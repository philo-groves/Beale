import { describe, expect, it } from 'vitest';
import type { EvidenceRecord, FindingRecord, HypothesisRecord, TraceEventRecord } from '@shared/types';
import {
  buildEvidenceTrails,
  evidenceScrollKey,
  findingScrollKey,
  hypothesisScrollKey,
  sortedEvidence,
  traceEventForEvidence,
  traceEventForFinding,
  traceEventForHypothesis
} from '../src/renderer/view-models/researchItems';

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
    expect(evidenceScrollKey([evidenceRecord({ summary: 'Runtime crash' })])).toContain('evidence_test:runtime:Runtime crash:2026-04-30T10:00:00.000Z');
  });

  it('sorts evidence newest first for the evidence sidebar', () => {
    const older = evidenceRecord({ id: 'older', createdAt: '2026-04-30T10:00:00.000Z' });
    const newer = evidenceRecord({ id: 'newer', createdAt: '2026-04-30T11:00:00.000Z' });

    expect(sortedEvidence([older, newer]).map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('builds evidence trails from hypothesis, finding, and evidence links', () => {
    const hypothesis = hypothesisRecord({ id: 'hypothesis_one', updatedAt: '2026-04-30T10:00:00.000Z' });
    const finding = findingRecord({ id: 'finding_one', hypothesisId: hypothesis.id, updatedAt: '2026-04-30T10:30:00.000Z' });
    const hypothesisEvidence = evidenceRecord({ id: 'evidence_hypothesis', hypothesisId: hypothesis.id, createdAt: '2026-04-30T10:20:00.000Z' });
    const findingEvidence = evidenceRecord({ id: 'evidence_finding', findingId: finding.id, createdAt: '2026-04-30T10:40:00.000Z' });
    const looseEvidence = evidenceRecord({ id: 'evidence_loose', createdAt: '2026-04-30T11:00:00.000Z' });

    const trails = buildEvidenceTrails([hypothesis], [finding], [hypothesisEvidence, findingEvidence, looseEvidence]);

    expect(trails.map((trail) => trail.id)).toEqual(['evidence:evidence_loose', 'hypothesis:hypothesis_one']);
    expect(trails[1].findings.map((item) => item.id)).toEqual(['finding_one']);
    expect(trails[1].evidence.map((item) => item.id)).toEqual(['evidence_finding', 'evidence_hypothesis']);
  });

  it('finds evidence provenance from direct observations and verifier/artifact references', () => {
    const observation = traceEvent({ id: 'trace_observation' });
    const verifier = traceEvent({ id: 'trace_verifier', payload: { verifier_run_id: 'verifier_one' } });

    expect(traceEventForEvidence([verifier, observation], evidenceRecord({ observationTraceEventId: 'trace_observation' }))?.id).toBe('trace_observation');
    expect(traceEventForEvidence([verifier], evidenceRecord({ verifierRunId: 'verifier_one' }))?.id).toBe('trace_verifier');
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
    updatedAt: '2026-04-30T10:00:00.000Z',
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
    updatedAt: '2026-04-30T10:00:00.000Z',
    ...input
  } as unknown as FindingRecord;
}

function evidenceRecord(input: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 'evidence_test',
    kind: 'runtime',
    summary: 'Evidence',
    createdAt: '2026-04-30T10:00:00.000Z',
    hypothesisId: null,
    findingId: null,
    observationTraceEventId: null,
    artifactId: null,
    verifierRunId: null,
    ...input
  } as unknown as EvidenceRecord;
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
