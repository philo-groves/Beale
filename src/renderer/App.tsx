import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { devInstrumentation, useDevInputLatencyProbe, useDevRenderProbe } from './devInstrumentation';
import type { DevMetricDetail } from './devInstrumentation';
import {
  Archive,
  Ban,
  Bug,
  CheckCircle2,
  ClipboardCheck,
  ClipboardX,
  Edit3,
  EyeOff,
  FileArchive,
  FileJson,
  FileOutput,
  FileText,
  Gauge,
  GitFork,
  GitMerge,
  KeyRound,
  LockKeyhole,
  Network,
  PackageCheck,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
  XCircle
} from 'lucide-react';
import type {
  ArtifactRecord,
  BenchmarkOverview,
  BenchmarkSuiteKind,
  ExportRecord,
  ExecutorStatus,
  FindingRecord,
  HypothesisRecord,
  HostEnvironment,
  NotificationRecord,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  PriorityFactorInput,
  ProgramOnboardingDefaults,
  ProgramOnboardingInput,
  ProgramRegistryEntry,
  ProgramRegistryState,
  ProgramScopeDraft,
  ProgramScopeVersion,
  ResearchSessionSummary,
  RunDetail,
  RunDetailUpdate,
  RunRow,
  ScopeAssetDirection,
  ScopeAssetInput,
  ScopeAssetKind,
  StartRunInput,
  TraceEventRecord,
  TranscriptMessageRecord,
  VmPreference,
  VmPreferenceInput,
  WindowChromeState,
  WorkspaceSnapshot
} from '@shared/types';
import { AppBackgroundPulses } from './app/AppBackgroundPulses';
import { Modal } from './app/Modal';
import { StatusPill } from './app/StatusPill';
import { StatusBar } from './app/StatusBar';
import { TopBar } from './app/TopBar';
import { NotificationDetailModal, NotificationStack } from './features/notifications/Notifications';
import { ProgramSidebar } from './features/programs/ProgramSidebar';
import { CwePill } from './features/research/CwePill';
import { EvidenceSidebar } from './features/research/EvidenceSidebar';
import { ResearchSidePanel } from './features/research/ResearchSidePanel';
import { SessionHeader } from './features/sessions/SessionHeader';
import { ResearchPromptModal } from './features/sessions/ResearchPromptModal';
import { SettingsModal, type SettingsSection } from './features/settings/SettingsModal';
import type { ResearchMomentum, ResearchMomentumState } from './features/momentum/types';
import { TraceDetailModal } from './features/traces/TraceDetailModal';
import { TraceFilterModal } from './features/traces/TraceFilterModal';
import { TraceView } from './features/traces/TraceView';
import { ALL_TRACE_CATEGORY_IDS } from './features/traces/traceVisuals';
import {
  clampPriorityScoreForDisplay,
  formatPercent,
  networkProfileLabel,
  shortDate,
  stateClass,
  traceLabel,
  truncateText
} from './lib/formatting';
import {
  traceCategoryForEvent,
  traceEventOutcome,
  tracePayloadPrimitive
} from './traceClassification';
import type { TraceCategoryId } from './traceClassification';
import { findBackendByKind, type EnvironmentActivity } from './view-models/environmentDisplay';
import { promptSessionTitle, researchSessionsForProgram, shortRelativeAge } from './view-models/programDisplay';
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

interface ScopeFormState {
  programName: string;
  organizationName: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  expiresAt: string;
  domains: string;
  repositories: string;
  executables: string;
  localPaths: string;
  credentialRefs: string;
  outOfScope: string;
}

interface ProgramOnboardingFormState {
  templateKind: ProgramTemplateKind;
  workspacePath: string;
  programName: string;
  organizationName: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  expiresAt: string;
  assets: ScopeAssetInput[];
}

type ProgramTemplateKind = 'manual' | 'hackerone' | 'apple' | 'msrc';

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

const UNBOUNDED_MINUTES = 999_999;
const UNBOUNDED_ATTEMPTS = 999_999;
const NETWORK_PROFILE_OPTIONS = ['offline', 'scoped', 'elevated'] as const;
const DEFAULT_VM_PREFERENCE: VmPreference = {
  enabled: false,
  backendKind: null,
  updatedAt: null
};

const APPLE_PROGRAM_DESCRIPTION =
  'Authorized research under the Apple Security Bounty program for eligible Apple product, platform, service, and security mechanism vulnerabilities described by Apple Security Research.';

const APPLE_SCOPE_AND_RULES = [
  '## Source of truth',
  'Verify current Apple Security Bounty scope, categories, guidelines, Target Flags, and submission requirements before testing or submitting.',
  '',
  '- Categories: https://security.apple.com/bounty/categories/',
  '- Guidelines: https://security.apple.com/bounty/guidelines/',
  '- Target Flags: https://security.apple.com/bounty/target-flags/',
  '',
  '## Authorized scope',
  '- Product research must affect the latest publicly available version, including beta versions, of iOS, iPadOS, macOS, tvOS, visionOS, or watchOS with standard configuration on publicly available Apple hardware or a Security Research Device.',
  '- Services research must relate to a web server or service owned by Apple or an Apple subsidiary.',
  '- Bounty categories include product exploit chains, Apple-designed radio proximity attacks, unauthorized physical device access, app and browser sandbox issues, macOS-only issues, Private Cloud Compute, and eligible Apple services issues such as iCloud data access, remote code execution, unrestricted file system or database access, logic flaws bypassing security controls, client/server code execution, sensitive data exposure, and domain or subdomain takeover.',
  '',
  '## Evidence and reporting requirements',
  '- Provide a complete and actionable report with observed behavior, expected behavior, the security or privacy mechanism bypassed, and attacker impact.',
  '- Include a reliable exploit or proof of concept, plus concise numbered reproduction steps.',
  '- For zero-click, one-click, or multi-exploit issues, submit the full chain as one report with everything needed to execute it and a nondestructive payload when needed.',
  '- Include crash logs, sysdiagnose output, or video demonstrations when applicable.',
  '- Use Target Flags when they apply to the category or reward level. For kernel or user-level privilege escalation, include a Commpage Target Flag PoC and crash log. For TCC database modification, use the `tccutil flag check` and `tccutil flag reset` workflow to confirm impact.',
  '',
  '## Boundaries',
  '- Do not publicly disclose before Apple releases an update with a security advisory or otherwise completes investigation.',
  '- Do not submit reports about third-party hardware, software, or services to Apple.',
  '- Do not rely on theoretical, unvalidated, incomplete, or AI-discovered claims without reproducible validation.',
  '- Do not brute force Target Flags.'
].join('\n');

const MSRC_PROGRAM_DESCRIPTION =
  'Authorized research under Microsoft Security Response Center bounty programs for eligible Microsoft cloud, endpoint, on-premises, developer, AI, identity, and service vulnerabilities described by MSRC.';

const MSRC_SCOPE_AND_RULES = [
  '## Source of truth',
  'Verify current Microsoft bounty scope, rules of engagement, coordinated vulnerability disclosure requirements, safe harbor, bounty guidelines, and individual program rules before testing or submitting.',
  '',
  '- Bounty overview: https://www.microsoft.com/en-us/msrc/bounty',
  '- Cloud programs: https://www.microsoft.com/en-us/msrc/bounty-programs#cloud',
  '- Endpoint and on-prem programs: https://www.microsoft.com/en-us/msrc/bounty-programs#endpoints',
  '- Researcher Portal: https://msrc.microsoft.com/report/vulnerability',
  '',
  '## Authorized scope',
  '- Cloud bounty programs include Microsoft Identity, Microsoft Azure, Microsoft Copilot, Xbox Live network and services, Azure DevOps Services, Dynamics 365 and Power Platform, Microsoft Defender for Endpoint APIs, Microsoft 365 including Office 365, .NET Core and ASP.NET Core, and selected Microsoft-owned open-source repositories.',
  '- Endpoint and on-prem bounty programs include Microsoft Hyper-V, Windows Insider Preview, Microsoft Applications and On-Premises Servers, Microsoft Edge Chromium channels, and Microsoft 365 Insider.',
  '- Zero Day Quest focuses on high-impact vulnerabilities in Azure, Copilot, Dynamics 365 and Power Platform, Microsoft Identity, and Microsoft 365 bounty programs, subject to the applicable bounty program and event terms.',
  '- Always confirm the specific product, service, build, tenant, account type, and test asset are in scope on the individual bounty program page before live testing.',
  '',
  '## Evidence and reporting requirements',
  '- Submit privately through the MSRC Researcher Portal under Coordinated Vulnerability Disclosure.',
  '- Provide clear reproduction steps, proof-of-concept code when safe, detailed technical analysis, affected assets, expected and observed behavior, security impact, prerequisites, and remediation-relevant details.',
  '- Prioritize new, unique vulnerabilities with meaningful real-world customer security impact.',
  '- Include enough detail for Microsoft to validate, triage, reproduce, and fix the issue quickly.',
  '',
  '## Boundaries',
  '- Follow Microsoft Security Testing Rules of Engagement and the rules on the applicable individual bounty program page.',
  '- Do not access, modify, exfiltrate, disclose, or share customer data.',
  '- Do not disrupt Microsoft services, compromise uptime, degrade availability, or harm other customers or infrastructure.',
  '- If unauthorized or sensitive data is encountered, stop immediately, notify MSRC with details, delete the data, and acknowledge this in the report.',
  '- Do not publicly disclose before Microsoft has had time to remediate under CVD.'
].join('\n');

