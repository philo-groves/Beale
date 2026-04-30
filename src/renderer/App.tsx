import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { AppBackgroundPulses } from './app/AppBackgroundPulses';
import { StatusBar } from './app/StatusBar';
import { TopBar } from './app/TopBar';
import { NotificationDetailModal, NotificationStack } from './features/notifications/Notifications';
import { ProgramInformationModal, ProgramSessionHistoryModal } from './features/programs/ProgramModals';
import { ProgramOnboardingModal } from './features/programs/ProgramOnboardingModal';
import { ProgramSidebar } from './features/programs/ProgramSidebar';
import { EvidenceSidebar } from './features/research/EvidenceSidebar';
import { MainSessionWorkspace } from './features/sessions/MainSessionWorkspace';
import { SessionHeader } from './features/sessions/SessionHeader';
import { StartRunForm } from './features/sessions/StartRunForm';
import { ResearchPromptModal } from './features/sessions/ResearchPromptModal';
import { SettingsModal, type SettingsSection } from './features/settings/SettingsModal';
import { TraceDetailModal } from './features/traces/TraceDetailModal';
import { TraceFilterModal } from './features/traces/TraceFilterModal';
import { ALL_TRACE_CATEGORY_IDS } from './features/traces/traceVisuals';
import { useInsetScrollbarActivation } from './hooks/useInsetScrollbarActivation';
import { useResizableSidebar } from './hooks/useResizableSidebar';
import { useRunDetailPolling } from './hooks/useRunDetailPolling';
import type { TraceCategoryId } from './traceClassification';
import { errorMessage } from './lib/errors';
import { environmentActivityForDetail } from './view-models/environmentDisplay';
import { researchSessionsForProgram } from './view-models/programDisplay';
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
import {
  findingForTraceEvent,
  hypothesisForTraceEvent
} from './view-models/traceContent';
import {
  buildTraceDisplayEvents,
  type TraceDisplayEvent
} from './view-models/traceDisplay';
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
  const [programInfo, setProgramInfo] = useState<ProgramRegistryEntry | null>(null);
  const [sessionHistoryProgramId, setSessionHistoryProgramId] = useState<string | null>(null);
  const [openProgramMenuId, setOpenProgramMenuId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [traceFilterOpen, setTraceFilterOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationRecord | null>(null);
  const [researchPromptDetail, setResearchPromptDetail] = useState<RunDetail | null>(null);
  const [traceDetailOpen, setTraceDetailOpen] = useState(false);
  const [visibleTraceCategories, setVisibleTraceCategories] = useState<TraceCategoryId[]>(ALL_TRACE_CATEGORY_IDS);
  const [selectedTraceEventId, setSelectedTraceEventId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { sidebarWidth, sidebarCollapsed, toggleSidebar, beginSidebarResize } = useResizableSidebar();
  const previousRunIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (previousRunIdRef.current === selectedRunId) return;
    previousRunIdRef.current = selectedRunId;
    setSelectedTraceEventId(null);
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedTraceEventId || !runDetail) return;
    const traceEvents = devInstrumentation.time('trace.buildDisplayEvents.selectionGuard', () => buildTraceDisplayEvents(runDetail), runDetailMetricDetail(runDetail));
    if (!traceEvents.some((event) => event.id === selectedTraceEventId)) {
      setSelectedTraceEventId(null);
      setTraceDetailOpen(false);
    }
  }, [runDetail, selectedTraceEventId]);

  useEffect(() => {
    if (!openProgramMenuId) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Element && !event.target.closest('[data-program-menu-root]')) {
        setOpenProgramMenuId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenProgramMenuId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openProgramMenuId]);

  useEffect(() => {
    if (!programRegistry) return;
    if (openProgramMenuId && !programRegistry.programs.some((program) => program.id === openProgramMenuId)) {
      setOpenProgramMenuId(null);
    }
    if (programInfo && !programRegistry.programs.some((program) => program.id === programInfo.id)) {
      setProgramInfo(null);
    }
    if (sessionHistoryProgramId && !programRegistry.programs.some((program) => program.id === sessionHistoryProgramId)) {
      setSessionHistoryProgramId(null);
    }
  }, [openProgramMenuId, programInfo, programRegistry, sessionHistoryProgramId]);

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

  const handleSelectTraceEvent = useCallback((event: TraceDisplayEvent): void => {
    setSelectedTraceEventId(event.id);
    setTraceDetailOpen(true);
  }, []);

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
  const selectedTraceEvent = useMemo(() => activeTraceEvents.find((event) => event.id === selectedTraceEventId) ?? null, [activeTraceEvents, selectedTraceEventId]);
  const selectedTraceFinding = selectedTraceEvent ? findingForTraceEvent(activeRunDetail, selectedTraceEvent) : null;
  const selectedTraceHypothesis = selectedTraceEvent ? hypothesisForTraceEvent(activeRunDetail, selectedTraceEvent) : null;
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
  const sessionHistoryProgram =
    sessionHistoryProgramId && programRegistry ? programRegistry.programs.find((program) => program.id === sessionHistoryProgramId) ?? null : null;
  const sessionHistorySessions = sessionHistoryProgram && programRegistry ? researchSessionsForProgram(programRegistry, sessionHistoryProgram) : [];
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
            onSelectTraceEvent={handleSelectTraceEvent}
            onSteerInstruction={handleSteerInstruction}
          />
        </div>
      </main>
      <aside className="inspector-sidebar" aria-label="Evidence" aria-hidden={!inspectorOpen} inert={!inspectorOpen}>
        <EvidenceSidebar
          detail={activeRunDetail}
          events={activeTraceEvents}
          onSelectTraceEvent={handleSelectTraceEvent}
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
      {programDraft ? (
        <ProgramOnboardingModal
          busy={busy}
          form={programDraft}
          onCancel={() => setProgramDraft(null)}
          onChange={setProgramDraft}
          onLookupHackerOne={lookupHackerOneProgram}
          onTemplate={applyOnboardingTemplate}
          onSubmit={submitProgramOnboarding}
        />
      ) : null}
      {newResearchOpen && snapshot ? (
        <StartRunForm
          snapshot={snapshot}
          vmPreference={vmPreference}
          busy={busy}
          runAction={runAction}
          onCancel={() => setNewResearchOpen(false)}
          onStarted={(runId) => {
            clearRunDetail();
            setSelectedRunId(runId);
            setNewResearchOpen(false);
          }}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          section={settingsSection}
          executor={snapshot?.executor ?? null}
          vmPreference={vmPreference}
          openAiOAuthResult={openAiOAuthResult}
          openAiStatus={snapshot?.openAi ?? openAiStatus}
          busy={busy}
          onChangeSection={setSettingsSection}
          onClose={() => setSettingsOpen(false)}
          onSetVmPreference={updateVmPreference}
          onRefreshOpenAi={refreshOpenAiProvider}
          onStartOpenAiOAuth={startOpenAiOAuth}
        />
      ) : null}
      {traceFilterOpen ? (
        <TraceFilterModal
          visibleCategories={visibleTraceCategories}
          onChange={setVisibleTraceCategories}
          onClose={() => setTraceFilterOpen(false)}
        />
      ) : null}
      {activeNotification ? (
        <NotificationDetailModal
          notification={activeNotification}
          busy={busy}
          onClose={() => setActiveNotification(null)}
          onSteer={(instruction) => {
            void runAction(() => window.beale.steerRun({ type: 'steer', runId: activeNotification.runId, instruction }));
            setActiveNotification(null);
          }}
        />
      ) : null}
      {researchPromptDetail ? <ResearchPromptModal detail={researchPromptDetail} onClose={() => setResearchPromptDetail(null)} /> : null}
      {traceDetailOpen && selectedTraceEvent ? (
        <TraceDetailModal
          detail={activeRunDetail}
          event={selectedTraceEvent}
          finding={selectedTraceFinding}
          hypothesis={selectedTraceHypothesis}
          onClose={() => setTraceDetailOpen(false)}
        />
      ) : null}
      {programInfo ? <ProgramInformationModal program={programInfo} onClose={() => setProgramInfo(null)} /> : null}
      {sessionHistoryProgram ? (
        <ProgramSessionHistoryModal
          program={sessionHistoryProgram}
          sessions={sessionHistorySessions}
          selectedRunId={selectedRunId}
          onClose={() => setSessionHistoryProgramId(null)}
          onOpenSession={(session) => {
            openResearchSession(sessionHistoryProgram, session);
            setSessionHistoryProgramId(null);
          }}
        />
      ) : null}
    </div>
  );
}
