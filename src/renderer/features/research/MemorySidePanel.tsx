import { memo, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Database, GitFork, Search } from 'lucide-react';
import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary, HoneycrispMemorySummary, HoneycrispRunbookSummary, RunDetail, RunStatus } from '@shared/types';
import { BottomSheet } from '../../app/Modal';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatSessionDateTime, stateClass, traceLabel } from '../../lib/formatting';
import { activeMemoryCount, filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogUpdateKey, sessionMemoryActivitySummary, sessionMemoryTypeSummaries } from '../../view-models/memoryCatalog';
import { subagentStatusCountSummary, subagentStatusLabel, subagentSummaries } from '../../view-models/subagents';
import { runbookDescriptionText } from '../../view-models/runbooks';
import type { ChatView } from '../../view-models/chatView';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { SessionUsageSummary } from '../momentum/SessionUsageStatus';
import { SessionDurationMetric } from '../sessions/SessionMetrics';

type MemoryLevelFilter = 'session' | 'workspace' | 'subject';
type ResearchSideView = 'memory' | 'runbooks' | 'subagents';

export const ResearchSidePanel = memo(function ResearchSidePanel({
  detail,
  events,
  memory,
  runId,
  runStatus,
  chatView = 'commentary',
  selectedSubagentPath,
  selectedRunbookId,
  onOpenRunbook,
  onSelectSubagent
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  memory: HoneycrispMemorySummary | null;
  runId: string;
  runStatus: RunStatus | null;
  chatView?: ChatView;
  selectedSubagentPath: string | null;
  selectedRunbookId: string | null;
  onOpenRunbook: (runbookId: string) => void;
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  const [activeView, setActiveView] = useState<ResearchSideView>('memory');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<MemoryLevelFilter>('workspace');
  const [type, setType] = useState('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const nodes = memory?.nodes ?? [];
  const runbooks = memory?.runbooks ?? [];
  const sessionMemoryNodes = useMemo(
    () => nodes.filter((node) => node.sessionId === runId),
    [nodes, runId]
  );
  const sessionMemories = useMemo(() => activeMemoryCount(sessionMemoryNodes), [sessionMemoryNodes]);
  const sessionMemoryActivity = useMemo(() => sessionMemoryActivitySummary(events), [events]);
  const sessionMemoryTypes = useMemo(() => sessionMemoryTypeSummaries(sessionMemoryNodes), [sessionMemoryNodes]);
  const sessionRunbooks = useMemo(
    () => runbooks.filter((runbook) => runbook.sessionId === runId && runbook.status !== 'archived').length,
    [runbooks, runId]
  );
  const sessionRunbookRevisions = useMemo(
    () => runbooks
      .filter((runbook) => runbook.sessionId === runId && runbook.status !== 'archived')
      .reduce((count, runbook) => count + runbook.revision, 0),
    [runbooks, runId]
  );
  const workspaceId = memory?.contextWorkspaceId ?? null;
  const subjectId = memory?.contextSubjectId ?? null;
  const subagents = useMemo(() => subagentSummaries(events, runStatus, chatView), [chatView, events, runStatus]);
  const subagentStatusCounts = useMemo(() => subagentStatusCountSummary(subagents), [subagents]);
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
    setDetailsOpen(false);
    setSelectedNodeId(null);
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

  const openDetails = (view: ResearchSideView): void => {
    setActiveView(view);
    setDetailsOpen(true);
  };

  if (!detailsOpen) {
    return (
      <aside className="main-session-side session-summary-panel" aria-label="Session summary">
        <section className="session-summary-card">
          <header className="session-summary-heading">
            <h2 className="session-summary-title">Session</h2>
            {detail ? <SessionDurationMetric detail={detail} className="session-summary-duration" /> : null}
          </header>
          <div className="session-summary-items">
            <button type="button" className="session-summary-item" onClick={() => openDetails('memory')}>
              <Database size={15} aria-hidden="true" />
              <span>{sessionMemories} Memories</span>
              {sessionMemoryActivity ? <span className="session-summary-meta">{sessionMemoryActivity}</span> : null}
              <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
            </button>
            {sessionMemoryTypes.map((memoryType) => (
              <div className="session-memory-type-item" key={memoryType.type}>
                <span>{memoryType.countLabel}</span>
                {memoryType.statusLabel ? <span className="session-summary-meta">{memoryType.statusLabel}</span> : null}
              </div>
            ))}

            <button type="button" className="session-summary-item" onClick={() => openDetails('runbooks')}>
              <BookOpen size={15} aria-hidden="true" />
              <span>{sessionRunbooks} Runbooks</span>
              <span className="session-summary-meta">{sessionRunbookRevisions} Revisions</span>
              <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
            </button>
            <button type="button" className="session-summary-item" onClick={() => openDetails('subagents')}>
              <GitFork size={15} aria-hidden="true" />
              <span>{subagents.length} Subagents</span>
              {subagentStatusCounts ? <span className="session-summary-meta">{subagentStatusCounts}</span> : null}
              <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
            </button>
          </div>
          {detail ? (
            <>
              <hr className="session-summary-divider" />
              <SessionUsageSummary detail={detail} />
            </>
          ) : null}
        </section>
      </aside>
    );
  }

  return (
    <>
      <aside className={`main-session-side memory-catalog view-${activeView}`} aria-label="Session details">
      <header className="research-side-back">
        <button
          type="button"
          className="research-side-back-button"
          title="Back to session summary"
          onClick={() => setDetailsOpen(false)}
        >
          <ChevronLeft size={15} aria-hidden="true" />
          <span>Back</span>
        </button>
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
          stickToEnd
          updateKey={subagents.map((agent) => `${agent.path}:${agent.status}:${agent.createdAt}:${agent.lastActiveAt}:${agent.latestMessage}`).join('|')}
        >
          {subagents.map((agent) => (
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
