import { describe, expect, it } from 'vitest';
import {
  SHELL_SAFETY_REVIEW_REASONING_EFFORT,
  SESSION_TITLE_REASONING_EFFORT,
  smallModelForProvider,
  sessionTitleModelForProvider
} from '../src/shared/modelDefaults';

describe('research session title models', () => {
  it('uses the designated small model for each supported provider', () => {
    expect(sessionTitleModelForProvider('openai-codex')).toBe('gpt-5.6-luna');
    expect(sessionTitleModelForProvider('anthropic')).toBe('claude-haiku-4-5');
    expect(sessionTitleModelForProvider('xai')).toBe('grok-4.3');
    expect(smallModelForProvider('openai-codex')).toBe('gpt-5.6-luna');
    expect(smallModelForProvider('anthropic')).toBe('claude-haiku-4-5');
    expect(smallModelForProvider('xai')).toBe('grok-4.3');
    expect(SESSION_TITLE_REASONING_EFFORT).toBe('medium');
    expect(SHELL_SAFETY_REVIEW_REASONING_EFFORT).toBe('medium');
  });

  it('does not invent a title model for unknown providers', () => {
    expect(sessionTitleModelForProvider('other')).toBeNull();
    expect(smallModelForProvider('other')).toBeNull();
  });
});
