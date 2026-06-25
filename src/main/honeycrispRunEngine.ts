import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import type { ProgramScopeVersion, ScopeAsset, StartRunInput, TraceEventType, TraceSource } from '@shared/types';
import { generateSessionTitle } from '../shared/sessionTitle';

export interface HoneycrispRunHandle {
  context: CreatedRunContext;
  completion: Promise<void>;
}

export interface HoneycrispInvocation {
  command: string;
  prefixArgs: string[];
  cwd: string;
  configuredBy: 'env_command' | 'env_root' | 'sibling_root';
}

interface HoneycrispWorkspaceContextFile {
  schemaVersion: 1;
  workspaceRoot: string;
  knownRepositories: HoneycrispWorkspaceRepositoryContext[];
  materializedSourcePaths: string[];
  projectNotes: string[];
}

interface HoneycrispWorkspaceRepositoryContext {
  rootPath: string;
  label?: string;
  role: 'known_repository' | 'materialized_source' | 'workspace';
  source: 'beale';
  repositoryUrl?: string;
}

interface ActiveHoneycrispRun {
  child: ChildProcessWithoutNullStreams;
  context: CreatedRunContext;
  stopped: boolean;
}

interface HoneycrispFlowCapture {
  capturedAt?: string;
  goal?: {
    id?: string;
    objective?: string;
    scopeConstraints?: unknown;
    evidenceRequirements?: unknown;
    riskFlags?: unknown;
  };
  decision?: {
    actionClass?: string;
    subGoalId?: string;
    subGoalObjective?: string;
    rationale?: string;
  };
  goalRun?: {
    status?: string;
    terminalReason?: string;
    statusReason?: string;
    loopsUsed?: number;
    maxLoops?: number | null;
    safetyMaxLoops?: number;
    blockedThreshold?: number;
    consecutiveBlockedCount?: number;
  };
  loop?: {
    status?: string;
    executorName?: string;
    executionMode?: string;
    outputText?: string;
    followUpRecommendation?: string;
    followUpRationale?: string;
    researchTrace?: {
      observations?: HoneycrispTraceItem[];
      inferences?: HoneycrispTraceItem[];
      hypotheses?: HoneycrispTraceItem[];
      assumptions?: HoneycrispTraceItem[];
      rejectedPaths?: HoneycrispTraceItem[];
      uncertainty?: HoneycrispTraceItem[];
      nextQuestions?: HoneycrispTraceItem[];
      goalAssessment?: {
        status?: string;
        rationale?: string;
      };
    };
    raw?: unknown;
  };
  contextV2?: {
    sections?: Array<{
      estimatedTokens?: number | string;
      tokenBudget?: number | string;
    }>;
  };
  memoryIntegration?: {
    databasePath?: string;
    eventLogCount?: number;
    recordCount?: number;
    eventsAppended?: number;
    recordsWritten?: number;
    usedMemoryDrivenController?: boolean;
  };
  storageManifest?: {
    path?: string;
    artifactCount?: number;
    artifacts?: unknown[];
  };
  usage?: unknown;
  modelUsage?: unknown;
  tokenUsage?: unknown;
  eventTimeline?: HoneycrispCaptureEvent[];
  runtimeConfig?: Record<string, unknown>;
}

interface HoneycrispTraceItem {
  text?: string;
  confidence?: number;
  evidenceRefIds?: readonly string[];
}

interface HoneycrispCaptureEvent {
  id?: string;
  sequence?: number;
  kind?: string;
  timestamp?: string;
  summary?: string;
  payload?: unknown;
  artifactRefs?: unknown;
}

interface HoneycrispContextUsageSummary {
  inputTokens: number;
  outputTokens: number | null;
  totalTokens: number | null;
  source: string;
  estimated: boolean;
  reportedCallCount: number;
  estimatedSerializedTokens: number | null;
  contextV2EstimatedTokens: number | null;
}

interface NormalizedTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

const UNBOUNDED_RUN_ATTEMPTS = 999_999;
const DEFAULT_HONEYCRISP_TOOL_MAX_BYTES = 200_000;
const MAX_LIVE_OUTPUT_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 220;
const HONEYCRISP_REPORTED_USAGE_SOURCE = 'Honeycrisp reported model usage';
const HONEYCRISP_ESTIMATED_USAGE_SOURCE = 'Honeycrisp serialized capture estimate';
const HONEYCRISP_MIXED_USAGE_SOURCE = 'Honeycrisp reported total plus capture estimate';

