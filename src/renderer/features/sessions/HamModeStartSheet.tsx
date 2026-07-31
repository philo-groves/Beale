import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Loader2, Radio } from 'lucide-react';
import type { HamModeGenerationUpdate, HamModeState } from '@shared/types';
import { BottomSheet } from '../../app/Modal';
import { renderTraceProseText } from '../traces/traceMarkup';

export function HamModeStartSheet({
  busy,
  hamMode,
  generationUpdate,
  onClose,
  onStart
}: {
  busy: boolean;
  hamMode: HamModeState;
  generationUpdate: HamModeGenerationUpdate | null;
  onClose: () => void;
  onStart: (promptGuidance: string) => void;
}): JSX.Element {
  const [promptGuidance, setPromptGuidance] = useState(hamMode.promptGuidance);
  const guidanceRef = useRef<HTMLTextAreaElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const promptPreviewRef = useRef<HTMLElement | null>(null);
  const started = hamMode.enabled;
  const working = started && ['exploring_subsystem', 'closing_candidates', 'reviewing_research', 'starting_session'].includes(hamMode.phase);
  const status = hamMode.lastError
    ? hamModeStatus(hamMode)
    : generationUpdate?.reasoningSummary?.trim() || hamModeStatus(hamMode);
  const generatedPrompt = generationUpdate?.promptMarkdown.trim() ?? '';

  useEffect(() => {
    if (!started) guidanceRef.current?.focus();
  }, [started]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const promptPreview = promptPreviewRef.current;
      if (promptPreview) promptPreview.scrollTop = promptPreview.scrollHeight;
      const sheetScroller = sheetRef.current?.closest('.modal-body');
      if (sheetScroller instanceof HTMLElement) sheetScroller.scrollTop = sheetScroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [generatedPrompt, generationUpdate?.reasoningSummary, generationUpdate?.requestId]);

  return (
    <BottomSheet title="Start HAM Mode" wide onClose={onClose}>
      <div ref={sheetRef} className="ham-mode-start-sheet">
        <label className="ham-mode-guidance">
          <span>Prompt Guidance <small>Optional</small></span>
          <textarea
            ref={guidanceRef}
            rows={4}
            maxLength={6000}
            placeholder="Describe the research direction, surfaces, or constraints you want HAM Mode to favor."
            value={promptGuidance}
            disabled={started}
            onChange={(event) => setPromptGuidance(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={`primary-button ham-mode-start-button ${started ? 'is-running' : ''}`}
          aria-pressed={started}
          disabled={busy || started}
          onClick={() => onStart(promptGuidance)}
        >
          {working ? <Loader2 className="ham-mode-spinner" size={16} /> : <Radio size={16} />}
          Go HAM
        </button>
        <section className="ham-mode-generation-status" aria-live="polite">
          <div className="ham-mode-generation-heading">
            <span>{generationUpdate?.phase === 'exploration' ? 'Exploration Status' : generationUpdate?.phase === 'closure' ? 'Closure Status' : 'Agent Status'}</span>
            {working ? <Loader2 className="ham-mode-spinner" size={14} /> : null}
          </div>
          <div className="ham-mode-reasoning-summary">
            {renderTraceProseText(status, 'reasoning')}
          </div>
        </section>
        <section className="ham-mode-exploration-candidates" aria-label="Exploration candidates">
          <div className="ham-mode-generation-heading">
            <span>Exploration Candidates</span>
            {hamMode.lastExploration ? <span>{hamMode.lastExploration.subsystemTitle}</span> : null}
          </div>
          {hamMode.lastExploration ? (
            <div className="ham-mode-candidate-list">
              {hamMode.lastExploration.candidates.map((candidate) => (
                <article key={`${candidate.rank}:${candidate.candidateKey}`} className={`ham-mode-candidate ${candidate.survivedPreliminaryReview ? 'survived' : 'rejected'}`}>
                  <div>
                    <strong>{candidate.rank}. {candidate.title}</strong>
                    <span>{candidate.survivedPreliminaryReview ? 'Survived' : 'Rejected'}</span>
                  </div>
                  <p>{candidate.survivedPreliminaryReview
                    ? candidate.preliminaryReviewSummary
                    : candidate.hostRejectionReasons.join(' ') || candidate.preliminaryReviewSummary}</p>
                </article>
              ))}
            </div>
          ) : <div className="ham-mode-candidate-empty">Ranked candidates will appear after exploration.</div>}
        </section>
        <section ref={promptPreviewRef} className="ham-mode-prompt-preview" aria-live="polite">
          <div className="ham-mode-generation-heading">
            <span>Generated Prompt</span>
            {working && !generatedPrompt ? <span>Waiting for draft…</span> : null}
          </div>
          <div className={`ham-mode-prompt-content ${generatedPrompt ? '' : 'empty'}`}>
            {generatedPrompt
              ? renderTraceProseText(generatedPrompt, 'agent_output')
              : 'The generated research prompt will stream here.'}
          </div>
        </section>
      </div>
    </BottomSheet>
  );
}

function hamModeStatus(state: HamModeState): string {
  if (state.phase === 'error') return state.lastError || 'HAM Mode could not prepare the next research session.';
  if (state.phase === 'retrying_session') return state.lastError
    ? `The current session failed and HAM Mode is waiting to retry it: ${state.lastError}`
    : 'The current session failed and HAM Mode is waiting to retry it.';
  if (state.phase === 'session_active') return 'The HAM research session has started.';
  if (state.phase === 'starting_session') return 'The prompt is ready. Starting the next research session…';
  if (state.phase === 'exploring_subsystem') return 'Exploring one bounded underexplored subsystem and ranking candidates…';
  if (state.phase === 'closing_candidates') return 'Closing only the candidates that survived preliminary review…';
  if (state.phase === 'reviewing_research') return 'Reviewing the previous transcript and subject memories…';
  if (state.enabled) return state.activeRunId
    ? 'Waiting for the current session to end naturally before preparing the next prompt.'
    : 'Preparing to review the prior research context…';
  return state.lastError
    ? `HAM Mode stopped after an error: ${state.lastError}`
    : 'Add optional guidance, then start HAM Mode.';
}
