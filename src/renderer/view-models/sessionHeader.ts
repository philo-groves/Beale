import type { RunDetail, RunStatus, TraceEventRecord } from '@shared/types';
import { formatDurationHms, formatSessionDateTime, formatSessionStart, traceLabel } from '../lib/formatting';
import { traceCategoryForEvent } from '../traceClassification';
import type { TraceCategoryId } from '../traceClassification';
import { latestTraceTurnNumber } from './traceDisplay';

export type RunStatusClass = 'active' | 'completed' | 'failed' | 'paused' | 'queued';

export interface SessionConfigPill {
  label: string;
  tooltip: string;
}

export interface SessionHeaderTiming {
  latestTurn: number;
  visibleEventCount: number;
  totalEventCount: number;
  eventMetric: string;
  turnTooltip: string;
  durationMs: number;
  durationLabel: string;
  durationTooltip: string;
}

export function runStatusClass(status: RunStatus): RunStatusClass {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'active') return 'active';
  if (status === 'queued') return 'queued';
  return 'paused';
}

export function sessionConfigPills(detail: RunDetail): SessionConfigPill[] {
  return [
    { label: traceLabel(detail.run.mode), tooltip: `Mode: ${traceLabel(detail.run.mode)}` },
    { label: traceLabel(detail.run.attemptStrategy), tooltip: `Strategy: ${traceLabel(detail.run.attemptStrategy)}` },
    { label: traceLabel(detail.run.networkProfile), tooltip: `Network: ${traceLabel(detail.run.networkProfile)}` }
  ];
}

export function sessionHeaderTiming(
  detail: RunDetail,
  events: TraceEventRecord[],
  visibleTraceCategories: TraceCategoryId[],
  nowMs: number
): SessionHeaderTiming | null {
  const updated = latestRunDetailDate(detail);
  if (!updated) return null;

  const active = detail.run.status === 'active';
  const createdMs = Date.parse(detail.run.createdAt);
  const durationEndMs = active ? nowMs : updated.getTime();
  const durationMs = Number.isFinite(createdMs) ? Math.max(0, durationEndMs - createdMs) : 0;
  const latestTurn = latestTraceTurnNumber(events) ?? 0;
  const visibleEventCount = events.filter((event) => visibleTraceCategories.includes(traceCategoryForEvent(event))).length;
  const totalEventCount = events.length;
  const turnTooltip = latestTurn === 0 ? 'Current model turn. 0 means setup before the first model turn.' : 'Current model turn.';

  return {
    latestTurn,
    visibleEventCount,
    totalEventCount,
    eventMetric: totalEventCount.toLocaleString(),
    turnTooltip,
    durationMs,
    durationLabel: formatDurationHms(durationMs),
    durationTooltip: `Created ${formatSessionDateTime(detail.run.createdAt)}\nUpdated ${formatSessionStart(updated)}`
  };
}

export function latestRunDetailDate(detail: RunDetail): Date | null {
  const timestamps = [
    detail.run.createdAt,
    detail.run.startedAt,
    detail.run.endedAt,
    ...detail.attempts.flatMap((attempt) => [attempt.startedAt, attempt.endedAt]),
    ...detail.traceEvents.map((event) => event.createdAt),
    ...detail.hypotheses.flatMap((hypothesis) => [hypothesis.createdAt, hypothesis.updatedAt]),
    ...detail.artifacts.map((artifact) => artifact.createdAt),
    ...detail.findings.flatMap((finding) => [finding.createdAt, finding.updatedAt]),
    ...detail.verifierContracts.flatMap((contract) => [contract.createdAt, contract.updatedAt]),
    ...detail.verifierRuns.flatMap((run) => [run.startedAt, run.endedAt]),
    ...detail.vmContexts.flatMap((context) => [context.createdAt, context.destroyedAt]),
    ...detail.modelSessions.flatMap((session) => [session.createdAt, session.updatedAt]),
    ...detail.policyEvents.flatMap((event) => [event.createdAt, event.decidedAt]),
    ...detail.exports.flatMap((exportRecord) => [exportRecord.createdAt, exportRecord.reviewedAt])
  ];
  const latestTimestamp = timestamps.reduce<number | null>((latest, value) => {
    if (!value) return latest;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return latest;
    return latest === null ? timestamp : Math.max(latest, timestamp);
  }, null);
  return latestTimestamp === null ? null : new Date(latestTimestamp);
}
