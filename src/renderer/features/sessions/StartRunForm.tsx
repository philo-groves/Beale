import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, Play, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import type {
  OpenAiAccountStatus,
  ResearchGoalPhase,
  ResearchGoalSuggestionsByPhase,
  ResearchGoalSuggestionStateByPhase,
  ResearchModelEffortLevel,
  ResearchModelProviderId,
  ResearchProfileWorkflow,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  ResearchProviderStatus,
  StartRunInput,
  WorkspaceSnapshot
} from '@shared/types';
import { resolveGoalObjective } from '../../../shared/goalObjective';
import { BottomSheet } from '../../app/Modal';
import { userFacingErrorMessage } from '../../lib/errors';
import { researchModelNameLabel } from '../../lib/formatting';
import { DEFAULT_SHELL_SAFETY_MODE, normalizeShellSafetyMode, SHELL_SAFETY_MODE_OPTIONS } from '../../../shared/shellSafety';
import {
  clientRequestId,
  defaultRunInput,
  optionalPositiveInteger,
  UNBOUNDED_MINUTES
} from '../../view-models/runSettings';

const PROMPT_STREAM_RENDER_INTERVAL_MS = 90;
const MAX_RENDERED_GOAL_SUGGESTIONS = 12;

type PromptEntryMode = 'chooser' | 'expanded';

type StartRunFieldUpdater = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]) => void;
type StartRunBudgetUpdater = (key: keyof StartRunInput['budget'], value: number) => void;
interface SessionProviderOption {
  id: ResearchModelProviderId;
  label: string;
  configured: boolean;
  models: ResearchProviderModel[];
}

interface ResearchGoalChooserProps {
  workflows?: readonly ResearchProfileWorkflow[];
  suggestions: ResearchGoalSuggestionsByPhase;
  loading: ResearchGoalSuggestionStateByPhase<boolean>;
  errors: ResearchGoalSuggestionStateByPhase<string | null>;
  onSelect: (sentence: string, phase: ResearchGoalPhase | null) => void;
  onRetry: (phase: ResearchGoalPhase) => void;
}

const LEGACY_RESEARCH_GOAL_WORKFLOWS: readonly ResearchProfileWorkflow[] = [
  {
    id: 'discovery',
    name: 'Discovery',
    description: 'Find a new primitive by pairing a system area with a plausible bug class; reachability, exploitability, and reportability remain open.',
    goalSuggestionCount: 4,
    goalSuggestionInstructions: [],
    promptInstructions: [],
    outputRequirements: [],
    default: true
  },
  {
    id: 'chaining',
    name: 'Chaining',
    description: 'Upgrade existing primitives into a reportable exploit chain and triage-ready PoC, discovering missing links when needed.',
    goalSuggestionCount: 4,
    goalSuggestionInstructions: [],
    promptInstructions: [],
    outputRequirements: []
  },
  {
    id: 'reporting',
    name: 'Reporting',
    description: 'Document a supported chain, its bugs and impact, and package the triage-ready PoC and required evidence in submission.zip.',
    goalSuggestionCount: 4,
    goalSuggestionInstructions: [],
    promptInstructions: [],
    outputRequirements: []
  }
];

