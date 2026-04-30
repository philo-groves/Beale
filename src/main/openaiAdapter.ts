import type { OpenAiTransport, ProfilingMetricDetail } from '@shared/types';
import { arch, platform, release } from 'node:os';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { OpenAiAuthService, type OpenAiCredential, resolveOpenAiTransport } from './openaiAuth';
import type { OpenAiToolDefinition } from './openaiTools';
import NodeWebSocket from 'ws';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const CODEX_SSE_BETA_HEADER = 'responses=experimental';
const CODEX_WEBSOCKET_BETA_HEADER = 'responses_websockets=2026-02-06';
const STREAM_EVENT_LOOP_YIELD_BATCH = 25;

export interface ResponseInputMessage {
  type: 'message';
  role: 'user' | 'developer' | 'system';
  content: Array<{ type: 'input_text'; text: string }>;
}

export interface FunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export interface FunctionCallInputItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
  status?: 'completed';
}

export type ResponseInputItem = ResponseInputMessage | FunctionCallInputItem | FunctionCallOutputItem;

export interface OpenAiResponseCreateBody {
  model: string;
  instructions: string;
  input: ResponseInputItem[];
  tools: OpenAiToolDefinition[];
  tool_choice: 'auto';
  parallel_tool_calls: boolean;
  stream: boolean;
  store: boolean;
  reasoning: {
    effort: string;
  };
  text: {
    verbosity: 'low' | 'medium' | 'high';
  };
  previous_response_id?: string | null;
  metadata: Record<string, string>;
}

type OpenAiResponseWireBody = Omit<OpenAiResponseCreateBody, 'metadata' | 'reasoning'> & {
  metadata?: Record<string, string>;
  reasoning: {
    effort: string;
    summary?: string;
  };
  include?: string[];
  prompt_cache_key?: string;
};

export interface StreamResponseInput {
  body: OpenAiResponseCreateBody;
  signal?: AbortSignal;
}

export interface OpenAiStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface FetchLike {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface WebSocketLike {
  on(event: 'open', listener: () => void): WebSocketLike;
  on(event: 'message', listener: (data: unknown) => void): WebSocketLike;
  on(event: 'error', listener: (error: Error) => void): WebSocketLike;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): WebSocketLike;
  send(data: string): void;
  close(): void;
}

export interface WebSocketConstructorLike {
  new (url: string, options: { headers: Record<string, string> }): WebSocketLike;
}

export interface OpenAiProfilingRecorder {
  (name: string, durationMs: number, detail: ProfilingMetricDetail): void;
}

export class OpenAiApiError extends Error {
  public constructor(
    message: string,
    public readonly code: string | null = null,
    public readonly status: number | null = null
  ) {
    super(message);
    this.name = 'OpenAiApiError';
  }
}

export class OpenAiResponsesAdapter {
  private readonly baseUrl: string;
  private readonly webSocketSessions = new Map<string, OpenAiWebSocketSession>();

  public constructor(
    private readonly auth: OpenAiAuthService = new OpenAiAuthService(),
    private readonly fetchImpl: FetchLike = fetch,
    baseUrl = process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
    private readonly webSocketImpl: WebSocketConstructorLike | null = NodeWebSocket as unknown as WebSocketConstructorLike,
    codexBaseUrl = process.env.BEALE_OPENAI_CODEX_BASE_URL ?? DEFAULT_CODEX_BASE_URL,
    private readonly profilingRecorder: OpenAiProfilingRecorder | null = null
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.codexBaseUrl = codexBaseUrl.replace(/\/$/, '');
  }

  private readonly codexBaseUrl: string;

  public getTransport(): OpenAiTransport {
    return resolveOpenAiTransport(this.webSocketImpl !== null) === 'websocket' ? 'websocket' : 'sse_http';
  }

  public usesManualConversationState(): boolean {
    const credential = this.auth.getCredential();
    return credential ? usesCodexBackend(credential) : false;
  }

