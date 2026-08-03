import type { TraceEventRecord } from '@shared/types';

export type ChatView = 'commentary' | 'traces';

export const DEFAULT_CHAT_VIEW: ChatView = 'commentary';
export const CHAT_VIEW_STORAGE_KEY = 'beale.chatView';

export function normalizeChatView(value: unknown): ChatView {
  return value === 'traces' || value === 'commentary' ? value : DEFAULT_CHAT_VIEW;
}

export function readChatViewPreference(storage: Pick<Storage, 'getItem'>): ChatView {
  try {
    return normalizeChatView(storage.getItem(CHAT_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_CHAT_VIEW;
  }
}

export function writeChatViewPreference(storage: Pick<Storage, 'setItem'>, chatView: ChatView): void {
  try {
    storage.setItem(CHAT_VIEW_STORAGE_KEY, chatView);
  } catch {
    // A renderer with unavailable storage can still switch views for its current lifetime.
  }
}

export function chatEventString(event: TraceEventRecord, key: string): string | null {
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
  const source = chatEventString(event, 'transcriptSource');
  return source === 'honeycrisp_commentary' || (
    chatEventString(event, 'transcriptRole') === 'assistant' &&
    chatEventString(event, 'messagePhase') === 'commentary' &&
    source !== 'openai_reasoning_summary'
  );
}

export function chatMessageCorrelationKey(event: TraceEventRecord): string | null {
  const responseId = chatEventString(event, 'responseId');
  const turn = chatEventString(event, 'turn');
  if (!responseId && !turn) return null;
  const agentPath = chatEventString(event, 'agentPath') ?? '/root';
  const attemptId = event.attemptId ?? '';
  const correlation = responseId
    ? `response:${responseId}`
    : `turn:${chatEventString(event, 'provider') ?? ''}:${chatEventString(event, 'model') ?? ''}:${turn}`;
  return `${attemptId}\u0000${agentPath}\u0000${correlation}`;
}

export function nativeCommentaryCorrelationKeys(events: readonly TraceEventRecord[]): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (!isNativeCommentaryEvent(event)) continue;
    const key = chatMessageCorrelationKey(event);
    if (key) keys.add(key);
  }
  return keys;
}

function normalizedScalar(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
