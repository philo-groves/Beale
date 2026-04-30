import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { devInstrumentation, useDevInputLatencyProbe, useDevRenderProbe } from './devInstrumentation';
import type { DevMetricDetail } from './devInstrumentation';
import type {
  HostEnvironment,
  NotificationRecord,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  ProgramRegistryEntry,
  ProgramRegistryState,
  ResearchSessionSummary,
  RunDetail,
  RunDetailUpdate,
  TraceEventRecord,
  TranscriptMessageRecord,
  VmPreference,
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
import { ResearchSidePanel } from './features/research/ResearchSidePanel';
import { SessionHeader } from './features/sessions/SessionHeader';
import { StartRunForm } from './features/sessions/StartRunForm';
import { ResearchPromptModal } from './features/sessions/ResearchPromptModal';
import { SettingsModal, type SettingsSection } from './features/settings/SettingsModal';
import type { ResearchMomentum, ResearchMomentumState } from './features/momentum/types';
import { TraceDetailModal } from './features/traces/TraceDetailModal';
import { TraceFilterModal } from './features/traces/TraceFilterModal';
import { TraceView } from './features/traces/TraceView';
import { ALL_TRACE_CATEGORY_IDS } from './features/traces/traceVisuals';
import {
  stateClass,
  traceLabel
} from './lib/formatting';
import {
  traceCategoryForEvent,
  traceEventOutcome,
  tracePayloadPrimitive
} from './traceClassification';
import type { TraceCategoryId } from './traceClassification';
import { errorMessage } from './lib/errors';
import { findBackendByKind, type EnvironmentActivity } from './view-models/environmentDisplay';
import { researchSessionsForProgram } from './view-models/programDisplay';
import {
  applyProgramTemplate,
  onboardingFormFromDefaults,
  onboardingInputFromForm,
  type ProgramOnboardingFormState,
  type ProgramTemplateKind
} from './view-models/programOnboarding';
import { isIgnoredHeatState, sessionHeatForDetail, type SessionHeat } from './view-models/sessionHeat';
import {
  findingForTraceEvent,
  hypothesisForTraceEvent,
  traceEventSummary,
  trimTraceLabelPeriod
} from './view-models/traceContent';
import {
  buildTraceDisplayEvents,
  type TraceDisplayEvent
} from './view-models/traceDisplay';

const RESEARCH_MOMENTUM_WINDOW_MS = 90_000;
const RESEARCH_MOMENTUM_RECENT_LIMIT = 18;
const INSET_SCROLLBAR_ACTIVE_MS = 900;
const INSET_SCROLLBAR_SELECTOR = [
  '.sidebar',
  '.inspector-sidebar',
  '.main-trace-list',
  '.main-hypothesis-list',
  '.main-finding-list',
  '.modal-body',
  '.session-history-list',
  '.trace-inspector-payload pre',
  '.center-column',
  '.tracker-panel',
  '.timeline',
  '.notification-detail pre'
].join(', ');

const DEFAULT_VM_PREFERENCE: VmPreference = {
  enabled: false,
  backendKind: null,
  updatedAt: null
};

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
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const previousRunIdRef = useRef<string | null>(null);
  const runDetailRequestSeqRef = useRef(0);
  const runDetailVersionRef = useRef<string | null>(null);
  const runDetailRef = useRef<RunDetail | null>(null);

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

  useEffect(() => {
    runDetailRef.current = runDetail;
  }, [runDetail]);

  useEffect(() => {
    const timers = new Map<Element, number>();

    const handleScroll = (event: Event): void => {
      if (!(event.target instanceof Element) || !event.target.matches(INSET_SCROLLBAR_SELECTOR)) {
        return;
      }

      const target = event.target;
      target.classList.add('scrollbar-active');
      const existingTimer = timers.get(target);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      timers.set(
        target,
        window.setTimeout(() => {
          target.classList.remove('scrollbar-active');
          timers.delete(target);
        }, INSET_SCROLLBAR_ACTIVE_MS)
      );
    };

    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

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

  const selectedRunStatus = selectedRunId ? snapshot?.runs.find((row) => row.run.id === selectedRunId)?.run.status ?? null : null;

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
    const requestSeq = ++runDetailRequestSeqRef.current;
    if (!selectedRunId) {
      runDetailVersionRef.current = null;
      runDetailRef.current = null;
      setRunDetail(null);
      return undefined;
    }

    runDetailVersionRef.current = null;
    runDetailRef.current = null;
    let disposed = false;
    let inFlight = false;
    const refreshRunDetail = (): void => {
      if (inFlight) return;
      inFlight = true;
      devInstrumentation
        .timeAsync('ipc.getRunDetailVersion', () => window.beale.getRunDetailVersion(selectedRunId), { run: shortMetricId(selectedRunId) })
        .then(async (version) => {
          devInstrumentation.recordEvent('ipc.getRunDetailVersion.payload', {
            run: shortMetricId(version.runId),
            databaseMs: version.databaseMs,
            version: shortMetricId(version.version)
          });
          if (!disposed && requestSeq === runDetailRequestSeqRef.current && version.version === runDetailVersionRef.current) {
            return null;
          }
          const currentDetail = runDetailRef.current;
          if (currentDetail?.run.id === selectedRunId && runDetailVersionRef.current) {
            const update = await devInstrumentation.timeAsync(
              'ipc.getRunDetailUpdate',
              () => window.beale.getRunDetailUpdate(selectedRunId, runDetailUpdateCursor(currentDetail)),
              { run: shortMetricId(selectedRunId) }
            );
            return { detail: mergeRunDetailUpdate(currentDetail, update), version: update.version.version, update };
          }
          const detail = await devInstrumentation.timeAsync('ipc.getRunDetail', () => window.beale.getRunDetail(selectedRunId), { run: shortMetricId(selectedRunId) });
          return { detail, version: version.version, update: null };
        })
        .then((result) => {
          if (!result) return;
          const { detail, version, update } = result;
          if (update) {
            devInstrumentation.recordPayload('ipc.getRunDetailUpdate.payload', update, runDetailUpdateMetricDetail(update));
          } else {
            devInstrumentation.recordPayload('ipc.getRunDetail.payload', detail, runDetailMetricDetail(detail));
          }
          if (!disposed && requestSeq === runDetailRequestSeqRef.current) {
            if (version !== runDetailVersionRef.current) {
              runDetailVersionRef.current = version;
              runDetailRef.current = detail;
              startTransition(() => setRunDetail(detail));
            } else {
              devInstrumentation.recordEvent('ipc.getRunDetail.versionRaceSkipped', {
                run: shortMetricId(detail.run.id)
              });
            }
          }
        })
        .catch((caught: unknown) => {
          if (!disposed && requestSeq === runDetailRequestSeqRef.current) {
            setError(errorMessage(caught));
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };

    refreshRunDetail();
    if (selectedRunStatus !== 'active') {
      return () => {
        disposed = true;
      };
    }

    const interval = window.setInterval(refreshRunDetail, 750);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [selectedRunId, selectedRunStatus]);

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
      setRunDetail(null);
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

  const beginSidebarResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);
    document.body.classList.add('is-resizing-sidebar');

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      setSidebarWidth(Math.max(240, Math.min(420, startWidth + moveEvent.clientX - startX)));
    };
    const handlePointerUp = (): void => {
      document.body.classList.remove('is-resizing-sidebar');
      target.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const activeRunDetail = runDetail && runDetail.run.id === selectedRunId ? runDetail : null;
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
  const sessionActive = activeRunDetail?.run.status === 'active';
  const appShellClassName = [
    'app-shell',
    `session-heat-${sessionHeat}`,
    `momentum-${researchMomentum.state}`,
    sessionActive ? 'session-active' : '',
    windowChromeState.isMaximized || windowChromeState.isFullScreen ? 'window-edge-flush' : '',
    sidebarCollapsed ? 'sidebar-collapsed' : '',
    inspectorOpen ? 'inspector-open' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const sessionHistoryProgram =
    sessionHistoryProgramId && programRegistry ? programRegistry.programs.find((program) => program.id === sessionHistoryProgramId) ?? null : null;
  const sessionHistorySessions = sessionHistoryProgram && programRegistry ? researchSessionsForProgram(programRegistry, sessionHistoryProgram) : [];
  const vmPreference = programRegistry?.vmPreference ?? snapshot?.vmPreference ?? DEFAULT_VM_PREFERENCE;
  const windowControlPlatform = (snapshot?.workspace.hostEnvironment ?? hostEnvironment)?.platform ?? 'linux';
  const toggleSidebar = useCallback(() => setSidebarCollapsed((current) => !current), []);
  const configureVm = useCallback(() => {
    setSettingsSection('general');
    setSettingsOpen(true);
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openTraceFilters = useCallback(() => setTraceFilterOpen(true), []);
  const toggleInspector = useCallback(() => setInspectorOpen((current) => !current), []);

  return (
    <div className={appShellClassName} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
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
            setRunDetail(null);
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

function selectRunId(current: string | null, snapshot: WorkspaceSnapshot | null): string | null {
  if (!snapshot) return null;
  if (current && snapshot.runs.some(({ run }) => run.id === current)) return current;
  return snapshot.runs[0]?.run.id ?? null;
}

function snapshotMetricDetail(snapshot: WorkspaceSnapshot | null): DevMetricDetail {
  return {
    active: Boolean(snapshot),
    runs: snapshot?.runs.length ?? 0,
    notifications: snapshot?.notifications.length ?? 0,
    programs: snapshot?.workspace ? 1 : 0
  };
}

function runDetailMetricDetail(detail: RunDetail): DevMetricDetail {
  return {
    run: shortMetricId(detail.run.id),
    status: detail.run.status,
    traceEvents: detail.traceEvents.length,
    transcripts: detail.transcriptMessages.length,
    hypotheses: detail.hypotheses.length,
    findings: detail.findings.length,
    evidence: detail.evidence.length
  };
}

function runDetailUpdateMetricDetail(update: RunDetailUpdate): DevMetricDetail {
  return {
    run: shortMetricId(update.run.id),
    status: update.run.status,
    versionDatabaseMs: update.version.databaseMs,
    traceEvents: update.traceEvents.length,
    transcripts: update.transcriptMessages.length,
    hypotheses: update.hypotheses.length,
    findings: update.findings.length,
    evidence: update.evidence.length
  };
}

function runDetailUpdateCursor(detail: RunDetail): { afterTraceSequence: number; afterTranscriptCount: number } {
  return {
    afterTraceSequence: detail.traceEvents.at(-1)?.sequence ?? -1,
    afterTranscriptCount: detail.transcriptMessages.length
  };
}

function mergeRunDetailUpdate(current: RunDetail, update: RunDetailUpdate): RunDetail {
  return {
    run: update.run,
    attempts: update.attempts,
    traceEvents: mergeTraceEvents(current.traceEvents, update.traceEvents),
    transcriptMessages: mergeTranscriptMessages(current.transcriptMessages, update.transcriptMessages),
    hypotheses: update.hypotheses,
    artifacts: update.artifacts,
    evidence: update.evidence,
    findings: update.findings,
    verifierContracts: update.verifierContracts,
    verifierRuns: update.verifierRuns,
    vmContexts: update.vmContexts,
    modelSessions: update.modelSessions,
    contextCompactions: update.contextCompactions,
    policyEvents: update.policyEvents,
    exports: update.exports
  };
}

function mergeTraceEvents(current: TraceEventRecord[], incoming: TraceEventRecord[]): TraceEventRecord[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort((left, right) => left.sequence - right.sequence);
}

function mergeTranscriptMessages(current: TranscriptMessageRecord[], incoming: TranscriptMessageRecord[]): TranscriptMessageRecord[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

function shortMetricId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function MainSessionWorkspace({
  detail,
  events,
  selectedRunId,
  selectedTraceEventId,
  visibleTraceCategories,
  busy,
  onSelectTraceEvent,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  selectedRunId: string | null;
  selectedTraceEventId: string | null;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  if (!selectedRunId) return null;

  return (
    <div className="main-session-grid">
      <TraceView
        busy={busy}
        detail={detail}
        events={events}
        selectedRunId={selectedRunId}
        selectedTraceEventId={selectedTraceEventId}
        visibleTraceCategories={visibleTraceCategories}
        onSelectTraceEvent={onSelectTraceEvent}
        onSteerInstruction={onSteerInstruction}
      />
      <ResearchSidePanel detail={detail} events={events} selectedTraceEventId={selectedTraceEventId} onSelectTraceEvent={onSelectTraceEvent} />
    </div>
  );
}

function environmentActivityForDetail(detail: RunDetail | null): EnvironmentActivity {
  if (!detail || detail.run.status !== 'active') return { host: false, guest: false };
  const latest = detail.traceEvents.at(-1);
  if (!latest) return { host: true, guest: false };
  const category = traceCategoryForEvent(latest);

  if (latest.source === 'executor' || latest.type === 'vm_event' || category === 'vm_execution' || category === 'tools' || category === 'verifier' || category === 'code_navigation') {
    return { host: false, guest: true };
  }

  if (latest.source === 'model' || latest.source === 'policy' || latest.source === 'system' || latest.source === 'user') {
    return { host: true, guest: false };
  }

  return { host: true, guest: false };
}

function researchMomentumForDetail(detail: RunDetail | null, heat: SessionHeat): ResearchMomentum {
  if (!detail) return momentumState('idle', 'No research session is selected.');
  if (detail.run.status === 'queued') return momentumState('waiting', 'The research session is queued.');
  if (detail.run.status !== 'active') return momentumState('idle', `The research session is ${traceLabel(detail.run.status)}.`);

  const recent = recentMomentumTraceEvents(detail.traceEvents);
  const latest = recent.at(-1) ?? null;
  if (recent.length === 0) return momentumState('waiting', 'Waiting for the first trace event.');

  const waitingEvents = recent.filter(isMomentumWaitingEvent);
  if (waitingEvents.length > 0 && latest && isMomentumWaitingEvent(latest)) {
    return momentumState('waiting', momentumReasonFromEvent('Waiting on setup or approval', latest), waitingEvents);
  }

  const failureEvents = recent.filter(isMomentumFailureEvent);
  if (isMomentumStuck(recent, failureEvents)) {
    return momentumState('stuck', momentumStuckReason(recent, failureEvents), failureEvents);
  }

  if (hasMomentumHotLead(detail, heat, recent)) {
    const supporting = recent.filter((event) => isMomentumVerifyingEvent(event) || isMomentumBuildingEvent(event) || traceCategoryForEvent(event) === 'evidence');
    return momentumState('hot', `Evidence-backed ${traceLabel(heat)} lead is active.`, supporting.length > 0 ? supporting : recent.slice(-3));
  }

  const verifyingEvents = recent.filter(isMomentumVerifyingEvent);
  if (verifyingEvents.length > 0) {
    return momentumState('verifying', momentumReasonFromEvent('Verifying evidence', verifyingEvents.at(-1) ?? latest), verifyingEvents);
  }

  const buildingEvents = recent.filter(isMomentumBuildingEvent);
  if (buildingEvents.length > 0) {
    return momentumState('building', momentumReasonFromEvent('Building hypotheses or experiments', buildingEvents.at(-1) ?? latest), buildingEvents);
  }

  const exploringEvents = recent.filter(isMomentumExploringEvent);
  if (exploringEvents.length > 0) {
    return momentumState('exploring', momentumReasonFromEvent('Exploring target surface', exploringEvents.at(-1) ?? latest), exploringEvents);
  }

  return momentumState('exploring', momentumReasonFromEvent('Active session is producing trace events', latest), recent.slice(-3));
}

function recentMomentumTraceEvents(events: TraceEventRecord[]): TraceEventRecord[] {
  const now = Date.now();
  const recent = events.filter((event) => {
    const created = Date.parse(event.createdAt);
    return Number.isFinite(created) && now - created >= 0 && now - created <= RESEARCH_MOMENTUM_WINDOW_MS;
  });
  return recent.length > 0 ? recent : events.slice(-RESEARCH_MOMENTUM_RECENT_LIMIT);
}

function momentumState(state: ResearchMomentumState, reason: string, events: TraceEventRecord[] = []): ResearchMomentum {
  return {
    state,
    reason,
    since: events[0]?.createdAt ?? null,
    supportingTraceEventIds: events.map((event) => event.id)
  };
}

function momentumReasonFromEvent(prefix: string, event: TraceEventRecord | null): string {
  if (!event) return `${prefix}.`;
  return `${prefix}: ${trimTraceLabelPeriod(traceEventSummary(event, traceCategoryForEvent(event)))}.`;
}

function isMomentumWaitingEvent(event: TraceEventRecord): boolean {
  const text = momentumEventText(event);
  return /\b(waiting|approval|approve|authenticate|credential|authorization|permission|not configured|configure|blocked by|requires setup|user input)\b/.test(text);
}

function isMomentumFailureEvent(event: TraceEventRecord): boolean {
  const category = traceCategoryForEvent(event);
  if (category === 'failure_recovery' || traceEventOutcome(event) === 'failure') return true;
  return /\b(retry|unavailable|unsupported|missing|no local source|not found|blocked)\b/.test(momentumOperationalText(event));
}

function isMomentumStuck(recent: TraceEventRecord[], failureEvents: TraceEventRecord[]): boolean {
  if (failureEvents.length >= 3) return true;
  const latest = recent.at(-1);
  if (failureEvents.length >= 2 && latest && isMomentumFailureEvent(latest)) return true;
  const sourceUnavailableCount = recent.filter((event) => /\b(source unavailable|no local source|materialize source|clone failed)\b/.test(momentumOperationalText(event))).length;
  return sourceUnavailableCount >= 2;
}

function momentumStuckReason(recent: TraceEventRecord[], failureEvents: TraceEventRecord[]): string {
  const sourceUnavailableCount = recent.filter((event) => /\b(source unavailable|no local source|materialize source|clone failed)\b/.test(momentumOperationalText(event))).length;
  if (sourceUnavailableCount >= 2) return 'Repeated source availability blockers detected.';
  const latestFailure = failureEvents.at(-1) ?? recent.at(-1) ?? null;
  return momentumReasonFromEvent('Repeated errors detected', latestFailure);
}

function hasMomentumHotLead(detail: RunDetail, heat: SessionHeat, recent: TraceEventRecord[]): boolean {
  if (heat !== 'high' && heat !== 'critical') return false;
  const recentProgress = recent.some((event) => isMomentumVerifyingEvent(event) || isMomentumBuildingEvent(event) || traceCategoryForEvent(event) === 'evidence');
  if (recentProgress) return true;

  return (
    detail.findings.some((finding) => !isIgnoredHeatState(finding.state) && isMomentumRecentIso(finding.updatedAt)) ||
    detail.hypotheses.some((hypothesis) => {
      const state = stateClass(hypothesis.state);
      return (state === 'reproduced' || state === 'promoted' || state === 'verified') && isMomentumRecentIso(hypothesis.updatedAt);
    })
  );
}

function isMomentumVerifyingEvent(event: TraceEventRecord): boolean {
  const category = traceCategoryForEvent(event);
  if (category === 'verifier') return true;
  const text = momentumEventText(event);
  return (
    category === 'vm_execution' ||
    /\b(verifier|verify|verified|repro|reproduction|debugger|poc|proof|crash|sanitizer|exploit|execute|test|assert)\b/.test(text)
  );
}

function isMomentumBuildingEvent(event: TraceEventRecord): boolean {
  const category = traceCategoryForEvent(event);
  if (category === 'hypotheses' || category === 'evidence') return true;
  return /\b(hypothesis|finding|artifact|experiment|prepare|construct|build|created|promote|chain)\b/.test(momentumEventText(event));
}

function isMomentumExploringEvent(event: TraceEventRecord): boolean {
  const category = traceCategoryForEvent(event);
  if (category === 'code_navigation' || category === 'tools') return true;
  return /\b(search|inspect|read|list|grep|repository|source|import|clone|map|enumerate)\b/.test(momentumEventText(event));
}

function isMomentumRecentIso(value: string): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= RESEARCH_MOMENTUM_WINDOW_MS;
}

function momentumEventText(event: TraceEventRecord): string {
  let payload = '';
  try {
    payload = JSON.stringify(event.payload);
  } catch {
    payload = '';
  }
  return `${event.source}\n${event.type}\n${event.summary}\n${payload}`.toLowerCase();
}

function momentumOperationalText(event: TraceEventRecord): string {
  return [
    event.source,
    event.type,
    event.summary,
    tracePayloadPrimitive(event.payload, 'status'),
    tracePayloadPrimitive(event.payload, 'error'),
    tracePayloadPrimitive(event.payload, 'reason'),
    tracePayloadPrimitive(event.payload, 'message'),
    tracePayloadPrimitive(event.payload, 'blockedIssue'),
    tracePayloadPrimitive(event.payload, 'sourceAcquisitionHint')
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .toLowerCase();
}
