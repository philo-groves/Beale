export type AppearanceTheme = 'light' | 'dark' | 'cream' | 'midnight';

export const APPEARANCE_THEMES: readonly AppearanceTheme[] = ['light', 'dark', 'cream', 'midnight'];
export const DEFAULT_APPEARANCE_THEME: AppearanceTheme = 'dark';
export const APPEARANCE_THEME_STORAGE_KEY = 'beale.appearanceTheme';

export function normalizeAppearanceTheme(value: unknown): AppearanceTheme {
  return typeof value === 'string' && APPEARANCE_THEMES.includes(value as AppearanceTheme)
    ? value as AppearanceTheme
    : DEFAULT_APPEARANCE_THEME;
}

export function readAppearanceTheme(storage: Pick<Storage, 'getItem'>): AppearanceTheme {
  try {
    return normalizeAppearanceTheme(storage.getItem(APPEARANCE_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_APPEARANCE_THEME;
  }
}

export function writeAppearanceTheme(
  storage: Pick<Storage, 'setItem'>,
  theme: AppearanceTheme
): void {
  try {
    storage.setItem(APPEARANCE_THEME_STORAGE_KEY, theme);
  } catch {
    // A renderer with unavailable storage can still use the theme for its current lifetime.
  }
}
