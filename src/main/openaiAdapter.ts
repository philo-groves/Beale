import type { OpenAiTransport } from '@shared/types';
import { OpenAiAuthService, resolveOpenAiTransport } from './openaiAuth';
import type { OpenAiToolDefinition } from './openaiTools';

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

export class OpenAiResponsesAdapter {
  private readonly baseUrl: string;

  public constructor(
    private readonly auth: OpenAiAuthService = new OpenAiAuthService(),
    private readonly fetchImpl: FetchLike = fetch,
    baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public getTransport(): OpenAiTransport {
    return resolveOpenAiTransport() === 'websocket' ? 'websocket' : 'sse_http';
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
      throw new Error(`OpenAI Responses API request failed with ${response.status}: ${safeErrorBody(body)}`);
    }

    if (!response.body) {
      throw new Error('OpenAI Responses API returned an empty stream body.');
    }

    yield* parseSseStream(response.body);
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

function safeErrorBody(body: string): string {
  if (!body) return 'empty response body';
  return body.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-...redacted').slice(0, 800);
}
