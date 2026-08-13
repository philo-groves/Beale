import type {
  ResearchCollaborationIntensity,
  ResearchCollaborationMode,
  ResearchCollaborationPreferences,
  ResearchCollaborationProviderPreference,
  ResearchModelEffortLevel,
  ResearchModelProviderId
} from './types';

export const DEFAULT_RESEARCH_COLLABORATION = Object.freeze({
  mode: 'adaptive',
  intensity: 'balanced',
  providers: [],
  independentFirstPass: true,
  peerChallengeRounds: 1,
  maxConcurrentRooms: 2,
  maxMembersPerRoom: 3,
  maxTotalInvocations: 8
} satisfies ResearchCollaborationPreferences);

const MODES = new Set<ResearchCollaborationMode>(['solo', 'adaptive', 'always']);
const INTENSITIES = new Set<ResearchCollaborationIntensity>(['focused', 'balanced', 'deep']);
const PROVIDERS = new Set<ResearchModelProviderId>(['openai-codex', 'anthropic', 'xai']);
const EFFORTS = new Set<ResearchModelEffortLevel>(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export function normalizeResearchCollaboration(
  value: unknown,
  fallbackProviders: readonly ResearchCollaborationProviderPreference[] = []
): ResearchCollaborationPreferences {
  const record = isRecord(value) ? value : {};
  const mode = MODES.has(record.mode as ResearchCollaborationMode)
    ? record.mode as ResearchCollaborationMode
    : DEFAULT_RESEARCH_COLLABORATION.mode;
  const intensity = INTENSITIES.has(record.intensity as ResearchCollaborationIntensity)
    ? record.intensity as ResearchCollaborationIntensity
    : DEFAULT_RESEARCH_COLLABORATION.intensity;
  const providers = normalizeProviders(record.providers, fallbackProviders);
  const limits = collaborationLimits(intensity);
  return {
    mode,
    intensity,
    providers: mode === 'solo' ? [] : providers,
    independentFirstPass: record.independentFirstPass !== false,
    peerChallengeRounds: boundedInteger(record.peerChallengeRounds, 0, 3, DEFAULT_RESEARCH_COLLABORATION.peerChallengeRounds),
    maxConcurrentRooms: boundedInteger(record.maxConcurrentRooms, 1, 5, limits.maxConcurrentRooms),
    maxMembersPerRoom: boundedInteger(record.maxMembersPerRoom, 2, 5, limits.maxMembersPerRoom),
    maxTotalInvocations: boundedInteger(record.maxTotalInvocations, 2, 24, limits.maxTotalInvocations)
  };
}

export function collaborationLimits(intensity: ResearchCollaborationIntensity): Pick<
  ResearchCollaborationPreferences,
  'maxConcurrentRooms' | 'maxMembersPerRoom' | 'maxTotalInvocations'
> {
  if (intensity === 'focused') return { maxConcurrentRooms: 1, maxMembersPerRoom: 2, maxTotalInvocations: 4 };
  if (intensity === 'deep') return { maxConcurrentRooms: 4, maxMembersPerRoom: 4, maxTotalInvocations: 16 };
  return { maxConcurrentRooms: 2, maxMembersPerRoom: 3, maxTotalInvocations: 8 };
}

function normalizeProviders(
  value: unknown,
  fallback: readonly ResearchCollaborationProviderPreference[]
): ResearchCollaborationProviderPreference[] {
  const candidates = Array.isArray(value) ? value : fallback;
  const seen = new Set<ResearchModelProviderId>();
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const provider = candidate.provider as ResearchModelProviderId;
    const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
    const reasoningEffort = candidate.reasoningEffort as ResearchModelEffortLevel;
    if (!PROVIDERS.has(provider) || !model || !EFFORTS.has(reasoningEffort) || seen.has(provider)) return [];
    seen.add(provider);
    return [{
      provider,
      model,
      reasoningEffort,
      enabled: candidate.enabled !== false
    }];
  });
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
