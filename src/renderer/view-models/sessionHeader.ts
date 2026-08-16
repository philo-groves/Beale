import type { RunDetail } from '@shared/types';
import { formatDurationHms, formatSessionDateTime, formatSessionStart, traceLabel } from '../lib/formatting';

export interface SessionConfigPill {
  label: string;
  tooltip: string;
}

export interface SessionDurationTiming {
  durationMs: number;
  durationLabel: string;
  durationTooltip: string;
}

export function sessionConfigPills(detail: RunDetail): SessionConfigPill[] {
  return [
    { label: traceLabel(detail.run.mode), tooltip: `Mode: ${traceLabel(detail.run.mode)}` },
    { label: traceLabel(detail.run.attemptStrategy), tooltip: `Strategy: ${traceLabel(detail.run.attemptStrategy)}` }
  ];
}

export function sessionDurationTiming(detail: RunDetail, nowMs: number): SessionDurationTiming | null {
  const updated = latestRunDetailDate(detail);
  if (!updated) return null;

  const createdMs = Date.parse(detail.run.createdAt);
  const durationEndMs = detail.run.status === 'active' ? nowMs : updated.getTime();
  const durationMs = Number.isFinite(createdMs) ? Math.max(0, durationEndMs - createdMs) : 0;

  return {
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
    ...detail.artifacts.map((artifact) => artifact.createdAt),
    ...(detail.honeycrispMemory?.nodes.flatMap((node) => [node.createdAt, node.updatedAt]) ?? []),
    ...detail.verifierContracts.flatMap((contract) => [contract.createdAt, contract.updatedAt]),
    ...detail.verifierRuns.flatMap((run) => [run.startedAt, run.endedAt]),
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
