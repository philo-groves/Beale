import WebSocket, { type RawData } from 'ws';
import {
  HONEYCRISP_PROTOCOL_BOOTSTRAP_PREFIX,
  HONEYCRISP_PROTOCOL_VERSION,
  decodeHoneycrispServerMessage,
  honeycrispClientHello,
  honeycrispSessionControl,
  type HoneycrispTransportBootstrap
} from './honeycrispProtocol';

export const HONEYCRISP_TRANSPORT_PREFIX = HONEYCRISP_PROTOCOL_BOOTSTRAP_PREFIX;
export { parseHoneycrispTransportBootstrap } from './honeycrispProtocol';
export type { HoneycrispTransportBootstrap } from './honeycrispProtocol';
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

export interface HoneycrispWebSocketClientOptions {
  bootstrap: HoneycrispTransportBootstrap;
  token: string;
  clientVersion: string;
  onEvent: (event: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onClose?: (code: number, reason: string) => void;
  connectTimeoutMs?: number;
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
        socket.send(JSON.stringify(honeycrispClientHello(
          this.options.bootstrap.sessionId,
          this.options.clientVersion
        )));
      });
      socket.on('message', (data) => {
        let message;
        try {
          message = decodeHoneycrispServerMessage(JSON.parse(rawDataText(data)) as unknown);
        } catch {
          settleError(new Error('Honeycrisp sent an invalid WebSocket protocol message.'));
          socket.close(1002, 'invalid protocol message');
          return;
        }
        if (message.protocolVersion !== HONEYCRISP_PROTOCOL_VERSION
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
        if (message.type === 'session.event') {
          this.options.onEvent(message.event);
          return;
        }
        if (message.type === 'protocol.error') {
          const detail = message.error.message;
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
    this.socket.send(JSON.stringify(honeycrispSessionControl(this.options.bootstrap.sessionId, control)));
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

function rawDataText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}
