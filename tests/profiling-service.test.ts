import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProfilingService } from '../src/main/profilingService';
import type { ProfilingReport } from '../src/shared/types';

describe('profiling service', () => {
  it('writes structured JSONL records while enabled', () => {
    const root = mkdtempSync(join(tmpdir(), 'beale-profiling-test-'));
    try {
      const service = new ProfilingService(root);
      const enabled = service.setEnabled(true);

      expect(enabled.enabled).toBe(true);
      expect(enabled.outputPath).toContain(root);

      service.recordRendererReport(report());
      service.recordMainTiming('getRunDetail', 12.34, { run: 'run_123' });
      const disabled = service.setEnabled(false);

      expect(disabled.enabled).toBe(false);
      expect(disabled.reportCount).toBe(1);

      const lines = readFileSync(enabled.outputPath ?? '', 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string });

      expect(lines.map((line) => line.type)).toEqual([
        'profiling_session_started',
        'renderer_report',
        'main_timing',
        'profiling_session_stopped'
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function report(): ProfilingReport {
  return {
    enabled: true,
    empty: false,
    reason: 'manual',
    generatedAt: '2026-04-30T00:00:00.000Z',
    renders: [
      {
        surface: 'app.shell',
        renders: 2,
        lastRender: 2,
        detail: {}
      }
    ],
    timings: [],
    events: []
  };
}
