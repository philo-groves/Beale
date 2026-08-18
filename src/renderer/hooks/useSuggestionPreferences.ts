import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SUGGESTION_PREFERENCES,
  readSuggestionPreferences,
  withSuggestionPreference,
  writeSuggestionPreferences,
  type SuggestionPreferenceKey,
  type SuggestionPreferences
} from '../view-models/suggestionPreferences';

function initialSuggestionPreferences(): SuggestionPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_SUGGESTION_PREFERENCES };
  return readSuggestionPreferences(window.localStorage);
}

export function useSuggestionPreferences(): [
  SuggestionPreferences,
  (key: SuggestionPreferenceKey, enabled: boolean) => void
] {
  const [preferences, setPreferences] = useState<SuggestionPreferences>(initialSuggestionPreferences);

  useEffect(() => {
    writeSuggestionPreferences(window.localStorage, preferences);
  }, [preferences]);

  const setPreference = useCallback((key: SuggestionPreferenceKey, enabled: boolean): void => {
    setPreferences((current) => withSuggestionPreference(current, key, enabled));
  }, []);

  return [preferences, setPreference];
}
