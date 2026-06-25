import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Play, ShieldAlert } from 'lucide-react';
import type { ExecutorStatus, StartRunInput, VmPreference, WorkspaceSnapshot } from '@shared/types';
import { Modal } from '../../app/Modal';
import { networkProfileLabel } from '../../lib/formatting';
import { findBackendByKind } from '../../view-models/environmentDisplay';
import {
  defaultRunInput,
  optionalPositiveInteger,
  UNBOUNDED_MINUTES
} from '../../view-models/runSettings';

const NETWORK_PROFILE_OPTIONS = ['offline', 'scoped', 'elevated'] as const;

type StartRunFieldUpdater = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]) => void;
type StartRunBudgetUpdater = (key: keyof StartRunInput['budget'], value: number) => void;

export function StartRunForm({
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
  const [startingRun, setStartingRun] = useState(false);

  useEffect(() => {
    setInput((current) => {
      return { ...current, networkProfile: 'elevated', sandboxProfile };
    });
  }, [sandboxProfile, snapshot.activeScope.id]);

  const update = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]): void => {
    setInput((current) => {
      return { ...current, [key]: value };
    });
  };

  const updateBudget = (key: keyof StartRunInput['budget'], value: number): void => {
    setInput((current) => {
      return { ...current, budget: { ...current.budget, [key]: value } };
    });
  };
  const minuteLimitValue = input.budget.maxMinutes >= UNBOUNDED_MINUTES ? '' : String(input.budget.maxMinutes);
  const openAiBlocked = input.runEngine === 'openai_responses' && !snapshot.openAi.configured;
  const hasPromptDraft = input.promptMarkdown.trim().length > 0;
  const canStart = hasPromptDraft && !openAiBlocked;

  const startWithInput = (startInput: StartRunInput): void => {
    if (startingRun) return;
    setStartingRun(true);
    void runAction(async () => {
      const next = await window.beale.startRun(startInput);
      const latestRunId = next.runs[0]?.run.id;
      if (latestRunId) onStarted(latestRunId);
      return next;
    }).finally(() => setStartingRun(false));
  };

  const start = (): void => {
    startWithInput(input);
  };

  const closeModal = (): void => {
    onCancel();
  };

  return (
    <Modal
      title="New Research"
      wide
      onClose={closeModal}
      footer={
        <>
          <button type="button" disabled={busy} onClick={closeModal}>
            Nevermind
          </button>
          <button className="primary-button" type="button" disabled={busy || startingRun || !canStart} onClick={start}>
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
            Commands and executables will run on this host machine. A disposable sandbox is recommended, and a virtual machine is preferred for high-risk target execution.
          </div>
        ) : null}
        <textarea
          className="prompt-box"
          rows={6}
          placeholder="Describe the research objective, scope constraints, and evidence requirements."
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
          <SessionSettingsFields input={input} minuteLimitValue={minuteLimitValue} onUpdate={update} onUpdateBudget={updateBudget} />
        </details>
      </div>
    </Modal>
  );
}

export function SessionSettingsFields({
  input,
  minuteLimitValue,
  onUpdate,
  onUpdateBudget
}: {
  input: StartRunInput;
  minuteLimitValue: string;
  onUpdate: StartRunFieldUpdater;
  onUpdateBudget: StartRunBudgetUpdater;
}): JSX.Element {
  return (
    <div className="form-grid">
      <label>
        Minutes
        <input
          type="number"
          min={1}
          placeholder="Unlimited"
          value={minuteLimitValue}
          onChange={(event) => onUpdateBudget('maxMinutes', optionalPositiveInteger(event.target.value, UNBOUNDED_MINUTES))}
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
        <input value={input.model} onChange={(event) => onUpdate('model', event.target.value)} />
      </label>
      <label>
        Reasoning
        <input value={input.reasoningEffort} onChange={(event) => onUpdate('reasoningEffort', event.target.value)} />
      </label>
    </div>
  );
}

export function preferredSandboxProfile(executor: ExecutorStatus | null, vmPreference: VmPreference): string {
  const selectedBackend = findBackendByKind(executor, vmPreference.backendKind);
  return vmPreference.enabled && selectedBackend?.available && executor?.available === true ? 'local_disposable_vm' : 'host_research_only';
}
