import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, Play, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
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
import { userFacingErrorMessage } from '../../lib/errors';
import { networkProfileLabel } from '../../lib/formatting';
import {
  clientRequestId,
  defaultRunInput,
  optionalPositiveInteger,
  UNBOUNDED_MINUTES
} from '../../view-models/runSettings';

const NETWORK_PROFILE_OPTIONS = ['offline', 'scoped', 'elevated'] as const;
const PROMPT_STREAM_RENDER_INTERVAL_MS = 90;

type PromptEntryMode = 'chooser' | 'expanded' | 'custom';

type StartRunFieldUpdater = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]) => void;
type StartRunBudgetUpdater = (key: keyof StartRunInput['budget'], value: number) => void;
interface SessionProviderOption {
  id: ResearchModelProviderId;
  label: string;
  configured: boolean;
  models: ResearchProviderModel[];
}

interface ResearchGoalChooserProps {
  suggestions: [string, string, string] | null;
  loading: boolean;
  error: string | null;
  onSelect: (sentence: string) => void;
  onSomethingElse: () => void;
  onRetry: () => void;
}

export function StartRunForm({
  snapshot,
  openAiStatus,
  researchProviderStatuses,
  providerModelCatalog,
  researchGoalSuggestions,
  researchGoalSuggestionsLoading,
  researchGoalSuggestionError,
  busy,
  runAction,
  onCancel,
  onRetryResearchGoalSuggestions,
  onStarted
}: {
  snapshot: WorkspaceSnapshot;
  openAiStatus: OpenAiAccountStatus | null;
  researchProviderStatuses: ResearchProviderStatus[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  researchGoalSuggestions: [string, string, string] | null;
  researchGoalSuggestionsLoading: boolean;
  researchGoalSuggestionError: string | null;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
  onCancel: () => void;
  onRetryResearchGoalSuggestions: () => void;
  onStarted: (runId: string) => void;
}): JSX.Element {
  const [input, setInput] = useState<StartRunInput>(() => ({
    ...defaultRunInput,
    networkProfile: 'elevated',
    sandboxProfile: 'host'
  }));
  const [startingRun, setStartingRun] = useState(false);
  const [entryMode, setEntryMode] = useState<PromptEntryMode>('chooser');
  const [selectedGoalSentence, setSelectedGoalSentence] = useState<string | null>(null);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<ResearchModelProviderId>('openai-codex');
  const promptBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef(input);
  const mountedRef = useRef(true);
  const generationRequestIdRef = useRef<string | null>(null);
  const pendingPromptMarkdownRef = useRef<string | null>(null);
  const promptStreamFlushTimerRef = useRef<number | null>(null);
  const promptStreamAutoScrollRef = useRef(false);
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

  const clearPendingPromptStream = (): void => {
    pendingPromptMarkdownRef.current = null;
    if (promptStreamFlushTimerRef.current !== null) {
      window.clearTimeout(promptStreamFlushTimerRef.current);
      promptStreamFlushTimerRef.current = null;
    }
  };

  const flushPendingPromptStream = (): void => {
    const promptMarkdown = pendingPromptMarkdownRef.current;
    pendingPromptMarkdownRef.current = null;
    if (promptStreamFlushTimerRef.current !== null) {
      window.clearTimeout(promptStreamFlushTimerRef.current);
      promptStreamFlushTimerRef.current = null;
    }
    if (promptMarkdown === null || !mountedRef.current) return;
    promptStreamAutoScrollRef.current = true;
    setInput((current) => {
      const next = { ...current, promptMarkdown };
      inputRef.current = next;
      return next;
    });
  };

  const setPromptMarkdown = (promptMarkdown: string): void => {
    setInput((current) => {
      const next = { ...current, promptMarkdown };
      inputRef.current = next;
      return next;
    });
  };

  const cancelPromptGeneration = (updateState = true): void => {
    const requestId = generationRequestIdRef.current;
    generationRequestIdRef.current = null;
    clearPendingPromptStream();
    if (updateState) setGeneratingPrompt(false);
    if (requestId) void window.beale.cancelResearchPromptGeneration(requestId).catch(() => undefined);
  };

  const expandGoalSentence = (sentence: string): void => {
    cancelPromptGeneration();
    const requestId = clientRequestId('research_prompt');
    const sessionInput = inputRef.current;
    generationRequestIdRef.current = requestId;
    setSelectedGoalSentence(sentence);
    setEntryMode('expanded');
    setGenerationError(null);
    setPromptMarkdown('');
    setGeneratingPrompt(true);
    promptStreamAutoScrollRef.current = true;
    void window.beale.generateResearchPrompt({
      requestId,
      operation: 'expand_goal',
      goalSentence: sentence,
      draftPromptMarkdown: null,
      mode: sessionInput.mode,
      attemptStrategy: sessionInput.attemptStrategy,
      model: sessionInput.model,
      reasoningEffort: sessionInput.reasoningEffort,
      networkProfile: sessionInput.networkProfile,
      sandboxProfile: sessionInput.sandboxProfile,
      targetAssetId: sessionInput.targetAssetId ?? null,
      targetPath: sessionInput.targetPath ?? null
    })
      .then((generated) => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        clearPendingPromptStream();
        setPromptMarkdown(generated.promptMarkdown);
      })
      .catch((caught: unknown) => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        clearPendingPromptStream();
        setPromptMarkdown('');
        const message = userFacingErrorMessage(caught);
        if (!/canceled/i.test(message)) setGenerationError(message);
      })
      .finally(() => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        generationRequestIdRef.current = null;
        setGeneratingPrompt(false);
      });
  };

  useEffect(() => {
    cancelPromptGeneration();
    setInput((current) => {
      const next = { ...current, networkProfile: 'elevated', sandboxProfile: 'host', promptMarkdown: '' };
      inputRef.current = next;
      return next;
    });
    setEntryMode('chooser');
    setSelectedGoalSentence(null);
    setGenerationError(null);
  }, [snapshot.activeScope.id, snapshot.workspace.workspaceId]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = window.beale.onResearchPromptGenerationUpdate((update) => {
      if (!mountedRef.current || generationRequestIdRef.current !== update.requestId) return;
      pendingPromptMarkdownRef.current = update.promptMarkdown;
      if (promptStreamFlushTimerRef.current !== null) return;
      promptStreamFlushTimerRef.current = window.setTimeout(flushPendingPromptStream, PROMPT_STREAM_RENDER_INTERVAL_MS);
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
      cancelPromptGeneration(false);
    };
  }, []);

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

  useLayoutEffect(() => {
    if (!generatingPrompt || !promptStreamAutoScrollRef.current) return;
    const promptBox = promptBoxRef.current;
    if (promptBox) promptBox.scrollTop = promptBox.scrollHeight;
  }, [generatingPrompt, input.promptMarkdown]);

  const update = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]): void => {
    setInput((current) => {
      const next = { ...current, [key]: value };
      inputRef.current = next;
      return next;
    });
    if (key === 'promptMarkdown') {
      promptStreamAutoScrollRef.current = false;
      setGenerationError(null);
    }
  };

  const updateBudget = (key: keyof StartRunInput['budget'], value: number): void => {
    setInput((current) => {
      const next = { ...current, budget: { ...current.budget, [key]: value } };
      inputRef.current = next;
      return next;
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

  const showCustomPrompt = (): void => {
    cancelPromptGeneration();
    setSelectedGoalSentence(null);
    setGenerationError(null);
    setPromptMarkdown('');
    setEntryMode('custom');
  };

  const chooseAnotherGoal = (): void => {
    cancelPromptGeneration();
    setSelectedGoalSentence(null);
    setGenerationError(null);
    setPromptMarkdown('');
    setEntryMode('chooser');
  };

  const closeModal = (): void => {
    cancelPromptGeneration();
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
          <button className="primary-button" type="button" disabled={busy || startingRun || generatingPrompt || !canStart} onClick={start}>
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
        {entryMode === 'chooser' ? (
          <ResearchGoalChooser
            suggestions={researchGoalSuggestions}
            loading={researchGoalSuggestionsLoading}
            error={researchGoalSuggestionError}
            onSelect={expandGoalSentence}
            onSomethingElse={showCustomPrompt}
            onRetry={onRetryResearchGoalSuggestions}
          />
        ) : (
          <div className="research-prompt-entry">
            <button type="button" className="research-goal-back" onClick={chooseAnotherGoal}>
              <ArrowLeft size={14} />
              Choose {entryMode === 'custom' ? 'a suggested goal' : 'another goal'}
            </button>
            {entryMode === 'expanded' && selectedGoalSentence ? (
              <div className="selected-research-goal">
                <span>Selected direction</span>
                <p>{selectedGoalSentence}</p>
              </div>
            ) : null}
            {generationError ? (
              <div className="generate-prompt-error-box" role="alert">
                <ShieldAlert size={15} />
                <div>
                  <strong>Could not write the research prompt</strong>
                  <p>{generationError}</p>
                  {selectedGoalSentence ? (
                    <button type="button" onClick={() => expandGoalSentence(selectedGoalSentence)}>Retry</button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {entryMode === 'custom' || generatingPrompt || input.promptMarkdown || !generationError ? (
              <label className="research-prompt-editor">
                {entryMode === 'custom' ? 'Research prompt' : 'Full research prompt'}
                <textarea
                  ref={promptBoxRef}
                  className="prompt-box"
                  rows={7}
                  disabled={generatingPrompt}
                  placeholder={entryMode === 'custom'
                    ? 'Describe the research objective, constraints, and desired outcome.'
                    : 'Beale is expanding the selected direction into a complete research prompt…'}
                  value={input.promptMarkdown}
                  onChange={(event) => update('promptMarkdown', event.target.value)}
                />
              </label>
            ) : null}
            {generatingPrompt ? (
              <div className="research-prompt-generation-status" role="status">
                <Sparkles size={14} />
                Writing a full prompt from the selected direction…
              </div>
            ) : null}
          </div>
        )}
        <label className="goal-option">
          <input
            type="checkbox"
            checked={input.goalEnabled}
            onChange={(event) => update('goalEnabled', event.target.checked)}
          />
          <span>
            <strong>Goal</strong>
            <small>Keep working across turns until the objective is complete or genuinely blocked.</small>
          </span>
        </label>
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

export function ResearchGoalChooser({
  suggestions,
  loading,
  error,
  onSelect,
  onSomethingElse,
  onRetry
}: ResearchGoalChooserProps): JSX.Element {
  return (
    <section className="research-goal-chooser" aria-labelledby="research-goal-chooser-title">
      <div className="research-goal-chooser-heading">
        <div>
          <h3 id="research-goal-chooser-title">Choose a goal</h3>
          <p>These directions build on previous research. Beale will turn your selection into a full prompt before starting.</p>
        </div>
        {loading ? <span role="status">Reviewing prior research…</span> : null}
      </div>
      {error ? (
        <div className="generate-prompt-error-box" role="alert">
          <ShieldAlert size={15} />
          <div>
            <strong>Could not suggest goals</strong>
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        </div>
      ) : null}
      <div className="research-goal-choice-grid">
        {loading ? [0, 1, 2].map((index) => (
          <div className="research-goal-choice research-goal-choice-loading" aria-hidden="true" key={index}>
            <span />
            <span />
          </div>
        )) : null}
        {suggestions?.map((sentence, index) => (
          <button
            type="button"
            className="research-goal-choice"
            aria-label={`Goal ${index + 1}: ${sentence}`}
            onClick={() => onSelect(sentence)}
            key={sentence}
          >
            <span className="research-goal-choice-number">{index + 1}</span>
            <span className="research-goal-choice-text">{sentence}</span>
          </button>
        ))}
        <button type="button" className="research-goal-choice research-goal-choice-custom" onClick={onSomethingElse}>
          <span className="research-goal-choice-number">4</span>
          <span>
            <strong>Something Else</strong>
            <small>Write your own research prompt.</small>
          </span>
        </button>
      </div>
    </section>
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
