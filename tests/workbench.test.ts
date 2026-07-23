import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceOnboardingProgressUpdate, ScopeAssetKind, StartRunInput } from '@shared/types';
import { WorkspaceDatabase } from '../src/main/database';
import { honeycrispProcessEnvironment } from '../src/main/honeycrispRunEngine';
import { startRunForTest, WorkspaceService } from '../src/main/workspaceService';

const createdDirs: string[] = [];

beforeEach(() => {
  process.env.BEALE_WORKSPACE_REGISTRY_DIR = tempWorkspace();
});

afterEach(() => {
  delete process.env.BEALE_TEST_FAIL_ATOMIC_EXPORT;
  delete process.env.BEALE_GIT_COMMAND;
  delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
  delete process.env.BEALE_OPENAI_AUTH_COMMAND;
  delete process.env.BEALE_OPENAI_AUTH_ARGS_JSON;
  delete process.env.BEALE_OPENAI_CODEX_AUTH_FILE;
  delete process.env.OPENAI_API_KEY;
  delete process.env.BEALE_HONEYCRISP_ARGS_JSON;
  delete process.env.BEALE_HONEYCRISP_COMMAND;
  delete process.env.BEALE_HONEYCRISP_CONFIG;
  delete process.env.BEALE_HONEYCRISP_CWD;
  delete process.env.BEALE_HONEYCRISP_GOAL_LOOPS;
  delete process.env.BEALE_HONEYCRISP_MOCK;
  delete process.env.BEALE_HONEYCRISP_NODE_COMMAND;
  delete process.env.BEALE_HONEYCRISP_PNPM_COMMAND;
  delete process.env.BEALE_HONEYCRISP_PROVIDER;
  delete process.env.BEALE_HONEYCRISP_ROOT;
  delete process.env.BEALE_HONEYCRISP_RUNTIME_ARGS_JSON;
  delete process.env.BEALE_HONEYCRISP_TOOL_MAX_BYTES;
  delete process.env.HONEYCRISP_CODEX_AUTH_FILE;
  delete process.env.BEALE_WORKSPACE_REGISTRY_DIR;
  delete process.env.BEALE_TOOLING_ARGS_PATH;
  delete process.env.POC_SAVE_DIR;
  delete process.env.XDG_CACHE_HOME;
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Beale workbench skeleton', () => {
  it('bridges the host Codex auth file path into Honeycrisp without credential values', () => {
    const codexAuthFile = join(tempWorkspace(), 'auth.json');
    writeFileSync(codexAuthFile, '{}');
    process.env.BEALE_OPENAI_CODEX_AUTH_FILE = codexAuthFile;

    const env = honeycrispProcessEnvironment();

    expect(env.HONEYCRISP_CODEX_AUTH_FILE).toBe(codexAuthFile);
    expect(JSON.stringify(env)).not.toContain('access_token');
  });

  it('initializes and reopens the global SQLite database for a workspace', () => {
    const dir = tempWorkspace();
    const service = new WorkspaceService();

    const snapshot = service.createWorkspace(dir);
    expect(snapshot.workspace.workspacePath).toBe(dir);
    expect(snapshot.workspace.databasePath).toBe(globalDatabasePath());
    expect(snapshot.activeScope.version).toBe(1);
    expect(snapshot.activeScope.workspaceName).toBe('Untitled Workspace');
    expect(snapshot.openAi.credentialsHostOnly).toBe(true);
    expect(snapshot.openAi.readiness).toBe('not_configured');
    expect(snapshot.openAi.onboardingSteps.some((step) => step.id === 'secret_isolation')).toBe(true);
    expect(snapshot.projectSemantic).toMatchObject({ enabled: false, status: 'disabled', remoteEmbeddingEnabled: false });
    expect(snapshot.projectGraph).toMatchObject({ status: 'disabled', nodeCount: 0, edgeCount: 0 });
    expect(service.refreshOpenAiStatus().openAi.readiness).toBe('not_configured');
    expect(existsSync(globalDatabasePath())).toBe(true);
    expect(existsSync(join(dir, '.beale', 'artifacts', 'sha256'))).toBe(true);
    const registry = new DatabaseSync(join(process.env.BEALE_WORKSPACE_REGISTRY_DIR ?? '', 'workspace-registry.sqlite'));
    expect(registry.prepare("SELECT version, name FROM schema_migrations WHERE component = 'beale_registry'").get()).toEqual({
      version: 1,
      name: 'registry_schema_baseline'
    });
    expect(registry.prepare("SELECT value FROM registry_meta WHERE key = 'schema_version'").get()).toBeUndefined();
    registry.close();
    const schema = new DatabaseSync(globalDatabasePath());
    const benchmarkTables = schema
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('benchmark_runs', 'benchmark_task_results') ORDER BY name")
      .all();
    const scopeTable = schema.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scope_versions'").get();
    const removedSchemaTables = schema.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'program_scope_versions'").all();
    const migration = schema
      .prepare("SELECT component, version, name FROM schema_migrations WHERE component = 'beale_workbench'")
      .get();
    const scopeColumns = (schema.prepare('PRAGMA table_info(scope_versions)').all() as Array<{ name: string }>).map((row) => row.name);
    const obsoleteSchemaVersion = schema.prepare("SELECT value FROM workspace_meta WHERE key = 'schema_version'").get();
    schema.close();
    expect(benchmarkTables).toHaveLength(0);
    expect(scopeTable).toBeTruthy();
    expect(removedSchemaTables).toHaveLength(0);
    expect(migration).toEqual({ component: 'beale_workbench', version: 1, name: 'workspace_schema_baseline' });
    expect(obsoleteSchemaVersion).toBeUndefined();
    expect(scopeColumns).toEqual(expect.arrayContaining(['workspace_name', 'scope_owner']));
    expect(scopeColumns).not.toEqual(expect.arrayContaining(['program_name', 'organization_name']));

    const workspaceId = snapshot.workspace.workspaceId;
    service.close();

    const preMigrationDatabase = new DatabaseSync(globalDatabasePath());
    preMigrationDatabase.prepare("DELETE FROM schema_migrations WHERE component = 'beale_workbench'").run();
    preMigrationDatabase.prepare("INSERT OR REPLACE INTO workspace_meta (key, value, updated_at) VALUES ('schema_version', '1', ?)").run(new Date().toISOString());
    preMigrationDatabase.close();

    const reopened = service.openWorkspace(dir);
    expect(reopened.workspace.workspaceId).toBe(workspaceId);
    expect(reopened.activeScope.version).toBe(1);
    service.close();

    const migratedDatabase = new DatabaseSync(globalDatabasePath());
    expect(migratedDatabase.prepare("SELECT version, name FROM schema_migrations WHERE component = 'beale_workbench'").get()).toEqual({
      version: 1,
      name: 'workspace_schema_baseline'
    });
    expect(migratedDatabase.prepare("SELECT value FROM workspace_meta WHERE key = 'schema_version'").get()).toBeUndefined();
    migratedDatabase.close();
  });

  it('migrates legacy completed runs whose latest Honeycrisp capture reported an agent error', () => {
    const workspace = tempWorkspace();
    const service = new WorkspaceService();
    service.createWorkspace(workspace);
    const snapshot = startRunForTest(service, runInput('source_logic_bug'));
    const runId = snapshot.runs[0]?.run.id ?? '';
    const attemptId = service.getRunDetail(runId).attempts.at(-1)?.id ?? '';
    service.close();

    const databasePath = globalDatabasePath();
    const legacyDatabase = new DatabaseSync(databasePath);
    const now = new Date().toISOString();
    legacyDatabase
      .prepare(
        `INSERT INTO model_sessions (
          id, run_id, provider, transport, previous_response_id, status,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'honeycrisp', 'host_process', NULL, 'completed', ?, ?, ?)`
      )
      .run('model_session_legacy_error', runId, JSON.stringify({ honeycrispAgentStatus: 'error' }), now, now);
    legacyDatabase.prepare("UPDATE runs SET status = 'completed', summary = 'Incorrect legacy completion.' WHERE id = ?").run(runId);
    legacyDatabase
      .prepare("UPDATE attempts SET status = 'completed', short_state = 'Incorrect legacy completion.' WHERE id = ?")
      .run(attemptId);
    legacyDatabase.prepare("DELETE FROM schema_migrations WHERE component = 'beale_workbench' AND version >= 2").run();
    legacyDatabase.close();

    const reopened = new WorkspaceService();
    reopened.openWorkspace(workspace);
    const detail = reopened.getRunDetail(runId);
    reopened.close();

    expect(detail.run).toMatchObject({ status: 'failed', summary: 'Honeycrisp capture reported an agent error.' });
    expect(detail.attempts.find((attempt) => attempt.id === attemptId)).toMatchObject({
      status: 'failed',
      shortState: 'Honeycrisp capture reported an agent error.'
    });
    expect(detail.modelSessions.at(-1)?.status).toBe('failed');

    const migratedDatabase = new DatabaseSync(databasePath);
    expect(
      migratedDatabase
        .prepare("SELECT version, name FROM schema_migrations WHERE component = 'beale_workbench' AND version = 2")
        .get()
    ).toEqual({ version: 2, name: 'reconcile_errored_honeycrisp_run_status' });
    migratedDatabase.close();
  });

  it('keeps operational records scoped while workspaces share the global database', () => {
    const databasePath = globalDatabasePath();
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const first = new WorkspaceDatabase(databasePath, join(firstWorkspace, '.beale', 'artifacts'), { workspacePath: firstWorkspace });
    first.initialize();
    first.saveScope({
      workspaceName: 'Zsh',
      scopeOwner: 'Apple',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      networkProfile: 'offline',
      expiresAt: null,
      assets: []
    });
    const firstRun = first.createRun({
      scopeVersionId: first.getActiveScope().id,
      title: 'Zsh session',
      promptMarkdown: 'Inspect Zsh.',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'single_path',
      networkProfile: 'offline',
      sandboxProfile: 'host',
      budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0 }
    });

    const second = new WorkspaceDatabase(databasePath, join(secondWorkspace, '.beale', 'artifacts'), { workspacePath: secondWorkspace });
    second.initialize();
    second.saveScope({
      workspaceName: 'mDNSResponder',
      scopeOwner: 'Apple',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      networkProfile: 'offline',
      expiresAt: null,
      assets: []
    });

    expect(second.getActiveScope().workspaceName).toBe('mDNSResponder');
    expect(second.listRunRows()).toEqual([]);
    expect(second.getRun(firstRun.run.id)).toBeNull();
    expect(first.listRunRows().map((row) => row.run.id)).toEqual([firstRun.run.id]);
    second.close();
    first.close();
  });

  it('keeps disabled context graph state inert for workspace snapshots', () => {
    const dir = tempWorkspace();
    const service = new WorkspaceService();
    service.createWorkspace(dir);
    const runSnapshot = startRunForTest(service, runInput('source_logic_bug'));
    const runId = runSnapshot.runs[0]?.run.id;
    expect(runId).toBeTruthy();
    service.close();

    const db = new WorkspaceDatabase(globalDatabasePath(), join(dir, '.beale', 'artifacts'), { workspacePath: dir });
    db.createHypothesis({
      runId: String(runId),
      state: 'needs_evidence',
      title: 'Snapshot graph refresh hypothesis',
      descriptionMarkdown: 'The workspace overview should refresh stale graph state before rendering.',
      component: 'overview graph',
      bugClass: 'state_sync',
      priorityScore: 0.4,
      attackerReachability: 'local',
      impact: 'low',
      evidenceConfidence: 'model',
      exploitPracticality: 'needs validation',
      scopeConfidence: 'in_scope'
    });
    const graph = db.getProjectGraphSummary(runSnapshot.activeScope.id);
    expect(graph.status).toBe('empty');
    expect(graph.nodeCount).toBe(0);
    db.close();

    const reopened = new WorkspaceService();
    const refreshed = reopened.openWorkspace(dir);
    expect(refreshed.projectGraph).toMatchObject({
      scopeVersionId: runSnapshot.activeScope.id,
      status: 'disabled',
      nodeCount: 0,
      edgeCount: 0,
      buildCount: 0
    });
    reopened.close();
  });

  it('resolves existing Honeycrisp memory directories for host file manager actions', () => {
    const dir = tempWorkspace();
    const service = new WorkspaceService();
    service.createWorkspace(dir);
    const artifactsPath = join(dirname(globalDatabasePath()), 'artifacts');

    expect(service.resolveHoneycrispMemoryDirectoryPath('artifacts')).toBe(artifactsPath);
    expect(() => service.resolveHoneycrispMemoryDirectoryPath('unknown' as never)).toThrow(/Unknown Honeycrisp memory directory/);
    service.close();
  });

  it('onboards workspaces into the global registry and mirrors run summaries', () => {
    const workspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });

    expect(service.getWorkspaceRegistryState().workspaces).toHaveLength(0);
    const inspection = service.inspectWorkspaceDirectory(workspace);
    expect(inspection.requiresOnboarding).toBe(true);
    expect(inspection.defaults?.workspacePath).toBe(workspace);
    expect(existsSync(join(workspace, '.beale'))).toBe(false);

    const snapshot = service.createScopedWorkspace({
      workspacePath: workspace,
      workspaceName: 'Acme Bug Bounty',
      scopeOwner: '',
      descriptionMarkdown: 'Authorized parser research.',
      rulesMarkdown: 'Stay inside recorded scope.',
      networkProfile: 'offline',
      expiresAt: '   '
    });
    expect(snapshot.activeScope.workspaceName).toBe('Acme Bug Bounty');
    expect(snapshot.activeScope.scopeOwner).toBe('');
    expect(snapshot.activeScope.expiresAt).toBeNull();
    expect(existsSync(join(registryDir, 'honeycrisp', 'memory.sqlite'))).toBe(true);

    const registered = service.getWorkspaceRegistryState();
    expect(registered.registryPath).toBe(join(registryDir, 'workspace-registry.sqlite'));
    expect(registered.workspaces).toHaveLength(1);
    expect(registered.workspaces[0]).toMatchObject({
      workspacePath: workspace,
      workspaceName: 'Acme Bug Bounty',
      scopeOwner: '',
      runCount: 0
    });
    expect(service.inspectWorkspaceDirectory(workspace).knownWorkspace?.id).toBe(registered.workspaces[0].id);

    const runSnapshot = service.startRun(runInput('verified_finding'), 'complete');
    const latestRun = runSnapshot.runs[0]?.run;
    expect(latestRun).toBeTruthy();
    const withRun = service.getWorkspaceRegistryState();
    expect(withRun.workspaces[0].runCount).toBe(1);
    expect(withRun.researchSessions[0]).toMatchObject({
      registryWorkspaceId: withRun.workspaces[0].id,
      workspacePath: workspace,
      runId: latestRun?.id,
      title: latestRun?.title,
      promptMarkdown: '# Test run\nExercise the fixture workbench path.',
      status: latestRun?.status,
      runEngine: 'fixture'
    });
    service.close();

    const reopened = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });
    const persisted = reopened.getWorkspaceRegistryState();
    expect(persisted.workspaces[0].workspaceName).toBe('Acme Bug Bounty');
    expect(persisted.researchSessions[0].runId).toBe(latestRun?.id);
    expect(reopened.openRegisteredWorkspace(persisted.workspaces[0].id).activeScope.workspaceName).toBe('Acme Bug Bounty');
    reopened.close();
  });

  it('executes research prompts through the Honeycrisp host process adapter', async () => {
    const workspace = tempWorkspace();
    const fakeHoneycrisp = join(workspace, 'fake-honeycrisp.mjs');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { dirname } from 'node:path';",
        'const args = process.argv.slice(2);',
        "const capturePath = args[args.indexOf('--capture') + 1];",
        "if (!capturePath) throw new Error('missing --capture');",
        "if (!args.includes('--event-stream')) throw new Error('missing --event-stream');",
        "if (args[args.indexOf('--executor') + 1] !== 'agent') throw new Error('missing agent executor');",
        "if (args[args.indexOf('--provider') + 1] !== 'xai') throw new Error('missing xAI provider');",
        "if (args[args.indexOf('--title-model') + 1] !== 'grok-4.3') throw new Error('missing xAI title model');",
        "if (args[args.indexOf('--title-effort') + 1] !== 'medium') throw new Error('missing title effort');",
        "mkdirSync(dirname(capturePath), { recursive: true });",
        'const now = new Date().toISOString();',
        'const capture = {',
        '  schemaVersion: 4,',
        '  capturedAt: now,',
        "  request: { prompt: 'Fixture Honeycrisp research' },",
        '  agent: {',
        "    id: 'agent_fixture',",
        "    status: 'complete',",
        "    executorName: 'fixture-honeycrisp',",
        '    startedAt: now,',
        '    completedAt: now,',
        "    outputText: 'Fixture Honeycrisp answer.',",
        '    nextPromptSuggestions: [',
        "      { title: 'Verify fixture', promptMarkdown: 'Skeptically verify the fixture result with fresh evidence.', rationale: 'Test structured prompt suggestions.' },",
        "      { title: 'Inspect adjacent fixture', promptMarkdown: 'Inspect adjacent fixture files without repeating exhausted targets.' },",
        "      { title: 'Summarize fixture', promptMarkdown: 'Summarize the fixture evidence and decide whether to continue.' }",
        '    ],',
        '    researchTrace: {',
        "      observations: [{ text: 'Fixture observation.', confidence: 1 }],",
        "      inferences: [{ text: 'Fixture inference.', confidence: 0.8 }],",
        "      hypotheses: [{ text: 'Fixture hypothesis.', confidence: 0.4 }],",
        '      assumptions: [],',
        '      rejectedPaths: [],',
        '      uncertainty: [],',
        '      nextQuestions: [],',
        '      evidenceLinks: []',
        '    },',
        '    raw: {',
        "      provider: 'fixture-provider',",
        "      model: 'fixture-model',",
        "      api: 'fixture-api',",
        "      stopReason: 'complete',",
        "      responseId: 'fixture-response',",
        '      usage: { input_tokens: 12345, output_tokens: 678, total_tokens: 13023 },',
        '      modelCalls: [{ usage: { input: 2345, output: 678, cacheRead: 10000, cacheWrite: 0, totalTokens: 13023, cacheHitRate: 0.8100445524503848 } }],',
        '      toolCallCount: 0,',
        '      plannedToolCallCount: 0,',
        '      subagents: { maxThreads: 6, maxDepth: 1, agents: [{ id: \'agent_child\', path: \'/root/parser_review\', status: \'completed\', model: \'gpt-5.6-sol\', reasoningEffort: \'high\', modelCalls: [{ usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1100, cacheHitRate: 0 } }] }] }',
        '    }',
        '  },',
        "  storageManifest: { path: '/tmp/fixture-manifest.json', artifactCount: 0, artifacts: [] },",
        '  eventTimeline: [',
        "    { id: 'evt_context', sequence: 1, timestamp: now, kind: 'context.compiled', summary: 'Fixture context compiled.', payload: { request: 'fixture' } },",
        "    { id: 'evt_tool_call', sequence: 2, timestamp: now, kind: 'tool.requested', summary: 'Fixture tool requested.', payload: { toolName: 'repository.search' } },",
        "    { id: 'evt_tool_result', sequence: 3, timestamp: now, kind: 'tool.observed', summary: 'Fixture tool observed.', payload: { summary: 'search result' } },",
        "    { id: 'evt_claim', sequence: 4, timestamp: now, kind: 'model.claim', summary: 'Fixture model claim.', payload: { text: 'claim' } }",
        '  ],',
        "  runtimeConfig: { modelConfig: { mode: 'mock' } }",
        '};',
        "writeFileSync(capturePath, JSON.stringify(capture, null, 2) + '\\n');",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'session.title', timestamp: now, payload: { status: 'error', provider: 'xai', model: 'grok-4.3', effort: 'medium', errorMessage: 'Fixture title failure.' } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'session.title', timestamp: now, payload: { title: 'Zsh Host Adapter Validation', provider: 'xai', model: 'grok-4.3', effort: 'medium' } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'research.event', timestamp: now, payload: { agentId: 'agent_child', agentPath: '/root/parser_review', parentAgentId: 'root', event: { id: 'evt_tool_result', sequence: 3, kind: 'tool.observed', timestamp: now, summary: 'Live repository search completed.', payload: { toolName: 'repository.search', summary: 'Live repository search completed.' } } } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'model.thought', timestamp: now, payload: { phase: 'completed', eventType: 'thinking_end', responseId: 'fixture-response', itemId: 'thinking:0', provider: 'fixture-provider', model: 'fixture-model', text: '**Focus** Inspect fixture context' } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'agent.event', timestamp: now, payload: { type: 'subagent.activity', action: 'spawned', agentId: 'agent_child', agentPath: '/root/parser_review', parentId: 'root', status: 'running', message: 'Inspect parser boundary.' } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'model.output', timestamp: now, payload: { phase: 'completed', eventType: 'text_end', agentId: 'agent_child', agentPath: '/root/parser_review', parentAgentId: 'root', turn: 1, responseId: 'child_response', itemId: 'text:0', text: 'Parser boundary inspected.' } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'agent.event', timestamp: now, payload: { type: 'turn_completed', agentId: 'agent_child', agentPath: '/root/parser_review', parentAgentId: 'root', turn: 1, usage: { input: 1000, output: 100, totalTokens: 1100 } } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'agent.event', timestamp: now, payload: { type: 'subagent.activity', action: 'completed', agentId: 'agent_child', agentPath: '/root/parser_review', parentId: 'root', status: 'completed', message: 'Parser boundary inspected.' } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'agent.event', timestamp: now, payload: { type: 'context_compacted', reason: 'context_window_error', retry: true, agentId: 'root', agentPath: '/root', tokensBefore: 280000, tokensAfter: 120000 } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'agent.event', timestamp: now, payload: { type: 'model_retry', retry: 1, maxRetries: 2, errorMessage: 'Model stream produced no content for 180000ms.', agentId: 'agent_child', agentPath: '/root/parser_review', parentAgentId: 'root' } }));",
        "console.log('fixture honeycrisp stdout');"
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp]);

    const service = new WorkspaceService();
    const snapshot = service.createWorkspace(workspace);
    const runSnapshot = service.startRun({
      ...runInput('adaptive_portfolio'),
      runEngine: 'honeycrisp',
      promptMarkdown: '# Honeycrisp fixture\nRun through the host adapter.',
      provider: 'xai',
      model: 'fixture-model',
      reasoningEffort: 'minimal'
    });
    const runId = runSnapshot.runs[0]?.run.id;
    expect(runId).toBeTruthy();
    expect(runSnapshot.runs[0]?.engine).toBe('honeycrisp');
    expect(snapshot.workspace.workspacePath).toBe(workspace);

    await waitForCondition(() => service.getSnapshot()?.runs[0]?.run.status === 'completed', 5000);

    const detail = service.getRunDetail(runId ?? '');
    expect(detail.run.title).toBe('Zsh Host Adapter Validation');
    expect(detail.traceEvents.find((event) => event.summary === 'Session title generation failed.')?.payload).toMatchObject({
      provider: 'xai',
      model: 'grok-4.3',
      effort: 'medium',
      errorMessage: 'Fixture title failure.'
    });
    expect(detail.modelSessions[0]).toMatchObject({ provider: 'honeycrisp', transport: 'host_process', status: 'completed' });
    expect(detail.modelSessions[0]?.metadata).toMatchObject({
      provider: 'xai',
      latestReportedInputTokens: 12345,
      latestReportedTotalTokens: 14123,
      latestContextUsageSource: 'Honeycrisp reported model usage',
      latestContextUsageEstimated: false,
      honeycrispAgentRunId: 'agent_fixture',
      honeycrispAgentStatus: 'complete',
      honeycrispRequestPrompt: 'Fixture Honeycrisp research',
      honeycrispSubagentCount: 1,
      honeycrispSubagentCompletedCount: 1,
      honeycrispSubagentFailedCount: 0,
      honeycrispSubagentMaxThreads: 6,
      honeycrispSubagentMaxDepth: 1
    });
    const captureTrace = detail.traceEvents.find((event) => event.summary === 'Honeycrisp flow capture preserved as a Beale artifact.');
    expect(captureTrace?.payload).toMatchObject({
      request: {
        prompt: 'Fixture Honeycrisp research'
      },
      agent: {
        id: 'agent_fixture',
        status: 'complete',
        executorName: 'fixture-honeycrisp'
      },
      usage: {
        input_tokens: 2345,
        prompt_tokens: 12345,
        output_tokens: 778,
        total_tokens: 14123,
        cache_read_tokens: 10000,
        cache_write_tokens: 0,
        source: 'Honeycrisp reported model usage',
        estimated: false
      }
    });
    expect(Number((captureTrace?.payload.usage as Record<string, unknown>).cache_hit_rate)).toBeCloseTo(10_000 / 13_345);
    expect(detail.traceEvents.some((event) => event.summary.includes('Honeycrisp agent session: Fixture Honeycrisp research'))).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Honeycrisp subagent /root/parser_review started.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Honeycrisp subagent /root/parser_review turn 1 completed.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Honeycrisp subagent /root/parser_review completed.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary.includes('fixture honeycrisp stdout'))).toBe(true);
    expect(detail.traceEvents.find((event) => event.summary === 'OpenAI context window pressure triggered compacted retry.')?.payload).toMatchObject({
      agentPath: '/root',
      tokensBefore: 280000,
      tokensAfter: 120000,
      retry: true
    });
    expect(detail.traceEvents.find((event) => event.summary === 'Honeycrisp retried a silent model stream.')?.payload).toMatchObject({
      agentPath: '/root/parser_review',
      retry: 1,
      maxRetries: 2
    });
    expect(detail.traceEvents.some((event) => event.summary.includes('Honeycrisp tool.requested'))).toBe(true);
    expect(
      detail.traceEvents.filter((event) => (event.payload as { honeycrispEventId?: string }).honeycrispEventId === 'evt_tool_result')
    ).toHaveLength(1);
    expect(detail.traceEvents.find((event) => event.payload.honeycrispEventId === 'evt_tool_result')?.payload.agentPath).toBe('/root/parser_review');
    expect(detail.traceEvents.some((event) => event.type === 'hypothesis_event' && event.summary.includes('Fixture hypothesis'))).toBe(true);
    expect(detail.artifacts.find((artifact) => artifact.kind === 'honeycrisp_flow_capture')).toMatchObject({ modelVisible: false });
    expect(detail.transcriptMessages.some((message) => message.source === 'openai_reasoning_summary' && message.contentMarkdown.includes('Inspect fixture context'))).toBe(true);
    expect(detail.transcriptMessages.some((message) => message.source === 'openai_reasoning_summary' && message.contentMarkdown.includes('Live repository search completed'))).toBe(false);
    expect(detail.transcriptMessages.some((message) => message.source === 'honeycrisp' && message.contentMarkdown.includes('Fixture Honeycrisp answer.'))).toBe(true);
    expect(
      detail.transcriptMessages.some(
        (message) => message.source === 'honeycrisp' && message.metadata.agentPath === '/root/parser_review' && message.contentMarkdown === 'Parser boundary inspected.'
      )
    ).toBe(true);
    const honeycrispTranscript = detail.transcriptMessages.find(
      (message) => message.source === 'honeycrisp' && Array.isArray(message.metadata.nextPromptSuggestions)
    );
    expect(honeycrispTranscript?.metadata.nextPromptSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Verify fixture',
          promptMarkdown: 'Skeptically verify the fixture result with fresh evidence.'
        })
      ])
    );
    expect(
      detail.traceEvents.find((event) => event.summary === 'Honeycrisp produced a final run response.')?.payload.nextPromptSuggestions
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Verify fixture',
          promptMarkdown: 'Skeptically verify the fixture result with fresh evidence.'
        })
      ])
    );
    expect(detail.run.summary).toContain('completed the research session');
    service.close();
  });

  it('marks an errored Honeycrisp capture as failed even when the host process exits cleanly', async () => {
    const workspace = tempWorkspace();
    const fakeHoneycrisp = join(workspace, 'fake-honeycrisp-error.mjs');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { dirname } from 'node:path';",
        'const args = process.argv.slice(2);',
        "const capturePath = args[args.indexOf('--capture') + 1];",
        "mkdirSync(dirname(capturePath), { recursive: true });",
        'const now = new Date().toISOString();',
        "writeFileSync(capturePath, JSON.stringify({ schemaVersion: 4, capturedAt: now, request: { prompt: 'Transient failure fixture' }, agent: { id: 'agent_error', status: 'error', executorName: 'fixture-honeycrisp', startedAt: now, completedAt: now, outputText: 'Transient provider failure.' }, eventTimeline: [] }) + '\\n');"
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp]);

    const service = new WorkspaceService();
    service.createWorkspace(workspace);
    const snapshot = service.startRun({
      ...runInput('adaptive_portfolio'),
      runEngine: 'honeycrisp',
      promptMarkdown: 'Exercise errored capture handling.'
    });
    const runId = snapshot.runs[0]?.run.id ?? '';

    await waitForCondition(() => service.getSnapshot()?.runs[0]?.run.status === 'failed', 5000);

    const detail = service.getRunDetail(runId);
    expect(detail.run.status).toBe('failed');
    expect(detail.attempts.at(-1)?.status).toBe('failed');
    expect(detail.modelSessions.at(-1)?.status).toBe('failed');
    expect(detail.modelSessions.at(-1)?.metadata).toMatchObject({ honeycrispAgentStatus: 'error' });
    expect(detail.artifacts.some((artifact) => artifact.kind === 'honeycrisp_flow_capture')).toBe(true);
    service.close();
  });

  it('pauses, resumes, and steers an active Honeycrisp process', async () => {
    const workspace = tempWorkspace();
    const fakeHoneycrisp = join(workspace, 'fake-controlled-honeycrisp.mjs');
    const controlLogPath = join(workspace, 'controls.jsonl');
    const heartbeatPath = join(workspace, 'heartbeat.txt');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
        "import { dirname } from 'node:path';",
        'const [controlLogPath, heartbeatPath, ...args] = process.argv.slice(2);',
        "if (!args.includes('--control-stream')) throw new Error('missing --control-stream');",
        "const capturePath = args[args.indexOf('--capture') + 1];",
        "mkdirSync(dirname(capturePath), { recursive: true });",
        "writeFileSync(heartbeatPath, '0');",
        'let heartbeat = 0;',
        "const timer = setInterval(() => writeFileSync(heartbeatPath, String(++heartbeat)), 20);",
        "process.stdin.setEncoding('utf8');",
        "let buffer = '';",
        "process.stdin.on('data', (chunk) => {",
        '  buffer += chunk;',
        "  let newlineIndex = buffer.indexOf('\\n');",
        '  while (newlineIndex !== -1) {',
        "    const line = buffer.slice(0, newlineIndex).replace(/\\r$/, '');",
        '    buffer = buffer.slice(newlineIndex + 1);',
        '    const message = JSON.parse(line);',
        "    appendFileSync(controlLogPath, JSON.stringify(message) + '\\n');",
        "    if (message.type === 'steer') {",
        '      clearInterval(timer);',
        '      const now = new Date().toISOString();',
        '      const capture = {',
        '        schemaVersion: 4,',
        '        capturedAt: now,',
        "        request: { prompt: 'Controlled run' },",
        "        agent: { id: 'agent_control', status: 'complete', executorName: 'controlled-fixture', startedAt: now, completedAt: now, outputText: 'Steering received.' },",
        '        eventTimeline: []',
        '      };',
        "      writeFileSync(capturePath, JSON.stringify(capture) + '\\n');",
        '      setImmediate(() => process.exit(0));',
        '    }',
        "    newlineIndex = buffer.indexOf('\\n');",
        '  }',
        '});'
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp, controlLogPath, heartbeatPath]);

    const service = new WorkspaceService();
    try {
      service.createWorkspace(workspace);
      const started = service.startRun({
        ...runInput('adaptive_portfolio'),
        runEngine: 'honeycrisp',
        promptMarkdown: '# Controlled Honeycrisp fixture',
        model: 'fixture-model',
        reasoningEffort: 'minimal'
      });
      const runId = started.runs[0]?.run.id ?? '';
      await waitForCondition(() => existsSync(heartbeatPath));
      await waitForCondition(() => Number(readFileSync(heartbeatPath, 'utf8')) > 0);

      service.steerRun({ type: 'pause', runId });
      expect(service.getRunDetail(runId).run.status).toBe('paused');
      const pausedHeartbeat = readFileSync(heartbeatPath, 'utf8');
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(readFileSync(heartbeatPath, 'utf8')).toBe(pausedHeartbeat);

      service.steerRun({ type: 'resume', runId });
      expect(service.getRunDetail(runId).run.status).toBe('active');
      await waitForCondition(() => readFileSync(heartbeatPath, 'utf8') !== pausedHeartbeat);

      service.steerRun({
        type: 'steer',
        runId,
        instruction: 'Inspect the authorization boundary next.',
        modelSelection: { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' }
      });
      await waitForCondition(() => service.getRunDetail(runId).run.status === 'completed', 5000);

      const controls = readFileSync(controlLogPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; instruction?: string; modelSelection?: Record<string, string> });
      expect(controls.map((control) => control.type)).toEqual(['pause', 'resume', 'steer']);
      expect(controls[2]?.instruction).toBe('Inspect the authorization boundary next.');
      expect(controls[2]?.modelSelection).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' });
      expect(service.getRunDetail(runId).run).toMatchObject({ model: 'gpt-5.6-sol', reasoningEffort: 'high' });
      expect(
        service.getRunDetail(runId).traceEvents.find((event) => event.summary === 'User steering added to current run.')?.payload
      ).toMatchObject({ deliveredToHoneycrisp: true });
    } finally {
      service.close();
    }
  });

  it('asks Honeycrisp to stop its agent tree before terminating the host process', async () => {
    const workspace = tempWorkspace();
    const fakeHoneycrisp = join(workspace, 'fake-stoppable-honeycrisp.mjs');
    const controlLogPath = join(workspace, 'stop-controls.jsonl');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { appendFileSync } from 'node:fs';",
        'const [controlLogPath] = process.argv.slice(2);',
        "process.stdin.setEncoding('utf8');",
        "let buffer = '';",
        "process.stdin.on('data', (chunk) => {",
        '  buffer += chunk;',
        "  let newlineIndex = buffer.indexOf('\\n');",
        '  while (newlineIndex !== -1) {',
        "    const line = buffer.slice(0, newlineIndex).replace(/\\r$/, '');",
        '    buffer = buffer.slice(newlineIndex + 1);',
        '    const message = JSON.parse(line);',
        "    appendFileSync(controlLogPath, JSON.stringify(message) + '\\n');",
        "    if (message.type === 'stop') {",
        "      const now = new Date().toISOString();",
        "      console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'agent.event', timestamp: now, payload: { type: 'subagent.activity', action: 'interrupted', agentId: 'agent_child', agentPath: '/root/reviewer', parentId: 'root', status: 'interrupted' } }));",
        '      setImmediate(() => process.exit(0));',
        '    }',
        "    newlineIndex = buffer.indexOf('\\n');",
        '  }',
        '});',
        'setInterval(() => undefined, 1000);'
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp, controlLogPath]);

    const service = new WorkspaceService();
    try {
      service.createWorkspace(workspace);
      const started = service.startRun({
        ...runInput('adaptive_portfolio'),
        runEngine: 'honeycrisp',
        promptMarkdown: 'Exercise graceful Honeycrisp cancellation.',
        model: 'fixture-model',
        reasoningEffort: 'minimal'
      });
      const runId = started.runs[0]?.run.id ?? '';

      await waitForCondition(() => service.getRunDetail(runId).run.status === 'active');
      service.steerRun({ type: 'stop', runId });
      await waitForCondition(
        () => service.getRunDetail(runId).traceEvents.some((event) => event.summary === 'Honeycrisp host process was stopped by Beale.'),
        5000
      );

      expect(JSON.parse(readFileSync(controlLogPath, 'utf8').trim())).toMatchObject({ schemaVersion: 1, type: 'stop' });
      expect(
        service.getRunDetail(runId).traceEvents.some((event) => event.summary === 'Honeycrisp subagent /root/reviewer was interrupted.')
      ).toBe(true);
    } finally {
      service.close();
    }
  });

  it('stops an active Honeycrisp process when its session time limit is reached', async () => {
    const workspace = tempWorkspace();
    const fakeHoneycrisp = join(workspace, 'fake-long-running-honeycrisp.mjs');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "process.on('SIGTERM', () => process.exit(0));",
        'setInterval(() => undefined, 1000);'
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp]);

    const service = new WorkspaceService();
    try {
      service.createWorkspace(workspace);
      const started = service.startRun({
        ...runInput('adaptive_portfolio'),
        runEngine: 'honeycrisp',
        promptMarkdown: 'Exercise the bounded Honeycrisp fixture.',
        model: 'fixture-model',
        reasoningEffort: 'minimal',
        budget: { maxMinutes: 0.001, maxAttempts: 1, maxCostUsd: 0 }
      });
      const runId = started.runs[0]?.run.id ?? '';

      await waitForCondition(() => service.getRunDetail(runId).run.status === 'stopped', 3000);

      const detail = service.getRunDetail(runId);
      expect(detail.traceEvents.some((event) => event.summary === 'Session time limit reached.')).toBe(true);
      expect(detail.traceEvents.some((event) => event.summary === 'Honeycrisp host process stopped at the session time limit.')).toBe(true);
      expect(detail.run.summary).toBe('Honeycrisp host process stopped at the session time limit.');
      expect(detail.modelSessions[0]?.metadata).toMatchObject({ stopReason: 'time_limit' });
    } finally {
      service.close();
    }
  });

  it('extends a completed Honeycrisp session in place with prior transcript context', async () => {
    const workspace = tempWorkspace();
    const fakeHoneycrisp = join(workspace, 'fake-continuing-honeycrisp.mjs');
    const invocationLogPath = join(workspace, 'invocations.jsonl');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { dirname } from 'node:path';",
        'const [invocationLogPath, ...args] = process.argv.slice(2);',
        "const capturePath = args[args.indexOf('--capture') + 1];",
        "const prompt = args[args.indexOf('-p') + 1];",
        "const titleModel = args.includes('--title-model') ? args[args.indexOf('--title-model') + 1] : null;",
        "const priorCount = existsSync(invocationLogPath) ? readFileSync(invocationLogPath, 'utf8').trim().split('\\n').filter(Boolean).length : 0;",
        'const turn = priorCount + 1;',
        "mkdirSync(dirname(capturePath), { recursive: true });",
        "appendFileSync(invocationLogPath, JSON.stringify({ capturePath, prompt, titleModel, turn }) + '\\n');",
        'const now = new Date().toISOString();',
        'const capture = {',
        '  schemaVersion: 4,',
        '  capturedAt: now,',
        '  request: { prompt },',
        "  agent: { id: `agent_${turn}`, status: 'complete', executorName: 'continuation-fixture', startedAt: now, completedAt: now, outputText: `Turn ${turn} response.` },",
        '  eventTimeline: []',
        '};',
        "writeFileSync(capturePath, JSON.stringify(capture) + '\\n');"
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp, invocationLogPath]);

    const service = new WorkspaceService();
    try {
      service.createWorkspace(workspace);
      const started = service.startRun({
        ...runInput('adaptive_portfolio'),
        runEngine: 'honeycrisp',
        promptMarkdown: 'Research the ZFTP module for memory-safety vulnerabilities.',
        model: 'fixture-model',
        reasoningEffort: 'minimal'
      });
      const runId = started.runs[0]?.run.id ?? '';
      await waitForCondition(() => service.getRunDetail(runId).run.status === 'completed', 5000);

      service.steerRun({ type: 'steer', runId, instruction: 'Now inspect integer truncation paths.' });
      expect(service.getSnapshot()?.runs).toHaveLength(1);
      expect(service.getRunDetail(runId).run.status).toBe('active');
      await waitForCondition(() => service.getRunDetail(runId).run.status === 'completed', 5000);

      const detail = service.getRunDetail(runId);
      const invocations = readFileSync(invocationLogPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { capturePath: string; prompt: string; titleModel: string | null; turn: number });
      expect(detail.run.id).toBe(runId);
      expect(detail.attempts).toHaveLength(2);
      expect(detail.modelSessions).toHaveLength(2);
      expect(detail.modelSessions.map((session) => session.status)).toEqual(['completed', 'completed']);
      expect(detail.transcriptMessages.map((message) => message.contentMarkdown)).toEqual(
        expect.arrayContaining(['Now inspect integer truncation paths.', 'Turn 1 response.', 'Turn 2 response.'])
      );
      expect(invocations).toHaveLength(2);
      expect(invocations.map((invocation) => invocation.titleModel)).toEqual(['gpt-5.6-luna', null]);
      expect(invocations[1]?.capturePath).not.toBe(invocations[0]?.capturePath);
      expect(invocations[1]?.prompt).toContain('Now inspect integer truncation paths.');
      expect(invocations[1]?.prompt).toContain('Research the ZFTP module for memory-safety vulnerabilities.');
      expect(invocations[1]?.prompt).toContain('Turn 1 response.');
      expect(detail.traceEvents.some((event) => event.summary === 'User steering extended the current research session.')).toBe(true);
    } finally {
      service.close();
    }
  });

  it('runs the default Honeycrisp CLI through a plain Node runtime', async () => {
    const workspace = tempWorkspace();
    const honeycrispRoot = tempWorkspace();
    const cliPath = join(honeycrispRoot, 'packages', 'cli', 'dist', 'cli.js');
    mkdirSync(dirname(cliPath), { recursive: true });
    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { dirname } from 'node:path';",
        'const args = process.argv.slice(2);',
        "const capturePath = args[args.indexOf('--capture') + 1];",
        "const contextPath = args[args.indexOf('--workspace-context') + 1];",
        "if (!contextPath) throw new Error('Missing --workspace-context');",
        "if (args.includes('--repo-root') || args.includes('--file-read-root')) throw new Error('Old repository guard args must not be passed');",
        "if (args.includes('--skill-dir') || args.includes('beale-skeptical-triage')) throw new Error('Removed Beale triage guidance was passed');",
        "const workspaceContext = JSON.parse(readFileSync(contextPath, 'utf8'));",
        "if (!workspaceContext.materializedSourcePaths?.some((path) => String(path).endsWith('/sources/zsh'))) throw new Error('Nested source path missing from workspace context');",
        "if (workspaceContext.materializedSourcePaths?.includes(workspaceContext.workspaceRoot)) throw new Error('Workspace root must not be presented as source code');",
        "if (!workspaceContext.projectNotes?.some((note) => String(note).startsWith('Authorization:'))) throw new Error('Authorization context missing');",
        "if (workspaceContext.authorization?.recorded !== true || workspaceContext.authorization?.source !== 'beale') throw new Error('Structured authorization context missing');",
        "if (workspaceContext.authorization?.networkProfile !== 'offline') throw new Error('Per-session network profile missing from authorization context');",
        "if (!workspaceContext.projectNotes?.includes('Network access profile: offline')) throw new Error('Per-session network profile missing from project notes');",
        "if (!workspaceContext.memoryTierContext?.sessionId || !workspaceContext.memoryTierContext?.workspaceId) throw new Error('Memory tier session/workspace context missing');",
        "if (workspaceContext.memoryTierContext?.subjectName !== 'Apple Security Bounty') throw new Error('Memory subject context missing');",
        "if (!workspaceContext.projectNotes?.some((note) => String(note).startsWith('Rules and constraints:'))) throw new Error('Scope rules missing');",
        "mkdirSync(dirname(capturePath), { recursive: true });",
        "writeFileSync(capturePath, JSON.stringify({",
        '  capturedAt: new Date().toISOString(),',
        '  schemaVersion: 4,',
        "  request: { prompt: 'Node CLI fixture request' },",
        "  agent: { id: 'agent_node_fixture', status: 'complete', executorName: 'node-cli-fixture', outputText: 'Node CLI fixture done.' },",
        '  eventTimeline: []',
        "}, null, 2) + '\\n');",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'agent.event', timestamp: new Date().toISOString(), payload: { type: 'turn_completed', turn: 1, responseId: 'response_fixture', stopReason: 'stop', usage: { input: 123, output: 45, totalTokens: 168 } } }));",
        "console.log('node cli fixture stdout');"
      ].join('\n')
    );
    process.env.BEALE_HONEYCRISP_ROOT = honeycrispRoot;
    process.env.BEALE_HONEYCRISP_NODE_COMMAND = process.execPath;

    const service = new WorkspaceService();
    const nestedSourceRoot = join(workspace, 'sources', 'zsh');
    const credentialReferencePath = join(workspace, 'credentials', 'research-account');
    const nestedContentRoot = join(nestedSourceRoot, 'zsh');
    mkdirSync(join(nestedContentRoot, 'Src'), { recursive: true });
    mkdirSync(dirname(credentialReferencePath), { recursive: true });
    writeFileSync(join(nestedContentRoot, 'Src', 'parse.c'), 'parse_context_save();\n');
    writeFileSync(credentialReferencePath, 'host-only-reference\n');
    service.createWorkspace(workspace);
    service.saveScope({
      workspaceName: 'ZSH Fixture',
      scopeOwner: 'Apple Security Bounty',
      descriptionMarkdown: 'Local nested source fixture for Honeycrisp integration.',
      rulesMarkdown: 'Use local context provided by the operator.',
      networkProfile: 'elevated',
      expiresAt: null,
      assets: [
        asset('in_scope', 'path', nestedSourceRoot),
        asset('out_of_scope', 'domain', 'excluded.example.test'),
        asset('in_scope', 'credential_ref', credentialReferencePath)
      ]
    });
    const runSnapshot = service.startRun({
      ...runInput('adaptive_portfolio'),
      runEngine: 'honeycrisp',
      promptMarkdown: '# Honeycrisp node fixture\nRun through the default CLI path.'
    });
    const runId = runSnapshot.runs[0]?.run.id ?? '';

    await waitForCondition(() => service.getSnapshot()?.runs[0]?.run.status === 'completed', 5000);

    const detail = service.getRunDetail(runId);
    const launchEvent = detail.traceEvents.find((event) => event.summary === 'Honeycrisp host process launched.');
    expect(launchEvent?.payload).toMatchObject({
      command: process.execPath,
      configuredBy: 'env_root'
    });
    expect(JSON.stringify(launchEvent?.payload)).toContain('--workspace-context');
    expect(JSON.stringify(launchEvent?.payload)).not.toContain('beale-skeptical-triage');
    expect(JSON.stringify(launchEvent?.payload)).not.toContain('--repo-root');
    expect(JSON.stringify(launchEvent?.payload)).not.toContain('--file-read-root');
    const launchArgs = (launchEvent?.payload as { args?: string[] } | undefined)?.args ?? [];
    expect(launchArgs).toContain('--shell-options');
    expect(launchArgs).toContain('shell');
    expect(launchArgs).toContain('--no-default-tool-config');
    expect(launchArgs).toContain('repository-search');
    expect(launchArgs).toContain('file-read');
    expect(launchArgs).toContain('code');
    expect(existsSync(join(workspace, '.beale', 'honeycrisp-skills', 'beale-skeptical-triage', 'SKILL.md'))).toBe(false);
    const workspaceContextPath = (launchEvent?.payload as { workspaceContextPath?: string } | undefined)?.workspaceContextPath ?? '';
    const workspaceContext = JSON.parse(readFileSync(workspaceContextPath, 'utf8')) as {
      authorization?: { recorded?: boolean; source?: string; scopeName?: string; networkProfile?: string };
      materializedSourcePaths?: string[];
      knownRepositories?: Array<{ rootPath: string; contentRoots?: string[] }>;
      projectNotes?: string[];
      memoryTierContext?: { sessionId?: string; workspaceId?: string; workspaceName?: string; subjectId?: string; subjectName?: string };
    };
    expect(workspaceContext.materializedSourcePaths).toContain(nestedSourceRoot);
    expect(workspaceContext.authorization).toMatchObject({
      recorded: true,
      source: 'beale',
      scopeName: 'ZSH Fixture',
      networkProfile: 'offline'
    });
    expect(workspaceContext.memoryTierContext).toMatchObject({
      sessionId: runId,
      workspaceName: 'ZSH Fixture',
      subjectName: 'Apple Security Bounty',
    });
    expect(workspaceContext.memoryTierContext?.workspaceId).toBeTruthy();
    expect(workspaceContext.memoryTierContext?.subjectId).toMatch(/^subject_/);
    expect(workspaceContext.materializedSourcePaths).not.toContain(workspace);
    expect(workspaceContext.knownRepositories?.some((repository) => repository.rootPath === nestedSourceRoot)).toBe(true);
    expect(workspaceContext.knownRepositories?.find((repository) => repository.rootPath === nestedSourceRoot)?.contentRoots).toEqual([nestedContentRoot]);
    expect(workspaceContext.projectNotes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Authorization:/),
        expect.stringContaining('Scope: ZSH Fixture'),
        expect.stringContaining('Rules and constraints: Use local context provided by the operator.'),
        'Network access profile: offline',
        expect.stringContaining(`In scope (path, internal): ${nestedSourceRoot}`),
        expect.stringContaining('Out of scope (domain, internal): excluded.example.test'),
        expect.stringContaining('In scope (credential_ref, internal): [host-held credential reference; value withheld from agent context]')
      ])
    );
    expect(JSON.stringify(workspaceContext)).not.toContain(credentialReferencePath);
    expect(detail.modelSessions[0]?.metadata.latestContextUsageSource).toBe('Honeycrisp serialized capture estimate');
    expect(Number(detail.modelSessions[0]?.metadata.latestReportedInputTokens)).toBeGreaterThan(0);
    expect(detail.traceEvents.some((event) => event.summary.includes('node cli fixture stdout'))).toBe(true);
    expect(detail.traceEvents.find((event) => event.summary === 'Honeycrisp model turn 1 completed.')?.payload.usage).toMatchObject({
      input_tokens: 123,
      output_tokens: 45,
      total_tokens: 168,
      estimated: false
    });
    expect(detail.transcriptMessages.some((message) => message.source === 'honeycrisp' && message.contentMarkdown.includes('Node CLI fixture done.'))).toBe(true);
    service.close();
  });

  it('uses the global database instead of peer database references for same-subject workspaces', async () => {
    const zshWorkspace = tempWorkspace();
    const mdnsWorkspace = tempWorkspace();
    const fakeHoneycrisp = join(mdnsWorkspace, 'fake-subject-peer-honeycrisp.mjs');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { dirname } from 'node:path';",
        'const args = process.argv.slice(2);',
        "const capturePath = args[args.indexOf('--capture') + 1];",
        "const contextPath = args[args.indexOf('--workspace-context') + 1];",
        "const context = JSON.parse(readFileSync(contextPath, 'utf8'));",
        "mkdirSync(dirname(capturePath), { recursive: true });",
        "writeFileSync(capturePath, JSON.stringify({ schemaVersion: 4, capturedAt: new Date().toISOString(), request: { prompt: 'Subject peer fixture' }, agent: { id: 'agent_subject_peer', status: 'complete', executorName: 'subject-peer-fixture', outputText: 'Subject peer visible.' }, eventTimeline: [] }) + '\\n');"
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp]);

    const service = new WorkspaceService();
    service.createWorkspace(zshWorkspace);
    service.saveScope({
      workspaceName: 'Zsh',
      scopeOwner: 'Apple',
      descriptionMarkdown: 'Authorized Zsh research.',
      rulesMarkdown: 'Local source only.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: []
    });
    service.createWorkspace(mdnsWorkspace);
    service.saveScope({
      workspaceName: 'mDNSResponder',
      scopeOwner: 'Apple',
      descriptionMarkdown: 'Authorized mDNSResponder research.',
      rulesMarkdown: 'Local source only.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: []
    });
    const snapshot = service.startRun({
      ...runInput('adaptive_portfolio'),
      runEngine: 'honeycrisp',
      promptMarkdown: 'Inspect interactions with related Apple components.'
    });
    const runId = snapshot.runs[0]?.run.id ?? '';
    await waitForCondition(() => ['completed', 'failed', 'stopped'].includes(service.getRunDetail(runId).run.status), 5000);

    const runDetail = service.getRunDetail(runId);
    expect(runDetail.run.status, JSON.stringify(runDetail.traceEvents.map((event) => ({ summary: event.summary, payload: event.payload })))).toBe('completed');
    const launch = runDetail.traceEvents.find((event) => event.summary === 'Honeycrisp host process launched.');
    const contextPath = (launch?.payload as { workspaceContextPath?: string } | undefined)?.workspaceContextPath ?? '';
    const context = JSON.parse(readFileSync(contextPath, 'utf8')) as {
      memoryTierContext?: { workspaceId?: string; subjectName?: string };
    };
    expect(context.memoryTierContext).toMatchObject({ workspaceId: expect.any(String), subjectName: 'Apple' });
    service.close();
  });

  it('materializes explicitly referenced run repositories before Honeycrisp starts', async () => {
    const workspace = tempWorkspace();
    const repositoryStore = join(tempWorkspace(), 'repositories');
    const fakeGit = join(workspace, 'fake-git-run-source.mjs');
    const fakeHoneycrisp = join(workspace, 'fake-honeycrisp-run-source.mjs');
    writeFileSync(
      fakeGit,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        "if (args.includes('clone')) { mkdirSync(`${args.at(-1)}/.git`, { recursive: true }); process.exit(0); }",
        "if (args.includes('rev-parse') && args.at(-1) === 'HEAD') { process.stdout.write('0123456789abcdef0123456789abcdef01234567\\n'); process.exit(0); }",
        'process.exit(1);'
      ].join('\n')
    );
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { dirname } from 'node:path';",
        'const args = process.argv.slice(2);',
        "const capturePath = args[args.indexOf('--capture') + 1];",
        "const contextPath = args[args.indexOf('--workspace-context') + 1];",
        "const context = JSON.parse(readFileSync(contextPath, 'utf8'));",
        "if (context.authorization?.recorded !== true) throw new Error('recorded scope missing');",
        "if (!context.knownRepositories?.some((repository) => repository.repositoryUrl === 'https://github.com/apple-oss-distributions/zsh')) throw new Error('repository reference missing');",
        'mkdirSync(dirname(capturePath), { recursive: true });',
        "writeFileSync(capturePath, JSON.stringify({ schemaVersion: 4, capturedAt: new Date().toISOString(), request: { prompt: 'Prepare source' }, agent: { id: 'agent_source_fixture', status: 'complete', executorName: 'source-fixture', outputText: 'Source ready.' }, eventTimeline: [] }) + '\\n');"
      ].join('\n')
    );
    chmodSync(fakeGit, 0o700);
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_GIT_COMMAND = fakeGit;
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp]);

    const service = new WorkspaceService(() => undefined, { repositoryStoreDirectory: repositoryStore });
    service.createWorkspace(workspace);
    service.saveScope({
      workspaceName: 'Zsh',
      scopeOwner: 'Apple',
      descriptionMarkdown: 'Authorized local source research.',
      rulesMarkdown: 'Do not access live targets.',
      networkProfile: 'elevated',
      expiresAt: null,
      assets: []
    });

    const snapshot = await service.startRunWithSourcePreparation({
      ...runInput('adaptive_portfolio'),
      runEngine: 'honeycrisp',
      networkProfile: 'elevated',
      promptMarkdown:
        'Materialize https://github.com/apple-oss-distributions/zsh and inspect the ZFTP module using local source only.'
    });
    const runId = snapshot.runs[0]?.run.id ?? '';
    await waitForCondition(() => service.getRunDetail(runId).run.status === 'completed', 5000);

    const activeScope = service.getSnapshot()?.activeScope;
    const localSource = activeScope?.assets.find(
      (asset) => asset.attributes?.sourceStorage === 'user_global' && asset.attributes?.repositoryUrl === 'https://github.com/apple-oss-distributions/zsh'
    );
    expect(localSource?.value).toBe(join(repositoryStore, 'github.com_apple-oss-distributions_zsh', 'default'));
    expect(activeScope?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://github.com/apple-oss-distributions/zsh'
        })
      ])
    );
    service.close();
  });

  it('loads Skills and MCP Servers from Honeycrisp tools list', () => {
    const workspace = tempWorkspace();
    const fakeHoneycrisp = join(workspace, 'fake-honeycrisp-tools.mjs');
    const argsPath = join(workspace, 'tooling-args.json');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { writeFileSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        "if (args[0] !== 'tools' || args[1] !== 'list') throw new Error(`unexpected command ${args.join(' ')}`);",
        "if (!args.includes('--workspace-root')) throw new Error('missing workspace root');",
        "if (!args.includes('--json')) throw new Error('missing json flag');",
        "writeFileSync(process.env.BEALE_TOOLING_ARGS_PATH, JSON.stringify(args));",
        'console.log("$ fake honeycrisp tools list");',
        'console.log(JSON.stringify({',
        '  toolConfig: {',
        '    configPath: "/workspace/.honeycrisp/tools.json",',
        '    exists: true,',
        '    loaded: true,',
        '    defaultDisabled: false,',
        '    preference: { skillDirs: ["/skills"], selectedSkillIds: ["parser-vuln"], mcpConfigPath: "/tmp/mcp.json", allowedMcpServers: ["local"], mcpTimeoutMs: 30000 }',
        '  },',
        '  tools: [{ name: "repository.search", transportName: "repository_search", actionClasses: ["search"], sideEffects: ["read"], requiredPermissions: ["filesystem:read"], metadata: { family: "repository-search" } }],',
        '  toolFamilies: { enabled: ["repository-search"], requested: ["repository-search"], disabled: [] },',
        '  skills: {',
        '    loaded: [',
        '      { id: "parser-vuln", version: "0.1", description: "Parser research", domainTags: ["parser"], source: { kind: "local", uri: "/skills/parser" } }',
        '    ],',
        '    selectedIds: ["parser-vuln"]',
        '  },',
        '  mcp: {',
        '    status: "configured",',
        '    configPath: "/tmp/mcp.json",',
        '    configuredServers: ["local"],',
        '    allowedServers: ["local"],',
        '    timeoutMs: 30000,',
        '    discoveredCapabilities: [{ name: "mcp.local.search", transportName: "mcp_local_search", actionClasses: ["search"], sideEffects: ["read"], requiredPermissions: ["mcp:local:tool:search"], metadata: { serverName: "local" } }],',
        '    deniedCapabilities: [{ serverName: "other", name: "blocked" }],',
        '    resourceTemplates: [{ serverName: "local", uriTemplate: "mcp://local/{id}" }]',
        '  }',
        '}));'
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp]);
    process.env.BEALE_HONEYCRISP_RUNTIME_ARGS_JSON = JSON.stringify([
      '--skill-dir',
      '/skills',
      '--skill',
      'parser-vuln',
      '--mcp-config',
      '/tmp/mcp.json',
      '--allow-mcp-server',
      'local'
    ]);
    process.env.BEALE_TOOLING_ARGS_PATH = argsPath;

    const service = new WorkspaceService();
    service.createWorkspace(workspace);

    const summary = service.getHoneycrispToolingSummary();
    const args = JSON.parse(readFileSync(argsPath, 'utf8')) as string[];

    expect(args).toContain('tools');
    expect(args).toContain('list');
    expect(args).toContain('--workspace-root');
    expect(args[args.indexOf('--workspace-root') + 1]).toBe(workspace);
    expect(args).toContain('--skill-dir');
    expect(args).toContain('--mcp-config');
    const skillDirs = args.flatMap((arg, index) => (arg === '--skill-dir' ? [args[index + 1]] : []));
    const selectedSkills = args.flatMap((arg, index) => (arg === '--skill' ? [args[index + 1]] : []));
    expect(skillDirs).toContain('/skills');
    expect(selectedSkills).toContain('parser-vuln');
    expect(summary.skills.loaded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'parser-vuln',
          version: '0.1',
          selected: true,
          domainTags: ['parser']
        })
      ])
    );
    expect(summary.mcp).toMatchObject({
      status: 'configured',
      allowedServers: ['local'],
      configuredServers: ['local']
    });
    expect(summary.config).toMatchObject({
      configPath: '/workspace/.honeycrisp/tools.json',
      exists: true,
      preference: {
        skillDirs: ['/skills'],
        selectedSkillIds: ['parser-vuln'],
        mcpConfigPath: '/tmp/mcp.json',
        allowedMcpServers: ['local'],
        mcpTimeoutMs: 30000
      }
    });
    expect(summary.mcp.discoveredCapabilities[0]).toMatchObject({
      name: 'mcp.local.search',
      transportName: 'mcp_local_search',
      actionClasses: ['search']
    });
    expect(summary.mcp.deniedCapabilities).toHaveLength(1);
    expect(summary.mcp.resourceTemplates).toHaveLength(1);
    service.close();
  });

  it('updates Honeycrisp Skills and MCP configuration through Honeycrisp CLI', () => {
    const workspace = tempWorkspace();
    const fakeHoneycrisp = join(workspace, 'fake-honeycrisp-tools-config.mjs');
    const callsPath = join(workspace, 'tooling-config-calls.jsonl');
    writeFileSync(
      fakeHoneycrisp,
      [
        '#!/usr/bin/env node',
        "import { appendFileSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        'appendFileSync(process.env.BEALE_TOOLING_ARGS_PATH, `${JSON.stringify(args)}\\n`);',
        "if (args[0] === 'tools' && args[1] === 'config') {",
        '  console.log(JSON.stringify({ configPath: "/workspace/.honeycrisp/tools.json", exists: true, preference: { skillDirs: ["/skills/new"] } }));',
        '  process.exit(0);',
        '}',
        "if (args[0] === 'tools' && args[1] === 'list') {",
        '  console.log(JSON.stringify({',
        '    toolConfig: { configPath: "/workspace/.honeycrisp/tools.json", exists: true, loaded: true, defaultDisabled: false, preference: { skillDirs: ["/skills/new"], selectedSkillIds: [], allowedMcpServers: [] } },',
        '    tools: [],',
        '    toolFamilies: { enabled: [], requested: [], disabled: [] },',
        '    skills: { loaded: [], selectedIds: [] },',
        '    mcp: { status: "not_configured", allowedServers: [], discoveredCapabilities: [] }',
        '  }));',
        '  process.exit(0);',
        '}',
        'throw new Error(`unexpected command ${args.join(" ")}`);'
      ].join('\n')
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp]);
    process.env.BEALE_TOOLING_ARGS_PATH = callsPath;

    const service = new WorkspaceService();
    service.createWorkspace(workspace);

    const summary = service.updateHoneycrispToolingConfig({ type: 'add_skill_dir', path: '/skills/new' });
    const calls = readFileSync(callsPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);

    expect(calls[0]).toEqual(['tools', 'config', 'add', 'skill-dir', '/skills/new', '--workspace-root', workspace, '--json']);
    expect(calls[1]?.slice(0, 4)).toEqual(['tools', 'list', '--workspace-root', workspace]);
    expect(calls[1]).toEqual(expect.arrayContaining(['--tool-family', 'shell', '--shell-options', '--no-default-tool-config', '--json']));
    expect(summary.config.preference.skillDirs).toEqual(['/skills/new']);
    service.close();
  });

  it('isolates default workspace registry writes when the registry directory override is set', () => {
    const workspace = tempWorkspace();
    const registryDir = process.env.BEALE_WORKSPACE_REGISTRY_DIR ?? '';
    expect(registryDir).toBeTruthy();

    const service = new WorkspaceService();
    service.createWorkspace(workspace);
    service.getWorkspaceRegistryState();

    expect(existsSync(join(registryDir, 'workspace-registry.sqlite'))).toBe(true);
    const registry = new DatabaseSync(join(registryDir, 'workspace-registry.sqlite'));
    const rows = registry.prepare('SELECT workspace_name, workspace_path FROM workspaces').all() as Array<{ workspace_name: string; workspace_path: string }>;
    registry.close();
    expect(rows).toEqual([{ workspace_name: 'Untitled Workspace', workspace_path: workspace }]);
    service.close();
  });

  it('does not open the incompatible pre-workspace registry database', () => {
    const registryDir = tempWorkspace();
    const legacyRegistryPath = join(registryDir, 'registry.sqlite');
    const legacyRegistry = new DatabaseSync(legacyRegistryPath);
    legacyRegistry.exec(`
      CREATE TABLE research_sessions (
        id TEXT PRIMARY KEY,
        program_id TEXT,
        workspace_path TEXT NOT NULL,
        run_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacyRegistry.close();

    const service = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });
    const state = service.getWorkspaceRegistryState();

    expect(state.registryPath).toBe(join(registryDir, 'workspace-registry.sqlite'));
    expect(state.workspaces).toEqual([]);
    expect(state.researchSessions).toEqual([]);
    expect(existsSync(legacyRegistryPath)).toBe(true);
    service.close();
  });

  it('persists developer mode and profiling diagnostics settings', () => {
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });

    expect(service.getDeveloperSettings()).toEqual({ developerModeEnabled: false });
    expect(service.getShellOptions()).toEqual({ defaultConcurrency: 4, utilities: { sudo: 0 } });
    expect(service.getProfilingState().enabled).toBe(false);

    expect(service.setDeveloperModeEnabled(true)).toEqual({ developerModeEnabled: true });
    expect(service.setShellOptions({ defaultConcurrency: 3, utilities: { sudo: 0, clang: 2 } })).toEqual({
      defaultConcurrency: 3,
      utilities: { sudo: 0, clang: 2 }
    });
    const shellOptionsFile = JSON.parse(readFileSync(join(registryDir, 'shell-options.json'), 'utf8')) as Record<string, unknown>;
    expect(shellOptionsFile).toMatchObject({
      schemaVersion: 1,
      defaultConcurrency: 3,
      utilities: { sudo: 0, clang: 2 },
      leaseDirectory: join(registryDir, 'shell-leases')
    });
    expect(service.getProfilingState().enabled).toBe(true);
    service.close();

    const reopened = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });
    expect(reopened.getDeveloperSettings()).toEqual({ developerModeEnabled: true });
    expect(reopened.getShellOptions()).toEqual({ defaultConcurrency: 3, utilities: { sudo: 0, clang: 2 } });
    expect(reopened.getProfilingState().enabled).toBe(true);
    expect(reopened.setDeveloperModeEnabled(false)).toEqual({ developerModeEnabled: false });
    expect(reopened.getProfilingState().enabled).toBe(false);
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

    const response = service.searchSessionTranscripts({ query: 'fixture workbench', limit: 5 });
    expect(response.totalTranscriptMatches).toBe(1);
    expect(response.workspaceCount).toBe(1);
    expect(response.workspaces[0]).toMatchObject({
      workspaceName: 'Untitled Workspace',
      totalTranscriptMatches: 1
    });
    expect(response.results[0]).toMatchObject({
      runId,
      role: 'user',
      source: 'run_prompt'
    });
    expect(response.results[0].contentPreview).toContain('fixture workbench');
    expect(service.searchSessionTranscripts({ query: 'not-present-in-session-transcripts' })).toEqual({
      results: [],
      totalTranscriptMatches: 0,
      workspaceCount: 0,
      workspaces: []
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
    expect(response.workspaceCount).toBe(1);
    expect(response.workspaces[0]).toMatchObject({
      workspaceName: 'Untitled Workspace',
      totalTranscriptMatches: 2
    });
    service.close();
  });

  it('searches the current workspace by default and can opt into loaded workspaces', () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });

    service.createScopedWorkspace({
      workspacePath: firstWorkspace,
      workspaceName: 'First Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'First persisted workspace.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.startRun({ ...runInput('source_logic_bug'), promptMarkdown: '# First\nsharedneedle first transcript.' }, 'complete');
    service.createScopedWorkspace({
      workspacePath: secondWorkspace,
      workspaceName: 'Second Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'Second persisted workspace.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.startRun({ ...runInput('source_logic_bug'), promptMarkdown: '# Second\nsharedneedle second transcript.' }, 'complete');

    const currentOnly = service.searchSessionTranscripts({ query: 'sharedneedle', limit: 10 });
    expect(currentOnly.totalTranscriptMatches).toBe(1);
    expect(currentOnly.workspaceCount).toBe(1);
    expect(currentOnly.workspaces).toHaveLength(1);
    expect(currentOnly.workspaces[0]).toMatchObject({
      workspaceName: 'Second Workspace',
      totalTranscriptMatches: 1
    });
    expect(new Set(currentOnly.results.map((result) => result.workspaceName))).toEqual(new Set(['Second Workspace']));

    const acrossLoaded = service.searchSessionTranscripts({ query: 'sharedneedle', limit: 10, currentWorkspaceOnly: false });
    expect(acrossLoaded.totalTranscriptMatches).toBe(2);
    expect(acrossLoaded.workspaceCount).toBe(2);
    expect(new Map(acrossLoaded.workspaces.map((workspace) => [workspace.workspaceName, workspace.totalTranscriptMatches]))).toEqual(
      new Map([
        ['First Workspace', 1],
        ['Second Workspace', 1]
      ])
    );
    expect(new Set(acrossLoaded.results.map((result) => result.workspaceName))).toEqual(new Set(['First Workspace', 'Second Workspace']));
    expect(acrossLoaded.results.every((result) => result.workspacePath === firstWorkspace || result.workspacePath === secondWorkspace)).toBe(true);
    service.close();
  });

  it('keeps workspace sidebar order stable when workspaces are opened', () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });

    service.createScopedWorkspace({
      workspacePath: firstWorkspace,
      workspaceName: 'First Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'First persisted workspace.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.createScopedWorkspace({
      workspacePath: secondWorkspace,
      workspaceName: 'Second Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'Second persisted workspace.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });

    const initialOrder = service.getWorkspaceRegistryState().workspaces.map((workspace) => workspace.id);
    const firstRegisteredWorkspace = service.getWorkspaceRegistryState().workspaces.find((workspace) => workspace.workspaceName === 'First Workspace');
    expect(firstRegisteredWorkspace).toBeTruthy();
    service.openRegisteredWorkspace(firstRegisteredWorkspace?.id ?? '');
    expect(service.getWorkspaceRegistryState().workspaces.map((workspace) => workspace.id)).toEqual(initialOrder);
    service.close();
  });

  it('keeps active research sessions running when another workspace is opened', async () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });

    service.createScopedWorkspace({
      workspacePath: firstWorkspace,
      workspaceName: 'First Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'First persisted workspace.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    const firstRegisteredWorkspace = service.getWorkspaceRegistryState().workspaces.find((workspace) => workspace.workspaceName === 'First Workspace');
    const activeSnapshot = service.startRun(runInput('source_logic_bug'), 'scheduled');
    const runId = activeSnapshot.runs[0]?.run.id ?? '';
    const initialTraceCount = service.getRunDetail(runId).traceEvents.length;

    service.createScopedWorkspace({
      workspacePath: secondWorkspace,
      workspaceName: 'Second Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'Second persisted workspace.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    expect(service.getSnapshot()?.activeScope.workspaceName).toBe('Second Workspace');

    await new Promise<void>((resolve) => setTimeout(resolve, 950));
    const backgroundSession = service.getWorkspaceRegistryState().researchSessions.find((session) => session.runId === runId);
    expect(backgroundSession?.status).toBe('active');

    service.openRegisteredWorkspace(firstRegisteredWorkspace?.id ?? '');
    const detail = service.getRunDetail(runId);
    expect(detail.run.status).toBe('active');
    expect(detail.traceEvents.length).toBeGreaterThan(initialTraceCount);
    expect(detail.traceEvents.some((event) => event.summary === 'Workspace recovery paused interrupted run after app restart.')).toBe(false);
    service.close();
  });

  it('materializes onboarding repositories marked for immediate indexing', async () => {
    const workspace = tempWorkspace();
    const fakeGit = join(workspace, 'fake-git-onboarding.mjs');
    writeFileSync(
      fakeGit,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        "if (args.includes('clone')) {",
        '  const target = args.at(-1);',
        "  mkdirSync(`${target}/.git`, { recursive: true });",
        "  mkdirSync(`${target}/src`, { recursive: true });",
        "  writeFileSync(`${target}/src/index.js`, 'export const vulnerable = false;\\n');",
        '  process.exit(0);',
        '}',
        "if (args.includes('rev-parse') && args.at(-1) === 'HEAD') {",
        '  process.stdout.write("0123456789abcdef0123456789abcdef01234567\\n");',
        '  process.exit(0);',
        '}',
        'process.exit(1);'
      ].join('\n')
    );
    chmodSync(fakeGit, 0o700);
    process.env.BEALE_GIT_COMMAND = fakeGit;
    const service = new WorkspaceService();
    const progressUpdates: WorkspaceOnboardingProgressUpdate[] = [];

    service.createScopedWorkspace(
      {
        workspacePath: workspace,
        workspaceName: 'Onboarding Source Workspace',
        scopeOwner: 'Example Org',
        descriptionMarkdown: 'Onboarding should clone selected repositories.',
        rulesMarkdown: 'Offline source review.',
        networkProfile: 'offline',
        expiresAt: null,
        onboardingRequestId: 'onboarding-index-now-test',
        assets: [
          {
            direction: 'in_scope',
            kind: 'repo',
            value: 'https://github.com/Netflix/zuul',
            sensitivity: 'public',
            attributes: { bealeOnboardingIndexNow: true }
          }
        ]
      },
      (update) => {
        progressUpdates.push(update);
      }
    );

    await waitForCondition(() => service.getSnapshot()?.activeScope.assets.some((asset) => String(asset.value).includes('github.com_Netflix_zuul')) ?? false);
    await waitForCondition(() => progressUpdates.at(-1)?.phase === 'complete', 5000);

    const snapshot = service.getSnapshot();
    const completedProgress = progressUpdates.at(-1);
    const sourceReference = snapshot?.activeScope.assets.find((asset) => String(asset.value).includes('github.com_Netflix_zuul'));
    expect(sourceReference?.value).toContain(join(process.env.BEALE_WORKSPACE_REGISTRY_DIR ?? '', 'repositories'));
    expect(sourceReference?.attributes).toMatchObject({
      sourceStorage: 'user_global',
      sourceReferenceVersion: 1,
      repositoryUrl: 'https://github.com/Netflix/zuul'
    });
    expect(completedProgress?.repositories[0]).toMatchObject({ stage: 'indexed' });
    expect(progressUpdates.some((update) => update.repositories.some((repository) => repository.stage === 'indexing'))).toBe(false);
    expect(snapshot?.projectSemantic).toMatchObject({ enabled: false, status: 'disabled' });
    service.close();
  });

  it('does not broadcast full workspace snapshots for active trace-only runtime updates', async () => {
    const workspace = tempWorkspace();
    const changes: boolean[] = [];
    const service = new WorkspaceService((change) => changes.push(change.workspaceRegistryChanged));

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

  it('removes workspaces from the global registry without deleting workspaces', () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });

    service.createScopedWorkspace({
      workspacePath: firstWorkspace,
      workspaceName: 'First Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'First persisted workspace.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.createScopedWorkspace({
      workspacePath: secondWorkspace,
      workspaceName: 'Second Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'Second persisted workspace.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });

    const secondRegisteredWorkspace = service.getWorkspaceRegistryState().workspaces.find((workspace) => workspace.workspaceName === 'Second Workspace');
    expect(secondRegisteredWorkspace).toBeTruthy();
    expect(service.removeRegisteredWorkspace(secondRegisteredWorkspace?.id ?? '')).toBeNull();
    expect(service.getSnapshot()).toBeNull();
    expect(existsSync(secondWorkspace)).toBe(true);

    const remaining = service.getWorkspaceRegistryState().workspaces;
    expect(remaining.map((workspace) => workspace.workspaceName)).toEqual(['First Workspace']);
    expect(service.openRegisteredWorkspace(remaining[0]?.id ?? '').activeScope.workspaceName).toBe('First Workspace');
    service.close();
  });

  it('reopens the last known workspace and skips missing workspaces gracefully', () => {
    const firstWorkspace = tempWorkspace();
    const secondWorkspace = tempWorkspace();
    const registryDir = tempWorkspace();
    const service = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });

    service.createScopedWorkspace({
      workspacePath: firstWorkspace,
      workspaceName: 'First Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'First persisted workspace.',
      rulesMarkdown: 'First rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.createScopedWorkspace({
      workspacePath: secondWorkspace,
      workspaceName: 'Second Workspace',
      scopeOwner: '',
      descriptionMarkdown: 'Second persisted workspace.',
      rulesMarkdown: 'Second rules.',
      networkProfile: 'offline',
      expiresAt: null
    });
    service.dispose();

    const reopened = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });
    const restored = reopened.openLastWorkspaceIfAvailable();
    expect(restored?.activeScope.workspaceName).toBe('Second Workspace');
    expect(reopened.getSnapshot()?.workspace.workspacePath).toBe(secondWorkspace);
    reopened.dispose();

    rmSync(secondWorkspace, { recursive: true, force: true });
    const missing = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });
    expect(missing.openLastWorkspaceIfAvailable()).toBeNull();
    expect(missing.getSnapshot()).toBeNull();
    expect(missing.getWorkspaceRegistryState().workspaces.some((workspace) => workspace.workspacePath === secondWorkspace)).toBe(true);
    missing.dispose();
  });

  it('looks up HackerOne scope metadata and imports public structured scope', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-hackerone-import-review';
    const modelRequests: Record<string, unknown>[] = [];
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: tempWorkspace(),
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
                  total_count: 3,
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
                    },
                    {
                      asset_type: 'SOURCE_CODE',
                      asset_identifier: 'https://github.com/github/securitylab',
                      instruction: 'In-scope public repository.',
                      eligible_for_bounty: true,
                      eligible_for_submission: true,
                      max_severity: 'high',
                      url: 'https://hackerone.com/github/asset/3'
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
        expect(request.model).toBe('gpt-5.6-sol');
        expect(request.tools).toEqual([]);
        expect(request.reasoning).toEqual({ effort: 'medium' });
        expect(JSON.stringify(request)).toContain('github.com');
        expect(JSON.stringify(request)).toContain('Third-party services');
        const review = {
          workspaceName: 'GitHub',
          scopeOwner: 'GitHub',
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

    const lookup = await service.lookupHackerOneScope('https://hackerone.com/github');
    expect(lookup).toMatchObject({
      handle: 'github',
      sourceUrl: 'https://hackerone.com/github',
      workspaceName: 'GitHub',
      scopeOwner: 'GitHub',
      descriptionMarkdown: 'Authorized research under the GitHub Security Bounty workspace on HackerOne.',
      networkProfile: 'elevated',
      importedScopeCount: 3
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
        }),
        expect.objectContaining({
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://github.com/github/securitylab',
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
      workspaceRegistryDirectory: tempWorkspace(),
      hackerOneFetch: async () => {
        requestedHackerOne = true;
        return new Response('{}', { status: 200 });
      }
    });

    await expect(service.lookupHackerOneScope('github')).rejects.toThrow(/Authenticate with OpenAI first/);
    expect(requestedHackerOne).toBe(false);
    expect(() =>
      service.createScopedWorkspace({
        workspacePath: tempWorkspace(),
        workspaceName: 'GitHub',
        scopeOwner: 'GitHub',
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
      workspaceRegistryDirectory: tempWorkspace(),
      hackerOneFetch: async () => hackerOneWorkspaceResponse(),
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

    await expect(service.lookupHackerOneScope('github')).rejects.toThrow(/Responses API write scope.*BEALE_OPENAI_ACCESS_TOKEN.*OPENAI_API_KEY/);
    service.close();
  });

  it('generates a recommended research prompt from workspace scope and prior research', async () => {
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
        expect(serialized).toContain('Kernel Audit Workspace');
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
        expect(serialized).toContain('\\"sandboxProfile\\": \\"host\\"');
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
    service.saveScope({
      workspaceName: 'Kernel Audit Workspace',
      scopeOwner: 'Kernel Org',
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
      sandboxProfile: 'host',
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
      sandboxProfile: 'host',
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
        sandboxProfile: 'host',
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
      sandboxProfile: 'host',
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
        sandboxProfile: 'host',
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

    const snapshot = service.saveScope({
      workspaceName: 'Example Bug Bounty',
      scopeOwner: 'Example Org',
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
    expect(snapshot.activeScope.workspaceName).toBe('Example Bug Bounty');
    expect(snapshot.activeScope.networkProfile).toBe('scoped');
    expect(snapshot.activeScope.assets).toHaveLength(4);
    expect(snapshot.activeScope.assets.map((item) => item.value)).toContain('admin.example.test');

    service.close();
    const reopened = service.openWorkspace(snapshot.workspace.workspacePath);
    expect(reopened.activeScope.version).toBe(2);
    expect(reopened.activeScope.assets).toHaveLength(4);
    service.close();
  });

  it('records a deterministic fixture run graph that replays from persisted state', () => {
    const service = openService();
    service.saveScope({
      workspaceName: 'Parser Workspace',
      scopeOwner: 'Example Org',
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
    expect(detail.vmContexts[0].backend).toBe('fixture');
    expect(snapshot.runs[0].attemptCount).toBeGreaterThan(1);
    expect(snapshot.runs[0].engine).toBe('fixture');

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
        triggerStepsMarkdown: 'Run the edited verifier trigger through host execution.',
        expectedObservations: { stdout: 'edited verifier output' }
      }
    });
    service.steerRun({ type: 'review_verifier_contract', runId, verifierContractId: contract?.id ?? '', decision: 'approved', note: 'secret=approvesecret12345' });
    service.steerRun({ type: 'mark_disclosure_ready', runId, findingId: finding?.id ?? '', note: 'ready for report draft' });
    service.steerRun({ type: 'mark_needs_more_evidence', runId, findingId: finding?.id ?? '', note: 'api_key=evidencesecret12345' });
    service.steerRun({ type: 'export_finding_bundle', runId, findingId: finding?.id, note: 'token=findingsecret12345' });
    service.steerRun({ type: 'export_redacted_trace', runId, findingId: finding?.id, note: 'api_key=tracesecret12345' });
    service.steerRun({ type: 'generate_report_draft', runId, findingId: finding?.id, note: 'password=reportsecret12345' });
    service.steerRun({ type: 'preserve_vm', runId, reason: 'Preserve host execution record for review.' });
    service.steerRun({ type: 'destroy_vm', runId, reason: 'Close host execution record after review.' });

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
    expect(detail.traceEvents.some((event) => event.summary === 'Host process execution record refreshed by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Verifier contract approved by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Finding marked disclosure ready by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Finding marked as needing more evidence by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Finding bundle export created.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Redacted trace export created.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Report draft export created.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Host execution record preserved by explicit request.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Host execution record closed.')).toBe(true);

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
    const db = new WorkspaceDatabase(globalDatabasePath(), artifactRoot, { workspacePath: dir });
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
      sandboxProfile: 'host',
      budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'honeycrisp' }
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

  it('executes verifier contracts on the host before allowing verified findings', () => {
    const dir = tempWorkspace();
    const artifactRoot = join(dir, '.beale', 'artifacts');
    const targetDir = join(dir, 'target');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'target.txt'), 'verifier target\n');
    const db = new WorkspaceDatabase(globalDatabasePath(), artifactRoot, { workspacePath: dir });
    db.initialize();
    db.saveScope({
      workspaceName: 'Verifier Workspace',
      scopeOwner: 'Example Org',
      descriptionMarkdown: 'Scoped verifier target.',
      rulesMarkdown: 'Host verifier only.',
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
      sandboxProfile: 'host',
      budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'honeycrisp' }
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
      setupStepsMarkdown: 'Prepare scoped target for host verifier execution.',
      triggerStepsMarkdown: 'Run the verifier script on the host.',
      expectedObservations: { stdout: 'verifier-ok' },
      invariants: { hostDatabaseMounted: false, openAiCredentialsMounted: false },
      artifactsToCollect: { verifierOutput: '/tmp/beale-output.txt' },
      passCriteria: {
        verifier: {
          operationKind: 'shell',
          script: 'echo verifier-ok | tee /tmp/beale-output.txt',
          expectedExitCode: 0,
          expectedStdoutIncludes: 'verifier-ok',
          artifactPath: '/tmp/beale-output.txt',
          timeoutMs: 30_000
        }
      }
    });
    db.updateAttemptState(context.attempt.id, 'completed', 'Prepared executable verifier contract.');
    db.updateRunStatus(context.run.id, 'completed', 'Prepared executable verifier contract.');
    db.close();

    const service = new WorkspaceService();
    service.openWorkspace(dir);
    service.steerRun({ type: 'rerun_verifier', runId: context.run.id, verifierContractId: contract.id, note: 'run real verifier' });
    let detail = service.getRunDetail(context.run.id);
    const realVerifierRun = detail.verifierRuns.at(-1);
    expect(realVerifierRun?.status).toBe('pass');
    expect(realVerifierRun?.result.realExecution).toBe(true);
    expect(realVerifierRun?.result.vmExecution).toBe(false);
    expect(realVerifierRun?.result.hostExecution).toBe(true);
    expect(detail.artifacts.some((artifact) => artifact.kind === 'verifier_output')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Verifier contract executed on host with pass.')).toBe(true);

    service.steerRun({ type: 'promote_hypothesis', runId: context.run.id, hypothesisId: hypothesis.id });
    detail = service.getRunDetail(context.run.id);
    const finding = detail.findings.at(-1);
    expect(finding?.state).toBe('verified');
    expect(finding?.verifiedByVerifierRunId).toBe(realVerifierRun?.id);
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
    service.saveScope({
      workspaceName: 'Backup Workspace',
      scopeOwner: 'Example Org',
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
    expect(listing).not.toContain('memory.sqlite');
    expect(backup?.manifest).toMatchObject({ databasePath: globalDatabasePath(), databaseIncluded: false });
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

function globalDatabasePath(): string {
  const registryDirectory = process.env.BEALE_WORKSPACE_REGISTRY_DIR;
  if (!registryDirectory) throw new Error('BEALE_WORKSPACE_REGISTRY_DIR is required for isolated workbench tests.');
  return join(registryDirectory, 'honeycrisp', 'memory.sqlite');
}

function hackerOneWorkspaceResponse(): Response {
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

async function waitForCondition(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  expect(check()).toBe(true);
}

function runInput(fixtureScenario: StartRunInput['fixtureScenario']): StartRunInput {
  return {
    runEngine: 'fixture',
    promptMarkdown: '# Test run\nExercise the fixture workbench path.',
    mode: 'open_discovery',
    attemptStrategy: 'adaptive_portfolio',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    networkProfile: 'offline',
    sandboxProfile: 'host',
    budget: {
      maxMinutes: 30,
      maxAttempts: 2,
      maxCostUsd: 0
    },
    fixtureScenario
  };
}

function sequence(length: number): number[] {
  return Array.from({ length }, (_value, index) => index + 1);
}
