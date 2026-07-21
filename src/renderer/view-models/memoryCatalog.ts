import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary } from '@shared/types';

export interface MemoryCatalogFilters {
  query: string;
  scope: 'all' | 'session' | 'workspace' | 'subject';
  sessionId: string;
  workspaceId: string | null;
  subjectId: string | null;
  type: string;
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
  if (filters.scope === 'session') return node.sessionId === filters.sessionId;
  if (filters.scope === 'workspace') return filters.workspaceId !== null && node.workspaceId === filters.workspaceId;
  return filters.subjectId !== null && node.subjectId === filters.subjectId;
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
