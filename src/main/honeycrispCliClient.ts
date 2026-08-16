import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveHoneycrispProtocolInvocation } from './honeycrispInvocation';
import type {
  HoneycrispMemorySummary,
  HoneycrispMemoryEdgeSummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispReportDocument,
  HoneycrispRunbookDocument,
  MemoryDreamingRunSummary,
  ResearchProfileSnapshot,
  AgentPluginRegistryState,
  WorkspaceDejunkSummary
} from '@shared/types';
import type { ResolvedResearchProfile } from '../shared/researchProfile';

export const HONEYCRISP_PROTOCOL_VERSION = 1 as const;
export const HONEYCRISP_PROTOCOL_WEBSOCKET_PATH = '/v1/session' as const;

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

export function resolveHoneycrispStoragePaths(
  profileId: string,
  options: { databasePath?: string; artifactDirectoryPath?: string; registryDirectory?: string } = {}
): HoneycrispSessionStorage {
  const databasePath = options.databasePath
    ? profileId === 'security-research'
      ? resolve(options.databasePath)
      : join(dirname(resolve(options.databasePath)), 'profiles', profileId, 'memory.sqlite')
    : options.registryDirectory
      ? resolve(options.registryDirectory, 'honeycrisp', 'profiles', profileId, 'memory.sqlite')
      : join(homedir(), '.honeycrisp', 'profiles', profileId, 'memory.sqlite');
  const artifactDirectoryPath = options.artifactDirectoryPath
    ? profileId === 'security-research'
      ? resolve(options.artifactDirectoryPath)
      : join(dirname(resolve(options.artifactDirectoryPath)), profileId, 'artifacts')
    : join(dirname(databasePath), 'artifacts');
  return { databasePath, artifactDirectoryPath };
}

export type MemoryDreamingProfileInput =
  | { profileSnapshot: ResearchProfileSnapshot; resolvedProfile?: never }
  | { resolvedProfile: ResolvedResearchProfile; profileSnapshot?: never };

export interface MemoryDreamingPlan {
  prune: Array<{ nodeId: string; reason: string }>;
  merge: Array<{
    survivorNodeId: string;
    duplicateNodeIds: string[];
    summary: string | null;
    body: string | null;
    attributes?: Record<string, string | number | boolean>;
    reason: string;
  }>;
  revise: Array<{
    nodeId: string;
    summary: string | null;
    body: string | null;
    attributes?: Record<string, string | number | boolean>;
    reason: string;
  }>;
  reclassify: Array<{
    nodeId: string;
    type: string;
    attributes?: Record<string, string | number | boolean>;
    reason: string;
  }>;
}

export interface MemoryDreamingRunContext {
  model: string;
  reasoningEffort: string;
  inputNodeCount: number;
  inputSessionCount: number;
}

export interface HoneycrispDreamingPreparation {
  instructions: string;
  typeDescriptions: Record<string, string>;
  modelJobDefaults: { size: string; reasoningEffort: string } | null;
  inputTexts: string[];
}

export interface HoneycrispDreamingSessionInput {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  endedAt: string | null;
  prompt: string;
  finalSummary: string;
  transcript: Array<{ role: string; source: string; createdAt: string; content: string }>;
}

