import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import type {
  ResearchModelSelection,
  RunRecord,
  TranscriptMessageRecord,
  WorkspaceScopeVersion,
  ScopeAsset,
  StartRunInput,
  TraceEventRecord,
  TraceEventType,
  TraceSource
} from '@shared/types';
import { SESSION_TITLE_FALLBACK } from '../shared/sessionTitle';
import { SESSION_TITLE_REASONING_EFFORT, sessionTitleModelForProvider } from '../shared/modelDefaults';
import { redactForModelText } from './redaction';

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
  authorization?: HoneycrispWorkspaceAuthorizationContext;
  memoryTierContext: HoneycrispMemoryTierContext;
  knownRepositories: HoneycrispWorkspaceRepositoryContext[];
  materializedSourcePaths: string[];
  projectNotes: string[];
}

interface HoneycrispMemoryTierContext {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  subjectId?: string;
  subjectName?: string;
}

interface HoneycrispWorkspaceAuthorizationContext {
  recorded: true;
  source: 'beale';
  scopeId: string;
  scopeName: string;
  scopeOwner?: string;
  networkProfile: string;
  activeFrom: string;
  expiresAt?: string;
}

interface HoneycrispWorkspaceRepositoryContext {
  rootPath: string;
  contentRoots?: string[];
  label?: string;
  role: 'known_repository' | 'materialized_source' | 'workspace';
  source: 'beale';
  repositoryUrl?: string;
  notes?: string[];
}

interface ActiveHoneycrispRun {
  child: ChildProcessWithoutNullStreams;
  context: CreatedRunContext;
  rootTurnOffset: number;
  paused: boolean;
  stopped: boolean;
  stopReason: 'user' | 'time_limit' | null;
  budgetTimer: NodeJS.Timeout | null;
  forceStopTimer: NodeJS.Timeout | null;
  liveHoneycrispEventIds: Set<string>;
  liveReasoningSummaries: Map<string, HoneycrispLiveReasoningSummaryState>;
}

interface HoneycrispFlowCapture {
  schemaVersion?: 4;
  capturedAt?: string;
  request?: {
    prompt?: string;
  };
  agent?: {
    id?: string;
    status?: string;
    executorName?: string;
    startedAt?: string;
    completedAt?: string;
    outputText?: string;
    nextPromptSuggestions?: HoneycrispNextPromptSuggestion[];
    researchTrace?: {
      observations?: HoneycrispTraceItem[];
      inferences?: HoneycrispTraceItem[];
      hypotheses?: HoneycrispTraceItem[];
      assumptions?: HoneycrispTraceItem[];
      rejectedPaths?: HoneycrispTraceItem[];
      uncertainty?: HoneycrispTraceItem[];
      nextQuestions?: HoneycrispTraceItem[];
    };
    raw?: unknown;
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

interface HoneycrispNextPromptSuggestion {
  title?: string;
  promptMarkdown?: string;
  rationale?: string;
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
  agentId?: string;
  agentPath?: string;
  parentAgentId?: string;
}

interface HoneycrispLiveEvent {
  schemaVersion?: number;
  kind?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

interface HoneycrispLiveReasoningSummaryState {
  text: string;
  snapshotCount: number;
}

interface HoneycrispContextUsageSummary {
  inputTokens: number;
  promptTokens: number;
  sessionPromptTokens: number;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number | null;
  source: string;
  estimated: boolean;
  reportedCallCount: number;
  estimatedSerializedTokens: number | null;
}

interface NormalizedTokenUsage {
  inputTokens: number | null;
  promptTokens: number | null;
  sessionPromptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number | null;
}

const DEFAULT_HONEYCRISP_TOOL_MAX_BYTES = 200_000;
const MAX_LIVE_OUTPUT_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 220;
const HONEYCRISP_REPORTED_USAGE_SOURCE = 'Honeycrisp reported model usage';
const HONEYCRISP_ESTIMATED_USAGE_SOURCE = 'Honeycrisp serialized capture estimate';
const HONEYCRISP_MIXED_USAGE_SOURCE = 'Honeycrisp reported total plus capture estimate';
const HONEYCRISP_EVENT_PREFIX = 'HONEYCRISP_EVENT ';
const CONTINUATION_CONTEXT_MAX_CHARS = 32_000;
const UNBOUNDED_RUN_MINUTES = 999_999;
const HONEYCRISP_STOP_GRACE_MS = 1_500;
export class HoneycrispRunEngine {
  private readonly activeRuns = new Map<string, ActiveHoneycrispRun>();
  private readonly completions = new Map<string, Promise<void>>();
  private disposed = false;

  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly workspacePath: string,
    private readonly onChange: (change?: { workspaceRegistryChanged?: boolean }) => void = () => undefined,
    private readonly shellOptionsPath?: string
  ) {}

  public startRun(input: StartRunInput): HoneycrispRunHandle {
    if (this.disposed) {
      throw new Error('Honeycrisp run engine has been disposed.');
    }
    const scope = this.db.getActiveScope();
    const context = this.db.createRun({
      scopeVersionId: scope.id,
      title: SESSION_TITLE_FALLBACK,
      promptMarkdown: input.promptMarkdown,
      mode: input.mode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attemptStrategy: input.attemptStrategy,
      networkProfile: input.networkProfile,
      sandboxProfile: input.sandboxProfile,
      targetAssetId: input.targetAssetId,
      targetPath: input.targetPath,
      budget: { ...input.budget, runEngine: 'honeycrisp', modelProvider: input.provider?.trim() || null },
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
        provider: input.provider?.trim() || null,
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
        provider: input.provider?.trim() || null,
        sandboxProfile: input.sandboxProfile
      },
      vmContextId: context.vmContext.id
    });

    return this.launchRun(context, input, scope, false);
  }

  public extendRun(runId: string, instruction: string): HoneycrispRunHandle {
    if (this.activeRuns.has(runId)) {
      throw new Error(`Honeycrisp run ${runId} is already active.`);
    }
    const detail = this.db.getRunDetail(runId);
    const run = detail.run;
    const scope = this.db.getScopeVersion(run.scopeVersionId);
    const parentAttempt = detail.attempts.at(-1) ?? null;
    const attempt = this.db.createAttempt({
      runId,
      parentAttemptId: parentAttempt?.id ?? null,
      status: 'active',
      shortState: 'Continuing the current Honeycrisp research session.',
      strategyRole: 'session_continuation',
      vmBackend: 'host',
      vmImageId: 'host-machine',
      vmSnapshotId: 'none',
      vmState: 'host_active',
      vmMetadata: {
        executor: 'honeycrisp',
        targetExecution: false,
        hostProcess: true,
        continuation: true,
        honeycrispWorkspaceRoot: this.workspacePath
      }
    });
    const refreshed = this.db.getRunDetail(runId);
    const vmContext = refreshed.vmContexts.find((candidate) => candidate.id === attempt.vmContextId);
    if (!vmContext) throw new Error(`Continuation VM context not found for run ${runId}.`);
    const context: CreatedRunContext = { run, attempt, vmContext };
    const continuationInput = startRunInputFromRun(run, buildContinuationPrompt(run, detail.transcriptMessages, instruction));

    this.db.createModelSession({
      runId,
      provider: 'honeycrisp',
      transport: 'host_process',
      status: 'active',
      metadata: {
        provider: continuationInput.provider?.trim() || null,
        model: run.model,
        reasoningEffort: run.reasoningEffort,
        continuation: true,
        parentAttemptId: parentAttempt?.id ?? null
      }
    });
    const steeringTrace = this.db.appendTraceEvent({
      runId,
      attemptId: attempt.id,
      type: 'user_note',
      source: 'user',
      summary: 'User steering extended the current research session.',
      payload: { instruction: redactForModelText(instruction), continuation: true },
      vmContextId: vmContext.id
    });
    this.db.createTranscriptMessage({
      runId,
      attemptId: attempt.id,
      traceEventId: steeringTrace.id,
      role: 'user',
      contentMarkdown: instruction,
      source: 'user_steering',
      metadata: { continuation: true }
    });
    this.db.updateRunStatus(runId, 'active', 'Continuing the current Honeycrisp research session.');

    return this.launchRun(context, continuationInput, scope, true);
  }

  private launchRun(
    context: CreatedRunContext,
    input: StartRunInput,
    scope: WorkspaceScopeVersion,
    continuation: boolean
  ): HoneycrispRunHandle {
    const invocation = resolveHoneycrispInvocation();
    const rootTurnOffset = continuation ? latestRootTurn(this.db.getRunDetail(context.run.id).traceEvents) : 0;
    const runDirectory = join(this.workspacePath, '.beale', 'honeycrisp-runs');
    const fileStem = continuation ? `${context.run.id}.${context.attempt.id}` : context.run.id;
    const capturePath = join(runDirectory, `${fileStem}.capture.json`);
    const workspaceContextPath = join(runDirectory, `${fileStem}.workspace-context.json`);
    writeHoneycrispWorkspaceContext(
      scope,
      this.workspacePath,
      workspaceContextPath,
      context.run.id,
      this.db.getWorkspaceId(),
      input.networkProfile
    );
    const args = [
      ...invocation.prefixArgs,
      ...honeycrispRunArgs(input, this.workspacePath, capturePath, workspaceContextPath, this.shellOptionsPath, !continuation)
    ];
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'vm_event',
      source: 'executor',
      summary: continuation ? 'Honeycrisp host process launched to continue the current session.' : 'Honeycrisp host process launched.',
      payload: {
        command: invocation.command,
        args: redactHoneycrispArgs(args),
        cwd: invocation.cwd,
        configuredBy: invocation.configuredBy,
        capturePath,
        workspaceContextPath,
        continuation,
        rootTurnOffset
      },
      vmContextId: context.vmContext.id
    });