  public buildRequest(input: Omit<OpenAiResponseCreateBody, 'stream' | 'store' | 'tool_choice' | 'parallel_tool_calls'>): OpenAiResponseCreateBody {
    return {
      ...input,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      stream: true,
      store: false
    };
  }

  public async *streamResponse(input: StreamResponseInput): AsyncGenerator<OpenAiStreamEvent> {
    if (this.getTransport() === 'websocket') {
      yield* this.streamWebSocketResponse(input);
      return;
    }
    yield* this.streamSseResponse(input);
  }

  private async *streamSseResponse(input: StreamResponseInput): AsyncGenerator<OpenAiStreamEvent> {
    const startedAt = performance.now();
    let source = 'unknown';
    let status = 'completed';
    let eventCount = 0;
    let firstEventMs = -1;
    let yieldCount = 0;

    try {
      const credential = this.auth.getCredentialOrThrow();
      source = credential.source;
      const sessionId = input.body.metadata.beale_run_id;
      const response = await this.fetchImpl(this.responsesHttpUrl(credential), {
        method: 'POST',
        headers: this.sseHeaders(credential, sessionId),
        body: JSON.stringify(wireBodyForCredential(credential, input.body, sessionId)),
        signal: input.signal
      });

      if (!response.ok) {
        status = `http_${response.status}`;
        const body = await response.text().catch(() => '');
        throw openAiApiErrorFromBody(response.status, body);
      }

      if (!response.body) {
        status = 'empty_body';
        throw new Error('OpenAI Responses API returned an empty stream body.');
      }

      for await (const event of parseSseStream(response.body)) {
        eventCount += 1;
        if (firstEventMs < 0) {
          firstEventMs = performance.now() - startedAt;
        }
        yield normalizeOpenAiStreamEvent(event);
        if (shouldYieldOpenAiStream(eventCount)) {
          yieldCount += 1;
          await yieldImmediate();
        }
      }
    } catch (error) {
      if (status === 'completed') status = error instanceof Error && error.name === 'AbortError' ? 'aborted' : 'error';
      throw error;
    } finally {
      this.recordProfilingTiming('openai.responses.stream', performance.now() - startedAt, {
        transport: 'sse_http',
        model: input.body.model,
        source,
        status,
        events: eventCount,
        yields: yieldCount,
        firstEventMs: roundMs(firstEventMs)
      });
    }
  }

  private async *streamWebSocketResponse(input: StreamResponseInput): AsyncGenerator<OpenAiStreamEvent> {
    const startedAt = performance.now();
    let source = 'unknown';
    let status = 'completed';
    let eventCount = 0;
    let firstEventMs = -1;
    let yieldCount = 0;

    if (!this.webSocketImpl) {
      throw new Error('OpenAI Responses WebSocket transport is not available in this host process.');
    }

    try {
      const credential = this.auth.getCredentialOrThrow();
      source = credential.source;
      const sessionKey = input.body.metadata.beale_run_id || 'default';
      const session = this.getWebSocketSession(sessionKey, credential);
      try {
        for await (const event of session.stream(wireBodyForCredential(credential, input.body, sessionKey), input.signal)) {
          eventCount += 1;
          if (firstEventMs < 0) {
            firstEventMs = performance.now() - startedAt;
          }
          yield event;
          if (shouldYieldOpenAiStream(eventCount)) {
            yieldCount += 1;
            await yieldImmediate();
          }
        }
      } finally {
        if (session.isClosed()) {
          this.webSocketSessions.delete(sessionKey);
        }
      }
    } catch (error) {
      status = error instanceof Error && error.message.includes('aborted') ? 'aborted' : 'error';
      throw error;
    } finally {
      this.recordProfilingTiming('openai.responses.stream', performance.now() - startedAt, {
        transport: 'websocket',
        model: input.body.model,
        source,
        status,
        events: eventCount,
        yields: yieldCount,
        firstEventMs: roundMs(firstEventMs)
      });
    }
  }

