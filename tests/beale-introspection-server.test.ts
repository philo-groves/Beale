import { afterEach, describe, expect, it } from 'vitest';
import { BealeIntrospectionServer } from '../src/main/bealeIntrospectionServer';

let server: BealeIntrospectionServer | null = null;

afterEach(() => {
  server?.stop();
  server = null;
});

describe('BealeIntrospectionServer', () => {
  it('serves token-protected tool calls on loopback', async () => {
    server = new BealeIntrospectionServer((tool, args) => ({ tool, args }));
    const endpoint = server.ensureStarted();

    const unauthorized = await fetch(`${endpoint.url}/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'list_workspaces' })
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${endpoint.url}/tool`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ tool: 'list_workspaces', args: { limit: 3 } })
    });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({
      ok: true,
      result: {
        tool: 'list_workspaces',
        args: { limit: 3 }
      }
    });
  });
});
