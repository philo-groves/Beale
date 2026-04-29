import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { buildCompactedReplayOpenAiInput, buildInitialOpenAiInput, buildOpenAiInstructions } from '../src/main/openaiContext';
import { OpenAiResponsesAdapter, parseSseEvent, parseSseStream, type FetchLike, type WebSocketConstructorLike, type WebSocketLike } from '../src/main/openaiAdapter';
import { OpenAiAuthService } from '../src/main/openaiAuth';
import { OpenAiRunEngine } from '../src/main/openaiRunEngine';
import type { StartRunInput } from '../src/shared/types';

const createdDirs: string[] = [];

afterEach(() => {
  delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
  delete process.env.BEALE_OPENAI_AUTH_COMMAND;
  delete process.env.BEALE_OPENAI_AUTH_ARGS_JSON;
  delete process.env.BEALE_OPENAI_AUTH_COMMAND_REFRESH_MS;
  delete process.env.BEALE_OPENAI_AUTH_COMMAND_TIMEOUT_MS;
  delete process.env.BEALE_OPENAI_CODEX_AUTH_FILE;
  delete process.env.BEALE_OPENAI_ENABLE_CODEX_AUTH_FILE;
  delete process.env.BEALE_OPENAI_COMPACT_INPUT_TOKENS;
  delete process.env.BEALE_OPENAI_COMPACT_MANUAL_TURNS;
  delete process.env.BEALE_OPENAI_COMPACT_RECENT_EVENTS;
  delete process.env.BEALE_OPENAI_COMPACT_SERIALIZED_BYTES;
  delete process.env.BEALE_OPENAI_CONTEXT_BUDGET_TOKENS;
  delete process.env.BEALE_OPENAI_MAX_TOOL_TURNS;
  delete process.env.BEALE_OPENAI_TRANSPORT_RETRY_DELAY_MS;
  delete process.env.BEALE_OPENAI_TRANSPORT_RETRY_LIMIT;
  delete process.env.BEALE_OPENAI_TRANSPORT;
  delete process.env.OPENAI_API_KEY;
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('OpenAI Responses run engine', () => {
  it('parses Responses SSE events without SDK state', async () => {
    const parsedSingle = parseSseEvent('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}');
    expect(parsedSingle?.type).toBe('response.output_text.delta');
    expect(parsedSingle?.delta).toBe('hello');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1"}}\n\n' +
              'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1"}}\n\n'
          )
        );
        controller.close();
      }
    });

    const events = [];
    for await (const event of parseSseStream(stream)) {
      events.push(event.type);
    }
    expect(events).toEqual(['response.created', 'response.completed']);
  });

  it('resolves an OAuth command token before API key fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beale-openai-auth-'));
    createdDirs.push(dir);
    const tokenCommand = join(dir, 'token.sh');
    const envDump = join(dir, 'auth-env.txt');
    writeFileSync(tokenCommand, `#!/bin/sh\nenv > "${envDump}"\nprintf "Bearer oauth-command-token\\n"\n`, { mode: 0o700 });
    process.env.BEALE_OPENAI_AUTH_COMMAND = tokenCommand;
    process.env.OPENAI_API_KEY = 'sk-development-fallback-for-test';

    const auth = new OpenAiAuthService();
    expect(auth.getCredential()).toEqual({ token: 'oauth-command-token', source: 'oauth_command' });
    expect(auth.getStatus().source).toBe('oauth_command');
    expect(auth.getStatus().readiness).toBe('oauth_ready');
    expect(JSON.stringify(auth.getStatus())).not.toContain('oauth-command-token');
    expect(readFileSync(envDump, 'utf8')).not.toContain('OPENAI_API_KEY');
    expect(readFileSync(envDump, 'utf8')).not.toContain('sk-development-fallback-for-test');
  });

  it('resolves Codex OAuth auth file credentials without exposing tokens in status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beale-codex-auth-'));
    createdDirs.push(dir);
    const authPath = join(dir, 'auth.json');
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: fakeCodexAccessToken('chatgpt-account-for-test'),
          refresh_token: 'codex-refresh-token-for-test'
        }
      })
    );

    const auth = new OpenAiAuthService({ codexAuthPath: authPath });
    expect(auth.getCredential()).toEqual({
      token: fakeCodexAccessToken('chatgpt-account-for-test'),
      source: 'codex_oauth_file',
      accountId: 'chatgpt-account-for-test'
    });
    const status = auth.getStatus();
    expect(status.source).toBe('codex_oauth_file');
    expect(status.readiness).toBe('oauth_ready');
    expect(status.credentialsHostOnly).toBe(true);
    expect(JSON.stringify(status)).not.toContain(fakeCodexAccessToken('chatgpt-account-for-test'));
    expect(JSON.stringify(status)).not.toContain('codex-refresh-token-for-test');
  });

  it('prefers explicit API key fallback over auto-detected Codex OAuth file credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beale-codex-auth-with-api-key-'));
    createdDirs.push(dir);
    const authPath = join(dir, 'auth.json');
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'codex-oauth-token-for-test'
        }
      })
    );
    process.env.OPENAI_API_KEY = 'sk-explicit-api-key-for-test';

    const auth = new OpenAiAuthService({ codexAuthPath: authPath });
    expect(auth.getCredential()).toEqual({ token: 'sk-explicit-api-key-for-test', source: 'api_key_env' });
    expect(auth.getStatus().source).toBe('api_key_env');
  });

  it('starts Codex OAuth device login and returns browser instructions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beale-codex-login-'));
    createdDirs.push(dir);
    const codex = join(dir, 'codex');
    writeFileSync(
      codex,
      '#!/bin/sh\nif [ "$1" = "login" ] && [ "$2" = "--device-auth" ]; then\n  printf "Open https://auth.openai.com/codex/device\\nCode: ABCD-EFGH\\n"\n  exit 0\nfi\nexit 2\n',
      { mode: 0o700 }
    );

    const auth = new OpenAiAuthService({ codexAuthPath: null, codexCommand: codex });
    const result = await auth.startOAuthLogin();
    expect(result.started).toBe(true);
    expect(result.command).toBe(`${codex} login --device-auth`);
    expect(result.verificationUri).toBe('https://auth.openai.com/codex/device');
    expect(result.userCode).toBe('ABCD-EFGH');
    expect(JSON.stringify(result)).not.toMatch(/access[_-]?token|refresh[_-]?token|Bearer /i);
    auth.dispose();
  });

  it('reports OAuth onboarding and command failures without exposing tokens', () => {
    let auth = new OpenAiAuthService({ codexAuthPath: null });
    const missing = auth.getStatus();
    expect(missing.readiness).toBe('not_configured');
    expect(missing.setupCommand).toBe('codex login');
    expect(missing.onboardingSteps.some((step) => step.id === 'secret_isolation' && step.status === 'complete')).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'beale-openai-auth-failure-'));
    createdDirs.push(dir);
    const failingCommand = join(dir, 'token-fails.sh');
    writeFileSync(failingCommand, '#!/bin/sh\nprintf "Bearer oauth-failure-secret\\n" >&2\nexit 1\n', { mode: 0o700 });
    process.env.BEALE_OPENAI_AUTH_COMMAND = failingCommand;

    auth = new OpenAiAuthService({ codexAuthPath: null });
    const failed = auth.getStatus();
    expect(failed.readiness).toBe('oauth_command_failed');
    expect(failed.oauthCommandConfigured).toBe(true);
    expect(failed.configured).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('oauth-failure-secret');
  });

  it('redacts secrets from model input and compacted replay context', () => {
    const input = {
      ...openAiInput(),
      promptMarkdown: '# Secret prompt\napi_key=sk-1234567890abcdef password=hunter2 Bearer abcdefghijklmnopqrstuvwxyz'
    };
    const initial = buildInitialOpenAiInput(input);
    const initialText = initial[0].content[0].text;
    expect(initialText).toContain('api_key=...redacted');
    expect(initialText).toContain('password=...redacted');
    expect(initialText).toContain('Bearer ...redacted');
    expect(initialText).not.toContain('hunter2');

    const { db } = openDb();
    const context = db.createRun({
      scopeVersionId: db.getActiveScope().id,
      title: 'Replay test',
      promptMarkdown: input.promptMarkdown,
      mode: input.mode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attemptStrategy: input.attemptStrategy,
      networkProfile: input.networkProfile,
      sandboxProfile: input.sandboxProfile,
      budget: { ...input.budget, runEngine: 'openai_responses' }
    });
    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_result',
      source: 'tool',
      summary: 'Tool returned token=supersecret',
      payload: { access_token: 'secret-token-value', nested: { password: 'secret-password' } }
    });
    const replay = buildCompactedReplayOpenAiInput(db.getRunDetail(context.run.id));
    const replayText = replay[0].content[0].text;
    expect(replayText).toContain('token=...redacted');
    expect(replayText).toContain('"access_token":"...redacted"');
    expect(replayText).not.toContain('secret-password');
    db.close();
  });

  it('gives autonomy-forward dynamic mode transition guidance to the model', () => {
    const { db } = openDb();
    const instructions = buildOpenAiInstructions(db.getActiveScope(), { ...openAiInput(), mode: 'dynamic' });

    expect(instructions).toContain('Mode: dynamic');
    expect(instructions).toContain('Work autonomously inside the recorded program scope');
    expect(instructions).toContain('Dynamic mode can move between open discovery, targeted reproduction, patch validation, and variant analysis');
    expect(instructions).toContain('shift into reproduction, verification, chaining, or variant analysis without waiting for user approval');
    expect(instructions).not.toContain('Do not stay in broad discovery');
    expect(instructions).not.toContain('Do not claim');
    db.close();
  });

  it('streams Responses events over WebSocket transport with host authorization', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-test';
    process.env.BEALE_OPENAI_TRANSPORT = 'websocket';
    const sent: string[] = [];
    const sockets: FakeWebSocket[] = [];
    const WebSocketCtor = fakeWebSocketConstructor(sockets, sent);
    const auth = new OpenAiAuthService();
    const adapter = new OpenAiResponsesAdapter(auth, async () => new Response('', { status: 500 }), 'https://api.openai.test/v1', WebSocketCtor);
    const body = adapter.buildRequest({
      model: 'gpt-5.5',
      instructions: 'Return a smoke response.',
      input: buildInitialOpenAiInput(openAiInput()),
      tools: [],
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      metadata: { beale_test: 'websocket', beale_run_id: 'run_ws' }
    });

    const events = [];
    for await (const event of adapter.streamResponse({ body })) {
      events.push(event.type);
    }

    expect(events).toEqual(['response.created', 'response.completed']);
    expect(sockets[0].url).toBe('wss://api.openai.test/v1/responses');
    expect(sockets[0].options.headers.Authorization).toBe('Bearer oauth-token-for-test');
    const request = JSON.parse(sent[0]) as Record<string, unknown>;
    expect(request.type).toBe('response.create');
    expect(request.stream).toBeUndefined();
    expect(request.store).toBe(false);

    const followup = {
      ...body,
      previous_response_id: 'resp_ws_1',
      input: [{ type: 'function_call_output' as const, call_id: 'call_ws_1', output: '{"ok":true}' }]
    };
    for await (const _event of adapter.streamResponse({ body: followup })) {
      // Drain the second response to prove the same socket can continue a run.
    }
    expect(sockets).toHaveLength(1);
    expect((JSON.parse(sent[1]) as Record<string, unknown>).previous_response_id).toBe('resp_ws_1');
    adapter.closeWebSocketSession('run_ws');
  });

  it('routes Codex OAuth sessions through the ChatGPT Codex Responses backend', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beale-codex-backend-'));
    createdDirs.push(dir);
    const authPath = join(dir, 'auth.json');
    const token = fakeCodexAccessToken('codex-account-123');
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: token
        }
      })
    );

    const seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
      });
      return new Response(
        sse(event('response.output_text.done', { type: 'response.output_text.done', text: 'done' }) + event('response.done', { type: 'response.done', response: { id: 'resp_codex' } })),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
    };

    const auth = new OpenAiAuthService({ codexAuthPath: authPath });
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1', null, 'https://chatgpt.test/backend-api');
    const body = adapter.buildRequest({
      model: 'gpt-5.5',
      instructions: 'Return done.',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'test' }] }],
      tools: [],
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      metadata: { beale_run_id: 'run_codex_backend' }
    });

    const events = [];
    for await (const streamEvent of adapter.streamResponse({ body })) {
      events.push(streamEvent.type);
    }

    expect(seen[0].url).toBe('https://chatgpt.test/backend-api/codex/responses');
    expect(seen[0].headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(seen[0].headers.get('chatgpt-account-id')).toBe('codex-account-123');
    expect(seen[0].headers.get('originator')).toBe('beale');
    expect(seen[0].headers.get('OpenAI-Beta')).toBe('responses=experimental');
    expect(seen[0].headers.get('session_id')).toBe('run_codex_backend');
    expect(seen[0].body.model).toBe('gpt-5.5');
    expect(seen[0].body.metadata).toBeUndefined();
    expect(seen[0].body.prompt_cache_key).toBe('run_codex_backend');
    expect(seen[0].body.include).toEqual(['reasoning.encrypted_content']);
    expect(seen[0].body.reasoning).toEqual({ effort: 'low', summary: 'auto' });
    expect(seen[0].body).not.toHaveProperty('previous_response_id');
    expect(events).toEqual(['response.output_text.done', 'response.completed']);

    const followupBody = adapter.buildRequest({
      model: 'gpt-5.5',
      instructions: 'Continue.',
      input: [{ type: 'function_call_output', call_id: 'call_codex_1', output: '{"ok":true}' }],
      tools: [],
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      previous_response_id: 'resp_codex',
      metadata: { beale_run_id: 'run_codex_backend' }
    });
    for await (const _streamEvent of adapter.streamResponse({ body: followupBody })) {
      // Drain the follow-up request.
    }
    expect(seen[1].headers.get('session_id')).toBe('run_codex_backend');
    expect(seen[1].body.previous_response_id).toBe('resp_codex');
  });

  it('constructs a host-only Responses request and routes model tool calls through Beale policy', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-test';
    const requests: unknown[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      const previousResponseId = body.previous_response_id;
      return new Response(previousResponseId ? sse(finalResponseEvents()) : sse(toolCallEvents()), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      });
    };

    const { db, dir } = openDb();
    db.saveProgramScope({
      programName: 'OpenAI Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Scoped OpenAI engine test.',
      rulesMarkdown: 'No unscoped network.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [
        { direction: 'in_scope', kind: 'domain', value: 'api.example.test', sensitivity: 'internal', attributes: {} },
        { direction: 'out_of_scope', kind: 'domain', value: 'blocked.example.test', sensitivity: 'internal', attributes: {} }
      ]
    });

    const auth = new OpenAiAuthService();
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    const detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('completed');
    expect(detail.modelSessions[0].provider).toBe('openai');
    expect(detail.modelSessions[0].previousResponseId).toBe('resp_2');
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI streamed model output delta.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI completed function call arguments for search.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.type === 'tool_result' && event.source === 'tool')).toBe(true);
    expect(detail.transcriptMessages.map((message) => message.contentMarkdown)).toEqual([
      '# OpenAI test\nUse Beale tools before making observations.',
      'I need to inspect scoped metadata before choosing a tool.',
      'I should record concrete hypotheses as state.',
      'I will search scoped metadata first.',
      'No verified finding yet.'
    ]);
    expect(detail.transcriptMessages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'assistant', 'assistant']);
    expect(detail.transcriptMessages.map((message) => message.source)).toEqual([
      'run_prompt',
      'openai_reasoning_summary',
      'openai_reasoning_summary',
      'openai_response_output',
      'openai_response_output'
    ]);
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI completed thought.')).toBe(true);
    const notifications = db.listNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe('session_final_response');
    expect(notifications[0].bodyMarkdown).toBe('No verified finding yet.');

    const firstRequest = requests[0] as Record<string, unknown>;
    expect(firstRequest.model).toBe('gpt-5.5');
    expect(firstRequest.store).toBe(false);
    expect(firstRequest.stream).toBe(true);
    expect(firstRequest.reasoning).toEqual({ effort: 'xhigh' });
    expect(Array.isArray(firstRequest.tools)).toBe(true);
    expect(firstRequest).not.toHaveProperty('previous_response_id');

    const secondRequest = requests[1] as Record<string, unknown>;
    expect(secondRequest.previous_response_id).toBe('resp_1');
    expect(JSON.stringify(secondRequest.input)).toContain('function_call_output');

    db.close();
    expect(dir).toContain('beale-openai-test-');
  });

  it('retries retryable OpenAI transport failures without failing the session', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-test';
    process.env.BEALE_OPENAI_TRANSPORT_RETRY_DELAY_MS = '0';
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        throw new TypeError('fetch failed');
      }
      return new Response(sse(finalResponseEvents('resp_after_transport_retry')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const { db } = openDb();
    const auth = new OpenAiAuthService();
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    const detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('completed');
    expect(requests).toHaveLength(2);
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI transport error was retryable; retrying request.' && event.payload.retryAttempt === 1)).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI Responses run failed.')).toBe(false);
    db.close();
  });

  it('uses manual response replay for Codex OAuth tool outputs', async () => {
    const authDir = mkdtempSync(join(tmpdir(), 'beale-codex-engine-'));
    createdDirs.push(authDir);
    const authPath = join(authDir, 'auth.json');
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: fakeCodexAccessToken('codex-account-123')
        }
      })
    );

    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (body.previous_response_id) {
        return new Response(JSON.stringify({ detail: 'Unsupported parameter: previous_response_id' }), { status: 400 });
      }
      if (requests.length === 1) {
        return new Response(sse(toolCallEvents('resp_codex_1', 'call_codex_1')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(sse(finalResponseEvents('resp_codex_2')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const { db } = openDb();
    const auth = new OpenAiAuthService({ codexAuthPath: authPath });
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1', null, 'https://chatgpt.test/backend-api');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    const detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('completed');
    expect(detail.modelSessions[0].previousResponseId).toBeNull();
    expect(detail.modelSessions[0].metadata.previousResponseIdUnsupported).toBe(true);

    expect(requests).toHaveLength(2);
    expect(requests[0]).not.toHaveProperty('previous_response_id');
    expect(requests[1]).not.toHaveProperty('previous_response_id');
    const replayInput = requests[1].input as Array<Record<string, unknown>>;
    expect(replayInput.some((item) => item.type === 'message')).toBe(true);
    expect(replayInput.some((item) => item.type === 'function_call' && item.call_id === 'call_codex_1')).toBe(true);
    expect(replayInput.some((item) => item.type === 'function_call_output' && item.call_id === 'call_codex_1')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI Responses request sent for turn 2.' && event.payload.replayMode === 'manual_response_replay')).toBe(true);
    db.close();
  });

  it('proactively compacts long manual response replay before it hits the context window', async () => {
    process.env.BEALE_OPENAI_COMPACT_MANUAL_TURNS = '1';
    const authDir = mkdtempSync(join(tmpdir(), 'beale-codex-compaction-'));
    createdDirs.push(authDir);
    const authPath = join(authDir, 'auth.json');
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: fakeCodexAccessToken('codex-account-123')
        }
      })
    );

    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (requests.length <= 2) {
        return new Response(sse(toolCallEvents(`resp_compact_${requests.length}`, `call_compact_${requests.length}`)), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        });
      }
      return new Response(sse(finalResponseEvents('resp_compact_final')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const { db } = openDb();
    const auth = new OpenAiAuthService({ codexAuthPath: authPath });
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1', null, 'https://chatgpt.test/backend-api');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    const detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('completed');
    expect(detail.contextCompactions).toHaveLength(2);
    expect(detail.contextCompactions[0].reason).toBe('manual_replay_turn_limit');
    expect(detail.contextCompactions[0].previousCompactionId).toBeNull();
    expect(detail.contextCompactions[1].reason).toBe('manual_replay_turn_limit');
    expect(detail.contextCompactions[1].previousCompactionId).toBe(detail.contextCompactions[0].id);
    expect(detail.traceEvents.some((event) => event.summary === 'Context compacted for long-running session.' && event.payload.reason === 'manual_replay_turn_limit')).toBe(true);

    const compactedRequest = requests[1];
    expect(JSON.stringify(compactedRequest.input)).toContain('Compacted Beale Run Replay');
    const session = db.getRunDetail(handle.context.run.id).modelSessions[0];
    const manualConversationInput = session.metadata.manualConversationInput as Array<Record<string, unknown>>;
    expect(manualConversationInput.filter((item) => item.type === 'function_call').length).toBeLessThanOrEqual(1);
    db.close();
  });

  it('compacts and retries once after a context-window error', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-test';
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return new Response(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'Your input exceeds the context window of this model.' } }), { status: 400 });
      }
      return new Response(sse(finalResponseEvents('resp_after_context_compaction')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const { db } = openDb();
    const auth = new OpenAiAuthService();
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    const detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('completed');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].input)).toContain('Compacted Beale Run Replay');
    expect(detail.contextCompactions).toHaveLength(1);
    expect(detail.contextCompactions[0].reason).toBe('context_window_error');
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI context window pressure triggered compacted retry.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI compacted retry recovered from context window pressure.')).toBe(true);
    db.close();
  });

  it('replays compacted context when previous_response_id cannot be recovered', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-test';
    const requests: unknown[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return new Response(sse(toolCallEvents('resp_1', 'call_1')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (requests.length === 2) {
        return new Response(sse(previousResponseMissingEvents()), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(sse(finalResponseEvents('resp_3')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const { db } = openDb();
    const auth = new OpenAiAuthService();
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    const detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('completed');
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI previous response state was unavailable; retrying with compacted Beale replay context.')).toBe(true);
    expect((requests[1] as Record<string, unknown>).previous_response_id).toBe('resp_1');
    expect(requests[2] as Record<string, unknown>).not.toHaveProperty('previous_response_id');
    expect(JSON.stringify((requests[2] as Record<string, unknown>).input)).toContain('Compacted Beale Run Replay');
    db.close();
  });

  it('resumes a paused OpenAI run from persisted pending tool output', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-test';
    process.env.BEALE_OPENAI_MAX_TOOL_TURNS = '4';
    const requests: unknown[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (requests.length <= 4) {
        return new Response(sse(toolCallEvents(`resp_${requests.length}`, `call_${requests.length}`)), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        });
      }
      return new Response(sse(finalResponseEvents('resp_5')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const { db } = openDb();
    const auth = new OpenAiAuthService();
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    let detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('paused');
    expect(detail.modelSessions[0].previousResponseId).toBe('resp_4');
    expect(JSON.stringify(detail.modelSessions[0].metadata.pendingInput)).toContain('function_call_output');

    const resumed = engine.resumeRun(handle.context.run.id);
    await resumed?.completion;
    detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('completed');
    expect((requests[4] as Record<string, unknown>).previous_response_id).toBe('resp_4');
    expect(JSON.stringify((requests[4] as Record<string, unknown>).input)).toContain('function_call_output');
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI run resumed from persisted Responses state.')).toBe(true);
    db.close();
  });

  it('continues past the legacy four-turn development cap by default', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-test';
    const requests: unknown[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (requests.length <= 5) {
        return new Response(sse(toolCallEvents(`resp_${requests.length}`, `call_${requests.length}`)), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        });
      }
      return new Response(sse(finalResponseEvents('resp_6')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const { db } = openDb();
    const auth = new OpenAiAuthService();
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    const detail = db.getRunDetail(handle.context.run.id);
    expect(detail.run.status).toBe('completed');
    expect(requests).toHaveLength(6);
    expect(detail.modelSessions[0].status).toBe('completed');
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI Responses request sent for turn 5.')).toBe(true);
    db.close();
  });

  it('blocks OpenAI runs before API calls when no host credential is configured', async () => {
    delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
    delete process.env.OPENAI_API_KEY;
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return new Response('', { status: 500 });
    };
    const { db } = openDb();
    const auth = new OpenAiAuthService();
    const adapter = new OpenAiResponsesAdapter(auth, fetchImpl, 'https://api.openai.test/v1');
    const engine = new OpenAiRunEngine(db, auth, adapter);
    const handle = engine.startRun(openAiInput());
    await handle.completion;

    const detail = db.getRunDetail(handle.context.run.id);
    expect(called).toBe(false);
    expect(detail.run.status).toBe('blocked');
    expect(detail.modelSessions[0].status).toBe('blocked_auth');
    expect(detail.traceEvents.some((event) => event.summary === 'OpenAI run blocked because no host credential is configured.')).toBe(true);
    db.close();
  });
});

function openDb(): { db: WorkspaceDatabase; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beale-openai-test-'));
  createdDirs.push(dir);
  const artifactRoot = join(dir, '.beale', 'artifacts');
  mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
  const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
  db.initialize();
  return { db, dir };
}

function openAiInput(): StartRunInput {
  return {
    runEngine: 'openai_responses',
    promptMarkdown: '# OpenAI test\nUse Beale tools before making observations.',
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
    fakeScenario: 'adaptive_portfolio'
  };
}

function toolCallEvents(responseId = 'resp_1', callId = 'call_1'): string {
  return [
    event('response.created', { type: 'response.created', response: { id: responseId } }),
    event('response.reasoning_summary_text.done', {
      type: 'response.reasoning_summary_text.done',
      response_id: responseId,
      item_id: 'rs_1',
      summary_index: 0,
      text: 'I need to inspect scoped metadata before choosing a tool.'
    }),
    event('response.reasoning_summary_text.done', {
      type: 'response.reasoning_summary_text.done',
      response_id: responseId,
      item_id: 'rs_1',
      summary_index: 1,
      text: 'I should record concrete hypotheses as state.'
    }),
    event('response.output_item.done', {
      type: 'response.output_item.done',
      response_id: responseId,
      item: {
        type: 'reasoning',
        id: 'rs_1',
        status: 'completed',
        summary: [
          { type: 'summary_text', text: 'I need to inspect scoped metadata before choosing a tool.' },
          { type: 'summary_text', text: 'I should record concrete hypotheses as state.' }
        ]
      }
    }),
    event('response.output_text.delta', { type: 'response.output_text.delta', response_id: responseId, delta: 'Checking scope.' }),
    event('response.output_text.done', {
      type: 'response.output_text.done',
      response_id: responseId,
      item_id: 'msg_1',
      content_index: 0,
      text: 'I will search scoped metadata first.'
    }),
    event('response.output_item.done', {
      type: 'response.output_item.done',
      response_id: responseId,
      item: {
        type: 'message',
        id: 'msg_1',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'I will search scoped metadata first.', annotations: [] }]
      }
    }),
    event('response.output_item.done', {
      type: 'response.output_item.done',
      response_id: responseId,
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: callId,
        name: 'search',
        arguments: '{"query":"authorization boundary","target":"local"}',
        status: 'completed'
      }
    }),
    event('response.completed', {
      type: 'response.completed',
      response: {
        id: responseId,
        output: [
          {
            type: 'reasoning',
            id: 'rs_1',
            status: 'completed',
            summary: [
              { type: 'summary_text', text: 'I need to inspect scoped metadata before choosing a tool.' },
              { type: 'summary_text', text: 'I should record concrete hypotheses as state.' }
            ]
          },
          {
            type: 'message',
            id: 'msg_1',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'I will search scoped metadata first.', annotations: [] }]
          }
        ],
        usage: { total_tokens: 42 }
      }
    })
  ].join('');
}