export class HoneycrispRunEngine {
  private readonly activeRuns = new Map<string, ActiveHoneycrispRun>();
  private readonly completions = new Map<string, Promise<void>>();

  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly workspacePath: string,
    private readonly onChange: () => void = () => undefined
  ) {}

  public startRun(input: StartRunInput): HoneycrispRunHandle {
    const scope = this.db.getActiveScope();
    const context = this.db.createRun({
      scopeVersionId: scope.id,
      title: generateSessionTitle(input.promptMarkdown),
      promptMarkdown: input.promptMarkdown,
      mode: input.mode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attemptStrategy: input.attemptStrategy,
      networkProfile: input.networkProfile,
      sandboxProfile: input.sandboxProfile,
      targetAssetId: input.targetAssetId,
      targetPath: input.targetPath,
      budget: { ...input.budget, runEngine: 'honeycrisp' },
      vmBackend: 'host',
      vmImageId: 'host-machine',
      vmSnapshotId: 'none',
      vmState: 'host_active',
      vmMetadata: {
        executor: 'honeycrisp',
        targetExecution: false,
        hostProcess: true,
        honeycrispWorkspaceRoot: this.workspacePath
      }
    });
    this.db.createModelSession({
      runId: context.run.id,
      provider: 'honeycrisp',
      transport: 'host_process',
      status: 'active',
      metadata: {
        model: input.model,
        reasoningEffort: input.reasoningEffort
      }
    });
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'user_note',
      source: 'user',
      summary: 'Honeycrisp research run started from markdown prompt.',
      payload: {
        runEngine: 'honeycrisp',
        mode: input.mode,
        attemptStrategy: input.attemptStrategy,
        sandboxProfile: input.sandboxProfile
      },
      vmContextId: context.vmContext.id
    });

    const invocation = resolveHoneycrispInvocation();
    const runDirectory = join(this.workspacePath, '.beale', 'honeycrisp-runs');
    const capturePath = join(runDirectory, `${context.run.id}.capture.json`);
    const workspaceContextPath = join(runDirectory, `${context.run.id}.workspace-context.json`);
    writeHoneycrispWorkspaceContext(scope, this.workspacePath, workspaceContextPath);
    const args = [
      ...invocation.prefixArgs,
      ...honeycrispRunArgs(input, this.workspacePath, capturePath, workspaceContextPath)
    ];
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'vm_event',
      source: 'executor',
      summary: 'Honeycrisp host process launched.',
      payload: {
        command: invocation.command,
        args: redactHoneycrispArgs(args),
        cwd: invocation.cwd,
        configuredBy: invocation.configuredBy,
        capturePath,
        workspaceContextPath
      },
      vmContextId: context.vmContext.id
    });

    const child = spawn(invocation.command, args, {
      cwd: invocation.cwd,
      env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? '1' },
      windowsHide: true
    });
    const active: ActiveHoneycrispRun = { child, context, stopped: false };
    this.activeRuns.set(context.run.id, active);

    const stdout = new LineBuffer((line) => this.recordProcessLine(context, 'stdout', line));
    const stderr = new LineBuffer((line) => this.recordProcessLine(context, 'stderr', line));
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const completion = new Promise<void>((resolveCompletion) => {
      child.once('error', (error) => {
        this.failRun(context, 'Honeycrisp host process failed to start.', { error: errorMessage(error), capturePath });
        resolveCompletion();
      });
      child.once('close', (code, signal) => {
        stdout.flush();
        stderr.flush();
        this.activeRuns.delete(context.run.id);
        this.finishClosedProcess(context, capturePath, code, signal, active.stopped);
        resolveCompletion();
      });
    }).finally(() => {
      if (this.completions.get(context.run.id) === completion) {
        this.completions.delete(context.run.id);
      }
    });
    this.completions.set(context.run.id, completion);
    this.onChange();
    return { context, completion };
  }

  public stop(runId: string): void {
    const active = this.activeRuns.get(runId);
    if (!active) return;
    active.stopped = true;
    active.child.kill('SIGTERM');
  }

  public dispose(): void {
    for (const runId of this.activeRuns.keys()) {
      this.stop(runId);
    }
    this.activeRuns.clear();
  }

  private recordProcessLine(context: CreatedRunContext, stream: 'stdout' | 'stderr', line: string): void {
    const text = line.trim();
    if (!text) return;
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'vm_event',
      source: 'executor',
      summary: `Honeycrisp ${stream}: ${truncateSummary(text)}`,
      payload: {
        stream,
        text: text.slice(0, MAX_LIVE_OUTPUT_CHARS),
        truncated: text.length > MAX_LIVE_OUTPUT_CHARS
      },
      vmContextId: context.vmContext.id,
      modelVisible: false
    });
    this.onChange();
  }

  private finishClosedProcess(
    context: CreatedRunContext,
    capturePath: string,
    code: number | null,
    signal: NodeJS.Signals | null,
    stopped: boolean
  ): void {
    const processPayload = { code, signal, capturePath };
    if (stopped) {
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'vm_event',
        source: 'executor',
        summary: 'Honeycrisp host process was stopped by Beale.',
        payload: processPayload,
        vmContextId: context.vmContext.id
      });
      this.db.updateAttemptState(context.attempt.id, 'stopped', 'Honeycrisp host process stopped.');
      this.db.updateRunStatus(context.run.id, 'stopped', 'Honeycrisp host process stopped.');
      this.db.updateModelSessionByRun(context.run.id, { status: 'stopped', metadata: processPayload });
      this.onChange();
      return;
    }

    if (code !== 0) {
      this.failRun(context, 'Honeycrisp host process exited with an error.', processPayload);
      return;
    }

    try {
      const captureText = readTextFile(capturePath);
      const capture = parseHoneycrispCapture(captureText);
      const contextUsage = this.importCapture(context, capture, capturePath, captureText);
      const summary = honeycrispCompletionSummary(capture);
      this.db.updateAttemptState(context.attempt.id, 'completed', summary);
      this.db.updateRunStatus(context.run.id, 'completed', summary);
      this.db.updateModelSessionByRun(context.run.id, {
        status: 'completed',
        metadata: {
          capturePath,
          goalStatus: capture.goalRun?.status ?? null,
          goalTerminalReason: capture.goalRun?.terminalReason ?? null,
          loopStatus: capture.loop?.status ?? null,
          memoryDatabasePath: capture.memoryIntegration?.databasePath ?? null,
          ...honeycrispGoalMetadata(capture),
          ...honeycrispContextUsageMetadata(contextUsage)
        }
      });
    } catch (error) {
      this.failRun(context, 'Honeycrisp run completed but Beale could not import the capture.', {
        ...processPayload,
        error: errorMessage(error)
      });
      return;
    }
    this.onChange();
  }

  private importCapture(
    context: CreatedRunContext,
    capture: HoneycrispFlowCapture,
    capturePath: string,
    captureText: string
  ): HoneycrispContextUsageSummary | null {
    const contextUsage = summarizeHoneycrispContextUsage(capture, captureText);
    const captureArtifact = this.db.createArtifact({
      kind: 'honeycrisp_flow_capture',
      mimeType: 'application/json',
      sensitivity: 'internal',
      modelVisible: true,
      source: 'honeycrisp',
      metadata: {
        sourcePath: capturePath,
        capturedAt: capture.capturedAt ?? null,
        memoryDatabasePath: capture.memoryIntegration?.databasePath ?? null,
        storageManifestPath: capture.storageManifest?.path ?? null,
        ...honeycrispGoalMetadata(capture),
        ...honeycrispContextUsageMetadata(contextUsage)
      },
      content: captureText
    });
    this.db.updateModelSessionByRun(context.run.id, { metadata: honeycrispContextUsageMetadata(contextUsage) });
    const artifactTrace = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'artifact_created',
      source: 'system',
      summary: 'Honeycrisp flow capture preserved as a Beale artifact.',
      payload: {
        sourcePath: capturePath,
        goal: honeycrispGoalPayload(capture),
        decision: honeycrispDecisionPayload(capture),
        goalRun: honeycrispGoalRunPayload(capture),
        memoryIntegration: capture.memoryIntegration ?? null,
        storageManifest: capture.storageManifest ?? null,
        ...(contextUsage
          ? {
              usage: honeycrispTraceUsage(contextUsage),
              contextUsage: honeycrispContextUsageMetadata(contextUsage)
            }
          : {})
      },
      artifactId: captureArtifact.id,
      vmContextId: context.vmContext.id
    });

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'system',
      summary: honeycrispGoalTraceSummary(capture),
      payload: {
        goal: honeycrispGoalPayload(capture),
        decision: honeycrispDecisionPayload(capture),
        goalRun: honeycrispGoalRunPayload(capture),
        bealeSessionBoundary: honeycrispSessionBoundary(capture)
      },
      vmContextId: context.vmContext.id,
      modelVisible: false
    });

    for (const event of capture.eventTimeline ?? []) {
      const mapped = mapHoneycrispEvent(event.kind);
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: mapped.type,
        source: mapped.source,
        summary: honeycrispEventSummary(event),
        payload: {
          honeycrispEventId: event.id ?? null,
          honeycrispKind: event.kind ?? 'unknown',
          honeycrispSequence: event.sequence ?? null,
          honeycrispTimestamp: event.timestamp ?? null,
          payload: event.payload ?? null,
          artifactRefs: event.artifactRefs ?? null
        },
        vmContextId: context.vmContext.id
      });
    }

    for (const [kind, items] of Object.entries(capture.loop?.researchTrace ?? {})) {
      if (!Array.isArray(items)) continue;
      for (const item of items.filter(isHoneycrispTraceItem)) {
        this.db.appendTraceEvent({
          runId: context.run.id,
          attemptId: context.attempt.id,
          type: kind === 'hypotheses' ? 'hypothesis_event' : 'model_message',
          source: 'model',
          summary: `Honeycrisp ${kind}: ${truncateSummary(item.text ?? '')}`,
          payload: {
            traceKind: kind,
            text: item.text ?? '',
            confidence: item.confidence ?? null,
            evidenceRefIds: item.evidenceRefIds ?? []
          },
          vmContextId: context.vmContext.id
        });
      }
    }

    const assistantText = renderHoneycrispAssistantMessage(capture);
    if (assistantText) {
      const transcriptTrace = this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'model_message',
        source: 'model',
        summary: 'Honeycrisp produced a final run response.',
        payload: {
          outputText: assistantText,
          followUpRecommendation: capture.loop?.followUpRecommendation ?? null,
          followUpRationale: capture.loop?.followUpRationale ?? null,
          captureArtifactId: captureArtifact.id
        },
        vmContextId: context.vmContext.id
      });
      this.db.createTranscriptMessage({
        runId: context.run.id,
        attemptId: context.attempt.id,
        traceEventId: transcriptTrace.id,
        role: 'assistant',
        contentMarkdown: assistantText,
        source: 'honeycrisp',
        metadata: {
          captureArtifactId: captureArtifact.id,
          captureTraceEventId: artifactTrace.id,
          executorName: capture.loop?.executorName ?? null,
          executionMode: capture.loop?.executionMode ?? null
        }
      });
      this.db.createNotification({
        runId: context.run.id,
        traceEventId: transcriptTrace.id,
        kind: 'session_final_response',
        title: 'Honeycrisp run finished',
        bodyMarkdown: assistantText
      });
    }
    return contextUsage;
  }

  private failRun(context: CreatedRunContext, summary: string, payload: Record<string, unknown>): void {
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'approval_event',
      source: 'system',
      summary,
      payload,
      vmContextId: context.vmContext.id
    });
    this.db.updateAttemptState(context.attempt.id, 'failed', summary);
    this.db.updateRunStatus(context.run.id, 'failed', summary);
    this.db.updateModelSessionByRun(context.run.id, { status: 'failed', metadata: payload });
    this.activeRuns.delete(context.run.id);
    this.onChange();
  }
}

