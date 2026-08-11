import type {
  HoneycrispMemorySummary,
  ResearchProfile,
  ResearchProfileSessionHeat,
  ResearchProfileSessionHeatPalette,
  RunDetail
} from '@shared/types';
import { stateClass } from '../lib/formatting';

export type SessionHeat = ResearchProfileSessionHeat;
export type SessionHeatPreferenceOverrides = Record<string, Record<string, Record<string, SessionHeat>>>;

export const SESSION_HEAT_LEVELS: readonly SessionHeat[] = ['none', 'low', 'medium', 'high', 'critical'];
export const SESSION_HEAT_STORAGE_KEY = 'beale.sessionHeatOverrides';

export function sessionHeatForDetail(
  detail: RunDetail | null,
  overrides: SessionHeatPreferenceOverrides = {}
): SessionHeat {
  if (!detail?.researchProfile?.profile) return 'none';
  return sessionHeatForHoneycrispMemory(
    detail.honeycrispMemory ?? null,
    detail.run.id,
    detail.researchProfile.profile,
    overrides
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

export function readSessionHeatPreferences(
  storage: Pick<Storage, 'getItem'>
): SessionHeatPreferenceOverrides {
  try {
    return normalizeSessionHeatPreferences(JSON.parse(storage.getItem(SESSION_HEAT_STORAGE_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

export function writeSessionHeatPreferences(
  storage: Pick<Storage, 'setItem'>,
  overrides: SessionHeatPreferenceOverrides
): void {
  try {
    storage.setItem(SESSION_HEAT_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // A renderer with unavailable storage can still use the settings for its current lifetime.
  }
}

export function withSessionHeatPreference(
  current: SessionHeatPreferenceOverrides,
  profileId: string,
  memoryTypeId: string,
  status: string,
  heat: SessionHeat | null
): SessionHeatPreferenceOverrides {
  const next = structuredClone(current);
  if (heat) {
    next[profileId] = next[profileId] ?? {};
    next[profileId][memoryTypeId] = next[profileId][memoryTypeId] ?? {};
    next[profileId][memoryTypeId][status] = heat;
    return next;
  }
  delete next[profileId]?.[memoryTypeId]?.[status];
  if (Object.keys(next[profileId]?.[memoryTypeId] ?? {}).length === 0) delete next[profileId]?.[memoryTypeId];
  if (Object.keys(next[profileId] ?? {}).length === 0) delete next[profileId];
  return next;
}

function normalizeSessionHeatPreferences(value: unknown): SessionHeatPreferenceOverrides {
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

function isSessionHeat(value: unknown): value is SessionHeat {
  return typeof value === 'string' && SESSION_HEAT_LEVELS.includes(value as SessionHeat);
}

function maxSessionHeat(left: SessionHeat, right: SessionHeat): SessionHeat {
  return SESSION_HEAT_LEVELS[Math.max(SESSION_HEAT_LEVELS.indexOf(left), SESSION_HEAT_LEVELS.indexOf(right))];
}
