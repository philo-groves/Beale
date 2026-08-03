import type { RunDetail } from '@shared/types';
import {
  chatMessageCorrelationKey,
  nativeCommentaryCorrelationKeys
} from './chatView';
import {
  honeycrispToolEventKind,
  honeycrispToolName,
  honeycrispToolPairingKey
} from '../traceClassification';
import type { TraceDisplayEvent } from './traceDisplay';

export type CommentaryMessageKind = 'user' | 'task' | 'commentary' | 'progress' | 'tool' | 'final_answer' | 'error';

export interface CommentaryMessage {
  id: string;
  traceEventId: string | null;
  kind: CommentaryMessageKind;
  taskAction?: 'spawn' | 'followup';
  toolName?: string;
  toolCount?: number;
  contentMarkdown: string;
  createdAt: string;
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
  const pairedToolObservationIds = pairedHoneycrispToolObservationIds(projectedEvents);
  let messages = projectedEvents.flatMap((event) => {
    const activity = subagentActivityMessage(event);
    if (activity) return [activity];
    const toolUsage = toolUsageMessage(event, pairedToolObservationIds);
    if (toolUsage) return [toolUsage];
    const kind = commentaryMessageKind(event, nativeCommentaryKeys);
    const contentMarkdown = eventText(event);
    if (!kind || !contentMarkdown) return [];
    return [{
      id: event.id,
      traceEventId: linkedTraceEventId(event),
      kind,
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

function coalesceConsecutiveToolMessages(messages: readonly CommentaryMessage[]): CommentaryMessage[] {
  const coalesced: CommentaryMessage[] = [];
  for (const message of messages) {
    const previous = coalesced.at(-1);
    if (message.kind === 'tool' && previous?.kind === 'tool' && previous.toolName === message.toolName) {
      const toolCount = (previous.toolCount ?? 1) + (message.toolCount ?? 1);
      coalesced[coalesced.length - 1] = {
        ...previous,
        traceEventId: message.traceEventId,
        toolCount,
        contentMarkdown: commentaryToolUsageText(message.toolName ?? '', toolCount),
        createdAt: message.createdAt
      };
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
  pairedObservationIds: ReadonlySet<string>
): CommentaryMessage | null {
  const toolEventKind = honeycrispToolEventKind(event);
  if (!toolEventKind || (toolEventKind === 'tool.observed' && pairedObservationIds.has(event.id))) return null;
  const toolName = honeycrispToolName(event);
  if (!toolName || LIFECYCLE_TOOL_NAMES.has(toolName)) return null;
  return {
    id: `tool:${event.id}`,
    traceEventId: event.id,
    kind: 'tool',
    toolName,
    toolCount: 1,
    contentMarkdown: commentaryToolUsageText(toolName, 1),
    createdAt: event.createdAt
  };
}

function pairedHoneycrispToolObservationIds(events: readonly TraceDisplayEvent[]): Set<string> {
  const requestedByKey = new Map<string, number>();
  const pairedObservationIds = new Set<string>();
  for (const event of events) {
    const kind = honeycrispToolEventKind(event);
    const pairingKey = honeycrispToolPairingKey(event);
    if (!kind || !pairingKey) continue;
    if (kind === 'tool.requested') {
      requestedByKey.set(pairingKey, (requestedByKey.get(pairingKey) ?? 0) + 1);
      continue;
    }
    const pendingRequests = requestedByKey.get(pairingKey) ?? 0;
    if (pendingRequests <= 0) continue;
    pairedObservationIds.add(event.id);
    requestedByKey.set(pairingKey, pendingRequests - 1);
  }
  return pairedObservationIds;
}

type ToolUsageCopy = {
  singular: string;
  plural: (count: number) => string;
};

const TOOL_USAGE_COPY: Readonly<Record<string, ToolUsageCopy>> = {
  'analysis.transform': { singular: 'Analyzed Data', plural: (count) => `Ran ${count} Analyses` },
  'code.call_candidates': { singular: 'Found Call Candidates', plural: (count) => `Found Call Candidates ${count} Times` },
  'code.detect': { singular: 'Detected the Codebase', plural: (count) => `Detected the Codebase ${count} Times` },
  'code.node_context': { singular: 'Inspected Code Context', plural: (count) => `Inspected Code Context ${count} Times` },
  'code.outline': { singular: 'Outlined a File', plural: (count) => `Outlined ${count} Files` },
  'code.query': { singular: 'Queried Code', plural: (count) => `Ran ${count} Code Queries` },
  'code.references': { singular: 'Found References', plural: (count) => `Ran ${count} Reference Searches` },
  'experiment.run': { singular: 'Ran an Experiment', plural: (count) => `Ran ${count} Experiments` },
  'file.read': { singular: 'Read a File', plural: (count) => `Read ${count} Files` },
  'list_agents': { singular: 'Check Subagents', plural: (count) => `Checked Subagents ${count} Times` },
  'local.inspection': { singular: 'Inspected the Target', plural: (count) => `Inspected the Target ${count} Times` },
  'memory.correct': { singular: 'Corrected a Memory', plural: (count) => `Corrected ${count} Memories` },
  'memory.get': { singular: 'Read a Memory', plural: (count) => `Read ${count} Memories` },
  'memory.link': { singular: 'Linked Memories', plural: (count) => `Linked Memories ${count} Times` },
  'memory.save': { singular: 'Saved a Memory', plural: (count) => `Saved ${count} Memories` },
  'memory.search': { singular: 'Searched Memory', plural: (count) => `Ran ${count} Memory Searches` },
  'repository.search': { singular: 'Searched the Repository', plural: (count) => `Ran ${count} Repository Searches` },
  'runbook.append': { singular: 'Updated a Runbook', plural: (count) => `Updated ${count} Runbooks` },
  'runbook.create': { singular: 'Created a Runbook', plural: (count) => `Created ${count} Runbooks` },
  'runbook.get': { singular: 'Read a Runbook', plural: (count) => `Read ${count} Runbooks` },
  'runbook.list': { singular: 'Checked Runbooks', plural: (count) => `Checked Runbooks ${count} Times` },
  'session.disposition': { singular: 'Recorded the Session Outcome', plural: (count) => `Recorded ${count} Session Outcomes` },
  'shell.run': { singular: 'Ran a Command', plural: (count) => `Ran ${count} Commands` },
  'storage.list': { singular: 'Checked Artifacts', plural: (count) => `Checked Artifacts ${count} Times` },
  'synthesis.compose': { singular: 'Composed a Report', plural: (count) => `Composed ${count} Reports` },
  'wait_agent': { singular: 'Waited for Subagents', plural: (count) => `Waited for Subagents ${count} Times` }
};

export function commentaryToolUsageText(toolName: string, count: number): string {
  const normalizedCount = Math.max(1, Math.floor(count));
  const copy = TOOL_USAGE_COPY[toolName];
  if (copy) return normalizedCount === 1 ? copy.singular : copy.plural(normalizedCount);
  const displayName = humanizeToolName(toolName);
  return normalizedCount === 1 ? `Used ${displayName}` : `Used ${displayName} ${normalizedCount} Times`;
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
