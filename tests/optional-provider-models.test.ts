import { describe, expect, it } from 'vitest';
import type { ResearchProviderModel, ResearchProviderModelCatalog } from '../src/shared/types';
import {
  CLAUDE_FABLE_MODEL_ID,
  CLAUDE_MYTHOS_MODEL_ID,
  DAYBREAK_BLUE_MODEL_ID,
  DAYBREAK_RED_MODEL_ID,
  filterEnabledProviderModelCatalogs
} from '../src/shared/optionalProviderModels';

describe('optional provider models', () => {
  const catalogs: ResearchProviderModelCatalog[] = [
    {
      providerId: 'openai-codex',
      providerName: 'OpenAI (Codex)',
      models: [
        model(DAYBREAK_BLUE_MODEL_ID, 'Daybreak Blue'),
        model(DAYBREAK_RED_MODEL_ID, 'Daybreak Red')
      ]
    },
    {
      providerId: 'anthropic',
      providerName: 'Anthropic',
      models: [
        model(CLAUDE_FABLE_MODEL_ID, 'Claude Fable 5'),
        model(CLAUDE_MYTHOS_MODEL_ID, 'Claude Mythos 5')
      ]
    }
  ];

  it('enables Daybreak Blue by default while keeping Daybreak Red opt-in', () => {
    expect(filterEnabledProviderModelCatalogs(catalogs, null)[0]?.models.map((model) => model.id)).toEqual([
      DAYBREAK_BLUE_MODEL_ID
    ]);
    expect(filterEnabledProviderModelCatalogs(catalogs, {
      enabledOptionalModels: { 'openai-codex': [DAYBREAK_RED_MODEL_ID] }
    })[0]?.models.map((model) => model.id)).toEqual([
      DAYBREAK_BLUE_MODEL_ID,
      DAYBREAK_RED_MODEL_ID
    ]);
  });

  it('persists an explicit Daybreak Blue disable independently of Red opt-in', () => {
    expect(filterEnabledProviderModelCatalogs(catalogs, {
      enabledOptionalModels: { 'openai-codex': [DAYBREAK_RED_MODEL_ID] },
      disabledOptionalModels: { 'openai-codex': [DAYBREAK_BLUE_MODEL_ID] }
    })[0]?.models.map((model) => model.id)).toEqual([DAYBREAK_RED_MODEL_ID]);
  });

  it('enables Fable by default while keeping Mythos opt-in', () => {
    expect(filterEnabledProviderModelCatalogs(catalogs, null)[1]?.models.map((model) => model.id)).toEqual([
      CLAUDE_FABLE_MODEL_ID
    ]);
    expect(filterEnabledProviderModelCatalogs(catalogs, {
      enabledOptionalModels: { anthropic: [CLAUDE_MYTHOS_MODEL_ID] }
    })[1]?.models.map((model) => model.id)).toEqual([
      CLAUDE_FABLE_MODEL_ID,
      CLAUDE_MYTHOS_MODEL_ID
    ]);
  });

  it('persists an explicit Fable disable independently of Mythos opt-in', () => {
    expect(filterEnabledProviderModelCatalogs(catalogs, {
      enabledOptionalModels: { anthropic: [CLAUDE_MYTHOS_MODEL_ID] },
      disabledOptionalModels: { anthropic: [CLAUDE_FABLE_MODEL_ID] }
    })[1]?.models.map((model) => model.id)).toEqual([CLAUDE_MYTHOS_MODEL_ID]);
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
