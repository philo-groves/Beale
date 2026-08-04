import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { ArrowLeft, BookOpen, Bot, ChevronDown, ChevronRight, Database, LoaderCircle, Plus, Search, X } from 'lucide-react';
import type {
  HoneycrispMemoryEdgeSummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispMemorySummary,
  HoneycrispRunbookDocument,
  HoneycrispRunbookSummary,
  ResearchProviderModelCatalog,
  RunDetail,
  RunStatus
} from '@shared/types';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatSessionDateTime, stateClass, traceLabel } from '../../lib/formatting';
import { activeMemoryCount, filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogGroupPreview, memoryCatalogStatusGroups, memoryCatalogUpdateKey, sessionMemoryActivitySummary, sessionMemoryCatalogNodes, sessionMemoryTypeSummaries } from '../../view-models/memoryCatalog';
import type { MemoryStatusGroup } from '../../view-models/memoryCatalog';
import { filterSubagentSummaries, subagentCatalogGroups, subagentDisplayName, subagentStatusCountSummary, subagentStatusIconKind, subagentStatusLabel, subagentSummaries, traceEventsForSubagent } from '../../view-models/subagents';
import type { SubagentSummary } from '../../view-models/subagents';
import { runbookCatalogGroups, runbookDescriptionText } from '../../view-models/runbooks';
import type { ChatView } from '../../view-models/chatView';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import type { TraceCategoryId } from '../../traceClassification';
import { CommentaryView } from '../commentary/CommentaryView';
import { SessionUsageSummary } from '../momentum/SessionUsageStatus';
import { SessionDurationMetric } from '../sessions/SessionMetrics';
import { MemoryTypeIcon, MemoryTypeLabel, memoryTypeClassName } from './MemoryTypeLabel';
import { RunbookView } from './RunbookView';
import { renderInlineCodeText } from '../traces/traceMarkup';
import { TraceView } from '../traces/TraceView';

type MemoryLevelFilter = 'session' | 'workspace' | 'subject';
export const DEFAULT_MEMORY_LEVEL_FILTER: MemoryLevelFilter = 'session';
export type RunbookScopeFilter = 'session' | 'workspace';
export const DEFAULT_RUNBOOK_SCOPE_FILTER: RunbookScopeFilter = 'session';
export type ResearchSideView = 'memory' | 'runbooks' | 'subagents';

export interface ResearchSideNavigationState {
  openViews: ResearchSideView[];
  activeView: ResearchSideView | null;
}

export type ResearchSideNavigationAction =
  | { type: 'open'; view: ResearchSideView }
  | { type: 'activate'; view: ResearchSideView }
  | { type: 'close'; view: ResearchSideView }
  | { type: 'reset' };

export const RESEARCH_SIDE_VIEWS: readonly ResearchSideView[] = ['memory', 'runbooks', 'subagents'];

const CLOSED_RESEARCH_SIDE_NAVIGATION: ResearchSideNavigationState = {
  openViews: [],
  activeView: null
};

export function researchSideNavigationReducer(
  state: ResearchSideNavigationState,
  action: ResearchSideNavigationAction
): ResearchSideNavigationState {
  if (action.type === 'reset') return CLOSED_RESEARCH_SIDE_NAVIGATION;
  if (action.type === 'open') {
    return {
      openViews: state.openViews.includes(action.view) ? state.openViews : [...state.openViews, action.view],
      activeView: action.view
    };
  }
  if (action.type === 'activate') {
    return state.openViews.includes(action.view) ? { ...state, activeView: action.view } : state;
  }

  const closingIndex = state.openViews.indexOf(action.view);
  if (closingIndex < 0) return state;
  const openViews = state.openViews.filter((view) => view !== action.view);
  if (state.activeView !== action.view) return { openViews, activeView: state.activeView };
  return {
    openViews,
    activeView: openViews[Math.min(closingIndex, openViews.length - 1)] ?? null
  };
}

