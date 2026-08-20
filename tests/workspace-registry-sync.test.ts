import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceRegistry } from '../src/main/workspaceRegistry';
import type { WorkspaceSnapshot } from '../src/shared/types';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('workspace registry synchronization', () => {
  it('does not duplicate the AGENTS.md-backed description in registry metadata', () => {
    const registryDirectory = mkdtempSync(join(tmpdir(), 'beale-registry-description-'));
    temporaryDirectories.push(registryDirectory);
    const registry = new WorkspaceRegistry(registryDirectory);
    const snapshot = registrySnapshot();
    snapshot.activeScope.descriptionMarkdown = '# Workspace instructions';
    snapshot.runs = [];

    try {
      registry.syncWorkspace(snapshot);
      expect(registry.getState().workspaces[0]?.descriptionMarkdown).toBe('');
    } finally {
      registry.close();
    }
  });

  it('commits workspace metadata and session rows atomically', () => {
    const registryDirectory = mkdtempSync(join(tmpdir(), 'beale-registry-sync-'));
    temporaryDirectories.push(registryDirectory);
    const registry = new WorkspaceRegistry(registryDirectory);
    const snapshot = registrySnapshot();
    snapshot.runs.push({
      ...snapshot.runs[0]!,
      run: { ...snapshot.runs[0]!.run, id: null as unknown as string }
    });

    try {
      expect(() => registry.syncWorkspace(snapshot)).toThrow();
      expect(registry.getState()).toMatchObject({ workspaces: [], researchSessions: [] });
    } finally {
      registry.close();
    }
  });
});

function registrySnapshot(): WorkspaceSnapshot {
  const createdAt = '2026-08-18T12:00:00.000Z';
  return {
    workspace: {
      workspaceId: 'workspace_atomic',
      workspacePath: 'C:\\research\\atomic',
      workspaceDirectories: ['C:\\research\\atomic']
    },
    activeScope: {
      workspaceName: 'Atomic Workspace',
      scopeOwner: 'Researcher',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      expiresAt: null
    },
    researchProfile: { profileId: 'security-research' },
    runs: [{
      engine: 'honeycrisp',
      run: {
        id: 'run_valid',
        status: 'completed',
        mode: 'dynamic',
        title: 'Valid session',
        promptMarkdown: '',
        summary: '',
        finalDisposition: null,
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        sandboxProfile: 'host',
        createdAt,
        startedAt: createdAt,
        endedAt: createdAt
      }
    }]
  } as unknown as WorkspaceSnapshot;
}
