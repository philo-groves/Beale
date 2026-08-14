import { randomBytes, randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface BealeIntrospectionEndpoint {
  url: string;
  token: string;
}

export type BealeIntrospectionToolHandler = (
  tool: string,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

export class BealeIntrospectionServer {
  private server: Server | null = null;
  private endpoint: BealeIntrospectionEndpoint | null = null;
  private readonly token = randomBytes(32).toString('hex');

  public constructor(private readonly handleTool: BealeIntrospectionToolHandler) {}

  public ensureStarted(): BealeIntrospectionEndpoint {
    if (this.endpoint) return this.endpoint;
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    const port = randomInt(49_152, 65_536);
    server.on('error', () => {
      if (this.server === server) {
        this.server = null;
        this.endpoint = null;
      }
    });
    server.listen(port, '127.0.0.1');
    this.server = server;
    this.endpoint = {
      url: `http://127.0.0.1:${port}`,
      token: this.token
    };
    return this.endpoint;
  }

  public stop(): void {
    this.endpoint = null;
    const server = this.server;
    this.server = null;
    server?.close();
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'POST' || request.url !== '/tool') {
        writeJson(response, 404, { ok: false, error: 'Unknown Beale introspection route.' });
        return;
      }
      if (request.headers.authorization !== `Bearer ${this.token}`) {
        writeJson(response, 401, { ok: false, error: 'Invalid Beale introspection token.' });
        return;
      }
      const payload = await readJsonBody(request);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        writeJson(response, 400, { ok: false, error: 'Request body must be a JSON object.' });
        return;
      }
      const tool = typeof payload.tool === 'string' ? payload.tool.trim() : '';
      const args = payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
        ? payload.args as Record<string, unknown>
        : {};
      if (!tool) {
        writeJson(response, 400, { ok: false, error: 'Request body must include a tool name.' });
        return;
      }
      const result = await this.handleTool(tool, args);
      writeJson(response, 200, { ok: true, result });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const maxBytes = 1024 * 1024;
  let size = 0;
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Beale introspection request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function writeJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}
