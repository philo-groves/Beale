import type { RunDetail, TraceEventRecord, WorkspaceScopeVersion } from '@shared/types';
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
  requestTraceEventId?: string | null;
  observationTraceEventId?: string | null;
  detailsDeferred?: boolean;
  repositorySearch?: {
    repositories: string[];
    repositoryNames: string[];
    query: string | null;
  };
  input: unknown;
  output: unknown;
}

export interface CommentaryProjectionOptions {
  includeInitialPrompt?: boolean;
  repositoryMetadata?: readonly CommentaryRepositoryMetadata[];
}

export interface CommentaryRepositoryMetadata {
  path: string;
  name: string;
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
  const toolCallsByPrimaryEventId = projectedHoneycrispToolCalls(
    projectedEvents,
    detail,
    options.repositoryMetadata ?? []
  );
  let messages = projectedEvents.flatMap((event) => {
    const activity = subagentActivityMessage(event);
    if (activity) return [activity];
    const toolUsage = toolUsageMessage(event, toolCallsByPrimaryEventId);
    if (toolUsage) return [toolUsage];
    const kind = commentaryMessageKind(event, nativeCommentaryKeys);
    const contentMarkdown = commentaryMessageContentMarkdown(event, kind);
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
  messages = appendRecoveryErrorFallback(messages, detail, projectedEvents);

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

function appendRecoveryErrorFallback(
  messages: readonly CommentaryMessage[],
  detail: RunDetail,
  events: readonly TraceDisplayEvent[]
): CommentaryMessage[] {
  if (detail.run.status !== 'paused') return [...messages];
  if (messages.some((message) => message.kind === 'final_answer' || (message.kind === 'error' && !message.id.startsWith('error:')))) {
    return [...messages];
  }
  const latestAttemptId = detail.attempts.at(-1)?.id ?? null;
  const recoveryEvent = [...events].reverse().find((event) => {
    const recovery = event.payload.interruptedByRecovery === true ||
      event.summary === 'Workspace recovery paused interrupted run after app restart.';
    return recovery && (!latestAttemptId || !event.attemptId || event.attemptId === latestAttemptId);
  });
  if (!recoveryEvent) return [...messages];
  return [...messages, {
    id: `recovery-error:${recoveryEvent.id}`,
    traceEventId: recoveryEvent.id,
    kind: 'error',
    contentMarkdown: HONEYCRISP_UNEXPECTED_ERROR_TEXT,
    createdAt: recoveryEvent.createdAt
  }];
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
      previous.contentMarkdown = commentaryToolMessageUsageText(
        message.toolName ?? '',
        toolCount,
        previous.toolCalls ?? []
      );
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
  if (payloadString(event, 'finalResultKind') === 'error' || legacyHoneycrispFinalErrorText(event)) return 'error';
  if (source === 'honeycrisp_commentary') return 'commentary';
  if (source === 'openai_reasoning_summary') {
    const key = chatMessageCorrelationKey(event);
    if (key && nativeCommentaryKeys.has(key)) return null;
    return payloadString(event, 'provider') === 'xai' ? 'commentary' : 'progress';
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
    contentMarkdown: commentaryToolMessageUsageText(toolName, 1, [toolCall]),
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
  detail: RunDetail,
  repositoryMetadata: readonly CommentaryRepositoryMetadata[]
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
    commentaryToolCall(projection, detail, repositoryMetadata)
  ]));
}

function commentaryToolCall(
  projection: MutableToolCallProjection,
  detail: RunDetail,
  repositoryMetadata: readonly CommentaryRepositoryMetadata[] = []
): CommentaryToolCall {
  const requestPayload = projection.requestEvent ? honeycrispToolPayload(projection.requestEvent) : null;
  const observationPayload = projection.observationEvent ? honeycrispToolPayload(projection.observationEvent) : null;
  const toolName = honeycrispToolName(projection.primaryEvent) ?? 'tool';
  const input = recordValue(requestPayload ?? observationPayload, 'normalizedInputs') ?? {};
  const output = commentaryToolCallOutput(observationPayload);
  const observationLabel = projection.observationEvent
    ? honeycrispToolTraceSubtext(projection.observationEvent, detail)
    : '';
  const requestLabel = projection.requestEvent
    ? honeycrispToolTraceSubtext(projection.requestEvent, detail)
    : '';
  const repositorySearch = toolName === 'repository.search'
    ? commentaryRepositorySearchDetails(input, output, repositoryMetadata)
    : null;
  const label = repositorySearch
    ? commentaryRepositorySearchCallLabel(repositorySearch)
    : toolName === 'memory.search'
      ? commentaryMemorySearchCallLabel(input)
    : observationLabel || requestLabel || humanizeToolName(toolName);
  const detailsDeferred = projection.requestEvent?.payload.commentaryDetailDeferred === true ||
    projection.observationEvent?.payload.commentaryDetailDeferred === true;
  return {
    id: projection.requestEvent?.id ?? projection.observationEvent?.id ?? projection.primaryEvent.id,
    traceEventId: projection.observationEvent?.id ?? projection.primaryEvent.id,
    label,
    ...(repositorySearch ? { repositorySearch } : {}),
    ...(detailsDeferred ? {
      requestTraceEventId: projection.requestEvent?.id ?? null,
      observationTraceEventId: projection.observationEvent?.id ?? null,
      detailsDeferred: true
    } : {}),
    input: detailsDeferred ? undefined : input,
    output: detailsDeferred ? undefined : output
  };
}

export function hydrateCommentaryToolCall(
  toolCall: CommentaryToolCall,
  traceEvents: readonly TraceEventRecord[],
  detail: RunDetail
): CommentaryToolCall {
  const byId = new Map(traceEvents.map((event) => [event.id, event]));
  const requestEvent = toolCall.requestTraceEventId ? byId.get(toolCall.requestTraceEventId) ?? null : null;
  const observationEvent = toolCall.observationTraceEventId ? byId.get(toolCall.observationTraceEventId) ?? null : null;
  const primaryEvent = requestEvent ?? observationEvent;
  if (!primaryEvent) throw new Error('Tool call detail is no longer available.');
  const hydrated = commentaryToolCall({ primaryEvent, requestEvent, observationEvent }, detail);
  const repositorySearch = toolCall.repositorySearch ?? hydrated.repositorySearch;
  return {
    ...hydrated,
    id: toolCall.id,
    traceEventId: toolCall.traceEventId,
    ...(repositorySearch ? {
      repositorySearch,
      label: commentaryRepositorySearchCallLabel(repositorySearch)
    } : {}),
    detailsDeferred: false
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
  'memory.search': { singular: 'Searching Memory', plural: (count) => `Searching Memory with ${count} Queries` },
  'repository.search': { singular: 'Searching the Repository', plural: (count) => `Running ${count} Repository Searches` },
  'runbook.append': { singular: 'Updating a Runbook', plural: (count) => `Updating ${count} Runbooks` },
  'runbook.create': { singular: 'Creating a Runbook', plural: (count) => `Creating ${count} Runbooks` },
  'runbook.get': { singular: 'Reading a Runbook', plural: (count) => `Reading ${count} Runbooks` },
  'runbook.list': { singular: 'Checking Runbooks', plural: (count) => `Checking Runbooks ${count} Times` },
  'report.create': { singular: 'Creating a Report', plural: (count) => `Creating ${count} Reports` },
  'report.get': { singular: 'Reading a Report', plural: (count) => `Reading ${count} Reports` },
  'report.list': { singular: 'Checking Reports', plural: (count) => `Checking Reports ${count} Times` },
  'report.revise': { singular: 'Revising a Report', plural: (count) => `Revising ${count} Reports` },
  'session.disposition': { singular: 'Recording the Session Outcome', plural: (count) => `Recording ${count} Session Outcomes` },
  'shell.run': { singular: 'Running a Command', plural: (count) => `Running ${count} Commands` },
  'storage.list': { singular: 'Checking Artifacts', plural: (count) => `Checking Artifacts ${count} Times` },
  'synthesis.compose': { singular: 'Composing a Report', plural: (count) => `Composing ${count} Reports` },
  'wait_agent': { singular: 'Waiting for Subagents', plural: (count) => `Waiting for Subagents ${count} Times` }
};

export function commentaryToolUsageText(toolName: string, count: number, singularDetail?: string): string {
  const normalizedCount = Math.max(1, Math.floor(count));
  const detail = singularDetail?.trim() ?? '';
  const singularDetailVerb = toolName === 'shell.run' ? 'Running' : toolName === 'file.read' ? 'Reading' : null;
  if (
    singularDetailVerb
    && normalizedCount === 1
    && detail
    && detail.toLowerCase() !== humanizeToolName(toolName).toLowerCase()
  ) {
    return `${singularDetailVerb} ${toolName === 'file.read' ? compactUserPath(detail) : detail}`;
  }
  const copy = TOOL_USAGE_COPY[toolName];
  const description = copy
    ? normalizedCount === 1 ? copy.singular : copy.plural(normalizedCount)
    : normalizedCount === 1
      ? `Using ${humanizeToolName(toolName)}`
      : `Using ${humanizeToolName(toolName)} ${normalizedCount} Times`;
  return sentenceCaseToolDescription(description);
}

function commentaryToolMessageUsageText(
  toolName: string,
  count: number,
  toolCalls: readonly CommentaryToolCall[]
): string {
  if (toolName === 'repository.search') return commentaryRepositorySearchUsageText(count, toolCalls);
  if (toolName === 'memory.search') return commentaryMemorySearchUsageText(count, toolCalls);
  return commentaryToolUsageText(toolName, count, count === 1 ? toolCalls[0]?.label : undefined);
}

function commentaryMemorySearchUsageText(
  count: number,
  toolCalls: readonly CommentaryToolCall[]
): string {
  const normalizedCount = Math.max(1, Math.floor(count));
  if (normalizedCount === 1) {
    return toolCalls[0]?.label ?? commentaryToolUsageText('memory.search', 1);
  }
  return `Searching memory with ${normalizedCount} queries`;
}

function commentaryMemorySearchCallLabel(inputValue: unknown): string {
  const query = firstStringValue(unknownRecord(inputValue), ['query']);
  return query ? `Searching memory for "${query}"` : commentaryToolUsageText('memory.search', 1);
}

function commentaryRepositorySearchUsageText(
  count: number,
  toolCalls: readonly CommentaryToolCall[]
): string {
  const normalizedCount = Math.max(1, Math.floor(count));
  const searches = toolCalls.map((toolCall) => toolCall.repositorySearch
    ?? commentaryRepositorySearchDetails(toolCall.input, toolCall.output));
  const repositoryPaths = searches.flatMap((search) => search.repositories);
  if (normalizedCount === 1) {
    return toolCalls[0]?.label ?? commentaryToolUsageText('repository.search', 1);
  }
  const repositoryCount = new Set(repositoryPaths.map(normalizedRepositoryIdentity)).size;
  const repositoryLabel = repositoryCount > 0
    ? `${repositoryCount} ${repositoryCount === 1 ? 'repository' : 'repositories'}`
    : 'repositories';
  return `Searching ${repositoryLabel} with ${normalizedCount} queries`;
}

function commentaryRepositorySearchCallLabel(
  search: { repositoryNames: readonly string[]; query: string | null }
): string {
  const { query } = search;
  const repositoryNames = [...new Set(search.repositoryNames.filter(Boolean))];
  const repositoryLabel = repositoryNames.length > 0 ? repositoryNames.join(', ') : 'repository';
  if (query) return `Querying ${repositoryLabel} for "${query}"`;
  if (repositoryNames.length > 0) return `Querying ${repositoryLabel}`;
  return commentaryToolUsageText('repository.search', 1);
}

function commentaryRepositorySearchDetails(
  inputValue: unknown,
  outputValue: unknown,
  repositoryMetadata: readonly CommentaryRepositoryMetadata[] = []
): { repositories: string[]; repositoryNames: string[]; query: string | null } {
  const input = unknownRecord(inputValue);
  const output = unknownRecord(outputValue);
  const resolvedRoots = firstStringArrayValue(output, ['roots', 'attemptedRoots']);
  const requestedRoot = firstStringValue(input, ['path', 'repositoryPath', 'repository', 'root']);
  const repositories = resolvedRoots.length > 0 ? resolvedRoots : requestedRoot ? [requestedRoot] : [];
  return {
    repositories,
    repositoryNames: repositories.map((repository) => configuredRepositoryName(repository, repositoryMetadata)
      ?? repositoryShortName(repository)
      ?? 'repository'),
    query: firstStringValue(output, ['query']) ?? firstStringValue(input, ['query'])
  };
}

export function commentaryRepositoryMetadataForScope(
  scope: WorkspaceScopeVersion | null | undefined
): CommentaryRepositoryMetadata[] {
  if (!scope) return [];
  const displayNamesByAssetId = new Map<string, string>();
  const displayNamesByRepositoryUrl = new Map<string, string>();
  for (const asset of scope.assets) {
    const displayName = stringMetadataValue(asset.attributes?.displayName)
      ?? stringMetadataValue(asset.attributes?.name)
      ?? repositoryNameFromUrlMetadata(asset.attributes?.repositoryUrl)
      ?? repositoryNameFromUrlMetadata(asset.value);
    if (!displayName) continue;
    displayNamesByAssetId.set(asset.id, displayName);
    const repositoryUrl = repositoryUrlForAsset(asset.value, asset.attributes?.repositoryUrl);
    if (repositoryUrl) displayNamesByRepositoryUrl.set(repositoryUrl, displayName);
  }
  return scope.assets.flatMap((asset) => {
    if (asset.direction !== 'in_scope' || (asset.kind !== 'repo' && asset.kind !== 'path')) return [];
    if (!looksLikeLocalPath(asset.value)) return [];
    const repositoryUrl = repositoryUrlForAsset(asset.value, asset.attributes?.repositoryUrl);
    const sourceAssetId = stringMetadataValue(asset.attributes?.sourceAssetId);
    const name = stringMetadataValue(asset.attributes?.displayName)
      ?? stringMetadataValue(asset.attributes?.name)
      ?? (sourceAssetId ? displayNamesByAssetId.get(sourceAssetId) : null)
      ?? (repositoryUrl ? displayNamesByRepositoryUrl.get(repositoryUrl) : null)
      ?? repositoryNameFromUrlMetadata(asset.attributes?.repositoryUrl);
    return name ? [{ path: asset.value, name }] : [];
  });
}

function configuredRepositoryName(
  repositoryPath: string,
  repositoryMetadata: readonly CommentaryRepositoryMetadata[]
): string | null {
  const normalizedPath = normalizedRepositoryIdentity(repositoryPath);
  const matching = repositoryMetadata
    .filter(({ path }) => {
      const normalizedRoot = normalizedRepositoryIdentity(path);
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
    })
    .sort((left, right) => right.path.length - left.path.length)[0];
  return matching?.name.trim() || null;
}

function stringMetadataValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function repositoryUrlForAsset(value: string, attributeValue: unknown): string | null {
  const candidate = stringMetadataValue(attributeValue) ?? value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(candidate)) return null;
  return candidate.replace(/\.git$/iu, '').replace(/\/+$/u, '').toLowerCase();
}

function repositoryNameFromUrlMetadata(value: unknown): string | null {
  const candidate = stringMetadataValue(value);
  if (!candidate || !/^[a-z][a-z0-9+.-]*:\/\//iu.test(candidate)) return null;
  const name = candidate.replace(/\.git(?:[?#].*)?$/iu, '').replace(/[?#].*$/u, '').replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .at(-1);
  if (!name || /^[a-z][a-z0-9+.-]*:$/iu.test(name)) return null;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function looksLikeLocalPath(value: string): boolean {
  return /^[a-z]:[\\/]/iu.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}

function unknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstStringValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstStringArrayValue(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const strings = value
      .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
      .map((entry) => entry.trim());
    if (strings.length > 0) return strings;
  }
  return [];
}

function normalizedRepositoryIdentity(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function repositoryShortName(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  const materializedSegment = [...segments].reverse().find((segment) => {
    const parts = segment.split('_').filter(Boolean);
    return parts.length >= 3 && /^(?:github|gitlab)\.com$/iu.test(parts[0] ?? '');
  });
  const materializedName = materializedSegment?.split('_').filter(Boolean).at(-1)?.replace(/\.git$/iu, '') ?? '';
  const lastSegment = materializedName || segments.at(-1)?.replace(/\.git$/iu, '') || '';
  if (!lastSegment || lastSegment === '.') return null;
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

function compactUserPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const homePrefixPatterns = [
    /^[a-z]:\/Users\/(?!Public(?:\/|$)|Default(?: User)?(?:\/|$)|All Users(?:\/|$))[^/]+(?=\/|$)/iu,
    /^\/Users\/[^/]+(?=\/|$)/u,
    /^\/home\/[^/]+(?=\/|$)/u,
    /^\/root(?=\/|$)/u
  ];
  const homePrefix = homePrefixPatterns.find((pattern) => pattern.test(normalized));
  if (!homePrefix) return value;
  const relativePath = normalized.replace(homePrefix, '').replace(/^\/+/, '');
  return relativePath ? `~/${relativePath}` : '~/';
}

function sentenceCaseToolDescription(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
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

function commentaryMessageContentMarkdown(
  event: TraceDisplayEvent,
  kind: CommentaryMessageKind | null
): string {
  const text = eventText(event);
  return kind === 'error' ? honeycrispErrorDisplayText(text) ?? text : text;
}

const HONEYCRISP_UNEXPECTED_ERROR_TEXT = 'Unexpected error';

function legacyHoneycrispFinalErrorText(event: TraceDisplayEvent): string | null {
  if (payloadString(event, 'transcriptSource') !== 'honeycrisp') return null;
  const phase = payloadString(event, 'messagePhase');
  if (phase && phase !== 'final_answer') return null;
  return honeycrispErrorDisplayText(eventText(event));
}

function honeycrispErrorDisplayText(value: string): string | null {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  const stripped = trimmed
    .replace(/^research agent failed:\s*/i, '')
    .replace(/^honeycrisp process failed:\s*/i, '')
    .replace(/^honeycrisp process finished with agent status\s*/i, '')
    .replace(/^agent status\s*/i, '')
    .trim();
  const generic = stripped.toLowerCase().replace(/[.]+$/, '');
  if (['terminated', 'unexpected error', 'error', 'failed', 'failure', 'unknown'].includes(generic)) {
    return HONEYCRISP_UNEXPECTED_ERROR_TEXT;
  }
  return stripped !== trimmed ? stripped : null;
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
