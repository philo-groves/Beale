import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { OpenAiResponsesAdapter } from '../src/main/openaiAdapter';
import { OpenAiAuthService } from '../src/main/openaiAuth';
import { startRunForTest, WorkspaceService } from '../src/main/workspaceService';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { ScopeAssetKind, StartRunInput } from '../src/shared/types';

const ROOT = process.cwd();
const createdDirs: string[] = [];
const OPENAI_ENV_NAMES = [
  'BEALE_OPENAI_AUTH_COMMAND',
  'BEALE_OPENAI_AUTH_ARGS_JSON',
  'BEALE_OPENAI_AUTH_COMMAND_REFRESH_MS',
  'BEALE_OPENAI_AUTH_COMMAND_TIMEOUT_MS',
  'BEALE_OPENAI_ACCESS_TOKEN',
  'BEALE_OPENAI_TRANSPORT',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL'
];

beforeEach(() => {
  process.env.BEALE_WORKSPACE_REGISTRY_DIR = tempDir('beale-test-registry-');
});

afterEach(() => {
  delete process.env.BEALE_WORKSPACE_REGISTRY_DIR;
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('plan conformance', () => {
  it('keeps every host API on a distinct IPC channel', () => {
    const channels = Object.values(IPC_CHANNELS);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('keeps planning documents linked from the book summary', () => {
    const summaryPath = join(ROOT, 'planning/book/SUMMARY.md');
    const summary = readFileSync(summaryPath, 'utf8');
    const linked = new Set(
      [...summary.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => normalizePath(relative(ROOT, resolve(join(ROOT, 'planning/book'), match[1]))))
    );
    const expectedDocs = [...filesUnder('planning/book'), ...filesUnder('planning/research')]
      .filter((path) => path.endsWith('.md'))
      .filter((path) => basename(path) !== 'SUMMARY.md')
      .map(normalizePath);

    const unlinked = expectedDocs.filter((path) => !linked.has(path));
    expect(unlinked).toEqual([]);
  });

  it('keeps renderer and preload behind typed host APIs without secrets or database access', () => {
    const files = [...filesUnder('src/renderer'), ...filesUnder('src/preload')].filter(isSourceFile);
    const forbidden = [
      /node:sqlite|DatabaseSync|WorkspaceDatabase/,
      /node:child_process|spawnSync|spawn\(|execFile\(|exec\(/,
      /OPENAI_API_KEY|BEALE_OPENAI_/,
      /Authorization:\s*`?Bearer/i,
      /process\.env/
    ];

    expect(findPatternHits(files, forbidden)).toEqual([]);
  });

  it('keeps authoritative SQL mutation inside the persistence service', () => {
    const persistenceFiles = new Set(['src/main/database.ts', 'src/main/databaseMigrations.ts', 'src/main/workspaceRegistry.ts']);
    const files = filesUnder('src').filter(isSourceFile).filter((path) => !persistenceFiles.has(normalizePath(path)));
    const forbiddenSql = [/\bINSERT INTO\b/i, /\bCREATE TABLE\b/i, /\bDELETE FROM\b/i, /\bALTER TABLE\b/i, /\bUPDATE\s+[a-z_]+\s+SET\b/i, /\bPRAGMA\b/i];

    expect(findPatternHits(files, forbiddenSql)).toEqual([]);
  });

  it('keeps host subprocess use limited to auth, host tools, source setup, and Honeycrisp host-agent boundaries', () => {
    const files = filesUnder('src/main').filter(isSourceFile);
    const hits = findPatternHits(files, [/node:child_process|spawnSync\(|\bspawn\(|\bexecFile\(|\bfork\(/]).filter(
      (hit) =>
        ![
          'src/main/openaiAuth.ts',
          'src/main/hostToolExecutor.ts',
          'src/main/sourceMaterializer.ts',
          'src/main/honeycrispRunEngine.ts',
          'src/main/honeycrispMemorySummary.ts'
        ].includes(normalizePath(hit.path))
    );

    expect(hits).toEqual([]);
  });

  it('keeps removed Beale agent runtime layers out of the main source tree', () => {
    const files = filesUnder('src/main').map(normalizePath);
    expect(files).not.toContain('src/main/openaiRunEngine.ts');
    expect(files).not.toContain('src/main/openaiContext.ts');
    expect(files).not.toContain('src/main/openaiTools.ts');
    expect(files).not.toContain('src/main/fakeRunEngine.ts');
  });

  it('keeps the OpenAI adapter aligned with the planned defaults and host-only credential state', () => {
    withCleanOpenAiEnv(() => {
      const auth = new OpenAiAuthService();
      const status = auth.getStatus();
      expect(status.credentialsHostOnly).toBe(true);
      expect(status.defaultModel).toBe('gpt-5.6-sol');
      expect(status.defaultReasoningEffort).toBe('high');

      const adapter = new OpenAiResponsesAdapter(auth, async () => new Response('', { status: 500 }), 'https://api.openai.test/v1', null);
      const request = adapter.buildRequest({
        model: status.defaultModel,
        instructions: 'Plan conformance smoke request.',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Return ok.' }] }],
        tools: [],
        reasoning: { effort: status.defaultReasoningEffort },
        text: { verbosity: 'low' },
        metadata: { beale_plan_check: 'true' }
      });

      expect(request.store).toBe(false);
      expect(request.stream).toBe(true);
      expect(request.tool_choice).toBe('auto');
      expect(request.parallel_tool_calls).toBe(true);
      expect(request.reasoning).toEqual({ effort: 'high' });
    });
  });

  it('creates workspace-local SQLite state and host execution records without exposing secrets', () => {
    const dir = tempDir('beale-plan-db-');
    const artifactRoot = join(dir, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    const db = new WorkspaceDatabase(join(dir, '.honeycrisp', 'memory', 'memory.sqlite'), artifactRoot);
    db.initialize();

    const context = db.createRun({
      scopeVersionId: db.getActiveScope().id,
      title: 'Plan conformance run',
      promptMarkdown: '# Plan conformance',
      mode: 'open_discovery',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      attemptStrategy: 'adaptive_portfolio',
      networkProfile: 'offline',
      sandboxProfile: 'host',
      budget: { maxMinutes: 30, maxAttempts: 1, maxCostUsd: 0, runEngine: 'fixture' }
    });

    expect(db.getDatabasePath()).toBe(join(dir, '.honeycrisp', 'memory', 'memory.sqlite'));
    expect(db.getArtifactRoot()).toBe(artifactRoot);
    expect(context.vmContext.backend).toBe('host');
    expect(context.vmContext.metadata).toMatchObject({ executor: 'host', targetExecution: true, executionPosture: 'host_process' });
    expect(JSON.stringify(context.vmContext.metadata)).not.toMatch(/beale\.sqlite|OPENAI|api[_-]?key|access[_-]?token|credential/i);
    db.close();
  });

  it('keeps fixture run evidence provenance distinct from model claims', () => {
    const service = new WorkspaceService();
    service.createWorkspace(tempDir('beale-plan-workspace-'));
    service.saveScope({
      workspaceName: 'Plan Workspace',
      scopeOwner: 'Example Org',
      descriptionMarkdown: 'Plan conformance scope.',
      rulesMarkdown: 'Stay inside local fixtures.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [asset('in_scope', 'path', '/targets/plan-fixture'), asset('out_of_scope', 'domain', 'blocked.example.test')]
    });

    const snapshot = startRunForTest(service, { ...runInput(), fixtureScenario: 'verified_finding' });
    const detail = service.getRunDetail(snapshot.runs[0].run.id);
    const modelMessages = detail.traceEvents.filter((event) => event.source === 'model' && event.type === 'model_message');
    const observations = detail.traceEvents.filter((event) => ['tool', 'verifier'].includes(event.source) && ['tool_result', 'artifact_created', 'verifier_result'].includes(event.type));
    const verifiedFindings = detail.findings.filter((finding) => finding.state === 'verified');

    expect(modelMessages.length).toBeGreaterThan(0);
    expect(modelMessages.every((event) => typeof event.payload.claimStatus === 'string')).toBe(true);
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((event) => event.payload.observationBacked === true)).toBe(true);
    expect(verifiedFindings.every((finding) => typeof finding.verifiedByVerifierRunId === 'string')).toBe(true);
    service.close();
  });
});

function filesUnder(relativeRoot: string): string[] {
  const absoluteRoot = join(ROOT, relativeRoot);
  const results: string[] = [];
  for (const entry of readdirSync(absoluteRoot)) {
    const absolutePath = join(absoluteRoot, entry);
    const relativePath = normalizePath(relative(ROOT, absolutePath));
    if (statSync(absolutePath).isDirectory()) {
      results.push(...filesUnder(relativePath));
    } else {
      results.push(relativePath);
    }
  }
  return results;
}

function findPatternHits(files: string[], patterns: RegExp[]): Array<{ path: string; pattern: string }> {
  const hits: Array<{ path: string; pattern: string }> = [];
  for (const path of files) {
    const content = readFileSync(join(ROOT, path), 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        hits.push({ path: normalizePath(path), pattern: pattern.source });
      }
    }
  }
  return hits;
}

function isSourceFile(path: string): boolean {
  return path.endsWith('.ts') || path.endsWith('.tsx');
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function withCleanOpenAiEnv(work: () => void): void {
  const previous = new Map(OPENAI_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of OPENAI_ENV_NAMES) {
    delete process.env[name];
  }
  try {
    work();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
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

function runInput(): StartRunInput {
  return {
    runEngine: 'fixture',
    promptMarkdown: '# Plan conformance\nExercise the fixture workbench path.',
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
    fixtureScenario: 'adaptive_portfolio'
  };
}
