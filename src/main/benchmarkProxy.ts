import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { OpenAiResponsesAdapter, type FetchLike, type OpenAiStreamEvent } from './openaiAdapter';
import { OpenAiAuthService } from './openaiAuth';
import type { BenchmarkModelProxyDecision, BenchmarkModelProxyPolicy } from './benchmarkIsolation';
import { validateModelProxyRequest, type BenchmarkModelProxyRequest } from './benchmarkIsolation';

export interface BenchmarkModelProxyOptions extends Omit<BenchmarkModelProxyPolicy, 'endpoint'> {
  adapter?: OpenAiResponsesAdapter;
  allowOfflineFallback?: boolean;
}

export interface BenchmarkModelProxyHandle {
  hostEndpoint: string;
  containerEndpoint: string;
  decisions: BenchmarkModelProxyDecision[];
  readonly requestCount: number;
  close(): Promise<void>;
}

export async function startBenchmarkModelProxy(options: BenchmarkModelProxyOptions): Promise<BenchmarkModelProxyHandle> {
  const decisions: BenchmarkModelProxyDecision[] = [];
  let requestCount = 0;
  const adapter = options.adapter ?? new OpenAiResponsesAdapter(new OpenAiAuthService(), fetch as FetchLike, process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1', null);
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/responses') requestCount += 1;
    void handleProxyRequest(request, response, { ...options, endpoint: '' }, adapter, options.allowOfflineFallback ?? true, decisions);
  });
  await listen(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    hostEndpoint: `http://127.0.0.1:${port}/v1/responses`,
    containerEndpoint: `http://${containerReachableHost()}:${port}/v1/responses`,
    decisions,
    get requestCount() {
      return requestCount;
    },
    close: () => close(server)
  };
}

function containerReachableHost(): string {
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces ?? []) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('127.')) {
        return item.address;
      }
    }
  }
  return 'host.docker.internal';
}

async function handleProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  policy: BenchmarkModelProxyPolicy,
  adapter: OpenAiResponsesAdapter,
  allowOfflineFallback: boolean,
  decisions: BenchmarkModelProxyDecision[]
): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    writeJson(response, 404, { error: 'unsupported benchmark proxy route' });
    return;
  }
  try {
    const body = await readJsonBody(request, policy.maxInputBytes);
    const proxyRequest = normalizeProxyRequest(body);
    const decision = validateModelProxyRequest(proxyRequest, policy);
    decisions.push(decision);
    if (!decision.allowed) {
      writeJson(response, 403, { error: decision.reason, metadata: decision.metadata });
      return;
    }
    const forwarded = await forwardModelRequest(proxyRequest, adapter, allowOfflineFallback);
    writeJson(response, 200, forwarded);
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : 'invalid benchmark proxy request' });
  }
}

function normalizeProxyRequest(value: unknown): BenchmarkModelProxyRequest {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    model: typeof record.model === 'string' ? record.model : '',
    reasoningEffort: typeof record.reasoningEffort === 'string' ? record.reasoningEffort : typeof record.reasoning_effort === 'string' ? record.reasoning_effort : '',
    instructions: typeof record.instructions === 'string' ? record.instructions : undefined,
    input: record.input,
    stream: record.stream === true,
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata) ? (record.metadata as Record<string, unknown>) : undefined
  };
}

async function forwardModelRequest(request: BenchmarkModelProxyRequest, adapter: OpenAiResponsesAdapter, allowOfflineFallback: boolean): Promise<Record<string, unknown>> {
  const body = adapter.buildRequest({
    model: request.model,
    instructions:
      request.instructions ??
      'You are the host-side Beale benchmark model proxy. Return a concise assessment of the benchmark task input without requesting tools.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: typeof request.input === 'string' ? request.input : JSON.stringify(request.input) }]
      }
    ],
    tools: [],
    reasoning: { effort: request.reasoningEffort },
    text: { verbosity: 'low' },
    metadata: stringifyMetadata({
      ...(request.metadata ?? {}),
      beale_benchmark_proxy: 'true'
    })
  });
  try {
    let outputText = '';
    let responseId: string | null = null;
    let usage: unknown = null;
    for await (const event of adapter.streamResponse({ body })) {
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') outputText += event.delta;
      if (event.type === 'response.output_text.done' && typeof event.text === 'string') outputText = event.text;
      if (event.type === 'response.completed') {
        const response = recordValue(event.response);
        responseId = typeof response.id === 'string' ? response.id : responseId;
        usage = response.usage ?? null;
      }
      responseId = responseIdFromEvent(event) ?? responseId;
    }
    return {
      id: responseId ?? 'benchmark_proxy_response',
      object: 'response',
      output_text: outputText,
      forwarded: true,
      credentialExposedToAgent: false,
      usage
    };
  } catch (error) {
    if (!allowOfflineFallback) throw error;
    return {
      id: 'benchmark_proxy_offline_fallback',
      object: 'response',
      output_text: 'Benchmark proxy accepted request in offline fallback mode. No host credentials were exposed.',
      forwarded: false,
      credentialExposedToAgent: false,
      fallbackReason: error instanceof Error ? error.message : 'OpenAI forwarding unavailable'
    };
  }
}

function stringifyMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
}

function responseIdFromEvent(event: OpenAiStreamEvent): string | null {
  const response = recordValue(event.response);
  if (typeof response.id === 'string') return response.id;
  return typeof event.response_id === 'string' ? event.response_id : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxBytes) {
        request.destroy();
        reject(new Error('benchmark proxy request body exceeds limit'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('benchmark proxy request body is not valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function writeJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
