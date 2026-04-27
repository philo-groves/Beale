import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { OpenAiResponsesAdapter, parseSseEvent, parseSseStream, type FetchLike } from '../src/main/openaiAdapter';
import { OpenAiAuthService } from '../src/main/openaiAuth';
import { OpenAiRunEngine } from '../src/main/openaiRunEngine';
import type { StartRunInput } from '../src/shared/types';

const createdDirs: string[] = [];

afterEach(() => {
  delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
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

function toolCallEvents(): string {
  return [
    event('response.created', { type: 'response.created', response: { id: 'resp_1' } }),
    event('response.output_text.delta', { type: 'response.output_text.delta', response_id: 'resp_1', delta: 'Checking scope.' }),
    event('response.output_text.done', { type: 'response.output_text.done', response_id: 'resp_1', text: 'I will search scoped metadata first.' }),
    event('response.output_item.done', {
      type: 'response.output_item.done',
      response_id: 'resp_1',
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'search',
        arguments: '{"query":"authorization boundary","target":"local"}',
        status: 'completed'
      }
    }),
    event('response.completed', { type: 'response.completed', response: { id: 'resp_1', usage: { total_tokens: 42 } } })
  ].join('');
}

function finalResponseEvents(): string {
  return [
    event('response.created', { type: 'response.created', response: { id: 'resp_2' } }),
    event('response.output_text.done', { type: 'response.output_text.done', response_id: 'resp_2', text: 'No verified finding yet.' }),
    event('response.completed', { type: 'response.completed', response: { id: 'resp_2', usage: { total_tokens: 24 } } })
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
