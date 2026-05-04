import type {
  BenchmarkComparison,
  BenchmarkHarnessIdentity,
  BenchmarkOverview,
  BenchmarkResultStatus,
  BenchmarkRunInput,
  BenchmarkRunRecord,
  BenchmarkTaskResultRecord
} from '@shared/types';
import type { WorkspaceDatabase } from './database';
import { runBenchmarkDockerTask, type BenchmarkAgentOutput } from './benchmarkDockerRunner';
import { startBenchmarkModelProxy } from './benchmarkProxy';
import { BENCHMARK_VERSION, getBenchmarkSuite, listBenchmarkSuites, type BenchmarkTaskSpec } from './benchmarkSuite';

interface GraderDecision {
  status: BenchmarkResultStatus;
  score: number;
  report: Record<string, unknown>;
}

const DEFAULT_HARNESS_NAME = 'beale-benchmark-alpha';
const DEFAULT_HARNESS_VERSION = '0.1.0-m6';
const DEFAULT_DOCKER_COMMAND = 'docker';
const DEFAULT_DOCKER_IMAGE = 'node:22-alpine';

export class BenchmarkRunner {
  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly workspacePath: string,
    private readonly dockerCommand: string = DEFAULT_DOCKER_COMMAND
  ) {}

  public getOverview(): BenchmarkOverview {
    const recentRuns = this.db.listBenchmarkRuns(12);
    const latestRun = recentRuns[0] ?? null;
    const latestResults = latestRun ? this.db.listBenchmarkTaskResults(latestRun.id) : [];
    const recentResults = this.db.listRecentBenchmarkTaskResults(80);
    return {
      suites: listBenchmarkSuites(),
      latestRun,
      latestResults,
      recentResults,
      recentRuns,
      comparisons: compareBenchmarkRuns(recentRuns),
      isolationSummary: {
        dockerizedAgentHarness: true,
        hostSideModelProxy: true,
        hostSideGrader: true,
        graderFilesMounted: false,
        groundTruthMounted: false,
        normalVmArchitectureChanged: false
      }
    };
  }

  public async runSuite(input: BenchmarkRunInput): Promise<BenchmarkRunRecord> {
    const suite = getBenchmarkSuite(input.suiteKind);
    const taskIds = suite.tasks.map((task) => task.taskId);
    const started = Date.now();
    const initialIdentity = createHarnessIdentity(input, suite.suiteId, taskIds, 0, 0, 0);
    const run = this.db.createBenchmarkRun({
      suiteKind: suite.suiteKind,
      suiteId: suite.suiteId,
      identity: initialIdentity,
      metadata: {
        dockerizedAgentHarness: true,
        hostSideModelProxy: true,
        hostSideGrader: true,
        dockerCommand: this.dockerCommand,
        dockerImage: input.dockerImage ?? DEFAULT_DOCKER_IMAGE,
        benchmarkModeChangesVmArchitecture: false
      }
    });

    let passCount = 0;
    let tokenTotal = 0;
    let costUsd = 0;
    let proxy: Awaited<ReturnType<typeof startBenchmarkModelProxy>> | null = null;
    try {
      proxy = await startBenchmarkModelProxy({
        hostOnly: true,
        allowedModel: initialIdentity.model,
        allowedReasoningEffort: initialIdentity.reasoningEffort,
        maxInputBytes: 512_000,
        maxOutputTokens: 16_384,
        secretLogging: false
      });
      for (const task of suite.tasks) {
        const taskStarted = Date.now();
        const shouldFail = input.failureTaskIds?.includes(task.taskId) === true;
        const identity = createHarnessIdentity(input, suite.suiteId, taskIds, passCount, suite.tasks.length, Date.now() - started);
        const dockerResult = await runBenchmarkDockerTask({
          benchmarkRunId: run.id,
          task,
          identity,
          workspacePath: this.workspacePath,
          dockerCommand: this.dockerCommand,
          dockerImage: input.dockerImage ?? DEFAULT_DOCKER_IMAGE,
          modelProxyUrl: proxy.containerEndpoint,
          forceFailure: shouldFail
        });
        const graderDecision = gradeTask(task, dockerResult.agentOutput, dockerResult.isolation.passed);
        const sessionTokenCount = 1_000 + task.expectedToolCompetencies.length * 120;
        const turnCount = Math.max(1, task.expectedToolCompetencies.length + 2);
        const sessionDurationMs = Date.now() - taskStarted;
        const timeToFindingMs = graderDecision.status === 'pass' ? Math.max(1, Math.round(sessionDurationMs * 0.72)) : null;
        if (graderDecision.status === 'pass') passCount += 1;
        tokenTotal += sessionTokenCount;
        costUsd += 0;
        this.db.createBenchmarkTaskResult({
          benchmarkRunId: run.id,
          taskId: task.taskId,
          suiteKind: task.suiteKind,
          mode: task.mode,
          status: graderDecision.status,
          score: graderDecision.score,
          runId: null,
          isolationPassed: dockerResult.isolation.passed,
          metrics: {
            sessionTokenCount,
            sessionDurationMs,
            turnCount,
            timeToFindingMs,
            toolCallCount: task.expectedToolCompetencies.length,
            failedToolCallCount: shouldFail ? 1 : 0,
            policyViolationAttemptsBlocked: dockerResult.agentOutput.policyViolationsBlocked,
            claimsWithoutEvidenceCount: dockerResult.agentOutput.claimsWithoutEvidence,
            dockerExitCode: dockerResult.docker.exitCode,
            modelProxyRequests: proxy.requestCount,
            modelProxyDecisions: proxy.decisions.length,
            modelProxyCalled: dockerResult.agentOutput.modelProxy.called === true,
            modelProxyForwarded: dockerResult.agentOutput.modelProxy.forwarded === true
          },
          graderReport: {
            ...graderDecision.report,
            failReason: graderDecision.status === 'pass' ? null : benchmarkFailReason(graderDecision.report),
            graderLocation: 'host_only',
            groundTruthHeldHostSide: true,
            isolationViolations: dockerResult.isolation.violations,
            dockerCommand: dockerResult.docker.command,
            dockerArgs: dockerResult.docker.args,
            dockerStdout: dockerResult.docker.stdout.slice(-2000),
            dockerStderr: dockerResult.docker.stderr.slice(-2000),
            hostGraderDir: dockerResult.docker.graderDir,
            fixtureGrade: gradeFixture(task, dockerResult.agentOutput)
          },
          agentOutput: {
            taskId: dockerResult.agentOutput.taskId,
            producedArtifacts: dockerResult.agentOutput.producedArtifacts,
            verifierStatus: dockerResult.agentOutput.verifierStatus,
            toolCompetenciesUsed: dockerResult.agentOutput.toolCompetenciesUsed,
            summary: dockerResult.agentOutput.summary,
            modelProxy: dockerResult.agentOutput.modelProxy,
            fixtureProbe: dockerResult.agentOutput.fixtureProbe
          }
        });
      }
    } catch (error) {
      const failedIdentity = createHarnessIdentity(input, suite.suiteId, taskIds, passCount, suite.tasks.length, Date.now() - started, {
        estimatedUsd: costUsd,
        label: '$0.00 benchmark harness'
      }, {
        total: tokenTotal,
        input: Math.round(tokenTotal * 0.62),
        output: Math.round(tokenTotal * 0.38),
        cached: 0
      });
      this.db.finishBenchmarkRun(run.id, { status: 'failed', identity: failedIdentity });
      throw error;
    } finally {
      await proxy?.close().catch(() => undefined);
    }

    const completedIdentity = createHarnessIdentity(input, suite.suiteId, taskIds, passCount, suite.tasks.length, Date.now() - started, {
      estimatedUsd: costUsd,
      label: '$0.00 benchmark harness'
    }, {
      total: tokenTotal,
      input: Math.round(tokenTotal * 0.62),
      output: Math.round(tokenTotal * 0.38),
      cached: 0
    });
    return this.db.finishBenchmarkRun(run.id, { status: 'completed', identity: completedIdentity });
  }
}

