import type { TraceEventRecord } from '@shared/types';

export interface SubagentSummary {
  id: string | null;
  path: string;
  name: string;
  status: string;
  latestMessage: string;
  lastActiveAt: string;
}

export function subagentSummaries(events: TraceEventRecord[]): SubagentSummary[] {
  const summaries = new Map<string, SubagentSummary>();

  for (const event of events) {
    const path = traceAgentPath(event);
    if (!path || path === '/root') continue;
    const current = summaries.get(path) ?? {
      id: null,
      path,
      name: subagentName(path),
      status: 'running',
      latestMessage: '',
      lastActiveAt: event.createdAt
    };
    const message = subagentMessage(event);
    summaries.set(path, {
      ...current,
      id: stringValue(event.payload.agentId) ?? current.id,
      status: stringValue(event.payload.status) ?? current.status,
      latestMessage: message ?? current.latestMessage,
      lastActiveAt: laterTimestamp(current.lastActiveAt, event.createdAt)
    });
  }

  return [...summaries.values()].sort((left, right) => {
    const timeDifference = Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt);
    return timeDifference || left.path.localeCompare(right.path);
  });
}

export function traceEventsForSubagent<TEvent extends TraceEventRecord>(events: TEvent[], path: string | null): TEvent[] {
  if (!path) {
    return events.filter((event) => {
      const agentPath = traceAgentPath(event);
      return !agentPath || agentPath === '/root';
    });
  }
  return events.filter((event) => traceAgentPath(event) === path);
}

export function traceAgentPath(event: TraceEventRecord): string | null {
  return stringValue(event.payload.agentPath);
}

export function formatRelativeActivity(timestamp: string, nowMs = Date.now()): string {
  const thenMs = Date.parse(timestamp);
  if (!Number.isFinite(thenMs)) return '—';
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (elapsedSeconds < 60) return 'now';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 28) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function subagentMessage(event: TraceEventRecord): string | null {
  const eventType = stringValue(event.payload.type);
  const action = stringValue(event.payload.action);
  if (eventType === 'subagent.activity') {
    if (!action || ['spawned', 'message', 'followup', 'completed', 'errored'].includes(action)) {
      return normalizedPreview(stringValue(event.payload.message));
    }
  }
  return normalizedPreview(
    stringValue(event.payload.text) ??
      stringValue(event.payload.outputText) ??
      stringValue(event.payload.message)
  );
}

function normalizedPreview(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function subagentName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function laterTimestamp(left: string, right: string): string {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return rightMs >= leftMs ? right : left;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
