import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScopeAsset, WorkspaceSnapshot, WorkspaceSummary } from '@shared/types';
import { WorkspaceService } from '../src/main/workspaceService';
import { resolvedTestResearchProfile } from './researchProfileFixture';

interface ResourceToolResult {
  workspace: WorkspaceSummary;
  scopeVersion: number;
  resources: ScopeAsset[];
}

interface IntrospectionInvoker {
  invokeBealeIntrospectionTool(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Beale introspection tools', () => {
  it('rejects unregistered paths without creating or selecting a workspace', async () => {
    const { service, workspace } = createService();
    const introspection = service as unknown as IntrospectionInvoker;
    const unregistered = join(dirname(workspace), 'unregistered-repository');
    mkdirSync(unregistered, { recursive: true });

    try {
      const before = service.getWorkspaceRegistryState();
      await expect(introspection.invokeBealeIntrospectionTool('list_resources', {
        workspacePath: unregistered
      })).rejects.toThrow('Introspection can only access registered Beale workspaces');
      await expect(introspection.invokeBealeIntrospectionTool('create_workspace', {
        workspacePath: unregistered
      })).rejects.toThrow('Unknown Beale introspection tool');
      expect(service.getSnapshot()?.workspace.workspacePath).toBe(workspace);
      expect(service.getWorkspaceRegistryState().workspaces.map(({ id }) => id)).toEqual(
        before.workspaces.map(({ id }) => id)
      );
      expect(existsSync(join(unregistered, '.beale'))).toBe(false);
    } finally {
      service.dispose();
    }
  });

  it('views and edits a registered background workspace without activating it', async () => {
    const { service, workspace } = createService();
    const introspection = service as unknown as IntrospectionInvoker;
    const secondWorkspace = join(dirname(workspace), 'second-workspace');

    try {
      service.createWorkspace(secondWorkspace);
      const registry = service.getWorkspaceRegistryState();
      const first = registry.workspaces.find((entry) => entry.workspacePath === workspace);
      const second = registry.workspaces.find((entry) => entry.workspacePath === secondWorkspace);
      if (!first || !second) throw new Error('Expected both workspaces to be registered.');
      service.openRegisteredWorkspace(first.id);

      const added = await introspection.invokeBealeIntrospectionTool('add_resource', {
        registryWorkspaceId: second.id,
        kind: 'repo',
        value: 'https://github.com/example/background'
      }) as ResourceToolResult;
      expect(added.workspace.workspacePath).toBe(secondWorkspace);
      expect(added.resources).toHaveLength(1);
      expect(service.getSnapshot()?.workspace.workspacePath).toBe(workspace);

      const listed = await introspection.invokeBealeIntrospectionTool('list_resources', {
        workspacePath: secondWorkspace
      }) as ResourceToolResult;
      expect(listed.resources[0]?.value).toBe('https://github.com/example/background');
      expect(service.getSnapshot()?.workspace.workspacePath).toBe(workspace);
    } finally {
      service.dispose();
    }
  });

  it('lists, adds, edits, and removes versioned workspace resources', async () => {
    const { service, workspace } = createService();
    const introspection = service as unknown as IntrospectionInvoker;

    try {
      const added = await introspection.invokeBealeIntrospectionTool('add_resource', {
        workspacePath: workspace,
        kind: 'repo',
        value: 'https://github.com/example/first',
        displayName: 'First repository',
        attributes: { branch: 'main' }
      }) as ResourceToolResult;
      expect(added.scopeVersion).toBe(2);
      expect(added.resources).toHaveLength(1);
      expect(added.resources[0]).toMatchObject({
        direction: 'in_scope',
        kind: 'repo',
        value: 'https://github.com/example/first',
        sensitivity: 'internal',
        attributes: {
          branch: 'main',
          displayName: 'First repository',
          repositoryUrl: 'https://github.com/example/first'
        }
      });

      const listed = await introspection.invokeBealeIntrospectionTool('list_resources', {
        kind: 'repo',
        direction: 'in_scope'
      }) as ResourceToolResult;
      expect(listed.scopeVersion).toBe(2);
      expect(listed.resources.map((resource) => resource.id)).toEqual([added.resources[0].id]);

      const edited = await introspection.invokeBealeIntrospectionTool('edit_resource', {
        resourceId: added.resources[0].id,
        value: 'https://github.com/example/second',
        displayName: 'Second repository',
        sensitivity: 'public'
      }) as ResourceToolResult;
      expect(edited.scopeVersion).toBe(3);
      expect(edited.resources[0]).toMatchObject({
        value: 'https://github.com/example/second',
        sensitivity: 'public',
        attributes: {
          branch: 'main',
          displayName: 'Second repository',
          repositoryUrl: 'https://github.com/example/second'
        }
      });

      const removed = await introspection.invokeBealeIntrospectionTool('remove_resource', {
        resourceId: edited.resources[0].id
      }) as ResourceToolResult;
      expect(removed.scopeVersion).toBe(4);
      expect(removed.resources).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  it('routes Dejunk and Dreaming through the existing maintenance services', async () => {
    const { service } = createService();
    const introspection = service as unknown as IntrospectionInvoker;

    try {
      const snapshot = service.getSnapshot() as WorkspaceSnapshot;
      const dejunk = vi.spyOn(service, 'runWorkspaceDejunk').mockReturnValue(snapshot);
      const dreaming = vi.spyOn(service, 'runMemoryDreaming').mockResolvedValue(snapshot);

      await expect(introspection.invokeBealeIntrospectionTool('run_dejunk', {})).resolves.toMatchObject({
        workspace: snapshot.workspace,
        dejunk: snapshot.workspace.dejunk
      });
      await expect(introspection.invokeBealeIntrospectionTool('run_dreaming', {})).resolves.toMatchObject({
        workspace: snapshot.workspace,
        dreaming: snapshot.honeycrispMemory.dreaming
      });
      expect(dejunk).toHaveBeenCalledOnce();
      expect(dreaming).toHaveBeenCalledOnce();
    } finally {
      service.dispose();
    }
  });
});

function createService(): { service: WorkspaceService; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), 'beale-introspection-tools-'));
  roots.push(root);
  const workspace = join(root, 'workspace');
  const service = new WorkspaceService(() => undefined, {
    workspaceRegistryDirectory: join(root, 'registry'),
    honeycrispDatabasePath: join(root, 'honeycrisp', 'memory.sqlite'),
    honeycrispArtifactDirectory: join(root, 'honeycrisp', 'artifacts'),
    researchProfileResolver: () => resolvedTestResearchProfile()
  });
  service.createWorkspace(workspace);
  return { service, workspace };
}
