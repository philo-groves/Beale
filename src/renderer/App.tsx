import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties } from 'react';
import { devInstrumentation, useDevInputLatencyProbe, useDevRenderProbe } from './devInstrumentation';
import type {
  ApprovalRecord,
  DeveloperSettings,
  ShellOptions,
  HoneycrispMemoryDirectorySummary,
  HoneycrispRunbookDocument,
  NativeMenuAction,
  NotificationRecord,
  OpenAiOAuthStartResult,
  PolicyReviewDecision,
  ResearchModelSelection,
  ResearchProviderId,
  ResearchProviderOAuthStartResult,
  ResearchProviderModelCatalog,
  ResearchProviderStatus,
  WorkspaceOnboardingProgressUpdate,
  RunDetail,
  SessionTranscriptSearchResult,
  SteeringAction,
  WorkspaceSnapshot
} from '@shared/types';
import { AppModals } from './app/AppModals';
import { AppBackgroundPulses } from './app/AppBackgroundPulses';
import { StatusBar } from './app/StatusBar';
import { TopBar } from './app/TopBar';
import { NotificationStack, type WorkspaceAlert } from './features/notifications/Notifications';
import { WorkspaceSidebar } from './features/workspaces/WorkspaceSidebar';
import { MainSessionWorkspace } from './features/sessions/MainSessionWorkspace';
import { pendingShellApproval, ShellApprovalModal } from './features/sessions/ShellApprovalModal';
import { subagentSummaries, traceEventsForSubagent } from './view-models/subagents';
import type { SettingsSection } from './features/settings/SettingsModal';
import { ALL_TRACE_CATEGORY_IDS, DEFAULT_TRACE_CATEGORY_IDS } from './features/traces/traceVisuals';
import { useInsetScrollbarActivation } from './hooks/useInsetScrollbarActivation';
import { useWorkspaceActions, type WorkspaceActionOptions } from './hooks/useWorkspaceActions';
import { useWorkspaceOverlayState } from './hooks/useWorkspaceOverlayState';
import { useProfilingRuntime } from './hooks/useProfilingRuntime';
import { useResizableSidebar } from './hooks/useResizableSidebar';
import { useRunDetailPolling } from './hooks/useRunDetailPolling';
import { useResearchGoalSuggestions } from './hooks/useResearchGoalSuggestions';
import { useSidebarPerformanceProbe } from './hooks/useSidebarPerformanceProbe';
import { useTraceSelection } from './hooks/useTraceSelection';
import { useWorkspaceRuntime } from './hooks/useWorkspaceRuntime';
import type { TraceCategoryId } from './traceClassification';
import { errorMessage } from './lib/errors';
import { dispatchPasteSteeringText, readClipboardText } from './app/menuActions';
import {
  activeRunDetailForSelection,
  appShellClassName,
  selectedRunStatus,
  windowControlPlatformForState
} from './view-models/appShell';
import type { WorkspaceOnboardingFormState } from './view-models/workspaceOnboarding';
import { researchMomentumForDetail } from './view-models/researchMomentum';
import { sessionHeatForDetail } from './view-models/sessionHeat';
import { buildTraceDisplayEvents, type TraceDisplayEvent } from './view-models/traceDisplay';
import { runDetailMetricDetail, shortMetricId } from './view-models/runDetailUpdates';

