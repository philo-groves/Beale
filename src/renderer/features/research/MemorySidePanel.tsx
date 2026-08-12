import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { ArrowLeft, BookOpen, Bot, ChevronDown, ChevronRight, Database, LoaderCircle, Plus, Search, X } from 'lucide-react';
import type {
  HoneycrispMemoryEdgeSummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispMemorySummary,
  HoneycrispRunbookDocument,
  HoneycrispRunbookSummary,
  ResearchProfile,
  ResearchProfileMemoryStatus,
  ResearchProfileMemoryType,
  ResearchProviderModelCatalog,
  RunDetail,
  RunStatus
} from '@shared/types';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatSessionDateTime, stateClass, traceLabel } from '../../lib/formatting';
import { activeMemoryCount, filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogGroupPreview, memoryCatalogStatusGroups, memoryCatalogStatusSections, memoryCatalogUpdateKey, sessionMemoryActivitySummary, sessionMemoryCatalogNodes, sessionMemoryTypeSummaries } from '../../view-models/memoryCatalog';
import type { MemoryStatusGroup } from '../../view-models/memoryCatalog';
import { filterSubagentSummaries, subagentCatalogGroups, subagentDisplayName, subagentStatusCountSummary, subagentStatusIconKind, subagentStatusLabel, subagentSummaries, traceEventsForSubagent } from '../../view-models/subagents';
import type { SubagentSummary } from '../../view-models/subagents';
import { runbookCatalogGroups, runbookDescriptionText } from '../../view-models/runbooks';
import type { ChatView } from '../../view-models/chatView';
import { researchProfileFeatureAvailability } from '../../view-models/researchProfileFeatures';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import type { TraceCategoryId } from '../../traceClassification';
import { CommentaryView } from '../commentary/CommentaryView';
import { SessionUsageSummary } from '../momentum/SessionUsageStatus';
import { SessionDurationMetric } from '../sessions/SessionMetrics';
import { MemoryTypeIcon, MemoryTypeLabel, memoryTypeClassName, memoryTypeDefinition, memoryTypeLabel } from './MemoryTypeLabel';
import { RunbookView } from './RunbookView';
import { renderInlineCodeText } from '../traces/traceMarkup';
import { TraceView } from '../traces/TraceView';

export type MemoryLevelFilter = 'session' | 'workspace' | 'subject';
export const DEFAULT_MEMORY_LEVEL_FILTER: MemoryLevelFilter = 'session';
export const DEFAULT_WORKSPACE_MEMORY_LEVEL_FILTER: MemoryLevelFilter = 'workspace';
export type RunbookScopeFilter = 'session' | 'workspace';
export const DEFAULT_RUNBOOK_SCOPE_FILTER: RunbookScopeFilter = 'session';
export const DEFAULT_WORKSPACE_RUNBOOK_SCOPE_FILTER: RunbookScopeFilter = 'workspace';
export type ResearchViewSpace = 'session' | 'workspace';
export type ResearchSideView = 'memory' | 'runbooks' | 'subagents';

export interface ResearchSideNavigationState {
  openViews: ResearchSideView[];
  activeView: ResearchSideView | null;
}

export type ResearchSideNavigationAction =
  | { type: 'open'; view: ResearchSideView }
  | { type: 'activate'; view: ResearchSideView }
  | { type: 'close'; view: ResearchSideView }
  | { type: 'restrict'; views: readonly ResearchSideView[] }
  | { type: 'reset' };

export const RESEARCH_SIDE_VIEWS: readonly ResearchSideView[] = ['memory', 'runbooks', 'subagents'];

export function memoryLevelFiltersForViewSpace(viewSpace: ResearchViewSpace): MemoryLevelFilter[] {
  return viewSpace === 'workspace' ? ['workspace', 'subject'] : ['session', 'workspace', 'subject'];
}

export function runbookScopeFiltersForViewSpace(viewSpace: ResearchViewSpace): RunbookScopeFilter[] {
  return viewSpace === 'workspace' ? ['workspace'] : ['session', 'workspace'];
}

const CLOSED_RESEARCH_SIDE_NAVIGATION: ResearchSideNavigationState = {
  openViews: [],
  activeView: null
};

