import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { importHoneycrispSessionCapture } from '../src/main/honeycrispCliClient';
import {
  createHoneycrispSessionBoundary,
  flushHoneycrispSessionWrites,
  getHoneycrispRunDetailForClient,
  getHoneycrispRunDetailUpdateForClient
} from '../src/main/honeycrispSessionBoundary';
import { WorkspaceService } from '../src/main/workspaceService';
import { resolvedTestResearchProfile } from './researchProfileFixture';

const createdDirectories: string[] = [];
const previousEnvironment = new Map<string, string | undefined>();

afterEach(() => {
  for (const [name, value] of previousEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  previousEnvironment.clear();
  for (const directory of createdDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Honeycrisp session persistence boundary', () => {
  it('uses Honeycrisp as the only writer and batches live trace mirrors off the caller path', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-session-boundary-'));
    createdDirectories.push(directory);
    const databasePath = join(directory, 'memory.sqlite');
    const artifactRoot = join(directory, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    configureRealHoneycrisp();

    const rawDatabase = new WorkspaceDatabase(databasePath, artifactRoot, {
      workspacePath: directory,
      workspaceId: 'workspace_boundary'
    });
    rawDatabase.initialize();
    const database = createHoneycrispSessionBoundary(rawDatabase);
    const context = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Canonical Honeycrisp session',
      promptMarkdown: 'Inspect the parser.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      budget: { runEngine: 'honeycrisp' }
    });

    expect(rawDatabase.getRun(context.run.id)).toBeNull();
    expect(database.getRun(context.run.id)).toMatchObject({ id: context.run.id, status: 'active' });

    for (const summary of ['First live trace', 'Second live trace', 'Third live trace']) {
      database.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'research_event',
        source: 'executor',
        summary,
        payload: {}
      });
    }
    await flushHoneycrispSessionWrites(database, context.run.id);

    const capturePath = join(directory, 'capture.json');
    writeFileSync(capturePath, JSON.stringify({
      schemaVersion: 5,
      capturedAt: '2026-08-15T13:00:00.000Z',
      request: { prompt: 'Inspect the parser.' },
      agent: {
        id: 'agent_boundary',
        status: 'complete',
        executorName: 'fixture',
        startedAt: '2026-08-15T12:59:00.000Z',
        completedAt: '2026-08-15T13:00:00.000Z',
        outputText: 'The parser is safe.',
        finalDisposition: {
          outcome: 'objective_achieved',
          summary: 'Inspection complete.',
          externalStateRequired: false,
          blockerDependencies: []
        }
      },
      eventTimeline: []
    }));
    importHoneycrispSessionCapture(context.run.id, context.attempt.id, capturePath, {
      databasePath,
      artifactDirectoryPath: join(dirname(databasePath), 'artifacts')
    });

    expect(database.getRunDetail(context.run.id)).toMatchObject({
      run: { status: 'completed', summary: 'Honeycrisp completed the research session.' },
      transcriptMessages: [{ role: 'assistant', contentMarkdown: 'The parser is safe.' }]
    });

    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(inspection.prepare('SELECT COUNT(*) AS count FROM honeycrisp_sessions').get()).toMatchObject({ count: 1 });
      expect(inspection.prepare('SELECT COUNT(*) AS count FROM runs').get()).toMatchObject({ count: 0 });
      const row = inspection.prepare('SELECT document_json FROM honeycrisp_sessions WHERE id = ?').get(context.run.id) as {
        document_json: string;
      };
      const stored = JSON.parse(row.document_json) as { events: Array<{ kind: string; payload?: { records?: unknown[] } }> };
      const traceBatches = stored.events.filter((event) => event.kind === 'beale.trace_batch');
      expect(traceBatches).toHaveLength(1);
      expect(traceBatches[0]?.payload?.records).toHaveLength(3);
    } finally {
      inspection.close();
      database.close();
    }
  }, 15_000);

  it('does not replay a prior attempt final response while a continuation is active', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-active-continuation-'));
    createdDirectories.push(directory);
    const databasePath = join(directory, 'memory.sqlite');
    const artifactRoot = join(directory, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    configureRealHoneycrisp();

    const rawDatabase = new WorkspaceDatabase(databasePath, artifactRoot, {
      workspacePath: directory,
      workspaceId: 'workspace_active_continuation'
    });
    rawDatabase.initialize();
    const database = createHoneycrispSessionBoundary(rawDatabase);
    const context = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Interrupted Honeycrisp session',
      promptMarkdown: 'Inspect the parser.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      budget: { runEngine: 'honeycrisp' }
    });

    try {
      const capturePath = join(directory, 'aborted-capture.json');
      writeFileSync(capturePath, JSON.stringify({
        schemaVersion: 5,
        capturedAt: '2026-08-16T21:00:00.000Z',
        request: { prompt: 'Inspect the parser.' },
        agent: {
          id: 'agent_aborted',
          status: 'error',
          executorName: 'fixture',
          startedAt: '2026-08-16T20:59:00.000Z',
          completedAt: '2026-08-16T21:00:00.000Z',
          outputText: 'Request was aborted'
        },
        eventTimeline: []
      }));
      importHoneycrispSessionCapture(context.run.id, context.attempt.id, capturePath, {
        databasePath,
        artifactDirectoryPath: join(dirname(databasePath), 'artifacts')
      });
      const failedDetail = database.getRunDetail(context.run.id);
      expect(failedDetail.run.status).toBe('failed');
      expect(failedDetail.transcriptMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: 'final_answer', contentMarkdown: 'Request was aborted' })
      ]));

      database.createAttempt({
        runId: context.run.id,
        parentAttemptId: context.attempt.id,
        status: 'active',
        shortState: 'Continue after interruption.',
        strategyRole: 'session_continuation'
      });
      const activeDetail = database.getRunDetail(context.run.id);
      expect(activeDetail.run.status).toBe('active');
      expect(activeDetail.transcriptMessages.some((message) =>
        message.phase === 'final_answer' && message.contentMarkdown === 'Request was aborted'
      )).toBe(false);

      const latestTrace = activeDetail.traceEvents.at(-1);
      const update = await getHoneycrispRunDetailUpdateForClient(database, context.run.id, {
        afterTraceSequence: latestTrace?.sequence ?? -1,
        afterTranscriptCount: activeDetail.transcriptMessages.length,
        afterTraceEventId: typeof latestTrace?.payload.honeycrispSessionEventId === 'string'
          ? latestTrace.payload.honeycrispSessionEventId
          : latestTrace?.id ?? null
      });
      expect(update?.run.status).toBe('active');
      expect(update?.transcriptMessages).toEqual([]);
    } finally {
      database.close();
    }
  }, 15_000);

  it('keeps the completed root response when a subagent already has a final transcript', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-root-final-'));
    createdDirectories.push(directory);
    const databasePath = join(directory, 'memory.sqlite');
    const artifactRoot = join(directory, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    configureRealHoneycrisp();

    const rawDatabase = new WorkspaceDatabase(databasePath, artifactRoot, {
      workspacePath: directory,
      workspaceId: 'workspace_root_final'
    });
    rawDatabase.initialize();
    const database = createHoneycrispSessionBoundary(rawDatabase);
    const context = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Root and subagent responses',
      promptMarkdown: 'Inspect the parser with a reviewer.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      budget: { runEngine: 'honeycrisp' }
    });

    try {
      database.createTranscriptMessage({
        runId: context.run.id,
        attemptId: context.attempt.id,
        role: 'assistant',
        phase: 'final_answer',
        contentMarkdown: 'The reviewer found one issue.',
        source: 'honeycrisp',
        metadata: { agentPath: '/root/reviewer' }
      });

      const capturePath = join(directory, 'complete-capture.json');
      writeFileSync(capturePath, JSON.stringify({
        schemaVersion: 5,
        capturedAt: '2026-08-16T22:24:40.699Z',
        request: { prompt: 'Inspect the parser with a reviewer.' },
        agent: {
          id: 'agent_root',
          status: 'complete',
          executorName: 'fixture',
          startedAt: '2026-08-16T22:20:00.000Z',
          completedAt: '2026-08-16T22:24:40.699Z',
          outputText: 'The root agent completed the inspection.'
        },
        eventTimeline: []
      }));
      importHoneycrispSessionCapture(context.run.id, context.attempt.id, capturePath, {
        databasePath,
        artifactDirectoryPath: join(dirname(databasePath), 'artifacts')
      });

      const finals = database.getRunDetail(context.run.id).transcriptMessages.filter((message) =>
        message.role === 'assistant' && message.phase === 'final_answer'
      );
      expect(finals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          contentMarkdown: 'The reviewer found one issue.',
          metadata: expect.objectContaining({ agentPath: '/root/reviewer' })
        }),
        expect.objectContaining({
          contentMarkdown: 'The root agent completed the inspection.',
          metadata: expect.objectContaining({ agentPath: '/root' })
        })
      ]));
    } finally {
      database.close();
    }
  }, 15_000);

  it('persists approval revisions as distinct events and reconciles legacy pending records from resolution traces', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-approval-boundary-'));
    createdDirectories.push(directory);
    const databasePath = join(directory, 'memory.sqlite');
    const artifactRoot = join(directory, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    configureRealHoneycrisp();

    const rawDatabase = new WorkspaceDatabase(databasePath, artifactRoot, {
      workspacePath: directory,
      workspaceId: 'workspace_approval_boundary'
    });
    rawDatabase.initialize();
    const database = createHoneycrispSessionBoundary(rawDatabase);
    const context = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Canonical approval session',
      promptMarkdown: 'Exercise approval persistence.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      budget: { runEngine: 'honeycrisp' }
    });

    try {
      const revised = database.createApproval({
        runId: context.run.id,
        attemptId: context.attempt.id,
        requestKind: 'shell_command',
        requestedAction: { approvalRequestId: 'shell_revision', approvalKind: 'auto_review_override' },
        decision: 'denied',
        reason: 'Waiting for the researcher.',
        pending: true
      });
      database.updateApprovalDecision(revised.id, context.run.id, 'approved', 'Approved once.');

      const reconciled = database.createApproval({
        runId: context.run.id,
        attemptId: context.attempt.id,
        requestKind: 'shell_command',
        requestedAction: { approvalRequestId: 'shell_reconciled', approvalKind: 'auto_review_override' },
        decision: 'denied',
        reason: 'Waiting for the researcher.',
        pending: true
      });
      database.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'approval_event',
        source: 'policy',
        summary: 'Shell command approved by the researcher.',
        payload: {
          approvalRequestId: 'shell_reconciled',
          decision: 'approved',
          reason: 'The researcher approved this command once.'
        },
        approvalId: reconciled.id,
        modelVisible: false
      });
      await flushHoneycrispSessionWrites(database, context.run.id);

      expect(database.getRunDetail(context.run.id).policyEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: revised.id, decision: 'approved', reason: 'Approved once.' }),
        expect.objectContaining({
          id: reconciled.id,
          decision: 'approved',
          reason: 'The researcher approved this command once.',
          decidedAt: expect.any(String)
        })
      ]));
      expect(database.listPendingShellApprovals()).toEqual([]);

      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const row = inspection.prepare('SELECT document_json FROM honeycrisp_sessions WHERE id = ?').get(context.run.id) as {
          document_json: string;
        };
        const stored = JSON.parse(row.document_json) as {
          events: Array<{ id: string; kind: string; payload?: { record?: { id?: string } } }>;
        };
        const revisions = stored.events.filter((event) =>
          event.kind === 'beale.approval' && event.payload?.record?.id === revised.id
        );
        expect(revisions).toHaveLength(2);
        expect(new Set(revisions.map((event) => event.id)).size).toBe(2);
      } finally {
        inspection.close();
      }
    } finally {
      database.close();
    }
  }, 15_000);

  it('runs the Honeycrisp host adapter against the canonical store without creating a Beale run row', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-canonical-run-'));
    const registry = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-canonical-registry-'));
    createdDirectories.push(workspace, registry);
    configureRealHoneycrisp();
    setEnvironment('BEALE_HONEYCRISP_MOCK', '1');

    const broadcastStatuses: string[] = [];
    let service!: WorkspaceService;
    service = new WorkspaceService(() => {
      const currentRun = service.getSnapshot()?.runs.find(
        ({ run }) => run.promptMarkdown === 'Inspect the canonical session boundary.'
      );
      if (currentRun) broadcastStatuses.push(currentRun.run.status);
    }, {
      workspaceRegistryDirectory: registry,
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    try {
      service.createWorkspace(workspace);
      const databasePath = join(registry, 'honeycrisp', 'profiles', 'security-research', 'memory.sqlite');
      const runtime = (service as unknown as {
        getForegroundRuntime(): { honeycrispEngine: { hasActiveRuns(): boolean } } | null;
      }).getForegroundRuntime();
      expect(runtime).not.toBeNull();
      runtime!.honeycrispEngine.hasActiveRuns = () => true;
      const started = service.startRun({
        runEngine: 'honeycrisp',
        provider: 'openai-codex',
        shellSafetyMode: 'auto_review',
        goalEnabled: false,
        goalObjective: null,
        promptMarkdown: 'Inspect the canonical session boundary.',
        mode: 'open_discovery',
        attemptStrategy: 'iterative_research',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        sandboxProfile: 'host',
        budget: { maxMinutes: 30, maxAttempts: 1, maxCostUsd: 0 },
      });
      const runId = started.runs.find(
        ({ run }) => run.promptMarkdown === 'Inspect the canonical session boundary.'
      )?.run.id;
      if (!runId) throw new Error('Expected the canonical Honeycrisp session to start.');
      await waitFor(() => service.getRunDetail(runId).run.status !== 'active');
      try {
        await waitFor(() => broadcastStatuses.includes('completed'));
      } catch {
        const detail = service.getRunDetail(runId);
        throw new Error(
          `Terminal session broadcast was not observed: ${JSON.stringify(broadcastStatuses)}; ${detail.run.status}: ${detail.run.summary}`
        );
      }
      expect(service.getRunDetail(runId)).toMatchObject({
        run: { status: 'completed' },
        transcriptMessages: [{ role: 'assistant' }]
      });
      const completeDetail = service.getRunDetail(runId);
      const incremental = await service.getRunDetailUpdateForClient(runId, {
        afterTraceSequence: completeDetail.traceEvents.at(-2)?.sequence ?? -1,
        afterTranscriptCount: Math.max(0, completeDetail.transcriptMessages.length - 1)
      });
      expect(incremental.traceEvents).toEqual(
        completeDetail.traceEvents.filter((event) => event.sequence > (completeDetail.traceEvents.at(-2)?.sequence ?? -1))
      );
      expect(incremental.transcriptMessages).toEqual(completeDetail.transcriptMessages.slice(-1));
      await expect(service.getRunDetailForClient(runId)).resolves.toMatchObject({
        run: { status: 'completed' },
        transcriptMessages: [{ role: 'assistant' }]
      });

      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      try {
        expect(inspection.prepare('SELECT COUNT(*) AS count FROM honeycrisp_sessions WHERE id = ?').get(runId)).toMatchObject({ count: 1 });
        expect(inspection.prepare('SELECT COUNT(*) AS count FROM runs WHERE id = ?').get(runId)).toMatchObject({ count: 0 });
      } finally {
        inspection.close();
      }
    } finally {
      service.close();
    }
  }, 15_000);

  it('stops a newly started canonical session without querying full session aggregates from live events', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-canonical-stop-'));
    const registry = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-canonical-stop-registry-'));
    createdDirectories.push(workspace, registry);
    configureRealHoneycrisp();
    setEnvironment('BEALE_HONEYCRISP_MOCK', '1');

    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: registry,
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    try {
      service.createWorkspace(workspace);
      const started = service.startRun({
        runEngine: 'honeycrisp',
        provider: 'openai-codex',
        shellSafetyMode: 'auto_review',
        goalEnabled: false,
        goalObjective: null,
        promptMarkdown: 'Stop this session immediately.',
        mode: 'open_discovery',
        attemptStrategy: 'iterative_research',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        sandboxProfile: 'host',
        budget: { maxMinutes: 30, maxAttempts: 1, maxCostUsd: 0 }
      });
      const runId = started.runs[0]?.run.id;
      expect(runId).toBeTruthy();

      expect(() => service.steerRun({ type: 'stop', runId: runId!, note: '' })).not.toThrow();
      await waitFor(() => service.getRunDetail(runId!).run.status === 'stopped');
      expect(service.getRunDetail(runId!)).toMatchObject({
        run: { status: 'stopped' },
        attempts: [expect.objectContaining({ status: 'stopped' })]
      });
    } finally {
      service.close();
    }
  }, 15_000);

  it('loads a Honeycrisp session asynchronously while its runtime database writer is active', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-session-read-lock-'));
    createdDirectories.push(directory);
    const databasePath = join(directory, 'memory.sqlite');
    const artifactRoot = join(directory, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    configureRealHoneycrisp();

    const rawDatabase = new WorkspaceDatabase(databasePath, artifactRoot, {
      workspacePath: directory,
      workspaceId: 'workspace_read_lock'
    });
    rawDatabase.initialize();
    const database = createHoneycrispSessionBoundary(rawDatabase);
    const context = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Concurrent session read',
      promptMarkdown: 'Keep the interface responsive.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      budget: { runEngine: 'honeycrisp' }
    });

    const writer = new DatabaseSync(databasePath);
    writer.exec('PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;');
    writer.prepare('UPDATE honeycrisp_sessions SET summary = summary WHERE id = ?').run(context.run.id);
    let mainLoopAdvanced = false;
    const detailPromise = getHoneycrispRunDetailForClient(database, context.run.id);
    setImmediate(() => { mainLoopAdvanced = true; });
    try {
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
      expect(mainLoopAdvanced).toBe(true);
      await expect(detailPromise).resolves.toMatchObject({ run: { id: context.run.id } });
    } finally {
      writer.exec('ROLLBACK;');
      writer.close();
      database.close();
    }
  });

  it('recovers a Honeycrisp-owned active session as interrupted on app restart', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-restart-workspace-'));
    const registry = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-restart-registry-'));
    createdDirectories.push(workspace, registry);
    configureRealHoneycrisp();

    const initial = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: registry,
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    const created = initial.createWorkspace(workspace);
    initial.close();

    const databasePath = join(registry, 'honeycrisp', 'profiles', 'security-research', 'memory.sqlite');
    const rawDatabase = new WorkspaceDatabase(databasePath, join(workspace, '.beale', 'artifacts'), {
      workspacePath: workspace,
      workspaceId: created.workspace.workspaceId
    });
    rawDatabase.initialize();
    const database = createHoneycrispSessionBoundary(rawDatabase);
    const interrupted = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Interrupted canonical session',
      promptMarkdown: 'Exercise restart recovery.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      budget: { runEngine: 'honeycrisp' }
    });
    database.close();

    const reopened = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: registry,
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    const recovered = reopened.openWorkspace(workspace);
    const row = recovered.runs.find(({ run }) => run.id === interrupted.run.id);
    const detail = reopened.getRunDetail(interrupted.run.id);

    expect(recovered.recovery).toMatchObject({ interruptedRuns: 1, interruptedAttempts: 1 });
    expect(row).toMatchObject({
      run: { status: 'paused' },
      sessionRuns: [{ status: 'paused', terminationCause: 'workspace_recovery' }]
    });
    expect(detail.attempts).toContainEqual(expect.objectContaining({
      id: interrupted.attempt.id,
      status: 'paused'
    }));
    expect(detail.traceEvents).toContainEqual(expect.objectContaining({
      attemptId: interrupted.attempt.id,
      summary: 'Workspace recovery paused an interrupted Honeycrisp session.',
      payload: expect.objectContaining({ interruptedByRecovery: true })
    }));
    expect(detail.transcriptMessages).toContainEqual(expect.objectContaining({
      attemptId: interrupted.attempt.id,
      role: 'assistant',
      phase: 'final_answer',
      contentMarkdown: 'Unexpected error',
      metadata: expect.objectContaining({
        agentStatus: 'interrupted',
        interruptedByRecovery: true
      })
    }));
    reopened.close();

    const reopenedAgain = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: registry,
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    const unchanged = reopenedAgain.openWorkspace(workspace);
    expect(unchanged.recovery.interruptedRuns).toBe(0);
    expect(unchanged.runs.find(({ run }) => run.id === interrupted.run.id)?.run.status).toBe('paused');
    reopenedAgain.close();
  }, 20_000);

  it('reconciles stale active sidebar sessions on startup without opening their workspace', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-registry-recovery-workspace-'));
    const registry = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-registry-recovery-registry-'));
    createdDirectories.push(workspace, registry);
    configureRealHoneycrisp();

    const initial = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: registry,
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    initial.createWorkspace(workspace);
    const database = (initial as unknown as { db: WorkspaceDatabase }).db;
    const interrupted = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Cached active session',
      promptMarkdown: 'Recover this session before rendering the startup sidebar.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      budget: { runEngine: 'honeycrisp' }
    });
    expect(initial.getWorkspaceRegistryState().researchSessions).toContainEqual(
      expect.objectContaining({ runId: interrupted.run.id, status: 'active' })
    );
    initial.close();

    const restarted = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: registry,
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    const startupRegistry = await restarted.getWorkspaceRegistryStateForClient();
    expect(restarted.getSnapshot()).toBeNull();
    expect(startupRegistry.researchSessions).toContainEqual(
      expect.objectContaining({ runId: interrupted.run.id, status: 'paused' })
    );

    const opened = restarted.openWorkspace(workspace);
    expect(opened.runs.find(({ run }) => run.id === interrupted.run.id)?.run.status).toBe('paused');
    restarted.close();
  }, 20_000);
});

function configureRealHoneycrisp(): void {
  const honeycrispRoot = resolve(process.cwd(), '..', 'honeycrisp');
  setEnvironment('BEALE_HONEYCRISP_SESSION_OWNERSHIP', 'honeycrisp');
  setEnvironment('BEALE_HONEYCRISP_COMMAND', process.execPath);
  setEnvironment('BEALE_HONEYCRISP_ARGS_JSON', JSON.stringify([join(honeycrispRoot, 'packages', 'cli', 'dist', 'cli.js')]));
  setEnvironment('BEALE_HONEYCRISP_CWD', honeycrispRoot);
}

function setEnvironment(name: string, value: string): void {
  if (!previousEnvironment.has(name)) previousEnvironment.set(name, process.env[name]);
  process.env[name] = value;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('Timed out waiting for canonical Honeycrisp session completion.');
}
