import type {
  HoneycrispMemoryEdgeSummary,
  HoneycrispMemoryNodeSummary,
  ResearchProfileMemory,
  ResearchProfileMemoryStatus,
  ResearchProfileMemoryType,
  TraceEventRecord
} from '@shared/types';
import { honeycrispToolEventKind, honeycrispToolName, honeycrispToolPairingKey, honeycrispToolPayload, stringRecordValue } from '../traceClassification';
import { SESSION_HEAT_LEVELS } from './sessionHeat';
import type { SessionHeatPreferenceOverrides } from './sessionHeat';

export interface MemoryCatalogFilters {
  query: string;
  scope: 'all' | 'session' | 'workspace' | 'subject';
  sessionId: string;
  workspaceId: string | null;
  subjectId: string | null;
  type: string;
}

export type MemoryStatusGroup = string;

export interface MemoryCatalogStatusSection {
  id: string;
  label: string;
  polarity: ResearchProfileMemoryStatus['polarity'] | 'unknown';
  nodes: HoneycrispMemoryNodeSummary[];
}

export function memoryCatalogStatusGroups(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  statuses?: readonly ResearchProfileMemoryStatus[]
): Record<MemoryStatusGroup, HoneycrispMemoryNodeSummary[]> {
  if (statuses) {
    const groups: Record<string, HoneycrispMemoryNodeSummary[]> = Object.fromEntries(
      statuses.map((status) => [status.id, []])
    );
    for (const node of nodes) (groups[node.status] ??= []).push(node);
    for (const group of Object.values(groups)) sortMemoryNodes(group);
    return groups;
  }
  const groups: Record<MemoryStatusGroup, HoneycrispMemoryNodeSummary[]> = {
    suspected: [],
    confirmed: [],
    rejected: []
  };
  for (const node of nodes) {
    if (node.status === 'confirmed') groups.confirmed.push(node);
    else if (node.status === 'rejected' || node.status === 'stale') groups.rejected.push(node);
    else groups.suspected.push(node);
  }
  for (const group of Object.values(groups)) sortMemoryNodes(group);
  return groups;
}

export function memoryCatalogStatusSections(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  statuses: readonly ResearchProfileMemoryStatus[]
): MemoryCatalogStatusSection[] {
  const orderedStatuses = [...statuses].sort(compareProfileOrder);
  const definitions = new Map(orderedStatuses.map((status) => [status.id, status]));
  const unknownIds = [...new Set(nodes.map((node) => node.status).filter((id) => !definitions.has(id)))].sort();
  const groups = memoryCatalogStatusGroups(nodes, statuses);
  return [
    ...orderedStatuses.map((status) => ({
      id: status.id,
      label: status.name,
      polarity: status.polarity ?? 'neutral' as const,
      nodes: groups[status.id] ?? []
    })),
    ...unknownIds.map((id) => ({
      id,
      label: unknownCatalogLabel('status', id),
      polarity: 'unknown' as const,
      nodes: groups[id] ?? []
    }))
  ];
}

export function memoryCatalogGroupPreview(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  expanded: boolean,
  limit = 5
): { visibleNodes: HoneycrispMemoryNodeSummary[]; hiddenCount: number } {
  if (expanded || nodes.length <= limit) return { visibleNodes: [...nodes], hiddenCount: 0 };
  return { visibleNodes: nodes.slice(0, limit), hiddenCount: nodes.length - limit };
}

export function activeMemoryCount(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  statuses?: readonly ResearchProfileMemoryStatus[]
): number {
  return nodes.filter((node) => isActiveMemoryNode(node, statuses)).length;
}

export function sessionMemoryCatalogNodes(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  sessionId: string
): HoneycrispMemoryNodeSummary[] {
  return nodes.filter((node) => node.sessionIds.includes(sessionId));
}

export interface SessionMemoryTypeSummary {
  type: string;
  count: number;
  confirmedCount: number;
  suspectedCount: number;
  rejectedCount: number;
  countLabel: string;
  statusLabel: string;
}

export interface MemoryTypeSummaryPresentation {
  summaries: SessionMemoryTypeSummary[];
  defaultVisibleCount: number;
}

export function memoryTypeSummaryPresentation(
  summaries: readonly SessionMemoryTypeSummary[],
  memory?: ResearchProfileMemory,
  profileId?: string | null,
  overrides: SessionHeatPreferenceOverrides = {}
): MemoryTypeSummaryPresentation {
  const definitionById = new Map(memory?.types.map((definition) => [definition.id, definition]) ?? []);
  const heatRankByType = new Map(memory?.types.map((definition) => [
    definition.id,
    memoryTypeHeatRank(definition, profileId, overrides)
  ]) ?? []);
  const defaultVisibleCount = Math.max(
    4,
    [...heatRankByType.values()].filter((rank) => rank > 0).length
  );

  return {
    summaries: [...summaries].sort((left, right) => {
      const heatDifference = (heatRankByType.get(right.type) ?? 0) - (heatRankByType.get(left.type) ?? 0);
      if (heatDifference !== 0) return heatDifference;
      if (right.count !== left.count) return right.count - left.count;
      return compareMemoryTypeEntries(
        left.type,
        definitionById.get(left.type) ?? null,
        right.type,
        definitionById.get(right.type) ?? null
      );
    }),
    defaultVisibleCount
  };
}

