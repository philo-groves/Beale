import { useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { Boxes, Database, GitBranch, Network, Route, SearchCheck, ShieldCheck } from 'lucide-react';
import type {
  ProgramGraphVisualization,
  ProgramGraphVisualizationNode,
  ProgramScopeVersion,
  ProjectGraphSummary,
  ProjectSemanticSummary,
  ScopeAsset
} from '@shared/types';
import { userFacingErrorMessage } from '../../lib/errors';
import { formatSessionDateTime, networkProfileLabel, stateClass, traceLabel, truncateText } from '../../lib/formatting';
import type { ProgramMainView } from './programViews';

export function ProgramUnderstandingView({
  graph,
  programView,
  runCount,
  scope,
  semantic
}: {
  graph: ProjectGraphSummary | null;
  programView: ProgramMainView;
  runCount: number;
  scope: ProgramScopeVersion | null;
  semantic: ProjectSemanticSummary | null;
}): JSX.Element {
  const inScopeAssets = scope?.assets.filter((asset) => asset.direction === 'in_scope') ?? [];
  const outOfScopeAssets = scope?.assets.filter((asset) => asset.direction === 'out_of_scope') ?? [];
  const repositoryAssets = inScopeAssets.filter((asset) => asset.kind === 'repo').slice(0, 6);
  const graphStatus = graph?.status ?? 'empty';
  const semanticStatus = semantic ? semantic.status : 'empty';
  const semanticChunkDetail = semantic ? `${formatCount(semantic.embeddedChunkCount)} / ${formatCount(semantic.chunkCount)} chunks` : '0 / 0 chunks';
  const semanticSourceDetail = semantic ? `${formatCount(semantic.indexedSourceDocumentCount)} / ${formatCount(semantic.sourceDocumentCount)} sources` : '0 / 0 sources';
  const [visualization, setVisualization] = useState<ProgramGraphVisualization | null>(null);
  const [visualizationLoading, setVisualizationLoading] = useState(false);
  const [visualizationError, setVisualizationError] = useState<string | null>(null);

  useEffect(() => {
    setVisualization(null);
    setVisualizationError(null);
  }, [scope?.id]);

  useEffect(() => {
    if (programView !== 'graph' || !scope) return undefined;
    let canceled = false;
    setVisualizationLoading(true);
    setVisualizationError(null);
    window.beale
      .getProgramGraphVisualization()
      .then((next) => {
        if (canceled) return;
        setVisualization(next);
      })
      .catch((error: unknown) => {
        if (canceled) return;
        setVisualizationError(userFacingErrorMessage(error));
      })
      .finally(() => {
        if (!canceled) setVisualizationLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [graph?.edgeCount, graph?.indexedAt, graph?.nodeCount, programView, scope?.id]);

  return (
    <div className="program-understanding-workspace" aria-label="Program Understanding">
      <div className="program-understanding-scroll">
        {programView === 'graph' ? (
          <ProgramGraphVisualizationPanel
            error={visualizationError}
            graph={graph}
            loading={visualizationLoading}
            visualization={visualization}
          />
        ) : (
          <>
            <div className="program-understanding-summary-grid" aria-label="Program summary">
              <SummaryTile icon={<GitBranch size={17} />} label="Relationship Graph" value={formatCount(graph?.nodeCount ?? 0)} detail={`${formatCount(graph?.edgeCount ?? 0)} edges`} />
              <SummaryTile icon={<SearchCheck size={17} />} label="Search Memory" value={semanticChunkDetail} detail={semanticSourceDetail} />
              <SummaryTile icon={<ShieldCheck size={17} />} label="Scope" value={`${formatCount(inScopeAssets.length)} in scope`} detail={`${formatCount(outOfScopeAssets.length)} excluded`} />
              <SummaryTile icon={<Network size={17} />} label="Sessions" value={formatCount(runCount)} detail={scope ? networkProfileLabel(scope.networkProfile) : 'No active program'} />
            </div>

            <div className="program-understanding-layout">
              <section className="program-understanding-section program-understanding-section-wide" aria-label="Relationship graph">
                <SectionHeader icon={<GitBranch size={16} />} title="Relationship Graph" status={graphStatus} />
                <div className="program-understanding-metric-grid">
                  <MetricCell label="Nodes" value={formatCount(graph?.nodeCount ?? 0)} />
                  <MetricCell label="Edges" value={formatCount(graph?.edgeCount ?? 0)} />
                  <MetricCell label="Structural Edges" value={formatCount(graph?.structuralEdgeCount ?? 0)} />
                  <MetricCell label="Unresolved" value={formatCount(graph?.unresolvedEdgeCount ?? 0)} />
                  <MetricCell label="Expected Nodes" value={formatCount(graph?.expectedNodeCount ?? 0)} />
                  <MetricCell label="Builds" value={formatCount(graph?.buildCount ?? 0)} />
                </div>
                <div className="program-understanding-list-grid">
                  <CountList title="Node Families" counts={graph?.nodeFamilyCounts} />
                  <CountList title="Edge Families" counts={graph?.edgeFamilyCounts} />
                  <CountList title="Extraction Families" counts={graph?.extractionFamilyCounts} />
                </div>
                <GraphFreshness graph={graph} />
              </section>

              <section className="program-understanding-section" aria-label="Search memory">
                <SectionHeader icon={<Database size={16} />} title="Search Memory" status={semanticStatus} />
                <div className="program-understanding-metric-grid compact">
                  <MetricCell label="Chunks" value={`${formatCount(semantic?.embeddedChunkCount ?? 0)} / ${formatCount(semantic?.chunkCount ?? 0)}`} />
                  <MetricCell label="Sources" value={`${formatCount(semantic?.indexedSourceDocumentCount ?? 0)} / ${formatCount(semantic?.sourceDocumentCount ?? 0)}`} />
                  <MetricCell label="Index Size" value={formatBytes(semantic?.indexSizeBytes ?? 0)} />
                  <MetricCell label="Provider" value={semantic?.provider ?? 'None'} />
                </div>
                <KeyValueRows
                  rows={[
                    ['Model', semantic?.model ?? 'None'],
                    ['Remote Embeddings', semantic?.remoteEmbeddingEnabled ? 'Enabled' : 'Disabled'],
                    ['Progress', semanticProgressLabel(semantic)],
                    ['Indexed', formatNullableDate(semantic?.indexedAt)]
                  ]}
                />
                <CountList title="Namespaces" counts={semantic?.namespaceCounts} />
                {semantic?.lastError ? <p className="program-understanding-warning">{semantic.lastError}</p> : null}
              </section>

              <section className="program-understanding-section" aria-label="Program scope">
                <SectionHeader icon={<Boxes size={16} />} title="Program Scope" />
                <KeyValueRows
                  rows={[
                    ['Organization', scope?.organizationName ?? 'None'],
                    ['Network', scope ? networkProfileLabel(scope.networkProfile) : 'None'],
                    ['Scope Version', scope ? `v${scope.version}` : 'None'],
                    ['Active From', formatNullableDate(scope?.activeFrom)]
                  ]}
                />
                <CountList title="Asset Types" counts={assetKindCounts(inScopeAssets)} />
                <RepositoryList assets={repositoryAssets} total={inScopeAssets.filter((asset) => asset.kind === 'repo').length} />
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProgramGraphVisualizationPanel({
  error,
  graph,
  loading,
  visualization
}: {
  error: string | null;
  graph: ProjectGraphSummary | null;
  loading: boolean;
  visualization: ProgramGraphVisualization | null;
}): JSX.Element {
  const layout = useMemo(() => (visualization ? buildGraphLayout(visualization) : null), [visualization]);
  const nodeCounts = useMemo(() => nodeFamilyCounts(visualization?.nodes ?? []), [visualization]);
  const edgeCounts = useMemo(() => edgeFamilyCounts(visualization), [visualization]);
  const relationships = useMemo(() => (visualization && layout ? graphRelationships(visualization, layout.nodesById) : []), [layout, visualization]);

  if (loading && !visualization) {
    return (
      <div className="program-graph-loading" role="status">
        Loading graph...
      </div>
    );
  }

  if (error && !visualization) {
    return <p className="program-understanding-warning">{error}</p>;
  }

  if (!visualization || visualization.nodes.length === 0 || !layout) {
    return (
      <div className="program-graph-empty">
        <Network size={22} />
        <strong>No graph records yet.</strong>
      </div>
    );
  }

  return (
    <div className="program-graph-visualization-view">
      <div className="program-graph-canvas" aria-label="Relationship graph visualization">
        <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} role="img">
          <defs>
            <marker id="program-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          <g className="program-graph-edges">
            {visualization.edges.map((edge) => {
              const source = layout.nodesById.get(edge.sourceNodeId);
              const target = layout.nodesById.get(edge.targetNodeId);
              if (!source || !target) return null;
              return (
                <line
                  key={edge.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className={`program-graph-edge edge-${stateClass(edge.edgeKind)}`}
                  markerEnd="url(#program-graph-arrow)"
                >
                  <title>{`${traceLabel(edge.edgeKind)}: ${target.label}`}</title>
                </line>
              );
            })}
          </g>
          <g className="program-graph-edge-labels">
            {visualization.edges.slice(0, 24).map((edge) => {
              const source = layout.nodesById.get(edge.sourceNodeId);
              const target = layout.nodesById.get(edge.targetNodeId);
              if (!source || !target) return null;
              return (
                <text key={`${edge.id}:label`} x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 5} textAnchor="middle">
                  {traceLabel(edge.edgeKind)}
                </text>
              );
            })}
          </g>
          <g className="program-graph-nodes">
            {layout.nodes.map((node) => (
              <g key={node.id} className={`program-graph-node node-${stateClass(node.entityType)}`} transform={`translate(${node.x} ${node.y})`}>
                <circle r={node.radius} fill={node.color} />
                {node.labelVisible ? (
                  <text y={node.radius + 13} textAnchor="middle">
                    {truncateText(node.displayLabel, 34)}
                  </text>
                ) : null}
                <title>{`${traceLabel(node.entityType)}: ${node.displayLabel}${node.sourcePath ? ` (${node.sourcePath})` : ''}`}</title>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <aside className="program-graph-side" aria-label="Displayed graph sample">
        <div className="program-graph-side-heading">
          <strong>{`${formatCount(visualization.sampledNodeCount)} nodes`}</strong>
          <span>{`${formatCount(visualization.sampledEdgeCount)} edges`}</span>
        </div>
        <KeyValueRows
          rows={[
            ['Total Nodes', formatCount(visualization.nodeCount)],
            ['Total Edges', formatCount(visualization.edgeCount)],
            ['Status', traceLabel(visualization.status)],
            ['Indexed', formatNullableDate(graph?.indexedAt)]
          ]}
        />
        <RelationshipList relationships={relationships} />
        <CountList title="Displayed Nodes" counts={nodeCounts} />
        <CountList title="Displayed Edges" counts={edgeCounts} />
        {loading ? <p className="program-graph-note">Refreshing graph sample...</p> : null}
        {visualization.truncated ? <p className="program-graph-note">Showing a bounded sample from the indexed graph.</p> : null}
        {error ? <p className="program-understanding-warning">{error}</p> : null}
      </aside>
    </div>
  );
}

const GRAPH_WIDTH = 1180;
const GRAPH_HEIGHT = 760;
const GRAPH_CENTER_X = GRAPH_WIDTH / 2;
const GRAPH_CENTER_Y = GRAPH_HEIGHT / 2;
const GRAPH_LABEL_LIMIT = 24;
const GRAPH_FAMILY_PRIORITY = [
  'scope_version',
  'scope_asset',
  'run',
  'hypothesis',
  'finding',
  'evidence',
  'verifier_run',
  'verifier_contract',
  'artifact',
  'structure_entity',
  'inventory_item',
  'trace_event',
  'transcript',
  'research_component',
  'weakness'
];

interface PositionedGraphNode extends ProgramGraphVisualizationNode {
  displayLabel: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  labelVisible: boolean;
}

function buildGraphLayout(visualization: ProgramGraphVisualization): {
  nodes: PositionedGraphNode[];
  nodesById: Map<string, PositionedGraphNode>;
} {
  const nodes = [...visualization.nodes].sort((left, right) => nodeSortPriority(left) - nodeSortPriority(right) || right.degree - left.degree || left.label.localeCompare(right.label));
  if (nodes.length === 0) return { nodes: [], nodesById: new Map() };
  const centerNode = [...nodes].sort((left, right) => right.degree - left.degree || nodeSortPriority(left) - nodeSortPriority(right))[0];
  const labelIds = new Set(
    [...nodes]
      .sort((left, right) => right.degree - left.degree || nodeSortPriority(left) - nodeSortPriority(right) || left.label.localeCompare(right.label))
      .slice(0, GRAPH_LABEL_LIMIT)
      .map((node) => node.id)
  );
  const remainingNodes = nodes.filter((node) => node.id !== centerNode.id);
  const families = [...new Set(remainingNodes.map((node) => node.entityType))].sort((left, right) => familyPriority(left) - familyPriority(right) || left.localeCompare(right));
  const initialPositions = new Map<string, { x: number; y: number }>([[centerNode.id, { x: GRAPH_CENTER_X, y: GRAPH_CENTER_Y }]]);
  const duplicateLabelCounts = duplicateGraphLabelCounts(nodes);

  families.forEach((family, familyIndex) => {
    const familyNodes = remainingNodes.filter((node) => node.entityType === family).sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label));
    const familyAngle = -Math.PI / 2 + (Math.PI * 2 * familyIndex) / Math.max(1, families.length);
    const familyCenterX = GRAPH_CENTER_X + Math.cos(familyAngle) * 330;
    const familyCenterY = GRAPH_CENTER_Y + Math.sin(familyAngle) * 250;
    const localRadius = familyNodes.length <= 1 ? 0 : Math.min(180, 58 + Math.sqrt(familyNodes.length) * 24);
    familyNodes.forEach((node, nodeIndex) => {
      const localAngle = familyAngle + (Math.PI * 2 * nodeIndex) / Math.max(1, familyNodes.length) + hashJitter(node.id, 0.22);
      initialPositions.set(node.id, {
        x: clamp(familyCenterX + Math.cos(localAngle) * localRadius, 48, GRAPH_WIDTH - 48),
        y: clamp(familyCenterY + Math.sin(localAngle) * localRadius, 54, GRAPH_HEIGHT - 76)
      });
    });
  });

  const positions = relaxGraphPositions(nodes, visualization.edges, initialPositions);
  const positioned = nodes.map((node) => {
    const position = positions.get(node.id) ?? { x: GRAPH_CENTER_X, y: GRAPH_CENTER_Y };
    return {
      ...node,
      x: position.x,
      y: position.y,
      radius: nodeRadius(node),
      color: nodeColor(node.entityType),
      displayLabel: graphNodeDisplayLabel(node, duplicateLabelCounts),
      labelVisible: nodes.length <= 64 || labelIds.has(node.id)
    };
  });

  const nodesById = new Map(positioned.map((node) => [node.id, node]));
  return { nodes: positioned, nodesById };
}

function relaxGraphPositions(
  nodes: ProgramGraphVisualizationNode[],
  edges: ProgramGraphVisualization['edges'],
  initialPositions: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  const positions = new Map(nodes.map((node) => [node.id, { ...(initialPositions.get(node.id) ?? { x: GRAPH_CENTER_X, y: GRAPH_CENTER_Y }) }]));
  const velocities = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
  const nodeIds = nodes.map((node) => node.id);
  const linkedEdges = edges.filter((edge) => positions.has(edge.sourceNodeId) && positions.has(edge.targetNodeId));
  for (let iteration = 0; iteration < 150; iteration += 1) {
    for (let leftIndex = 0; leftIndex < nodeIds.length; leftIndex += 1) {
      const leftId = nodeIds[leftIndex];
      const left = positions.get(leftId);
      const leftVelocity = velocities.get(leftId);
      if (!left || !leftVelocity) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < nodeIds.length; rightIndex += 1) {
        const rightId = nodeIds[rightIndex];
        const right = positions.get(rightId);
        const rightVelocity = velocities.get(rightId);
        if (!right || !rightVelocity) continue;
        const dx = left.x - right.x || hashJitter(`${leftId}:${rightId}`, 0.8);
        const dy = left.y - right.y || hashJitter(`${rightId}:${leftId}`, 0.8);
        const distanceSquared = Math.max(96, dx * dx + dy * dy);
        const force = 3900 / distanceSquared;
        const distance = Math.sqrt(distanceSquared);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        leftVelocity.x += fx;
        leftVelocity.y += fy;
        rightVelocity.x -= fx;
        rightVelocity.y -= fy;
      }
    }

    for (const edge of linkedEdges) {
      const source = positions.get(edge.sourceNodeId);
      const target = positions.get(edge.targetNodeId);
      const sourceVelocity = velocities.get(edge.sourceNodeId);
      const targetVelocity = velocities.get(edge.targetNodeId);
      if (!source || !target || !sourceVelocity || !targetVelocity) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const idealDistance = edge.edgeKind === 'calls' ? 170 : 220;
      const force = (distance - idealDistance) * 0.012;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      sourceVelocity.x += fx;
      sourceVelocity.y += fy;
      targetVelocity.x -= fx;
      targetVelocity.y -= fy;
    }

    for (const id of nodeIds) {
      const position = positions.get(id);
      const velocity = velocities.get(id);
      if (!position || !velocity) continue;
      velocity.x += (GRAPH_CENTER_X - position.x) * 0.0018;
      velocity.y += (GRAPH_CENTER_Y - position.y) * 0.0018;
      velocity.x *= 0.84;
      velocity.y *= 0.84;
      position.x = clamp(position.x + velocity.x, 60, GRAPH_WIDTH - 60);
      position.y = clamp(position.y + velocity.y, 62, GRAPH_HEIGHT - 82);
    }
  }
  return positions;
}

function nodeFamilyCounts(nodes: ProgramGraphVisualizationNode[]): Record<string, number> {
  return nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.entityType] = (counts[node.entityType] ?? 0) + 1;
    return counts;
  }, {});
}

function edgeFamilyCounts(visualization: ProgramGraphVisualization | null): Record<string, number> {
  return (visualization?.edges ?? []).reduce<Record<string, number>>((counts, edge) => {
    counts[edge.edgeKind] = (counts[edge.edgeKind] ?? 0) + 1;
    return counts;
  }, {});
}

interface GraphRelationship {
  id: string;
  edgeKind: string;
  source: string;
  sourcePath: string;
  target: string;
  targetPath: string;
}

function graphRelationships(visualization: ProgramGraphVisualization, nodesById: Map<string, PositionedGraphNode>): GraphRelationship[] {
  return visualization.edges
    .map((edge) => {
      const source = nodesById.get(edge.sourceNodeId);
      const target = nodesById.get(edge.targetNodeId);
      if (!source || !target) return null;
      return {
        id: edge.id,
        edgeKind: edge.edgeKind,
        source: source.displayLabel,
        sourcePath: compactGraphPath(source.sourcePath),
        target: target.displayLabel,
        targetPath: compactGraphPath(target.sourcePath)
      };
    })
    .filter((relationship): relationship is GraphRelationship => Boolean(relationship));
}

function RelationshipList({ relationships }: { relationships: GraphRelationship[] }): JSX.Element {
  return (
    <div className="program-graph-relationship-list">
      <h4>Displayed Relationships</h4>
      {relationships.length > 0 ? (
        <ul>
          {relationships.slice(0, 12).map((relationship) => (
            <li key={relationship.id}>
              <span className="program-graph-relationship-main">
                <strong title={relationship.source}>{truncateText(relationship.source, 44)}</strong>
                <em>{traceLabel(relationship.edgeKind)}</em>
                <strong title={relationship.target}>{truncateText(relationship.target, 44)}</strong>
              </span>
              <span className="program-graph-relationship-path" title={`${relationship.sourcePath} -> ${relationship.targetPath}`}>
                {truncateText(compactRelationshipPath(relationship), 72)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No connected relationships in this sample.</p>
      )}
    </div>
  );
}

function duplicateGraphLabelCounts(nodes: ProgramGraphVisualizationNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = node.label.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function graphNodeDisplayLabel(node: ProgramGraphVisualizationNode, duplicateLabelCounts: Map<string, number>): string {
  const label = node.label.trim() || traceLabel(node.entityType);
  const path = compactGraphPath(node.sourcePath);
  if ((duplicateLabelCounts.get(label.toLowerCase()) ?? 0) > 1 && path) return `${label} · ${path}`;
  return label;
}

function compactRelationshipPath(relationship: GraphRelationship): string {
  if (!relationship.sourcePath && !relationship.targetPath) return traceLabel(relationship.edgeKind);
  if (relationship.sourcePath && relationship.sourcePath === relationship.targetPath) return relationship.sourcePath;
  if (!relationship.targetPath) return relationship.sourcePath;
  if (!relationship.sourcePath) return relationship.targetPath;
  return `${relationship.sourcePath} -> ${relationship.targetPath}`;
}

function compactGraphPath(value: string | null): string {
  if (!value) return '';
  const segments = value.replace(/\\/g, '/').split('/').filter(Boolean);
  const repositoryIndex = segments.findIndex((segment) => segment.startsWith('github.com_'));
  const relevantSegments = repositoryIndex >= 0 ? segments.slice(repositoryIndex + 1) : segments;
  return relevantSegments.slice(-3).join('/');
}

function nodeSortPriority(node: ProgramGraphVisualizationNode): number {
  return familyPriority(node.entityType) * 1_000 - node.degree;
}

function familyPriority(family: string): number {
  const index = GRAPH_FAMILY_PRIORITY.indexOf(family);
  return index === -1 ? GRAPH_FAMILY_PRIORITY.length : index;
}

function nodeRadius(node: ProgramGraphVisualizationNode): number {
  return Math.min(26, 10 + Math.sqrt(Math.max(1, node.degree)) * 2.5);
}

function nodeColor(entityType: string): string {
  switch (entityType) {
    case 'scope_version':
      return '#9bbcff';
    case 'scope_asset':
      return '#65c3a5';
    case 'run':
      return '#8fd1ff';
    case 'hypothesis':
      return '#e5c789';
    case 'finding':
      return '#f2877e';
    case 'evidence':
      return '#9fe0bd';
    case 'verifier_run':
    case 'verifier_contract':
      return '#d0d0d0';
    case 'artifact':
      return '#b7a8ff';
    case 'structure_entity':
      return '#f0b36d';
    case 'inventory_item':
      return '#78b7d6';
    case 'weakness':
      return '#ef9fd0';
    default:
      return '#c7c7c7';
  }
}

function hashJitter(value: string, scale: number): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return ((hash % 1000) / 1000 - 0.5) * scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function SummaryTile({ detail, icon, label, value }: { detail: string; icon: ReactNode; label: string; value: string }): JSX.Element {
  return (
    <div className="program-understanding-summary-tile">
      <span className="program-understanding-summary-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="program-understanding-summary-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function SectionHeader({ icon, status, title }: { icon: ReactNode; status?: string; title: string }): JSX.Element {
  return (
    <div className="program-understanding-section-header">
      <span className="program-understanding-section-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      {status ? <StatusPill value={status} /> : null}
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="program-understanding-metric-cell">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CountList({ counts, title }: { counts: Record<string, number> | null | undefined; title: string }): JSX.Element {
  const entries = topCountEntries(counts, 6);
  return (
    <div className="program-understanding-count-list">
      <h4>{title}</h4>
      {entries.length > 0 ? (
        <ul>
          {entries.map(([label, count]) => (
            <li key={label}>
              <span>{traceLabel(label)}</span>
              <strong>{formatCount(count)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>No records yet.</p>
      )}
    </div>
  );
}

function GraphFreshness({ graph }: { graph: ProjectGraphSummary | null }): JSX.Element {
  const staleReasons = graph?.staleReasons ?? [];
  return (
    <div className="program-understanding-freshness">
      <Route size={15} aria-hidden="true" />
      <span>
        Indexed {formatNullableDate(graph?.indexedAt)}
        {graph?.rebuildReason ? ` from ${traceLabel(graph.rebuildReason)}` : ''}
      </span>
      {staleReasons.length > 0 ? (
        <div className="program-understanding-stale-reasons">
          {staleReasons.slice(0, 4).map((reason) => (
            <span key={reason}>{traceLabel(reason)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KeyValueRows({ rows }: { rows: Array<[string, string]> }): JSX.Element {
  return (
    <dl className="program-understanding-key-values">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RepositoryList({ assets, total }: { assets: ScopeAsset[]; total: number }): JSX.Element {
  return (
    <div className="program-understanding-repositories">
      <h4>Repositories</h4>
      {assets.length > 0 ? (
        <ul>
          {assets.map((asset) => (
            <li key={asset.id}>
              <span title={asset.value}>{truncateText(asset.value, 72)}</span>
              <small>{traceLabel(asset.sensitivity || 'normal')}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No in-scope repositories recorded.</p>
      )}
      {total > assets.length ? <small>{formatCount(total - assets.length)} more hidden</small> : null}
    </div>
  );
}

function StatusPill({ label, value }: { label?: string; value: string }): JSX.Element {
  return (
    <span className={`program-understanding-status status-${stateClass(value)}`} title={label ? `${label}: ${traceLabel(value)}` : traceLabel(value)}>
      {label ? `${label}: ` : ''}
      {traceLabel(value)}
    </span>
  );
}

function topCountEntries(counts: Record<string, number> | null | undefined, limit: number): Array<[string, number]> {
  return Object.entries(counts ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function assetKindCounts(assets: ScopeAsset[]): Record<string, number> {
  return assets.reduce<Record<string, number>>((counts, asset) => {
    counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function semanticProgressLabel(semantic: ProjectSemanticSummary | null): string {
  if (!semantic) return 'None';
  if (semantic.progressProcessed !== null && semantic.progressTotal !== null) {
    return `${formatCount(semantic.progressProcessed)} / ${formatCount(semantic.progressTotal)}`;
  }
  if (semantic.queuedAt && semantic.status === 'queued') return `Queued ${formatNullableDate(semantic.queuedAt)}`;
  if (semantic.startedAt && semantic.status === 'indexing') return `Started ${formatNullableDate(semantic.startedAt)}`;
  if (semantic.finishedAt) return `Finished ${formatNullableDate(semantic.finishedAt)}`;
  return traceLabel(semantic.status);
}

function formatNullableDate(value: string | null | undefined): string {
  return value ? formatSessionDateTime(value) : 'Never';
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatBytes(value: number): string {
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let next = value;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  const digits = next >= 10 || unitIndex === 0 ? 0 : 1;
  return `${next.toFixed(digits)} ${units[unitIndex]}`;
}
