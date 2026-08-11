import { useCallback, useEffect, useState } from 'react';
import {
  readSessionHeatPreferences,
  withSessionHeatPreference,
  writeSessionHeatPreferences,
  type SessionHeat,
  type SessionHeatPreferenceOverrides
} from '../view-models/sessionHeat';

function initialSessionHeatPreferences(): SessionHeatPreferenceOverrides {
  if (typeof window === 'undefined') return {};
  return readSessionHeatPreferences(window.localStorage);
}

export function useSessionHeatPreferences(): [
  SessionHeatPreferenceOverrides,
  (profileId: string, memoryTypeId: string, status: string, heat: SessionHeat | null) => void
] {
  const [preferences, setPreferences] = useState<SessionHeatPreferenceOverrides>(initialSessionHeatPreferences);

  useEffect(() => {
    writeSessionHeatPreferences(window.localStorage, preferences);
  }, [preferences]);

  const setPreference = useCallback((
    profileId: string,
    memoryTypeId: string,
    status: string,
    heat: SessionHeat | null
  ): void => {
    setPreferences((current) => withSessionHeatPreference(current, profileId, memoryTypeId, status, heat));
  }, []);

  return [preferences, setPreference];
}
