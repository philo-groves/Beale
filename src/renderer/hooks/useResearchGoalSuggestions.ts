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

const LEGACY_RESEARCH_GOAL_PHASES: ResearchGoalPhase[] = ['discovery', 'chaining', 'reporting', 'longshot'];

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
  load: (phase: ResearchGoalPhase) => void;
  retry: (phase: ResearchGoalPhase) => void;
  consume: (phase: ResearchGoalPhase, suggestion: string) => void;
}

export function useResearchGoalSuggestions(
  snapshot: WorkspaceSnapshot | null,
  _openAiConfigured: boolean,
  enabled = true
): ResearchGoalSuggestionsState {
  const cache = useMemo(() => new ResearchGoalSuggestionCache(), []);
  const phases = useMemo(
    () => snapshot?.researchProfile?.profile.workflows.map((workflow) => workflow.id)
      ?? LEGACY_RESEARCH_GOAL_PHASES,
    [snapshot?.researchProfile?.profileHash]
  );
  const activeRequestsRef = useRef(new Map<ResearchGoalPhase, ActiveSuggestionRequest>());
  const loadSuggestionsRef = useRef<(
    phase: ResearchGoalPhase,
    force?: boolean,
    topUpTo?: number
  ) => void>(() => undefined);
  const [requestStates, setRequestStates] = useState<ResearchGoalSuggestionStateByPhase<SuggestionRequestState>>(
    {}
  );
  const activeKey = researchGoalSuggestionCacheKey(snapshot);
  const researchRevision = researchGoalSuggestionRevision(snapshot);
  const suggestionContextKey = activeKey
    ? `${activeKey}::${researchRevision || 'initial'}`
    : null;

  const cancelRequest = useCallback((request: ActiveSuggestionRequest): void => {
    if (activeRequestsRef.current.get(request.phase)?.token === request.token) {
      activeRequestsRef.current.delete(request.phase);
    }
    cache.invalidate(request.key);
    void window.beale.cancelResearchPromptGeneration(request.requestId).catch(() => undefined);
  }, [cache]);

  const loadSuggestions = useCallback((
    phase: ResearchGoalPhase,
    force = false,
    topUpTo?: number
  ): void => {
    if (!enabled) {
      const activeRequest = activeRequestsRef.current.get(phase);
      if (activeRequest) cancelRequest(activeRequest);
      updatePhaseState(setRequestStates, phase, { key: null, loading: false, error: null });
      return;
    }
    const key = phaseCacheKey(suggestionContextKey, phase);
    if (!key) {
      const activeRequest = activeRequestsRef.current.get(phase);
      if (activeRequest) cancelRequest(activeRequest);
      updatePhaseState(setRequestStates, phase, { key: null, loading: false, error: null });
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
        () => window.beale.generateResearchGoalSuggestions({
          phase,
          requestId: request.requestId,
          refresh: force
        }),
        { force, topUpTo }
      )
      .then((result) => {
        if (activeRequestsRef.current.get(phase)?.token !== request.token) return;
        updatePhaseState(setRequestStates, phase, { key, loading: false, error: null });
        if (!force && result.cacheStatus === 'stale') {
          activeRequestsRef.current.delete(phase);
          loadSuggestionsRef.current(phase, true);
        }
      })
      .catch((caught: unknown) => {
        if (activeRequestsRef.current.get(phase)?.token !== request.token) return;
        const message = userFacingErrorMessage(caught);
        const retained = cache.read(key).status === 'ready';
        updatePhaseState(setRequestStates, phase, {
          key,
          loading: false,
          error: /canceled/i.test(message) || retained ? null : message
        });
      })
      .finally(() => {
        if (activeRequestsRef.current.get(phase)?.token === request.token) {
          activeRequestsRef.current.delete(phase);
        }
      });
  }, [cache, cancelRequest, enabled, suggestionContextKey]);
  loadSuggestionsRef.current = loadSuggestions;

  useEffect(() => {
    if (!enabled) {
      for (const activeRequest of activeRequestsRef.current.values()) cancelRequest(activeRequest);
      setRequestStates({});
      return;
    }
    const phaseSet = new Set(phases);
    for (const [phase, activeRequest] of activeRequestsRef.current) {
      if (!phaseSet.has(phase) || activeRequest.key !== phaseCacheKey(suggestionContextKey, phase)) {
        cancelRequest(activeRequest);
      }
    }
  }, [cancelRequest, enabled, phases, suggestionContextKey]);

  useEffect(() => () => {
    for (const request of activeRequestsRef.current.values()) cancelRequest(request);
  }, [cancelRequest]);

  const retry = useCallback((phase: ResearchGoalPhase) => loadSuggestions(phase, true), [loadSuggestions]);
  const consume = useCallback((phase: ResearchGoalPhase, suggestion: string): void => {
    if (!enabled) return;
    const key = phaseCacheKey(suggestionContextKey, phase);
    if (!key) return;
    const remaining = cache.consume(key, suggestion);
    setRequestStates((current) => ({ ...current }));
    if (!snapshot) return;
    const suggestionTarget = snapshot.researchProfile.profile.workflows
      .find((workflow) => workflow.id === phase)?.goalSuggestionCount ?? 0;
    const selection = window.beale.selectResearchGoalSuggestion({
      workspaceId: snapshot.workspace.workspaceId,
      scopeId: snapshot.activeScope.id,
      profileHash: snapshot.researchProfile.profileHash,
      phase,
      suggestion
    });
    if (remaining !== null && suggestionTarget > 0 && remaining < suggestionTarget) {
      void selection
        .then(() => loadSuggestionsRef.current(phase, true, suggestionTarget))
        .catch(() => undefined);
      return;
    }
    void selection.catch(() => undefined);
  }, [cache, enabled, snapshot, suggestionContextKey]);
  const suggestions: ResearchGoalSuggestionsByPhase = {};
  const loading: ResearchGoalSuggestionStateByPhase<boolean> = {};
  const errors: ResearchGoalSuggestionStateByPhase<string | null> = {};

  for (const phase of phases) {
    const key = phaseCacheKey(suggestionContextKey, phase);
    const cached = cache.read(key);
    if (enabled && cached.status === 'ready') suggestions[phase] = cached.result.suggestions;
    const requestState = requestStates[phase] ?? { key: null, loading: false, error: null };
    const stateMatchesKey = requestState.key === key;
    loading[phase] = enabled && Boolean(key) && cached.status !== 'ready' && stateMatchesKey && requestState.loading;
    errors[phase] = enabled && stateMatchesKey ? requestState.error : null;
  }

  return { suggestions, loading, errors, load: loadSuggestions, retry, consume };
}

function phaseCacheKey(activeKey: string | null, phase: ResearchGoalPhase): string | null {
  return activeKey ? `${activeKey}::${phase}` : null;
}

function updatePhaseState(
  setState: Dispatch<SetStateAction<ResearchGoalSuggestionStateByPhase<SuggestionRequestState>>>,
  phase: ResearchGoalPhase,
  state: SuggestionRequestState
): void {
  setState((current) => ({ ...current, [phase]: state }));
}
