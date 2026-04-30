import { describe, expect, it } from 'vitest';
import type { FindingRecord, HypothesisRecord, RunDetail } from '@shared/types';
import type { TraceDisplayEvent } from '../src/renderer/view-models/traceDisplay';
import {
  selectedTraceEventForId,
  traceSelectionDetail
} from '../src/renderer/view-models/traceSelection';

describe('renderer trace selection view model', () => {
  it('selects display events by id', () => {
    const events = [traceEvent('trace_one'), traceEvent('trace_two')];

    expect(selectedTraceEventForId(events, 'trace_two')?.id).toBe('trace_two');
    expect(selectedTraceEventForId(events, 'missing')).toBeNull();
    expect(selectedTraceEventForId(events, null)).toBeNull();
  });

  it('resolves hypothesis and finding context for selected trace events', () => {
    const hypothesis = { id: 'hypothesis_one', createdTraceEventId: 'trace_hypothesis' } as HypothesisRecord;
    const finding = { id: 'finding_one', hypothesisId: 'hypothesis_one' } as FindingRecord;
    const detail = {
      hypotheses: [hypothesis],
      findings: [finding]
    } as unknown as RunDetail;
    const events = [
      traceEvent('trace_hypothesis'),
      traceEvent('trace_finding', { findingId: 'finding_one' })
    ];

    expect(traceSelectionDetail(detail, events, 'trace_hypothesis')).toMatchObject({
      event: events[0],
      hypothesis,
      finding
    });
    expect(traceSelectionDetail(detail, events, 'trace_finding')).toMatchObject({
      event: events[1],
      finding
    });
    expect(traceSelectionDetail(detail, events, 'missing')).toEqual({
      event: null,
      finding: null,
      hypothesis: null
    });
  });
});

function traceEvent(id: string, payload: Record<string, unknown> = {}): TraceDisplayEvent {
  return {
    id,
    runId: 'run_test',
    attemptId: null,
    sequence: 1,
    source: 'model',
    type: 'model_message',
    summary: 'Trace event.',
    payload,
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-04-30T00:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null
  };
}
