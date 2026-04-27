import type { OpenAiTransport } from '@shared/types';
import { OpenAiAuthService, resolveOpenAiTransport } from './openaiAuth';
import type { OpenAiToolDefinition } from './openaiTools';
import NodeWebSocket from 'ws';

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

export type ResponseInputItem = ResponseInputMessage | FunctionCallOutputItem;

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
    baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    private readonly webSocketImpl: WebSocketConstructorLike | null = NodeWebSocket as unknown as WebSocketConstructorLike
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public getTransport(): OpenAiTransport {
    return resolveOpenAiTransport(this.webSocketImpl !== null) === 'websocket' ? 'websocket' : 'sse_http';
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
    const credential = this.auth.getCredentialOrThrow();
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(input.body),
      signal: input.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw openAiApiErrorFromBody(response.status, body);
    }

    if (!response.body) {
      throw new Error('OpenAI Responses API returned an empty stream body.');
    }

    yield* parseSseStream(response.body);
  }

  private async *streamWebSocketResponse(input: StreamResponseInput): AsyncGenerator<OpenAiStreamEvent> {
    if (!this.webSocketImpl) {
      throw new Error('OpenAI Responses WebSocket transport is not available in this host process.');
    }

    const credential = this.auth.getCredentialOrThrow();
    const sessionKey = input.body.metadata.beale_run_id || 'default';
    const session = this.getWebSocketSession(sessionKey, credential.token);
    try {
      yield* session.stream(input.body, input.signal);
    } finally {
      if (session.isClosed()) {
        this.webSocketSessions.delete(sessionKey);
      }
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

  private responsesWebSocketUrl(): string {
    const url = new URL(`${this.baseUrl}/responses`);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    return url.toString();
  }

  private getWebSocketSession(sessionKey: string, token: string): OpenAiWebSocketSession {
    const existing = this.webSocketSessions.get(sessionKey);
    if (existing && !existing.isClosed()) {
      return existing;
    }
    const session = new OpenAiWebSocketSession(this.responsesWebSocketUrl(), token, this.webSocketImpl as WebSocketConstructorLike);
    this.webSocketSessions.set(sessionKey, session);
    return session;
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

function toWebSocketRequest(body: OpenAiResponseCreateBody): Omit<OpenAiResponseCreateBody, 'stream'> & { type: 'response.create' } {
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

class OpenAiWebSocketSession {
  private readonly socket: WebSocketLike;
  private readonly openPromise: Promise<void>;
  private queue: AsyncEventQueue<OpenAiStreamEvent> | null = null;
  private closed = false;
  private activeFinished = false;
  private activeAborted = false;

  public constructor(url: string, token: string, webSocketImpl: WebSocketConstructorLike) {
    this.socket = new webSocketImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
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

  public async *stream(body: OpenAiResponseCreateBody, signal?: AbortSignal): AsyncGenerator<OpenAiStreamEvent> {
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
    const event = parseWebSocketEvent(data);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}

function safeErrorBody(body: string): string {
  if (!body) return 'empty response body';
  return body.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-...redacted').slice(0, 800);
}
