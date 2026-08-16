import type { RunDetail, RunDetailUpdate, RunDetailUpdateCursor, TraceEventRecord, TranscriptMessageRecord, WorkspaceSnapshot } from '@shared/types';
import type { DevMetricDetail } from '../devInstrumentation';

export function selectRunId(current: string | null, snapshot: WorkspaceSnapshot | null): string | null {
  if (!snapshot) return null;
  if (current && snapshot.runs.some(({ run }) => run.id === current)) return current;
  return null;
}

export function snapshotMetricDetail(snapshot: WorkspaceSnapshot | null): DevMetricDetail {
  return {
    active: Boolean(snapshot),
    runs: snapshot?.runs.length ?? 0,
    notifications: snapshot?.notifications.length ?? 0,
    workspaces: snapshot?.workspace ? 1 : 0
  };
}

export function runDetailMetricDetail(detail: RunDetail): DevMetricDetail {
  return {
    run: shortMetricId(detail.run.id),
    status: detail.run.status,
    traceEvents: detail.traceEvents.length,
    transcripts: detail.transcriptMessages.length,
    artifacts: detail.artifacts.length,
    memoryNodes: detail.honeycrispMemory?.nodes.length ?? 0
  };
}

export function runDetailUpdateMetricDetail(update: RunDetailUpdate): DevMetricDetail {
  return {
    run: shortMetricId(update.run.id),
    status: update.run.status,
    versionDatabaseMs: update.version.databaseMs,
    traceEvents: update.traceEvents.length,
    transcripts: update.transcriptMessages.length,
    artifacts: update.artifacts.length,
    memoryNodes: update.honeycrispMemory?.nodes.length ?? 0
  };
}

export function runDetailUpdateCursor(detail: RunDetail): RunDetailUpdateCursor {
  const latestTrace = detail.traceEvents.at(-1);
  const sessionEventId = typeof latestTrace?.payload.honeycrispSessionEventId === 'string'
    ? latestTrace.payload.honeycrispSessionEventId
    : latestTrace?.id ?? null;
  return {
    afterTraceSequence: latestTrace?.sequence ?? -1,
    afterTranscriptCount: detail.transcriptMessages.length,
    afterTraceEventId: sessionEventId
  };
}

export function mergeRunDetailUpdate(current: RunDetail, update: RunDetailUpdate): RunDetail {
  return {
    run: update.run,
    researchProfile: update.researchProfile ?? current.researchProfile ?? null,
    nextStepSuggestions: update.nextStepSuggestions === undefined
      ? current.nextStepSuggestions ?? null
      : update.nextStepSuggestions,
    attempts: update.attempts,
    traceEvents: mergeTraceEvents(current.traceEvents, update.traceEvents),
    transcriptMessages: mergeTranscriptMessages(current.transcriptMessages, update.transcriptMessages),
    breakoutRooms: mergeRecordsById(current.breakoutRooms ?? [], update.breakoutRooms ?? []),
    breakoutRoomMembers: mergeRecordsById(current.breakoutRoomMembers ?? [], update.breakoutRoomMembers ?? []),
    breakoutRoomMessages: mergeRecordsById(current.breakoutRoomMessages ?? [], update.breakoutRoomMessages ?? []),
    artifacts: mergeRecordsById(current.artifacts, update.artifacts),
    verifierContracts: mergeRecordsById(current.verifierContracts, update.verifierContracts),
    verifierRuns: mergeRecordsById(current.verifierRuns, update.verifierRuns),
    modelSessions: mergeRecordsById(current.modelSessions, update.modelSessions),
    contextCompactions: mergeRecordsById(current.contextCompactions, update.contextCompactions),
    policyEvents: mergeRecordsById(current.policyEvents, update.policyEvents),
    exports: mergeRecordsById(current.exports, update.exports),
    honeycrispMemory: update.honeycrispMemory ?? current.honeycrispMemory
  };
}

function mergeRecordsById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return current;
  if (current.length === 0) return incoming;
  const byId = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  return [...byId.values()];
}

export function shortMetricId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function mergeTraceEvents(current: TraceEventRecord[], incoming: TraceEventRecord[]): TraceEventRecord[] {
  if (incoming.length === 0) return current;
  if (canAppendTraceEvents(current, incoming)) return [...current, ...incoming];
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort((left, right) => left.sequence - right.sequence);
}

function mergeTranscriptMessages(current: TranscriptMessageRecord[], incoming: TranscriptMessageRecord[]): TranscriptMessageRecord[] {
  if (incoming.length === 0) return current;
  if (canAppendTranscriptMessages(current, incoming)) return [...current, ...incoming];
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort(compareTranscriptMessages);
}

function canAppendTraceEvents(current: readonly TraceEventRecord[], incoming: readonly TraceEventRecord[]): boolean {
  const lastSequence = current.at(-1)?.sequence;
  if (lastSequence !== undefined && incoming[0]!.sequence <= lastSequence) return false;
  return incoming.every((event, index) => index === 0 || incoming[index - 1]!.sequence < event.sequence);
}

function canAppendTranscriptMessages(
  current: readonly TranscriptMessageRecord[],
  incoming: readonly TranscriptMessageRecord[]
): boolean {
  const lastCurrent = current.at(-1);
  if (lastCurrent && compareTranscriptMessages(lastCurrent, incoming[0]!) >= 0) return false;
  return incoming.every((message, index) => index === 0 || compareTranscriptMessages(incoming[index - 1]!, message) < 0);
}

function compareTranscriptMessages(left: TranscriptMessageRecord, right: TranscriptMessageRecord): number {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
}