export function researchSideNavigationReducer(
  state: ResearchSideNavigationState,
  action: ResearchSideNavigationAction
): ResearchSideNavigationState {
  if (action.type === 'reset') return CLOSED_RESEARCH_SIDE_NAVIGATION;
  if (action.type === 'restrict') return restrictResearchSideNavigation(state, action.views);
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

export function availableResearchSideViews(
  openViews: readonly ResearchSideView[],
  enabledViews: readonly ResearchSideView[] = RESEARCH_SIDE_VIEWS
): ResearchSideView[] {
  return enabledViews.filter((view) => !openViews.includes(view));
}

export function researchSideViewsForProfile(
  profile: ResearchProfile | null | undefined
): ResearchSideView[] {
  const features = researchProfileFeatureAvailability(profile);
  return RESEARCH_SIDE_VIEWS.filter((view) => (
    view === 'memory'
      ? features.memory
      : view === 'runbooks'
        ? features.runbooks
        : features.collaboration
  ));
}

export function restrictResearchSideNavigation(
  state: ResearchSideNavigationState,
  enabledViews: readonly ResearchSideView[]
): ResearchSideNavigationState {
  const openViews = state.openViews.filter((view) => enabledViews.includes(view));
  return {
    openViews,
    activeView: state.activeView && openViews.includes(state.activeView)
      ? state.activeView
      : openViews.at(-1) ?? null
  };
}

export function isLastOpenResearchSideView(
  openViews: readonly ResearchSideView[],
  view: ResearchSideView
): boolean {
  return openViews.length === 1 && openViews[0] === view;
}

function initialResearchSideNavigation(
  selectedSubagentPath: string | null,
  selectedRunbookId: string | null,
  enabledViews: readonly ResearchSideView[]
): ResearchSideNavigationState {
  if (selectedSubagentPath && enabledViews.includes('subagents')) {
    return { openViews: ['subagents'], activeView: 'subagents' };
  }
  if (selectedRunbookId && enabledViews.includes('runbooks')) {
    return { openViews: ['runbooks'], activeView: 'runbooks' };
  }
  return CLOSED_RESEARCH_SIDE_NAVIGATION;
}

export const ResearchSidePanel = memo(function ResearchSidePanel({
  detail,
  events,
  memory,
  researchProfile = null,
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
  onExpandedChange,
  viewSpace = 'session'
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  memory: HoneycrispMemorySummary | null;
  researchProfile?: ResearchProfile | null;
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
  viewSpace?: ResearchViewSpace;
}): JSX.Element {
  const featureAvailability = researchProfileFeatureAvailability(researchProfile);
  const subagentsAvailable = featureAvailability.collaboration && viewSpace === 'session';
  const enabledViews = researchSideViewsForProfile(researchProfile)
    .filter((view) => viewSpace === 'session' || view !== 'subagents');
  const enabledViewsKey = enabledViews.join(':');
  const [navigation, dispatchNavigation] = useReducer(
    researchSideNavigationReducer,
    initialResearchSideNavigation(selectedSubagentPath, selectedRunbookId, enabledViews)
  );
  const runIdRef = useRef(runId);
  const [query, setQuery] = useState('');
  const [runbookQuery, setRunbookQuery] = useState('');
  const [subagentQuery, setSubagentQuery] = useState('');
  const [scope, setScope] = useState<MemoryLevelFilter>(
    viewSpace === 'workspace' ? DEFAULT_WORKSPACE_MEMORY_LEVEL_FILTER : DEFAULT_MEMORY_LEVEL_FILTER
  );
  const [runbookScope, setRunbookScope] = useState<RunbookScopeFilter>(
    viewSpace === 'workspace' ? DEFAULT_WORKSPACE_RUNBOOK_SCOPE_FILTER : DEFAULT_RUNBOOK_SCOPE_FILTER
  );
  const [type, setType] = useState('all');
  const [expandedMemoryGroups, setExpandedMemoryGroups] = useState<ReadonlySet<MemoryStatusGroup>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const visibleNavigation = restrictResearchSideNavigation(navigation, enabledViews);
  const detailsOpen = expanded ?? visibleNavigation.openViews.length > 0;
  const activeView = visibleNavigation.activeView;
  const nodes = memory?.nodes ?? [];
  const runbooks = memory?.runbooks ?? [];
  const memoryProfile = researchProfile?.memory;
  const memoryTypes = memoryProfile?.types ?? [];
  const memoryStatuses = memoryProfile?.statuses ?? [];
  const memoryLabel = 'Memory';
  const memoriesLabel = 'Memories';
  const runbookLabel = 'Runbooks';
  const sessionLabel = researchProfile?.presentation.sessionLabel ?? 'Session';
  const workspaceLabel = researchProfile?.workspace.workspaceNoun ?? 'Workspace';
  const viewSpaceLabel = viewSpace === 'workspace' ? workspaceLabel : sessionLabel;
  const sessionMemoryNodes = useMemo(
    () => sessionMemoryCatalogNodes(nodes, runId),
    [nodes, runId]
  );
  const sessionMemories = useMemo(
    () => activeMemoryCount(sessionMemoryNodes, memoryProfile?.statuses),
    [memoryProfile?.statuses, sessionMemoryNodes]
  );
  const sessionMemoryActivity = useMemo(() => sessionMemoryActivitySummary(events), [events]);
  const sessionMemoryTypes = useMemo(
    () => sessionMemoryTypeSummaries(sessionMemoryNodes, memoryProfile),
    [memoryProfile, sessionMemoryNodes]
  );
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
  const workspaceMemoryNodes = useMemo(
    () => filterMemoryCatalogNodes(nodes, {
      query: '',
      scope: 'workspace',
      sessionId: runId,
      workspaceId,
      subjectId,
      type: 'all'
    }),
    [nodes, runId, subjectId, workspaceId]
  );
  const workspaceMemories = useMemo(
    () => activeMemoryCount(workspaceMemoryNodes, memoryProfile?.statuses),
    [memoryProfile?.statuses, workspaceMemoryNodes]
  );
  const workspaceRunbooks = useMemo(
    () => runbooks.filter((runbook) => workspaceId !== null && runbook.workspaceId === workspaceId),
    [runbooks, workspaceId]
  );
  const workspaceRunbookRevisions = useMemo(
    () => workspaceRunbooks.reduce((count, runbook) => count + runbook.revision, 0),
    [workspaceRunbooks]
  );
  const subagents = useMemo(() => subagentSummaries(events, runStatus, chatView), [chatView, events, runStatus]);
  const filteredSubagents = useMemo(
    () => filterSubagentSummaries(subagents, subagentQuery),
    [subagentQuery, subagents]
  );
  const groupedSubagents = useMemo(() => subagentCatalogGroups(filteredSubagents), [filteredSubagents]);
  const visibleSelectedSubagentPath = subagentsAvailable ? selectedSubagentPath : null;
  const visibleSelectedRunbookId = featureAvailability.runbooks ? selectedRunbookId : null;
  const visibleSelectedRunbook = visibleSelectedRunbookId ? selectedRunbook : null;
  const selectedSubagentName = subagentDisplayName(visibleSelectedSubagentPath
    ? subagents.find((subagent) => subagent.path === visibleSelectedSubagentPath)?.name
      ?? visibleSelectedSubagentPath.split('/').filter(Boolean).at(-1)
      ?? visibleSelectedSubagentPath
    : '');
  const selectedRunbookName = visibleSelectedRunbook?.title
    ?? runbooks.find((runbook) => runbook.id === visibleSelectedRunbookId)?.title
    ?? 'Loading runbook';
  const selectedSubagentEvents = useMemo(
    () => traceEventsForSubagent(events, visibleSelectedSubagentPath),
    [events, visibleSelectedSubagentPath]
  );
  const subagentStatusCounts = useMemo(() => subagentStatusCountSummary(subagents), [subagents]);
  const nodeTypes = useMemo(() => orderedCatalogMemoryTypes(nodes, memoryTypes), [memoryTypes, nodes]);
  const filteredNodes = useMemo(
    () => filterMemoryCatalogNodes(nodes, { query, scope, sessionId: runId, workspaceId, subjectId, type }),
    [nodes, query, runId, scope, subjectId, type, workspaceId]
  );
  const memoryStatusSections = useMemo(
    () => memoryStatuses.length > 0
      ? memoryCatalogStatusSections(filteredNodes, memoryStatuses)
      : legacyMemoryStatusSections(filteredNodes),
    [filteredNodes, memoryStatuses]
  );
  const filteredRunbooks = useMemo(
    () => filterRunbookCatalog(runbooks, runbookScope, runId, workspaceId, runbookQuery),
    [runbookQuery, runbookScope, runbooks, runId, workspaceId]
  );
  const groupedRunbooks = useMemo(() => runbookCatalogGroups(filteredRunbooks), [filteredRunbooks]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNode = featureAvailability.memory && selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const relationshipsByNodeId = useMemo(() => groupMemoryRelationships(memory?.edges ?? []), [memory?.edges]);
  const updateKey = memoryCatalogUpdateKey(filteredNodes);
  const runbookUpdateKey = filteredRunbooks.map((runbook) => `${runbook.id}:${runbook.updatedAt}`).join('|');
  const hasSessionMetadata = Boolean(detail);
  const hasSessionResources = featureAvailability.runbooks || featureAvailability.collaboration;
  const hasSessionMemories = featureAvailability.memory;

  useEffect(() => {
    if (runIdRef.current === runId) return;
    runIdRef.current = runId;
    dispatchNavigation({ type: 'reset' });
    setExpandedMemoryGroups(new Set());
    setSelectedNodeId(null);
    setScope(viewSpace === 'workspace' ? DEFAULT_WORKSPACE_MEMORY_LEVEL_FILTER : DEFAULT_MEMORY_LEVEL_FILTER);
    setRunbookScope(viewSpace === 'workspace' ? DEFAULT_WORKSPACE_RUNBOOK_SCOPE_FILTER : DEFAULT_RUNBOOK_SCOPE_FILTER);
  }, [runId, viewSpace]);

  useEffect(() => {
    dispatchNavigation({ type: 'restrict', views: enabledViews });
    if (!featureAvailability.memory) setSelectedNodeId(null);
  }, [enabledViewsKey, featureAvailability.memory]);

  useEffect(() => {
    if (!featureAvailability.runbooks && selectedRunbookId) onBackToRunbooks();
    if (!subagentsAvailable && selectedSubagentPath) onBackToSubagents();
  }, [
    featureAvailability.runbooks,
    onBackToRunbooks,
    onBackToSubagents,
    selectedRunbookId,
    selectedSubagentPath,
    subagentsAvailable
  ]);

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
    if (!enabledViews.includes(view)) return;
    if (view !== 'memory') setSelectedNodeId(null);
    dispatchNavigation({ type: 'open', view });
    onExpandedChange?.(true);
  };

  const activateDetails = (view: ResearchSideView): void => {
    if (!enabledViews.includes(view)) return;
    if (view !== 'memory') setSelectedNodeId(null);
    dispatchNavigation({ type: 'activate', view });
  };

  const closeDetails = (view: ResearchSideView): void => {
    if (view === 'memory') setSelectedNodeId(null);
    const closingLastView = isLastOpenResearchSideView(visibleNavigation.openViews, view);
    dispatchNavigation({ type: 'close', view });
    if (closingLastView) onExpandedChange?.(false);
  };

  if (!detailsOpen) {
    if (viewSpace === 'workspace') {
      return (
        <aside className="main-session-side session-summary-panel workspace-summary-panel" aria-label={`${workspaceLabel} summary`}>
          <section className="session-summary-card">
            <header className="session-summary-heading">
              <h2 className="session-summary-title">{workspaceLabel}</h2>
            </header>
            <section className="session-summary-items session-summary-resources" aria-label={`${workspaceLabel} resources`}>
              {featureAvailability.runbooks ? (
                <button type="button" className="session-summary-item" onClick={() => openDetails('runbooks')}>
                  <BookOpen size={15} aria-hidden="true" />
                  <span>{workspaceRunbooks.length} {runbookLabel}</span>
                  <span className="session-summary-meta">{workspaceRunbookRevisions} Revisions</span>
                  <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
                </button>
              ) : null}
              {featureAvailability.memory ? (
                <button type="button" className="session-summary-item" onClick={() => openDetails('memory')}>
                  <Database size={15} aria-hidden="true" />
                  <span>{workspaceMemories} {workspaceMemories === 1 ? memoryLabel : memoriesLabel}</span>
                  <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
                </button>
              ) : null}
            </section>
          </section>
        </aside>
      );
    }
    return (
      <aside className="main-session-side session-summary-panel" aria-label={`${sessionLabel} summary`}>
        <section className="session-summary-card">
          <header className="session-summary-heading">
            <h2 className="session-summary-title">{sessionLabel}</h2>
            {detail ? <SessionDurationMetric detail={detail} className="session-summary-duration" /> : null}
          </header>
          <section className="session-summary-section session-summary-metadata" aria-label="Session metadata">
            {detail ? <SessionUsageSummary detail={detail} /> : null}
          </section>
          {hasSessionMetadata && (hasSessionResources || hasSessionMemories) ? <hr className="session-summary-divider" /> : null}
          <section className="session-summary-items session-summary-resources" aria-label="Session resources">
            {featureAvailability.runbooks ? (
              <button type="button" className="session-summary-item" onClick={() => openDetails('runbooks')}>
                <BookOpen size={15} aria-hidden="true" />
                <span>{sessionRunbooks} {runbookLabel}</span>
                <span className="session-summary-meta">{sessionRunbookRevisions} Revisions</span>
                <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
              </button>
            ) : null}
            {featureAvailability.collaboration ? (
              <button type="button" className="session-summary-item" onClick={() => openDetails('subagents')}>
                <Bot size={15} aria-hidden="true" />
                <span>{subagents.length} Subagents</span>
                {subagentStatusCounts ? <span className="session-summary-meta">{subagentStatusCounts}</span> : null}
                <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
              </button>
            ) : null}
          </section>
          {hasSessionResources && hasSessionMemories ? <hr className="session-summary-divider" /> : null}
          {featureAvailability.memory ? (
            <section className="session-summary-items session-summary-memories" aria-label="Session memories">
              <button type="button" className="session-summary-item" onClick={() => openDetails('memory')}>
                <Database size={15} aria-hidden="true" />
                <span>{sessionMemories} {sessionMemories === 1 ? memoryLabel : memoriesLabel}</span>
                {sessionMemoryActivity ? <span className="session-summary-meta">{sessionMemoryActivity}</span> : null}
                <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
              </button>
              {sessionMemoryTypes.map((memoryType) => (
                <div className="session-memory-type-item" key={memoryType.type}>
                  <span>{memoryType.countLabel}</span>
                  {memoryType.statusLabel ? <span className="session-summary-meta">{memoryType.statusLabel}</span> : null}
                </div>
              ))}
            </section>
          ) : null}
        </section>
      </aside>
    );
  }

  if (!activeView) {
    return (
      <aside className="main-session-side memory-catalog view-empty" aria-label={`${viewSpaceLabel} details`}>
        <ResearchSideViewChooser viewSpaceLabel={viewSpaceLabel} views={enabledViews} labels={{ memory: memoriesLabel, runbooks: runbookLabel }} onOpen={openDetails} />
      </aside>
    );
  }

  return (
    <>
      <aside className={`main-session-side memory-catalog view-${activeView} ${visibleSelectedSubagentPath || visibleSelectedRunbookId || selectedNode ? 'has-nested-view' : ''}`} aria-label={`${viewSpaceLabel} details`}>
        {visibleSelectedSubagentPath ? (
          <ResearchSideNestedHeader label="Subagents" name={selectedSubagentName} onBack={onBackToSubagents} />
        ) : visibleSelectedRunbookId ? (
          <ResearchSideNestedHeader label={runbookLabel} name={selectedRunbookName} onBack={onBackToRunbooks} />
        ) : selectedNode ? (
          <ResearchSideNestedHeader label={memoriesLabel} name={selectedNode.title} onBack={() => setSelectedNodeId(null)} />
        ) : (
          <ResearchSideViewTabs
            activeView={activeView}
            enabledViews={enabledViews}
            labels={{ memory: memoriesLabel, runbooks: runbookLabel }}
            openViews={visibleNavigation.openViews}
            viewSpaceLabel={viewSpaceLabel}
            onActivate={activateDetails}
            onClose={closeDetails}
            onOpen={openDetails}
            trailing={activeView === 'memory' ? (
              <FloatingTextPicker
                className="memory-catalog-filter memory-catalog-level-filter research-side-memory-scope"
                value={scope}
                title="Memory level filter"
                ariaLabel="Memory level filter"
                options={memoryLevelFiltersForViewSpace(viewSpace).map((filter) => ({
                  value: filter,
                  label: filter === 'session'
                    ? sessionLabel
                    : filter === 'workspace'
                      ? workspaceLabel
                      : researchProfile?.workspace.subjectNoun ?? 'Subject'
                }))}
                onChange={(value) => setScope(value as MemoryLevelFilter)}
              />
            ) : activeView === 'runbooks' ? (
              <FloatingTextPicker
                className="memory-catalog-filter memory-catalog-level-filter research-side-runbook-scope"
                value={runbookScope}
                title="Runbook scope filter"
                ariaLabel="Runbook scope filter"
                options={runbookScopeFiltersForViewSpace(viewSpace).map((filter) => ({
                  value: filter,
                  label: filter === 'session' ? sessionLabel : workspaceLabel
                }))}
                onChange={(value) => setRunbookScope(value as RunbookScopeFilter)}
              />
            ) : null}
          />
        )}

        {visibleSelectedSubagentPath ? (
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
                scrollScopeKey={visibleSelectedSubagentPath}
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
                traceScopeKey={visibleSelectedSubagentPath}
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
        ) : visibleSelectedRunbook ? (
          <div className="research-side-nested-content runbook-detail-content">
            <RunbookView
              document={selectedRunbookDocument}
              error={runbookError}
              followLatest
              loading={runbookLoading}
              runbook={visibleSelectedRunbook}
              showBackButton={false}
              onBackToMain={onBackToRunbooks}
            />
          </div>
        ) : visibleSelectedRunbookId ? (
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
              researchProfile={researchProfile}
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
                  placeholder={`Find ${articleForLabel(memoryLabel)} ${memoryLabel}`}
                  aria-label={`Search ${memoryLabel.toLocaleLowerCase()}`}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div className="memory-catalog-inline-filters" aria-label="Memory filters">
                  <FloatingTextPicker
                    className="memory-catalog-filter memory-catalog-type-filter"
                    value={type}
                    title="Memory type filter"
                    ariaLabel="Memory type filter"
                    options={[
                      { value: 'all', label: `All ${memoriesLabel}` },
                      ...nodeTypes.map((nodeType) => ({
                        value: nodeType.id,
                        label: nodeType.label,
                        group: nodeType.group,
                        className: `memory-type-option ${memoryTypeClassName(nodeType.id, memoryTypes)}`,
                        style: nodeType.color
                          ? { '--memory-type-color': nodeType.color } as CSSProperties
                          : undefined
                      }))
                    ]}
                    onChange={setType}
                  />
                </div>
              </div>
            </div>
            {!memory ? <div className="memory-catalog-empty">Loading {memoryLabel.toLocaleLowerCase()}.</div> : null}
            {memory?.lastError ? <div className="memory-catalog-empty is-error">{memory.lastError}</div> : null}
            {memory && !memory.lastError && nodes.length === 0 ? <div className="memory-catalog-empty">No {memoryLabel.toLocaleLowerCase()} records yet.</div> : null}
            {memory && nodes.length > 0 && filteredNodes.length === 0 ? <div className="memory-catalog-empty">No records match these filters.</div> : null}
            {filteredNodes.length > 0 ? (
              <MainSideScrollRegion listClassName="memory-catalog-list memory-status-groups" stickToStart updateKey={updateKey}>
                {memoryStatusSections.map((statusSection) => (
                  <MemoryCatalogSection
                    expanded={expandedMemoryGroups.has(statusSection.id)}
                    key={statusSection.id}
                    label={statusSection.id}
                    displayLabel={statusSection.label}
                    memoryLabel={memoryLabel}
                    memoryTypes={memoryTypes}
                    nodes={statusSection.nodes}
                    selectedNodeId={selectedNodeId}
                    onExpand={() => setExpandedMemoryGroups((current) => new Set(current).add(statusSection.id))}
                    onOpen={(nodeId) => setSelectedNodeId(nodeId)}
                  />
                ))}
              </MainSideScrollRegion>
            ) : null}
          </>
        ) : activeView === 'runbooks' ? (
          <>
            <CatalogSearch value={runbookQuery} placeholder={`Find ${articleForLabel(runbookLabel)} ${singularizePresentationLabel(runbookLabel)}`} ariaLabel={`Search ${runbookLabel.toLocaleLowerCase()}`} onChange={setRunbookQuery} />
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
                selectedPath={visibleSelectedSubagentPath}
              />
              <SubagentCatalogSection
                agents={groupedSubagents.completed}
                label="Completed"
                onSelect={onSelectSubagent}
                selectedPath={visibleSelectedSubagentPath}
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
  label: string;
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
  enabledViews = RESEARCH_SIDE_VIEWS,
  openViews,
  onActivate,
  onClose,
  onOpen,
  labels,
  trailing,
  viewSpaceLabel = 'Session'
}: {
  activeView: ResearchSideView;
  enabledViews?: readonly ResearchSideView[];
  openViews: readonly ResearchSideView[];
  onActivate: (view: ResearchSideView) => void;
  onClose: (view: ResearchSideView) => void;
  onOpen: (view: ResearchSideView) => void;
  labels?: Partial<Record<ResearchSideView, string>>;
  trailing?: ReactNode;
  viewSpaceLabel?: string;
}): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const availableViews = availableResearchSideViews(openViews, enabledViews);

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
      <div className="research-side-view-tabs" role="tablist" aria-label={`Open ${viewSpaceLabel.toLocaleLowerCase()} detail views`}>
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
              <span>{researchSideViewLabel(view, labels)}</span>
            </button>
            <button
              type="button"
              className="research-side-view-tab-close"
              aria-label={`Close ${researchSideViewLabel(view, labels)}`}
              title={`Close ${researchSideViewLabel(view, labels)}`}
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
            aria-label={`Add ${viewSpaceLabel.toLocaleLowerCase()} detail view`}
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            title={`Add ${viewSpaceLabel.toLocaleLowerCase()} detail view`}
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
                  <span>{researchSideViewLabel(view, labels)}</span>
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

export function ResearchSideViewChooser({
  labels,
  onOpen,
  views = RESEARCH_SIDE_VIEWS,
  viewSpaceLabel = 'Session'
}: {
  labels?: Partial<Record<ResearchSideView, string>>;
  onOpen: (view: ResearchSideView) => void;
  views?: readonly ResearchSideView[];
  viewSpaceLabel?: string;
}): JSX.Element {
  return (
    <nav className="research-side-view-chooser" aria-label={`Choose a ${viewSpaceLabel.toLocaleLowerCase()} detail view`}>
      {views.map((view) => (
        <button type="button" key={view} onClick={() => onOpen(view)}>
          {researchSideViewIcon(view, 16)}
          <span>{researchSideViewLabel(view, labels)}</span>
        </button>
      ))}
    </nav>
  );
}

function researchSideViewLabel(
  view: ResearchSideView,
  labels?: Partial<Record<ResearchSideView, string>>
): string {
  return labels?.[view] ?? (view === 'memory' ? 'Memories' : view === 'runbooks' ? 'Runbooks' : 'Subagents');
}

interface CatalogMemoryTypeOption {
  id: string;
  label: string;
  group?: string;
  color?: string;
}

export function orderedCatalogMemoryTypes(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  definitions: readonly ResearchProfileMemoryType[]
): CatalogMemoryTypeOption[] {
  return [...new Set(nodes.map((node) => node.type))]
    .map((id) => ({ id, definition: memoryTypeDefinition(id, definitions) }))
    .sort((left, right) => {
      if (left.definition && right.definition) {
        const group = (left.definition.group ?? '').localeCompare(right.definition.group ?? '');
        return left.definition.order - right.definition.order
          || group
          || left.definition.name.localeCompare(right.definition.name)
          || left.id.localeCompare(right.id);
      }
      if (left.definition) return -1;
      if (right.definition) return 1;
      return left.id.localeCompare(right.id);
    })
    .map(({ id, definition }) => ({
      id,
      label: memoryTypeLabel(id, definitions),
      ...(definition?.group ? { group: definition.group } : {}),
      ...(definition?.color ? { color: definition.color } : {})
    }));
}

function legacyMemoryStatusSections(nodes: readonly HoneycrispMemoryNodeSummary[]): Array<{
  id: string;
  label: string;
  polarity: ResearchProfileMemoryStatus['polarity'];
  nodes: HoneycrispMemoryNodeSummary[];
}> {
  const groups = memoryCatalogStatusGroups(nodes);
  return [
    { id: 'suspected', label: 'Suspected', polarity: 'neutral', nodes: groups.suspected },
    { id: 'confirmed', label: 'Confirmed', polarity: 'positive', nodes: groups.confirmed },
    { id: 'rejected', label: 'Rejected', polarity: 'negative', nodes: groups.rejected }
  ];
}

export function pluralizePresentationLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed || /s$/iu.test(trimmed)) return trimmed;
  if (/[^aeiou]y$/iu.test(trimmed)) return `${trimmed.slice(0, -1)}ies`;
  return `${trimmed}s`;
}

function singularizePresentationLabel(label: string): string {
  const trimmed = label.trim();
  if (/ies$/iu.test(trimmed)) return `${trimmed.slice(0, -3)}y`;
  if (/s$/iu.test(trimmed)) return trimmed.slice(0, -1);
  return trimmed;
}

function articleForLabel(label: string): 'a' | 'an' {
  return /^[aeiou]/iu.test(singularizePresentationLabel(label)) ? 'an' : 'a';
}

function unknownProfileValueLabel(kind: string, id: string): string {
  const normalized = id.trim().replace(/[_-]+/gu, ' ') || 'unlabeled';
  return `Unknown ${kind} (${normalized})`;
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
  memoryTypes,
  selected,
  onOpen
}: {
  node: HoneycrispMemoryNodeSummary;
  memoryTypes?: readonly ResearchProfileMemoryType[];
  selected: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <article className={`memory-catalog-item type-${stateClass(node.type)} ${selected ? 'selected' : ''}`}>
      <button type="button" className="memory-catalog-toggle" aria-pressed={selected} onClick={onOpen}>
        <span className="memory-catalog-item-heading">
          <span className="memory-catalog-item-meta-line">
            <span className="memory-catalog-item-primary">
              <MemoryTypeIcon type={node.type} definitions={memoryTypes} />
              <span className="memory-catalog-item-name" title={node.title}>{node.title}</span>
            </span>
            <span className="memory-catalog-item-trailing">
              <MemoryTypeLabel type={node.type} definitions={memoryTypes} showDot={false} />
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
  displayLabel,
  memoryLabel = 'memory',
  memoryTypes,
  expanded,
  selectedNodeId,
  onExpand,
  onOpen
}: {
  nodes: readonly HoneycrispMemoryNodeSummary[];
  label: MemoryStatusGroup;
  displayLabel?: string;
  memoryLabel?: string;
  memoryTypes?: readonly ResearchProfileMemoryType[];
  expanded: boolean;
  selectedNodeId: string | null;
  onExpand: () => void;
  onOpen: (nodeId: string) => void;
}): JSX.Element {
  const { visibleNodes, hiddenCount } = memoryCatalogGroupPreview(nodes, expanded);
  const sectionLabel = displayLabel ?? traceLabel(label);
  return (
    <section className="memory-status-section" aria-label={`${nodes.length} ${sectionLabel}`} data-memory-status={label}>
      <h3>{nodes.length} {sectionLabel}</h3>
      <div className={`memory-status-items ${nodes.length === 0 ? 'is-empty' : ''}`}>
        {visibleNodes.length > 0 ? visibleNodes.map((node) => (
          <MemoryCatalogItem
            key={node.id}
            node={node}
            memoryTypes={memoryTypes}
            selected={selectedNodeId === node.id}
            onOpen={() => onOpen(node.id)}
          />
        )) : (
          <p className="memory-status-empty">No {sectionLabel.toLocaleLowerCase()} {pluralizePresentationLabel(memoryLabel).toLocaleLowerCase()} yet.</p>
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
  relationships,
  researchProfile = null
}: {
  node: HoneycrispMemoryNodeSummary;
  nodeById: Map<string, HoneycrispMemoryNodeSummary>;
  relationships: HoneycrispMemoryEdgeSummary[];
  researchProfile?: ResearchProfile | null;
}): JSX.Element {
  const memoryProfile = researchProfile?.memory;
  const statusDefinition = memoryProfile?.statuses.find((status) => status.id === node.status);
  const statusLabel = statusDefinition?.name
    ?? (memoryProfile ? unknownProfileValueLabel('status', node.status) : traceLabel(node.status));
  const relationDefinitions = new Map(memoryProfile?.relations?.map((relation) => [relation.id, relation]) ?? []);
  const evidenceKindDefinitions = new Map(memoryProfile?.evidenceKinds.map((kind) => [kind.id, kind]) ?? []);
  const workspaceNoun = researchProfile?.workspace.workspaceNoun ?? 'Workspace';
  const subjectNoun = researchProfile?.workspace.subjectNoun ?? 'Subject';
  const sessionLabel = researchProfile?.presentation.sessionLabel ?? 'Session';
  return (
    <article className={`memory-detail type-${stateClass(node.type)}`}>
      <header className="memory-detail-heading">
        <span className="memory-catalog-item-labels">
          <MemoryTypeLabel type={node.type} definitions={memoryProfile?.types} />
          <span className="memory-catalog-status">{statusLabel}</span>
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
          <div><dt>{subjectNoun}</dt><dd>{node.subjectName}</dd></div>
          <div><dt>{pluralizePresentationLabel(workspaceNoun)}</dt><dd>{node.workspaces.map((workspace) => workspace.name).join(', ') || 'None'}</dd></div>
          <div><dt>{pluralizePresentationLabel(sessionLabel)}</dt><dd>{node.sessionIds.join(', ') || 'None'}</dd></div>
        </dl>
        {node.assetIds.length > 0 ? <ChipGroup label="Assets" values={node.assetIds} /> : null}
        {node.tags.length > 0 ? <ChipGroup label="Tags" values={node.tags} /> : null}
        {node.evidenceRefs.length > 0 ? (
          <section className="memory-catalog-subsection" aria-label="References">
            <h4>References</h4>
            <div className="memory-reference-list">
              {node.evidenceRefs.map((reference) => (
                <article key={reference.id}>
                  <span>{evidenceKindDefinitions.get(reference.kind)?.name
                    ?? (memoryProfile ? unknownProfileValueLabel('evidence kind', reference.kind) : traceLabel(reference.kind))}</span>
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
                    <span>{outbound ? '→' : '←'} {relationDefinitions.get(relationship.relation)?.name
                      ?? (memoryProfile ? unknownProfileValueLabel('relation', relationship.relation) : traceLabel(relationship.relation))}</span>
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
