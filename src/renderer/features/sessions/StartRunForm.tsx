import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ChevronDown, Play, Plus, RefreshCw, Repeat, ShieldAlert, Sparkles, X } from 'lucide-react';
import type {
  OpenAiAccountStatus,
  ResearchGoalPhase,
  ResearchGoalSuggestionsByPhase,
  ResearchGoalSuggestionStateByPhase,
  ResearchModelEffortLevel,
  ResearchModelProviderId,
  ProviderModelDefaults,
  ProviderSettings,
  ResearchCollaborationIntensity,
  ResearchCollaborationMode,
  ResearchProfileWorkflow,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  ResearchProviderStatus,
  RepeatSchedule,
  StartRunInput,
  WorkspaceSnapshot
} from '@shared/types';
import { resolveGoalObjective } from '../../../shared/goalObjective';
import {
  collaborationLimits,
  ensureDefaultResearchCollaborator,
  normalizeResearchCollaboration
} from '../../../shared/collaboration';
import { Modal } from '../../app/Modal';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { ModelSelectionPicker } from '../../app/ModelSelectionPicker';
import { userFacingErrorMessage } from '../../lib/errors';
import { researchModelNameLabel } from '../../lib/formatting';
import { DEFAULT_RESEARCH_MODEL } from '../../../shared/modelDefaults';
import { normalizeRepeatSchedule, repeatScheduleFor, repeatScheduleLabel } from '../../../shared/repeatSchedule';
import { DEFAULT_SHELL_SAFETY_MODE, normalizeShellSafetyMode, SHELL_SAFETY_MODE_OPTIONS } from '../../../shared/shellSafety';
import {
  clientRequestId,
  defaultRunInput
} from '../../view-models/runSettings';
import type { ResearchGoalSeed } from './SessionNextSteps';

const PROMPT_STREAM_RENDER_INTERVAL_MS = 90;
const MAX_RENDERED_GOAL_SUGGESTIONS = 12;
const REPEAT_SCHEDULE_TYPES: RepeatSchedule['type'][] = ['none', 'minutely', 'hourly', 'daily', 'weekly', 'monthly'];
type RepeatScheduleUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

