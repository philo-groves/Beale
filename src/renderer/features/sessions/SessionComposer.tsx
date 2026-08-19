import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ArrowRight, Square } from 'lucide-react';
import type {
  ApprovalRecord,
  PolicyReviewDecision,
  ResearchModelEffortLevel,
  ResearchModelProviderId,
  ResearchModelSelection,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  RunDetail,
  ShellSafetyMode,
  SteeringAction
} from '@shared/types';
import { ModelSelectionPicker } from '../../app/ModelSelectionPicker';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { CenteredLoadingState } from '../../app/CenteredLoadingState';
import { researchModelNameLabel } from '../../lib/formatting';
import { normalizeShellSafetyMode, SHELL_SAFETY_MODE_OPTIONS } from '../../../shared/shellSafety';
export { SHELL_SAFETY_MODE_OPTIONS } from '../../../shared/shellSafety';
import {
  steeringInputSuggestion,
  steeringInputTabAction,
  steeringSuggestionAutoVisible
} from '../../view-models/steeringSuggestions';
import { ShellApprovalQuestion } from './ShellApprovalModal';

export const STEER_TEXTAREA_MAX_LINES = 7;
export const STEER_TEXTAREA_DEFAULT_EXTRA_LINES = 1;
const STEER_ACTION_ROW_HEIGHT = 35;
const STEER_COMPOSER_ROW_GAP = 0;

export function SessionLoadingState({ label }: { label: string }): JSX.Element {
  return <CenteredLoadingState className="main-session-loading" label={label} />;
}