    const child = spawn(invocation.command, args, {
      cwd: invocation.cwd,
      env: honeycrispProcessEnvironment({
        databasePath: this.db.getDatabasePath(),
        artifactDirectoryPath: join(dirname(this.db.getDatabasePath()), 'artifacts')
      }),
      detached: process.platform !== 'win32',
      windowsHide: true
    });
    child.stdin.on('error', () => undefined);
    const active: ActiveHoneycrispRun = {
      child,
      context,
      rootTurnOffset,
      paused: false,
      stopped: false,
      stopReason: null,
      budgetTimer: null,
      forceStopTimer: null,
      liveHoneycrispEventIds: new Set(),
      liveReasoningSummaries: new Map()
    };
    this.activeRuns.set(context.run.id, active);
    this.armTimeLimit(active, input.budget.maxMinutes);

    const stdout = new LineBuffer((line) => this.recordProcessLine(context, 'stdout', line));
    const stderr = new LineBuffer((line) => this.recordProcessLine(context, 'stderr', line));
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const completion = new Promise<void>((resolveCompletion) => {
      child.once('error', (error) => {
        this.clearTimeLimit(active);
        this.clearForceStopTimer(active);
        if (!this.disposed) {
          this.failRun(context, 'Honeycrisp host process failed to start.', { error: errorMessage(error), capturePath });
        }
        resolveCompletion();
      });
      child.once('close', (code, signal) => {
        this.clearTimeLimit(active);
        this.clearForceStopTimer(active);
        stdout.flush();
        stderr.flush();
        this.activeRuns.delete(context.run.id);
        if (!this.disposed) {
          this.finishClosedProcess(context, capturePath, code, signal, active);
        }
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
    this.stopActiveRun(active, 'user');
  }

  public hasRun(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  private stopActiveRun(active: ActiveHoneycrispRun, reason: 'user' | 'time_limit'): void {
    if (active.stopped) return;
    active.stopped = true;
    active.stopReason = reason;
    this.clearTimeLimit(active);
    if (active.paused && process.platform !== 'win32') {
      signalHoneycrispProcess(active.child, 'SIGCONT');
    }
    try {
      this.sendControl(active, { schemaVersion: 1, type: 'stop' });
    } catch {
      signalHoneycrispProcess(active.child, 'SIGTERM');
      return;
    }
    active.forceStopTimer = setTimeout(() => {
      active.forceStopTimer = null;
      if (this.activeRuns.get(active.context.run.id) !== active) return;
      signalHoneycrispProcess(active.child, 'SIGTERM');
    }, HONEYCRISP_STOP_GRACE_MS);
    active.forceStopTimer.unref();
  }

  private armTimeLimit(active: ActiveHoneycrispRun, maxMinutes: number): void {
    if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes >= UNBOUNDED_RUN_MINUTES) return;
    const timeoutMs = Math.max(1, Math.round(maxMinutes * 60_000));
    active.budgetTimer = setTimeout(() => {
      if (this.activeRuns.get(active.context.run.id) !== active) return;
      this.db.appendTraceEvent({
        runId: active.context.run.id,
        attemptId: active.context.attempt.id,
        type: 'vm_event',
        source: 'system',
        summary: 'Session time limit reached.',
        payload: { maxMinutes },
        vmContextId: active.context.vmContext.id,
        modelVisible: false
      });
      this.onChange();
      this.stopActiveRun(active, 'time_limit');
    }, timeoutMs);
    active.budgetTimer.unref();
  }

  private clearTimeLimit(active: ActiveHoneycrispRun): void {
    if (!active.budgetTimer) return;
    clearTimeout(active.budgetTimer);
    active.budgetTimer = null;
  }

  private clearForceStopTimer(active: ActiveHoneycrispRun): void {
    if (!active.forceStopTimer) return;
    clearTimeout(active.forceStopTimer);
    active.forceStopTimer = null;
  }

  public pause(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    if (active.paused) return true;
    this.sendControl(active, { schemaVersion: 1, type: 'pause' });
    if (process.platform !== 'win32' && !signalHoneycrispProcess(active.child, 'SIGSTOP')) {
      throw new Error(`Unable to pause Honeycrisp process for run ${runId}.`);
    }
    active.paused = true;
    return true;
  }

  public resume(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    if (!active.paused) return true;
    if (process.platform !== 'win32' && !signalHoneycrispProcess(active.child, 'SIGCONT')) {
      throw new Error(`Unable to resume Honeycrisp process for run ${runId}.`);
    }
    active.paused = false;
    this.sendControl(active, { schemaVersion: 1, type: 'resume' });
    return true;
  }

  public steer(runId: string, instruction: string, modelSelection?: ResearchModelSelection): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    this.sendControl(active, {
      schemaVersion: 1,
      type: 'steer',
      instruction,
      ...(modelSelection ? { modelSelection } : {})
    });
    return true;
  }

  public configure(runId: string, modelSelection: ResearchModelSelection): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    this.sendControl(active, { schemaVersion: 1, type: 'configure', modelSelection });
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const active of this.activeRuns.values()) {
      this.clearTimeLimit(active);
      this.clearForceStopTimer(active);
      if (active.paused && process.platform !== 'win32') {
        signalHoneycrispProcess(active.child, 'SIGCONT');
      }
      try {
        this.sendControl(active, { schemaVersion: 1, type: 'stop' });
      } catch {
        // The process tree is terminated below even when its control stream has closed.
      }
      signalHoneycrispProcess(active.child, 'SIGTERM');
    }
    this.activeRuns.clear();
  }

  private sendControl(active: ActiveHoneycrispRun, message: Record<string, unknown>): void {
    if (active.child.stdin.destroyed || active.child.stdin.writableEnded) {
      throw new Error(`Honeycrisp control stream is unavailable for run ${active.context.run.id}.`);
    }
    active.child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8');
  }