class LineBuffer {
  private buffer = '';

  public constructor(private readonly emit: (line: string) => void) {}

  public push(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.emit(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  public flush(): void {
    if (!this.buffer) return;
    const line = this.buffer.replace(/\r$/, '');
    this.buffer = '';
    this.emit(line);
  }
}

function honeycrispRunArgs(input: StartRunInput, workspacePath: string, capturePath: string, workspaceContextPath: string): string[] {
  const args = [
    '--workspace-root',
    workspacePath,
    '--capture',
    capturePath,
    '--workspace-context',
    workspaceContextPath,
    '--goal-loops',
    String(goalLoopsForInput(input)),
    '-p',
    input.promptMarkdown
  ];
  if (honeycrispMockModeEnabled()) {
    args.push('--mock');
  }
  const configPath = process.env.BEALE_HONEYCRISP_CONFIG?.trim();
  if (configPath) {
    args.push('--config', configPath);
  }
  const provider = process.env.BEALE_HONEYCRISP_PROVIDER?.trim();
  if (provider) {
    args.push('--provider', provider);
  }
  if (input.model.trim()) {
    args.push('--model', input.model.trim());
  }
  if (input.reasoningEffort.trim()) {
    args.push('--effort', input.reasoningEffort.trim());
  }
  args.push('--tool-max-bytes', String(toolMaxBytes()));
  return args;
}

export function resolveHoneycrispInvocation(): HoneycrispInvocation {
  const command = process.env.BEALE_HONEYCRISP_COMMAND?.trim();
  if (command) {
    return {
      command,
      prefixArgs: parseEnvArgs('BEALE_HONEYCRISP_ARGS_JSON'),
      cwd: process.env.BEALE_HONEYCRISP_CWD?.trim() || process.cwd(),
      configuredBy: 'env_command'
    };
  }

  const root = process.env.BEALE_HONEYCRISP_ROOT?.trim() || resolve(process.cwd(), '..', 'honeycrisp');
  const cliPath = join(root, 'packages', 'cli', 'dist', 'cli.js');
  if (existsSync(cliPath)) {
    return {
      command: resolveHoneycrispNodeCommand(),
      prefixArgs: [cliPath],
      cwd: root,
      configuredBy: process.env.BEALE_HONEYCRISP_ROOT ? 'env_root' : 'sibling_root'
    };
  }
  return {
    command: process.env.BEALE_HONEYCRISP_PNPM_COMMAND?.trim() || 'pnpm',
    prefixArgs: ['--dir', root, 'start'],
    cwd: root,
    configuredBy: process.env.BEALE_HONEYCRISP_ROOT ? 'env_root' : 'sibling_root'
  };
}

function resolveHoneycrispNodeCommand(): string {
  const candidates = [
    process.env.BEALE_HONEYCRISP_NODE_COMMAND?.trim(),
    process.env.BEALE_NODE_COMMAND?.trim(),
    process.env.npm_node_execpath?.trim(),
    process.env.NODE?.trim(),
    'node',
    isPlainNodeExecutable(process.execPath) ? process.execPath : ''
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (nodeCommandAvailable(candidate)) return candidate;
  }
  return 'node';
}

function nodeCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true
  });
  return result.status === 0 && /^v\d+\.\d+\.\d+/.test(result.stdout.trim());
}

