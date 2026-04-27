import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { buildCompactedReplayOpenAiInput, buildInitialOpenAiInput } from '../src/main/openaiContext';
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

  it('reports OAuth onboarding and command failures without exposing tokens', () => {
    let auth = new OpenAiAuthService();
    const missing = auth.getStatus();
    expect(missing.readiness).toBe('not_configured');
    expect(missing.setupCommand).toBe('codex login');
    expect(missing.onboardingSteps.some((step) => step.id === 'secret_isolation' && step.status === 'complete')).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'beale-openai-auth-failure-'));
    createdDirs.push(dir);
    const failingCommand = join(dir, 'token-fails.sh');
    writeFileSync(failingCommand, '#!/bin/sh\nprintf "Bearer oauth-failure-secret\\n" >&2\nexit 1\n', { mode: 0o700 });
    process.env.BEALE_OPENAI_AUTH_COMMAND = failingCommand;

    auth = new OpenAiAuthService();
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

    const firstRequest = requests[0] as Record<string, unknown>;
    expect(firstRequest.model).toBe('gpt-5.5');
    expect(firstRequest.store).toBe(false);
    expect(firstRequest.stream).toBe(true);
    expect(firstRequest.reasoning).toEqual({ effort: 'xhigh' });
    expect(Array.isArray(firstRequest.tools)).toBe(true);

    const secondRequest = requests[1] as Record<string, unknown>;
    expect(secondRequest.previous_response_id).toBe('resp_1');
    expect(JSON.stringify(secondRequest.input)).toContain('function_call_output');

    db.close();
    expect(dir).toContain('beale-openai-test-');
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
    expect((requests[2] as Record<string, unknown>).previous_response_id).toBeNull();
    expect(JSON.stringify((requests[2] as Record<string, unknown>).input)).toContain('Compacted Beale Run Replay');
    db.close();
  });

  it('resumes a paused OpenAI run from persisted pending tool output', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-token-for-test';
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
    event('response.output_text.delta', { type: 'response.output_text.delta', response_id: responseId, delta: 'Checking scope.' }),
    event('response.output_text.done', { type: 'response.output_text.done', response_id: responseId, text: 'I will search scoped metadata first.' }),
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
    event('response.completed', { type: 'response.completed', response: { id: responseId, usage: { total_tokens: 42 } } })
  ].join('');
}

function finalResponseEvents(responseId = 'resp_2'): string {
  return [
    event('response.created', { type: 'response.created', response: { id: responseId } }),
    event('response.output_text.done', { type: 'response.output_text.done', response_id: responseId, text: 'No verified finding yet.' }),
    event('response.completed', { type: 'response.completed', response: { id: responseId, usage: { total_tokens: 24 } } })
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
