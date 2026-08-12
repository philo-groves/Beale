import { describe, expect, it } from 'vitest';
import {
  clampPriorityScoreForDisplay,
  formatDurationHms,
  formatPercent,
  formatPriorityPill,
  formatSessionDateTime,
  formatSessionStart,
  formatSessionTime,
  researchModelNameLabel,
  shortDate,
  stateClass,
  traceLabel,
  truncateText
} from '../src/renderer/lib/formatting';

describe('renderer formatting helpers', () => {
  it('formats session dates, times, and durations with compact product labels', () => {
    const date = new Date(2026, 3, 30, 0, 5, 9);

    expect(formatSessionTime(date)).toBe('12:05a');
    expect(formatSessionStart(date)).toBe('Apr 30, 12:05a');
    expect(formatSessionDateTime('not-a-date')).toBe('Unknown');
    expect(formatDurationHms(3_661_900)).toBe('01:01:01');
  });

  it('formats normalized labels and bounded priority pills', () => {
    expect(traceLabel('host_research_only')).toBe('Host Research Only');
    expect(formatPriorityPill(65.8)).toBe('P64');
    expect(clampPriorityScoreForDisplay(Number.NaN)).toBe(0);
  });

  it('omits only the leading GPT prefix from OpenAI model names', () => {
    expect(researchModelNameLabel('openai-codex', 'GPT-5.6 Sol')).toBe('5.6 Sol');
    expect(researchModelNameLabel('openai-codex', 'gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(researchModelNameLabel('openai-codex', 'Legacy GPT-5.6')).toBe('Legacy GPT-5.6');
    expect(researchModelNameLabel('anthropic', 'GPT-Compatible Claude')).toBe('GPT-Compatible Claude');
  });

  it('formats small utility labels consistently', () => {
    expect(formatPercent(0.125)).toBe('+13%');
    expect(formatPercent(-0.125)).toBe('-12%');
    expect(shortDate('2026-04-30T12:34:56.000Z')).toBe('2026-04-30');
    expect(stateClass('Needs Evidence!')).toBe('needs-evidence-');
    expect(truncateText('Trace output with a long body', 16)).toBe('Trace output...');
  });
});
