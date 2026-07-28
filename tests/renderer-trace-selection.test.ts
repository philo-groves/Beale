import { describe, expect, it } from 'vitest';
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

  it('keeps selection independent from Beale-owned research records', () => {
    const events = [
      traceEvent('trace_hypothesis'),
      traceEvent('trace_finding', { findingId: 'finding_one' })
    ];

    expect(traceSelectionDetail(events, 'trace_hypothesis')).toEqual({ event: events[0] });
    expect(traceSelectionDetail(events, 'trace_finding')).toEqual({ event: events[1] });
    expect(traceSelectionDetail(events, 'missing')).toEqual({ event: null });
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
