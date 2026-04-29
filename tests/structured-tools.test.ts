import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase, type CreatedRunContext } from '../src/main/database';
import { ExecutorManager } from '../src/main/executorManager';
import { BealeToolRouter } from '../src/main/openaiTools';
import type { ScopeAssetInput } from '../src/shared/types';

const createdDirs: string[] = [];
const ENV_KEYS = ['BEALE_VMCTL_COMMAND', 'BEALE_VMCTL_ARGS_JSON', 'BEALE_VMCTL_TIMEOUT_MS', 'BEALE_GIT_COMMAND'];
let callSequence = 0;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  callSequence = 0;
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('structured research tools', () => {
  it('materializes in-scope source repositories before scoped search and VM import', () => {
    const { db, context, targetDir } = openStructuredToolDb();
    const gitFixture = join(process.cwd(), 'tests/fixtures/git-fixture.mjs');
    chmodSync(gitFixture, 0o700);
    process.env.BEALE_GIT_COMMAND = gitFixture;
    const router = new BealeToolRouter(db);

    db.saveProgramScope({
      ...scopeDraftFromActive(db),
      assets: [
        ...scopeDraftFromActive(db).assets,
        {
          direction: 'in_scope',
          kind: 'other',
          value: 'Open Source - Zuul',
          sensitivity: 'public',
          attributes: { instruction: '## https://github.com/Netflix/zuul\nPrimary target.' }
        }
      ]
    });

    const source = callTool(router, context, 'source', { repository: 'Zuul', ref: '' });
    expect(source.status).toBe('success');
    expect(source.payload.repositoryUrl).toBe('https://github.com/Netflix/zuul');
    expect(String(source.payload.localPath)).toContain('targets/repositories/github.com_Netflix_zuul');

    for (let index = 0; index < 325; index += 1) {
      writeFileSync(join(targetDir, `filler-${index}.txt`), 'unrelated filler\n');
    }

    const search = callTool(router, context, 'search', { query: 'authorizationBoundary', target: 'Open Source - Zuul' });
    expect(search.status).toBe('success');
    expect(search.payload.targetResolution).toBe('materialized_source_repository');
    expect(search.payload.filesConsidered).toBeGreaterThan(0);
    expect(JSON.stringify(search.payload)).toContain('ProxyEndpoint.java');

    const regexSearch = callTool(router, context, 'search', { query: 'ProxyEndpoint|MissingRoute', target: 'https://github.com/Netflix/zuul' });
    expect(regexSearch.status).toBe('success');
    expect(regexSearch.payload.queryMode).toBe('regex_or_terms');
    expect(JSON.stringify(regexSearch.payload)).toContain('ProxyEndpoint.java');
    db.close();
  });

  it('searches scoped source and binary-derived strings, then reads bounded source chunks', () => {
    const { db, context, sourceFile, binaryFile } = openStructuredToolDb();
    const router = new BealeToolRouter(db);

    const search = callTool(router, context, 'search', { query: 'authorization boundary', target: '' });
    expect(search.status).toBe('success');
    expect(JSON.stringify(search.payload)).toContain(sourceFile);

    const binarySearch = callTool(router, context, 'search', { query: 'CRASH_SIG', target: '' });
    expect(binarySearch.status).toBe('success');
    expect(JSON.stringify(binarySearch.payload)).toContain(binaryFile);
    expect(JSON.stringify(binarySearch.payload)).toContain('binaryDerived');

    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: 'UniqueTraceOnlyNeedle should not become scoped search material.',
      payload: { text: 'UniqueTraceOnlyNeedle' }
    });
    const selfSearch = callTool(router, context, 'search', { query: 'UniqueTraceOnlyNeedle', target: '' });
    expect(selfSearch.status).toBe('success');
    expect(selfSearch.payload.matches).toEqual([]);
    expect(JSON.stringify(selfSearch.payload)).not.toContain('trace_event');

    const read = callTool(router, context, 'code_browser', { path: sourceFile, symbol: 'check_access' });
    expect(read.status).toBe('success');
    expect(JSON.stringify(read.payload)).toContain('check_access');
    expect(JSON.stringify(read.payload)).toContain('authorization boundary');

    const blocked = callTool(router, context, 'code_browser', { path: join(tmpdir(), 'out-of-scope.c'), symbol: '' });
    expect(blocked.status).toBe('policy_blocked');
    expect(JSON.stringify(blocked.payload)).toContain('path_outside_active_scope');
    db.close();
  });

  it('preserves model-generated artifacts separately from observations and gates verifier promotion on evidence references', () => {
    const { db, context } = openStructuredToolDb();
    const router = new BealeToolRouter(db);

    const artifact = callTool(router, context, 'artifact', {
      name: 'candidate-poc.txt',
      content: 'candidate input generated by model',
      kind: 'poc_input'
    });
    expect(artifact.status).toBe('success');
    expect(artifact.artifact_id).toBeTruthy();
    expect(artifact.payload.observationBacked).toBe(false);

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: 'candidate parser issue',
      expectation: 'candidate input should reproduce the observed condition',
      artifact_id: artifact.artifact_id,
      trace_event_id: artifact.trace_event_id,
      verifier_script: '',
      artifact_path: '',
      expected_stdout: ''
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('inconclusive');
    expect(verifier.payload.promotedFinding).toBe(false);
    expect((verifier.payload.evidenceReferences as { artifactId: string }).artifactId).toBe(artifact.artifact_id);

    const detail = db.getRunDetail(context.run.id);
    expect(detail.artifacts.find((candidate) => candidate.id === artifact.artifact_id)?.source).toBe('model_generated');
    expect(detail.verifierRuns).toHaveLength(1);
    expect(detail.traceEvents.some((event) => event.type === 'verifier_result' && event.source === 'verifier')).toBe(true);
    db.close();
  });

  it('runs Python and the debugger wrapper through the disposable VM controller boundary', () => {
    const { db, context, logPath } = openStructuredToolDb();
    context.run.networkProfile = 'elevated';
    configureVmctlFixture(logPath);
    const router = new BealeToolRouter(db, new ExecutorManager(db));

    const python = callTool(router, context, 'python', {
      task: 'generate a candidate input',
      script: 'print("candidate")',
      artifact_path: '/tmp/beale-output.txt'
    });
    expect(python.status).toBe('success');
    expect(python.artifact_id).toBeTruthy();
    expect(python.payload.hostExecution).toBe(false);
    expect(python.payload.requestedNetworkProfile).toBe('elevated');
    expect(python.payload.networkProfile).toBe('scoped');

    const debuggerResult = callTool(router, context, 'debugger', {
      operation: 'gdb_probe',
      target: '/workspace/target',
      input_path: ''
    });
    expect(debuggerResult.status).toBe('success');
    expect(debuggerResult.artifact_id).toBeTruthy();
    expect(debuggerResult.payload.wrapper).toBe('gdb_batch_probe');
    expect(debuggerResult.payload.hostExecution).toBe(false);
    expect(debuggerResult.payload.requestedNetworkProfile).toBe('elevated');
    expect(debuggerResult.payload.networkProfile).toBe('scoped');
    expect((debuggerResult.payload.debugger as { signal: string }).signal).toBe('SIGSEGV');
    expect((debuggerResult.payload.debugger as { frames: string[] }).frames.length).toBeGreaterThan(0);
    expect((debuggerResult.payload.debugger as { registersCaptured: boolean }).registersCaptured).toBe(true);
    context.run.networkProfile = 'offline';

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: 'structured tool VM verifier',
      expectation: 'VM verifier should observe fixture stdout',
      artifact_id: '',
      trace_event_id: '',
      verifier_script: 'echo verifier-ok',
      artifact_path: '/tmp/beale-output.txt',
      expected_stdout: 'fixture guest stdout'
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('pass');
    expect(verifier.payload.realExecution).toBe(true);
    expect(verifier.artifact_id).toBeTruthy();

    const actions = readVmctlEntries(logPath).map((entry) => entry.input.action);
    expect(actions).toContain('create_context');
    expect(actions).toContain('clone_context');
    expect(actions).toContain('import_workspace_material');
    expect(actions.filter((action) => action === 'execute')).toHaveLength(3);
    expect(actions).toContain('export_artifact');
    expect(actions.filter((action) => action === 'destroy')).toHaveLength(3);

    const operations = readVmctlEntries(logPath)
      .filter((entry) => entry.input.action === 'execute' && entry.input.payload.operation)
      .map((entry) => entry.input.payload.operation?.operationKind);
    expect(operations).toEqual(['python', 'shell', 'shell']);
    const localAnalysisProfiles = readVmctlEntries(logPath)
      .filter((entry) => entry.input.action === 'execute')
      .slice(0, 2)
      .map((entry) => entry.input.payload.operation?.networkPolicy?.profile);
    expect(localAnalysisProfiles).toEqual(['scoped', 'scoped']);
    db.close();
  });

  it('runs Python and verifier scripts on the host when the session sandbox is host_research_only', () => {
    const { db, context, targetDir } = openStructuredToolDb('host_research_only');
    const router = new BealeToolRouter(db);

    const python = callTool(router, context, 'python', {
      task: 'generate host-side analysis output',
      script: [
        'import os',
        'target = os.environ["BEALE_TARGET_PATH"]',
        'path = os.path.join(target, "beale-host-output.txt")',
        'open(path, "w", encoding="utf-8").write("host artifact")',
        'print(os.environ["BEALE_EXECUTION_SUBSTRATE"])'
      ].join('\n'),
      artifact_path: '/workspace/target/beale-host-output.txt'
    });
    expect(python.status).toBe('success');
    expect(python.artifact_id).toBeTruthy();
    expect(python.payload.hostExecution).toBe(true);
    expect(python.payload.executionSubstrate).toBe('host');
    expect(python.payload.hostTargetPath).toBe(targetDir);
    expect(python.payload.stdoutSummary).toContain('host');

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: 'host verifier',
      expectation: 'host verifier should observe stdout',
      artifact_id: '',
      trace_event_id: '',
      verifier_script: 'printf verifier-ok',
      artifact_path: '',
      expected_stdout: 'verifier-ok'
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('pass');
    expect(verifier.payload.realExecution).toBe(true);
    expect(verifier.payload.hostExecution).toBe(true);
    expect(verifier.payload.vmExecution).toBe(false);
    expect(db.getRunDetail(context.run.id).traceEvents.some((event) => event.summary === 'Verifier contract executed on host with pass.')).toBe(true);
    db.close();
  });

  it('selects the prompt-referenced host target and collects target-named temporary verifier artifacts', () => {
    const spectatorDir = mkdtempSync(join(tmpdir(), 'beale-spectator-target-'));
    createdDirs.push(spectatorDir);
    writeFileSync(join(spectatorDir, 'README.md'), 'spectator fixture\n');
    const { db, context, targetDir } = openStructuredToolDb('host_research_only', {
      title: 'Spectator source audit',
      promptMarkdown: `# Spectator source audit\nUse local repo: ${spectatorDir}`,
      extraAssets: [
        {
          direction: 'in_scope',
          kind: 'repo',
          value: spectatorDir,
          sensitivity: 'public',
          attributes: { repositoryUrl: 'https://github.com/Netflix/spectator' }
        }
      ]
    });
    const router = new BealeToolRouter(db);

    const python = callTool(router, context, 'python', {
      task: 'report selected host target',
      script: 'import os\nprint(os.environ["BEALE_TARGET_PATH"])',
      artifact_path: ''
    });
    expect(python.status).toBe('success');
    expect(python.payload.hostTargetPath).toBe(spectatorDir);
    expect(python.payload.hostTargetPath).not.toBe(targetDir);

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: 'host verifier bash and artifact policy',
      expectation: 'host verifier should run Bash and collect a target-prefixed temp artifact',
      artifact_id: '',
      trace_event_id: '',
      verifier_script: '#!/usr/bin/env bash\nset -euo pipefail\nprintf verifier-ok | tee /tmp/spectator-verifier.txt',
      artifact_path: '/tmp/spectator-verifier.txt',
      expected_stdout: 'verifier-ok'
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('pass');
    expect(verifier.artifact_id).toBeTruthy();
    expect(db.getRunDetail(context.run.id).artifacts.some((artifact) => artifact.kind === 'verifier_output')).toBe(true);
    db.close();
  });
});

