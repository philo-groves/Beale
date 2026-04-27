import type { BenchmarkHarnessIdentity } from '@shared/types';
import type { BenchmarkTaskSpec } from './benchmarkSuite';

export interface BenchmarkAgentInput {
  taskId: string;
  title: string;
  mode: string;
  targetAssets: string[];
  programScopePolicy: {
    networkProfile: string;
    allowedEndpoints: string[];
  };
  expectedToolCompetencies: string[];
  verifierContract: BenchmarkTaskSpec['verifierContract'];
  maxAttempts: number;
  maxWallTimeSeconds: number;
  maxCostUsd: number;
  requiredArtifacts: string[];
  fixture?: BenchmarkTaskSpec['fixture'];
}

export interface BenchmarkContainerMount {
  source: string;
  target: string;
  readonly: boolean;
  role: 'task_input' | 'agent_output' | 'agent_harness' | 'cache';
}

export interface BenchmarkContainerSpec {
  image: string;
  command: string[];
  networkMode: 'model_proxy_only' | 'declared_endpoints';
  mounts: BenchmarkContainerMount[];
  env: Record<string, string>;
  dockerSocketMounted: boolean;
  hostWorkspaceMounted: boolean;
  openAiCredentialsMounted: boolean;
  graderMounted: boolean;
  groundTruthMounted: boolean;
}

export interface BenchmarkModelProxyPolicy {
  hostOnly: true;
  endpoint: string;
  allowedModel: string;
  allowedReasoningEffort: string;
  maxInputBytes: number;
  maxOutputTokens: number;
  secretLogging: false;
}

export interface BenchmarkAgentPackage {
  agentInput: BenchmarkAgentInput;
  container: BenchmarkContainerSpec;
  modelProxy: BenchmarkModelProxyPolicy;
  graderLocation: 'host_only';
  outputChannel: {
    type: 'directory';
    path: string;
    oneWayToHostGrader: true;
  };
}

export interface BenchmarkIsolationReport {
  passed: boolean;
  violations: string[];
  hiddenFromAgent: string[];
}

