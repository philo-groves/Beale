import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeHoneycrispProtocolEnvelope,
  getHoneycrispProtocolDescriptor,
  invokeHoneycrispCliProtocol
} from '../src/main/honeycrispCliClient';

const createdDirectories: string[] = [];

afterEach(() => {
  delete process.env.BEALE_HONEYCRISP_COMMAND;
  delete process.env.BEALE_HONEYCRISP_ARGS_JSON;
  delete process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND;
  delete process.env.BEALE_HONEYCRISP_PROTOCOL_ARGS_JSON;
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Honeycrisp CLI protocol client', () => {
  it('rejects unversioned and unsupported envelopes', () => {
    expect(() => decodeHoneycrispProtocolEnvelope('{}')).toThrow(/Invalid or unsupported/);
    expect(() => decodeHoneycrispProtocolEnvelope(JSON.stringify({
      protocol: 'honeycrisp',
      protocolVersion: 2,
      operation: 'protocol.describe',
      ok: true,
      result: {}
    }))).toThrow(/Invalid or unsupported/);
  });

  it('discovers the Honeycrisp protocol through the CLI boundary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
    createdDirectories.push(directory);
    const fixture = join(directory, 'protocol-fixture.mjs');
    writeFileSync(fixture, [
      '#!/usr/bin/env node',
      "const args = process.argv.slice(2);",
      "const requestId = args[args.indexOf('--request-id') + 1];",
      "if (args.slice(0, 3).join(' ') !== 'protocol describe --json' || !requestId) process.exit(2);",
      `console.log(JSON.stringify({ ...${JSON.stringify({
        protocol: 'honeycrisp',
        protocolVersion: 1,
        operation: 'protocol.describe',
        ok: true,
        result: {
          protocol: 'honeycrisp',
          protocolVersion: 1,
          operations: ['protocol.describe'],
          transports: {
            cli: { framing: 'single-json-envelope', errors: 'envelope-and-nonzero-exit', correlation: 'request-id' },
            websocket: {
              path: '/v1/session',
              authentication: 'bearer',
              framing: 'json-message',
              errors: 'protocol-error-message',
              correlation: 'request-id',
              capabilities: ['session.events', 'session.controls']
            }
          }
        }
      })}, requestId }));`
    ].join('\n'));
    chmodSync(fixture, 0o700);
    process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_PROTOCOL_ARGS_JSON = JSON.stringify([fixture]);

    expect(getHoneycrispProtocolDescriptor()).toMatchObject({
      protocol: 'honeycrisp',
      protocolVersion: 1,
      operations: ['protocol.describe'],
      transports: { websocket: { path: '/v1/session' } }
    });
  });

  it('rejects a CLI response correlated to a different request', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
    createdDirectories.push(directory);
    const fixture = join(directory, 'protocol-fixture.mjs');
    writeFileSync(fixture, [
      '#!/usr/bin/env node',
      "console.log(JSON.stringify({ protocol: 'honeycrisp', protocolVersion: 1, operation: 'protocol.describe', requestId: 'wrong-request', ok: true, result: {} }));"
    ].join('\n'));
    chmodSync(fixture, 0o700);
    process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_PROTOCOL_ARGS_JSON = JSON.stringify([fixture]);

    expect(() => invokeHoneycrispCliProtocol('protocol.describe', ['protocol', 'describe', '--json']))
      .toThrow(/request mismatch/);
  });
});
