import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import {
  decodeHoneycrispProtocolEnvelope,
  type HoneycrispProtocolDescriptor,
  type HoneycrispProtocolEnvelope,
  type HoneycrispProtocolSuccess
} from './honeycrispProtocol';
export {
  HONEYCRISP_PROTOCOL_VERSION,
  HONEYCRISP_PROTOCOL_WEBSOCKET_PATH,
  decodeHoneycrispProtocolEnvelope
} from './honeycrispProtocol';
export type {
  HoneycrispProtocolDescriptor,
  HoneycrispProtocolEnvelope,
  HoneycrispProtocolFailure,
  HoneycrispProtocolSuccess
} from './honeycrispProtocol';

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

export type HoneycrispSessionSummary = Omit<
  HoneycrispSessionRecord,
  'attempts' | 'events' | 'finalResponse'
> & {
  attempts: Array<Omit<HoneycrispSessionAttempt, 'capture'>>;
  tokenUsage?: { totalTokens: number };
};

export interface HoneycrispSessionUpdate {
  session: HoneycrispSessionSummary;
  finalResponse: string | null;
  events: HoneycrispSessionEvent[];
  eventOffset: number;
}

export interface HoneycrispSessionMutationReceipt {
  sessionId: string;
  status: HoneycrispSessionStatus;
  revision: number;
  updatedAt: string;
}

export interface HoneycrispSessionStorage {
  databasePath: string;
  artifactDirectoryPath: string;
}

export interface HoneycrispSessionRecoveryReport {
  workspaceId: string;
  recoveredAt: string;
  reason: string;
  interruptedSessions: number;
  interruptedAttempts: number;
  sessionIds: string[];
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
  provider: string;
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
  provider: 'openai-codex' | 'anthropic' | 'xai' | 'zai' | 'openrouter';
  model: string;
  effort: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface HoneycrispProviderSemantics {
  providers: Array<'openai-codex' | 'anthropic' | 'xai' | 'zai' | 'openrouter'>;
  aliases: Record<string, 'openai-codex' | 'anthropic' | 'xai' | 'zai' | 'openrouter'>;
  defaultSmallModels: Record<'openai-codex' | 'anthropic' | 'xai' | 'zai' | 'openrouter', string>;
  auxiliaryEfforts: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  sessionTitleEffort: 'medium';
  shellReviewEffort: 'medium';
}

let providerSemanticsCache: HoneycrispProviderSemantics | null = null;
const HONEYCRISP_PROTOCOL_MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const HONEYCRISP_PROTOCOL_MAX_STDERR_CHARS = 2_000_000;

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
  enabledByDefault?: boolean;
}

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
      'session.append_event_receipt',
      'session.transition',
      'session.recover_interrupted',
      'session.import_capture',
      'session.get',
      'session.get_update',
      'session.list',
      'session.list_summaries'
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
): HoneycrispSessionMutationReceipt {
  return invokeWithJsonInput<HoneycrispSessionMutationReceipt>(
    'session.append_event_receipt',
    ['session', 'append-event-receipt', '--session-id', sessionId],
    input,
    storage
  ).result;
}

