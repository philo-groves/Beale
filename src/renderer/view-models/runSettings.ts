import type { StartRunInput } from '@shared/types';
import { DEFAULT_RESEARCH_MODEL, DEFAULT_RESEARCH_REASONING_EFFORT } from '../../shared/modelDefaults';

export const UNBOUNDED_MINUTES = 999_999;
export const UNBOUNDED_ATTEMPTS = 999_999;

export const defaultRunInput: StartRunInput = {
  runEngine: 'honeycrisp',
  provider: 'openai-codex',
  goalEnabled: true,
  promptMarkdown: '',
  mode: 'dynamic',
  attemptStrategy: 'iterative_research',
  model: DEFAULT_RESEARCH_MODEL,
  reasoningEffort: DEFAULT_RESEARCH_REASONING_EFFORT,
  networkProfile: 'elevated',
  sandboxProfile: 'host',
  budget: {
    maxMinutes: UNBOUNDED_MINUTES,
    maxAttempts: 1,
    maxCostUsd: 0
  }
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
