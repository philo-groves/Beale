import type { RunDetail } from '@shared/types';
import {
  chatMessageCorrelationKey,
  nativeCommentaryCorrelationKeys
} from './chatView';
import {
  honeycrispToolEventKind,
  honeycrispToolName,
  honeycrispToolPayload,
  honeycrispToolPairingKey,
  tracePayloadArray
} from '../traceClassification';
import { honeycrispToolTraceSubtext } from './traceContent';
import type { TraceDisplayEvent } from './traceDisplay';

export type CommentaryMessageKind = 'user' | 'task' | 'commentary' | 'progress' | 'tool' | 'final_answer' | 'error';

export interface CommentaryMessage {
  id: string;
  traceEventId: string | null;
  kind: CommentaryMessageKind;
  taskAction?: 'spawn' | 'followup';
  toolName?: string;
  toolCount?: number;
  toolCalls?: CommentaryToolCall[];
  reasoningTraceLines?: string[];
  contentMarkdown: string;
  createdAt: string;
}

export interface CommentaryToolCall {
  id: string;
  traceEventId: string;
  label: string;
  input: unknown;
  output: unknown;
}

export interface CommentaryProjectionOptions {
  includeInitialPrompt?: boolean;
}

export function commentaryMessagesForSession(
  detail: RunDetail | null,
  events: readonly TraceDisplayEvent[],
  options: CommentaryProjectionOptions = {}
): CommentaryMessage[] {
  if (!detail) return [];
  const includeInitialPrompt = options.includeInitialPrompt ?? true;
  const nativeCommentaryKeys = nativeCommentaryCorrelationKeys(events);
  const projectedEvents = coalesceLegacyReasoningSnapshots(events);
  const toolCallsByPrimaryEventId = projectedHoneycrispToolCalls(projectedEvents, detail);
  let messages = projectedEvents.flatMap((event) => {
    const activity = subagentActivityMessage(event);
    if (activity) return [activity];
    const toolUsage = toolUsageMessage(event, toolCallsByPrimaryEventId);
    if (toolUsage) return [toolUsage];
    const kind = commentaryMessageKind(event, nativeCommentaryKeys);
    const contentMarkdown = eventText(event);
    if (!kind || !contentMarkdown) return [];
    return [{
      id: event.id,
      traceEventId: linkedTraceEventId(event),
      kind,
      ...(kind === 'progress' ? { reasoningTraceLines: reasoningTraceLinesForEvent(event, contentMarkdown) } : {}),
      contentMarkdown,
      createdAt: event.createdAt
    } satisfies CommentaryMessage];
  });
  if (!messages.some((message) =>
    message.kind === 'commentary' ||
    message.kind === 'progress' ||
    message.kind === 'tool' ||
    message.kind === 'final_answer' ||
    message.kind === 'error'
  )) {
    messages = [...messages, ...fixtureProgressMessages(events)];
  }
  messages = coalesceConsecutiveProgressMessages(messages);
  messages = coalesceConsecutiveToolMessages(messages);

  if (!includeInitialPrompt || !detail.run.promptMarkdown.trim() || hasRecordedInitialPrompt(events)) {
    return messages;
  }

  return [{
    id: `run-prompt:${detail.run.id}`,
    traceEventId: null,
    kind: 'user',
    contentMarkdown: detail.run.promptMarkdown.trim(),
    createdAt: detail.run.createdAt
  }, ...messages];
}