export async function appendHoneycrispSessionEventAsync(
  sessionId: string,
  input: HoneycrispSessionEvent,
  storage: HoneycrispSessionStorage,
  signal?: AbortSignal
): Promise<HoneycrispSessionMutationReceipt> {
  return (await invokeWithJsonInputAsync<HoneycrispSessionMutationReceipt>(
    'session.append_event_receipt',
    ['session', 'append-event-receipt', '--session-id', sessionId],
    input,
    storage,
    signal,
    30_000
  )).result;
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

export function recoverInterruptedHoneycrispSessions(
  workspaceId: string,
  input: { reason?: string; at?: string },
  storage: HoneycrispSessionStorage
): HoneycrispSessionRecoveryReport {
  return invokeWithJsonInput<HoneycrispSessionRecoveryReport>(
    'session.recover_interrupted',
    ['session', 'recover-interrupted', '--workspace-id', workspaceId],
    input,
    storage
  ).result;
}

export async function recoverInterruptedHoneycrispSessionsAsync(
  workspaceId: string,
  input: { reason?: string; at?: string },
  storage: HoneycrispSessionStorage
): Promise<HoneycrispSessionRecoveryReport> {
  return (await invokeWithJsonInputAsync<HoneycrispSessionRecoveryReport>(
    'session.recover_interrupted',
    ['session', 'recover-interrupted', '--workspace-id', workspaceId],
    input,
    storage,
    undefined,
    30_000
  )).result;
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

export async function getHoneycrispSessionAsync(
  sessionId: string,
  storage: HoneycrispSessionStorage,
  signal?: AbortSignal
): Promise<HoneycrispSessionRecord> {
  return (await invokeHoneycrispCliProtocolAsync<HoneycrispSessionRecord>(
    'session.get',
    ['session', 'get', '--session-id', sessionId, '--json'],
    { env: storageEnvironment(storage), timeoutMs: 30_000, ...(signal ? { signal } : {}) }
  )).result;
}

export async function getHoneycrispSessionUpdateAsync(
  sessionId: string,
  afterEventId: string | null,
  storage: HoneycrispSessionStorage,
  signal?: AbortSignal
): Promise<HoneycrispSessionUpdate> {
  return (await invokeHoneycrispCliProtocolAsync<HoneycrispSessionUpdate>(
    'session.get_update',
    [
      'session',
      'get-update',
      '--session-id',
      sessionId,
      ...(afterEventId ? ['--after-event-id', afterEventId] : []),
      '--json'
    ],
    { env: storageEnvironment(storage), timeoutMs: 30_000, ...(signal ? { signal } : {}) }
  )).result;
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

export function listHoneycrispSessionSummaries(
  workspaceId: string,
  storage: HoneycrispSessionStorage,
  limit = 100
): HoneycrispSessionSummary[] {
  return invokeHoneycrispCliProtocol<HoneycrispSessionSummary[]>(
    'session.list_summaries',
    ['session', 'list-summaries', '--workspace-id', workspaceId, '--limit', String(limit), '--json'],
    { env: storageEnvironment(storage) }
  ).result;
}

export async function listHoneycrispSessionSummariesAsync(
  workspaceId: string,
  storage: HoneycrispSessionStorage,
  limit = 200
): Promise<HoneycrispSessionSummary[]> {
  return (await invokeHoneycrispCliProtocolAsync<HoneycrispSessionSummary[]>(
    'session.list_summaries',
    ['session', 'list-summaries', '--workspace-id', workspaceId, '--limit', String(limit), '--json'],
    { env: storageEnvironment(storage), timeoutMs: 30_000 }
  )).result;
}

export async function listHoneycrispSessionSummariesForWorkspacesAsync(
  workspaceIds: readonly string[],
  storage: HoneycrispSessionStorage,
  limitPerWorkspace = 200
): Promise<HoneycrispSessionSummary[]> {
  const normalizedWorkspaceIds = [...new Set(workspaceIds.map((workspaceId) => workspaceId.trim()).filter(Boolean))];
  if (normalizedWorkspaceIds.length === 0) return [];
  return (await invokeHoneycrispCliProtocolAsync<HoneycrispSessionSummary[]>(
    'session.list_summaries',
    [
      'session',
      'list-summaries',
      ...normalizedWorkspaceIds.flatMap((workspaceId) => ['--workspace-id', workspaceId]),
      '--limit',
      String(limitPerWorkspace),
      '--json'
    ],
    { env: storageEnvironment(storage), timeoutMs: 30_000 }
  )).result;
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

export async function getHoneycrispMemorySummaryAsync(
  input: {
    workspaceId: string;
    subjectId: string | null;
    sessionId?: string;
    researchProfile?: ResearchProfileSnapshot | null;
    includeForeignCatalogs?: boolean;
  },
  storage: HoneycrispSessionStorage,
  signal?: AbortSignal
): Promise<HoneycrispMemorySummary> {
  return (await invokeWithJsonInputAsync<HoneycrispMemorySummary>(
    'memory.summary',
    ['knowledge', 'summary'],
    input,
    storage,
    signal,
    10_000
  )).result;
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
    signal,
    null
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

export async function getHoneycrispMaintenanceSummaryAsync(workspacePath: string): Promise<WorkspaceDejunkSummary> {
  return (await invokeWithJsonInputAsync<WorkspaceDejunkSummary>(
    'maintenance.summary', ['harness', 'maintenance-summary'], { workspacePath }, null
  )).result;
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
  const requestId = `beale-${randomUUID()}`;
  const result = spawnSync(invocation.command, [...invocation.prefixArgs, ...args, '--request-id', requestId], {
    cwd: invocation.cwd,
    encoding: 'utf8',
    env: protocolEnvironment(options.env),
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: HONEYCRISP_PROTOCOL_MAX_STDOUT_BYTES,
    windowsHide: true
  });
  let envelope: HoneycrispProtocolEnvelope<T>;
  try {
    envelope = decodeHoneycrispProtocolEnvelope<T>(String(result.stdout ?? '').trim());
  } catch (error) {
    const detail = protocolProcessDetail(result);
    throw new Error(`Honeycrisp ${operation} returned an invalid protocol envelope${detail ? ` (${detail})` : ''}.`, { cause: error });
  }
  if (envelope.operation !== operation) {
    throw new Error(`Honeycrisp protocol operation mismatch: expected ${operation}, received ${envelope.operation}.`);
  }
  if (envelope.requestId !== requestId) {
    throw new Error(`Honeycrisp protocol request mismatch: expected ${requestId}, received ${envelope.requestId ?? 'none'}.`);
  }
  if (!envelope.ok) {
    throw new Error(`Honeycrisp ${operation} failed (${envelope.error.code}): ${envelope.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Honeycrisp ${operation} returned a success envelope with exit status ${String(result.status)}.`);
  }
  return envelope;
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
  signal?: AbortSignal,
  timeoutMs?: number | null
): Promise<HoneycrispProtocolSuccess<T>> {
  const directory = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-protocol-'));
  const inputPath = join(directory, 'input.json');
  try {
    writeFileSync(inputPath, `${JSON.stringify(input)}\n`, { encoding: 'utf8', mode: 0o600 });
    return await invokeHoneycrispCliProtocolAsync<T>(operation, [...args, '--input', inputPath, '--json'], {
      ...(storage ? { env: storageEnvironment(storage) } : {}),
      ...(signal ? { signal } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function invokeHoneycrispCliProtocolAsync<T>(
  operation: string,
  args: readonly string[],
  options: { timeoutMs?: number | null; env?: NodeJS.ProcessEnv; signal?: AbortSignal; stdin?: string } = {}
): Promise<HoneycrispProtocolSuccess<T>> {
  const invocation = resolveHoneycrispProtocolInvocation();
  const requestId = `beale-${randomUUID()}`;
  const child = spawn(invocation.command, [...invocation.prefixArgs, ...args, '--request-id', requestId], {
    cwd: invocation.cwd,
    env: protocolEnvironment(options.env),
    windowsHide: true
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(options.stdin ?? '');
  return new Promise((resolvePromise, reject) => {
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = (): void => {
      child.kill('SIGTERM');
      finish(() => reject(new Error(`Honeycrisp ${operation} was canceled.`)));
    };
    const timeout = options.timeoutMs === null ? null : setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new Error(`Honeycrisp ${operation} timed out.`)));
    }, options.timeoutMs ?? 5 * 60_000);
    timeout?.unref();
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > HONEYCRISP_PROTOCOL_MAX_STDOUT_BYTES) {
        child.kill('SIGTERM');
        finish(() => reject(new Error(
          `Honeycrisp ${operation} exceeded the ${HONEYCRISP_PROTOCOL_MAX_STDOUT_BYTES}-byte protocol response limit.`
        )));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-HONEYCRISP_PROTOCOL_MAX_STDERR_CHARS);
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => finish(() => {
      const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8');
      try {
        const envelope = decodeHoneycrispProtocolEnvelope<T>(stdout.trim());
        if (envelope.operation !== operation) throw new Error(`Honeycrisp protocol operation mismatch: expected ${operation}, received ${envelope.operation}.`);
        if (envelope.requestId !== requestId) throw new Error(`Honeycrisp protocol request mismatch: expected ${requestId}, received ${envelope.requestId ?? 'none'}.`);
        if (!envelope.ok) throw new Error(`Honeycrisp ${operation} failed (${envelope.error.code}): ${envelope.error.message}`);
        if (code !== 0) throw new Error(`Honeycrisp ${operation} returned success with exit status ${String(code)}.`);
        resolvePromise(envelope);
      } catch (error) {
        const detail = asyncProtocolProcessDetail(code, stdout, stderr);
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

function protocolEnvironment(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NO_COLOR: process.env.NO_COLOR ?? '1',
    NODE_NO_WARNINGS: '1',
    ...overrides
  };
}

function protocolProcessDetail(result: ReturnType<typeof spawnSync>): string {
  const details: string[] = [];
  if (result.error) details.push(`process error: ${result.error.message}`);
  if (result.signal) details.push(`signal: ${result.signal}`);
  if (result.status !== null && result.status !== 0) details.push(`exit status: ${result.status}`);
  const stderr = safeProtocolDetail(result.stderr);
  if (stderr) details.push(`stderr: ${stderr}`);
  const stdoutBytes = Buffer.byteLength(String(result.stdout ?? ''), 'utf8');
  if (stdoutBytes > 0) details.push(`invalid stdout bytes: ${stdoutBytes}`);
  return details.join('; ');
}

function asyncProtocolProcessDetail(code: number | null, stdout: string, stderr: string): string {
  const details: string[] = [];
  if (code !== null && code !== 0) details.push(`exit status: ${code}`);
  const safeStderr = safeProtocolDetail(stderr);
  if (safeStderr) details.push(`stderr: ${safeStderr}`);
  const stdoutBytes = Buffer.byteLength(stdout, 'utf8');
  if (stdoutBytes > 0) details.push(`invalid stdout bytes: ${stdoutBytes}`);
  return details.length > 0 ? `(${details.join('; ')})` : '';
}

function storageEnvironment(storage: HoneycrispSessionStorage): NodeJS.ProcessEnv {
  return {
    HONEYCRISP_DATABASE_PATH: storage.databasePath,
    HONEYCRISP_ARTIFACT_DIRECTORY: storage.artifactDirectoryPath
  };
}