  private recordProcessLine(context: CreatedRunContext, stream: 'stdout' | 'stderr', line: string): void {
    if (this.disposed) return;
    const text = line.trim();
    if (!text) return;
    const liveEvent = stream === 'stdout' ? parseHoneycrispLiveEvent(text) : null;
    if (liveEvent) {
      this.recordLiveEvent(context, liveEvent);
      return;
    }
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

  private recordLiveEvent(context: CreatedRunContext, event: HoneycrispLiveEvent): void {
    const active = this.activeRuns.get(context.run.id);
    event = offsetRootTurn(event, active?.rootTurnOffset ?? 0);
    if (event.kind === 'session.title') {
      const title = stringPayload(event.payload ?? {}, 'title');
      if (title) {
        this.db.updateRunTitle(context.run.id, title.slice(0, 120));
        this.onChange({ workspaceRegistryChanged: true });
        return;
      }
      if (stringPayload(event.payload ?? {}, 'status') !== 'error') return;
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'vm_event',
        source: 'executor',
        summary: 'Session title generation failed.',
        payload: {
          provider: stringPayload(event.payload ?? {}, 'provider'),
          model: stringPayload(event.payload ?? {}, 'model'),
          effort: stringPayload(event.payload ?? {}, 'effort'),
          errorMessage: stringPayload(event.payload ?? {}, 'errorMessage')
        },
        vmContextId: context.vmContext.id,
        modelVisible: false
      });
      this.onChange();
      return;
    }

    if (event.kind === 'research.event') {
      const honeycrispEvent = honeycrispCaptureEventFromLiveEvent(event);
      if (!honeycrispEvent) return;
      if (honeycrispEvent.id && active?.liveHoneycrispEventIds.has(honeycrispEvent.id)) return;
      if (honeycrispEvent.id) active?.liveHoneycrispEventIds.add(honeycrispEvent.id);
      this.appendHoneycrispTimelineEvent(context, honeycrispEvent);
      this.recordLiveResearchSummary(context, honeycrispEvent);
      this.onChange();
      return;
    }

    if (event.kind === 'model.thought') {
      this.recordLiveReasoningSummary(context, event, active);
      return;
    }

    if (event.kind === 'model.output') {
      this.recordLiveSubagentOutput(context, event);
      return;
    }