type PromptEditorStage = 'goal' | 'prompt';

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
  selectedWorkflowId?: ResearchGoalPhase;
  onSelectWorkflow?: (phase: ResearchGoalPhase) => void;
  onLoad?: (phase: ResearchGoalPhase) => void;
  onSelect: (sentence: string, phase: ResearchGoalPhase) => void;
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
  defaultProviderId,
  providerModelDefaults,
  providerPolicyRiskAcknowledgements = undefined,
  researchProviderStatuses,
  providerModelCatalog,
  researchGoalSuggestions,
  researchGoalSuggestionsLoading,
  researchGoalSuggestionErrors,
  initialGoal = null,
  busy,
  runAction,
  onCancel,
  onLoadResearchGoalSuggestions = () => undefined,
  onRetryResearchGoalSuggestions,
  onStarted
}: {
  snapshot: WorkspaceSnapshot;
  openAiStatus: OpenAiAccountStatus | null;
  defaultProviderId: ResearchModelProviderId | null | undefined;
  providerModelDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> | undefined;
  providerPolicyRiskAcknowledgements?: ProviderSettings['cyberPolicyRiskAcknowledgements'];
  researchProviderStatuses: ResearchProviderStatus[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  researchGoalSuggestions: ResearchGoalSuggestionsByPhase;
  researchGoalSuggestionsLoading: ResearchGoalSuggestionStateByPhase<boolean>;
  researchGoalSuggestionErrors: ResearchGoalSuggestionStateByPhase<string | null>;
  initialGoal?: ResearchGoalSeed | null;
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
  onCancel: () => void;
  onLoadResearchGoalSuggestions?: (phase: ResearchGoalPhase) => void;
  onRetryResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onStarted: (runId: string) => void;
}): JSX.Element {
  const profile = snapshot.researchProfile?.profile;
  const workflows = profile?.workflows.length ? profile.workflows : LEGACY_RESEARCH_GOAL_WORKFLOWS;
  const defaultWorkflowId = defaultResearchWorkflowId(workflows);
  const presentation = profile?.presentation;
  const initialWorkflowId = initialGoal?.phase ?? defaultWorkflowId;
  const [input, setInput] = useState<StartRunInput>(() => ({
    ...defaultRunInput,
    workflowId: initialWorkflowId,
    goalObjective: initialGoal?.sentence ?? null,
    promptMarkdown: initialGoal?.sentence ?? '',
    sandboxProfile: 'host'
  }));
  const [startingRun, setStartingRun] = useState(false);
  const [editorStage, setEditorStage] = useState<PromptEditorStage>('goal');
  const [generateEnabled, setGenerateEnabled] = useState(true);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<ResearchModelProviderId | null>(defaultProviderId ?? null);
  const providerSelectionInitializedRef = useRef(false);
  const modelSelectionInitializedRef = useRef(false);
  const promptBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef(input);
  const mountedRef = useRef(true);
  const generationRequestIdRef = useRef<string | null>(null);
  const generationSourceTextRef = useRef<string | null>(null);
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
  const initialProvider = useMemo(() => {
    if (defaultProviderId === undefined) return null;
    return providerOptions.find((provider) => provider.id === defaultProviderId && provider.configured && provider.models.length > 0)
      ?? providerOptions.find((provider) => provider.configured && provider.models.length > 0)
      ?? null;
  }, [defaultProviderId, providerOptions]);

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

  const generateFullPrompt = (): Promise<string | null> => {
    const draft = inputRef.current.promptMarkdown.trim();
    if (!draft || generatingPrompt) return Promise.resolve(null);
    cancelPromptGeneration();
    const requestId = clientRequestId('research_prompt');
    const sessionInput = inputRef.current;
    const workflowId = sessionInput.workflowId ?? defaultWorkflowId;
    const sourceStage = editorStage;
    generationRequestIdRef.current = requestId;
    generationSourceTextRef.current = draft;
    setGenerationError(null);
    setInput((current) => {
      const next = {
        ...current,
        workflowId,
        goalObjective: sourceStage === 'goal' ? draft : current.goalObjective,
        promptMarkdown: ''
      };
      inputRef.current = next;
      return next;
    });
    setGeneratingPrompt(true);
    promptStreamAutoScrollRef.current = true;
    return window.beale.generateResearchPrompt({
      requestId,
      operation: sourceStage === 'goal' ? 'expand_goal' : 'refine',
      researchPhase: workflowId,
      goalSentence: sourceStage === 'goal' ? draft : sessionInput.goalObjective,
      draftPromptMarkdown: sourceStage === 'prompt' ? draft : null,
      mode: sessionInput.mode,
      attemptStrategy: sessionInput.attemptStrategy,
      provider: selectedProviderId ?? undefined,
      model: sessionInput.model,
      reasoningEffort: sessionInput.reasoningEffort,
      sandboxProfile: sessionInput.sandboxProfile,
      targetAssetId: sessionInput.targetAssetId ?? null,
      targetPath: sessionInput.targetPath ?? null
    })
      .then((generated) => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return null;
        clearPendingPromptStream();
        setPromptMarkdown(generated.promptMarkdown);
        setEditorStage('prompt');
        return generated.promptMarkdown;
      })
      .catch((caught: unknown) => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return null;
        clearPendingPromptStream();
        setPromptMarkdown(generationSourceTextRef.current ?? draft);
        const message = userFacingErrorMessage(caught);
        if (!/canceled/i.test(message)) setGenerationError(message);
        return null;
      })
      .finally(() => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        generationRequestIdRef.current = null;
        generationSourceTextRef.current = null;
        setGeneratingPrompt(false);
      });
  };

  const selectWorkflow = (workflowId: ResearchGoalPhase): void => {
    if (!workflows.some((workflow) => workflow.id === workflowId)) return;
    update('workflowId', workflowId);
  };

  const selectGoalSentence = (sentence: string, phase: ResearchGoalPhase): void => {
    cancelPromptGeneration();
    setEditorStage('goal');
    setGenerationError(null);
    setInput((current) => {
      const next = { ...current, workflowId: phase, goalObjective: sentence, promptMarkdown: sentence };
      inputRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    cancelPromptGeneration();
    setInput((current) => {
      const next = {
        ...current,
        shellSafetyMode: DEFAULT_SHELL_SAFETY_MODE,
        sandboxProfile: 'host',
        workflowId: initialGoal?.phase ?? defaultWorkflowId,
        goalObjective: initialGoal?.sentence ?? null,
        promptMarkdown: initialGoal?.sentence ?? ''
      };
      inputRef.current = next;
      return next;
    });
    setEditorStage('goal');
    setGenerationError(null);
  }, [defaultWorkflowId, initialGoal, snapshot.activeScope.id, snapshot.researchProfile?.profileHash, snapshot.workspace.workspaceId]);

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
    if (providerSelectionInitializedRef.current || !initialProvider) return;
    providerSelectionInitializedRef.current = true;
    setSelectedProviderId(initialProvider.id);
  }, [initialProvider]);

  useEffect(() => {
    if (!selectedProvider || defaultProviderId === undefined || providerModelDefaults === undefined) return;
    setInput((current) => {
      const preferredModelId = providerDefaultModel(selectedProvider.id, openAiStatus, researchProviderStatuses, providerModelDefaults);
      const model = (!modelSelectionInitializedRef.current
        ? selectedProvider.models.find((candidate) => candidate.id === preferredModelId)
        : selectedProvider.models.find((candidate) => candidate.id === current.model))
        ?? selectedProvider.models.find((candidate) => candidate.id === preferredModelId)
        ?? selectedProvider.models[0];
      if (!model) return current;
      const defaultEffort = providerModelDefaults[selectedProvider.id]?.reasoningEffort
        ?? effortLevelFromInput(current.reasoningEffort);
      const effort = inputValueForEffort(preferredEffort(model.effortLevels, defaultEffort));
      modelSelectionInitializedRef.current = true;
      if (current.provider === selectedProvider.id && current.model === model.id && current.reasoningEffort === effort) {
        return current;
      }
      return { ...current, provider: selectedProvider.id, model: model.id, reasoningEffort: effort };
    });
  }, [defaultProviderId, openAiStatus, providerModelDefaults, researchProviderStatuses, selectedProvider]);

  useEffect(() => {
    if (providerModelDefaults === undefined || providerPolicyRiskAcknowledgements === undefined || providerOptions.length === 0) return;
    setInput((current) => {
      const currentCollaboration = normalizeResearchCollaboration(current.collaboration);
      const existing = new Map(currentCollaboration.providers.map((preference) => [
        collaboratorKey(preference.provider, preference.model),
        preference
      ]));
      const providers = providerOptions.flatMap((provider) => {
        const preferredModelId = providerDefaultModel(provider.id, openAiStatus, researchProviderStatuses, providerModelDefaults);
        const defaultEffort = providerModelDefaults[provider.id]?.reasoningEffort ?? 'high';
        const ready = provider.configured && providerPolicyRiskAcknowledgements[provider.id] === true;
        const orderedModels = [...provider.models].sort((left, right) => {
          if (left.id === preferredModelId) return -1;
          if (right.id === preferredModelId) return 1;
          return 0;
        });
        return orderedModels.map((model) => {
          const stored = existing.get(collaboratorKey(provider.id, model.id));
          return {
            provider: provider.id,
            model: model.id,
            reasoningEffort: stored?.reasoningEffort ?? preferredEffort(model.effortLevels, defaultEffort),
            enabled: ready && stored?.enabled === true
          };
        });
      });
      const leadModelId = current.model ?? '';
      const leadProvider = providerOptions.find((provider) => provider.id === current.provider)
        ?? providerOptions.find((provider) => provider.id === selectedProviderId);
      const leadProviderId = leadProvider?.id ?? selectedProviderId;
      const leadModel = leadProvider?.models.find((model) => model.id === leadModelId);
      const leadEffort = effortLevelFromInput(current.reasoningEffort);
      const leadReady = leadProviderId !== null
        && leadProvider?.configured === true
        && providerPolicyRiskAcknowledgements[leadProviderId] === true
        && leadModel?.effortLevels.includes(leadEffort) === true;
      const candidateCollaboration = { ...currentCollaboration, providers };
      const collaboration = leadReady
        ? ensureDefaultResearchCollaborator(candidateCollaboration, {
          provider: leadProviderId,
          model: leadModelId,
          reasoningEffort: leadEffort,
          enabled: true
        })
        : candidateCollaboration;
      const next = { ...current, collaboration };
      inputRef.current = next;
      return next;
    });
  }, [openAiStatus, providerModelDefaults, providerOptions, providerPolicyRiskAcknowledgements, researchProviderStatuses, selectedProviderId]);

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

  const hasPromptDraft = input.promptMarkdown.trim().length > 0;
  const activeWorkflowId = input.workflowId ?? defaultWorkflowId;
  const selectedEffort = effortLevelFromInput(input.reasoningEffort);
  const repeatSchedule = normalizeRepeatSchedule(input.budget.repeatSchedule);
  const requiresCyberPolicyAcknowledgement = collaborationRequiresCyberPolicyAcknowledgement(profile?.id);
  const collaboration = normalizeResearchCollaboration(input.collaboration);
  const enabledCollaborators = collaboration.providers.filter((provider) => provider.enabled);
  const availableCollaborators = collaboration.providers.filter((candidate) => {
    if (candidate.enabled) return false;
    const provider = providerOptions.find((option) => option.id === candidate.provider);
    return provider?.configured === true
      && provider.models.length > 0
      && (!requiresCyberPolicyAcknowledgement || providerPolicyRiskAcknowledgements?.[candidate.provider] === true);
  });
  const nextCollaborator = selectNextAvailableCollaborator(
    availableCollaborators,
    enabledCollaborators,
    selectedProviderId
  );
  const collaborationReady = collaboration.mode === 'solo'
    || (enabledCollaborators.length > 0 && enabledCollaborators.every((preference) => {
      const provider = providerOptions.find((candidate) => candidate.id === preference.provider);
      return provider?.configured === true
        && provider.models.some((model) => model.id === preference.model && model.effortLevels.includes(preference.reasoningEffort))
        && (!requiresCyberPolicyAcknowledgement || providerPolicyRiskAcknowledgements?.[preference.provider] === true);
    }));
  const canGenerate = hasPromptDraft && selectedProvider?.configured === true && !generatingPrompt;
  const canStart = hasPromptDraft
    && selectedProvider?.configured === true
    && Boolean(selectedModel?.effortLevels.includes(selectedEffort))
    && collaborationReady;

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
    const current = inputRef.current;
    startWithInput({
      ...current,
      goalObjective: current.goalEnabled
        ? resolveGoalObjective(current.goalObjective, current.promptMarkdown)
        : null
    });
  };

  const generateAndStart = (): void => {
    void generateFullPrompt().then((promptMarkdown) => {
      if (!promptMarkdown) return;
      const current = inputRef.current;
      startWithInput({
        ...current,
        promptMarkdown,
        goalObjective: current.goalEnabled
          ? resolveGoalObjective(current.goalObjective, promptMarkdown)
          : null
      });
    });
  };

  const selectProvider = (providerId: ResearchModelProviderId): void => {
    providerSelectionInitializedRef.current = true;
    modelSelectionInitializedRef.current = true;
    setSelectedProviderId(providerId);
    const provider = providerOptions.find((candidate) => candidate.id === providerId);
    const preferredModelId = providerDefaultModel(providerId, openAiStatus, researchProviderStatuses, providerModelDefaults ?? {});
    const model = provider?.models.find((candidate) => candidate.id === preferredModelId) ?? provider?.models[0];
    if (!model) return;
    setInput((current) => {
      const next = {
        ...current,
        provider: providerId,
        model: model.id,
        reasoningEffort: inputValueForEffort(preferredEffort(
          model.effortLevels,
          providerModelDefaults?.[providerId]?.reasoningEffort ?? effortLevelFromInput(current.reasoningEffort)
        ))
      };
      inputRef.current = next;
      return next;
    });
  };

  const selectModel = (modelId: string): void => {
    const model = selectedProvider?.models.find((candidate) => candidate.id === modelId);
    if (!model) return;
    setInput((current) => {
      const next = {
        ...current,
        model: model.id,
        reasoningEffort: inputValueForEffort(preferredEffort(model.effortLevels, effortLevelFromInput(current.reasoningEffort)))
      };
      inputRef.current = next;
      return next;
    });
  };

  const selectEffort = (effort: ResearchModelEffortLevel): void => {
    update('reasoningEffort', inputValueForEffort(effort));
  };

  const selectRepeatSchedule = (repeatSchedule: RepeatSchedule): void => {
    setInput((current) => {
      const next = {
        ...current,
        budget: {
          ...current.budget,
          repeatSchedule: normalizeRepeatSchedule(repeatSchedule)
        }
      };
      inputRef.current = next;
      return next;
    });
  };

  const selectCollaborationMode = (mode: ResearchCollaborationMode): void => {
    update('collaboration', { ...collaboration, mode });
  };

  const selectCollaborationIntensity = (intensity: ResearchCollaborationIntensity): void => {
    update('collaboration', { ...collaboration, intensity, ...collaborationLimits(intensity) });
  };

  const updateCollaborator = (
    providerId: ResearchModelProviderId,
    modelId: string,
    patch: Partial<(typeof collaboration.providers)[number]>
  ): void => {
    update('collaboration', {
      ...collaboration,
      providers: collaboration.providers.map((preference) => (
        preference.provider === providerId && preference.model === modelId
        ? { ...preference, ...patch }
        : preference
      ))
    });
  };

  const addCollaborator = (): void => {
    if (nextCollaborator) updateCollaborator(nextCollaborator.provider, nextCollaborator.model, { enabled: true });
  };

  const removeCollaborator = (providerId: ResearchModelProviderId, modelId: string): void => {
    updateCollaborator(providerId, modelId, { enabled: false });
  };

  const selectCollaboratorProvider = (
    currentProviderId: ResearchModelProviderId,
    currentModelId: string,
    nextProviderId: ResearchModelProviderId
  ): void => {
    if (currentProviderId === nextProviderId) return;
    const preferredModelId = providerDefaultModel(
      nextProviderId,
      openAiStatus,
      researchProviderStatuses,
      providerModelDefaults ?? {}
    );
    const target = collaboration.providers.find((preference) => (
      preference.provider === nextProviderId
      && preference.model === preferredModelId
      && !preference.enabled
    )) ?? collaboration.providers.find((preference) => (
      preference.provider === nextProviderId && !preference.enabled
    ));
    if (!target) return;
    update('collaboration', {
      ...collaboration,
      providers: collaboration.providers.map((preference) => {
        if (preference.provider === currentProviderId && preference.model === currentModelId) {
          return { ...preference, enabled: false };
        }
        if (preference.provider === target.provider && preference.model === target.model) {
          return { ...preference, enabled: true };
        }
        return preference;
      })
    });
  };

  const selectCollaboratorModel = (
    providerId: ResearchModelProviderId,
    currentModelId: string,
    nextModelId: string
  ): void => {
    if (currentModelId === nextModelId) return;
    const target = collaboration.providers.find((preference) => (
      preference.provider === providerId && preference.model === nextModelId && !preference.enabled
    ));
    if (!target) return;
    update('collaboration', {
      ...collaboration,
      providers: collaboration.providers.map((preference) => {
        if (preference.provider === providerId && preference.model === currentModelId) {
          return { ...preference, enabled: false };
        }
        if (preference.provider === providerId && preference.model === nextModelId) {
          return { ...preference, enabled: true };
        }
        return preference;
      })
    });
  };

  const closeModal = (): void => {
    cancelPromptGeneration();
    onCancel();
  };

  return (
    <Modal
      title={presentation?.newResearchLabel ?? 'New Research'}
      wide
      className="start-run-dialog"
      onClose={closeModal}
      footer={
        <>
          {generateEnabled ? (
            <button type="button" disabled={busy || startingRun || !canGenerate} onClick={() => void generateFullPrompt()}>
              <Sparkles size={15} />
              Generate
            </button>
          ) : null}
          <button
            className="primary-button"
            type="button"
            disabled={busy || startingRun || generatingPrompt || !canStart}
            onClick={generateEnabled ? generateAndStart : start}
          >
            {generateEnabled ? <Sparkles size={16} /> : <Play size={16} />}
            {generateEnabled ? 'Generate & Start' : 'Start'}
          </button>
        </>
      }
    >
      <div className="start-run-modal-body">
        <div className="new-research-compose-layout">
          <section className="new-research-composer" aria-label="Research prompt composer" aria-busy={generatingPrompt}>
            <textarea
              ref={promptBoxRef}
              autoFocus
              value={input.promptMarkdown}
              disabled={generatingPrompt}
              placeholder={editorStage === 'goal'
                ? 'Describe the research outcome you want.'
                : 'Review and edit the full research prompt.'}
              aria-label={editorStage === 'goal' ? 'Research goal' : 'Full research prompt'}
              onChange={(event) => update('promptMarkdown', event.target.value)}
            />
            <div className="new-research-composer-feedback" aria-live="polite">
              {generatingPrompt ? 'Writing a full prompt…' : generationError ? `Could not write the research prompt: ${generationError}` : ''}
            </div>
            <div className="new-research-composer-actions">
              <FloatingTextPicker
                className={`new-research-safety-picker main-steer-safety-mode-picker mode-${input.shellSafetyMode}`}
                value={input.shellSafetyMode}
                options={SHELL_SAFETY_MODE_OPTIONS}
                title="Shell safety mode"
                ariaLabel="Shell safety mode"
                disabled={generatingPrompt}
                onChange={(value) => update('shellSafetyMode', normalizeShellSafetyMode(value))}
              />
              <FloatingTextPicker
                className="new-research-workflow-picker"
                value={activeWorkflowId}
                options={workflows.map((workflow) => ({ value: workflow.id, label: workflow.name }))}
                title="Research workflow"
                ariaLabel="Research workflow"
                disabled={generatingPrompt}
                onChange={selectWorkflow}
              />
              <RepeatSchedulePicker
                value={repeatSchedule}
                disabled={generatingPrompt}
                onChange={selectRepeatSchedule}
              />
              <label
                className="new-research-goal-toggle"
                title="Keep working across turns until the objective is complete or genuinely blocked."
              >
                <input
                  type="checkbox"
                  checked={input.goalEnabled}
                  disabled={generatingPrompt}
                  onChange={(event) => update('goalEnabled', event.target.checked)}
                />
                <span>Goal</span>
              </label>
              <label
                className="new-research-generate-toggle"
                title="Generate a complete research prompt from the current content before starting."
              >
                <input
                  type="checkbox"
                  checked={generateEnabled}
                  disabled={generatingPrompt}
                  onChange={(event) => setGenerateEnabled(event.target.checked)}
                />
                <span>Generate</span>
              </label>
            </div>
          </section>
          <ResearchGoalChooser
            workflows={workflows}
            suggestions={researchGoalSuggestions}
            loading={researchGoalSuggestionsLoading}
            errors={researchGoalSuggestionErrors}
            selectedWorkflowId={activeWorkflowId}
            onSelectWorkflow={selectWorkflow}
            onLoad={onLoadResearchGoalSuggestions}
            onSelect={selectGoalSentence}
            onRetry={onRetryResearchGoalSuggestions}
          />
        </div>
        <div className="collaboration-settings">
            <div className="research-model-team">
              <div className="research-model-team-column research-lead-model-column">
                <span className="research-model-team-label">Lead</span>
                <ModelSelectionPicker
                  className="research-model-squircle research-lead-model-picker"
                  providerValue={selectedProviderId ?? ''}
                  modelValue={selectedModel?.id ?? ''}
                  effortValue={selectedEffort}
                  title="Lead provider, model, and effort"
                  ariaLabel="Lead model settings"
                  disabled={!selectedModel || generatingPrompt}
                  providerOptions={providerOptions.map((provider) => ({
                    value: provider.id,
                    label: provider.label,
                    disabled: provider.models.length === 0
                  }))}
                  modelOptions={(selectedProvider?.models ?? []).map((model) => ({
                    value: model.id,
                    label: selectedProviderId ? researchModelNameLabel(selectedProviderId, model.name) : model.name
                  }))}
                  effortOptions={(selectedModel?.effortLevels ?? []).map((effort) => ({ value: effort, label: effortLabel(effort) }))}
                  onSelectProvider={(value) => selectProvider(value as ResearchModelProviderId)}
                  onSelectModel={selectModel}
                  onSelectEffort={(value) => selectEffort(value as ResearchModelEffortLevel)}
                />
              </div>
              <div className="research-model-team-column research-collaborator-model-column">
                <span className="research-model-team-label">Collaborators</span>
                <div className="research-collaborator-stack">
                  {enabledCollaborators.map((preference) => {
                    const provider = providerOptions.find((candidate) => candidate.id === preference.provider);
                    const model = provider?.models.find((candidate) => candidate.id === preference.model) ?? null;
                    const canRemove = enabledCollaborators.length > 1;
                    return (
                      <div
                        className="research-model-squircle research-collaborator-squircle"
                        key={collaboratorKey(preference.provider, preference.model)}
                      >
                        <ModelSelectionPicker
                          className="research-collaborator-picker"
                          providerValue={preference.provider}
                          modelValue={preference.model}
                          effortValue={preference.reasoningEffort}
                          title={`${provider?.label ?? preference.provider} collaborator settings`}
                          ariaLabel={`${provider?.label ?? preference.provider} collaborator model settings`}
                          disabled={generatingPrompt}
                          providerOptions={providerOptions.map((candidate) => ({
                            value: candidate.id,
                            label: candidate.label,
                            disabled: candidate.models.length === 0
                              || !candidate.configured
                              || providerPolicyRiskAcknowledgements?.[candidate.id] !== true
                              || !collaboration.providers.some((available) => (
                                available.provider === candidate.id
                                && (candidate.id === preference.provider || !available.enabled)
                              ))
                          }))}
                          modelOptions={(provider?.models ?? []).map((candidate) => ({
                            value: candidate.id,
                            label: researchModelNameLabel(preference.provider, candidate.name),
                            disabled: candidate.id !== preference.model
                              && enabledCollaborators.some((enabled) => (
                                enabled.provider === preference.provider && enabled.model === candidate.id
                              ))
                          }))}
                          effortOptions={(model?.effortLevels ?? []).map((effort) => ({ value: effort, label: effortLabel(effort) }))}
                          onSelectProvider={(value) => selectCollaboratorProvider(
                            preference.provider,
                            preference.model,
                            value as ResearchModelProviderId
                          )}
                          onSelectModel={(modelId) => selectCollaboratorModel(
                            preference.provider,
                            preference.model,
                            modelId
                          )}
                          onSelectEffort={(effort) => updateCollaborator(preference.provider, preference.model, {
                            reasoningEffort: effort as ResearchModelEffortLevel
                          })}
                        />
                        <button
                          type="button"
                          className="research-collaborator-remove"
                          title={canRemove
                            ? `Remove ${provider?.label ?? preference.provider} collaborator`
                            : 'Add another collaborator before removing this one'}
                          aria-label={`Remove ${provider?.label ?? preference.provider} collaborator`}
                          disabled={generatingPrompt || !canRemove}
                          onClick={() => removeCollaborator(preference.provider, preference.model)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="research-model-squircle research-collaborator-add"
                    title={nextCollaborator ? 'Add collaborator' : 'No additional acknowledged providers are available'}
                    aria-label="Add collaborator"
                    disabled={!nextCollaborator || generatingPrompt}
                    onClick={addCollaborator}
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className="collaboration-controls-row">
              <div className="collaboration-controls-right">
                {collaboration.mode !== 'solo' ? (
                  <label className="collaboration-inline-control">
                    <span title="Sets how many rounds collaborators use to challenge and refine one another's conclusions.">Challenge Rounds</span>
                    <select
                      value={collaboration.peerChallengeRounds}
                      onChange={(event) => update('collaboration', { ...collaboration, peerChallengeRounds: Number(event.target.value) })}
                    >
                      <option value={0}>None</option>
                      <option value={1}>One</option>
                      <option value={2}>Two</option>
                      <option value={3}>Three</option>
                    </select>
                  </label>
                ) : null}
                <label className="collaboration-inline-control">
                  <span title="Controls whether research runs solo, calls collaborators adaptively, or always uses the configured team.">Mode</span>
                  <select value={collaboration.mode} onChange={(event) => selectCollaborationMode(event.target.value as ResearchCollaborationMode)}>
                    <option value="solo">Solo</option>
                    <option value="adaptive">Adaptive</option>
                    <option value="always">Always use team</option>
                  </select>
                </label>
                <label className="collaboration-inline-control">
                  <span title="Controls how broadly and deeply collaborators are used during the session.">Intensity</span>
                  <select
                    value={collaboration.intensity}
                    disabled={collaboration.mode === 'solo'}
                    onChange={(event) => selectCollaborationIntensity(event.target.value as ResearchCollaborationIntensity)}
                  >
                    <option value="focused">Focused</option>
                    <option value="balanced">Balanced</option>
                    <option value="deep">Deep</option>
                  </select>
                </label>
              </div>
            </div>
            {!collaborationReady && collaboration.mode !== 'solo' ? (
              <div className="policy-line collaboration-readiness-warning" role="alert">
                <ShieldAlert size={14} /> At least one collaborator is required. Every collaborator must be authenticated and use a supported model and effort.{requiresCyberPolicyAcknowledgement ? ' Cybersecurity collaborators must also have their policy acknowledgement accepted in Provider settings.' : ''}
              </div>
            ) : null}
        </div>
      </div>
    </Modal>
  );
}

function RepeatSchedulePicker({
  value,
  disabled,
  onChange
}: {
  value: RepeatSchedule;
  disabled: boolean;
  onChange: (value: RepeatSchedule) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const schedule = normalizeRepeatSchedule(value);
  const interval = schedule.type === 'none' ? 1 : schedule.interval;
  const unit = repeatScheduleUnit(schedule.type);

  useEffect(() => {
    if (!open) return undefined;
    const dismissOnOutsidePointer = (event: PointerEvent): void => {
      if (pickerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOnOutsidePointer);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectType = (type: RepeatSchedule['type']): void => {
    onChange(repeatScheduleFor(type, type === schedule.type ? interval : 1));
  };

  const selectInterval = (nextInterval: number): void => {
    onChange(repeatScheduleFor(schedule.type === 'none' ? 'daily' : schedule.type, nextInterval));
  };

  const selectUnit = (nextUnit: RepeatScheduleUnit): void => {
    const type = repeatScheduleTypeForUnit(nextUnit);
    onChange(repeatScheduleFor(type, interval));
  };

  return (
    <div
      className={`new-research-repeat-picker ${open ? 'is-open' : ''}`.trim()}
      ref={pickerRef}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setOpen(false);
      }}
    >
      <button
        type="button"
        className="new-research-repeat-trigger"
        title="Repeat schedule"
        aria-label="Repeat schedule"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Repeat size={13} aria-hidden="true" />
        <span>{repeatScheduleLabel(schedule)}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="new-research-repeat-menu" role="dialog" aria-label="Repeat schedule">
          <div className="new-research-repeat-presets" role="listbox" aria-label="Repeat preset">
            {REPEAT_SCHEDULE_TYPES.map((type) => (
              <button
                type="button"
                role="option"
                aria-selected={schedule.type === type}
                className={schedule.type === type ? 'is-selected' : undefined}
                onClick={() => selectType(type)}
                key={type}
              >
                {repeatTypeLabel(type)}
              </button>
            ))}
          </div>
          <div className="new-research-repeat-widget">
            <label>
              <span>Every</span>
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={interval}
                disabled={schedule.type === 'none'}
                onChange={(event) => selectInterval(Number(event.target.value))}
              />
            </label>
            <select
              value={unit}
              disabled={schedule.type === 'none'}
              aria-label="Repeat unit"
              onChange={(event) => selectUnit(event.target.value as RepeatScheduleUnit)}
            >
              <option value="minute">{interval === 1 ? 'minute' : 'minutes'}</option>
              <option value="hour">{interval === 1 ? 'hour' : 'hours'}</option>
              <option value="day">{interval === 1 ? 'day' : 'days'}</option>
              <option value="week">{interval === 1 ? 'week' : 'weeks'}</option>
              <option value="month">{interval === 1 ? 'month' : 'months'}</option>
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ResearchGoalChooser({
  workflows = LEGACY_RESEARCH_GOAL_WORKFLOWS,
  suggestions,
  loading,
  errors,
  selectedWorkflowId,
  onSelectWorkflow,
  onLoad,
  onSelect,
  onRetry
}: ResearchGoalChooserProps): JSX.Element {
  const activeWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId)
    ?? workflows.find((workflow) => workflow.default)
    ?? workflows[0]
    ?? LEGACY_RESEARCH_GOAL_WORKFLOWS[0]!;
  const phase = activeWorkflow.id;
  const workflowIndex = Math.max(0, workflows.findIndex((workflow) => workflow.id === phase));
  const domId = workflowDomId(phase, workflowIndex);

  useEffect(() => {
    onLoad?.(phase);
  }, [onLoad, phase]);

  return (
    <section
      className="research-goal-chooser"
      aria-label="Research suggestions"
      aria-describedby={`research-goal-${domId}-description`}
    >
      <div className="research-goal-view-toggle" role="tablist" aria-label="Suggestion workflow">
        {workflows.map((workflow) => (
          <button
            type="button"
            role="tab"
            aria-selected={workflow.id === phase}
            className={workflow.id === phase ? 'selected' : undefined}
            onClick={() => onSelectWorkflow?.(workflow.id)}
            key={workflow.id}
          >
            {workflow.name}
          </button>
        ))}
      </div>
      <header className="research-goal-section-header">
        <div className="research-goal-description-row">
          <p id={`research-goal-${domId}-description`}>{activeWorkflow.description}</p>
          {loading[phase] ? <span role="status">Loading…</span> : null}
        </div>
      </header>
      <MainSideScrollRegion
        className="research-goal-choice-scroll"
        listClassName="research-goal-choice-list"
        stickToStart
        updateKey={`${phase}:${loading[phase] ? 'loading' : 'ready'}:${errors[phase] ?? ''}:${suggestions[phase]?.length ?? 0}`}
      >
        {errors[phase] ? (
          <div className="research-goal-section-error" role="alert">
            <ShieldAlert size={14} />
            <div>
              <strong>Could not load {activeWorkflow.name.toLowerCase()} goals</strong>
              <p>{errors[phase]}</p>
              <button type="button" onClick={() => onRetry(phase)}>
                <RefreshCw size={13} />
                Retry
              </button>
            </div>
          </div>
        ) : null}
        {loading[phase] ? Array.from({
          length: Math.min(MAX_RENDERED_GOAL_SUGGESTIONS, Math.max(1, activeWorkflow.goalSuggestionCount))
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
            aria-label={`${activeWorkflow.name} goal ${index + 1}: ${sentence}`}
            onClick={() => onSelect(sentence, phase)}
            key={sentence}
          >
            <span className="research-goal-choice-text">{sentence}</span>
          </button>
        ))}
      </MainSideScrollRegion>
    </section>
  );
}

export function defaultResearchWorkflowId(workflows: readonly ResearchProfileWorkflow[]): string {
  return workflows.find((workflow) => workflow.id === 'discovery')?.id
    ?? workflows.find((workflow) => workflow.default)?.id
    ?? workflows[0]?.id
    ?? 'discovery';
}

function repeatTypeLabel(type: RepeatSchedule['type']): string {
  if (type === 'none') return 'No Repeat';
  if (type === 'minutely') return 'Every minute';
  if (type === 'hourly') return 'Hourly';
  if (type === 'daily') return 'Daily';
  if (type === 'weekly') return 'Weekly';
  return 'Monthly';
}

function repeatScheduleUnit(type: RepeatSchedule['type']): RepeatScheduleUnit {
  if (type === 'minutely') return 'minute';
  if (type === 'hourly') return 'hour';
  if (type === 'weekly') return 'week';
  if (type === 'monthly') return 'month';
  return 'day';
}

function repeatScheduleTypeForUnit(unit: RepeatScheduleUnit): Exclude<RepeatSchedule['type'], 'none'> {
  if (unit === 'minute') return 'minutely';
  if (unit === 'hour') return 'hourly';
  if (unit === 'week') return 'weekly';
  if (unit === 'month') return 'monthly';
  return 'daily';
}

function workflowDomId(id: string, index: number): string {
  const normalized = id.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return normalized || `workflow-${index + 1}`;
}

export function collaborationRequiresCyberPolicyAcknowledgement(profileId: string | null | undefined): boolean {
  return profileId === 'security-research';
}

function collaboratorKey(providerId: ResearchModelProviderId, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

export function selectNextAvailableCollaborator<T extends { provider: ResearchModelProviderId }>(
  available: readonly T[],
  enabled: readonly { provider: ResearchModelProviderId }[],
  leadProviderId: ResearchModelProviderId | null
): T | null {
  const representedProviders = new Set<ResearchModelProviderId>(enabled.map((collaborator) => collaborator.provider));
  if (leadProviderId) representedProviders.add(leadProviderId);
  return available.find((candidate) => !representedProviders.has(candidate.provider))
    ?? available.find((candidate) => candidate.provider !== leadProviderId)
    ?? available[0]
    ?? null;
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
  statuses: ResearchProviderStatus[],
  modelDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>>
): string | null {
  const configuredDefault = modelDefaults[providerId]?.largeModel;
  if (configuredDefault) return configuredDefault;
  if (providerId === 'openai-codex') return openAiStatus?.defaultModel ?? DEFAULT_RESEARCH_MODEL;
  return statuses.find((provider) => provider.id === providerId)?.defaultModel ?? null;
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
