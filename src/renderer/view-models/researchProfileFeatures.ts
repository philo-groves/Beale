import type { ResearchProfile } from '@shared/types';

export interface ResearchProfileFeatureAvailability {
  memory: boolean;
  runbooks: boolean;
  collaboration: boolean;
}

/** Legacy runs without a recorded profile retain the pre-profile renderer surface. */
export function researchProfileFeatureAvailability(
  profile: ResearchProfile | null | undefined
): ResearchProfileFeatureAvailability {
  return {
    memory: profile?.capabilities.memoryEnabled !== false,
    runbooks: profile?.capabilities.runbooksEnabled !== false,
    collaboration: profile?.capabilities.collaborationEnabled !== false
  };
}

export function hasResearchProfileDetailFeatures(
  profile: ResearchProfile | null | undefined
): boolean {
  const features = researchProfileFeatureAvailability(profile);
  return features.memory || features.runbooks || features.collaboration;
}
