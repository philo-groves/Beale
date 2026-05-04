/// <reference lib="webworker" />

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY
} from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { ProgramGraphProjection } from '@shared/types';
import type {
  ProgramGraphLayoutCluster,
  ProgramGraphLayoutEdge,
  ProgramGraphLayoutNode,
  ProgramGraphLayoutRequest,
  ProgramGraphLayoutResult,
  ProgramGraphLayoutWorkerResponse
} from './programGraphLayout';

type LayoutNode = ProgramGraphLayoutNode & SimulationNodeDatum;

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  id: string;
  source: string | LayoutNode;
  target: string | LayoutNode;
  edgeKind: string;
  qualityFlags: string[];
}

const workerScope = self as DedicatedWorkerGlobalScope;
const GRAPH_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

workerScope.onmessage = (event: MessageEvent<ProgramGraphLayoutRequest>): void => {
  if (event.data.type !== 'layout') return;
  try {
    const layout = buildLayout(event.data.projection, event.data.width, event.data.height);
    postWorkerMessage({ type: 'layout:complete', layout });
  } catch (error) {
    postWorkerMessage({ type: 'layout:error', message: error instanceof Error ? error.message : String(error) });
  }
};

function buildLayout(projection: ProgramGraphProjection, width: number, height: number): ProgramGraphLayoutResult {
  const startedAt = Date.now();
  const nodeIds = new Set(projection.nodes.map((node) => node.id));
  const projectedClusters = new Map(projection.clusters.map((cluster) => [cluster.id, cluster]));
  const nodes: LayoutNode[] = projection.nodes.map((node) => {
    const primaryClusterId = primaryClusterForNode(node.clusterIds);
    return {
      id: node.id,
      entityType: node.entityType,
      label: node.label,
      displayLabel: node.qualityFlags.includes('repeated_label') && node.pathLabel ? `${node.label} - ${node.pathLabel}` : node.label,
      sourcePath: node.sourcePath,
      pathLabel: node.pathLabel,
      repositoryLabel: node.repositoryLabel,
      sourceGroupLabel: node.sourceGroupLabel,
      degree: node.degree,
      radius: nodeRadius(node.degree, node.qualityFlags),
      clusterIds: node.clusterIds,
      qualityFlags: node.qualityFlags,
      primaryClusterId,
      x: 0,
      y: 0
    };
  });
  const links: LayoutLink[] = [];
  for (const edge of projection.edges) {
    if (!edge.targetNodeId || edge.sourceNodeId === edge.targetNodeId) continue;
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) continue;
    links.push({
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      edgeKind: edge.edgeKind,
      qualityFlags: edge.qualityFlags
    });
  }

  const centers = clusterCenters(nodes, projectedClusters, width, height);
  spreadInitialNodes(nodes, centers, width, height);
  postWorkerMessage({ type: 'layout:preview', layout: layoutResult(nodes, links, centers, projectedClusters, width, height, startedAt) });

  const simulation = forceSimulation<LayoutNode>(nodes)
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .id((node) => node.id)
        .distance((link) => edgeDistance(link.edgeKind))
        .strength((link) => edgeStrength(link.edgeKind))
    )
    .force(
      'charge',
      forceManyBody<LayoutNode>().strength((node) => -Math.min(50, 9 + Math.sqrt(Math.max(1, node.degree)) * 3.2))
    )
    .force(
      'x',
      forceX<LayoutNode>((node) => (centers.get(node.primaryClusterId)?.x ?? width / 2)).strength(0.048)
    )
    .force(
      'y',
      forceY<LayoutNode>((node) => (centers.get(node.primaryClusterId)?.y ?? height / 2)).strength(0.048)
    )
    .force('collide', forceCollide<LayoutNode>().radius((node) => node.radius + 3).iterations(2))
    .force('center', forceCenter(width / 2, height / 2))
    .stop();

  const tickCount = Math.max(90, Math.min(180, Math.round(75 + nodes.length / 45 + links.length / 240)));
  for (let index = 0; index < tickCount; index += 1) {
    simulation.tick();
  }

  return layoutResult(nodes, links, centers, projectedClusters, width, height, startedAt);
}

function layoutResult(
  nodes: LayoutNode[],
  links: LayoutLink[],
  centers: Map<string, { x: number; y: number }>,
  projectedClusters: Map<string, ProgramGraphProjection['clusters'][number]>,
  width: number,
  height: number,
  startedAt: number
): ProgramGraphLayoutResult {
  return {
    width,
    height,
    nodes: nodes.map((node) => ({
      id: node.id,
      entityType: node.entityType,
      label: node.label,
      displayLabel: node.displayLabel,
      sourcePath: node.sourcePath,
      pathLabel: node.pathLabel,
      repositoryLabel: node.repositoryLabel,
      sourceGroupLabel: node.sourceGroupLabel,
      degree: node.degree,
      radius: node.radius,
      clusterIds: node.clusterIds,
      qualityFlags: node.qualityFlags,
      primaryClusterId: node.primaryClusterId,
      x: node.x ?? width / 2,
      y: node.y ?? height / 2
    })),
    edges: links.map((link): ProgramGraphLayoutEdge => ({
      id: link.id,
      sourceNodeId: typeof link.source === 'string' ? link.source : link.source.id,
      targetNodeId: typeof link.target === 'string' ? link.target : link.target.id,
      edgeKind: link.edgeKind,
      qualityFlags: link.qualityFlags
    })),
    clusters: layoutClusters(nodes, centers, projectedClusters),
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt
  };
}

