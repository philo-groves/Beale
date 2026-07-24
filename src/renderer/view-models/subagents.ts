import type { TraceEventRecord } from '@shared/types';

export interface SubagentSummary {
  id: string | null;
  path: string;
  name: string;
  status: string;
  latestMessage: string;
  createdAt: string;
  lastActiveAt: string;
}

const ACTIVE_SUBAGENT_STATUSES = new Set(['pending', 'running']);

export function activeSubagentCount(subagents: readonly SubagentSummary[]): number {
  return subagents.filter((subagent) => ACTIVE_SUBAGENT_STATUSES.has(subagent.status.trim().toLowerCase())).length;
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
      createdAt: event.createdAt,
      lastActiveAt: event.createdAt
    };
    const message = subagentMessage(event);
    summaries.set(path, {
      ...current,
      id: stringValue(event.payload.agentId) ?? current.id,
      status: stringValue(event.payload.status) ?? current.status,
      latestMessage: message ?? current.latestMessage,
      createdAt: earlierTimestamp(current.createdAt, event.createdAt),
      lastActiveAt: laterTimestamp(current.lastActiveAt, event.createdAt)
    });
  }

  return [...summaries.values()].sort((left, right) => {
    const timeDifference = timestampOrder(left.createdAt, right.createdAt);
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
  const normalized = value
    .replace(/```(?:[\w-]+)?\s*([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}(?:\s+|$)/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function subagentName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function earlierTimestamp(left: string, right: string): string {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return leftMs <= rightMs ? left : right;
}

function laterTimestamp(left: string, right: string): string {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return leftMs <= rightMs ? right : left;
}

function timestampOrder(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return Number.isFinite(rightMs) ? 1 : 0;
  if (!Number.isFinite(rightMs)) return -1;
  return leftMs - rightMs;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
