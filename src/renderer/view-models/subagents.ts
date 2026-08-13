import type { RunStatus, TraceEventRecord } from '@shared/types';
import {
  chatMessageCorrelationKey,
  nativeCommentaryCorrelationKeys,
  type ChatView
} from './chatView';

export type SubagentStatus = 'pending' | 'running' | 'completed' | 'interrupted' | 'errored';

export interface SubagentSummary {
  id: string | null;
  path: string;
  name: string;
  provider: string | null;
  model: string | null;
  status: SubagentStatus;
  latestMessage: string;
  createdAt: string;
  lastActiveAt: string;
}

interface SubagentAccumulator extends SubagentSummary {
  attemptId: string | null;
  spawnedAt: string | null;
  lastSequence: number;
}

const ACTIVE_SUBAGENT_STATUSES = new Set(['pending', 'running']);
const SUBAGENT_STATUSES = new Set<SubagentStatus>(['pending', 'running', 'completed', 'interrupted', 'errored']);

export function activeSubagentCount(subagents: readonly SubagentSummary[]): number {
  return subagents.filter((subagent) => ACTIVE_SUBAGENT_STATUSES.has(subagent.status)).length;
}

export function subagentCatalogGroups(subagents: readonly SubagentSummary[]): {
  active: SubagentSummary[];
  completed: SubagentSummary[];
} {
  const active: SubagentSummary[] = [];
  const completed: SubagentSummary[] = [];
  for (const subagent of subagents) {
    (ACTIVE_SUBAGENT_STATUSES.has(subagent.status) ? active : completed).push(subagent);
  }
  const newestFirst = (left: SubagentSummary, right: SubagentSummary): number =>
    right.createdAt.localeCompare(left.createdAt) || left.path.localeCompare(right.path);
  active.sort(newestFirst);
  completed.sort(newestFirst);
  return { active, completed };
}

export function subagentStatusCountSummary(subagents: readonly SubagentSummary[]): string {
  const activeCount = activeSubagentCount(subagents);
  const completedCount = subagents.filter((subagent) => !ACTIVE_SUBAGENT_STATUSES.has(subagent.status)).length;
  return [
    activeCount > 0 ? `${activeCount} Active` : null,
    completedCount > 0 ? `${completedCount} Completed` : null
  ].filter((label): label is string => label !== null).join(', ');
}

export function subagentStatusLabel(status: SubagentStatus): string {
  if (status === 'errored') return 'Error';
  return `${status[0]?.toUpperCase() ?? ''}${status.slice(1)}`;
}

export function subagentStatusIconKind(status: SubagentStatus): 'active' | 'error' | 'success' {
  if (ACTIVE_SUBAGENT_STATUSES.has(status)) return 'active';
  return status === 'completed' ? 'success' : 'error';
}

