import { useCallback, useLayoutEffect, useState } from 'react';
import {
  DEFAULT_APPEARANCE_THEME,
  readAppearanceTheme,
  writeAppearanceTheme,
  type AppearanceTheme
} from '../view-models/appearance';

function initialAppearanceTheme(): AppearanceTheme {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE_THEME;
  const theme = readAppearanceTheme(window.localStorage);
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function useAppearanceTheme(): [AppearanceTheme, (theme: AppearanceTheme) => void] {
  const [theme, setTheme] = useState<AppearanceTheme>(initialAppearanceTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeAppearanceTheme(window.localStorage, theme);
  }, [theme]);

  const changeTheme = useCallback((nextTheme: AppearanceTheme): void => {
    setTheme(nextTheme);
  }, []);

  return [theme, changeTheme];
}
