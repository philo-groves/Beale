import type {
  HoneycrispCampaignGraphEdgeSummary,
  HoneycrispCampaignGraphNodeSummary,
  HoneycrispCampaignNodeKind
} from '@shared/types';

export interface CampaignLayoutNode extends HoneycrispCampaignGraphNodeSummary {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CampaignLayoutEdge extends HoneycrispCampaignGraphEdgeSummary {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CampaignGraphLayout {
  width: number;
  height: number;
  nodes: CampaignLayoutNode[];
  edges: CampaignLayoutEdge[];
}

const NODE_WIDTH = 184;
const NODE_HEIGHT = 60;
const COLUMN_GAP = 36;
const ROW_GAP = 18;
const INSET = 16;

export function layoutCampaignGraph(
  nodes: readonly HoneycrispCampaignGraphNodeSummary[],
  edges: readonly HoneycrispCampaignGraphEdgeSummary[]
): CampaignGraphLayout {
  const columns: HoneycrispCampaignNodeKind[][] = [
    ['asset'],
    ['memory'],
    ['finding'],
    ['runbook', 'report']
  ];
  const positioned: CampaignLayoutNode[] = [];
  columns.forEach((kinds, columnIndex) => {
    nodes
      .filter((node) => kinds.includes(node.kind))
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
      .forEach((node, rowIndex) => positioned.push({
        ...node,
        x: INSET + columnIndex * (NODE_WIDTH + COLUMN_GAP),
        y: INSET + rowIndex * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      }));
  });
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const positionedEdges = edges.flatMap((edge): CampaignLayoutEdge[] => {
    const from = byId.get(edge.fromId);
    const to = byId.get(edge.toId);
    if (!from || !to) return [];
    return [{
      ...edge,
      x1: from.x + from.width,
      y1: from.y + from.height / 2,
      x2: to.x,
      y2: to.y + to.height / 2
    }];
  });
  const maxRows = Math.max(1, ...columns.map((kinds) => nodes.filter((node) => kinds.includes(node.kind)).length));
  return {
    width: INSET * 2 + columns.length * NODE_WIDTH + (columns.length - 1) * COLUMN_GAP,
    height: INSET * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP,
    nodes: positioned,
    edges: positionedEdges
  };
}