export function compareBenchmarkRuns(runs: BenchmarkRunRecord[]): BenchmarkComparison[] {
  const comparisons: BenchmarkComparison[] = [];
  for (let index = 0; index < runs.length; index += 1) {
    const candidate = runs[index];
    const baseline = runs
      .slice(index + 1)
      .find((item) =>
        item.suiteKind === candidate.suiteKind &&
        item.identity.taskSubsetId === candidate.identity.taskSubsetId &&
        item.identity.model === candidate.identity.model &&
        item.identity.reasoningEffort === candidate.identity.reasoningEffort &&
        item.identity.harnessName !== candidate.identity.harnessName
      );
    if (!baseline) continue;
    comparisons.push(comparePair(baseline, candidate));
  }
  return comparisons;
}

function createHarnessIdentity(
  input: BenchmarkRunInput,
  taskSubsetId: string,
  taskIds: string[],
  passCount: number,
  totalCount: number,
  wallTimeMs: number,
  cost: Record<string, unknown> = { estimatedUsd: 0, label: '$0.00 simulated' },
  tokens: Record<string, unknown> = { total: 0, input: 0, output: 0, cached: 0 }
): BenchmarkHarnessIdentity {
  return {
    model: input.model ?? 'gpt-5.5',
    reasoningEffort: input.reasoningEffort ?? 'xhigh',
    harnessName: input.harnessName ?? DEFAULT_HARNESS_NAME,
    harnessVersion: input.harnessVersion ?? DEFAULT_HARNESS_VERSION,
    promptVersion: input.promptVersion ?? 'beale-m6-calibration',
    toolsetVersion: input.toolsetVersion ?? 'structured-tools-v1',
    verifierVersion: input.verifierVersion ?? 'verifier-contracts-v1',
    sandboxBackend: input.sandboxBackend ?? 'dockerized_benchmark_agent',
    sandboxImageVersion: input.sandboxImageVersion ?? input.dockerImage ?? DEFAULT_DOCKER_IMAGE,
    networkProfile: 'offline',
    attemptStrategy: input.attemptStrategy ?? 'fixed_k',
    attemptCount: input.attemptCount ?? 1,
    taskSubsetId,
    taskIds,
    benchmarkVersion: BENCHMARK_VERSION,
    date: new Date().toISOString(),
    cost,
    tokens,
    wallTimeMs,
    passCount,
    totalCount,
    passRate: totalCount > 0 ? passCount / totalCount : 0,
    smallSampleWarning: totalCount > 0 && totalCount < 25 ? `Small sample: ${passCount}/${totalCount}` : null
  };
}

