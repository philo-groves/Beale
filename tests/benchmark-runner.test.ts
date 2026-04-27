import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertBenchmarkIsolation, buildBenchmarkAgentPackage, validateModelProxyRequest } from '../src/main/benchmarkIsolation';
import { startBenchmarkModelProxy } from '../src/main/benchmarkProxy';
import { getBenchmarkSuite, listBenchmarkSuites } from '../src/main/benchmarkSuite';
import { WorkspaceService } from '../src/main/workspaceService';
import type { BenchmarkHarnessIdentity } from '@shared/types';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('benchmark and calibration runner', () => {
  it('defines stable calibration suites for smoke, tools, safety, and CyberGym compatibility', () => {
    const suites = listBenchmarkSuites();
    expect(suites.map((suite) => suite.suiteKind)).toEqual(['smoke', 'tool_competency', 'safety_policy', 'cybergym_compat']);
    expect(suites.find((suite) => suite.suiteKind === 'smoke')?.taskCount).toBe(5);
    expect(suites.find((suite) => suite.suiteKind === 'tool_competency')?.taskCount).toBe(10);
    expect(suites.find((suite) => suite.suiteKind === 'safety_policy')?.taskCount).toBe(10);
    expect(suites.find((suite) => suite.suiteKind === 'cybergym_compat')?.suiteId).toBe('cybergym-l1-beale-smoke-10');
  });

  it('packages benchmark agent input without grader files, ground truth, or host credentials', () => {
    const suite = getBenchmarkSuite('cybergym_compat');
    const task = suite.tasks[0];
    const identity = harnessIdentity(suite.suiteId, suite.tasks.map((item) => item.taskId));
    const agentPackage = buildBenchmarkAgentPackage(task, identity);
    const isolation = assertBenchmarkIsolation(agentPackage);

    expect(isolation.passed).toBe(true);
    expect(agentPackage.container.dockerSocketMounted).toBe(false);
    expect(agentPackage.container.graderMounted).toBe(false);
    expect(agentPackage.container.groundTruthMounted).toBe(false);
    expect(JSON.stringify(agentPackage.agentInput)).not.toContain('groundTruth');
    expect(JSON.stringify(agentPackage.agentInput)).not.toContain('expectedResult');
    expect(JSON.stringify(agentPackage.container.env)).not.toContain('OPENAI_API_KEY');

    const allowed = validateModelProxyRequest(
      { model: identity.model, reasoningEffort: identity.reasoningEffort, input: agentPackage.agentInput },
      agentPackage.modelProxy
    );
    expect(allowed.allowed).toBe(true);

    const denied = validateModelProxyRequest(
      { model: 'different-model', reasoningEffort: identity.reasoningEffort, input: agentPackage.agentInput },
      agentPackage.modelProxy
    );
    expect(denied.allowed).toBe(false);
  });

  it('runs a real host-side benchmark model proxy guard', async () => {
    const proxy = await startBenchmarkModelProxy({
      hostOnly: true,
      allowedModel: 'gpt-5.5',
      allowedReasoningEffort: 'xhigh',
      maxInputBytes: 10_000,
      maxOutputTokens: 1024,
      secretLogging: false
    });
    try {
      const allowed = await fetch(proxy.hostEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.5', reasoningEffort: 'xhigh', input: { taskId: 'proxy-smoke' } })
      });
      expect(allowed.status).toBe(200);
      const denied = await fetch(proxy.hostEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'different', reasoningEffort: 'xhigh', input: { taskId: 'proxy-smoke' } })
      });
      expect(denied.status).toBe(403);
      expect(proxy.decisions.map((decision) => decision.allowed)).toEqual([true, false]);
    } finally {
      await proxy.close();
    }
  });

  it('records Docker benchmark results and compares same-model different-harness runs on a stable sample', async () => {
    const dockerCommand = fakeDockerCommand();
    const service = new WorkspaceService(undefined, { benchmarkDockerCommand: dockerCommand });
    const snapshot = service.createWorkspace(tempWorkspace());
    expect(snapshot.runs).toHaveLength(0);

    const baseline = await service.runBenchmarkSuite({
      suiteKind: 'smoke',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      harnessName: 'baseline-harness',
      dockerImage: 'fake-node-image'
    });
    expect(baseline.runs).toHaveLength(0);
    expect(baseline.benchmark.latestRun?.identity.passCount).toBe(5);

    const candidate = await service.runBenchmarkSuite({
      suiteKind: 'smoke',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      harnessName: 'candidate-harness',
      dockerImage: 'fake-node-image',
      failureTaskIds: ['smoke-artifact-capture']
    });

    const latest = candidate.benchmark.latestRun;
    const comparison = candidate.benchmark.comparisons[0];
    expect(latest?.suiteId).toBe('beale-smoke-5');
    expect(latest?.identity.taskIds).toEqual(getBenchmarkSuite('smoke').tasks.map((task) => task.taskId));
    expect(latest?.identity.passCount).toBe(4);
    expect(candidate.benchmark.latestResults.find((result) => result.taskId === 'smoke-artifact-capture')?.status).toBe('inconclusive');
    expect(String(candidate.benchmark.latestResults[0]?.graderReport.dockerCommand)).toBe(dockerCommand);
    expect(candidate.benchmark.latestResults[0]?.graderReport.graderLocation).toBe('host_only');
    expect(JSON.stringify(candidate.benchmark.latestResults[0]?.graderReport)).not.toContain('groundTruthRef');
    expect(comparison.compatible).toBe(true);
    expect(comparison.baselineHarness).toBe('baseline-harness');
    expect(comparison.candidateHarness).toBe('candidate-harness');
    expect(comparison.passRateDelta).toBeCloseTo(-0.2);
    expect(candidate.benchmark.isolationSummary.normalVmArchitectureChanged).toBe(false);
    service.close();
  });

  it('runs the safety suite without exposing grader or ground truth materials to the agent package', async () => {
    const dockerCommand = fakeDockerCommand();
    const service = new WorkspaceService(undefined, { benchmarkDockerCommand: dockerCommand });
    service.createWorkspace(tempWorkspace());
    const snapshot = await service.runBenchmarkSuite({ suiteKind: 'safety_policy', harnessName: 'safety-harness', dockerImage: 'fake-node-image' });

    expect(snapshot.benchmark.latestRun?.identity.passCount).toBe(10);
    expect(snapshot.benchmark.latestResults.every((result) => result.isolationPassed)).toBe(true);
    expect(JSON.stringify(snapshot.benchmark.latestResults.map((result) => result.agentOutput))).not.toContain('groundTruthRef');
    service.close();
  });
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-benchmark-test-'));
  createdDirs.push(dir);
  return dir;
}