function primaryClusterForNode(clusterIds: string[]): string {
  return (
    clusterIds.find((clusterId) => clusterId.startsWith('source_group:')) ??
    clusterIds.find((clusterId) => clusterId.startsWith('repository:')) ??
    clusterIds.find((clusterId) => clusterId.startsWith('entity_family:')) ??
    clusterIds[0] ??
    'entity_family:unknown'
  );
}

function clusterCenters(
  nodes: LayoutNode[],
  projectedClusters: Map<string, ProgramGraphProjection['clusters'][number]>,
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.primaryClusterId, (counts.get(node.primaryClusterId) ?? 0) + 1);
  }
  const clusterIds = [...counts.entries()]
    .sort((left, right) => {
      const leftCluster = projectedClusters.get(left[0]);
      const rightCluster = projectedClusters.get(right[0]);
      return right[1] - left[1] || (leftCluster?.label ?? left[0]).localeCompare(rightCluster?.label ?? right[0]);
    })
    .map(([clusterId]) => clusterId);
  const centers = new Map<string, { x: number; y: number }>();
  if (clusterIds.length === 0) return centers;
  const columns = Math.max(1, Math.ceil(Math.sqrt(clusterIds.length * 1.35)));
  const rows = Math.ceil(clusterIds.length / columns);
  const marginX = Math.max(110, width * 0.08);
  const marginY = Math.max(90, height * 0.08);
  const usableWidth = Math.max(1, width - marginX * 2);
  const usableHeight = Math.max(1, height - marginY * 2);
  clusterIds.forEach((clusterId, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = columns === 1 ? width / 2 : marginX + (usableWidth * column) / (columns - 1);
    const y = rows === 1 ? height / 2 : marginY + (usableHeight * row) / (rows - 1);
    centers.set(clusterId, { x, y });
  });
  return centers;
}

function layoutClusters(
  nodes: LayoutNode[],
  centers: Map<string, { x: number; y: number }>,
  projectedClusters: Map<string, ProgramGraphProjection['clusters'][number]>
): ProgramGraphLayoutCluster[] {
  return [...centers.entries()]
    .map(([clusterId, center]) => {
      const clusterNodes = nodes.filter((node) => node.primaryClusterId === clusterId);
      const projected = projectedClusters.get(clusterId);
      if (clusterNodes.length === 0) {
        return {
          id: clusterId,
          kind: projected?.kind ?? 'cluster',
          label: projected?.label ?? clusterId,
          nodeCount: projected?.nodeCount ?? 0,
          edgeCount: projected?.edgeCount ?? 0,
          qualityFlags: projected?.qualityFlags ?? [],
          x: center.x,
          y: center.y,
          radius: 70
        };
      }
      const x = clusterNodes.reduce((sum, node) => sum + (node.x ?? center.x), 0) / clusterNodes.length;
      const y = clusterNodes.reduce((sum, node) => sum + (node.y ?? center.y), 0) / clusterNodes.length;
      const radius = Math.max(
        74,
        Math.max(...clusterNodes.map((node) => Math.hypot((node.x ?? x) - x, (node.y ?? y) - y) + node.radius + 18))
      );
      return {
        id: clusterId,
        kind: projected?.kind ?? 'cluster',
        label: projected?.label ?? clusterId,
        nodeCount: projected?.nodeCount ?? clusterNodes.length,
        edgeCount: projected?.edgeCount ?? 0,
        qualityFlags: projected?.qualityFlags ?? [],
        x,
        y,
        radius
      };
    })
    .sort((left, right) => right.nodeCount - left.nodeCount || left.label.localeCompare(right.label));
}

function spreadInitialNodes(nodes: LayoutNode[], centers: Map<string, { x: number; y: number }>, width: number, height: number): void {
  const groups = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    const group = groups.get(node.primaryClusterId) ?? [];
    group.push(node);
    groups.set(node.primaryClusterId, group);
  }
  for (const [clusterId, group] of groups) {
    const center = centers.get(clusterId) ?? { x: width / 2, y: height / 2 };
    group
      .sort((left, right) => right.degree - left.degree || left.displayLabel.localeCompare(right.displayLabel))
      .forEach((node, index) => {
        if (index === 0) {
          node.x = center.x;
          node.y = center.y;
          return;
        }
        const angle = index * GRAPH_GOLDEN_ANGLE;
        const radius = 18 + Math.sqrt(index) * 10.5 + stableJitter(node.id, 6);
        node.x = center.x + Math.cos(angle) * radius;
        node.y = center.y + Math.sin(angle) * radius;
      });
  }
}

function nodeRadius(degree: number, qualityFlags: string[]): number {
  const base = Math.min(15, 3.4 + Math.sqrt(Math.max(1, degree)) * 1.15);
  return qualityFlags.includes('generic_label') ? Math.max(4.2, base - 1.2) : base;
}

function edgeDistance(edgeKind: string): number {
  switch (edgeKind) {
    case 'routes_to':
    case 'handles_with':
    case 'uses_middleware':
      return 72;
    case 'checks_permission':
    case 'reaches_sink':
    case 'parses_body':
    case 'serializes_response':
      return 96;
    case 'calls':
      return 56;
    case 'imports_symbol':
    case 'exports_symbol':
      return 50;
    default:
      return 82;
  }
}

function edgeStrength(edgeKind: string): number {
  switch (edgeKind) {
    case 'routes_to':
    case 'handles_with':
    case 'uses_middleware':
      return 0.18;
    case 'checks_permission':
    case 'reaches_sink':
      return 0.13;
    case 'calls':
      return 0.08;
    default:
      return 0.06;
  }
}

function stableJitter(value: string, scale: number): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return ((hash % 1000) / 1000 - 0.5) * scale;
}

function postWorkerMessage(message: ProgramGraphLayoutWorkerResponse): void {
  workerScope.postMessage(message);
}
