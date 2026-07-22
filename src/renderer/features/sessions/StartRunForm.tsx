import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Play, ShieldAlert } from 'lucide-react';
import type {
  OpenAiAccountStatus,
  ResearchModelEffortLevel,
  ResearchModelProviderId,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  ResearchProviderStatus,
  StartRunInput,
  WorkspaceSnapshot
} from '@shared/types';
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
interface SessionProviderOption {
  id: ResearchModelProviderId;
  label: string;
  configured: boolean;
  models: ResearchProviderModel[];
}

export function StartRunForm({
  snapshot,
  openAiStatus,
  researchProviderStatuses,
  providerModelCatalog,
  busy,
  runAction,
  onCancel,
  onStarted
}: {
  snapshot: WorkspaceSnapshot;
  openAiStatus: OpenAiAccountStatus | null;
  researchProviderStatuses: ResearchProviderStatus[];
  providerModelCatalog: ResearchProviderModelCatalog[];
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
  const [selectedProviderId, setSelectedProviderId] = useState<ResearchModelProviderId>('openai-codex');
  const providerOptions = useMemo<SessionProviderOption[]>(
    () => providerModelCatalog.map((catalog) => ({
      id: catalog.providerId,
      label: providerLabel(catalog.providerId, catalog.providerName),
      configured: catalog.providerId === 'openai-codex'
        ? openAiStatus?.configured ?? false
        : researchProviderStatuses.find((provider) => provider.id === catalog.providerId)?.configured ?? false,
      models: catalog.models
    })),
    [openAiStatus, providerModelCatalog, researchProviderStatuses]
  );
  const selectedProvider = providerOptions.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectedModel = selectedProvider?.models.find((model) => model.id === input.model) ?? null;

  useEffect(() => {
    setInput((current) => {
      return { ...current, networkProfile: 'elevated', sandboxProfile: 'host' };
    });
  }, [snapshot.activeScope.id]);

  useEffect(() => {
    if (!selectedProvider) return;
    setInput((current) => {
      const preferredModelId = providerDefaultModel(selectedProvider.id, openAiStatus, researchProviderStatuses);
      const model = selectedProvider.models.find((candidate) => candidate.id === current.model)
        ?? selectedProvider.models.find((candidate) => candidate.id === preferredModelId)
        ?? selectedProvider.models[0];
      if (!model) return current;
      const effort = inputValueForEffort(preferredEffort(model.effortLevels, effortLevelFromInput(current.reasoningEffort)));
      if (current.provider === selectedProvider.id && current.model === model.id && current.reasoningEffort === effort) {
        return current;
      }
      return { ...current, provider: selectedProvider.id, model: model.id, reasoningEffort: effort };
    });
  }, [openAiStatus, researchProviderStatuses, selectedProvider]);

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
  const selectedEffort = effortLevelFromInput(input.reasoningEffort);
  const canStart = hasPromptDraft && Boolean(selectedModel?.effortLevels.includes(selectedEffort));

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

  const selectProvider = (providerId: ResearchModelProviderId): void => {
    setSelectedProviderId(providerId);
    const provider = providerOptions.find((candidate) => candidate.id === providerId);
    const preferredModelId = providerDefaultModel(providerId, openAiStatus, researchProviderStatuses);
    const model = provider?.models.find((candidate) => candidate.id === preferredModelId) ?? provider?.models[0];
    if (!model) return;
    setInput((current) => ({
      ...current,
      provider: providerId,
      model: model.id,
      reasoningEffort: inputValueForEffort(preferredEffort(model.effortLevels, effortLevelFromInput(current.reasoningEffort)))
    }));
  };

  const selectModel = (modelId: string): void => {
    const model = selectedProvider?.models.find((candidate) => candidate.id === modelId);
    if (!model) return;
    setInput((current) => ({
      ...current,
      model: model.id,
      reasoningEffort: inputValueForEffort(preferredEffort(model.effortLevels, effortLevelFromInput(current.reasoningEffort)))
    }));
  };

  const selectEffort = (effort: ResearchModelEffortLevel): void => {
    update('reasoningEffort', inputValueForEffort(effort));
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
            minuteLimitValue={minuteLimitValue}
            providerOptions={providerOptions}
            selectedProviderId={selectedProviderId}
            selectedModel={selectedModel}
            selectedEffort={selectedEffort}
            onSelectProvider={selectProvider}
            onSelectModel={selectModel}
            onSelectEffort={selectEffort}
            onUpdateBudget={updateBudget}
          />
        </details>
      </div>
    </Modal>
  );
}

export function SessionSettingsFields({
  minuteLimitValue,
  providerOptions,
  selectedProviderId,
  selectedModel,
  selectedEffort,
  onSelectProvider,
  onSelectModel,
  onSelectEffort,
  onUpdateBudget
}: {
  minuteLimitValue: string;
  providerOptions: SessionProviderOption[];
  selectedProviderId: ResearchModelProviderId;
  selectedModel: ResearchProviderModel | null;
  selectedEffort: ResearchModelEffortLevel;
  onSelectProvider: (providerId: ResearchModelProviderId) => void;
  onSelectModel: (modelId: string) => void;
  onSelectEffort: (effort: ResearchModelEffortLevel) => void;
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
        <select value={selectedProviderId} disabled={providerOptions.length === 0} onChange={(event) => onSelectProvider(event.target.value as ResearchModelProviderId)}>
          {providerOptions.length === 0 ? <option>Loading Pi catalog…</option> : null}
          {providerOptions.map((provider) => (
            <option value={provider.id} disabled={provider.models.length === 0} key={provider.id}>
              {provider.label}{provider.configured ? '' : ' — Not configured'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select value={selectedModel?.id ?? ''} disabled={!selectedModel} onChange={(event) => onSelectModel(event.target.value)}>
          {(providerOptions.find((provider) => provider.id === selectedProviderId)?.models ?? []).map((model) => (
            <option value={model.id} key={model.id}>{modelOptionLabel(model)}</option>
          ))}
        </select>
      </label>
      <label>
        Reasoning
        <select value={selectedEffort} disabled={!selectedModel} onChange={(event) => onSelectEffort(event.target.value as ResearchModelEffortLevel)}>
          {(selectedModel?.effortLevels ?? []).map((effort) => (
            <option value={effort} key={effort}>{effortLabel(effort)}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function providerLabel(providerId: ResearchModelProviderId, fallback: string): string {
  if (providerId === 'openai-codex') return 'OpenAI (Codex)';
  if (providerId === 'anthropic') return 'Anthropic (Claude)';
  if (providerId === 'xai') return 'xAI (Grok/X)';
  return fallback;
}

function providerDefaultModel(
  providerId: ResearchModelProviderId,
  openAiStatus: OpenAiAccountStatus | null,
  statuses: ResearchProviderStatus[]
): string | null {
  if (providerId === 'openai-codex') return openAiStatus?.defaultModel ?? defaultRunInput.model;
  return statuses.find((provider) => provider.id === providerId)?.defaultModel ?? null;
}

function modelOptionLabel(model: ResearchProviderModel): string {
  return model.name === model.id ? model.name : `${model.name} — ${model.id}`;
}

function effortLevelFromInput(value: string): ResearchModelEffortLevel {
  return value.trim() ? value as ResearchModelEffortLevel : 'off';
}

function inputValueForEffort(value: ResearchModelEffortLevel): string {
  return value === 'off' ? '' : value;
}

function preferredEffort(levels: ResearchModelEffortLevel[], current: ResearchModelEffortLevel): ResearchModelEffortLevel {
  if (levels.includes(current)) return current;
  if (levels.includes('high')) return 'high';
  return levels[0] ?? 'off';
}

function effortLabel(effort: ResearchModelEffortLevel): string {
  if (effort === 'xhigh') return 'XHigh';
  return `${effort.slice(0, 1).toUpperCase()}${effort.slice(1)}`;
}
