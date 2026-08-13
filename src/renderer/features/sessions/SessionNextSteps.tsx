import { memo, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ArrowRight, Lightbulb, RefreshCw } from 'lucide-react';
import type { ResearchGoalPhase, RunDetail, RunStatus } from '@shared/types';
import { clientRequestId } from '../../view-models/runSettings';

const NEXT_STEP_COUNT = 3;

export interface ResearchGoalSeed {
  sentence: string;
  phase: ResearchGoalPhase;
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
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    cacheKey: string;
    loading: boolean;
    suggestions: readonly string[];
    error: string | null;
  }>(() => ({
    cacheKey,
    loading: persistedSuggestions === null,
    suggestions: persistedSuggestions ?? [],
    error: workflowId ? null : 'This session does not have a research workflow.'
  }));

  useEffect(() => {
    if (persistedSuggestions) {
      setState({ cacheKey, loading: false, suggestions: persistedSuggestions, error: null });
      return undefined;
    }
    if (!workflowId) {
      setState({ cacheKey, loading: false, suggestions: [], error: 'This session does not have a research workflow.' });
      return undefined;
    }

    let cancelled = false;
    const requestId = clientRequestId('session_next_steps');
    setState({ cacheKey, loading: true, suggestions: [], error: null });
    void window.beale.generateResearchGoalSuggestions({
      phase: workflowId,
      requestId,
      sourceRunId: detail.run.id
    })
      .then((result) => {
        if (cancelled) return;
        setState({ cacheKey, loading: false, suggestions: result.suggestions, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        if (!/canceled/i.test(message)) {
          setState({ cacheKey, loading: false, suggestions: [], error: message });
        }
      });

    return () => {
      cancelled = true;
      void window.beale.cancelResearchPromptGeneration(requestId).catch(() => undefined);
    };
  }, [attempt, cacheKey, detail.run.id, persistedSuggestions, workflowId]);

  const currentState = state.cacheKey === cacheKey
    ? state
    : persistedSuggestions
      ? { cacheKey, loading: false, suggestions: persistedSuggestions, error: null }
      : { cacheKey, loading: true, suggestions: [] as readonly string[], error: null };

  return (
    <SessionNextStepsWidget
      loading={currentState.loading}
      suggestions={currentState.suggestions}
      error={currentState.error}
      onRetry={() => setAttempt((current) => current + 1)}
      onSelect={(sentence) => {
        if (workflowId) onSelect({ sentence, phase: workflowId });
      }}
    />
  );
});

export const SessionNextStepsWidget = memo(function SessionNextStepsWidget({
  loading,
  suggestions,
  error,
  onRetry,
  onSelect
}: {
  loading: boolean;
  suggestions: readonly string[];
  error: string | null;
  onRetry: () => void;
  onSelect: (sentence: string) => void;
}): JSX.Element {
  const visibleSuggestions = useMemo(() => suggestions.slice(0, NEXT_STEP_COUNT), [suggestions]);
  return (
    <section className="session-next-steps" aria-label="Suggestions" aria-busy={loading}>
      <header className="session-next-steps-header">
        <h3>Suggestions</h3>
        {error ? (
          <button type="button" className="session-next-steps-retry" onClick={onRetry}>
            <RefreshCw size={13} />
            <span>Retry</span>
          </button>
        ) : null}
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
