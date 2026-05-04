import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties } from 'react';
import { devInstrumentation, useDevInputLatencyProbe, useDevRenderProbe } from './devInstrumentation';
import type {
  CyberGymScenarioList,
  CyberGymScenarioSummary,
  CyberGymSettingsInput,
  CyberGymStorageActionResult,
  DeveloperSettings,
  NotificationRecord,
  OpenAiOAuthStartResult,
  ProgramOnboardingProgressUpdate,
  RunDetail,
  SandboxSetupInput,
  SandboxSetupResult,
  SessionTranscriptSearchResult,
  SteeringAction,
  VmPreferenceInput,
  WorkspaceSnapshot
} from '@shared/types';
import { AppModals } from './app/AppModals';
import { AppBackgroundPulses } from './app/AppBackgroundPulses';
import { StatusBar } from './app/StatusBar';
import { TopBar } from './app/TopBar';
import { NotificationStack, type WorkspaceAlert } from './features/notifications/Notifications';
import { ProgramSidebar } from './features/programs/ProgramSidebar';
import type { ProgramMainView } from './features/programs/programViews';
import { EvidenceSidebar } from './features/research/EvidenceSidebar';
import { MainSessionWorkspace } from './features/sessions/MainSessionWorkspace';
import { SessionHeader } from './features/sessions/SessionHeader';
import { DEFAULT_SESSION_MAIN_VIEW, type SessionMainView } from './features/sessions/sessionViews';
import { CyberGymBenchmarkWorkspace } from './features/settings/CyberGymBenchmarkWorkspace';
import type { SettingsSection } from './features/settings/SettingsModal';
import { ALL_TRACE_CATEGORY_IDS, DEFAULT_TRACE_CATEGORY_IDS } from './features/traces/traceVisuals';
import { useInsetScrollbarActivation } from './hooks/useInsetScrollbarActivation';
import { useProgramActions, type ProgramActionOptions } from './hooks/useProgramActions';
import { useProgramOverlayState } from './hooks/useProgramOverlayState';
import { useProfilingRuntime } from './hooks/useProfilingRuntime';
import { useResizableSidebar } from './hooks/useResizableSidebar';
import { useRunDetailPolling } from './hooks/useRunDetailPolling';
import { useSidebarPerformanceProbe } from './hooks/useSidebarPerformanceProbe';
import { useTraceSelection } from './hooks/useTraceSelection';
import { useWorkspaceRuntime } from './hooks/useWorkspaceRuntime';
import type { TraceCategoryId } from './traceClassification';
import { errorMessage } from './lib/errors';
import { environmentActivityForDetail } from './view-models/environmentDisplay';
import {
  activeRunDetailForSelection,
  appShellClassName,
  selectedRunStatus,
  vmPreferenceForState,
  windowControlPlatformForState
} from './view-models/appShell';
import type { ProgramOnboardingFormState } from './view-models/programOnboarding';
import { researchMomentumForDetail } from './view-models/researchMomentum';
import { semanticIndexAlertBody, semanticIndexRunningKey, shouldSuppressSemanticIndexInfoAlert } from './view-models/semanticIndexAlerts';
import { sessionHeatForDetail } from './view-models/sessionHeat';
import { buildTraceDisplayEvents, type TraceDisplayEvent } from './view-models/traceDisplay';
import { runDetailMetricDetail, shortMetricId } from './view-models/runDetailUpdates';

const SEMANTIC_INDEX_ALERT_DELAY_MS = 10_000;

