import type { RunDetail, RunDetailUpdate, TraceEventRecord, TranscriptMessageRecord, WorkspaceSnapshot } from '@shared/types';
import type { DevMetricDetail } from '../devInstrumentation';

export function selectRunId(current: string | null, snapshot: WorkspaceSnapshot | null): string | null {
  if (!snapshot) return null;
  if (current && snapshot.runs.some(({ run }) => run.id === current)) return current;
  return snapshot.runs.find(({ run }) => run.status === 'active' || run.status === 'queued')?.run.id ?? null;
}

export function snapshotMetricDetail(snapshot: WorkspaceSnapshot | null): DevMetricDetail {
  return {
    active: Boolean(snapshot),
    runs: snapshot?.runs.length ?? 0,
    notifications: snapshot?.notifications.length ?? 0,
    programs: snapshot?.workspace ? 1 : 0
  };
}

export function runDetailMetricDetail(detail: RunDetail): DevMetricDetail {
  return {
    run: shortMetricId(detail.run.id),
    status: detail.run.status,
    traceEvents: detail.traceEvents.length,
    transcripts: detail.transcriptMessages.length,
    hypotheses: detail.hypotheses.length,
    findings: detail.findings.length,
    evidence: detail.evidence.length
  };
}

export function runDetailUpdateMetricDetail(update: RunDetailUpdate): DevMetricDetail {
  return {
    run: shortMetricId(update.run.id),
    status: update.run.status,
    versionDatabaseMs: update.version.databaseMs,
    traceEvents: update.traceEvents.length,
    transcripts: update.transcriptMessages.length,
    hypotheses: update.hypotheses.length,
    findings: update.findings.length,
    evidence: update.evidence.length
  };
}

export function runDetailUpdateCursor(detail: RunDetail): { afterTraceSequence: number; afterTranscriptCount: number } {
  return {
    afterTraceSequence: detail.traceEvents.at(-1)?.sequence ?? -1,
    afterTranscriptCount: detail.transcriptMessages.length
  };
}

export function mergeRunDetailUpdate(current: RunDetail, update: RunDetailUpdate): RunDetail {
  return {
    run: update.run,
    attempts: update.attempts,
    traceEvents: mergeTraceEvents(current.traceEvents, update.traceEvents),
    transcriptMessages: mergeTranscriptMessages(current.transcriptMessages, update.transcriptMessages),
    hypotheses: update.hypotheses,
    artifacts: update.artifacts,
    evidence: update.evidence,
    findings: update.findings,
    verifierContracts: update.verifierContracts,
    verifierRuns: update.verifierRuns,
    vmContexts: update.vmContexts,
    modelSessions: update.modelSessions,
    contextCompactions: update.contextCompactions,
    policyEvents: update.policyEvents,
    exports: update.exports
  };
}

export function shortMetricId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function mergeTraceEvents(current: TraceEventRecord[], incoming: TraceEventRecord[]): TraceEventRecord[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort((left, right) => left.sequence - right.sequence);
}

function mergeTranscriptMessages(current: TranscriptMessageRecord[], incoming: TranscriptMessageRecord[]): TranscriptMessageRecord[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}
