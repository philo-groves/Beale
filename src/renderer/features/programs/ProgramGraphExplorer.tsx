import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { Network } from 'lucide-react';
import type { ProgramGraphProjection, ProgramScopeVersion, ProjectGraphSummary } from '@shared/types';
import { userFacingErrorMessage } from '../../lib/errors';
import { formatSessionDateTime, stateClass, traceLabel, truncateText } from '../../lib/formatting';
import type {
  ProgramGraphLayoutNode,
  ProgramGraphLayoutResult,
  ProgramGraphLayoutWorkerResponse
} from './programGraphLayout';

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

interface ViewSize {
  width: number;
  height: number;
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 4.5;
const GRAPH_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function ProgramGraphExplorer({ graph, scope }: { graph: ProjectGraphSummary | null; scope: ProgramScopeVersion | null }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [projection, setProjection] = useState<ProgramGraphProjection | null>(null);
  const [layout, setLayout] = useState<ProgramGraphLayoutResult | null>(null);
  const [viewSize, setViewSize] = useState<ViewSize>({ width: 0, height: 0 });
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, k: 0.2 });
  const [loading, setLoading] = useState(false);
  const [layouting, setLayouting] = useState(false);
  const [layoutPhase, setLayoutPhase] = useState<'idle' | 'preview' | 'complete'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [enabledEdgeKinds, setEnabledEdgeKinds] = useState<string[]>([]);
  const [focusedSourceGroup, setFocusedSourceGroup] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      setViewSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setProjection(null);
    setLayout(null);
    setLayoutPhase('idle');
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setError(null);
    setSearchQuery('');
    setFocusedSourceGroup(null);
  }, [scope?.id]);

  const edgeKindEntries = useMemo(() => topCountEntries(projection?.diagnostics.edgeFamilyCounts, 100), [projection]);
  const sourceGroupEntries = useMemo(() => topCountEntries(projection?.diagnostics.sourceGroupCounts, 12), [projection]);

  useEffect(() => {
    setEnabledEdgeKinds(edgeKindEntries.map(([kind]) => kind));
  }, [edgeKindEntries, projection?.generatedAt, projection?.scopeVersionId]);

  useEffect(() => {
    if (!scope) return undefined;
    let canceled = false;
    setLoading(true);
    setError(null);
    window.beale
      .getProgramGraphProjection()
      .then((next) => {
        if (canceled) return;
        setProjection(next);
      })
      .catch((nextError: unknown) => {
        if (canceled) return;
        setError(userFacingErrorMessage(nextError));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [graph?.edgeCount, graph?.indexedAt, graph?.nodeCount, scope?.id]);

  useEffect(() => {
    if (!projection || projection.nodes.length === 0) {
      setLayout(null);
      return undefined;
    }
    const worker = new Worker(new URL('./programGraphLayout.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current?.terminate();
    workerRef.current = worker;
    setLayouting(true);
    setLayoutPhase('preview');
    setError(null);
    const world = graphWorldSize(projection);
    setLayout(buildGraphPreviewLayout(projection, world.width, world.height));
    worker.onmessage = (event: MessageEvent<ProgramGraphLayoutWorkerResponse>): void => {
      if (event.data.type === 'layout:preview') {
        setLayout(event.data.layout);
        setLayoutPhase('preview');
        setLayouting(true);
      } else if (event.data.type === 'layout:complete') {
        setLayout(event.data.layout);
        setLayoutPhase('complete');
        setLayouting(false);
      } else {
        setError(event.data.message);
        setLayouting(false);
      }
    };
    worker.onerror = (event): void => {
      setError(event.message || 'Graph layout worker failed.');
      setLayouting(false);
    };
    worker.postMessage({ type: 'layout', projection, width: world.width, height: world.height });
    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [projection]);

  useEffect(() => {
    if (!layout || viewSize.width <= 1 || viewSize.height <= 1) return;
    const scale = Math.max(MIN_ZOOM, Math.min(0.85, Math.min(viewSize.width / layout.width, viewSize.height / layout.height) * 0.94));
    setTransform({
      k: scale,
      x: (viewSize.width - layout.width * scale) / 2,
      y: (viewSize.height - layout.height * scale) / 2
    });
  }, [layout?.generatedAt, layout?.height, layout?.width, viewSize.height, viewSize.width]);

  const nodesById = useMemo(() => new Map((layout?.nodes ?? []).map((node) => [node.id, node])), [layout]);
  const focusedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : hoveredNodeId ? nodesById.get(hoveredNodeId) ?? null : null;
  const selectedOrHoveredId = focusedNode?.id ?? null;
  const enabledEdgeKindSet = useMemo(() => new Set(enabledEdgeKinds), [enabledEdgeKinds]);
  const fallbackLayout = useMemo(() => {
    if (layout || !projection || projection.nodes.length === 0) return null;
    const world = graphWorldSize(projection);
    return buildGraphPreviewLayout(projection, world.width, world.height);
  }, [layout, projection]);
  const displayLayout = layout ?? fallbackLayout;
  const searchMatches = useMemo(() => {
    const normalized = normalizeSearch(searchQuery);
    if (!displayLayout || !normalized) return [];
    return displayLayout.nodes
      .filter((node) => nodeMatchesSearch(node, normalized))
      .sort((left, right) => right.degree - left.degree || left.displayLabel.localeCompare(right.displayLabel))
      .slice(0, 8);
  }, [displayLayout, searchQuery]);
  const visibleResolvedEdgeCount = useMemo(() => {
    if (!projection) return 0;
    return projection.edges.filter((edge) => edge.targetNodeId && enabledEdgeKindSet.has(edge.edgeKind)).length;
  }, [enabledEdgeKindSet, projection]);

  useEffect(() => {
    drawGraph(canvasRef.current, viewSize, displayLayout, nodesById, transform, selectedOrHoveredId, {
      enabledEdgeKinds: enabledEdgeKindSet,
      sourceGroup: focusedSourceGroup,
      searchQuery
    });
  }, [displayLayout, enabledEdgeKindSet, focusedSourceGroup, nodesById, searchQuery, selectedOrHoveredId, transform, viewSize]);

  const nodeAtClientPoint = useCallback(
    (clientX: number, clientY: number): ProgramGraphLayoutNode | null => {
      const canvas = canvasRef.current;
      if (!canvas || !layout) return null;
      const rect = canvas.getBoundingClientRect();
      const point = screenToWorld(clientX - rect.left, clientY - rect.top, transform);
      return nearestNode(layout.nodes, point.x, point.y, Math.max(14 / transform.k, 5));
    },
    [layout, transform]
  );

  const updateHover = useCallback(
    (clientX: number, clientY: number): void => {
      setHoveredNodeId(nodeAtClientPoint(clientX, clientY)?.id ?? null);
    },
    [nodeAtClientPoint]
  );

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: false };
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        drag.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
        setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
        return;
      }
      updateHover(event.clientX, event.clientY);
    },
    [updateHover]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      const drag = dragRef.current;
      if (drag?.pointerId === event.pointerId) {
        dragRef.current = null;
        if (!drag.moved) {
          const clickedNodeId = nodeAtClientPoint(event.clientX, event.clientY)?.id ?? null;
          setHoveredNodeId(clickedNodeId);
          setSelectedNodeId((current) => (current === clickedNodeId ? null : clickedNodeId));
        }
      }
    },
    [nodeAtClientPoint]
  );

  const handlePointerLeave = useCallback((): void => {
    if (!dragRef.current) setHoveredNodeId(null);
  }, []);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>): void => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      setTransform((current) => {
        const scaleFactor = Math.exp(-event.deltaY * 0.001);
        const nextK = clamp(current.k * scaleFactor, MIN_ZOOM, MAX_ZOOM);
        const world = screenToWorld(pointerX, pointerY, current);
        return { k: nextK, x: pointerX - world.x * nextK, y: pointerY - world.y * nextK };
      });
    },
    []
  );

  const focusNode = useCallback(
    (nodeId: string): void => {
      const node = nodesById.get(nodeId);
      if (!node) return;
      setSelectedNodeId(nodeId);
      setHoveredNodeId(nodeId);
      setTransform((current) => ({
        ...current,
        x: viewSize.width / 2 - node.x * current.k,
        y: viewSize.height / 2 - node.y * current.k
      }));
    },
    [nodesById, viewSize.height, viewSize.width]
  );

  const toggleEdgeKind = useCallback((kind: string): void => {
    setEnabledEdgeKinds((current) => (current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]));
  }, []);

  const showAllEdgeKinds = useCallback((): void => {
    setEnabledEdgeKinds(edgeKindEntries.map(([kind]) => kind));
  }, [edgeKindEntries]);

  if (loading && !projection) {
    return (
      <div className="program-graph-loading" role="status">
        Loading graph...
      </div>
    );
  }

  if (error && !projection) {
    return <p className="program-understanding-warning">{error}</p>;
  }

  if (!projection || projection.nodes.length === 0) {
    return (
      <div className="program-graph-empty">
        <Network size={22} />
        <strong>No graph records yet.</strong>
      </div>
    );
  }

  return (
    <div className="program-graph-visualization-view">
      <div className="program-graph-canvas" ref={containerRef} aria-label="Relationship graph visualization">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onWheel={handleWheel}
        />
        {displayLayout ? <GraphStaticOverview enabledEdgeKinds={enabledEdgeKindSet} focusedNodeId={selectedOrHoveredId} layout={displayLayout} searchQuery={searchQuery} sourceGroup={focusedSourceGroup} /> : null}
        {displayLayout && (selectedOrHoveredId || searchQuery.trim() || focusedSourceGroup) ? (
          <GraphDomOverlay
            enabledEdgeKinds={enabledEdgeKindSet}
            focusedNodeId={selectedOrHoveredId}
            layout={displayLayout}
            searchQuery={searchQuery}
            sourceGroup={focusedSourceGroup}
            transform={transform}
            viewSize={viewSize}
          />
        ) : null}
        {layouting ? <div className="program-graph-canvas-status">{layoutPhase === 'preview' ? 'Refining layout...' : 'Layout running...'}</div> : null}
      </div>
      <aside className="program-graph-side" aria-label="Graph diagnostics">
        <div className="program-graph-side-heading">
          <strong>{`${formatCount(projection.diagnostics.nodeCount)} nodes`}</strong>
          <span>{`${formatCount(visibleResolvedEdgeCount)} visible edges`}</span>
        </div>
        <GraphSearchControls
          matches={searchMatches}
          query={searchQuery}
          onFocusNode={focusNode}
          onQueryChange={setSearchQuery}
        />
        <KeyValueRows
          rows={[
            ['Status', traceLabel(projection.status)],
            ['Resolved Edges', formatCount(projection.diagnostics.resolvedEdgeCount)],
            ['Unresolved Edges', formatCount(projection.diagnostics.unresolvedEdgeCount)],
            ['Self Edges', formatCount(projection.diagnostics.selfEdgeCount)],
            ['Indexed', formatNullableDate(graph?.indexedAt)]
          ]}
        />
        {focusedNode ? <FocusedNode node={focusedNode} /> : null}
        <SourceGroupFocus
          entries={sourceGroupEntries}
          focusedSourceGroup={focusedSourceGroup}
          onFocus={setFocusedSourceGroup}
        />
        <RelationshipFamilyFilters
          enabledKinds={enabledEdgeKindSet}
          entries={edgeKindEntries}
          onShowAll={showAllEdgeKinds}
          onToggle={toggleEdgeKind}
        />
        <CountList title="Graph Quality" counts={projection.diagnostics.qualityFlagCounts} limit={8} />
        <CountList title="Repeated Labels" counts={projection.diagnostics.repeatedLabelCounts} limit={8} />
        {displayLayout ? <p className="program-graph-note">{`Layout ${formatCount(displayLayout.nodes.length)} nodes in ${formatCount(displayLayout.durationMs)} ms.`}</p> : null}
        {loading ? <p className="program-graph-note">Refreshing graph...</p> : null}
        {error ? <p className="program-understanding-warning">{error}</p> : null}
      </aside>
    </div>
  );
}