function isPlainNodeExecutable(path: string): boolean {
  const name = path.split(/[\\/]+/).at(-1)?.toLowerCase() ?? '';
  return name === 'node' || name === 'node.exe';
}

function writeHoneycrispWorkspaceContext(scope: ProgramScopeVersion, workspacePath: string, contextPath: string): HoneycrispWorkspaceContextFile {
  const context = honeycrispWorkspaceContext(scope, workspacePath);
  mkdirSync(dirname(contextPath), { recursive: true });
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
  return context;
}

function honeycrispWorkspaceContext(scope: ProgramScopeVersion, workspacePath: string): HoneycrispWorkspaceContextFile {
  const materializedSourcePaths: string[] = [];
  const knownRepositories: HoneycrispWorkspaceRepositoryContext[] = [];
  for (const asset of scope.assets) {
    if (asset.direction !== 'in_scope') continue;
    const root = localRootForAsset(asset);
    if (!root) continue;
    if (!materializedSourcePaths.includes(root)) {
      materializedSourcePaths.push(root);
    }
    if ((asset.kind === 'repo' || asset.kind === 'path') && !knownRepositories.some((repository) => repository.rootPath === root)) {
      const repositoryUrl = stringAttribute(asset.attributes?.repositoryUrl);
      knownRepositories.push({
        rootPath: root,
        label: honeycrispAssetLabel(asset),
        role: 'known_repository',
        source: 'beale',
        ...(repositoryUrl ? { repositoryUrl } : {})
      });
    }
  }
  return {
    schemaVersion: 1,
    workspaceRoot: workspacePath,
    knownRepositories,
    materializedSourcePaths,
    projectNotes: [
      `Program: ${scope.programName}`,
      `Organization: ${scope.organizationName}`,
      `Network profile: ${scope.networkProfile}`
    ].filter((note) => !note.endsWith(': '))
  };
}

