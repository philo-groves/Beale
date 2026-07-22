import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Play, ShieldAlert } from 'lucide-react';
import type { OpenAiAccountStatus, ResearchProviderId, ResearchProviderStatus, StartRunInput, WorkspaceSnapshot } from '@shared/types';
import { Modal } from '../../app/Modal';
import { networkProfileLabel } from '../../lib/formatting';
import {
  defaultRunInput,
  optionalPositiveInteger,
  UNBOUNDED_MINUTES
} from '../../view-models/runSettings';

const NETWORK_PROFILE_OPTIONS = ['offline', 'scoped', 'elevated'] as const;

type StartRunFieldUpdater = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]) => void;
type StartRunBudgetUpdater = (key: keyof StartRunInput['budget'], value: number) => void;
type SessionProviderId = 'openai-codex' | ResearchProviderId;

interface SessionProviderOption {
  id: SessionProviderId;
  label: string;
  defaultModel: string | null;
  configured: boolean;
}

export function StartRunForm({
  snapshot,
  openAiStatus,
  researchProviderStatuses,
  busy,
  runAction,
  onCancel,
  onStarted
}: {
  snapshot: WorkspaceSnapshot;
  openAiStatus: OpenAiAccountStatus | null;
  researchProviderStatuses: ResearchProviderStatus[];
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
  onCancel: () => void;
  onStarted: (runId: string) => void;
}): JSX.Element {
  const [input, setInput] = useState<StartRunInput>(() => ({
    ...defaultRunInput,
    networkProfile: 'elevated',
    sandboxProfile: 'host'
  }));
  const [startingRun, setStartingRun] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<SessionProviderId>('openai-codex');
  const providerOptions = useMemo<SessionProviderOption[]>(
    () => [
      {
        id: 'openai-codex',
        label: 'OpenAI (Codex)',
        defaultModel: openAiStatus?.defaultModel ?? defaultRunInput.model,
        configured: openAiStatus?.configured ?? false
      },
      ...researchProviderStatuses.map((provider) => ({
        id: provider.id,
        label: provider.name,
        defaultModel: provider.defaultModel,
        configured: provider.configured
      }))
    ],
    [openAiStatus, researchProviderStatuses]
  );

  useEffect(() => {
    setInput((current) => {
      return { ...current, networkProfile: 'elevated', sandboxProfile: 'host' };
    });
  }, [snapshot.activeScope.id]);

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
  const hasPromptDraft = input.promptMarkdown.trim().length > 0;
  const canStart = hasPromptDraft;

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

  const selectProvider = (providerId: SessionProviderId): void => {
    setSelectedProviderId(providerId);
    update('provider', providerId);
    const provider = providerOptions.find((candidate) => candidate.id === providerId);
    if (provider?.defaultModel) update('model', provider.defaultModel);
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
        <div className="policy-line host-sandbox-warning">
          <ShieldAlert size={15} />
          Honeycrisp runs with this user's host privileges. Launch Beale and Honeycrisp inside your own VM or container when you want OS isolation.
        </div>
        <textarea
          className="prompt-box"
          rows={6}
          placeholder="Describe the research objective, constraints, and desired outcome."
          value={input.promptMarkdown}
          onChange={(event) => update('promptMarkdown', event.target.value)}
        />
        <div className="start-grid">
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
          <SessionSettingsFields
            input={input}
            minuteLimitValue={minuteLimitValue}
            providerOptions={providerOptions}
            selectedProviderId={selectedProviderId}
            onSelectProvider={selectProvider}
            onUpdate={update}
            onUpdateBudget={updateBudget}
          />
        </details>
      </div>
    </Modal>
  );
}

export function SessionSettingsFields({
  input,
  minuteLimitValue,
  providerOptions,
  selectedProviderId,
  onSelectProvider,
  onUpdate,
  onUpdateBudget
}: {
  input: StartRunInput;
  minuteLimitValue: string;
  providerOptions: SessionProviderOption[];
  selectedProviderId: SessionProviderId;
  onSelectProvider: (providerId: SessionProviderId) => void;
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
        Provider
        <select value={selectedProviderId} onChange={(event) => onSelectProvider(event.target.value as SessionProviderId)}>
          {providerOptions.map((provider) => (
            <option value={provider.id} disabled={!provider.defaultModel} key={provider.id}>
              {provider.label}{provider.configured ? '' : ' — Not configured'}
            </option>
          ))}
        </select>
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
