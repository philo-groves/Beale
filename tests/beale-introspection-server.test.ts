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

  it('does not dispatch an introspection request after its client deadline', async () => {
    let dispatched = false;
    server = new BealeIntrospectionServer(() => {
      dispatched = true;
      return {};
    });
    const endpoint = server.ensureStarted();
    const response = await fetch(`${endpoint.url}/tool`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        'content-type': 'application/json',
        'x-beale-introspection-deadline': String(Date.now() - 1)
      },
      body: JSON.stringify({ tool: 'list_workspaces' })
    });

    expect(response.status).toBe(408);
    expect(dispatched).toBe(false);
  });

  it('aborts an in-flight handler when its request deadline expires', async () => {
    let sideEffectCommitted = false;
    server = new BealeIntrospectionServer((_tool, _args, signal) => new Promise((resolve, reject) => {
      const commit = setTimeout(() => {
        sideEffectCommitted = true;
        resolve({});
      }, 100);
      signal.addEventListener('abort', () => {
        clearTimeout(commit);
        reject(new Error('canceled'));
      }, { once: true });
    }));
    const endpoint = server.ensureStarted();
    const response = await fetch(`${endpoint.url}/tool`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        'content-type': 'application/json',
        'x-beale-introspection-deadline': String(Date.now() + 20)
      },
      body: JSON.stringify({ tool: 'edit_resource' })
    });

    expect(response.status).toBe(408);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sideEffectCommitted).toBe(false);
  });
});