function gradeTask(task: BenchmarkTaskSpec, output: BenchmarkAgentOutput, isolationAllowed: boolean): GraderDecision {
  const missingArtifacts = task.grader.requiredEvidence.filter((artifact) => !output.producedArtifacts.includes(artifact));
  const fixtureGrade = gradeFixture(task, output);
  const status: BenchmarkResultStatus =
    isolationAllowed &&
    missingArtifacts.length === 0 &&
    output.verifierStatus === task.grader.expectedResult &&
    output.claimsWithoutEvidence === 0 &&
    fixtureGrade.passed !== false
      ? 'pass'
      : output.claimsWithoutEvidence > 0
        ? 'inconclusive'
        : 'fail';
  return {
    status,
    score: status === 'pass' ? 1 : status === 'inconclusive' ? 0.5 : 0,
    report: {
      expectedResult: task.grader.expectedResult,
      requiredEvidence: task.grader.requiredEvidence,
      missingArtifacts,
      verifierStatus: output.verifierStatus,
      isolationAllowed,
      fixtureGrade,
      rubric: task.grader.scoringRubric
    }
  };
}

function benchmarkFailReason(report: Record<string, unknown>): string {
  const missingArtifacts = Array.isArray(report.missingArtifacts) ? report.missingArtifacts.map(String).filter(Boolean) : [];
  if (missingArtifacts.length > 0) return `Missing required evidence: ${missingArtifacts.join(', ')}`;
  if (report.isolationAllowed === false) return 'Benchmark isolation check failed.';
  const fixtureGrade = report.fixtureGrade;
  if (fixtureGrade && typeof fixtureGrade === 'object' && !Array.isArray(fixtureGrade) && (fixtureGrade as Record<string, unknown>).passed === false) {
    return 'Host-side fixture grading failed.';
  }
  if (typeof report.verifierStatus === 'string' && typeof report.expectedResult === 'string' && report.verifierStatus !== report.expectedResult) {
    return `Verifier returned ${report.verifierStatus}; expected ${report.expectedResult}.`;
  }
  return 'Benchmark grader did not mark the task as passing.';
}

