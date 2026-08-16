import { spawnSync } from 'node:child_process';
import { resolveHoneycrispInvocation } from './honeycrispRunEngine';

export const HONEYCRISP_PROTOCOL_VERSION = 1 as const;

export interface HoneycrispProtocolDescriptor {
  protocol: 'honeycrisp';
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  operations: string[];
  transports: {
    cli: { framing: 'single-json-envelope'; errors: 'envelope-and-nonzero-exit' };
    websocket: {
      path: '/v1/session';
      authentication: 'bearer';
      capabilities: ['session.events', 'session.controls'];
    };
  };
}

export interface HoneycrispProtocolSuccess<T> {
  protocol: 'honeycrisp';
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  operation: string;
  requestId?: string;
  ok: true;
  result: T;
}

export interface HoneycrispProtocolFailure {
  protocol: 'honeycrisp';
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  operation: string;
  requestId?: string;
  ok: false;
  error: { code: string; message: string; retryable: boolean };
}

export type HoneycrispProtocolEnvelope<T> = HoneycrispProtocolSuccess<T> | HoneycrispProtocolFailure;

export function getHoneycrispProtocolDescriptor(): HoneycrispProtocolDescriptor {
  const envelope = invokeHoneycrispCliProtocol<HoneycrispProtocolDescriptor>(
    'protocol.describe',
    ['protocol', 'describe', '--json']
  );
  return envelope.result;
}

export function invokeHoneycrispCliProtocol<T>(
  operation: string,
  args: readonly string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): HoneycrispProtocolSuccess<T> {
  const invocation = resolveHoneycrispInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefixArgs, ...args], {
    cwd: invocation.cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? '1', ...options.env },
    timeout: options.timeoutMs ?? 30_000,
    windowsHide: true
  });
  let envelope: HoneycrispProtocolEnvelope<T>;
  try {
    envelope = decodeHoneycrispProtocolEnvelope<T>(String(result.stdout ?? '').trim());
  } catch (error) {
    const detail = String(result.stderr || result.stdout || 'Honeycrisp returned no protocol envelope.').trim();
    throw new Error(`Honeycrisp ${operation} protocol failure: ${detail}`, { cause: error });
  }
  if (envelope.operation !== operation) {
    throw new Error(`Honeycrisp protocol operation mismatch: expected ${operation}, received ${envelope.operation}.`);
  }
  if (!envelope.ok) {
    throw new Error(`Honeycrisp ${operation} failed (${envelope.error.code}): ${envelope.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Honeycrisp ${operation} returned a success envelope with exit status ${String(result.status)}.`);
  }
  return envelope;
}

export function decodeHoneycrispProtocolEnvelope<T>(json: string): HoneycrispProtocolEnvelope<T> {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)
    || value.protocol !== 'honeycrisp'
    || value.protocolVersion !== HONEYCRISP_PROTOCOL_VERSION
    || typeof value.operation !== 'string'
    || !value.operation.trim()
    || typeof value.ok !== 'boolean') {
    throw new Error('Invalid or unsupported Honeycrisp protocol envelope.');
  }
  if (value.requestId !== undefined && (typeof value.requestId !== 'string' || !value.requestId.trim())) {
    throw new Error('Honeycrisp protocol requestId must be a non-empty string.');
  }
  if (value.ok === true) {
    if (!('result' in value)) throw new Error('Honeycrisp protocol success is missing result.');
    return value as unknown as HoneycrispProtocolSuccess<T>;
  }
  if (!isRecord(value.error)
    || typeof value.error.code !== 'string'
    || typeof value.error.message !== 'string'
    || typeof value.error.retryable !== 'boolean') {
    throw new Error('Honeycrisp protocol failure is missing a valid error.');
  }
  return value as unknown as HoneycrispProtocolFailure;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
