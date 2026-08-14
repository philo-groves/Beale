import { useCallback, useEffect, useState } from 'react';
import {
  readSessionHeatPreferences,
  withSessionHeatPalettePreference,
  withSessionHeatPreference,
  writeSessionHeatPreferences,
  type SessionHeat,
  type SessionHeatColorLevel,
  type SessionHeatPreferences,
  type SessionHeatTheme
} from '../view-models/sessionHeat';

function initialSessionHeatPreferences(): SessionHeatPreferences {
  if (typeof window === 'undefined') return { heatOverrides: {}, paletteOverrides: {} };
  return readSessionHeatPreferences(window.localStorage);
}

export function useSessionHeatPreferences(): [
  SessionHeatPreferences,
  (profileId: string, memoryTypeId: string, status: string, heat: SessionHeat | null) => void,
  (profileId: string, theme: SessionHeatTheme, level: SessionHeatColorLevel, color: string | null) => void
] {
  const [preferences, setPreferences] = useState<SessionHeatPreferences>(initialSessionHeatPreferences);

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

  const setPalettePreference = useCallback((
    profileId: string,
    theme: SessionHeatTheme,
    level: SessionHeatColorLevel,
    color: string | null
  ): void => {
    setPreferences((current) => withSessionHeatPalettePreference(current, profileId, theme, level, color));
  }, []);

  return [preferences, setPreference, setPalettePreference];
}
