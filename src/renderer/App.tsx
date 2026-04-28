import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  Archive,
  ArrowRight,
  Ban,
  Bell,
  Bug,
  CalendarClock,
  ChevronRight,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  ClipboardX,
  Edit3,
  EyeOff,
  FileArchive,
  FileJson,
  FileOutput,
  FileText,
  FolderPlus,
  Gauge,
  GitFork,
  GitMerge,
  KeyRound,
  LockKeyhole,
  Monitor,
  MoreVertical,
  Network,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Server,
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
  RunRow,
  RunStatus,
  ScopeAssetDirection,
  ScopeAssetInput,
  ScopeAssetKind,
  StartRunInput,
  TraceEventRecord,
  TranscriptMessageRecord,
  WorkspaceSnapshot
} from '@shared/types';

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
type SettingsSection = 'general' | 'providers';
type TraceCategoryId =
  | 'agent_output'
  | 'reasoning'
  | 'tools'
  | 'vm_execution'
  | 'hypotheses'
  | 'evidence'
  | 'verifier'
  | 'policy_scope'
  | 'code_navigation'
  | 'failure_recovery'
  | 'events';

interface TraceCategoryOption {
  id: TraceCategoryId;
  label: string;
  description: string;
}

interface TraceTimelineGroup {
  key: string;
  label: string;
  startedAt: string;
  updatedAt: string;
  visibleCount: number;
  toolCount: number;
  modelCount: number;
  failureCount: number;
}

interface TraceTimelineEntry {
  event: TraceDisplayEvent;
  group: TraceTimelineGroup;
}

interface TraceDisplayEvent extends TraceEventRecord {
  transcriptMessageId?: string;
  displayOnly?: boolean;
}

interface RenderedTraceGroup {
  key: string;
  group: TraceTimelineGroup;
  entries: TraceTimelineEntry[];
}

const TRACE_CATEGORY_OPTIONS: TraceCategoryOption[] = [
  { id: 'agent_output', label: 'Agent Output', description: 'Model messages, status updates, and researcher-facing agent responses.' },
  { id: 'reasoning', label: 'Thought', description: 'Agent thought summaries, intent, and concise rationale without hidden chain-of-thought.' },
  { id: 'tools', label: 'Tools', description: 'Tool calls, tool results, and execution summaries.' },
  { id: 'vm_execution', label: 'VM / Execution', description: 'Guest VM lifecycle, imports, commands, cleanup, and target execution.' },
  { id: 'hypotheses', label: 'Hypotheses', description: 'Hypothesis creation, priority changes, merges, dismissals, and scope decisions.' },
  { id: 'evidence', label: 'Evidence / Artifacts', description: 'Artifacts, evidence promotion, finding records, and exportable observations.' },
  { id: 'verifier', label: 'Verifier', description: 'Verifier contracts, pass/fail results, and verification gating.' },
  { id: 'policy_scope', label: 'Scope / Policy', description: 'Scope checks, network decisions, approvals, and policy blocks.' },
  { id: 'code_navigation', label: 'Code Nav', description: 'Search, code browser, symbol, file, and repository inspection traces.' },
  { id: 'failure_recovery', label: 'Error', description: 'Errors, retries, cleanup issues, recovery notes, and blocked operations.' },
  { id: 'events', label: 'Events', description: 'Run lifecycle, user steering, notes, and uncategorized system events.' }
];

const ALL_TRACE_CATEGORY_IDS = TRACE_CATEGORY_OPTIONS.map((option) => option.id);
const TRACE_RENDER_WINDOW_SIZE = 50;
const TRACE_ESTIMATED_EVENT_HEIGHT = 58;
const TRACE_AUTO_FOLLOW_THRESHOLD = TRACE_ESTIMATED_EVENT_HEIGHT * 2;
const TRACE_SUMMARY_VERBS = new Set([
  'accept',
  'accepted',
  'allocate',
  'allocated',
  'ask',
  'asked',
  'block',
  'blocked',
  'call',
  'called',
  'compact',
  'compacted',
  'complete',
  'completed',
  'create',
  'created',
  'destroy',
  'destroyed',
  'enforce',
  'enforced',
  'execute',
  'executed',
  'export',
  'exported',
  'fail',
  'failed',
  'finish',
  'finished',
  'import',
  'imported',
  'inspect',
  'inspected',
  'pause',
  'paused',
  'plan',
  'planned',
  'prepare',
  'prepared',
  'read',
  'record',
  'recorded',
  'recover',
  'recovered',
  'request',
  'requested',
  'report',
  'reported',
  'resume',
  'resumed',
  'retry',
  'retried',
  'review',
  'reviewed',
  'run',
  'search',
  'send',
  'sent',
  'skip',
  'skipped',
  'start',
  'started',
  'stream',
  'streamed',
  'update',
  'updated',
  'verify',
  'verified'
]);
const INSET_SCROLLBAR_ACTIVE_MS = 900;
const INSET_SCROLLBAR_SELECTOR = [
  '.sidebar',
  '.inspector-sidebar',
  '.main-trace-list',
  '.main-hypothesis-list',
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
  networkProfile: 'offline',
  sandboxProfile: 'local_disposable_vm',
  budget: {
    maxMinutes: UNBOUNDED_MINUTES,
    maxAttempts: 1,
    maxCostUsd: 0
  },
  fakeScenario: 'adaptive_portfolio'
};

