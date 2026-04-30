import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { environmentActivityForDetail } from '../src/renderer/view-models/environmentDisplay';
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

  it('uses host/guest activity from the latest trace event', () => {
    expect(environmentActivityForDetail(null)).toEqual({ host: false, guest: false });
    expect(
      environmentActivityForDetail(
        runDetail({
          traceEvents: [
            traceEvent({
              source: 'executor',
              type: 'tool_result',
              summary: 'Guest python operation finished with success.'
            })
          ]
        })
      )
    ).toEqual({ host: false, guest: true });
  });
});

function runDetail(input: { traceEvents?: TraceEventRecord[]; status?: string } = {}): RunDetail {
  return {
    run: {
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
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}
