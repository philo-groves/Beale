import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHoneycrispInvocation } from './honeycrispInvocation';

export const HONEYCRISP_PROTOCOL_VERSION = 1 as const;

export type HoneycrispSessionStatus = 'active' | 'paused' | 'blocked' | 'completed' | 'failed' | 'stopped';

export interface HoneycrispSessionEvent {
  id: string;
  kind: string;
  timestamp: string;
  summary: string;
  payload: unknown;
  agentId?: string;
  agentPath?: string;
  parentAgentId?: string;
}

export interface HoneycrispSessionAttempt {
  id: string;
  parentAttemptId: string | null;
  status: HoneycrispSessionStatus;
  summary: string;
  startedAt: string;
  endedAt: string | null;
  capture: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface HoneycrispSessionRecord {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  status: HoneycrispSessionStatus;
  title: string;
  prompt: string;
  summary: string;
  provider: string | null;
  model: string;
  reasoningEffort: string;
  workflowId: string | null;
  profile: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  finalDisposition: Record<string, unknown> | null;
  finalResponse: string | null;
  attempts: HoneycrispSessionAttempt[];
  events: HoneycrispSessionEvent[];
  createdAt: string;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  revision: number;
}

export interface HoneycrispSessionStorage {
  databasePath: string;
  artifactDirectoryPath: string;
}

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

export function honeycrispOwnsSessions(): boolean {
  try {
    const descriptor = getHoneycrispProtocolDescriptor();
    return [
      'session.create',
      'session.begin_attempt',
      'session.append_event',
      'session.transition',
      'session.import_capture',
      'session.get',
      'session.list'
    ].every((operation) => descriptor.operations.includes(operation));
  } catch {
    return false;
  }
}

export function createHoneycrispSession(
  input: Record<string, unknown>,
  storage: HoneycrispSessionStorage
): HoneycrispSessionRecord {
  return invokeWithJsonInput<HoneycrispSessionRecord>('session.create', ['session', 'create'], input, storage).result;
}

export function beginHoneycrispSessionAttempt(
  sessionId: string,
  input: Record<string, unknown>,
  storage: HoneycrispSessionStorage
): HoneycrispSessionRecord {
  return invokeWithJsonInput<HoneycrispSessionRecord>(
    'session.begin_attempt',
    ['session', 'begin-attempt', '--session-id', sessionId],
    input,
    storage
  ).result;
}

export function appendHoneycrispSessionEvent(
  sessionId: string,
  input: HoneycrispSessionEvent,
  storage: HoneycrispSessionStorage
): HoneycrispSessionRecord {
  return invokeWithJsonInput<HoneycrispSessionRecord>(
    'session.append_event',
    ['session', 'append-event', '--session-id', sessionId],
    input,
    storage
  ).result;
}

export function transitionHoneycrispSession(
  sessionId: string,
  input: Record<string, unknown>,
  storage: HoneycrispSessionStorage
): HoneycrispSessionRecord {
  return invokeWithJsonInput<HoneycrispSessionRecord>(
    'session.transition',
    ['session', 'transition', '--session-id', sessionId],
    input,
    storage
  ).result;
}

export function importHoneycrispSessionCapture(
  sessionId: string,
  attemptId: string,
  capturePath: string,
  storage: HoneycrispSessionStorage
): HoneycrispSessionRecord {
  return invokeHoneycrispCliProtocol<HoneycrispSessionRecord>(
    'session.import_capture',
    ['session', 'import-capture', '--session-id', sessionId, '--attempt-id', attemptId, '--capture', capturePath, '--json'],
    { env: storageEnvironment(storage), timeoutMs: 30_000 }
  ).result;
}

export function getHoneycrispSession(sessionId: string, storage: HoneycrispSessionStorage): HoneycrispSessionRecord {
  return invokeHoneycrispCliProtocol<HoneycrispSessionRecord>(
    'session.get',
    ['session', 'get', '--session-id', sessionId, '--json'],
    { env: storageEnvironment(storage) }
  ).result;
}

export function listHoneycrispSessions(
  workspaceId: string,
  storage: HoneycrispSessionStorage,
  limit = 100
): HoneycrispSessionRecord[] {
  return invokeHoneycrispCliProtocol<HoneycrispSessionRecord[]>(
    'session.list',
    ['session', 'list', '--workspace-id', workspaceId, '--limit', String(limit), '--json'],
    { env: storageEnvironment(storage) }
  ).result;
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

function invokeWithJsonInput<T>(
  operation: string,
  args: readonly string[],
  input: unknown,
  storage: HoneycrispSessionStorage
): HoneycrispProtocolSuccess<T> {
  const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
  const inputPath = join(directory, 'input.json');
  try {
    writeFileSync(inputPath, `${JSON.stringify(input)}\n`, { encoding: 'utf8', mode: 0o600 });
    return invokeHoneycrispCliProtocol<T>(operation, [...args, '--input', inputPath, '--json'], {
      env: storageEnvironment(storage)
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function storageEnvironment(storage: HoneycrispSessionStorage): NodeJS.ProcessEnv {
  return {
    HONEYCRISP_DATABASE_PATH: storage.databasePath,
    HONEYCRISP_ARTIFACT_DIRECTORY: storage.artifactDirectoryPath
  };
}
