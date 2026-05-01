import { describe, expect, it } from 'vitest';
import type { FindingRecord, HypothesisRecord, RunDetail } from '@shared/types';
import { sessionHeatForDetail, sessionHeatForFinding, sessionHeatForHypothesis } from '../src/renderer/view-models/sessionHeat';

describe('renderer session heat view models', () => {
  it('returns none for missing or ignored research records', () => {
    expect(sessionHeatForDetail(null)).toBe('none');
    expect(sessionHeatForDetail(runDetail({ findings: [findingRecord({ state: 'duplicate', priorityScore: 64 })] }))).toBe('none');
  });

  it('uses verified finding evidence to preserve critical heat', () => {
    const finding = findingRecord({
      title: 'Remote code execution',
      impactMarkdown: 'RCE enables code execution.',
      priorityScore: 64,
      verifiedByVerifierRunId: 'verifier_run_test'
    });

    expect(sessionHeatForFinding(finding, null)).toBe('critical');
    expect(sessionHeatForDetail(runDetail({ findings: [finding] }))).toBe('critical');
  });

  it('treats reportable findings as critical heat', () => {
    const finding = findingRecord({ state: 'reportable', priorityScore: 10, verifiedByVerifierRunId: 'verifier_run_test' });

    expect(sessionHeatForFinding(finding, null)).toBe('critical');
  });

  it('caps hypothesis-only leads below confirmed finding severity', () => {
    const hypothesis = hypothesisRecord({
      impact: 'critical compromise',
      attackerReachability: 'remote attacker',
      evidenceConfidence: 'hypothesis only',
      priorityScore: 64
    });

    expect(sessionHeatForHypothesis(hypothesis)).toBe('low');
  });
});

function runDetail(input: { findings?: FindingRecord[]; hypotheses?: HypothesisRecord[] } = {}): RunDetail {
  return {
    findings: input.findings ?? [],
    hypotheses: input.hypotheses ?? [],
    evidence: []
  } as unknown as RunDetail;
}

function findingRecord(input: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'finding_test',
    hypothesisId: null,
    title: 'Finding',
    state: 'verified',
    priorityScore: 42,
    summaryMarkdown: '',
    impactMarkdown: '',
    verifiedByVerifierRunId: null,
    ...input
  } as unknown as FindingRecord;
}

function hypothesisRecord(input: Partial<HypothesisRecord> = {}): HypothesisRecord {
  return {
    id: 'hypothesis_test',
    state: 'needs_evidence',
    priorityScore: 12,
    impact: 'static lead',
    attackerReachability: 'unknown',
    evidenceConfidence: 'hypothesis only',
    ...input
  } as unknown as HypothesisRecord;
}