function reasoningTraceLinesForEvent(event: TraceDisplayEvent, fallback: string): string[] {
  const coalescedLines = (tracePayloadArray(event.payload, 'reasoningSummaryTexts') ?? [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  return coalescedLines.length > 0 ? coalescedLines : reasoningTraceLinesFromText(fallback);
}

function reasoningTraceLinesFromText(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [text];
}

function coalesceConsecutiveToolMessages(messages: readonly CommentaryMessage[]): CommentaryMessage[] {
  const coalesced: CommentaryMessage[] = [];
  for (const message of messages) {
    const previous = coalesced.at(-1);
    if (message.kind === 'tool' && previous?.kind === 'tool' && previous.toolName === message.toolName) {
      const toolCount = (previous.toolCount ?? 1) + (message.toolCount ?? 1);
      previous.traceEventId = message.traceEventId;
      previous.toolCount = toolCount;
      if (message.toolCalls?.length) {
        if (previous.toolCalls) previous.toolCalls.push(...message.toolCalls);
        else previous.toolCalls = [...message.toolCalls];
      }
      previous.contentMarkdown = commentaryToolUsageText(message.toolName ?? '', toolCount);
      previous.createdAt = message.createdAt;
      continue;
    }
    coalesced.push(message);
  }
  return coalesced;
}

function coalesceConsecutiveProgressMessages(messages: readonly CommentaryMessage[]): CommentaryMessage[] {
  const coalesced: CommentaryMessage[] = [];
  for (const message of messages) {
    if (message.kind === 'progress' && coalesced.at(-1)?.kind === 'progress') {
      coalesced[coalesced.length - 1] = message;
      continue;
    }
    coalesced.push(message);
  }
  return coalesced;
}

function commentaryMessageKind(
  event: TraceDisplayEvent,
  nativeCommentaryKeys: ReadonlySet<string>
): CommentaryMessageKind | null {
  const role = payloadString(event, 'transcriptRole');
  const source = payloadString(event, 'transcriptSource');
  const phase = payloadString(event, 'messagePhase');

  if (role === 'user') return 'user';
  if (role !== 'assistant') return null;
  if (source === 'honeycrisp_commentary') return 'commentary';
  if (source === 'openai_reasoning_summary') {
    const key = chatMessageCorrelationKey(event);
    return key && nativeCommentaryKeys.has(key) ? null : 'progress';
  }
  if (phase === 'commentary') return 'commentary';
  if (phase === 'final_answer' || source === 'honeycrisp') return 'final_answer';
  return 'final_answer';
}

function subagentActivityMessage(event: TraceDisplayEvent): CommentaryMessage | null {
  const action = payloadString(event, 'action');
  if (payloadString(event, 'type') !== 'subagent.activity' || !action) return null;
  const task = ['spawned', 'message', 'followup'].includes(action);
  const error = action === 'errored' || action === 'interrupted';
  if (!task && !error) return null;
  const contentMarkdown = payloadString(event, 'message') ?? (error ? event.summary.trim() : null);
  if (!contentMarkdown) return null;
  return {
    id: `${task ? 'task' : 'error'}:${event.id}`,
    traceEventId: event.id,
    kind: task ? 'task' : 'error',
    ...(task ? { taskAction: action === 'spawned' ? 'spawn' as const : 'followup' as const } : {}),
    contentMarkdown,
    createdAt: event.createdAt
  };
}

const LIFECYCLE_TOOL_NAMES = new Set(['spawn_agent', 'send_message', 'followup_task', 'interrupt_agent']);
function toolUsageMessage(
  event: TraceDisplayEvent,
  toolCallsByPrimaryEventId: ReadonlyMap<string, CommentaryToolCall>
): CommentaryMessage | null {
  const toolCall = toolCallsByPrimaryEventId.get(event.id);
  if (!toolCall) return null;
  const toolName = honeycrispToolName(event);
  if (!toolName || LIFECYCLE_TOOL_NAMES.has(toolName)) return null;
  return {
    id: `tool:${event.id}`,
    traceEventId: toolCall.traceEventId,
    kind: 'tool',
    toolName,
    toolCount: 1,
    toolCalls: [toolCall],
    contentMarkdown: commentaryToolUsageText(toolName, 1),
    createdAt: event.createdAt
  };
}

interface MutableToolCallProjection {
  primaryEvent: TraceDisplayEvent;
  requestEvent: TraceDisplayEvent | null;
  observationEvent: TraceDisplayEvent | null;
}

function projectedHoneycrispToolCalls(
  events: readonly TraceDisplayEvent[],
  detail: RunDetail
): Map<string, CommentaryToolCall> {
  const projections: MutableToolCallProjection[] = [];
  const requestedByKey = new Map<string, MutableToolCallProjection[]>();
  for (const event of events) {
    const kind = honeycrispToolEventKind(event);
    const pairingKey = honeycrispToolPairingKey(event);
    if (!kind) continue;
    if (kind === 'tool.requested') {
      const projection: MutableToolCallProjection = {
        primaryEvent: event,
        requestEvent: event,
        observationEvent: null
      };
      projections.push(projection);
      if (pairingKey) {
        const pending = requestedByKey.get(pairingKey);
        if (pending) pending.push(projection);
        else requestedByKey.set(pairingKey, [projection]);
      }
      continue;
    }
    const pendingRequests = pairingKey ? requestedByKey.get(pairingKey) : undefined;
    const projection = pendingRequests?.shift();
    if (projection) {
      projection.observationEvent = event;
      continue;
    }
    projections.push({
      primaryEvent: event,
      requestEvent: null,
      observationEvent: event
    });
  }

  return new Map(projections.map((projection) => [
    projection.primaryEvent.id,
    commentaryToolCall(projection, detail)
  ]));
}

function commentaryToolCall(projection: MutableToolCallProjection, detail: RunDetail): CommentaryToolCall {
  const requestPayload = projection.requestEvent ? honeycrispToolPayload(projection.requestEvent) : null;
  const observationPayload = projection.observationEvent ? honeycrispToolPayload(projection.observationEvent) : null;
  const toolName = honeycrispToolName(projection.primaryEvent) ?? 'tool';
  const observationLabel = projection.observationEvent
    ? honeycrispToolTraceSubtext(projection.observationEvent, detail)
    : '';
  const requestLabel = projection.requestEvent
    ? honeycrispToolTraceSubtext(projection.requestEvent, detail)
    : '';
  return {
    id: projection.requestEvent?.id ?? projection.observationEvent?.id ?? projection.primaryEvent.id,
    traceEventId: projection.observationEvent?.id ?? projection.primaryEvent.id,
    label: observationLabel || requestLabel || humanizeToolName(toolName),
    input: recordValue(requestPayload ?? observationPayload, 'normalizedInputs') ?? {},
    output: commentaryToolCallOutput(observationPayload)
  };
}

function commentaryToolCallOutput(observationPayload: Record<string, unknown> | null): unknown {
  if (!observationPayload) return 'Waiting for output.';
  if (hasOwn(observationPayload, 'result')) return observationPayload.result;
  const fallback = Object.fromEntries(
    ['status', 'error', 'summary', 'generatedArtifactRefs', 'rawOutputRef']
      .filter((key) => hasOwn(observationPayload, key))
      .map((key) => [key, observationPayload[key]])
  );
  return Object.keys(fallback).length > 0 ? fallback : 'Completed without output.';
}

function recordValue(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

type ToolUsageCopy = {
  singular: string;
  plural: (count: number) => string;
};

const TOOL_USAGE_COPY: Readonly<Record<string, ToolUsageCopy>> = {
  'analysis.transform': { singular: 'Analyzing Data', plural: (count) => `Running ${count} Analyses` },
  'code.call_candidates': { singular: 'Finding Call Candidates', plural: (count) => `Finding Call Candidates ${count} Times` },
  'code.detect': { singular: 'Detecting the Codebase', plural: (count) => `Detecting the Codebase ${count} Times` },
  'code.node_context': { singular: 'Inspecting Code Context', plural: (count) => `Inspecting Code Context ${count} Times` },
  'code.outline': { singular: 'Outlining a File', plural: (count) => `Outlining ${count} Files` },
  'code.query': { singular: 'Querying Code', plural: (count) => `Running ${count} Code Queries` },
  'code.references': { singular: 'Finding References', plural: (count) => `Running ${count} Reference Searches` },
  'experiment.run': { singular: 'Running an Experiment', plural: (count) => `Running ${count} Experiments` },
  'file.read': { singular: 'Reading a File', plural: (count) => `Reading ${count} Files` },
  'list_agents': { singular: 'Checking Subagents', plural: (count) => `Checking Subagents ${count} Times` },
  'local.inspection': { singular: 'Inspecting the Target', plural: (count) => `Inspecting the Target ${count} Times` },
  'memory.correct': { singular: 'Correcting a Memory', plural: (count) => `Correcting ${count} Memories` },
  'memory.get': { singular: 'Reading a Memory', plural: (count) => `Reading ${count} Memories` },
  'memory.link': { singular: 'Linking Memories', plural: (count) => `Linking Memories ${count} Times` },
  'memory.save': { singular: 'Saving a Memory', plural: (count) => `Saving ${count} Memories` },
  'memory.search': { singular: 'Searching Memory', plural: (count) => `Running ${count} Memory Searches` },
  'repository.search': { singular: 'Searching the Repository', plural: (count) => `Running ${count} Repository Searches` },
  'runbook.append': { singular: 'Updating a Runbook', plural: (count) => `Updating ${count} Runbooks` },
  'runbook.create': { singular: 'Creating a Runbook', plural: (count) => `Creating ${count} Runbooks` },
  'runbook.get': { singular: 'Reading a Runbook', plural: (count) => `Reading ${count} Runbooks` },
  'runbook.list': { singular: 'Checking Runbooks', plural: (count) => `Checking Runbooks ${count} Times` },
  'session.disposition': { singular: 'Recording the Session Outcome', plural: (count) => `Recording ${count} Session Outcomes` },
  'shell.run': { singular: 'Running a Command', plural: (count) => `Running ${count} Commands` },
  'storage.list': { singular: 'Checking Artifacts', plural: (count) => `Checking Artifacts ${count} Times` },
  'synthesis.compose': { singular: 'Composing a Report', plural: (count) => `Composing ${count} Reports` },
  'wait_agent': { singular: 'Waiting for Subagents', plural: (count) => `Waiting for Subagents ${count} Times` }
};

export function commentaryToolUsageText(toolName: string, count: number): string {
  const normalizedCount = Math.max(1, Math.floor(count));
  const copy = TOOL_USAGE_COPY[toolName];
  if (copy) return normalizedCount === 1 ? copy.singular : copy.plural(normalizedCount);
  const displayName = humanizeToolName(toolName);
  return normalizedCount === 1 ? `Using ${displayName}` : `Using ${displayName} ${normalizedCount} Times`;
}

function humanizeToolName(toolName: string): string {
  const segments = toolName.split(/[._-]+/).filter(Boolean);
  const usefulSegments = toolName.startsWith('mcp.') && segments.length > 1 ? segments.slice(-1) : segments;
  const displayName = usefulSegments.map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`).join(' ');
  return displayName || 'Tool';
}

function coalesceLegacyReasoningSnapshots(events: readonly TraceDisplayEvent[]): readonly TraceDisplayEvent[] {
  const lastIndexByKey = new Map<string, number>();
  events.forEach((event, index) => {
    const key = legacyReasoningSnapshotKey(event);
    if (key) lastIndexByKey.set(key, index);
  });
  return events.filter((event, index) => {
    const key = legacyReasoningSnapshotKey(event);
    return !key || lastIndexByKey.get(key) === index;
  });
}

function legacyReasoningSnapshotKey(event: TraceDisplayEvent): string | null {
  if (payloadString(event, 'transcriptSource') !== 'openai_reasoning_summary') return null;
  const responseId = payloadString(event, 'responseId');
  const itemId = payloadString(event, 'itemId');
  if (!responseId || !itemId) return null;
  return `${event.attemptId ?? ''}\u0000${payloadString(event, 'agentPath') ?? '/root'}\u0000${responseId}\u0000${itemId}`;
}

function fixtureProgressMessages(events: readonly TraceDisplayEvent[]): CommentaryMessage[] {
  return events.flatMap((event) => {
    if (event.source !== 'model' || event.type !== 'model_message' || event.payload.fixtureOnly !== true) return [];
    const contentMarkdown = eventText(event) || event.summary.trim();
    if (!contentMarkdown) return [];
    return [{
      id: `fixture-progress:${event.id}`,
      traceEventId: event.id,
      kind: 'progress',
      reasoningTraceLines: reasoningTraceLinesForEvent(event, contentMarkdown),
      contentMarkdown,
      createdAt: event.createdAt
    } satisfies CommentaryMessage];
  });
}

function hasRecordedInitialPrompt(events: readonly TraceDisplayEvent[]): boolean {
  return events.some((event) =>
    payloadString(event, 'transcriptRole') === 'user' &&
    payloadString(event, 'transcriptSource') === 'run_prompt'
  );
}

function eventText(event: TraceDisplayEvent): string {
  return (payloadString(event, 'text') ?? payloadString(event, 'outputText') ?? '').trim();
}

function linkedTraceEventId(event: TraceDisplayEvent): string | null {
  return payloadString(event, 'linkedTraceEventId') ?? (event.displayOnly ? null : event.id);
}

function payloadString(event: TraceDisplayEvent, key: string): string | null {
  const direct = stringValue(event.payload[key]);
  if (direct) return direct;
  const metadata = event.payload.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return stringValue((metadata as Record<string, unknown>)[key]);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
