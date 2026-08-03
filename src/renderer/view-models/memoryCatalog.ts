import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary, TraceEventRecord } from '@shared/types';
import { honeycrispToolEventKind, honeycrispToolName, honeycrispToolPairingKey, honeycrispToolPayload, stringRecordValue } from '../traceClassification';

export interface MemoryCatalogFilters {
  query: string;
  scope: 'all' | 'session' | 'workspace' | 'subject';
  sessionId: string;
  workspaceId: string | null;
  subjectId: string | null;
  type: string;
}

export function activeMemoryCount(nodes: readonly HoneycrispMemoryNodeSummary[]): number {
  return nodes.filter(isActiveMemoryNode).length;
}

export function sessionMemoryCatalogNodes(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  sessionId: string
): HoneycrispMemoryNodeSummary[] {
  return nodes.filter((node) => node.sessionIds.includes(sessionId));
}

export interface SessionMemoryTypeSummary {
  type: 'primitive' | 'chain' | 'sink' | 'other';
  count: number;
  confirmedCount: number;
  suspectedCount: number;
  rejectedCount: number;
  countLabel: string;
  statusLabel: string;
}

export function sessionMemoryTypeSummaries(nodes: readonly HoneycrispMemoryNodeSummary[]): SessionMemoryTypeSummary[] {
  const summaries: SessionMemoryTypeSummary[] = [
    { type: 'sink', count: 0, confirmedCount: 0, suspectedCount: 0, rejectedCount: 0, countLabel: '', statusLabel: '' },
    { type: 'primitive', count: 0, confirmedCount: 0, suspectedCount: 0, rejectedCount: 0, countLabel: '', statusLabel: '' },
    { type: 'chain', count: 0, confirmedCount: 0, suspectedCount: 0, rejectedCount: 0, countLabel: '', statusLabel: '' },
    { type: 'other', count: 0, confirmedCount: 0, suspectedCount: 0, rejectedCount: 0, countLabel: '', statusLabel: '' }
  ];

  for (const node of nodes) {
    if (!isActiveMemoryNode(node)) continue;
    const type = node.type.trim();
    if (!type) continue;
    const normalizedType = type.toLocaleLowerCase();
    const category = normalizedType === 'primitive' || normalizedType === 'chain' || normalizedType === 'sink'
      ? normalizedType
      : 'other';
    const current = summaries.find((summary) => summary.type === category);
    if (!current) continue;
    current.count += 1;
    const status = node.status.trim().toLocaleLowerCase();
    if (status === 'confirmed') current.confirmedCount += 1;
    if (status === 'suspected') current.suspectedCount += 1;
    if (status === 'rejected') current.rejectedCount += 1;
  }

  return summaries
    .filter((summary) => summary.count > 0)
    .map((summary) => ({
      ...summary,
      countLabel: memoryTypeCountLabel(summary.type, summary.count),
      statusLabel: memoryTypeStatusLabel(summary)
    }));
}

export function sessionMemoryActivitySummary(events: readonly TraceEventRecord[]): string {
  const counts = {
    search: { paired: new Set<string>(), requested: 0, observed: 0 },
    update: { paired: new Set<string>(), requested: 0, observed: 0 }
  };

  for (const event of events) {
    const toolName = honeycrispToolName(event);
    const activity = toolName === 'memory.search'
      ? 'search'
      : toolName && ['memory.save', 'memory.correct', 'memory.link'].includes(toolName)
        ? 'update'
        : null;
    if (!activity) continue;

    const kind = honeycrispToolEventKind(event);
    if (!kind) continue;
    const payload = honeycrispToolPayload(event);
    const actionId = payload ? stringRecordValue(payload, 'toolActionId') : null;
    if (actionId) {
      counts[activity].paired.add(honeycrispToolPairingKey(event) ?? `${activity}:${actionId}`);
    } else if (kind === 'tool.requested') {
      counts[activity].requested += 1;
    } else {
      counts[activity].observed += 1;
    }
  }

  const searchCount = counts.search.paired.size + Math.max(counts.search.requested, counts.search.observed);
  const updateCount = counts.update.paired.size + Math.max(counts.update.requested, counts.update.observed);
  return [
    activityCountLabel(searchCount, 'Search', 'Searches'),
    activityCountLabel(updateCount, 'Update')
  ].filter((label): label is string => label !== null).join(', ');
}
export function filterMemoryCatalogNodes(nodes: HoneycrispMemoryNodeSummary[], filters: MemoryCatalogFilters): HoneycrispMemoryNodeSummary[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return nodes
    .filter((node) => {
      if (!memoryNodeMatchesScope(node, filters)) return false;
      if (filters.type !== 'all' && node.type !== filters.type) return false;
      return !query || memoryNodeSearchText(node).includes(query);
    })
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id));
}

function memoryNodeMatchesScope(node: HoneycrispMemoryNodeSummary, filters: MemoryCatalogFilters): boolean {
  if (filters.scope === 'all') return true;
  if (filters.scope === 'session') return node.sessionIds.includes(filters.sessionId);
  if (filters.scope === 'workspace') return filters.workspaceId !== null && node.workspaces.some((workspace) => workspace.id === filters.workspaceId);
  return filters.subjectId !== null && node.subjectId === filters.subjectId;
}

function isActiveMemoryNode(node: HoneycrispMemoryNodeSummary): boolean {
  return node.status.trim().toLowerCase() !== 'stale';
}

function activityCountLabel(count: number, label: string, pluralLabel = `${label}s`): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? label : pluralLabel}`;
}

function memoryTypeCountLabel(type: SessionMemoryTypeSummary['type'], count: number): string {
  if (type === 'other') return `${count} Boring`;
  const label = `${type[0].toUpperCase()}${type.slice(1)}`;
  return `${count} ${count === 1 ? label : `${label}s`}`;
}

function memoryTypeStatusLabel(summary: SessionMemoryTypeSummary): string {
  if (summary.type === 'other') return '';
  return [
    summary.confirmedCount > 0 ? `${summary.confirmedCount} Confirmed` : null,
    summary.suspectedCount > 0 ? `${summary.suspectedCount} Suspected` : null,
    summary.rejectedCount > 0 ? `${summary.rejectedCount} Rejected` : null
  ].filter((label): label is string => label !== null).join(', ');
}

export function groupMemoryRelationships(edges: HoneycrispMemoryEdgeSummary[]): Map<string, HoneycrispMemoryEdgeSummary[]> {
  const grouped = new Map<string, HoneycrispMemoryEdgeSummary[]>();
  for (const edge of edges) {
    grouped.set(edge.fromId, [...(grouped.get(edge.fromId) ?? []), edge]);
    if (edge.toId !== edge.fromId) grouped.set(edge.toId, [...(grouped.get(edge.toId) ?? []), edge]);
  }
  return grouped;
}

export function memoryCatalogUpdateKey(nodes: HoneycrispMemoryNodeSummary[]): string {
  return nodes.map((node) => `${node.id}:${node.updatedAt}`).join('|');
}

function memoryNodeSearchText(node: HoneycrispMemoryNodeSummary): string {
  return [
    node.type,
    node.title,
    node.summary,
    node.body,
    node.status,
    ...node.sessionIds,
    ...node.workspaces.flatMap((workspace) => [workspace.id, workspace.name]),
    node.subjectName,
    ...node.assetIds,
    ...node.tags,
    ...node.evidenceRefs.flatMap((reference) => [reference.kind, reference.summary, reference.path ?? ''])
  ].join('\n').toLocaleLowerCase();
}
