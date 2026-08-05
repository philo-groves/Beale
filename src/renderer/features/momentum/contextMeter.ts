import type { RunDetail } from '@shared/types';
import { tracePayloadRecord } from '../../traceClassification';
import type { ContextMeter } from './types';

const DEFAULT_CONTEXT_TOKEN_LIMIT = 200_000;

export function contextMeterForDetail(detail: RunDetail | null): ContextMeter {
  const tokenLimit = contextTokenLimitForDetail(detail);
  const candidate = latestContextTokenCandidate(detail);
  const inputTokens = candidate?.tokens ?? null;
  const fraction = inputTokens === null ? 0 : Math.max(0, Math.min(1, inputTokens / tokenLimit));
  const sessionTokenUsage = sessionTokenUsageForDetail(detail);
  const cacheUsage = cacheUsageForDetail(detail);
  return {
    fraction,
    inputTokens,
    tokenLimit,
    totalSessionTokens: sessionTokenUsage.totalTokens,
    totalSessionTokensLabel: formatCompactSessionTokenNumber(sessionTokenUsage.totalTokens),
    sessionInputTokens: sessionTokenUsage.inputTokens,
    sessionOutputTokens: sessionTokenUsage.outputTokens,
    cacheReadTokens: cacheUsage.cacheReadTokens,
    cachePromptTokens: cacheUsage.promptTokens,
    cacheHitRate: cacheUsage.cacheHitRate,
    label: inputTokens === null ? `0/${formatCompactContextNumber(tokenLimit)}` : `${formatCompactContextNumber(inputTokens)}/${formatCompactContextNumber(tokenLimit)}`,
    source: candidate?.source ?? 'no context measured'
  };
}

export function visibleContextMeterLabel(contextMeter: ContextMeter): string {
  const inputTokens = contextMeter.inputTokens ?? 0;
  return `${formatCompactContextKilobytes(inputTokens)}/${formatCompactContextKilobytes(contextMeter.tokenLimit)}`;
}

export function visibleContextWindowPercentageLabel(contextMeter: ContextMeter): string {
  return `${Math.round(contextMeter.fraction * 100)}%`;
}

export function visibleCurrentContextTokenLabel(contextMeter: ContextMeter): string {
  return `${formatCompactSessionTokenNumber(contextMeter.inputTokens ?? 0)} Used`;
}
export function visibleSessionTokenUsageLabel(contextMeter: ContextMeter): string {
  return contextMeter.totalSessionTokensLabel;
}

export function visibleSessionTokenBreakdownLabel(contextMeter: ContextMeter): string {
  if (contextMeter.sessionInputTokens === null || contextMeter.sessionOutputTokens === null) return '';
  return `${formatCompactSessionTokenNumber(contextMeter.sessionInputTokens)} In, ${formatCompactSessionTokenNumber(contextMeter.sessionOutputTokens)} Out`;
}

export function visibleSessionCachedTokenLabel(contextMeter: ContextMeter): string {
  return `${formatCompactSessionTokenNumber(contextMeter.cacheReadTokens)} Cached`;
}
export function visibleCacheHitRateLabel(contextMeter: ContextMeter): string {
  return contextMeter.cacheHitRate === null ? '—' : `${Math.round(contextMeter.cacheHitRate * 100)}%`;
}

function contextTokenLimitForDetail(detail: RunDetail | null): number {
  if (!detail) return DEFAULT_CONTEXT_TOKEN_LIMIT;
  for (const compaction of [...detail.contextCompactions].reverse()) {
    const limit = numberRecordValue(compaction.tokenPressure, 'inputTokenLimit');
    if (limit && limit > 0) return limit;
  }
  return DEFAULT_CONTEXT_TOKEN_LIMIT;
}

function latestContextTokenCandidate(detail: RunDetail | null): { tokens: number; timestamp: number; source: string } | null {
  if (!detail) return null;
  const candidates: Array<{ tokens: number; timestamp: number; source: string }> = [];
  const pushCandidate = (tokens: number | null, timestampValue: string, source: string): void => {
    if (tokens === null || !Number.isFinite(tokens) || tokens <= 0) return;
    const timestamp = Date.parse(timestampValue);
    candidates.push({ tokens, timestamp: Number.isFinite(timestamp) ? timestamp : 0, source });
  };

  for (const event of detail.traceEvents) {
    if (!traceEventContextUsageEligible(event.payload)) continue;
    const usage = tracePayloadRecord(event.payload, 'usage');
    pushCandidate(inputTokensFromUsage(usage), event.createdAt, usageContextSource(usage));
    pushCandidate(numberRecordValue(event.payload, 'serializedSizeBytes') ? Math.ceil((numberRecordValue(event.payload, 'serializedSizeBytes') ?? 0) / 4) : null, event.createdAt, 'serialized replay estimate');
  }

  for (const session of detail.modelSessions) {
    pushCandidate(
      numberRecordValue(session.metadata, 'latestReportedInputTokens'),
      session.updatedAt,
      stringRecordValue(session.metadata, 'latestContextUsageSource') ?? 'reported input tokens'
    );
    pushCandidate(estimatedTokensFromSerializedValue(session.metadata.manualConversationInput), session.updatedAt, 'manual replay estimate');
    pushCandidate(estimatedTokensFromSerializedValue(session.metadata.pendingInput), session.updatedAt, 'pending input estimate');
  }

  for (const compaction of detail.contextCompactions) {
    pushCandidate(numberRecordValue(compaction.tokenPressure, 'latestReportedInputTokens'), compaction.createdAt, 'compaction pressure');
    pushCandidate(compaction.serializedSizeBytes > 0 ? Math.ceil(compaction.serializedSizeBytes / 4) : null, compaction.createdAt, 'serialized replay estimate');
  }

  return candidates.sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
}

