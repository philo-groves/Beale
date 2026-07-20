import { describe, expect, it } from 'vitest';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { contextMeterForDetail, visibleContextMeterLabel, visibleSessionTokenUsageLabel } from '../src/renderer/features/momentum/contextMeter';
import { hostEnvironmentLabel } from '../src/renderer/view-models/environmentDisplay';

describe('renderer footer view models', () => {
  it('formats context usage against the default 372k Sol limit', () => {
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

    expect(meter.label).toBe('136k/372k');
    expect(visibleContextMeterLabel(meter)).toBe('136k/372k');
    expect(visibleSessionTokenUsageLabel(meter)).toBe('136k');
    expect(meter.fraction).toBeCloseTo(136 / 372);
  });

  it('formats cumulative session token usage with decimals starting at millions', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [
          traceEvent({ payload: { usage: { total_tokens: 50_000 } } }),
          traceEvent({ payload: { usage: { total_tokens: 1_250_000 } } }),
          traceEvent({ payload: { usage: { input_tokens: 1_800, output_tokens: 200 } } })
        ]
      })
    );

    expect(meter.totalSessionTokens).toBe(1_302_000);
    expect(visibleSessionTokenUsageLabel(meter)).toBe('1.3m');
    expect(sessionTokenLabelForTotal(50_000)).toBe('50k');
    expect(sessionTokenLabelForTotal(10_500_000)).toBe('10.5m');
    expect(sessionTokenLabelForTotal(1_100_000_000)).toBe('1.1b');
  });

  it('accepts host-agent camelCase usage and source labels', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [
          traceEvent({
            payload: {
              usage: {
                inputTokens: 9_269,
                source: 'Honeycrisp serialized capture estimate',
                estimated: true
              }
            }
          })
        ]
      })
    );

    expect(meter.label).toBe('9.3k/372k');
    expect(visibleContextMeterLabel(meter)).toBe('9.3k/372k');
    expect(visibleSessionTokenUsageLabel(meter)).toBe('0');
    expect(meter.source).toBe('Honeycrisp serialized capture estimate');
  });

  it('accepts Pi live usage field names', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [
          traceEvent({
            payload: {
              usage: {
                input: 12_000,
                output: 800,
                totalTokens: 12_800,
                source: 'Honeycrisp reported model usage'
              }
            }
          })
        ]
      })
    );

    expect(meter.label).toBe('12k/372k');
    expect(meter.totalSessionTokens).toBe(12_800);
    expect(meter.source).toBe('Honeycrisp reported model usage');
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

  it('formats host footer labels from host-owned state', () => {
    expect(hostEnvironmentLabel({ platform: 'linux', osLabel: '', isWsl: true, remoteName: 'Ubuntu' })).toBe('WSL: Ubuntu');
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

function sessionTokenLabelForTotal(totalTokens: number): string {
  return visibleSessionTokenUsageLabel(contextMeterForDetail(runDetail({ traceEvents: [traceEvent({ payload: { usage: { total_tokens: totalTokens } } })] })));
}
