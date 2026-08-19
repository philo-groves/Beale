import { memo, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ArrowRight, Lightbulb } from 'lucide-react';
import type { ResearchGoalPhase, RunDetail, RunStatus, SessionNextPromptSuggestion } from '@shared/types';

const NEXT_STEP_COUNT = 3;
const EMPTY_SESSION_PROMPTS: readonly SessionNextPromptSuggestion[] = [];

export interface ResearchGoalSeed {
  sentence: string;
  phase: ResearchGoalPhase;
  promptMarkdown?: string;
}

export function isEndedResearchRunStatus(status: RunStatus): boolean {
  return status === 'blocked' || status === 'completed' || status === 'failed' || status === 'stopped';
}

export const SessionNextSteps = memo(function SessionNextSteps({
  detail,
  onSelect
}: {
  detail: RunDetail;
  onSelect: (goal: ResearchGoalSeed) => void;
}): JSX.Element | null {
  const workflowId = sessionWorkflowId(detail);
  const cacheKey = `${detail.run.id}:${detail.run.endedAt ?? ''}:${detail.run.summary.length}:${detail.run.finalDisposition?.outcome ?? ''}`;
  const persistedSuggestions = detail.nextStepSuggestions?.phase === workflowId
    ? detail.nextStepSuggestions.suggestions
    : null;
  const persistedPrompts = detail.nextStepSuggestions?.phase === workflowId
    ? detail.nextStepSuggestions.promptSuggestions ?? EMPTY_SESSION_PROMPTS
    : EMPTY_SESSION_PROMPTS;
  const [state, setState] = useState<{
    cacheKey: string;
    loading: boolean;
    suggestions: readonly string[];
    promptSuggestions: readonly SessionNextPromptSuggestion[];
    error: string | null;
  }>(() => ({
    cacheKey,
    loading: persistedSuggestions === null,
    suggestions: persistedSuggestions ?? [],
    promptSuggestions: persistedPrompts,
    error: workflowId ? null : 'This session does not have a research workflow.'
  }));

  useEffect(() => {
    if (persistedSuggestions) {
      setState({ cacheKey, loading: false, suggestions: persistedSuggestions, promptSuggestions: persistedPrompts, error: null });
      return undefined;
    }
    if (!workflowId) {
      setState({
        cacheKey,
        loading: false,
        suggestions: [],
        promptSuggestions: [],
        error: 'This session does not have a research workflow.'
      });
      return undefined;
    }

    let cancelled = false;
    setState({ cacheKey, loading: true, suggestions: [], promptSuggestions: [], error: null });
    void window.beale.generateResearchGoalSuggestions({
      phase: workflowId,
      sourceRunId: detail.run.id
    })
      .then((result) => {
        if (cancelled) return;
        setState({
          cacheKey,
          loading: false,
          suggestions: result.suggestions,
          promptSuggestions: result.promptSuggestions ?? [],
          error: null
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        if (!/canceled/i.test(message)) {
          setState({ cacheKey, loading: false, suggestions: [], promptSuggestions: [], error: message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, detail.run.id, persistedPrompts, persistedSuggestions, workflowId]);

  const currentState = state.cacheKey === cacheKey
    ? state
    : persistedSuggestions
      ? { cacheKey, loading: false, suggestions: persistedSuggestions, promptSuggestions: persistedPrompts, error: null }
      : {
          cacheKey,
          loading: true,
          suggestions: [] as readonly string[],
          promptSuggestions: [] as readonly SessionNextPromptSuggestion[],
          error: workflowId ? null : 'This session does not have a research workflow.'
        };

  return (
    <SessionNextStepsWidget
      loading={currentState.loading}
      suggestions={currentState.suggestions}
      error={currentState.error}
      onSelect={(sentence) => {
        if (!workflowId) return;
        const promptMarkdown = currentState.promptSuggestions.find((suggestion) => suggestion.title === sentence)?.promptMarkdown;
        onSelect({ sentence, phase: workflowId, ...(promptMarkdown ? { promptMarkdown } : {}) });
      }}
    />
  );
});

export const SessionNextStepsWidget = memo(function SessionNextStepsWidget({
  loading,
  suggestions,
  error,
  onSelect
}: {
  loading: boolean;
  suggestions: readonly string[];
  error: string | null;
  onSelect: (sentence: string) => void;
}): JSX.Element {
  const visibleSuggestions = useMemo(() => suggestions.slice(0, NEXT_STEP_COUNT), [suggestions]);
  return (
    <section className="session-next-steps" aria-label="Suggestions" aria-busy={loading}>
      <header className="session-next-steps-header">
        <h3>Suggestions</h3>
      </header>
      <div className="session-next-steps-list">
        {loading
          ? Array.from({ length: NEXT_STEP_COUNT }, (_, index) => (
              <div className="session-next-step-skeleton" key={index} aria-hidden="true">
                <span />
              </div>
            ))
          : error
            ? <div className="session-next-steps-error">{error}</div>
            : visibleSuggestions.length === 0
              ? <div className="session-next-steps-empty">No suggestions to show.</div>
              : visibleSuggestions.map((suggestion) => (
                <button
                  type="button"
                  className="session-next-step-button"
                  key={suggestion}
                  onClick={() => onSelect(suggestion)}
                >
                  <Lightbulb className="session-next-step-icon" size={14} aria-hidden="true" />
                  <span>{suggestion}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ))}
      </div>
    </section>
  );
});

function sessionWorkflowId(detail: RunDetail): ResearchGoalPhase | null {
  const recordedWorkflow = detail.run.budget.researchWorkflowId;
  if (typeof recordedWorkflow === 'string' && recordedWorkflow.trim()) return recordedWorkflow.trim();
  return detail.researchProfile?.profile.workflows[0]?.id ?? null;
}
