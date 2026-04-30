import type { StartRunInput } from '@shared/types';

export const UNBOUNDED_MINUTES = 999_999;
export const UNBOUNDED_ATTEMPTS = 999_999;

export const defaultRunInput: StartRunInput = {
  runEngine: 'openai_responses',
  promptMarkdown: '',
  mode: 'dynamic',
  attemptStrategy: 'adaptive_portfolio',
  model: 'gpt-5.5',
  reasoningEffort: 'xhigh',
  networkProfile: 'elevated',
  sandboxProfile: 'host_research_only',
  budget: {
    maxMinutes: UNBOUNDED_MINUTES,
    maxAttempts: 1,
    maxCostUsd: 0
  },
  fakeScenario: 'adaptive_portfolio'
};

export function budgetNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function optionalPositiveInteger(rawValue: string, fallback: number): number {
  const trimmed = rawValue.trim();
  if (!trimmed) return fallback;
  const value = Math.floor(Number(trimmed));
  return Number.isFinite(value) ? Math.max(1, value) : fallback;
}

export function extendBudgetLimit(value: unknown, unboundedValue: number, step: number): number {
  const current = budgetNumber(value, unboundedValue);
  return current >= unboundedValue ? unboundedValue : current + step;
}

export function clientRequestId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
