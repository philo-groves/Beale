import { describe, expect, it } from 'vitest';
import type { FindingRecord, HypothesisRecord, TraceEventRecord } from '@shared/types';
import { findingScrollKey, hypothesisScrollKey, traceEventForFinding, traceEventForHypothesis } from '../src/renderer/view-models/researchItems';

describe('renderer research item view models', () => {
  it('finds hypothesis provenance by created event and payload references', () => {
    const created = traceEvent({ id: 'trace_created', type: 'user_note', payload: {} });
    const merged = traceEvent({ id: 'trace_merge', type: 'hypothesis_event', payload: { targetHypothesisId: 'hypothesis_test' } });
    const hypothesis = hypothesisRecord({ createdTraceEventId: 'trace_created' });

    expect(traceEventForHypothesis([merged, created], hypothesis)?.id).toBe('trace_created');
    expect(traceEventForHypothesis([merged], hypothesisRecord())?.id).toBe('trace_merge');
  });

  it('finds finding provenance directly or through its linked hypothesis', () => {
    const direct = traceEvent({ id: 'trace_finding', type: 'finding_event', payload: { findingId: 'finding_test' } });
    const hypothesisEvent = traceEvent({ id: 'trace_hypothesis', type: 'hypothesis_event', payload: { hypothesisId: 'hypothesis_test' } });
    const hypothesis = hypothesisRecord();

    expect(traceEventForFinding([hypothesisEvent, direct], findingRecord(), hypothesis)?.id).toBe('trace_finding');
    expect(traceEventForFinding([hypothesisEvent], findingRecord(), hypothesis)?.id).toBe('trace_hypothesis');
  });

  it('builds stable scroll keys from visible card fields', () => {
    expect(hypothesisScrollKey([hypothesisRecord({ title: 'A', descriptionMarkdown: 'abc' })])).toContain('hypothesis_test:needs_evidence:12:A:3');
    expect(findingScrollKey([findingRecord({ title: 'B', summaryMarkdown: 'abcd' })])).toContain('finding_test:verified:42:B:4');
  });
});

function hypothesisRecord(input: Partial<HypothesisRecord> = {}): HypothesisRecord {
  return {
    id: 'hypothesis_test',
    title: 'Hypothesis',
    state: 'needs_evidence',
    priorityScore: 12,
    descriptionMarkdown: '',
    createdTraceEventId: null,
    cweMappings: [],
    ...input
  } as unknown as HypothesisRecord;
}

function findingRecord(input: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'finding_test',
    hypothesisId: 'hypothesis_test',
    title: 'Finding',
    state: 'verified',
    priorityScore: 42,
    summaryMarkdown: '',
    cweMappings: [],
    ...input
  } as unknown as FindingRecord;
}

function traceEvent(input: Partial<TraceEventRecord>): TraceEventRecord {
  return {
    id: 'trace_test',
    runId: 'run_test',
    attemptId: null,
    sequence: 1,
    source: 'system',
    type: 'user_note',
    summary: 'Trace event.',
    payload: {},
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-04-30T10:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}
