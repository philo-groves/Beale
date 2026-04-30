import type { RunDetail, RunStatus, TraceEventRecord, TranscriptMessageRecord } from '@shared/types';
import { stringRecordValue, traceCategoryForEvent, traceEventOutcome } from '../traceClassification';
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

export function buildTraceDisplayEvents(detail: RunDetail): TraceDisplayEvent[] {
  const transcriptTraceIds = new Set(detail.transcriptMessages.map((message) => message.traceEventId).filter((id): id is string => Boolean(id)));
  const traceById = new Map(detail.traceEvents.map((event) => [event.id, event]));
  const baseEvents = detail.traceEvents.filter((event) => !transcriptTraceIds.has(event.id));
  const transcriptEvents = uniqueTranscriptMessages(detail.transcriptMessages).map((message, index) =>
    transcriptMessageToTraceEvent(message, index, traceById.get(message.traceEventId ?? ''))
  );

  return [...baseEvents, ...transcriptEvents].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    if (left.sequence !== right.sequence) return left.sequence - right.sequence;
    return left.id.localeCompare(right.id);
  });
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

function uniqueTranscriptMessages(messages: TranscriptMessageRecord[]): TranscriptMessageRecord[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = transcriptMessageDisplayKey(message);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function transcriptMessageDisplayKey(message: TranscriptMessageRecord): string | null {
  const text = message.contentMarkdown.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const responseId = stringRecordValue(message.metadata, 'responseId') ?? '';
  const itemId = stringRecordValue(message.metadata, 'itemId') ?? '';
  if (!responseId && !itemId) return null;
  return [message.source, responseId, itemId, text].join('\u0000');
}

function transcriptMessageToTraceEvent(message: TranscriptMessageRecord, index: number, linkedTraceEvent?: TraceEventRecord): TraceDisplayEvent {
  const source: TraceEventRecord['source'] = message.role === 'assistant' ? 'model' : message.role === 'user' ? 'user' : 'system';
  const type: TraceEventRecord['type'] = message.role === 'user' ? 'user_note' : 'model_message';
  const summary =
    message.source === 'openai_reasoning_summary'
      ? 'Thought.'
      : message.role === 'assistant'
        ? 'Report agent output.'
        : message.role === 'user'
          ? 'Ask agent.'
          : 'Record system message.';
  const linkedTurn = linkedTraceEvent?.payload.turn;
  const payload: Record<string, unknown> = {
    text: message.contentMarkdown,
    transcriptMessageId: message.id,
    transcriptRole: message.role,
    transcriptSource: message.source,
    ...(message.traceEventId ? { linkedTraceEventId: message.traceEventId } : {}),
    ...(linkedTurn === undefined ? {} : { turn: linkedTurn }),
    metadata: message.metadata
  };

  return {
    id: `transcript:${message.id}`,
    runId: message.runId,
    attemptId: message.attemptId,
    sequence: linkedTraceEvent ? linkedTraceEvent.sequence + 0.01 + index / 100_000 : -100_000 + index,
    type,
    source,
    summary,
    payload,
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: message.createdAt,
    vmContextId: linkedTraceEvent?.vmContextId ?? null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    transcriptMessageId: message.id,
    displayOnly: true
  };
}
