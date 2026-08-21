import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeHoneycrispProtocolEnvelope,
  decodeHoneycrispMemorySummary,
  getHoneycrispProtocolDescriptor,
  invokeHoneycrispCliProtocol,
  invokeHoneycrispCliProtocolAsync,
  listHoneycrispSessionSummariesForWorkspacesAsync
} from '../src/main/honeycrispCliClient';

const createdDirectories: string[] = [];
const compatibleDescriptor = {
  protocol: 'honeycrisp',
  protocolVersion: 1,
  contractVersion: 4,
  runtime: { name: 'honeycrisp', version: '0.1.0', buildId: 'fixture-build', nodeVersion: process.version },
  schemas: { protocol: 1, session: 1, memorySummary: 3, finding: 1, campaignGraph: 1 },
  capabilities: ['knowledge.findings', 'knowledge.finding_staleness', 'knowledge.campaign_graph', 'knowledge.evidence_gates', 'session.append_only', 'session.controls', 'session.bounded_reads', 'session.targeted_details'],
  operations: ['protocol.describe'],
  transports: {
    cli: { framing: 'single-json-envelope', errors: 'envelope-and-nonzero-exit', correlation: 'request-id' },
    websocket: { path: '/v1/session', authentication: 'bearer', framing: 'json-message', errors: 'protocol-error-message', correlation: 'request-id', capabilities: ['session.events', 'session.controls'] }
  }
};

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
        result: compatibleDescriptor
      })}, requestId }));`
    ].join('\n'));
    chmodSync(fixture, 0o700);
    process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_PROTOCOL_ARGS_JSON = JSON.stringify([fixture]);

    expect(getHoneycrispProtocolDescriptor()).toMatchObject({
      protocol: 'honeycrisp',
      protocolVersion: 1,
      operations: ['protocol.describe'],
      contractVersion: 4,
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

  it('reports protocol process failures without mistaking runtime warnings for the cause', () => {
    process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND = join(tmpdir(), 'missing-honeycrisp-protocol-command');

    expect(() => invokeHoneycrispCliProtocol('session.list', ['session', 'list', '--workspace-id', 'workspace_one', '--json']))
      .toThrow(/process error:.*ENOENT/);
  });

  it('suppresses Node runtime warnings on machine-readable protocol subprocesses', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
    createdDirectories.push(directory);
    const fixture = join(directory, 'protocol-warning-fixture.mjs');
    writeFileSync(fixture, [
      '#!/usr/bin/env node',
      "const args = process.argv.slice(2);",
      "const requestId = args[args.indexOf('--request-id') + 1];",
      `if (args[0] === 'protocol' && args[1] === 'describe') { console.log(JSON.stringify({ protocol: 'honeycrisp', protocolVersion: 1, operation: 'protocol.describe', requestId, ok: true, result: ${JSON.stringify(compatibleDescriptor)} })); process.exit(0); }`,
      "if (process.env.NODE_NO_WARNINGS !== '1') process.stderr.write('ExperimentalWarning: protocol noise\\n');",
      "console.log(JSON.stringify({ protocol: 'honeycrisp', protocolVersion: 1, operation: 'session.list', requestId, ok: true, result: [] }));"
    ].join('\n'));
    chmodSync(fixture, 0o700);
    process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_PROTOCOL_ARGS_JSON = JSON.stringify([fixture]);

    expect(invokeHoneycrispCliProtocol('session.list', ['session', 'list', '--workspace-id', 'workspace_one', '--json']).result)
      .toEqual([]);
  });

  it('retains complete async JSON envelopes larger than the former two-million-character cap', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
    createdDirectories.push(directory);
    const fixture = join(directory, 'protocol-large-envelope-fixture.mjs');
    writeFileSync(fixture, [
      '#!/usr/bin/env node',
      "const args = process.argv.slice(2);",
      "const requestId = args[args.indexOf('--request-id') + 1];",
      `if (args[0] === 'protocol' && args[1] === 'describe') { console.log(JSON.stringify({ protocol: 'honeycrisp', protocolVersion: 1, operation: 'protocol.describe', requestId, ok: true, result: ${JSON.stringify(compatibleDescriptor)} })); process.exit(0); }`,
      "process.stdout.write(JSON.stringify({ protocol: 'honeycrisp', protocolVersion: 1, operation: 'session.get', requestId, ok: true, result: { text: 'v'.repeat(3 * 1024 * 1024) } }));"
    ].join('\n'));
    chmodSync(fixture, 0o700);
    process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_PROTOCOL_ARGS_JSON = JSON.stringify([fixture]);

    const envelope = await invokeHoneycrispCliProtocolAsync<{ text: string }>(
      'session.get',
      ['session', 'get', '--session-id', 'session_large', '--json']
    );
    expect(envelope.result.text).toHaveLength(3 * 1024 * 1024);
  });

  it('rejects incompatible runtime descriptors and malformed memory summary v3 payloads', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-incompatible-'));
    createdDirectories.push(directory);
    const fixture = join(directory, 'protocol-fixture.mjs');
    writeFileSync(fixture, [
      '#!/usr/bin/env node',
      "const args = process.argv.slice(2);",
      "const requestId = args[args.indexOf('--request-id') + 1];",
      `console.log(JSON.stringify({ protocol: 'honeycrisp', protocolVersion: 1, operation: 'protocol.describe', requestId, ok: true, result: ${JSON.stringify({ ...compatibleDescriptor, contractVersion: 1 })} }));`
    ].join('\n'));
    chmodSync(fixture, 0o700);
    process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_PROTOCOL_ARGS_JSON = JSON.stringify([fixture]);
    expect(() => getHoneycrispProtocolDescriptor()).toThrow(/incompatible with Beale contract v4/);
    expect(() => decodeHoneycrispMemorySummary({ nodes: [], edges: [], runbooks: [], findings: [], campaign: {} })).toThrow(/memory summary v3/);
  });

  it('batches multiple workspace summary catalogs into one protocol process', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
    createdDirectories.push(directory);
    const fixture = join(directory, 'protocol-workspace-batch-fixture.mjs');
    writeFileSync(fixture, [
      '#!/usr/bin/env node',
      "const args = process.argv.slice(2);",
      "const requestId = args[args.indexOf('--request-id') + 1];",
      `if (args[0] === 'protocol' && args[1] === 'describe') { console.log(JSON.stringify({ protocol: 'honeycrisp', protocolVersion: 1, operation: 'protocol.describe', requestId, ok: true, result: ${JSON.stringify(compatibleDescriptor)} })); process.exit(0); }`,
      "const workspaceIds = args.flatMap((arg, index) => arg === '--workspace-id' ? [args[index + 1]] : []);",
      "if (workspaceIds.join(',') !== 'workspace_one,workspace_two') process.exit(2);",
      "console.log(JSON.stringify({ protocol: 'honeycrisp', protocolVersion: 1, operation: 'session.list_summaries', requestId, ok: true, result: [] }));"
    ].join('\n'));
    chmodSync(fixture, 0o700);
    process.env.BEALE_HONEYCRISP_PROTOCOL_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_PROTOCOL_ARGS_JSON = JSON.stringify([fixture]);

    await expect(listHoneycrispSessionSummariesForWorkspacesAsync(
      ['workspace_one', 'workspace_two', 'workspace_one'],
      { databasePath: join(directory, 'memory.sqlite'), artifactDirectoryPath: join(directory, 'artifacts') }
    )).resolves.toEqual([]);
  });
});
