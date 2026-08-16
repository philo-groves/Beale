import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { importHoneycrispSessionCapture } from '../src/main/honeycrispCliClient';
import {
  createHoneycrispSessionBoundary,
  getHoneycrispRunDetailForClient
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
  it('uses Honeycrisp as the only writer for session creation, capture import, lifecycle, and queries', () => {
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
    } finally {
      inspection.close();
      database.close();
    }
  }, 15_000);

  it('runs the Honeycrisp host adapter against the canonical store without creating a Beale run row', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-canonical-run-'));
    const registry = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-canonical-registry-'));
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
        promptMarkdown: 'Inspect the canonical session boundary.',
        mode: 'open_discovery',
        attemptStrategy: 'iterative_research',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        sandboxProfile: 'host',
        budget: { maxMinutes: 30, maxAttempts: 1, maxCostUsd: 0 },
      });
      const runId = started.runs[0]?.run.id;
      expect(runId).toBeTruthy();
      await waitFor(() => service.getRunDetail(runId!).run.status !== 'active');
      expect(service.getRunDetail(runId!)).toMatchObject({
        run: { status: 'completed' },
        transcriptMessages: [{ role: 'assistant' }]
      });
      await expect(service.getRunDetailForClient(runId!)).resolves.toMatchObject({
        run: { status: 'completed' },
        transcriptMessages: [{ role: 'assistant' }]
      });

      const databasePath = join(registry, 'honeycrisp', 'profiles', 'security-research', 'memory.sqlite');
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
