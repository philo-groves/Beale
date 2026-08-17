import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { ArrowLeft, BookOpen, Bot, ChevronDown, ChevronRight, Database, FileText, MessagesSquare, Plus, Search, X } from 'lucide-react';
import type {
  BreakoutRoomRecord,
  BreakoutRoomStatus,
  HoneycrispMemoryEdgeSummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispMemorySummary,
  HoneycrispReportDocument,
  HoneycrispReportSummary,
  HoneycrispRunbookDocument,
  HoneycrispRunbookSummary,
  ResearchProfile,
  ResearchProfileMemoryStatus,
  ResearchProfileMemoryType,
  ResearchProviderModelCatalog,
  RunDetail,
  RunStatus,
  TraceEventRecord
} from '@shared/types';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { ProviderIcon } from '../../app/ProviderIcon';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatSessionDateTime, stateClass, traceLabel } from '../../lib/formatting';
import { displayBreakoutRoomTitle } from '../../view-models/appHeader';
import { activeMemoryCount, filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogGroupPreview, memoryCatalogStatusGroups, memoryCatalogStatusSections, memoryCatalogUpdateKey, memoryTypeSummaryPresentation, sessionMemoryActivitySummary, sessionMemoryCatalogNodes, sessionMemoryTypeSummaries } from '../../view-models/memoryCatalog';
import type { MemoryStatusGroup, SessionMemoryTypeSummary } from '../../view-models/memoryCatalog';
import { filterSubagentSummaries, subagentCatalogGroups, subagentDisplayName, subagentOverviewForEvents, subagentOverviewFromSummaries, subagentOverviewStatusCountSummary, subagentStatusIconKind, subagentStatusLabel, subagentSummaries, traceEventsForSubagent } from '../../view-models/subagents';
import type { SubagentSummary } from '../../view-models/subagents';
import { runbookCatalogGroups, runbookDescriptionText } from '../../view-models/runbooks';
import { reportCatalogGroups } from '../../view-models/reports';
import type { ChatView } from '../../view-models/chatView';
import { EMPTY_SESSION_HEAT_PREFERENCES } from '../../view-models/sessionHeat';
import type { SessionHeatPreferences } from '../../view-models/sessionHeat';
import { researchProfileFeatureAvailability } from '../../view-models/researchProfileFeatures';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import type { TraceCategoryId } from '../../traceClassification';
import { CommentaryView } from '../commentary/CommentaryView';
import { SessionUsageSummary } from '../momentum/SessionUsageStatus';
import { BreakoutRoomView } from '../sessions/BreakoutRoomView';
import { SessionDurationMetric } from '../sessions/SessionMetrics';
import { MemoryTypeIcon, MemoryTypeLabel, memoryTypeClassName, memoryTypeDefinition, memoryTypeLabel } from './MemoryTypeLabel';
import { RunbookView } from './RunbookView';
import { ReportView } from './ReportView';
import { renderInlineCodeText } from '../traces/traceMarkup';
import { TraceView } from '../traces/TraceView';

const EMPTY_SUBAGENT_OVERVIEW = { count: 0, activeCount: 0, completedCount: 0 };

export type MemoryLevelFilter = 'session' | 'workspace' | 'subject';
export const DEFAULT_MEMORY_LEVEL_FILTER: MemoryLevelFilter = 'session';
export const DEFAULT_WORKSPACE_MEMORY_LEVEL_FILTER: MemoryLevelFilter = 'workspace';
export type RunbookScopeFilter = 'session' | 'workspace';
export const DEFAULT_RUNBOOK_SCOPE_FILTER: RunbookScopeFilter = 'session';
export const DEFAULT_WORKSPACE_RUNBOOK_SCOPE_FILTER: RunbookScopeFilter = 'workspace';
export type ResearchViewSpace = 'session' | 'workspace';
export type ResearchSideView = 'memory' | 'runbooks' | 'reports' | 'rooms' | 'subagents';

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

export const RESEARCH_SIDE_VIEWS: readonly ResearchSideView[] = ['memory', 'runbooks', 'reports', 'rooms', 'subagents'];

export function memoryLevelFiltersForViewSpace(viewSpace: ResearchViewSpace): MemoryLevelFilter[] {
  return viewSpace === 'workspace' ? ['workspace', 'subject'] : ['session', 'workspace', 'subject'];
}

export function runbookScopeFiltersForViewSpace(viewSpace: ResearchViewSpace): RunbookScopeFilter[] {
  return viewSpace === 'workspace' ? ['workspace'] : ['session', 'workspace'];
}

export function researchViewSpaceLabel(viewSpace: ResearchViewSpace): 'Session' | 'Workspace' {
  return viewSpace === 'workspace' ? 'Workspace' : 'Session';
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
        : view === 'reports'
          ? features.reports
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
  selectedReportId: string | null,
  selectedBreakoutRoomId: string | null,
  enabledViews: readonly ResearchSideView[]
): ResearchSideNavigationState {
  return researchSideNavigationForSelectedDetail(
    CLOSED_RESEARCH_SIDE_NAVIGATION,
    selectedSubagentPath,
    selectedRunbookId,
    selectedReportId,
    selectedBreakoutRoomId,
    enabledViews
  );
}