function traceEventContextUsageEligible(payload: Record<string, unknown>): boolean {
  if (payload.contextUsageEligible === false) return false;
  return tracePayloadRecord(payload, 'payload')?.contextUsageEligible !== false;
}

function sessionTokenUsageForDetail(detail: RunDetail | null): { totalTokens: number; inputTokens: number | null; outputTokens: number | null } {
  if (!detail) return { totalTokens: 0, inputTokens: null, outputTokens: null };

  const turnUsage = detail.traceEvents
    .filter((event) => event.type !== 'artifact_created')
    .map((event) => tracePayloadRecord(event.payload, 'usage'));
  const aggregateUsage = detail.traceEvents
    .filter((event) => event.type === 'artifact_created')
    .map((event) => tracePayloadRecord(event.payload, 'usage'));
  const turnTotal = turnUsage.reduce((total, usage) => total + (usageTotalTokens(usage) ?? 0), 0);
  const usageRecords = turnTotal > 0 ? turnUsage : aggregateUsage;
  const classifiedRecords = usageRecords
    .map((usage) => ({ total: usageTotalTokens(usage), breakdown: usageTokenBreakdown(usage) }))
    .filter((entry) => entry.total !== null && entry.total > 0);
  const totalTokens = classifiedRecords.reduce((total, entry) => total + (entry.total ?? 0), 0);
  const hasCompleteBreakdown = totalTokens > 0 && classifiedRecords.every((entry) =>
    entry.breakdown !== null && entry.breakdown.inputTokens + entry.breakdown.outputTokens === entry.total
  );

  return {
    totalTokens,
    inputTokens: hasCompleteBreakdown
      ? classifiedRecords.reduce((total, entry) => total + (entry.breakdown?.inputTokens ?? 0), 0)
      : null,
    outputTokens: hasCompleteBreakdown
      ? classifiedRecords.reduce((total, entry) => total + (entry.breakdown?.outputTokens ?? 0), 0)
      : null
  };
}

function usageTokenBreakdown(usage: Record<string, unknown> | null): { inputTokens: number; outputTokens: number } | null {
  if (booleanRecordValue(usage, 'estimated')) return null;
  const inputTokens = inputTokensFromUsage(usage);
  const outputTokens = outputTokensFromUsage(usage);
  return inputTokens === null || outputTokens === null ? null : { inputTokens, outputTokens };
}

function cacheUsageForDetail(detail: RunDetail | null): { cacheReadTokens: number; promptTokens: number; cacheHitRate: number | null } {
  if (!detail) return { cacheReadTokens: 0, promptTokens: 0, cacheHitRate: null };
  const turnUsage = detail.traceEvents
    .filter((event) => event.type !== 'artifact_created')
    .map((event) => tracePayloadRecord(event.payload, 'usage'))
    .filter(hasCacheTelemetry);
  const aggregateUsage = detail.traceEvents
    .filter((event) => event.type === 'artifact_created')
    .map((event) => tracePayloadRecord(event.payload, 'usage'))
    .filter(hasCacheTelemetry);
  const usingTurnUsage = turnUsage.length > 0;
  const usageRecords = usingTurnUsage ? turnUsage : aggregateUsage;
  if (usageRecords.length === 0) return { cacheReadTokens: 0, promptTokens: 0, cacheHitRate: null };

  let cacheReadTokens = 0;
  let promptTokens = 0;
  let latestReportedRate: number | null = null;
  for (const usage of usageRecords) {
    const cacheRead = cacheReadTokensFromUsage(usage) ?? 0;
    const cacheWrite = cacheWriteTokensFromUsage(usage) ?? 0;
    const reportedPrompt = usingTurnUsage
      ? numberRecordValue(usage, 'prompt_tokens') ?? numberRecordValue(usage, 'promptTokens')
      : numberRecordValue(usage, 'cache_prompt_tokens') ??
        numberRecordValue(usage, 'cachePromptTokens') ??
        numberRecordValue(usage, 'prompt_tokens') ??
        numberRecordValue(usage, 'promptTokens');
    const uncachedInput = uncachedInputTokensFromUsage(usage);
    const prompt = reportedPrompt ?? (
      uncachedInput !== null ? uncachedInput + cacheRead + cacheWrite : null
    );
    cacheReadTokens += cacheRead;
    if (prompt !== null) promptTokens += prompt;
    latestReportedRate = numberRecordValue(usage, 'cache_hit_rate') ?? numberRecordValue(usage, 'cacheHitRate') ?? latestReportedRate;
  }

  return {
    cacheReadTokens,
    promptTokens,
    cacheHitRate: usingTurnUsage && promptTokens > 0
      ? cacheReadTokens / promptTokens
      : latestReportedRate ?? (promptTokens > 0 ? cacheReadTokens / promptTokens : null)
  };
}