  public closeWebSocketSession(sessionKey: string): void {
    const session = this.webSocketSessions.get(sessionKey);
    session?.close();
    this.webSocketSessions.delete(sessionKey);
  }

  public closeAllWebSocketSessions(): void {
    for (const session of this.webSocketSessions.values()) {
      session.close();
    }
    this.webSocketSessions.clear();
  }

  private responsesHttpUrl(credential: OpenAiCredential): string {
    if (usesCodexBackend(credential)) return resolveCodexResponsesUrl(this.codexBaseUrl);
    return `${this.baseUrl}/responses`;
  }

  private responsesWebSocketUrl(credential: OpenAiCredential): string {
    const url = new URL(this.responsesHttpUrl(credential));
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    return url.toString();
  }

  private sseHeaders(credential: OpenAiCredential, sessionId?: string): Record<string, string> {
    if (!usesCodexBackend(credential)) {
      return {
        Authorization: `Bearer ${credential.token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      };
    }

    const accountId = requireCodexAccountId(credential);
    return {
      Authorization: `Bearer ${credential.token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'OpenAI-Beta': CODEX_SSE_BETA_HEADER,
      'chatgpt-account-id': accountId,
      originator: 'beale',
      'User-Agent': bealeUserAgent(),
      ...(sessionId ? { session_id: sessionId, 'x-client-request-id': sessionId } : {})
    };
  }

  private webSocketHeaders(credential: OpenAiCredential, sessionKey: string): Record<string, string> {
    if (!usesCodexBackend(credential)) {
      return { Authorization: `Bearer ${credential.token}` };
    }

    return {
      Authorization: `Bearer ${credential.token}`,
      'OpenAI-Beta': CODEX_WEBSOCKET_BETA_HEADER,
      'chatgpt-account-id': requireCodexAccountId(credential),
      originator: 'beale',
      'User-Agent': bealeUserAgent(),
      session_id: sessionKey,
      'x-client-request-id': sessionKey
    };
  }

  private getWebSocketSession(sessionKey: string, credential: OpenAiCredential): OpenAiWebSocketSession {
    const existing = this.webSocketSessions.get(sessionKey);
    if (existing && !existing.isClosed()) {
      return existing;
    }
    const session = new OpenAiWebSocketSession(this.responsesWebSocketUrl(credential), this.webSocketHeaders(credential, sessionKey), this.webSocketImpl as WebSocketConstructorLike);
    this.webSocketSessions.set(sessionKey, session);
    return session;
  }

  private recordProfilingTiming(name: string, durationMs: number, detail: ProfilingMetricDetail): void {
    this.profilingRecorder?.(name, roundMs(durationMs), detail);
  }
}

export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<OpenAiStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const eventText of events) {
        const parsed = parseSseEvent(eventText);
        if (parsed) yield parsed;
      }
    }

    buffer += decoder.decode();
    const parsed = parseSseEvent(buffer);
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

export function parseSseEvent(raw: string): OpenAiStreamEvent | null {
  const dataLines = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n');
  if (data === '[DONE]') return null;
  const parsed: unknown = JSON.parse(data);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as OpenAiStreamEvent;
}

export function openAiApiErrorFromEvent(event: OpenAiStreamEvent): OpenAiApiError {
  const payload = event.error;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : null;
    const message = typeof record.message === 'string' ? record.message : errorMessage(payload);
    const status = typeof event.status === 'number' ? event.status : null;
    return new OpenAiApiError(message, code, status);
  }
  return new OpenAiApiError(errorMessage(payload ?? event), null, typeof event.status === 'number' ? event.status : null);
}

export function openAiErrorCode(error: unknown): string | null {
  return error instanceof OpenAiApiError ? error.code : null;
}