function localRootForAsset(asset: ScopeAsset): string | null {
  const value = asset.value.trim();
  if (!isAbsolute(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || !existsSync(value)) {
    return null;
  }
  try {
    return statSync(value).isDirectory() ? value : dirname(value);
  } catch {
    return null;
  }
}

function honeycrispAssetLabel(asset: ScopeAsset): string {
  return stringAttribute(asset.attributes?.displayName) || stringAttribute(asset.attributes?.name) || asset.value;
}

function stringAttribute(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function goalLoopsForInput(input: StartRunInput): number {
  const envValue = positiveIntegerEnv('BEALE_HONEYCRISP_GOAL_LOOPS');
  if (envValue) return envValue;
  const attempts = Math.floor(input.budget.maxAttempts);
  if (!Number.isFinite(attempts) || attempts <= 0 || attempts >= UNBOUNDED_RUN_ATTEMPTS) return 1;
  return attempts;
}

function toolMaxBytes(): number {
  return positiveIntegerEnv('BEALE_HONEYCRISP_TOOL_MAX_BYTES') ?? DEFAULT_HONEYCRISP_TOOL_MAX_BYTES;
}

function positiveIntegerEnv(name: string): number | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function honeycrispMockModeEnabled(): boolean {
  return process.env.BEALE_HONEYCRISP_MOCK === '1' || process.env.BEALE_HONEYCRISP_MOCK === 'true';
}

function parseEnvArgs(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be a JSON string array.`);
  }
  return parsed;
}

function redactHoneycrispArgs(args: string[]): string[] {
  const sensitiveFlags = new Set(['--config']);
  const redacted: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    redacted.push(arg);
    if (sensitiveFlags.has(arg) && index + 1 < args.length) {
      redacted.push('[redacted]');
      index += 1;
    }
  }
  return redacted;
}

function mapHoneycrispEvent(kind: string | undefined): { type: TraceEventType; source: TraceSource } {
  switch (kind) {
    case 'tool.requested':
      return { type: 'tool_call', source: 'model' };
    case 'tool.observed':
      return { type: 'tool_result', source: 'tool' };
    case 'model.hypothesis':
      return { type: 'hypothesis_event', source: 'model' };
    case 'artifact.tombstoned':
      return { type: 'artifact_created', source: 'system' };
    case 'error.observed':
      return { type: 'approval_event', source: 'system' };
    case 'model.visible_note':
    case 'model.claim':
      return { type: 'model_message', source: 'model' };
    default:
      return { type: 'model_message', source: 'system' };
  }
}

function honeycrispEventSummary(event: HoneycrispCaptureEvent): string {
  const prefix = event.kind ? `Honeycrisp ${event.kind}` : 'Honeycrisp event';
  const summary = typeof event.summary === 'string' && event.summary.trim() ? event.summary.trim() : '';
  return summary ? `${prefix}: ${truncateSummary(summary)}` : prefix;
}

function summarizeHoneycrispContextUsage(capture: HoneycrispFlowCapture, captureText: string): HoneycrispContextUsageSummary | null {
  const reported = summarizeReportedHoneycrispUsage(capture);
  const estimatedSerializedTokens = estimateSerializedTokens(captureText);
  const contextV2EstimatedTokens = estimatedHoneycrispContextV2Tokens(capture);

  if (reported && reported.usage.inputTokens !== null) {
    return {
      inputTokens: reported.usage.inputTokens,
      outputTokens: reported.usage.outputTokens,
      totalTokens: reported.usage.totalTokens ?? tokenTotalFromParts(reported.usage.inputTokens, reported.usage.outputTokens),
      source: HONEYCRISP_REPORTED_USAGE_SOURCE,
      estimated: false,
      reportedCallCount: reported.callCount,
      estimatedSerializedTokens,
      contextV2EstimatedTokens
    };
  }

  if (reported && reported.usage.totalTokens !== null && estimatedSerializedTokens !== null) {
    return {
      inputTokens: estimatedSerializedTokens,
      outputTokens: reported.usage.outputTokens,
      totalTokens: reported.usage.totalTokens,
      source: HONEYCRISP_MIXED_USAGE_SOURCE,
      estimated: true,
      reportedCallCount: reported.callCount,
      estimatedSerializedTokens,
      contextV2EstimatedTokens
    };
  }

  if (estimatedSerializedTokens !== null) {
    return {
      inputTokens: estimatedSerializedTokens,
      outputTokens: null,
      totalTokens: null,
      source: HONEYCRISP_ESTIMATED_USAGE_SOURCE,
      estimated: true,
      reportedCallCount: 0,
      estimatedSerializedTokens,
      contextV2EstimatedTokens
    };
  }

  return null;
}

function summarizeReportedHoneycrispUsage(
  capture: HoneycrispFlowCapture
): { usage: NormalizedTokenUsage; callCount: number } | null {
  const usageRecords = collectHoneycrispUsageRecords(capture);
  if (usageRecords.length === 0) return null;

  let latestInputTokens: number | null = null;
  let outputTokenTotal = 0;
  let sawOutputTokens = false;
  let totalTokenTotal = 0;
  let sawTotalTokens = false;

  for (const record of usageRecords) {
    const usage = normalizeTokenUsage(record);
    if (!usage) continue;
    if (usage.inputTokens !== null) latestInputTokens = usage.inputTokens;
    if (usage.outputTokens !== null) {
      outputTokenTotal += usage.outputTokens;
      sawOutputTokens = true;
    }
    const totalTokens = usage.totalTokens ?? tokenTotalFromParts(usage.inputTokens, usage.outputTokens);
    if (totalTokens !== null) {
      totalTokenTotal += totalTokens;
      sawTotalTokens = true;
    }
  }

  if (latestInputTokens === null && !sawOutputTokens && !sawTotalTokens) return null;
  return {
    usage: {
      inputTokens: latestInputTokens,
      outputTokens: sawOutputTokens ? outputTokenTotal : null,
      totalTokens: sawTotalTokens ? totalTokenTotal : null
    },
    callCount: usageRecords.length
  };
}

function collectHoneycrispUsageRecords(capture: HoneycrispFlowCapture): Record<string, unknown>[] {
  const raw = recordValue(capture.loop?.raw);
  const modelCallUsages = arrayRecordValues(raw?.modelCalls).flatMap((call) => {
    const usage = recordValue(call.usage);
    return usage ? [usage] : [];
  });
  if (modelCallUsages.length > 0) return modelCallUsages;

  const rawUsage = recordValue(raw?.usage);
  if (rawUsage) return [rawUsage];

  return [capture.usage, capture.modelUsage, capture.tokenUsage].flatMap((value) => {
    const usage = recordValue(value);
    return usage ? [usage] : [];
  });
}

function normalizeTokenUsage(record: Record<string, unknown>): NormalizedTokenUsage | null {
  const inputTokens =
    positiveNumberRecordValue(record, 'input_tokens') ??
    positiveNumberRecordValue(record, 'prompt_tokens') ??
    positiveNumberRecordValue(record, 'inputTokens') ??
    positiveNumberRecordValue(record, 'promptTokens');
  const outputTokens =
    positiveNumberRecordValue(record, 'output_tokens') ??
    positiveNumberRecordValue(record, 'completion_tokens') ??
    positiveNumberRecordValue(record, 'outputTokens') ??
    positiveNumberRecordValue(record, 'completionTokens');
  const totalTokens = positiveNumberRecordValue(record, 'total_tokens') ?? positiveNumberRecordValue(record, 'totalTokens');
  if (inputTokens === null && outputTokens === null && totalTokens === null) return null;
  return { inputTokens, outputTokens, totalTokens };
}

function honeycrispTraceUsage(usage: HoneycrispContextUsageSummary): Record<string, unknown> {
  return {
    input_tokens: usage.inputTokens,
    ...(usage.outputTokens !== null ? { output_tokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== null ? { total_tokens: usage.totalTokens } : {}),
    source: usage.source,
    estimated: usage.estimated,
    reportedCallCount: usage.reportedCallCount,
    estimatedSerializedTokens: usage.estimatedSerializedTokens,
    contextV2EstimatedTokens: usage.contextV2EstimatedTokens
  };
}

function honeycrispContextUsageMetadata(usage: HoneycrispContextUsageSummary | null): Record<string, unknown> {
  if (!usage) return {};
  return {
    latestReportedInputTokens: usage.inputTokens,
    latestReportedTotalTokens: usage.totalTokens,
    latestContextUsageSource: usage.source,
    latestContextUsageEstimated: usage.estimated,
    latestContextUsageReportedCallCount: usage.reportedCallCount,
    latestEstimatedSerializedTokens: usage.estimatedSerializedTokens,
    latestContextV2EstimatedTokens: usage.contextV2EstimatedTokens
  };
}

function honeycrispGoalMetadata(capture: HoneycrispFlowCapture): Record<string, unknown> {
  return {
    honeycrispGoalId: capture.goal?.id ?? null,
    honeycrispGoalObjective: capture.goal?.objective ?? null,
    honeycrispGoalStatus: capture.goalRun?.status ?? null,
    honeycrispGoalTerminalReason: capture.goalRun?.terminalReason ?? null,
    honeycrispGoalStatusReason: capture.goalRun?.statusReason ?? null,
    honeycrispGoalLoopsUsed: capture.goalRun?.loopsUsed ?? null,
    honeycrispGoalMaxLoops: capture.goalRun?.maxLoops ?? null,
    honeycrispSubGoalId: capture.decision?.subGoalId ?? null,
    honeycrispSubGoalObjective: capture.decision?.subGoalObjective ?? null,
    honeycrispSubGoalActionClass: capture.decision?.actionClass ?? null,
    honeycrispSubGoalRationale: capture.decision?.rationale ?? null,
    honeycrispBealeSessionBoundary: honeycrispSessionBoundary(capture)
  };
}

function honeycrispGoalPayload(capture: HoneycrispFlowCapture): Record<string, unknown> {
  return {
    id: capture.goal?.id ?? null,
    objective: capture.goal?.objective ?? null,
    scopeConstraints: capture.goal?.scopeConstraints ?? null,
    evidenceRequirements: capture.goal?.evidenceRequirements ?? null,
    riskFlags: capture.goal?.riskFlags ?? null
  };
}

function honeycrispDecisionPayload(capture: HoneycrispFlowCapture): Record<string, unknown> {
  return {
    actionClass: capture.decision?.actionClass ?? null,
    subGoalId: capture.decision?.subGoalId ?? null,
    subGoalObjective: capture.decision?.subGoalObjective ?? null,
    rationale: capture.decision?.rationale ?? null
  };
}

function honeycrispGoalRunPayload(capture: HoneycrispFlowCapture): Record<string, unknown> {
  return {
    status: capture.goalRun?.status ?? null,
    terminalReason: capture.goalRun?.terminalReason ?? null,
    statusReason: capture.goalRun?.statusReason ?? null,
    loopsUsed: capture.goalRun?.loopsUsed ?? null,
    maxLoops: capture.goalRun?.maxLoops ?? null,
    safetyMaxLoops: capture.goalRun?.safetyMaxLoops ?? null,
    blockedThreshold: capture.goalRun?.blockedThreshold ?? null,
    consecutiveBlockedCount: capture.goalRun?.consecutiveBlockedCount ?? null
  };
}

function honeycrispSessionBoundary(capture: HoneycrispFlowCapture): string {
  const status = capture.goalRun?.status ?? '';
  const terminalReason = capture.goalRun?.terminalReason ?? '';
  if (status === 'active' && terminalReason === 'loop_limit') return 'beale_subgoal_checkpoint';
  if (status === 'active' && terminalReason === 'ready_to_respond') return 'beale_response_checkpoint';
  if (status === 'active') return 'active_goal_checkpoint';
  return 'terminal_goal';
}

function estimatedHoneycrispContextV2Tokens(capture: HoneycrispFlowCapture): number | null {
  const total = (capture.contextV2?.sections ?? []).reduce((sum, section) => sum + (positiveNumber(section.estimatedTokens) ?? 0), 0);
  return total > 0 ? Math.ceil(total) : null;
}

function estimateSerializedTokens(value: string): number | null {
  const byteLength = Buffer.byteLength(value, 'utf8');
  return byteLength > 0 ? Math.ceil(byteLength / 4) : null;
}

function tokenTotalFromParts(inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens === null && outputTokens === null) return null;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function arrayRecordValues(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const records: Record<string, unknown>[] = [];
  for (const item of value) {
    const record = recordValue(item);
    if (record) records.push(record);
  }
  return records;
}

function positiveNumberRecordValue(record: Record<string, unknown>, key: string): number | null {
  return positiveNumber(record[key]);
}

function positiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
}

function honeycrispCompletionSummary(capture: HoneycrispFlowCapture): string {
  const goalStatus = capture.goalRun?.status ?? 'unknown';
  const terminalReason = capture.goalRun?.terminalReason ?? '';
  const terminal = terminalReason ? ` (${terminalReason})` : '';
  if (goalStatus === 'active' && terminalReason === 'loop_limit') {
    const subGoal = capture.decision?.subGoalObjective ? ` after subgoal "${truncateSummary(capture.decision.subGoalObjective)}"` : '';
    return `Honeycrisp checkpoint completed${subGoal}; root goal remains active.`;
  }
  if (goalStatus === 'active' && terminalReason === 'ready_to_respond') {
    return 'Honeycrisp response checkpoint completed; root goal remains active.';
  }
  return `Honeycrisp process finished with goal status ${goalStatus}${terminal}.`;
}

function renderHoneycrispAssistantMessage(capture: HoneycrispFlowCapture): string {
  const checkpoint = honeycrispAssistantCheckpoint(capture);
  const parts = [
    capture.loop?.outputText?.trim() ?? '',
    capture.loop?.researchTrace?.goalAssessment?.rationale
      ? `\n\nGoal assessment: ${capture.loop.researchTrace.goalAssessment.rationale}`
      : '',
    checkpoint ? `\n\n${checkpoint}` : ''
  ].filter(Boolean);
  return parts.join('');
}

function honeycrispAssistantCheckpoint(capture: HoneycrispFlowCapture): string {
  if (capture.goalRun?.status !== 'active') return '';
  const subGoal = capture.decision?.subGoalObjective?.trim();
  if (capture.goalRun.terminalReason === 'loop_limit') {
    return subGoal
      ? `Checkpoint: Beale session completed the selected Honeycrisp subgoal while the root goal remains active.\n\nSubgoal: ${subGoal}`
      : 'Checkpoint: Beale session completed a Honeycrisp subgoal while the root goal remains active.';
  }
  if (capture.goalRun.terminalReason === 'ready_to_respond') {
    return 'Checkpoint: Honeycrisp is ready to respond while the root goal remains active.';
  }
  return '';
}

function honeycrispGoalTraceSummary(capture: HoneycrispFlowCapture): string {
  const subGoal = capture.decision?.subGoalObjective?.trim();
  if (subGoal) {
    return `Honeycrisp selected subgoal: ${truncateSummary(subGoal)}`;
  }
  const goal = capture.goal?.objective?.trim();
  if (goal) {
    return `Honeycrisp goal checkpoint: ${truncateSummary(goal)}`;
  }
  return 'Honeycrisp goal checkpoint imported.';
}

function isHoneycrispTraceItem(value: unknown): value is HoneycrispTraceItem {
  return typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string';
}

function parseHoneycrispCapture(text: string): HoneycrispFlowCapture {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Honeycrisp capture was not a JSON object.');
  }
  return value as HoneycrispFlowCapture;
}

function readTextFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Honeycrisp capture was not written: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

function truncateSummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= MAX_SUMMARY_CHARS ? normalized : `${normalized.slice(0, MAX_SUMMARY_CHARS - 1)}...`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}
