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
  if (filters.scope === 'session') return node.tier === 'session' && node.sessionId === filters.sessionId;
  if (filters.scope === 'workspace') return node.tier === 'workspace' && filters.workspaceId !== null && node.workspaceId === filters.workspaceId;
  return node.tier === 'subject' && filters.subjectId !== null && node.subjectId === filters.subjectId;
}

function isActiveMemoryNode(node: HoneycrispMemoryNodeSummary): boolean {
  return node.status.trim().toLowerCase() !== 'stale';
}

function activityCountLabel(count: number, label: string, pluralLabel = `${label}s`): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? label : pluralLabel}`;
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
    node.tier,
    node.workspaceName,
    node.subjectName ?? '',
    ...node.assetIds,
    ...node.tags,
    ...node.evidenceRefs.flatMap((reference) => [reference.kind, reference.summary, reference.path ?? ''])
  ].join('\n').toLocaleLowerCase();
}
