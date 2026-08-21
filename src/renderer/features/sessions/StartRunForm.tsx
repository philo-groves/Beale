import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ArrowRight, ChevronDown, Compass, FileText, Handshake, Lightbulb, Minus, Play, Plus, RefreshCw, Repeat, ShieldAlert, Sparkles, Telescope, Waypoints, X } from 'lucide-react';
import type {
  OpenAiAccountStatus,
  ResearchGoalPhase,
  ResearchGoalSuggestionsByPhase,
  ResearchGoalSuggestionStateByPhase,
  ResearchModelEffortLevel,
  ResearchModelProviderId,
  ResearchModelSelection,
  ProviderModelDefaults,
  ProviderSettings,
  ResearchCollaborationIntensity,
  ResearchCollaborationMode,
  ResearchCollaborationProviderPreference,
  ResearchProfileSnapshot,
  ResearchProfileWorkflow,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  ResearchProviderStatus,
  RepeatSchedule,
  RunRecord,
  ShellSafetyMode,
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
import { BealeWelcomeIcon } from '../../app/BealeWelcomeIcon';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { ModelSelectionPicker } from '../../app/ModelSelectionPicker';
import { NestedSelectionPicker } from '../../app/NestedSelectionPicker';
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
import { MainSteerArea } from './SessionComposer';
import { SessionNextStepsWidget } from './SessionNextSteps';

const PROMPT_STREAM_RENDER_INTERVAL_MS = 90;
const MAX_RENDERED_GOAL_SUGGESTIONS = 12;

export function newResearchPromptPlaceholder(addContext: boolean): string {
  return addContext ? 'Write a sentence or two' : 'Write a full research prompt';
}

export function enableCollaboratorAtTop(
  providers: ResearchCollaborationProviderPreference[],
  collaborator: ResearchCollaborationProviderPreference | null
): ResearchCollaborationProviderPreference[] {
  if (!collaborator) return providers;
  return [
    { ...collaborator, enabled: true },
    ...providers.filter((provider) => (
      provider.provider !== collaborator.provider || provider.model !== collaborator.model
    ))
  ];
}
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
  },
  {
    id: 'longshot',
    name: 'Longshot',
    description: 'Hunt for ambitious, reportable high- or critical-severity vulnerabilities.',
    goalSuggestionCount: 4,
    goalSuggestionInstructions: [],
    promptInstructions: [],
    outputRequirements: []
  }
];

