import { memo, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ChevronDown, Database, GitFork, Search } from 'lucide-react';
import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary, HoneycrispMemorySummary } from '@shared/types';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatSessionDateTime, stateClass, traceLabel } from '../../lib/formatting';
import { filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogUpdateKey } from '../../view-models/memoryCatalog';
import { formatRelativeActivity, subagentSummaries } from '../../view-models/subagents';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';

type MemoryScopeFilter = 'all' | 'session' | 'workspace' | 'subject';
type ResearchSideView = 'memory' | 'subagents';

export const ResearchSidePanel = memo(function ResearchSidePanel({
  events,
  memory,
  runId,
  selectedSubagentPath,
  onSelectSubagent
}: {
  events: TraceDisplayEvent[];
  memory: HoneycrispMemorySummary | null;
  runId: string;
  selectedSubagentPath: string | null;
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  const [activeView, setActiveView] = useState<ResearchSideView>('memory');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<MemoryScopeFilter>('all');
  const [type, setType] = useState('all');
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const nodes = memory?.nodes ?? [];
  const currentSessionNode = nodes.find((node) => node.sessionId === runId);
  const workspaceId = currentSessionNode?.workspaceId ?? nodes[0]?.workspaceId ?? null;
  const subjectId = currentSessionNode?.subjectId ?? nodes.find((node) => node.workspaceId === workspaceId && node.subjectId)?.subjectId ?? null;
  const subagents = useMemo(() => subagentSummaries(events), [events]);
  const nodeTypes = useMemo(() => [...new Set(nodes.map((node) => node.type))].sort(), [nodes]);
  const filteredNodes = useMemo(
    () => filterMemoryCatalogNodes(nodes, { query, scope, sessionId: runId, workspaceId, subjectId, type }),
    [nodes, query, runId, scope, subjectId, type, workspaceId]
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const relationshipsByNodeId = useMemo(() => groupMemoryRelationships(memory?.edges ?? []), [memory?.edges]);
  const updateKey = memoryCatalogUpdateKey(filteredNodes);

  useEffect(() => {
    setActiveView('memory');
  }, [runId]);

  useEffect(() => {
    if (activeView !== 'subagents') return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [activeView]);

  useDevRenderProbe('research.memory', () => ({
    loaded: Boolean(memory),
    nodes: nodes.length,
    visibleNodes: filteredNodes.length,
    scope,
    type
  }));

  return (
    <aside className={`main-session-side memory-catalog view-${activeView}`} aria-label="Session details">
      <header className="research-side-tabs" role="tablist" aria-label="Session details">
        <button
          type="button"
          className={activeView === 'memory' ? 'active' : ''}
          role="tab"
          aria-selected={activeView === 'memory'}
          onClick={() => setActiveView('memory')}
        >
          <Database size={15} />
          <span>Memory</span>
          <strong>{filteredNodes.length === nodes.length ? nodes.length : `${filteredNodes.length}/${nodes.length}`}</strong>
        </button>
        <button
          type="button"
          className={activeView === 'subagents' ? 'active' : ''}
          role="tab"
          aria-selected={activeView === 'subagents'}
          onClick={() => setActiveView('subagents')}
        >
          <GitFork size={15} />
          <span>Subagents</span>
          <strong>{subagents.length}</strong>
        </button>
      </header>

      {activeView === 'memory' ? (
        <>
          <div className="memory-catalog-controls">
            <label className="memory-catalog-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="Search memory"
                aria-label="Search memory"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="memory-catalog-filter-row">
              <div className="memory-tier-filter" aria-label="Memory context filter">
                {(['all', 'session', 'workspace', 'subject'] as const).map((candidate) => (
                  <button
                    type="button"
                    className={scope === candidate ? 'selected' : ''}
                    aria-pressed={scope === candidate}
                    key={candidate}
                    onClick={() => setScope(candidate)}
                  >
                    {traceLabel(candidate)}
                  </button>
                ))}
              </div>
              <label className="memory-type-filter">
                <span>Type</span>
                <select value={type} aria-label="Memory type filter" onChange={(event) => setType(event.target.value)}>
                  <option value="all">All types</option>
                  {nodeTypes.map((nodeType) => (
                    <option value={nodeType} key={nodeType}>{traceLabel(nodeType)}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {!memory ? <div className="memory-catalog-empty">Loading memory.</div> : null}
          {memory?.lastError ? <div className="memory-catalog-empty is-error">{memory.lastError}</div> : null}
          {memory && !memory.lastError && nodes.length === 0 ? <div className="memory-catalog-empty">No memory records yet.</div> : null}
          {memory && nodes.length > 0 && filteredNodes.length === 0 ? <div className="memory-catalog-empty">No records match these filters.</div> : null}
          {filteredNodes.length > 0 ? (
            <MainSideScrollRegion listClassName="memory-catalog-list" updateKey={updateKey}>
              {filteredNodes.map((node) => (
                <MemoryCatalogItem
                  expanded={expandedNodeId === node.id}
                  key={node.id}
                  node={node}
                  nodeById={nodeById}
                  relationships={relationshipsByNodeId.get(node.id) ?? []}
                  onToggle={() => setExpandedNodeId((current) => current === node.id ? null : node.id)}
                />
              ))}
            </MainSideScrollRegion>
          ) : null}
        </>
      ) : subagents.length > 0 ? (
        <MainSideScrollRegion listClassName="subagent-catalog-list" updateKey={subagents.map((agent) => `${agent.path}:${agent.lastActiveAt}:${agent.latestMessage}`).join('|')}>
          {subagents.map((agent) => (
            <button
              type="button"
              className={`subagent-catalog-item ${selectedSubagentPath === agent.path ? 'selected' : ''}`}
              aria-pressed={selectedSubagentPath === agent.path}
              key={agent.path}
              onClick={() => onSelectSubagent(agent.path)}
            >
              <span className="subagent-catalog-heading">
                <strong>{agent.name}</strong>
                <time dateTime={agent.lastActiveAt} title={formatSessionDateTime(agent.lastActiveAt)}>{formatRelativeActivity(agent.lastActiveAt, nowMs)}</time>
              </span>
              <span className="subagent-catalog-preview">{agent.latestMessage || 'No message yet.'}</span>
              <span className={`subagent-catalog-status status-${stateClass(agent.status)}`}>{traceLabel(agent.status)}</span>
            </button>
          ))}
        </MainSideScrollRegion>
      ) : (
        <div className="memory-catalog-empty">No subagents in this session.</div>
      )}
    </aside>
  );
});

function MemoryCatalogItem({
  expanded,
  node,
  nodeById,
  relationships,
  onToggle
}: {
  expanded: boolean;
  node: HoneycrispMemoryNodeSummary;
  nodeById: Map<string, HoneycrispMemoryNodeSummary>;
  relationships: HoneycrispMemoryEdgeSummary[];
  onToggle: () => void;
}): JSX.Element {
  const contentId = `memory-record-${node.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return (
    <article className={`memory-catalog-item type-${stateClass(node.type)} ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="memory-catalog-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={onToggle}>
        <span className="memory-catalog-item-heading">
          <span className="memory-catalog-item-meta-line">
            <span className="memory-catalog-type">{traceLabel(node.type)}</span>
            <span className="memory-catalog-item-trailing">
              <span>{traceLabel(node.status)} · {formatConfidence(node.confidence)}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </span>
          <strong>{node.title}</strong>
        </span>
      </button>
      <div id={contentId} className="memory-catalog-content" hidden={!expanded}>
        {node.summary ? <p className="memory-catalog-summary">{node.summary}</p> : null}
        {node.body && node.body !== node.summary ? <p className="memory-catalog-body">{node.body}</p> : null}
        <div className="memory-catalog-meta">
          <span>{traceLabel(node.tier)}</span>
          <span>rev {node.revision}</span>
          <span>{node.evidenceRefs.length} refs</span>
          <span>{relationships.length} links</span>
          <time dateTime={node.updatedAt}>{formatSessionDateTime(node.updatedAt)}</time>
        </div>
        {node.subjectName || node.workspaceName ? (
          <dl className="memory-catalog-scope">
            {node.subjectName ? <div><dt>Subject</dt><dd>{node.subjectName}</dd></div> : null}
            <div><dt>Workspace</dt><dd>{node.workspaceName}</dd></div>
            {node.sessionId ? <div><dt>Session</dt><dd>{node.sessionId}</dd></div> : null}
          </dl>
        ) : null}
        {node.assetIds.length > 0 ? <ChipGroup label="Assets" values={node.assetIds} /> : null}
        {node.tags.length > 0 ? <ChipGroup label="Tags" values={node.tags} /> : null}
        {node.evidenceRefs.length > 0 ? (
          <section className="memory-catalog-subsection" aria-label="References">
            <h4>References</h4>
            <div className="memory-reference-list">
              {node.evidenceRefs.map((reference) => (
                <article key={reference.id}>
                  <span>{traceLabel(reference.kind)}</span>
                  <strong>{reference.summary || reference.path || reference.id}</strong>
                  {reference.path ? <code>{reference.path}</code> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {relationships.length > 0 ? (
          <section className="memory-catalog-subsection" aria-label="Relationships">
            <h4>Relationships</h4>
            <div className="memory-relationship-list">
              {relationships.map((relationship) => {
                const outbound = relationship.fromId === node.id;
                const relatedId = outbound ? relationship.toId : relationship.fromId;
                const relatedNode = nodeById.get(relatedId);
                return (
                  <article key={`${relationship.fromId}:${relationship.relation}:${relationship.toId}`}>
                    <span>{outbound ? '→' : '←'} {traceLabel(relationship.relation)}</span>
                    <strong>{relatedNode?.title ?? relatedId}</strong>
                    {relationship.note ? <p>{relationship.note}</p> : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}

function ChipGroup({ label, values }: { label: string; values: string[] }): JSX.Element {
  return (
    <div className="memory-chip-group">
      <span>{label}</span>
      <div>{values.map((value) => <span key={value}>{value}</span>)}</div>
    </div>
  );
}

function formatConfidence(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}
