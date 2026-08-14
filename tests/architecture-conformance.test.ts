import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { boundedOpenAiPromptCacheKey, OpenAiResponsesAdapter } from '../src/main/openaiAdapter';
import { OpenAiAuthService } from '../src/main/openaiAuth';
import { startRunForTest, WorkspaceService } from '../src/main/workspaceService';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { ScopeAssetKind, StartRunInput } from '../src/shared/types';
import { resolvedTestResearchProfile } from './researchProfileFixture';

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

describe('architecture conformance', () => {
  it('keeps every host API on a distinct IPC channel', () => {
    const channels = Object.values(IPC_CHANNELS);
    expect(new Set(channels).size).toBe(channels.length);
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
    const persistenceFiles = new Set([
      'src/main/database.ts',
      'src/main/databaseMigrations.ts',
      'src/main/memoryDreaming.ts',
      'src/main/workspaceRegistry.ts'
    ]);
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
          'src/main/researchProviderAuth.ts',
          'src/main/hostToolExecutor.ts',
          'src/main/sourceMaterializer.ts',
          'src/main/honeycrispRunEngine.ts',
          'src/main/providerTextCompletion.ts',
          'src/main/researchProfileService.ts',
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

  it('keeps the OpenAI adapter aligned with product defaults and host-only credential state', () => {
    withCleanOpenAiEnv(() => {
      const auth = new OpenAiAuthService();
      const status = auth.getStatus();
      expect(status.credentialsHostOnly).toBe(true);
      expect(status.defaultModel).toBe('gpt-5.6-sol');
      expect(status.defaultReasoningEffort).toBe('high');

      const adapter = new OpenAiResponsesAdapter(auth, async () => new Response('', { status: 500 }), 'https://api.openai.test/v1', null);
      const request = adapter.buildRequest({
        model: status.defaultModel,
        instructions: 'Architecture conformance smoke request.',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Return ok.' }] }],
        tools: [],
        reasoning: { effort: status.defaultReasoningEffort },
        text: { verbosity: 'low' },
        metadata: { beale_architecture_check: 'true' }
      });

      expect(request.store).toBe(false);
      expect(request.stream).toBe(true);
      expect(request.tool_choice).toBe('auto');
      expect(request.parallel_tool_calls).toBe(true);
      expect(request.reasoning).toEqual({ effort: 'high' });
    });
  });

  it('bounds deterministic OpenAI prompt cache keys without changing short session ids', () => {
    expect(boundedOpenAiPromptCacheKey('run_short')).toBe('run_short');

    const longSessionId = `prompt_generation_ham_${'workspace-with-a-long-id_'.repeat(4)}request`;
    const bounded = boundedOpenAiPromptCacheKey(longSessionId);
    expect(bounded).toHaveLength(64);
    expect(bounded).toBe(boundedOpenAiPromptCacheKey(longSessionId));
    expect(bounded).not.toBe(boundedOpenAiPromptCacheKey(`${longSessionId}_different`));
  });

  it('bounds long Codex session identifiers in both request headers and prompt cache bodies', async () => {
    const captured: { headers?: HeadersInit; body?: string } = {};
    const credential = {
      token: 'test-token',
      source: 'codex_oauth_file' as const,
      accountId: 'test-account'
    };
    const auth = {
      getCredential: () => credential,
      getCredentialOrThrow: () => credential
    } as OpenAiAuthService;
    const adapter = new OpenAiResponsesAdapter(
      auth,
      async (_url, init) => {
        captured.headers = init.headers;
        captured.body = String(init.body ?? '');
        return new Response('data: {"type":"response.completed","response":{"id":"response_test"}}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        });
      },
      'https://api.openai.test/v1',
      null,
      'https://chatgpt.test/backend-api'
    );
    const longSessionId = `prompt_generation_ham_${'workspace-with-a-long-id_'.repeat(4)}request`;
    const request = adapter.buildRequest({
      model: 'gpt-5.6-sol',
      instructions: 'Return ok.',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Return ok.' }] }],
      tools: [],
      reasoning: { effort: 'high' },
      text: { verbosity: 'low' },
      metadata: { beale_run_id: longSessionId }
    });

    for await (const _event of adapter.streamResponse({ body: request })) {
      // Drain the stream to capture the serialized request.
    }

    const headers = new Headers(captured.headers);
    const body = JSON.parse(captured.body ?? '{}') as Record<string, unknown>;
    expect(headers.get('session_id')).toHaveLength(64);
    expect(headers.get('x-client-request-id')).toHaveLength(64);
    expect(body.prompt_cache_key).toBe(headers.get('session_id'));
  });

  it('creates shared SQLite state and host execution records without exposing secrets', () => {
    const dir = tempDir('beale-architecture-db-');
    const artifactRoot = join(dir, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    const db = new WorkspaceDatabase(join(dir, '.honeycrisp', 'memory', 'memory.sqlite'), artifactRoot);
    db.initialize();

    const context = db.createRun({
      scopeVersionId: db.getActiveScope().id,
      title: 'Architecture conformance run',
      promptMarkdown: '# Architecture conformance',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      attemptStrategy: 'iterative_research',
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

  it('keeps fixture narration distinct from observation and verifier provenance', () => {
    const service = new WorkspaceService(() => undefined, {
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    service.createWorkspace(tempDir('beale-architecture-workspace-'));
    service.saveScope({
      workspaceName: 'Architecture Workspace',
      scopeOwner: 'Example Org',
      descriptionMarkdown: 'Architecture conformance scope.',
      rulesMarkdown: 'Stay inside local fixtures.',
      expiresAt: null,
      assets: [asset('in_scope', 'path', '/targets/architecture-fixture'), asset('out_of_scope', 'domain', 'blocked.example.test')]
    });

    const snapshot = startRunForTest(service, { ...runInput(), fixtureScenario: 'verifier_pass' });
    const detail = service.getRunDetail(snapshot.runs[0].run.id);
    const modelMessages = detail.traceEvents.filter((event) => event.source === 'model' && event.type === 'model_message');
    const observations = detail.traceEvents.filter((event) => ['tool', 'verifier'].includes(event.source) && ['tool_result', 'artifact_created', 'verifier_result'].includes(event.type));
    const verifierRuns = detail.verifierRuns.filter((run) => run.status === 'pass');

    expect(modelMessages.length).toBeGreaterThan(0);
    expect(modelMessages.every((event) => event.payload.fixtureOnly === true)).toBe(true);
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((event) => event.payload.observationBacked === true)).toBe(true);
    expect(verifierRuns.every((run) => run.result.fixture === true || run.result.simulated === true)).toBe(true);
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
    shellSafetyMode: 'auto_review',
    goalEnabled: false,
    goalObjective: null,
    promptMarkdown: '# Architecture conformance\nExercise the fixture workbench path.',
    mode: 'open_discovery',
    attemptStrategy: 'iterative_research',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    sandboxProfile: 'host',
    budget: {
      maxMinutes: 30,
      maxAttempts: 2,
      maxCostUsd: 0
    },
    fixtureScenario: 'multi_branch_trace'
  };
}
