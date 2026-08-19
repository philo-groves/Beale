import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketingService } from '../src/main/ticketingService';
import type { HoneycrispReportDocument, HoneycrispReportSummary } from '../src/shared/types';

const directories: string[] = [];
const encryption = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decrypt: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/u, '')
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ticketing service', () => {
  it('defaults to local reports without configuring an external system', async () => {
    const service = new TicketingService(null, null, { environment: {} });
    expect(service.getSettings()).toEqual({
      provider: 'local',
      automation: { humanInTheLoop: true },
      github: { credentialConfigured: false, credentialSource: null, targetId: null, targetLabel: null },
      linear: { credentialConfigured: false, credentialSource: null, targetId: null, targetLabel: null }
    });
    await expect(service.submit(report(), document())).rejects.toThrow('Local Reports Only');
  });

  it('defaults HITL on when loading ticketing settings written before automation existed', () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'ticketing-settings.json');
    writeFileSync(path, JSON.stringify({ version: 1, provider: 'local', targets: {}, credentials: {} }));
    expect(new TicketingService(path, encryption, { environment: {} }).getSettings().automation).toEqual({
      humanInTheLoop: true
    });
  });

  it('stores GitHub credentials encrypted, discovers repositories, and creates an issue', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'ticketing-settings.json');
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/user/repos')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer github-secret' });
        return jsonResponse([
          { full_name: 'acme/parser', has_issues: true, archived: false },
          { full_name: 'acme/archive', has_issues: true, archived: true },
          { full_name: 'acme/no-issues', has_issues: false, archived: false }
        ]);
      }
      expect(url).toBe('https://api.github.com/repos/acme/parser/issues');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ title: 'Parser vulnerability', body: '# Finding\n\nEvidence.' });
      return jsonResponse({ number: 42, title: 'Parser vulnerability', html_url: 'https://github.com/acme/parser/issues/42' });
    });
    const service = new TicketingService(path, encryption, { fetchImpl: fetchImpl as typeof fetch, environment: {} });

    expect((await service.configureCredential('github', 'github-secret')).github.credentialSource).toBe('managed');
    expect(await service.listTargets('github')).toEqual([{ id: 'acme/parser', label: 'acme/parser' }]);
    await service.setTarget('github', { id: 'acme/parser', label: 'untrusted label' });
    service.setProvider('github');

    expect(readFileSync(path, 'utf8')).not.toContain('github-secret');
    expect(new TicketingService(path, encryption, { fetchImpl: fetchImpl as typeof fetch, environment: {} }).getSettings()).toMatchObject({
      provider: 'github',
      github: { credentialConfigured: true, credentialSource: 'managed', targetId: 'acme/parser', targetLabel: 'acme/parser' }
    });
    await expect(service.submit(report(), document())).resolves.toEqual({
      provider: 'github',
      ticketId: '#42',
      title: 'Parser vulnerability',
      url: 'https://github.com/acme/parser/issues/42'
    });
  });

  it('discovers Linear teams and creates an issue through GraphQL', async () => {
    const requests: Array<{ query?: string; variables?: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'linear-secret' });
      const body = JSON.parse(String(init?.body)) as { query?: string; variables?: Record<string, unknown> };
      requests.push(body);
      return body.query?.includes('TicketingTeams')
        ? jsonResponse({ data: { teams: { nodes: [{ id: 'team-1', name: 'Security', key: 'SEC' }] } } })
        : jsonResponse({ data: { issueCreate: { success: true, issue: {
          id: 'issue-1', identifier: 'SEC-9', title: 'Parser vulnerability', url: 'https://linear.app/acme/issue/SEC-9/parser-vulnerability'
        } } } });
    });
    const service = new TicketingService(null, null, { fetchImpl: fetchImpl as typeof fetch, environment: { LINEAR_API_KEY: 'linear-secret' } });
    service.setProvider('linear');

    expect((await service.listTargets('linear'))[0]).toEqual({ id: 'team-1', label: 'Security (SEC)' });
    await service.setTarget('linear', { id: 'team-1', label: 'Security (SEC)' });
    await expect(service.submit(report(), document())).resolves.toMatchObject({ provider: 'linear', ticketId: 'SEC-9' });
    expect(requests.at(-1)?.variables).toEqual({ input: {
      teamId: 'team-1',
      title: 'Parser vulnerability',
      description: '# Finding\n\nEvidence.'
    } });
  });

  it('rejects unavailable targets and oversized report bodies', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ full_name: 'acme/parser', has_issues: true }]));
    const service = new TicketingService(null, null, { fetchImpl: fetchImpl as typeof fetch, environment: { GITHUB_TOKEN: 'token' } });
    await expect(service.setTarget('github', { id: 'other/repo', label: 'Other' })).rejects.toThrow('not available');
    await service.setTarget('github', { id: 'acme/parser', label: 'Parser' });
    service.setProvider('github');
    await expect(service.submit(report(), { reportId: 'report-1', content: 'x'.repeat(60_001) })).rejects.toThrow('too large');
  });

  it('defaults HITL on and automatically submits only newly completed reports once when disabled', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'ticketing-settings.json');
    let issueCreations = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/user/repos')) {
        return jsonResponse([{ full_name: 'acme/parser', has_issues: true }]);
      }
      issueCreations += 1;
      return jsonResponse({ number: 42, title: 'Parser vulnerability', html_url: 'https://github.com/acme/parser/issues/42' });
    });
    const options = {
      fetchImpl: fetchImpl as typeof fetch,
      environment: {},
      now: () => new Date('2026-08-18T01:00:00.000Z')
    };
    const service = new TicketingService(path, encryption, options);
    await service.configureCredential('github', 'github-secret');
    await service.setTarget('github', { id: 'acme/parser', label: 'acme/parser' });
    service.setProvider('github');
    expect(service.setHumanInTheLoop(false).automation.humanInTheLoop).toBe(false);

    const olderReport = report();
    const newerReport = { ...report(), updatedAt: '2026-08-18T02:00:00.000Z' };
    await service.submitAutomatically([olderReport, newerReport], () => document());
    await service.submitAutomatically([newerReport], () => document());
    expect(issueCreations).toBe(1);

    const reloaded = new TicketingService(path, encryption, options);
    expect(reloaded.getSettings().automation.humanInTheLoop).toBe(false);
    await reloaded.submitAutomatically([newerReport], () => document());
    expect(issueCreations).toBe(1);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'beale-ticketing-'));
  directories.push(directory);
  return directory;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function report(): HoneycrispReportSummary {
  return {
    id: 'report-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Parser',
    subjectId: null,
    subjectName: null,
    sessionId: null,
    title: 'Parser vulnerability',
    summary: 'A supported parser vulnerability.',
    status: 'complete',
    artifactId: 'artifact-1',
    submissionPacket: null,
    revision: 1,
    revisions: [],
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z'
  };
}

function document(): HoneycrispReportDocument {
  return { reportId: 'report-1', content: '# Finding\n\nEvidence.' };
}