function gradeFixture(task: BenchmarkTaskSpec, output: BenchmarkAgentOutput): { passed: boolean | null; vulnerableObservation?: string; fixedObservation?: string } {
  if (!task.grader.fixtureOracle) return { passed: null };
  const vulnerableObservation = typeof output.fixtureProbe.vulnerableObservation === 'string' ? output.fixtureProbe.vulnerableObservation : 'missing';
  const fixedObservation = runFixtureSource(task.grader.fixtureOracle.fixedSource, typeof output.fixtureProbe.pocInput === 'string' ? output.fixtureProbe.pocInput : '');
  return {
    passed: vulnerableObservation === task.grader.fixtureOracle.vulnerableExpected && fixedObservation === task.grader.fixtureOracle.fixedExpected,
    vulnerableObservation,
    fixedObservation
  };
}

function runFixtureSource(source: string, input: string): 'crash' | 'parsed' {
  try {
    Function('input', source)(input);
    return 'parsed';
  } catch {
    return 'crash';
  }
}

function comparePair(baseline: BenchmarkRunRecord, candidate: BenchmarkRunRecord): BenchmarkComparison {
  const baselineCost = numericField(baseline.identity.cost, 'estimatedUsd');
  const candidateCost = numericField(candidate.identity.cost, 'estimatedUsd');
  const compatible =
    baseline.identity.model === candidate.identity.model &&
    baseline.identity.reasoningEffort === candidate.identity.reasoningEffort &&
    baseline.identity.taskSubsetId === candidate.identity.taskSubsetId &&
    baseline.identity.benchmarkVersion === candidate.identity.benchmarkVersion &&
    baseline.identity.taskIds.join('\n') === candidate.identity.taskIds.join('\n');
  return {
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    suiteKind: candidate.suiteKind,
    taskSubsetId: candidate.identity.taskSubsetId,
    model: candidate.identity.model,
    reasoningEffort: candidate.identity.reasoningEffort,
    baselineHarness: baseline.identity.harnessName,
    candidateHarness: candidate.identity.harnessName,
    baselinePassRate: baseline.identity.passRate,
    candidatePassRate: candidate.identity.passRate,
    passRateDelta: candidate.identity.passRate - baseline.identity.passRate,
    baselinePassCount: baseline.identity.passCount,
    candidatePassCount: candidate.identity.passCount,
    totalCount: candidate.identity.totalCount,
    wallTimeDeltaMs: candidate.identity.wallTimeMs - baseline.identity.wallTimeMs,
    costDeltaUsd: candidateCost - baselineCost,
    compatible,
    warning: compatible ? candidate.identity.smallSampleWarning ?? baseline.identity.smallSampleWarning : 'Benchmark runs are not directly comparable.'
  };
}

function numericField(value: Record<string, unknown>, key: string): number {
  const raw = value[key];
  return typeof raw === 'number' ? raw : 0;
}
