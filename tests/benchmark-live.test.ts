import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/main/workspaceService';

const createdDirs: string[] = [];
const runLiveDocker = process.env.BEALE_BENCHMARK_LIVE_DOCKER === '1';

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!runLiveDocker)('live Docker benchmark runner', () => {
  it('runs the smoke calibration suite through a real Docker agent container', async () => {
    const service = new WorkspaceService();
    const snapshot = service.createWorkspace(tempWorkspace());
    expect(snapshot.benchmark.isolationSummary.normalVmArchitectureChanged).toBe(false);

    const result = await service.runBenchmarkSuite({
      suiteKind: 'smoke',
      harnessName: 'live-docker-smoke',
      dockerImage: process.env.BEALE_BENCHMARK_DOCKER_IMAGE ?? 'node:22-alpine'
    });

    expect(result.runs).toHaveLength(0);
    expect(result.benchmark.latestRun?.identity.passCount).toBe(5);
    expect(result.benchmark.latestRun?.identity.totalCount).toBe(5);
    expect(result.benchmark.latestResults).toHaveLength(5);
    expect(result.benchmark.latestResults.every((item) => item.isolationPassed)).toBe(true);
    expect(result.benchmark.latestResults.every((item) => item.graderReport.graderLocation === 'host_only')).toBe(true);
    expect(result.benchmark.latestResults.every((item) => item.graderReport.dockerCommand === 'docker')).toBe(true);
    expect(result.benchmark.isolationSummary.normalVmArchitectureChanged).toBe(false);
    service.close();
  });
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-live-benchmark-test-'));
  createdDirs.push(dir);
  return dir;
}