    if (event.kind === 'agent.event') {
      const eventType = stringPayload(event.payload ?? {}, 'type');
      if (eventType === 'subagent.activity') {
        this.recordSubagentActivity(context, event);
        return;
      }
      if (eventType === 'context_compacted') {
        this.recordAgentContextCompaction(context, event);
        return;
      }
      if (eventType === 'model_retry') {
        this.recordAgentModelRetry(context, event);
        return;
      }
      if (eventType !== 'turn_completed') return;
      const turn = numberPayload(event.payload ?? {}, 'turn');
      const agentPath = stringPayload(event.payload ?? {}, 'agentPath');
      const subagent = Boolean(agentPath && agentPath !== '/root');
      const reportedUsage = normalizeTokenUsage(recordValue(event.payload?.usage) ?? {});
      const usage = reportedUsage ? reportedHoneycrispTraceUsage(reportedUsage) : null;
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'model_message',
        source: 'executor',
        summary: subagent
          ? turn
            ? `Honeycrisp subagent ${agentPath} turn ${turn} completed.`
            : `Honeycrisp subagent ${agentPath} turn completed.`
          : turn
            ? `Honeycrisp model turn ${turn} completed.`
            : 'Honeycrisp model turn completed.',
        payload: {
          honeycrispLiveKind: event.kind,
          honeycrispTimestamp: event.timestamp ?? null,
          ...(event.payload ?? {}),
          ...(usage ? { usage } : {})
        },
        vmContextId: context.vmContext.id,
        modelVisible: false
      });
      if (reportedUsage && !subagent) {
        this.db.updateModelSessionByRun(context.run.id, {
          metadata: {
            latestReportedInputTokens: reportedUsage.promptTokens,
            latestReportedTotalTokens: reportedUsage.totalTokens,
            latestCacheHitRate: reportedUsage.cacheHitRate,
            latestContextUsageSource: HONEYCRISP_REPORTED_USAGE_SOURCE,
            latestContextUsageEstimated: false,
            latestContextUsageReportedCallCount: turn ?? 1
          }
        });
      }
      this.onChange();
      return;
    }

    if (event.kind === 'tool.progress') {
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'vm_event',
        source: 'executor',
        summary: honeycrispLiveEventSummary(event),
        payload: {
          honeycrispLiveKind: event.kind,
          honeycrispTimestamp: event.timestamp ?? null,
          ...(event.payload ?? {})
        },
        vmContextId: context.vmContext.id,
        modelVisible: false
      });
      this.onChange();
    }
  }

  private recordAgentContextCompaction(context: CreatedRunContext, event: HoneycrispLiveEvent): void {
    const payload = event.payload ?? {};
    const reactive = payload.reason === 'context_window_error';
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'system',
      summary: reactive
        ? 'OpenAI context window pressure triggered compacted retry.'
        : 'Honeycrisp compacted agent context.',
      payload: {
        honeycrispLiveKind: event.kind,
        honeycrispTimestamp: event.timestamp ?? null,
        transcriptRole: 'system',
        ...payload
      },
      vmContextId: context.vmContext.id,
      modelVisible: false
    });
    this.onChange();
  }

  private recordAgentModelRetry(context: CreatedRunContext, event: HoneycrispLiveEvent): void {
    const payload = event.payload ?? {};
    const errorMessage = stringPayload(payload, 'errorMessage') ?? 'Transient model error.';
    const silentStream = errorMessage.includes('produced no content');
    const safetyGuardrail = stringPayload(payload, 'recoveryKind') === 'safety_guardrail';
    const likelyFalsePositive = stringPayload(payload, 'safetyDisposition') === 'likely_false_positive';
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'system',
      summary: safetyGuardrail
        ? likelyFalsePositive
          ? 'Honeycrisp continued after an authorized safety guardrail false positive.'
          : 'Honeycrisp added safer steering after a provider safety guardrail.'
        : silentStream
          ? 'Honeycrisp retried a silent model stream.'
          : 'Honeycrisp retried a transient model error.',
      payload: {
        honeycrispLiveKind: event.kind,
        honeycrispTimestamp: event.timestamp ?? null,
        transcriptRole: 'system',
        ...payload
      },
      vmContextId: context.vmContext.id,
      modelVisible: false
    });
    this.onChange();
  }

  private recordSubagentActivity(context: CreatedRunContext, event: HoneycrispLiveEvent): void {
    const payload = event.payload ?? {};
    const action = stringPayload(payload, 'action') ?? 'updated';
    const agentPath = stringPayload(payload, 'agentPath') ?? 'unknown agent';
    const summaries: Record<string, string> = {
      spawned: `Honeycrisp subagent ${agentPath} started.`,
      message: `Honeycrisp sent a message to subagent ${agentPath}.`,
      followup: `Honeycrisp extended subagent ${agentPath}.`,
      interrupted: `Honeycrisp subagent ${agentPath} was interrupted.`,
      completed: `Honeycrisp subagent ${agentPath} completed.`,
      errored: `Honeycrisp subagent ${agentPath} failed.`
    };
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'system',
      summary: summaries[action] ?? `Honeycrisp subagent ${agentPath} ${action}.`,
      payload: {
        honeycrispLiveKind: event.kind,
        honeycrispTimestamp: event.timestamp ?? null,
        transcriptRole: 'system',
        ...(event.payload ?? {})
      },
      vmContextId: context.vmContext.id,
      modelVisible: false
    });
    this.onChange();
  }

  private recordLiveSubagentOutput(context: CreatedRunContext, event: HoneycrispLiveEvent): void {
    const payload = event.payload ?? {};
    const agentPath = stringPayload(payload, 'agentPath');
    const phase = stringPayload(payload, 'phase');
    const text = stringPayload(payload, 'text');
    if (!agentPath || agentPath === '/root' || phase !== 'completed' || !text) return;
    const responseId = stringPayload(payload, 'responseId') ?? `subagent:${agentPath}`;
    const itemId = stringPayload(payload, 'itemId') ?? 'text:0';
    const trace = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: `Honeycrisp subagent ${agentPath} responded.`,
      payload: {
        ...(event.payload ?? {}),
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp',
        transcriptKind: 'agent_output',
        responseId,
        itemId,
        live: true
      },
      vmContextId: context.vmContext.id
    });
    this.db.createTranscriptMessage({
      runId: context.run.id,
      attemptId: context.attempt.id,
      traceEventId: trace.id,
      role: 'assistant',
      contentMarkdown: text,
      source: 'honeycrisp',
      metadata: {
        agentId: stringPayload(payload, 'agentId'),
        agentPath,
        parentAgentId: stringPayload(payload, 'parentAgentId'),
        responseId,
        itemId,
        live: true
      }
    });
    this.onChange();
  }

  private recordLiveResearchSummary(context: CreatedRunContext, event: HoneycrispCaptureEvent): void {
    const summaryText = researchSummaryText(event);
    if (!summaryText) return;
    const payload = recordValue(event.payload);
    const itemId = event.id ?? `${event.kind ?? 'event'}:${event.timestamp ?? Date.now()}`;
    const trace = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: 'Honeycrisp progress summary.',
      payload: {
        text: summaryText,
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        transcriptKind: 'reasoning_summary',
        responseId: 'honeycrisp-progress',
        itemId,
        phase: 'progress',
        live: true,
        honeycrispEventId: event.id ?? null,
        honeycrispKind: event.kind ?? null,
        honeycrispTimestamp: event.timestamp ?? null,
        toolName: stringPayload(payload ?? {}, 'toolName') ?? null
      },
      vmContextId: context.vmContext.id
    });
    this.db.createTranscriptMessage({
      runId: context.run.id,
      attemptId: context.attempt.id,
      traceEventId: trace.id,
      role: 'assistant',
      contentMarkdown: summaryText,
      source: 'openai_reasoning_summary',
      metadata: {
        responseId: 'honeycrisp-progress',
        itemId,
        phase: 'progress',
        live: true,
        honeycrispEventId: event.id ?? null,
        honeycrispKind: event.kind ?? null,
        honeycrispTimestamp: event.timestamp ?? null,
        toolName: stringPayload(payload ?? {}, 'toolName') ?? null,
        fallback: true
      }
    });
  }

  private recordLiveReasoningSummary(context: CreatedRunContext, event: HoneycrispLiveEvent, active: ActiveHoneycrispRun | undefined): void {
    const payload = event.payload ?? {};
    const text = stringPayload(payload, 'text');
    const delta = stringPayload(payload, 'delta');
    const responseId = stringPayload(payload, 'responseId') ?? 'live-response';
    const itemId = stringPayload(payload, 'itemId') ?? `reasoning-summary:${responseId}`;
    const agentId = stringPayload(payload, 'agentId');
    const agentPath = stringPayload(payload, 'agentPath');
    const parentAgentId = stringPayload(payload, 'parentAgentId');
    const subagent = Boolean(agentPath && agentPath !== '/root');
    const key = `${agentPath ?? '/root'}\u0000${responseId}\u0000${itemId}`;
    const state =
      active?.liveReasoningSummaries.get(key) ?? {
        text: '',
        snapshotCount: 0
      };
    state.text = text ?? (delta ? `${state.text}${delta}` : state.text);
    const summaryText = state.text.trim();
    if (!summaryText) return;

    const phase = stringPayload(payload, 'phase') ?? 'delta';
    const shouldSnapshot = phase === 'completed' || state.snapshotCount === 0;
    active?.liveReasoningSummaries.set(key, state);
    if (!shouldSnapshot) return;

    state.snapshotCount += 1;
    const trace = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: subagent
        ? phase === 'completed'
          ? `Honeycrisp subagent ${agentPath} completed reasoning.`
          : `Honeycrisp subagent ${agentPath} reasoning.`
        : phase === 'completed'
          ? 'Honeycrisp completed reasoning.'
          : 'Honeycrisp reasoning.',
      payload: {
        text: summaryText,
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        transcriptKind: 'reasoning_summary',
        responseId,
        itemId,
        agentId,
        agentPath,
        parentAgentId,
        turn: numberPayload(payload, 'turn'),
        phase,
        live: true,
        snapshot: state.snapshotCount,
        provider: stringPayload(payload, 'provider') ?? null,
        model: stringPayload(payload, 'model') ?? null,
        redacted: payload.redacted === true
      },
      vmContextId: context.vmContext.id
    });
    this.db.createTranscriptMessage({
      runId: context.run.id,
      attemptId: context.attempt.id,
      traceEventId: trace.id,
      role: 'assistant',
      contentMarkdown: summaryText,
      source: 'openai_reasoning_summary',
      metadata: {
        responseId,
        itemId,
        agentId,
        agentPath,
        parentAgentId,
        phase,
        live: true,
        snapshot: state.snapshotCount,
        provider: stringPayload(payload, 'provider') ?? null,
        model: stringPayload(payload, 'model') ?? null
      }
    });
    this.onChange();
  }

  private finishClosedProcess(
    context: CreatedRunContext,
    capturePath: string,
    code: number | null,
    signal: NodeJS.Signals | null,
    active: ActiveHoneycrispRun
  ): void {
    const processPayload = { code, signal, capturePath, stopReason: active.stopReason };
    if (active.stopped) {
      const timeLimitReached = active.stopReason === 'time_limit';
      const stoppedSummary = timeLimitReached
        ? 'Honeycrisp host process stopped at the session time limit.'
        : 'Honeycrisp host process was stopped by Beale.';
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'vm_event',
        source: 'executor',
        summary: stoppedSummary,
        payload: processPayload,
        vmContextId: context.vmContext.id
      });
      this.db.updateAttemptState(context.attempt.id, 'stopped', stoppedSummary);
      this.db.updateRunStatus(context.run.id, 'stopped', stoppedSummary);
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
      const contextUsage = this.importCapture(context, capture, capturePath, captureText, active.liveHoneycrispEventIds);
      const summary = honeycrispCompletionSummary(capture);
      const completed = capture.agent?.status === 'complete';
      this.db.updateAttemptState(context.attempt.id, completed ? 'completed' : 'failed', summary);
      this.db.updateRunStatus(context.run.id, completed ? 'completed' : 'failed', summary);
      this.db.updateModelSessionByRun(context.run.id, {
        status: completed ? 'completed' : 'failed',
        metadata: {
          capturePath,
          agentStatus: capture.agent?.status ?? null,
          ...honeycrispAgentMetadata(capture),
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
    captureText: string,
    liveHoneycrispEventIds: ReadonlySet<string> = new Set()
  ): HoneycrispContextUsageSummary | null {
    const contextUsage = summarizeHoneycrispContextUsage(capture, captureText);
    const importedEventIds = new Set(liveHoneycrispEventIds);
    for (const traceEvent of this.db.getRunDetail(context.run.id).traceEvents) {
      const eventId = stringPayload(traceEvent.payload, 'honeycrispEventId');
      if (eventId) importedEventIds.add(eventId);
    }
    const captureArtifact = this.db.createArtifact({
      kind: 'honeycrisp_flow_capture',
      mimeType: 'application/json',
      sensitivity: 'internal',
      modelVisible: false,
      source: 'honeycrisp',
      metadata: {
        sourcePath: capturePath,
        capturedAt: capture.capturedAt ?? null,
        storageManifestPath: capture.storageManifest?.path ?? null,
        ...honeycrispAgentMetadata(capture),
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
        request: capture.request ?? null,
        agent: honeycrispAgentPayload(capture),
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
      summary: honeycrispAgentTraceSummary(capture),
      payload: {
        request: capture.request ?? null,
        agent: honeycrispAgentPayload(capture)
      },
      vmContextId: context.vmContext.id,
      modelVisible: false
    });

    for (const event of capture.eventTimeline ?? []) {
      if (event.id && importedEventIds.has(event.id)) continue;
      this.appendHoneycrispTimelineEvent(context, event);
    }

    for (const [kind, items] of Object.entries(capture.agent?.researchTrace ?? {})) {
      if (!Array.isArray(items)) continue;
      for (const item of items.filter(isHoneycrispTraceItem)) {
        this.db.appendTraceEvent({
          runId: context.run.id,
          attemptId: context.attempt.id,
          type: 'research_event',
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
    const nextPromptSuggestions = honeycrispNextPromptSuggestions(capture);
    if (assistantText) {
      const transcriptTrace = this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'model_message',
        source: 'model',
        summary: 'Honeycrisp produced a final run response.',
        payload: {
          outputText: assistantText,
          nextPromptSuggestions,
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
          executorName: capture.agent?.executorName ?? null,
          nextPromptSuggestions
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

  private appendHoneycrispTimelineEvent(context: CreatedRunContext, event: HoneycrispCaptureEvent): void {
    const mapped = mapHoneycrispEvent(event.kind);
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: mapped.type,
      source: mapped.source,
      summary: honeycrispEventSummary(event),
      payload: {
        agentId: event.agentId ?? null,
        agentPath: event.agentPath ?? null,
        parentAgentId: event.parentAgentId ?? null,
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

export function honeycrispProcessEnvironment(
  storage: { databasePath: string; artifactDirectoryPath: string } | null = null
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: process.env.NO_COLOR ?? '1' };
  if (storage) {
    env.HONEYCRISP_DATABASE_PATH = storage.databasePath;
    env.HONEYCRISP_ARTIFACT_DIRECTORY = storage.artifactDirectoryPath;
  }
  if (env.HONEYCRISP_CODEX_AUTH_FILE?.trim()) return env;

  const configured = process.env.BEALE_OPENAI_CODEX_AUTH_FILE?.trim();
  const candidate = configured
    ? configured.replace(/^~(?=$|\/)/, homedir())
    : join(homedir(), '.codex', 'auth.json');
  if (existsSync(candidate)) env.HONEYCRISP_CODEX_AUTH_FILE = candidate;
  return env;
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

function parseHoneycrispLiveEvent(line: string): HoneycrispLiveEvent | null {
  if (!line.startsWith(HONEYCRISP_EVENT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(line.slice(HONEYCRISP_EVENT_PREFIX.length)) as unknown;
    if (!isRecord(parsed)) return null;
    return {
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : undefined,
      kind: typeof parsed.kind === 'string' ? parsed.kind : undefined,
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
      payload: isRecord(parsed.payload) ? parsed.payload : undefined
    };
  } catch {
    return null;
  }
}

function honeycrispCaptureEventFromLiveEvent(event: HoneycrispLiveEvent): HoneycrispCaptureEvent | null {
  const payload = event.payload ?? {};
  const rawEvent = recordValue(payload.event);
  if (!rawEvent) return null;
  return {
    id: stringPayload(rawEvent, 'id') ?? undefined,
    sequence: numberPayload(rawEvent, 'sequence') ?? undefined,
    kind: stringPayload(rawEvent, 'kind') ?? undefined,
    timestamp: stringPayload(rawEvent, 'timestamp') ?? undefined,
    summary: stringPayload(rawEvent, 'summary') ?? undefined,
    payload: rawEvent.payload ?? null,
    artifactRefs: rawEvent.artifactRefs ?? null,
    agentId: stringPayload(payload, 'agentId') ?? undefined,
    agentPath: stringPayload(payload, 'agentPath') ?? undefined,
    parentAgentId: stringPayload(payload, 'parentAgentId') ?? undefined
  };
}

function honeycrispLiveEventSummary(event: HoneycrispLiveEvent): string {
  const payload = event.payload ?? {};
  if (event.kind === 'tool.progress') {
    const eventType = stringPayload(payload, 'eventType') ?? 'tool_execution';
    const toolName = stringPayload(payload, 'toolName') ?? 'tool';
    return `Honeycrisp ${eventType}: ${toolName}`;
  }
  if (event.kind === 'agent.event') {
    const eventType = stringPayload(payload, 'type') ?? 'agent_event';
    return `Honeycrisp ${eventType}`;
  }
  return `Honeycrisp live event: ${event.kind ?? 'unknown'}`;
}

function researchSummaryText(event: HoneycrispCaptureEvent): string {
  const payload = recordValue(event.payload);
  const summary = stringPayload(payload ?? {}, 'summary') ?? (typeof event.summary === 'string' ? event.summary.trim() : '');
  switch (event.kind) {
    case 'error.observed':
      return summary ? `**Issue** ${summary}` : '';
    default:
      return '';
  }
}

function stringPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberPayload(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function honeycrispRunArgs(
  input: StartRunInput,
  workspacePath: string,
  capturePath: string,
  workspaceContextPath: string,
  shellOptionsPath?: string,
  generateTitle = false
): string[] {
  const args = [
    '--workspace-root',
    workspacePath,
    '--capture',
    capturePath,
    '--workspace-context',
    workspaceContextPath,
    '--executor',
    'agent',
    '--event-stream',
    '--control-stream',
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
  const provider = process.env.BEALE_HONEYCRISP_PROVIDER?.trim() || input.provider?.trim();
  if (provider) {
    args.push('--provider', provider);
  }
  if (generateTitle) {
    const titleModel = sessionTitleModelForProvider(provider || 'openai-codex');
    if (titleModel) {
      args.push('--title-model', titleModel, '--title-effort', SESSION_TITLE_REASONING_EFFORT);
    }
  }
  if (input.model.trim()) {
    args.push('--model', input.model.trim());
  }
  if (input.reasoningEffort.trim()) {
    args.push('--effort', input.reasoningEffort.trim());
  }
  args.push('--tool-max-bytes', String(toolMaxBytes()));
  args.push(...bealeHoneycrispRuntimeArgs(shellOptionsPath));
  return args;
}

function startRunInputFromRun(run: RunRecord, promptMarkdown: string): StartRunInput {
  return {
    provider: typeof run.budget.modelProvider === 'string' ? run.budget.modelProvider : undefined,
    promptMarkdown,
    mode: run.mode,
    attemptStrategy: run.attemptStrategy,
    model: run.model,
    reasoningEffort: run.reasoningEffort,
    networkProfile: run.networkProfile,
    sandboxProfile: run.sandboxProfile,
    targetAssetId: run.targetAssetId,
    targetPath: run.targetPath,
    budget: {
      maxMinutes: finiteRecordNumber(run.budget, 'maxMinutes', 1),
      maxAttempts: finiteRecordNumber(run.budget, 'maxAttempts', 1),
      maxCostUsd: finiteRecordNumber(run.budget, 'maxCostUsd', 0)
    },
    runEngine: 'honeycrisp'
  };
}

function buildContinuationPrompt(run: RunRecord, messages: readonly TranscriptMessageRecord[], instruction: string): string {
  const originalRequest = run.promptMarkdown.trim().slice(0, CONTINUATION_CONTEXT_MAX_CHARS / 2);
  const priorTurns = messages
    .filter(isRootContinuationMessage)
    .map((message) => `${continuationMessageLabel(message)}:\n${message.contentMarkdown.trim()}`)
    .filter((message) => message.length > 0);
  const retainedTurns: string[] = [];
  let retainedChars = originalRequest.length;
  for (let index = priorTurns.length - 1; index >= 0; index -= 1) {
    const turn = priorTurns[index];
    if (!turn) continue;
    const remainingChars = CONTINUATION_CONTEXT_MAX_CHARS - retainedChars;
    if (remainingChars <= 0) break;
    if (turn.length > remainingChars) {
      retainedTurns.unshift(`[Earlier content omitted]\n${turn.slice(-remainingChars)}`);
      break;
    }
    retainedTurns.unshift(turn);
    retainedChars += turn.length;
  }
  return [
    '# Continue the existing Beale research session',
    '',
    'Continue from the prior session state below. Preserve its established facts, decisions, explored paths, and tool-backed observations. Do not restart the investigation or treat this as turn 1.',
    '',
    '## New steering instruction',
    instruction.trim(),
    '',
    '## Existing session context',
    `Original request:\n${originalRequest}`,
    ...(retainedTurns.length > 0 ? ['', ...retainedTurns] : [])
  ].join('\n');
}

function isRootContinuationMessage(message: TranscriptMessageRecord): boolean {
  if (message.source !== 'honeycrisp' && message.source !== 'user_steering' && message.source !== 'openai_reasoning_summary') {
    return false;
  }
  const agentPath = stringPayload(message.metadata, 'agentPath');
  return !agentPath || agentPath === '/root';
}

function continuationMessageLabel(message: TranscriptMessageRecord): string {
  if (message.source === 'openai_reasoning_summary') return 'Agent progress';
  return message.role === 'assistant' ? 'Agent' : message.role === 'system' ? 'System' : 'User';
}

function latestRootTurn(events: readonly TraceEventRecord[]): number {
  let latest = 0;
  for (const event of events) {
    const agentPath = stringPayload(event.payload, 'agentPath');
    if (agentPath && agentPath !== '/root') continue;
    const turn = numberPayload(event.payload, 'turn') ?? turnFromSummary(event.summary);
    if (turn && Number.isInteger(turn)) latest = Math.max(latest, turn);
  }
  return latest;
}

function turnFromSummary(summary: string): number | null {
  const match = summary.match(/\bturn\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function offsetRootTurn(event: HoneycrispLiveEvent, rootTurnOffset: number): HoneycrispLiveEvent {
  if (rootTurnOffset <= 0 || !event.payload) return event;
  const turn = numberPayload(event.payload, 'turn');
  if (!turn) return event;
  const agentPath = stringPayload(event.payload, 'agentPath');
  if (agentPath && agentPath !== '/root') return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      processTurn: turn,
      turn: rootTurnOffset + turn
    }
  };
}

function finiteRecordNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function signalHoneycrispProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): boolean {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // Fall through to signaling the direct child when no process group exists.
    }
  }
  return child.kill(signal);
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

export function invokeHoneycrispToolsList(workspacePath: string, shellOptionsPath?: string): Record<string, unknown> {
  const invocation = resolveHoneycrispInvocation();
  const fullArgs = [
    ...invocation.prefixArgs,
    'tools',
    'list',
    '--workspace-root',
    workspacePath,
    ...bealeHoneycrispRuntimeArgs(shellOptionsPath),
    '--json'
  ];
  const result = spawnSync(invocation.command, fullArgs, {
    cwd: invocation.cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? '1' },
    timeout: 30_000,
    windowsHide: true
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || 'Honeycrisp tools list failed.').trim();
    throw new Error(`Honeycrisp tooling discovery failed: ${detail}`);
  }
  return parseHoneycrispJsonCommandOutput(result.stdout, 'Honeycrisp tooling discovery');
}

export function invokeHoneycrispToolsConfig(workspacePath: string, args: readonly string[]): Record<string, unknown> {
  const invocation = resolveHoneycrispInvocation();
  const fullArgs = [
    ...invocation.prefixArgs,
    'tools',
    'config',
    ...args,
    '--workspace-root',
    workspacePath,
    '--json'
  ];
  const result = spawnSync(invocation.command, fullArgs, {
    cwd: invocation.cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? '1' },
    timeout: 15_000,
    windowsHide: true
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || 'Honeycrisp tools config failed.').trim();
    throw new Error(`Honeycrisp tooling configuration failed: ${detail}`);
  }
  return parseHoneycrispJsonCommandOutput(result.stdout, 'Honeycrisp tooling configuration');
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

function writeHoneycrispWorkspaceContext(
  scope: WorkspaceScopeVersion,
  workspacePath: string,
  contextPath: string,
  sessionId: string,
  workspaceId: string,
  networkProfile: string
): HoneycrispWorkspaceContextFile {
  const context = honeycrispWorkspaceContext(scope, workspacePath, sessionId, workspaceId, networkProfile);
  mkdirSync(dirname(contextPath), { recursive: true });
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
  return context;
}

function honeycrispWorkspaceContext(
  scope: WorkspaceScopeVersion,
  workspacePath: string,
  sessionId: string,
  workspaceId: string,
  networkProfile: string
): HoneycrispWorkspaceContextFile {
  const materializedSourcePaths: string[] = [];
  const knownRepositories: HoneycrispWorkspaceRepositoryContext[] = [];
  for (const asset of scope.assets) {
    if (asset.direction !== 'in_scope' || !isLocalResearchMaterialKind(asset.kind)) continue;
    const root = localRootForAsset(asset);
    if (!root) continue;
    if (!materializedSourcePaths.includes(root)) {
      materializedSourcePaths.push(root);
    }
    if ((asset.kind === 'repo' || asset.kind === 'path') && !knownRepositories.some((repository) => repository.rootPath === root)) {
      const repositoryUrl = stringAttribute(asset.attributes?.repositoryUrl);
      knownRepositories.push({
        rootPath: root,
        ...inferredRepositoryContentRoots(root),
        label: honeycrispAssetLabel(asset),
        role: 'materialized_source',
        source: 'beale',
        ...(repositoryUrl ? { repositoryUrl } : {}),
        ...(asset.attributes?.sourceStorage === 'user_global'
          ? { notes: ['User-global Beale source checkout referenced by this workspace. Research state remains workspace-local.'] }
          : {})
      });
    }
  }
  return {
    schemaVersion: 1,
    workspaceRoot: workspacePath,
    memoryTierContext: {
      sessionId,
      workspaceId,
      workspaceName: scope.workspaceName,
      ...(scope.scopeOwner.trim()
        ? {
            subjectId: honeycrispMemorySubjectId(scope.scopeOwner),
            subjectName: scope.scopeOwner.trim()
          }
        : {}),
    },
    ...(isRecordedWorkspaceScope(scope)
      ? {
          authorization: {
            recorded: true,
            source: 'beale',
            scopeId: scope.id,
            scopeName: scope.workspaceName,
            ...(scope.scopeOwner.trim() ? { scopeOwner: scope.scopeOwner } : {}),
            networkProfile,
            activeFrom: scope.activeFrom,
            ...(scope.expiresAt ? { expiresAt: scope.expiresAt } : {})
          }
        }
      : {}),
    knownRepositories,
    materializedSourcePaths,
    projectNotes: honeycrispScopeNotes(scope, networkProfile)
  };
}

const REPOSITORY_CONTENT_MARKERS = [
  'src',
  'Src',
  'Sources',
  'include',
  'lib',
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'CMakeLists.txt',
  'configure'
];

function inferredRepositoryContentRoots(rootPath: string): { contentRoots: string[] } | Record<string, never> {
  try {
    const children = readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .slice(0, 64);
    const contentRoots = children
      .filter((entry) => REPOSITORY_CONTENT_MARKERS.some((marker) => existsSync(join(rootPath, entry.name, marker))))
      .map((entry) => join(rootPath, entry.name))
      .slice(0, 8);
    return contentRoots.length > 0 ? { contentRoots } : {};
  } catch {
    return {};
  }
}

function honeycrispMemorySubjectId(subjectName: string): string {
  const normalized = subjectName.trim().replace(/\s+/g, ' ').toLowerCase();
  return `subject_${createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`;
}

function isLocalResearchMaterialKind(kind: ScopeAsset['kind']): boolean {
  return kind === 'repo' || kind === 'path' || kind === 'binary';
}

function honeycrispScopeNotes(scope: WorkspaceScopeVersion, networkProfile: string): string[] {
  const notes = [
    'Authorization: This is an operator-recorded authorized security research scope. Treat only explicitly in-scope assets as authorized; exclusions and constraints override research objectives.',
    scope.workspaceName.trim() ? `Scope: ${boundedContextText(scope.workspaceName)}` : '',
    scope.scopeOwner.trim() ? `Scope owner or subject: ${boundedContextText(scope.scopeOwner)}` : '',
    scope.rulesMarkdown.trim() ? `Rules and constraints: ${boundedContextText(scope.rulesMarkdown)}` : '',
    `Network access profile: ${boundedContextText(networkProfile)}`,
    scope.expiresAt ? `Authorization expiry or review date: ${scope.expiresAt}` : 'Authorization expiry or review date: no expiry recorded.',
    scope.descriptionMarkdown.trim() ? `Scope description: ${boundedContextText(scope.descriptionMarkdown)}` : ''
  ];
  const orderedAssets = [...scope.assets].sort((left, right) => Number(left.direction === 'in_scope') - Number(right.direction === 'in_scope'));
  for (const asset of orderedAssets.slice(0, 200)) {
    const instruction = stringAttribute(asset.attributes?.instruction);
    notes.push(
      `${asset.direction === 'in_scope' ? 'In scope' : 'Out of scope'} (${asset.kind}, ${asset.sensitivity}): ${honeycrispScopeAssetValue(asset)}` +
        (instruction ? ` — ${boundedContextText(instruction, 1_000)}` : '')
    );
  }
  if (scope.assets.length > 200) {
    notes.push(`Scope asset list truncated: ${scope.assets.length - 200} additional assets remain in Beale.`);
  }
  return notes.filter(Boolean);
}

function isRecordedWorkspaceScope(scope: WorkspaceScopeVersion): boolean {
  return (
    scope.workspaceName.trim() !== '' && scope.workspaceName !== 'Untitled Workspace'
  ) || Boolean(
    scope.scopeOwner.trim() ||
      scope.descriptionMarkdown.trim() ||
      scope.rulesMarkdown.trim() ||
      scope.assets.length > 0
  );
}

function honeycrispScopeAssetValue(asset: ScopeAsset): string {
  if (asset.kind === 'credential_ref') return '[host-held credential reference; value withheld from agent context]';
  return boundedContextText(asset.value, 1_000);
}

function boundedContextText(value: string, maxChars = 6_000): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function localRootForAsset(asset: ScopeAsset): string | null {
  const value = asset.value.trim();
  if (!isAbsolute(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || !existsSync(value)) {
    return null;
  }
  return localDirectoryRoot(value);
}

function localDirectoryRoot(value: string): string | null {
  if (!isAbsolute(value) || !existsSync(value)) {
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

function additionalHoneycrispRuntimeArgs(): string[] {
  return parseEnvArgs('BEALE_HONEYCRISP_RUNTIME_ARGS_JSON');
}

function bealeHoneycrispRuntimeArgs(shellOptionsPath?: string): string[] {
  return [
    ...additionalHoneycrispRuntimeArgs(),
    '--no-default-tool-config',
    '--tool-family',
    'shell',
    '--disable-tool-family',
    'repository-search',
    '--disable-tool-family',
    'file-read',
    '--disable-tool-family',
    'code',
    '--disable-tool-family',
    'analysis',
    '--disable-tool-family',
    'synthesis',
    '--disable-tool-family',
    'storage',
    '--disable-tool-family',
    'experiment',
    ...(shellOptionsPath ? ['--shell-options', shellOptionsPath] : [])
  ];
}

function redactHoneycrispArgs(args: string[]): string[] {
  const sensitiveFlags = new Set(['--config', '-p']);
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
      return { type: 'research_event', source: 'model' };
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

  if (reported && reported.usage.promptTokens !== null) {
    return {
      inputTokens: reported.usage.inputTokens ?? reported.usage.promptTokens,
      promptTokens: reported.usage.promptTokens,
      sessionPromptTokens: reported.usage.sessionPromptTokens ?? reported.usage.promptTokens,
      outputTokens: reported.usage.outputTokens,
      totalTokens: reported.usage.totalTokens ?? tokenTotalFromParts(reported.usage.promptTokens, reported.usage.outputTokens),
      cacheReadTokens: reported.usage.cacheReadTokens,
      cacheWriteTokens: reported.usage.cacheWriteTokens,
      cacheHitRate: reported.usage.cacheHitRate,
      source: HONEYCRISP_REPORTED_USAGE_SOURCE,
      estimated: false,
      reportedCallCount: reported.callCount,
      estimatedSerializedTokens
    };
  }

  if (reported && reported.usage.totalTokens !== null && estimatedSerializedTokens !== null) {
    return {
      inputTokens: estimatedSerializedTokens,
      promptTokens: estimatedSerializedTokens,
      sessionPromptTokens: reported.usage.sessionPromptTokens ?? estimatedSerializedTokens,
      outputTokens: reported.usage.outputTokens,
      totalTokens: reported.usage.totalTokens,
      cacheReadTokens: reported.usage.cacheReadTokens,
      cacheWriteTokens: reported.usage.cacheWriteTokens,
      cacheHitRate: reported.usage.cacheHitRate,
      source: HONEYCRISP_MIXED_USAGE_SOURCE,
      estimated: true,
      reportedCallCount: reported.callCount,
      estimatedSerializedTokens
    };
  }

  if (estimatedSerializedTokens !== null) {
    return {
      inputTokens: estimatedSerializedTokens,
      promptTokens: estimatedSerializedTokens,
      sessionPromptTokens: estimatedSerializedTokens,
      outputTokens: null,
      totalTokens: null,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitRate: null,
      source: HONEYCRISP_ESTIMATED_USAGE_SOURCE,
      estimated: true,
      reportedCallCount: 0,
      estimatedSerializedTokens
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
  let promptTokenTotal = 0;
  let latestPromptTokens: number | null = null;
  let cacheReadTokenTotal = 0;
  let cacheWriteTokenTotal = 0;
  let sawCacheTelemetry = false;

  for (const record of usageRecords) {
    const usage = normalizeTokenUsage(record);
    if (!usage) continue;
    if (usage.inputTokens !== null) latestInputTokens = usage.inputTokens;
    if (usage.promptTokens !== null) {
      latestPromptTokens = usage.promptTokens;
      promptTokenTotal += usage.promptTokens;
    }
    cacheReadTokenTotal += usage.cacheReadTokens;
    cacheWriteTokenTotal += usage.cacheWriteTokens;
    sawCacheTelemetry ||= usage.cacheHitRate !== null;
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
      promptTokens: latestPromptTokens,
      sessionPromptTokens: promptTokenTotal > 0 ? promptTokenTotal : null,
      outputTokens: sawOutputTokens ? outputTokenTotal : null,
      totalTokens: sawTotalTokens ? totalTokenTotal : null,
      cacheReadTokens: cacheReadTokenTotal,
      cacheWriteTokens: cacheWriteTokenTotal,
      cacheHitRate: sawCacheTelemetry && promptTokenTotal > 0 ? cacheReadTokenTotal / promptTokenTotal : null
    },
    callCount: usageRecords.length
  };
}

function collectHoneycrispUsageRecords(capture: HoneycrispFlowCapture): Record<string, unknown>[] {
  const raw = recordValue(capture.agent?.raw);
  const rootModelCallUsages = arrayRecordValues(raw?.modelCalls).flatMap((call) => {
    const usage = recordValue(call.usage);
    return usage ? [usage] : [];
  });
  const subagents = recordValue(raw?.subagents);
  const childModelCallUsages = arrayRecordValues(subagents?.agents).flatMap((agent) =>
    arrayRecordValues(agent.modelCalls).flatMap((call) => {
      const usage = recordValue(call.usage);
      return usage ? [usage] : [];
    })
  );
  if (rootModelCallUsages.length > 0 || childModelCallUsages.length > 0) {
    // Child usage contributes to session totals. Root calls remain last so the
    // context meter reflects the root agent's latest prompt size.
    return [...childModelCallUsages, ...rootModelCallUsages];
  }

  const rawUsage = recordValue(raw?.usage);
  if (rawUsage) return [rawUsage];

  return [capture.usage, capture.modelUsage, capture.tokenUsage].flatMap((value) => {
    const usage = recordValue(value);
    return usage ? [usage] : [];
  });
}

function normalizeTokenUsage(record: Record<string, unknown>): NormalizedTokenUsage | null {
  const inputTokens =
    nonNegativeNumberRecordValue(record, 'input_tokens') ??
    nonNegativeNumberRecordValue(record, 'inputTokens') ??
    nonNegativeNumberRecordValue(record, 'input');
  const outputTokens =
    nonNegativeNumberRecordValue(record, 'output_tokens') ??
    nonNegativeNumberRecordValue(record, 'completion_tokens') ??
    nonNegativeNumberRecordValue(record, 'outputTokens') ??
    nonNegativeNumberRecordValue(record, 'completionTokens') ??
    nonNegativeNumberRecordValue(record, 'output');
  const totalTokens = nonNegativeNumberRecordValue(record, 'total_tokens') ?? nonNegativeNumberRecordValue(record, 'totalTokens');
  const cacheReadTokens =
    positiveNumberRecordValue(record, 'cache_read_tokens') ??
    positiveNumberRecordValue(record, 'cached_tokens') ??
    positiveNumberRecordValue(record, 'cacheReadTokens') ??
    positiveNumberRecordValue(record, 'cacheRead') ??
    0;
  const cacheWriteTokens =
    positiveNumberRecordValue(record, 'cache_write_tokens') ??
    positiveNumberRecordValue(record, 'cacheWriteTokens') ??
    positiveNumberRecordValue(record, 'cacheWrite') ??
    0;
  const reportedPromptTokens =
    nonNegativeNumberRecordValue(record, 'prompt_tokens') ??
    nonNegativeNumberRecordValue(record, 'promptTokens');
  const promptTokens = reportedPromptTokens ?? (
    inputTokens !== null || cacheReadTokens > 0 || cacheWriteTokens > 0
      ? (inputTokens ?? 0) + cacheReadTokens + cacheWriteTokens
      : null
  );
  const reportedCacheHitRate =
    nonNegativeNumberRecordValue(record, 'cache_hit_rate') ??
    nonNegativeNumberRecordValue(record, 'cacheHitRate');
  const hasCacheTelemetry = [
    'cache_read_tokens',
    'cached_tokens',
    'cacheReadTokens',
    'cacheRead',
    'cache_write_tokens',
    'cacheWriteTokens',
    'cacheWrite',
    'cache_hit_rate',
    'cacheHitRate'
  ].some((key) => key in record);
  const cacheHitRate = reportedCacheHitRate ?? (
    hasCacheTelemetry && promptTokens && promptTokens > 0 ? cacheReadTokens / promptTokens : null
  );
  if (inputTokens === null && outputTokens === null && totalTokens === null && promptTokens === null) return null;
  return {
    inputTokens,
    promptTokens,
    sessionPromptTokens: promptTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheHitRate
  };
}

function reportedHoneycrispTraceUsage(usage: NormalizedTokenUsage): Record<string, unknown> {
  return {
    ...(usage.inputTokens !== null ? { input_tokens: usage.inputTokens } : {}),
    ...(usage.promptTokens !== null ? { prompt_tokens: usage.promptTokens } : {}),
    ...(usage.outputTokens !== null ? { output_tokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== null ? { total_tokens: usage.totalTokens } : {}),
    ...(usage.cacheHitRate !== null
      ? {
          cache_read_tokens: usage.cacheReadTokens,
          cache_write_tokens: usage.cacheWriteTokens,
          cache_hit_rate: usage.cacheHitRate
        }
      : {}),
    source: HONEYCRISP_REPORTED_USAGE_SOURCE,
    estimated: false
  };
}

function honeycrispTraceUsage(usage: HoneycrispContextUsageSummary): Record<string, unknown> {
  return {
    input_tokens: usage.inputTokens,
    prompt_tokens: usage.promptTokens,
    cache_prompt_tokens: usage.sessionPromptTokens,
    ...(usage.outputTokens !== null ? { output_tokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== null ? { total_tokens: usage.totalTokens } : {}),
    ...(usage.cacheHitRate !== null
      ? {
          cache_read_tokens: usage.cacheReadTokens,
          cache_write_tokens: usage.cacheWriteTokens,
          cache_hit_rate: usage.cacheHitRate
        }
      : {}),
    source: usage.source,
    estimated: usage.estimated,
    reportedCallCount: usage.reportedCallCount,
    estimatedSerializedTokens: usage.estimatedSerializedTokens
  };
}

function honeycrispContextUsageMetadata(usage: HoneycrispContextUsageSummary | null): Record<string, unknown> {
  if (!usage) return {};
  return {
    latestReportedInputTokens: usage.promptTokens,
    latestReportedTotalTokens: usage.totalTokens,
    latestCacheHitRate: usage.cacheHitRate,
    sessionCachePromptTokens: usage.sessionPromptTokens,
    latestContextUsageSource: usage.source,
    latestContextUsageEstimated: usage.estimated,
    latestContextUsageReportedCallCount: usage.reportedCallCount,
    latestEstimatedSerializedTokens: usage.estimatedSerializedTokens
  };
}

function honeycrispAgentMetadata(capture: HoneycrispFlowCapture): Record<string, unknown> {
  const raw = recordValue(capture.agent?.raw);
  const subagentRuntime = recordValue(raw?.subagents);
  const subagents = arrayRecordValues(subagentRuntime?.agents);
  return {
    honeycrispAgentRunId: capture.agent?.id ?? null,
    honeycrispAgentStatus: capture.agent?.status ?? null,
    honeycrispAgentStartedAt: capture.agent?.startedAt ?? null,
    honeycrispAgentCompletedAt: capture.agent?.completedAt ?? null,
    honeycrispRequestPrompt: capture.request?.prompt ?? null,
    honeycrispSubagentCount: subagents.length,
    honeycrispSubagentCompletedCount: subagents.filter((agent) => agent.status === 'completed').length,
    honeycrispSubagentFailedCount: subagents.filter((agent) => agent.status === 'errored').length,
    honeycrispSubagentMaxThreads: numberPayload(subagentRuntime ?? {}, 'maxThreads'),
    honeycrispSubagentMaxDepth: numberPayload(subagentRuntime ?? {}, 'maxDepth')
  };
}

function honeycrispAgentPayload(capture: HoneycrispFlowCapture): Record<string, unknown> {
  return {
    id: capture.agent?.id ?? null,
    status: capture.agent?.status ?? null,
    executorName: capture.agent?.executorName ?? null,
    startedAt: capture.agent?.startedAt ?? null,
    completedAt: capture.agent?.completedAt ?? null
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(recordValue(value));
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

function nonNegativeNumberRecordValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
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
  const status = capture.agent?.status ?? 'unknown';
  return status === 'complete' ? 'Honeycrisp completed the research session.' : `Honeycrisp process finished with agent status ${status}.`;
}

function renderHoneycrispAssistantMessage(capture: HoneycrispFlowCapture): string {
  return capture.agent?.outputText?.trim() ?? '';
}

function honeycrispNextPromptSuggestions(capture: HoneycrispFlowCapture): HoneycrispNextPromptSuggestion[] {
  const suggestions = capture.agent?.nextPromptSuggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions
    .map((suggestion) => ({
      title: typeof suggestion.title === 'string' ? suggestion.title.trim() : '',
      promptMarkdown: typeof suggestion.promptMarkdown === 'string' ? suggestion.promptMarkdown.trim() : '',
      rationale: typeof suggestion.rationale === 'string' ? suggestion.rationale.trim() : ''
    }))
    .filter((suggestion) => suggestion.title && suggestion.promptMarkdown)
    .slice(0, 3)
    .map((suggestion) => ({
      title: suggestion.title,
      promptMarkdown: suggestion.promptMarkdown,
      ...(suggestion.rationale ? { rationale: suggestion.rationale } : {})
    }));
}

function honeycrispAgentTraceSummary(capture: HoneycrispFlowCapture): string {
  const prompt = capture.request?.prompt?.trim();
  return prompt
    ? `Honeycrisp agent session: ${truncateSummary(prompt)}`
    : 'Honeycrisp agent session imported.';
}

function isHoneycrispTraceItem(value: unknown): value is HoneycrispTraceItem {
  return typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string';
}

function parseHoneycrispCapture(text: string): HoneycrispFlowCapture {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Honeycrisp capture was not a JSON object.');
  }
  if ((value as { schemaVersion?: unknown }).schemaVersion !== 4) {
    throw new Error('Honeycrisp capture must use schema version 4.');
  }
  return value as HoneycrispFlowCapture;
}

function readTextFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Honeycrisp capture was not written: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHoneycrispJsonCommandOutput(stdout: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (isJsonRecord(parsed)) return parsed;
  } catch {
    // Some package runners print a command banner before the CLI JSON.
  }
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
      if (isJsonRecord(parsed)) return parsed;
    } catch {
      // Fall through to the structured error below.
    }
  }
  throw new Error(`${label} returned non-JSON output: ${stdout.slice(0, 500)}`);
}

function truncateSummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= MAX_SUMMARY_CHARS ? normalized : `${normalized.slice(0, MAX_SUMMARY_CHARS - 1)}...`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}