function toWebSocketRequest(body: OpenAiResponseWireBody): Omit<OpenAiResponseWireBody, 'stream'> & { type: 'response.create' } {
  const { stream: _stream, ...request } = body;
  return {
    type: 'response.create',
    ...request
  };
}

function parseWebSocketEvent(data: unknown): OpenAiStreamEvent | null {
  const text = webSocketDataToString(data);
  if (!text) return null;
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as OpenAiStreamEvent;
}

function webSocketDataToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data) && data.every((item) => Buffer.isBuffer(item))) {
    return Buffer.concat(data).toString('utf8');
  }
  return '';
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function shouldYieldOpenAiStream(eventCount: number): boolean {
  return eventCount > 0 && eventCount % STREAM_EVENT_LOOP_YIELD_BATCH === 0;
}

class OpenAiWebSocketSession {
  private readonly socket: WebSocketLike;
  private readonly openPromise: Promise<void>;
  private queue: AsyncEventQueue<OpenAiStreamEvent> | null = null;
  private closed = false;
  private activeFinished = false;
  private activeAborted = false;

  public constructor(url: string, headers: Record<string, string>, webSocketImpl: WebSocketConstructorLike) {
    this.socket = new webSocketImpl(url, {
      headers
    });
    this.openPromise = waitForWebSocketOpen(this.socket);

    this.socket.on('message', (data) => this.handleMessage(data));
    this.socket.on('error', (error) => {
      this.closed = true;
      this.queue?.fail(error);
    });
    this.socket.on('close', (code, reason) => {
      this.closed = true;
      if (this.queue && !this.activeFinished && !this.activeAborted) {
        const detail = reason.length > 0 ? `: ${reason.toString('utf8')}` : '';
        this.queue.fail(new Error(`OpenAI Responses WebSocket closed before completion (${code})${detail}`));
        return;
      }
      this.queue?.end();
    });
  }

  public async *stream(body: OpenAiResponseWireBody, signal?: AbortSignal): AsyncGenerator<OpenAiStreamEvent> {
    if (this.closed) {
      throw new Error('OpenAI Responses WebSocket session is closed.');
    }
    if (this.queue) {
      throw new Error('OpenAI Responses WebSocket session already has an in-flight response.');
    }

    const queue = new AsyncEventQueue<OpenAiStreamEvent>();
    this.queue = queue;
    this.activeFinished = false;
    this.activeAborted = false;

    const abort = (): void => {
      this.activeAborted = true;
      this.close();
      queue.fail(new Error('OpenAI Responses WebSocket stream aborted.'));
    };
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      await this.openPromise;
      this.socket.send(JSON.stringify(toWebSocketRequest(body)));
      while (true) {
        const item = await queue.next();
        if (item.done) break;
        yield item.value;
      }
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.queue === queue) {
        this.queue = null;
      }
    }
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
  }

  private handleMessage(data: unknown): void {
    const parsed = parseWebSocketEvent(data);
    const event = parsed ? normalizeOpenAiStreamEvent(parsed) : null;
    if (!event || !this.queue) return;
    this.queue.push(event);
    if (event.type === 'response.completed' || event.type === 'error') {
      this.activeFinished = true;
      this.queue.end();
    }
  }
}

function waitForWebSocketOpen(socket: WebSocketLike, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('OpenAI Responses WebSocket stream aborted.'));
      return;
    }
    socket.on('open', () => resolve());
    socket.on('error', (error) => reject(error));
    socket.on('close', (code, reason) => {
      reject(new Error(`OpenAI Responses WebSocket closed before opening (${code}): ${reason.toString('utf8')}`));
    });
  });
}

interface AsyncQueueResult<T> {
  done: boolean;
  value: T;
}

class AsyncEventQueue<T> {
  private readonly items: Array<AsyncQueueResult<T>> = [];
  private waiters: Array<(item: AsyncQueueResult<T>) => void> = [];
  private failure: Error | null = null;
  private closed = false;