const defaultRunInput: StartRunInput = {
  runEngine: 'openai_responses',
  promptMarkdown: '',
  mode: 'dynamic',
  attemptStrategy: 'adaptive_portfolio',
  model: 'gpt-5.5',
  reasoningEffort: 'xhigh',
  networkProfile: 'elevated',
  sandboxProfile: 'host_research_only',
  budget: {
    maxMinutes: UNBOUNDED_MINUTES,
    maxAttempts: 1,
    maxCostUsd: 0
  },
  fakeScenario: 'adaptive_portfolio'
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

function preferredSandboxProfile(executor: ExecutorStatus | null, vmPreference: VmPreference): string {
  const selectedBackend = findBackendByKind(executor, vmPreference.backendKind);
  return vmPreference.enabled && selectedBackend?.available && executor?.available === true ? 'local_disposable_vm' : 'host_research_only';
}

function ProgramInformationModal({ program, onClose }: { program: ProgramRegistryEntry; onClose: () => void }): JSX.Element {
  return (
    <Modal title="Program Information" wide onClose={onClose} footer={<button type="button" onClick={onClose}>Done</button>}>
      <div className="program-info-grid">
        <div>
          <span>Program</span>
          <strong>{program.programName}</strong>
        </div>
        <div>
          <span>Organization</span>
          <strong>{program.organizationName || 'None'}</strong>
        </div>
        <div>
          <span>Workspace</span>
          <strong>{program.workspacePath}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong>{program.networkProfile}</strong>
        </div>
        <div>
          <span>Authorization Expires</span>
          <strong>{program.expiresAt ?? 'Never'}</strong>
        </div>
        <div>
          <span>Research Sessions</span>
          <strong>{program.runCount}</strong>
        </div>
        <div className="program-info-block">
          <span>Description</span>
          <p>{program.descriptionMarkdown || 'No description recorded.'}</p>
        </div>
        <div className="program-info-block">
          <span>Scope and Rules</span>
          <p>{program.rulesMarkdown || 'No scope or rules recorded.'}</p>
        </div>
      </div>
    </Modal>
  );
}

function ProgramSessionHistoryModal({
  program,
  sessions,
  selectedRunId,
  onClose,
  onOpenSession
}: {
  program: ProgramRegistryEntry;
  sessions: ResearchSessionSummary[];
  selectedRunId: string | null;
  onClose: () => void;
  onOpenSession: (session: ResearchSessionSummary) => void;
}): JSX.Element {
  return (
    <Modal title={`${program.programName} Sessions`} wide onClose={onClose} footer={<button type="button" onClick={onClose}>Done</button>}>
      <div className="session-history-list">
        {sessions.length > 0 ? (
          sessions.map((session) => (
            <button
              type="button"
              className={`session-history-item ${selectedRunId === session.runId ? 'active' : ''}`}
              key={session.id}
              onClick={() => onOpenSession(session)}
            >
              <span className="session-history-title">{promptSessionTitle(session)}</span>
              <span className="session-history-meta">
                {session.status} · Updated {shortRelativeAge(session.updatedAt)}
              </span>
            </button>
          ))
        ) : (
          <span className="session-history-empty">No Session Yet...</span>
        )}
      </div>
    </Modal>
  );
}

function ProgramOnboardingModal({
  form,
  busy,
  onChange,
  onCancel,
  onLookupHackerOne,
  onTemplate,
  onSubmit
}: {
  form: ProgramOnboardingFormState;
  busy: boolean;
  onChange: (next: ProgramOnboardingFormState) => void;
  onCancel: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onTemplate: (templateKind: ProgramTemplateKind) => void;
  onSubmit: () => void;
}): JSX.Element {
  const [hackerOneIdentifier, setHackerOneIdentifier] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const update = (key: keyof ProgramOnboardingFormState, value: string): void => {
    onChange({ ...form, [key]: value });
  };
  const canSubmit = form.programName.trim().length > 0;
  const lookupHackerOne = (): void => {
    if (!hackerOneIdentifier.trim()) return;
    setLookupBusy(true);
    setLookupError(null);
    onLookupHackerOne(hackerOneIdentifier)
      .catch((caught: unknown) => setLookupError(errorMessage(caught)))
      .finally(() => setLookupBusy(false));
  };

  return (
    <Modal
      title="New Program"
      onClose={onCancel}
      footer={
        <>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit" form="program-onboarding-form" disabled={busy || lookupBusy || !canSubmit}>
            {lookupBusy ? 'Importing Program...' : 'Create Program'}
          </button>
        </>
      }
    >
      <form
        id="program-onboarding-form"
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <label>
          Workspace directory
          <input value={form.workspacePath} readOnly />
        </label>
        <div className="template-toggle-row" role="group" aria-label="Program template">
          {(['manual', 'hackerone', 'apple', 'msrc'] as ProgramTemplateKind[]).map((templateKind) => (
            <button
              type="button"
              className={`template-toggle ${form.templateKind === templateKind ? 'active' : ''}`}
              key={templateKind}
              onClick={() => onTemplate(templateKind)}
            >
              {templateLabel(templateKind)}
            </button>
          ))}
        </div>
        {form.templateKind === 'hackerone' ? (
          <div className="hackerone-lookup">
            <label>
              Program Identifier
              <input value={hackerOneIdentifier} placeholder="github" onChange={(event) => setHackerOneIdentifier(event.target.value)} />
            </label>
            <button type="button" disabled={busy || lookupBusy || !hackerOneIdentifier.trim()} onClick={lookupHackerOne}>
              {lookupBusy ? 'Loading...' : 'Look Up'}
            </button>
            {lookupError ? <div className="error-box">{lookupError}</div> : null}
          </div>
        ) : null}
        <div className="form-grid">
          <label>
            Program name
            <input value={form.programName} onChange={(event) => update('programName', event.target.value)} autoFocus />
          </label>
          <label>
            Organization (optional)
            <input value={form.organizationName} onChange={(event) => update('organizationName', event.target.value)} />
          </label>
        </div>
        <label>
          Description
          <textarea rows={3} value={form.descriptionMarkdown} onChange={(event) => update('descriptionMarkdown', event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Network
            <select value={form.networkProfile} onChange={(event) => update('networkProfile', event.target.value)}>
              <option value="offline">offline</option>
              <option value="scoped">scoped</option>
              <option value="elevated">elevated</option>
            </select>
          </label>
          <label>
            Authorization expires (empty = never)
            <input type="date" className={emptyDateClass(form.expiresAt)} value={form.expiresAt} onChange={(event) => update('expiresAt', event.target.value)} />
          </label>
        </div>
        <label>
          Scope and Rules
          <textarea rows={3} value={form.rulesMarkdown} onChange={(event) => update('rulesMarkdown', event.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

function ScopeEditor({
  snapshot,
  busy,
  runAction
}: {
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const [form, setForm] = useState<ScopeFormState>(() => scopeToForm(snapshot.activeScope));

  useEffect(() => {
    setForm(scopeToForm(snapshot.activeScope));
  }, [snapshot.activeScope.id]);

  const update = (key: keyof ScopeFormState, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveScope = (): void => {
    const draft = formToScopeDraft(form);
    void runAction(() => window.beale.saveProgramScope(draft));
  };

  return (
    <section className="panel scope-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Program</p>
          <h3>Scope</h3>
        </div>
        <button type="button" title="Save scope version" disabled={busy} onClick={saveScope}>
          <Save size={16} />
          Save
        </button>
      </div>

      <div className="form-grid">
        <label>
          Program
          <input value={form.programName} onChange={(event) => update('programName', event.target.value)} />
        </label>
        <label>
          Organization (optional)
          <input value={form.organizationName} onChange={(event) => update('organizationName', event.target.value)} />
        </label>
      </div>
      <label>
        Description
        <textarea rows={4} value={form.descriptionMarkdown} onChange={(event) => update('descriptionMarkdown', event.target.value)} />
      </label>
      <div className="form-grid">
        <label>
          Network
          <select value={form.networkProfile} onChange={(event) => update('networkProfile', event.target.value)}>
            <option value="offline">offline</option>
            <option value="scoped">scoped</option>
            <option value="elevated">elevated</option>
          </select>
        </label>
        <label>
          Authorization expires (empty = never)
          <input type="date" className={emptyDateClass(form.expiresAt)} value={form.expiresAt} onChange={(event) => update('expiresAt', event.target.value)} />
        </label>
      </div>

      <div className="asset-grid">
        <label>
          Domains and hosts
          <textarea rows={4} value={form.domains} onChange={(event) => update('domains', event.target.value)} />
        </label>
        <label>
          Repositories
          <textarea rows={4} value={form.repositories} onChange={(event) => update('repositories', event.target.value)} />
        </label>
        <label>
          Executables
          <textarea rows={4} value={form.executables} onChange={(event) => update('executables', event.target.value)} />
        </label>
        <label>
          Local paths
          <textarea rows={4} value={form.localPaths} onChange={(event) => update('localPaths', event.target.value)} />
        </label>
        <label>
          Credential references
          <textarea rows={3} value={form.credentialRefs} onChange={(event) => update('credentialRefs', event.target.value)} />
        </label>
        <label>
          Out of scope
          <textarea rows={3} value={form.outOfScope} onChange={(event) => update('outOfScope', event.target.value)} />
        </label>
      </div>
      <label>
        Scope and Rules
        <textarea rows={4} value={form.rulesMarkdown} onChange={(event) => update('rulesMarkdown', event.target.value)} />
      </label>
    </section>
  );
}

function OpenAiAccountPanel({
  snapshot,
  busy,
  runAction
}: {
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const status = snapshot.openAi;
  const refresh = (): void => {
    void runAction(() => window.beale.refreshOpenAiStatus());
  };

  return (
    <section className={`panel openai-panel readiness-${stateClass(status.readiness)}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">OpenAI</p>
          <h3>Account</h3>
        </div>
        <button type="button" title="Refresh OpenAI account status" disabled={busy} onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="openai-status-row">
        <div className="status-icon">
          <KeyRound size={18} />
        </div>
        <div>
          <StatusPill status={status.readiness} />
          <strong>{status.label}</strong>
          <p>{status.statusDetail}</p>
        </div>
      </div>

      <div className="openai-grid">
        <div>
          <span>Source</span>
          <strong>{status.source}</strong>
        </div>
        <div>
          <span>Transport</span>
          <strong>{status.preferredTransport}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{status.defaultModel}</strong>
        </div>
        <div>
          <span>Reasoning</span>
          <strong>{status.defaultReasoningEffort}</strong>
        </div>
      </div>

      <div className="openai-isolation">
        <LockKeyhole size={15} />
        <span>{status.credentialsHostOnly ? 'Host-only credential boundary' : 'Credential boundary needs review'}</span>
      </div>

      {status.setupCommand ? (
        <div className="command-row">
          <Terminal size={15} />
          <code>{status.setupCommand}</code>
        </div>
      ) : null}

      {status.userAction ? (
        <div className="policy-line">
          <ShieldAlert size={15} />
          {status.userAction}
        </div>
      ) : null}

      <div className="onboarding-list">
        {status.onboardingSteps.map((step) => (
          <div className={`onboarding-step step-${step.status}`} key={step.id}>
            <span>{step.status}</span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
              {step.command ? <code>{step.command}</code> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StartRunForm({
  snapshot,
  vmPreference,
  busy,
  runAction,
  onCancel,
  onStarted
}: {
  snapshot: WorkspaceSnapshot;
  vmPreference: VmPreference;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
  onCancel: () => void;
  onStarted: (runId: string) => void;
}): JSX.Element {
  const sandboxProfile = preferredSandboxProfile(snapshot.executor, vmPreference);
  const [input, setInput] = useState<StartRunInput>(() => ({
    ...defaultRunInput,
    networkProfile: 'elevated',
    sandboxProfile
  }));
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [startingRun, setStartingRun] = useState(false);
  const promptBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const generationRequestIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const promptStreamAutoScrollRef = useRef(false);

  useEffect(() => {
    setInput((current) => ({ ...current, networkProfile: 'elevated', sandboxProfile }));
  }, [sandboxProfile, snapshot.activeScope.id]);

  useEffect(() => {
    const unsubscribe = window.beale.onResearchPromptGenerationUpdate((update) => {
      if (!mountedRef.current || generationRequestIdRef.current !== update.requestId) return;
      promptStreamAutoScrollRef.current = true;
      setInput((current) => ({ ...current, promptMarkdown: update.promptMarkdown }));
    });
    return () => {
      unsubscribe();
      mountedRef.current = false;
      const requestId = generationRequestIdRef.current;
      if (requestId) {
        void window.beale.cancelResearchPromptGeneration(requestId);
      }
    };
  }, []);

  const update = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]): void => {
    if (key === 'promptMarkdown') promptStreamAutoScrollRef.current = false;
    setInput((current) => ({ ...current, [key]: value }));
    if (key === 'promptMarkdown') setGenerateError(null);
  };

  useLayoutEffect(() => {
    if (!generatingPrompt || !promptStreamAutoScrollRef.current) return;
    const promptBox = promptBoxRef.current;
    if (!promptBox) return;
    promptBox.scrollTop = promptBox.scrollHeight;
  }, [generatingPrompt, input.promptMarkdown]);

  const updateBudget = (key: keyof StartRunInput['budget'], value: number): void => {
    setInput((current) => ({ ...current, budget: { ...current.budget, [key]: value } }));
  };
  const minuteLimitValue = input.budget.maxMinutes >= UNBOUNDED_MINUTES ? '' : String(input.budget.maxMinutes);
  const openAiBlocked = input.runEngine === 'openai_responses' && !snapshot.openAi.configured;
  const hasPromptDraft = input.promptMarkdown.trim().length > 0;
  const canStart = hasPromptDraft && !openAiBlocked;
  const promptGenerationLabel = hasPromptDraft ? 'Refine' : 'Generate';

  const start = (): void => {
    if (startingRun) return;
    setStartingRun(true);
    void runAction(async () => {
      const next = await window.beale.startRun(input);
      const latestRunId = next.runs[0]?.run.id;
      if (latestRunId) onStarted(latestRunId);
      return next;
    }).finally(() => setStartingRun(false));
  };

  const cancelGeneratePrompt = (): void => {
    const requestId = generationRequestIdRef.current;
    if (!requestId) return;
    generationRequestIdRef.current = null;
    setGeneratingPrompt(false);
    void window.beale.cancelResearchPromptGeneration(requestId);
  };

  const generatePrompt = (): void => {
    if (generatingPrompt) {
      cancelGeneratePrompt();
      return;
    }
    const requestId = clientRequestId('research_prompt');
    const draftPromptMarkdown = input.promptMarkdown;
    const operation = draftPromptMarkdown.trim().length > 0 ? 'refine' : 'generate';
    generationRequestIdRef.current = requestId;
    promptStreamAutoScrollRef.current = true;
    setGeneratingPrompt(true);
    setGenerateError(null);
    void window.beale
      .generateResearchPrompt({
        requestId,
        operation,
        draftPromptMarkdown: operation === 'refine' ? draftPromptMarkdown : null,
        mode: input.mode,
        attemptStrategy: input.attemptStrategy,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        networkProfile: input.networkProfile,
        sandboxProfile: input.sandboxProfile,
        targetAssetId: input.targetAssetId ?? null,
        targetPath: input.targetPath ?? null
      })
      .then((generated) => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        setInput((current) => ({ ...current, promptMarkdown: generated.promptMarkdown }));
      })
      .catch((caught: unknown) => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        const message = userFacingErrorMessage(caught);
        if (!/canceled/i.test(message)) {
          setGenerateError(message);
        }
      })
      .finally(() => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        generationRequestIdRef.current = null;
        setGeneratingPrompt(false);
      });
  };

  const closeModal = (): void => {
    cancelGeneratePrompt();
    onCancel();
  };

  return (
    <Modal
      title="New Research Session"
      wide
      onClose={closeModal}
      footer={
        <>
          <div className="modal-footer-leading generate-prompt-footer">
            <button type="button" className="generate-prompt-button" disabled={!generatingPrompt && (busy || openAiBlocked)} onClick={generatePrompt}>
              {generatingPrompt ? <X size={16} /> : <Sparkles size={16} />}
              {generatingPrompt ? 'Cancel' : promptGenerationLabel}
            </button>
            {generatingPrompt ? <span className="generate-prompt-status">Generating plan, thinking may take several minutes...</span> : null}
          </div>
          <button type="button" disabled={busy} onClick={closeModal}>
            Nevermind
          </button>
          <button className="primary-button" type="button" disabled={busy || startingRun || generatingPrompt || !canStart} onClick={start}>
            <Play size={16} />
            Start
          </button>
        </>
      }
    >
      <div className="start-run-modal-body">
        {input.runEngine === 'openai_responses' && snapshot.openAi.readiness !== 'oauth_ready' ? (
          <div className="policy-line">
            <ShieldAlert size={15} />
            {snapshot.openAi.userAction ?? snapshot.openAi.statusDetail}
          </div>
        ) : null}
        {input.sandboxProfile === 'host_research_only' ? (
          <div className="policy-line host-sandbox-warning">
            <ShieldAlert size={15} />
            Commands and executables will run on this host machine. A disposable VM is recommended.
          </div>
        ) : null}
        {generateError ? (
          <div className="generate-prompt-error-box" role="alert">
            <ShieldAlert size={15} />
            <div>
              <strong>Could not generate plan</strong>
              <p>{generateError}</p>
            </div>
          </div>
        ) : null}
        <textarea
          ref={promptBoxRef}
          className="prompt-box"
          rows={6}
          placeholder="Enter a prompt or press Generate."
          value={input.promptMarkdown}
          onChange={(event) => update('promptMarkdown', event.target.value)}
        />
        <div className="start-grid">
          <label>
            Mode
            <select value={input.mode} onChange={(event) => update('mode', event.target.value)}>
              <option value="dynamic">Dynamic</option>
              <option value="open_discovery">Open Discovery</option>
              <option value="targeted_reproduction">Targeted Reproduction</option>
              <option value="patch_validation">Patch Validation</option>
              <option value="variant_analysis">Variant Analysis</option>
            </select>
          </label>
          <label>
            Strategy
            <select value={input.attemptStrategy} onChange={(event) => update('attemptStrategy', event.target.value)}>
              <option value="adaptive_portfolio">Adaptive Portfolio</option>
              <option value="single_path">Single Path</option>
              <option value="reproduction_first">Reproduction First</option>
            </select>
          </label>
          <label>
            Network
            <select value={input.networkProfile} onChange={(event) => update('networkProfile', event.target.value)}>
              {NETWORK_PROFILE_OPTIONS.map((profile) => (
                <option value={profile} key={profile}>
                  {networkProfileLabel(profile)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details className="advanced-run-options">
          <summary>Session Settings</summary>
          <div className="form-grid">
            <label>
              Minutes
              <input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={minuteLimitValue}
                onChange={(event) => updateBudget('maxMinutes', optionalPositiveInteger(event.target.value, UNBOUNDED_MINUTES))}
              />
            </label>
            <label>
              Max Research Branches
              <input
                type="number"
                min={1}
                value={1}
                disabled
                onChange={() => undefined}
              />
            </label>
            <label>
              Model
              <input value={input.model} onChange={(event) => update('model', event.target.value)} />
            </label>
            <label>
              Reasoning
              <input value={input.reasoningEffort} onChange={(event) => update('reasoningEffort', event.target.value)} />
            </label>
          </div>
        </details>
      </div>
    </Modal>
  );
}

function HardeningPanel({
  snapshot,
  busy,
  runAction
}: {
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const interruptedTotal =
    snapshot.recovery.interruptedRuns +
    snapshot.recovery.interruptedAttempts +
    snapshot.recovery.interruptedModelSessions +
    snapshot.recovery.interruptedToolCalls +
    snapshot.recovery.interruptedVerifierRuns +
    snapshot.recovery.interruptedVmContexts +
    snapshot.recovery.interruptedBenchmarkRuns;
  const backup = (): void => {
    void runAction(() => window.beale.exportWorkspaceBackup('Manual workspace backup from beta hardening panel.'));
  };

  return (
    <section className="panel hardening-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Hardening</p>
          <h3>Recovery and Review</h3>
        </div>
        <button type="button" disabled={busy} onClick={backup} title="Export workspace backup">
          <FileArchive size={16} />
          Backup
        </button>
      </div>
      <div className="hardening-grid">
        <div>
          <span>Recovery</span>
          <strong>{interruptedTotal > 0 ? `${interruptedTotal} item${interruptedTotal === 1 ? '' : 's'}` : 'clean'}</strong>
        </div>
        <div>
          <span>VM review</span>
          <strong>{snapshot.recovery.interruptedVmContexts}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong>{snapshot.policyReview.networkProfile}</strong>
        </div>
        <div>
          <span>Backup</span>
          <strong>{snapshot.workspace.lastWorkspaceBackup ? 'ready' : 'none'}</strong>
        </div>
        <div>
          <span>Live target</span>
          <strong>{snapshot.policyReview.liveTargetAllowed ? 'scoped' : 'blocked'}</strong>
        </div>
        <div>
          <span>Credential approval</span>
          <strong>{snapshot.policyReview.credentialInjectionRequiresApproval ? 'required' : 'none'}</strong>
        </div>
      </div>
      <div className="backend-list">
        {snapshot.executor.backends.map((backend) => (
          <div className={`backend-row ${backend.available ? 'available' : ''}`} key={backend.kind}>
            <span>{backend.label}</span>
            <strong>{backend.available ? 'available' : backend.configured ? 'configured' : backend.recommended ? 'recommended' : 'later'}</strong>
          </div>
        ))}
      </div>
      {snapshot.policyReview.warnings.length > 0 ? (
        <div className="review-list">
          {snapshot.policyReview.warnings.map((warning) => (
            <div className="policy-line" key={warning}>
              <ShieldAlert size={15} />
              {warning}
            </div>
          ))}
        </div>
      ) : null}
      {snapshot.policyReview.allowedDestinations.length > 0 ? (
        <div className="allowed-destinations">
          <span>Allowed live destinations</span>
          <strong>{snapshot.policyReview.allowedDestinations.join(', ')}</strong>
        </div>
      ) : null}
      {snapshot.workspace.lastWorkspaceBackup ? <div className="path-text">{snapshot.workspace.lastWorkspaceBackup.relativePath}</div> : null}
    </section>
  );
}

function BenchmarkPanel({
  benchmark,
  busy,
  runAction
}: {
  benchmark: BenchmarkOverview;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const [harnessName, setHarnessName] = useState('beale-benchmark-alpha');
  const [dockerImage, setDockerImage] = useState('node:22-alpine');
  const runSuite = (suiteKind: BenchmarkSuiteKind): void => {
    void runAction(() =>
      window.beale.runBenchmarkSuite({
        suiteKind,
        harnessName: harnessName.trim() || 'beale-benchmark-alpha',
        dockerImage: dockerImage.trim() || 'node:22-alpine'
      })
    );
  };
  const latest = benchmark.latestRun;
  const comparison = benchmark.comparisons[0] ?? null;

  return (
    <section className="panel benchmark-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Benchmark</p>
          <h3>Calibration</h3>
        </div>
        <Gauge size={17} />
      </div>
      <div className="benchmark-controls">
        <label>
          Harness
          <input value={harnessName} onChange={(event) => setHarnessName(event.target.value)} />
        </label>
        <label>
          Docker image
          <input value={dockerImage} onChange={(event) => setDockerImage(event.target.value)} />
        </label>
        <div className="benchmark-buttons">
          {benchmark.suites.map((suite) => (
            <button key={suite.suiteKind} type="button" disabled={busy} title={suite.title} onClick={() => runSuite(suite.suiteKind)}>
              <CheckCircle2 size={14} />
              {suite.suiteKind}
            </button>
          ))}
        </div>
      </div>
      <div className="benchmark-grid">
        <div>
          <span>Latest</span>
          <strong>{latest ? `${latest.identity.passCount}/${latest.identity.totalCount}` : 'none'}</strong>
        </div>
        <div>
          <span>Suite</span>
          <strong>{latest?.suiteId ?? 'none'}</strong>
        </div>
        <div>
          <span>Isolation</span>
          <strong>{benchmark.isolationSummary.graderFilesMounted || benchmark.isolationSummary.groundTruthMounted ? 'blocked' : 'clean'}</strong>
        </div>
        <div>
          <span>Compare</span>
          <strong>{comparison ? `${formatPercent(comparison.passRateDelta)} delta` : 'pending'}</strong>
        </div>
      </div>
      {benchmark.latestResults.length > 0 ? (
        <div className="benchmark-results">
          {benchmark.latestResults.slice(0, 5).map((result) => (
            <div className={`benchmark-result state-${stateClass(result.status)}`} key={result.id}>
              <span>{result.taskId}</span>
              <strong>{result.status}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RunTracker({
  runs,
  selectedRunId,
  onSelect
}: {
  runs: RunRow[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}): JSX.Element {
  return (
    <section className="panel tracker-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Mission Control</p>
          <h3>Runs</h3>
        </div>
        <div className="run-total">{runs.length}</div>
      </div>
      <div className="run-list">
        {runs.length === 0 ? (
          <div className="empty-state calm-empty">
            <strong>No active runs</strong>
            <span>Start a run from the command bar when you are ready.</span>
          </div>
        ) : (
          runs.map((row) => (
            <button
              type="button"
              key={row.run.id}
              className={`run-row ${selectedRunId === row.run.id ? 'selected' : ''}`}
              onClick={() => onSelect(row.run.id)}
            >
              <div className="run-row-main">
                <StatusPill status={row.run.status} />
                <strong>{row.run.title}</strong>
              </div>
              <p>{row.latestAttemptState}</p>
              <div className="run-row-grid">
                <span>{row.engine}</span>
                <span>{row.attemptCount} attempt{row.attemptCount === 1 ? '' : 's'}</span>
                <span>{row.topFinding ?? row.topHypothesis ?? 'No hypothesis yet'}</span>
                <span>{row.verifierState ?? 'verifier pending'}</span>
                <span>{row.artifactCount} artifacts</span>
                <span>{row.costLabel}</span>
              </div>
              {row.policyBlocker ? (
                <div className="policy-line">
                  <ShieldAlert size={15} />
                  {row.policyBlocker}
                </div>
              ) : null}
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function RunDetailView({
  detail,
  busy,
  runAction
}: {
  detail: RunDetail | null;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const [forkInstruction, setForkInstruction] = useState('');
  const firstArtifact = detail?.artifacts[0];
  const firstHypothesis = detail?.hypotheses[0];
  const firstFinding = detail?.findings[0];
  const firstVerifier = detail?.verifierContracts[0];
  const firstVmContext = detail?.vmContexts[0];

  const steer = (action: Parameters<typeof window.beale.steerRun>[0]): void => {
    void runAction(() => window.beale.steerRun(action));
  };

  if (!detail) {
    return (
      <section className="panel detail-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Detail</p>
            <h3>Run Detail</h3>
          </div>
        </div>
        <div className="empty-state calm-empty">
          <strong>No run selected</strong>
          <span>Trace, artifacts, and verifier output will appear here.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Detail</p>
          <h3>{detail.run.title}</h3>
        </div>
        <StatusPill status={detail.run.status} />
      </div>

      <div className="control-bar">
        <button type="button" title="Pause run" disabled={busy || detail.run.status !== 'active'} onClick={() => steer({ type: 'pause', runId: detail.run.id })}>
          <Pause size={15} />
          Pause
        </button>
        <button type="button" title="Resume run" disabled={busy || detail.run.status !== 'paused'} onClick={() => steer({ type: 'resume', runId: detail.run.id })}>
          <Play size={15} />
          Resume
        </button>
        <button type="button" title="Stop run" disabled={busy || detail.run.status === 'stopped'} onClick={() => steer({ type: 'stop', runId: detail.run.id })}>
          <Square size={15} />
          Stop
        </button>
        <button
          type="button"
          title="Restart from selected VM snapshot"
          disabled={busy || !firstVmContext}
          onClick={() => firstVmContext && steer({ type: 'restart_from_snapshot', runId: detail.run.id, snapshotRef: firstVmContext.snapshotId || 'clean' })}
        >
          <RotateCcw size={15} />
          Restart
        </button>
        <button
          type="button"
          title="Extend run budget"
          disabled={busy}
          onClick={() =>
            steer({
              type: 'update_run_budget',
              runId: detail.run.id,
              budgetPatch: {
                maxMinutes: extendBudgetLimit(detail.run.budget.maxMinutes, UNBOUNDED_MINUTES, 30),
                maxAttempts: budgetNumber(detail.run.budget.maxAttempts, UNBOUNDED_ATTEMPTS)
              }
            })
          }
        >
          <Gauge size={15} />
          Budget
        </button>
      </div>

      <div className="fork-row">
        <input value={forkInstruction} onChange={(event) => setForkInstruction(event.target.value)} placeholder="Fork instruction" />
        <button
          type="button"
          title="Fork run"
          disabled={busy || !forkInstruction.trim()}
          onClick={() => {
            steer({ type: 'fork', runId: detail.run.id, instruction: forkInstruction.trim() });
            setForkInstruction('');
          }}
        >
          <GitFork size={15} />
          Fork
        </button>
      </div>

      <div className="detail-grid">
        <TracePanel events={detail.traceEvents} />
      </div>

      <div className="quick-actions">
        <button type="button" disabled={busy || !firstVerifier} onClick={() => firstVerifier && steer({ type: 'rerun_verifier', runId: detail.run.id, verifierContractId: firstVerifier.id })}>
          <RotateCw size={15} />
          Rerun Verifier
        </button>
        <button type="button" disabled={busy || !firstArtifact} onClick={() => firstArtifact && steer({ type: 'promote_artifact', runId: detail.run.id, artifactId: firstArtifact.id })}>
          <Archive size={15} />
          Promote Artifact
        </button>
        <button type="button" disabled={busy || !firstArtifact} onClick={() => firstArtifact && steer({ type: 'mark_artifact_sensitive', runId: detail.run.id, artifactId: firstArtifact.id })}>
          <EyeOff size={15} />
          Mark Sensitive
        </button>
        <button type="button" disabled={busy || !firstHypothesis} onClick={() => firstHypothesis && steer({ type: 'dismiss_hypothesis', runId: detail.run.id, hypothesisId: firstHypothesis.id })}>
          <XCircle size={15} />
          Dismiss Hypothesis
        </button>
        <button type="button" disabled={busy || !firstHypothesis} onClick={() => firstHypothesis && steer({ type: 'request_reproduction', runId: detail.run.id, hypothesisId: firstHypothesis.id })}>
          <ShieldCheck size={15} />
          Reproduce
        </button>
        <button type="button" disabled={busy || !firstFinding} onClick={() => firstFinding && steer({ type: 'export_evidence_bundle', runId: detail.run.id, findingId: firstFinding.id })}>
          <FileArchive size={15} />
          Export Evidence
        </button>
        <button type="button" disabled={busy || !firstFinding} onClick={() => firstFinding && steer({ type: 'export_finding_bundle', runId: detail.run.id, findingId: firstFinding.id })}>
          <FileOutput size={15} />
          Finding Bundle
        </button>
        <button type="button" disabled={busy} onClick={() => steer({ type: 'export_redacted_trace', runId: detail.run.id, findingId: firstFinding?.id })}>
          <FileJson size={15} />
          Redacted Trace
        </button>
        <button type="button" disabled={busy || !firstFinding} onClick={() => firstFinding && steer({ type: 'generate_report_draft', runId: detail.run.id, findingId: firstFinding.id })}>
          <FileText size={15} />
          Report Draft
        </button>
        <button type="button" disabled={busy || !firstFinding} onClick={() => firstFinding && steer({ type: 'mark_disclosure_ready', runId: detail.run.id, findingId: firstFinding.id })}>
          <ClipboardCheck size={15} />
          Disclosure Ready
        </button>
        <button type="button" disabled={busy || !firstFinding} onClick={() => firstFinding && steer({ type: 'mark_needs_more_evidence', runId: detail.run.id, findingId: firstFinding.id })}>
          <ShieldAlert size={15} />
          Needs Evidence
        </button>
        <button type="button" disabled={busy || !firstHypothesis} onClick={() => firstHypothesis && steer({ type: 'mark_hypothesis_out_of_scope', runId: detail.run.id, hypothesisId: firstHypothesis.id })}>
          <Ban size={15} />
          Mark Out of Scope
        </button>
      </div>
    </section>
  );
}

function RunInspector({
  detail,
  busy,
  runAction
}: {
  detail: RunDetail | null;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const steer = (action: Parameters<typeof window.beale.steerRun>[0]): void => {
    void runAction(() => window.beale.steerRun(action));
  };

  if (!detail) {
    return (
      <section className="panel inspector-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inspector</p>
            <h3>Run Context</h3>
          </div>
        </div>
        <div className="empty-state calm-empty">
          <strong>No context loaded</strong>
          <span>Hypotheses, evidence, and verifier state will dock here.</span>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="panel inspector-summary">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inspector</p>
            <h3>{detail.run.status === 'active' ? 'Active Run' : 'Run Context'}</h3>
          </div>
          <StatusPill status={detail.run.status} />
        </div>
        <div className="inspector-metrics">
          <div>
            <span>Attempts</span>
            <strong>{detail.attempts.length}</strong>
          </div>
          <div>
            <span>Evidence</span>
            <strong>{detail.artifacts.length}</strong>
          </div>
          <div>
            <span>Verifiers</span>
            <strong>{detail.verifierRuns.length}/{detail.verifierContracts.length}</strong>
          </div>
        </div>
      </section>
      <HypothesisPanel
        hypotheses={detail.hypotheses}
        disabled={busy}
        onPromote={(hypothesis) => steer({ type: 'promote_hypothesis', runId: detail.run.id, hypothesisId: hypothesis.id })}
        onReproduce={(hypothesis) => steer({ type: 'request_reproduction', runId: detail.run.id, hypothesisId: hypothesis.id })}
        onPatchValidation={(hypothesis) => steer({ type: 'request_patch_validation', runId: detail.run.id, hypothesisId: hypothesis.id })}
        onAdjustPriority={(hypothesis) => steer({ type: 'adjust_priority', runId: detail.run.id, hypothesisId: hypothesis.id, factors: bumpedPriorityFactors(hypothesis) })}
        onMerge={(source, target) => steer({ type: 'merge_hypotheses', runId: detail.run.id, sourceHypothesisId: source.id, targetHypothesisId: target.id })}
        onDismiss={(hypothesis) => steer({ type: 'dismiss_hypothesis', runId: detail.run.id, hypothesisId: hypothesis.id })}
        onOutOfScope={(hypothesis) => steer({ type: 'mark_hypothesis_out_of_scope', runId: detail.run.id, hypothesisId: hypothesis.id })}
      />
      <FindingPanel
        detail={detail}
        disabled={busy}
        onPatchValidation={(finding) => steer({ type: 'request_patch_validation', runId: detail.run.id, findingId: finding.id })}
        onFalsePositive={(finding) => steer({ type: 'mark_finding_false_positive', runId: detail.run.id, findingId: finding.id })}
        onOutOfScope={(finding) => steer({ type: 'mark_finding_out_of_scope', runId: detail.run.id, findingId: finding.id })}
        onDisclosureReady={(finding) => steer({ type: 'mark_disclosure_ready', runId: detail.run.id, findingId: finding.id })}
        onNeedsEvidence={(finding) => steer({ type: 'mark_needs_more_evidence', runId: detail.run.id, findingId: finding.id })}
        onFindingBundle={(finding) => steer({ type: 'export_finding_bundle', runId: detail.run.id, findingId: finding.id })}
        onReportDraft={(finding) => steer({ type: 'generate_report_draft', runId: detail.run.id, findingId: finding.id })}
      />
      <VerifierPanel
        detail={detail}
        disabled={busy}
        onRerun={(contractId) => steer({ type: 'rerun_verifier', runId: detail.run.id, verifierContractId: contractId })}
        onEdit={(contractId, triggerStepsMarkdown) =>
          steer({ type: 'edit_verifier_contract', runId: detail.run.id, verifierContractId: contractId, patch: { triggerStepsMarkdown } })
        }
        onReview={(contractId, decision) => steer({ type: 'review_verifier_contract', runId: detail.run.id, verifierContractId: contractId, decision })}
      />
      <ArtifactPanel
        artifacts={detail.artifacts}
        disabled={busy}
        onPromote={(artifact) => steer({ type: 'promote_artifact', runId: detail.run.id, artifactId: artifact.id })}
        onSensitive={(artifact) => steer({ type: 'mark_artifact_sensitive', runId: detail.run.id, artifactId: artifact.id })}
      />
      <ExportPanel
        exports={detail.exports}
        disabled={busy}
        onReview={(exportRecord, decision) => steer({ type: 'review_export', runId: detail.run.id, exportId: exportRecord.id, decision })}
      />
      <VmPolicyPanel
        detail={detail}
        disabled={busy}
        onReview={(requestKind, decision, requestedAction) =>
          steer({
            type: 'review_policy_request',
            runId: detail.run.id,
            requestKind,
            decision,
            requestedAction,
            note: `${decision} ${requestKind}`
          })
        }
        onPreserve={(vmContextId) => steer({ type: 'preserve_vm', runId: detail.run.id, vmContextId, reason: 'Preserve VM for local review.' })}
        onDestroy={(vmContextId) => steer({ type: 'destroy_vm', runId: detail.run.id, vmContextId, reason: 'Destroy VM after review.' })}
      />
      <ModelSessionPanel detail={detail} />
    </>
  );
}

function TracePanel({ events }: { events: TraceEventRecord[] }): JSX.Element {
  return (
    <section className="detail-section trace-section">
      <div className="section-title">
        <Search size={16} />
        <h4>Trace</h4>
      </div>
      <div className="timeline">
        {events.map((event) => (
          <div key={event.id} className={`trace-event source-${event.source} type-${event.type}`}>
            <div className="trace-top">
              <span>#{event.sequence}</span>
              <span>{event.source}</span>
              <span>{event.type}</span>
              {!event.modelVisible ? <span>model hidden</span> : null}
            </div>
            <strong>{event.summary}</strong>
            <pre>{compactJson(event.payload)}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}

function HypothesisPanel({
  hypotheses,
  disabled,
  onPromote,
  onReproduce,
  onPatchValidation,
  onAdjustPriority,
  onMerge,
  onDismiss,
  onOutOfScope
}: {
  hypotheses: HypothesisRecord[];
  disabled: boolean;
  onPromote: (hypothesis: HypothesisRecord) => void;
  onReproduce: (hypothesis: HypothesisRecord) => void;
  onPatchValidation: (hypothesis: HypothesisRecord) => void;
  onAdjustPriority: (hypothesis: HypothesisRecord) => void;
  onMerge: (source: HypothesisRecord, target: HypothesisRecord) => void;
  onDismiss: (hypothesis: HypothesisRecord) => void;
  onOutOfScope: (hypothesis: HypothesisRecord) => void;
}): JSX.Element {
  const mergeTarget = hypotheses[0] ?? null;
  return (
    <section className="detail-section">
      <div className="section-title">
        <Bug size={16} />
        <h4>Hypotheses</h4>
      </div>
      {hypotheses.length === 0 ? <div className="empty-state">No hypotheses.</div> : null}
      {hypotheses.map((hypothesis) => (
        <div className={`entity-row state-${stateClass(hypothesis.state)}`} key={hypothesis.id}>
          <div>
            <div className="entity-title-row">
              <strong>{hypothesis.title}</strong>
              <CwePill mappings={hypothesis.cweMappings} />
            </div>
            <p>{hypothesis.state} · priority {clampPriorityScoreForDisplay(hypothesis.priorityScore).toFixed(2)} · {hypothesis.bugClass} · {hypothesis.component}</p>
            <p>{hypothesis.evidenceConfidence} · {hypothesis.scopeConfidence}</p>
          </div>
          <div className="entity-actions">
            <button type="button" title="Promote hypothesis" disabled={disabled} onClick={() => onPromote(hypothesis)}>
              <ShieldCheck size={14} />
            </button>
            <button type="button" title="Request reproduction" disabled={disabled} onClick={() => onReproduce(hypothesis)}>
              <CheckCircle2 size={14} />
            </button>
            <button type="button" title="Request patch validation" disabled={disabled} onClick={() => onPatchValidation(hypothesis)}>
              <PackageCheck size={14} />
            </button>
            <button type="button" title="Adjust priority" disabled={disabled} onClick={() => onAdjustPriority(hypothesis)}>
              <SlidersHorizontal size={14} />
            </button>
            <button
              type="button"
              title="Merge into top hypothesis"
              disabled={disabled || !mergeTarget || mergeTarget.id === hypothesis.id}
              onClick={() => mergeTarget && onMerge(hypothesis, mergeTarget)}
            >
              <GitMerge size={14} />
            </button>
            <button type="button" title="Dismiss hypothesis" disabled={disabled} onClick={() => onDismiss(hypothesis)}>
              <XCircle size={14} />
            </button>
            <button type="button" title="Mark hypothesis out of scope" disabled={disabled} onClick={() => onOutOfScope(hypothesis)}>
              <Ban size={14} />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function ArtifactPanel({
  artifacts,
  disabled,
  onPromote,
  onSensitive
}: {
  artifacts: ArtifactRecord[];
  disabled: boolean;
  onPromote: (artifact: ArtifactRecord) => void;
  onSensitive: (artifact: ArtifactRecord) => void;
}): JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-title">
        <Archive size={16} />
        <h4>Artifacts</h4>
      </div>
      {artifacts.length === 0 ? <div className="empty-state">No artifacts.</div> : null}
      {artifacts.map((artifact) => (
        <div className="entity-row" key={artifact.id}>
          <div>
            <strong>{String(artifact.metadata.name ?? artifact.kind)}</strong>
            <p>{artifact.kind} · {artifact.sensitivity} · {artifact.sha256.slice(0, 12)}</p>
          </div>
          <div className="entity-actions">
            <button type="button" title="Promote artifact to evidence" disabled={disabled} onClick={() => onPromote(artifact)}>
              <CheckCircle2 size={14} />
            </button>
            <button type="button" title="Mark artifact sensitive" disabled={disabled} onClick={() => onSensitive(artifact)}>
              <EyeOff size={14} />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function VerifierPanel({
  detail,
  disabled,
  onRerun,
  onEdit,
  onReview
}: {
  detail: RunDetail;
  disabled: boolean;
  onRerun: (contractId: string) => void;
  onEdit: (contractId: string, triggerStepsMarkdown: string) => void;
  onReview: (contractId: string, decision: 'approved' | 'rejected') => void;
}): JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <section className="detail-section">
      <div className="section-title">
        <CheckCircle2 size={16} />
        <h4>Verifiers</h4>
      </div>
      {detail.verifierContracts.length === 0 ? <div className="empty-state">No verifiers.</div> : null}
      {detail.verifierContracts.map((contract) => {
        const latest = [...detail.verifierRuns].reverse().find((run) => run.contractId === contract.id);
        const draft = drafts[contract.id] ?? contract.triggerStepsMarkdown;
        return (
          <div className="entity-row verifier-row" key={contract.id}>
            <div className="entity-main">
              <strong>{contract.mode}</strong>
              <p>{latest?.status ?? contract.status} · {contract.id}</p>
              <textarea
                className="verifier-edit"
                rows={3}
                value={draft}
                onChange={(event) => setDrafts((current) => ({ ...current, [contract.id]: event.target.value }))}
              />
            </div>
            <div className="entity-actions">
              <button type="button" title="Edit verifier trigger" disabled={disabled || !draft.trim()} onClick={() => onEdit(contract.id, draft)}>
                <Edit3 size={14} />
              </button>
              <button type="button" title="Approve verifier contract" disabled={disabled} onClick={() => onReview(contract.id, 'approved')}>
                <ClipboardCheck size={14} />
              </button>
              <button type="button" title="Reject verifier contract" disabled={disabled} onClick={() => onReview(contract.id, 'rejected')}>
                <ClipboardX size={14} />
              </button>
              <button type="button" title="Rerun verifier" disabled={disabled} onClick={() => onRerun(contract.id)}>
                <RotateCw size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function FindingPanel({
  detail,
  disabled,
  onPatchValidation,
  onFalsePositive,
  onOutOfScope,
  onDisclosureReady,
  onNeedsEvidence,
  onFindingBundle,
  onReportDraft
}: {
  detail: RunDetail;
  disabled: boolean;
  onPatchValidation: (finding: FindingRecord) => void;
  onFalsePositive: (finding: FindingRecord) => void;
  onOutOfScope: (finding: FindingRecord) => void;
  onDisclosureReady: (finding: FindingRecord) => void;
  onNeedsEvidence: (finding: FindingRecord) => void;
  onFindingBundle: (finding: FindingRecord) => void;
  onReportDraft: (finding: FindingRecord) => void;
}): JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-title">
        <FileText size={16} />
        <h4>Findings</h4>
      </div>
      {detail.findings.length === 0 ? <div className="empty-state">No findings.</div> : null}
      {detail.findings.map((finding) => (
        <div className={`entity-row state-${stateClass(finding.state)} ${finding.verifiedByVerifierRunId ? 'verified-finding' : ''}`} key={finding.id}>
          <div>
            <div className="entity-title-row">
              <strong>{finding.title}</strong>
              <CwePill mappings={finding.cweMappings} />
            </div>
            <p>
              {finding.state} · priority {clampPriorityScoreForDisplay(finding.priorityScore).toFixed(2)}
              {finding.verifiedByVerifierRunId ? ` · verifier ${finding.verifiedByVerifierRunId.slice(0, 12)}` : ''}
            </p>
          </div>
          <div className="entity-actions">
            <button type="button" title="Request patch validation" disabled={disabled} onClick={() => onPatchValidation(finding)}>
              <PackageCheck size={14} />
            </button>
            <button type="button" title="Mark disclosure ready" disabled={disabled} onClick={() => onDisclosureReady(finding)}>
              <ClipboardCheck size={14} />
            </button>
            <button type="button" title="Mark needs more evidence" disabled={disabled} onClick={() => onNeedsEvidence(finding)}>
              <ShieldAlert size={14} />
            </button>
            <button type="button" title="Export finding bundle" disabled={disabled} onClick={() => onFindingBundle(finding)}>
              <FileOutput size={14} />
            </button>
            <button type="button" title="Generate report draft" disabled={disabled} onClick={() => onReportDraft(finding)}>
              <FileText size={14} />
            </button>
            <button type="button" title="Mark false positive" disabled={disabled} onClick={() => onFalsePositive(finding)}>
              <XCircle size={14} />
            </button>
            <button type="button" title="Mark finding out of scope" disabled={disabled} onClick={() => onOutOfScope(finding)}>
              <Ban size={14} />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function ExportPanel({
  exports,
  disabled,
  onReview
}: {
  exports: ExportRecord[];
  disabled: boolean;
  onReview: (exportRecord: ExportRecord, decision: 'approved' | 'needs_more_evidence' | 'rejected') => void;
}): JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-title">
        <FileArchive size={16} />
        <h4>Exports</h4>
      </div>
      {exports.length === 0 ? <div className="empty-state">No exports.</div> : null}
      {exports.map((exportRecord) => (
        <div className={`entity-row state-${stateClass(exportRecord.status)}`} key={exportRecord.id}>
          <div>
            <strong>{exportRecord.kind}</strong>
            <p>
              {exportRecord.status} · {exportRecord.relativePath}
              {exportRecord.reviewedAt ? ` · reviewed ${shortDate(exportRecord.reviewedAt)}` : ''}
            </p>
          </div>
          <div className="entity-actions">
            <button type="button" title="Approve export" disabled={disabled} onClick={() => onReview(exportRecord, 'approved')}>
              <CheckCircle2 size={14} />
            </button>
            <button type="button" title="Needs more evidence" disabled={disabled} onClick={() => onReview(exportRecord, 'needs_more_evidence')}>
              <ShieldAlert size={14} />
            </button>
            <button type="button" title="Reject export" disabled={disabled} onClick={() => onReview(exportRecord, 'rejected')}>
              <XCircle size={14} />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function ModelSessionPanel({ detail }: { detail: RunDetail }): JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-title">
        <Network size={16} />
        <h4>Model Session</h4>
      </div>
      {detail.modelSessions.length === 0 ? <div className="empty-state">No model session.</div> : null}
      {detail.modelSessions.map((session) => (
        <div className="entity-row" key={session.id}>
          <div>
            <strong>{session.provider}</strong>
            <p>
              {session.status} · {session.transport} · {session.previousResponseId ?? 'no response id'}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}

function VmPolicyPanel({
  detail,
  disabled,
  onReview,
  onPreserve,
  onDestroy
}: {
  detail: RunDetail;
  disabled: boolean;
  onReview: (
    requestKind: 'network_profile_change' | 'credential_injection' | 'host_action' | 'scope_change',
    decision: 'approved' | 'denied',
    requestedAction: Record<string, unknown>
  ) => void;
  onPreserve: (vmContextId: string) => void;
  onDestroy: (vmContextId: string) => void;
}): JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-title">
        <Network size={16} />
        <h4>VM and Policy</h4>
      </div>
      {detail.vmContexts.map((vm) => (
        <div className="entity-row" key={vm.id}>
          <div>
            <strong>{vm.backend}</strong>
            <p>
              {vm.state} · {vm.networkProfile}
              {typeof vm.metadata.targetExecution === 'boolean' ? ` · target execution ${vm.metadata.targetExecution ? 'enabled' : 'simulated'}` : ''}
            </p>
          </div>
          <div className="entity-actions">
            <button type="button" title="Preserve VM" disabled={disabled || vm.state === 'destroyed' || vm.state === 'preserved'} onClick={() => onPreserve(vm.id)}>
              <Save size={14} />
            </button>
            <button type="button" title="Destroy VM" disabled={disabled || vm.state === 'destroyed'} onClick={() => onDestroy(vm.id)}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
      <div className="entity-row policy-entity">
        <div>
          <strong>Policy controls</strong>
          <p>Network, credential, host action, and scope approval decisions are recorded as trace-backed approvals.</p>
        </div>
        <div className="entity-actions">
          <button
            type="button"
            title="Approve scoped network profile"
            disabled={disabled}
            onClick={() => onReview('network_profile_change', 'approved', { networkProfile: detail.run.networkProfile, runId: detail.run.id })}
          >
            <ShieldCheck size={14} />
          </button>
          <button
            type="button"
            title="Deny scoped network profile"
            disabled={disabled}
            onClick={() => onReview('network_profile_change', 'denied', { networkProfile: detail.run.networkProfile, runId: detail.run.id })}
          >
            <Ban size={14} />
          </button>
          <button
            type="button"
            title="Approve credential injection"
            disabled={disabled}
            onClick={() => onReview('credential_injection', 'approved', { runId: detail.run.id, credentialsHostOnly: true })}
          >
            <KeyRound size={14} />
          </button>
          <button
            type="button"
            title="Deny credential injection"
            disabled={disabled}
            onClick={() => onReview('credential_injection', 'denied', { runId: detail.run.id, credentialsHostOnly: true })}
          >
            <Ban size={14} />
          </button>
          <button
            type="button"
            title="Approve host action"
            disabled={disabled}
            onClick={() => onReview('host_action', 'approved', { runId: detail.run.id, hostAction: 'user_reviewed' })}
          >
            <Terminal size={14} />
          </button>
          <button
            type="button"
            title="Deny host action"
            disabled={disabled}
            onClick={() => onReview('host_action', 'denied', { runId: detail.run.id, hostAction: 'user_reviewed' })}
          >
            <XCircle size={14} />
          </button>
          <button
            type="button"
            title="Approve scope change"
            disabled={disabled}
            onClick={() => onReview('scope_change', 'approved', { runId: detail.run.id, scopeVersionId: detail.run.scopeVersionId })}
          >
            <ClipboardCheck size={14} />
          </button>
          <button
            type="button"
            title="Deny scope change"
            disabled={disabled}
            onClick={() => onReview('scope_change', 'denied', { runId: detail.run.id, scopeVersionId: detail.run.scopeVersionId })}
          >
            <ClipboardX size={14} />
          </button>
        </div>
      </div>
      {detail.policyEvents.map((policy) => (
        <div className="entity-row policy-entity" key={policy.id}>
          <div>
            <strong>{policy.decision}</strong>
            <p>{policy.reason}</p>
          </div>
        </div>
      ))}
      {detail.vmContexts.length === 0 && detail.policyEvents.length === 0 ? <div className="empty-state">No VM or policy events.</div> : null}
    </section>
  );
}

function openAiStatusLabel(status: OpenAiAccountStatus): string {
  switch (status.readiness) {
    case 'oauth_ready':
      return 'OAuth';
    case 'development_fallback':
      return 'Fallback';
    case 'oauth_command_failed':
      return 'Review';
    case 'not_configured':
      return 'Missing';
  }
}

function bumpedPriorityFactors(hypothesis: HypothesisRecord): PriorityFactorInput {
  return {
    attackerReachability: factorFromText(hypothesis.attackerReachability),
    impact: factorFromText(hypothesis.impact),
    evidenceConfidence: Math.min(4, factorFromText(hypothesis.evidenceConfidence) + 1),
    exploitPracticality: factorFromText(hypothesis.exploitPracticality),
    scopeConfidence: factorFromText(hypothesis.scopeConfidence)
  };
}

function factorFromText(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return Math.max(0, Math.min(4, parsed));
  const lower = value.toLowerCase();
  if (lower.includes('verifier') || lower.includes('verified')) return 3;
  if (lower.includes('dynamic') || lower.includes('reproduced')) return 2;
  if (lower.includes('out_of_scope') || lower.includes('out-of-scope')) return 0;
  return 1;
}

function budgetNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalPositiveInteger(rawValue: string, fallback: number): number {
  const trimmed = rawValue.trim();
  if (!trimmed) return fallback;
  const value = Math.floor(Number(trimmed));
  return Number.isFinite(value) ? Math.max(1, value) : fallback;
}

function clientRequestId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function extendBudgetLimit(value: unknown, unboundedValue: number, step: number): number {
  const current = budgetNumber(value, unboundedValue);
  return current >= unboundedValue ? unboundedValue : current + step;
}

function onboardingFormFromDefaults(defaults: ProgramOnboardingDefaults): ProgramOnboardingFormState {
  return {
    templateKind: 'manual',
    workspacePath: defaults.workspacePath,
    programName: defaults.programName,
    organizationName: defaults.organizationName,
    descriptionMarkdown: defaults.descriptionMarkdown,
    rulesMarkdown: defaults.rulesMarkdown,
    networkProfile: defaults.networkProfile,
    expiresAt: defaults.expiresAt ? defaults.expiresAt.slice(0, 10) : '',
    assets: defaults.assets
  };
}

function onboardingInputFromForm(form: ProgramOnboardingFormState): ProgramOnboardingInput {
  return {
    workspacePath: form.workspacePath,
    programName: form.programName,
    organizationName: form.organizationName,
    descriptionMarkdown: form.descriptionMarkdown,
    rulesMarkdown: form.rulesMarkdown,
    networkProfile: form.networkProfile,
    expiresAt: optionalDateOrNever(form.expiresAt),
    assets: form.assets
  };
}

function templateLabel(templateKind: ProgramTemplateKind): string {
  switch (templateKind) {
    case 'manual':
      return 'Manual';
    case 'hackerone':
      return 'HackerOne';
    case 'apple':
      return 'Apple';
    case 'msrc':
      return 'MSRC';
  }
}

function applyProgramTemplate(form: ProgramOnboardingFormState, templateKind: ProgramTemplateKind): ProgramOnboardingFormState {
  if (templateKind === 'manual' || templateKind === 'hackerone') {
    return { ...form, templateKind };
  }
  if (templateKind === 'apple') {
    return {
      ...form,
      templateKind,
      programName: 'Apple Security Bounty',
      organizationName: 'Apple',
      descriptionMarkdown: APPLE_PROGRAM_DESCRIPTION,
      rulesMarkdown: APPLE_SCOPE_AND_RULES,
      networkProfile: 'elevated',
      expiresAt: '',
      assets: []
    };
  }
  return {
    ...form,
    templateKind,
    programName: 'Microsoft Security Response Center',
    organizationName: 'Microsoft',
    descriptionMarkdown: MSRC_PROGRAM_DESCRIPTION,
    rulesMarkdown: MSRC_SCOPE_AND_RULES,
    networkProfile: 'elevated',
    expiresAt: '',
    assets: []
  };
}

function scopeToForm(scope: ProgramScopeVersion): ScopeFormState {
  return {
    programName: scope.programName,
    organizationName: scope.organizationName,
    descriptionMarkdown: scope.descriptionMarkdown,
    rulesMarkdown: scope.rulesMarkdown,
    networkProfile: scope.networkProfile,
    expiresAt: scope.expiresAt ? scope.expiresAt.slice(0, 10) : '',
    domains: linesFor(scope, 'in_scope', 'domain'),
    repositories: linesFor(scope, 'in_scope', 'repo'),
    executables: linesFor(scope, 'in_scope', 'binary'),
    localPaths: linesFor(scope, 'in_scope', 'path'),
    credentialRefs: linesFor(scope, 'in_scope', 'credential_ref'),
    outOfScope: scope.assets
      .filter((asset) => asset.direction === 'out_of_scope')
      .map((asset) => asset.value)
      .join('\n')
  };
}

function formToScopeDraft(form: ScopeFormState): ProgramScopeDraft {
  return {
    programName: form.programName,
    organizationName: form.organizationName,
    descriptionMarkdown: form.descriptionMarkdown,
    rulesMarkdown: form.rulesMarkdown,
    networkProfile: form.networkProfile,
    expiresAt: optionalDateOrNever(form.expiresAt),
    assets: [
      ...assetsFromLines(form.domains, 'in_scope', 'domain'),
      ...assetsFromLines(form.repositories, 'in_scope', 'repo'),
      ...assetsFromLines(form.executables, 'in_scope', 'binary'),
      ...assetsFromLines(form.localPaths, 'in_scope', 'path'),
      ...assetsFromLines(form.credentialRefs, 'in_scope', 'credential_ref'),
      ...assetsFromLines(form.outOfScope, 'out_of_scope', 'other')
    ]
  };
}

function optionalDateOrNever(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function emptyDateClass(value: string): string | undefined {
  return value.trim() ? undefined : 'date-input-empty';
}

function linesFor(scope: ProgramScopeVersion, direction: ScopeAssetDirection, kind: ScopeAssetKind): string {
  return scope.assets
    .filter((asset) => asset.direction === direction && asset.kind === kind)
    .map((asset) => asset.value)
    .join('\n');
}

function assetsFromLines(text: string, direction: ScopeAssetDirection, kind: ScopeAssetKind): ProgramScopeDraft['assets'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value) => ({
      direction,
      kind,
      value,
      sensitivity: kind === 'credential_ref' ? 'restricted' : 'internal',
      attributes: {}
    }));
}

function compactJson(value: Record<string, unknown>): string {
  const text = JSON.stringify(value, null, 2);
  return text.length > 600 ? `${text.slice(0, 600)}\n...` : text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function userFacingErrorMessage(error: unknown): string {
  const message = errorMessage(error)
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
  return message || 'An unknown error occurred.';
}