function hasCacheTelemetry(usage: Record<string, unknown> | null): usage is Record<string, unknown> {
  return Boolean(usage && [
    'cache_read_tokens',
    'cached_tokens',
    'cacheReadTokens',
    'cacheRead',
    'cache_write_tokens',
    'cacheWriteTokens',
    'cacheWrite',
    'cache_hit_rate',
    'cacheHitRate'
  ].some((key) => key in usage));
}

function cacheReadTokensFromUsage(usage: Record<string, unknown> | null): number | null {
  return (
    numberRecordValue(usage, 'cache_read_tokens') ??
    numberRecordValue(usage, 'cached_tokens') ??
    numberRecordValue(usage, 'cacheReadTokens') ??
    numberRecordValue(usage, 'cacheRead')
  );
}

function cacheWriteTokensFromUsage(usage: Record<string, unknown> | null): number | null {
  return (
    numberRecordValue(usage, 'cache_write_tokens') ??
    numberRecordValue(usage, 'cacheWriteTokens') ??
    numberRecordValue(usage, 'cacheWrite')
  );
}

function usageTotalTokens(usage: Record<string, unknown> | null): number | null {
  const totalTokens = numberRecordValue(usage, 'total_tokens') ?? numberRecordValue(usage, 'totalTokens');
  if (totalTokens !== null) return totalTokens;
  if (booleanRecordValue(usage, 'estimated')) return null;

  const inputTokens = inputTokensFromUsage(usage);
  const outputTokens = outputTokensFromUsage(usage);
  if (inputTokens !== null || outputTokens !== null) return (inputTokens ?? 0) + (outputTokens ?? 0);
  return null;
}

function outputTokensFromUsage(usage: Record<string, unknown> | null): number | null {
  return (
    numberRecordValue(usage, 'output_tokens') ??
    numberRecordValue(usage, 'completion_tokens') ??
    numberRecordValue(usage, 'outputTokens') ??
    numberRecordValue(usage, 'completionTokens') ??
    numberRecordValue(usage, 'output')
  );
}

function inputTokensFromUsage(usage: Record<string, unknown> | null): number | null {
  const reportedPromptTokens = numberRecordValue(usage, 'prompt_tokens') ?? numberRecordValue(usage, 'promptTokens');
  if (reportedPromptTokens !== null) return reportedPromptTokens;
  const uncachedInput = uncachedInputTokensFromUsage(usage);
  const cacheRead = cacheReadTokensFromUsage(usage);
  const cacheWrite = cacheWriteTokensFromUsage(usage);
  if (uncachedInput === null && cacheRead === null && cacheWrite === null) return null;
  return (uncachedInput ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
}

function uncachedInputTokensFromUsage(usage: Record<string, unknown> | null): number | null {
  return (
    numberRecordValue(usage, 'input_tokens') ??
    numberRecordValue(usage, 'inputTokens') ??
    numberRecordValue(usage, 'input')
  );
}

function usageContextSource(usage: Record<string, unknown> | null): string {
  return stringRecordValue(usage, 'source') ?? (booleanRecordValue(usage, 'estimated') ? 'estimated input tokens' : 'reported input tokens');
}

function numberRecordValue(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function stringRecordValue(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanRecordValue(record: Record<string, unknown> | null, key: string): boolean {
  if (!record) return false;
  return record[key] === true;
}

function estimatedTokensFromSerializedValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized ? Math.ceil(serialized.length / 4) : null;
  } catch {
    return null;
  }
}

function formatCompactContextNumber(value: number): string {
  if (value >= 1_000_000) return `${trimCompactDecimal(value / 1_000_000)}m`;
  if (value >= 1_000) return `${trimCompactDecimal(value / 1_000)}k`;
  return `${Math.max(0, Math.round(value))}`;
}

function formatCompactContextKilobytes(value: number): string {
  return `${trimCompactDecimal(Math.max(0, value) / 1_000)}k`;
}

function formatCompactSessionTokenNumber(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 1_000_000_000) return `${trimSessionDecimal(rounded / 1_000_000_000)}b`;
  if (rounded >= 1_000_000) return `${trimSessionDecimal(rounded / 1_000_000)}m`;
  if (rounded >= 1_000) return `${Math.round(rounded / 1_000)}k`;
  return `${rounded}`;
}

function trimSessionDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

function trimCompactDecimal(value: number): string {
  return value >= 10 ? `${Math.round(value)}` : value.toFixed(1).replace(/\.0$/, '');
}