export function researchSideNavigationForSelectedDetail(
  state: ResearchSideNavigationState,
  selectedSubagentPath: string | null,
  selectedRunbookId: string | null,
  selectedReportId: string | null,
  selectedBreakoutRoomId: string | null,
  enabledViews: readonly ResearchSideView[]
): ResearchSideNavigationState {
  if (selectedBreakoutRoomId && enabledViews.includes('rooms')) {
    return researchSideNavigationReducer(state, { type: 'open', view: 'rooms' });
  }
  if (selectedSubagentPath && enabledViews.includes('subagents')) {
    return researchSideNavigationReducer(state, { type: 'open', view: 'subagents' });
  }
  if (selectedRunbookId && enabledViews.includes('runbooks')) {
    return researchSideNavigationReducer(state, { type: 'open', view: 'runbooks' });
  }
  if (selectedReportId && enabledViews.includes('reports')) {
    return researchSideNavigationReducer(state, { type: 'open', view: 'reports' });
  }
  return state;
}

export const ResearchSidePanel = memo(function ResearchSidePanel({
  detail,
  events,
  memory,
  researchProfile = null,
  sessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES,
  runId,
  runStatus,
  chatView = 'commentary',
  providerModelCatalog,
  selectedRunbook,
  selectedRunbookDocument,
  runbookLoading,
  runbookError,
  selectedReport = null,
  selectedReportDocument = null,
  reportLoading = false,
  reportError = null,
  selectedBreakoutRoomId = null,
  selectedSubagentPath,
  selectedRunbookId,
  selectedReportId = null,
  selectedTraceEventId,
  searchHighlightQuery,
  visibleTraceCategories,
  onOpenRunbook,
  onOpenReport = () => undefined,
  onOpenBreakoutRoom = () => undefined,
  onSelectSubagent,
  onBackToRunbooks,
  onBackToReports = () => undefined,
  onBackToRooms = () => undefined,
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
  sessionHeatPreferences?: SessionHeatPreferences;
  runId: string;
  runStatus: RunStatus | null;
  chatView?: ChatView;
  providerModelCatalog: ResearchProviderModelCatalog[];
  selectedRunbook: HoneycrispRunbookSummary | null;
  selectedRunbookDocument: HoneycrispRunbookDocument | null;
  runbookLoading: boolean;
  runbookError: string | null;
  selectedReport?: HoneycrispReportSummary | null;
  selectedReportDocument?: HoneycrispReportDocument | null;
  reportLoading?: boolean;
  reportError?: string | null;
  selectedBreakoutRoomId?: string | null;
  selectedSubagentPath: string | null;
  selectedRunbookId: string | null;
  selectedReportId?: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  visibleTraceCategories: TraceCategoryId[];
  onOpenRunbook: (runbookId: string) => void;
  onOpenReport?: (reportId: string) => void;
  onOpenBreakoutRoom?: (roomId: string) => void;
  onSelectSubagent: (path: string) => void;
  onBackToRunbooks: () => void;
  onBackToReports?: () => void;
  onBackToRooms?: () => void;
  onBackToSubagents: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  viewSpace?: ResearchViewSpace;
}): JSX.Element {
  const featureAvailability = researchProfileFeatureAvailability(researchProfile);
  const subagentsAvailable = featureAvailability.collaboration && viewSpace === 'session';
  const enabledViews = researchSideViewsForProfile(researchProfile)
    .filter((view) => viewSpace === 'session' || (view !== 'subagents' && view !== 'rooms'));
  const enabledViewsKey = enabledViews.join(':');
  const [navigation, dispatchNavigation] = useReducer(
    researchSideNavigationReducer,
    initialResearchSideNavigation(selectedSubagentPath, selectedRunbookId, selectedReportId, selectedBreakoutRoomId, enabledViews)
  );
  const runIdRef = useRef(runId);
  const [query, setQuery] = useState('');
  const [runbookQuery, setRunbookQuery] = useState('');
  const [reportQuery, setReportQuery] = useState('');
  const [roomQuery, setRoomQuery] = useState('');
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
  const restrictedNavigation = restrictResearchSideNavigation(navigation, enabledViews);
  const visibleNavigation = researchSideNavigationForSelectedDetail(
    restrictedNavigation,
    selectedSubagentPath,
    selectedRunbookId,
    selectedReportId,
    selectedBreakoutRoomId,
    enabledViews
  );
  const detailsOpen = expanded ?? visibleNavigation.openViews.length > 0;
  const activeView = visibleNavigation.activeView;
  const nodes = memory?.nodes ?? [];
  const runbooks = memory?.runbooks ?? [];
  const reports = memory?.reports ?? [];
  const memoryProfile = researchProfile?.memory;
  const memoryTypes = memoryProfile?.types ?? [];
  const memoryStatuses = memoryProfile?.statuses ?? [];
  const memoryLabel = 'Memory';
  const memoriesLabel = 'Memories';
  const runbookLabel = 'Runbooks';
  const reportLabel = 'Reports';
  const viewSpaceLabel = researchViewSpaceLabel(viewSpace);
  const summaryEvents: readonly TraceEventRecord[] = events.length > 0 ? events : detail?.traceEvents ?? [];
  const sessionMemoryNodes = useMemo(
    () => sessionMemoryCatalogNodes(nodes, runId),
    [nodes, runId]
  );
  const sessionMemories = useMemo(
    () => activeMemoryCount(sessionMemoryNodes, memoryProfile?.statuses),
    [memoryProfile?.statuses, sessionMemoryNodes]
  );
  const sessionMemoryActivity = useMemo(() => sessionMemoryActivitySummary(summaryEvents), [summaryEvents]);
  const sessionMemoryTypes = useMemo(
    () => memoryTypeSummaryPresentation(
      sessionMemoryTypeSummaries(sessionMemoryNodes, memoryProfile),
      memoryProfile,
      researchProfile?.id,
      sessionHeatPreferences.heatOverrides
    ),
    [memoryProfile, researchProfile?.id, sessionHeatPreferences.heatOverrides, sessionMemoryNodes]
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
  const sessionReports = useMemo(() => reports.filter((report) => report.sessionId === runId), [reports, runId]);
  const sessionReportRevisions = useMemo(() => sessionReports.reduce((count, report) => count + report.revision, 0), [sessionReports]);
  const breakoutRooms = detail?.breakoutRooms ?? [];
  const activeBreakoutRoomCount = useMemo(
    () => breakoutRooms.filter((room) => room.status === 'active').length,
    [breakoutRooms]
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
  const workspaceMemoryTypes = useMemo(
    () => memoryTypeSummaryPresentation(
      sessionMemoryTypeSummaries(workspaceMemoryNodes, memoryProfile),
      memoryProfile,
      researchProfile?.id,
      sessionHeatPreferences.heatOverrides
    ),
    [memoryProfile, researchProfile?.id, sessionHeatPreferences.heatOverrides, workspaceMemoryNodes]
  );
  const workspaceRunbooks = useMemo(
    () => runbooks.filter((runbook) => workspaceId !== null && runbook.workspaceId === workspaceId),
    [runbooks, workspaceId]
  );
  const workspaceRunbookRevisions = useMemo(
    () => workspaceRunbooks.reduce((count, runbook) => count + runbook.revision, 0),
    [workspaceRunbooks]
  );
  const workspaceReports = useMemo(
    () => reports.filter((report) => workspaceId !== null && report.workspaceId === workspaceId),
    [reports, workspaceId]
  );
  const workspaceReportRevisions = useMemo(
    () => workspaceReports.reduce((count, report) => count + report.revision, 0),
    [workspaceReports]
  );
  const needsFullSubagents = subagentsAvailable && (detailsOpen || selectedSubagentPath !== null);
  const subagents = useMemo(
    () => needsFullSubagents ? subagentSummaries(summaryEvents, runStatus, chatView) : [],
    [chatView, needsFullSubagents, runStatus, summaryEvents]
  );
  const subagentOverview = useMemo(
    () => {
      if (!subagentsAvailable) return EMPTY_SUBAGENT_OVERVIEW;
      return needsFullSubagents ? subagentOverviewFromSummaries(subagents) : subagentOverviewForEvents(summaryEvents, runStatus);
    },
    [needsFullSubagents, runStatus, subagents, subagentsAvailable, summaryEvents]
  );
  const filteredSubagents = useMemo(
    () => needsFullSubagents ? filterSubagentSummaries(subagents, subagentQuery) : [],
    [needsFullSubagents, subagentQuery, subagents]
  );
  const groupedSubagents = useMemo(() => subagentCatalogGroups(filteredSubagents), [filteredSubagents]);
  const visibleSelectedSubagentPath = subagentsAvailable ? selectedSubagentPath : null;
  const visibleSelectedRunbookId = featureAvailability.runbooks ? selectedRunbookId : null;
  const visibleSelectedRunbook = visibleSelectedRunbookId ? selectedRunbook : null;
  const visibleSelectedReportId = featureAvailability.reports ? selectedReportId : null;
  const visibleSelectedReport = visibleSelectedReportId ? selectedReport : null;
  const visibleSelectedBreakoutRoomId = subagentsAvailable ? selectedBreakoutRoomId : null;
  const selectedBreakoutRoom = visibleSelectedBreakoutRoomId
    ? breakoutRooms.find((room) => room.id === visibleSelectedBreakoutRoomId) ?? null
    : null;
  const selectedSubagent = visibleSelectedSubagentPath
    ? subagents.find((subagent) => subagent.path === visibleSelectedSubagentPath) ?? null
    : null;
  const selectedSubagentName = subagentDisplayName(visibleSelectedSubagentPath
    ? selectedSubagent?.name
      ?? visibleSelectedSubagentPath.split('/').filter(Boolean).at(-1)
      ?? visibleSelectedSubagentPath
    : '');
  const selectedRunbookName = visibleSelectedRunbook?.title
    ?? runbooks.find((runbook) => runbook.id === visibleSelectedRunbookId)?.title
    ?? 'Loading runbook';
  const selectedReportName = visibleSelectedReport?.title
    ?? reports.find((report) => report.id === visibleSelectedReportId)?.title
    ?? 'Loading report';
  const selectedBreakoutRoomName = displayBreakoutRoomTitle(selectedBreakoutRoom?.title);
  const selectedSubagentEvents = useMemo(
    () => traceEventsForSubagent(events, visibleSelectedSubagentPath),
    [events, visibleSelectedSubagentPath]
  );
  const subagentStatusCounts = useMemo(() => subagentOverviewStatusCountSummary(subagentOverview), [subagentOverview]);
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
  const filteredReports = useMemo(
    () => filterReportCatalog(reports, runbookScope, runId, workspaceId, reportQuery),
    [reportQuery, reports, runId, runbookScope, workspaceId]
  );
  const groupedReports = useMemo(() => reportCatalogGroups(filteredReports), [filteredReports]);
  const filteredBreakoutRooms = useMemo(
    () => filterBreakoutRoomCatalog(breakoutRooms, roomQuery),
    [breakoutRooms, roomQuery]
  );
  const groupedBreakoutRooms = useMemo(
    () => breakoutRoomCatalogGroups(filteredBreakoutRooms),
    [filteredBreakoutRooms]
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNode = featureAvailability.memory && selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const relationshipsByNodeId = useMemo(() => groupMemoryRelationships(memory?.edges ?? []), [memory?.edges]);
  const updateKey = memoryCatalogUpdateKey(filteredNodes);
  const runbookUpdateKey = filteredRunbooks.map((runbook) => `${runbook.id}:${runbook.updatedAt}`).join('|');
  const reportUpdateKey = filteredReports.map((report) => `${report.id}:${report.updatedAt}`).join('|');
  const roomUpdateKey = filteredBreakoutRooms.map((room) => `${room.id}:${room.status}:${room.closedAt ?? room.createdAt}`).join('|');
  const hasSessionMetadata = Boolean(detail);
  const hasSessionResources = (featureAvailability.runbooks && sessionRunbooks > 0)
    || (featureAvailability.reports && sessionReports.length > 0)
    || (featureAvailability.collaboration && (breakoutRooms.length > 0 || subagentOverview.count > 0));
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
    if (selectedBreakoutRoomId && subagentsAvailable) {
      dispatchNavigation({ type: 'open', view: 'rooms' });
      return;
    }
    if (selectedSubagentPath && subagentsAvailable) {
      dispatchNavigation({ type: 'open', view: 'subagents' });
      return;
    }
    if (selectedRunbookId && featureAvailability.runbooks) {
      dispatchNavigation({ type: 'open', view: 'runbooks' });
      return;
    }
    if (selectedReportId && featureAvailability.reports) {
      dispatchNavigation({ type: 'open', view: 'reports' });
    }
  }, [
    featureAvailability.reports,
    featureAvailability.runbooks,
    selectedReportId,
    selectedRunbookId,
    selectedBreakoutRoomId,
    selectedSubagentPath,
    subagentsAvailable
  ]);

  useEffect(() => {
    if (!featureAvailability.runbooks && selectedRunbookId) onBackToRunbooks();
    if (!featureAvailability.reports && selectedReportId) onBackToReports();
    if (!subagentsAvailable && selectedBreakoutRoomId) onBackToRooms();
    if (!subagentsAvailable && selectedSubagentPath) onBackToSubagents();
  }, [
    featureAvailability.runbooks,
    featureAvailability.reports,
    onBackToRunbooks,
    onBackToReports,
    onBackToRooms,
    onBackToSubagents,
    selectedRunbookId,
    selectedReportId,
    selectedBreakoutRoomId,
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
        <aside className="main-session-side session-summary-panel workspace-summary-panel" aria-label="Workspace summary">
          <section className="session-summary-card">
            <header className="session-summary-heading">
              <h2 className="session-summary-title">Workspace</h2>
            </header>
            <section className="session-summary-items session-summary-resources" aria-label="Workspace resources">
              {featureAvailability.runbooks && workspaceRunbooks.length > 0 ? (
                <button type="button" className="session-summary-item" onClick={() => openDetails('runbooks')}>
                  <BookOpen size={15} aria-hidden="true" />
                  <span>{workspaceRunbooks.length} {workspaceRunbooks.length === 1 ? 'Runbook' : runbookLabel}</span>
                  <span className="session-summary-meta">{workspaceRunbookRevisions} Updates</span>
                  <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
                </button>
              ) : null}
              {featureAvailability.reports && workspaceReports.length > 0 ? (
                <button type="button" className="session-summary-item" onClick={() => openDetails('reports')}>
                  <FileText size={15} aria-hidden="true" />
                  <span>{workspaceReports.length} {workspaceReports.length === 1 ? 'Report' : 'Reports'}</span>
                  <span className="session-summary-meta">{workspaceReportRevisions} Updates</span>
                  <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
                </button>
              ) : null}
              {featureAvailability.memory ? (
                <>
                  <button type="button" className="session-summary-item" onClick={() => openDetails('memory')}>
                    <Database size={15} aria-hidden="true" />
                    <span>{workspaceMemories} {workspaceMemories === 1 ? memoryLabel : memoriesLabel}</span>
                    <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
                  </button>
                  <MemoryTypeSummaryRows
                    key={`workspace:${workspaceId ?? runId}`}
                    summaries={workspaceMemoryTypes.summaries}
                    defaultVisibleCount={workspaceMemoryTypes.defaultVisibleCount}
                  />
                </>
              ) : null}
            </section>
          </section>
        </aside>
      );
    }
    return (
      <aside className="main-session-side session-summary-panel" aria-label="Session summary">
        <section className="session-summary-card">
          <header className="session-summary-heading">
            <h2 className="session-summary-title">Session</h2>
            {detail ? <SessionDurationMetric detail={detail} className="session-summary-duration" /> : null}
          </header>
          <section className="session-summary-section session-summary-metadata" aria-label="Session metadata">
            {detail ? <SessionUsageSummary detail={detail} /> : null}
          </section>
          {hasSessionMetadata && (hasSessionResources || hasSessionMemories) ? <hr className="session-summary-divider" /> : null}
          <section className="session-summary-items session-summary-resources" aria-label="Session resources">
            {featureAvailability.runbooks && sessionRunbooks > 0 ? (
              <button type="button" className="session-summary-item" onClick={() => openDetails('runbooks')}>
                <BookOpen size={15} aria-hidden="true" />
                <span>{sessionRunbooks} {sessionRunbooks === 1 ? 'Runbook' : runbookLabel}</span>
                <span className="session-summary-meta">{sessionRunbookRevisions} Updates</span>
                <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
              </button>
            ) : null}
            {featureAvailability.reports && sessionReports.length > 0 ? (
              <button type="button" className="session-summary-item" onClick={() => openDetails('reports')}>
                <FileText size={15} aria-hidden="true" />
                <span>{sessionReports.length} {sessionReports.length === 1 ? 'Report' : 'Reports'}</span>
                <span className="session-summary-meta">{sessionReportRevisions} Updates</span>
                <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
              </button>
            ) : null}
            {featureAvailability.collaboration && breakoutRooms.length > 0 ? (
              <button type="button" className="session-summary-item" onClick={() => openDetails('rooms')}>
                <MessagesSquare size={15} aria-hidden="true" />
                <span>{breakoutRooms.length} {breakoutRooms.length === 1 ? 'Room' : 'Rooms'}</span>
                {activeBreakoutRoomCount > 0 ? <span className="session-summary-meta">{activeBreakoutRoomCount} Active</span> : null}
                <ChevronRight className="session-summary-chevron" size={15} aria-hidden="true" />
              </button>
            ) : null}
            {featureAvailability.collaboration && subagentOverview.count > 0 ? (
              <button type="button" className="session-summary-item" onClick={() => openDetails('subagents')}>
                <Bot size={15} aria-hidden="true" />
                <span>{subagentOverview.count} {subagentOverview.count === 1 ? 'Subagent' : 'Subagents'}</span>
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
              <MemoryTypeSummaryRows
                key={`session:${runId}`}
                summaries={sessionMemoryTypes.summaries}
                defaultVisibleCount={sessionMemoryTypes.defaultVisibleCount}
              />
            </section>
          ) : null}
        </section>
      </aside>
    );
  }

  if (!activeView) {
    return (
      <aside className="main-session-side memory-catalog view-empty" aria-label={`${viewSpaceLabel} details`}>
        <ResearchSideViewChooser viewSpaceLabel={viewSpaceLabel} views={enabledViews} labels={{ memory: memoriesLabel, runbooks: runbookLabel, reports: reportLabel }} onOpen={openDetails} />
      </aside>
    );
  }

  return (
    <>
      <aside className={`main-session-side memory-catalog view-${activeView} ${visibleSelectedBreakoutRoomId || visibleSelectedSubagentPath || visibleSelectedRunbookId || visibleSelectedReportId || selectedNode ? 'has-nested-view' : ''}`} aria-label={`${viewSpaceLabel} details`}>
        {visibleSelectedBreakoutRoomId ? (
          <ResearchSideNestedHeader label="Rooms" name={selectedBreakoutRoomName} onBack={onBackToRooms} />
        ) : visibleSelectedSubagentPath ? (
          <ResearchSideNestedHeader
            label="Subagents"
            leading={selectedSubagent ? (
              <SubagentProviderIcon provider={selectedSubagent.provider} model={selectedSubagent.model} />
            ) : null}
            name={selectedSubagentName}
            onBack={onBackToSubagents}
          />
        ) : visibleSelectedRunbookId ? (
          <ResearchSideNestedHeader label={runbookLabel} name={selectedRunbookName} onBack={onBackToRunbooks} />
        ) : visibleSelectedReportId ? (
          <ResearchSideNestedHeader label={reportLabel} name={selectedReportName} onBack={onBackToReports} />
        ) : selectedNode ? (
          <ResearchSideNestedHeader label={memoriesLabel} name={selectedNode.title} onBack={() => setSelectedNodeId(null)} />
        ) : (
          <ResearchSideViewTabs
            activeView={activeView}
            enabledViews={enabledViews}
            labels={{ memory: memoriesLabel, runbooks: runbookLabel, reports: reportLabel }}
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
                    ? researchViewSpaceLabel('session')
                    : filter === 'workspace'
                      ? researchViewSpaceLabel('workspace')
                      : researchProfile?.workspace.subjectNoun ?? 'Subject'
                }))}
                onChange={(value) => setScope(value as MemoryLevelFilter)}
              />
            ) : activeView === 'runbooks' || activeView === 'reports' ? (
              <FloatingTextPicker
                className="memory-catalog-filter memory-catalog-level-filter research-side-runbook-scope"
                value={runbookScope}
                title={`${activeView === 'reports' ? 'Report' : 'Runbook'} scope filter`}
                ariaLabel={`${activeView === 'reports' ? 'Report' : 'Runbook'} scope filter`}
                options={runbookScopeFiltersForViewSpace(viewSpace).map((filter) => ({
                  value: filter,
                  label: researchViewSpaceLabel(filter)
                }))}
                onChange={(value) => setRunbookScope(value as RunbookScopeFilter)}
              />
            ) : null}
          />
        )}

        {visibleSelectedBreakoutRoomId ? (
          <div className="research-side-nested-content breakout-room-detail-content">
            <BreakoutRoomView
              detail={detail}
              events={events}
              providerModelCatalog={providerModelCatalog}
              roomId={visibleSelectedBreakoutRoomId}
              onSelectSubagent={onSelectSubagent}
            />
          </div>
        ) : visibleSelectedSubagentPath ? (
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
        ) : visibleSelectedReport ? (
          <div className="research-side-nested-content runbook-detail-content">
            <ReportView
              document={selectedReportDocument}
              error={reportError}
              loading={reportLoading}
              report={visibleSelectedReport}
            />
          </div>
        ) : visibleSelectedReportId ? (
          <div className="memory-catalog-empty">Loading report.</div>
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
                {memoryStatusSections.filter((statusSection) => statusSection.nodes.length > 0).map((statusSection) => (
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
              {filteredRunbooks.length === 0 ? (
                <p className="runbook-catalog-empty">
                  {runbookQuery.trim() ? 'No runbooks match this search.' : 'No runbooks yet.'}
                </p>
              ) : (
                <>
                  {groupedRunbooks.active.length > 0 ? (
                    <RunbookCatalogSection
                      label="Active"
                      runbooks={groupedRunbooks.active}
                      selectedRunbookId={selectedRunbookId}
                      onOpen={onOpenRunbook}
                    />
                  ) : null}
                  {groupedRunbooks.archived.length > 0 ? (
                    <RunbookCatalogSection
                      label="Archived"
                      runbooks={groupedRunbooks.archived}
                      selectedRunbookId={selectedRunbookId}
                      onOpen={onOpenRunbook}
                    />
                  ) : null}
                </>
              )}
            </MainSideScrollRegion>
          </>
        ) : activeView === 'reports' ? (
          <>
            <CatalogSearch value={reportQuery} placeholder="Find a Report" ariaLabel="Search reports" onChange={setReportQuery} />
            <MainSideScrollRegion listClassName="memory-catalog-list runbook-catalog-list report-catalog-list" stickToStart updateKey={reportUpdateKey}>
              {filteredReports.length === 0 ? (
                <p className="runbook-catalog-empty">
                  {reportQuery.trim() ? 'No reports match this search.' : 'No reports yet.'}
                </p>
              ) : (
                <>
                  {groupedReports.complete.length > 0 ? (
                    <ReportCatalogSection
                      label="Complete"
                      reports={groupedReports.complete}
                      selectedReportId={selectedReportId}
                      onOpen={onOpenReport}
                    />
                  ) : null}
                  {groupedReports.stale.length > 0 ? (
                    <ReportCatalogSection
                      label="Stale"
                      reports={groupedReports.stale}
                      selectedReportId={selectedReportId}
                      onOpen={onOpenReport}
                    />
                  ) : null}
                </>
              )}
            </MainSideScrollRegion>
          </>
        ) : activeView === 'rooms' ? (
          <>
            <CatalogSearch value={roomQuery} placeholder="Find a Room" ariaLabel="Search rooms" onChange={setRoomQuery} />
            <MainSideScrollRegion listClassName="memory-catalog-list runbook-catalog-list breakout-room-catalog-list" stickToStart updateKey={roomUpdateKey}>
              {filteredBreakoutRooms.length === 0 ? (
                <p className="runbook-catalog-empty">
                  {roomQuery.trim() ? 'No rooms match this search.' : 'No rooms yet.'}
                </p>
              ) : (
                groupedBreakoutRooms.map((group) => (
                  <BreakoutRoomCatalogSection
                    key={group.status}
                    label={breakoutRoomStatusLabel(group.status)}
                    rooms={group.rooms}
                    selectedRoomId={visibleSelectedBreakoutRoomId}
                    onOpen={onOpenBreakoutRoom}
                  />
                ))
              )}
            </MainSideScrollRegion>
          </>
        ) : (
          <>
            <CatalogSearch value={subagentQuery} placeholder="Find a Subagent" ariaLabel="Search subagents" onChange={setSubagentQuery} />
            <MainSideScrollRegion
              listClassName="subagent-catalog-list"
              stickToStart
              updateKey={filteredSubagents.map((agent) => `${agent.path}:${agent.provider}:${agent.model}:${agent.status}:${agent.createdAt}:${agent.lastActiveAt}:${agent.latestMessage}`).join('|')}
            >
              {filteredSubagents.length === 0 ? (
                <p className="subagent-catalog-empty">
                  {subagentQuery.trim() ? 'No subagents match this search.' : 'No subagents yet.'}
                </p>
              ) : (
                <>
                  {groupedSubagents.active.length > 0 ? (
                    <SubagentCatalogSection
                      agents={groupedSubagents.active}
                      label="Active"
                      onSelect={onSelectSubagent}
                      selectedPath={visibleSelectedSubagentPath}
                    />
                  ) : null}
                  {groupedSubagents.completed.length > 0 ? (
                    <SubagentCatalogSection
                      agents={groupedSubagents.completed}
                      label="Completed"
                      onSelect={onSelectSubagent}
                      selectedPath={visibleSelectedSubagentPath}
                    />
                  ) : null}
                </>
              )}
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

export function filterReportCatalog(
  reports: readonly HoneycrispReportSummary[],
  scope: RunbookScopeFilter,
  sessionId: string,
  workspaceId: string | null,
  query = ''
): HoneycrispReportSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return reports.filter((report) => {
    const inScope = scope === 'session'
      ? report.sessionId === sessionId
      : workspaceId !== null && report.workspaceId === workspaceId;
    if (!inScope || !normalizedQuery) return inScope;
    return [report.id, report.title, report.summary, report.status, report.workspaceName, report.subjectName ?? '']
      .join('\n').toLocaleLowerCase().includes(normalizedQuery);
  });
}

export function filterBreakoutRoomCatalog(
  rooms: readonly BreakoutRoomRecord[],
  query = ''
): BreakoutRoomRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return rooms
    .filter((room) => !normalizedQuery || [room.title, room.name, room.purpose, room.kind, room.status]
      .join('\n')
      .toLocaleLowerCase()
      .includes(normalizedQuery))
    .sort((left, right) => breakoutRoomTimestamp(right).localeCompare(breakoutRoomTimestamp(left)) || left.id.localeCompare(right.id));
}

export function breakoutRoomCatalogGroups(
  rooms: readonly BreakoutRoomRecord[]
): Array<{ status: BreakoutRoomStatus; rooms: BreakoutRoomRecord[] }> {
  const statusOrder: readonly BreakoutRoomStatus[] = ['active', 'completed', 'interrupted', 'errored'];
  return statusOrder
    .map((status) => ({ status, rooms: rooms.filter((room) => room.status === status) }))
    .filter((group) => group.rooms.length > 0);
}

function breakoutRoomTimestamp(room: BreakoutRoomRecord): string {
  return room.closedAt ?? room.createdAt;
}

function breakoutRoomStatusLabel(status: BreakoutRoomStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'completed') return 'Completed';
  if (status === 'interrupted') return 'Interrupted';
  return 'Errored';
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

function MemoryTypeSummaryRows({ summaries, defaultVisibleCount }: {
  summaries: readonly SessionMemoryTypeSummary[];
  defaultVisibleCount: number;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const visibleSummaries = summaries.slice(0, defaultVisibleCount);
  const hiddenSummaries = summaries.slice(defaultVisibleCount);
  return (
    <div className="session-memory-type-list">
      {visibleSummaries.map((memoryType) => <MemoryTypeSummaryRow memoryType={memoryType} key={memoryType.type} />)}
      {hiddenSummaries.length > 0 ? (
        <>
          <div
            className={`session-memory-type-overflow ${expanded ? 'expanded' : ''}`.trim()}
            aria-hidden={!expanded}
            inert={!expanded}
          >
            <div className="session-memory-type-overflow-inner">
              {hiddenSummaries.map((memoryType) => <MemoryTypeSummaryRow memoryType={memoryType} key={memoryType.type} />)}
            </div>
          </div>
          <button
            type="button"
            className="session-memory-type-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Show less' : `Show ${hiddenSummaries.length} more`}
          </button>
        </>
      ) : null}
    </div>
  );
}

function MemoryTypeSummaryRow({ memoryType }: { memoryType: SessionMemoryTypeSummary }): JSX.Element {
  return (
    <div className="session-memory-type-item">
      <span>{memoryType.countLabel}</span>
      {memoryType.statusLabel ? <span className="session-summary-meta">{memoryType.statusLabel}</span> : null}
    </div>
  );
}

export function ResearchSideNestedHeader({
  label,
  leading,
  name,
  onBack
}: {
  label: string;
  leading?: ReactNode;
  name: string;
  onBack: () => void;
}): JSX.Element {
  return (
    <header className="research-side-nested-header">
      <button type="button" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        <span>Back to {label}</span>
      </button>
      {leading}
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
      <div className="research-side-view-tabs research-side-view-tabs-scrollable" role="tablist" aria-label={`Open ${viewSpaceLabel.toLocaleLowerCase()} detail views`}>
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
  return labels?.[view] ?? (view === 'memory'
    ? 'Memories'
    : view === 'runbooks'
      ? 'Runbooks'
      : view === 'reports'
        ? 'Reports'
        : view === 'rooms'
          ? 'Rooms'
          : 'Subagents');
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
  if (view === 'reports') return <FileText size={size} aria-hidden="true" />;
  if (view === 'rooms') return <MessagesSquare size={size} aria-hidden="true" />;
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

export function ReportCatalogItem({ report, selected, onOpen }: {
  report: HoneycrispReportSummary;
  selected: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`runbook-catalog-item report-catalog-item report-status-${stateClass(report.status)} ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onOpen}
    >
      <span className="runbook-catalog-heading">
        <span className="runbook-catalog-primary">
          <FileText className="runbook-catalog-icon" size={16} aria-hidden="true" />
          <span className="runbook-catalog-name">{report.title}</span>
        </span>
        <span className="runbook-catalog-heading-trailing">
          <span className="runbook-catalog-status">{traceLabel(report.status)}</span>
          <time dateTime={report.updatedAt} title={formatSessionDateTime(report.updatedAt)}>{formatSessionDateTime(report.updatedAt)}</time>
        </span>
      </span>
      {report.summary ? <span className="runbook-catalog-purpose">{runbookDescriptionText(report.summary)}</span> : null}
    </button>
  );
}

function ReportCatalogSection({ reports, label, selectedReportId, onOpen }: {
  reports: readonly HoneycrispReportSummary[];
  label: 'Complete' | 'Stale';
  selectedReportId: string | null;
  onOpen: (reportId: string) => void;
}): JSX.Element {
  return (
    <section className="runbook-catalog-section report-catalog-section" aria-label={`${reports.length} ${label}`}>
      <h3>{reports.length} {label}</h3>
      <div className={`runbook-catalog-items ${reports.length === 0 ? 'is-empty' : ''}`}>
        {reports.length > 0 ? reports.map((report) => (
          <ReportCatalogItem key={report.id} report={report} selected={selectedReportId === report.id} onOpen={() => onOpen(report.id)} />
        )) : (
          <p className="runbook-catalog-empty">{label === 'Complete' ? 'No complete reports yet.' : 'No stale reports yet.'}</p>
        )}
      </div>
    </section>
  );
}

export function BreakoutRoomCatalogItem({ room, selected, onOpen }: {
  room: BreakoutRoomRecord;
  selected: boolean;
  onOpen: () => void;
}): JSX.Element {
  const timestamp = breakoutRoomTimestamp(room);
  return (
    <button
      type="button"
      className={`runbook-catalog-item breakout-room-catalog-item room-status-${stateClass(room.status)} ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onOpen}
    >
      <span className="runbook-catalog-heading">
        <span className="runbook-catalog-primary">
          <MessagesSquare className="runbook-catalog-icon" size={16} aria-hidden="true" />
          <span className="runbook-catalog-name">{displayBreakoutRoomTitle(room.title)}</span>
        </span>
        <span className="runbook-catalog-heading-trailing">
          <span className="runbook-catalog-status">{breakoutRoomStatusLabel(room.status)}</span>
          <time dateTime={timestamp} title={formatSessionDateTime(timestamp)}>{formatSessionDateTime(timestamp)}</time>
        </span>
      </span>
      {room.purpose ? <span className="runbook-catalog-purpose">{runbookDescriptionText(room.purpose)}</span> : null}
    </button>
  );
}

function BreakoutRoomCatalogSection({ rooms, label, selectedRoomId, onOpen }: {
  rooms: readonly BreakoutRoomRecord[];
  label: string;
  selectedRoomId: string | null;
  onOpen: (roomId: string) => void;
}): JSX.Element {
  return (
    <section className="runbook-catalog-section breakout-room-catalog-section" aria-label={`${rooms.length} ${label}`}>
      <h3>{rooms.length} {label}</h3>
      <div className="runbook-catalog-items">
        {rooms.map((room) => (
          <BreakoutRoomCatalogItem
            key={room.id}
            room={room}
            selected={selectedRoomId === room.id}
            onOpen={() => onOpen(room.id)}
          />
        ))}
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
              <SubagentProviderIcon provider={agent.provider} model={agent.model} />
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

function SubagentProviderIcon({
  provider,
  model
}: Pick<SubagentSummary, 'provider' | 'model'>): JSX.Element {
  const modelLabel = model ?? 'Unknown model';
  return (
    <span className="subagent-provider-icon" aria-label={`Model: ${modelLabel}`} title={modelLabel}>
      <ProviderIcon provider={provider ?? model} size={15} aria-hidden="true" />
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
          <span>Update {node.revision}</span>
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
