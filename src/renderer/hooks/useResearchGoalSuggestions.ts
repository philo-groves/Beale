import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  ResearchGoalPhase,
  ResearchGoalSuggestionsByPhase,
  ResearchGoalSuggestionStateByPhase,
  WorkspaceSnapshot
} from '@shared/types';
import { userFacingErrorMessage } from '../lib/errors';
import {
  ResearchGoalSuggestionCache,
  researchGoalSuggestionCacheKey,
  researchGoalSuggestionRevision
} from '../view-models/researchGoalSuggestions';
import { clientRequestId } from '../view-models/runSettings';

const OPENAI_NOT_CONFIGURED_MESSAGE = 'Connect OpenAI in Settings to load suggested goals.';
const RESEARCH_GOAL_PHASES: ResearchGoalPhase[] = ['discovery', 'chaining', 'reporting'];

interface ActiveSuggestionRequest {
  key: string;
  phase: ResearchGoalPhase;
  requestId: string;
  token: symbol;
}

interface SuggestionRequestState {
  key: string | null;
  loading: boolean;
  error: string | null;
}

export interface ResearchGoalSuggestionsState {
  suggestions: ResearchGoalSuggestionsByPhase;
  loading: ResearchGoalSuggestionStateByPhase<boolean>;
  errors: ResearchGoalSuggestionStateByPhase<string | null>;
  retry: (phase: ResearchGoalPhase) => void;
}

export function useResearchGoalSuggestions(
  snapshot: WorkspaceSnapshot | null,
  openAiConfigured: boolean
): ResearchGoalSuggestionsState {
  const cache = useMemo(() => new ResearchGoalSuggestionCache(), []);
  const activeRequestsRef = useRef(new Map<ResearchGoalPhase, ActiveSuggestionRequest>());
  const [requestStates, setRequestStates] = useState<ResearchGoalSuggestionStateByPhase<SuggestionRequestState>>(
    () => phaseRecord(() => ({ key: null, loading: false, error: null }))
  );
  const activeKey = researchGoalSuggestionCacheKey(snapshot);
  const researchRevision = researchGoalSuggestionRevision(snapshot);

  const cancelRequest = useCallback((request: ActiveSuggestionRequest): void => {
    if (activeRequestsRef.current.get(request.phase)?.token === request.token) {
      activeRequestsRef.current.delete(request.phase);
    }
    cache.invalidate(request.key);
    void window.beale.cancelResearchPromptGeneration(request.requestId).catch(() => undefined);
  }, [cache]);

  const loadSuggestions = useCallback((phase: ResearchGoalPhase, force = false): void => {
    const key = phaseCacheKey(activeKey, phase);
    if (!key) {
      const activeRequest = activeRequestsRef.current.get(phase);
      if (activeRequest) cancelRequest(activeRequest);
      updatePhaseState(setRequestStates, phase, { key: null, loading: false, error: null });
      return;
    }

    if (!openAiConfigured) {
      const activeRequest = activeRequestsRef.current.get(phase);
      if (activeRequest) cancelRequest(activeRequest);
      updatePhaseState(setRequestStates, phase, { key, loading: false, error: OPENAI_NOT_CONFIGURED_MESSAGE });
      return;
    }

    const cached = cache.read(key);
    if (!force && cached.status === 'ready') {
      updatePhaseState(setRequestStates, phase, { key, loading: false, error: null });
      return;
    }

    const activeRequest = activeRequestsRef.current.get(phase);
    if (!force && activeRequest?.key === key) return;
    if (activeRequest) cancelRequest(activeRequest);
    if (cached.status === 'loading') cache.invalidate(key);

    const request: ActiveSuggestionRequest = {
      key,
      phase,
      requestId: clientRequestId(`goal_suggestions_${phase}`),
      token: Symbol(key)
    };
    activeRequestsRef.current.set(phase, request);
    updatePhaseState(setRequestStates, phase, { key, loading: true, error: null });

    void cache
      .load(
        key,
        () => window.beale.generateResearchGoalSuggestions({ phase, requestId: request.requestId }),
        { force }
      )
      .then(() => {
        if (activeRequestsRef.current.get(phase)?.token !== request.token) return;
        updatePhaseState(setRequestStates, phase, { key, loading: false, error: null });
      })
      .catch((caught: unknown) => {
        if (activeRequestsRef.current.get(phase)?.token !== request.token) return;
        const message = userFacingErrorMessage(caught);
        updatePhaseState(setRequestStates, phase, {
          key,
          loading: false,
          error: /canceled/i.test(message) ? null : message
        });
      })
      .finally(() => {
        if (activeRequestsRef.current.get(phase)?.token === request.token) {
          activeRequestsRef.current.delete(phase);
        }
      });
  }, [activeKey, cache, cancelRequest, openAiConfigured]);

  useEffect(() => {
    for (const phase of RESEARCH_GOAL_PHASES) {
      const activeRequest = activeRequestsRef.current.get(phase);
      if (activeRequest && (activeRequest.key !== phaseCacheKey(activeKey, phase) || !openAiConfigured)) {
        cancelRequest(activeRequest);
      }
    }

    const timers = RESEARCH_GOAL_PHASES.map((phase) => window.setTimeout(() => loadSuggestions(phase, true), 0));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeKey, cancelRequest, loadSuggestions, openAiConfigured, researchRevision]);

  useEffect(() => () => {
    for (const request of activeRequestsRef.current.values()) cancelRequest(request);
  }, [cancelRequest]);

  const retry = useCallback((phase: ResearchGoalPhase) => loadSuggestions(phase, true), [loadSuggestions]);
  const suggestions: ResearchGoalSuggestionsByPhase = {};
  const loading = phaseRecord(() => false);
  const errors = phaseRecord<string | null>(() => null);

  for (const phase of RESEARCH_GOAL_PHASES) {
    const key = phaseCacheKey(activeKey, phase);
    const cached = cache.read(key);
    if (cached.status === 'ready') suggestions[phase] = cached.result.suggestions;
    const requestState = requestStates[phase];
    const stateMatchesKey = requestState.key === key;
    loading[phase] = Boolean(key) && cached.status !== 'ready' && (stateMatchesKey ? requestState.loading : true);
    errors[phase] = stateMatchesKey ? requestState.error : null;
  }

  return { suggestions, loading, errors, retry };
}

function phaseCacheKey(activeKey: string | null, phase: ResearchGoalPhase): string | null {
  return activeKey ? `${activeKey}::${phase}` : null;
}

function phaseRecord<T>(value: (phase: ResearchGoalPhase) => T): ResearchGoalSuggestionStateByPhase<T> {
  return {
    discovery: value('discovery'),
    chaining: value('chaining'),
    reporting: value('reporting')
  };
}

function updatePhaseState(
  setState: Dispatch<SetStateAction<ResearchGoalSuggestionStateByPhase<SuggestionRequestState>>>,
  phase: ResearchGoalPhase,
  state: SuggestionRequestState
): void {
  setState((current) => ({ ...current, [phase]: state }));
}
