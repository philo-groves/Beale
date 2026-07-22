import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '../src/shared/types';
import {
  ALL_TRACE_CATEGORY_IDS,
  DEFAULT_TRACE_CATEGORY_IDS,
  TRACE_CATEGORY_OPTIONS,
  traceCategoryBadgeLabel,
  traceCategoryIcon,
  traceCategoryLabel,
  traceEventIcon,
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
    expect(traceCategoryBadgeLabel('evidence')).toBe('References');
    expect(traceCategoryBadgeLabel('reasoning')).toBe('Reasoning');
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

  it('uses the request symbol and status-colored marker tone for Honeycrisp tool observations', () => {
    const request = honeycrispToolEvent('tool.requested', 'complete');
    const success = honeycrispToolEvent('tool.observed', 'complete');
    const failure = honeycrispToolEvent('tool.observed', 'error', { message: 'Read failed' });

    expect(traceEventIcon(request, 'non_standard').type).toBe(traceCategoryIcon('tools').type);
    expect(traceEventIcon(success, 'tools').type).toBe(traceEventIcon(request, 'non_standard').type);
    expect(traceEventIcon(failure, 'failure_recovery').type).toBe(traceEventIcon(request, 'non_standard').type);
    expect(traceEventMarkerToneClass(success)).toBe('marker-tool-observation-success');
    expect(traceEventMarkerToneClass(failure)).toBe('marker-tool-observation-failure');
  });
});

function honeycrispToolEvent(kind: 'tool.requested' | 'tool.observed', status: string, error?: Record<string, unknown>): TraceEventRecord {
  return traceEvent({
    source: kind === 'tool.requested' ? 'model' : 'tool',
    type: kind === 'tool.requested' ? 'tool_call' : 'tool_result',
    summary: `Honeycrisp ${kind}: file.read`,
    payload: {
      honeycrispKind: kind,
      payload: {
        toolActionId: 'action_file_read',
        toolName: 'file.read',
        status,
        ...(error ? { error } : {})
      }
    }
  });
}

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
