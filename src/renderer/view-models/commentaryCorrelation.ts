import type { TraceEventRecord } from '@shared/types';

export function commentaryEventString(event: TraceEventRecord, key: string): string | null {
  const direct = normalizedScalar(event.payload[key]);
  if (direct) return direct;
  for (const containerKey of ['payload', 'metadata']) {
    const container = event.payload[containerKey];
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    const nested = normalizedScalar((container as Record<string, unknown>)[key]);
    if (nested) return nested;
  }
  return null;
}

export function isNativeCommentaryEvent(event: TraceEventRecord): boolean {
  const source = commentaryEventString(event, 'transcriptSource');
  return source === 'honeycrisp_commentary' || (
    commentaryEventString(event, 'transcriptRole') === 'assistant' &&
    commentaryEventString(event, 'messagePhase') === 'commentary' &&
    source !== 'openai_reasoning_summary'
  );
}

export function commentaryMessageCorrelationKey(event: TraceEventRecord): string | null {
  const responseId = commentaryEventString(event, 'responseId');
  const turn = commentaryEventString(event, 'turn');
  if (!responseId && !turn) return null;
  const agentPath = commentaryEventString(event, 'agentPath') ?? '/root';
  const attemptId = event.attemptId ?? '';
  const correlation = responseId
    ? `response:${responseId}`
    : `turn:${commentaryEventString(event, 'provider') ?? ''}:${commentaryEventString(event, 'model') ?? ''}:${turn}`;
  return `${attemptId}\u0000${agentPath}\u0000${correlation}`;
}

export function nativeCommentaryCorrelationKeys(events: readonly TraceEventRecord[]): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (!isNativeCommentaryEvent(event)) continue;
    const key = commentaryMessageCorrelationKey(event);
    if (key) keys.add(key);
  }
  return keys;
}

function normalizedScalar(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
