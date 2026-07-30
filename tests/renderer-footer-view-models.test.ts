import { describe, expect, it } from 'vitest';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { contextMeterForDetail, visibleCacheHitRateLabel, visibleContextMeterLabel, visibleSessionTokenUsageLabel } from '../src/renderer/features/momentum/contextMeter';

describe('renderer session usage view models', () => {
  it('formats context usage against the default 200k limit', () => {
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

    expect(meter.label).toBe('136k/200k');
    expect(visibleContextMeterLabel(meter)).toBe('136k/200k');
    expect(visibleSessionTokenUsageLabel(meter)).toBe('136k');
    expect(meter.fraction).toBeCloseTo(136 / 200);
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

  it('does not count aggregate capture usage again when summing model calls', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [
          traceEvent({ payload: { usage: { total_tokens: 2_000 } } }),
          traceEvent({ id: 'trace_second', sequence: 2, payload: { usage: { total_tokens: 3_000 } } }),
          traceEvent({
            id: 'trace_capture',
            sequence: 3,
            type: 'artifact_created',
            createdAt: '2026-04-29T00:01:00.000Z',
            payload: { usage: { input_tokens: 4_500, total_tokens: 5_000 } }
          })
        ]
      })
    );

    expect(meter.totalSessionTokens).toBe(5_000);
    expect(meter.label).toBe('4.5k/200k');
  });

  it('uses aggregate capture usage when turn telemetry is unavailable', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [traceEvent({ type: 'artifact_created', payload: { usage: { input_tokens: 4_500, total_tokens: 5_000 } } })]
      })
    );

    expect(meter.totalSessionTokens).toBe(5_000);
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

    expect(meter.label).toBe('9.3k/200k');
    expect(visibleContextMeterLabel(meter)).toBe('9.3k/200k');
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

    expect(meter.label).toBe('12k/200k');
    expect(meter.totalSessionTokens).toBe(12_800);
    expect(meter.source).toBe('Honeycrisp reported model usage');
  });

  it('uses Pi cache tokens for full context size and session cache hit rate', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [
          traceEvent({
            payload: {
              usage: {
                input: 200,
                output: 50,
                cacheRead: 800,
                cacheWrite: 0,
                totalTokens: 1_050,
                cacheHitRate: 0.8,
                source: 'Honeycrisp reported model usage'
              }
            }
          })
        ]
      })
    );

    expect(meter.label).toBe('1k/200k');
    expect(meter.cacheReadTokens).toBe(800);
    expect(meter.cachePromptTokens).toBe(1_000);
    expect(meter.cacheHitRate).toBe(0.8);
    expect(visibleCacheHitRateLabel(meter)).toBe('80%');
  });

  it('weights cache hit rate by prompt tokens across model turns', () => {
    const meter = contextMeterForDetail(
      runDetail({
        traceEvents: [
          traceEvent({ payload: { usage: { input_tokens: 500, prompt_tokens: 1_000, cache_read_tokens: 500, cache_hit_rate: 0.5 } } }),
          traceEvent({ id: 'trace_second', sequence: 2, payload: { usage: { input_tokens: 100, prompt_tokens: 1_000, cache_read_tokens: 900, cache_hit_rate: 0.9 } } })
        ]
      })
    );

    expect(meter.cacheReadTokens).toBe(1_400);
    expect(meter.cachePromptTokens).toBe(2_000);
    expect(visibleCacheHitRateLabel(meter)).toBe('70%');
  });

  it('shows unavailable cache telemetry distinctly from a zero-percent hit rate', () => {
    const meter = contextMeterForDetail(runDetail({ traceEvents: [] }));
    expect(meter.cacheHitRate).toBeNull();
    expect(visibleCacheHitRateLabel(meter)).toBe('—');
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
});

function runDetail(input: {
  traceEvents?: TraceEventRecord[];
  contextCompactions?: Array<Record<string, unknown>>;
  modelSessions?: Array<Record<string, unknown>>;
  status?: 'active' | 'completed';
}): RunDetail {
  return {
    run: {
      status: input.status ?? 'active'
    },
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
