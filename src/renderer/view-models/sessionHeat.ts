import type {
  HoneycrispMemorySummary,
  ResearchProfile,
  ResearchProfileSessionHeat,
  ResearchProfileSessionHeatPalette,
  RunDetail
} from '@shared/types';
import { stateClass } from '../lib/formatting';
import type { AppearanceTheme } from './appearance';

export type SessionHeat = ResearchProfileSessionHeat;
export type SessionHeatColorLevel = Exclude<SessionHeat, 'none'>;
export type SessionHeatTheme = AppearanceTheme;
export type SessionHeatPreferenceOverrides = Record<string, Record<string, Record<string, SessionHeat>>>;
export type SessionHeatPalettePreferenceOverrides = Record<
  string,
  Partial<Record<SessionHeatTheme, Partial<ResearchProfileSessionHeatPalette>>>
>;

export interface SessionHeatPreferences {
  heatOverrides: SessionHeatPreferenceOverrides;
  paletteOverrides: SessionHeatPalettePreferenceOverrides;
}

export interface SessionHeatDisplayState {
  heat: SessionHeat;
  profile: ResearchProfile | null;
}

export const SESSION_HEAT_LEVELS: readonly SessionHeat[] = ['none', 'low', 'medium', 'high', 'critical'];
export const SESSION_HEAT_COLOR_LEVELS: readonly SessionHeatColorLevel[] = ['low', 'medium', 'high', 'critical'];
export const SESSION_HEAT_THEMES: readonly SessionHeatTheme[] = ['light', 'dark', 'cream', 'midnight'];
export const SESSION_HEAT_STORAGE_KEY = 'beale.sessionHeatOverrides';
export const DEFAULT_SESSION_HEAT_PALETTE: ResearchProfileSessionHeatPalette = {
  low: '#45b8d8',
  medium: '#4f87e8',
  high: '#7768e8',
  critical: '#b14ee8'
};
export const SECURITY_RESEARCH_LIGHT_SESSION_HEAT_PALETTE: ResearchProfileSessionHeatPalette = {
  low: '#e6ce7f',
  medium: '#ce9564',
  high: '#d37e83',
  critical: '#d2565e'
};
export const SECURITY_RESEARCH_DARK_SESSION_HEAT_PALETTE: ResearchProfileSessionHeatPalette = {
  low: '#857300',
  medium: '#612d00',
  high: '#7e1117',
  critical: '#5c0006'
};
export const CREAM_SESSION_HEAT_PALETTE: ResearchProfileSessionHeatPalette = {
  low: '#dbb061',
  medium: '#d0793e',
  high: '#e66565',
  critical: '#c24747'
};
export const MIDNIGHT_SESSION_HEAT_PALETTE: ResearchProfileSessionHeatPalette = {
  low: '#657be6',
  medium: '#4b5baa',
  high: '#31296a',
  critical: '#181433'
};

export const EMPTY_SESSION_HEAT_PREFERENCES: SessionHeatPreferences = {
  heatOverrides: {},
  paletteOverrides: {}
};
export const EMPTY_SESSION_HEAT_DISPLAY_STATE: SessionHeatDisplayState = {
  heat: 'none',
  profile: null
};

export function sessionHeatDisplayStateForSelection(
  previous: SessionHeatDisplayState,
  selectedRunId: string | null,
  detail: RunDetail | null,
  preferences: SessionHeatPreferences | SessionHeatPreferenceOverrides = EMPTY_SESSION_HEAT_PREFERENCES
): SessionHeatDisplayState {
  if (!selectedRunId) return EMPTY_SESSION_HEAT_DISPLAY_STATE;
  if (!detail || detail.run.id !== selectedRunId) return previous;
  const profile = detail.researchProfile?.profile ?? null;
  const heat = sessionHeatForDetail(detail, preferences);
  return previous.heat === heat && previous.profile === profile ? previous : { heat, profile };
}

export function sessionHeatForDetail(
  detail: RunDetail | null,
  preferences: SessionHeatPreferences | SessionHeatPreferenceOverrides = EMPTY_SESSION_HEAT_PREFERENCES
): SessionHeat {
  if (!detail?.researchProfile?.profile) return 'none';
  return sessionHeatForHoneycrispMemory(
    detail.honeycrispMemory ?? null,
    detail.run.id,
    detail.researchProfile.profile,
    sessionHeatPreferenceOverrides(preferences)
  );
}