function drawGraph(
  canvas: HTMLCanvasElement | null,
  viewSize: ViewSize,
  layout: ProgramGraphLayoutResult | null,
  nodesById: Map<string, ProgramGraphLayoutNode>,
  transform: ViewTransform,
  focusedNodeId: string | null,
  filters: { enabledEdgeKinds: Set<string>; searchQuery: string; sourceGroup: string | null }
): void {
  if (!canvas || viewSize.width <= 1 || viewSize.height <= 1) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(viewSize.width * ratio));
  const height = Math.max(1, Math.floor(viewSize.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.style.width = `${viewSize.width}px`;
  canvas.style.height = `${viewSize.height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, viewSize.width, viewSize.height);
  if (!layout) return;
  const worldBounds = visibleWorldBounds(viewSize, transform);
  const normalizedSearch = normalizeSearch(filters.searchQuery);
  const matchedNodeIds = normalizedSearch ? new Set(layout.nodes.filter((node) => nodeMatchesSearch(node, normalizedSearch)).map((node) => node.id)) : null;
  const sourceGroupNodeIds = filters.sourceGroup ? new Set(layout.nodes.filter((node) => node.sourceGroupLabel === filters.sourceGroup).map((node) => node.id)) : null;
  const seedNodeIds = matchedNodeIds || sourceGroupNodeIds ? new Set<string>() : null;
  if (seedNodeIds) {
    for (const node of layout.nodes) {
      if (matchedNodeIds && !matchedNodeIds.has(node.id)) continue;
      if (sourceGroupNodeIds && !sourceGroupNodeIds.has(node.id)) continue;
      seedNodeIds.add(node.id);
    }
  }
  const visibleNodeIds = seedNodeIds ? new Set(seedNodeIds) : null;
  if (seedNodeIds) {
    for (const edge of layout.edges) {
      if (!filters.enabledEdgeKinds.has(edge.edgeKind)) continue;
      if (seedNodeIds.has(edge.sourceNodeId) || seedNodeIds.has(edge.targetNodeId)) {
        visibleNodeIds?.add(edge.sourceNodeId);
        visibleNodeIds?.add(edge.targetNodeId);
      }
    }
  }
  const focusedEdges = focusedNodeId
    ? new Set(
        layout.edges
          .filter((edge) => filters.enabledEdgeKinds.has(edge.edgeKind) && (edge.sourceNodeId === focusedNodeId || edge.targetNodeId === focusedNodeId))
          .map((edge) => edge.id)
      )
    : null;

  context.save();
  context.translate(transform.x, transform.y);
  context.scale(transform.k, transform.k);

  drawClusters(context, layout, worldBounds, transform.k, Boolean(seedNodeIds));
  drawEdges(context, layout, nodesById, worldBounds, transform.k, focusedEdges, filters.enabledEdgeKinds, seedNodeIds);
  drawNodes(context, layout, worldBounds, focusedNodeId, transform.k, visibleNodeIds, matchedNodeIds);
  drawLabels(context, layout, worldBounds, transform.k, focusedNodeId, visibleNodeIds, matchedNodeIds);

  context.restore();
}

function GraphDomOverlay({
  enabledEdgeKinds,
  focusedNodeId,
  layout,
  searchQuery,
  sourceGroup,
  transform,
  viewSize
}: {
  enabledEdgeKinds: Set<string>;
  focusedNodeId: string | null;
  layout: ProgramGraphLayoutResult;
  searchQuery: string;
  sourceGroup: string | null;
  transform: ViewTransform;
  viewSize: ViewSize;
}): JSX.Element {
  const normalizedSearch = normalizeSearch(searchQuery);
  const filterActive = Boolean(normalizedSearch || sourceGroup);
  const filteredNodes = filterActive
    ? layout.nodes.filter((node) => {
        if (sourceGroup && node.sourceGroupLabel !== sourceGroup) return false;
        if (normalizedSearch && !nodeMatchesSearch(node, normalizedSearch)) return false;
        return true;
      })
    : [];
  const visibleSeeds = new Set(filteredNodes.map((node) => node.id));
  const nodeIds = filterActive ? new Set(visibleSeeds) : null;
  if (nodeIds) {
    for (const edge of layout.edges) {
      if (!enabledEdgeKinds.has(edge.edgeKind)) continue;
      if (visibleSeeds.has(edge.sourceNodeId) || visibleSeeds.has(edge.targetNodeId)) {
        nodeIds.add(edge.sourceNodeId);
        nodeIds.add(edge.targetNodeId);
      }
    }
  }
  const projectedNodes = layout.nodes
    .filter((node) => !nodeIds || nodeIds.has(node.id))
    .map((node) => ({ node, x: node.x * transform.k + transform.x, y: node.y * transform.k + transform.y }))
    .filter((item) => item.x >= -40 && item.x <= viewSize.width + 40 && item.y >= -40 && item.y <= viewSize.height + 40)
    .sort((left, right) => Number(right.node.id === focusedNodeId) - Number(left.node.id === focusedNodeId) || right.node.degree - left.node.degree)
    .slice(0, filterActive ? 420 : 260);
  const projectedNodeIds = new Set(projectedNodes.map((item) => item.node.id));
  const projectedNodesById = new Map(projectedNodes.map((item) => [item.node.id, item]));
  const projectedEdges = layout.edges
    .filter((edge) => enabledEdgeKinds.has(edge.edgeKind) && projectedNodeIds.has(edge.sourceNodeId) && projectedNodeIds.has(edge.targetNodeId))
    .slice(0, filterActive ? 900 : 520);
  const clusters = filterActive
    ? []
    : layout.clusters
        .slice(0, 16)
        .map((cluster) => ({
          cluster,
          x: cluster.x * transform.k + transform.x,
          y: cluster.y * transform.k + transform.y,
          radius: Math.max(18, cluster.radius * transform.k)
        }))
        .filter((item) => item.x + item.radius >= 0 && item.x - item.radius <= viewSize.width && item.y + item.radius >= 0 && item.y - item.radius <= viewSize.height);

  return (
    <svg className="program-graph-dom-overlay" viewBox={`0 0 ${viewSize.width} ${viewSize.height}`} aria-hidden="true">
      <g>
        {clusters.map(({ cluster, radius, x, y }) => (
          <g key={cluster.id}>
            <circle cx={x} cy={y} r={radius} className="program-graph-overlay-cluster" />
            <text x={x} y={Math.max(15, y - radius - 8)} textAnchor="middle" className="program-graph-overlay-cluster-label">
              {truncateText(cluster.label, 30)}
            </text>
          </g>
        ))}
      </g>
      <g>
        {projectedEdges.map((edge) => {
          const source = projectedNodesById.get(edge.sourceNodeId);
          const target = projectedNodesById.get(edge.targetNodeId);
          if (!source || !target) return null;
          const focused = edge.sourceNodeId === focusedNodeId || edge.targetNodeId === focusedNodeId;
          return <line className={`program-graph-overlay-edge${focused ? ' focused' : ''}`} key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} />;
        })}
      </g>
      <g>
          {projectedNodes.map(({ node, x, y }, index) => {
            const focused = node.id === focusedNodeId;
          const matched = filterActive && visibleSeeds.has(node.id);
          const radius = Math.max(focused ? 5 : matched ? 4 : 2.7, node.radius * transform.k);
          return (
            <g key={node.id}>
              <circle className={`program-graph-overlay-node node-${stateClass(node.entityType)}${focused ? ' focused' : ''}${matched ? ' matched' : ''}`} cx={x} cy={y} r={radius} />
              {focused || matched || (filterActive && index < 28) ? (
                <text className="program-graph-overlay-label" x={x} y={y + radius + 11} textAnchor="middle">
                  {truncateText(node.displayLabel || node.label, focused ? 52 : 28)}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function GraphStaticOverview({
  enabledEdgeKinds,
  focusedNodeId,
  layout,
  searchQuery,
  sourceGroup
}: {
  enabledEdgeKinds: Set<string>;
  focusedNodeId: string | null;
  layout: ProgramGraphLayoutResult;
  searchQuery: string;
  sourceGroup: string | null;
}): JSX.Element {
  const normalizedSearch = normalizeSearch(searchQuery);
  const filterActive = Boolean(normalizedSearch || sourceGroup);
  if (!filterActive) {
    return <GraphClusterOverview enabledEdgeKinds={enabledEdgeKinds} layout={layout} />;
  }
  const seedNodes = layout.nodes.filter((node) => {
    if (sourceGroup && node.sourceGroupLabel !== sourceGroup) return false;
    if (normalizedSearch && !nodeMatchesSearch(node, normalizedSearch)) return false;
    return true;
  });
  const seedIds = new Set(seedNodes.map((node) => node.id));
  const visibleNodeIds = filterActive ? new Set(seedIds) : null;
  if (visibleNodeIds) {
    for (const edge of layout.edges) {
      if (!enabledEdgeKinds.has(edge.edgeKind)) continue;
      if (seedIds.has(edge.sourceNodeId) || seedIds.has(edge.targetNodeId)) {
        visibleNodeIds.add(edge.sourceNodeId);
        visibleNodeIds.add(edge.targetNodeId);
      }
    }
  }
  const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
  const displayedNodes = layout.nodes
    .filter((node) => !visibleNodeIds || visibleNodeIds.has(node.id))
    .sort((left, right) => Number(right.id === focusedNodeId) - Number(left.id === focusedNodeId) || right.degree - left.degree)
    .slice(0, filterActive ? 700 : 420);
  const displayedNodeIds = new Set(displayedNodes.map((node) => node.id));
  const displayedEdges = layout.edges
    .filter((edge) => enabledEdgeKinds.has(edge.edgeKind) && displayedNodeIds.has(edge.sourceNodeId) && displayedNodeIds.has(edge.targetNodeId))
    .slice(0, filterActive ? 1400 : 760);
  return (
    <svg className="program-graph-static-overview" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g>
        {displayedEdges.map((edge) => {
          const source = nodesById.get(edge.sourceNodeId);
          const target = nodesById.get(edge.targetNodeId);
          if (!source || !target) return null;
          const focused = edge.sourceNodeId === focusedNodeId || edge.targetNodeId === focusedNodeId;
          return <line className={`program-graph-static-edge${focused ? ' focused' : ''}`} key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} />;
        })}
      </g>
      <g>
        {displayedNodes.map((node, index) => {
          const focused = node.id === focusedNodeId;
          const matched = seedIds.has(node.id);
          const radius = focused ? 46 : matched ? 36 : Math.max(20, Math.min(34, node.radius * 2.2));
          return (
            <g key={node.id}>
              <circle className={`program-graph-static-node node-${stateClass(node.entityType)}${focused ? ' focused' : ''}${matched ? ' matched' : ''}`} cx={node.x} cy={node.y} r={radius} />
              {focused || matched || index < 22 ? (
                <text className="program-graph-static-label" x={node.x} y={node.y + radius + 78} textAnchor="middle">
                  {truncateText(node.displayLabel || node.label, focused ? 52 : 28)}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function GraphClusterOverview({ enabledEdgeKinds, layout }: { enabledEdgeKinds: Set<string>; layout: ProgramGraphLayoutResult }): JSX.Element {
  const clusters = layout.clusters.slice(0, 28);
  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
  const clustersById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const edgeBundles = new Map<string, { source: ProgramGraphLayoutResult['clusters'][number]; target: ProgramGraphLayoutResult['clusters'][number]; count: number }>();
  for (const edge of layout.edges) {
    if (!enabledEdgeKinds.has(edge.edgeKind)) continue;
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (!sourceNode || !targetNode) continue;
    if (!clusterIds.has(sourceNode.primaryClusterId) || !clusterIds.has(targetNode.primaryClusterId)) continue;
    if (sourceNode.primaryClusterId === targetNode.primaryClusterId) continue;
    const sourceId = sourceNode.primaryClusterId < targetNode.primaryClusterId ? sourceNode.primaryClusterId : targetNode.primaryClusterId;
    const targetId = sourceNode.primaryClusterId < targetNode.primaryClusterId ? targetNode.primaryClusterId : sourceNode.primaryClusterId;
    const source = clustersById.get(sourceId);
    const target = clustersById.get(targetId);
    if (!source || !target) continue;
    const key = `${sourceId}->${targetId}`;
    const existing = edgeBundles.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      edgeBundles.set(key, { source, target, count: 1 });
    }
  }
  const bundles = [...edgeBundles.values()].sort((left, right) => right.count - left.count).slice(0, 90);
  return (
    <svg className="program-graph-static-overview" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g>
        {bundles.map((bundle) => (
          <line
            className="program-graph-cluster-edge"
            key={`${bundle.source.id}:${bundle.target.id}`}
            x1={bundle.source.x}
            y1={bundle.source.y}
            x2={bundle.target.x}
            y2={bundle.target.y}
            style={{ strokeWidth: Math.min(22, 5 + Math.sqrt(bundle.count) * 2.2), opacity: Math.min(0.46, 0.18 + Math.sqrt(bundle.count) * 0.025) }}
          />
        ))}
      </g>
      <g>
        {clusters.map((cluster) => {
          const radius = Math.max(150, Math.min(390, 112 + Math.sqrt(cluster.nodeCount) * 9));
          return (
            <g key={cluster.id}>
              <circle className="program-graph-static-cluster" cx={cluster.x} cy={cluster.y} r={radius} />
              <text className="program-graph-static-cluster-label" x={cluster.x} y={cluster.y - 24} textAnchor="middle">
                {truncateText(cluster.label, 28)}
              </text>
              <text className="program-graph-static-cluster-count" x={cluster.x} y={cluster.y + 88} textAnchor="middle">
                {formatCount(cluster.nodeCount)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function drawClusters(context: CanvasRenderingContext2D, layout: ProgramGraphLayoutResult, bounds: ReturnType<typeof visibleWorldBounds>, zoom: number, searchActive: boolean): void {
  if (zoom > 1.2 || searchActive) return;
  context.save();
  for (const cluster of layout.clusters.slice(0, 36)) {
    if (cluster.x + cluster.radius < bounds.left || cluster.x - cluster.radius > bounds.right || cluster.y + cluster.radius < bounds.top || cluster.y - cluster.radius > bounds.bottom) continue;
    context.beginPath();
    context.arc(cluster.x, cluster.y, cluster.radius, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 255, 255, 0.036)';
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    context.lineWidth = 1.4 / zoom;
    context.stroke();
    context.fillStyle = 'rgba(232, 232, 232, 0.76)';
    context.font = `${Math.max(11 / zoom, 13)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(truncateText(cluster.label, 34), cluster.x, cluster.y - cluster.radius - 14 / zoom);
  }
  context.restore();
}

function drawEdges(
  context: CanvasRenderingContext2D,
  layout: ProgramGraphLayoutResult,
  nodesById: Map<string, ProgramGraphLayoutNode>,
  bounds: ReturnType<typeof visibleWorldBounds>,
  zoom: number,
  focusedEdges: Set<string> | null,
  enabledEdgeKinds: Set<string>,
  matchedNodeIds: Set<string> | null
): void {
  context.save();
  context.lineCap = 'round';
  for (const edge of layout.edges) {
    if (!enabledEdgeKinds.has(edge.edgeKind)) continue;
    if (matchedNodeIds && !matchedNodeIds.has(edge.sourceNodeId) && !matchedNodeIds.has(edge.targetNodeId)) continue;
    const source = nodesById.get(edge.sourceNodeId);
    const target = nodesById.get(edge.targetNodeId);
    if (!source || !target) continue;
    if (!segmentVisible(source.x, source.y, target.x, target.y, bounds)) continue;
    const focused = focusedEdges?.has(edge.id) ?? false;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.strokeStyle = edgeColor(edge.edgeKind, edge.qualityFlags, focused);
    context.globalAlpha = focused ? 0.92 : zoom < 0.35 ? 0.26 : 0.38;
    context.lineWidth = (focused ? 2.4 : 1.05) / zoom;
    context.stroke();
  }
  context.restore();
}

function drawNodes(
  context: CanvasRenderingContext2D,
  layout: ProgramGraphLayoutResult,
  bounds: ReturnType<typeof visibleWorldBounds>,
  focusedNodeId: string | null,
  zoom: number,
  visibleNodeIds: Set<string> | null,
  matchedNodeIds: Set<string> | null
): void {
  context.save();
  for (const node of layout.nodes) {
    if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
    if (node.x + node.radius < bounds.left || node.x - node.radius > bounds.right || node.y + node.radius < bounds.top || node.y - node.radius > bounds.bottom) continue;
    const focused = node.id === focusedNodeId;
    const matched = matchedNodeIds?.has(node.id) ?? false;
    const radius = Math.max(node.radius, (focused ? 4.2 : matched ? 3.4 : 2.3) / zoom);
    context.beginPath();
    context.arc(node.x, node.y, focused ? radius + 3 / zoom : radius, 0, Math.PI * 2);
    context.fillStyle = nodeColor(node.entityType, node.qualityFlags);
    context.fill();
    context.strokeStyle = focused ? '#ffffff' : matched ? '#f0d9a6' : 'rgba(255, 255, 255, 0.58)';
    context.lineWidth = (focused ? 2.4 : matched ? 2 : 1.1) / zoom;
    context.stroke();
  }
  context.restore();
}

function drawLabels(
  context: CanvasRenderingContext2D,
  layout: ProgramGraphLayoutResult,
  bounds: ReturnType<typeof visibleWorldBounds>,
  zoom: number,
  focusedNodeId: string | null,
  visibleNodeIds: Set<string> | null,
  matchedNodeIds: Set<string> | null
): void {
  const labelCandidates = layout.nodes
    .filter((node) => !visibleNodeIds || visibleNodeIds.has(node.id))
    .filter((node) => node.id === focusedNodeId || matchedNodeIds?.has(node.id) || node.degree >= labelDegreeThreshold(zoom) || (zoom > 1.45 && node.qualityFlags.includes('generic_label')))
    .filter((node) => node.x >= bounds.left && node.x <= bounds.right && node.y >= bounds.top && node.y <= bounds.bottom)
    .sort((left, right) => Number(right.id === focusedNodeId) - Number(left.id === focusedNodeId) || right.degree - left.degree)
    .slice(0, matchedNodeIds ? 120 : zoom > 1.4 ? 140 : 52);
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.font = `${Math.max(10 / zoom, 11)}px Inter, ui-sans-serif, system-ui, sans-serif`;
  context.lineJoin = 'round';
  for (const node of labelCandidates) {
    const text = truncateText(node.displayLabel || node.label, node.id === focusedNodeId ? 64 : 32);
    const y = node.y + node.radius + 4 / zoom;
    context.strokeStyle = '#101010';
    context.lineWidth = 4 / zoom;
    context.strokeText(text, node.x, y);
    context.fillStyle = matchedNodeIds?.has(node.id) ? '#f0d9a6' : node.qualityFlags.includes('generic_label') ? '#f0b36d' : '#e6e6e6';
    context.fillText(text, node.x, y);
  }
  context.restore();
}

function FocusedNode({ node }: { node: ProgramGraphLayoutNode }): JSX.Element {
  return (
    <div className="program-graph-focused-node">
      <span>{traceLabel(node.entityType)}</span>
      <strong title={node.displayLabel}>{truncateText(node.displayLabel, 62)}</strong>
      {node.pathLabel ? <small title={node.sourcePath ?? node.pathLabel}>{node.pathLabel}</small> : null}
      {node.qualityFlags.length > 0 ? (
        <div className="program-graph-quality-tags">
          {node.qualityFlags.slice(0, 4).map((flag) => (
            <em key={flag}>{traceLabel(flag)}</em>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GraphSearchControls({
  matches,
  onFocusNode,
  onQueryChange,
  query
}: {
  matches: ProgramGraphLayoutNode[];
  onFocusNode(nodeId: string): void;
  onQueryChange(query: string): void;
  query: string;
}): JSX.Element {
  const normalized = normalizeSearch(query);
  return (
    <div className="program-graph-controls">
      <input
        aria-label="Search graph"
        className="program-graph-search"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        placeholder="Search graph"
        type="search"
        value={query}
      />
      {normalized ? (
        <div className="program-graph-search-results">
          {matches.length > 0 ? (
            matches.map((node) => (
              <button key={node.id} type="button" onClick={() => onFocusNode(node.id)}>
                <span>{traceLabel(node.entityType)}</span>
                <strong title={node.displayLabel}>{truncateText(node.displayLabel, 48)}</strong>
                {node.pathLabel ? <small title={node.sourcePath ?? node.pathLabel}>{truncateText(node.pathLabel, 56)}</small> : null}
              </button>
            ))
          ) : (
            <p>No matches.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RelationshipFamilyFilters({
  enabledKinds,
  entries,
  onShowAll,
  onToggle
}: {
  enabledKinds: Set<string>;
  entries: Array<[string, number]>;
  onShowAll(): void;
  onToggle(kind: string): void;
}): JSX.Element {
  return (
    <div className="program-graph-edge-filters">
      <div className="program-graph-filter-heading">
        <h4>Relationship Families</h4>
        <button type="button" onClick={onShowAll}>
          All
        </button>
      </div>
      <ul>
        {entries.map(([kind, count]) => (
          <li key={kind}>
            <label>
              <input checked={enabledKinds.has(kind)} onChange={() => onToggle(kind)} type="checkbox" />
              <span>{traceLabel(kind)}</span>
              <strong>{formatCount(count)}</strong>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceGroupFocus({
  entries,
  focusedSourceGroup,
  onFocus
}: {
  entries: Array<[string, number]>;
  focusedSourceGroup: string | null;
  onFocus(sourceGroup: string | null): void;
}): JSX.Element {
  if (entries.length === 0) {
    return <CountList title="Source Groups" counts={{}} limit={8} />;
  }
  return (
    <div className="program-graph-source-focus">
      <div className="program-graph-filter-heading">
        <h4>Source Groups</h4>
        <button type="button" onClick={() => onFocus(null)}>
          All
        </button>
      </div>
      <div className="program-graph-source-buttons">
        {entries.map(([sourceGroup, count]) => (
          <button
            className={focusedSourceGroup === sourceGroup ? 'active' : ''}
            key={sourceGroup}
            type="button"
            onClick={() => onFocus(focusedSourceGroup === sourceGroup ? null : sourceGroup)}
          >
            <span title={sourceGroup}>{traceLabel(sourceGroup)}</span>
            <strong>{formatCount(count)}</strong>
          </button>
        ))}
      </div>
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

function CountList({ counts, limit, title }: { counts: Record<string, number> | null | undefined; limit: number; title: string }): JSX.Element {
  const entries = Object.entries(counts ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
  return (
    <div className="program-understanding-count-list">
      <h4>{title}</h4>
      {entries.length > 0 ? (
        <ul>
          {entries.map(([label, count]) => (
            <li key={label}>
              <span title={label}>{traceLabel(label)}</span>
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

function buildGraphPreviewLayout(projection: ProgramGraphProjection, width: number, height: number): ProgramGraphLayoutResult {
  const startedAt = Date.now();
  const nodeIds = new Set(projection.nodes.map((node) => node.id));
  const projectedClusters = new Map(projection.clusters.map((cluster) => [cluster.id, cluster]));
  const nodes: ProgramGraphLayoutNode[] = projection.nodes.map((node) => ({
    id: node.id,
    entityType: node.entityType,
    label: node.label,
    displayLabel: node.qualityFlags.includes('repeated_label') && node.pathLabel ? `${node.label} - ${node.pathLabel}` : node.label,
    sourcePath: node.sourcePath,
    pathLabel: node.pathLabel,
    repositoryLabel: node.repositoryLabel,
    sourceGroupLabel: node.sourceGroupLabel,
    degree: node.degree,
    radius: previewNodeRadius(node.degree, node.qualityFlags),
    clusterIds: node.clusterIds,
    qualityFlags: node.qualityFlags,
    primaryClusterId: primaryClusterForNode(node.clusterIds),
    x: 0,
    y: 0
  }));
  const edges = projection.edges
    .filter((edge) => edge.targetNodeId && edge.sourceNodeId !== edge.targetNodeId && nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
    .map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId ?? '',
      edgeKind: edge.edgeKind,
      qualityFlags: edge.qualityFlags
    }));
  const centers = previewClusterCenters(nodes, projectedClusters, width, height);
  spreadPreviewNodes(nodes, centers);
  return {
    width,
    height,
    nodes,
    edges,
    clusters: previewLayoutClusters(nodes, centers, projectedClusters),
    generatedAt: `preview:${projection.generatedAt}`,
    durationMs: Date.now() - startedAt
  };
}

function graphWorldSize(projection: ProgramGraphProjection): ViewSize {
  const nodeCount = Math.max(1, projection.nodes.length);
  const sourceGroups = Math.max(1, Object.keys(projection.diagnostics.sourceGroupCounts).length);
  const width = clamp(Math.sqrt(nodeCount) * 118 + sourceGroups * 18, 2200, 7600);
  const height = clamp(Math.sqrt(nodeCount) * 82 + sourceGroups * 12, 1500, 5200);
  return { width, height };
}

function topCountEntries(counts: Record<string, number> | null | undefined, limit: number): Array<[string, number]> {
  return Object.entries(counts ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
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

function previewClusterCenters(
  nodes: ProgramGraphLayoutNode[],
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

function spreadPreviewNodes(nodes: ProgramGraphLayoutNode[], centers: Map<string, { x: number; y: number }>): void {
  const groups = new Map<string, ProgramGraphLayoutNode[]>();
  for (const node of nodes) {
    const group = groups.get(node.primaryClusterId) ?? [];
    group.push(node);
    groups.set(node.primaryClusterId, group);
  }
  for (const [clusterId, group] of groups) {
    const center = centers.get(clusterId) ?? { x: 0, y: 0 };
    group
      .sort((left, right) => right.degree - left.degree || left.displayLabel.localeCompare(right.displayLabel))
      .forEach((node, index) => {
        if (index === 0) {
          node.x = center.x;
          node.y = center.y;
          return;
        }
        const angle = index * GRAPH_GOLDEN_ANGLE;
        const radius = 18 + Math.sqrt(index) * 10.5;
        node.x = center.x + Math.cos(angle) * radius;
        node.y = center.y + Math.sin(angle) * radius;
      });
  }
}

function previewLayoutClusters(
  nodes: ProgramGraphLayoutNode[],
  centers: Map<string, { x: number; y: number }>,
  projectedClusters: Map<string, ProgramGraphProjection['clusters'][number]>
): ProgramGraphLayoutResult['clusters'] {
  return [...centers.entries()]
    .map(([clusterId, center]) => {
      const clusterNodes = nodes.filter((node) => node.primaryClusterId === clusterId);
      const projected = projectedClusters.get(clusterId);
      const radius =
        clusterNodes.length === 0
          ? 70
          : Math.max(74, Math.max(...clusterNodes.map((node) => Math.hypot(node.x - center.x, node.y - center.y) + node.radius + 18)));
      return {
        id: clusterId,
        kind: projected?.kind ?? 'cluster',
        label: projected?.label ?? clusterId,
        nodeCount: projected?.nodeCount ?? clusterNodes.length,
        edgeCount: projected?.edgeCount ?? 0,
        qualityFlags: projected?.qualityFlags ?? [],
        x: center.x,
        y: center.y,
        radius
      };
    })
    .sort((left, right) => right.nodeCount - left.nodeCount || left.label.localeCompare(right.label));
}

function previewNodeRadius(degree: number, qualityFlags: string[]): number {
  const base = Math.min(15, 3.4 + Math.sqrt(Math.max(1, degree)) * 1.15);
  return qualityFlags.includes('generic_label') ? Math.max(4.2, base - 1.2) : base;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function nodeMatchesSearch(node: ProgramGraphLayoutNode, normalizedSearch: string): boolean {
  if (!normalizedSearch) return true;
  return [
    node.displayLabel,
    node.label,
    node.entityType,
    node.pathLabel,
    node.sourcePath,
    node.repositoryLabel,
    node.sourceGroupLabel,
    ...node.qualityFlags
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(normalizedSearch);
}

function screenToWorld(x: number, y: number, transform: ViewTransform): { x: number; y: number } {
  return { x: (x - transform.x) / transform.k, y: (y - transform.y) / transform.k };
}

function visibleWorldBounds(viewSize: ViewSize, transform: ViewTransform): { left: number; right: number; top: number; bottom: number } {
  const topLeft = screenToWorld(0, 0, transform);
  const bottomRight = screenToWorld(viewSize.width, viewSize.height, transform);
  const margin = 80 / transform.k;
  return {
    left: Math.min(topLeft.x, bottomRight.x) - margin,
    right: Math.max(topLeft.x, bottomRight.x) + margin,
    top: Math.min(topLeft.y, bottomRight.y) - margin,
    bottom: Math.max(topLeft.y, bottomRight.y) + margin
  };
}

function nearestNode(nodes: ProgramGraphLayoutNode[], x: number, y: number, maxDistance: number): ProgramGraphLayoutNode | null {
  let nearest: ProgramGraphLayoutNode | null = null;
  let nearestDistance = maxDistance;
  for (const node of nodes) {
    const distance = Math.hypot(node.x - x, node.y - y) - node.radius;
    if (distance <= nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function segmentVisible(sourceX: number, sourceY: number, targetX: number, targetY: number, bounds: ReturnType<typeof visibleWorldBounds>): boolean {
  const left = Math.min(sourceX, targetX);
  const right = Math.max(sourceX, targetX);
  const top = Math.min(sourceY, targetY);
  const bottom = Math.max(sourceY, targetY);
  return right >= bounds.left && left <= bounds.right && bottom >= bounds.top && top <= bounds.bottom;
}

function nodeColor(entityType: string, qualityFlags: string[]): string {
  if (qualityFlags.includes('generic_label')) return '#d99a58';
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

function edgeColor(edgeKind: string, qualityFlags: string[], focused: boolean): string {
  if (qualityFlags.includes('unresolved_target') || qualityFlags.includes('self_relation')) return focused ? '#f2c78b' : '#9a7445';
  switch (edgeKind) {
    case 'routes_to':
    case 'handles_with':
    case 'uses_middleware':
      return focused ? '#b7e4ff' : '#8fd1ff';
    case 'checks_permission':
    case 'reaches_sink':
    case 'references_permission':
      return focused ? '#f0d9a6' : '#d6b76f';
    case 'supports_hypothesis':
    case 'verifies_finding':
    case 'evidence_for':
      return focused ? '#bcf0cf' : '#8fd7ae';
    default:
      return focused ? '#dddddd' : '#7c7c7c';
  }
}

function labelDegreeThreshold(zoom: number): number {
  if (zoom > 2.4) return 8;
  if (zoom > 1.45) return 16;
  if (zoom > 0.85) return 34;
  return 70;
}

function formatNullableDate(value: string | null | undefined): string {
  return value ? formatSessionDateTime(value) : 'Never';
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
