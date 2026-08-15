import WebSocket, { type RawData } from 'ws';

export const HONEYCRISP_TRANSPORT_PREFIX = 'HONEYCRISP_TRANSPORT ';
export const HONEYCRISP_TRANSPORT_PROTOCOL_VERSION = 1 as const;

const HONEYCRISP_TRANSPORT_PATH = '/v1/session';
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

export interface HoneycrispTransportBootstrap {
  protocolVersion: typeof HONEYCRISP_TRANSPORT_PROTOCOL_VERSION;
  transport: 'websocket';
  url: string;
  sessionId: string;
}

export interface HoneycrispWebSocketClientOptions {
  bootstrap: HoneycrispTransportBootstrap;
  token: string;
  clientVersion: string;
  onEvent: (event: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onClose?: (code: number, reason: string) => void;
  connectTimeoutMs?: number;
}

export function parseHoneycrispTransportBootstrap(
  line: string,
  expectedSessionId: string
): HoneycrispTransportBootstrap | null {
  if (!line.startsWith(HONEYCRISP_TRANSPORT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(line.slice(HONEYCRISP_TRANSPORT_PREFIX.length)) as unknown;
    if (!isRecord(parsed)
      || parsed.protocolVersion !== HONEYCRISP_TRANSPORT_PROTOCOL_VERSION
      || parsed.transport !== 'websocket'
      || parsed.sessionId !== expectedSessionId
      || typeof parsed.url !== 'string') {
      return null;
    }
    const url = new URL(parsed.url);
    if (url.protocol !== 'ws:'
      || url.hostname !== '127.0.0.1'
      || url.pathname !== HONEYCRISP_TRANSPORT_PATH
      || url.username
      || url.password) {
      return null;
    }
    return {
      protocolVersion: HONEYCRISP_TRANSPORT_PROTOCOL_VERSION,
      transport: 'websocket',
      url: url.toString(),
      sessionId: parsed.sessionId
    };
  } catch {
    return null;
  }
}

export class HoneycrispWebSocketClient {
  private socket: WebSocket | null = null;
  private ready = false;
  private closed = false;

  public constructor(private readonly options: HoneycrispWebSocketClientOptions) {}

  public connect(): Promise<void> {
    if (this.socket) throw new Error('Honeycrisp WebSocket transport is already connecting.');
    if (!this.options.token.trim()) throw new Error('Honeycrisp WebSocket transport token is missing.');

    return new Promise((resolve, reject) => {
      let settled = false;
      const settleError = (error: Error): void => {
        this.options.onError?.(error);
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const socket = new WebSocket(this.options.bootstrap.url, {
        headers: { authorization: `Bearer ${this.options.token}` },
        maxPayload: 1_048_576
      });
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.terminate();
        settleError(new Error('Timed out waiting for the Honeycrisp WebSocket handshake.'));
      }, this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
      timeout.unref();

      socket.once('open', () => {
        socket.send(JSON.stringify({
          protocolVersion: HONEYCRISP_TRANSPORT_PROTOCOL_VERSION,
          type: 'client.hello',
          sessionId: this.options.bootstrap.sessionId,
          client: { name: 'beale', version: this.options.clientVersion }
        }));
      });
      socket.on('message', (data) => {
        const message = parseServerMessage(data);
        if (!message) {
          settleError(new Error('Honeycrisp sent an invalid WebSocket protocol message.'));
          socket.close(1002, 'invalid protocol message');
          return;
        }
        if (message.protocolVersion !== HONEYCRISP_TRANSPORT_PROTOCOL_VERSION
          || message.sessionId !== this.options.bootstrap.sessionId) {
          settleError(new Error('Honeycrisp WebSocket protocol or session mismatch.'));
          socket.close(1002, 'protocol or session mismatch');
          return;
        }
        if (message.type === 'server.hello') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.ready = true;
            resolve();
          }
          return;
        }
        if (message.type === 'session.event' && isRecord(message.event)) {
          this.options.onEvent(message.event);
          return;
        }
        if (message.type === 'protocol.error') {
          const detail = typeof message.message === 'string' ? message.message : 'Unknown protocol error.';
          settleError(new Error(`Honeycrisp WebSocket protocol error: ${detail}`));
        }
      });
      socket.on('error', (error) => settleError(error));
      socket.once('close', (code, reason) => {
        this.ready = false;
        this.socket = null;
        if (!this.closed && !settled) {
          settleError(new Error(`Honeycrisp WebSocket closed before its handshake (code ${code}).`));
        }
        this.options.onClose?.(code, reason.toString('utf8'));
      });
    });
  }

  public sendControl(control: Record<string, unknown> & { requestId: string }): void {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Honeycrisp WebSocket transport is not ready.');
    }
    this.socket.send(JSON.stringify({
      protocolVersion: HONEYCRISP_TRANSPORT_PROTOCOL_VERSION,
      type: 'session.control',
      sessionId: this.options.bootstrap.sessionId,
      requestId: control.requestId,
      control
    }));
  }

  public close(): void {
    this.closed = true;
    this.ready = false;
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close(1000, 'client closed');
    }
  }
}

function parseServerMessage(data: RawData): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawDataText(data)) as unknown;
    return isRecord(parsed) && typeof parsed.type === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function rawDataText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