export function App(): JSX.Element {
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleError = useCallback((message: string) => setError(message), []);
  const {
    snapshot,
    workspaceRegistry,
    hostEnvironment,
    windowChromeState,
    openAiStatus,
    selectedRunId,
    setWorkspaceRegistry,
    setOpenAiStatus,
    setSelectedRunId,
    applySnapshot,
    loadSnapshot,
    loadWorkspaceRegistry
  } = useWorkspaceRuntime(handleError);
  const researchGoalSuggestionState = useResearchGoalSuggestions(
    snapshot,
    openAiStatus?.configured ?? snapshot?.openAi.configured ?? false
  );
  const [openAiOAuthResult, setOpenAiOAuthResult] = useState<OpenAiOAuthStartResult | null>(null);
  const [researchProviderStatuses, setResearchProviderStatuses] = useState<ResearchProviderStatus[]>([]);
  const [researchProviderModelCatalog, setResearchProviderModelCatalog] = useState<ResearchProviderModelCatalog[]>([]);
  const [researchProviderOAuthResults, setResearchProviderOAuthResults] = useState<Partial<Record<ResearchProviderId, ResearchProviderOAuthStartResult>>>({});
  const [developerSettings, setDeveloperSettings] = useState<DeveloperSettings | null>(null);
  const [shellOptions, setShellOptions] = useState<ShellOptions | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceOnboardingFormState | null>(null);
  const [workspaceOnboardingProgress, setWorkspaceOnboardingProgress] = useState<WorkspaceOnboardingProgressUpdate | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingSearchTarget, setPendingSearchTarget] = useState<SessionTranscriptSearchResult | null>(null);
  const [traceSearchHighlightQuery, setTraceSearchHighlightQuery] = useState('');
  const [profilingOpen, setProfilingOpen] = useState(false);
  const [traceFilterOpen, setTraceFilterOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationRecord | null>(null);
  const [workspaceAlerts, setWorkspaceAlerts] = useState<WorkspaceAlert[]>([]);
  const [sessionSummaryDetail, setSessionSummaryDetail] = useState<RunDetail | null>(null);
  const [visibleTraceCategories, setVisibleTraceCategories] = useState<TraceCategoryId[]>(DEFAULT_TRACE_CATEGORY_IDS);
  const [selectedSubagentPath, setSelectedSubagentPath] = useState<string | null>(null);
  const [selectedRunbookId, setSelectedRunbookId] = useState<string | null>(null);
  const [selectedRunbookDocument, setSelectedRunbookDocument] = useState<HoneycrispRunbookDocument | null>(null);
  const [runbookLoading, setRunbookLoading] = useState(false);
  const [runbookError, setRunbookError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shellApprovalDecisionInFlight, setShellApprovalDecisionInFlight] = useState<string | null>(null);
  const shellApprovalDecisionRef = useRef<string | null>(null);
  const { sidebarWidth, sidebarCollapsed, sidebarToggleProfile, toggleSidebar, beginSidebarResize } = useResizableSidebar();
  const {
    openRegisteredWorkspaceMenuId,
    setOpenWorkspaceMenuId,
    workspaceInfo,
    setWorkspaceInfo,
    setSessionHistoryWorkspaceId,
    sessionHistoryWorkspace,
    sessionHistorySessions
  } = useWorkspaceOverlayState(workspaceRegistry);
  const {
    profilingState,
    lastProfilingReport,
    refreshProfilingState,
    flushProfilingReport
  } = useProfilingRuntime(handleError, { observeReports: profilingOpen || settingsOpen });
  const selectedRunState = selectedRunStatus(snapshot, selectedRunId);
  const selectedRunRefreshKey = useMemo(() => {
    const selected = snapshot?.runs.find((row) => row.run.id === selectedRunId)?.run;
    if (!selected) return null;
    const pendingApprovalIds = snapshot?.pendingShellApprovals
      .filter((approval) => approval.runId === selected.id)
      .map((approval) => approval.id)
      .join(',') ?? '';
    return `${selected.status}:${selected.shellSafetyMode}:${pendingApprovalIds}`;
  }, [selectedRunId, snapshot?.pendingShellApprovals, snapshot?.runs]);
  const handleRunDetailError = useCallback((message: string) => setError(message), []);
  const { runDetail, clearRunDetail } = useRunDetailPolling({
    selectedRunId,
    selectedRunState,
    refreshKey: selectedRunRefreshKey,
    onError: handleRunDetailError
  });
  useDevRenderProbe('app.shell', () => ({
    selectedRun: selectedRunId ? shortMetricId(selectedRunId) : 'none',
    workspaces: workspaceRegistry?.workspaces.length ?? 0,
    sessions: workspaceRegistry?.researchSessions.length ?? 0,
    traceEvents: runDetail?.traceEvents.length ?? 0,
    transcripts: runDetail?.transcriptMessages.length ?? 0
  }));
  useDevInputLatencyProbe();
  useSidebarPerformanceProbe({ appShellRef, profile: sidebarToggleProfile });
  useInsetScrollbarActivation();

  useEffect(() => {
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookLoading(false);
    setRunbookError(null);
  }, [selectedRunId]);

  useEffect(() => {
    window.beale
      .getDeveloperSettings()
      .then(setDeveloperSettings)
      .catch((caught: unknown) => handleError(errorMessage(caught)));
  }, [handleError]);

  useEffect(() => {
    window.beale
      .getShellOptions()
      .then(setShellOptions)
      .catch((caught: unknown) => handleError(errorMessage(caught)));
  }, [handleError]);

  const runAction = useCallback(
    async (action: () => Promise<WorkspaceSnapshot | null | void>) => {
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        if (next) applySnapshot(next);
        await loadSnapshot();
        await loadWorkspaceRegistry();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, loadWorkspaceRegistry, loadSnapshot]
  );

  const openNotification = useCallback(
    async (notification: NotificationRecord) => {
      setActiveNotification(notification);
      try {
        applySnapshot(await window.beale.openNotification(notification.id));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [applySnapshot]
  );

  const dismissNotification = useCallback(
    async (notificationId: string) => {
      try {
        applySnapshot(await window.beale.dismissNotification(notificationId));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [applySnapshot]
  );

  const dismissWorkspaceAlert = useCallback((alertId: string) => {
    setWorkspaceAlerts((current) => current.filter((alert) => alert.id !== alertId));
  }, []);

  const closeWorkspaceOnboarding = useCallback((): void => {
    setWorkspaceDraft(null);
    setWorkspaceOnboardingProgress(null);
  }, []);

  const skipWorkspaceOnboardingRepository = useCallback(
    async (repositoryUrl: string, stage: 'clone' | 'index'): Promise<void> => {
      if (!workspaceOnboardingProgress) return;
      const update = await window.beale.skipWorkspaceOnboardingRepository({
        requestId: workspaceOnboardingProgress.requestId,
        repositoryUrl,
        stage
      });
      if (update) {
        setWorkspaceOnboardingProgress(update);
      }
    },
    [workspaceOnboardingProgress]
  );

  const openWorkspaceAlert = useCallback(
    (alert: WorkspaceAlert) => {
      if (alert.id.startsWith('semantic-index-')) {
        setSettingsSection('general');
        setSettingsOpen(true);
        dismissWorkspaceAlert(alert.id);
      }
    },
    [dismissWorkspaceAlert]
  );

  const runWorkspaceAction = useCallback(
    async (action: () => Promise<void>, { markBusy = true, reloadRegistry = true }: WorkspaceActionOptions = {}) => {
      if (markBusy) {
        setBusy(true);
      }
      setError(null);
      try {
        await action();
        if (reloadRegistry) {
          await loadWorkspaceRegistry();
        }
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (markBusy) {
          setBusy(false);
        }
      }
    },
    [loadWorkspaceRegistry]
  );

  const openHoneycrispMemoryDirectory = useCallback(
    async (name: HoneycrispMemoryDirectorySummary['name']) => {
      await runAction(() => window.beale.openHoneycrispMemoryDirectory(name));
    },
    [runAction]
  );

  const runMemoryDreaming = useCallback((): void => {
    void runAction(() => window.beale.runMemoryDreaming());
  }, [runAction]);

  const restoreMemoryDreamingChange = useCallback((changeId: string): void => {
    void runAction(() => window.beale.restoreMemoryDreamingChange(changeId));
  }, [runAction]);

  const openHoneycrispRunbook = useCallback((runbookId: string): void => {
    setSelectedSubagentPath(null);
    setSelectedRunbookId(runbookId);
  }, []);

  const selectSubagent = useCallback((path: string): void => {
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
    setSelectedSubagentPath(path);
  }, []);

  const backToMain = useCallback((): void => {
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
  }, []);

  const refreshOpenAiProvider = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (snapshot) {
        const next = await window.beale.refreshOpenAiStatus();
        applySnapshot(next);
      } else {
        setOpenAiStatus(await window.beale.getOpenAiStatus());
      }
      setResearchProviderStatuses(await window.beale.getResearchProviderStatuses());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, snapshot]);

  const loadResearchProviderStatuses = useCallback(async (): Promise<void> => {
    try {
      setResearchProviderStatuses(await window.beale.getResearchProviderStatuses());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const loadResearchProviderModelCatalog = useCallback(async (): Promise<void> => {
    try {
      setResearchProviderModelCatalog(await window.beale.getResearchProviderModelCatalog());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    if (!newResearchOpen && !(settingsOpen && settingsSection === 'providers')) return;
    void loadResearchProviderStatuses();
  }, [loadResearchProviderStatuses, newResearchOpen, settingsOpen, settingsSection]);

  useEffect(() => {
    if (!newResearchOpen && !selectedRunId) return;
    void loadResearchProviderModelCatalog();
  }, [loadResearchProviderModelCatalog, newResearchOpen, selectedRunId]);

  useEffect(() => {
    if (!settingsOpen || !researchProviderStatuses.some((provider) => provider.loginInProgress)) return;
    const timer = window.setInterval(() => void loadResearchProviderStatuses(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadResearchProviderStatuses, researchProviderStatuses, settingsOpen]);

  const setDeveloperModeEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        setDeveloperSettings(await window.beale.setDeveloperModeEnabled(enabled));
        await refreshProfilingState();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [refreshProfilingState]
  );

  const saveShellOptions = useCallback(async (options: ShellOptions): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setShellOptions(await window.beale.setShellOptions(options));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const startOpenAiOAuth = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.beale.startOpenAiOAuth();
      setOpenAiOAuthResult(result);
      setOpenAiStatus(await window.beale.getOpenAiStatus());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const startResearchProviderOAuth = useCallback(async (providerId: ResearchProviderId) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.beale.startResearchProviderOAuth(providerId);
      setResearchProviderOAuthResults((current) => ({ ...current, [providerId]: result }));
      setResearchProviderStatuses(await window.beale.getResearchProviderStatuses());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const {
    addWorkspace,
    openRegisteredWorkspace,
    openResearchSession,
    removeRegisteredWorkspace,
    submitWorkspaceOnboarding,
    applyOnboardingTemplate,
    lookupHackerOneScope
  } = useWorkspaceActions({
    snapshot,
    workspaceDraft,
    runWorkspaceAction,
    applySnapshot,
    clearRunDetail,
    setSelectedRunId,
    setWorkspaceDraft,
    setWorkspaceOnboardingProgress,
    setWorkspaceInfo,
    setOpenWorkspaceMenuId
  });

  useEffect(() => window.beale.onNativeMenuAction((action: NativeMenuAction) => {
    if (action === 'new_research_workspace') {
      addWorkspace();
      return;
    }
    if (action === 'paste_steering') {
      void readClipboardText().then(dispatchPasteSteeringText);
    }
  }), [addWorkspace]);

  const handleSessionAction = useCallback(
    (action: SteeringAction): void => {
      void runAction(() => window.beale.steerRun(action));
    },
    [runAction]
  );

  const handleSteerInstruction = useCallback(
    (runId: string, instruction: string, modelSelection: ResearchModelSelection): void => {
      handleSessionAction({ type: 'steer', runId, instruction, modelSelection });
    },
    [handleSessionAction]
  );

  const activeRunDetail = activeRunDetailForSelection(runDetail, selectedRunId);
  const activeShellApproval = useMemo(() => {
    if (!snapshot) return pendingShellApproval(activeRunDetail);
    return snapshot.pendingShellApprovals.find((approval) => approval.runId === selectedRunId)
      ?? snapshot.pendingShellApprovals[0]
      ?? null;
  }, [activeRunDetail?.policyEvents, selectedRunId, snapshot?.pendingShellApprovals]);
  useEffect(() => {
    if (shellApprovalDecisionRef.current === activeShellApproval?.id) return;
    shellApprovalDecisionRef.current = null;
    setShellApprovalDecisionInFlight(null);
  }, [activeShellApproval?.id]);

  const handleShellApprovalDecision = useCallback((
    approval: ApprovalRecord,
    decision: PolicyReviewDecision
  ): void => {
    if (shellApprovalDecisionRef.current) return;
    shellApprovalDecisionRef.current = approval.id;
    setShellApprovalDecisionInFlight(approval.id);
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const next = await window.beale.steerRun({
          type: 'review_shell_command',
          workspacePath: shellApprovalWorkspacePath(approval),
          runId: approval.runId,
          approvalId: approval.id,
          decision
        });
        if (next) applySnapshot(next);
        await loadSnapshot();
        await loadWorkspaceRegistry();
      } catch (caught) {
        shellApprovalDecisionRef.current = null;
        setShellApprovalDecisionInFlight(null);
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    })();
  }, [applySnapshot, loadSnapshot, loadWorkspaceRegistry]);
  const activeWorkspaceEntry = useMemo(() => {
    if (!snapshot || !workspaceRegistry) return null;
    return (
      workspaceRegistry.workspaces.find(
        (workspace) =>
          (snapshot.workspace.workspaceId.length > 0 && workspace.workspaceId === snapshot.workspace.workspaceId) ||
          workspace.workspacePath === snapshot.workspace.workspacePath
      ) ?? null
    );
  }, [workspaceRegistry, snapshot?.workspace.workspaceId, snapshot?.workspace.workspacePath]);
  const selectedRunbook = useMemo(
    () => activeRunDetail?.honeycrispMemory?.runbooks.find((runbook) => runbook.id === selectedRunbookId) ?? null,
    [activeRunDetail?.honeycrispMemory?.runbooks, selectedRunbookId]
  );
  useEffect(() => {
    if (!selectedRunbookId || !activeRunDetail || selectedRunbook) return;
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
  }, [activeRunDetail, selectedRunbook, selectedRunbookId]);
  useEffect(() => {
    if (!selectedRunbookId) {
      setRunbookLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRunbookLoading(true);
    setRunbookError(null);
    setSelectedRunbookDocument(null);
    void window.beale.getHoneycrispRunbook(selectedRunbookId)
      .then((document) => {
        if (cancelled || document.runbookId !== selectedRunbookId) return;
        setSelectedRunbookDocument(document);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setRunbookError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setRunbookLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunbook?.revision, selectedRunbookId]);

  const activeTraceEvents = useMemo(
    () => (activeRunDetail ? devInstrumentation.time('trace.buildDisplayEvents.active', () => buildTraceDisplayEvents(activeRunDetail), runDetailMetricDetail(activeRunDetail)) : []),
    [activeRunDetail]
  );
  const visibleSessionTraceEvents = useMemo(
    () => traceEventsForSubagent(activeTraceEvents, selectedSubagentPath),
    [activeTraceEvents, selectedSubagentPath]
  );
  const activeSubagents = useMemo(
    () => subagentSummaries(activeTraceEvents, activeRunDetail?.run.status),
    [activeRunDetail?.run.status, activeTraceEvents]
  );
  useEffect(() => {
    if (!selectedSubagentPath || activeSubagents.some((agent) => agent.path === selectedSubagentPath)) return;
    setSelectedSubagentPath(null);
  }, [activeSubagents, selectedSubagentPath]);
  const {
    selectedTraceEventId,
    traceDetailOpen,
    selectedTraceEvent,
    selectTraceEvent,
    focusTraceEvent,
    closeTraceDetail
  } = useTraceSelection({
    events: visibleSessionTraceEvents,
    selectedRunId
  });
  const sessionHeat = useMemo(() => sessionHeatForDetail(activeRunDetail), [activeRunDetail]);
  const researchMomentum = useMemo(() => researchMomentumForDetail(activeRunDetail, sessionHeat), [activeRunDetail, sessionHeat]);
  const windowControlPlatform = windowControlPlatformForState(snapshot, hostEnvironment);
  const shellClassName = appShellClassName({
    sessionHeat,
    momentumState: researchMomentum.state,
    sessionActive: activeRunDetail?.run.status === 'active',
    platform: windowControlPlatform,
    windowChromeState,
    sidebarCollapsed
  });
  const currentWorkspaceName = snapshot?.activeScope.workspaceName ?? 'No Workspace Selected';
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openProfiling = useCallback(() => {
    flushProfilingReport();
    setProfilingOpen(true);
  }, [flushProfilingReport]);
  const closeProfiling = useCallback(() => setProfilingOpen(false), []);
  const openTraceFilters = useCallback(() => setTraceFilterOpen(true), []);
  const startNewResearch = useCallback(() => {
    setNewResearchOpen(true);
  }, []);
  const handleResearchStarted = useCallback(
    (runId: string): void => {
      clearRunDetail();
      setSelectedRunId(runId);
      setNewResearchOpen(false);
    },
    [clearRunDetail, setSelectedRunId]
  );
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const openSearchResult = useCallback(
    (result: SessionTranscriptSearchResult, query: string): void => {
      setPendingSearchTarget(result);
      setTraceSearchHighlightQuery(query);
      const targetWorkspace = workspaceRegistry?.workspaces.find((workspace) => workspace.id === result.registryWorkspaceId) ?? null;
      const activeWorkspace = snapshot?.workspace.workspacePath === result.workspacePath;
      if (targetWorkspace && !activeWorkspace) {
        void runWorkspaceAction(async () => {
          clearRunDetail();
          applySnapshot(await window.beale.openRegisteredWorkspace(targetWorkspace.id));
          setSelectedRunId(result.runId);
        }, { markBusy: false, reloadRegistry: false });
        setSearchOpen(false);
        return;
      }
      if (selectedRunId !== result.runId) {
        clearRunDetail();
      }
      setSelectedRunId(result.runId);
      setSearchOpen(false);
    },
    [applySnapshot, clearRunDetail, workspaceRegistry, runWorkspaceAction, selectedRunId, setSelectedRunId, snapshot]
  );
  useEffect(() => {
    if (!pendingSearchTarget || activeRunDetail?.run.id !== pendingSearchTarget.runId) return;
    const targetEvent = traceEventForSearchResult(activeTraceEvents, pendingSearchTarget);
    if (!targetEvent) return;
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
    focusTraceEvent(targetEvent);
    setPendingSearchTarget(null);
  }, [activeRunDetail?.run.id, activeTraceEvents, focusTraceEvent, pendingSearchTarget]);

  return (
    <div ref={appShellRef} className={shellClassName} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <AppBackgroundPulses />
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        platform={windowControlPlatform}
        workspaceName={currentWorkspaceName}
        activeWorkspace={activeWorkspaceEntry}
        activeRunDetail={activeRunDetail}
        profilingEnabled={profilingState?.enabled ?? false}
        onOpenSessionSummary={setSessionSummaryDetail}
        onOpenWorkspaceInfo={setWorkspaceInfo}
        onOpenProfiling={openProfiling}
        onAddWorkspace={() => {
          addWorkspace();
        }}
        onToggleSidebar={toggleSidebar}
      />
      <WorkspaceSidebar
        busy={busy}
        collapsed={sidebarCollapsed}
        error={error}
        openRegisteredWorkspaceMenuId={openRegisteredWorkspaceMenuId}
        workspaceRegistry={workspaceRegistry}
        selectedRunId={selectedRunId}
        snapshot={snapshot}
        onAddWorkspace={() => {
          addWorkspace();
        }}
        onOpenWorkspace={(workspace) => {
          openRegisteredWorkspace(workspace);
        }}
        onOpenWorkspaceInfo={setWorkspaceInfo}
        onOpenResearchSession={(workspace, session) => {
          openResearchSession(workspace, session);
        }}
        onRemoveWorkspace={removeRegisteredWorkspace}
        onResizePointerDown={beginSidebarResize}
        onSetOpenWorkspaceMenuId={setOpenWorkspaceMenuId}
        onShowMoreSessions={setSessionHistoryWorkspaceId}
        onSearch={openSearch}
        onStartNewResearch={startNewResearch}
      />

      <main className="workbench" data-session-heat={sessionHeat}>
        <div className="workspace-page">
          <MainSessionWorkspace
            detail={activeRunDetail}
            events={visibleSessionTraceEvents}
            allEvents={activeTraceEvents}
            providerModelCatalog={researchProviderModelCatalog}
            honeycrispMemory={selectedRunId ? null : snapshot?.honeycrispMemory ?? null}
            runCount={selectedRunId ? 0 : snapshot?.runs.length ?? 0}
            scope={selectedRunId ? null : snapshot?.activeScope ?? null}
            selectedRunId={selectedRunId}
            selectedRunbook={selectedRunbook}
            selectedRunbookDocument={selectedRunbookDocument}
            runbookLoading={runbookLoading}
            runbookError={runbookError}
            selectedSubagentPath={selectedSubagentPath}
            selectedTraceEventId={selectedTraceEventId}
            searchHighlightQuery={traceSearchHighlightQuery}
            visibleTraceCategories={visibleTraceCategories}
            busy={busy}
            traceFilterCount={visibleTraceCategories.length}
            totalTraceFilterCount={ALL_TRACE_CATEGORY_IDS.length}
            onOpenTraceFilters={openTraceFilters}
            onOpenHoneycrispMemoryDirectory={openHoneycrispMemoryDirectory}
            onRestoreMemoryDreamingChange={restoreMemoryDreamingChange}
            onRunMemoryDreaming={runMemoryDreaming}
            onOpenHoneycrispRunbook={openHoneycrispRunbook}
            onBackToMain={backToMain}
            onSelectTraceEvent={selectTraceEvent}
            onSelectSubagent={selectSubagent}
            onSessionAction={handleSessionAction}
            onSteerInstruction={handleSteerInstruction}
          />
        </div>
      </main>
      <StatusBar
        onOpenSettings={openSettings}
      />
      <NotificationStack
        notifications={snapshot?.notifications ?? []}
        alerts={workspaceAlerts}
        onOpen={openNotification}
        onDismiss={dismissNotification}
        onOpenAlert={openWorkspaceAlert}
        onDismissAlert={dismissWorkspaceAlert}
      />
      <AppModals
        activeNotification={activeNotification}
        activeRunDetail={activeRunDetail}
        activeWorkspaceName={snapshot?.activeScope.workspaceName ?? 'current workspace'}
        busy={busy}
        developerSettings={developerSettings}
        shellOptions={shellOptions}
        newResearchOpen={newResearchOpen}
        openAiOAuthResult={openAiOAuthResult}
        openAiStatus={snapshot?.openAi ?? openAiStatus}
        researchProviderOAuthResults={researchProviderOAuthResults}
        researchProviderModelCatalog={researchProviderModelCatalog}
        researchProviderStatuses={researchProviderStatuses}
        researchGoalSuggestions={researchGoalSuggestionState.suggestions}
        researchGoalSuggestionsLoading={researchGoalSuggestionState.loading}
        researchGoalSuggestionError={researchGoalSuggestionState.error}
        profilingOpen={profilingOpen}
        profilingState={profilingState}
        lastProfilingReport={lastProfilingReport}
        workspaceDraft={workspaceDraft}
        workspaceOnboardingProgress={workspaceOnboardingProgress}
        workspaceInfo={workspaceInfo}
        sessionSummaryDetail={sessionSummaryDetail}
        searchOpen={searchOpen}
        selectedRunId={selectedRunId}
        selectedTraceEvent={selectedTraceEvent}
        sessionHistoryWorkspace={sessionHistoryWorkspace}
        sessionHistorySessions={sessionHistorySessions}
        settingsOpen={settingsOpen}
        settingsSection={settingsSection}
        snapshot={snapshot}
        traceDetailOpen={traceDetailOpen}
        traceFilterOpen={traceFilterOpen}
        visibleTraceCategories={visibleTraceCategories}
        onCancelNewResearch={() => setNewResearchOpen(false)}
        onCancelWorkspaceOnboarding={closeWorkspaceOnboarding}
        onChangeWorkspaceDraft={setWorkspaceDraft}
        onChangeSettingsSection={setSettingsSection}
        onChangeVisibleTraceCategories={setVisibleTraceCategories}
        onCloseNotification={() => setActiveNotification(null)}
        onCloseProfiling={closeProfiling}
        onCloseWorkspaceInfo={() => setWorkspaceInfo(null)}
        onCloseSessionSummary={() => setSessionSummaryDetail(null)}
        onCloseSearch={() => setSearchOpen(false)}
        onCloseSessionHistory={() => setSessionHistoryWorkspaceId(null)}
        onCloseSettings={() => setSettingsOpen(false)}
        onCloseTraceDetail={closeTraceDetail}
        onCloseTraceFilters={() => setTraceFilterOpen(false)}
        onLookupHackerOne={lookupHackerOneScope}
        onOpenSessionHistorySession={(workspace, session) => {
          openResearchSession(workspace, session);
          setSessionHistoryWorkspaceId(null);
        }}
        onWorkspaceTemplate={applyOnboardingTemplate}
        onRefreshOpenAi={refreshOpenAiProvider}
        onFlushProfilingReport={flushProfilingReport}
        onSetDeveloperModeEnabled={setDeveloperModeEnabled}
        onSaveShellOptions={saveShellOptions}
        onStartOpenAiOAuth={startOpenAiOAuth}
        onStartResearchProviderOAuth={startResearchProviderOAuth}
        onRetryResearchGoalSuggestions={researchGoalSuggestionState.retry}
        onStartedNewResearch={handleResearchStarted}
        onOpenSearchResult={openSearchResult}
        onSteerNotification={(notification, instruction) => {
          void runAction(() => window.beale.steerRun({ type: 'steer', runId: notification.runId, instruction }));
          setActiveNotification(null);
        }}
        onSubmitWorkspaceOnboarding={submitWorkspaceOnboarding}
        onSkipWorkspaceOnboardingRepository={skipWorkspaceOnboardingRepository}
        runAction={runAction}
      />
      {activeShellApproval ? (
        <ShellApprovalModal
          approval={activeShellApproval}
          busy={busy || shellApprovalDecisionInFlight === activeShellApproval.id}
          onDecision={(decision) => handleShellApprovalDecision(activeShellApproval, decision)}
        />
      ) : null}
    </div>
  );
}

function shellApprovalWorkspacePath(approval: ApprovalRecord): string {
  const workspacePath = approval.requestedAction.workspacePath;
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
    throw new Error('Shell approval is missing its originating workspace.');
  }
  return workspacePath;
}


function traceEventForSearchResult(events: TraceDisplayEvent[], result: SessionTranscriptSearchResult): TraceDisplayEvent | null {
  const transcriptEventId = `transcript:${result.transcriptMessageId}`;
  return (
    events.find((event) => {
      if (event.id === transcriptEventId || event.transcriptMessageId === result.transcriptMessageId) return true;
      if (event.payload.transcriptMessageId === result.transcriptMessageId) return true;
      if (!result.traceEventId) return false;
      return event.id === result.traceEventId || event.payload.linkedTraceEventId === result.traceEventId;
    }) ?? null
  );
}
