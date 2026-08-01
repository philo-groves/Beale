import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceSnapshot } from '@shared/types';
import { userFacingErrorMessage } from '../lib/errors';
import {
  ResearchGoalSuggestionCache,
  researchGoalSuggestionCacheKey,
  researchGoalSuggestionRevision
} from '../view-models/researchGoalSuggestions';
import { clientRequestId } from '../view-models/runSettings';

const OPENAI_NOT_CONFIGURED_MESSAGE = 'Connect OpenAI in Settings to load suggested goals.';

interface ActiveSuggestionRequest {
  key: string;
  requestId: string;
  token: symbol;
}

interface SuggestionRequestState {
  key: string | null;
  loading: boolean;
  error: string | null;
}

export interface ResearchGoalSuggestionsState {
  suggestions: [string, string, string] | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useResearchGoalSuggestions(
  snapshot: WorkspaceSnapshot | null,
  openAiConfigured: boolean
): ResearchGoalSuggestionsState {
  const cache = useMemo(() => new ResearchGoalSuggestionCache(), []);
  const activeRequestRef = useRef<ActiveSuggestionRequest | null>(null);
  const [requestState, setRequestState] = useState<SuggestionRequestState>({
    key: null,
    loading: false,
    error: null
  });
  const activeKey = researchGoalSuggestionCacheKey(snapshot);
  const researchRevision = researchGoalSuggestionRevision(snapshot);

  const cancelRequest = useCallback((request: ActiveSuggestionRequest): void => {
    if (activeRequestRef.current?.token === request.token) activeRequestRef.current = null;
    cache.invalidate(request.key);
    void window.beale.cancelResearchPromptGeneration(request.requestId).catch(() => undefined);
  }, [cache]);

  const loadSuggestions = useCallback((force = false): void => {
    if (!activeKey) {
      const activeRequest = activeRequestRef.current;
      if (activeRequest) cancelRequest(activeRequest);
      setRequestState({ key: null, loading: false, error: null });
      return;
    }

    if (!openAiConfigured) {
      const activeRequest = activeRequestRef.current;
      if (activeRequest) cancelRequest(activeRequest);
      setRequestState({ key: activeKey, loading: false, error: OPENAI_NOT_CONFIGURED_MESSAGE });
      return;
    }

    const cached = cache.read(activeKey);
    if (!force && cached.status === 'ready') {
      setRequestState({ key: activeKey, loading: false, error: null });
      return;
    }

    const activeRequest = activeRequestRef.current;
    if (!force && activeRequest?.key === activeKey) return;
    if (activeRequest) cancelRequest(activeRequest);
    if (cached.status === 'loading') cache.invalidate(activeKey);

    const request: ActiveSuggestionRequest = {
      key: activeKey,
      requestId: clientRequestId('goal_suggestions'),
      token: Symbol(activeKey)
    };
    activeRequestRef.current = request;
    setRequestState({ key: activeKey, loading: true, error: null });

    void cache
      .load(
        activeKey,
        () => window.beale.generateResearchGoalSuggestions({ requestId: request.requestId }),
        { force }
      )
      .then(() => {
        if (activeRequestRef.current?.token !== request.token) return;
        setRequestState({ key: activeKey, loading: false, error: null });
      })
      .catch((caught: unknown) => {
        if (activeRequestRef.current?.token !== request.token) return;
        const message = userFacingErrorMessage(caught);
        setRequestState({
          key: activeKey,
          loading: false,
          error: /canceled/i.test(message) ? null : message
        });
      })
      .finally(() => {
        if (activeRequestRef.current?.token === request.token) activeRequestRef.current = null;
      });
  }, [activeKey, cache, cancelRequest, openAiConfigured]);

  useEffect(() => {
    const activeRequest = activeRequestRef.current;
    if (activeRequest && (activeRequest.key !== activeKey || !openAiConfigured)) cancelRequest(activeRequest);

    if (!activeKey) {
      loadSuggestions();
      return;
    }

    if (!openAiConfigured) {
      setRequestState({ key: activeKey, loading: false, error: OPENAI_NOT_CONFIGURED_MESSAGE });
      return;
    }

    const timer = window.setTimeout(() => loadSuggestions(true), 0);
    return () => window.clearTimeout(timer);
  }, [activeKey, cancelRequest, loadSuggestions, openAiConfigured, researchRevision]);

  useEffect(() => () => {
    const activeRequest = activeRequestRef.current;
    if (activeRequest) cancelRequest(activeRequest);
  }, [cancelRequest]);

  const retry = useCallback(() => loadSuggestions(true), [loadSuggestions]);
  const cached = cache.read(activeKey);
  if (cached.status === 'ready') {
    return {
      suggestions: cached.result.suggestions,
      loading: false,
      error: null,
      retry
    };
  }

  const stateMatchesActiveKey = requestState.key === activeKey;
  return {
    suggestions: null,
    loading: Boolean(activeKey) && (stateMatchesActiveKey ? requestState.loading : true),
    error: stateMatchesActiveKey ? requestState.error : null,
    retry
  };
}
