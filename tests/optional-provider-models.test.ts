import { describe, expect, it } from 'vitest';
import type { ResearchProviderModel, ResearchProviderModelCatalog } from '../src/shared/types';
import {
  DAYBREAK_RED_MODEL_ID,
  filterEnabledProviderModelCatalogs
} from '../src/shared/optionalProviderModels';

describe('optional provider models', () => {
  const catalogs: ResearchProviderModelCatalog[] = [{
    providerId: 'openai-codex',
    providerName: 'OpenAI (Codex)',
    models: [
      model('gpt-daybreak-blue-latest', 'Daybreak Blue'),
      model(DAYBREAK_RED_MODEL_ID, 'Daybreak Red')
    ]
  }];

  it('hides Daybreak Red until OpenAI Provider Settings explicitly enables it', () => {
    expect(filterEnabledProviderModelCatalogs(catalogs, null)[0]?.models.map((model) => model.id)).toEqual([
      'gpt-daybreak-blue-latest'
    ]);
    expect(filterEnabledProviderModelCatalogs(catalogs, {
      enabledOptionalModels: { 'openai-codex': [DAYBREAK_RED_MODEL_ID] }
    })[0]?.models.map((model) => model.id)).toEqual([
      'gpt-daybreak-blue-latest',
      DAYBREAK_RED_MODEL_ID
    ]);
  });
});

function model(id: string, name: string): ResearchProviderModel {
  return {
    id,
    name,
    reasoning: true,
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    contextWindow: 272_000,
    maxTokens: 128_000
  };
}
