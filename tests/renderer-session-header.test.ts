import { describe, expect, it } from 'vitest';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { sessionConfigPills, sessionDurationTiming } from '../src/renderer/view-models/sessionHeader';
import { latestTraceGroupKey, latestTraceTurnNumber, traceTurnNumber } from '../src/renderer/view-models/traceDisplay';

describe('renderer session header view models', () => {
  it('formats session configuration pills', () => {
    const detail = runDetail();

    expect(sessionConfigPills(detail)).toEqual([
      { label: 'Dynamic', tooltip: 'Mode: Dynamic' },
      { label: 'Breadth First', tooltip: 'Strategy: Breadth First' },
      { label: 'Scoped', tooltip: 'Network: Scoped' }
    ]);
  });

  it('isolates the session duration timing used outside the main header', () => {
    const detail = runDetail({ traceEvents: [traceEvent()] });

    expect(sessionDurationTiming(detail, Date.parse('2026-04-30T12:00:00.000Z'))).toMatchObject({
      durationMs: 300_000,
      durationLabel: '00:05:00'
    });
  });

  it('extracts trace turn numbers and latest group keys', () => {
    const events = [
      traceEvent({ id: 'trace_setup', sequence: 1, payload: {}, summary: 'Setup.' }),
      traceEvent({ id: 'trace_turn', sequence: 2, payload: { turn: '7' }, summary: 'Request for turn 7.' })
    ];

    expect(traceTurnNumber(events[0])).toBeNull();
    expect(traceTurnNumber(traceEvent({ payload: { turn: 3 }, summary: 'Request.' }))).toBe(3);
    expect(traceTurnNumber(traceEvent({ payload: {}, summary: 'Request for turn 4.' }))).toBe(4);
    expect(latestTraceTurnNumber(events)).toBe(7);
    expect(latestTraceGroupKey(events)).toBe('turn-7-2');
  });

  it('keeps child turns out of the root session turn count', () => {
    const events = [
      traceEvent({ id: 'root_turn', sequence: 1, payload: { turn: 2, agentPath: '/root' } }),
      traceEvent({ id: 'child_turn', sequence: 2, payload: { turn: 8, agentPath: '/root/worker' } })
    ];

    expect(latestTraceTurnNumber(events)).toBe(2);
    expect(latestTraceGroupKey(events)).toBe('agent-root-worker-turn-8-2');
  });
});

function runDetail(input: { traceEvents?: TraceEventRecord[]; findings?: Array<Record<string, unknown>> } = {}): RunDetail {
  return {
    run: {
      id: 'run_test',
      status: 'completed',
      createdAt: '2026-04-30T10:00:00.000Z',
      startedAt: '2026-04-30T10:00:00.000Z',
      endedAt: null,
      mode: 'dynamic',
      attemptStrategy: 'breadth_first',
      networkProfile: 'scoped',
      title: '',
      promptMarkdown: ''
    },
    attempts: [],
    traceEvents: input.traceEvents ?? [],
    transcriptMessages: [],
    hypotheses: [],
    artifacts: [],
    evidence: [],
    findings: input.findings ?? [],
    verifierContracts: [],
    verifierRuns: [],
    vmContexts: [],
    modelSessions: [],
    contextCompactions: [],
    policyEvents: [],
    exports: []
  } as unknown as RunDetail;
}

function traceEvent(input: Partial<TraceEventRecord> = {}): TraceEventRecord {
  return {
    id: 'trace_test',
    runId: 'run_test',
    attemptId: null,
    sequence: 1,
    source: 'model',
    type: 'model_message',
    summary: 'Request for turn 1.',
    payload: {},
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-04-30T10:05:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}
