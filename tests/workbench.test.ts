import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceOnboardingProgressUpdate, ScopeAssetKind, StartRunInput } from '@shared/types';
import { WorkspaceDatabase } from '../src/main/database';
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
  delete process.env.BEALE_WORKSPACE_REGISTRY_DIR;
  delete process.env.BEALE_TOOLING_ARGS_PATH;
  delete process.env.POC_SAVE_DIR;
  delete process.env.XDG_CACHE_HOME;
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
    expect(snapshot.activeScope.workspaceName).toBe('Untitled Workspace');
    expect(snapshot.openAi.credentialsHostOnly).toBe(true);
    expect(snapshot.openAi.readiness).toBe('not_configured');
    expect(snapshot.openAi.onboardingSteps.some((step) => step.id === 'secret_isolation')).toBe(true);
    expect(snapshot.projectSemantic).toMatchObject({ enabled: false, status: 'disabled', remoteEmbeddingEnabled: false });
    expect(snapshot.projectGraph).toMatchObject({ status: 'disabled', nodeCount: 0, edgeCount: 0 });
    expect(service.refreshOpenAiStatus().openAi.readiness).toBe('not_configured');
    expect(existsSync(join(dir, '.beale', 'beale.sqlite'))).toBe(true);
    expect(existsSync(join(dir, '.beale', 'artifacts', 'sha256'))).toBe(true);
    const schema = new DatabaseSync(join(dir, '.beale', 'beale.sqlite'));
    const benchmarkTables = schema
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('benchmark_runs', 'benchmark_task_results') ORDER BY name")
      .all();
    const scopeTable = schema.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scope_versions'").get();
    const removedSchemaTables = schema
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('program_scope_versions', 'schema_migrations') ORDER BY name")
      .all();
    const scopeColumns = (schema.prepare('PRAGMA table_info(scope_versions)').all() as Array<{ name: string }>).map((row) => row.name);
    schema.close();
    expect(benchmarkTables).toHaveLength(0);
    expect(scopeTable).toBeTruthy();
    expect(removedSchemaTables).toHaveLength(0);
    expect(scopeColumns).toEqual(expect.arrayContaining(['workspace_name', 'scope_owner']));
    expect(scopeColumns).not.toEqual(expect.arrayContaining(['program_name', 'organization_name']));

    const workspaceId = snapshot.workspace.workspaceId;
    service.close();

    const reopened = service.openWorkspace(dir);
    expect(reopened.workspace.workspaceId).toBe(workspaceId);
    expect(reopened.activeScope.version).toBe(1);
    service.close();
  });

  it('keeps disabled context graph state inert for workspace snapshots', () => {
    const dir = tempWorkspace();
    const service = new WorkspaceService();
    service.createWorkspace(dir);
    const runSnapshot = startRunForTest(service, runInput('source_logic_bug'));
    const runId = runSnapshot.runs[0]?.run.id;
    expect(runId).toBeTruthy();
    service.close();

    const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), join(dir, '.beale', 'artifacts'));
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
    const eventsPath = join(dir, '.honeycrisp', 'memory', 'events');
    mkdirSync(eventsPath, { recursive: true });

    expect(service.resolveHoneycrispMemoryDirectoryPath('events')).toBe(eventsPath);
    expect(() => service.resolveHoneycrispMemoryDirectoryPath('claims')).toThrow(/does not exist/);
    expect(() => service.resolveHoneycrispMemoryDirectoryPath('unknown' as never)).toThrow(/Unknown Honeycrisp memory directory/);
    service.close();
  });

  it('reads the latest compiled Honeycrisp context from the SQLite event log', () => {
    const dir = tempWorkspace();
    const service = new WorkspaceService();
    service.createWorkspace(dir);
    const snapshot = service.startRun(runInput('adaptive_portfolio'), 'complete');
    const runId = snapshot.runs[0]?.run.id ?? '';
    const memoryPath = join(dir, '.honeycrisp', 'memory', 'memory.sqlite');
    mkdirSync(dirname(memoryPath), { recursive: true });
    const memory = new DatabaseSync(memoryPath);
    memory.exec(`
      CREATE TABLE memory_events (
        sequence INTEGER PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        goal_id TEXT,
        loop_id TEXT,
        sub_goal_id TEXT,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        schema_version INTEGER NOT NULL
      )
    `);
    const payload = {
      activeSubGoalId: 'subgoal_latest',
      openQuestions: ['Where does parser input cross a trust boundary?'],
      selectedSkills: [{ id: 'maxtac-sast-surface-triage', name: 'Surface triage' }],
      toolPermissions: { allowedSideEffects: ['read'] },
      candidateToolActions: [{ toolName: 'repository.search', reason: 'Map parser entrypoints' }],
      skippedToolActions: [],
      storage: { databasePath: memoryPath }
    };
    memory
      .prepare(
        `INSERT INTO memory_events (
          sequence, event_id, timestamp, kind, goal_id, loop_id, sub_goal_id,
          payload_json, payload_hash, artifact_refs_json, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        7,
        'evt_context_fixture',
        '2026-06-25T12:00:00.000Z',
        'context.compiled',
        'goal_fixture',
        'loop_fixture',
        'subgoal_latest',
        JSON.stringify(payload),
        'hash_fixture',
        '[]',
        1
      );
    memory.close();

    const context = service.getAgentContext(runId);

    expect(context).toMatchObject({
      runId,
      source: 'honeycrisp_sqlite',
      status: 'ready',
      databasePath: memoryPath,
      event: {
        sequence: 7,
        eventId: 'evt_context_fixture',
        goalId: 'goal_fixture',
        subGoalId: 'subgoal_latest',
        payloadHash: 'hash_fixture',
        schemaVersion: 1
      }
    });
    expect(context.event?.payload).toMatchObject(payload);
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
    expect(existsSync(join(workspace, '.beale', 'beale.sqlite'))).toBe(true);

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
        "mkdirSync(dirname(capturePath), { recursive: true });",
        'const now = new Date().toISOString();',
        'const capture = {',
        '  schemaVersion: 1,',
        '  capturedAt: now,',
        "  goal: { id: 'goal_fixture', objective: 'Fixture Honeycrisp research', scopeConstraints: [], evidenceRequirements: [], riskFlags: [] },",
        "  decision: { actionClass: 'synthesize', subGoalId: 'subgoal_fixture', subGoalObjective: 'Run fixture', rationale: 'Test adapter' },",
        "  goalRun: { status: 'active', terminalReason: 'loop_limit', loopsUsed: 1, maxLoops: 1, safetyMaxLoops: 3, blockedThreshold: 3, consecutiveBlockedCount: 0, statusReason: 'The configured goal loop budget was reached before terminal proof.' },",
        '  loop: {',
        "    planId: 'loop_fixture',",
        "    resultId: 'loopresult_fixture',",
        "    status: 'complete',",
        "    executorName: 'fixture-honeycrisp',",
        "    executionMode: 'deterministic',",
        "    outputText: 'Fixture Honeycrisp answer.',",
        "    followUpRecommendation: 'respond',",
        "    followUpRationale: 'Fixture complete.',",
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
        '      evidenceLinks: [],',
        "      goalAssessment: { status: 'complete', rationale: 'Fixture goal satisfied.' }",
        '    },',
        '    raw: {',
        "      provider: 'fixture-provider',",
        "      model: 'fixture-model',",
        "      api: 'fixture-api',",
        "      stopReason: 'complete',",
        "      responseId: 'fixture-response',",
        '      usage: { input_tokens: 12345, output_tokens: 678, total_tokens: 13023 },',
        '      modelCalls: [{ usage: { input_tokens: 12345, output_tokens: 678, total_tokens: 13023 } }],',
        '      toolCallCount: 0,',
        '      plannedToolCallCount: 0',
        '    }',
        '  },',
        "  memoryIntegration: { enabled: true, databasePath: '/tmp/fixture-memory.sqlite', eventLogCount: 4, recordCount: 4, eventsAppended: 4, recordsWritten: 4, latestRetrievalCandidateCount: 1, usedMemoryDrivenController: true, usedFirstRunFallback: false },",
        "  storageManifest: { path: '/tmp/fixture-manifest.json', artifactCount: 0, artifacts: [] },",
        '  eventTimeline: [',
        "    { id: 'evt_goal', sequence: 1, timestamp: now, kind: 'goal.created', summary: 'Fixture goal created.', payload: { objective: 'fixture' } },",
        "    { id: 'evt_tool_call', sequence: 2, timestamp: now, kind: 'tool.requested', summary: 'Fixture tool requested.', payload: { toolName: 'repository.search' } },",
        "    { id: 'evt_tool_result', sequence: 3, timestamp: now, kind: 'tool.observed', summary: 'Fixture tool observed.', payload: { summary: 'search result' } },",
        "    { id: 'evt_claim', sequence: 4, timestamp: now, kind: 'model.claim', summary: 'Fixture model claim.', payload: { text: 'claim' } }",
        '  ],',
        "  runtimeConfig: { modelConfig: { mode: 'mock' } }",
        '};',
        "writeFileSync(capturePath, JSON.stringify(capture, null, 2) + '\\n');",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'research.event', timestamp: now, payload: { event: { id: 'evt_live_progress', sequence: 5, kind: 'tool.observed', timestamp: now, summary: 'Live repository search completed.', payload: { toolName: 'repository.search', summary: 'Live repository search completed.' } } } }));",
        "console.log('HONEYCRISP_EVENT ' + JSON.stringify({ schemaVersion: 1, kind: 'model.thought', timestamp: now, payload: { phase: 'completed', eventType: 'thinking_end', responseId: 'fixture-response', itemId: 'thinking:0', provider: 'fixture-provider', model: 'fixture-model', text: '**Focus** Inspect fixture context' } }));",
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
      model: 'fixture-model',
      reasoningEffort: 'minimal'
    });
    const runId = runSnapshot.runs[0]?.run.id;
    expect(runId).toBeTruthy();
    expect(runSnapshot.runs[0]?.engine).toBe('honeycrisp');
    expect(snapshot.workspace.workspacePath).toBe(workspace);

    await waitForCondition(() => service.getSnapshot()?.runs[0]?.run.status === 'completed', 5000);

    const detail = service.getRunDetail(runId ?? '');
    expect(detail.modelSessions[0]).toMatchObject({ provider: 'honeycrisp', transport: 'host_process', status: 'completed' });
    expect(detail.modelSessions[0]?.metadata).toMatchObject({
      latestReportedInputTokens: 12345,
      latestReportedTotalTokens: 13023,
      latestContextUsageSource: 'Honeycrisp reported model usage',
      latestContextUsageEstimated: false,
      honeycrispGoalId: 'goal_fixture',
      honeycrispGoalStatus: 'active',
      honeycrispGoalTerminalReason: 'loop_limit',
      honeycrispSubGoalId: 'subgoal_fixture',
      honeycrispSubGoalObjective: 'Run fixture',
      honeycrispBealeSessionBoundary: 'beale_subgoal_checkpoint'
    });
    expect(detail.traceEvents.find((event) => event.summary === 'Honeycrisp flow capture preserved as a Beale artifact.')?.payload).toMatchObject({
      goal: {
        id: 'goal_fixture',
        objective: 'Fixture Honeycrisp research'
      },
      decision: {
        subGoalId: 'subgoal_fixture',
        subGoalObjective: 'Run fixture'
      },
      goalRun: {
        status: 'active',
        terminalReason: 'loop_limit'
      },
      usage: {
        input_tokens: 12345,
        output_tokens: 678,
        total_tokens: 13023,
        source: 'Honeycrisp reported model usage',
        estimated: false
      }
    });
    expect(detail.traceEvents.some((event) => event.summary.includes('Honeycrisp selected subgoal: Run fixture'))).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary.includes('fixture honeycrisp stdout'))).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary.includes('Honeycrisp tool.requested'))).toBe(true);
    expect(detail.traceEvents.some((event) => event.type === 'hypothesis_event' && event.summary.includes('Fixture hypothesis'))).toBe(true);
    expect(detail.artifacts.some((artifact) => artifact.kind === 'honeycrisp_flow_capture')).toBe(true);
    expect(detail.transcriptMessages.some((message) => message.source === 'openai_reasoning_summary' && message.contentMarkdown.includes('Inspect fixture context'))).toBe(true);
    expect(detail.transcriptMessages.some((message) => message.source === 'openai_reasoning_summary' && message.contentMarkdown.includes('Live repository search completed'))).toBe(false);
    expect(detail.transcriptMessages.some((message) => message.source === 'honeycrisp' && message.contentMarkdown.includes('Fixture Honeycrisp answer.'))).toBe(true);
    expect(detail.transcriptMessages.some((message) => message.source === 'honeycrisp' && message.contentMarkdown.includes('root goal remains active'))).toBe(false);
    const honeycrispTranscript = detail.transcriptMessages.find((message) => message.source === 'honeycrisp');
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
    expect(detail.run.summary).toContain('checkpoint completed');
    service.close();
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
        "if (!workspaceContext.projectNotes?.some((note) => String(note).startsWith('Rules and constraints:'))) throw new Error('Scope rules missing');",
        "mkdirSync(dirname(capturePath), { recursive: true });",
        "writeFileSync(capturePath, JSON.stringify({",
        '  capturedAt: new Date().toISOString(),',
        "  goalRun: { status: 'complete', loopsUsed: 1, maxLoops: 1 },",
        "  loop: { status: 'complete', executorName: 'node-cli-fixture', executionMode: 'mock', outputText: 'Node CLI fixture done.' },",
        '  eventTimeline: []',
        "}, null, 2) + '\\n');",
        "console.log('node cli fixture stdout');"
      ].join('\n')
    );
    process.env.BEALE_HONEYCRISP_ROOT = honeycrispRoot;
    process.env.BEALE_HONEYCRISP_NODE_COMMAND = process.execPath;

    const service = new WorkspaceService();
    const nestedSourceRoot = join(workspace, 'sources', 'zsh');
    const credentialReferencePath = join(workspace, 'credentials', 'research-account');
    mkdirSync(nestedSourceRoot, { recursive: true });
    mkdirSync(dirname(credentialReferencePath), { recursive: true });
    writeFileSync(join(nestedSourceRoot, 'parse.c'), 'parse_context_save();\n');
    writeFileSync(credentialReferencePath, 'host-only-reference\n');
    service.createWorkspace(workspace);
    service.saveScope({
      workspaceName: 'ZSH Fixture',
      scopeOwner: 'Apple Security Bounty',
      descriptionMarkdown: 'Local nested source fixture for Honeycrisp integration.',
      rulesMarkdown: 'Use local context provided by the operator.',
      networkProfile: 'offline',
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
    expect(existsSync(join(workspace, '.beale', 'honeycrisp-skills', 'beale-skeptical-triage', 'SKILL.md'))).toBe(false);
    const workspaceContextPath = (launchEvent?.payload as { workspaceContextPath?: string } | undefined)?.workspaceContextPath ?? '';
    const workspaceContext = JSON.parse(readFileSync(workspaceContextPath, 'utf8')) as {
      materializedSourcePaths?: string[];
      knownRepositories?: Array<{ rootPath: string }>;
      projectNotes?: string[];
    };
    expect(workspaceContext.materializedSourcePaths).toContain(nestedSourceRoot);
    expect(workspaceContext.materializedSourcePaths).not.toContain(workspace);
    expect(workspaceContext.knownRepositories?.some((repository) => repository.rootPath === nestedSourceRoot)).toBe(true);
    expect(workspaceContext.projectNotes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Authorization:/),
        expect.stringContaining('Scope: ZSH Fixture'),
        expect.stringContaining('Rules and constraints: Use local context provided by the operator.'),
        expect.stringContaining(`In scope (path, internal): ${nestedSourceRoot}`),
        expect.stringContaining('Out of scope (domain, internal): excluded.example.test'),
        expect.stringContaining('In scope (credential_ref, internal): [host-held credential reference; value withheld from agent context]')
      ])
    );
    expect(JSON.stringify(workspaceContext)).not.toContain(credentialReferencePath);
    expect(detail.modelSessions[0]?.metadata.latestContextUsageSource).toBe('Honeycrisp serialized capture estimate');
    expect(Number(detail.modelSessions[0]?.metadata.latestReportedInputTokens)).toBeGreaterThan(0);
    expect(detail.traceEvents.some((event) => event.summary.includes('node cli fixture stdout'))).toBe(true);
    expect(detail.transcriptMessages.some((message) => message.source === 'honeycrisp' && message.contentMarkdown.includes('Node CLI fixture done.'))).toBe(true);
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
    expect(calls[1]).toEqual([
      'tools',
      'list',
      '--workspace-root',
      workspace,
      '--json'
    ]);
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
    expect(service.getProfilingState().enabled).toBe(false);

    expect(service.setDeveloperModeEnabled(true)).toEqual({ developerModeEnabled: true });
    expect(service.getProfilingState().enabled).toBe(true);
    service.close();

    const reopened = new WorkspaceService(() => undefined, { workspaceRegistryDirectory: registryDir });
    expect(reopened.getDeveloperSettings()).toEqual({ developerModeEnabled: true });
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

  it('forwards general Honeycrisp steering actions to the Honeycrisp memory CLI', () => {
    const dir = tempWorkspace();
    const logPath = join(dir, 'honeycrisp-steering-calls.jsonl');
    const fakeHoneycrisp = join(dir, 'fake-honeycrisp-memory.mjs');
    writeFileSync(
      fakeHoneycrisp,
      [
        "import { appendFileSync } from 'node:fs';",
        `const logPath = ${JSON.stringify(logPath)};`,
        "const args = process.argv.slice(2);",
        "appendFileSync(logPath, JSON.stringify(args) + '\\n');",
        "const memoryIndex = args.indexOf('memory');",
        "const command = args[memoryIndex + 1] || 'unknown';",
        "const eventKind = command === 'request-proof' ? 'proof.requested' : command === 'mark-artifact' ? 'artifact.updated' : command === 'promote-hypothesis' ? 'finding.updated' : command === 'supersede-record' ? 'memory.decision' : 'finding.reviewed';",
        "const subjectId = args[memoryIndex + 3] || 'mem_fixture';",
        "const output = { action: command, event: { id: 'evt_fixture_' + command.replaceAll('-', '_'), kind: eventKind }, records: [], record: { id: subjectId, kind: 'finding', status: 'confirmed', summary: 'fixture record' }, agentState: { memory: {}, proof: {}, storage: {} } };",
        "if (command === 'request-proof') output.obligation = { id: 'proof_obl_fixture', status: 'open', question: 'fixture proof' };",
        "console.log(JSON.stringify(output));"
      ].join('\n'),
      'utf8'
    );
    chmodSync(fakeHoneycrisp, 0o700);
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp]);

    const artifactRoot = join(dir, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
    db.initialize();
    const context = db.createRun({
      scopeVersionId: db.getActiveScope().id,
      title: 'Honeycrisp steering run',
      promptMarkdown: '# Honeycrisp steering run',
      mode: 'open_discovery',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      attemptStrategy: 'single_path',
      networkProfile: 'offline',
      sandboxProfile: 'host',
      budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'honeycrisp' }
    });
    db.updateAttemptState(context.attempt.id, 'completed', 'Prepared Honeycrisp steering fixture.');
    db.updateRunStatus(context.run.id, 'completed', 'Prepared Honeycrisp steering fixture.');
    db.close();

    const service = new WorkspaceService();
    service.openWorkspace(dir);
    service.steerRun({ type: 'promote_hypothesis', runId: context.run.id, hypothesisId: 'mem_hypothesis_fixture' });
    service.steerRun({ type: 'merge_hypotheses', runId: context.run.id, sourceHypothesisId: 'mem_hypothesis_old', targetHypothesisId: 'mem_hypothesis_fixture' });
    service.steerRun({ type: 'request_reproduction', runId: context.run.id, hypothesisId: 'mem_hypothesis_fixture', note: 'secret=forwardsecret12345' });
    service.steerRun({ type: 'mark_needs_more_evidence', runId: context.run.id, findingId: 'mem_finding_fixture' });
    service.steerRun({ type: 'mark_artifact_sensitive', runId: context.run.id, artifactId: 'artifact_fixture' });

    const calls = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(calls).toHaveLength(5);
    expect(calls[0]).toEqual(expect.arrayContaining(['memory', 'promote-hypothesis', 'mem_hypothesis_fixture']));
    expect(calls[1]).toEqual(expect.arrayContaining(['memory', 'supersede-record', 'mem_hypothesis_old', '--superseded-by', 'mem_hypothesis_fixture']));
    expect(calls[2]).toEqual(expect.arrayContaining(['memory', 'request-proof', 'memory_record', 'mem_hypothesis_fixture', '--method-kind', 'empirical_reproduction']));
    expect(calls[2]).not.toContain('forwardsecret12345');
    expect(calls[3]).toEqual(expect.arrayContaining(['memory', 'review-record', 'mem_finding_fixture', '--finding-status', 'needs_evidence']));
    expect(calls[4]).toEqual(expect.arrayContaining(['memory', 'mark-artifact', 'artifact_fixture', '--mark', 'sensitive']));

    const detail = service.getRunDetail(context.run.id);
    expect(detail.traceEvents.filter((event) => event.summary.startsWith('Honeycrisp memory steering forwarded:'))).toHaveLength(5);
    expect(detail.traceEvents.some((event) => event.summary === 'Honeycrisp memory steering forwarded: request_reproduction.')).toBe(true);
    expect(JSON.stringify(detail.traceEvents.at(-1)?.payload)).not.toContain('forwardsecret12345');
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
    const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
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
