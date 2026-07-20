import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties } from 'react';
import { devInstrumentation, useDevInputLatencyProbe, useDevRenderProbe } from './devInstrumentation';
import type {
  DeveloperSettings,
  HoneycrispMemoryDirectorySummary,
  NotificationRecord,
  OpenAiOAuthStartResult,
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
import { SessionHeader } from './features/sessions/SessionHeader';
import { DEFAULT_SESSION_MAIN_VIEW, type SessionMainView } from './features/sessions/sessionViews';
import { subagentSummaries, traceEventsForSubagent } from './view-models/subagents';
import type { SettingsSection } from './features/settings/SettingsModal';
import { ALL_TRACE_CATEGORY_IDS, DEFAULT_TRACE_CATEGORY_IDS } from './features/traces/traceVisuals';
import { useInsetScrollbarActivation } from './hooks/useInsetScrollbarActivation';
import { useWorkspaceActions, type WorkspaceActionOptions } from './hooks/useWorkspaceActions';
import { useWorkspaceOverlayState } from './hooks/useWorkspaceOverlayState';
import { useProfilingRuntime } from './hooks/useProfilingRuntime';
import { useResizableSidebar } from './hooks/useResizableSidebar';
import { useRunDetailPolling } from './hooks/useRunDetailPolling';
import { useSidebarPerformanceProbe } from './hooks/useSidebarPerformanceProbe';
import { useTraceSelection } from './hooks/useTraceSelection';
import { useWorkspaceRuntime } from './hooks/useWorkspaceRuntime';
import type { TraceCategoryId } from './traceClassification';
import { errorMessage } from './lib/errors';
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
  const [openAiOAuthResult, setOpenAiOAuthResult] = useState<OpenAiOAuthStartResult | null>(null);
  const [developerSettings, setDeveloperSettings] = useState<DeveloperSettings | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceOnboardingFormState | null>(null);
  const [workspaceOnboardingProgress, setWorkspaceOnboardingProgress] = useState<WorkspaceOnboardingProgressUpdate | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolingModal, setToolingModal] = useState<'skills' | 'mcpServers' | null>(null);
  const [pendingSearchTarget, setPendingSearchTarget] = useState<SessionTranscriptSearchResult | null>(null);
  const [traceSearchHighlightQuery, setTraceSearchHighlightQuery] = useState('');
  const [profilingOpen, setProfilingOpen] = useState(false);
  const [traceFilterOpen, setTraceFilterOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationRecord | null>(null);
  const [workspaceAlerts, setWorkspaceAlerts] = useState<WorkspaceAlert[]>([]);
  const [researchPromptDetail, setResearchPromptDetail] = useState<RunDetail | null>(null);
  const [visibleTraceCategories, setVisibleTraceCategories] = useState<TraceCategoryId[]>(DEFAULT_TRACE_CATEGORY_IDS);
  const [sessionMainView, setSessionMainView] = useState<SessionMainView>(DEFAULT_SESSION_MAIN_VIEW);
  const [selectedSubagentPath, setSelectedSubagentPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const handleRunDetailError = useCallback((message: string) => setError(message), []);
  const { runDetail, clearRunDetail } = useRunDetailPolling({
    selectedRunId,
    selectedRunState,
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
    setSessionMainView(DEFAULT_SESSION_MAIN_VIEW);
    setSelectedSubagentPath(null);
  }, [selectedRunId]);

  useEffect(() => {
    window.beale
      .getDeveloperSettings()
      .then(setDeveloperSettings)
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, snapshot]);

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

  const handleSessionAction = useCallback(
    (action: SteeringAction): void => {
      void runAction(() => window.beale.steerRun(action));
    },
    [runAction]
  );

  const handleSteerInstruction = useCallback(
    (runId: string, instruction: string): void => handleSessionAction({ type: 'steer', runId, instruction }),
    [handleSessionAction]
  );

  const activeRunDetail = activeRunDetailForSelection(runDetail, selectedRunId);
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
  const activeTraceEvents = useMemo(
    () => (activeRunDetail ? devInstrumentation.time('trace.buildDisplayEvents.active', () => buildTraceDisplayEvents(activeRunDetail), runDetailMetricDetail(activeRunDetail)) : []),
    [activeRunDetail]
  );
  const visibleSessionTraceEvents = useMemo(
    () => traceEventsForSubagent(activeTraceEvents, selectedSubagentPath),
    [activeTraceEvents, selectedSubagentPath]
  );
  const activeSubagents = useMemo(() => subagentSummaries(activeTraceEvents), [activeTraceEvents]);
  useEffect(() => {
    if (!selectedSubagentPath || activeSubagents.some((agent) => agent.path === selectedSubagentPath)) return;
    setSelectedSubagentPath(null);
  }, [activeSubagents, selectedSubagentPath]);
  const {
    selectedTraceEventId,
    traceDetailOpen,
    selectedTraceEvent,
    selectedTraceFinding,
    selectedTraceHypothesis,
    selectTraceEvent,
    focusTraceEvent,
    closeTraceDetail
  } = useTraceSelection({
    detail: activeRunDetail,
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
        onOpenResearchPrompt={setResearchPromptDetail}
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
        onShowMcpServers={() => setToolingModal('mcpServers')}
        onSearch={openSearch}
        onShowSkills={() => setToolingModal('skills')}
        onStartNewResearch={startNewResearch}
      />

      <main className="workbench" data-session-heat={sessionHeat}>
        <SessionHeader
          detail={activeRunDetail}
          events={visibleSessionTraceEvents}
          honeycrispMemoryStatus={!selectedRunId && snapshot ? snapshot.honeycrispMemory.status : null}
          workspaceOpen={!selectedRunId && Boolean(snapshot)}
          sessionView={sessionMainView}
          selectedSubagentPath={selectedSubagentPath}
          visibleTraceCategories={visibleTraceCategories}
          onSessionViewChange={setSessionMainView}
          onBackToMain={() => setSelectedSubagentPath(null)}
        />
        <div className="workspace-page">
          <MainSessionWorkspace
            detail={activeRunDetail}
            events={visibleSessionTraceEvents}
            allEvents={activeTraceEvents}
            honeycrispMemory={selectedRunId ? null : snapshot?.honeycrispMemory ?? null}
            runCount={selectedRunId ? 0 : snapshot?.runs.length ?? 0}
            scope={selectedRunId ? null : snapshot?.activeScope ?? null}
            selectedRunId={selectedRunId}
            selectedSubagentPath={selectedSubagentPath}
            selectedTraceEventId={selectedTraceEventId}
            searchHighlightQuery={traceSearchHighlightQuery}
            sessionView={sessionMainView}
            visibleTraceCategories={visibleTraceCategories}
            busy={busy}
            traceFilterCount={visibleTraceCategories.length}
            totalTraceFilterCount={ALL_TRACE_CATEGORY_IDS.length}
            onOpenTraceFilters={openTraceFilters}
            onOpenHoneycrispMemoryDirectory={openHoneycrispMemoryDirectory}
            onSelectTraceEvent={selectTraceEvent}
            onSelectSubagent={setSelectedSubagentPath}
            onSessionAction={handleSessionAction}
            onSteerInstruction={handleSteerInstruction}
          />
        </div>
      </main>
      <StatusBar
        detail={activeRunDetail}
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
        newResearchOpen={newResearchOpen}
        openAiOAuthResult={openAiOAuthResult}
        openAiStatus={snapshot?.openAi ?? openAiStatus}
        profilingOpen={profilingOpen}
        profilingState={profilingState}
        lastProfilingReport={lastProfilingReport}
        workspaceDraft={workspaceDraft}
        workspaceOnboardingProgress={workspaceOnboardingProgress}
        workspaceInfo={workspaceInfo}
        researchPromptDetail={researchPromptDetail}
        searchOpen={searchOpen}
        selectedRunId={selectedRunId}
        selectedTraceEvent={selectedTraceEvent}
        selectedTraceFinding={selectedTraceFinding}
        selectedTraceHypothesis={selectedTraceHypothesis}
        sessionHistoryWorkspace={sessionHistoryWorkspace}
        sessionHistorySessions={sessionHistorySessions}
        settingsOpen={settingsOpen}
        settingsSection={settingsSection}
        snapshot={snapshot}
        traceDetailOpen={traceDetailOpen}
        traceFilterOpen={traceFilterOpen}
        toolingModal={toolingModal}
        visibleTraceCategories={visibleTraceCategories}
        onCancelNewResearch={() => setNewResearchOpen(false)}
        onCancelWorkspaceOnboarding={closeWorkspaceOnboarding}
        onChangeWorkspaceDraft={setWorkspaceDraft}
        onChangeSettingsSection={setSettingsSection}
        onChangeVisibleTraceCategories={setVisibleTraceCategories}
        onCloseNotification={() => setActiveNotification(null)}
        onCloseProfiling={closeProfiling}
        onCloseWorkspaceInfo={() => setWorkspaceInfo(null)}
        onCloseResearchPrompt={() => setResearchPromptDetail(null)}
        onCloseSearch={() => setSearchOpen(false)}
        onCloseSessionHistory={() => setSessionHistoryWorkspaceId(null)}
        onCloseSettings={() => setSettingsOpen(false)}
        onCloseTooling={() => setToolingModal(null)}
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
        onStartOpenAiOAuth={startOpenAiOAuth}
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
    </div>
  );
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
