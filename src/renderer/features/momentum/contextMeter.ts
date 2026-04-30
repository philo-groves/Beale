import type { RunDetail } from '@shared/types';
import { tracePayloadRecord } from '../../traceClassification';
import type { ContextMeter } from './types';

const DEFAULT_CONTEXT_TOKEN_LIMIT = 272_000;

export function contextMeterForDetail(detail: RunDetail | null): ContextMeter {
  const tokenLimit = contextTokenLimitForDetail(detail);
  const candidate = latestContextTokenCandidate(detail);
  const inputTokens = candidate?.tokens ?? null;
  const fraction = inputTokens === null ? 0 : Math.max(0, Math.min(1, inputTokens / tokenLimit));
  return {
    fraction,
    inputTokens,
    tokenLimit,
    label: inputTokens === null ? `0/${formatCompactContextNumber(tokenLimit)}` : `${formatCompactContextNumber(inputTokens)}/${formatCompactContextNumber(tokenLimit)}`,
    source: candidate?.source ?? 'no context measured'
  };
}

export function visibleContextMeterLabel(contextMeter: ContextMeter): string {
  const inputTokens = contextMeter.inputTokens ?? 0;
  return `${formatCompactContextKilobytes(inputTokens)}/${formatCompactContextKilobytes(contextMeter.tokenLimit)}`;
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
    const usage = tracePayloadRecord(event.payload, 'usage');
    pushCandidate(numberRecordValue(usage, 'input_tokens') ?? numberRecordValue(usage, 'prompt_tokens'), event.createdAt, 'reported input tokens');
    pushCandidate(numberRecordValue(event.payload, 'serializedSizeBytes') ? Math.ceil((numberRecordValue(event.payload, 'serializedSizeBytes') ?? 0) / 4) : null, event.createdAt, 'serialized replay estimate');
  }

  for (const session of detail.modelSessions) {
    pushCandidate(numberRecordValue(session.metadata, 'latestReportedInputTokens'), session.updatedAt, 'reported input tokens');
    pushCandidate(estimatedTokensFromSerializedValue(session.metadata.manualConversationInput), session.updatedAt, 'manual replay estimate');
    pushCandidate(estimatedTokensFromSerializedValue(session.metadata.pendingInput), session.updatedAt, 'pending input estimate');
  }

  for (const compaction of detail.contextCompactions) {
    pushCandidate(numberRecordValue(compaction.tokenPressure, 'latestReportedInputTokens'), compaction.createdAt, 'compaction pressure');
    pushCandidate(compaction.serializedSizeBytes > 0 ? Math.ceil(compaction.serializedSizeBytes / 4) : null, compaction.createdAt, 'serialized replay estimate');
  }

  return candidates.sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
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

function trimCompactDecimal(value: number): string {
  return value >= 10 ? `${Math.round(value)}` : value.toFixed(1).replace(/\.0$/, '');
}
