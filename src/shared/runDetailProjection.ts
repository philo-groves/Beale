import type {
  RunDetail,
  RunDetailProjection,
  RunDetailUpdate,
  TraceEventRecord,
  TranscriptMessageRecord
} from './types';

const COMMENTARY_EVENT_PAYLOAD_KEYS = [
  'turn',
  'agentId',
  'agentPath',
  'parentAgentId',
  'transcriptRole',
  'transcriptSource',
  'messagePhase',
  'finalResultKind',
  'provider',
  'model',
  'responseId',
  'itemId',
  'linkedTraceEventId',
  'transcriptMessageId',
  'type',
  'action',
  'interruptedByRecovery',
  'fixtureOnly',
  'honeycrispKind',
  'toolName',
  'honeycrispSessionEventId',
  'contextUsageEligible',
  'serializedSizeBytes'
] as const;

const COMMENTARY_USAGE_PAYLOAD_KEYS = [
  'input_tokens',
  'inputTokens',
  'input',
  'prompt_tokens',
  'promptTokens',
  'output_tokens',
  'outputTokens',
  'output',
  'completion_tokens',
  'completionTokens',
  'total_tokens',
  'totalTokens',
  'cache_read_tokens',
  'cached_tokens',
  'cacheReadTokens',
  'cacheRead',
  'cache_write_tokens',
  'cacheWriteTokens',
  'cacheWrite',
  'cache_hit_rate',
  'cacheHitRate',
  'source',
  'estimated'
] as const;

const COMMENTARY_CONTENT_PAYLOAD_KEYS = [
  'message',
  'text',
  'outputText',
  'reasoningSummaryTexts'
] as const;

const COMMENTARY_TRANSCRIPT_METADATA_KEYS = [
  'agentId',
  'agentPath',
  'parentAgentId',
  'messagePhase',
  'finalResultKind',
  'provider',
  'model',
  'responseId',
  'itemId',
  'turn',
  'interruptedByRecovery'
] as const;

export function projectRunDetailForRenderer<TDetail extends RunDetail | RunDetailUpdate>(
  detail: TDetail,
  projection: RunDetailProjection
): TDetail {
  if (projection === 'full') return detail;
  return {
    ...detail,
    traceEvents: detail.traceEvents.map(projectCommentaryTraceEvent),
    transcriptMessages: detail.transcriptMessages.map(projectCommentaryTranscriptMessage)
  } as TDetail;
}

export function projectCommentaryTraceEvent(event: TraceEventRecord): TraceEventRecord {
  const payload = pickRecordValues(event.payload, COMMENTARY_EVENT_PAYLOAD_KEYS);
  const metadata = recordValue(event.payload.metadata);
  if (metadata) payload.metadata = pickRecordValues(metadata, COMMENTARY_TRANSCRIPT_METADATA_KEYS);
  const usage = recordValue(event.payload.usage);
  if (usage) payload.usage = boundedRecordValues(usage, COMMENTARY_USAGE_PAYLOAD_KEYS);

  if (isHoneycrispToolTraceEvent(event)) {
    const toolPayload = recordValue(event.payload.payload);
    payload.payload = toolPayload ? projectToolPayloadScaffold(event, toolPayload) : {};
    payload.commentaryDetailDeferred = true;
  } else if (isCommentaryContentEvent(event)) {
    Object.assign(payload, pickRecordValues(event.payload, COMMENTARY_CONTENT_PAYLOAD_KEYS));
  }

  if (!isHoneycrispToolTraceEvent(event)) {
    const nestedPayload = recordValue(event.payload.payload);
    const contextScaffold = nestedPayload
      ? pickRecordValues(nestedPayload, ['agentPath', 'contextUsageEligible'] as const)
      : {};
    if (Object.keys(contextScaffold).length > 0) payload.payload = contextScaffold;
  }

  return { ...event, payload };
}

