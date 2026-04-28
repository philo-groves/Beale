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
  CheckCircle2,
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
  Upload,
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
  ScopeAssetDirection,
  ScopeAssetInput,
  ScopeAssetKind,
  StartRunInput,
  TraceEventRecord,
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
    maxAttempts: UNBOUNDED_ATTEMPTS,
    maxCostUsd: 0
  },
  fakeScenario: 'adaptive_portfolio'
};

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
  const [openProgramMenuId, setOpenProgramMenuId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  const loadRunDetail = useCallback(async (runId: string | null) => {
    if (!runId) {
      setRunDetail(null);
      return;
    }
    const detail = await window.beale.getRunDetail(runId);
    setRunDetail(detail);
  }, []);

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
    loadRunDetail(selectedRunId).catch((caught: unknown) => setError(errorMessage(caught)));
  }, [loadRunDetail, selectedRunId, snapshot]);

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
  }, [openProgramMenuId, programInfo, programRegistry]);

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

  return (
    <div className={appShellClassName} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        inspectorOpen={inspectorOpen}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onToggleInspector={() => setInspectorOpen((current) => !current)}
        onOpenSettings={() => setSettingsOpen(true)}
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
                {sessions.length > 0 ? (
                  <div className="program-session-list">
                    {sessions.map((session) => (
                      <button
                        type="button"
                        className={`program-session-item ${selectedRunId === session.runId ? 'active' : ''}`}
                        title={promptSessionTitle(session)}
                        key={session.id}
                        onClick={() => openResearchSession(program, session)}
                      >
                        <span className="program-session-title">{promptSessionTitle(session)}</span>
                        <span className="program-session-age">{shortRelativeAge(session.updatedAt)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
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

      <main className="workbench">
        <div className="workbench-header">
          <span className="workbench-title">{snapshot?.activeScope.programName ?? 'No Program Selected'}</span>
          <SessionStartTime detail={runDetail && runDetail.run.id === selectedRunId ? runDetail : null} />
        </div>
        <div className="workspace-page">
          <MainSessionWorkspace detail={runDetail && runDetail.run.id === selectedRunId ? runDetail : null} selectedRunId={selectedRunId} />
        </div>
      </main>
      <aside className="inspector-sidebar" aria-label="Inspector" aria-hidden={!inspectorOpen} inert={!inspectorOpen}>
        <div className="inspector-empty-state">
          <span>Inspector</span>
          <p>No inspector content.</p>
        </div>
      </aside>
      <StatusBar
        hostEnvironment={snapshot?.workspace.hostEnvironment ?? hostEnvironment}
        executor={snapshot?.executor ?? null}
        message={statusMessage ?? openAiFooterMessage(snapshot?.openAi ?? openAiStatus)}
        onConfigureVm={() => {
          setSettingsSection('general');
          setSettingsOpen(true);
        }}
      />
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
      {programInfo ? <ProgramInformationModal program={programInfo} onClose={() => setProgramInfo(null)} /> : null}
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
  onToggleSidebar,
  onToggleInspector
}: {
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
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
        <button type="button" title="Export">
          <Upload size={14} />
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
  message,
  onConfigureVm
}: {
  hostEnvironment: HostEnvironment | null;
  executor: ExecutorStatus | null;
  message: { tone: 'error' | 'info'; text: string } | null;
  onConfigureVm: () => void;
}): JSX.Element {
  const osLabel = hostEnvironmentLabel(hostEnvironment);
  const vmTarget = vmTargetStatus(executor);

  return (
    <footer className="status-bar">
      <div className="environment-switcher" aria-label="Environment target">
        <div className="environment-pill" title={`Host operating system: ${osLabel}`}>
          <Monitor size={14} />
          <span>{osLabel}</span>
        </div>
        <ArrowRight className="environment-arrow" size={14} aria-hidden="true" />
        <div className={`environment-pill environment-vm-pill ${vmTarget.configured ? 'is-configured' : 'is-unconfigured'}`} title={vmTarget.title}>
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
      <button type="button" className="notification-button" title="Notifications">
        <Bell size={15} />
      </button>
    </footer>
  );
}

function SessionStartTime({ detail }: { detail: RunDetail | null }): JSX.Element | null {
  if (!detail) return null;
  const startAt = detail.run.startedAt ?? detail.run.createdAt;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;

  return (
    <div className="session-start-time" title={startAt}>
      <span>{formatSessionStart(start)}</span>
    </div>
  );
}

function formatSessionStart(date: Date): string {
  return `${SESSION_MONTHS[date.getMonth()]} ${date.getDate()}, ${formatSessionTime(date)}`;
}

function formatSessionTime(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? 'a' : 'p';
  return `${hour12}:${minutes}${suffix}`;
}

const SESSION_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MainSessionWorkspace({ detail, selectedRunId }: { detail: RunDetail | null; selectedRunId: string | null }): JSX.Element | null {
  if (!selectedRunId) return null;

  return (
    <div className="main-session-grid">
      <MainTraceView detail={detail} selectedRunId={selectedRunId} />
      <MainHypothesisList detail={detail} />
    </div>
  );
}

function MainTraceView({ detail, selectedRunId }: { detail: RunDetail | null; selectedRunId: string | null }): JSX.Element | null {
  const loading = !detail;
  const events = detail?.traceEvents ?? [];
  const latestEventId = events.at(-1)?.id ?? '';
  const traceListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const traceList = traceListRef.current;
    if (!traceList) return;
    traceList.scrollTop = traceList.scrollHeight;
  }, [events.length, latestEventId, selectedRunId]);

  if (!selectedRunId) return null;

  return (
    <section className="main-trace-view" aria-label="Agent trace">
      {loading ? <div className="main-trace-empty">Loading trace.</div> : null}
      {!loading && events.length === 0 ? <div className="main-trace-empty">No trace events recorded.</div> : null}
      {!loading && events.length > 0 ? (
        <div className="main-trace-list" ref={traceListRef}>
          {events.map((event) => (
            <MainTraceEvent event={event} key={event.id} />
          ))}
        </div>
      ) : null}
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

function MainTraceEvent({ event }: { event: TraceEventRecord }): JSX.Element {
  const payload = compactTracePayload(event.payload);
  const hasPayload = payload !== '{}';
  return (
    <article className={`main-trace-event source-${event.source} type-${event.type}`}>
      <time className="main-trace-time" dateTime={event.createdAt}>
        {formatTraceTimestamp(event.createdAt)}
      </time>
      <div className="main-trace-marker" aria-hidden="true">
        <span>{traceEventIcon(event)}</span>
      </div>
      <div className="main-trace-event-body">
        <div className="main-trace-line">
          <strong>{event.summary}</strong>
          <div className="main-trace-badges">
            <span>{traceTypeLabel(event.type)}</span>
            {!event.modelVisible ? <span>Hidden</span> : null}
          </div>
        </div>
        <div className="main-trace-context">
          <span>Event {event.sequence}</span>
          <span>{traceLabel(event.source)}</span>
          {hasPayload ? <code>{payload}</code> : null}
        </div>
      </div>
    </article>
  );
}

function traceEventIcon(event: TraceEventRecord): JSX.Element {
  if (event.type === 'artifact_created') return <FileOutput size={12} />;
  if (event.type === 'network_event') return <Network size={12} />;
  if (event.type === 'approval_event' || event.source === 'policy') return <ShieldAlert size={12} />;
  if (event.type === 'verifier_result' || event.source === 'verifier') return <ShieldCheck size={12} />;
  if (event.source === 'model') return <Sparkles size={12} />;
  if (event.source === 'tool') return <Terminal size={12} />;
  if (event.source === 'user') return <Edit3 size={12} />;
  return <Search size={12} />;
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
  const attemptLimitValue = input.budget.maxAttempts >= UNBOUNDED_ATTEMPTS ? '' : String(input.budget.maxAttempts);
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
              Attempts
              <input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={attemptLimitValue}
                onChange={(event) => updateBudget('maxAttempts', optionalPositiveInteger(event.target.value, UNBOUNDED_ATTEMPTS))}
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
