import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary } from '@shared/types';

export interface MemoryCatalogFilters {
  query: string;
  tier: 'all' | HoneycrispMemoryNodeSummary['tier'];
  type: string;
}

export function filterMemoryCatalogNodes(nodes: HoneycrispMemoryNodeSummary[], filters: MemoryCatalogFilters): HoneycrispMemoryNodeSummary[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return nodes.filter((node) => {
    if (filters.tier !== 'all' && node.tier !== filters.tier) return false;
    if (filters.type !== 'all' && node.type !== filters.type) return false;
    return !query || memoryNodeSearchText(node).includes(query);
  });
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
