import { describe, expect, it } from 'vitest';
import { HoneycrispRunEngine, steeringContinuationConsumed } from '../src/main/honeycrispRunEngine';

interface PendingSteeringHarness {
  requestId: string;
  type: 'steer';
  rootTurnAtDispatch: number;
  timeout: null;
  requiresReportRevision?: boolean;
  reportRevisionCompleted?: boolean;
}

interface ActiveRunHarness {
  stopped: boolean;
  context: {
    run: {
      id: string;
      budget: { resourceContext: { kind: 'report'; resourceId: string } };
    };
    attempt: { id: string };
  };
  pendingControls: Map<string, PendingSteeringHarness>;
  queuedContinuations: Map<string, PendingSteeringHarness>;
}

interface EngineHarness {
  activeRuns: Map<string, ActiveRunHarness>;
  db: { appendTraceEvent: (event: unknown) => void };
  onChange: (options?: unknown) => void;
  recordControlAcknowledgement: (
    context: ActiveRunHarness['context'],
    event: { kind: 'agent.event'; payload: Record<string, unknown> }
  ) => void;
  clearConsumedSteeringContinuations: (active: ActiveRunHarness, completedRootTurn: number) => void;
  markReportRevisionCompleted: (
    active: ActiveRunHarness,
    event: { kind: string; payload: Record<string, unknown> }
  ) => void;
}

describe('Honeycrisp steering continuation fallback', () => {
  it('requires a later completed root turn before treating accepted steering as consumed', () => {
    expect(steeringContinuationConsumed(3, 3)).toBe(false);
    expect(steeringContinuationConsumed(3, 4)).toBe(true);
  });

  it('accepts the first completed turn when steering arrived before any root turn was observed', () => {
    expect(steeringContinuationConsumed(undefined, 1)).toBe(true);
    expect(steeringContinuationConsumed(0, 1)).toBe(true);
  });

  it('does not consume report steering before the requested revision succeeds', () => {
    expect(steeringContinuationConsumed(3, 4, true, false)).toBe(false);
    expect(steeringContinuationConsumed(3, 4, true, true)).toBe(true);
  });

  it('retains acknowledged report steering until revision and response are both observed', () => {
    const requestId = 'control_report_change';
    const pending: PendingSteeringHarness = {
      requestId,
      type: 'steer',
      rootTurnAtDispatch: 1,
      timeout: null,
      requiresReportRevision: true
    };
    const active: ActiveRunHarness = {
      stopped: false,
      context: {
        run: {
          id: 'run_report',
          budget: { resourceContext: { kind: 'report', resourceId: 'report_1' } }
        },
        attempt: { id: 'attempt_initial' }
      },
      pendingControls: new Map([[requestId, pending]]),
      queuedContinuations: new Map()
    };
    const engine = Object.create(HoneycrispRunEngine.prototype) as EngineHarness;
    engine.activeRuns = new Map([[active.context.run.id, active]]);
    engine.db = { appendTraceEvent: () => undefined };
    engine.onChange = () => undefined;

    engine.recordControlAcknowledgement(active.context, {
      kind: 'agent.event',
      payload: {
        eventType: 'control.received',
        accepted: true,
        type: 'steer',
        requestId
      }
    });

    expect(active.pendingControls.has(requestId)).toBe(false);
    expect(active.queuedContinuations.has(requestId)).toBe(true);

    engine.clearConsumedSteeringContinuations(active, 2);

    expect(active.queuedContinuations.has(requestId)).toBe(true);

    engine.markReportRevisionCompleted(active, {
      kind: 'tool.observed',
      payload: {
        toolName: 'report.revise',
        status: 'complete',
        normalizedInputs: { id: 'report_1' }
      }
    });
    expect(pending.reportRevisionCompleted).toBe(true);

    engine.clearConsumedSteeringContinuations(active, 2);

    expect(active.queuedContinuations.has(requestId)).toBe(false);
  });
});
