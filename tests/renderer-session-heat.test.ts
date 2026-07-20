import { describe, expect, it } from 'vitest';
import type { FindingRecord, HoneycrispMemorySummary, HypothesisRecord, RunDetail } from '@shared/types';
import { sessionHeatForDetail, sessionHeatForFinding, sessionHeatForHoneycrispMemory, sessionHeatForHypothesis } from '../src/renderer/view-models/sessionHeat';

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

  it('computes general research intensity from Honeycrisp memory state', () => {
    const memory = honeycrispMemory({
      primitiveStatus: 'confirmed'
    });

    expect(sessionHeatForHoneycrispMemory(memory)).toBe('high');
    expect(sessionHeatForDetail(runDetail({ honeycrispMemory: memory }))).toBe('high');
  });

  it('lets Beale vulnerability-specific rows boost Honeycrisp general heat', () => {
    const memory = honeycrispMemory({ primitiveStatus: 'suspected' });
    const finding = findingRecord({ state: 'reportable', priorityScore: 10, verifiedByVerifierRunId: 'verifier_run_test' });

    expect(sessionHeatForDetail(runDetail({ honeycrispMemory: memory, findings: [finding] }))).toBe('critical');
  });
});

function runDetail(input: { findings?: FindingRecord[]; honeycrispMemory?: HoneycrispMemorySummary; hypotheses?: HypothesisRecord[] } = {}): RunDetail {
  return {
    findings: input.findings ?? [],
    hypotheses: input.hypotheses ?? [],
    evidence: [],
    honeycrispMemory: input.honeycrispMemory
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

function honeycrispMemory(input: { primitiveStatus: string }): HoneycrispMemorySummary {
  return {
    status: 'ready',
    source: 'honeycrisp_sqlite',
    nodes: [{
      id: 'primitive_test',
      type: 'primitive',
      title: 'General primitive',
      summary: 'General primitive',
      body: '',
      status: input.primitiveStatus,
      confidence: 0.9,
      assetIds: [],
      tags: [],
      attributes: {},
      evidenceRefs: [{ id: 'evidence_test', kind: 'code', pathBase: 'repository', path: 'src/parser.ts', locator: {}, summary: 'Evidence', createdAt: '2026-01-01T00:00:00.000Z' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 1
    }]
  } as unknown as HoneycrispMemorySummary;
}
