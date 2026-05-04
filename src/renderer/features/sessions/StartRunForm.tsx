import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Play, ShieldAlert, Sparkles, X } from 'lucide-react';
import type { ExecutorStatus, StartRunInput, VmPreference, WorkspaceSnapshot } from '@shared/types';
import { Modal } from '../../app/Modal';
import { userFacingErrorMessage } from '../../lib/errors';
import { networkProfileLabel } from '../../lib/formatting';
import { findBackendByKind } from '../../view-models/environmentDisplay';
import {
  clientRequestId,
  defaultRunInput,
  optionalPositiveInteger,
  UNBOUNDED_MINUTES
} from '../../view-models/runSettings';

const NETWORK_PROFILE_OPTIONS = ['offline', 'scoped', 'elevated'] as const;
const PROMPT_STREAM_RENDER_INTERVAL_MS = 90;

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
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [autoStartAfterGeneration, setAutoStartAfterGeneration] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [startingRun, setStartingRun] = useState(false);
  const promptBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef(input);
  const autoStartAfterGenerationRef = useRef(false);
  const generationRequestIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const promptStreamAutoScrollRef = useRef(false);
  const pendingPromptMarkdownRef = useRef<string | null>(null);
  const promptStreamFlushTimerRef = useRef<number | null>(null);

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
      if (current.promptMarkdown === promptMarkdown) return current;
      const next = { ...current, promptMarkdown };
      inputRef.current = next;
      return next;
    });
  };

  const clearPendingPromptStream = (): void => {
    pendingPromptMarkdownRef.current = null;
    if (promptStreamFlushTimerRef.current !== null) {
      window.clearTimeout(promptStreamFlushTimerRef.current);
      promptStreamFlushTimerRef.current = null;
    }
  };

  useEffect(() => {
    setInput((current) => {
      const next = { ...current, networkProfile: 'elevated', sandboxProfile };
      inputRef.current = next;
      return next;
    });
  }, [sandboxProfile, snapshot.activeScope.id]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    const unsubscribe = window.beale.onResearchPromptGenerationUpdate((update) => {
      if (!mountedRef.current || generationRequestIdRef.current !== update.requestId) return;
      pendingPromptMarkdownRef.current = update.promptMarkdown;
      if (promptStreamFlushTimerRef.current !== null) return;
      promptStreamFlushTimerRef.current = window.setTimeout(flushPendingPromptStream, PROMPT_STREAM_RENDER_INTERVAL_MS);
    });
    return () => {
      unsubscribe();
      mountedRef.current = false;
      clearPendingPromptStream();
      const requestId = generationRequestIdRef.current;
      if (requestId) {
        void window.beale.cancelResearchPromptGeneration(requestId);
      }
    };
  }, []);

  const update = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]): void => {
    if (key === 'promptMarkdown') promptStreamAutoScrollRef.current = false;
    setInput((current) => {
      const next = { ...current, [key]: value };
      inputRef.current = next;
      return next;
    });
    if (key === 'promptMarkdown') setGenerateError(null);
  };

  useLayoutEffect(() => {
    if (!generatingPrompt || !promptStreamAutoScrollRef.current) return;
    const promptBox = promptBoxRef.current;
    if (!promptBox) return;
    promptBox.scrollTop = promptBox.scrollHeight;
  }, [generatingPrompt, input.promptMarkdown]);

  const updateBudget = (key: keyof StartRunInput['budget'], value: number): void => {
    setInput((current) => {
      const next = { ...current, budget: { ...current.budget, [key]: value } };
      inputRef.current = next;
      return next;
    });
  };
  const minuteLimitValue = input.budget.maxMinutes >= UNBOUNDED_MINUTES ? '' : String(input.budget.maxMinutes);
  const openAiBlocked = input.runEngine === 'openai_responses' && !snapshot.openAi.configured;
  const hasPromptDraft = input.promptMarkdown.trim().length > 0;
  const canStart = hasPromptDraft && !openAiBlocked;
  const promptGenerationLabel = hasPromptDraft ? 'Refine' : 'Generate';

  const updateAutoStartAfterGeneration = (checked: boolean): void => {
    autoStartAfterGenerationRef.current = checked;
    setAutoStartAfterGeneration(checked);
  };

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

  const cancelGeneratePrompt = (): void => {
    const requestId = generationRequestIdRef.current;
    if (!requestId) return;
    generationRequestIdRef.current = null;
    setGeneratingPrompt(false);
    updateAutoStartAfterGeneration(false);
    clearPendingPromptStream();
    void window.beale.cancelResearchPromptGeneration(requestId);
  };

  const generatePrompt = (): void => {
    if (generatingPrompt) {
      cancelGeneratePrompt();
      return;
    }
    const requestId = clientRequestId('research_prompt');
    const draftPromptMarkdown = input.promptMarkdown;
    const operation = draftPromptMarkdown.trim().length > 0 ? 'refine' : 'generate';
    generationRequestIdRef.current = requestId;
    promptStreamAutoScrollRef.current = true;
    updateAutoStartAfterGeneration(false);
    setGeneratingPrompt(true);
    setGenerateError(null);
    void window.beale
      .generateResearchPrompt({
        requestId,
        operation,
        draftPromptMarkdown: operation === 'refine' ? draftPromptMarkdown : null,
        mode: input.mode,
        attemptStrategy: input.attemptStrategy,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        networkProfile: input.networkProfile,
        sandboxProfile: input.sandboxProfile,
        targetAssetId: input.targetAssetId ?? null,
        targetPath: input.targetPath ?? null
      })
      .then((generated) => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        clearPendingPromptStream();
        const nextInput = { ...inputRef.current, promptMarkdown: generated.promptMarkdown };
        inputRef.current = nextInput;
        setInput(nextInput);
        if (autoStartAfterGenerationRef.current && nextInput.promptMarkdown.trim().length > 0 && !(nextInput.runEngine === 'openai_responses' && !snapshot.openAi.configured)) {
          startWithInput(nextInput);
        }
      })
      .catch((caught: unknown) => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        const message = userFacingErrorMessage(caught);
        if (!/canceled/i.test(message)) {
          setGenerateError(message);
        }
      })
      .finally(() => {
        if (!mountedRef.current || generationRequestIdRef.current !== requestId) return;
        generationRequestIdRef.current = null;
        setGeneratingPrompt(false);
      });
  };

  const closeModal = (): void => {
    cancelGeneratePrompt();
    onCancel();
  };

  return (
    <Modal
      title="New Research"
      wide
      onClose={closeModal}
      footer={
        <>
          <div className="modal-footer-leading generate-prompt-footer">
            <button type="button" className="generate-prompt-button" disabled={!generatingPrompt && (busy || openAiBlocked)} onClick={generatePrompt}>
              {generatingPrompt ? <X size={16} /> : <Sparkles size={16} />}
              {generatingPrompt ? 'Cancel' : promptGenerationLabel}
            </button>
            {generatingPrompt ? (
              <div className="generate-prompt-status-stack">
                <span className="generate-prompt-status">Generating plan, thinking may take several minutes...</span>
                <label className="generate-prompt-auto-start">
                  <input
                    type="checkbox"
                    checked={autoStartAfterGeneration}
                    onChange={(event) => updateAutoStartAfterGeneration(event.target.checked)}
                  />
                  <span>Auto-start after generation</span>
                </label>
              </div>
            ) : null}
          </div>
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
        {generateError ? (
          <div className="generate-prompt-error-box" role="alert">
            <ShieldAlert size={15} />
            <div>
              <strong>Could not generate plan</strong>
              <p>{generateError}</p>
            </div>
          </div>
        ) : null}
        <textarea
          ref={promptBoxRef}
          className="prompt-box"
          rows={6}
          placeholder="Enter a prompt or press Generate."
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
          <div className="form-grid">
            <label>
              Minutes
              <input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={minuteLimitValue}
                onChange={(event) => updateBudget('maxMinutes', optionalPositiveInteger(event.target.value, UNBOUNDED_MINUTES))}
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
              <input value={input.model} onChange={(event) => update('model', event.target.value)} />
            </label>
            <label>
              Reasoning
              <input value={input.reasoningEffort} onChange={(event) => update('reasoningEffort', event.target.value)} />
            </label>
          </div>
        </details>
      </div>
    </Modal>
  );
}

function preferredSandboxProfile(executor: ExecutorStatus | null, vmPreference: VmPreference): string {
  const selectedBackend = findBackendByKind(executor, vmPreference.backendKind);
  return vmPreference.enabled && selectedBackend?.available && executor?.available === true ? 'local_disposable_vm' : 'host_research_only';
}
