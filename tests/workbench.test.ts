import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScopeAssetKind, StartRunInput } from '@shared/types';
import { WorkspaceDatabase } from '../src/main/database';
import { startRunForTest, WorkspaceService } from '../src/main/workspaceService';

const createdDirs: string[] = [];

afterEach(() => {
  delete process.env.BEALE_TEST_FAIL_ATOMIC_EXPORT;
  delete process.env.BEALE_VMCTL_COMMAND;
  delete process.env.BEALE_VMCTL_ARGS_JSON;
  delete process.env.BEALE_VMCTL_TIMEOUT_MS;
  delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
  delete process.env.BEALE_OPENAI_AUTH_COMMAND;
  delete process.env.BEALE_OPENAI_AUTH_ARGS_JSON;
  delete process.env.OPENAI_API_KEY;
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Beale workbench skeleton', () => {
  it('initializes and reopens a workspace-local SQLite database', () => {
    const dir = tempWorkspace();
    const service = new WorkspaceService();

    const snapshot = service.createWorkspace(dir);
    expect(snapshot.workspace.workspacePath).toBe(dir);
    expect(snapshot.workspace.databasePath).toBe(join(dir, '.beale', 'beale.sqlite'));
    expect(snapshot.activeScope.version).toBe(1);
    expect(snapshot.activeScope.programName).toBe('Untitled Program');
    expect(snapshot.openAi.credentialsHostOnly).toBe(true);
    expect(snapshot.openAi.readiness).toBe('not_configured');
    expect(snapshot.openAi.onboardingSteps.some((step) => step.id === 'secret_isolation')).toBe(true);
    expect(snapshot.projectSemantic).toMatchObject({ enabled: true, remoteEmbeddingEnabled: false });
    expect(['empty', 'queued', 'ready']).toContain(snapshot.projectSemantic.status);
    expect(service.refreshOpenAiStatus().openAi.readiness).toBe('not_configured');
    const enabledSemantic = service.setProjectSemanticIndexEnabled(true);
    expect(enabledSemantic.projectSemantic.enabled).toBe(true);
    expect(['empty', 'queued', 'ready']).toContain(enabledSemantic.projectSemantic.status);
    expect(service.refreshProjectSemanticIndex().projectSemantic.enabled).toBe(true);
    expect(service.setProjectSemanticIndexEnabled(false).projectSemantic.status).toBe('disabled');
    expect(existsSync(join(dir, '.beale', 'beale.sqlite'))).toBe(true);
    expect(existsSync(join(dir, '.beale', 'artifacts', 'sha256'))).toBe(true);

    const workspaceId = snapshot.workspace.workspaceId;
    service.close();

    const reopened = service.openWorkspace(dir);
    expect(reopened.workspace.workspaceId).toBe(workspaceId);
    expect(reopened.activeScope.version).toBe(1);
    service.close();
  });

  it('onboards programs into the global registry and mirrors run summaries', () => {
    const workspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });

    expect(service.getProgramRegistryState().programs).toHaveLength(0);
    const inspection = service.inspectProgramDirectory(workspace);
    expect(inspection.requiresOnboarding).toBe(true);
    expect(inspection.defaults?.workspacePath).toBe(workspace);
    expect(existsSync(join(workspace, '.beale'))).toBe(false);

    const snapshot = service.createProgram({
      workspacePath: workspace,
      programName: 'Acme Bug Bounty',
      organizationName: '',
      descriptionMarkdown: 'Authorized parser research.',
      rulesMarkdown: 'Stay inside recorded scope.',
      networkProfile: 'offline',
      expiresAt: '   '
    });
    expect(snapshot.activeScope.programName).toBe('Acme Bug Bounty');
    expect(snapshot.activeScope.organizationName).toBe('');
    expect(snapshot.activeScope.expiresAt).toBeNull();
    expect(existsSync(join(workspace, '.beale', 'beale.sqlite'))).toBe(true);

    const registered = service.getProgramRegistryState();
    expect(registered.registryPath).toBe(join(registryDir, 'registry.sqlite'));
    expect(registered.programs).toHaveLength(1);
    expect(registered.programs[0]).toMatchObject({
      workspacePath: workspace,
      programName: 'Acme Bug Bounty',
      organizationName: '',
      runCount: 0
    });
    expect(service.inspectProgramDirectory(workspace).knownProgram?.id).toBe(registered.programs[0].id);

    const runSnapshot = service.startRun(runInput('verified_finding'), 'complete');
    const latestRun = runSnapshot.runs[0]?.run;
    expect(latestRun).toBeTruthy();
    const withRun = service.getProgramRegistryState();
    expect(withRun.programs[0].runCount).toBe(1);
    expect(withRun.researchSessions[0]).toMatchObject({
      programId: withRun.programs[0].id,
      workspacePath: workspace,
      runId: latestRun?.id,
      title: latestRun?.title,
      promptMarkdown: '# Test run\nExercise the fake workbench path.',
      status: latestRun?.status,
      runEngine: 'fake'
    });
    service.close();

    const reopened = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });
    const persisted = reopened.getProgramRegistryState();
    expect(persisted.programs[0].programName).toBe('Acme Bug Bounty');
    expect(persisted.researchSessions[0].runId).toBe(latestRun?.id);
    expect(reopened.openProgram(persisted.programs[0].id).activeScope.programName).toBe('Acme Bug Bounty');
    reopened.close();
  });

  it('persists the global VM enablement preference', () => {
    const workspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });

    const snapshot = service.createWorkspace(workspace);
    expect(snapshot.vmPreference).toMatchObject({ enabled: false, backendKind: null });
    expect(service.getProgramRegistryState().vmPreference).toMatchObject({ enabled: false, backendKind: null });

    const enabled = service.setVmPreference({ enabled: true, backendKind: 'firecracker' });
    expect(enabled.vmPreference).toMatchObject({ enabled: true, backendKind: 'firecracker' });
    expect(service.getSnapshot()?.vmPreference).toMatchObject({ enabled: true, backendKind: 'firecracker' });
    service.close();

    const reopened = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });
    expect(reopened.getProgramRegistryState().vmPreference).toMatchObject({ enabled: true, backendKind: 'firecracker' });
    expect(reopened.openWorkspace(workspace).vmPreference).toMatchObject({ enabled: true, backendKind: 'firecracker' });

    const disabled = reopened.setVmPreference({ enabled: false, backendKind: null });
    expect(disabled.vmPreference).toMatchObject({ enabled: false, backendKind: null });
    reopened.close();
  });

  it('reports a cheap run detail version for active polling', () => {
    const service = openService();
    const snapshot = service.startRun(runInput('source_logic_bug'), 'complete');
    const runId = snapshot.runs[0]?.run.id ?? '';

    const initial = service.getRunDetailVersion(runId);
    const unchanged = service.getRunDetailVersion(runId);
    expect(initial.version).toBe(unchanged.version);
    expect(initial.databaseMs).toBeGreaterThanOrEqual(0);

    const detail = service.getRunDetail(runId);
    const afterTraceSequence = detail.traceEvents.at(-1)?.sequence ?? -1;
    const afterTranscriptCount = detail.transcriptMessages.length;
    service.steerRun({ type: 'update_run_budget', runId, budgetPatch: { maxMinutes: 60 }, note: 'version test' });

    const updated = service.getRunDetailVersion(runId);
    expect(updated.version).not.toBe(initial.version);
    const update = service.getRunDetailUpdate(runId, { afterTraceSequence, afterTranscriptCount });
    expect(update.version.version).toBe(updated.version);
    expect(update.traceEvents.every((event) => event.sequence > afterTraceSequence)).toBe(true);
    expect(update.traceEvents.length).toBeGreaterThan(0);
    service.close();
  });

  it('searches session transcripts in the active workspace', () => {
    const service = openService();
    const snapshot = service.startRun(runInput('source_logic_bug'), 'complete');
    const runId = snapshot.runs[0]?.run.id ?? '';

    const response = service.searchSessionTranscripts({ query: 'fake workbench', limit: 5 });
    expect(response.totalTranscriptMatches).toBe(1);
    expect(response.programCount).toBe(1);
    expect(response.programs[0]).toMatchObject({
      programName: 'Untitled Program',
      totalTranscriptMatches: 1
    });
    expect(response.results[0]).toMatchObject({
      runId,
      role: 'user',
      source: 'run_prompt'
    });
    expect(response.results[0].contentPreview).toContain('fake workbench');
    expect(service.searchSessionTranscripts({ query: 'not-present-in-session-transcripts' })).toEqual({
      results: [],
      totalTranscriptMatches: 0,
      programCount: 0,
      programs: []
    });
    service.close();
  });

  it('reports transcript search totals beyond the visible result limit', () => {
    const service = openService();
    service.startRun({ ...runInput('source_logic_bug'), promptMarkdown: '# First\nlimitedneedle first transcript.' }, 'complete');
    service.startRun({ ...runInput('source_logic_bug'), promptMarkdown: '# Second\nlimitedneedle second transcript.' }, 'complete');

    const response = service.searchSessionTranscripts({ query: 'limitedneedle', limit: 1 });
    expect(response.results).toHaveLength(1);
    expect(response.totalTranscriptMatches).toBe(2);
    expect(response.programCount).toBe(1);
    expect(response.programs[0]).toMatchObject({
      programName: 'Untitled Program',
      totalTranscriptMatches: 2
    });
    service.close();
  });

  it('searches the current program by default and can opt into loaded programs', () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });

    service.createProgram({
      workspacePath: firstWorkspace,
      programName: 'First Program',
      organizationName: '',
      descriptionMarkdown: 'First persisted program.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.startRun({ ...runInput('source_logic_bug'), promptMarkdown: '# First\nsharedneedle first transcript.' }, 'complete');
    service.createProgram({
      workspacePath: secondWorkspace,
      programName: 'Second Program',
      organizationName: '',
      descriptionMarkdown: 'Second persisted program.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.startRun({ ...runInput('source_logic_bug'), promptMarkdown: '# Second\nsharedneedle second transcript.' }, 'complete');

    const currentOnly = service.searchSessionTranscripts({ query: 'sharedneedle', limit: 10 });
    expect(currentOnly.totalTranscriptMatches).toBe(1);
    expect(currentOnly.programCount).toBe(1);
    expect(currentOnly.programs).toHaveLength(1);
    expect(currentOnly.programs[0]).toMatchObject({
      programName: 'Second Program',
      totalTranscriptMatches: 1
    });
    expect(new Set(currentOnly.results.map((result) => result.programName))).toEqual(new Set(['Second Program']));

    const acrossLoaded = service.searchSessionTranscripts({ query: 'sharedneedle', limit: 10, currentProgramOnly: false });
    expect(acrossLoaded.totalTranscriptMatches).toBe(2);
    expect(acrossLoaded.programCount).toBe(2);
    expect(new Map(acrossLoaded.programs.map((program) => [program.programName, program.totalTranscriptMatches]))).toEqual(
      new Map([
        ['First Program', 1],
        ['Second Program', 1]
      ])
    );
    expect(new Set(acrossLoaded.results.map((result) => result.programName))).toEqual(new Set(['First Program', 'Second Program']));
    expect(acrossLoaded.results.every((result) => result.workspacePath === firstWorkspace || result.workspacePath === secondWorkspace)).toBe(true);
    service.close();
  });

  it('keeps program sidebar order stable when programs are opened', () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });

    service.createProgram({
      workspacePath: firstWorkspace,
      programName: 'First Program',
      organizationName: '',
      descriptionMarkdown: 'First persisted program.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.createProgram({
      workspacePath: secondWorkspace,
      programName: 'Second Program',
      organizationName: '',
      descriptionMarkdown: 'Second persisted program.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });

    const initialOrder = service.getProgramRegistryState().programs.map((program) => program.id);
    const firstProgram = service.getProgramRegistryState().programs.find((program) => program.programName === 'First Program');
    expect(firstProgram).toBeTruthy();
    service.openProgram(firstProgram?.id ?? '');
    expect(service.getProgramRegistryState().programs.map((program) => program.id)).toEqual(initialOrder);
    service.close();
  });

  it('keeps active research sessions running when another program is opened', async () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });

    service.createProgram({
      workspacePath: firstWorkspace,
      programName: 'First Program',
      organizationName: '',
      descriptionMarkdown: 'First persisted program.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    const firstProgram = service.getProgramRegistryState().programs.find((program) => program.programName === 'First Program');
    const activeSnapshot = service.startRun(runInput('source_logic_bug'), 'scheduled');
    const runId = activeSnapshot.runs[0]?.run.id ?? '';
    const initialTraceCount = service.getRunDetail(runId).traceEvents.length;

    service.createProgram({
      workspacePath: secondWorkspace,
      programName: 'Second Program',
      organizationName: '',
      descriptionMarkdown: 'Second persisted program.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    expect(service.getSnapshot()?.activeScope.programName).toBe('Second Program');

    await new Promise<void>((resolve) => setTimeout(resolve, 950));
    const backgroundSession = service.getProgramRegistryState().researchSessions.find((session) => session.runId === runId);
    expect(backgroundSession?.status).toBe('active');

    service.openProgram(firstProgram?.id ?? '');
    const detail = service.getRunDetail(runId);
    expect(detail.run.status).toBe('active');
    expect(detail.traceEvents.length).toBeGreaterThan(initialTraceCount);
    expect(detail.traceEvents.some((event) => event.summary === 'Workspace recovery paused interrupted run after app restart.')).toBe(false);
    service.close();
  });

  it('does not broadcast full workspace snapshots for active trace-only runtime updates', async () => {
    const workspace = tempWorkspace();
    const changes: boolean[] = [];
    const service = new WorkspaceService((change) => changes.push(change.programRegistryChanged));

    service.createWorkspace(workspace);
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    changes.length = 0;

    const snapshot = service.startRun(runInput('source_logic_bug'), 'scheduled');
    const runId = snapshot.runs[0]?.run.id ?? '';
    const initialTraceCount = service.getRunDetail(runId).traceEvents.length;
    expect(changes).toEqual([true]);

    await new Promise<void>((resolve) => setTimeout(resolve, 950));
    expect(service.getRunDetail(runId).traceEvents.length).toBeGreaterThan(initialTraceCount);
    expect(changes).toEqual([true]);
    service.close();
  });

  it('removes programs from the global registry without deleting workspaces', () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });

    service.createProgram({
      workspacePath: firstWorkspace,
      programName: 'First Program',
      organizationName: '',
      descriptionMarkdown: 'First persisted program.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.createProgram({
      workspacePath: secondWorkspace,
      programName: 'Second Program',
      organizationName: '',
      descriptionMarkdown: 'Second persisted program.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });

    const secondProgram = service.getProgramRegistryState().programs.find((program) => program.programName === 'Second Program');
    expect(secondProgram).toBeTruthy();
    expect(service.removeProgram(secondProgram?.id ?? '')).toBeNull();
    expect(service.getSnapshot()).toBeNull();
    expect(existsSync(secondWorkspace)).toBe(true);

    const remaining = service.getProgramRegistryState().programs;
    expect(remaining.map((program) => program.programName)).toEqual(['First Program']);
    expect(service.openProgram(remaining[0]?.id ?? '').activeScope.programName).toBe('First Program');
    service.close();
  });

  it('reopens the last known program and skips missing workspaces gracefully', () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });

    service.createProgram({
      workspacePath: firstWorkspace,
      programName: 'First Program',
      organizationName: '',
      descriptionMarkdown: 'First persisted program.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.createProgram({
      workspacePath: secondWorkspace,
      programName: 'Second Program',
      organizationName: '',
      descriptionMarkdown: 'Second persisted program.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.dispose();

    const reopened = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });
    const restored = reopened.openLastProgramIfAvailable();
    expect(restored?.activeScope.programName).toBe('Second Program');
    expect(reopened.getSnapshot()?.workspace.workspacePath).toBe(secondWorkspace);
    reopened.dispose();

    rmSync(secondWorkspace, { recursive: true, force: true });
    const missing = new WorkspaceService(() => undefined, { programRegistryDirectory: registryDir });
    expect(missing.openLastProgramIfAvailable()).toBeNull();
    expect(missing.getSnapshot()).toBeNull();
    expect(missing.getProgramRegistryState().programs.some((program) => program.workspacePath === secondWorkspace)).toBe(true);
    missing.dispose();
  });

  it('looks up HackerOne program metadata and imports public structured scope', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-hackerone-import-review';
    const modelRequests: Record<string, unknown>[] = [];
    const service = new WorkspaceService(() => undefined, {
      programRegistryDirectory: tempWorkspace(),
      hackerOneFetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { variables: { handle: string } };
        expect(body.variables.handle).toBe('github');
        return new Response(
          JSON.stringify({
            data: {
              team: {
                handle: 'github',
                name: 'GitHub',
                url: 'https://hackerone.com/github',
                policy: '# GitHub policy\nStay in scope.',
                submission_state: 'open',
                structured_scopes: {
                  total_count: 2,
                  nodes: [
                    {
                      asset_type: 'URL',
                      asset_identifier: 'github.com',
                      instruction: 'Main application.',
                      eligible_for_bounty: true,
                      eligible_for_submission: true,
                      max_severity: 'critical',
                      url: 'https://hackerone.com/github/asset/1'
                    },
                    {
                      asset_type: 'OTHER',
                      asset_identifier: 'Third-party services',
                      instruction: 'Not accepted.',
                      eligible_for_bounty: false,
                      eligible_for_submission: false,
                      max_severity: null,
                      url: 'https://hackerone.com/github/asset/2'
                    }
                  ]
                }
              }
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      openAiFetch: async (_url, init) => {
        const request = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        modelRequests.push(request);
        expect(request.model).toBe('gpt-5.5');
        expect(request.tools).toEqual([]);
        expect(request.reasoning).toEqual({ effort: 'medium' });
        expect(JSON.stringify(request)).toContain('github.com');
        expect(JSON.stringify(request)).toContain('Third-party services');
        const review = {
          programName: 'GitHub',
          organizationName: 'GitHub',
          scopeMarkdown: '## Scope\n- In scope: github.com\n- Out of scope: Third-party services',
          rulesMarkdown: '## Rules\nStay in scope. Verify the current HackerOne page before live testing.'
        };
        return new Response(
          sse(
            event('response.output_text.done', { type: 'response.output_text.done', text: JSON.stringify(review) }) +
              event('response.completed', { type: 'response.completed', response: { id: 'resp_hackerone_import' } })
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        );
      }
    });

    const lookup = await service.lookupHackerOneProgram('https://hackerone.com/github');
    expect(lookup).toMatchObject({
      handle: 'github',
      sourceUrl: 'https://hackerone.com/github',
      programName: 'GitHub',
      organizationName: 'GitHub',
      descriptionMarkdown: 'Authorized research under the GitHub Security Bounty program on HackerOne.',
      networkProfile: 'elevated',
      importedScopeCount: 2
    });
    expect(modelRequests).toHaveLength(1);
    expect(JSON.stringify(modelRequests[0])).not.toContain('descriptionMarkdown');
    expect(lookup.rulesMarkdown).toContain('## Scope');
    expect(lookup.rulesMarkdown).toContain('## Rules');
    expect(lookup.rulesMarkdown).not.toContain('# GitHub policy');
    expect(lookup.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'in_scope',
          kind: 'domain',
          value: 'github.com',
          sensitivity: 'public',
          attributes: expect.objectContaining({ hackerOneHandle: 'github', hackerOneSourceUrl: 'https://hackerone.com/github' })
        }),
        expect.objectContaining({
          direction: 'out_of_scope',
          kind: 'other',
          value: 'Third-party services',
          sensitivity: 'public',
          attributes: expect.objectContaining({ hackerOneHandle: 'github', hackerOneSourceUrl: 'https://hackerone.com/github' })
        })
      ])
    );

    service.close();
  });

  it('requires OpenAI authentication before HackerOne lookup or import', async () => {
    delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
    delete process.env.BEALE_OPENAI_AUTH_COMMAND;
    delete process.env.OPENAI_API_KEY;
    let requestedHackerOne = false;
    const service = new WorkspaceService(() => undefined, {
      programRegistryDirectory: tempWorkspace(),
      hackerOneFetch: async () => {
        requestedHackerOne = true;
        return new Response('{}', { status: 200 });
      }
    });

    await expect(service.lookupHackerOneProgram('github')).rejects.toThrow(/Authenticate with OpenAI first/);
    expect(requestedHackerOne).toBe(false);
    expect(() =>
      service.createProgram({
        workspacePath: tempWorkspace(),
        programName: 'GitHub',
        organizationName: 'GitHub',
        descriptionMarkdown: '',
        rulesMarkdown: '',
        networkProfile: 'scoped',
        expiresAt: null,
        assets: [
          {
            direction: 'in_scope',
            kind: 'domain',
            value: 'github.com',
            sensitivity: 'public',
            attributes: { source: 'hackerone' }
          }
        ]
      })
    ).toThrow(/Authenticate with OpenAI first/);

    service.close();
  });

  it('reports missing Responses API scope clearly during HackerOne model review', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-without-responses-write';
    const service = new WorkspaceService(() => undefined, {
      programRegistryDirectory: tempWorkspace(),
      hackerOneFetch: async () => hackerOneProgramResponse(),
      openAiFetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'You have insufficient permissions for this operation. Missing scopes: api.responses.write.',
              code: 'insufficient_permissions'
            }
          }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        )
    });

    await expect(service.lookupHackerOneProgram('github')).rejects.toThrow(/Responses API write scope.*BEALE_OPENAI_ACCESS_TOKEN.*OPENAI_API_KEY/);
    service.close();
  });

  it('generates a recommended research prompt from program scope and prior research', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-prompt-generation';
    const modelRequests: Record<string, unknown>[] = [];
    const service = new WorkspaceService(() => undefined, {
      openAiFetch: async (_url, init) => {
        const request = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        modelRequests.push(request);
        const serialized = JSON.stringify(request);
        expect(request.model).toBe('gpt-5.4');
        expect(request.tools).toEqual([]);
        expect(request.reasoning).toEqual({ effort: 'medium' });
        expect(serialized).toContain('Kernel Audit Program');
        expect(serialized).toContain('/src/kernel');
        expect(serialized).toContain('previousResearch');
        expect(serialized).toContain('likelyUnderexploredInScopeAssets');
        expect(serialized).toContain('chain existing findings');
        expect(serialized).toContain('promptQualityRules');
        expect(serialized).toContain('one-time preflight gate');
        expect(serialized).toContain('Do not repeatedly inspect HackerOne');
        expect(serialized).toContain('hasUsableCredentialAssets');
        expect(serialized).toContain('static/passive fallback');
        expect(serialized).toContain('recentEvidence');
        expect(serialized).toContain('requestedSession');
        expect(serialized).toContain('\\"reasoningEffort\\": \\"xhigh\\"');
        expect(serialized).toContain('\\"networkProfile\\": \\"scoped\\"');
        expect(serialized).toContain('\\"sandboxProfile\\": \\"host_research_only\\"');
        return new Response(
          sse(
            event('response.output_text.done', {
              type: 'response.output_text.done',
              text: JSON.stringify({
                promptMarkdown: '# Kernel parser audit\nFocus on the least explored kernel parser surface and collect verifier-backed evidence.'
              })
            }) + event('response.completed', { type: 'response.completed', response: { id: 'resp_prompt_generation' } })
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        );
      }
    });

    service.createWorkspace(tempWorkspace());
    service.saveProgramScope({
      programName: 'Kernel Audit Program',
      organizationName: 'Kernel Org',
      descriptionMarkdown: 'Authorized source and binary review for kernel-adjacent parsing components.',
      rulesMarkdown: 'Only test local fixtures and scoped repositories.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [asset('in_scope', 'repo', '/src/kernel'), asset('in_scope', 'binary', '/bin/parserd'), asset('out_of_scope', 'domain', 'prod.example.test')]
    });
    startRunForTest(service, runInput('verified_finding'));

    const result = await service.generateResearchPrompt({
      mode: 'dynamic',
      attemptStrategy: 'single_path',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      networkProfile: 'scoped',
      sandboxProfile: 'host_research_only',
      targetAssetId: null,
      targetPath: null
    });
    expect(result.promptMarkdown).toBe('# Kernel parser audit\nFocus on the least explored kernel parser surface and collect verifier-backed evidence.');
    expect(modelRequests).toHaveLength(1);
    service.close();
  });

  it('cancels an in-flight research prompt generation request', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-prompt-generation';
    let resolveFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    const service = new WorkspaceService(() => undefined, {
      openAiFetch: async (_url, init) => {
        const signal = init.signal;
        if (!signal) throw new Error('Expected prompt generation to pass an AbortSignal.');
        resolveFetchStarted?.();
        return await new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }
    });

    service.createWorkspace(tempWorkspace());
    const pending = service.generateResearchPrompt({
      requestId: 'cancel_test',
      operation: 'generate',
      mode: 'dynamic',
      attemptStrategy: 'single_path',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      networkProfile: 'scoped',
      sandboxProfile: 'host_research_only',
      targetAssetId: null,
      targetPath: null
    });
    await fetchStarted;
    service.cancelResearchPromptGeneration('cancel_test');

    await expect(pending).rejects.toThrow(/canceled/i);
    service.close();
  });

  it('surfaces OpenAI stream error reasons during research prompt generation', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-prompt-generation';
    const service = new WorkspaceService(() => undefined, {
      openAiFetch: async () =>
        new Response(
          sse(
            event('error', {
              type: 'error',
              status: 429,
              error: {
                message: 'The model is temporarily overloaded.',
                code: 'rate_limit_exceeded'
              }
            })
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
    });

    service.createWorkspace(tempWorkspace());

    await expect(
      service.generateResearchPrompt({
        requestId: 'stream_error_test',
        operation: 'generate',
        mode: 'dynamic',
        attemptStrategy: 'single_path',
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        networkProfile: 'scoped',
        sandboxProfile: 'host_research_only',
        targetAssetId: null,
        targetPath: null
      })
    ).rejects.toThrow(/temporarily overloaded/);
    service.close();
  });

  it('keeps generated research prompts up to the 25k character cap', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-prompt-generation';
    const generatedPromptPrefix = '# Long generated plan\n';
    const generatedPrompt = `${generatedPromptPrefix}${'A'.repeat(25_000 - generatedPromptPrefix.length)}`;
    const service = new WorkspaceService(() => undefined, {
      openAiFetch: async () =>
        new Response(
          sse(
            event('response.output_text.done', {
              type: 'response.output_text.done',
              text: JSON.stringify({ promptMarkdown: generatedPrompt })
            }) + event('response.completed', { type: 'response.completed', response: { id: 'resp_long_prompt_generation' } })
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
    });

    service.createWorkspace(tempWorkspace());
    const result = await service.generateResearchPrompt({
      mode: 'dynamic',
      attemptStrategy: 'single_path',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      networkProfile: 'scoped',
      sandboxProfile: 'host_research_only',
      targetAssetId: null,
      targetPath: null
    });

    expect(result.promptMarkdown).toHaveLength(25_000);
    expect(result.promptMarkdown).toBe(generatedPrompt);
    service.close();
  });

  it('streams decoded generated research prompt text before completion', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-prompt-generation';
    const chunks = ['{"promptMarkdown":"# Streamed plan\\n', 'Step one', '\\nStep two"}'];
    const service = new WorkspaceService(() => undefined, {
      openAiFetch: async () =>
        new Response(
          sse(
            chunks
              .map((chunk) =>
                event('response.output_text.delta', {
                  type: 'response.output_text.delta',
                  delta: chunk
                })
              )
              .join('') +
              event('response.output_text.done', {
                type: 'response.output_text.done',
                text: chunks.join('')
              }) +
              event('response.completed', { type: 'response.completed', response: { id: 'resp_streamed_prompt_generation' } })
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
    });
    const updates: string[] = [];

    service.createWorkspace(tempWorkspace());
    const result = await service.generateResearchPrompt(
      {
        requestId: 'stream_test',
        mode: 'dynamic',
        attemptStrategy: 'single_path',
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        networkProfile: 'scoped',
        sandboxProfile: 'host_research_only',
        targetAssetId: null,
        targetPath: null
      },
      (update) => updates.push(update.promptMarkdown)
    );

    expect(result.promptMarkdown).toBe('# Streamed plan\nStep one\nStep two');
    expect(updates).toContain('# Streamed plan\n');
    expect(updates).toContain('# Streamed plan\nStep one');
    expect(updates.at(-1)).toBe('# Streamed plan\nStep one\nStep two');
    service.close();
  });

  it('upgrades an older migration marker into the current workspace schema', () => {
    const dir = tempWorkspace();
    mkdirSync(join(dir, '.beale', 'artifacts', 'sha256'), { recursive: true });
    const raw = new DatabaseSync(join(dir, '.beale', 'beale.sqlite'));
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (1, 'old_fixture_schema', '2026-01-01T00:00:00.000Z');
    `);
    raw.close();

    const service = new WorkspaceService();
    const snapshot = service.openWorkspace(dir);
    expect(snapshot.activeScope.programName).toBe('Untitled Program');
    expect(snapshot.recovery.interruptedRuns).toBe(0);
    service.close();
  });

  it('migrates schema v3 export records to export review state', () => {
    const dir = tempWorkspace();
    const artifactRoot = join(dir, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    const raw = new DatabaseSync(join(dir, '.beale', 'beale.sqlite'));
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (3, 'initial_workbench_schema', '2026-01-01T00:00:00.000Z');

      CREATE TABLE workspace_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE program_scope_versions (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        program_name TEXT NOT NULL,
        organization_name TEXT NOT NULL,
        description_markdown TEXT NOT NULL,
        network_policy_json TEXT NOT NULL,
        rules_markdown TEXT NOT NULL,
        active_from TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      );

      CREATE TABLE scope_assets (
        id TEXT PRIMARY KEY,
        scope_version_id TEXT NOT NULL REFERENCES program_scope_versions(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK (direction IN ('in_scope', 'out_of_scope')),
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        attributes_json TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE exports (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        finding_id TEXT,
        kind TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        redaction_policy_json TEXT NOT NULL,
        included_artifacts_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    raw.close();

    const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
    db.initialize();
    db.close();

    const migrated = new DatabaseSync(join(dir, '.beale', 'beale.sqlite'));
    const columns = (migrated.prepare('PRAGMA table_info(exports)').all() as Array<{ name: string }>).map((row) => row.name);
    const migration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 4').get();
    const notificationsMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 5').get();
    const contextCompactionMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 6').get();
    const transcriptMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 7').get();
    const cweMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 9').get();
    const projectIndexMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 11').get();
    const projectStructureMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 12').get();
    const projectSemanticMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 13').get();
    const projectGraphMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 14').get();
    const projectGraphStatusMigration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 15').get();
    const notificationsTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get();
    const transcriptTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transcript_messages'").get();
    const weaknessTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'weakness_mappings'").get();
    const inventoryTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_inventory_items'").get();
    const searchDocumentsTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_search_documents'").get();
    const searchFtsTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_search_fts'").get();
    const structureTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_structure_entities'").get();
    const structureRelationsTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_structure_relations'").get();
    const semanticChunksTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_semantic_chunks'").get();
    const graphNodesTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_graph_nodes'").get();
    const graphEdgesTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_graph_edges'").get();
    const graphStatusTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_graph_status'").get();
    const cweEntry = migrated.prepare("SELECT name FROM cwe_entries WHERE cwe_id = 'CWE-862'").get();
    migrated.close();
    expect(columns).toEqual(expect.arrayContaining(['status', 'review_decision', 'review_note', 'reviewed_at']));
    expect(migration).toBeTruthy();
    expect(notificationsMigration).toBeTruthy();
    expect(contextCompactionMigration).toBeTruthy();
    expect(transcriptMigration).toBeTruthy();
    expect(cweMigration).toBeTruthy();
    expect(projectIndexMigration).toBeTruthy();
    expect(projectStructureMigration).toBeTruthy();
    expect(projectSemanticMigration).toBeTruthy();
    expect(projectGraphMigration).toBeTruthy();
    expect(projectGraphStatusMigration).toBeTruthy();
    expect(notificationsTable).toBeTruthy();
    expect(transcriptTable).toBeTruthy();
    expect(weaknessTable).toBeTruthy();
    expect(inventoryTable).toBeTruthy();
    expect(searchDocumentsTable).toBeTruthy();
    expect(searchFtsTable).toBeTruthy();
    expect(structureTable).toBeTruthy();
    expect(structureRelationsTable).toBeTruthy();
    expect(semanticChunksTable).toBeTruthy();
    expect(graphNodesTable).toBeTruthy();
    expect(graphEdgesTable).toBeTruthy();
    expect(graphStatusTable).toBeTruthy();
    expect(cweEntry).toBeTruthy();
  });

  it('recovers interrupted active state on workspace reopen', () => {
    const service = openService();
    const snapshot = service.startRun(runInput('source_logic_bug'), 'scheduled');
    const runId = snapshot.runs[0].run.id;
    const workspacePath = snapshot.workspace.workspacePath;
    service.close();

    const reopened = new WorkspaceService();
    const recovered = reopened.openWorkspace(workspacePath);
    const detail = reopened.getRunDetail(runId);

    expect(recovered.recovery.interruptedRuns).toBe(1);
    expect(recovered.runs[0].run.status).toBe('paused');
    expect(detail.attempts[0].status).toBe('paused');
    expect(detail.vmContexts[0].state).toBe('recovery_pending');
    expect(detail.traceEvents.some((event) => event.summary === 'Workspace recovery paused interrupted run after app restart.')).toBe(true);
    reopened.close();
  });

  it('persists scope edits as a new active version with typed assets', () => {
    const service = openService();

    const snapshot = service.saveProgramScope({
      programName: 'Example Bug Bounty',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Authorized open-ended vulnerability discovery on scoped assets.',
      rulesMarkdown: 'No out-of-scope network testing.',
      networkProfile: 'scoped',
      expiresAt: '2026-12-31',
      assets: [
        asset('in_scope', 'domain', 'api.example.test'),
        asset('in_scope', 'repo', 'https://github.com/example/repo'),
        asset('in_scope', 'path', '/tmp/example-target'),
        asset('out_of_scope', 'other', 'admin.example.test')
      ]
    });

    expect(snapshot.activeScope.version).toBe(2);
    expect(snapshot.activeScope.programName).toBe('Example Bug Bounty');
    expect(snapshot.activeScope.networkProfile).toBe('scoped');
    expect(snapshot.activeScope.assets).toHaveLength(4);
    expect(snapshot.activeScope.assets.map((item) => item.value)).toContain('admin.example.test');

    service.close();
    const reopened = service.openWorkspace(snapshot.workspace.workspacePath);
    expect(reopened.activeScope.version).toBe(2);
    expect(reopened.activeScope.assets).toHaveLength(4);
    service.close();
  });

  it('records a deterministic fake run graph that replays from persisted state', () => {
    const service = openService();
    service.saveProgramScope({
      programName: 'Parser Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Scoped parser research.',
      rulesMarkdown: 'Stay inside local fixtures.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [asset('in_scope', 'path', '/targets/parser')]
    });

    const snapshot = startRunForTest(service, runInput('adaptive_portfolio'));
    const runId = snapshot.runs[0].run.id;
    const detail = service.getRunDetail(runId);

    expect(detail.run.status).toBe('completed');
    expect(detail.traceEvents.map((event) => event.sequence)).toEqual(sequence(detail.traceEvents.length));
    expect(detail.traceEvents.some((event) => event.source === 'model' && event.type === 'model_message')).toBe(true);
    expect(detail.traceEvents.some((event) => event.source === 'tool' && event.type === 'tool_result')).toBe(true);
    expect(detail.traceEvents.some((event) => event.source === 'policy' && event.type === 'approval_event')).toBe(true);
    expect(detail.traceEvents.some((event) => event.type === 'verifier_result')).toBe(true);
    expect(detail.hypotheses.length).toBeGreaterThan(0);
    expect(detail.artifacts.length).toBeGreaterThan(0);
    expect(detail.verifierRuns.some((run) => run.status === 'pass')).toBe(true);
    expect(detail.findings.some((finding) => finding.state === 'verified')).toBe(false);
    expect(detail.findings.some((finding) => finding.state === 'needs_evidence')).toBe(true);
    expect(detail.attempts.length).toBeGreaterThan(1);
    expect(detail.attempts.map((attempt) => attempt.strategyRole)).toContain('parser_memory_safety');
    expect(detail.attempts.map((attempt) => attempt.strategyRole)).toContain('authorization_review');
    expect(detail.vmContexts[0].backend).toBe('fake_vm');
    expect(snapshot.runs[0].attemptCount).toBeGreaterThan(1);
    expect(snapshot.runs[0].engine).toBe('fake');

    const workspacePath = snapshot.workspace.workspacePath;
    service.close();

    const reopened = new WorkspaceService();
    reopened.openWorkspace(workspacePath);
    const replayed = reopened.getRunDetail(runId);
    expect(replayed.traceEvents.map((event) => event.sequence)).toEqual(sequence(replayed.traceEvents.length));
    expect(replayed.artifacts[0].provenanceTraceEventId).toBeTruthy();
    expect(replayed.hypotheses[0].createdTraceEventId).toBeTruthy();
    reopened.close();
  });

  it('records steering actions as trace events and state changes', () => {
    const service = openService();
    const snapshot = service.startRun(runInput('source_logic_bug'), 'scheduled');
    const runId = snapshot.runs[0].run.id;

    service.steerRun({ type: 'steer', runId, instruction: 'Focus on auth boundary checks.' });
    let detail = service.getRunDetail(runId);
    expect(service.getSnapshot()?.runs).toHaveLength(1);
    expect(detail.run.id).toBe(runId);
    expect(detail.traceEvents.at(-1)?.summary).toBe('User steering added to current run.');
    expect(detail.traceEvents.at(-1)?.payload.instruction).toBe('Focus on auth boundary checks.');

    service.steerRun({ type: 'pause', runId });
    detail = service.getRunDetail(runId);
    expect(detail.run.status).toBe('paused');
    expect(detail.traceEvents.at(-1)?.summary).toBe('Run paused by user.');

    service.steerRun({ type: 'resume', runId });
    service.steerRun({ type: 'stop', runId });
    detail = service.getRunDetail(runId);
    expect(detail.run.status).toBe('stopped');
    expect(detail.traceEvents.at(-1)?.summary).toBe('Run stopped by user.');

    service.close();
  });

  it('updates artifact and hypothesis state through steering controls', () => {
    const service = openService();
    const snapshot = startRunForTest(service, runInput('verified_finding'));
    const runId = snapshot.runs[0].run.id;
    const detail = service.getRunDetail(runId);
    const artifact = detail.artifacts[0];
    const hypothesis = detail.hypotheses[0];

    service.steerRun({ type: 'mark_artifact_sensitive', runId, artifactId: artifact.id });
    service.steerRun({ type: 'dismiss_hypothesis', runId, hypothesisId: hypothesis.id });

    const updated = service.getRunDetail(runId);
    expect(updated.artifacts.find((item) => item.id === artifact.id)?.modelVisible).toBe(false);
    expect(updated.artifacts.find((item) => item.id === artifact.id)?.sensitivity).toBe('sensitive');
    expect(updated.hypotheses.find((item) => item.id === hypothesis.id)?.state).toBe('dismissed');
    expect(updated.traceEvents.some((event) => event.summary === 'Artifact marked sensitive and hidden from model context.')).toBe(true);
    expect(updated.traceEvents.some((event) => event.summary === 'Hypothesis dismissed by user.')).toBe(true);
    service.close();
  });

  it('supports discovery steering, verifier contracts, priority scoring, finding states, and evidence export', () => {
    const service = openService();
    const snapshot = startRunForTest(service, runInput('source_logic_bug'));
    const runId = snapshot.runs[0].run.id;
    let detail = service.getRunDetail(runId);
    const hypothesis = detail.hypotheses[0];

    service.steerRun({
      type: 'adjust_priority',
      runId,
      hypothesisId: hypothesis.id,
      factors: {
        attackerReachability: 2,
        impact: 3,
        evidenceConfidence: 2,
        exploitPracticality: 2,
        scopeConfidence: 3
      }
    });
    service.steerRun({ type: 'request_reproduction', runId, hypothesisId: hypothesis.id });
    service.steerRun({ type: 'promote_hypothesis', runId, hypothesisId: hypothesis.id });

    detail = service.getRunDetail(runId);
    const promoted = detail.hypotheses.find((item) => item.id === hypothesis.id);
    const finding = detail.findings.find((item) => item.hypothesisId === hypothesis.id);
    expect(promoted?.priorityScore).toBe(20);
    expect(promoted?.state).toBe('promoted');
    expect(finding?.state).toBe('needs_evidence');
    expect(detail.verifierContracts.some((contract) => contract.mode === 'reproduction' && contract.hypothesisId === hypothesis.id)).toBe(true);

    service.steerRun({ type: 'request_patch_validation', runId, findingId: finding?.id });
    service.steerRun({ type: 'mark_finding_false_positive', runId, findingId: finding?.id ?? '' });
    service.steerRun({ type: 'mark_finding_out_of_scope', runId, findingId: finding?.id ?? '' });
    service.steerRun({ type: 'export_evidence_bundle', runId, findingId: finding?.id, note: 'api_key=supersecretvalue12345' });

    detail = service.getRunDetail(runId);
    const exported = detail.artifacts.find((artifact) => artifact.kind === 'evidence_bundle_export');
    const exportRecord = detail.exports.find((item) => item.kind === 'evidence_bundle');
    expect(detail.findings.find((item) => item.id === finding?.id)?.state).toBe('out_of_scope');
    expect(detail.verifierContracts.some((contract) => contract.mode === 'patch_validation' && contract.findingId === finding?.id)).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Finding marked false positive by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Evidence bundle export created.')).toBe(true);
    expect(exported?.modelVisible).toBe(false);
    expect(exportRecord?.status).toBe('pending_review');
    const exportedPath = join(snapshot.workspace.workspacePath, String(exported?.metadata.exportRelativePath));
    expect(existsSync(exportedPath)).toBe(true);
    expect(readFileSync(exportedPath, 'utf8')).toContain('api_key=...redacted');
    expect(readFileSync(exportedPath, 'utf8')).not.toContain('supersecretvalue12345');

    service.steerRun({ type: 'review_export', runId, exportId: exportRecord?.id ?? '', decision: 'approved', note: 'token=reviewsecret12345' });
    detail = service.getRunDetail(runId);
    const reviewed = detail.exports.find((item) => item.id === exportRecord?.id);
    expect(reviewed?.status).toBe('approved');
    expect(reviewed?.reviewDecision).toBe('approved');
    expect(reviewed?.reviewNote).toContain('token=...redacted');
    expect(reviewed?.reviewNote).not.toContain('reviewsecret12345');
    expect(detail.traceEvents.some((event) => event.summary === 'Export review recorded: approved.')).toBe(true);
    service.close();
  });

  it('supports remaining steering and disclosure export controls', () => {
    const service = openService();
    const snapshot = startRunForTest(service, runInput('source_logic_bug'));
    const runId = snapshot.runs[0].run.id;
    let detail = service.getRunDetail(runId);
    const hypothesis = detail.hypotheses[0];

    service.steerRun({ type: 'request_reproduction', runId, hypothesisId: hypothesis.id });
    service.steerRun({ type: 'promote_hypothesis', runId, hypothesisId: hypothesis.id });
    detail = service.getRunDetail(runId);
    const contract = detail.verifierContracts.find((item) => item.mode === 'reproduction' && item.hypothesisId === hypothesis.id);
    const finding = detail.findings.find((item) => item.hypothesisId === hypothesis.id);
    expect(contract).toBeTruthy();
    expect(finding).toBeTruthy();

    service.steerRun({ type: 'update_run_budget', runId, budgetPatch: { maxMinutes: 60, maxAttempts: 3, maxCostUsd: 12 }, note: 'budget updated' });
    service.steerRun({ type: 'restart_from_snapshot', runId, snapshotRef: 'clean-user-review', note: 'token=restartsecret12345' });
    service.steerRun({
      type: 'edit_verifier_contract',
      runId,
      verifierContractId: contract?.id ?? '',
      patch: {
        triggerStepsMarkdown: 'Run the edited verifier trigger inside the disposable VM.',
        expectedObservations: { stdout: 'edited verifier output' }
      }
    });
    service.steerRun({ type: 'review_verifier_contract', runId, verifierContractId: contract?.id ?? '', decision: 'approved', note: 'secret=approvesecret12345' });
    service.steerRun({ type: 'mark_disclosure_ready', runId, findingId: finding?.id ?? '', note: 'ready for report draft' });
    service.steerRun({ type: 'mark_needs_more_evidence', runId, findingId: finding?.id ?? '', note: 'api_key=evidencesecret12345' });
    service.steerRun({ type: 'export_finding_bundle', runId, findingId: finding?.id, note: 'token=findingsecret12345' });
    service.steerRun({ type: 'export_redacted_trace', runId, findingId: finding?.id, note: 'api_key=tracesecret12345' });
    service.steerRun({ type: 'generate_report_draft', runId, findingId: finding?.id, note: 'password=reportsecret12345' });
    service.steerRun({ type: 'preserve_vm', runId, reason: 'Preserve VM for review.' });
    service.steerRun({ type: 'destroy_vm', runId, reason: 'Destroy VM after review.' });

    detail = service.getRunDetail(runId);
    const updatedContract = detail.verifierContracts.find((item) => item.id === contract?.id);
    const updatedFinding = detail.findings.find((item) => item.id === finding?.id);
    const exportKinds = detail.exports.map((item) => item.kind);
    expect(detail.run.budget.maxMinutes).toBe(60);
    expect(detail.run.budget.maxAttempts).toBe(3);
    expect(detail.run.budget.maxCostUsd).toBe(12);
    expect(detail.vmContexts[0].snapshotId).toBe('clean-user-review');
    expect(detail.vmContexts[0].state).toBe('destroyed');
    expect(updatedContract?.status).toBe('approved');
    expect(updatedContract?.triggerStepsMarkdown).toContain('edited verifier trigger');
    expect(updatedFinding?.state).toBe('needs_evidence');
    expect(exportKinds).toEqual(expect.arrayContaining(['finding_bundle', 'redacted_trace', 'report_draft']));
    expect(detail.traceEvents.some((event) => event.summary === 'Run budget updated by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Run restarted from VM snapshot by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Verifier contract approved by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Finding marked disclosure ready by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Finding marked as needing more evidence by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Finding bundle export created.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Redacted trace export created.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Report draft export created.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'VM context preserved by explicit request.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'VM context destroyed.')).toBe(true);

    for (const exportRecord of detail.exports.filter((item) => ['finding_bundle', 'redacted_trace', 'report_draft'].includes(item.kind))) {
      const exportPath = join(snapshot.workspace.workspacePath, exportRecord.relativePath);
      const content = readFileSync(exportPath, 'utf8');
      expect(existsSync(exportPath)).toBe(true);
      expect(content).toContain('...redacted');
      expect(content).not.toContain('findingsecret12345');
      expect(content).not.toContain('tracesecret12345');
      expect(content).not.toContain('reportsecret12345');
      expect(content).not.toContain('evidencesecret12345');
      expect(content).not.toContain('restartsecret12345');
    }
    service.close();
  });

  it('records scoped policy approval decisions with redacted request data', () => {
    const service = openService();
    const snapshot = startRunForTest(service, runInput('source_logic_bug'));
    const runId = snapshot.runs[0].run.id;

    service.steerRun({
      type: 'review_policy_request',
      runId,
      requestKind: 'network_profile_change',
      decision: 'approved',
      requestedAction: {
        networkProfile: 'elevated',
        destinationPattern: 'api.example.test',
        api_key: 'policysecret12345'
      },
      note: 'token=policytokensecret12345'
    });

    const detail = service.getRunDetail(runId);
    const approval = detail.policyEvents.find((event) => event.requestKind === 'network_profile_change');
    expect(approval?.decision).toBe('approved');
    expect(approval?.reason).toContain('token=...redacted');
    expect(approval?.requestedAction.api_key).toBe('...redacted');
    expect(detail.traceEvents.some((event) => event.summary === 'Policy request approved: network_profile_change.')).toBe(true);
    service.close();
  });

  it('records verifier rerun failures without corrupting run state', () => {
    const dir = tempWorkspace();
    const artifactRoot = join(dir, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
    db.initialize();
    const context = db.createRun({
      scopeVersionId: db.getActiveScope().id,
      title: 'Verifier failure run',
      promptMarkdown: '# Verifier failure run',
      mode: 'open_discovery',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      attemptStrategy: 'single_path',
      networkProfile: 'offline',
      sandboxProfile: 'local_disposable_vm',
      budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'fake' }
    });
    const contract = db.createVerifierContract({
      runId: context.run.id,
      mode: 'reproduction',
      status: 'draft_requested',
      setupStepsMarkdown: '',
      triggerStepsMarkdown: '',
      expectedObservations: {},
      invariants: { hostDatabaseMounted: false },
      artifactsToCollect: {},
      passCriteria: {}
    });
    db.updateAttemptState(context.attempt.id, 'completed', 'Prepared incomplete verifier contract.');
    db.updateRunStatus(context.run.id, 'completed', 'Prepared incomplete verifier contract.');
    db.close();

    const service = new WorkspaceService();
    service.openWorkspace(dir);
    service.steerRun({ type: 'rerun_verifier', runId: context.run.id, verifierContractId: contract.id, note: 'rerun incomplete verifier' });
    const detail = service.getRunDetail(context.run.id);
    expect(detail.run.status).toBe('completed');
    expect(detail.verifierRuns.at(-1)?.status).toBe('error');
    expect(detail.traceEvents.some((event) => event.summary === 'Verifier rerun failed before execution.')).toBe(true);
    service.close();
  });

  it('executes verifier contracts in the VM before allowing verified findings', () => {
    const dir = tempWorkspace();
    const artifactRoot = join(dir, '.beale', 'artifacts');
    const targetDir = join(dir, 'target');
    const logPath = join(dir, 'vmctl.log');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'target.txt'), 'verifier target\n');
    const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
    db.initialize();
    db.saveProgramScope({
      programName: 'Verifier Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Scoped verifier target.',
      rulesMarkdown: 'Offline VM verifier only.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [asset('in_scope', 'path', targetDir)]
    });
    const context = db.createRun({
      scopeVersionId: db.getActiveScope().id,
      title: 'Verifier execution run',
      promptMarkdown: '# Verifier execution run',
      mode: 'open_discovery',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      attemptStrategy: 'single_path',
      networkProfile: 'offline',
      sandboxProfile: 'local_disposable_vm',
      budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'fake' }
    });
    const hypothesis = db.createHypothesis({
      runId: context.run.id,
      state: 'candidate',
      title: 'Verifier-backed issue',
      descriptionMarkdown: 'A real verifier should decide this hypothesis.',
      component: 'verifier fixture',
      bugClass: 'authorization',
      priorityScore: 0.5,
      attackerReachability: 'local',
      impact: 'medium',
      evidenceConfidence: 'tool-backed',
      exploitPracticality: 'reproducible',
      scopeConfidence: 'in_scope'
    });
    const simulatedRun = db.createVerifierRun({
      contractId: db
        .createVerifierContract({
          runId: context.run.id,
          hypothesisId: hypothesis.id,
          mode: 'reproduction',
          status: 'approved',
          setupStepsMarkdown: 'Simulated setup.',
          triggerStepsMarkdown: 'Simulated trigger.',
          expectedObservations: { simulated: true },
          invariants: { noHostExecution: true },
          artifactsToCollect: { trace: true },
          passCriteria: { simulated: true }
        })
        .id,
      runId: context.run.id,
      attemptId: context.attempt.id,
      vmContextId: context.vmContext.id,
      status: 'pass',
      blockedIssue: 'yes',
      behaviorPreserved: 'not_applicable',
      diagnosticsClean: 'yes',
      regressionTests: 'not_run',
      result: { simulated: true }
    });
    expect(() =>
      db.createFinding({
        runId: context.run.id,
        hypothesisId: hypothesis.id,
        state: 'verified',
        title: 'Blocked simulated finding',
        summaryMarkdown: 'This should not become authoritative.',
        impactMarkdown: 'Simulated only.',
        priorityScore: 0.5,
        verifiedByVerifierRunId: simulatedRun.id
      })
    ).toThrow(/passing real verifier/);

    const contract = db.createVerifierContract({
      runId: context.run.id,
      hypothesisId: hypothesis.id,
      mode: 'reproduction',
      status: 'approved',
      setupStepsMarkdown: 'Import scoped target into the disposable VM.',
      triggerStepsMarkdown: 'Run the verifier script inside the disposable VM.',
      expectedObservations: { stdout: 'fixture guest stdout' },
      invariants: { hostDatabaseMounted: false, openAiCredentialsMounted: false },
      artifactsToCollect: { verifierOutput: '/tmp/beale-output.txt' },
      passCriteria: {
        verifier: {
          operationKind: 'shell',
          script: 'echo verifier-ok',
          expectedExitCode: 0,
          expectedStdoutIncludes: 'fixture guest stdout',
          artifactPath: '/tmp/beale-output.txt',
          timeoutMs: 30_000
        }
      }
    });
    db.updateAttemptState(context.attempt.id, 'completed', 'Prepared executable verifier contract.');
    db.updateRunStatus(context.run.id, 'completed', 'Prepared executable verifier contract.');
    db.close();

    configureVmctlFixture(logPath);
    const service = new WorkspaceService();
    service.openWorkspace(dir);
    service.steerRun({ type: 'rerun_verifier', runId: context.run.id, verifierContractId: contract.id, note: 'run real verifier' });
    let detail = service.getRunDetail(context.run.id);
    const realVerifierRun = detail.verifierRuns.at(-1);
    expect(realVerifierRun?.status).toBe('pass');
    expect(realVerifierRun?.result.realExecution).toBe(true);
    expect(realVerifierRun?.result.vmExecution).toBe(true);
    expect(detail.artifacts.some((artifact) => artifact.kind === 'verifier_output')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Verifier contract executed in disposable VM with pass.')).toBe(true);

    service.steerRun({ type: 'promote_hypothesis', runId: context.run.id, hypothesisId: hypothesis.id });
    detail = service.getRunDetail(context.run.id);
    const finding = detail.findings.at(-1);
    expect(finding?.state).toBe('verified');
    expect(finding?.verifiedByVerifierRunId).toBe(realVerifierRun?.id);
    expect(readVmctlActions(logPath)).toEqual(expect.arrayContaining(['create_context', 'clone_context', 'import_workspace_material', 'execute', 'export_artifact', 'destroy']));
    service.close();
  });

  it('keeps authoritative state clean when evidence export fails before publish', () => {
    const service = openService();
    const snapshot = startRunForTest(service, runInput('source_logic_bug'));
    const runId = snapshot.runs[0].run.id;
    let detail = service.getRunDetail(runId);
    const hypothesis = detail.hypotheses[0];
    service.steerRun({ type: 'promote_hypothesis', runId, hypothesisId: hypothesis.id });
    detail = service.getRunDetail(runId);
    const finding = detail.findings[0];

    process.env.BEALE_TEST_FAIL_ATOMIC_EXPORT = 'before_rename';
    expect(() => service.steerRun({ type: 'export_evidence_bundle', runId, findingId: finding.id })).toThrow(/Injected atomic export failure/);

    detail = service.getRunDetail(runId);
    expect(detail.exports).toHaveLength(0);
    expect(detail.artifacts.some((artifact) => artifact.kind === 'evidence_bundle_export')).toBe(false);
    expect(detail.traceEvents.some((event) => event.summary === 'Evidence bundle export created.')).toBe(false);
    service.close();
  });

  it('exports a checkpointed workspace backup archive with a review manifest', () => {
    const service = openService();
    service.saveProgramScope({
      programName: 'Backup Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Scoped backup test.',
      rulesMarkdown: 'Offline only.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [asset('in_scope', 'path', '/tmp/backup-target')]
    });

    const snapshot = service.exportWorkspaceBackup('secret=workspacebackupsecret12345');
    const backup = snapshot.workspace.lastWorkspaceBackup;
    expect(backup).toBeTruthy();
    expect(backup?.includesSensitiveData).toBe(true);
    expect(backup?.userReviewRequired).toBe(true);
    expect(String(backup?.manifest.note)).toContain('secret=...redacted');
    expect(String(backup?.manifest.note)).not.toContain('workspacebackupsecret12345');
    expect(existsSync(String(backup?.absolutePath))).toBe(true);

    const listing = execFileSync('tar', ['-tzf', String(backup?.absolutePath)], { encoding: 'utf8' });
    expect(listing).toContain('./manifest.json');
    expect(listing).toContain('./workspace/.beale/beale.sqlite');
    service.close();
  });
});

function openService(): WorkspaceService {
  const service = new WorkspaceService();
  service.createWorkspace(tempWorkspace());
  return service;
}

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-test-'));
  createdDirs.push(dir);
  return dir;
}

function hackerOneProgramResponse(): Response {
  return new Response(
    JSON.stringify({
      data: {
        team: {
          handle: 'github',
          name: 'GitHub',
          url: 'https://hackerone.com/github',
          policy: '# GitHub policy\nStay in scope.',
          submission_state: 'open',
          structured_scopes: {
            total_count: 1,
            nodes: [
              {
                asset_type: 'URL',
                asset_identifier: 'github.com',
                instruction: 'Main application.',
                eligible_for_bounty: true,
                eligible_for_submission: true,
                max_severity: 'critical',
                url: 'https://hackerone.com/github/asset/1'
              }
            ]
          }
        }
      }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function asset(direction: 'in_scope' | 'out_of_scope', kind: ScopeAssetKind, value: string) {
  return {
    direction,
    kind,
    value,
    sensitivity: 'internal',
    attributes: {}
  };
}

function event(name: string, data: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sse(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

function runInput(fakeScenario: StartRunInput['fakeScenario']): StartRunInput {
  return {
    runEngine: 'fake',
    promptMarkdown: '# Test run\nExercise the fake workbench path.',
    mode: 'open_discovery',
    attemptStrategy: 'adaptive_portfolio',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    networkProfile: 'offline',
    sandboxProfile: 'local_disposable_vm',
    budget: {
      maxMinutes: 30,
      maxAttempts: 2,
      maxCostUsd: 0
    },
    fakeScenario
  };
}

function configureVmctlFixture(logPath: string): void {
  process.env.BEALE_VMCTL_COMMAND = process.execPath;
  process.env.BEALE_VMCTL_ARGS_JSON = JSON.stringify([join(process.cwd(), 'tests/fixtures/vmctl-fixture.mjs'), logPath]);
}

function readVmctlActions(logPath: string): string[] {
  const content = readFileSync(logPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => (JSON.parse(line) as { input: { action: string } }).input.action);
}

function sequence(length: number): number[] {
  return Array.from({ length }, (_value, index) => index + 1);
}