function finalResponseEvents(responseId = 'resp_2'): string {
  return [
    event('response.created', { type: 'response.created', response: { id: responseId } }),
    event('response.output_item.done', {
      type: 'response.output_item.done',
      response_id: responseId,
      item: {
        type: 'message',
        id: 'msg_final',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'No verified finding yet.', annotations: [] }]
      }
    }),
    event('response.completed', {
      type: 'response.completed',
      response: {
        id: responseId,
        output: [
          {
            type: 'message',
            id: 'msg_final',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'No verified finding yet.', annotations: [] }]
          }
        ],
        usage: { total_tokens: 24 }
      }
    })
  ].join('');
}

function previousResponseMissingEvents(): string {
  return [
    event('error', {
      type: 'error',
      status: 400,
      error: {
        code: 'previous_response_not_found',
        message: "Previous response with id 'resp_1' not found.",
        param: 'previous_response_id'
      }
    })
  ].join('');
}

function event(name: string, data: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function fakeCodexAccessToken(accountId: string): string {
  return [
    base64UrlJson({ alg: 'none', typ: 'JWT' }),
    base64UrlJson({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
    'signature'
  ].join('.');
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sse(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

function fakeWebSocketConstructor(sockets: FakeWebSocket[], sent: string[]): WebSocketConstructorLike {
  return class TestWebSocket extends FakeWebSocket {
    public constructor(url: string, options: { headers: Record<string, string> }) {
      super(url, options, sockets, sent);
    }
  };
}

class FakeWebSocket implements WebSocketLike {
  private readonly openListeners: Array<() => void> = [];
  private readonly messageListeners: Array<(data: unknown) => void> = [];
  private readonly errorListeners: Array<(error: Error) => void> = [];
  private readonly closeListeners: Array<(code: number, reason: Buffer) => void> = [];

  public constructor(
    public readonly url: string,
    public readonly options: { headers: Record<string, string> },
    sockets: FakeWebSocket[],
    private readonly sent: string[]
  ) {
    sockets.push(this);
    queueMicrotask(() => this.openListeners.forEach((listener) => listener()));
  }

  public on(event: 'open', listener: () => void): WebSocketLike;
  public on(event: 'message', listener: (data: unknown) => void): WebSocketLike;
  public on(event: 'error', listener: (error: Error) => void): WebSocketLike;
  public on(event: 'close', listener: (code: number, reason: Buffer) => void): WebSocketLike;
  public on(
    event: 'open' | 'message' | 'error' | 'close',
    listener: (() => void) | ((data: unknown) => void) | ((error: Error) => void) | ((code: number, reason: Buffer) => void)
  ): WebSocketLike {
    switch (event) {
      case 'open':
        this.openListeners.push(listener as () => void);
        break;
      case 'message':
        this.messageListeners.push(listener as (data: unknown) => void);
        break;
      case 'error':
        this.errorListeners.push(listener as (error: Error) => void);
        break;
      case 'close':
        this.closeListeners.push(listener as (code: number, reason: Buffer) => void);
        break;
    }
    return this;
  }

  public send(data: string): void {
    this.sent.push(data);
    queueMicrotask(() => {
      this.messageListeners.forEach((listener) => listener(JSON.stringify({ type: 'response.created', response: { id: 'resp_ws_1' } })));
      this.messageListeners.forEach((listener) => listener(JSON.stringify({ type: 'response.completed', response: { id: 'resp_ws_1' } })));
    });
  }

  public close(): void {
    this.closeListeners.forEach((listener) => listener(1000, Buffer.alloc(0)));
  }
}
