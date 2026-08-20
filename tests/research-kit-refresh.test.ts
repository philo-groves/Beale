import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/main/workspaceService';
import { researchKitDefinition } from '../src/shared/researchKits';
import { resolvedTestResearchProfile } from './researchProfileFixture';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspaceService(root: string, githubFetch?: typeof fetch): WorkspaceService {
  return new WorkspaceService(() => undefined, {
    workspaceRegistryDirectory: join(root, 'registry'),
    honeycrispDatabasePath: join(root, 'memory.sqlite'),
    honeycrispArtifactDirectory: join(root, 'artifacts'),
    researchProfileResolver: () => resolvedTestResearchProfile(),
    githubFetch
  });
}

function workspaceDirectory(prefix: string): { root: string; workspacePath: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdDirectories.push(root);
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  return { root, workspacePath };
}

describe('Research Kit refresh', () => {
  it('refreshes selected Apple repository metadata while preserving clones and manual resources', async () => {
    const { root, workspacePath } = workspaceDirectory('beale-apple-kit-refresh-');
    const service = workspaceService(root, async () => new Response(JSON.stringify([{
      name: 'swift',
      html_url: 'https://github.com/apple-oss-distributions/swift',
      archived: true
    }]), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      service.createScopedWorkspace({
        workspacePath,
        researchKitId: 'apple-security-bounty',
        workspaceName: 'Apple Research',
        researchSubjectName: 'Apple',
        scopeOwner: 'Apple',
        descriptionMarkdown: 'Old guidance.',
        rules: [],
        expiresAt: null,
        assets: [{
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://github.com/apple-oss-distributions/swift',
          sensitivity: 'public',
          attributes: {
            source: 'apple-oss',
            repositoryUrl: 'https://github.com/apple-oss-distributions/swift',
            displayName: 'Old Swift',
            clonedDirectory: 'C:\\Research\\swift'
          }
        }, {
          direction: 'in_scope',
          kind: 'documentation',
          value: 'https://example.test/manual',
          sensitivity: 'public',
          attributes: { source: 'manual' }
        }]
      });

      const refreshed = await service.refreshResearchKit({});
      expect(refreshed).toMatchObject({
        researchKitId: 'apple-security-bounty',
        resourcesRefreshed: 1,
        rulesRefreshed: researchKitDefinition('apple-security-bounty').onboardingDefaults?.rules.length,
        guidanceRefreshed: true
      });
      expect(refreshed.snapshot.activeScope.descriptionMarkdown).toBe(
        researchKitDefinition('apple-security-bounty').onboardingDefaults?.descriptionMarkdown
      );
      expect(refreshed.snapshot.activeScope.assets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'repo',
          value: 'https://github.com/apple-oss-distributions/swift',
          attributes: expect.objectContaining({
            displayName: 'swift',
            archived: true,
            clonedDirectory: 'C:\\Research\\swift',
            researchKitId: 'apple-security-bounty',
            researchKitRefreshedAt: refreshed.refreshedAt
          })
        }),
        expect.objectContaining({ kind: 'documentation', value: 'https://example.test/manual' })
      ]));
    } finally {
      service.close();
    }
  });

  it('refreshes bundled MSRC rules and guidance without creating resources', async () => {
    const { root, workspacePath } = workspaceDirectory('beale-msrc-kit-refresh-');
    const service = workspaceService(root);
    try {
      service.createScopedWorkspace({
        workspacePath,
        researchKitId: 'msrc',
        workspaceName: 'Microsoft Research',
        researchSubjectName: 'Microsoft',
        scopeOwner: 'Microsoft',
        descriptionMarkdown: 'Old guidance.',
        rules: [],
        expiresAt: null,
        assets: []
      });
      const refreshed = await service.refreshResearchKit({});
      const definition = researchKitDefinition('msrc');
      expect(refreshed).toMatchObject({
        researchKitId: 'msrc',
        resourcesRefreshed: 0,
        rulesRefreshed: definition.onboardingDefaults?.rules.length,
        guidanceRefreshed: true
      });
      expect(refreshed.snapshot.activeScope.assets).toEqual([]);
      expect(refreshed.snapshot.workspaceRules.map((rule) => rule.text)).toEqual(definition.onboardingDefaults?.rules);
      expect(refreshed.snapshot.activeScope.descriptionMarkdown).toBe(definition.onboardingDefaults?.descriptionMarkdown);
    } finally {
      service.close();
    }
  });

  it('does not expose a refresh operation for the General kit', async () => {
    const { root, workspacePath } = workspaceDirectory('beale-general-kit-refresh-');
    const service = workspaceService(root);
    try {
      service.createScopedWorkspace({
        workspacePath,
        researchKitId: 'general',
        workspaceName: 'General Research',
        researchSubjectName: 'General',
        scopeOwner: 'General',
        descriptionMarkdown: '',
        rules: [],
        expiresAt: null,
        assets: []
      });
      await expect(service.refreshResearchKit({})).rejects.toThrow('no imports to refresh');
    } finally {
      service.close();
    }
  });
});
