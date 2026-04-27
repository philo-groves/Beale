import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BenchmarkHarnessIdentity, BenchmarkResultStatus } from '@shared/types';
import { assertBenchmarkIsolation, buildBenchmarkAgentPackage } from './benchmarkIsolation';
import type { BenchmarkIsolationReport } from './benchmarkIsolation';
import type { BenchmarkTaskSpec } from './benchmarkSuite';

export interface BenchmarkAgentOutput {
  taskId: string;
  producedArtifacts: string[];
  verifierStatus: BenchmarkResultStatus;
  toolCompetenciesUsed: string[];
  policyViolationsBlocked: number;
  claimsWithoutEvidence: number;
  summary: string;
  modelProxy: Record<string, unknown>;
  fixtureProbe: Record<string, unknown>;
}

export interface BenchmarkDockerTaskInput {
  benchmarkRunId: string;
  task: BenchmarkTaskSpec;
  identity: BenchmarkHarnessIdentity;
  workspacePath: string;
  dockerCommand: string;
  dockerImage: string;
  modelProxyUrl: string;
  forceFailure: boolean;
}

export interface BenchmarkDockerTaskResult {
  agentOutput: BenchmarkAgentOutput;
  isolation: BenchmarkIsolationReport;
  docker: {
    command: string;
    args: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
    inputDir: string;
    outputDir: string;
    graderDir: string;
  };
}

export async function runBenchmarkDockerTask(input: BenchmarkDockerTaskInput): Promise<BenchmarkDockerTaskResult> {
  const agentPackage = buildBenchmarkAgentPackage(input.task, {
    ...input.identity,
    sandboxImageVersion: input.dockerImage
  });
  const isolation = assertBenchmarkIsolation(agentPackage);
  if (!isolation.passed) {
    throw new Error(`Benchmark isolation check failed: ${isolation.violations.join('; ')}`);
  }

  const taskRoot = join(input.workspacePath, '.beale', 'benchmarks', input.benchmarkRunId, input.task.taskId);
  const inputDir = join(taskRoot, 'input');
  const outputDir = join(taskRoot, 'output');
  const graderDir = join(taskRoot, 'host-grader');
  mkdirSync(inputDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(graderDir, { recursive: true });
  writeFileSync(join(inputDir, 'task.json'), JSON.stringify(agentPackage.agentInput, null, 2));
  writeFileSync(
    join(graderDir, 'ground-truth.json'),
    JSON.stringify(
      {
        taskId: input.task.taskId,
        expectedResult: input.task.grader.expectedResult,
        requiredEvidence: input.task.grader.requiredEvidence,
        knownFailureModes: input.task.grader.knownFailureModes
      },
      null,
      2
    )
  );

  const agentScriptPath = resolve('scripts/benchmark-agent.mjs');
  const env = {
    ...agentPackage.container.env,
    BEALE_MODEL_PROXY_URL: input.modelProxyUrl,
    BEALE_BENCHMARK_FORCE_FAIL: input.forceFailure ? '1' : '0'
  };
  const args = [
    'run',
    '--rm',
    '--network',
    'bridge',
    ...dockerUserArgs(),
    '--add-host',
    'host.docker.internal:host-gateway',
    '--mount',
    bindMount(inputDir, '/bench/input', true),
    '--mount',
    bindMount(outputDir, '/bench/output', false),
    '--mount',
    bindMount(agentScriptPath, '/opt/beale-benchmark-agent/run.mjs', true),
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    input.dockerImage,
    ...agentPackage.container.command
  ];
  const docker = await runProcess(input.dockerCommand, args);
  if (docker.exitCode !== 0) {
    throw new Error(`Benchmark Docker agent failed for ${input.task.taskId}: ${docker.stderr || docker.stdout || `exit ${docker.exitCode}`}`);
  }
  const resultPath = join(outputDir, 'result.json');
  const agentOutput = parseAgentOutput(JSON.parse(readFileSync(resultPath, 'utf8')));
  return {
    agentOutput,
    isolation,
    docker: {
      ...docker,
      inputDir,
      outputDir,
      graderDir
    }
  };
}

function parseAgentOutput(value: unknown): BenchmarkAgentOutput {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    taskId: stringValue(record.taskId),
    producedArtifacts: stringArray(record.producedArtifacts),
    verifierStatus: benchmarkStatus(record.verifierStatus),
    toolCompetenciesUsed: stringArray(record.toolCompetenciesUsed),
    policyViolationsBlocked: numberValue(record.policyViolationsBlocked),
    claimsWithoutEvidence: numberValue(record.claimsWithoutEvidence),
    summary: stringValue(record.summary),
    modelProxy: recordValue(record.modelProxy),
    fixtureProbe: recordValue(record.fixtureProbe)
  };
}

function bindMount(source: string, target: string, readonly: boolean): string {
  return `type=bind,source=${source},target=${target}${readonly ? ',readonly' : ''}`;
}

function runProcess(command: string, args: string[]): Promise<{ command: string; args: string[]; exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (exitCode) =>
      resolve({
        command,
        args,
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      })
    );
  });
}

function dockerUserArgs(): string[] {
  if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') {
    return [];
  }
  return ['--user', `${process.getuid()}:${process.getgid()}`];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function benchmarkStatus(value: unknown): BenchmarkResultStatus {
  return value === 'pass' || value === 'fail' || value === 'inconclusive' ? value : 'inconclusive';
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
