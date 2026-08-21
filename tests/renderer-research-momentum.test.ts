import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { researchMomentumForDetail } from '../src/renderer/view-models/researchMomentum';

describe('renderer research momentum view model', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports idle when no session is selected', () => {
    expect(researchMomentumForDetail(null, 'none').state).toBe('idle');
  });

  it('detects verification work from recent verifier and execution traces', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const momentum = researchMomentumForDetail(
      runDetail({
        traceEvents: [
          traceEvent({
            id: 'trace_verify',
            source: 'verifier',
            type: 'verifier_result',
            summary: 'Verifier reproduced crash.',
            createdAt: '2026-04-30T11:59:30.000Z'
          })
        ]
      }),
      'none'
    );

    expect(momentum.state).toBe('verifying');
    expect(momentum.supportingTraceEventIds).toEqual(['trace_verify']);
  });

  it('marks repeated source availability blockers as stuck', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const momentum = researchMomentumForDetail(
      runDetail({
        traceEvents: [
          traceEvent({ id: 'trace_source_1', summary: 'Source unavailable.', createdAt: '2026-04-30T11:59:00.000Z' }),
          traceEvent({ id: 'trace_source_2', summary: 'No local source found.', createdAt: '2026-04-30T11:59:30.000Z' })
        ]
      }),
      'none'
    );

    expect(momentum.state).toBe('stuck');
    expect(momentum.reason).toBe('Repeated source availability blockers detected.');
  });

  it('treats Honeycrisp memory graph mutations as building activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'));

    const momentum = researchMomentumForDetail(
      runDetail({
        traceEvents: [traceEvent({
          id: 'trace_memory_correct',
          source: 'tool',
          type: 'tool_result',
          summary: 'Honeycrisp tool.observed: memory.correct',
          payload: {
            honeycrispKind: 'tool.observed',
            payload: { toolName: 'memory.correct' }
          },
          createdAt: '2026-07-21T11:59:30.000Z'
        })]
      }),
      'medium'
    );

    expect(momentum.state).toBe('building');
    expect(momentum.supportingTraceEventIds).toEqual(['trace_memory_correct']);
  });

  it('uses a recent current-session chain memory for hot momentum', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'));

    const detail = runDetail({
      traceEvents: [traceEvent({
        id: 'trace_agent',
        summary: 'Continuing analysis.',
        createdAt: '2026-07-21T11:59:30.000Z'
      })]
    });
    detail.honeycrispMemory = {
      status: 'ready',
      nodes: [{
        sessionIds: ['run_test'],
        type: 'chain',
        status: 'confirmed',
        updatedAt: '2026-07-21T11:59:45.000Z'
      }]
    } as unknown as RunDetail['honeycrispMemory'];

    const momentum = researchMomentumForDetail(detail, 'critical');

    expect(momentum.state).toBe('hot');
  });

  it('prefers typed campaign momentum over contradictory trace wording', () => {
    const detail = runDetail({ traceEvents: [traceEvent({ summary: 'No local source found. Retrying.' })] });
    detail.honeycrispMemory = {
      campaign: { momentum: { state: 'verifying', reason: 'Independent verification is the next evidence gate.', supportingNodeIds: ['finding:one'] } }
    } as unknown as RunDetail['honeycrispMemory'];

    const momentum = researchMomentumForDetail(detail, 'none');

    expect(momentum.state).toBe('verifying');
    expect(momentum.reason).toBe('Independent verification is the next evidence gate.');
    expect(momentum.supportingTraceEventIds).toEqual([]);
  });
});

function runDetail(input: { traceEvents?: TraceEventRecord[]; status?: string } = {}): RunDetail {
  return {
    run: {
      id: 'run_test',
      status: input.status ?? 'active'
    },
    traceEvents: input.traceEvents ?? [],
    findings: [],
    hypotheses: []
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
    summary: 'Inspect repository.',
    payload: {},
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-04-30T11:59:00.000Z',
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}