export function App(): JSX.Element {
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleError = useCallback((message: string) => setError(message), []);
  const {
    snapshot,
    programRegistry,
    hostEnvironment,
    windowChromeState,
    openAiStatus,
    selectedRunId,
    setProgramRegistry,
    setOpenAiStatus,
    setSelectedRunId,
    applySnapshot,
    loadSnapshot,
    loadProgramRegistry
  } = useWorkspaceRuntime(handleError);
  const [openAiOAuthResult, setOpenAiOAuthResult] = useState<OpenAiOAuthStartResult | null>(null);
  const [developerSettings, setDeveloperSettings] = useState<DeveloperSettings | null>(null);
  const [cyberGymScenarioList, setCyberGymScenarioList] = useState<CyberGymScenarioList | null>(null);
  const [cyberGymWorkspaceOpen, setCyberGymWorkspaceOpen] = useState(false);
  const [programDraft, setProgramDraft] = useState<ProgramOnboardingFormState | null>(null);
  const [programOnboardingProgress, setProgramOnboardingProgress] = useState<ProgramOnboardingProgressUpdate | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingSearchTarget, setPendingSearchTarget] = useState<SessionTranscriptSearchResult | null>(null);
  const [traceSearchHighlightQuery, setTraceSearchHighlightQuery] = useState('');
  const [profilingOpen, setProfilingOpen] = useState(false);
  const [traceFilterOpen, setTraceFilterOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationRecord | null>(null);
  const [workspaceAlerts, setWorkspaceAlerts] = useState<WorkspaceAlert[]>([]);
  const [researchPromptDetail, setResearchPromptDetail] = useState<RunDetail | null>(null);
  const [visibleTraceCategories, setVisibleTraceCategories] = useState<TraceCategoryId[]>(DEFAULT_TRACE_CATEGORY_IDS);
  const [sessionMainView, setSessionMainView] = useState<SessionMainView>(DEFAULT_SESSION_MAIN_VIEW);
  const [programMainView, setProgramMainView] = useState<ProgramMainView>('understanding');
  const [busy, setBusy] = useState(false);
  const semanticIndexAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const semanticIndexRunningAlertKeyRef = useRef<string | null>(null);
  const semanticIndexErrorAlertKeyRef = useRef<string | null>(null);
  const { sidebarWidth, sidebarCollapsed, sidebarToggleProfile, toggleSidebar, beginSidebarResize } = useResizableSidebar();
  const {
    openProgramMenuId,
    setOpenProgramMenuId,
    programInfo,
    setProgramInfo,
    setSessionHistoryProgramId,
    sessionHistoryProgram,
    sessionHistorySessions
  } = useProgramOverlayState(programRegistry);
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
    programs: programRegistry?.programs.length ?? 0,
    sessions: programRegistry?.researchSessions.length ?? 0,
    traceEvents: runDetail?.traceEvents.length ?? 0,
    transcripts: runDetail?.transcriptMessages.length ?? 0
  }));
  useDevInputLatencyProbe();
  useSidebarPerformanceProbe({ appShellRef, profile: sidebarToggleProfile });
  useInsetScrollbarActivation();

  useEffect(() => {
    setSessionMainView(DEFAULT_SESSION_MAIN_VIEW);
  }, [selectedRunId]);

  useEffect(() => {
    window.beale
      .getDeveloperSettings()
      .then(setDeveloperSettings)
      .catch((caught: unknown) => handleError(errorMessage(caught)));
  }, [handleError]);

  useEffect(() => {
    if (developerSettings && !developerSettings.developerModeEnabled) {
      setCyberGymWorkspaceOpen(false);
    }
  }, [developerSettings]);

  useEffect(() => {
    if (!selectedRunId) setProgramMainView('understanding');
  }, [selectedRunId, snapshot?.activeScope.id]);

  const runAction = useCallback(
    async (action: () => Promise<WorkspaceSnapshot | null | void>) => {
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        if (next) applySnapshot(next);
        await loadSnapshot();
        await loadProgramRegistry();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, loadProgramRegistry, loadSnapshot]
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

  const closeProgramOnboarding = useCallback((): void => {
    setProgramDraft(null);
    setProgramOnboardingProgress(null);
  }, []);

  const skipProgramOnboardingRepository = useCallback(
    async (repositoryUrl: string, stage: 'clone' | 'index'): Promise<void> => {
      if (!programOnboardingProgress) return;
      const update = await window.beale.skipProgramOnboardingRepository({
        requestId: programOnboardingProgress.requestId,
        repositoryUrl,
        stage
      });
      if (update) {
        setProgramOnboardingProgress(update);
      }
    },
    [programOnboardingProgress]
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

  const runProgramAction = useCallback(
    async (action: () => Promise<void>, { markBusy = true, reloadRegistry = true }: ProgramActionOptions = {}) => {
      if (markBusy) {
        setBusy(true);
      }
      setError(null);
      try {
        await action();
        if (reloadRegistry) {
          await loadProgramRegistry();
        }
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (markBusy) {
          setBusy(false);
        }
      }
    },
    [loadProgramRegistry]
  );

  const updateVmPreference = useCallback(
    async (input: VmPreferenceInput) => {
      await runProgramAction(async () => {
        setProgramRegistry(await window.beale.setVmPreference(input));
        await loadSnapshot();
      });
    },
    [loadSnapshot, runProgramAction]
  );

  const setupSandbox = useCallback(
    async (input: SandboxSetupInput): Promise<SandboxSetupResult> => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.beale.setupSandbox(input);
        await loadSnapshot();
        if (!result.ok) {
          setError(result.detail);
        }
        return result;
      } catch (caught) {
        setError(errorMessage(caught));
        throw caught;
      } finally {
        setBusy(false);
      }
    },
    [loadSnapshot]
  );

  const setProjectSemanticIndexEnabled = useCallback(
    async (enabled: boolean) => {
      await runAction(() => window.beale.setProjectSemanticIndexEnabled(enabled));
    },
    [runAction]
  );

  const refreshProjectSemanticIndex = useCallback(async () => {
    await runAction(() => window.beale.refreshProjectSemanticIndex());
  }, [runAction]);

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

  const updateCyberGymSettings = useCallback(async (input: CyberGymSettingsInput): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setDeveloperSettings(await window.beale.updateCyberGymSettings(input));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshCyberGymScenarios = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setCyberGymScenarioList(await window.beale.getCyberGymScenarios());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const openCyberGymWorkspace = useCallback((): void => {
    clearRunDetail();
    setInspectorOpen(false);
    setSelectedRunId(null);
    setCyberGymWorkspaceOpen(true);
    void refreshCyberGymScenarios();
  }, [clearRunDetail, refreshCyberGymScenarios, setSelectedRunId]);

  const selectCyberGymScenario = useCallback(
    async (scenario: CyberGymScenarioSummary): Promise<void> => {
      await updateCyberGymSettings({ selectedBenchmark: scenario.id });
    },
    [updateCyberGymSettings]
  );

  const prepareCyberGymStorage = useCallback(async (): Promise<CyberGymStorageActionResult> => {
    setBusy(true);
    setError(null);
    try {
      return await window.beale.prepareCyberGymStorage();
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearCyberGymCache = useCallback(async (): Promise<CyberGymStorageActionResult> => {
    setBusy(true);
    setError(null);
    try {
      return await window.beale.clearCyberGymCache();
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
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

  const {
    addProgram,
    openRegisteredProgram,
    openResearchSession,
    removeRegisteredProgram,
    submitProgramOnboarding,
    applyOnboardingTemplate,
    lookupHackerOneProgram
  } = useProgramActions({
    snapshot,
    programDraft,
    runProgramAction,
    applySnapshot,
    clearRunDetail,
    setSelectedRunId,
    setProgramDraft,
    setProgramOnboardingProgress,
    setProgramInfo,
    setOpenProgramMenuId
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
  const activeProgramEntry = useMemo(() => {
    if (!snapshot || !programRegistry) return null;
    return (
      programRegistry.programs.find(
        (program) =>
          (snapshot.workspace.workspaceId.length > 0 && program.workspaceId === snapshot.workspace.workspaceId) ||
          program.workspacePath === snapshot.workspace.workspacePath
      ) ?? null
    );
  }, [programRegistry, snapshot?.workspace.workspaceId, snapshot?.workspace.workspacePath]);
  const activeTraceEvents = useMemo(
    () => (activeRunDetail ? devInstrumentation.time('trace.buildDisplayEvents.active', () => buildTraceDisplayEvents(activeRunDetail), runDetailMetricDetail(activeRunDetail)) : []),
    [activeRunDetail]
  );
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
    events: activeTraceEvents,
    selectedRunId
  });
  const sessionHeat = useMemo(() => sessionHeatForDetail(activeRunDetail), [activeRunDetail]);
  const researchMomentum = useMemo(() => researchMomentumForDetail(activeRunDetail, sessionHeat), [activeRunDetail, sessionHeat]);
  const environmentActivity = useMemo(() => environmentActivityForDetail(activeRunDetail), [activeRunDetail]);
  const windowControlPlatform = windowControlPlatformForState(snapshot, hostEnvironment);
  const shellClassName = appShellClassName({
    sessionHeat,
    momentumState: researchMomentum.state,
    sessionActive: activeRunDetail?.run.status === 'active',
    platform: windowControlPlatform,
    windowChromeState,
    sidebarCollapsed,
    inspectorOpen
  });
  const vmPreference = vmPreferenceForState(programRegistry, snapshot);
  const configureVm = useCallback(() => {
    setSettingsSection('sandboxes');
    setSettingsOpen(true);
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openBenchmarkingSettings = useCallback(() => {
    setSettingsSection('benchmarking');
    setSettingsOpen(true);
  }, []);
  const openProfiling = useCallback(() => {
    flushProfilingReport();
    setProfilingOpen(true);
  }, [flushProfilingReport]);
  const closeProfiling = useCallback(() => setProfilingOpen(false), []);
  const openTraceFilters = useCallback(() => setTraceFilterOpen(true), []);
  const startNewResearch = useCallback(() => {
    setCyberGymWorkspaceOpen(false);
    setNewResearchOpen(true);
  }, []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const openSearchResult = useCallback(
    (result: SessionTranscriptSearchResult, query: string): void => {
      setCyberGymWorkspaceOpen(false);
      setPendingSearchTarget(result);
      setTraceSearchHighlightQuery(query);
      const targetProgram = programRegistry?.programs.find((program) => program.id === result.programId || program.workspacePath === result.workspacePath) ?? null;
      const activeProgram = snapshot?.workspace.workspacePath === result.workspacePath;
      if (targetProgram && !activeProgram) {
        void runProgramAction(async () => {
          clearRunDetail();
          applySnapshot(await window.beale.openProgram(targetProgram.id));
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
    [applySnapshot, clearRunDetail, programRegistry, runProgramAction, selectedRunId, setSelectedRunId, snapshot]
  );
  const toggleInspector = useCallback(() => setInspectorOpen((current) => !current), []);
  const closeInspector = useCallback(() => setInspectorOpen(false), []);

  useEffect(() => {
    if (!pendingSearchTarget || activeRunDetail?.run.id !== pendingSearchTarget.runId) return;
    const targetEvent = traceEventForSearchResult(activeTraceEvents, pendingSearchTarget);
    if (!targetEvent) return;
    focusTraceEvent(targetEvent);
    setPendingSearchTarget(null);
  }, [activeRunDetail?.run.id, activeTraceEvents, focusTraceEvent, pendingSearchTarget]);

  useEffect(() => {
    const summary = snapshot?.projectSemantic ?? null;
    const status = summary?.status ?? 'disabled';
    const programName = snapshot?.activeScope.programName ?? 'the active program';
    if (semanticIndexAlertTimerRef.current) {
      clearTimeout(semanticIndexAlertTimerRef.current);
      semanticIndexAlertTimerRef.current = null;
    }

    if (!summary || status === 'disabled' || status === 'ready' || status === 'empty' || status === 'stale' || status === 'canceled') {
      setWorkspaceAlerts((current) => current.filter((alert) => !alert.id.startsWith('semantic-index-')));
      return;
    }

    if (status === 'error') {
      const errorKey = `${summary.scopeVersionId}:${summary.finishedAt ?? ''}:${summary.lastError ?? ''}`;
      setWorkspaceAlerts((current) => current.filter((alert) => !alert.id.startsWith('semantic-index-running:')));
      if (semanticIndexErrorAlertKeyRef.current !== errorKey) {
        semanticIndexErrorAlertKeyRef.current = errorKey;
        setWorkspaceAlerts((current) => [
          ...current.filter((alert) => !alert.id.startsWith('semantic-index-error:')),
          {
            id: `semantic-index-error:${errorKey}`,
            severity: 'error',
            title: 'Project understanding failed',
            bodyMarkdown: `Semantic indexing failed for ${programName}. ${summary.lastError || 'Open Settings > General for details.'}`
          }
        ]);
      }
      return;
    }

    if (
      shouldSuppressSemanticIndexInfoAlert(summary) ||
      (programOnboardingProgress && programOnboardingProgress.phase !== 'complete' && programOnboardingProgress.workspacePath === snapshot?.workspace.workspacePath)
    ) {
      setWorkspaceAlerts((current) => current.filter((alert) => !alert.id.startsWith('semantic-index-running:')));
      return;
    }

    if (status === 'queued' || status === 'indexing') {
      const runningKey = semanticIndexRunningKey(summary);
      if (semanticIndexRunningAlertKeyRef.current === runningKey) return;
      semanticIndexAlertTimerRef.current = setTimeout(() => {
        semanticIndexRunningAlertKeyRef.current = runningKey;
        setWorkspaceAlerts((current) => {
          const alertId = `semantic-index-running:${runningKey}`;
          if (current.some((alert) => alert.id === alertId)) return current;
          return [
            ...current.filter((alert) => !alert.id.startsWith('semantic-index-running:')),
            {
              id: alertId,
              severity: 'info',
              title: 'Project understanding indexing',
              bodyMarkdown: semanticIndexAlertBody(summary, programName)
            }
          ];
        });
      }, SEMANTIC_INDEX_ALERT_DELAY_MS);
    }

    return () => {
      if (semanticIndexAlertTimerRef.current) {
        clearTimeout(semanticIndexAlertTimerRef.current);
        semanticIndexAlertTimerRef.current = null;
      }
    };
  }, [
    snapshot?.activeScope.programName,
    snapshot?.projectSemantic?.finishedAt,
    snapshot?.projectSemantic?.lastError,
    snapshot?.projectSemantic?.jobReason,
    snapshot?.projectSemantic?.queuedAt,
    snapshot?.projectSemantic?.scopeVersionId,
    snapshot?.projectSemantic?.startedAt,
    snapshot?.projectSemantic?.status,
    snapshot?.workspace.workspacePath,
    programOnboardingProgress?.phase,
    programOnboardingProgress?.workspacePath
  ]);

  useEffect(() => {
    const summary = snapshot?.projectSemantic ?? null;
    if (!summary || (summary.status !== 'queued' && summary.status !== 'indexing')) return;
    if (shouldSuppressSemanticIndexInfoAlert(summary)) {
      setWorkspaceAlerts((current) => current.filter((alert) => !alert.id.startsWith('semantic-index-running:')));
      return;
    }
    const alertId = `semantic-index-running:${semanticIndexRunningKey(summary)}`;
    const bodyMarkdown = semanticIndexAlertBody(summary, snapshot?.activeScope.programName ?? 'the active program');
    setWorkspaceAlerts((current) => {
      let changed = false;
      const next = current.map((alert) => {
        if (alert.id !== alertId || alert.bodyMarkdown === bodyMarkdown) return alert;
        changed = true;
        return { ...alert, bodyMarkdown };
      });
      return changed ? next : current;
    });
  }, [
    snapshot?.activeScope.programName,
    snapshot?.projectSemantic?.jobReason,
    snapshot?.projectSemantic?.progressProcessed,
    snapshot?.projectSemantic?.progressTotal,
    snapshot?.projectSemantic?.queuedAt,
    snapshot?.projectSemantic?.scopeVersionId,
    snapshot?.projectSemantic?.startedAt,
    snapshot?.projectSemantic?.status,
    snapshot?.runs
  ]);

  return (
    <div ref={appShellRef} className={shellClassName} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <AppBackgroundPulses />
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        platform={windowControlPlatform}
        programName={snapshot?.activeScope.programName ?? 'No Program Selected'}
        activeProgram={activeProgramEntry}
        activeRunDetail={activeRunDetail}
        profilingEnabled={profilingState?.enabled ?? false}
        onOpenResearchPrompt={setResearchPromptDetail}
        onOpenProgramInfo={setProgramInfo}
        onOpenProfiling={openProfiling}
        onAddProgram={() => {
          setCyberGymWorkspaceOpen(false);
          addProgram();
        }}
        onToggleSidebar={toggleSidebar}
      />
      <ProgramSidebar
        busy={busy}
        cyberGymActive={cyberGymWorkspaceOpen}
        collapsed={sidebarCollapsed}
        developerModeEnabled={developerSettings?.developerModeEnabled ?? false}
        error={error}
        openProgramMenuId={openProgramMenuId}
        programRegistry={programRegistry}
        selectedRunId={selectedRunId}
        snapshot={snapshot}
        onAddProgram={() => {
          setCyberGymWorkspaceOpen(false);
          addProgram();
        }}
        onOpenBenchmarkingSettings={openBenchmarkingSettings}
        onOpenCyberGymWorkspace={openCyberGymWorkspace}
        onOpenProgram={(program) => {
          setCyberGymWorkspaceOpen(false);
          openRegisteredProgram(program);
        }}
        onOpenProgramInfo={setProgramInfo}
        onOpenResearchSession={(program, session) => {
          setCyberGymWorkspaceOpen(false);
          openResearchSession(program, session);
        }}
        onRemoveProgram={removeRegisteredProgram}
        onResizePointerDown={beginSidebarResize}
        onSetOpenProgramMenuId={setOpenProgramMenuId}
        onShowMoreSessions={setSessionHistoryProgramId}
        onSearch={openSearch}
        onStartNewResearch={startNewResearch}
      />

      <main className="workbench" data-session-heat={sessionHeat}>
        <SessionHeader
          detail={activeRunDetail}
          events={activeTraceEvents}
          programGraphStatus={!selectedRunId && snapshot && !cyberGymWorkspaceOpen ? snapshot.projectGraph.status : null}
          programSemanticStatus={!selectedRunId && snapshot && !cyberGymWorkspaceOpen ? snapshot.projectSemantic.status : null}
          programView={!selectedRunId && snapshot && !cyberGymWorkspaceOpen ? programMainView : null}
          sessionView={sessionMainView}
          visibleTraceCategories={visibleTraceCategories}
          onProgramViewChange={setProgramMainView}
          onSessionViewChange={setSessionMainView}
        />
        <div className="workspace-page">
          {cyberGymWorkspaceOpen ? (
            <CyberGymBenchmarkWorkspace
              benchmark={snapshot?.benchmark ?? null}
              busy={busy}
              scenarioList={cyberGymScenarioList}
              selectedScenarioId={developerSettings?.cyberGym.selectedBenchmark ?? ''}
              onRefreshScenarios={() => void refreshCyberGymScenarios()}
              onSelectScenario={(scenario) => void selectCyberGymScenario(scenario)}
            />
          ) : (
            <MainSessionWorkspace
              detail={activeRunDetail}
              events={activeTraceEvents}
              graph={selectedRunId ? null : snapshot?.projectGraph ?? null}
              programView={programMainView}
              researchPanelCollapsed={inspectorOpen}
              runCount={selectedRunId ? 0 : snapshot?.runs.length ?? 0}
              scope={selectedRunId ? null : snapshot?.activeScope ?? null}
              selectedRunId={selectedRunId}
              selectedTraceEventId={selectedTraceEventId}
              searchHighlightQuery={traceSearchHighlightQuery}
              semantic={selectedRunId ? null : snapshot?.projectSemantic ?? null}
              sessionView={sessionMainView}
              visibleTraceCategories={visibleTraceCategories}
              busy={busy}
              traceFilterCount={visibleTraceCategories.length}
              totalTraceFilterCount={ALL_TRACE_CATEGORY_IDS.length}
              onExpandResearchPanel={closeInspector}
              onOpenTraceFilters={openTraceFilters}
              onSelectTraceEvent={selectTraceEvent}
              onSessionAction={handleSessionAction}
              onSteerInstruction={handleSteerInstruction}
            />
          )}
        </div>
      </main>
      <aside className="inspector-sidebar" aria-label="Evidence" aria-hidden={!inspectorOpen} inert={!inspectorOpen}>
        <EvidenceSidebar
          detail={activeRunDetail}
          events={activeTraceEvents}
          onSelectTraceEvent={selectTraceEvent}
        />
      </aside>
      <StatusBar
        hostEnvironment={snapshot?.workspace.hostEnvironment ?? hostEnvironment}
        executor={snapshot?.executor ?? null}
        vmPreference={vmPreference}
        activity={environmentActivity}
        detail={activeRunDetail}
        momentum={researchMomentum}
        notificationCount={(snapshot?.notifications.length ?? 0) + workspaceAlerts.length}
        inspectorOpen={inspectorOpen}
        onConfigureVm={configureVm}
        onOpenSettings={openSettings}
        onToggleInspector={toggleInspector}
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
        activeProgramName={snapshot?.activeScope.programName ?? 'current program'}
        busy={busy}
        developerSettings={developerSettings}
        newResearchOpen={newResearchOpen}
        openAiOAuthResult={openAiOAuthResult}
        openAiStatus={snapshot?.openAi ?? openAiStatus}
        profilingOpen={profilingOpen}
        profilingState={profilingState}
        lastProfilingReport={lastProfilingReport}
        programDraft={programDraft}
        programOnboardingProgress={programOnboardingProgress}
        programInfo={programInfo}
        researchPromptDetail={researchPromptDetail}
        searchOpen={searchOpen}
        selectedRunId={selectedRunId}
        selectedTraceEvent={selectedTraceEvent}
        selectedTraceFinding={selectedTraceFinding}
        selectedTraceHypothesis={selectedTraceHypothesis}
        sessionHistoryProgram={sessionHistoryProgram}
        sessionHistorySessions={sessionHistorySessions}
        settingsOpen={settingsOpen}
        settingsSection={settingsSection}
        snapshot={snapshot}
        traceDetailOpen={traceDetailOpen}
        traceFilterOpen={traceFilterOpen}
        visibleTraceCategories={visibleTraceCategories}
        vmPreference={vmPreference}
        onCancelNewResearch={() => setNewResearchOpen(false)}
        onCancelProgramOnboarding={closeProgramOnboarding}
        onChangeProgramDraft={setProgramDraft}
        onChangeSettingsSection={setSettingsSection}
        onChangeVisibleTraceCategories={setVisibleTraceCategories}
        onCloseNotification={() => setActiveNotification(null)}
        onCloseProfiling={closeProfiling}
        onCloseProgramInfo={() => setProgramInfo(null)}
        onCloseResearchPrompt={() => setResearchPromptDetail(null)}
        onCloseSearch={() => setSearchOpen(false)}
        onCloseSessionHistory={() => setSessionHistoryProgramId(null)}
        onCloseSettings={() => setSettingsOpen(false)}
        onClearCyberGymCache={clearCyberGymCache}
        onCloseTraceDetail={closeTraceDetail}
        onCloseTraceFilters={() => setTraceFilterOpen(false)}
        onLookupHackerOne={lookupHackerOneProgram}
        onOpenSessionHistorySession={(program, session) => {
          setCyberGymWorkspaceOpen(false);
          openResearchSession(program, session);
          setSessionHistoryProgramId(null);
        }}
        onProgramTemplate={applyOnboardingTemplate}
        onRefreshOpenAi={refreshOpenAiProvider}
        onPrepareCyberGymStorage={prepareCyberGymStorage}
        onFlushProfilingReport={flushProfilingReport}
        onRefreshProjectSemanticIndex={refreshProjectSemanticIndex}
        onSetProjectSemanticIndexEnabled={setProjectSemanticIndexEnabled}
        onSetDeveloperModeEnabled={setDeveloperModeEnabled}
        onSetupSandbox={setupSandbox}
        onSetVmPreference={updateVmPreference}
        onStartOpenAiOAuth={startOpenAiOAuth}
        onUpdateCyberGymSettings={updateCyberGymSettings}
        onStartedNewResearch={(runId) => {
          clearRunDetail();
          setCyberGymWorkspaceOpen(false);
          setSelectedRunId(runId);
          setNewResearchOpen(false);
        }}
        onOpenSearchResult={openSearchResult}
        onSteerNotification={(notification, instruction) => {
          void runAction(() => window.beale.steerRun({ type: 'steer', runId: notification.runId, instruction }));
          setActiveNotification(null);
        }}
        onSubmitProgramOnboarding={submitProgramOnboarding}
        onSkipProgramOnboardingRepository={skipProgramOnboardingRepository}
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
