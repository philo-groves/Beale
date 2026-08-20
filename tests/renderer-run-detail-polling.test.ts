import { describe, expect, it } from 'vitest';
import type { RunDetail, RunRecord } from '@shared/types';
import { activeRunDetailPollMs, optimisticRunDetail, sessionSetupComplete, shouldReportRunDetailError } from '../src/renderer/hooks/useRunDetailPolling';

describe('renderer run-detail polling', () => {
  it('backs off live polling as retained session history grows', () => {
    expect(activeRunDetailPollMs(detailWithRecords(0))).toBe(750);
    expect(activeRunDetailPollMs(detailWithRecords(5_000))).toBe(1_250);
    expect(activeRunDetailPollMs(detailWithRecords(20_000))).toBe(2_000);
    expect(activeRunDetailPollMs(detailWithRecords(0), 1)).toBe(1_500);
    expect(activeRunDetailPollMs(detailWithRecords(20_000), 4)).toBe(10_000);
  });

  it('keeps a loaded session usable when an incremental refresh fails', () => {
    const detail = detailWithRecords(1);
    detail.run = { id: 'run_loaded' } as RunDetail['run'];

    expect(shouldReportRunDetailError(detail, 'run_loaded')).toBe(false);
    expect(shouldReportRunDetailError(detail, 'run_other')).toBe(true);
    expect(shouldReportRunDetailError(null, 'run_loaded')).toBe(true);
  });

  it('primes a new session detail from its durable run record', () => {
    const detail = optimisticRunDetail({
      id: 'run_new',
      status: 'active',
      promptMarkdown: 'Inspect the parser boundary.',
      createdAt: '2026-08-20T12:00:00.000Z'
    } as RunRecord);

    expect(detail.run.id).toBe('run_new');
    expect(detail.run.promptMarkdown).toBe('Inspect the parser boundary.');
    expect(detail.traceEvents).toEqual([]);
    expect(detail.transcriptMessages).toEqual([]);
    expect(sessionSetupComplete(detail, 'database:1')).toBe(false);
    expect(sessionSetupComplete(detail, 'honeycrisp:1')).toBe(true);

    detail.attempts = [{}] as RunDetail['attempts'];
    expect(sessionSetupComplete(detail, 'database:2')).toBe(true);
  });
});

function detailWithRecords(traceEventCount: number): RunDetail {
  return {
    traceEvents: Array.from({ length: traceEventCount }, () => ({})),
    transcriptMessages: []
  } as unknown as RunDetail;
}
