export const DEFAULT_RESEARCH_MODEL = 'gpt-5.6-sol';
export const DEFAULT_RESEARCH_REASONING_EFFORT = 'high';

export const SMALL_MODEL_BY_PROVIDER = {
  'openai-codex': 'gpt-5.6-luna',
  anthropic: 'claude-haiku-4-5',
  xai: 'grok-4.3',
  zai: 'glm-5-turbo'
} as const;
export const SESSION_TITLE_MODEL_BY_PROVIDER = SMALL_MODEL_BY_PROVIDER;
export const SESSION_TITLE_REASONING_EFFORT = 'medium';
export const SHELL_SAFETY_REVIEW_REASONING_EFFORT = 'medium';

export function smallModelForProvider(provider: string): string | null {
  return SMALL_MODEL_BY_PROVIDER[provider as keyof typeof SMALL_MODEL_BY_PROVIDER] ?? null;
}

export function sessionTitleModelForProvider(provider: string): string | null {
  return smallModelForProvider(provider);
}