export function sessionHeatForHoneycrispMemory(
  memory: HoneycrispMemorySummary | null | undefined,
  sessionId: string | null,
  profile?: ResearchProfile | null,
  overrides: SessionHeatPreferenceOverrides = {}
): SessionHeat {
  if (!sessionId || !profile || !memory || memory.status === 'missing' || memory.status === 'error') return 'none';

  let heat: SessionHeat = 'none';
  for (const node of memory.nodes) {
    if (!node.sessionIds.includes(sessionId)) continue;
    const memoryType = profile.memory.types.find((candidate) =>
      stateClass(candidate.id) === stateClass(node.type)
      || candidate.aliases?.some((alias) => stateClass(alias) === stateClass(node.type))
    );
    if (!memoryType) continue;
    const configuredHeat = overrides[profile.id]?.[memoryType.id]?.[node.status]
      ?? memoryType.sessionHeat?.[node.status]
      ?? 'none';
    heat = maxSessionHeat(heat, configuredHeat);
  }
  return heat;
}

export function sessionHeatPaletteStyle(
  palette: ResearchProfileSessionHeatPalette | null | undefined
): Record<string, string> {
  if (!palette) return {};
  return {
    '--session-heat-low-color': palette.low,
    '--session-heat-medium-color': palette.medium,
    '--session-heat-high-color': palette.high,
    '--session-heat-critical-color': palette.critical
  };
}

export function sessionHeatPaletteForProfile(
  profile: ResearchProfile | null | undefined,
  preferences: SessionHeatPreferences | SessionHeatPreferenceOverrides = EMPTY_SESSION_HEAT_PREFERENCES,
  theme: SessionHeatTheme = 'dark'
): ResearchProfileSessionHeatPalette {
  const paletteOverrides = isSessionHeatPreferences(preferences) ? preferences.paletteOverrides : {};
  return {
    ...DEFAULT_SESSION_HEAT_PALETTE,
    ...profile?.presentation.sessionHeatPalette,
    ...(profile?.id === 'security-research' && theme === 'light' ? SECURITY_RESEARCH_LIGHT_SESSION_HEAT_PALETTE : {}),
    ...(profile?.id === 'security-research' && theme === 'dark' ? SECURITY_RESEARCH_DARK_SESSION_HEAT_PALETTE : {}),
    ...(theme === 'cream' ? CREAM_SESSION_HEAT_PALETTE : {}),
    ...(theme === 'midnight' ? MIDNIGHT_SESSION_HEAT_PALETTE : {}),
    ...paletteOverrides[profile?.id ?? '']?.[theme]
  };
}

export function readSessionHeatPreferences(
  storage: Pick<Storage, 'getItem'>
): SessionHeatPreferences {
  try {
    return normalizeSessionHeatPreferences(JSON.parse(storage.getItem(SESSION_HEAT_STORAGE_KEY) ?? '{}'));
  } catch {
    return EMPTY_SESSION_HEAT_PREFERENCES;
  }
}