function fakeDockerCommand(): string {
  const dir = tempWorkspace();
  const path = join(dir, 'fake-docker.mjs');
  writeFileSync(
    path,
    `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] !== 'run') {
  console.error('expected docker run');
  process.exit(2);
}
const env = {};
let inputDir = '';
let outputDir = '';
for (let index = 1; index < args.length; index += 1) {
  if (args[index] === '--mount') {
    const mount = args[index + 1] ?? '';
    const parts = Object.fromEntries(mount.split(',').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key, rest.join('=') || 'true'];
    }));
    if (parts.target === '/bench/input') inputDir = parts.source;
    if (parts.target === '/bench/output') outputDir = parts.source;
    index += 1;
  } else if (args[index] === '-e') {
    const [key, ...rest] = String(args[index + 1] ?? '').split('=');
    env[key] = rest.join('=');
    index += 1;
  }
}
const task = JSON.parse(readFileSync(join(inputDir, 'task.json'), 'utf8'));
const requiredArtifacts = Array.isArray(task.requiredArtifacts) ? task.requiredArtifacts : [];
const forceFail = env.BEALE_BENCHMARK_FORCE_FAIL === '1';
const producedArtifacts = forceFail ? requiredArtifacts.slice(0, Math.max(0, requiredArtifacts.length - 1)) : requiredArtifacts;
mkdirSync(join(outputDir, 'artifacts'), { recursive: true });
for (const artifact of producedArtifacts) {
  writeFileSync(join(outputDir, 'artifacts', String(artifact).replace(/[^a-z0-9._-]+/gi, '-') + '.txt'), 'artifact');
}
writeFileSync(join(outputDir, 'result.json'), JSON.stringify({
  taskId: task.taskId,
  producedArtifacts,
  verifierStatus: forceFail ? 'inconclusive' : task.verifierContract.requiredResult,
  toolCompetenciesUsed: task.expectedToolCompetencies,
  policyViolationsBlocked: task.mode === 'safety' || String(task.taskId).startsWith('safety-') ? 1 : 0,
  claimsWithoutEvidence: forceFail ? 1 : 0,
  summary: forceFail ? 'fake docker omitted evidence' : 'fake docker produced evidence'
}, null, 2));
console.log('fake docker completed ' + task.taskId);
`
  );
  chmodSync(path, 0o755);
  return path;
}

function harnessIdentity(taskSubsetId: string, taskIds: string[]): BenchmarkHarnessIdentity {
  return {
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    harnessName: 'test-harness',
    harnessVersion: '0.1.0-test',
    promptVersion: 'test-prompt',
    toolsetVersion: 'test-tools',
    verifierVersion: 'test-verifier',
    sandboxBackend: 'dockerized_benchmark_agent',
    sandboxImageVersion: 'test-image',
    networkProfile: 'offline',
    attemptStrategy: 'fixed_k',
    attemptCount: 1,
    taskSubsetId,
    taskIds,
    benchmarkVersion: 'test-benchmark',
    date: '2026-04-27T00:00:00.000Z',
    cost: { estimatedUsd: 0 },
    tokens: { total: 0 },
    wallTimeMs: 0,
    passCount: 0,
    totalCount: taskIds.length,
    passRate: 0,
    smallSampleWarning: 'Small sample'
  };
}
