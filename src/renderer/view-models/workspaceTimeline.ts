import type {
  HoneycrispMemoryNodeSummary,
  ResearchProfileMemoryType,
  RunRow,
  SessionActivityInterval
} from '@shared/types';

export const WORKSPACE_TIMELINE_WINDOW_MS = 12 * 60 * 60 * 1_000;

export interface WorkspaceTimelineSegment {
  id: string;
  startedAt: string;
  endedAt: string | null;
  leftPercent: number;
  widthPercent: number;
}

export interface WorkspaceTimelineMemoryMarker {
  id: string;
  type: string;
  title: string;
  createdAt: string;
  color: string | null;
  leftPercent: number;
}

export interface WorkspaceTimelineRow {
  runId: string;
  title: string;
  status: RunRow['run']['status'];
  totalDurationMs: number;
  windowDurationMs: number;
  latestActivityAtMs: number;
  segments: WorkspaceTimelineSegment[];
  memoryMarkers: WorkspaceTimelineMemoryMarker[];
}

export function buildWorkspaceTimeline(
  runs: readonly RunRow[],
  memories: readonly HoneycrispMemoryNodeSummary[],
  memoryTypes: readonly ResearchProfileMemoryType[],
  nowMs: number
): WorkspaceTimelineRow[] {
  const windowStartMs = nowMs - WORKSPACE_TIMELINE_WINDOW_MS;
  const memoryTypeById = new Map<string, ResearchProfileMemoryType>();
  for (const type of memoryTypes) {
    memoryTypeById.set(type.id, type);
    for (const alias of type.aliases ?? []) memoryTypeById.set(alias, type);
  }

  return runs.flatMap((row) => {
    const intervals = normalizedIntervals(row.activityIntervals, nowMs);
    const segments = intervals.flatMap((interval) => {
      const startMs = Date.parse(interval.startedAt);
      const endMs = interval.endedAt ? Date.parse(interval.endedAt) : nowMs;
      const clippedStart = Math.max(startMs, windowStartMs);
      const clippedEnd = Math.min(endMs, nowMs);
      if (clippedEnd < clippedStart || endMs < windowStartMs || startMs > nowMs) return [];
      return [{
        id: interval.id,
        startedAt: interval.startedAt,
        endedAt: interval.endedAt,
        leftPercent: percentOfWindow(clippedStart, windowStartMs),
        widthPercent: Math.max(0, ((clippedEnd - clippedStart) / WORKSPACE_TIMELINE_WINDOW_MS) * 100)
      }];
    });
    const memoryMarkers = memories.flatMap((memory) => {
      if (!memory.sessionIds.includes(row.run.id)) return [];
      const createdAtMs = Date.parse(memory.createdAt);
      if (!Number.isFinite(createdAtMs) || createdAtMs < windowStartMs || createdAtMs > nowMs) return [];
      const definition = memoryTypeById.get(memory.type);
      return [{
        id: memory.id,
        type: definition?.id ?? memory.type,
        title: memory.title,
        createdAt: memory.createdAt,
        color: definition?.color ?? null,
        leftPercent: percentOfWindow(createdAtMs, windowStartMs)
      }];
    });
    if (segments.length === 0 && memoryMarkers.length === 0) return [];

    const totalDurationMs = intervals.reduce((total, interval) => {
      const startMs = Date.parse(interval.startedAt);
      const endMs = interval.endedAt ? Date.parse(interval.endedAt) : nowMs;
      return total + Math.max(0, endMs - startMs);
    }, 0);
    const windowDurationMs = intervals.reduce((total, interval) => {
      const startMs = Math.max(Date.parse(interval.startedAt), windowStartMs);
      const endMs = Math.min(interval.endedAt ? Date.parse(interval.endedAt) : nowMs, nowMs);
      return total + Math.max(0, endMs - startMs);
    }, 0);
    const latestActivityAtMs = Math.max(
      ...intervals.map((interval) => interval.endedAt ? Date.parse(interval.endedAt) : nowMs),
      ...memoryMarkers.map((marker) => Date.parse(marker.createdAt))
    );
    return [{
      runId: row.run.id,
      title: row.run.title.trim() || 'Untitled session',
      status: row.run.status,
      totalDurationMs,
      windowDurationMs,
      latestActivityAtMs,
      segments,
      memoryMarkers
    }];
  }).sort((left, right) => right.latestActivityAtMs - left.latestActivityAtMs || left.runId.localeCompare(right.runId));
}

export function formatWorkspaceTimelineDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function normalizedIntervals(
  intervals: readonly SessionActivityInterval[],
  nowMs: number
): SessionActivityInterval[] {
  return intervals.filter((interval) => {
    const startMs = Date.parse(interval.startedAt);
    const endMs = interval.endedAt ? Date.parse(interval.endedAt) : nowMs;
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
  });
}

function percentOfWindow(timestampMs: number, windowStartMs: number): number {
  return Math.max(0, Math.min(100, ((timestampMs - windowStartMs) / WORKSPACE_TIMELINE_WINDOW_MS) * 100));
}
