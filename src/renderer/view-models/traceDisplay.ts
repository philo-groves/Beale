import type { RunStatus, TraceEventRecord } from '@shared/types';
import { traceCategoryForEvent, traceEventOutcome } from '../traceClassification';
import type { TraceCategoryId } from '../traceClassification';

export interface TraceDisplayEvent extends TraceEventRecord {
  transcriptMessageId?: string;
  displayOnly?: boolean;
}

export interface TraceTimelineGroup {
  key: string;
  label: string;
  startedAt: string;
  updatedAt: string;
  visibleCount: number;
  toolCount: number;
  modelCount: number;
  failureCount: number;
}

export interface TraceTimelineEntry<TEvent extends TraceEventRecord = TraceDisplayEvent> {
  event: TEvent;
  group: TraceTimelineGroup;
}

export interface RenderedTraceGroup<TEvent extends TraceEventRecord = TraceDisplayEvent> {
  key: string;
  group: TraceTimelineGroup;
  entries: TraceTimelineEntry<TEvent>[];
}

export interface TraceGroupStatusLabel {
  kind: string;
  label: string;
}

export function traceTurnNumber(event: TraceEventRecord): number | null {
  const turn = event.payload.turn;
  if (typeof turn === 'number' && Number.isInteger(turn) && turn > 0) return turn;
  if (typeof turn === 'string' && /^\d+$/.test(turn)) return Number(turn);
  const match = event.summary.match(/\bturn\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function latestTraceTurnNumber(events: TraceEventRecord[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    latest = traceTurnNumber(event) ?? latest;
  }
  return latest;
}

export function latestTraceGroupKey(events: TraceEventRecord[]): string {
  let key = 'setup';
  for (const event of events) {
    const turnNumber = traceTurnNumber(event);
    if (turnNumber !== null) {
      key = `turn-${turnNumber}-${event.sequence}`;
    }
  }
  return key;
}

export function buildTraceTimelineEntries<TEvent extends TraceEventRecord>(events: TEvent[], visibleCategories: TraceCategoryId[]): TraceTimelineEntry<TEvent>[] {
  const entries: TraceTimelineEntry<TEvent>[] = [];
  let group = createTraceTimelineGroup('setup', 'Setup', events[0]?.createdAt ?? '');

  for (const event of events) {
    const turnNumber = traceTurnNumber(event);
    if (turnNumber !== null) {
      group = createTraceTimelineGroup(`turn-${turnNumber}-${event.sequence}`, `Turn ${turnNumber}`, event.createdAt);
    }

    group.updatedAt = event.createdAt;
    const category = traceCategoryForEvent(event);
    if (!visibleCategories.includes(category)) continue;

    group.visibleCount += 1;
    if (category === 'tools' || category === 'code_navigation' || category === 'vm_execution' || category === 'verifier') {
      group.toolCount += 1;
    }
    if (category === 'agent_output' || category === 'reasoning') {
      group.modelCount += 1;
    }
    if (traceEventOutcome(event) === 'failure') {
      group.failureCount += 1;
    }
    entries.push({ event, group });
  }

  return entries;
}

export function groupRenderedTraceEntries<TEvent extends TraceEventRecord>(entries: TraceTimelineEntry<TEvent>[]): RenderedTraceGroup<TEvent>[] {
  const groups: RenderedTraceGroup<TEvent>[] = [];
  for (const entry of entries) {
    const current = groups.at(-1);
    if (current && current.group === entry.group) {
      current.entries.push(entry);
      continue;
    }
    groups.push({ key: `${entry.group.key}-${entry.event.id}`, group: entry.group, entries: [entry] });
  }
  return groups;
}

export function traceGroupStatusLabel(group: TraceTimelineGroup, latest: boolean, runStatus: RunStatus): TraceGroupStatusLabel {
  if (group.failureCount > 0) return { kind: 'review', label: `${group.failureCount} ${group.failureCount === 1 ? 'Error' : 'Errors'}` };
  if (latest && runStatus === 'active') return { kind: 'active', label: 'Active' };
  if (group.toolCount > 0 || group.modelCount > 0) return { kind: 'complete', label: 'Complete' };
  return { kind: 'events', label: 'Events' };
}

function createTraceTimelineGroup(key: string, label: string, startedAt: string): TraceTimelineGroup {
  return {
    key,
    label,
    startedAt,
    updatedAt: startedAt,
    visibleCount: 0,
    toolCount: 0,
    modelCount: 0,
    failureCount: 0
  };
}