export function writeSessionHeatPreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: SessionHeatPreferences
): void {
  try {
    storage.setItem(SESSION_HEAT_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A renderer with unavailable storage can still use the settings for its current lifetime.
  }
}

export function withSessionHeatPreference(
  current: SessionHeatPreferences | SessionHeatPreferenceOverrides,
  profileId: string,
  memoryTypeId: string,
  status: string,
  heat: SessionHeat | null
): SessionHeatPreferences {
  const normalized = normalizeSessionHeatPreferences(current);
  const heatOverrides = structuredClone(normalized.heatOverrides);
  if (heat) {
    heatOverrides[profileId] = heatOverrides[profileId] ?? {};
    heatOverrides[profileId][memoryTypeId] = heatOverrides[profileId][memoryTypeId] ?? {};
    heatOverrides[profileId][memoryTypeId][status] = heat;
    return { ...normalized, heatOverrides };
  }
  delete heatOverrides[profileId]?.[memoryTypeId]?.[status];
  if (Object.keys(heatOverrides[profileId]?.[memoryTypeId] ?? {}).length === 0) delete heatOverrides[profileId]?.[memoryTypeId];
  if (Object.keys(heatOverrides[profileId] ?? {}).length === 0) delete heatOverrides[profileId];
  return { ...normalized, heatOverrides };
}

export function withSessionHeatPalettePreference(
  current: SessionHeatPreferences | SessionHeatPreferenceOverrides,
  profileId: string,
  theme: SessionHeatTheme,
  level: SessionHeatColorLevel,
  color: string | null
): SessionHeatPreferences {
  const normalized = normalizeSessionHeatPreferences(current);
  const paletteOverrides = structuredClone(normalized.paletteOverrides);
  const nextColor = color ? normalizeHexColor(color) : null;
  if (nextColor) {
    paletteOverrides[profileId] = paletteOverrides[profileId] ?? {};
    paletteOverrides[profileId][theme] = paletteOverrides[profileId][theme] ?? {};
    paletteOverrides[profileId][theme][level] = nextColor;
    return { ...normalized, paletteOverrides };
  }
  delete paletteOverrides[profileId]?.[theme]?.[level];
  if (Object.keys(paletteOverrides[profileId]?.[theme] ?? {}).length === 0) delete paletteOverrides[profileId]?.[theme];
  if (Object.keys(paletteOverrides[profileId] ?? {}).length === 0) delete paletteOverrides[profileId];
  return { ...normalized, paletteOverrides };
}

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  const expanded = trimmed.match(/^#?([0-9a-f]{3})$/i);
  if (expanded) {
    return `#${expanded[1].split('').map((digit) => `${digit}${digit}`).join('')}`.toLowerCase();
  }
  const full = trimmed.match(/^#?([0-9a-f]{6})$/i);
  return full ? `#${full[1].toLowerCase()}` : null;
}

function normalizeSessionHeatPreferences(value: unknown): SessionHeatPreferences {
  if (isSessionHeatPreferencesShape(value)) {
    return {
      heatOverrides: normalizeSessionHeatPreferenceOverrides(value.heatOverrides),
      paletteOverrides: normalizeSessionHeatPalettePreferences(value.paletteOverrides)
    };
  }
  return {
    heatOverrides: normalizeSessionHeatPreferenceOverrides(value),
    paletteOverrides: {}
  };
}

function normalizeSessionHeatPreferenceOverrides(value: unknown): SessionHeatPreferenceOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: SessionHeatPreferenceOverrides = {};
  for (const [profileId, rawTypes] of Object.entries(value)) {
    if (!rawTypes || typeof rawTypes !== 'object' || Array.isArray(rawTypes)) continue;
    for (const [memoryTypeId, rawStatuses] of Object.entries(rawTypes)) {
      if (!rawStatuses || typeof rawStatuses !== 'object' || Array.isArray(rawStatuses)) continue;
      for (const [status, rawHeat] of Object.entries(rawStatuses)) {
        if (!isSessionHeat(rawHeat)) continue;
        result[profileId] = result[profileId] ?? {};
        result[profileId][memoryTypeId] = result[profileId][memoryTypeId] ?? {};
        result[profileId][memoryTypeId][status] = rawHeat;
      }
    }
  }
  return result;
}

function normalizeSessionHeatPalettePreferences(value: unknown): SessionHeatPalettePreferenceOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: SessionHeatPalettePreferenceOverrides = {};
  for (const [profileId, rawThemes] of Object.entries(value)) {
    if (!rawThemes || typeof rawThemes !== 'object' || Array.isArray(rawThemes)) continue;
    for (const [theme, rawPalette] of Object.entries(rawThemes)) {
      if (!isSessionHeatTheme(theme) || !rawPalette || typeof rawPalette !== 'object' || Array.isArray(rawPalette)) continue;
      for (const [level, rawColor] of Object.entries(rawPalette)) {
        if (!isSessionHeatColorLevel(level) || typeof rawColor !== 'string') continue;
        const color = normalizeHexColor(rawColor);
        if (!color) continue;
        result[profileId] = result[profileId] ?? {};
        result[profileId][theme] = result[profileId][theme] ?? {};
        result[profileId][theme][level] = color;
      }
    }
  }
  return result;
}

function sessionHeatPreferenceOverrides(
  preferences: SessionHeatPreferences | SessionHeatPreferenceOverrides
): SessionHeatPreferenceOverrides {
  return isSessionHeatPreferences(preferences) ? preferences.heatOverrides : preferences;
}

function isSessionHeatPreferences(value: SessionHeatPreferences | SessionHeatPreferenceOverrides): value is SessionHeatPreferences {
  return isSessionHeatPreferencesShape(value);
}

function isSessionHeatPreferencesShape(value: unknown): value is Partial<SessionHeatPreferences> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('heatOverrides' in value || 'paletteOverrides' in value)
  );
}

function isSessionHeat(value: unknown): value is SessionHeat {
  return typeof value === 'string' && SESSION_HEAT_LEVELS.includes(value as SessionHeat);
}

function isSessionHeatColorLevel(value: unknown): value is SessionHeatColorLevel {
  return typeof value === 'string' && SESSION_HEAT_COLOR_LEVELS.includes(value as SessionHeatColorLevel);
}

function isSessionHeatTheme(value: unknown): value is SessionHeatTheme {
  return typeof value === 'string' && SESSION_HEAT_THEMES.includes(value as SessionHeatTheme);
}

function maxSessionHeat(left: SessionHeat, right: SessionHeat): SessionHeat {
  return SESSION_HEAT_LEVELS[Math.max(SESSION_HEAT_LEVELS.indexOf(left), SESSION_HEAT_LEVELS.indexOf(right))];
}
