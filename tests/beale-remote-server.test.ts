import { describe, expect, it } from 'vitest';
import { handleBealeRemoteRequest, isTailscaleIpv4Address } from '../src/main/bealeRemoteServer';
import type { HoneycrispMemorySummary, WorkspaceRegistryState } from '../src/shared/types';

describe('Beale remote server', () => {
  it('recognizes only Tailscale IPv4 addresses', () => {
    expect(isTailscaleIpv4Address('100.64.0.1')).toBe(true);
    expect(isTailscaleIpv4Address('100.127.255.254')).toBe(true);
    expect(isTailscaleIpv4Address('100.128.0.1')).toBe(false);
    expect(isTailscaleIpv4Address('192.168.1.10')).toBe(false);
    expect(isTailscaleIpv4Address('not-an-address')).toBe(false);
  });

  it('returns a path-free read-only workspace projection', async () => {
    const response = await handleBealeRemoteRequest(
      JSON.stringify({ version: 1, action: 'list_workspaces' }),
      registryFixture(),
      { name: 'Research Mac', address: '100.110.195.79', port: 59_728 }
    );

    expect(response).toEqual({
      ok: true,
      version: 1,
      action: 'list_workspaces',
      host: { name: 'Research Mac', address: '100.110.195.79', port: 59_728 },
      workspaces: [{
        id: 'registry-one',
        name: 'Parser',
        researchProfileId: 'security-research',
        researchKitId: 'general',
        runCount: 3,
        lastRunAt: '2026-08-19T12:00:00.000Z',
        updatedAt: '2026-08-20T12:00:00.000Z'
      }]
    });
    expect(JSON.stringify(response)).not.toContain('/Users/research/parser');
    expect(JSON.stringify(response)).not.toContain('private rule');
  });

  it('returns workspace-scoped memory without host storage paths or evidence locators', async () => {
    const response = await handleBealeRemoteRequest(
      JSON.stringify({ version: 1, action: 'get_workspace_memory', registryWorkspaceId: 'registry-one' }),
      registryFixture(),
      hostFixture(),
      async (registryWorkspaceId) => {
        expect(registryWorkspaceId).toBe('registry-one');
        return memoryFixture();
      }
    );

    expect(response).toMatchObject({
      ok: true,
      version: 1,
      action: 'get_workspace_memory',
      workspace: { id: 'registry-one', name: 'Parser' },
      memory: {
        status: 'ready',
        nodeCount: 1,
        nodes: [{
          id: 'memory-one',
          title: 'Length validation',
          body: 'Validate the declared length before allocation.',
          evidence: [{ kind: 'code', summary: 'Parser check', createdAt: '2026-08-20T12:00:00.000Z' }]
        }]
      }
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('/Users/research/.honeycrisp/memory.sqlite');
    expect(serialized).not.toContain('/Users/research/parser/src/parser.c');
    expect(serialized).not.toContain('lineStart');
  });

  it('rejects malformed and expanded requests', async () => {
    await expect(handleBealeRemoteRequest('not-json', registryFixture(), hostFixture())).resolves.toMatchObject({ ok: false });
    await expect(handleBealeRemoteRequest(
      JSON.stringify({ version: 1, action: 'list_workspaces', workspacePath: '/tmp' }),
      registryFixture(),
      hostFixture()
    )).resolves.toMatchObject({ ok: false });
    await expect(handleBealeRemoteRequest(
      JSON.stringify({ version: 1, action: 'get_workspace_memory', registryWorkspaceId: 'missing' }),
      registryFixture(),
      hostFixture()
    )).resolves.toMatchObject({ ok: false });
  });
});

function hostFixture() {
  return { name: 'Research Mac', address: '100.110.195.79', port: 59_728 };
}

function memoryFixture(): HoneycrispMemorySummary {
  return {
    status: 'ready',
    source: 'honeycrisp_sqlite',
    contextWorkspaceId: 'workspace-one',
    contextSubjectId: 'subject-one',
    databasePath: '/Users/research/.honeycrisp/memory.sqlite',
    storageRoot: '/Users/research/.honeycrisp',
    artifactDirectoryPath: '/Users/research/.honeycrisp/artifacts',
    databaseSizeBytes: 1_024,
    nodeCount: 1,
    edgeCount: 0,
    evidenceRefCount: 1,
    storageArtifactCount: 0,
    runbookCount: 0,
    reportCount: 0,
    latestNodeUpdatedAt: '2026-08-20T12:00:00.000Z',
    nodeTypeCounts: { invariant: 1 },
    nodeStatusCounts: { confirmed: 1 },
    nodes: [{
      id: 'memory-one',
      sessionIds: ['session-one'],
      workspaces: [{ id: 'workspace-one', name: 'Parser' }],
      subjectId: 'subject-one',
      subjectName: 'Parser',
      type: 'invariant',
      title: 'Length validation',
      summary: 'The parser validates its declared input length.',
      body: 'Validate the declared length before allocation.',
      status: 'confirmed',
      confidence: 0.95,
      assetIds: [],
      tags: ['parser'],
      attributes: {},
      evidenceRefs: [{
        id: 'evidence-one',
        kind: 'code',
        pathBase: '/Users/research/parser',
        path: '/Users/research/parser/src/parser.c',
        locator: { lineStart: 42 },
        summary: 'Parser check',
        createdAt: '2026-08-20T12:00:00.000Z'
      }],
      createdAt: '2026-08-19T12:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
      revision: 1
    }],
    edges: [],
    runbooks: [],
    reports: [],
    dreaming: {
      available: false,
      scope: 'workspace',
      hiddenNodeCount: 0,
      restorableChangeCount: 0,
      lastRun: null,
      changes: []
    },
    directories: [],
    lastError: null
  };
}

function registryFixture(): WorkspaceRegistryState {
  return {
    registryPath: '/Users/research/.honeycrisp/workspaces.sqlite',
    researchSessions: [],
    workspaces: [{
      id: 'registry-one',
      workspacePath: '/Users/research/parser',
      workspaceDirectories: ['/Users/research/parser'],
      workspaceId: 'workspace-one',
      workspaceName: 'Parser',
      researchProfileId: 'security-research',
      researchKitId: 'general',
      scopeOwner: 'Researcher',
      descriptionMarkdown: 'Sensitive description',
      rulesMarkdown: 'private rule',
      expiresAt: null,
      createdAt: '2026-08-18T12:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
      lastOpenedAt: '2026-08-20T12:00:00.000Z',
      runCount: 3,
      lastRunAt: '2026-08-19T12:00:00.000Z'
    }]
  };
}