export function subagentDisplayName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\S+/g, (word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`);
}

export function filterSubagentSummaries(
  subagents: readonly SubagentSummary[],
  query: string
): SubagentSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...subagents];
  return subagents.filter((subagent) => [
    subagent.id ?? '',
    subagent.path,
    subagent.name,
    subagentDisplayName(subagent.name),
    subagent.provider ?? '',
    subagent.model ?? '',
    subagent.status,
    subagent.latestMessage
  ].join('\n').toLocaleLowerCase().includes(normalizedQuery));
}

export function subagentSummaries(
  events: TraceEventRecord[],
  runStatus?: RunStatus | null,
  chatView: ChatView = 'traces'
): SubagentSummary[] {
  const summaries = new Map<string, SubagentAccumulator>();
  const currentAttemptId = latestRootAttemptId(events);
  const recoveryInterruptionSequence = latestRecoveryInterruptionSequence(events);
  const nativeCommentaryKeys = chatView === 'commentary' ? nativeCommentaryCorrelationKeys(events) : new Set<string>();

  for (const event of events) {
    const path = traceAgentPath(event);
    if (!path || path === '/root') continue;
    const timestamp = subagentEventTimestamp(event);
    const eventType = subagentPayloadValue(event, 'type');
    const action = subagentPayloadValue(event, 'action');
    const lifecycleEvent = eventType === 'subagent.activity';
    const spawnEvent = lifecycleEvent && action === 'spawned';
    const current = summaries.get(path) ?? {
      id: null,
      path,
      name: subagentName(path),
      provider: null,
      model: null,
      status: 'running',
      latestMessage: '',
      createdAt: timestamp,
      lastActiveAt: timestamp,
      attemptId: event.attemptId,
      spawnedAt: null,
      lastSequence: event.sequence
    };
    const message = chatView === 'commentary'
      ? subagentAssistantPreview(event, nativeCommentaryKeys) ?? subagentActivityMessage(event)
      : subagentMessage(event);
    summaries.set(path, {
      ...current,
      id: subagentPayloadValue(event, 'agentId') ?? current.id,
      provider: subagentPayloadValue(event, 'provider') ?? current.provider,
      model: subagentPayloadValue(event, 'model') ?? current.model,
      status: lifecycleEvent
        ? subagentLifecycleStatus(subagentPayloadValue(event, 'status'), action) ?? current.status
        : current.status,
      latestMessage: message ?? current.latestMessage,
      createdAt: earlierTimestamp(current.createdAt, timestamp),
      lastActiveAt: laterTimestamp(current.lastActiveAt, timestamp),
      attemptId: event.attemptId ?? current.attemptId,
      lastSequence: Math.max(current.lastSequence, event.sequence),
      spawnedAt: spawnEvent
        ? current.spawnedAt
          ? earlierTimestamp(current.spawnedAt, timestamp)
          : timestamp
        : current.spawnedAt
    });
  }

  return [...summaries.values()].map(({ attemptId, spawnedAt, lastSequence, ...summary }) => ({
    ...summary,
    status: reconciledSubagentStatus(
      summary.status,
      attemptId,
      currentAttemptId,
      runStatus,
      lastSequence,
      recoveryInterruptionSequence
    ),
    createdAt: spawnedAt ?? summary.createdAt
  })).sort((left, right) => {
    const timeDifference = timestampOrder(left.createdAt, right.createdAt);
    return timeDifference || left.path.localeCompare(right.path);
  });
}

export function traceEventsForSubagent<TEvent extends TraceEventRecord>(events: TEvent[], path: string | null): TEvent[] {
  if (!path) {
    return events.filter((event) => {
      const agentPath = traceAgentPath(event);
      return !agentPath || agentPath === '/root';
    });
  }
  return events.filter((event) => traceAgentPath(event) === path);
}

export function traceAgentPath(event: TraceEventRecord): string | null {
  return stringValue(event.payload.agentPath);
}

function subagentMessage(event: TraceEventRecord): string | null {
  const activityMessage = subagentActivityMessage(event);
  if (activityMessage) return activityMessage;
  return normalizedPreview(
    subagentPayloadValue(event, 'text') ??
      subagentPayloadValue(event, 'outputText') ??
      subagentPayloadValue(event, 'message')
  );
}

function subagentActivityMessage(event: TraceEventRecord): string | null {
  const eventType = subagentPayloadValue(event, 'type');
  const action = subagentPayloadValue(event, 'action');
  if (eventType === 'subagent.activity') {
    if (!action || ['spawned', 'message', 'followup', 'interrupted', 'completed', 'errored'].includes(action)) {
      return normalizedPreview(subagentPayloadValue(event, 'message'));
    }
  }
  return null;
}

function subagentAssistantPreview(
  event: TraceEventRecord,
  nativeCommentaryKeys: ReadonlySet<string>
): string | null {
  const transcriptRole = subagentPayloadValue(event, 'transcriptRole');
  const transcriptSource = subagentPayloadValue(event, 'transcriptSource');
  const messagePhase = subagentPayloadValue(event, 'messagePhase') ?? subagentMetadataValue(event, 'messagePhase');
  const nativeCommentary = transcriptSource === 'honeycrisp_commentary' || (
    transcriptRole === 'assistant' &&
    messagePhase === 'commentary' &&
    transcriptSource !== 'openai_reasoning_summary'
  );
  const legacyCommentary = transcriptSource === 'openai_reasoning_summary';
  const finalAnswer = transcriptRole === 'assistant' && (messagePhase === 'final_answer' || transcriptSource === 'honeycrisp');
  const correlationKey = chatMessageCorrelationKey(event);
  const suppressedLegacyCommentary = legacyCommentary && correlationKey !== null && nativeCommentaryKeys.has(correlationKey);
  if (!nativeCommentary && !finalAnswer && !(legacyCommentary && !suppressedLegacyCommentary)) {
    return null;
  }
  return normalizedPreview(
    subagentPayloadValue(event, 'text') ??
      subagentPayloadValue(event, 'outputText') ??
      subagentPayloadValue(event, 'message')
  );
}

function subagentEventTimestamp(event: TraceEventRecord): string {
  const honeycrispTimestamp = stringValue(event.payload.honeycrispTimestamp);
  return honeycrispTimestamp && Number.isFinite(Date.parse(honeycrispTimestamp)) ? honeycrispTimestamp : event.createdAt;
}

function subagentPayloadValue(event: TraceEventRecord, key: string): string | null {
  const direct = stringValue(event.payload[key]);
  if (direct) return direct;
  const nested = event.payload.payload;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null;
  return stringValue((nested as Record<string, unknown>)[key]);
}

function subagentMetadataValue(event: TraceEventRecord, key: string): string | null {
  const metadata = event.payload.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return stringValue((metadata as Record<string, unknown>)[key]);
}

function normalizedPreview(value: string | null): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/```(?:[\w-]+)?\s*([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}(?:\s+|$)/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function subagentName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function subagentLifecycleStatus(status: string | null, action: string | null): SubagentStatus | null {
  const normalizedStatus = status?.trim().toLowerCase();
  if (normalizedStatus && SUBAGENT_STATUSES.has(normalizedStatus as SubagentStatus)) {
    return normalizedStatus as SubagentStatus;
  }
  if (action === 'spawned' || action === 'followup') return 'running';
  if (action === 'completed') return 'completed';
  if (action === 'interrupted') return 'interrupted';
  if (action === 'errored') return 'errored';
  return null;
}

function reconciledSubagentStatus(
  status: SubagentStatus,
  attemptId: string | null,
  currentAttemptId: string | null,
  runStatus: RunStatus | null | undefined,
  lastSequence: number,
  recoveryInterruptionSequence: number | null
): SubagentStatus {
  if (!ACTIVE_SUBAGENT_STATUSES.has(status)) return status;
  if (attemptId && currentAttemptId && attemptId !== currentAttemptId) return 'interrupted';
  if (runStatus && !['queued', 'active', 'paused'].includes(runStatus)) return 'interrupted';
  if (
    runStatus === 'paused' &&
    recoveryInterruptionSequence !== null &&
    lastSequence < recoveryInterruptionSequence
  ) {
    return 'interrupted';
  }
  return status;
}

function latestRecoveryInterruptionSequence(events: readonly TraceEventRecord[]): number | null {
  let sequence: number | null = null;
  for (const event of events) {
    const recoveryInterruption = event.payload.interruptedByRecovery === true ||
      event.summary === 'Workspace recovery paused interrupted run after app restart.';
    if (!recoveryInterruption) continue;
    sequence = sequence === null ? event.sequence : Math.max(sequence, event.sequence);
  }
  return sequence;
}

function latestRootAttemptId(events: readonly TraceEventRecord[]): string | null {
  let attemptId: string | null = null;
  for (const event of events) {
    const agentPath = traceAgentPath(event);
    if (agentPath && agentPath !== '/root') continue;
    attemptId = event.attemptId ?? attemptId;
  }
  return attemptId;
}

function earlierTimestamp(left: string, right: string): string {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return leftMs <= rightMs ? left : right;
}

function laterTimestamp(left: string, right: string): string {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return leftMs <= rightMs ? right : left;
}

function timestampOrder(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return Number.isFinite(rightMs) ? 1 : 0;
  if (!Number.isFinite(rightMs)) return -1;
  return leftMs - rightMs;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
