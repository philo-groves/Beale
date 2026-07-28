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

interface SubagentAccumulator extends SubagentSummary {
  spawnedAt: string | null;
}

const ACTIVE_SUBAGENT_STATUSES = new Set(['pending', 'running']);

export function activeSubagentCount(subagents: readonly SubagentSummary[]): number {
  return subagents.filter((subagent) => ACTIVE_SUBAGENT_STATUSES.has(subagent.status.trim().toLowerCase())).length;
}

export function subagentSummaries(events: TraceEventRecord[]): SubagentSummary[] {
  const summaries = new Map<string, SubagentAccumulator>();

  for (const event of events) {
    const path = traceAgentPath(event);
    if (!path || path === '/root') continue;
    const timestamp = subagentEventTimestamp(event);
    const eventType = subagentPayloadValue(event, 'type');
    const action = subagentPayloadValue(event, 'action');
    const spawnEvent = eventType === 'subagent.activity' && action === 'spawned';
    const current = summaries.get(path) ?? {
      id: null,
      path,
      name: subagentName(path),
      status: 'running',
      latestMessage: '',
      createdAt: timestamp,
      lastActiveAt: timestamp,
      spawnedAt: null
    };
    const message = subagentMessage(event);
    summaries.set(path, {
      ...current,
      id: subagentPayloadValue(event, 'agentId') ?? current.id,
      status: subagentPayloadValue(event, 'status') ?? current.status,
      latestMessage: message ?? current.latestMessage,
      createdAt: earlierTimestamp(current.createdAt, timestamp),
      lastActiveAt: laterTimestamp(current.lastActiveAt, timestamp),
      spawnedAt: spawnEvent
        ? current.spawnedAt
          ? earlierTimestamp(current.spawnedAt, timestamp)
          : timestamp
        : current.spawnedAt
    });
  }

  return [...summaries.values()].map(({ spawnedAt, ...summary }) => ({
    ...summary,
    createdAt: spawnedAt ?? summary.createdAt
  })).sort((left, right) => {
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

function subagentMessage(event: TraceEventRecord): string | null {
  const eventType = subagentPayloadValue(event, 'type');
  const action = subagentPayloadValue(event, 'action');
  if (eventType === 'subagent.activity') {
    if (!action || ['spawned', 'message', 'followup', 'completed', 'errored'].includes(action)) {
      return normalizedPreview(subagentPayloadValue(event, 'message'));
    }
  }
  return normalizedPreview(
    subagentPayloadValue(event, 'text') ??
      subagentPayloadValue(event, 'outputText') ??
      subagentPayloadValue(event, 'message')
  );
}

function subagentEventTimestamp(event: TraceEventRecord): string {
  const honeycrispTimestamp = stringValue(event.payload.honeycrispTimestamp);
  return honeycrispTimestamp && Number.isFinite(Date.parse(honeycrispTimestamp)) ? honeycrispTimestamp : event.createdAt;
}

function subagentPayloadValue(event: TraceEventRecord, key: string): string | null {
  const direct = stringValue(event.payload[key]);
  if (direct) return direct;
  const nested = event.payload.payload;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null;
  return stringValue((nested as Record<string, unknown>)[key]);
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