interface StartRunFormProps {
  snapshot: WorkspaceSnapshot;
  openAiStatus: OpenAiAccountStatus | null;
  defaultProviderId: ResearchModelProviderId | null | undefined;
  dangerModeEnabled?: boolean;
  defaultShellSafetyMode?: ShellSafetyMode;
  providerModelDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> | undefined;
  providerPolicyRiskAcknowledgements?: ProviderSettings['cyberPolicyRiskAcknowledgements'];
  researchProviderStatuses: ResearchProviderStatus[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  researchGoalSuggestions: ResearchGoalSuggestionsByPhase;
  researchGoalSuggestionsLoading: ResearchGoalSuggestionStateByPhase<boolean>;
  researchGoalSuggestionErrors: ResearchGoalSuggestionStateByPhase<string | null>;
  initialGoal?: ResearchGoalSeed | null;
  showSuggestions?: boolean;
  presentation?: 'dialog' | 'session';
  busy: boolean;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
  onCancel: () => void;
  onLoadResearchGoalSuggestions?: (phase: ResearchGoalPhase) => void;
  onSelectResearchGoalSuggestion?: (phase: ResearchGoalPhase, suggestion: string) => void;
  onRetryResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onStarted: (run: RunRecord) => void;
}

export interface ResearchSettingsFormProps {
  researchProfile: ResearchProfileSnapshot | null;
  formIdentity: string;
  workspaceName?: string;
  openAiStatus: OpenAiAccountStatus | null;
  defaultProviderId: ResearchModelProviderId | null | undefined;
  dangerModeEnabled?: boolean;
  defaultShellSafetyMode?: ShellSafetyMode;
  providerModelDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> | undefined;
  providerPolicyRiskAcknowledgements?: ProviderSettings['cyberPolicyRiskAcknowledgements'];
  researchProviderStatuses: ResearchProviderStatus[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  researchGoalSuggestions?: ResearchGoalSuggestionsByPhase;
  researchGoalSuggestionsLoading?: ResearchGoalSuggestionStateByPhase<boolean>;
  researchGoalSuggestionErrors?: ResearchGoalSuggestionStateByPhase<string | null>;
  initialGoal?: ResearchGoalSeed | null;
  initialInput?: StartRunInput;
  showSuggestions?: boolean;
  showAddContext?: boolean;
  disableNoRepeat?: boolean;
  presentation?: 'dialog' | 'embedded' | 'session';
  title?: string;
  submitLabel?: string;
  busy: boolean;
  onCancel?: () => void;
  onLoadResearchGoalSuggestions?: (phase: ResearchGoalPhase) => void;
  onSelectResearchGoalSuggestion?: (phase: ResearchGoalPhase, suggestion: string) => void;
  onRetryResearchGoalSuggestions?: (phase: ResearchGoalPhase) => void;
  onSubmit: (input: StartRunInput) => Promise<void> | void;
}

export function StartRunForm(props: StartRunFormProps): JSX.Element {
  const {
    snapshot,
    runAction,
    onStarted,
    presentation = 'dialog',
    ...settingsProps
  } = props;
  return (
    <ResearchSettingsForm
      {...settingsProps}
      researchProfile={snapshot.researchProfile ?? null}
      formIdentity={`${snapshot.workspace.workspaceId}:${snapshot.activeScope.id}:${snapshot.researchProfile?.profileHash ?? 'default'}`}
      workspaceName={snapshot.activeScope.workspaceName ?? 'Workspace'}
      showSuggestions={props.showSuggestions ?? true}
      presentation={presentation}
      onSubmit={async (input) => {
        let latestRun: RunRecord | undefined;
        await runAction(async () => {
          const next = await window.beale.startRun(input);
          latestRun = next.runs[0]?.run;
          return next;
        });
        if (latestRun) onStarted(latestRun);
      }}
    />
  );
}

export function ResearchSettingsForm({
  researchProfile,
  formIdentity,
  workspaceName = 'Workspace',
  openAiStatus,
  defaultProviderId,
  dangerModeEnabled = false,
  defaultShellSafetyMode = DEFAULT_SHELL_SAFETY_MODE,
  providerModelDefaults,
  providerPolicyRiskAcknowledgements = undefined,
  researchProviderStatuses,
  providerModelCatalog,
  researchGoalSuggestions = {},
  researchGoalSuggestionsLoading = {},
  researchGoalSuggestionErrors = {},
  initialGoal = null,
  initialInput,
  showSuggestions = true,
  showAddContext = true,
  disableNoRepeat = false,
  presentation: formPresentation = 'embedded',
  title,
  submitLabel = 'Save changes',
  busy,
  onCancel = () => undefined,
  onLoadResearchGoalSuggestions = () => undefined,
  onSelectResearchGoalSuggestion = () => undefined,
  onRetryResearchGoalSuggestions = () => undefined,
  onSubmit
}: ResearchSettingsFormProps): JSX.Element {
  const profile = researchProfile?.profile;
  const workflows = profile?.workflows.length ? profile.workflows : LEGACY_RESEARCH_GOAL_WORKFLOWS;
  const defaultWorkflowId = defaultResearchWorkflowId(workflows);
  const profilePresentation = profile?.presentation;
  const initialWorkflowId = initialGoal?.phase ?? defaultWorkflowId;
  const [input, setInput] = useState<StartRunInput>(() => (
    researchSettingsInput(initialInput, initialWorkflowId, initialGoal, defaultShellSafetyMode)
  ));
  const [startingRun, setStartingRun] = useState(false);
  const [editorStage, setEditorStage] = useState<PromptEditorStage>(initialInput || initialGoal?.promptMarkdown ? 'prompt' : 'goal');
  const [generateEnabled, setGenerateEnabled] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<ResearchModelProviderId | null>(
    researchProviderId(initialInput?.provider) ?? defaultProviderId ?? null
  );
  const providerSelectionInitializedRef = useRef(Boolean(initialInput?.provider));
  const modelSelectionInitializedRef = useRef(Boolean(initialInput?.model));
  const shellSafetyModeOptions = SHELL_SAFETY_MODE_OPTIONS.filter((option) => (
    option.value !== 'danger' || dangerModeEnabled || input.shellSafetyMode === 'danger'
  ));
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
  const configuredProviderModelCatalog = useMemo(
    () => providerModelCatalog.filter((catalog) => (
      providerOptions.some((provider) => provider.id === catalog.providerId && provider.configured)
    )),
    [providerModelCatalog, providerOptions]
  );
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

  const generateFullPrompt = (inputOverride?: StartRunInput): Promise<string | null> => {
    const sessionInput = inputOverride ?? inputRef.current;
    const draft = sessionInput.promptMarkdown.trim();
    if (!draft || generatingPrompt) return Promise.resolve(null);
    cancelPromptGeneration();
    const requestId = clientRequestId('research_prompt');
    const workflowId = sessionInput.workflowId ?? defaultWorkflowId;
    const sourceStage = editorStage;
    generationRequestIdRef.current = requestId;
    generationSourceTextRef.current = draft;
    setGenerationError(null);
    setInput(() => {
      const next = {
        ...sessionInput,
        workflowId,
        goalObjective: sourceStage === 'goal' ? draft : sessionInput.goalObjective,
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
      provider: researchProviderId(sessionInput.provider) ?? selectedProviderId ?? undefined,
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
    onSelectResearchGoalSuggestion(phase, sentence);
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
    const next = researchSettingsInput(
      initialInput,
      initialGoal?.phase ?? defaultWorkflowId,
      initialGoal,
      defaultShellSafetyMode
    );
    inputRef.current = next;
    setInput(next);
    const inflatedProvider = researchProviderId(initialInput?.provider);
    setSelectedProviderId(inflatedProvider ?? defaultProviderId ?? null);
    providerSelectionInitializedRef.current = Boolean(inflatedProvider);
    modelSelectionInitializedRef.current = Boolean(initialInput?.model);
    setEditorStage(initialInput || initialGoal?.promptMarkdown ? 'prompt' : 'goal');
    setGenerationError(null);
  }, [defaultProviderId, defaultShellSafetyMode, defaultWorkflowId, formIdentity, initialGoal, initialInput]);

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
    void Promise.resolve(onSubmit(startInput)).finally(() => setStartingRun(false));
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
    if (disableNoRepeat && normalizeRepeatSchedule(repeatSchedule).type === 'none') return;
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
    if (!nextCollaborator) return;
    update('collaboration', {
      ...collaboration,
      providers: enableCollaboratorAtTop(collaboration.providers, nextCollaborator)
    });
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

  const closeForm = (): void => {
    cancelPromptGeneration();
    onCancel();
  };

  if (formPresentation === 'session') {
    const initialModelSelection: ResearchModelSelection | undefined = selectedProviderId && selectedModel ? {
      provider: selectedProviderId,
      model: selectedModel.id,
      reasoningEffort: selectedEffort
    } : undefined;
    const startFromSessionComposer = (
      promptMarkdown: string,
      modelSelection: ResearchModelSelection,
      shellSafetyMode: ShellSafetyMode
    ): void => {
      const next: StartRunInput = {
        ...inputRef.current,
        promptMarkdown,
        provider: modelSelection.provider,
        model: modelSelection.model,
        reasoningEffort: inputValueForEffort(modelSelection.reasoningEffort),
        shellSafetyMode
      };
      inputRef.current = next;
      setInput(next);
      setSelectedProviderId(modelSelection.provider);
      if (generateEnabled) generateAndStart();
      else start();
    };

    return (
      <section className="main-trace-view main-commentary-view new-research-session-view" aria-label={title ?? 'New Research'}>
        <div className="main-commentary-scroll" aria-label="New research commentary">
          <div className="main-commentary-list">
            <NewResearchWelcome
              key={formIdentity}
              workspaceName={workspaceName}
              workflows={workflows}
              suggestions={researchGoalSuggestions}
              loading={researchGoalSuggestionsLoading}
              errors={researchGoalSuggestionErrors}
              visible={showSuggestions}
              onOpenWorkflow={(workflowId) => {
                selectWorkflow(workflowId);
                onLoadResearchGoalSuggestions(workflowId);
              }}
              onSelect={selectGoalSentence}
            />
          </div>
        </div>
        <MainSteerArea
          runId={null}
          detail={null}
          providerModelCatalog={configuredProviderModelCatalog}
          busy={busy || startingRun || generatingPrompt}
          initialModelSelection={initialModelSelection}
          initialSafetyMode={input.shellSafetyMode}
          initialInstruction={input.promptMarkdown}
          inputPlaceholder={newResearchPromptPlaceholder(generateEnabled)}
          safetyModeOptions={shellSafetyModeOptions}
          ariaLabel="Start new research"
          preComposerContent={(
            <div className="new-research-options-tray" aria-label="New research options">
              <div className="new-research-options-tray-left">
                <RepeatSchedulePicker
                  value={repeatSchedule}
                  disabled={generatingPrompt}
                  disableNoRepeat={disableNoRepeat}
                  onChange={selectRepeatSchedule}
                />
              </div>
              <div className="new-research-options-tray-right">
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
                {showAddContext ? (
                  <label
                    className="new-research-generate-toggle"
                    title="Add relevant workspace context to the objective before starting."
                  >
                    <input
                      type="checkbox"
                      checked={generateEnabled}
                      disabled={generatingPrompt}
                      onChange={(event) => setGenerateEnabled(event.target.checked)}
                    />
                    <span>Add Context</span>
                  </label>
                ) : null}
              </div>
            </div>
          )}
          postComposerContent={(
            <div className="new-research-collaboration-tray" aria-label="Collaboration settings">
              <div className="new-research-collaboration-dropdowns">
                <NestedSelectionPicker
                  className="new-research-collaboration-picker"
                  sections={[
                    {
                      id: 'collaboration-mode',
                      label: 'Mode',
                      value: collaboration.mode,
                      options: [
                        { value: 'solo', label: 'Solo' },
                        { value: 'adaptive', label: 'Adaptive' },
                        { value: 'always', label: 'Always Use Team' }
                      ],
                      onSelect: (value) => selectCollaborationMode(value as ResearchCollaborationMode)
                    },
                    {
                      id: 'collaboration-intensity',
                      label: 'Intensity',
                      value: collaboration.intensity,
                      options: [
                        { value: 'focused', label: 'Focused' },
                        { value: 'balanced', label: 'Balanced' },
                        { value: 'deep', label: 'Deep' }
                      ],
                      disabled: collaboration.mode === 'solo',
                      onSelect: (value) => selectCollaborationIntensity(value as ResearchCollaborationIntensity)
                    },
                    {
                      id: 'collaboration-rounds',
                      label: 'Challenge Rounds',
                      value: String(collaboration.peerChallengeRounds),
                      options: [
                        { value: '0', label: 'None' },
                        { value: '1', label: 'One' },
                        { value: '2', label: 'Two' },
                        { value: '3', label: 'Three' }
                      ],
                      disabled: collaboration.mode === 'solo',
                      onSelect: (value) => update('collaboration', {
                        ...collaboration,
                        peerChallengeRounds: Number(value)
                      })
                    }
                  ]}
                  triggerContent={(
                    <>
                      <Handshake className="new-research-collaboration-setting-icon" size={13} aria-hidden="true" />
                      <span className="model-selection-picker-model">Collaboration</span>
                      <ChevronDown className="model-selection-picker-trigger-chevron" size={13} aria-hidden="true" />
                    </>
                  )}
                  title="Collaboration settings"
                  ariaLabel="Collaboration settings"
                  disabled={generatingPrompt}
                />
              </div>
              <div className="new-research-collaborator-stack">
                {enabledCollaborators.map((preference, index) => {
                  const provider = providerOptions.find((candidate) => candidate.id === preference.provider);
                  const model = provider?.models.find((candidate) => candidate.id === preference.model) ?? null;
                  const oldest = index === enabledCollaborators.length - 1;
                  return (
                    <div className="new-research-collaborator-row" key={collaboratorKey(preference.provider, preference.model)}>
                      <ModelSelectionPicker
                        className="main-steer-model-selection-picker new-research-collaborator-picker"
                        providerValue={preference.provider}
                        modelValue={preference.model}
                        effortValue={preference.reasoningEffort}
                        title={`${provider?.label ?? preference.provider} collaborator settings`}
                        ariaLabel={`${provider?.label ?? preference.provider} collaborator model settings`}
                        disabled={generatingPrompt || collaboration.mode === 'solo'}
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
                      {oldest ? (
                        <button
                          type="button"
                          className="new-research-collaborator-add"
                          title={nextCollaborator ? 'Add collaborator' : 'No additional acknowledged collaborators are available'}
                          aria-label="Add collaborator"
                          disabled={!nextCollaborator || generatingPrompt || collaboration.mode === 'solo'}
                          onClick={addCollaborator}
                        >
                          <Plus size={16} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="new-research-collaborator-remove"
                          title={`Remove ${provider?.label ?? preference.provider} collaborator`}
                          aria-label={`Remove ${provider?.label ?? preference.provider} collaborator`}
                          disabled={generatingPrompt || collaboration.mode === 'solo'}
                          onClick={() => removeCollaborator(preference.provider, preference.model)}
                        >
                          <Minus size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {enabledCollaborators.length === 0 ? (
                  <div className="new-research-collaborator-row is-empty">
                    <button
                      type="button"
                      className="new-research-collaborator-add"
                      title={nextCollaborator ? 'Add collaborator' : 'No acknowledged collaborators are available'}
                      aria-label="Add collaborator"
                      disabled={!nextCollaborator || generatingPrompt || collaboration.mode === 'solo'}
                      onClick={addCollaborator}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )}
          onInitialInstruction={startFromSessionComposer}
          onCancel={closeForm}
          onSessionAction={() => undefined}
          onSteerInstruction={() => undefined}
        />
      </section>
    );
  }

  const primaryLabel = formPresentation === 'dialog' ? 'Start' : submitLabel;
  const actions = (
    <>
      {generateEnabled ? (
        <button type="button" disabled={busy || startingRun || !canGenerate} onClick={() => void generateFullPrompt()}>
          <Sparkles size={15} />
          Add Context
        </button>
      ) : null}
      <button
        className="primary-button"
        type="button"
        disabled={busy || startingRun || generatingPrompt || !canStart}
        onClick={generateEnabled ? generateAndStart : start}
      >
        {generateEnabled ? <Sparkles size={16} /> : formPresentation === 'dialog' ? <Play size={16} /> : null}
        {generateEnabled ? `Add Context & ${primaryLabel}` : primaryLabel}
      </button>
    </>
  );
  const content = (
      <div className={`start-run-modal-body research-settings-form-body ${showSuggestions ? '' : 'without-suggestions'}`.trim()}>
        <div className={`new-research-compose-layout ${showSuggestions ? '' : 'without-suggestions'}`.trim()}>
          <section className="new-research-composer" aria-label="Research objective composer" aria-busy={generatingPrompt}>
            <textarea
              ref={promptBoxRef}
              autoFocus={formPresentation === 'dialog'}
              value={input.promptMarkdown}
              disabled={generatingPrompt}
              placeholder={editorStage === 'goal'
                ? 'Describe the research outcome you want.'
                : 'Review and edit the enriched objective.'}
              aria-label={editorStage === 'goal' ? 'Research goal' : 'Research objective brief'}
              onChange={(event) => update('promptMarkdown', event.target.value)}
            />
            <div className="new-research-composer-feedback" aria-live="polite">
              {generatingPrompt ? 'Adding useful context…' : generationError ? `Could not add context: ${generationError}` : ''}
            </div>
            <div className="new-research-composer-actions">
              <FloatingTextPicker
                className={`new-research-safety-picker main-steer-safety-mode-picker mode-${input.shellSafetyMode}`}
                value={input.shellSafetyMode}
                options={shellSafetyModeOptions}
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
                disableNoRepeat={disableNoRepeat}
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
              {showAddContext ? (
                <label
                  className="new-research-generate-toggle"
                  title="Add relevant workspace context to the objective before starting."
                >
                  <input
                    type="checkbox"
                    checked={generateEnabled}
                    disabled={generatingPrompt}
                    onChange={(event) => setGenerateEnabled(event.target.checked)}
                  />
                  <span>Add Context</span>
                </label>
              ) : null}
            </div>
          </section>
          {showSuggestions ? (
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
          ) : null}
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
  );

  return formPresentation === 'dialog' ? (
    <Modal
      title={title ?? profilePresentation?.newResearchLabel ?? 'New Research'}
      wide
      className="start-run-dialog"
      onClose={closeForm}
      footer={actions}
    >
      {content}
    </Modal>
  ) : (
    <div className="research-settings-form" aria-label={title ?? 'Research settings'}>
      {content}
      <div className="research-settings-form-actions">{actions}</div>
    </div>
  );
}

function RepeatSchedulePicker({
  value,
  disabled,
  disableNoRepeat,
  onChange
}: {
  value: RepeatSchedule;
  disabled: boolean;
  disableNoRepeat: boolean;
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
    if (disableNoRepeat && type === 'none') return;
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
      className={`new-research-repeat-picker${schedule.type !== 'none' ? ' is-non-default' : ''}${open ? ' is-open' : ''}`}
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
                disabled={disableNoRepeat && type === 'none'}
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

function NewResearchWelcome({
  workspaceName,
  workflows,
  suggestions,
  loading,
  errors,
  visible,
  onOpenWorkflow,
  onSelect
}: {
  workspaceName: string;
  workflows: readonly ResearchProfileWorkflow[];
  suggestions: ResearchGoalSuggestionsByPhase;
  loading: ResearchGoalSuggestionStateByPhase<boolean>;
  errors: ResearchGoalSuggestionStateByPhase<string | null>;
  visible: boolean;
  onOpenWorkflow: (workflowId: ResearchGoalPhase) => void;
  onSelect: (sentence: string, workflowId: ResearchGoalPhase) => void;
}): JSX.Element {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<ResearchGoalPhase | null>(null);
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const suggestionLimit = selectedWorkflow
    ? Math.min(MAX_RENDERED_GOAL_SUGGESTIONS, Math.max(1, selectedWorkflow.goalSuggestionCount))
    : 3;

  return (
    <section className="new-research-welcome" aria-label={`New research for ${workspaceName}`}>
      <BealeWelcomeIcon />
      <h2>Let&apos;s research {workspaceName}</h2>
      {visible ? (
        selectedWorkflow ? (
          <div className="new-research-suggestion-panel">
            <SessionNextStepsWidget
              loading={loading[selectedWorkflow.id] ?? false}
              suggestions={suggestions[selectedWorkflow.id] ?? []}
              error={errors[selectedWorkflow.id] ?? null}
              title={null}
              suggestionLimit={suggestionLimit}
              onBack={() => setSelectedWorkflowId(null)}
              onSelect={(sentence) => onSelect(sentence, selectedWorkflow.id)}
            />
          </div>
        ) : (
          <div className="new-research-workflow-list" aria-label="Research suggestion categories">
            {workflows.map((workflow) => (
              <button
                type="button"
                className="new-research-workflow-option"
                aria-label={`${workflow.name}: ${workflow.description}`}
                onClick={() => {
                  setSelectedWorkflowId(workflow.id);
                  onOpenWorkflow(workflow.id);
                }}
                key={workflow.id}
              >
                <ResearchWorkflowIcon workflow={workflow} />
                <span>
                  <strong>{workflow.name}</strong>
                  <span>{workflow.description}</span>
                </span>
                <ArrowRight className="new-research-workflow-arrow" size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}

function ResearchWorkflowIcon({ workflow }: { workflow: ResearchProfileWorkflow }): JSX.Element {
  const identity = `${workflow.id} ${workflow.name}`.toLowerCase();
  if (identity.includes('discover')) return <Compass size={19} aria-hidden="true" />;
  if (identity.includes('chain')) return <Waypoints size={19} aria-hidden="true" />;
  if (identity.includes('report')) return <FileText size={19} aria-hidden="true" />;
  if (identity.includes('longshot')) return <Telescope size={19} aria-hidden="true" />;
  return <Lightbulb size={19} aria-hidden="true" />;
}

export function defaultResearchWorkflowId(workflows: readonly ResearchProfileWorkflow[]): string {
  return workflows.find((workflow) => workflow.id === 'discovery')?.id
    ?? workflows.find((workflow) => workflow.default)?.id
    ?? workflows[0]?.id
    ?? 'discovery';
}

export function researchSettingsInput(
  initialInput: StartRunInput | undefined,
  initialWorkflowId: string,
  initialGoal: ResearchGoalSeed | null,
  defaultShellSafetyMode: ShellSafetyMode = DEFAULT_SHELL_SAFETY_MODE
): StartRunInput {
  if (initialInput) {
    return {
      ...defaultRunInput,
      ...initialInput,
      provider: initialInput.provider,
      workflowId: initialInput.workflowId ?? initialWorkflowId,
      collaboration: initialInput.collaboration
        ? normalizeResearchCollaboration(initialInput.collaboration)
        : normalizeResearchCollaboration(defaultRunInput.collaboration),
      budget: {
        ...defaultRunInput.budget,
        ...initialInput.budget,
        repeatSchedule: normalizeRepeatSchedule(initialInput.budget.repeatSchedule)
      }
    };
  }
  return {
    ...defaultRunInput,
    shellSafetyMode: defaultShellSafetyMode,
    workflowId: initialGoal?.phase ?? initialWorkflowId,
    goalObjective: initialGoal?.sentence ?? null,
    promptMarkdown: initialGoal?.promptMarkdown ?? initialGoal?.sentence ?? '',
    sandboxProfile: 'host',
    budget: { ...defaultRunInput.budget },
    collaboration: normalizeResearchCollaboration(defaultRunInput.collaboration)
  };
}

function researchProviderId(value: string | null | undefined): ResearchModelProviderId | null {
  if (value === 'openai-codex' || value === 'anthropic' || value === 'xai' || value === 'zai' || value === 'openrouter') return value;
  return null;
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
