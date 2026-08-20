import { describe, expect, it } from 'vitest';
import { handleBealeRemoteRequest, isTailscaleIpv4Address } from '../src/main/bealeRemoteServer';
import type { WorkspaceRegistryState } from '../src/shared/types';

describe('Beale remote server', () => {
  it('recognizes only Tailscale IPv4 addresses', () => {
    expect(isTailscaleIpv4Address('100.64.0.1')).toBe(true);
    expect(isTailscaleIpv4Address('100.127.255.254')).toBe(true);
    expect(isTailscaleIpv4Address('100.128.0.1')).toBe(false);
    expect(isTailscaleIpv4Address('192.168.1.10')).toBe(false);
    expect(isTailscaleIpv4Address('not-an-address')).toBe(false);
  });

  it('returns a path-free read-only workspace projection', () => {
    const response = handleBealeRemoteRequest(
      JSON.stringify({ version: 1, action: 'list_workspaces' }),
      registryFixture(),
      { name: 'Research Mac', address: '100.110.195.79', port: 59_728 }
    );

    expect(response).toEqual({
      ok: true,
      version: 1,
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

  it('rejects malformed and expanded requests', () => {
    expect(handleBealeRemoteRequest('not-json', registryFixture(), hostFixture())).toMatchObject({ ok: false });
    expect(handleBealeRemoteRequest(
      JSON.stringify({ version: 1, action: 'list_workspaces', workspacePath: '/tmp' }),
      registryFixture(),
      hostFixture()
    )).toMatchObject({ ok: false });
  });
});

function hostFixture() {
  return { name: 'Research Mac', address: '100.110.195.79', port: 59_728 };
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