export function StartRunForm({
  snapshot,
  openAiStatus,
  researchProviderStatuses,
  providerModelCatalog,
  researchGoalSuggestions,
  researchGoalSuggestionsLoading,
  researchGoalSuggestionErrors,
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
  researchGoalSuggestions: ResearchGoalSuggestionsByPhase;
  researchGoalSuggestionsLoading: ResearchGoalSuggestionStateByPhase<boolean>;
  researchGoalSuggestionErrors: ResearchGoalSuggestionStateByPhase<string | null>;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
  onCancel: () => void;
  onRetryResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onStarted: (runId: string) => void;
}): JSX.Element {
  const profile = snapshot.researchProfile?.profile;
  const workflows = profile?.workflows.length ? profile.workflows : LEGACY_RESEARCH_GOAL_WORKFLOWS;
  const defaultWorkflowId = defaultResearchWorkflowId(workflows);
  const presentation = profile?.presentation;
  const [input, setInput] = useState<StartRunInput>(() => ({
    ...defaultRunInput,
    workflowId: defaultWorkflowId,
    networkProfile: snapshot.activeScope.networkProfile,
    sandboxProfile: 'host'
  }));
  const [startingRun, setStartingRun] = useState(false);
  const [entryMode, setEntryMode] = useState<PromptEntryMode>('chooser');
  const [selectedGoalSentence, setSelectedGoalSentence] = useState<string | null>(null);
  const [selectedGoalPhase, setSelectedGoalPhase] = useState<ResearchGoalPhase | null>(null);
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

  const expandGoalSentence = (sentence: string, phase: ResearchGoalPhase | null): void => {
    cancelPromptGeneration();
    const requestId = clientRequestId('research_prompt');
    const sessionInput = inputRef.current;
    const workflowId = phase ?? sessionInput.workflowId ?? defaultWorkflowId;
    generationRequestIdRef.current = requestId;
    setSelectedGoalSentence(sentence);
    setSelectedGoalPhase(workflowId);
    setEntryMode('expanded');
    setGenerationError(null);
    setInput((current) => {
      const next = { ...current, workflowId, goalObjective: sentence, promptMarkdown: '' };
      inputRef.current = next;
      return next;
    });
    setGeneratingPrompt(true);
    promptStreamAutoScrollRef.current = true;
    void window.beale.generateResearchPrompt({
      requestId,
      operation: 'expand_goal',
      researchPhase: workflowId,
      goalSentence: sentence,
      draftPromptMarkdown: null,
      mode: sessionInput.mode,
      attemptStrategy: sessionInput.attemptStrategy,
      model: sessionInput.model,
      reasoningEffort: sessionInput.reasoningEffort,
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
      const next = {
        ...current,
        shellSafetyMode: DEFAULT_SHELL_SAFETY_MODE,
        networkProfile: snapshot.activeScope.networkProfile,
        sandboxProfile: 'host',
        workflowId: defaultWorkflowId,
        goalObjective: null,
        promptMarkdown: ''
      };
      inputRef.current = next;
      return next;
    });
    setEntryMode('chooser');
    setSelectedGoalSentence(null);
    setSelectedGoalPhase(null);
    setGenerationError(null);
  }, [defaultWorkflowId, snapshot.activeScope.id, snapshot.researchProfile?.profileHash, snapshot.workspace.workspaceId]);

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
      const next: StartRunInput = { ...current, [key]: value };
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
    startWithInput({
      ...input,
      goalObjective: input.goalEnabled
        ? resolveGoalObjective(input.goalObjective, input.promptMarkdown)
        : null
    });
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

  const chooseAnotherGoal = (): void => {
    cancelPromptGeneration();
    setSelectedGoalSentence(null);
    setSelectedGoalPhase(null);
    setGenerationError(null);
    setInput((current) => {
      const next = { ...current, goalObjective: null, promptMarkdown: '' };
      inputRef.current = next;
      return next;
    });
    setEntryMode('chooser');
  };

  const closeModal = (): void => {
    cancelPromptGeneration();
    onCancel();
  };

  return (
    <BottomSheet
      title={presentation?.newResearchLabel ?? 'New Research'}
      wide
      className="start-run-sheet"
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
            workflows={workflows}
            suggestions={researchGoalSuggestions}
            loading={researchGoalSuggestionsLoading}
            errors={researchGoalSuggestionErrors}
            onSelect={expandGoalSentence}
            onRetry={onRetryResearchGoalSuggestions}
          />
        ) : (
          <div className="research-prompt-entry">
            <button type="button" className="research-goal-back" onClick={chooseAnotherGoal}>
              <ArrowLeft size={14} />
              Choose another goal
            </button>
            {entryMode === 'expanded' && selectedGoalSentence ? (
              <div className="selected-research-goal">
                <span>{selectedGoalPhase ? `${phaseTitle(selectedGoalPhase, workflows)} goal` : 'Your goal'}</span>
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
                    <button type="button" onClick={() => expandGoalSentence(selectedGoalSentence, selectedGoalPhase)}>Retry</button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {generatingPrompt || input.promptMarkdown || !generationError ? (
              <label className="research-prompt-editor">
                Full research prompt
                <textarea
                  ref={promptBoxRef}
                  className="prompt-box"
                  rows={7}
                  disabled={generatingPrompt}
                  placeholder="Beale is expanding the selected direction into a complete research prompt…"
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
            Safety Mode
            <select
              value={input.shellSafetyMode}
              onChange={(event) => update('shellSafetyMode', normalizeShellSafetyMode(event.target.value))}
            >
              {SHELL_SAFETY_MODE_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details className="advanced-run-options">
          <summary>{presentation?.sessionLabel ?? 'Session'} Settings</summary>
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
    </BottomSheet>
  );
}

export function ResearchGoalChooser({
  workflows = LEGACY_RESEARCH_GOAL_WORKFLOWS,
  suggestions,
  loading,
  errors,
  onSelect,
  onRetry
}: ResearchGoalChooserProps): JSX.Element {
  const [customGoal, setCustomGoal] = useState('');
  const [customWorkflowId, setCustomWorkflowId] = useState(() => defaultResearchWorkflowId(workflows));
  const normalizedCustomGoal = customGoal.trim();
  const anySectionLoading = Object.values(loading).some(Boolean);

  useEffect(() => {
    if (!workflows.some((workflow) => workflow.id === customWorkflowId)) {
      setCustomWorkflowId(defaultResearchWorkflowId(workflows));
    }
  }, [customWorkflowId, workflows]);

  return (
    <section className="research-goal-chooser" aria-labelledby="research-goal-chooser-title">
      <div className="research-goal-chooser-heading">
        <div>
          <h3 id="research-goal-chooser-title">Choose a goal</h3>
          <p>Choose the workflow that matches the next research outcome. Beale will turn the selected goal into a full editable prompt.</p>
        </div>
        {anySectionLoading ? <span role="status">Reviewing prior research…</span> : null}
      </div>
      <div className="research-goal-sections">
        {workflows.map((workflow, workflowIndex) => {
          const phase = workflow.id;
          const title = workflow.name;
          const domId = workflowDomId(phase, workflowIndex);
          return (
            <section className={`research-goal-section research-goal-section-${domId}`} aria-labelledby={`research-goal-${domId}-title`} key={phase}>
              <header>
                <div className="research-goal-section-title">
                  <h4 id={`research-goal-${domId}-title`}>{title}</h4>
                  {loading[phase] ? <span role="status">Loading…</span> : null}
                </div>
                <p>{workflow.description}</p>
              </header>
              <div className="research-goal-choice-list">
              {errors[phase] ? (
                <div className="research-goal-section-error" role="alert">
                  <ShieldAlert size={14} />
                  <div>
                    <strong>Could not load {title.toLowerCase()} goals</strong>
                    <p>{errors[phase]}</p>
                    <button type="button" onClick={() => onRetry(phase)}>
                      <RefreshCw size={13} />
                      Retry
                    </button>
                  </div>
                </div>
              ) : null}
              {loading[phase] ? Array.from({
                length: Math.min(MAX_RENDERED_GOAL_SUGGESTIONS, Math.max(1, workflow.goalSuggestionCount))
              }, (_, index) => index).map((index) => (
                <div className="research-goal-choice research-goal-choice-loading" aria-hidden="true" key={index}>
                  <span />
                  <span />
                </div>
              )) : null}
              {suggestions[phase]?.slice(0, MAX_RENDERED_GOAL_SUGGESTIONS).map((sentence, index) => (
                <button
                  type="button"
                  className="research-goal-choice"
                  aria-label={`${title} goal ${index + 1}: ${sentence}`}
                  onClick={() => onSelect(sentence, phase)}
                  key={sentence}
                >
                  <span className="research-goal-choice-number">{index + 1}</span>
                  <span className="research-goal-choice-text">{sentence}</span>
                </button>
              ))}
              </div>
            </section>
          );
        })}
      </div>
      <section className="research-goal-custom-section" aria-labelledby="research-goal-custom-title">
        <div>
          <h4 id="research-goal-custom-title">Your Goal</h4>
          <p>Write a goal in your own words. Beale will expand it into a complete editable prompt.</p>
        </div>
        <textarea
          rows={2}
          value={customGoal}
          placeholder="Describe the research outcome you want."
          onChange={(event) => setCustomGoal(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && normalizedCustomGoal) {
              onSelect(normalizedCustomGoal, customWorkflowId);
            }
          }}
        />
        {workflows.length > 1 ? (
          <label className="research-goal-custom-workflow">
            Workflow
            <select value={customWorkflowId} onChange={(event) => setCustomWorkflowId(event.target.value)}>
              {workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
            </select>
          </label>
        ) : null}
        <button type="button" className="primary-button" disabled={!normalizedCustomGoal} onClick={() => onSelect(normalizedCustomGoal, customWorkflowId)}>
          Write full prompt
        </button>
      </section>
    </section>
  );
}

function phaseTitle(phase: ResearchGoalPhase, workflows: readonly ResearchProfileWorkflow[]): string {
  return workflows.find((workflow) => workflow.id === phase)?.name ?? phase;
}

export function defaultResearchWorkflowId(workflows: readonly ResearchProfileWorkflow[]): string {
  return workflows.find((workflow) => workflow.default)?.id ?? workflows[0]?.id ?? 'discovery';
}

function workflowDomId(id: string, index: number): string {
  const normalized = id.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return normalized || `workflow-${index + 1}`;
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
            <option value={model.id} key={model.id}>{modelOptionLabel(selectedProviderId, model)}</option>
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

function modelOptionLabel(providerId: ResearchModelProviderId, model: ResearchProviderModel): string {
  const name = researchModelNameLabel(providerId, model.name);
  return model.name === model.id ? name : `${name} — ${model.id}`;
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
