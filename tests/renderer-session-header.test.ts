import { describe, expect, it } from 'vitest';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { runStatusClass, sessionConfigPills, sessionHeaderTiming } from '../src/renderer/view-models/sessionHeader';
import { latestTraceGroupKey, latestTraceTurnNumber, traceTurnNumber } from '../src/renderer/view-models/traceDisplay';

describe('renderer session header view models', () => {
  it('formats status and session configuration pills', () => {
    const detail = runDetail();

    expect(runStatusClass('failed')).toBe('failed');
    expect(runStatusClass('stopped')).toBe('paused');
    expect(sessionConfigPills(detail)).toEqual([
      { label: 'Dynamic', tooltip: 'Mode: Dynamic' },
      { label: 'Breadth First', tooltip: 'Strategy: Breadth First' },
      { label: 'Scoped', tooltip: 'Network: Scoped' }
    ]);
  });

  it('builds session timing metrics from trace filters and latest run detail timestamp', () => {
    const events = [
      traceEvent({ id: 'trace_agent', sequence: 1, payload: { transcriptRole: 'assistant', turn: 1 }, summary: 'Agent response.' }),
      traceEvent({ id: 'trace_tool', sequence: 2, source: 'tool', type: 'tool_result', payload: { turn: '2' }, summary: 'Tool returned output.' })
    ];
    const detail = runDetail({
      traceEvents: events,
      findings: [{ createdAt: '2026-04-30T10:15:00.000Z', updatedAt: '2026-04-30T10:30:00.000Z' }]
    });

    const timing = sessionHeaderTiming(detail, events, ['agent_output'], Date.parse('2026-04-30T12:00:00.000Z'));

    expect(timing).toMatchObject({
      latestTurn: 2,
      visibleEventCount: 1,
      totalEventCount: 2,
      eventMetric: '2',
      durationLabel: '00:30:00',
      turnTooltip: 'Current model turn.'
    });
    expect(timing?.durationTooltip).toBe('Created Apr 30, 6:00a\nUpdated Apr 30, 6:30a');
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
