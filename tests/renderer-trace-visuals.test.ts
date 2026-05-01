import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '../src/shared/types';
import {
  ALL_TRACE_CATEGORY_IDS,
  DEFAULT_TRACE_CATEGORY_IDS,
  TRACE_CATEGORY_OPTIONS,
  traceCategoryBadgeLabel,
  traceCategoryLabel,
  traceEventMarkerToneClass,
  traceTypeLabel
} from '../src/renderer/features/traces/traceVisuals';

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

  it('marks verifier contract failures with the failure marker tone without changing their category', () => {
    expect(
      traceEventMarkerToneClass(
        traceEvent({
          source: 'verifier',
          type: 'verifier_result',
          summary: 'Verifier contract executed on host with fail.',
          payload: { status: 'fail' }
        })
      )
    ).toBe('marker-verifier-failure');
    expect(
      traceEventMarkerToneClass(
        traceEvent({
          source: 'verifier',
          type: 'verifier_result',
          summary: 'Verifier contract executed on host with pass.',
          payload: { status: 'pass' }
        })
      )
    ).toBe('');
  });
});

function traceEvent(overrides: Partial<TraceEventRecord>): TraceEventRecord {
  return {
    id: 'trace_test',
    runId: 'run_test',
    attemptId: 'attempt_test',
    sequence: 1,
    source: 'system',
    type: 'model_message',
    summary: 'Trace event.',
    payload: {},
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...overrides
  };
}