function memoryTypeHeatRank(
  definition: ResearchProfileMemoryType,
  profileId: string | null | undefined,
  overrides: SessionHeatPreferenceOverrides
): number {
  let rank = 0;
  for (const status of definition.allowedStatuses) {
    const heat = (profileId ? overrides[profileId]?.[definition.id]?.[status] : undefined)
      ?? definition.sessionHeat?.[status]
      ?? 'none';
    rank = Math.max(rank, SESSION_HEAT_LEVELS.indexOf(heat));
  }
  return rank;
}

export function sessionMemoryTypeSummaries(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  memory?: ResearchProfileMemory
): SessionMemoryTypeSummary[] {
  if (memory) return dynamicSessionMemoryTypeSummaries(nodes, memory);
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

function isActiveMemoryNode(
  node: HoneycrispMemoryNodeSummary,
  statuses?: readonly ResearchProfileMemoryStatus[]
): boolean {
  if (!statuses) return node.status.trim().toLowerCase() !== 'stale';
  const status = statuses.find((definition) => definition.id === node.status);
  if (!status || status.polarity === 'negative') return false;
  return status.terminal !== true || status.polarity === 'positive';
}

function activityCountLabel(count: number, label: string, pluralLabel = `${label}s`): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? label : pluralLabel}`;
}

function memoryTypeCountLabel(type: string, count: number): string {
  if (type === 'other') return `${count} Boring`;
  const label = `${type[0].toUpperCase()}${type.slice(1)}`;
  return `${count} ${count === 1 ? label : `${label}s`}`;
}

function dynamicSessionMemoryTypeSummaries(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  memory: ResearchProfileMemory
): SessionMemoryTypeSummary[] {
  const typeById = new Map(memory.types.map((type) => [type.id, type]));
  const aliasToType = new Map(memory.types.flatMap((type) => (type.aliases ?? []).map((alias) => [alias, type] as const)));
  const statusById = new Map(memory.statuses.map((status) => [status.id, status]));
  const summaryByType = new Map<string, {
    definition: ResearchProfileMemoryType | null;
    count: number;
    statusCounts: Map<string, number>;
  }>();

  for (const node of nodes) {
    if (!isActiveMemoryNode(node, memory.statuses)) continue;
    const definition = typeById.get(node.type) ?? aliasToType.get(node.type) ?? null;
    const typeId = definition?.id ?? node.type;
    if (!typeId.trim()) continue;
    const summary = summaryByType.get(typeId) ?? { definition, count: 0, statusCounts: new Map() };
    summary.count += 1;
    summary.statusCounts.set(node.status, (summary.statusCounts.get(node.status) ?? 0) + 1);
    summaryByType.set(typeId, summary);
  }

  return [...summaryByType.entries()]
    .sort(([leftId, left], [rightId, right]) => compareMemoryTypeEntries(leftId, left.definition, rightId, right.definition))
    .map(([type, summary]) => {
      const confirmedCount = summary.statusCounts.get('confirmed') ?? 0;
      const suspectedCount = summary.statusCounts.get('suspected') ?? 0;
      const rejectedCount = summary.statusCounts.get('rejected') ?? 0;
      const orderedStatusIds = [
        ...[...memory.statuses].sort(compareProfileOrder).map((status) => status.id),
        ...[...summary.statusCounts.keys()].filter((id) => !statusById.has(id)).sort()
      ];
      const statusLabel = orderedStatusIds
        .map((statusId) => {
          const count = summary.statusCounts.get(statusId) ?? 0;
          if (count === 0) return null;
          const label = statusById.get(statusId)?.name ?? unknownCatalogLabel('status', statusId);
          return `${count} ${label}`;
        })
        .filter((label): label is string => label !== null)
        .join(', ');
      const name = summary.definition?.name ?? unknownCatalogLabel('type', type);
      const pluralName = summary.definition?.pluralName ?? name;
      return {
        type,
        count: summary.count,
        confirmedCount,
        suspectedCount,
        rejectedCount,
        countLabel: `${summary.count} ${summary.count === 1 ? name : pluralName}`,
        statusLabel
      };
    });
}

function compareMemoryTypeEntries(
  leftId: string,
  left: ResearchProfileMemoryType | null,
  rightId: string,
  right: ResearchProfileMemoryType | null
): number {
  if (left && right) {
    const group = (left.group ?? '').localeCompare(right.group ?? '');
    return left.order - right.order || group || left.name.localeCompare(right.name) || leftId.localeCompare(rightId);
  }
  if (left) return -1;
  if (right) return 1;
  return leftId.localeCompare(rightId);
}

function compareProfileOrder(left: { order: number; id: string }, right: { order: number; id: string }): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function sortMemoryNodes(nodes: HoneycrispMemoryNodeSummary[]): void {
  nodes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function unknownCatalogLabel(kind: 'type' | 'status', id: string): string {
  const normalized = id.trim().replace(/[_-]+/gu, ' ');
  const displayId = normalized ? `${normalized[0]?.toLocaleUpperCase() ?? ''}${normalized.slice(1)}` : 'unlabeled';
  return `Unknown ${kind} (${displayId})`;
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