export interface BenchmarkModelProxyRequest {
  model: string;
  reasoningEffort: string;
  instructions?: string;
  input: unknown;
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkModelProxyDecision {
  allowed: boolean;
  reason: string;
  metadata: Record<string, unknown>;
}

const forbiddenSerializedKeys = [
  'groundTruth',
  'ground_truth',
  'expectedResult',
  'scoringRubric',
  'knownFailureModes',
  'OPENAI_API_KEY',
  'OPENAI_ACCESS_TOKEN'
];

export function buildBenchmarkAgentPackage(task: BenchmarkTaskSpec, identity: BenchmarkHarnessIdentity): BenchmarkAgentPackage {
  const agentInput: BenchmarkAgentInput = {
    taskId: task.taskId,
    title: task.title,
    mode: task.mode,
    targetAssets: task.targetAssets,
    programScopePolicy: task.programScopePolicy,
    expectedToolCompetencies: task.expectedToolCompetencies,
    verifierContract: task.verifierContract,
    maxAttempts: task.maxAttempts,
    maxWallTimeSeconds: task.maxWallTimeSeconds,
    maxCostUsd: task.maxCostUsd,
    requiredArtifacts: task.requiredArtifacts,
    fixture: task.fixture
  };
  const networkMode = task.programScopePolicy.allowedEndpoints.length > 0 ? 'declared_endpoints' : 'model_proxy_only';
  return {
    agentInput,
    container: {
      image: `beale/benchmark-agent:${identity.harnessVersion}`,
      command: ['node', '/opt/beale-benchmark-agent/run.mjs'],
      networkMode,
      mounts: [
        { source: `/benchmark/packages/${task.taskId}`, target: '/bench/input', readonly: true, role: 'task_input' },
        { source: `/benchmark/outputs/${identity.taskSubsetId}/${task.taskId}`, target: '/bench/output', readonly: false, role: 'agent_output' },
        { source: 'beale-agent-harness://benchmark-agent.mjs', target: '/opt/beale-benchmark-agent/run.mjs', readonly: true, role: 'agent_harness' }
      ],
      env: {
        BEALE_BENCHMARK_MODE: '1',
        BEALE_TASK_INPUT: '/bench/input/task.json',
        BEALE_OUTPUT_DIR: '/bench/output',
        BEALE_MODEL_PROXY_URL: 'http://host.docker.internal:39871/v1/responses',
        BEALE_MODEL: identity.model,
        BEALE_REASONING_EFFORT: identity.reasoningEffort
      },
      dockerSocketMounted: false,
      hostWorkspaceMounted: false,
      openAiCredentialsMounted: false,
      graderMounted: false,
      groundTruthMounted: false
    },
    modelProxy: {
      hostOnly: true,
      endpoint: 'http://127.0.0.1:39871/v1/responses',
      allowedModel: identity.model,
      allowedReasoningEffort: identity.reasoningEffort,
      maxInputBytes: 512_000,
      maxOutputTokens: 16_384,
      secretLogging: false
    },
    graderLocation: 'host_only',
    outputChannel: {
      type: 'directory',
      path: `/benchmark/outputs/${identity.taskSubsetId}/${task.taskId}`,
      oneWayToHostGrader: true
    }
  };
}

export function assertBenchmarkIsolation(agentPackage: BenchmarkAgentPackage): BenchmarkIsolationReport {
  const violations: string[] = [];
  const serializedInput = JSON.stringify(agentPackage.agentInput);
  for (const key of forbiddenSerializedKeys) {
    if (serializedInput.includes(key)) {
      violations.push(`agent input includes forbidden benchmark-only field: ${key}`);
    }
  }
  if (agentPackage.container.dockerSocketMounted) violations.push('Docker socket is mounted into agent container');
  if (agentPackage.container.hostWorkspaceMounted) violations.push('Host workspace is mounted into agent container');
  if (agentPackage.container.openAiCredentialsMounted) violations.push('OpenAI credentials are mounted into agent container');
  if (agentPackage.container.graderMounted) violations.push('Grader files are mounted into agent container');
  if (agentPackage.container.groundTruthMounted) violations.push('Ground truth files are mounted into agent container');
  for (const mount of agentPackage.container.mounts) {
    if (!['task_input', 'agent_output', 'agent_harness', 'cache'].includes(mount.role)) {
      violations.push(`unsupported mount role: ${mount.role}`);
    }
    if (isForbiddenMountSource(mount.source)) {
      violations.push(`forbidden mount source: ${mount.source}`);
    }
  }
  for (const [key, value] of Object.entries(agentPackage.container.env)) {
    if (key.includes('OPENAI') && key !== 'BEALE_MODEL_PROXY_URL') {
      violations.push(`forbidden OpenAI credential env: ${key}`);
    }
    if (value.includes('.beale') || value.includes('ground-truth') || value.includes('grader')) {
      violations.push(`forbidden env value for ${key}`);
    }
  }
  if (!agentPackage.modelProxy.hostOnly || agentPackage.modelProxy.secretLogging) {
    violations.push('model proxy is not host-only with secret logging disabled');
  }
  if (agentPackage.graderLocation !== 'host_only') {
    violations.push('grader is not host-side only');
  }
  if (!agentPackage.outputChannel.oneWayToHostGrader) {
    violations.push('grader output flow is not one-way');
  }
  return {
    passed: violations.length === 0,
    violations,
    hiddenFromAgent: ['grader_files', 'ground_truth', 'openai_credentials', '.beale/beale.sqlite', 'docker_socket']
  };
}

export function validateModelProxyRequest(request: BenchmarkModelProxyRequest, policy: BenchmarkModelProxyPolicy): BenchmarkModelProxyDecision {
  if (request.model !== policy.allowedModel) {
    return denied(`model mismatch: ${request.model}`, request);
  }
  if (request.reasoningEffort !== policy.allowedReasoningEffort) {
    return denied(`reasoning effort mismatch: ${request.reasoningEffort}`, request);
  }
  const serializedInput = JSON.stringify(request.input);
  if (Buffer.byteLength(serializedInput, 'utf8') > policy.maxInputBytes) {
    return denied('request exceeds benchmark proxy input budget', request);
  }
  for (const key of forbiddenSerializedKeys) {
    if (serializedInput.includes(key)) {
      return denied(`request includes forbidden field or value: ${key}`, request);
    }
  }
  return {
    allowed: true,
    reason: 'allowed by host-side benchmark model proxy policy',
    metadata: {
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      inputBytes: Buffer.byteLength(serializedInput, 'utf8'),
      stream: request.stream === true,
      secretValuesLogged: false
    }
  };
}

function denied(reason: string, request: BenchmarkModelProxyRequest): BenchmarkModelProxyDecision {
  return {
    allowed: false,
    reason,
    metadata: {
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      secretValuesLogged: false
    }
  };
}

function isForbiddenMountSource(source: string): boolean {
  return (
    source.includes('.beale') ||
    source.includes('/ground-truth') ||
    source.endsWith('/ground-truth') ||
    source.includes('/grader/') ||
    source.endsWith('/grader') ||
    source.includes('/var/run/docker.sock')
  );
}