const SIDEBAR_SESSION_LIMIT = 4;

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [programRegistry, setProgramRegistry] = useState<ProgramRegistryState | null>(null);
  const [hostEnvironment, setHostEnvironment] = useState<HostEnvironment | null>(null);
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiAccountStatus | null>(null);
  const [openAiOAuthResult, setOpenAiOAuthResult] = useState<OpenAiOAuthStartResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
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
    setSnapshot(next);
    if (next) {
      setOpenAiStatus(next.openAi);
      if (next.openAi.readiness === 'oauth_ready') {
        setStatusMessage(null);
      }
    }
    setSelectedRunId((current) => selectRunId(current, next));
  }, []);

  const loadSnapshot = useCallback(async () => {
    const next = await window.beale.getSnapshot();
    applySnapshot(next);
  }, [applySnapshot]);

  const loadProgramRegistry = useCallback(async () => {
    setProgramRegistry(await window.beale.getProgramRegistry());
  }, []);

  const selectedRunStatus = selectedRunId ? snapshot?.runs.find((row) => row.run.id === selectedRunId)?.run.status ?? null : null;

  useEffect(() => {
    window.beale
      .getHostEnvironment()
      .then(setHostEnvironment)
      .catch((caught: unknown) => setError(errorMessage(caught)));

    window.beale
      .getSnapshot()
      .then((initial) => {
        applySnapshot(initial);
      })
      .catch((caught: unknown) => setError(errorMessage(caught)));

    window.beale
      .getProgramRegistry()
      .then(setProgramRegistry)
      .catch((caught: unknown) => setError(errorMessage(caught)));

    window.beale
      .getOpenAiStatus()
      .then(setOpenAiStatus)
      .catch((caught: unknown) => setError(errorMessage(caught)));

    const unsubscribeSnapshot = window.beale.onSnapshot(applySnapshot);
    const unsubscribeProgramRegistry = window.beale.onProgramRegistry(setProgramRegistry);
    return () => {
      unsubscribeSnapshot();
      unsubscribeProgramRegistry();
    };
  }, [applySnapshot]);

  useEffect(() => {
    const requestSeq = ++runDetailRequestSeqRef.current;
    if (!selectedRunId) {
      setRunDetail(null);
      return undefined;
    }

    let disposed = false;
    let inFlight = false;
    const refreshRunDetail = (): void => {
      if (inFlight) return;
      inFlight = true;
      window.beale
        .getRunDetail(selectedRunId)
        .then((detail) => {
          if (!disposed && requestSeq === runDetailRequestSeqRef.current) {
            setRunDetail(detail);
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
    if (!buildTraceDisplayEvents(runDetail).some((event) => event.id === selectedTraceEventId)) {
      setSelectedTraceEventId(null);
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

  const refreshOpenAiProvider = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatusMessage(null);
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
      setStatusMessage({ tone: 'info', text: result.detail });
      setOpenAiStatus(await window.beale.getOpenAiStatus());
    } catch (caught) {
      setStatusMessage({ tone: 'error', text: errorMessage(caught) });
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

  const appShellClassName = [
    'app-shell',
    sidebarCollapsed ? 'sidebar-collapsed' : '',
    inspectorOpen ? 'inspector-open' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const activeRunDetail = runDetail && runDetail.run.id === selectedRunId ? runDetail : null;
  const activeTraceEvents = activeRunDetail ? buildTraceDisplayEvents(activeRunDetail) : [];
  const selectedTraceEvent = activeTraceEvents.find((event) => event.id === selectedTraceEventId) ?? null;
  const sessionHeat = sessionHeatForDetail(activeRunDetail);
  const sessionHistoryProgram =
    sessionHistoryProgramId && programRegistry ? programRegistry.programs.find((program) => program.id === sessionHistoryProgramId) ?? null : null;
  const sessionHistorySessions = sessionHistoryProgram && programRegistry ? researchSessionsForProgram(programRegistry, sessionHistoryProgram) : [];

  return (
    <div className={appShellClassName} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        inspectorOpen={inspectorOpen}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onToggleInspector={() => setInspectorOpen((current) => !current)}
        onOpenTraceFilters={() => setTraceFilterOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        traceFilterCount={visibleTraceCategories.length}
      />
      <aside className="sidebar" aria-hidden={sidebarCollapsed} inert={sidebarCollapsed}>
        <button type="button" className="sidebar-new-research" title="Start new research session" disabled={busy || !snapshot} onClick={() => setNewResearchOpen(true)}>
          <Play size={15} />
          <span>New Research Session</span>
        </button>
        <div className="sidebar-quick-actions">
          <button type="button" className="sidebar-utility-button" title="Search">
            <Search size={15} />
            <span>Search</span>
          </button>
          <button type="button" className="sidebar-utility-button" title="Schedules">
            <CalendarClock size={15} />
            <span>Schedules</span>
          </button>
        </div>
        <div className="sidebar-section program-list">
          <div className="section-row">
            <div className="meta-label">Research Programs</div>
            <button type="button" title="Add research program" disabled={busy} onClick={addProgram}>
              <FolderPlus size={15} />
            </button>
          </div>
          {(programRegistry?.programs ?? []).map((program) => {
            const active = snapshot?.workspace.workspacePath === program.workspacePath;
            const menuOpen = openProgramMenuId === program.id;
            const sessions = programRegistry ? researchSessionsForProgram(programRegistry, program) : [];
            const visibleSessions = sessions.slice(0, SIDEBAR_SESSION_LIMIT);
            return (
              <div className="program-group" key={program.id}>
                <div className={`program-item-row ${active ? 'active' : ''} ${menuOpen ? 'menu-open' : ''}`} data-program-menu-root>
                  <button type="button" className="program-item" title={program.workspacePath} onClick={() => openRegisteredProgram(program)}>
                    <Terminal size={15} />
                    <span>{program.programName}</span>
                  </button>
                  <button
                    type="button"
                    className="program-menu-button"
                    title={`${program.programName} options`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenProgramMenuId((current) => (current === program.id ? null : program.id));
                    }}
                  >
                    <MoreVertical size={14} />
                  </button>
                  {menuOpen ? (
                    <div className="program-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProgramInfo(program);
                          setOpenProgramMenuId(null);
                        }}
                      >
                        Program Information
                      </button>
                      <button type="button" role="menuitem" className="danger" onClick={() => removeRegisteredProgram(program)}>
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="program-session-list">
                  {visibleSessions.length > 0 ? (
                    visibleSessions.map((session) => (
                      <div className="program-session-row" key={session.id}>
                        <SessionActiveIndicator status={session.status} />
                        <button
                          type="button"
                          className={`program-session-item ${selectedRunId === session.runId ? 'active' : ''}`}
                          title={promptSessionTitle(session)}
                          onClick={() => openResearchSession(program, session)}
                        >
                          <span className="program-session-title">{promptSessionTitle(session)}</span>
                          <span className="program-session-age">{shortRelativeAge(session.updatedAt)}</span>
                        </button>
                      </div>
                    ))
                  ) : (
                    <span className="program-session-empty">No Session Yet...</span>
                  )}
                  {sessions.length > SIDEBAR_SESSION_LIMIT ? (
                    <button type="button" className="program-session-more" onClick={() => setSessionHistoryProgramId(program.id)}>
                      More Sessions...
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!programRegistry && snapshot ? (
            <button type="button" className="program-item active" title={snapshot.workspace.workspacePath}>
              <Terminal size={15} />
              <span>{snapshot.activeScope.programName}</span>
            </button>
          ) : null}
        </div>
        {error ? <div className="error-box">{error}</div> : null}
        <div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" onPointerDown={beginSidebarResize} />
      </aside>

      <main className={`workbench session-heat-${sessionHeat}`} data-session-heat={sessionHeat}>
        <div className="workbench-header">
          <div className="workbench-program">
            <RunStatusIndicator detail={activeRunDetail} />
            <span className="workbench-title">{snapshot?.activeScope.programName ?? 'No Program Selected'}</span>
          </div>
          <SessionTimestamps detail={activeRunDetail} events={activeTraceEvents} visibleTraceCategories={visibleTraceCategories} />
        </div>
        <div className={`workspace-page session-heat-${sessionHeat}`}>
          <MainSessionWorkspace
            detail={activeRunDetail}
            selectedRunId={selectedRunId}
            selectedTraceEventId={selectedTraceEventId}
            visibleTraceCategories={visibleTraceCategories}
            busy={busy}
            onSelectTraceEvent={(event) => {
              setSelectedTraceEventId(event.id);
              setInspectorOpen(true);
            }}
            onSteerInstruction={(runId, instruction) => {
              void runAction(() => window.beale.steerRun({ type: 'fork', runId, instruction }));
            }}
          />
        </div>
      </main>
      <aside className="inspector-sidebar" aria-label="Inspector" aria-hidden={!inspectorOpen} inert={!inspectorOpen}>
        <TraceInspector event={selectedTraceEvent} />
      </aside>
      <StatusBar
        hostEnvironment={snapshot?.workspace.hostEnvironment ?? hostEnvironment}
        executor={snapshot?.executor ?? null}
        activity={environmentActivityForDetail(activeRunDetail)}
        message={statusMessage ?? openAiFooterMessage(snapshot?.openAi ?? openAiStatus)}
        notificationCount={snapshot?.notifications.length ?? 0}
        onConfigureVm={() => {
          setSettingsSection('general');
          setSettingsOpen(true);
        }}
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
          openAiOAuthResult={openAiOAuthResult}
          openAiStatus={snapshot?.openAi ?? openAiStatus}
          busy={busy}
          onChangeSection={setSettingsSection}
          onClose={() => setSettingsOpen(false)}
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
            void runAction(() => window.beale.steerRun({ type: 'fork', runId: activeNotification.runId, instruction }));
            setActiveNotification(null);
          }}
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

function researchSessionsForProgram(registry: ProgramRegistryState, program: ProgramRegistryEntry): ResearchSessionSummary[] {
  return registry.researchSessions.filter((session) => session.programId === program.id || (!session.programId && session.workspacePath === program.workspacePath));
}

function promptSessionTitle(session: ResearchSessionSummary): string {
  const promptText = firstPromptSentence(session.promptMarkdown);
  return truncateText(promptText || session.title || session.summary || 'Untitled research', 86);
}

function firstPromptSentence(promptMarkdown: string): string {
  const rawLines = promptMarkdown.split(/\r?\n/);
  const contentLines = rawLines.length > 1 && /^#{1,6}\s+/.test(rawLines[0]?.trim() ?? '') ? rawLines.slice(1) : rawLines;
  const lines = contentLines
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/^[*\-\d.]+\s+/, '').trim())
    .filter(Boolean);
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? text).trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function shortRelativeAge(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}D`;
  return `${Math.max(1, Math.floor(days / 7))}W`;
}

function TopBar({
  sidebarCollapsed,
  inspectorOpen,
  onOpenSettings,
  onOpenTraceFilters,
  onToggleSidebar,
  onToggleInspector,
  traceFilterCount
}: {
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  onOpenSettings: () => void;
  onOpenTraceFilters: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  traceFilterCount: number;
}): JSX.Element {
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const InspectorToggleIcon = inspectorOpen ? PanelRightClose : PanelRightOpen;

  return (
    <header className="top-bar">
      <nav className="window-menu" aria-label="Application menu">
        <button
          type="button"
          className="sidebar-toggle-button"
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-pressed={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <SidebarToggleIcon size={14} />
        </button>
        <button type="button">File</button>
        <button type="button">Edit</button>
        <button type="button">View</button>
        <button type="button">Window</button>
      </nav>
      <div className="top-actions">
        <button
          type="button"
          title={`Trace filters (${traceFilterCount}/${ALL_TRACE_CATEGORY_IDS.length} shown)`}
          aria-label={`Trace filters (${traceFilterCount}/${ALL_TRACE_CATEGORY_IDS.length} shown)`}
          onClick={onOpenTraceFilters}
        >
          <SlidersHorizontal size={14} />
        </button>
        <button type="button" title="Settings" onClick={onOpenSettings}>
          <Settings size={14} />
        </button>
        <button
          type="button"
          title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          aria-pressed={inspectorOpen}
          onClick={onToggleInspector}
        >
          <InspectorToggleIcon size={14} />
        </button>
      </div>
    </header>
  );
}

function StatusBar({
  hostEnvironment,
  executor,
  activity,
  message,
  notificationCount,
  onConfigureVm
}: {
  hostEnvironment: HostEnvironment | null;
  executor: ExecutorStatus | null;
  activity: EnvironmentActivity;
  message: { tone: 'error' | 'info'; text: string } | null;
  notificationCount: number;
  onConfigureVm: () => void;
}): JSX.Element {
  const osLabel = hostEnvironmentLabel(hostEnvironment);
  const vmTarget = vmTargetStatus(executor);

  return (
    <footer className="status-bar">
      <div className="environment-switcher" aria-label="Environment target">
        <div className={`environment-pill ${activity.host ? 'is-active' : ''}`} title={`Host operating system: ${osLabel}`}>
          <Monitor size={14} />
          <span>{osLabel}</span>
        </div>
        <ArrowRight className="environment-arrow" size={14} aria-hidden="true" />
        <div className={`environment-pill environment-vm-pill ${vmTarget.configured ? 'is-configured' : 'is-unconfigured'} ${activity.guest ? 'is-active' : ''}`} title={vmTarget.title}>
          <Server size={14} />
          <span>{vmTarget.label}</span>
          {vmTarget.configured ? null : (
            <button type="button" className="environment-configure" onClick={onConfigureVm}>
              Configure
            </button>
          )}
        </div>
      </div>
      <div className={`status-message ${message ? `tone-${message.tone}` : ''}`}>{message ? message.text : null}</div>
      <button type="button" className="notification-button" title={`${notificationCount} unread notification${notificationCount === 1 ? '' : 's'}`}>
        <Bell size={15} />
        {notificationCount > 0 ? <span>{notificationCount}</span> : null}
      </button>
    </footer>
  );
}

function NotificationStack({
  notifications,
  onOpen,
  onDismiss
}: {
  notifications: NotificationRecord[];
  onOpen: (notification: NotificationRecord) => void;
  onDismiss: (notificationId: string) => void;
}): JSX.Element | null {
  if (notifications.length === 0) return null;
  return (
    <div className="notification-stack" aria-label="Notifications">
      {notifications.map((notification) => (
        <article className="notification-toast" key={notification.id}>
          <button type="button" className="notification-toast-main" onClick={() => onOpen(notification)}>
            <span className="notification-toast-title">{notification.title}</span>
            <span className="notification-toast-body">{truncateText(firstNotificationSentence(notification.bodyMarkdown), 140)}</span>
          </button>
          <button
            type="button"
            className="notification-toast-close"
            title="Dismiss notification"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(notification.id)}
          >
            <XCircle size={15} />
          </button>
        </article>
      ))}
    </div>
  );
}

function NotificationDetailModal({
  notification,
  busy,
  onClose,
  onSteer
}: {
  notification: NotificationRecord;
  busy: boolean;
  onClose: () => void;
  onSteer: (instruction: string) => void;
}): JSX.Element {
  const [instruction, setInstruction] = useState('');
  const trimmedInstruction = instruction.trim();
  return (
    <Modal
      title={notification.title}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary-button" disabled={busy || !trimmedInstruction} onClick={() => onSteer(trimmedInstruction)}>
            <ChevronRight size={15} />
            Steer
          </button>
        </>
      }
    >
      <div className="notification-detail">
        <pre>{notification.bodyMarkdown}</pre>
        <label>
          Steer
          <textarea
            rows={4}
            value={instruction}
            placeholder="Add direction for this research session"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

function firstNotificationSentence(markdown: string): string {
  return firstPromptSentence(markdown) || markdown.replace(/\s+/g, ' ').trim();
}

function RunStatusIndicator({ detail }: { detail: RunDetail | null }): JSX.Element | null {
  if (!detail) return null;
  const status = detail.run.status;
  const statusClass = runStatusClass(status);
  const label = traceLabel(status);
  const icon =
    statusClass === 'active' ? (
      <RefreshCw size={13} />
    ) : statusClass === 'paused' ? (
      <Pause size={17} strokeWidth={2.8} />
    ) : statusClass === 'completed' ? (
      <Square size={16} strokeWidth={2.6} />
    ) : statusClass === 'failed' ? (
      <X size={17} strokeWidth={3.2} />
    ) : null;

  if (!icon) return null;
  return (
    <span className={`workbench-run-status run-status-${statusClass}`} title={`Run status: ${label}`} aria-label={`Run status: ${label}`}>
      {icon}
    </span>
  );
}

function SessionActiveIndicator({ status }: { status: RunStatus }): JSX.Element {
  return (
    <span className="program-session-status" title={traceLabel(status)} aria-label={`Session status: ${traceLabel(status)}`}>
      {status === 'active' ? <RefreshCw size={10} /> : null}
    </span>
  );
}

function runStatusClass(status: RunStatus): 'active' | 'completed' | 'failed' | 'paused' | 'queued' {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'active') return 'active';
  if (status === 'queued') return 'queued';
  return 'paused';
}

function SessionTimestamps({
  detail,
  events,
  visibleTraceCategories
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  visibleTraceCategories: TraceCategoryId[];
}): JSX.Element | null {
  const active = detail?.run.status === 'active';
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active, detail?.run.id]);

  if (!detail) return null;
  const updated = latestRunDetailDate(detail);
  if (!updated) return null;
  const createdMs = Date.parse(detail.run.createdAt);
  const durationEndMs = active ? nowMs : updated.getTime();
  const durationMs = Number.isFinite(createdMs) ? Math.max(0, durationEndMs - createdMs) : 0;
  const latestTurn = latestTraceTurnNumber(events) ?? 0;
  const visibleEventCount = events.filter((event) => visibleTraceCategories.includes(traceCategoryForEvent(event))).length;
  const eventMetric = `${visibleEventCount}/${events.length}`;
  const turnTooltip = latestTurn === 0 ? 'Current model turn. 0 means setup before the first model turn.' : 'Current model turn.';
  const durationTooltip = `Created ${formatSessionDateTime(detail.run.createdAt)}\nUpdated ${formatSessionStart(updated)}`;

  return (
    <div className="session-start-time">
      <span className="session-mode-pill">{traceLabel(detail.run.mode)}</span>
      <span className="session-header-metric" title={turnTooltip} aria-label={`Current model turn ${latestTurn}`}>
        <GitFork size={13} />
        <span>{latestTurn}</span>
      </span>
      <span
        className="session-header-metric"
        title="Visible trace events after filters, followed by total trace events when filters are active."
        aria-label={`${visibleEventCount} visible trace events out of ${events.length} total trace events`}
      >
        <FileText size={13} />
        <span>{eventMetric}</span>
      </span>
      <span className="session-header-metric session-duration-metric" title={durationTooltip} aria-label={`Session duration ${formatDurationHms(durationMs)}`}>
        <Clock size={13} />
        <span>{formatDurationHms(durationMs)}</span>
      </span>
    </div>
  );
}

function latestRunDetailDate(detail: RunDetail): Date | null {
  const timestamps = [
    detail.run.createdAt,
    detail.run.startedAt,
    detail.run.endedAt,
    ...detail.attempts.flatMap((attempt) => [attempt.startedAt, attempt.endedAt]),
    ...detail.traceEvents.map((event) => event.createdAt),
    ...detail.hypotheses.flatMap((hypothesis) => [hypothesis.createdAt, hypothesis.updatedAt]),
    ...detail.artifacts.map((artifact) => artifact.createdAt),
    ...detail.findings.flatMap((finding) => [finding.createdAt, finding.updatedAt]),
    ...detail.verifierContracts.flatMap((contract) => [contract.createdAt, contract.updatedAt]),
    ...detail.verifierRuns.flatMap((run) => [run.startedAt, run.endedAt]),
    ...detail.vmContexts.flatMap((context) => [context.createdAt, context.destroyedAt]),
    ...detail.modelSessions.flatMap((session) => [session.createdAt, session.updatedAt]),
    ...detail.policyEvents.flatMap((event) => [event.createdAt, event.decidedAt]),
    ...detail.exports.flatMap((exportRecord) => [exportRecord.createdAt, exportRecord.reviewedAt])
  ];
  const latestTimestamp = timestamps.reduce<number | null>((latest, value) => {
    if (!value) return latest;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return latest;
    return latest === null ? timestamp : Math.max(latest, timestamp);
  }, null);
  return latestTimestamp === null ? null : new Date(latestTimestamp);
}

function formatSessionStart(date: Date): string {
  return `${SESSION_MONTHS[date.getMonth()]} ${date.getDate()}, ${formatSessionTime(date)}`;
}

function formatSessionDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return formatSessionStart(date);
}

function formatSessionTime(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? 'a' : 'p';
  return `${hour12}:${minutes}${suffix}`;
}

function formatDurationHms(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const SESSION_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MainSessionWorkspace({
  detail,
  selectedRunId,
  selectedTraceEventId,
  visibleTraceCategories,
  busy,
  onSelectTraceEvent,
  onSteerInstruction
}: {
  detail: RunDetail | null;
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
      <MainTraceView
        busy={busy}
        detail={detail}
        selectedRunId={selectedRunId}
        selectedTraceEventId={selectedTraceEventId}
        visibleTraceCategories={visibleTraceCategories}
        onSelectTraceEvent={onSelectTraceEvent}
        onSteerInstruction={onSteerInstruction}
      />
      <MainSessionSidePanel detail={detail} />
    </div>
  );
}

function MainSessionSidePanel({ detail }: { detail: RunDetail | null }): JSX.Element {
  return (
    <div className="main-session-side">
      <MainHypothesisList detail={detail} />
    </div>
  );
}

function MainSteerArea({
  detail,
  busy,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  busy: boolean;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element {
  const [instruction, setInstruction] = useState('');
  const trimmedInstruction = instruction.trim();
  const disabled = busy || !detail || !trimmedInstruction;

  const submit = (): void => {
    if (disabled || !detail) return;
    onSteerInstruction(detail.run.id, trimmedInstruction);
    setInstruction('');
  };

  return (
    <footer className="main-trace-footer" aria-label="Steer research session">
      <div className="main-steer-row">
        <div className="main-steer-input-shell">
          <textarea
            rows={1}
            value={instruction}
            placeholder="Steer the agent..."
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" className="main-steer-model-picker" title="Session model and effort" aria-label="Session model and effort">
            {detail ? `${detail.run.model} ${detail.run.reasoningEffort}` : 'No model'}
          </button>
          <button type="button" className="main-steer-send" title="Send steering instruction" aria-label="Send steering instruction" disabled={disabled} onClick={submit}>
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </footer>
  );
}

function MainTraceView({
  busy,
  detail,
  selectedRunId,
  selectedTraceEventId,
  visibleTraceCategories,
  onSelectTraceEvent,
  onSteerInstruction
}: {
  busy: boolean;
  detail: RunDetail | null;
  selectedRunId: string | null;
  selectedTraceEventId: string | null;
  visibleTraceCategories: TraceCategoryId[];
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  const loading = !detail;
  const events = detail ? buildTraceDisplayEvents(detail) : [];
  const timelineEntries = buildTraceTimelineEntries(events, visibleTraceCategories);
  const latestEventId = events.at(-1)?.id ?? '';
  const traceFilterKey = visibleTraceCategories.join('|');
  const maxWindowStart = Math.max(0, timelineEntries.length - TRACE_RENDER_WINDOW_SIZE);
  const [traceWindowStart, setTraceWindowStart] = useState(maxWindowStart);
  const normalizedWindowStart = Math.min(traceWindowStart, maxWindowStart);
  const renderedEntries = timelineEntries.slice(normalizedWindowStart, normalizedWindowStart + TRACE_RENDER_WINDOW_SIZE);
  const renderedGroups = groupRenderedTraceEntries(renderedEntries);
  const latestGroupKey = latestTraceGroupKey(events);
  const topSpacerHeight = normalizedWindowStart * TRACE_ESTIMATED_EVENT_HEIGHT;
  const bottomSpacerHeight = Math.max(0, timelineEntries.length - normalizedWindowStart - renderedEntries.length) * TRACE_ESTIMATED_EVENT_HEIGHT;
  const traceScrollRef = useRef<HTMLDivElement | null>(null);
  const traceListRef = useRef<HTMLDivElement | null>(null);
  const traceFollowLatestRef = useRef(true);
  const traceAutoScrollingRef = useRef(false);
  const traceAutoScrollFrameRef = useRef<number | null>(null);
  const traceAutoScrollSettledFrameRef = useRef<number | null>(null);
  const latestRenderedEvent = renderedEntries.at(-1)?.event;
  const latestRenderedPayloadLength = latestRenderedEvent ? (JSON.stringify(latestRenderedEvent.payload)?.length ?? 0) : 0;
  const latestRenderedEventVersion = latestRenderedEvent ? `${latestRenderedEvent.id}:${latestRenderedEvent.summary.length}:${latestRenderedPayloadLength}` : '';

  const updateTraceScrollEdges = useCallback(() => {
    const traceScroll = traceScrollRef.current;
    const traceList = traceListRef.current;
    if (!traceScroll) return;
    if (!traceList) {
      traceScroll.classList.remove('has-top-fade', 'has-bottom-fade');
      return;
    }

    const scrollableDistance = traceList.scrollHeight - traceList.clientHeight;
    const canScroll = scrollableDistance > 8;
    const hasVirtualTop = normalizedWindowStart > 0;
    const hasVirtualBottom = normalizedWindowStart + renderedEntries.length < timelineEntries.length;
    const showTopFade = canScroll && (hasVirtualTop || traceList.scrollTop > 8);
    const showBottomFade = canScroll && (hasVirtualBottom || traceList.scrollTop < scrollableDistance - 8);

    traceScroll.classList.toggle('has-top-fade', showTopFade);
    traceScroll.classList.toggle('has-bottom-fade', showBottomFade);
  }, [normalizedWindowStart, renderedEntries.length, timelineEntries.length]);

  const cancelPendingTraceAutoScroll = useCallback(() => {
    if (traceAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(traceAutoScrollFrameRef.current);
      traceAutoScrollFrameRef.current = null;
    }
    if (traceAutoScrollSettledFrameRef.current !== null) {
      window.cancelAnimationFrame(traceAutoScrollSettledFrameRef.current);
      traceAutoScrollSettledFrameRef.current = null;
    }
  }, []);

  const scrollTraceToBottom = useCallback(() => {
    const traceList = traceListRef.current;
    if (!traceList) return;

    cancelPendingTraceAutoScroll();
    traceAutoScrollingRef.current = true;
    const alignToBottom = (): void => {
      traceList.scrollTop = Math.max(0, traceList.scrollHeight - traceList.clientHeight);
      updateTraceScrollEdges();
    };

    alignToBottom();
    traceAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      alignToBottom();
      traceAutoScrollSettledFrameRef.current = window.requestAnimationFrame(() => {
        alignToBottom();
        traceAutoScrollingRef.current = false;
        traceAutoScrollFrameRef.current = null;
        traceAutoScrollSettledFrameRef.current = null;
        updateTraceScrollEdges();
      });
    });
  }, [cancelPendingTraceAutoScroll, updateTraceScrollEdges]);

  useEffect(() => {
    if (!traceFollowLatestRef.current) return;
    scrollTraceToBottom();
  }, [bottomSpacerHeight, latestEventId, latestRenderedEventVersion, normalizedWindowStart, renderedEntries.length, scrollTraceToBottom, selectedRunId]);

  useEffect(() => () => {
    cancelPendingTraceAutoScroll();
  }, [cancelPendingTraceAutoScroll]);

  useEffect(() => {
    traceFollowLatestRef.current = true;
    setTraceWindowStart(Math.max(0, timelineEntries.length - TRACE_RENDER_WINDOW_SIZE));
  }, [selectedRunId, traceFilterKey]);

  useEffect(() => {
    setTraceWindowStart((current) => Math.min(current, maxWindowStart));
  }, [maxWindowStart]);

  useEffect(() => {
    if (traceFollowLatestRef.current) {
      setTraceWindowStart(maxWindowStart);
    }
  }, [latestEventId, maxWindowStart]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateTraceScrollEdges);
    return () => window.cancelAnimationFrame(frame);
  }, [bottomSpacerHeight, latestEventId, latestRenderedEventVersion, renderedEntries.length, selectedRunId, topSpacerHeight, updateTraceScrollEdges]);

  useEffect(() => {
    const traceList = traceListRef.current;
    if (!traceList || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateTraceScrollEdges);
    observer.observe(traceList);
    return () => observer.disconnect();
  }, [selectedRunId, updateTraceScrollEdges]);

  const handleTraceScroll = useCallback(() => {
    const traceList = traceListRef.current;
    updateTraceScrollEdges();
    if (!traceList || timelineEntries.length <= TRACE_RENDER_WINDOW_SIZE) return;
    if (traceAutoScrollingRef.current) {
      traceFollowLatestRef.current = true;
      return;
    }
    const distanceFromBottom = traceList.scrollHeight - traceList.clientHeight - traceList.scrollTop;
    const nearBottom = distanceFromBottom <= TRACE_AUTO_FOLLOW_THRESHOLD;
    traceFollowLatestRef.current = nearBottom;
    const nextStart = Math.max(0, Math.min(maxWindowStart, Math.floor(traceList.scrollTop / TRACE_ESTIMATED_EVENT_HEIGHT)));
    if (nextStart !== normalizedWindowStart) {
      setTraceWindowStart(nextStart);
    }
  }, [maxWindowStart, normalizedWindowStart, timelineEntries.length, updateTraceScrollEdges]);

  if (!selectedRunId) return null;

  return (
    <section className="main-trace-view" aria-label="Agent trace">
      {loading ? <div className="main-trace-empty">Loading trace.</div> : null}
      {!loading && events.length === 0 ? <div className="main-trace-empty">No trace events recorded.</div> : null}
      {!loading && events.length > 0 && timelineEntries.length === 0 ? <div className="main-trace-empty">No trace events match the active filters.</div> : null}
      {!loading && renderedEntries.length > 0 ? (
        <div className="main-trace-scroll" ref={traceScrollRef}>
          <div className="main-trace-list" ref={traceListRef} onScroll={handleTraceScroll}>
            {topSpacerHeight > 0 ? <div className="main-trace-spacer" style={{ height: topSpacerHeight }} aria-hidden="true" /> : null}
            {renderedGroups.map((group) => (
              <MainTraceTurnGroup
                group={group.group}
                entries={group.entries}
                key={group.key}
                latest={group.group.key === latestGroupKey}
                runStatus={detail.run.status}
                selectedTraceEventId={selectedTraceEventId}
                onSelectTraceEvent={onSelectTraceEvent}
              />
            ))}
            {bottomSpacerHeight > 0 ? <div className="main-trace-spacer" style={{ height: bottomSpacerHeight }} aria-hidden="true" /> : null}
          </div>
        </div>
      ) : null}
      <MainSteerArea busy={busy} detail={detail} onSteerInstruction={onSteerInstruction} />
    </section>
  );
}

function MainHypothesisList({ detail }: { detail: RunDetail | null }): JSX.Element {
  const loading = !detail;
  const hypotheses = detail?.hypotheses ?? [];

  return (
    <section className="main-hypothesis-view" aria-label="Hypotheses">
      <div className="main-surface-header">
        <div>
          <Bug size={14} />
          <span>Hypotheses</span>
        </div>
        <span>{loading ? 'Loading' : `${hypotheses.length}`}</span>
      </div>
      {loading ? <div className="main-trace-empty">Loading hypotheses.</div> : null}
      {!loading && hypotheses.length === 0 ? <div className="main-trace-empty">No hypotheses recorded.</div> : null}
      {!loading && hypotheses.length > 0 ? (
        <div className="main-hypothesis-list">
          {hypotheses.map((hypothesis) => (
            <MainHypothesisItem hypothesis={hypothesis} key={hypothesis.id} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MainHypothesisItem({ hypothesis }: { hypothesis: HypothesisRecord }): JSX.Element {
  return (
    <article className={`main-hypothesis-item state-${stateClass(hypothesis.state)}`}>
      <strong>{hypothesis.title}</strong>
      <p>
        {traceLabel(hypothesis.state)} · Priority {hypothesis.priorityScore.toFixed(2)}
      </p>
      <p>
        {hypothesis.bugClass || 'Unclassified'} · {hypothesis.component || 'Unknown component'}
      </p>
    </article>
  );
}

function MainTraceTurnGroup({
  group,
  entries,
  latest,
  runStatus,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  group: TraceTimelineGroup;
  entries: TraceTimelineEntry[];
  latest: boolean;
  runStatus: RunStatus;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const status = traceGroupStatusLabel(group, latest, runStatus);
  const activitySummary = group.toolCount > 0 ? `${group.toolCount} ops` : group.modelCount > 0 ? `${group.modelCount} model` : 'system';

  return (
    <section className="main-trace-turn" aria-label={group.label}>
      <div className="main-trace-turn-header">
        <div>
          <span className="main-trace-turn-label">{group.label}</span>
          <span>
            {formatTraceTimestamp(group.startedAt)}
            {group.updatedAt !== group.startedAt ? ` - ${formatTraceTimestamp(group.updatedAt)}` : ''}
          </span>
        </div>
        <div>
          <span>{group.visibleCount} events</span>
          <span>{activitySummary}</span>
          <span className={`main-trace-turn-state state-${status.kind}`}>{status.label}</span>
        </div>
      </div>
      <div className="main-trace-turn-events">
        {entries.map(({ event }) => (
          <MainTraceEvent event={event} key={event.id} selected={event.id === selectedTraceEventId} onSelect={onSelectTraceEvent} />
        ))}
      </div>
    </section>
  );
}

function MainTraceEvent({ event, selected, onSelect }: { event: TraceDisplayEvent; selected: boolean; onSelect: (event: TraceDisplayEvent) => void }): JSX.Element {
  const category = traceCategoryForEvent(event);
  const outcome = traceEventOutcome(event);
  const detail = traceEventDetailText(event, category);
  const hasDetail = detail.length > 0;
  const eventKindClass = usesCompactTraceSublabel(event, category) ? 'trace-compact-sublabel' : '';
  return (
    <button
      type="button"
      className={`main-trace-event source-${event.source} type-${event.type} category-${category} ${eventKindClass} ${outcome ? `outcome-${outcome}` : ''} ${
        selected ? 'selected' : ''
      }`}
      aria-pressed={selected}
      onClick={() => onSelect(event)}
    >
      <div className="main-trace-meta">
        <time className="main-trace-time" dateTime={event.createdAt}>
          {formatTraceTimestamp(event.createdAt)}
        </time>
        <span>{traceLabel(event.source)}</span>
      </div>
      <div className="main-trace-marker" aria-hidden="true">
        <span>{traceEventIcon(event, category)}</span>
      </div>
      <div className="main-trace-event-body">
        <div className="main-trace-line">
          <strong>{traceEventSummary(event, category)}</strong>
          <div className="main-trace-badges">
            <span>{traceCategoryLabel(category)}</span>
            {!event.modelVisible ? <span>Hidden</span> : null}
          </div>
        </div>
        <div className="main-trace-context">
          {hasDetail ? <code>{detail}</code> : null}
        </div>
      </div>
    </button>
  );
}

function usesCompactTraceSublabel(event: TraceEventRecord, category: TraceCategoryId): boolean {
  return !isProseTraceEvent(event, category);
}

function isProseTraceEvent(event: TraceEventRecord, category: TraceCategoryId): boolean {
  const text = tracePayloadPrimitive(event.payload, 'text') ?? tracePayloadPrimitive(event.payload, 'delta');
  if (!text) return false;
  if (tracePayloadPrimitive(event.payload, 'transcriptSource') === 'openai_reasoning_summary') return true;
  if (tracePayloadPrimitive(event.payload, 'transcriptKind') === 'reasoning_summary') return true;
  if (tracePayloadPrimitive(event.payload, 'claimStatus') === 'reasoning_summary') return true;
  if (tracePayloadPrimitive(event.payload, 'transcriptRole') === 'assistant') return true;
  if (tracePayloadPrimitive(event.payload, 'transcriptKind') === 'agent_output') return true;
  return category === 'agent_output' && event.source === 'model';
}

function buildTraceDisplayEvents(detail: RunDetail): TraceDisplayEvent[] {
  const transcriptTraceIds = new Set(detail.transcriptMessages.map((message) => message.traceEventId).filter((id): id is string => Boolean(id)));
  const traceById = new Map(detail.traceEvents.map((event) => [event.id, event]));
  const baseEvents = detail.traceEvents.filter((event) => !transcriptTraceIds.has(event.id));
  const transcriptEvents = detail.transcriptMessages.map((message, index) => transcriptMessageToTraceEvent(message, index, traceById.get(message.traceEventId ?? '')));

  return [...baseEvents, ...transcriptEvents].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    if (left.sequence !== right.sequence) return left.sequence - right.sequence;
    return left.id.localeCompare(right.id);
  });
}

function transcriptMessageToTraceEvent(message: TranscriptMessageRecord, index: number, linkedTraceEvent?: TraceEventRecord): TraceDisplayEvent {
  const source: TraceEventRecord['source'] = message.role === 'assistant' ? 'model' : message.role === 'user' ? 'user' : 'system';
  const type: TraceEventRecord['type'] = message.role === 'user' ? 'user_note' : 'model_message';
  const summary =
    message.source === 'openai_reasoning_summary'
      ? 'Thought.'
      : message.role === 'assistant'
        ? 'Report agent output.'
        : message.role === 'user'
          ? 'Ask agent.'
          : 'Record system message.';
  const linkedTurn = linkedTraceEvent?.payload.turn;
  const payload: Record<string, unknown> = {
    text: message.contentMarkdown,
    transcriptMessageId: message.id,
    transcriptRole: message.role,
    transcriptSource: message.source,
    ...(message.traceEventId ? { linkedTraceEventId: message.traceEventId } : {}),
    ...(linkedTurn === undefined ? {} : { turn: linkedTurn }),
    metadata: message.metadata
  };

  return {
    id: `transcript:${message.id}`,
    runId: message.runId,
    attemptId: message.attemptId,
    sequence: linkedTraceEvent ? linkedTraceEvent.sequence + 0.01 + index / 100_000 : -100_000 + index,
    type,
    source,
    summary,
    payload,
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: message.createdAt,
    vmContextId: linkedTraceEvent?.vmContextId ?? null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    transcriptMessageId: message.id,
    displayOnly: true
  };
}

function buildTraceTimelineEntries(events: TraceDisplayEvent[], visibleCategories: TraceCategoryId[]): TraceTimelineEntry[] {
  const entries: TraceTimelineEntry[] = [];
  let group = createTraceTimelineGroup('setup', 'Setup', events[0]?.createdAt ?? '');

  for (const event of events) {
    const turnNumber = traceTurnNumber(event);
    if (turnNumber !== null) {
      group = createTraceTimelineGroup(`turn-${turnNumber}-${event.sequence}`, `Turn ${turnNumber}`, event.createdAt);
    }

    group.updatedAt = event.createdAt;
    const category = traceCategoryForEvent(event);
    if (!visibleCategories.includes(category)) continue;

    group.visibleCount += 1;
    if (category === 'tools' || category === 'code_navigation' || category === 'vm_execution' || category === 'verifier') {
      group.toolCount += 1;
    }
    if (category === 'agent_output' || category === 'reasoning') {
      group.modelCount += 1;
    }
    if (category === 'failure_recovery') {
      group.failureCount += 1;
    }
    entries.push({ event, group });
  }

  return entries;
}

function createTraceTimelineGroup(key: string, label: string, startedAt: string): TraceTimelineGroup {
  return {
    key,
    label,
    startedAt,
    updatedAt: startedAt,
    visibleCount: 0,
    toolCount: 0,
    modelCount: 0,
    failureCount: 0
  };
}

function groupRenderedTraceEntries(entries: TraceTimelineEntry[]): RenderedTraceGroup[] {
  const groups: RenderedTraceGroup[] = [];
  for (const entry of entries) {
    const current = groups.at(-1);
    if (current && current.group === entry.group) {
      current.entries.push(entry);
      continue;
    }
    groups.push({ key: `${entry.group.key}-${entry.event.id}`, group: entry.group, entries: [entry] });
  }
  return groups;
}

function latestTraceTurnNumber(events: TraceDisplayEvent[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    latest = traceTurnNumber(event) ?? latest;
  }
  return latest;
}

function latestTraceGroupKey(events: TraceDisplayEvent[]): string {
  let key = 'setup';
  for (const event of events) {
    const turnNumber = traceTurnNumber(event);
    if (turnNumber !== null) {
      key = `turn-${turnNumber}-${event.sequence}`;
    }
  }
  return key;
}

function traceTurnNumber(event: TraceEventRecord): number | null {
  const turn = event.payload.turn;
  if (typeof turn === 'number' && Number.isInteger(turn) && turn > 0) return turn;
  if (typeof turn === 'string' && /^\d+$/.test(turn)) return Number(turn);
  const match = event.summary.match(/\bturn\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function traceGroupStatusLabel(group: TraceTimelineGroup, latest: boolean, runStatus: RunStatus): { kind: string; label: string } {
  if (group.failureCount > 0) return { kind: 'review', label: `${group.failureCount} ${group.failureCount === 1 ? 'Error' : 'Errors'}` };
  if (latest && runStatus === 'active') return { kind: 'active', label: 'Active' };
  if (group.toolCount > 0 || group.modelCount > 0) return { kind: 'complete', label: 'Complete' };
  return { kind: 'events', label: 'Events' };
}

function traceEventSummary(event: TraceEventRecord, category: TraceCategoryId): string {
  return trimTraceLabelPeriod(rawTraceEventSummary(event, category));
}

function rawTraceEventSummary(event: TraceEventRecord, category: TraceCategoryId): string {
  const summary = event.summary.trim();
  if (!summary) return traceCategoryFallbackPrefix(category);

  if (summary === 'OpenAI streamed model output delta.') return 'Stream model output';
  if (summary === 'OpenAI response completed.') return 'Complete response';
  if (summary === 'OpenAI response created.') return 'Start model turn';
  if (summary === 'OpenAI completed a model output item.') return 'Complete model output';
  if (summary === 'OpenAI completed thought.' || isLegacyThoughtSummary(summary)) return 'Thought';
  if (summary === 'OpenAI adapter prepared host-only model session.') return 'Prepare host-only model session';
  if (summary === 'OpenAI Responses run started from markdown prompt.') return 'Start run from prompt';
  if (summary === 'OpenAI run blocked because no host credential is configured.') return 'Block run: missing host credential';
  if (summary === 'OpenAI run resume blocked because no host credential is configured.') return 'Block resume: missing host credential';
  if (summary === 'OpenAI run resumed from compacted Beale replay context.') return 'Resume run from compacted replay';
  if (summary === 'OpenAI run resumed from persisted Responses state.') return 'Resume run from persisted state';
  if (summary === 'OpenAI compacted retry recovered from context window pressure.') return 'Recover compacted retry';
  if (summary === 'OpenAI previous response state was unavailable; retrying with compacted Beale replay context.') return 'Retry with compacted replay';
  if (summary === 'OpenAI backend rejected previous_response_id; retrying with compacted Beale replay context.') return 'Retry with compacted replay';
  if (summary === 'OpenAI context window pressure triggered compacted retry.') return 'Compact context for retry';
  if (summary === 'OpenAI Responses run failed.') return 'Fail Responses run';
  if (summary === 'Context compacted for long-running session.') return 'Compact context for long-running session';
  if (summary === 'Workspace recovery paused interrupted run after app restart.') return 'Pause interrupted run after restart';
  if (summary === 'Run started from markdown prompt.') return 'Start run from prompt';
  if (summary === 'Fake executor allocated a simulated disposable VM context.') return 'Allocate simulated VM context';
  if (summary === 'Simulated model planned an open-ended discovery pass.') return 'Plan discovery pass';
  if (summary === 'No network request was sent.') return 'Skip network request';
  if (summary === 'Simulated finding recorded; real VM verifier required for verified state.') return 'Record simulated finding';
  if (summary === 'Verifier failed to destroy guest after execution.') return 'Review verifier cleanup failure';
  if (summary === 'VM executor alpha failed to destroy guest after run failure.') return 'Review VM cleanup failure';
  if (summary === 'VM executor alpha run failed.') return 'Fail VM executor run';
  if (summary === 'VM executor alpha run started from markdown prompt.') return 'Start VM executor run';

  let match = summary.match(/^OpenAI Responses request sent for turn (\d+)\.$/);
  if (match) return `Send request for turn ${match[1]}`;
  match = summary.match(/^OpenAI completed function call arguments for ([^.]+)\.$/);
  if (match) return `Call ${match[1]}`;
  match = summary.match(/^Guest ([\w -]+) operation sent to VM executor\.$/i);
  if (match) return `Send ${match[1].toLowerCase()} operation to VM`;
  match = summary.match(/^Guest ([\w -]+) operation finished with ([^.]+)\.$/i);
  if (match) return `Finish ${match[1].toLowerCase()} operation: ${match[2]}`;
  match = summary.match(/^Debugger wrapper operation finished with ([^.]+)\.$/i);
  if (match) return `Finish debugger wrapper: ${match[1]}`;
  match = summary.match(/^Guest artifact exported and accepted: (.+)\.$/);
  if (match) return `Accept exported artifact: ${match[1]}`;
  match = summary.match(/^VM network profile enforced: ([^.]+)\.$/);
  if (match) return `Enforce network profile: ${match[1]}`;
  match = summary.match(/^Verifier contract executed in disposable VM with ([^.]+)\.$/);
  if (match) return `Execute verifier contract: ${match[1]}`;
  match = summary.match(/^Adaptive portfolio branch recorded: (.+)\.$/);
  if (match) return `Record portfolio branch: ${match[1]}`;
  match = summary.match(/^Requested (.+)\.$/);
  if (match) return `Request ${match[1]}`;
  match = summary.match(/^Artifact recorded: (.+)\.$/);
  if (match) return `Record artifact: ${match[1]}`;
  match = summary.match(/^Hypothesis created: (.+)\.$/);
  if (match) return `Create hypothesis: ${match[1]}`;
  match = summary.match(/^Policy engine blocked (.+)\.$/);
  if (match) return `Block ${match[1]}`;
  match = summary.match(/^Paused after (.+)\.$/);
  if (match) return `Pause after ${match[1]}`;

  if (startsWithTraceVerb(summary)) return summary;
  return `${traceCategoryFallbackPrefix(category)}: ${summary}`;
}

function trimTraceLabelPeriod(label: string): string {
  return label.replace(/(?<!\.)\.$/, '');
}

function isLegacyThoughtSummary(summary: string): boolean {
  return summary.startsWith('OpenAI completed reasoning') && summary.endsWith('summary.');
}

function startsWithTraceVerb(summary: string): boolean {
  const firstWord = summary.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '').toLowerCase() ?? '';
  return TRACE_SUMMARY_VERBS.has(firstWord);
}

function traceCategoryFallbackPrefix(category: TraceCategoryId): string {
  if (category === 'agent_output' || category === 'reasoning') return 'Report';
  if (category === 'tools') return 'Run';
  if (category === 'vm_execution') return 'Execute';
  if (category === 'hypotheses') return 'Track';
  if (category === 'evidence') return 'Record';
  if (category === 'verifier') return 'Verify';
  if (category === 'policy_scope') return 'Enforce';
  if (category === 'code_navigation') return 'Inspect';
  if (category === 'failure_recovery') return 'Review';
  return 'Note';
}

function traceEventDetailText(event: TraceEventRecord, category: TraceCategoryId): string {
  const text = tracePayloadPrimitive(event.payload, 'text') ?? tracePayloadPrimitive(event.payload, 'delta');
  if ((category === 'agent_output' || category === 'reasoning') && text) {
    return category === 'reasoning' ? formatReasoningTraceText(text) : truncateText(text.replace(/\s+/g, ' ').trim(), 360);
  }

  return tracePayloadDetailText(event, category);
}

function formatReasoningTraceText(text: string): string {
  const thoughts: string[] = [];
  let current = '';

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/[ \t]+/g, ' ').trim();
    if (!line) continue;

    const heading = line.match(/^\*\*([^*]+?)\*\*\s*(.*)$/);
    if (heading) {
      if (current) thoughts.push(current);
      const title = heading[1].trim();
      const description = heading[2].trim();
      current = description ? `${title}: ${description}` : `${title}:`;
      continue;
    }

    current = current ? `${current} ${line}` : line;
  }

  if (current) thoughts.push(current);
  return thoughts.join('\n');
}

function tracePayloadDetailText(event: TraceEventRecord, category: TraceCategoryId): string {
  const payload = event.payload;
  const parts =
    [
      detailPartsForToolCall(event),
      detailPartsForToolResult(event),
      detailPartsForModelSystemEvent(event),
      detailPartsForVerifierEvent(event),
      detailPartsForNetworkEvent(event),
      detailPartsForVmEvent(event),
      detailPartsForEvidenceEvent(event),
      detailPartsForReviewEvent(event),
      detailPartsForUserEvent(event),
      fallbackPayloadParts(payload, category)
    ].find((candidate): candidate is string[] => Boolean(candidate && candidate.length > 0)) ?? [];
  return truncateText(formatTraceDetailParts(parts), 300);
}

function detailPartsForToolCall(event: TraceEventRecord): string[] | null {
  if (event.type !== 'tool_call') return null;
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  const args = tracePayloadRecord(event.payload, 'arguments');
  const parts = [toolName ? `tool ${toolName}` : null, ...toolArgumentParts(toolName, args), policyPart(event.payload)].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts : null;
}

function toolArgumentParts(toolName: string | null, args: Record<string, unknown> | null): Array<string | null> {
  if (!args) return [];
  if (toolName === 'search') return [quotedPart('query', stringRecordValue(args, 'query')), targetPart(args)];
  if (toolName === 'source') return [pathPart('repo', stringRecordValue(args, 'repository')), quotedPart('ref', stringRecordValue(args, 'ref'))];
  if (toolName === 'code_browser') return [pathPart('path', stringRecordValue(args, 'path')), quotedPart('symbol', stringRecordValue(args, 'symbol')), rangePart(args)];
  if (toolName === 'python') return [quotedPart('task', stringRecordValue(args, 'task')), pathPart('artifact', stringRecordValue(args, 'artifact_path'))];
  if (toolName === 'debugger') return [tracePart('operation', stringRecordValue(args, 'operation')), pathPart('target', stringRecordValue(args, 'target')), pathPart('input', stringRecordValue(args, 'input_path'))];
  if (toolName === 'artifact') return [quotedPart('name', stringRecordValue(args, 'name')), tracePart('kind', stringRecordValue(args, 'kind'))];
  if (toolName === 'verifier') return [quotedPart('hypothesis', stringRecordValue(args, 'hypothesis')), pathPart('artifact', stringRecordValue(args, 'artifact_id')), pathPart('trace', stringRecordValue(args, 'trace_event_id'))];
  return Object.entries(args)
    .slice(0, 3)
    .map(([key, value]) => primitiveValuePart(key, value));
}

function detailPartsForToolResult(event: TraceEventRecord): string[] | null {
  if (event.type !== 'tool_result' && event.type !== 'artifact_created') return null;
  const payload = event.payload;
  const error = tracePayloadPrimitive(payload, 'error');
  if (error) {
    return [
      tracePart('status', tracePayloadPrimitive(payload, 'status') ?? 'error'),
      tracePart('error', error),
      pathPart('path', tracePayloadPrimitive(payload, 'path')),
      tracePart('tool', tracePayloadPrimitive(payload, 'toolName')),
      ...nestedArgumentsParts(payload)
    ].filter((part): part is string => Boolean(part));
  }

  const query = tracePayloadPrimitive(payload, 'query');
  if (query) {
    return [
      quotedPart('query', query),
      matchCountPart(payload),
      traceNumberPart('files', tracePayloadPrimitive(payload, 'filesConsidered')),
      traceNumberPart('skipped', tracePayloadPrimitive(payload, 'skippedFiles')),
      availableRepositoriesPart(payload),
      targetPart(payload),
      tracePayloadPrimitive(payload, 'sourceAcquisitionHint')
    ].filter((part): part is string => Boolean(part));
  }

  const repositoryUrl = tracePayloadPrimitive(payload, 'repositoryUrl') ?? tracePayloadPrimitive(payload, 'requestedRepository');
  if (repositoryUrl || tracePayloadArray(payload, 'availableRepositories')) {
    return [
      pathPart('repo', repositoryUrl),
      pathPart('local', tracePayloadPrimitive(payload, 'localPath')),
      traceBooleanPart('cloned', tracePayloadPrimitive(payload, 'cloned')),
      shortHashPart('head', tracePayloadPrimitive(payload, 'head')),
      tracePart('reason', tracePayloadPrimitive(payload, 'reason')),
      availableRepositoriesPart(payload)
    ].filter((part): part is string => Boolean(part));
  }

  const sourcePath = tracePayloadPrimitive(payload, 'sourcePath') ?? tracePayloadPrimitive(payload, 'path');
  if (sourcePath && (event.summary.includes('Code browser') || payload.excerpt)) {
    return [
      pathPart('path', sourcePath),
      lineRangePart(payload),
      quotedPart('symbol', tracePayloadPrimitive(payload, 'symbol')),
      traceBooleanPart('truncated', tracePayloadPrimitive(payload, 'truncated')),
      shortHashPart('hash', tracePayloadPrimitive(payload, 'contentHash')),
      tracePart('reason', tracePayloadPrimitive(payload, 'reason'))
    ].filter((part): part is string => Boolean(part));
  }

  const artifactId = tracePayloadPrimitive(payload, 'artifactId') ?? tracePayloadPrimitive(payload, 'exportedArtifactId');
  if (artifactId || event.type === 'artifact_created') {
    return [
      pathPart('artifact', artifactId),
      pathPart('path', tracePayloadPrimitive(payload, 'relativePath') ?? tracePayloadPrimitive(payload, 'guestPath')),
      quotedPart('name', tracePayloadPrimitive(payload, 'name')),
      tracePart('kind', tracePayloadPrimitive(payload, 'kind')),
      shortHashPart('sha256', tracePayloadPrimitive(payload, 'sha256'))
    ].filter((part): part is string => Boolean(part));
  }

  return executionParts(payload);
}

function detailPartsForModelSystemEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'model_message') return null;
  const payload = event.payload;
  const responseId = tracePayloadPrimitive(payload, 'responseId');
  const usage = tracePayloadRecord(payload, 'usage');
  const tokenParts = usage
    ? [
        traceNumberPart('input', stringRecordValue(usage, 'input_tokens')),
        traceNumberPart('output', stringRecordValue(usage, 'output_tokens')),
        traceNumberPart('reasoning', tracePayloadRecord(usage, 'output_tokens_details') ? stringRecordValue(tracePayloadRecord(usage, 'output_tokens_details') ?? {}, 'reasoning_tokens') : null)
      ]
    : [];

  return [
    tracePart('model', tracePayloadPrimitive(payload, 'model')),
    tracePart('effort', reasoningEffortPart(payload)),
    traceNumberPart('tools', tracePayloadPrimitive(payload, 'toolCount')),
    tracePart('transport', tracePayloadPrimitive(payload, 'transport')),
    replayPart(payload),
    tracePart('reason', tracePayloadPrimitive(payload, 'reason')),
    traceNumberPart('high water', tracePayloadPrimitive(payload, 'traceHighWaterMark')),
    byteSizePart(tracePayloadPrimitive(payload, 'serializedSizeBytes')),
    shortHashPart('response', responseId),
    shortHashPart('previous response', tracePayloadPrimitive(payload, 'previousResponseId')),
    tracePart('auth', tracePayloadPrimitive(payload, 'authSource')),
    traceBooleanPart('auth configured', tracePayloadPrimitive(payload, 'authConfigured')),
    traceBooleanPart('credentials host-only', tracePayloadPrimitive(payload, 'credentialsHostOnly')),
    traceBooleanPart('recovered', tracePayloadPrimitive(payload, 'recovered')),
    traceBooleanPart('retry', tracePayloadPrimitive(payload, 'retryAttempted')),
    tracePart('error', tracePayloadPrimitive(payload, 'error')),
    ...tokenParts
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForVerifierEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'verifier_result' && event.source !== 'verifier') return null;
  const payload = event.payload;
  return [
    tracePart('status', tracePayloadPrimitive(payload, 'status')),
    pathPart('contract', tracePayloadPrimitive(payload, 'contractId')),
    pathPart('run', tracePayloadPrimitive(payload, 'verifierRunId')),
    traceBooleanPart('real', tracePayloadPrimitive(payload, 'realExecution')),
    traceBooleanPart('vm', tracePayloadPrimitive(payload, 'vmExecution')),
    pathPart('artifact', tracePayloadPrimitive(payload, 'artifactId')),
    tracePart('blocked', tracePayloadPrimitive(payload, 'blockedIssue')),
    firstArrayPart('issue', tracePayloadArray(payload, 'issues'))
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForNetworkEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'network_event') return null;
  const payload = event.payload;
  return [
    tracePart('profile', tracePayloadPrimitive(payload, 'networkProfile')),
    tracePart('decision', tracePayloadPrimitive(payload, 'decision')),
    traceBooleanPart('live target', tracePayloadPrimitive(payload, 'liveTargetAllowed')),
    traceNumberPart('destinations', tracePayloadPrimitive(payload, 'allowedDestinationCount')),
    pathPart('host', tracePayloadPrimitive(payload, 'destinationHostname')),
    tracePart('port', tracePayloadPrimitive(payload, 'port')),
    tracePart('protocol', tracePayloadPrimitive(payload, 'protocol')),
    tracePart('backend', tracePayloadPrimitive(payload, 'backend')),
    tracePart('rule', tracePayloadPrimitive(payload, 'policyRule')),
    tracePart('reason', tracePayloadPrimitive(payload, 'reason'))
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForVmEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'vm_event') return null;
  const payload = event.payload;
  return [
    pathPart('vm', tracePayloadPrimitive(payload, 'vmContextId')),
    tracePart('state', tracePayloadPrimitive(payload, 'state') ?? tracePayloadPrimitive(payload, 'previousState')),
    tracePart('backend', tracePayloadPrimitive(payload, 'backend')),
    tracePart('provider', tracePayloadPrimitive(payload, 'provider')),
    pathPart('image', tracePayloadPrimitive(payload, 'imageRef')),
    tracePart('snapshot', tracePayloadPrimitive(payload, 'snapshotRef')),
    tracePart('profile', tracePayloadPrimitive(payload, 'networkProfile')),
    pathPart('host', tracePayloadPrimitive(payload, 'hostPath') ?? tracePayloadPrimitive(payload, 'requestedHostPath')),
    pathPart('guest', tracePayloadPrimitive(payload, 'guestPath')),
    tracePart('mode', tracePayloadPrimitive(payload, 'mode')),
    importSummaryPart(payload),
    providerResultPart(payload),
    traceNumberPart('destinations', arrayLengthValue(payload, 'allowedDestinations')),
    traceBooleanPart('live target', tracePayloadPrimitive(payload, 'liveTargetAllowed')),
    traceBooleanPart('target execution', tracePayloadPrimitive(payload, 'targetExecution')),
    traceBooleanPart('host db mounted', tracePayloadPrimitive(payload, 'hostDatabaseMounted')),
    traceBooleanPart('OpenAI creds mounted', tracePayloadPrimitive(payload, 'openAiCredentialsMounted')),
    traceBooleanPart('review required', tracePayloadPrimitive(payload, 'userReviewRequired')),
    tracePart('reason', tracePayloadPrimitive(payload, 'reason')),
    tracePayloadPrimitive(payload, 'error'),
    tracePart('recovered', tracePayloadPrimitive(payload, 'recoveredAt'))
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForEvidenceEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'artifact_created' && event.type !== 'finding_event' && event.type !== 'hypothesis_event') return null;
  const payload = event.payload;
  return [
    pathPart('hypothesis', tracePayloadPrimitive(payload, 'hypothesisId')),
    pathPart('source hypothesis', tracePayloadPrimitive(payload, 'sourceHypothesisId')),
    pathPart('target hypothesis', tracePayloadPrimitive(payload, 'targetHypothesisId')),
    pathPart('finding', tracePayloadPrimitive(payload, 'findingId')),
    tracePart('title', tracePayloadPrimitive(payload, 'title')),
    tracePart('component', tracePayloadPrimitive(payload, 'component')),
    tracePart('severity', tracePayloadPrimitive(payload, 'severity')),
    tracePart('state', tracePayloadPrimitive(payload, 'findingState') ?? tracePayloadPrimitive(payload, 'state')),
    traceNumberPart('priority', tracePayloadPrimitive(payload, 'priorityScore')),
    pathPart('artifact', tracePayloadPrimitive(payload, 'artifactId')),
    pathPart('evidence', tracePayloadPrimitive(payload, 'evidenceId')),
    pathPart('export', tracePayloadPrimitive(payload, 'exportId')),
    pathPart('path', tracePayloadPrimitive(payload, 'relativePath')),
    tracePart('decision', tracePayloadPrimitive(payload, 'decision')),
    traceBooleanPart('reversible', tracePayloadPrimitive(payload, 'reversible')),
    tracePayloadPrimitive(payload, 'note')
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForReviewEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'approval_event') return null;
  const payload = event.payload;
  return [
    tracePart('decision', tracePayloadPrimitive(payload, 'decision')),
    tracePart('request', tracePayloadPrimitive(payload, 'requestKind')),
    pathPart('approval', tracePayloadPrimitive(payload, 'approvalId')),
    tracePart('tool', tracePayloadPrimitive(payload, 'toolName')),
    tracePayloadPrimitive(payload, 'credentialHint'),
    tracePayloadPrimitive(payload, 'note'),
    tracePayloadPrimitive(payload, 'reason'),
    ...nestedArgumentsParts(payload)
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForUserEvent(event: TraceEventRecord): string[] | null {
  if (event.source !== 'user' && event.type !== 'user_note') return null;
  const payload = event.payload;
  return [
    tracePayloadPrimitive(payload, 'instruction'),
    tracePayloadPrimitive(payload, 'note'),
    tracePart('mode', tracePayloadPrimitive(payload, 'mode')),
    tracePart('strategy', tracePayloadPrimitive(payload, 'attemptStrategy')),
    tracePart('engine', tracePayloadPrimitive(payload, 'runEngine'))
  ].filter((part): part is string => Boolean(part));
}

function executionParts(payload: Record<string, unknown>): string[] | null {
  const status = tracePayloadPrimitive(payload, 'status');
  const operation = tracePayloadPrimitive(payload, 'operationKind') ?? tracePayloadPrimitive(payload, 'operation') ?? tracePayloadPrimitive(payload, 'wrapper');
  const parts = [
    quotedPart('task', tracePayloadPrimitive(payload, 'task')),
    tracePart('operation', operation),
    tracePart('status', status),
    traceNumberPart('exit', tracePayloadPrimitive(payload, 'exitCode')),
    tracePart('signal', tracePayloadPrimitive(payload, 'signal')),
    durationPart(tracePayloadPrimitive(payload, 'durationMs')),
    tracePart('network', tracePayloadPrimitive(payload, 'networkProfile')),
    shortHashPart('script', tracePayloadPrimitive(payload, 'scriptHash')),
    pathPart('imported', tracePayloadPrimitive(payload, 'importedHostPath')),
    pathPart('artifact', tracePayloadPrimitive(payload, 'exportedArtifactId')),
    traceNumberPart('artifact candidates', tracePayloadPrimitive(payload, 'candidateArtifactCount')),
    structuredSummaryPart(payload),
    tracePayloadPrimitive(payload, 'stdoutSummary'),
    tracePayloadPrimitive(payload, 'stderrSummary'),
    firstArrayPart('artifact candidates', tracePayloadArray(payload, 'candidateArtifacts'))
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts : null;
}

function fallbackPayloadParts(payload: Record<string, unknown>, category: TraceCategoryId): string[] {
  const preferredKeys =
    category === 'failure_recovery'
      ? ['error', 'status', 'reason', 'message', 'blockedIssue']
      : ['status', 'reason', 'message', 'path', 'target', 'query', 'name', 'operationKind', 'command', 'cwd'];
  const preferred = preferredKeys.map((key) => primitiveValuePart(key, payload[key])).filter((part): part is string => Boolean(part));
  if (preferred.length > 0) return preferred;
  return Object.entries(payload)
    .map(([key, value]) => primitiveValuePart(key, value))
    .filter((part): part is string => Boolean(part))
    .slice(0, 4);
}

function formatTraceDetailParts(parts: string[]): string {
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
}

function tracePayloadPrimitive(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function tracePayloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = payload[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function tracePayloadArray(payload: Record<string, unknown>, key: string): unknown[] | null {
  const value = payload[key];
  return Array.isArray(value) ? value : null;
}

function stringRecordValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function primitiveValuePart(key: string, value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? `${traceLabel(key)} ${truncateText(value.trim(), 72)}` : null;
  if (typeof value === 'number' || typeof value === 'boolean') return `${traceLabel(key)} ${String(value)}`;
  if (Array.isArray(value)) return `${traceLabel(key)} ${value.length}`;
  return null;
}

function tracePart(label: string, value: string | null): string | null {
  return value ? `${label} ${value}` : null;
}

function quotedPart(label: string, value: string | null): string | null {
  return value ? `${label} "${truncateText(value, 72)}"` : null;
}

function pathPart(label: string, value: string | null): string | null {
  return value ? `${label} ${compactTracePath(value)}` : null;
}

function targetPart(record: Record<string, unknown>): string | null {
  return pathPart('target', stringRecordValue(record, 'target') ?? stringRecordValue(record, 'targetHint'));
}

function nestedArgumentsParts(payload: Record<string, unknown>): string[] {
  const args = tracePayloadRecord(payload, 'arguments');
  if (!args) return [];
  return [
    quotedPart('query', stringRecordValue(args, 'query')),
    targetPart(args),
    pathPart('repo', stringRecordValue(args, 'repository')),
    pathPart('path', stringRecordValue(args, 'path')),
    quotedPart('task', stringRecordValue(args, 'task')),
    tracePart('operation', stringRecordValue(args, 'operation'))
  ].filter((part): part is string => Boolean(part));
}

function policyPart(payload: Record<string, unknown>): string | null {
  const policy = tracePayloadRecord(payload, 'policy');
  if (!policy) return null;
  const execution = stringRecordValue(policy, 'execution');
  const targetExecution = stringRecordValue(policy, 'targetExecution');
  return [execution, targetExecution ? `target ${targetExecution}` : null].filter(Boolean).join(' / ') || null;
}

function rangePart(record: Record<string, unknown>): string | null {
  const start = stringRecordValue(record, 'line_start') ?? stringRecordValue(record, 'lineStart');
  const end = stringRecordValue(record, 'line_end') ?? stringRecordValue(record, 'lineEnd');
  if (start && end) return `lines ${start}-${end}`;
  if (start) return `line ${start}`;
  return null;
}

function lineRangePart(payload: Record<string, unknown>): string | null {
  const start = tracePayloadPrimitive(payload, 'lineStart');
  const end = tracePayloadPrimitive(payload, 'lineEnd');
  if (start && end) return `lines ${start}-${end}`;
  if (start) return `line ${start}`;
  return null;
}

function matchCountPart(payload: Record<string, unknown>): string | null {
  const matches = tracePayloadArray(payload, 'matches');
  return matches ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : null;
}

function availableRepositoriesPart(payload: Record<string, unknown>): string | null {
  const repositories = tracePayloadArray(payload, 'sourceRepositoriesAvailable') ?? tracePayloadArray(payload, 'availableRepositories');
  if (!repositories) return null;
  return `${repositories.length} source repo${repositories.length === 1 ? '' : 's'}`;
}

function reasoningEffortPart(payload: Record<string, unknown>): string | null {
  const reasoning = tracePayloadRecord(payload, 'reasoning');
  return reasoning ? stringRecordValue(reasoning, 'effort') : tracePayloadPrimitive(payload, 'reasoningEffort');
}

function replayPart(payload: Record<string, unknown>): string | null {
  const previousReplay = tracePayloadPrimitive(payload, 'previousReplayMode');
  const nextReplay = tracePayloadPrimitive(payload, 'newReplayMode');
  if (previousReplay && nextReplay) return `replay ${previousReplay} -> ${nextReplay}`;
  return tracePart('replay', tracePayloadPrimitive(payload, 'replayMode') ?? nextReplay);
}

function arrayLengthValue(payload: Record<string, unknown>, key: string): string | null {
  const value = tracePayloadArray(payload, key);
  return value ? String(value.length) : null;
}

function importSummaryPart(payload: Record<string, unknown>): string | null {
  const summary = tracePayloadRecord(payload, 'importSummary');
  if (!summary) return null;
  const kind = stringRecordValue(summary, 'kind');
  const files = stringRecordValue(summary, 'fileCount');
  const directories = stringRecordValue(summary, 'directoryCount');
  const size = byteSizePart(stringRecordValue(summary, 'sizeBytes'))?.replace(/^size /, '');
  return [kind, files ? `${files} files` : null, directories ? `${directories} dirs` : null, size].filter(Boolean).join(' · ') || null;
}

function providerResultPart(payload: Record<string, unknown>): string | null {
  const result = tracePayloadRecord(payload, 'providerResult');
  if (!result) return null;
  return (
    [
      traceBooleanPart('destroyed', stringRecordValue(result, 'destroyed')),
      traceBooleanPart('reset', stringRecordValue(result, 'reset')),
      traceBooleanPart('preserved', stringRecordValue(result, 'preserved')),
      tracePart('snapshot', stringRecordValue(result, 'snapshotRef')),
      pathPart('path', stringRecordValue(result, 'path'))
    ]
      .filter(Boolean)
      .join(' · ') || null
  );
}

function structuredSummaryPart(payload: Record<string, unknown>): string | null {
  const structured = tracePayloadRecord(payload, 'structured');
  if (!structured) return null;
  return [
    tracePart('backend', stringRecordValue(structured, 'backend')),
    pathPart('artifact', stringRecordValue(structured, 'artifactPath') ?? stringRecordValue(structured, 'artifact_path')),
    tracePart('result', stringRecordValue(structured, 'result')),
    tracePart('status', stringRecordValue(structured, 'status'))
  ]
    .filter(Boolean)
    .join(' · ');
}

function traceNumberPart(label: string, value: string | null): string | null {
  if (!value) return null;
  return `${label} ${value}`;
}

function traceBooleanPart(label: string, value: string | null): string | null {
  if (value !== 'true' && value !== 'false') return null;
  return `${label} ${value === 'true' ? 'yes' : 'no'}`;
}

function durationPart(value: string | null): string | null {
  if (!value) return null;
  const ms = Number(value);
  if (!Number.isFinite(ms)) return `duration ${value}`;
  if (ms < 1000) return `duration ${Math.round(ms)}ms`;
  return `duration ${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function byteSizePart(value: string | null): string | null {
  if (!value) return null;
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return `size ${value}`;
  if (bytes < 1024) return `size ${bytes}B`;
  if (bytes < 1024 * 1024) return `size ${(bytes / 1024).toFixed(1)}KB`;
  return `size ${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function shortHashPart(label: string, value: string | null): string | null {
  if (!value) return null;
  return `${label} ${value.length > 16 ? value.slice(0, 12) : value}`;
}

function firstArrayPart(label: string, value: unknown[] | null): string | null {
  if (!value) return null;
  if (value.length === 0) return `${label} 0`;
  const first = value[0];
  if (typeof first === 'string') return `${label} ${truncateText(first, 72)}`;
  return `${label} ${value.length}`;
}

function compactTracePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.length <= 68) return normalized;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return `...${normalized.slice(-64)}`;
  return `.../${parts.slice(-3).join('/')}`;
}

function toolNameFromSummary(summary: string): string | null {
  const requested = summary.match(/OpenAI requested Beale tool: ([^.]+)\./);
  if (requested) return requested[1];
  const completed = summary.match(/OpenAI completed function call arguments for ([^.]+)\./);
  return completed ? completed[1] : null;
}

function traceCategoryForEvent(event: TraceEventRecord): TraceCategoryId {
  const searchable = `${event.source} ${event.type} ${event.summary} ${JSON.stringify(event.payload)}`.toLowerCase();
  const transcriptRole = tracePayloadPrimitive(event.payload, 'transcriptRole');
  const transcriptSource = tracePayloadPrimitive(event.payload, 'transcriptSource');
  if (transcriptSource === 'openai_reasoning_summary') return 'reasoning';
  if (transcriptRole === 'assistant') return 'agent_output';
  if (transcriptRole === 'user' || transcriptRole === 'system') return 'events';
  if (event.source === 'policy' || event.type === 'approval_event' || event.type === 'network_event' || event.type === 'user_scope') return 'policy_scope';
  if (traceEventOutcome(event) === 'success') {
    if (event.source === 'executor' || /\b(vm|guest|firecracker|docker|snapshot|sandbox)\b/.test(searchable)) return 'vm_execution';
    if (event.source === 'tool' || event.type === 'tool_result') return 'tools';
  }
  if (/\b(error|failed|failure|retry|recover|recovery|blocked|timeout|destroy failed)\b/.test(searchable)) return 'failure_recovery';
  if (event.type === 'verifier_result' || event.source === 'verifier') return 'verifier';
  if (event.type === 'hypothesis_event') return 'hypotheses';
  if (event.type === 'artifact_created' || event.type === 'finding_event' || /\b(evidence|artifact|export|finding)\b/.test(searchable)) return 'evidence';
  if (event.source === 'executor' || event.type === 'vm_event' || /\b(vm|guest|firecracker|docker|snapshot|sandbox)\b/.test(searchable)) return 'vm_execution';
  if (event.source === 'tool' || event.type === 'tool_call' || event.type === 'tool_result') {
    if (/\b(search|code browser|symbol|file|repository|repo|line|bounded text)\b/.test(searchable)) return 'code_navigation';
    return 'tools';
  }
  if (event.source === 'model' || event.type === 'model_message') {
    if (/\b(plan|planned|prepared|objective|rationale|reason|strategy|hypothesis|intent)\b/.test(searchable)) return 'reasoning';
    return 'agent_output';
  }
  return 'events';
}

function traceEventOutcome(event: TraceEventRecord): 'success' | 'failure' | null {
  const status = tracePayloadPrimitive(event.payload, 'status')?.toLowerCase() ?? '';
  if (status === 'success' || /\bfinished with success\b/i.test(event.summary)) return 'success';
  if (['failure', 'failed', 'timeout', 'policy_blocked', 'executor_error', 'error'].includes(status)) return 'failure';
  if (/\b(failed|failure|timeout|blocked|errored)\b/i.test(event.summary)) return 'failure';
  return null;
}

function traceCategoryOption(category: TraceCategoryId): TraceCategoryOption {
  return TRACE_CATEGORY_OPTIONS.find((option) => option.id === category) ?? TRACE_CATEGORY_OPTIONS[TRACE_CATEGORY_OPTIONS.length - 1];
}

function traceCategoryLabel(category: TraceCategoryId): string {
  return traceCategoryOption(category).label;
}

function traceEventIcon(event: TraceEventRecord, category: TraceCategoryId): JSX.Element {
  const outcome = traceEventOutcome(event);
  if (outcome === 'success') return <CheckCircle2 size={13} />;
  if (outcome === 'failure') return <XCircle size={13} />;
  return traceCategoryIcon(category);
}

function traceCategoryIcon(category: TraceCategoryId): JSX.Element {
  if (category === 'agent_output') return <Sparkles size={13} />;
  if (category === 'reasoning') return <GitFork size={13} />;
  if (category === 'tools') return <Terminal size={13} />;
  if (category === 'vm_execution') return <Server size={13} />;
  if (category === 'hypotheses') return <Bug size={13} />;
  if (category === 'evidence') return <FileOutput size={13} />;
  if (category === 'verifier') return <ShieldCheck size={13} />;
  if (category === 'policy_scope') return <ShieldAlert size={13} />;
  if (category === 'code_navigation') return <Search size={13} />;
  if (category === 'failure_recovery') return <XCircle size={13} />;
  return <Square size={13} />;
}

function traceLabel(value: string): string {
  return value
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

function traceTypeLabel(value: string): string {
  return traceLabel(value);
}

function formatTraceTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatSessionTime(date);
}

function compactTracePayload(value: Record<string, unknown>): string {
  const text = JSON.stringify(value);
  if (!text) return '{}';
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function hostEnvironmentLabel(hostEnvironment: HostEnvironment | null): string {
  if (!hostEnvironment) return 'Host OS';
  if (hostEnvironment.osLabel) return hostEnvironment.osLabel;
  if (hostEnvironment.isWsl) return `WSL: ${hostEnvironment.remoteName ?? 'Linux'}`;
  if (hostEnvironment.platform === 'win32') return 'Windows';
  if (hostEnvironment.platform === 'darwin') return 'macOS';
  if (hostEnvironment.platform === 'linux') return 'Linux';
  return 'Host OS';
}

interface EnvironmentActivity {
  host: boolean;
  guest: boolean;
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

function vmTargetStatus(executor: ExecutorStatus | null): { configured: boolean; label: string; title: string } {
  const backend = executor?.backends.find((candidate) => candidate.available) ?? executor?.backends.find((candidate) => candidate.configured) ?? null;
  if (!backend) {
    return {
      configured: false,
      label: 'Not Setup',
      title: 'Local VM target is not configured'
    };
  }
  return {
    configured: true,
    label: backend.label,
    title: backend.available ? `${backend.label} is available` : `${backend.label} is configured but unavailable`
  };
}

function Modal({
  title,
  children,
  footer,
  onClose,
  wide = false
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  wide?: boolean;
}): JSX.Element {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={`modal-panel ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" title="Close" onClick={onClose}>
            <XCircle size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        <footer className="modal-footer">{footer}</footer>
      </section>
    </div>
  );
}

function TraceFilterModal({
  visibleCategories,
  onChange,
  onClose
}: {
  visibleCategories: TraceCategoryId[];
  onChange: (categories: TraceCategoryId[]) => void;
  onClose: () => void;
}): JSX.Element {
  const visibleSet = new Set(visibleCategories);
  const updateCategory = (category: TraceCategoryId, visible: boolean): void => {
    if (visible) {
      onChange(ALL_TRACE_CATEGORY_IDS.filter((candidate) => candidate === category || visibleSet.has(candidate)));
      return;
    }
    onChange(visibleCategories.filter((candidate) => candidate !== category));
  };

  return (
    <Modal
      title="Trace Filters"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modal-footer-leading" onClick={() => onChange(ALL_TRACE_CATEGORY_IDS)}>
            Select All
          </button>
          <button type="button" onClick={() => onChange([])}>
            Clear
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="trace-filter-grid">
        {TRACE_CATEGORY_OPTIONS.map((option) => {
          const active = visibleSet.has(option.id);
          return (
            <button type="button" className={`trace-filter-option ${active ? 'active' : ''}`} key={option.id} aria-pressed={active} onClick={() => updateCategory(option.id, !active)}>
              <span className={`trace-filter-icon category-${option.id}`}>{traceCategoryIcon(option.id)}</span>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <span className="trace-filter-state">{active ? 'Shown' : 'Hidden'}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function TraceInspector({ event }: { event: TraceEventRecord | null }): JSX.Element {
  if (!event) {
    return (
      <div className="inspector-empty-state">
        <span>Inspector</span>
        <p>Select a trace item to inspect its details.</p>
      </div>
    );
  }

  const category = traceCategoryForEvent(event);
  const payload = JSON.stringify(event.payload, null, 2);

  return (
    <div className="trace-inspector">
      <div className="trace-inspector-heading">
        <span>Inspector</span>
        <h3>Trace Detail</h3>
      </div>
      <div className="trace-inspector-summary">
        <span className={`trace-filter-icon category-${category}`}>{traceCategoryIcon(category)}</span>
        <div>
          <strong>{traceCategoryLabel(category)}</strong>
          <p>{event.summary}</p>
        </div>
      </div>
      <div className="trace-inspector-grid">
        <div>
          <span>Time</span>
          <strong>{formatSessionStart(new Date(event.createdAt))}</strong>
        </div>
        <div>
          <span>Event</span>
          <strong>{event.sequence}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>{traceLabel(event.source)}</strong>
        </div>
        <div>
          <span>Type</span>
          <strong>{traceTypeLabel(event.type)}</strong>
        </div>
        <div>
          <span>Model Visible</span>
          <strong>{event.modelVisible ? 'Yes' : 'No'}</strong>
        </div>
        <div>
          <span>Sensitivity</span>
          <strong>{traceLabel(event.sensitivity)}</strong>
        </div>
      </div>
      <div className="trace-inspector-links">
        <span>References</span>
        <InspectorReference label="id" value={event.id} />
        {event.attemptId ? <InspectorReference label="attempt" value={event.attemptId} /> : null}
        {event.vmContextId ? <InspectorReference label="vm" value={event.vmContextId} /> : null}
        {event.artifactId ? <InspectorReference label="artifact" value={event.artifactId} /> : null}
        {event.toolCallId ? <InspectorReference label="tool" value={event.toolCallId} /> : null}
        {event.approvalId ? <InspectorReference label="approval" value={event.approvalId} /> : null}
      </div>
      <div className="trace-inspector-payload">
        <span>Payload</span>
        <pre>{payload === '{}' ? 'No payload recorded.' : payload}</pre>
      </div>
    </div>
  );
}

function InspectorReference({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="trace-inspector-reference">
      <span>{label}:</span>
      <code>{value}</code>
    </div>
  );
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

function SettingsModal({
  section,
  openAiStatus,
  openAiOAuthResult,
  busy,
  onChangeSection,
  onClose,
  onRefreshOpenAi,
  onStartOpenAiOAuth
}: {
  section: SettingsSection;
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  busy: boolean;
  onChangeSection: (section: SettingsSection) => void;
  onClose: () => void;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
}): JSX.Element {
  return (
    <Modal
      title="Settings"
      wide
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="settings-layout">
        <nav className="settings-sections" aria-label="Settings sections">
          {(['general', 'providers'] as SettingsSection[]).map((item) => (
            <button type="button" className={section === item ? 'active' : ''} key={item} onClick={() => onChangeSection(item)}>
              {settingsSectionLabel(item)}
            </button>
          ))}
        </nav>
        <section className="settings-view">
          {section === 'general' ? (
            <div className="settings-page">
              <h3>General</h3>
            </div>
          ) : (
            <ProvidersSettingsView busy={busy} openAiOAuthResult={openAiOAuthResult} openAiStatus={openAiStatus} onRefreshOpenAi={onRefreshOpenAi} onStartOpenAiOAuth={onStartOpenAiOAuth} />
          )}
        </section>
      </div>
    </Modal>
  );
}

function ProvidersSettingsView({
  openAiStatus,
  openAiOAuthResult,
  busy,
  onRefreshOpenAi,
  onStartOpenAiOAuth
}: {
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  busy: boolean;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
}): JSX.Element {
  const readiness = openAiStatus?.readiness ?? 'not_configured';
  const authenticateLabel = readiness === 'oauth_ready' ? 'Re-authenticate' : 'Authenticate';
  const authenticate = (): void => {
    void onStartOpenAiOAuth();
  };
  const refresh = (): void => {
    void onRefreshOpenAi();
  };

  return (
    <div className="settings-page provider-settings-page">
      <div className="settings-page-header">
        <h3>Providers</h3>
        <button type="button" title="Refresh OpenAI provider status" disabled={busy} onClick={refresh}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <section className={`provider-card readiness-${stateClass(readiness)}`}>
        <div className="provider-heading">
          <div className="status-icon">
            <KeyRound size={18} />
          </div>
          <div>
            <h4>OpenAI</h4>
            <p>{openAiStatus?.label ?? 'Checking provider status'}</p>
          </div>
          <StatusPill status={readiness} />
        </div>

        <div className="provider-grid">
          <div>
            <span>Source</span>
            <strong>{openAiStatus?.source ?? 'unknown'}</strong>
          </div>
          <div>
            <span>Transport</span>
            <strong>{openAiStatus?.preferredTransport ?? 'sse_http'}</strong>
          </div>
          <div>
            <span>Model</span>
            <strong>{openAiStatus?.defaultModel ?? 'gpt-5.5'}</strong>
          </div>
          <div>
            <span>Boundary</span>
            <strong>{openAiStatus?.credentialsHostOnly ? 'host only' : 'review'}</strong>
          </div>
        </div>

        <p className="provider-detail">{openAiStatus?.statusDetail ?? 'OpenAI status has not loaded yet.'}</p>
        {openAiStatus?.credentialHint ? <p className="provider-detail muted">{openAiStatus.credentialHint}</p> : null}

        {openAiOAuthResult ? (
          <div className="provider-oauth-result">
            <strong>{openAiOAuthResult.detail}</strong>
            {openAiOAuthResult.verificationUri ? <code>{openAiOAuthResult.verificationUri}</code> : null}
            {openAiOAuthResult.userCode ? (
              <div>
                <span>Code</span>
                <code>{openAiOAuthResult.userCode}</code>
              </div>
            ) : null}
            {openAiOAuthResult.instructions && !openAiOAuthResult.verificationUri ? <pre>{openAiOAuthResult.instructions}</pre> : null}
          </div>
        ) : null}

        <div className="provider-actions">
          <button className="primary-button" type="button" disabled={busy || openAiStatus?.codexCliAvailable === false} onClick={authenticate}>
            <KeyRound size={15} />
            {authenticateLabel}
          </button>
          {openAiStatus?.setupCommand ? (
            <div className="command-row">
              <Terminal size={15} />
              <code>{openAiStatus.setupCommand}</code>
            </div>
          ) : null}
        </div>
      </section>
    </div>
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
              <option value="host_research_only">host_research_only</option>
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
            <option value="host_research_only">host_research_only</option>
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
  busy,
  runAction,
  onCancel,
  onStarted
}: {
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
  onCancel: () => void;
  onStarted: (runId: string) => void;
}): JSX.Element {
  const [input, setInput] = useState<StartRunInput>(() => ({
    ...defaultRunInput,
    networkProfile: snapshot.activeScope.networkProfile
  }));
  const [generatingPrompt, setGeneratingPrompt] = useState(false);

  useEffect(() => {
    setInput((current) => ({ ...current, networkProfile: snapshot.activeScope.networkProfile }));
  }, [snapshot.activeScope.networkProfile]);

  const update = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]): void => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const updateBudget = (key: keyof StartRunInput['budget'], value: number): void => {
    setInput((current) => ({ ...current, budget: { ...current.budget, [key]: value } }));
  };
  const minuteLimitValue = input.budget.maxMinutes >= UNBOUNDED_MINUTES ? '' : String(input.budget.maxMinutes);
  const openAiBlocked = input.runEngine === 'openai_responses' && !snapshot.openAi.configured;
  const canStart = input.promptMarkdown.trim().length > 0 && !openAiBlocked;
  const showGeneratePrompt = input.promptMarkdown.length === 0;

  const start = (): void => {
    void runAction(async () => {
      const next = await window.beale.startRun(input);
      const latestRunId = next.runs[0]?.run.id;
      if (latestRunId) onStarted(latestRunId);
      return next;
    });
  };

  const generatePrompt = (): void => {
    setGeneratingPrompt(true);
    void runAction(async () => {
      const generated = await window.beale.generateResearchPrompt();
      setInput((current) => ({ ...current, promptMarkdown: generated.promptMarkdown }));
    }).finally(() => setGeneratingPrompt(false));
  };

  return (
    <Modal
      title="New Research Session"
      wide
      onClose={onCancel}
      footer={
        <>
          {showGeneratePrompt ? (
            <button type="button" className="modal-footer-leading generate-prompt-button" disabled={busy || generatingPrompt} onClick={generatePrompt}>
              <Sparkles size={16} />
              {generatingPrompt ? 'Generating...' : 'Generate'}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="button" disabled={busy || !canStart} onClick={start}>
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
        <textarea
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
            <strong>{hypothesis.title}</strong>
            <p>{hypothesis.state} · priority {hypothesis.priorityScore.toFixed(2)} · {hypothesis.bugClass} · {hypothesis.component}</p>
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
            <strong>{finding.title}</strong>
            <p>
              {finding.state} · priority {finding.priorityScore.toFixed(2)}
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' }): JSX.Element {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function openAiFooterMessage(status: OpenAiAccountStatus | null): { tone: 'error' | 'info'; text: string } | null {
  if (!status || status.readiness === 'oauth_ready') return null;
  return {
    tone: 'error',
    text: 'Not authenticated with OpenAI. Authenticate by going to Settings > Providers.'
  };
}

function StatusPill({ status }: { status: string }): JSX.Element {
  return <span className={`status-pill status-${status}`}>{status}</span>;
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

type SessionHeat = 'none' | 'low' | 'medium' | 'high' | 'critical';

const SESSION_HEAT_LEVELS: SessionHeat[] = ['none', 'low', 'medium', 'high', 'critical'];
const SESSION_HEAT_IGNORED_STATES = new Set(['dismissed', 'duplicate', 'false_positive', 'false-positive', 'out_of_scope', 'out-of-scope']);

function sessionHeatForDetail(detail: RunDetail | null): SessionHeat {
  if (!detail) return 'none';

  const hypothesesById = new Map(detail.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));
  let heat: SessionHeat = 'none';

  for (const finding of detail.findings) {
    if (isIgnoredHeatState(finding.state)) continue;
    const hypothesis = finding.hypothesisId ? (hypothesesById.get(finding.hypothesisId) ?? null) : null;
    heat = maxSessionHeat(heat, sessionHeatForFinding(finding, hypothesis));
  }

  for (const hypothesis of detail.hypotheses) {
    if (isIgnoredHeatState(hypothesis.state)) continue;
    heat = maxSessionHeat(heat, sessionHeatForHypothesis(hypothesis));
  }

  return heat;
}

function sessionHeatForFinding(finding: FindingRecord, hypothesis: HypothesisRecord | null): SessionHeat {
  const impactScore = hypothesis ? heatFactorFromText(hypothesis.impact) : heatImpactFromText(`${finding.title}\n${finding.summaryMarkdown}\n${finding.impactMarkdown}`);
  const reachabilityScore = hypothesis ? heatFactorFromText(hypothesis.attackerReachability) : 1;
  const baseHeat = maxSessionHeat(sessionHeatFromImpact(impactScore, reachabilityScore), sessionHeatFromPriority(finding.priorityScore));
  return gateSessionHeat(baseHeat, findingEvidenceScore(finding, hypothesis));
}

function sessionHeatForHypothesis(hypothesis: HypothesisRecord): SessionHeat {
  const impactScore = heatFactorFromText(hypothesis.impact);
  const reachabilityScore = heatFactorFromText(hypothesis.attackerReachability);
  const baseHeat = maxSessionHeat(sessionHeatFromImpact(impactScore, reachabilityScore), sessionHeatFromPriority(hypothesis.priorityScore));
  return gateSessionHeat(baseHeat, hypothesisEvidenceScore(hypothesis));
}

function findingEvidenceScore(finding: FindingRecord, hypothesis: HypothesisRecord | null): number {
  const state = stateClass(finding.state);
  if (finding.verifiedByVerifierRunId || state === 'verified') return 3;
  if (state === 'reproduced' || state === 'promoted') return Math.max(2, hypothesis ? hypothesisEvidenceScore(hypothesis) : 2);
  if (state === 'needs_evidence' || state === 'needs-evidence') return hypothesis ? Math.max(1, hypothesisEvidenceScore(hypothesis)) : 1;
  return hypothesis ? hypothesisEvidenceScore(hypothesis) : 1;
}

function hypothesisEvidenceScore(hypothesis: HypothesisRecord): number {
  const state = stateClass(hypothesis.state);
  if (state === 'verified') return 3;
  if (state === 'promoted' || state === 'reproduced') return Math.max(2, heatFactorFromText(hypothesis.evidenceConfidence));
  return heatFactorFromText(hypothesis.evidenceConfidence);
}

function gateSessionHeat(heat: SessionHeat, evidenceScore: number): SessionHeat {
  if (heat === 'none') return 'none';
  if (evidenceScore <= 0) return 'low';
  if (evidenceScore === 1) return minSessionHeat(heat, 'medium');
  if (evidenceScore === 2) return minSessionHeat(heat, 'high');
  return heat;
}

function sessionHeatFromImpact(impactScore: number, reachabilityScore: number): SessionHeat {
  if (impactScore >= 4 && reachabilityScore >= 3) return 'critical';
  if (impactScore >= 4 || (impactScore >= 3 && reachabilityScore >= 3)) return 'high';
  if (impactScore >= 2) return 'medium';
  if (impactScore >= 1) return 'low';
  return 'none';
}

function sessionHeatFromPriority(priorityScore: number): SessionHeat {
  if (priorityScore >= 42) return 'critical';
  if (priorityScore >= 24) return 'high';
  if (priorityScore >= 10) return 'medium';
  if (priorityScore > 0) return 'low';
  return 'none';
}

function maxSessionHeat(left: SessionHeat, right: SessionHeat): SessionHeat {
  return SESSION_HEAT_LEVELS[Math.max(SESSION_HEAT_LEVELS.indexOf(left), SESSION_HEAT_LEVELS.indexOf(right))];
}

function minSessionHeat(left: SessionHeat, right: SessionHeat): SessionHeat {
  return SESSION_HEAT_LEVELS[Math.min(SESSION_HEAT_LEVELS.indexOf(left), SESSION_HEAT_LEVELS.indexOf(right))];
}

function isIgnoredHeatState(state: string): boolean {
  return SESSION_HEAT_IGNORED_STATES.has(stateClass(state));
}

function heatFactorFromText(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return Math.max(0, Math.min(4, parsed));
  const lower = value.toLowerCase();
  if (lower.includes('critical') || lower.includes('compromise') || lower.includes('code execution') || lower.includes('privilege escalation')) return 4;
  if (lower.includes('verified') || lower.includes('verifier')) return 3;
  if (lower.includes('dynamic') || lower.includes('reproduced') || lower.includes('controlled')) return 2;
  if (lower.includes('static') || lower.includes('tool-backed') || lower.includes('plausible') || lower.includes('lead')) return 1;
  if (lower.includes('hypothesis only') || lower.includes('out_of_scope') || lower.includes('out-of-scope') || lower.includes('none')) return 0;
  return 1;
}

function heatImpactFromText(value: string): number {
  const lower = value.toLowerCase();
  if (/\b(rce|remote code execution|code execution|sandbox escape|privilege escalation|credential compromise|cross-tenant|critical compromise)\b/.test(lower)) return 4;
  if (/\b(authorization bypass|data integrity|sensitive data|service compromise|account takeover|tenant)\b/.test(lower)) return 3;
  if (/\b(denial of service|dos|limited data exposure|limited exposure|integrity violation)\b/.test(lower)) return 2;
  if (/\b(crash|info leak|information leak|limited impact)\b/.test(lower)) return 1;
  return 1;
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

function extendBudgetLimit(value: unknown, unboundedValue: number, step: number): number {
  const current = budgetNumber(value, unboundedValue);
  return current >= unboundedValue ? unboundedValue : current + step;
}

function networkProfileLabel(profile: string): string {
  if (profile === 'offline') return 'Offline';
  if (profile === 'scoped') return 'Scoped';
  if (profile === 'elevated') return 'Elevated';
  return profile;
}

function stateClass(state: string): string {
  return state.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value * 100)}%`;
}

function shortDate(value: string): string {
  return value.slice(0, 10);
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

function settingsSectionLabel(section: SettingsSection): string {
  switch (section) {
    case 'general':
      return 'General';
    case 'providers':
      return 'Providers';
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
      networkProfile: 'scoped',
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
    networkProfile: 'scoped',
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
