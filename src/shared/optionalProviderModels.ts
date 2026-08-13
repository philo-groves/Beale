import type {
  ProviderSettings,
  ResearchModelProviderId,
  ResearchProviderModelCatalog
} from './types';

export interface OptionalProviderModelDefinition {
  providerId: ResearchModelProviderId;
  modelId: string;
  name: string;
  accessNote: string;
  enabledByDefault: boolean;
}

export const DAYBREAK_BLUE_MODEL_ID = 'gpt-daybreak-blue-latest';
export const DAYBREAK_RED_MODEL_ID = 'gpt-daybreak-red-latest';
export const CLAUDE_FABLE_MODEL_ID = 'claude-fable-5';
export const CLAUDE_MYTHOS_MODEL_ID = 'claude-mythos-5';

export const OPTIONAL_PROVIDER_MODELS = Object.freeze([
  {
    providerId: 'openai-codex',
    modelId: DAYBREAK_BLUE_MODEL_ID,
    name: 'Daybreak Blue',
    accessNote: 'Expected, but not guaranteed, for Trusted Access for Cyber members.',
    enabledByDefault: true
  },
  {
    providerId: 'openai-codex',
    modelId: DAYBREAK_RED_MODEL_ID,
    name: 'Daybreak Red',
    accessNote: 'Requires account access, primarily available to approved commercial users.',
    enabledByDefault: false
  },
  {
    providerId: 'anthropic',
    modelId: CLAUDE_FABLE_MODEL_ID,
    name: 'Fable 5',
    accessNote: 'Available by default, but its safeguards may decline cybersecurity requests even for Cyber Verification Program members.',
    enabledByDefault: true
  },
  {
    providerId: 'anthropic',
    modelId: CLAUDE_MYTHOS_MODEL_ID,
    name: 'Mythos 5',
    accessNote: 'Requires approved access and is primarily available to approved commercial users.',
    enabledByDefault: false
  }
] satisfies OptionalProviderModelDefinition[]);

export function isOptionalProviderModel(providerId: ResearchModelProviderId, modelId: string): boolean {
  return OPTIONAL_PROVIDER_MODELS.some((model) => model.providerId === providerId && model.modelId === modelId);
}

export function isOptionalProviderModelEnabled(
  settings: Pick<ProviderSettings, 'enabledOptionalModels' | 'disabledOptionalModels'> | null | undefined,
  providerId: ResearchModelProviderId,
  modelId: string
): boolean {
  if (settings?.disabledOptionalModels?.[providerId]?.includes(modelId) === true) return false;
  if (settings?.enabledOptionalModels?.[providerId]?.includes(modelId) === true) return true;
  return OPTIONAL_PROVIDER_MODELS.find((model) => model.providerId === providerId && model.modelId === modelId)?.enabledByDefault === true;
}

export function isProviderModelEnabled(
  settings: Pick<ProviderSettings, 'enabledOptionalModels' | 'disabledOptionalModels'> | null | undefined,
  providerId: ResearchModelProviderId,
  modelId: string
): boolean {
  return !isOptionalProviderModel(providerId, modelId)
    || isOptionalProviderModelEnabled(settings, providerId, modelId);
}

export function filterEnabledProviderModelCatalogs(
  catalogs: readonly ResearchProviderModelCatalog[],
  settings: Pick<ProviderSettings, 'enabledOptionalModels' | 'disabledOptionalModels'> | null | undefined
): ResearchProviderModelCatalog[] {
  return catalogs.map((catalog) => ({
    ...catalog,
    models: catalog.models.filter((model) => (
      !isOptionalProviderModel(catalog.providerId, model.id)
      || isOptionalProviderModelEnabled(settings, catalog.providerId, model.id)
    ))
  }));
}
