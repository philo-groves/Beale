import { describe, expect, it } from 'vitest';
import { ensureDefaultResearchCollaborator, normalizeResearchCollaboration } from '../src/shared/collaboration';
import { selectNextAvailableCollaborator } from '../src/renderer/features/sessions/StartRunForm';

describe('research collaboration normalization', () => {
  it('always requires independent first passes', () => {
    expect(normalizeResearchCollaboration({ independentFirstPass: false }).independentFirstPass).toBe(true);
    expect(normalizeResearchCollaboration({ independentFirstPass: true }).independentFirstPass).toBe(true);
    expect(normalizeResearchCollaboration(undefined).independentFirstPass).toBe(true);
  });

  it('allows distinct models from one provider while preventing exact duplicates', () => {
    const collaboration = normalizeResearchCollaboration({
      mode: 'adaptive',
      intensity: 'balanced',
      providers: [
        { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: true },
        { provider: 'anthropic', model: 'claude-sonnet-5', reasoningEffort: 'high', enabled: true },
        { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'medium', enabled: false }
      ]
    });

    expect(collaboration.providers).toEqual([
      { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: true },
      { provider: 'anthropic', model: 'claude-sonnet-5', reasoningEffort: 'high', enabled: true }
    ]);
  });

  it('fills unused providers before stacking another model from a represented provider', () => {
    const anthropicOpus = { provider: 'anthropic' as const, model: 'claude-opus-5' };
    const anthropicSonnet = { provider: 'anthropic' as const, model: 'claude-sonnet-5' };
    const xaiGrok = { provider: 'xai' as const, model: 'grok-4.6' };
    const openAiLuna = { provider: 'openai-codex' as const, model: 'gpt-5.6-luna' };

    expect(selectNextAvailableCollaborator(
      [anthropicOpus, anthropicSonnet, xaiGrok, openAiLuna],
      [],
      'openai-codex'
    )).toBe(anthropicOpus);
    expect(selectNextAvailableCollaborator(
      [anthropicSonnet, xaiGrok, openAiLuna],
      [anthropicOpus],
      'openai-codex'
    )).toBe(xaiGrok);
    expect(selectNextAvailableCollaborator(
      [anthropicSonnet, openAiLuna],
      [anthropicOpus, xaiGrok],
      'openai-codex'
    )).toBe(anthropicSonnet);
  });

  it('enables the lead model only when no collaborator has been selected', () => {
    const collaboration = normalizeResearchCollaboration({
      mode: 'adaptive',
      intensity: 'balanced',
      providers: [
        { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high', enabled: false },
        { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: false }
      ]
    });
    const withDefault = ensureDefaultResearchCollaborator(collaboration, {
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
      enabled: true
    });

    expect(withDefault.providers).toEqual([
      { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'xhigh', enabled: true },
      { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: false }
    ]);
    expect(ensureDefaultResearchCollaborator({
      ...withDefault,
      providers: withDefault.providers.map((preference) => ({
        ...preference,
        enabled: preference.provider === 'anthropic'
      }))
    }, {
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      enabled: true
    }).providers).toEqual([
      { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'xhigh', enabled: false },
      { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: true }
    ]);
  });
});
