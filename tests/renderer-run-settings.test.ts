import { describe, expect, it, vi } from 'vitest';
import {
  budgetNumber,
  clientRequestId,
  defaultRunInput,
  extendBudgetLimit,
  optionalPositiveInteger,
  UNBOUNDED_ATTEMPTS,
  UNBOUNDED_MINUTES
} from '../src/renderer/view-models/runSettings';

describe('renderer run settings view model', () => {
  it('keeps new research sessions unlimited by minutes but one branch by default', () => {
    expect(defaultRunInput.budget.maxMinutes).toBe(UNBOUNDED_MINUTES);
    expect(defaultRunInput.budget.maxAttempts).toBe(1);
    expect(defaultRunInput.runEngine).toBe('openai_responses');
  });

  it('parses optional positive integers and preserves unbounded budget extension', () => {
    expect(optionalPositiveInteger('', UNBOUNDED_MINUTES)).toBe(UNBOUNDED_MINUTES);
    expect(optionalPositiveInteger('3.8', UNBOUNDED_MINUTES)).toBe(3);
    expect(budgetNumber('bad', UNBOUNDED_ATTEMPTS)).toBe(UNBOUNDED_ATTEMPTS);
    expect(extendBudgetLimit(UNBOUNDED_MINUTES, UNBOUNDED_MINUTES, 30)).toBe(UNBOUNDED_MINUTES);
    expect(extendBudgetLimit(60, UNBOUNDED_MINUTES, 30)).toBe(90);
  });

  it('builds stable-prefixed client request ids', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(clientRequestId('research_prompt')).toMatch(/^research_prompt_/);
  });
});
