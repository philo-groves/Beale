import { memo, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { BookOpen, Database, GitFork, Search } from 'lucide-react';
import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary, HoneycrispMemorySummary, HoneycrispRunbookSummary, RunStatus } from '@shared/types';
import { BottomSheet } from '../../app/Modal';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatSessionDateTime, stateClass, traceLabel } from '../../lib/formatting';
import { activeMemoryCount, filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogUpdateKey, researchSideTabLabel } from '../../view-models/memoryCatalog';
import { activeSubagentCount, subagentStatusLabel, subagentSummaries, visibleSubagentSummaries } from '../../view-models/subagents';
import { runbookDescriptionText } from '../../view-models/runbooks';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';

type MemoryLevelFilter = 'session' | 'workspace' | 'subject';
type ResearchSideView = 'memory' | 'runbooks' | 'subagents';

export const ResearchSidePanel = memo(function ResearchSidePanel({
  events,
  memory,
  runId,
  runStatus,
  selectedSubagentPath,
  selectedRunbookId,
  onOpenRunbook,
  onSelectSubagent
}: {
  events: TraceDisplayEvent[];
  memory: HoneycrispMemorySummary | null;
  runId: string;
  runStatus: RunStatus | null;
  selectedSubagentPath: string | null;
  selectedRunbookId: string | null;
  onOpenRunbook: (runbookId: string) => void;
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  const [activeView, setActiveView] = useState<ResearchSideView>('memory');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<MemoryLevelFilter>('session');
  const [type, setType] = useState('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showInactiveSubagents, setShowInactiveSubagents] = useState(false);
  const nodes = memory?.nodes ?? [];
  const activeMemories = useMemo(() => activeMemoryCount(nodes), [nodes]);
  const runbooks = memory?.runbooks ?? [];
  const activeRunbooks = useMemo(() => runbooks.filter((runbook) => runbook.status !== 'archived').length, [runbooks]);
  const workspaceId = memory?.contextWorkspaceId ?? null;
  const subjectId = memory?.contextSubjectId ?? null;
  const subagents = useMemo(() => subagentSummaries(events, runStatus), [events, runStatus]);
  const activeSubagents = useMemo(() => activeSubagentCount(subagents), [subagents]);
  const inactiveSubagents = subagents.length - activeSubagents;
  const visibleSubagents = useMemo(
    () => visibleSubagentSummaries(subagents, showInactiveSubagents),
    [showInactiveSubagents, subagents]
  );
  const nodeTypes = useMemo(() => [...new Set(nodes.map((node) => node.type))].sort(), [nodes]);
  const filteredNodes = useMemo(
    () => filterMemoryCatalogNodes(nodes, { query, scope, sessionId: runId, workspaceId, subjectId, type }),
    [nodes, query, runId, scope, subjectId, type, workspaceId]
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const relationshipsByNodeId = useMemo(() => groupMemoryRelationships(memory?.edges ?? []), [memory?.edges]);
  const updateKey = memoryCatalogUpdateKey(filteredNodes);
  const runbookUpdateKey = runbooks.map((runbook) => `${runbook.id}:${runbook.updatedAt}`).join('|');

  useEffect(() => {
    setActiveView('memory');
    setSelectedNodeId(null);
    setShowInactiveSubagents(false);
  }, [runId]);

  useEffect(() => {
    if (selectedNodeId && !nodeById.has(selectedNodeId)) setSelectedNodeId(null);
  }, [nodeById, selectedNodeId]);

  useDevRenderProbe('research.memory', () => ({
    loaded: Boolean(memory),
    nodes: nodes.length,
    visibleNodes: filteredNodes.length,
    scope,
    type
  }));

  return (
    <>
      <aside className={`main-session-side memory-catalog view-${activeView}`} aria-label="Session details">
      <header className="research-side-tabs">
        <div className="research-side-tab-buttons" role="tablist" aria-label="Session details">
          <button
            type="button"
            className={activeView === 'memory' ? 'active' : ''}
            role="tab"
            aria-selected={activeView === 'memory'}
            onClick={() => setActiveView('memory')}
          >
            <Database size={15} />
            <span>{researchSideTabLabel('memory', activeMemories)}</span>
          </button>
          <button
            type="button"
            className={activeView === 'runbooks' ? 'active' : ''}
            role="tab"
            aria-selected={activeView === 'runbooks'}
            onClick={() => setActiveView('runbooks')}
          >
            <BookOpen size={15} />
            <span>{researchSideTabLabel('runbooks', activeRunbooks)}</span>
          </button>
          <button
            type="button"
            className={activeView === 'subagents' ? 'active' : ''}
            role="tab"
            aria-selected={activeView === 'subagents'}
            onClick={() => setActiveView('subagents')}
          >
            <GitFork size={15} />
            <span>{researchSideTabLabel('subagents', activeSubagents)}</span>
          </button>
        </div>
      </header>

      {activeView === 'memory' ? (
        <>
          <div className="memory-catalog-controls">
            <div className="memory-catalog-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="Find a Memory"
                aria-label="Search memory"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="memory-catalog-inline-filters" aria-label="Memory filters">
                <FloatingTextPicker
                  className="memory-catalog-filter memory-catalog-level-filter"
                  value={scope}
                  title="Memory level filter"
                  ariaLabel="Memory level filter"
                  options={[
                    { value: 'session', label: 'Session' },
                    { value: 'workspace', label: 'Workspace' },
                    { value: 'subject', label: 'Subject' }
                  ]}
                  onChange={(value) => setScope(value as MemoryLevelFilter)}
                />
                <FloatingTextPicker
                  className="memory-catalog-filter memory-catalog-type-filter"
                  value={type}
                  title="Memory type filter"
                  ariaLabel="Memory type filter"
                  options={[
                    { value: 'all', label: 'All Memories' },
                    ...nodeTypes.map((nodeType) => ({ value: nodeType, label: traceLabel(nodeType) }))
                  ]}
                  onChange={setType}
                />
              </div>
            </div>
          </div>
          {!memory ? <div className="memory-catalog-empty">Loading memory.</div> : null}
          {memory?.lastError ? <div className="memory-catalog-empty is-error">{memory.lastError}</div> : null}
          {memory && !memory.lastError && nodes.length === 0 ? <div className="memory-catalog-empty">No memory records yet.</div> : null}
          {memory && nodes.length > 0 && filteredNodes.length === 0 ? <div className="memory-catalog-empty">No records match these filters.</div> : null}
          {filteredNodes.length > 0 ? (
            <MainSideScrollRegion listClassName="memory-catalog-list" stickToEnd updateKey={updateKey}>
              {filteredNodes.map((node) => (
                <MemoryCatalogItem
                  key={node.id}
                  node={node}
                  selected={selectedNodeId === node.id}
                  onOpen={() => setSelectedNodeId(node.id)}
                />
              ))}
            </MainSideScrollRegion>
          ) : null}
        </>
      ) : activeView === 'runbooks' ? (
        runbooks.length > 0 ? (
          <MainSideScrollRegion listClassName="memory-catalog-list runbook-catalog-list" stickToEnd updateKey={runbookUpdateKey}>
            {runbooks.map((runbook) => <RunbookCatalogItem key={runbook.id} runbook={runbook} selected={selectedRunbookId === runbook.id} onOpen={() => onOpenRunbook(runbook.id)} />)}
          </MainSideScrollRegion>
        ) : (
          <div className="memory-catalog-empty">No runbooks in this workspace.</div>
        )
      ) : subagents.length > 0 ? (
        <MainSideScrollRegion
          listClassName="subagent-catalog-list"
          stickToEnd={!showInactiveSubagents}
          updateKey={`${showInactiveSubagents}:${visibleSubagents.map((agent) => `${agent.path}:${agent.status}:${agent.createdAt}:${agent.lastActiveAt}:${agent.latestMessage}`).join('|')}`}
        >
          {inactiveSubagents > 0 ? (
            <div className="subagent-inactive-toggle-row">
              <button
                type="button"
                className="subagent-inactive-toggle"
                aria-pressed={showInactiveSubagents}
                onClick={() => setShowInactiveSubagents((visible) => !visible)}
              >
                {showInactiveSubagents ? 'Hide Inactive' : 'Show Inactive'}
              </button>
            </div>
          ) : null}
          {visibleSubagents.map((agent) => (
            <button
              type="button"
              className={`subagent-catalog-item ${selectedSubagentPath === agent.path ? 'selected' : ''}`}
              aria-pressed={selectedSubagentPath === agent.path}
              key={agent.path}
              onClick={() => onSelectSubagent(agent.path)}
            >
              <span className="subagent-catalog-heading">
                <span className="subagent-catalog-labels">
                  <strong className={`subagent-catalog-name status-${stateClass(agent.status)}`}>{agent.name}</strong>
                  <span className="memory-catalog-status subagent-catalog-status">{subagentStatusLabel(agent.status)}</span>
                </span>
                <time dateTime={agent.createdAt} title={formatSessionDateTime(agent.createdAt)}>{formatSessionDateTime(agent.createdAt)}</time>
              </span>
              <span className="subagent-catalog-preview">{agent.latestMessage || 'No message yet.'}</span>
            </button>
          ))}
        </MainSideScrollRegion>
      ) : (
        <div className="memory-catalog-empty">No subagents in this session.</div>
      )}
      </aside>
      {selectedNode ? (
        <MemoryDetailSheet
          node={selectedNode}
          nodeById={nodeById}
          relationships={relationshipsByNodeId.get(selectedNode.id) ?? []}
          onClose={() => setSelectedNodeId(null)}
        />
      ) : null}
    </>
  );
});

function RunbookCatalogItem({
  runbook,
  selected,
  onOpen
}: {
  runbook: HoneycrispRunbookSummary;
  selected: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`runbook-catalog-item ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onOpen}
    >
      <span className="runbook-catalog-heading">
        <span className="runbook-catalog-labels">
          <span className="runbook-catalog-type">Runbook</span>
          <span className="memory-catalog-status">{traceLabel(runbook.status)}</span>
        </span>
        <time dateTime={runbook.updatedAt} title={formatSessionDateTime(runbook.updatedAt)}>{formatSessionDateTime(runbook.updatedAt)}</time>
      </span>
      <strong>{runbook.title}</strong>
      {runbook.purpose ? <span className="runbook-catalog-purpose">{runbookDescriptionText(runbook.purpose)}</span> : null}
      <span className="runbook-catalog-meta">
        <span>rev {runbook.revision}</span>
        <span>{runbook.sessionId ? 'Session-linked' : 'Workspace'}</span>
      </span>
    </button>
  );
}

function MemoryCatalogItem({
  node,
  selected,
  onOpen
}: {
  node: HoneycrispMemoryNodeSummary;
  selected: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <article className={`memory-catalog-item type-${stateClass(node.type)} ${selected ? 'selected' : ''}`}>
      <button type="button" className="memory-catalog-toggle" aria-haspopup="dialog" onClick={onOpen}>
        <span className="memory-catalog-item-heading">
          <span className="memory-catalog-item-meta-line">
            <span className="memory-catalog-item-labels">
              <span className="memory-catalog-type">{traceLabel(node.type)}</span>
              <span className="memory-catalog-status">{traceLabel(node.status)}</span>
            </span>
            <span className="memory-catalog-item-trailing">
              <time dateTime={node.updatedAt} title={formatSessionDateTime(node.updatedAt)}>{formatSessionDateTime(node.updatedAt)}</time>
            </span>
          </span>
          <strong>{node.title}</strong>
        </span>
      </button>
    </article>
  );
}

export function MemoryDetailSheet({
  node,
  nodeById,
  relationships,
  onClose
}: {
  node: HoneycrispMemoryNodeSummary;
  nodeById: Map<string, HoneycrispMemoryNodeSummary>;
  relationships: HoneycrispMemoryEdgeSummary[];
  onClose: () => void;
}): JSX.Element {
  return (
    <BottomSheet title="Memory Details" wide className="memory-detail-sheet" onClose={onClose}>
      <article className={`memory-detail type-${stateClass(node.type)}`}>
        <header className="memory-detail-heading">
          <span className="memory-catalog-item-labels">
            <span className="memory-catalog-type">{traceLabel(node.type)}</span>
            <span className="memory-catalog-status">{traceLabel(node.status)}</span>
          </span>
          <time dateTime={node.updatedAt} title={formatSessionDateTime(node.updatedAt)}>{formatSessionDateTime(node.updatedAt)}</time>
          <h3>{node.title}</h3>
        </header>
        <div className="memory-catalog-content">
          {node.summary ? <p className="memory-catalog-summary">{node.summary}</p> : null}
          {node.body && node.body !== node.summary ? <p className="memory-catalog-body">{node.body}</p> : null}
          <div className="memory-catalog-meta">
            <span>{traceLabel(node.tier)}</span>
            <span>rev {node.revision}</span>
            <span>{node.evidenceRefs.length} refs</span>
            <span>{relationships.length} links</span>
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
    </BottomSheet>
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