  public push(value: T): void {
    this.enqueue({ done: false, value });
  }

  public end(): void {
    this.closed = true;
    this.enqueue({ done: true, value: undefined as T });
  }

  public fail(error: Error): void {
    this.failure = error;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter({ done: true, value: undefined as T });
    }
  }

  public async next(): Promise<AsyncQueueResult<T>> {
    if (this.failure) throw this.failure;
    const item = this.items.shift();
    if (item) return item;
    if (this.closed) return { done: true, value: undefined as T };
    return new Promise<AsyncQueueResult<T>>((resolve) => {
      this.waiters.push(resolve);
    }).then((queued) => {
      if (this.failure) throw this.failure;
      return queued;
    });
  }

  private enqueue(item: AsyncQueueResult<T>): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }
}

function openAiApiErrorFromBody(status: number, body: string): OpenAiApiError {
  if (!body) return new OpenAiApiError(`OpenAI Responses API request failed with ${status}: empty response body`, null, status);
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const error = record.error;
      if (error && typeof error === 'object' && !Array.isArray(error)) {
        const errorRecord = error as Record<string, unknown>;
        const code = typeof errorRecord.code === 'string' ? errorRecord.code : null;
        const message = typeof errorRecord.message === 'string' ? errorRecord.message : safeErrorBody(body);
        return new OpenAiApiError(`OpenAI Responses API request failed with ${status}: ${message}`, code, status);
      }
    }
  } catch {
    // Fall through to the redacted body summary.
  }
  return new OpenAiApiError(`OpenAI Responses API request failed with ${status}: ${safeErrorBody(body)}`, null, status);
}

function normalizeOpenAiStreamEvent(event: OpenAiStreamEvent): OpenAiStreamEvent {
  if (event.type === 'response.done' || event.type === 'response.incomplete') {
    return { ...event, type: 'response.completed' };
  }
  if (event.type === 'response.failed') {
    const response = event.response;
    const error = response && typeof response === 'object' && !Array.isArray(response) ? (response as Record<string, unknown>).error : null;
    return {
      ...event,
      type: 'error',
      error: error ?? { message: 'OpenAI response failed.' }
    };
  }
  return event;
}

function wireBodyForCredential(credential: OpenAiCredential, body: OpenAiResponseCreateBody, sessionId?: string): OpenAiResponseWireBody {
  const { previous_response_id: previousResponseId, ...bodyWithoutPreviousResponse } = body;
  const bodyWithPreviousResponse: OpenAiResponseWireBody =
    previousResponseId === null || previousResponseId === undefined
      ? bodyWithoutPreviousResponse
      : { ...bodyWithoutPreviousResponse, previous_response_id: previousResponseId };

  if (!usesCodexBackend(credential)) return bodyWithPreviousResponse;
  const { metadata: _metadata, ...wireBody } = bodyWithPreviousResponse;
  return {
    ...wireBody,
    reasoning: { ...body.reasoning, summary: 'auto' },
    include: ['reasoning.encrypted_content'],
    ...(sessionId ? { prompt_cache_key: sessionId } : {})
  };
}

function usesCodexBackend(credential: OpenAiCredential): boolean {
  return credential.source === 'codex_oauth_file' || Boolean(credential.accountId && credential.source !== 'api_key_env');
}

function requireCodexAccountId(credential: OpenAiCredential): string {
  const accountId = credential.accountId?.trim();
  if (!accountId) {
    throw new Error('Codex OAuth session is missing a ChatGPT account id. Re-authenticate in Settings > Providers and retry.');
  }
  return accountId;
}

function resolveCodexResponsesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/codex/responses')) return normalized;
  if (normalized.endsWith('/codex')) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

function bealeUserAgent(): string {
  return `Beale/0.1 (${platform()} ${release()}; ${arch()})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}

function safeErrorBody(body: string): string {
  if (!body) return 'empty response body';
  return body.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-...redacted').slice(0, 800);
}
