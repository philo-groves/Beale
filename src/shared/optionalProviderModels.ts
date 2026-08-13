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
}

export const DAYBREAK_RED_MODEL_ID = 'gpt-daybreak-red-latest';

export const OPTIONAL_PROVIDER_MODELS = Object.freeze([
  {
    providerId: 'openai-codex',
    modelId: DAYBREAK_RED_MODEL_ID,
    name: 'Daybreak Red',
    accessNote: 'Requires account access, primarily available to approved commercial users.'
  }
] satisfies OptionalProviderModelDefinition[]);

export function isOptionalProviderModel(providerId: ResearchModelProviderId, modelId: string): boolean {
  return OPTIONAL_PROVIDER_MODELS.some((model) => model.providerId === providerId && model.modelId === modelId);
}

export function isOptionalProviderModelEnabled(
  settings: Pick<ProviderSettings, 'enabledOptionalModels'> | null | undefined,
  providerId: ResearchModelProviderId,
  modelId: string
): boolean {
  return settings?.enabledOptionalModels?.[providerId]?.includes(modelId) === true;
}

export function isProviderModelEnabled(
  settings: Pick<ProviderSettings, 'enabledOptionalModels'> | null | undefined,
  providerId: ResearchModelProviderId,
  modelId: string
): boolean {
  return !isOptionalProviderModel(providerId, modelId)
    || isOptionalProviderModelEnabled(settings, providerId, modelId);
}

export function filterEnabledProviderModelCatalogs(
  catalogs: readonly ResearchProviderModelCatalog[],
  settings: Pick<ProviderSettings, 'enabledOptionalModels'> | null | undefined
): ResearchProviderModelCatalog[] {
  return catalogs.map((catalog) => ({
    ...catalog,
    models: catalog.models.filter((model) => (
      !isOptionalProviderModel(catalog.providerId, model.id)
      || isOptionalProviderModelEnabled(settings, catalog.providerId, model.id)
    ))
  }));
}