export interface HoneycrispResolvedArtifact {
  id: string;
  kind: string;
  purpose: string;
  path: string;
  relativePath: string;
  uri: string;
  sizeBytes: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface HoneycrispAuxiliaryModelRoute {
  provider: 'openai-codex' | 'anthropic' | 'xai' | 'zai';
  model: string;
  effort: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface HoneycrispProviderSemantics {
  providers: Array<'openai-codex' | 'anthropic' | 'xai' | 'zai'>;
  aliases: Record<string, 'openai-codex' | 'anthropic' | 'xai' | 'zai'>;
  defaultSmallModels: Record<'openai-codex' | 'anthropic' | 'xai' | 'zai', string>;
  auxiliaryEfforts: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  sessionTitleEffort: 'medium';
  shellReviewEffort: 'medium';
}

let providerSemanticsCache: HoneycrispProviderSemantics | null = null;

export interface HoneycrispSourceRepositoryCandidate {
  url: string;
  label: string;
  sourceAssetId: string;
  sourceAssetKind: string;
  sensitivity: string;
}

export interface HoneycrispMaterializedSourceRepository {
  repositoryUrl: string;
  localPath: string;
  cloned: boolean;
  ref: string | null;
  head: string | null;
  headRefName: string | null;
  headDescribe: string | null;
  requestedRefHead: string | null;
  requestedRefMatchesHead: boolean | null;
}

export interface HoneycrispAgentPluginRuntime {
  runtimeDirectory: string;
  skillDirs: string[];
  selectedSkillIds: string[];
  mcpConfigPath: string | null;
  allowedMcpServers: string[];
  args: string[];
  warnings: string[];
}

export interface HoneycrispBuiltinPlugin {
  id: string;
  path: string;
  installedAt: string;
}

export interface HoneycrispProtocolDescriptor {
  protocol: 'honeycrisp';
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  operations: string[];
  transports: {
    cli: { framing: 'single-json-envelope'; errors: 'envelope-and-nonzero-exit' };
    websocket: {
      path: typeof HONEYCRISP_PROTOCOL_WEBSOCKET_PATH;
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

export function getHoneycrispMemorySummary(
  input: {
    workspaceId: string;
    subjectId: string | null;
    sessionId?: string;
    researchProfile?: ResearchProfileSnapshot | null;
    includeForeignCatalogs?: boolean;
  },
  storage: HoneycrispSessionStorage
): HoneycrispMemorySummary {
  return invokeWithJsonInput<HoneycrispMemorySummary>('memory.summary', ['knowledge', 'summary'], input, storage).result;
}

export function prepareHoneycrispMemoryDreaming(
  typeDescriptions: Record<string, string>,
  profileInput: MemoryDreamingProfileInput,
  nodes: HoneycrispMemoryNodeSummary[],
  edges: HoneycrispMemoryEdgeSummary[],
  sessions: HoneycrispDreamingSessionInput[],
  storage: HoneycrispSessionStorage
): HoneycrispDreamingPreparation {
  return invokeWithJsonInput<HoneycrispDreamingPreparation>(
    'dreaming.prepare',
    ['knowledge', 'dreaming-prepare'],
    { typeDescriptions, profileInput, nodes, edges, sessions },
    storage
  ).result;
}

export function parseHoneycrispMemoryDreamingPlan(
  output: string,
  profileInput: MemoryDreamingProfileInput,
  storage: HoneycrispSessionStorage
): MemoryDreamingPlan {
  return invokeWithJsonInput<MemoryDreamingPlan>(
    'dreaming.parse_plan',
    ['knowledge', 'dreaming-parse-plan'],
    { output, profileInput },
    storage
  ).result;
}

export function applyHoneycrispMemoryDreaming(
  workspaceId: string,
  plan: MemoryDreamingPlan,
  context: MemoryDreamingRunContext,
  profileInput: MemoryDreamingProfileInput,
  storage: HoneycrispSessionStorage
): MemoryDreamingRunSummary {
  return invokeWithJsonInput<MemoryDreamingRunSummary>(
    'dreaming.apply',
    ['knowledge', 'dreaming-apply'],
    { workspaceId, plan, context, profileInput },
    storage
  ).result;
}

export function recordHoneycrispMemoryDreamingFailure(
  workspaceId: string,
  context: MemoryDreamingRunContext,
  errorMessage: string,
  profileInput: MemoryDreamingProfileInput,
  storage: HoneycrispSessionStorage
): MemoryDreamingRunSummary {
  return invokeWithJsonInput<MemoryDreamingRunSummary>(
    'dreaming.record_failure',
    ['knowledge', 'dreaming-record-failure'],
    { workspaceId, context, errorMessage, profileInput },
    storage
  ).result;
}

export function restoreHoneycrispMemoryDreamingChange(
  workspaceId: string,
  changeId: string,
  storage: HoneycrispSessionStorage
): void {
  invokeWithJsonInput<{ restored: true }>(
    'dreaming.restore',
    ['knowledge', 'dreaming-restore'],
    { workspaceId, changeId },
    storage
  );
}

export function getHoneycrispRunbookDocument(
  workspaceId: string,
  runbookId: string,
  storage: HoneycrispSessionStorage
): HoneycrispRunbookDocument {
  return invokeWithJsonInput<HoneycrispRunbookDocument>(
    'runbook.get',
    ['knowledge', 'runbook-get'],
    { workspaceId, runbookId },
    storage
  ).result;
}

export function getHoneycrispReportDocument(
  workspaceId: string,
  reportId: string,
  storage: HoneycrispSessionStorage
): HoneycrispReportDocument {
  return invokeWithJsonInput<HoneycrispReportDocument>(
    'report.get',
    ['knowledge', 'report-get'],
    { workspaceId, reportId },
    storage
  ).result;
}

export function resolveHoneycrispArtifact(
  artifactId: string,
  storage: HoneycrispSessionStorage,
  expectedKind?: string
): HoneycrispResolvedArtifact {
  return invokeWithJsonInput<HoneycrispResolvedArtifact>(
    'artifact.resolve',
    ['knowledge', 'artifact-resolve'],
    { artifactId, ...(expectedKind ? { expectedKind } : {}) },
    storage
  ).result;
}

export function resolveHoneycrispAuxiliaryModelRoute(input: Record<string, unknown>): HoneycrispAuxiliaryModelRoute {
  return invokeWithJsonInput<HoneycrispAuxiliaryModelRoute>(
    'model_job.resolve',
    ['harness', 'model-job-resolve'],
    input,
    null
  ).result;
}

export function getHoneycrispProviderSemantics(): HoneycrispProviderSemantics {
  providerSemanticsCache ??= invokeWithJsonInput<HoneycrispProviderSemantics>(
    'provider.describe',
    ['harness', 'provider-describe'],
    {},
    null
  ).result;
  return providerSemanticsCache;
}

export function inspectHoneycrispSources(input: Record<string, unknown>): {
  urls?: string[];
  normalizedUrl?: string | null;
  candidates?: HoneycrispSourceRepositoryCandidate[];
  selection?: { candidate: HoneycrispSourceRepositoryCandidate | null; candidates: HoneycrispSourceRepositoryCandidate[]; reason: 'matched' | 'ambiguous' | 'not_found' };
} {
  return invokeWithJsonInput<{
    urls?: string[];
    normalizedUrl?: string | null;
    candidates?: HoneycrispSourceRepositoryCandidate[];
    selection?: { candidate: HoneycrispSourceRepositoryCandidate | null; candidates: HoneycrispSourceRepositoryCandidate[]; reason: 'matched' | 'ambiguous' | 'not_found' };
  }>('source.inspect', ['harness', 'source-inspect'], input, null).result;
}

export async function materializeHoneycrispSource(
  candidate: HoneycrispSourceRepositoryCandidate,
  ref: string,
  repositoryStoreDirectory: string | undefined,
  signal?: AbortSignal
): Promise<HoneycrispMaterializedSourceRepository> {
  return (await invokeWithJsonInputAsync<HoneycrispMaterializedSourceRepository>(
    'source.materialize',
    ['harness', 'source-materialize'],
    { candidate, ref, ...(repositoryStoreDirectory ? { repositoryStoreDirectory } : {}) },
    null,
    signal
  )).result;
}

export function materializeHoneycrispSourceSync(
  candidate: HoneycrispSourceRepositoryCandidate,
  ref: string,
  repositoryStoreDirectory?: string
): HoneycrispMaterializedSourceRepository {
  return invokeWithJsonInput<HoneycrispMaterializedSourceRepository>(
    'source.materialize',
    ['harness', 'source-materialize'],
    { candidate, ref, ...(repositoryStoreDirectory ? { repositoryStoreDirectory } : {}) },
    null
  ).result;
}

export function listHoneycrispPlugins(input: Record<string, unknown>): AgentPluginRegistryState {
  return invokeWithJsonInput<AgentPluginRegistryState>('plugin.list', ['harness', 'plugin-list'], input, null).result;
}

export function addHoneycrispPluginFromFilesystem(input: Record<string, unknown>): AgentPluginRegistryState {
  return invokeWithJsonInput<AgentPluginRegistryState>('plugin.add_filesystem', ['harness', 'plugin-add-filesystem'], input, null).result;
}

export async function addHoneycrispPluginFromRepository(input: Record<string, unknown>): Promise<AgentPluginRegistryState> {
  return (await invokeWithJsonInputAsync<AgentPluginRegistryState>(
    'plugin.add_repository', ['harness', 'plugin-add-repository'], input, null
  )).result;
}

export function setHoneycrispPluginEnabled(input: Record<string, unknown>): AgentPluginRegistryState {
  return invokeWithJsonInput<AgentPluginRegistryState>('plugin.set_enabled', ['harness', 'plugin-set-enabled'], input, null).result;
}

export function removeHoneycrispPlugin(input: Record<string, unknown>): AgentPluginRegistryState {
  return invokeWithJsonInput<AgentPluginRegistryState>('plugin.remove', ['harness', 'plugin-remove'], input, null).result;
}

export function getHoneycrispPluginRuntime(input: Record<string, unknown>): HoneycrispAgentPluginRuntime {
  return invokeWithJsonInput<HoneycrispAgentPluginRuntime>('plugin.runtime', ['harness', 'plugin-runtime'], input, null).result;
}

export function getHoneycrispMaintenanceSummary(workspacePath: string): WorkspaceDejunkSummary {
  return invokeWithJsonInput<WorkspaceDejunkSummary>(
    'maintenance.summary', ['harness', 'maintenance-summary'], { workspacePath }, null
  ).result;
}

export function runHoneycrispMaintenance(workspacePath: string): WorkspaceDejunkSummary {
  return invokeWithJsonInput<WorkspaceDejunkSummary>(
    'maintenance.run', ['harness', 'maintenance-run'], { workspacePath }, null
  ).result;
}

export function invokeHoneycrispCliProtocol<T>(
  operation: string,
  args: readonly string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): HoneycrispProtocolSuccess<T> {
  const invocation = resolveHoneycrispProtocolInvocation();
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
    const detail = safeProtocolDetail(result.stderr || result.stdout || 'Honeycrisp returned no protocol envelope.');
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
  storage: HoneycrispSessionStorage | null
): HoneycrispProtocolSuccess<T> {
  const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
  const inputPath = join(directory, 'input.json');
  try {
    writeFileSync(inputPath, `${JSON.stringify(input)}\n`, { encoding: 'utf8', mode: 0o600 });
    return invokeHoneycrispCliProtocol<T>(operation, [...args, '--input', inputPath, '--json'], {
      ...(storage ? { env: storageEnvironment(storage) } : {})
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function invokeWithJsonInputAsync<T>(
  operation: string,
  args: readonly string[],
  input: unknown,
  storage: HoneycrispSessionStorage | null,
  signal?: AbortSignal
): Promise<HoneycrispProtocolSuccess<T>> {
  const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
  const inputPath = join(directory, 'input.json');
  try {
    writeFileSync(inputPath, `${JSON.stringify(input)}\n`, { encoding: 'utf8', mode: 0o600 });
    return await invokeHoneycrispCliProtocolAsync<T>(operation, [...args, '--input', inputPath, '--json'], {
      ...(storage ? { env: storageEnvironment(storage) } : {}),
      ...(signal ? { signal } : {})
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function invokeHoneycrispCliProtocolAsync<T>(
  operation: string,
  args: readonly string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal; stdin?: string } = {}
): Promise<HoneycrispProtocolSuccess<T>> {
  const invocation = resolveHoneycrispProtocolInvocation();
  const child = spawn(invocation.command, [...invocation.prefixArgs, ...args], {
    cwd: invocation.cwd,
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? '1', ...options.env },
    windowsHide: true
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(options.stdin ?? '');
  return new Promise((resolvePromise, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current: string, chunk: Buffer): string => (current + chunk.toString('utf8')).slice(-2_000_000);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = (): void => {
      child.kill('SIGTERM');
      finish(() => reject(new Error(`Honeycrisp ${operation} was canceled.`)));
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new Error(`Honeycrisp ${operation} timed out.`)));
    }, options.timeoutMs ?? 5 * 60_000);
    timeout.unref();
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => finish(() => {
      try {
        const envelope = decodeHoneycrispProtocolEnvelope<T>(stdout.trim());
        if (envelope.operation !== operation) throw new Error(`Honeycrisp protocol operation mismatch: expected ${operation}, received ${envelope.operation}.`);
        if (!envelope.ok) throw new Error(`Honeycrisp ${operation} failed (${envelope.error.code}): ${envelope.error.message}`);
        if (code !== 0) throw new Error(`Honeycrisp ${operation} returned success with exit status ${String(code)}.`);
        resolvePromise(envelope);
      } catch (error) {
        const detail = safeProtocolDetail(stderr || stdout || `Honeycrisp ${operation} returned no envelope.`);
        reject(error instanceof Error ? new Error(`${error.message}${detail ? ` ${detail}` : ''}`, { cause: error }) : new Error(detail));
      }
    }));
  });
}

function safeProtocolDetail(value: unknown): string {
  return String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/(?:sk|xai)-[A-Za-z0-9_-]+/gu, '...redacted')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer ...redacted')
    .trim()
    .slice(-2_000);
}

function storageEnvironment(storage: HoneycrispSessionStorage): NodeJS.ProcessEnv {
  return {
    HONEYCRISP_DATABASE_PATH: storage.databasePath,
    HONEYCRISP_ARTIFACT_DIRECTORY: storage.artifactDirectoryPath
  };
}
