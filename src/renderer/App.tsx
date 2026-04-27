import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  Archive,
  Ban,
  Bug,
  CheckCircle2,
  Database,
  EyeOff,
  FileArchive,
  FileText,
  FolderOpen,
  FolderPlus,
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
  RotateCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  XCircle
} from 'lucide-react';
import type {
  ArtifactRecord,
  BenchmarkOverview,
  BenchmarkSuiteKind,
  ExportRecord,
  FakeScenario,
  FindingRecord,
  HypothesisRecord,
  OpenAiAccountStatus,
  PriorityFactorInput,
  ProgramScopeDraft,
  ProgramScopeVersion,
  RunDetail,
  RunRow,
  ScopeAssetDirection,
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

const defaultRunInput: StartRunInput = {
  runEngine: 'fake',
  promptMarkdown: '# Open discovery\nMap the scoped target, identify promising attack surfaces, and collect verifier-backed evidence where possible.',
  mode: 'open_discovery',
  attemptStrategy: 'adaptive_portfolio',
  model: 'gpt-5.5',
  reasoningEffort: 'xhigh',
  networkProfile: 'offline',
  sandboxProfile: 'local_disposable_vm',
  budget: {
    maxMinutes: 45,
    maxAttempts: 2,
    maxCostUsd: 0
  },
  fakeScenario: 'adaptive_portfolio'
};

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSnapshot = useCallback(async () => {
    const next = await window.beale.getSnapshot();
    setSnapshot(next);
    if (next?.runs[0] && !selectedRunId) {
      setSelectedRunId(next.runs[0].run.id);
    }
  }, [selectedRunId]);

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
      .getSnapshot()
      .then((initial) => {
        setSnapshot(initial);
        if (initial?.runs[0]) setSelectedRunId(initial.runs[0].run.id);
      })
      .catch((caught: unknown) => setError(errorMessage(caught)));

    return window.beale.onSnapshot((next) => {
      setSnapshot(next);
      setSelectedRunId((current) => current ?? next.runs[0]?.run.id ?? null);
    });
  }, []);

  useEffect(() => {
    loadRunDetail(selectedRunId).catch((caught: unknown) => setError(errorMessage(caught)));
  }, [loadRunDetail, selectedRunId, snapshot]);

  const runAction = useCallback(
    async (action: () => Promise<WorkspaceSnapshot | null | void>) => {
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        if (next) setSnapshot(next);
        await loadSnapshot();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [loadSnapshot]
  );

  if (!snapshot) {
    return <WorkspaceGate busy={busy} error={error} runAction={runAction} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">B</div>
          <div>
            <h1>Beale</h1>
            <p>Research workbench</p>
          </div>
        </div>
        <div className="workspace-meta">
          <div className="meta-label">Workspace</div>
          <div className="path-text">{snapshot.workspace.workspacePath}</div>
          <div className="meta-row">
            <Database size={15} />
            <span>.beale/beale.sqlite</span>
          </div>
          <div className="meta-row warning">
            <ShieldAlert size={15} />
            <span>{snapshot.workspace.fakeExecutorLabel}</span>
          </div>
          <div className={`meta-row ${snapshot.openAi.readiness === 'oauth_ready' ? '' : 'warning'}`}>
            <Network size={15} />
            <span>{snapshot.openAi.label}</span>
          </div>
          <div className={`meta-row ${snapshot.executor.available ? '' : 'warning'}`}>
            <ShieldAlert size={15} />
            <span>{snapshot.executor.label}</span>
          </div>
        </div>
        <div className="sidebar-section">
          <div className="meta-label">Active Scope</div>
          <strong>{snapshot.activeScope.programName}</strong>
          <span>Version {snapshot.activeScope.version}</span>
          <span>{snapshot.activeScope.networkProfile}</span>
        </div>
        {error ? <div className="error-box">{error}</div> : null}
      </aside>

      <main className="workbench">
        <div className="workbench-header">
          <div>
            <p className="eyebrow">Milestone 7</p>
            <h2>Beta Hardening</h2>
          </div>
          <div className="header-stats">
            <Stat label="Runs" value={String(snapshot.runs.length)} />
            <Stat label="Scope Assets" value={String(snapshot.activeScope.assets.length)} />
            <Stat
              label="Recovery"
              value={snapshot.recovery.interruptedRuns + snapshot.recovery.interruptedVmContexts > 0 ? 'Review' : 'Clean'}
              tone={snapshot.recovery.interruptedRuns + snapshot.recovery.interruptedVmContexts > 0 ? 'warning' : undefined}
            />
            <Stat label="Benchmarks" value={snapshot.benchmark.latestRun ? `${snapshot.benchmark.latestRun.identity.passCount}/${snapshot.benchmark.latestRun.identity.totalCount}` : 'None'} />
            <Stat label="OpenAI" value={openAiStatusLabel(snapshot.openAi)} tone={snapshot.openAi.readiness === 'oauth_ready' ? undefined : 'warning'} />
            <Stat label="Executor" value={snapshot.executor.available ? snapshot.executor.provider : 'Unavailable'} tone={snapshot.executor.available ? undefined : 'warning'} />
          </div>
        </div>

        <div className="workspace-grid">
          <ScopeEditor snapshot={snapshot} busy={busy} runAction={runAction} />
          <section className="center-column">
            <OpenAiAccountPanel snapshot={snapshot} busy={busy} runAction={runAction} />
            <StartRunForm snapshot={snapshot} busy={busy} runAction={runAction} onStarted={setSelectedRunId} />
            <HardeningPanel snapshot={snapshot} busy={busy} runAction={runAction} />
            <BenchmarkPanel benchmark={snapshot.benchmark} busy={busy} runAction={runAction} />
            <RunTracker runs={snapshot.runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
          </section>
          <RunDetailView detail={runDetail} busy={busy} runAction={runAction} />
        </div>
      </main>
    </div>
  );
}

function WorkspaceGate({
  busy,
  error,
  runAction
}: {
  busy: boolean;
  error: string | null;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const [path, setPath] = useState('');

  const choose = (mode: 'open' | 'create'): void => {
    void runAction(async () => {
      const result = await window.beale.selectWorkspace(mode);
      if (result.canceled || !result.path) return null;
      return mode === 'create' ? window.beale.createWorkspace(result.path) : window.beale.openWorkspace(result.path);
    });
  };

  const openManual = (mode: 'open' | 'create'): void => {
    if (!path.trim()) return;
    void runAction(() => (mode === 'create' ? window.beale.createWorkspace(path.trim()) : window.beale.openWorkspace(path.trim())));
  };

  return (
    <div className="workspace-gate">
      <div className="gate-panel">
        <div className="brand-block">
          <div className="brand-mark">B</div>
          <div>
            <h1>Beale</h1>
            <p>Authorized vulnerability research workbench</p>
          </div>
        </div>
        <div className="gate-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={() => choose('create')}>
            <FolderPlus size={17} />
            Create Workspace
          </button>
          <button type="button" disabled={busy} onClick={() => choose('open')}>
            <FolderOpen size={17} />
            Open Workspace
          </button>
        </div>
        <label className="field-label" htmlFor="workspace-path">
          Workspace path
        </label>
        <div className="inline-form">
          <input id="workspace-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/path/to/program-workspace" />
          <button type="button" disabled={busy || !path.trim()} onClick={() => openManual('open')}>
            <FolderOpen size={16} />
            Open
          </button>
          <button type="button" disabled={busy || !path.trim()} onClick={() => openManual('create')}>
            <FolderPlus size={16} />
            Create
          </button>
        </div>
        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </div>
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
          Organization
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
            <option value="scoped_public">scoped_public</option>
            <option value="host_research_only">host_research_only</option>
          </select>
        </label>
        <label>
          Review date
          <input type="date" value={form.expiresAt} onChange={(event) => update('expiresAt', event.target.value)} />
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
        Rules
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
  onStarted
}: {
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
  onStarted: (runId: string) => void;
}): JSX.Element {
  const [input, setInput] = useState<StartRunInput>(() => ({
    ...defaultRunInput,
    networkProfile: snapshot.activeScope.networkProfile
  }));

  useEffect(() => {
    setInput((current) => ({ ...current, networkProfile: snapshot.activeScope.networkProfile }));
  }, [snapshot.activeScope.networkProfile]);

  const update = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]): void => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const updateBudget = (key: keyof StartRunInput['budget'], value: number): void => {
    setInput((current) => ({ ...current, budget: { ...current.budget, [key]: value } }));
  };
  const openAiBlocked = input.runEngine === 'openai_responses' && !snapshot.openAi.configured;

  const start = (): void => {
    void runAction(async () => {
      const next = await window.beale.startRun(input);
      const latestRunId = next.runs[0]?.run.id;
      if (latestRunId) onStarted(latestRunId);
      return next;
    });
  };

  return (
    <section className="panel start-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Run</p>
          <h3>Start Research</h3>
        </div>
        <button className="primary-button" type="button" disabled={busy || !input.promptMarkdown.trim() || openAiBlocked} onClick={start}>
          <Play size={16} />
          Start
        </button>
      </div>
      {input.runEngine === 'openai_responses' && snapshot.openAi.readiness !== 'oauth_ready' ? (
        <div className="policy-line">
          <ShieldAlert size={15} />
          {snapshot.openAi.userAction ?? snapshot.openAi.statusDetail}
        </div>
      ) : null}
      <textarea className="prompt-box" rows={6} value={input.promptMarkdown} onChange={(event) => update('promptMarkdown', event.target.value)} />
      <div className="start-grid">
        <label>
          Engine
          <select value={input.runEngine} onChange={(event) => update('runEngine', event.target.value as StartRunInput['runEngine'])}>
            <option value="fake">fake</option>
            <option value="openai_responses">openai_responses</option>
            <option value="executor_alpha">executor_alpha</option>
          </select>
        </label>
        <label>
          Mode
          <select value={input.mode} onChange={(event) => update('mode', event.target.value)}>
            <option value="open_discovery">open_discovery</option>
            <option value="targeted_reproduction">targeted_reproduction</option>
            <option value="patch_validation">patch_validation</option>
            <option value="variant_analysis">variant_analysis</option>
          </select>
        </label>
        <label>
          Strategy
          <select value={input.attemptStrategy} onChange={(event) => update('attemptStrategy', event.target.value)}>
            <option value="adaptive_portfolio">adaptive_portfolio</option>
            <option value="single_path">single_path</option>
            <option value="reproduction_first">reproduction_first</option>
          </select>
        </label>
        <label>
          Fake scenario
          <select value={input.fakeScenario} onChange={(event) => update('fakeScenario', event.target.value as FakeScenario)}>
            <option value="adaptive_portfolio">adaptive_portfolio</option>
            <option value="source_logic_bug">source_logic_bug</option>
            <option value="memory_corruption">memory_corruption</option>
            <option value="policy_block">policy_block</option>
            <option value="verified_finding">verified_finding</option>
          </select>
        </label>
        <label>
          Model
          <input value={input.model} onChange={(event) => update('model', event.target.value)} />
        </label>
        <label>
          Reasoning
          <input value={input.reasoningEffort} onChange={(event) => update('reasoningEffort', event.target.value)} />
        </label>
        <label>
          Network
          <input value={input.networkProfile} onChange={(event) => update('networkProfile', event.target.value)} />
        </label>
        <label>
          Sandbox
          <input value={input.sandboxProfile} onChange={(event) => update('sandboxProfile', event.target.value)} />
        </label>
        <label>
          Minutes
          <input type="number" min={1} value={input.budget.maxMinutes} onChange={(event) => updateBudget('maxMinutes', Number(event.target.value))} />
        </label>
        <label>
          Attempts
          <input type="number" min={1} value={input.budget.maxAttempts} onChange={(event) => updateBudget('maxAttempts', Number(event.target.value))} />
        </label>
      </div>
    </section>
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
          <p className="eyebrow">Tracker</p>
          <h3>Runs</h3>
        </div>
      </div>
      <div className="run-list">
        {runs.length === 0 ? (
          <div className="empty-state">No runs yet.</div>
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
        <div className="empty-state">Select a run.</div>
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
        <ArtifactPanel
          artifacts={detail.artifacts}
          disabled={busy}
          onPromote={(artifact) => steer({ type: 'promote_artifact', runId: detail.run.id, artifactId: artifact.id })}
          onSensitive={(artifact) => steer({ type: 'mark_artifact_sensitive', runId: detail.run.id, artifactId: artifact.id })}
        />
        <VerifierPanel
          detail={detail}
          disabled={busy}
          onRerun={(contractId) => steer({ type: 'rerun_verifier', runId: detail.run.id, verifierContractId: contractId })}
        />
        <ModelSessionPanel detail={detail} />
        <FindingPanel
          detail={detail}
          disabled={busy}
          onPatchValidation={(finding) => steer({ type: 'request_patch_validation', runId: detail.run.id, findingId: finding.id })}
          onFalsePositive={(finding) => steer({ type: 'mark_finding_false_positive', runId: detail.run.id, findingId: finding.id })}
          onOutOfScope={(finding) => steer({ type: 'mark_finding_out_of_scope', runId: detail.run.id, findingId: finding.id })}
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
        />
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
        <button type="button" disabled={busy || !firstHypothesis} onClick={() => firstHypothesis && steer({ type: 'mark_hypothesis_out_of_scope', runId: detail.run.id, hypothesisId: firstHypothesis.id })}>
          <Ban size={15} />
          Mark Out of Scope
        </button>
      </div>
    </section>
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
  onRerun
}: {
  detail: RunDetail;
  disabled: boolean;
  onRerun: (contractId: string) => void;
}): JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-title">
        <CheckCircle2 size={16} />
        <h4>Verifiers</h4>
      </div>
      {detail.verifierContracts.length === 0 ? <div className="empty-state">No verifiers.</div> : null}
      {detail.verifierContracts.map((contract) => {
        const latest = [...detail.verifierRuns].reverse().find((run) => run.contractId === contract.id);
        return (
          <div className="entity-row" key={contract.id}>
            <div>
              <strong>{contract.mode}</strong>
              <p>{latest?.status ?? contract.status} · {contract.id}</p>
            </div>
            <div className="entity-actions">
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
  onOutOfScope
}: {
  detail: RunDetail;
  disabled: boolean;
  onPatchValidation: (finding: FindingRecord) => void;
  onFalsePositive: (finding: FindingRecord) => void;
  onOutOfScope: (finding: FindingRecord) => void;
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
  onReview
}: {
  detail: RunDetail;
  disabled: boolean;
  onReview: (
    requestKind: 'network_profile_change' | 'credential_injection' | 'host_action' | 'scope_change',
    decision: 'approved' | 'denied',
    requestedAction: Record<string, unknown>
  ) => void;
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
            title="Deny credential injection"
            disabled={disabled}
            onClick={() => onReview('credential_injection', 'denied', { runId: detail.run.id, credentialsHostOnly: true })}
          >
            <Ban size={14} />
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
    expiresAt: form.expiresAt || null,
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