export function availableResearchSideViews(openViews: readonly ResearchSideView[]): ResearchSideView[] {
  return RESEARCH_SIDE_VIEWS.filter((view) => !openViews.includes(view));
}

export function isLastOpenResearchSideView(
  openViews: readonly ResearchSideView[],
  view: ResearchSideView
): boolean {
  return openViews.length === 1 && openViews[0] === view;
}

function initialResearchSideNavigation(
  selectedSubagentPath: string | null,
  selectedRunbookId: string | null
): ResearchSideNavigationState {
  if (selectedSubagentPath) return { openViews: ['subagents'], activeView: 'subagents' };
  if (selectedRunbookId) return { openViews: ['runbooks'], activeView: 'runbooks' };
  return CLOSED_RESEARCH_SIDE_NAVIGATION;
}

export const ResearchSidePanel = memo(function ResearchSidePanel({
  detail,
  events,
  memory,
  runId,
  runStatus,
  chatView = 'commentary',
  providerModelCatalog,
  selectedRunbook,
  selectedRunbookDocument,
  runbookLoading,
  runbookError,
  selectedSubagentPath,
  selectedRunbookId,
  selectedTraceEventId,
  searchHighlightQuery,
  visibleTraceCategories,
  onOpenRunbook,
  onSelectSubagent,
  onBackToRunbooks,
  onBackToSubagents,
  onSelectTraceEvent,
  expanded,
  onExpandedChange
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  memory: HoneycrispMemorySummary | null;
  runId: string;
  runStatus: RunStatus | null;
  chatView?: ChatView;
  providerModelCatalog: ResearchProviderModelCatalog[];
  selectedRunbook: HoneycrispRunbookSummary | null;
  selectedRunbookDocument: HoneycrispRunbookDocument | null;
  runbookLoading: boolean;
  runbookError: string | null;
  selectedSubagentPath: string | null;
  selectedRunbookId: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  visibleTraceCategories: TraceCategoryId[];
  onOpenRunbook: (runbookId: string) => void;
  onSelectSubagent: (path: string) => void;
  onBackToRunbooks: () => void;
  onBackToSubagents: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}): JSX.Element {
  const [navigation, dispatchNavigation] = useReducer(
    researchSideNavigationReducer,
    initialResearchSideNavigation(selectedSubagentPath, selectedRunbookId)
  );
  const runIdRef = useRef(runId);
  const [query, setQuery] = useState('');
  const [runbookQuery, setRunbookQuery] = useState('');
  const [subagentQuery, setSubagentQuery] = useState('');
  const [scope, setScope] = useState<MemoryLevelFilter>(DEFAULT_MEMORY_LEVEL_FILTER);
  const [runbookScope, setRunbookScope] = useState<RunbookScopeFilter>(DEFAULT_RUNBOOK_SCOPE_FILTER);
  const [type, setType] = useState('all');
  const [expandedMemoryGroups, setExpandedMemoryGroups] = useState<ReadonlySet<MemoryStatusGroup>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const detailsOpen = expanded ?? navigation.openViews.length > 0;
  const activeView = navigation.activeView;
  const nodes = memory?.nodes ?? [];
  const runbooks = memory?.runbooks ?? [];
  const sessionMemoryNodes = useMemo(
    () => sessionMemoryCatalogNodes(nodes, runId),
    [nodes, runId]
  );
  const sessionMemories = useMemo(() => activeMemoryCount(sessionMemoryNodes), [sessionMemoryNodes]);
  const sessionMemoryActivity = useMemo(() => sessionMemoryActivitySummary(events), [events]);
  const sessionMemoryTypes = useMemo(() => sessionMemoryTypeSummaries(sessionMemoryNodes), [sessionMemoryNodes]);
  const sessionRunbooks = useMemo(
    () => runbooks.filter((runbook) => runbook.sessionId === runId).length,
    [runbooks, runId]
  );
  const sessionRunbookRevisions = useMemo(
    () => runbooks
      .filter((runbook) => runbook.sessionId === runId)
      .reduce((count, runbook) => count + runbook.revision, 0),
    [runbooks, runId]
  );
  const workspaceId = memory?.contextWorkspaceId ?? null;
  const subjectId = memory?.contextSubjectId ?? null;
  const subagents = useMemo(() => subagentSummaries(events, runStatus, chatView), [chatView, events, runStatus]);
  const filteredSubagents = useMemo(
    () => filterSubagentSummaries(subagents, subagentQuery),
    [subagentQuery, subagents]
  );
  const groupedSubagents = useMemo(() => subagentCatalogGroups(filteredSubagents), [filteredSubagents]);
  const selectedSubagentName = subagentDisplayName(selectedSubagentPath
    ? subagents.find((subagent) => subagent.path === selectedSubagentPath)?.name
      ?? selectedSubagentPath.split('/').filter(Boolean).at(-1)
      ?? selectedSubagentPath
    : '');
  const selectedRunbookName = selectedRunbook?.title
    ?? runbooks.find((runbook) => runbook.id === selectedRunbookId)?.title
    ?? 'Loading runbook';
  const selectedSubagentEvents = useMemo(
    () => traceEventsForSubagent(events, selectedSubagentPath),
    [events, selectedSubagentPath]
  );
  const subagentStatusCounts = useMemo(() => subagentStatusCountSummary(subagents), [subagents]);
  const nodeTypes = useMemo(() => [...new Set(nodes.map((node) => node.type))].sort(), [nodes]);
  const filteredNodes = useMemo(
    () => filterMemoryCatalogNodes(nodes, { query, scope, sessionId: runId, workspaceId, subjectId, type }),
    [nodes, query, runId, scope, subjectId, type, workspaceId]
  );
  const groupedMemories = useMemo(() => memoryCatalogStatusGroups(filteredNodes), [filteredNodes]);
  const filteredRunbooks = useMemo(
    () => filterRunbookCatalog(runbooks, runbookScope, runId, workspaceId, runbookQuery),
    [runbookQuery, runbookScope, runbooks, runId, workspaceId]
  );
  const groupedRunbooks = useMemo(() => runbookCatalogGroups(filteredRunbooks), [filteredRunbooks]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const relationshipsByNodeId = useMemo(() => groupMemoryRelationships(memory?.edges ?? []), [memory?.edges]);
  const updateKey = memoryCatalogUpdateKey(filteredNodes);
  const runbookUpdateKey = filteredRunbooks.map((runbook) => `${runbook.id}:${runbook.updatedAt}`).join('|');

  useEffect(() => {
    if (runIdRef.current === runId) return;
    runIdRef.current = runId;
    dispatchNavigation({ type: 'reset' });
    setExpandedMemoryGroups(new Set());
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
    if (view !== 'memory') setSelectedNodeId(null);
    dispatchNavigation({ type: 'open', view });
    onExpandedChange?.(true);
  };

  const activateDetails = (view: ResearchSideView): void => {
    if (view !== 'memory') setSelectedNodeId(null);
    dispatchNavigation({ type: 'activate', view });
  };

  const closeDetails = (view: ResearchSideView): void => {
    if (view === 'memory') setSelectedNodeId(null);
    const closingLastView = isLastOpenResearchSideView(navigation.openViews, view);
    dispatchNavigation({ type: 'close', view });
    if (closingLastView) onExpandedChange?.(false);
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
              <Bot size={15} aria-hidden="true" />
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

  if (!activeView) {
    return (
      <aside className="main-session-side memory-catalog view-empty" aria-label="Session details">
        <ResearchSideViewChooser onOpen={openDetails} />
      </aside>
    );
  }

  return (
    <>
      <aside className={`main-session-side memory-catalog view-${activeView} ${selectedSubagentPath || selectedRunbookId || selectedNode ? 'has-nested-view' : ''}`} aria-label="Session details">
        {selectedSubagentPath ? (
          <ResearchSideNestedHeader label="Subagents" name={selectedSubagentName} onBack={onBackToSubagents} />
        ) : selectedRunbookId ? (
          <ResearchSideNestedHeader label="Runbooks" name={selectedRunbookName} onBack={onBackToRunbooks} />
        ) : selectedNode ? (
          <ResearchSideNestedHeader label="Memories" name={selectedNode.title} onBack={() => setSelectedNodeId(null)} />
        ) : (
          <ResearchSideViewTabs
            activeView={activeView}
            openViews={navigation.openViews}
            onActivate={activateDetails}
            onClose={closeDetails}
            onOpen={openDetails}
            trailing={activeView === 'memory' ? (
              <FloatingTextPicker
                className="memory-catalog-filter memory-catalog-level-filter research-side-memory-scope"
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
            ) : activeView === 'runbooks' ? (
              <FloatingTextPicker
                className="memory-catalog-filter memory-catalog-level-filter research-side-runbook-scope"
                value={runbookScope}
                title="Runbook scope filter"
                ariaLabel="Runbook scope filter"
                options={[
                  { value: 'session', label: 'Session' },
                  { value: 'workspace', label: 'Workspace' }
                ]}
                onChange={(value) => setRunbookScope(value as RunbookScopeFilter)}
              />
            ) : null}
          />
        )}

        {selectedSubagentPath ? (
          <div className="research-side-nested-content subagent-chat-content">
            {chatView === 'commentary' ? (
              <CommentaryView
                busy={false}
                detail={detail}
                events={selectedSubagentEvents}
                providerModelCatalog={providerModelCatalog}
                selectedRunId={runId}
                showBackToMain
                showBackButton={false}
                scrollScopeKey={selectedSubagentPath}
                selectedTraceEventId={selectedTraceEventId}
                searchHighlightQuery={searchHighlightQuery}
                onBackToMain={onBackToSubagents}
                onSessionAction={() => undefined}
                onSteerInstruction={() => undefined}
              />
            ) : (
              <TraceView
                busy={false}
                detail={detail}
                events={selectedSubagentEvents}
                providerModelCatalog={providerModelCatalog}
                selectedRunId={runId}
                traceScopeKey={selectedSubagentPath}
                showBackToMain
                showBackButton={false}
                selectedTraceEventId={selectedTraceEventId}
                searchHighlightQuery={searchHighlightQuery}
                traceFilterCount={visibleTraceCategories.length}
                totalTraceFilterCount={visibleTraceCategories.length}
                visibleTraceCategories={visibleTraceCategories}
                onBackToMain={onBackToSubagents}
                onOpenTraceFilters={() => undefined}
                onSelectTraceEvent={onSelectTraceEvent}
                onSessionAction={() => undefined}
                onSteerInstruction={() => undefined}
              />
            )}
          </div>
        ) : selectedRunbook ? (
          <div className="research-side-nested-content runbook-detail-content">
            <RunbookView
              document={selectedRunbookDocument}
              error={runbookError}
              followLatest
              loading={runbookLoading}
              runbook={selectedRunbook}
              showBackButton={false}
              onBackToMain={onBackToRunbooks}
            />
          </div>
        ) : selectedRunbookId ? (
          <div className="memory-catalog-empty">Loading runbook.</div>
        ) : selectedNode ? (
          <MainSideScrollRegion
            className="research-side-nested-content memory-detail-content"
            listClassName="memory-catalog-list memory-detail-scroll"
            updateKey={`${selectedNode.id}:${selectedNode.updatedAt}:${selectedNode.revision}`}
          >
            <MemoryDetailView
              node={selectedNode}
              nodeById={nodeById}
              relationships={relationshipsByNodeId.get(selectedNode.id) ?? []}
            />
          </MainSideScrollRegion>
        ) : activeView === 'memory' ? (
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
                    className="memory-catalog-filter memory-catalog-type-filter"
                    value={type}
                    title="Memory type filter"
                    ariaLabel="Memory type filter"
                    options={[
                      { value: 'all', label: 'All Memories' },
                      ...nodeTypes.map((nodeType) => ({
                        value: nodeType,
                        label: traceLabel(nodeType),
                        className: `memory-type-option ${memoryTypeClassName(nodeType)}`
                      }))
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
              <MainSideScrollRegion listClassName="memory-catalog-list memory-status-groups" stickToStart updateKey={updateKey}>
                {(['suspected', 'confirmed', 'rejected'] as const).map((statusGroup) => (
                  <MemoryCatalogSection
                    expanded={expandedMemoryGroups.has(statusGroup)}
                    key={statusGroup}
                    label={statusGroup}
                    nodes={groupedMemories[statusGroup]}
                    selectedNodeId={selectedNodeId}
                    onExpand={() => setExpandedMemoryGroups((current) => new Set(current).add(statusGroup))}
                    onOpen={(nodeId) => setSelectedNodeId(nodeId)}
                  />
                ))}
              </MainSideScrollRegion>
            ) : null}
          </>
        ) : activeView === 'runbooks' ? (
          <>
            <CatalogSearch value={runbookQuery} placeholder="Find a Runbook" ariaLabel="Search runbooks" onChange={setRunbookQuery} />
            <MainSideScrollRegion listClassName="memory-catalog-list runbook-catalog-list" stickToStart updateKey={runbookUpdateKey}>
              <RunbookCatalogSection
                label="Active"
                runbooks={groupedRunbooks.active}
                selectedRunbookId={selectedRunbookId}
                onOpen={onOpenRunbook}
              />
              <RunbookCatalogSection
                label="Archived"
                runbooks={groupedRunbooks.archived}
                selectedRunbookId={selectedRunbookId}
                onOpen={onOpenRunbook}
              />
            </MainSideScrollRegion>
          </>
        ) : (
          <>
            <CatalogSearch value={subagentQuery} placeholder="Find a Subagent" ariaLabel="Search subagents" onChange={setSubagentQuery} />
            <MainSideScrollRegion
              listClassName="subagent-catalog-list"
              stickToStart
              updateKey={filteredSubagents.map((agent) => `${agent.path}:${agent.status}:${agent.createdAt}:${agent.lastActiveAt}:${agent.latestMessage}`).join('|')}
            >
              <SubagentCatalogSection
                agents={groupedSubagents.active}
                label="Active"
                onSelect={onSelectSubagent}
                selectedPath={selectedSubagentPath}
              />
              <SubagentCatalogSection
                agents={groupedSubagents.completed}
                label="Completed"
                onSelect={onSelectSubagent}
                selectedPath={selectedSubagentPath}
              />
            </MainSideScrollRegion>
          </>
        )}
      </aside>
    </>
  );
});

export function filterRunbookCatalog(
  runbooks: readonly HoneycrispRunbookSummary[],
  scope: RunbookScopeFilter,
  sessionId: string,
  workspaceId: string | null,
  query = ''
): HoneycrispRunbookSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return runbooks.filter((runbook) => {
    const inScope = scope === 'session'
      ? runbook.sessionId === sessionId
      : workspaceId !== null && runbook.workspaceId === workspaceId;
    if (!inScope || !normalizedQuery) return inScope;
    return [
      runbook.id,
      runbook.title,
      runbook.purpose,
      runbook.status,
      runbook.workspaceId,
      runbook.workspaceName,
      runbook.subjectId ?? '',
      runbook.subjectName ?? '',
      runbook.sessionId ?? '',
      runbook.artifactId
    ].join('\n').toLocaleLowerCase().includes(normalizedQuery);
  });
}

function CatalogSearch({
  value,
  placeholder,
  ariaLabel,
  onChange
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="memory-catalog-controls">
      <div className="memory-catalog-search search-only">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

export function ResearchSideNestedHeader({
  label,
  name,
  onBack
}: {
  label: 'Memories' | 'Runbooks' | 'Subagents';
  name: string;
  onBack: () => void;
}): JSX.Element {
  return (
    <header className="research-side-nested-header">
      <button type="button" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        <span>Back to {label}</span>
      </button>
      <span className="research-side-nested-name" title={name}>{name}</span>
    </header>
  );
}

export function ResearchSideViewTabs({
  activeView,
  openViews,
  onActivate,
  onClose,
  onOpen,
  trailing
}: {
  activeView: ResearchSideView;
  openViews: readonly ResearchSideView[];
  onActivate: (view: ResearchSideView) => void;
  onClose: (view: ResearchSideView) => void;
  onOpen: (view: ResearchSideView) => void;
  trailing?: ReactNode;
}): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const availableViews = availableResearchSideViews(openViews);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (availableViews.length === 0) setPickerOpen(false);
  }, [availableViews.length]);

  return (
    <header className="research-side-view-header">
      <div className="research-side-view-tabs" role="tablist" aria-label="Open session detail views">
        {openViews.map((view) => (
          <div className={`research-side-view-tab ${activeView === view ? 'active' : ''}`} key={view}>
            <button
              type="button"
              className="research-side-view-tab-activate"
              role="tab"
              aria-selected={activeView === view}
              onClick={() => onActivate(view)}
            >
              {researchSideViewIcon(view, 15)}
              <span>{researchSideViewLabel(view)}</span>
            </button>
            <button
              type="button"
              className="research-side-view-tab-close"
              aria-label={`Close ${researchSideViewLabel(view)}`}
              title={`Close ${researchSideViewLabel(view)}`}
              onClick={() => onClose(view)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {availableViews.length > 0 ? (
        <div className={`research-side-view-picker ${pickerOpen ? 'open' : ''}`} ref={pickerRef}>
          <button
            type="button"
            className="research-side-view-picker-trigger"
            aria-label="Add session detail view"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            title="Add session detail view"
            onClick={() => setPickerOpen((current) => !current)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          {pickerOpen ? (
            <div className="research-side-view-picker-menu" role="menu">
              {availableViews.map((view) => (
                <button
                  type="button"
                  role="menuitem"
                  key={view}
                  onClick={() => {
                    onOpen(view);
                    setPickerOpen(false);
                  }}
                >
                  {researchSideViewIcon(view, 15)}
                  <span>{researchSideViewLabel(view)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {trailing ? <div className="research-side-view-trailing">{trailing}</div> : null}
    </header>
  );
}

export function ResearchSideViewChooser({ onOpen }: { onOpen: (view: ResearchSideView) => void }): JSX.Element {
  return (
    <nav className="research-side-view-chooser" aria-label="Choose a session detail view">
      {RESEARCH_SIDE_VIEWS.map((view) => (
        <button type="button" key={view} onClick={() => onOpen(view)}>
          {researchSideViewIcon(view, 16)}
          <span>{researchSideViewLabel(view)}</span>
        </button>
      ))}
    </nav>
  );
}

function researchSideViewLabel(view: ResearchSideView): string {
  if (view === 'memory') return 'Memories';
  if (view === 'runbooks') return 'Runbooks';
  return 'Subagents';
}

function researchSideViewIcon(view: ResearchSideView, size: number): JSX.Element {
  if (view === 'memory') return <Database size={size} aria-hidden="true" />;
  if (view === 'runbooks') return <BookOpen size={size} aria-hidden="true" />;
  return <Bot size={size} aria-hidden="true" />;
}

export function RunbookCatalogItem({
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
      className={`runbook-catalog-item runbook-status-${stateClass(runbook.status)} ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onOpen}
    >
      <span className="runbook-catalog-heading">
        <span className="runbook-catalog-primary">
          <BookOpen className="runbook-catalog-icon" size={16} aria-hidden="true" />
          <span className="runbook-catalog-name">{runbook.title}</span>
        </span>
        <span className="runbook-catalog-heading-trailing">
          <span className="runbook-catalog-status">{traceLabel(runbook.status)}</span>
          <time dateTime={runbook.updatedAt} title={formatSessionDateTime(runbook.updatedAt)}>{formatSessionDateTime(runbook.updatedAt)}</time>
        </span>
      </span>
      {runbook.purpose ? <span className="runbook-catalog-purpose">{runbookDescriptionText(runbook.purpose)}</span> : null}
    </button>
  );
}

function RunbookCatalogSection({
  runbooks,
  label,
  selectedRunbookId,
  onOpen
}: {
  runbooks: readonly HoneycrispRunbookSummary[];
  label: 'Active' | 'Archived';
  selectedRunbookId: string | null;
  onOpen: (runbookId: string) => void;
}): JSX.Element {
  return (
    <section className="runbook-catalog-section" aria-label={`${runbooks.length} ${label}`}>
      <h3>{runbooks.length} {label}</h3>
      <div className={`runbook-catalog-items ${runbooks.length === 0 ? 'is-empty' : ''}`}>
        {runbooks.length > 0 ? runbooks.map((runbook) => (
          <RunbookCatalogItem
            key={runbook.id}
            runbook={runbook}
            selected={selectedRunbookId === runbook.id}
            onOpen={() => onOpen(runbook.id)}
          />
        )) : (
          <p className="runbook-catalog-empty">
            {label === 'Active' ? 'No active runbooks right now.' : 'No archived runbooks yet.'}
          </p>
        )}
      </div>
    </section>
  );
}

function SubagentCatalogSection({
  agents,
  label,
  selectedPath,
  onSelect
}: {
  agents: readonly SubagentSummary[];
  label: 'Active' | 'Completed';
  selectedPath: string | null;
  onSelect: (path: string) => void;
}): JSX.Element {
  return (
    <section className="subagent-catalog-section" aria-label={`${agents.length} ${label}`}>
      <h3>{agents.length} {label}</h3>
      <div className={`subagent-catalog-items ${agents.length === 0 ? 'is-empty' : ''}`}>
        {agents.length > 0 ? (
          agents.map((agent) => (
            <button
              type="button"
              className={`subagent-catalog-item ${selectedPath === agent.path ? 'selected' : ''}`}
              aria-pressed={selectedPath === agent.path}
              key={agent.path}
              onClick={() => onSelect(agent.path)}
            >
              <SubagentStatusIcon status={agent.status} />
              <span className="subagent-catalog-heading">
                <strong className="subagent-catalog-name">{subagentDisplayName(agent.name)}</strong>
                <span className="subagent-catalog-heading-trailing">
                  <span className={`subagent-catalog-status is-${subagentStatusIconKind(agent.status)}`}>{subagentStatusLabel(agent.status)}</span>
                  <time dateTime={agent.createdAt} title={formatSessionDateTime(agent.createdAt)}>{formatSessionDateTime(agent.createdAt)}</time>
                </span>
              </span>
              <span className="subagent-catalog-preview">{agent.latestMessage || 'No message yet.'}</span>
            </button>
          ))
        ) : (
          <p className="subagent-catalog-empty">
            {label === 'Active' ? 'No active subagents right now.' : 'No completed subagents yet.'}
          </p>
        )}
      </div>
    </section>
  );
}

function SubagentStatusIcon({ status }: { status: SubagentSummary['status'] }): JSX.Element {
  const kind = subagentStatusIconKind(status);
  const label = subagentStatusLabel(status);
  return (
    <span className={`subagent-status-icon is-${kind}`} aria-label={label} title={label}>
      {kind === 'active' ? (
        <LoaderCircle size={15} aria-hidden="true" />
      ) : (
        <Bot size={15} aria-hidden="true" />
      )}
    </span>
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
      <button type="button" className="memory-catalog-toggle" aria-pressed={selected} onClick={onOpen}>
        <span className="memory-catalog-item-heading">
          <span className="memory-catalog-item-meta-line">
            <span className="memory-catalog-item-primary">
              <MemoryTypeIcon type={node.type} />
              <span className="memory-catalog-item-name" title={node.title}>{node.title}</span>
            </span>
            <span className="memory-catalog-item-trailing">
              <MemoryTypeLabel type={node.type} showDot={false} />
              <time dateTime={node.updatedAt} title={formatSessionDateTime(node.updatedAt)}>{formatSessionDateTime(node.updatedAt)}</time>
            </span>
          </span>
          {node.summary || node.body ? (
            <span className="memory-catalog-item-description">{renderInlineCodeText(node.summary || node.body)}</span>
          ) : null}
        </span>
      </button>
    </article>
  );
}

export function MemoryCatalogSection({
  nodes,
  label,
  expanded,
  selectedNodeId,
  onExpand,
  onOpen
}: {
  nodes: readonly HoneycrispMemoryNodeSummary[];
  label: MemoryStatusGroup;
  expanded: boolean;
  selectedNodeId: string | null;
  onExpand: () => void;
  onOpen: (nodeId: string) => void;
}): JSX.Element {
  const { visibleNodes, hiddenCount } = memoryCatalogGroupPreview(nodes, expanded);
  const displayLabel = traceLabel(label);
  return (
    <section className="memory-status-section" aria-label={`${nodes.length} ${displayLabel}`}>
      <h3>{nodes.length} {displayLabel}</h3>
      <div className={`memory-status-items ${nodes.length === 0 ? 'is-empty' : ''}`}>
        {visibleNodes.length > 0 ? visibleNodes.map((node) => (
          <MemoryCatalogItem
            key={node.id}
            node={node}
            selected={selectedNodeId === node.id}
            onOpen={() => onOpen(node.id)}
          />
        )) : (
          <p className="memory-status-empty">No {label} memories yet.</p>
        )}
      </div>
      {hiddenCount > 0 ? (
        <button type="button" className="memory-status-show-more" onClick={onExpand}>
          <span>Show {hiddenCount} More</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

export function MemoryDetailView({
  node,
  nodeById,
  relationships
}: {
  node: HoneycrispMemoryNodeSummary;
  nodeById: Map<string, HoneycrispMemoryNodeSummary>;
  relationships: HoneycrispMemoryEdgeSummary[];
}): JSX.Element {
  return (
    <article className={`memory-detail type-${stateClass(node.type)}`}>
      <header className="memory-detail-heading">
        <span className="memory-catalog-item-labels">
          <MemoryTypeLabel type={node.type} />
          <span className="memory-catalog-status">{traceLabel(node.status)}</span>
        </span>
        <time dateTime={node.updatedAt} title={formatSessionDateTime(node.updatedAt)}>{formatSessionDateTime(node.updatedAt)}</time>
        <h3>{node.title}</h3>
      </header>
      <div className="memory-catalog-content">
        {node.summary ? <p className="memory-catalog-summary">{node.summary}</p> : null}
        {node.body && node.body !== node.summary ? <p className="memory-catalog-body">{node.body}</p> : null}
        <div className="memory-catalog-meta">
          <span>rev {node.revision}</span>
          <span>{node.evidenceRefs.length} refs</span>
          <span>{relationships.length} links</span>
        </div>
        <dl className="memory-catalog-scope">
          <div><dt>Subject</dt><dd>{node.subjectName}</dd></div>
          <div><dt>Workspaces</dt><dd>{node.workspaces.map((workspace) => workspace.name).join(', ') || 'None'}</dd></div>
          <div><dt>Sessions</dt><dd>{node.sessionIds.join(', ') || 'None'}</dd></div>
        </dl>
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