function projectToolPayloadScaffold(
  event: TraceEventRecord,
  toolPayload: Record<string, unknown>
): Record<string, unknown> {
  const scaffold = pickRecordValues(toolPayload, ['toolActionId', 'toolName', 'status'] as const);
  const toolName = stringValue(event.payload.toolName) ?? stringValue(toolPayload.toolName);
  const inputs = recordValue(toolPayload.normalizedInputs);
  if (toolName && inputs) {
    const inputKeys = toolLabelInputKeys(toolName);
    if (inputKeys.length > 0) scaffold.normalizedInputs = boundedRecordValues(inputs, inputKeys);
  }
  const result = recordValue(toolPayload.result);
  if (toolName && result) {
    const resultKeys = toolLabelResultKeys(toolName);
    if (resultKeys.length > 0) scaffold.result = boundedRecordValues(result, resultKeys);
    if (toolName === 'list_agents' && Array.isArray(result.agents)) {
      const projectedResult = recordValue(scaffold.result) ?? {};
      projectedResult.agents = Array.from({ length: Math.min(1_000, result.agents.length) }, () => null);
      scaffold.result = projectedResult;
    }
  }
  return scaffold;
}

function toolLabelInputKeys(toolName: string): readonly string[] {
  switch (toolName) {
    case 'memory.search': return ['query'];
    case 'memory.save': return ['type', 'status'];
    case 'memory.link': return ['fromId', 'relation', 'toId'];
    case 'memory.correct': return ['id', 'status'];
    case 'memory.get': return ['id'];
    case 'runbook.list':
    case 'report.list': return ['query'];
    case 'runbook.get': return ['id'];
    case 'runbook.create': return ['title', 'status'];
    case 'runbook.append': return ['id', 'status', 'expectedRevision'];
    case 'file.read': return ['path'];
    case 'shell.run': return ['command', 'utility', 'args'];
    case 'list_agents': return ['path_prefix'];
    case 'wait_agent': return ['timeout_ms'];
    default: return [];
  }
}

function toolLabelResultKeys(toolName: string): readonly string[] {
  switch (toolName) {
    case 'memory.save': return ['type', 'status'];
    case 'runbook.create':
    case 'runbook.append': return ['title', 'status', 'revision'];
    case 'shell.run': return ['command', 'utility', 'args'];
    case 'list_agents': return [];
    default: return [];
  }
}

function boundedRecordValues(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const bounded: Record<string, unknown> = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = boundedScaffoldValue(record[key]);
    if (value !== undefined) bounded[key] = value;
  }
  return bounded;
}

function boundedScaffoldValue(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 256 ? `${value.slice(0, 255)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 16).flatMap((candidate) => {
      const bounded = boundedScaffoldValue(candidate);
      return bounded === undefined ? [] : [bounded];
    });
  }
  return undefined;
}

export function projectCommentaryTranscriptMessage(message: TranscriptMessageRecord): TranscriptMessageRecord {
  return {
    ...message,
    contentMarkdown: message.role === 'system' ? '' : message.contentMarkdown,
    metadata: pickRecordValues(message.metadata, COMMENTARY_TRANSCRIPT_METADATA_KEYS)
  };
}

function isCommentaryContentEvent(event: TraceEventRecord): boolean {
  const role = event.payload.transcriptRole;
  return role === 'user' ||
    role === 'assistant' ||
    event.payload.type === 'subagent.activity' ||
    (event.source === 'model' && event.type === 'model_message' && event.payload.fixtureOnly === true);
}

export function isHoneycrispToolTraceEvent(event: TraceEventRecord): boolean {
  const kind = event.payload.honeycrispKind;
  return kind === 'tool.requested' ||
    kind === 'tool.observed' ||
    event.summary.startsWith('Honeycrisp tool.requested') ||
    event.summary.startsWith('Honeycrisp tool.observed');
}

function pickRecordValues<const TKey extends readonly string[]>(
  record: Record<string, unknown>,
  keys: TKey
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) projected[key] = record[key];
  }
  return projected;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
