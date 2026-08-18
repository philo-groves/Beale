export interface SuggestionPreferences {
  sessionEndingSuggestionsEnabled: boolean;
  responseSuggestionsEnabled: boolean;
  newResearchPromptSuggestionsEnabled: boolean;
}

export type SuggestionPreferenceKey = keyof SuggestionPreferences;

export const SUGGESTION_PREFERENCES_STORAGE_KEY = 'beale.suggestionPreferences';
export const DEFAULT_SUGGESTION_PREFERENCES: SuggestionPreferences = Object.freeze({
  sessionEndingSuggestionsEnabled: true,
  responseSuggestionsEnabled: true,
  newResearchPromptSuggestionsEnabled: true
});

export function normalizeSuggestionPreferences(value: unknown): SuggestionPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SUGGESTION_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  return {
    sessionEndingSuggestionsEnabled: booleanPreference(record.sessionEndingSuggestionsEnabled),
    responseSuggestionsEnabled: booleanPreference(record.responseSuggestionsEnabled),
    newResearchPromptSuggestionsEnabled: booleanPreference(record.newResearchPromptSuggestionsEnabled)
  };
}

export function readSuggestionPreferences(storage: Pick<Storage, 'getItem'>): SuggestionPreferences {
  try {
    const raw = storage.getItem(SUGGESTION_PREFERENCES_STORAGE_KEY);
    return raw ? normalizeSuggestionPreferences(JSON.parse(raw)) : { ...DEFAULT_SUGGESTION_PREFERENCES };
  } catch {
    return { ...DEFAULT_SUGGESTION_PREFERENCES };
  }
}

export function writeSuggestionPreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: SuggestionPreferences
): void {
  try {
    storage.setItem(SUGGESTION_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeSuggestionPreferences(preferences)));
  } catch {
    // The current renderer can still use suggestion preferences when storage is unavailable.
  }
}

export function withSuggestionPreference(
  preferences: SuggestionPreferences,
  key: SuggestionPreferenceKey,
  enabled: boolean
): SuggestionPreferences {
  return normalizeSuggestionPreferences({ ...preferences, [key]: enabled });
}

function booleanPreference(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}
