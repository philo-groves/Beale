import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { BenchmarkModelProxyDecision, BenchmarkModelProxyPolicy } from './benchmarkIsolation';
import { validateModelProxyRequest, type BenchmarkModelProxyRequest } from './benchmarkIsolation';

export interface BenchmarkModelProxyHandle {
  hostEndpoint: string;
  containerEndpoint: string;
  decisions: BenchmarkModelProxyDecision[];
  close(): Promise<void>;
}

export async function startBenchmarkModelProxy(policy: Omit<BenchmarkModelProxyPolicy, 'endpoint'>): Promise<BenchmarkModelProxyHandle> {
  const decisions: BenchmarkModelProxyDecision[] = [];
  const server = createServer((request, response) => {
    void handleProxyRequest(request, response, { ...policy, endpoint: '' }, decisions);
  });
  await listen(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    hostEndpoint: `http://127.0.0.1:${port}/v1/responses`,
    containerEndpoint: `http://host.docker.internal:${port}/v1/responses`,
    decisions,
    close: () => close(server)
  };
}

async function handleProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  policy: BenchmarkModelProxyPolicy,
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
    writeJson(response, 200, {
      id: 'benchmark_proxy_response',
      object: 'response',
      output_text: 'Benchmark proxy accepted request. No host credentials were exposed.',
      metadata: decision.metadata
    });
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : 'invalid benchmark proxy request' });
  }
}

function normalizeProxyRequest(value: unknown): BenchmarkModelProxyRequest {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    model: typeof record.model === 'string' ? record.model : '',
    reasoningEffort: typeof record.reasoningEffort === 'string' ? record.reasoningEffort : typeof record.reasoning_effort === 'string' ? record.reasoning_effort : '',
    input: record.input,
    stream: record.stream === true,
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata) ? (record.metadata as Record<string, unknown>) : undefined
  };
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
    server.listen(0, '127.0.0.1', () => {
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
