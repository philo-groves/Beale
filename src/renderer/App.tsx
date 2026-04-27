import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  Archive,
  Ban,
  Bug,
  CheckCircle2,
  Database,
  EyeOff,
  FileText,
  FolderOpen,
  FolderPlus,
  GitFork,
  Network,
  Pause,
  Play,
  RotateCw,
  Save,
  Search,
  ShieldAlert,
  Square,
  XCircle
} from 'lucide-react';
import type {
  ArtifactRecord,
  FakeScenario,
  HypothesisRecord,
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
            <p className="eyebrow">Milestone 1</p>
            <h2>Workbench Skeleton</h2>
          </div>
          <div className="header-stats">
            <Stat label="Runs" value={String(snapshot.runs.length)} />
            <Stat label="Scope Assets" value={String(snapshot.activeScope.assets.length)} />
            <Stat label="Engine" value="Fake" tone="warning" />
          </div>
        </div>

        <div className="workspace-grid">
          <ScopeEditor snapshot={snapshot} busy={busy} runAction={runAction} />
          <section className="center-column">
            <StartRunForm snapshot={snapshot} busy={busy} runAction={runAction} onStarted={setSelectedRunId} />
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
        <button className="primary-button" type="button" disabled={busy || !input.promptMarkdown.trim()} onClick={start}>
          <Play size={16} />
          Start
        </button>
      </div>
      <textarea className="prompt-box" rows={6} value={input.promptMarkdown} onChange={(event) => update('promptMarkdown', event.target.value)} />
      <div className="start-grid">
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
        <FindingPanel detail={detail} />
        <VmPolicyPanel detail={detail} />
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
  onDismiss,
  onOutOfScope
}: {
  hypotheses: HypothesisRecord[];
  disabled: boolean;
  onDismiss: (hypothesis: HypothesisRecord) => void;
  onOutOfScope: (hypothesis: HypothesisRecord) => void;
}): JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-title">
        <Bug size={16} />
        <h4>Hypotheses</h4>
      </div>
      {hypotheses.length === 0 ? <div className="empty-state">No hypotheses.</div> : null}
      {hypotheses.map((hypothesis) => (
        <div className="entity-row" key={hypothesis.id}>
          <div>
            <strong>{hypothesis.title}</strong>
            <p>{hypothesis.state} · {hypothesis.bugClass} · {hypothesis.component}</p>
          </div>
          <div className="entity-actions">
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

function FindingPanel({ detail }: { detail: RunDetail }): JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-title">
        <FileText size={16} />
        <h4>Findings</h4>
      </div>
      {detail.findings.length === 0 ? <div className="empty-state">No findings.</div> : null}
      {detail.findings.map((finding) => (
        <div className="entity-row" key={finding.id}>
          <div>
            <strong>{finding.title}</strong>
            <p>{finding.state} · priority {finding.priorityScore.toFixed(2)}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

function VmPolicyPanel({ detail }: { detail: RunDetail }): JSX.Element {
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
            <p>{vm.state} · {vm.networkProfile}</p>
          </div>
        </div>
      ))}
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

function StatusPill({ status }: { status: string }): JSX.Element {
  return <span className={`status-pill status-${status}`}>{status}</span>;
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
