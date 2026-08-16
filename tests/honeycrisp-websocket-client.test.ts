import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  HoneycrispWebSocketClient,
  HONEYCRISP_TRANSPORT_PREFIX,
  parseHoneycrispTransportBootstrap
} from '../src/main/honeycrispWebSocketClient';

describe('HoneycrispWebSocketClient', () => {
  const servers: WebSocketServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
      for (const client of server.clients) client.terminate();
      server.close(() => resolve());
    })));
  });

  it('accepts only the versioned loopback session bootstrap', () => {
    const line = `${HONEYCRISP_TRANSPORT_PREFIX}${JSON.stringify({
      protocolVersion: 1,
      transport: 'websocket',
      url: 'ws://127.0.0.1:3210/v1/session',
      sessionId: 'session-1'
    })}`;

    expect(parseHoneycrispTransportBootstrap(line, 'session-1')).toEqual({
      protocolVersion: 1,
      transport: 'websocket',
      url: 'ws://127.0.0.1:3210/v1/session',
      sessionId: 'session-1'
    });
    expect(parseHoneycrispTransportBootstrap(line, 'other-session')).toBeNull();
    expect(parseHoneycrispTransportBootstrap(
      line.replace('127.0.0.1', 'example.com'),
      'session-1'
    )).toBeNull();
  });

  it('authenticates, negotiates the protocol, receives events, and sends controls', async () => {
    const token = 'test-transport-token';
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/v1/session' });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('Expected a TCP WebSocket address.');

    let authorization: string | undefined;
    const controlReceived = new Promise<Record<string, unknown>>((resolve, reject) => {
      server.once('connection', (socket: WebSocket, request) => {
        authorization = request.headers.authorization;
        socket.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
            if (message.type === 'client.hello') {
              socket.send(JSON.stringify({
                protocolVersion: 1,
                type: 'server.hello',
                sessionId: 'session-1',
                server: { name: 'honeycrisp', version: '0.1.0' },
                capabilities: ['session.events', 'session.controls']
              }));
              socket.send(JSON.stringify({
                protocolVersion: 1,
                type: 'session.event',
                sessionId: 'session-1',
                event: { schemaVersion: 1, kind: 'agent.event', payload: { eventType: 'started' } }
              }));
            } else if (message.type === 'session.control') {
              resolve(message);
            }
          } catch (error) {
            reject(error);
          }
        });
      });
    });
    const eventReceived = new Promise<Record<string, unknown>>((resolve) => {
      const client = new HoneycrispWebSocketClient({
        bootstrap: {
          protocolVersion: 1,
          transport: 'websocket',
          url: `ws://127.0.0.1:${address.port}/v1/session`,
          sessionId: 'session-1'
        },
        token,
        clientVersion: 'test',
        onEvent: resolve
      });
      void client.connect().then(() => {
        client.sendControl({ schemaVersion: 1, type: 'pause', requestId: 'control-1' });
      });
    });

    await expect(eventReceived).resolves.toMatchObject({ kind: 'agent.event' });
    await expect(controlReceived).resolves.toMatchObject({
      protocolVersion: 1,
      type: 'session.control',
      sessionId: 'session-1',
      requestId: 'control-1',
      control: { schemaVersion: 1, type: 'pause', requestId: 'control-1' }
    });
    expect(authorization).toBe(`Bearer ${token}`);
  });
});
