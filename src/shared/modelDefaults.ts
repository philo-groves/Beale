export const DEFAULT_RESEARCH_MODEL = 'gpt-5.6-sol';
export const DEFAULT_RESEARCH_REASONING_EFFORT = 'high';

export const SESSION_TITLE_MODEL_BY_PROVIDER = {
  'openai-codex': 'gpt-5.6-luna',
  anthropic: 'claude-haiku-4-5',
  xai: 'grok-4.3'
} as const;
export const SESSION_TITLE_REASONING_EFFORT = 'medium';

export function sessionTitleModelForProvider(provider: string): string | null {
  return SESSION_TITLE_MODEL_BY_PROVIDER[provider as keyof typeof SESSION_TITLE_MODEL_BY_PROVIDER] ?? null;
}
