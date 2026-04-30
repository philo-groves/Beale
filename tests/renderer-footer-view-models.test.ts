import { describe, expect, it } from 'vitest';
import type { ExecutorStatus, RunDetail, TraceEventRecord, VmPreference } from '@shared/types';
import { contextMeterForDetail, visibleContextMeterLabel } from '../src/renderer/features/momentum/contextMeter';
import { hostEnvironmentLabel, vmTargetStatus } from '../src/renderer/view-models/environmentDisplay';

describe('renderer footer view models', () => {
  it('formats context usage against the default 272k limit', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [
          traceEvent({
            payload: {
              usage: {
                input_tokens: 136_000
              }
            }
          })
        ]
      })
    );

    expect(meter.label).toBe('136k/272k');
    expect(visibleContextMeterLabel(meter)).toBe('136k/272k');
    expect(meter.fraction).toBe(0.5);
  });

  it('uses compaction token pressure as the current context source when newer', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [
          traceEvent({
            createdAt: '2026-04-29T00:00:00.000Z',
            payload: {
              usage: {
                input_tokens: 30_000
              }
            }
          })
        ],
        contextCompactions: [
          {
            tokenPressure: {
              inputTokenLimit: 500_000,
              latestReportedInputTokens: 250_000
            },
            createdAt: '2026-04-29T00:01:00.000Z',
            serializedSizeBytes: 0
          }
        ]
      })
    );

    expect(meter.label).toBe('250k/500k');
    expect(meter.source).toBe('compaction pressure');
  });

  it('formats host and VM footer labels from host-owned capability state', () => {
    expect(hostEnvironmentLabel({ platform: 'linux', osLabel: '', isWsl: true, remoteName: 'Ubuntu' })).toBe('WSL: Ubuntu');

    const vmPreference: VmPreference = {
      enabled: true,
      backendKind: 'firecracker',
      updatedAt: '2026-04-29T00:00:00.000Z'
    };
    const target = vmTargetStatus(executorStatus(), vmPreference);

    expect(target.configured).toBe(true);
    expect(target.showConfigure).toBe(false);
    expect(target.label).toBe('Firecracker');
  });
});

function runDetail(input: { traceEvents?: TraceEventRecord[]; contextCompactions?: Array<Record<string, unknown>>; modelSessions?: Array<Record<string, unknown>> }): RunDetail {
  return {
    traceEvents: input.traceEvents ?? [],
    contextCompactions: input.contextCompactions ?? [],
    modelSessions: input.modelSessions ?? []
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
    summary: 'Response completed.',
    payload: {},
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-04-29T00:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}

function executorStatus(): ExecutorStatus {
  return {
    provider: 'vmctl',
    configured: true,
    available: true,
    label: 'Firecracker',
    reason: null,
    targetExecution: true,
    supportedNetworkProfiles: ['offline', 'scoped', 'elevated'],
    supports: {
      snapshots: true,
      clone: true,
      import: true,
      export: true,
      shell: true,
      python: true,
      debugger: true
    },
    backends: [
      {
        kind: 'firecracker',
        label: 'Firecracker',
        platform: 'linux',
        configured: true,
        available: true,
        recommended: true,
        reason: null
      }
    ]
  };
}