interface ToolOutput {
  status: string;
  summary: string;
  trace_event_id?: string;
  artifact_id?: string;
  payload: Record<string, unknown>;
}

function scopeDraftFromActive(db: WorkspaceDatabase) {
  const scope = db.getActiveScope();
  return {
    programName: scope.programName,
    organizationName: scope.organizationName,
    descriptionMarkdown: scope.descriptionMarkdown,
    rulesMarkdown: scope.rulesMarkdown,
    networkProfile: scope.networkProfile,
    expiresAt: scope.expiresAt,
    assets: scope.assets.map((asset) => ({
      direction: asset.direction,
      kind: asset.kind,
      value: asset.value,
      sensitivity: asset.sensitivity,
      attributes: asset.attributes
    }))
  };
}

function callTool(router: BealeToolRouter, context: CreatedRunContext, name: string, args: Record<string, unknown>): ToolOutput {
  return JSON.parse(
    router.execute(context, {
      callId: `call_${name}_${(callSequence += 1)}`,
      name,
      argumentsJson: JSON.stringify(args)
    }).output
  ) as ToolOutput;
}

interface StructuredToolDbOptions {
  title?: string;
  promptMarkdown?: string;
  extraAssets?: ScopeAssetInput[];
}

function openStructuredToolDb(
  sandboxProfile = 'local_disposable_vm',
  options: StructuredToolDbOptions = {}
): { db: WorkspaceDatabase; context: CreatedRunContext; sourceFile: string; binaryFile: string; targetDir: string; logPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beale-structured-tools-'));
  createdDirs.push(dir);
  const artifactRoot = join(dir, '.beale', 'artifacts');
  const targetDir = join(dir, 'target');
  mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
  mkdirSync(join(targetDir, 'src'), { recursive: true });
  mkdirSync(join(targetDir, 'bin'), { recursive: true });

  const sourceFile = join(targetDir, 'src', 'access.c');
  const binaryFile = join(targetDir, 'bin', 'target.bin');
  const logPath = join(dir, 'vmctl.log');
  writeFileSync(sourceFile, 'int check_access(void) {\n  // authorization boundary\n  return 1;\n}\n');
  writeFileSync(binaryFile, Buffer.from([0, 1, 2, ...Buffer.from('CRASH_SIG_NEAR_PARSE', 'utf8'), 0, 3]));

  const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
  db.initialize();
  db.saveProgramScope({
    programName: 'Structured Tool Program',
    organizationName: 'Example Org',
    descriptionMarkdown: 'Scoped structured tool test.',
    rulesMarkdown: 'Offline guest execution only.',
    networkProfile: 'offline',
    expiresAt: null,
    assets: [
      { direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} },
      ...(options.extraAssets ?? []),
      { direction: 'in_scope', kind: 'domain', value: 'live.example.test', sensitivity: 'public', attributes: { protocol: 'tcp', port: 443 } }
    ]
  });
  const context = db.createRun({
    scopeVersionId: db.getActiveScope().id,
    title: options.title ?? 'Structured tool smoke',
    promptMarkdown: options.promptMarkdown ?? '# Structured tool smoke',
    mode: 'open_discovery',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    attemptStrategy: 'single_path',
    networkProfile: 'offline',
    sandboxProfile,
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'openai_responses' }
  });
  return { db, context, sourceFile, binaryFile, targetDir, logPath };
}

function configureVmctlFixture(logPath: string): void {
  process.env.BEALE_VMCTL_COMMAND = process.execPath;
  process.env.BEALE_VMCTL_ARGS_JSON = JSON.stringify([join(process.cwd(), 'tests/fixtures/vmctl-fixture.mjs'), logPath]);
}

function readVmctlEntries(logPath: string): Array<{ input: { action: string; payload: { operation?: { operationKind: string; networkPolicy?: { profile: string } } } } }> {
  const content = readFileSync(logPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line) as { input: { action: string; payload: { operation?: { operationKind: string } } } });
}
