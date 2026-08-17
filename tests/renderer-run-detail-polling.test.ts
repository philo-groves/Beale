import { describe, expect, it } from 'vitest';
import type { RunDetail } from '@shared/types';
import { activeRunDetailPollMs, shouldReportRunDetailError } from '../src/renderer/hooks/useRunDetailPolling';

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
});

function detailWithRecords(traceEventCount: number): RunDetail {
  return {
    traceEvents: Array.from({ length: traceEventCount }, () => ({})),
    transcriptMessages: []
  } as unknown as RunDetail;
}
