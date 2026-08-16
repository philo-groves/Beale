import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunDetail } from '@shared/types';
import { activeRunDetailPollMs, shouldReportRunDetailError } from '../src/renderer/hooks/useRunDetailPolling';

describe('renderer run-detail polling', () => {
  it('cancels stale loads, uses one incremental request, and keeps live commits urgent', () => {
    const source = readFileSync(
      new URL('../src/renderer/hooks/useRunDetailPolling.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('currentDetail?.run.id !== selectedRunId');
    expect(source).toContain("if (detailRef.current?.run.id !== selectedRunId) {\n      versionRef.current = null;");
    expect(source).not.toContain("timeAsync('ipc.getRunDetailVersion'");
    expect(source).toContain("'ipc.getRunDetailUpdate'");
    expect(source).toContain('detailRef.current = detail;');
    expect(source).toContain('if (update) {');
    expect(source).toContain('setRunDetail(detail);');
    expect(source).toContain('startTransition(() => setRunDetail(detail));');
    expect(source).toContain('window.beale.cancelRunDetailRequests();');
    expect(source).toContain("devInstrumentation.recordEvent('ipc.getRunDetailUpdate.retry'");
    expect(source).toContain('!shouldReportRunDetailError(detailRef.current, selectedRunId)');
  });

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
