import { describe, expect, it } from 'vitest';
import { ALL_TRACE_CATEGORY_IDS, DEFAULT_TRACE_CATEGORY_IDS, TRACE_CATEGORY_OPTIONS, traceCategoryBadgeLabel, traceCategoryLabel, traceTypeLabel } from '../src/renderer/features/traces/traceVisuals';

describe('renderer trace visual helpers', () => {
  it('keeps trace filter metadata and labels in sync', () => {
    expect(ALL_TRACE_CATEGORY_IDS).toEqual(TRACE_CATEGORY_OPTIONS.map((option) => option.id));
    expect(DEFAULT_TRACE_CATEGORY_IDS).not.toContain('non_standard');
    expect(ALL_TRACE_CATEGORY_IDS).toContain('non_standard');
    expect(traceCategoryLabel('code_navigation')).toBe('Code Nav');
    expect(traceCategoryLabel('failure_recovery')).toBe('Error');
    expect(traceCategoryLabel('non_standard')).toBe('Non-standard');
    expect(traceCategoryBadgeLabel('evidence')).toBe('Evidence');
    expect(traceCategoryBadgeLabel('reasoning')).toBe('Agent Output');
  });

  it('formats trace type labels for detail metadata', () => {
    expect(traceTypeLabel('model_message')).toBe('Model Message');
    expect(traceTypeLabel('tool_result')).toBe('Tool Result');
  });
});
