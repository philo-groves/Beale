import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties } from 'react';
import { devInstrumentation, useDevInputLatencyProbe, useDevRenderProbe } from './devInstrumentation';
import type {
  HostEnvironment,
  NotificationRecord,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  ProgramRegistryEntry,
  ProgramRegistryState,
  ResearchSessionSummary,
  RunDetail,
  VmPreferenceInput,
  WindowChromeState,
  WorkspaceSnapshot
} from '@shared/types';
import { AppModals } from './app/AppModals';
import { AppBackgroundPulses } from './app/AppBackgroundPulses';
import { StatusBar } from './app/StatusBar';
import { TopBar } from './app/TopBar';
import { NotificationStack } from './features/notifications/Notifications';
import { ProgramSidebar } from './features/programs/ProgramSidebar';
import { EvidenceSidebar } from './features/research/EvidenceSidebar';
import { MainSessionWorkspace } from './features/sessions/MainSessionWorkspace';
import { SessionHeader } from './features/sessions/SessionHeader';
import type { SettingsSection } from './features/settings/SettingsModal';
import { ALL_TRACE_CATEGORY_IDS } from './features/traces/traceVisuals';
import { useInsetScrollbarActivation } from './hooks/useInsetScrollbarActivation';
import { useProgramOverlayState } from './hooks/useProgramOverlayState';
import { useResizableSidebar } from './hooks/useResizableSidebar';
import { useRunDetailPolling } from './hooks/useRunDetailPolling';
import { useTraceSelection } from './hooks/useTraceSelection';
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
import {
  applyProgramTemplate,
  onboardingFormFromDefaults,
  onboardingInputFromForm,
  type ProgramOnboardingFormState,
  type ProgramTemplateKind
} from './view-models/programOnboarding';
import { researchMomentumForDetail } from './view-models/researchMomentum';
import { sessionHeatForDetail } from './view-models/sessionHeat';
import { buildTraceDisplayEvents } from './view-models/traceDisplay';
import {
  runDetailMetricDetail,
  selectRunId,
  shortMetricId,
  snapshotMetricDetail
} from './view-models/runDetailUpdates';

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [programRegistry, setProgramRegistry] = useState<ProgramRegistryState | null>(null);
  const [hostEnvironment, setHostEnvironment] = useState<HostEnvironment | null>(null);
  const [windowChromeState, setWindowChromeState] = useState<WindowChromeState>({ isMaximized: false, isFullScreen: false });
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiAccountStatus | null>(null);
  const [openAiOAuthResult, setOpenAiOAuthResult] = useState<OpenAiOAuthStartResult | null>(null);
  const [programDraft, setProgramDraft] = useState<ProgramOnboardingFormState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [traceFilterOpen, setTraceFilterOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationRecord | null>(null);
  const [researchPromptDetail, setResearchPromptDetail] = useState<RunDetail | null>(null);
  const [visibleTraceCategories, setVisibleTraceCategories] = useState<TraceCategoryId[]>(ALL_TRACE_CATEGORY_IDS);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { sidebarWidth, sidebarCollapsed, toggleSidebar, beginSidebarResize } = useResizableSidebar();
  const {
    openProgramMenuId,
    setOpenProgramMenuId,
    programInfo,
    setProgramInfo,
    setSessionHistoryProgramId,
    sessionHistoryProgram,
    sessionHistorySessions
  } = useProgramOverlayState(programRegistry);
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
  useDevRenderProbe('sidebar.programs', () => ({
    collapsed: sidebarCollapsed,
    programs: programRegistry?.programs.length ?? 0,
    sessions: programRegistry?.researchSessions.length ?? 0
  }));
  useDevInputLatencyProbe();
  useInsetScrollbarActivation();

  const applySnapshot = useCallback((next: WorkspaceSnapshot | null) => {
    devInstrumentation.recordPayload('ipc.snapshot.apply', next, snapshotMetricDetail(next));
    setSnapshot(next);
    if (next) {
      setOpenAiStatus(next.openAi);
    }
    setSelectedRunId((current) => selectRunId(current, next));
  }, []);

  const loadSnapshot = useCallback(async () => {
    const next = await devInstrumentation.timeAsync('ipc.getSnapshot', () => window.beale.getSnapshot());
    applySnapshot(next);
  }, [applySnapshot]);

  const loadProgramRegistry = useCallback(async () => {
    setProgramRegistry(await devInstrumentation.timeAsync('ipc.getProgramRegistry', () => window.beale.getProgramRegistry()));
  }, []);

  useEffect(() => {
    window.beale
      .getHostEnvironment()
      .then(setHostEnvironment)
      .catch((caught: unknown) => setError(errorMessage(caught)));

    devInstrumentation
      .timeAsync('ipc.getSnapshot.initial', () => window.beale.getSnapshot())
      .then((initial) => {
        applySnapshot(initial);
      })
      .catch((caught: unknown) => setError(errorMessage(caught)));

    devInstrumentation
      .timeAsync('ipc.getProgramRegistry.initial', () => window.beale.getProgramRegistry())
      .then(setProgramRegistry)
      .catch((caught: unknown) => setError(errorMessage(caught)));

    window.beale
      .getOpenAiStatus()
      .then(setOpenAiStatus)
      .catch((caught: unknown) => setError(errorMessage(caught)));

    window.beale
      .getWindowChromeState()
      .then(setWindowChromeState)
      .catch((caught: unknown) => setError(errorMessage(caught)));

    const unsubscribeSnapshot = window.beale.onSnapshot((next) => {
      devInstrumentation.recordPayload('ipc.snapshot.event', next, snapshotMetricDetail(next));
      startTransition(() => applySnapshot(next));
    });
    const unsubscribeProgramRegistry = window.beale.onProgramRegistry((next) => {
      startTransition(() => setProgramRegistry(next));
    });
    const unsubscribeWindowChromeState = window.beale.onWindowChromeState(setWindowChromeState);
    return () => {
      unsubscribeSnapshot();
      unsubscribeProgramRegistry();
      unsubscribeWindowChromeState();
    };
  }, [applySnapshot]);

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

  const runProgramAction = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await loadProgramRegistry();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
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

  const addProgram = (): void => {
    void runProgramAction(async () => {
      const selection = await window.beale.selectProgramDirectory();
      if (selection.canceled) return;
      if (selection.knownProgram) {
        applySnapshot(await window.beale.openProgram(selection.knownProgram.id));
        return;
      }
      if (selection.defaults) {
        setProgramDraft(onboardingFormFromDefaults(selection.defaults));
      }
    });
  };

  const openRegisteredProgram = (program: ProgramRegistryEntry): void => {
    void runProgramAction(async () => {
      applySnapshot(await window.beale.openProgram(program.id));
    });
  };

  const openResearchSession = (program: ProgramRegistryEntry, session: ResearchSessionSummary): void => {
    void runProgramAction(async () => {
      clearRunDetail();
      const activeProgram = snapshot?.workspace.workspacePath === program.workspacePath;
      const next = activeProgram ? await window.beale.getSnapshot() : await window.beale.openProgram(program.id);
      applySnapshot(next);
      setSelectedRunId(session.runId);
    });
  };

  const removeRegisteredProgram = (program: ProgramRegistryEntry): void => {
    void runProgramAction(async () => {
      setProgramInfo((current) => (current?.id === program.id ? null : current));
      setOpenProgramMenuId(null);
      applySnapshot(await window.beale.removeProgram(program.id));
    });
  };

  const submitProgramOnboarding = (): void => {
    if (!programDraft) return;
    void runProgramAction(async () => {
      const next = await window.beale.createProgram(onboardingInputFromForm(programDraft));
      setProgramDraft(null);
      applySnapshot(next);
    });
  };

  const applyOnboardingTemplate = (templateKind: ProgramTemplateKind): void => {
    setProgramDraft((current) => (current ? applyProgramTemplate(current, templateKind) : current));
  };

  const lookupHackerOneProgram = async (identifier: string): Promise<void> => {
    const lookup = await window.beale.lookupHackerOneProgram(identifier);
    setProgramDraft((current) =>
      current
        ? {
            ...current,
            templateKind: 'hackerone',
            programName: lookup.programName,
            organizationName: lookup.organizationName,
            descriptionMarkdown: lookup.descriptionMarkdown,
            rulesMarkdown: lookup.rulesMarkdown,
            networkProfile: lookup.networkProfile,
            expiresAt: lookup.expiresAt ? lookup.expiresAt.slice(0, 10) : '',
            assets: lookup.assets
          }
        : current
    );
  };

  const handleSteerInstruction = useCallback(
    (runId: string, instruction: string): void => {
      void runAction(() => window.beale.steerRun({ type: 'steer', runId, instruction }));
    },
    [runAction]
  );

  const activeRunDetail = activeRunDetailForSelection(runDetail, selectedRunId);
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
    closeTraceDetail
  } = useTraceSelection({
    detail: activeRunDetail,
    events: activeTraceEvents,
    selectedRunId
  });
  const sessionHeat = useMemo(() => sessionHeatForDetail(activeRunDetail), [activeRunDetail]);
  const researchMomentum = useMemo(() => researchMomentumForDetail(activeRunDetail, sessionHeat), [activeRunDetail, sessionHeat]);
  const environmentActivity = useMemo(() => environmentActivityForDetail(activeRunDetail), [activeRunDetail]);
  const shellClassName = appShellClassName({
    sessionHeat,
    momentumState: researchMomentum.state,
    sessionActive: activeRunDetail?.run.status === 'active',
    windowChromeState,
    sidebarCollapsed,
    inspectorOpen
  });
  const vmPreference = vmPreferenceForState(programRegistry, snapshot);
  const windowControlPlatform = windowControlPlatformForState(snapshot, hostEnvironment);
  const configureVm = useCallback(() => {
    setSettingsSection('general');
    setSettingsOpen(true);
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openTraceFilters = useCallback(() => setTraceFilterOpen(true), []);
  const toggleInspector = useCallback(() => setInspectorOpen((current) => !current), []);

  return (
    <div className={shellClassName} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <AppBackgroundPulses />
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        platform={windowControlPlatform}
        onToggleSidebar={toggleSidebar}
      />
      <ProgramSidebar
        busy={busy}
        collapsed={sidebarCollapsed}
        error={error}
        openProgramMenuId={openProgramMenuId}
        programRegistry={programRegistry}
        selectedRunId={selectedRunId}
        snapshot={snapshot}
        onAddProgram={addProgram}
        onOpenProgram={openRegisteredProgram}
        onOpenProgramInfo={setProgramInfo}
        onOpenResearchSession={openResearchSession}
        onRemoveProgram={removeRegisteredProgram}
        onResizePointerDown={beginSidebarResize}
        onSetOpenProgramMenuId={setOpenProgramMenuId}
        onShowMoreSessions={setSessionHistoryProgramId}
        onStartNewResearch={() => setNewResearchOpen(true)}
      />

      <main className="workbench" data-session-heat={sessionHeat}>
        <SessionHeader
          detail={activeRunDetail}
          events={activeTraceEvents}
          programName={snapshot?.activeScope.programName ?? 'No Program Selected'}
          visibleTraceCategories={visibleTraceCategories}
          onOpenResearchPrompt={setResearchPromptDetail}
        />
        <div className="workspace-page">
          <MainSessionWorkspace
            detail={activeRunDetail}
            events={activeTraceEvents}
            selectedRunId={selectedRunId}
            selectedTraceEventId={selectedTraceEventId}
            visibleTraceCategories={visibleTraceCategories}
            busy={busy}
            onSelectTraceEvent={selectTraceEvent}
            onSteerInstruction={handleSteerInstruction}
          />
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
        notificationCount={snapshot?.notifications.length ?? 0}
        inspectorOpen={inspectorOpen}
        traceFilterCount={visibleTraceCategories.length}
        totalTraceFilterCount={ALL_TRACE_CATEGORY_IDS.length}
        onConfigureVm={configureVm}
        onOpenSettings={openSettings}
        onOpenTraceFilters={openTraceFilters}
        onToggleInspector={toggleInspector}
      />
      <NotificationStack notifications={snapshot?.notifications ?? []} onOpen={openNotification} onDismiss={dismissNotification} />
      <AppModals
        activeNotification={activeNotification}
        activeRunDetail={activeRunDetail}
        busy={busy}
        newResearchOpen={newResearchOpen}
        openAiOAuthResult={openAiOAuthResult}
        openAiStatus={snapshot?.openAi ?? openAiStatus}
        programDraft={programDraft}
        programInfo={programInfo}
        researchPromptDetail={researchPromptDetail}
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
        onCancelProgramOnboarding={() => setProgramDraft(null)}
        onChangeProgramDraft={setProgramDraft}
        onChangeSettingsSection={setSettingsSection}
        onChangeVisibleTraceCategories={setVisibleTraceCategories}
        onCloseNotification={() => setActiveNotification(null)}
        onCloseProgramInfo={() => setProgramInfo(null)}
        onCloseResearchPrompt={() => setResearchPromptDetail(null)}
        onCloseSessionHistory={() => setSessionHistoryProgramId(null)}
        onCloseSettings={() => setSettingsOpen(false)}
        onCloseTraceDetail={closeTraceDetail}
        onCloseTraceFilters={() => setTraceFilterOpen(false)}
        onLookupHackerOne={lookupHackerOneProgram}
        onOpenSessionHistorySession={(program, session) => {
          openResearchSession(program, session);
          setSessionHistoryProgramId(null);
        }}
        onProgramTemplate={applyOnboardingTemplate}
        onRefreshOpenAi={refreshOpenAiProvider}
        onSetVmPreference={updateVmPreference}
        onStartOpenAiOAuth={startOpenAiOAuth}
        onStartedNewResearch={(runId) => {
          clearRunDetail();
          setSelectedRunId(runId);
          setNewResearchOpen(false);
        }}
        onSteerNotification={(notification, instruction) => {
          void runAction(() => window.beale.steerRun({ type: 'steer', runId: notification.runId, instruction }));
          setActiveNotification(null);
        }}
        onSubmitProgramOnboarding={submitProgramOnboarding}
        runAction={runAction}
      />
    </div>
  );
}