export const MainSteerArea = memo(function MainSteerArea({
  runId,
  detail,
  providerModelCatalog,
  busy,
  shellApproval = null,
  shellApprovalBusy = false,
  initialModelSelection,
  initialSuggestion,
  responseSuggestionsEnabled = true,
  onInitialInstruction,
  onShellApprovalDecision = () => undefined,
  onSessionAction,
  onSteerInstruction
}: {
  runId: string | null;
  detail: RunDetail | null;
  providerModelCatalog: ResearchProviderModelCatalog[];
  busy: boolean;
  shellApproval?: ApprovalRecord | null;
  shellApprovalBusy?: boolean;
  initialModelSelection?: ResearchModelSelection;
  initialSuggestion?: string;
  responseSuggestionsEnabled?: boolean;
  onInitialInstruction?: (
    instruction: string,
    modelSelection: ResearchModelSelection,
    shellSafetyMode: ShellSafetyMode
  ) => void;
  onShellApprovalDecision?: (decision: PolicyReviewDecision) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element {
  const [instruction, setInstruction] = useState('');
  const [tabSuggestionVisible, setTabSuggestionVisible] = useState(false);
  const runProviderId = runModelProvider(detail, providerModelCatalog);
  const initialProviderId = detail ? runProviderId : initialModelSelection?.provider ?? runProviderId;
  const initialProvider = providerModelCatalog.find((catalog) => catalog.providerId === initialProviderId)
    ?? providerModelCatalog.find((catalog) => catalog.models.length > 0)
    ?? null;
  const initialModel = initialProvider?.models.find((model) => model.id === initialModelSelection?.model)
    ?? initialProvider?.models[0]
    ?? null;
  const [selectedProviderId, setSelectedProviderId] = useState<ResearchModelProviderId>(initialProvider?.providerId ?? runProviderId);
  const [selectedModelId, setSelectedModelId] = useState(detail?.run.model ?? initialModel?.id ?? '');
  const [selectedEffort, setSelectedEffort] = useState<ResearchModelEffortLevel>(() => detail
    ? researchEffort(detail.run.reasoningEffort)
    : preferredResearchEffort(initialModel?.effortLevels ?? [], initialModelSelection?.reasoningEffort ?? 'high'));
  const [initialShellSafetyMode, setInitialShellSafetyMode] = useState<ShellSafetyMode>(() =>
    normalizeShellSafetyMode(detail?.run.shellSafetyMode)
  );
  const footerRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedRunIdRef = useRef<string | null>(null);
  const trimmedInstruction = instruction.trim();
  const disabled = busy || (!runId && !onInitialInstruction) || !trimmedInstruction || !selectedModelId;
  const status = detail?.run.status ?? null;
  const steeringSuggestion = responseSuggestionsEnabled
    ? initialSuggestion ?? steeringInputSuggestion(detail)
    : null;
  const suggestionShowing = Boolean(
    steeringSuggestion && (initialSuggestion || tabSuggestionVisible || steeringSuggestionAutoVisible(status))
  );
  const shellSafetyMode = detail
    ? normalizeShellSafetyMode(detail.run.shellSafetyMode)
    : initialShellSafetyMode;
  const sessionControlsDisabled = busy || !runId;
  const composerControlsDisabled = busy || (!runId && !onInitialInstruction);
  const fallbackModel = detail ? fallbackResearchModel(detail.run.model, researchEffort(detail.run.reasoningEffort)) : null;
  const providerOptions = detail && !providerModelCatalog.some((catalog) => catalog.providerId === runProviderId)
    ? [
        ...providerModelCatalog,
        {
          providerId: runProviderId,
          providerName: researchProviderLabel(runProviderId, runProviderId),
          models: fallbackModel ? [fallbackModel] : []
        }
      ]
    : providerModelCatalog;
  const providerCatalog = providerOptions.find((catalog) => catalog.providerId === selectedProviderId) ?? null;
  const modelOptions = providerCatalog?.models.length
    ? providerCatalog.models
    : fallbackModel && selectedProviderId === runProviderId ? [fallbackModel] : [];
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId) ?? modelOptions[0] ?? null;
  const modelSelection: ResearchModelSelection = {
    provider: selectedProviderId,
    model: selectedModel?.id ?? detail?.run.model ?? '',
    reasoningEffort: selectedEffort
  };

  useEffect(() => {
    if (!detail) {
      const nextProvider = providerModelCatalog.find((catalog) => catalog.providerId === initialModelSelection?.provider)
        ?? providerModelCatalog.find((catalog) => catalog.models.length > 0);
      const nextModel = nextProvider?.models.find((model) => model.id === initialModelSelection?.model)
        ?? nextProvider?.models[0];
      if (!nextProvider || !nextModel) return;
      setSelectedProviderId(nextProvider.providerId);
      setSelectedModelId(nextModel.id);
      setSelectedEffort((current) => preferredResearchEffort(
        nextModel.effortLevels,
        initialModelSelection?.reasoningEffort ?? (current === 'off' ? 'high' : current)
      ));
      return;
    }
    const nextModel = providerModelCatalog
      .find((catalog) => catalog.providerId === runModelProvider(detail, providerModelCatalog))
      ?.models.find((model) => model.id === detail.run.model);
    const nextEffort = preferredResearchEffort(
      nextModel?.effortLevels ?? [researchEffort(detail.run.reasoningEffort)],
      researchEffort(detail.run.reasoningEffort)
    );
    setSelectedProviderId(runModelProvider(detail, providerModelCatalog));
    setSelectedModelId(nextModel?.id ?? detail.run.model);
    setSelectedEffort(nextEffort);
  }, [
    detail?.run.id,
    detail?.run.model,
    detail?.run.reasoningEffort,
    initialModelSelection?.model,
    initialModelSelection?.provider,
    initialModelSelection?.reasoningEffort,
    providerModelCatalog
  ]);

  useEffect(() => setTabSuggestionVisible(false), [runId, status, steeringSuggestion]);

  const resizeTextarea = useCallback((): void => {
    const textarea = textareaRef.current;
    const footer = footerRef.current;
    if (!textarea || !footer) return;
    textarea.style.height = '0px';
    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 16;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const baseMinHeight = Number.parseFloat(computedStyle.minHeight) || 44;
    const minHeight = baseMinHeight + lineHeight * STEER_TEXTAREA_DEFAULT_EXTRA_LINES;
    const maxHeight = lineHeight * STEER_TEXTAREA_MAX_LINES + paddingTop + paddingBottom;
    const nextHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    const nextFooterHeight = nextHeight + STEER_ACTION_ROW_HEIGHT + STEER_COMPOSER_ROW_GAP;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    const sessionView = footer.parentElement;
    sessionView?.style.removeProperty('--trace-footer-height');
    sessionView?.style.setProperty('--trace-footer-content-height', `${nextFooterHeight}px`);
  }, []);

  useLayoutEffect(() => resizeTextarea(), [instruction, resizeTextarea, shellApproval, status]);
  useEffect(() => {
    window.addEventListener('resize', resizeTextarea);
    return () => window.removeEventListener('resize', resizeTextarea);
  }, [resizeTextarea]);
  useEffect(() => {
    if (!runId || focusedRunIdRef.current === runId) return undefined;
    focusedRunIdRef.current = runId;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [runId]);

  const submit = (): void => {
    if (disabled) return;
    if (runId) onSteerInstruction(runId, trimmedInstruction, modelSelection);
    else onInitialInstruction?.(trimmedInstruction, modelSelection, shellSafetyMode);
    setInstruction('');
    setTabSuggestionVisible(false);
  };

  if (shellApproval) {
    return <ShellApprovalQuestion approval={shellApproval} busy={shellApprovalBusy} onDecision={onShellApprovalDecision} />;
  }

  const sessionActive = status === 'active';
  const placeholder = suggestionShowing && steeringSuggestion
    ? steeringSuggestion
    : sessionActive ? 'Steer the research' : 'Your move';

  return (
    <footer className="main-trace-footer" ref={footerRef} aria-label="Steer research session">
      <div className="main-steer-input-row without-trace-filters">
        <textarea
          ref={textareaRef}
          rows={1}
          value={instruction}
          placeholder={placeholder}
          onChange={(event) => {
            setInstruction(event.target.value);
            setTabSuggestionVisible(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
              const action = steeringInputTabAction({ instruction, suggestion: steeringSuggestion, suggestionShowing });
              if (action !== 'none') {
                event.preventDefault();
                if (action === 'accept_suggestion' && steeringSuggestion) {
                  setInstruction(steeringSuggestion);
                  setTabSuggestionVisible(false);
                } else {
                  setTabSuggestionVisible(true);
                }
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <FloatingTextPicker
          className={`main-steer-safety-mode-picker mode-${shellSafetyMode}`}
          value={shellSafetyMode}
          options={SHELL_SAFETY_MODE_OPTIONS}
          title="Shell safety mode"
          ariaLabel="Shell safety mode"
          disabled={busy || status === 'paused' || (!runId && !onInitialInstruction)}
          onChange={(value) => {
            const nextMode = normalizeShellSafetyMode(value);
            if (nextMode === shellSafetyMode) return;
            if (!runId) setInitialShellSafetyMode(nextMode);
            else onSessionAction({ type: 'set_shell_safety_mode', runId, shellSafetyMode: nextMode });
          }}
        />
        <ModelSelectionPicker
          className="main-steer-model-selection-picker"
          providerValue={selectedProviderId}
          modelValue={selectedModel?.id ?? ''}
          effortValue={selectedEffort}
          title="Model settings for the next agent turn"
          ariaLabel="Model settings for the next agent turn"
          disabled={!selectedModel || composerControlsDisabled}
          providerOptions={providerOptions.map((provider) => ({
            value: provider.providerId,
            label: researchProviderLabel(provider.providerId, provider.providerName),
            disabled: provider.models.length === 0
          }))}
          modelOptions={modelOptions.map((model) => ({ value: model.id, label: researchModelNameLabel(selectedProviderId, model.name) }))}
          effortOptions={(selectedModel?.effortLevels ?? []).map((effort) => ({ value: effort, label: researchEffortLabel(effort) }))}
          onSelectProvider={(value) => {
            const providerId = value as ResearchModelProviderId;
            const nextProvider = providerOptions.find((provider) => provider.providerId === providerId);
            const nextModel = nextProvider?.models.find((model) => model.id === selectedModelId) ?? nextProvider?.models[0];
            if (!nextModel) return;
            setSelectedProviderId(providerId);
            setSelectedModelId(nextModel.id);
            setSelectedEffort((current) => preferredResearchEffort(nextModel.effortLevels, current));
          }}
          onSelectModel={(value) => {
            const model = modelOptions.find((candidate) => candidate.id === value);
            if (!model) return;
            setSelectedModelId(model.id);
            setSelectedEffort((current) => preferredResearchEffort(model.effortLevels, current));
          }}
          onSelectEffort={(value) => setSelectedEffort(value as ResearchModelEffortLevel)}
        />
        {sessionActive ? (
          <button
            type="button"
            className="main-steer-send main-steer-stop"
            title="Stop session"
            aria-label="Stop session"
            disabled={sessionControlsDisabled}
            onClick={() => runId && onSessionAction({ type: 'stop', runId, note: 'Stop requested from session composer.' })}
          >
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button type="button" className="main-steer-send" title="Send steering instruction" aria-label="Send steering instruction" disabled={disabled} onClick={submit}>
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </footer>
  );
});

function runModelProvider(detail: RunDetail | null, catalogs: ResearchProviderModelCatalog[]): ResearchModelProviderId {
  const stored = detail?.run.budget.modelProvider;
  if (stored === 'openai-codex' || stored === 'anthropic' || stored === 'xai' || stored === 'zai' || stored === 'openrouter') return stored;
  const matchingCatalog = catalogs.find((catalog) => catalog.models.some((model) => model.id === detail?.run.model));
  return matchingCatalog?.providerId ?? 'openai-codex';
}

function researchEffort(value: string | undefined): ResearchModelEffortLevel {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max') return value;
  return 'off';
}

function preferredResearchEffort(levels: ResearchModelEffortLevel[], current: ResearchModelEffortLevel): ResearchModelEffortLevel {
  if (levels.includes(current)) return current;
  if (levels.includes('high')) return 'high';
  return levels[0] ?? 'off';
}

function fallbackResearchModel(model: string, effort: ResearchModelEffortLevel): ResearchProviderModel {
  return { id: model, name: model, reasoning: effort !== 'off', effortLevels: [effort], contextWindow: 0, maxTokens: 0 };
}

function researchProviderLabel(providerId: ResearchModelProviderId, fallback: string): string {
  if (providerId === 'openai-codex') return 'OpenAI (Codex)';
  if (providerId === 'anthropic') return 'Anthropic (Claude)';
  if (providerId === 'xai') return 'xAI (Grok/X)';
  return fallback;
}

function researchEffortLabel(effort: ResearchModelEffortLevel): string {
  if (effort === 'xhigh') return 'XHigh';
  return `${effort.slice(0, 1).toUpperCase()}${effort.slice(1)}`;
}
