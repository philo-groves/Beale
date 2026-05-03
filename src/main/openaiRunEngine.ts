import { createHash } from 'node:crypto';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import {
  OpenAiResponsesAdapter,
  OpenAiApiError,
  type OpenAiProfilingRecorder,
  openAiApiErrorFromEvent,
  openAiErrorCode,
  type FunctionCallInputItem,
  type FunctionCallOutputItem,
  type OpenAiStreamEvent,
  type ResponseInputItem
} from './openaiAdapter';
import { OpenAiAuthService } from './openaiAuth';
import {
  contextCompactionRanges,
  evaluateOpenAiCompaction,
  inputTokensFromOpenAiEvent,
  isContextWindowError,
  openAiCompactionPolicyFromEnv,
  representedCompactionState,
  serializedInputBytes,
  type OpenAiCompactionDecision,
  type OpenAiReplayMode
} from './openaiCompaction';
import { buildCompactedReplayOpenAiInput, buildInitialOpenAiInput, buildOpenAiInstructions, buildResumeOpenAiInput } from './openaiContext';
import { bealeToolDefinitions, BealeToolRouter, type OpenAiFunctionCall } from './openaiTools';
import { isHostResearchSandbox } from './hostToolExecutor';
import { redactForModelText } from './redaction';
import type { ExecutorManager } from './executorManager';
import type { FakeScenario, ModelSessionRecord, OpenAiTransport, ProfilingMetricDetail, RunDetail, RunRecord, StartRunInput, TraceEventRecord } from '@shared/types';
import { generateSessionTitle } from '../shared/sessionTitle';

export interface OpenAiRunHandle {
  context: CreatedRunContext;
  completion: Promise<void>;
}

const DEFAULT_OPENAI_TOOL_TURN_LIMIT = 256;
const MAX_OPENAI_TOOL_TURN_LIMIT = 10_000;
const UNBOUNDED_RUN_MINUTES = 999_999;
const UNBOUNDED_RUN_ATTEMPTS = 999_999;
const OUTPUT_DELTA_TRACE_INTERVAL_MS = 1000;
const DEFAULT_OPENAI_TRANSPORT_RETRY_LIMIT = 2;
const DEFAULT_OPENAI_TRANSPORT_RETRY_DELAY_MS = 250;
const DEFAULT_OPENAI_CONTEXT_WINDOW_RETRY_LIMIT = 8;
const MAX_OPENAI_CONTEXT_WINDOW_RETRY_LIMIT = 32;

interface RunLoopState {
  responseInput: ResponseInputItem[];
  previousResponseId: string | null;
  manualConversationInput: ResponseInputItem[];
  previousResponseIdUnsupported: boolean;
  replayMode: OpenAiReplayMode;
}

interface StreamTraceState {
  lastOutputDeltaTraceAt: number;
  persistedTranscriptKeys: Set<string>;
  reasoningSummaryTextsByItemId: Map<string, string[]>;
}

export class OpenAiRunEngine {
  private readonly controllers = new Map<string, AbortController>();
  private readonly completions = new Map<string, Promise<void>>();
  private readonly pendingSteeringResumes = new Set<string>();

  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly auth: OpenAiAuthService,
    private readonly adapter: OpenAiResponsesAdapter,
    private readonly executor: ExecutorManager | null = null,
    private readonly onChange: () => void = () => undefined,
    private readonly profilingRecorder: OpenAiProfilingRecorder | null = null,
    private readonly onSourceMaterialized: (scopeVersionId: string, reason: string) => void = () => undefined
  ) {}

  public startRun(input: StartRunInput): OpenAiRunHandle {
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
      budget: { ...input.budget, runEngine: 'openai_responses' },
      vmBackend: isHostResearchSandbox(input.sandboxProfile) ? 'host' : undefined,
      vmImageId: isHostResearchSandbox(input.sandboxProfile) ? 'host-machine' : undefined,
      vmSnapshotId: isHostResearchSandbox(input.sandboxProfile) ? 'none' : undefined,
      vmState: isHostResearchSandbox(input.sandboxProfile) ? 'host_active' : undefined,
      vmMetadata: isHostResearchSandbox(input.sandboxProfile)
        ? {
            executor: 'host',
            targetExecution: true,
            hostExecutionDefault: true,
            vmRecommended: true,
            warning: 'Commands and executables run on the host machine for this session.'
          }
        : undefined
    });

    const status = this.auth.getStatus();
    const requestedTransport = this.adapter.getTransport();
    const transport: OpenAiTransport = requestedTransport;
    this.db.createModelSession({
      runId: context.run.id,
      provider: 'openai',
      transport,
      status: status.configured ? 'active' : 'blocked_auth',
      metadata: {
        authSource: status.source,
        requestedTransport,
        runtimeTransport: transport,
        supportsWebSocket: status.supportsWebSocket
      }
    });

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'user_note',
      source: 'user',
      summary: 'OpenAI Responses run started from markdown prompt.',
      payload: {
        mode: input.mode,
        attemptStrategy: input.attemptStrategy,
        runEngine: 'openai_responses',
        sandboxProfile: input.sandboxProfile,
        hostExecutionDefault: isHostResearchSandbox(input.sandboxProfile)
      }
    });
    if (isHostResearchSandbox(input.sandboxProfile)) {
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'approval_event',
        source: 'policy',
        summary: 'Session started with host execution sandbox warning.',
        payload: {
          sandboxProfile: input.sandboxProfile,
          hostExecutionDefault: true,
          warning: 'Commands and executables run on the host machine. A disposable VM is recommended.'
        },
        vmContextId: context.vmContext.id
      });
    }
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'system',
      summary: 'OpenAI adapter prepared host-only model session.',
      payload: {
        credentialsHostOnly: true,
        authConfigured: status.configured,
        authSource: status.source,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        transport,
        requestedTransport
      },
      vmContextId: context.vmContext.id
    });

    if (!status.configured) {
      this.db.updateAttemptState(context.attempt.id, 'blocked', 'Blocked: OpenAI host credential is not configured.');
      this.db.updateRunStatus(context.run.id, 'blocked', 'Blocked: OpenAI host credential is not configured.');
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'approval_event',
        source: 'policy',
        summary: 'OpenAI run blocked because no host credential is configured.',
        payload: {
          credentialHint: status.credentialHint,
          credentialsHostOnly: true
        }
      });
      this.onChange();
      return { context, completion: Promise.resolve() };
    }

    const controller = new AbortController();
    this.controllers.set(context.run.id, controller);
    const runInput = { ...input, targetAssetId: context.run.targetAssetId, targetPath: context.run.targetPath };
    const completion = this.runLoop(context, runInput, controller).finally(() => {
      this.controllers.delete(context.run.id);
      if (this.pendingSteeringResumes.delete(context.run.id)) {
        this.resumeRun(context.run.id);
        return;
      }
      this.onChange();
    });
    this.trackCompletion(context.run.id, completion);
    return { context, completion };
  }

  public resumeRun(runId: string): OpenAiRunHandle | null {
    const detail = this.db.getRunDetail(runId);
    if (detail.run.budget.runEngine !== 'openai_responses') {
      return null;
    }
    const attempt = detail.attempts[0];
    if (!attempt) {
      throw new Error(`OpenAI run has no attempt to resume: ${runId}`);
    }
    const vmContext = detail.vmContexts.find((context) => context.id === attempt.vmContextId) ?? detail.vmContexts[0];
    if (!vmContext) {
      throw new Error(`OpenAI run has no VM context to resume: ${runId}`);
    }

    const context: CreatedRunContext = { run: detail.run, attempt, vmContext };
    const input = startInputFromRun(detail.run);
    const status = this.auth.getStatus();
    const latestSession = detail.modelSessions.at(-1);
    if (!latestSession) {
      this.db.createModelSession({
        runId,
        provider: 'openai',
        transport: this.adapter.getTransport(),
        status: status.configured ? 'active' : 'blocked_auth',
        metadata: { resumedWithoutPriorSession: true }
      });
    }

    this.db.updateAttemptState(attempt.id, 'active', 'Resuming OpenAI Responses run.');
    this.db.updateRunStatus(runId, 'active', 'Resuming OpenAI Responses run.');

    if (!status.configured) {
      this.db.updateAttemptState(attempt.id, 'blocked', 'Blocked: OpenAI host credential is not configured.');
      this.db.updateRunStatus(runId, 'blocked', 'Blocked: OpenAI host credential is not configured.');
      this.db.updateModelSessionByRun(runId, { status: 'blocked_auth' });
      this.db.appendTraceEvent({
        runId,
        attemptId: attempt.id,
        type: 'approval_event',
        source: 'policy',
        summary: 'OpenAI run resume blocked because no host credential is configured.',
        payload: {
          credentialHint: status.credentialHint,
          credentialsHostOnly: true
        }
      });
      this.onChange();
      return { context, completion: Promise.resolve() };
    }

    const resumeState = buildResumeState(detail.modelSessions.at(-1), detail);
    this.db.updateModelSessionByRun(runId, {
      status: 'active',
      metadata: {
        resumeRequested: true,
        replayMode: resumeState.replayMode,
        pendingInput: resumeState.responseInput,
        runtimeTransport: this.adapter.getTransport()
      }
    });
    this.db.appendTraceEvent({
      runId,
      attemptId: attempt.id,
      type: 'model_message',
      source: 'system',
      summary:
        resumeState.replayMode === 'compacted_replay'
          ? 'OpenAI run resumed from compacted Beale replay context.'
          : 'OpenAI run resumed from persisted Responses state.',
      payload: {
        replayMode: resumeState.replayMode,
        previousResponseId: resumeState.previousResponseId,
        credentialsHostOnly: true
      },
      vmContextId: vmContext.id
    });

    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const completion = this.runLoop(context, input, controller, resumeState).finally(() => {
      this.controllers.delete(runId);
      if (this.pendingSteeringResumes.delete(runId)) {
        this.resumeRun(runId);
        return;
      }
      this.onChange();
    });
    this.trackCompletion(runId, completion);
    return { context, completion };
  }

  public steerRun(runId: string, instruction: string): OpenAiRunHandle | null {
    const detail = this.db.getRunDetail(runId);
    if (detail.run.budget.runEngine !== 'openai_responses') {
      return null;
    }
    const attempt = detail.attempts[0];
    if (!attempt) {
      throw new Error(`OpenAI run has no attempt to steer: ${runId}`);
    }
    const vmContext = detail.vmContexts.find((context) => context.id === attempt.vmContextId) ?? detail.vmContexts[0];
    if (!vmContext) {
      throw new Error(`OpenAI run has no VM context to steer: ${runId}`);
    }

    const state = buildSteeredRunState(detail.modelSessions.at(-1), detail, instruction);
    this.db.updateAttemptState(attempt.id, 'active', 'User steering added to OpenAI run.');
    this.db.updateRunStatus(runId, 'active', 'User steering added to OpenAI run.');
    this.db.updateModelSessionByRun(runId, {
      status: 'steering_requested',
      previousResponseId: state.previousResponseId,
      metadata: {
        pendingInput: state.responseInput,
        manualConversationInput: state.manualConversationInput,
        previousResponseIdUnsupported: state.previousResponseIdUnsupported,
        replayMode: state.replayMode,
        steeringInstruction: redactForModelText(instruction)
      }
    });

    const activeController = this.controllers.get(runId);
    if (activeController) {
      this.pendingSteeringResumes.add(runId);
      activeController.abort();
      return { context: { run: detail.run, attempt, vmContext }, completion: this.completions.get(runId) ?? Promise.resolve() };
    }

    return this.resumeRun(runId);
  }

  public pause(runId: string): void {
    this.controllers.get(runId)?.abort();
    this.controllers.delete(runId);
  }

  public stop(runId: string): void {
    this.pause(runId);
  }

  public dispose(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
    this.adapter.closeAllWebSocketSessions();
  }

  private trackCompletion(runId: string, completion: Promise<void>): void {
    this.completions.set(runId, completion);
    completion.finally(() => {
      if (this.completions.get(runId) === completion) {
        this.completions.delete(runId);
      }
    });
  }

  private async runLoop(context: CreatedRunContext, input: StartRunInput, controller: AbortController, state?: RunLoopState): Promise<void> {
    const router = new BealeToolRouter(this.db, this.executor, { onSourceMaterialized: this.onSourceMaterialized });
    let responseInput: ResponseInputItem[] = state?.responseInput ?? buildInitialOpenAiInput(input);
    let manualConversationInput: ResponseInputItem[] = state?.manualConversationInput ?? buildInitialOpenAiInput(input);
    let previousResponseId: string | null = state?.previousResponseId ?? null;
    let previousResponseIdUnsupported = state?.previousResponseIdUnsupported ?? this.adapter.usesManualConversationState();
    let replayMode = state?.replayMode ?? 'initial';
    let replayedAfterMissingPrevious = replayMode === 'compacted_replay';
    let contextWindowRetryAttempts = 0;
    let pendingContextWindowRecoveryTrace = false;
    let latestReportedInputTokens: number | null = null;
    let latestCompletedModelOutput: { text: string; traceEventId: string } | null = null;
    let transportRetryAttempts = 0;
    const maxToolTurns = openAiToolTurnLimit();
    const compactionPolicy = openAiCompactionPolicyFromEnv();
    const transportRetryLimit = openAiTransportRetryLimit();
    const contextWindowRetryLimit = openAiContextWindowRetryLimit();

    try {
      for (let turn = 0; turn < maxToolTurns; turn += 1) {
        const compactionDecision = evaluateOpenAiCompaction({
          replayMode,
          previousResponseIdUnsupported,
          manualConversationInput,
          latestReportedInputTokens,
          policy: compactionPolicy
        });
        if (compactionDecision) {
          const compacted = this.compactReplayContext(context, compactionDecision, replayMode, compactionPolicy.recentModelVisibleEventLimit);
          responseInput = compacted.responseInput;
          manualConversationInput = compacted.manualConversationInput;
          previousResponseId = null;
          replayMode = 'compacted_replay';
          latestReportedInputTokens = null;
          this.onChange();
        }

        const requestPreviousResponseId = previousResponseIdUnsupported ? null : previousResponseId;
        this.db.updateModelSessionByRun(context.run.id, {
          status: 'active',
          metadata: {
            pendingInput: responseInput,
            manualConversationInput,
            previousResponseIdUnsupported,
            replayMode,
            turn: turn + 1
          }
        });
        const scope = this.db.getActiveScope();
        const body = this.adapter.buildRequest({
          model: input.model,
          instructions: buildOpenAiInstructions(scope, input),
          input: responseInput,
          tools: bealeToolDefinitions(),
          reasoning: { effort: input.reasoningEffort },
          text: { verbosity: 'low' },
          previous_response_id: requestPreviousResponseId,
          metadata: {
            beale_run_id: context.run.id,
            beale_attempt_id: context.attempt.id,
            beale_workspace_scope_version: scope.id
          }
        });

        this.db.appendTraceEvent({
          runId: context.run.id,
          attemptId: context.attempt.id,
          type: 'model_message',
          source: 'system',
          summary: `OpenAI Responses request sent for turn ${turn + 1}.`,
          payload: {
            model: body.model,
            reasoning: body.reasoning,
            toolCount: body.tools.length,
            previousResponseId: requestPreviousResponseId,
            store: body.store,
            stream: body.stream,
            transport: this.adapter.getTransport(),
            replayMode
          },
          vmContextId: context.vmContext.id
        });
        this.onChange();

        const functionCalls: OpenAiFunctionCall[] = [];
        const streamTraceState: StreamTraceState = { lastOutputDeltaTraceAt: 0, persistedTranscriptKeys: new Set(), reasoningSummaryTextsByItemId: new Map() };
        latestCompletedModelOutput = null;
        let streamEventSeen = false;
        let streamRetrySafe = true;
        try {
          for await (const event of this.adapter.streamResponse({ body, signal: controller.signal })) {
            streamEventSeen = true;
            if (event.type !== 'response.created') {
              streamRetrySafe = false;
            }
            const persistedTraceEvents = this.handleStreamEvent(context, event, functionCalls, streamTraceState);
            for (const persistedTraceEvent of persistedTraceEvents) {
              const transcript = this.recordTranscriptFromTraceEvent(context, persistedTraceEvent, event, streamTraceState);
              if (transcript?.source === 'openai_response_output') {
                latestCompletedModelOutput = { text: transcript.text, traceEventId: persistedTraceEvent.id };
              }
            }
            let updatedModelSession = false;
            const eventResponseId = responseIdFromEvent(event);
            if (eventResponseId && event.type === 'response.completed') {
              previousResponseId = previousResponseIdUnsupported ? null : eventResponseId;
              latestReportedInputTokens = inputTokensFromOpenAiEvent(event) ?? latestReportedInputTokens;
              this.db.updateModelSessionByRun(context.run.id, {
                previousResponseId,
                metadata: { lastResponseId: eventResponseId, lastEventType: event.type, previousResponseIdUnsupported, latestReportedInputTokens }
              });
              updatedModelSession = true;
            }
            if (persistedTraceEvents.length > 0 || updatedModelSession) {
              this.onChange();
            }
          }
          transportRetryAttempts = 0;
          if (pendingContextWindowRecoveryTrace) {
            pendingContextWindowRecoveryTrace = false;
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'system',
              summary: 'OpenAI compacted retry recovered from context window pressure.',
              payload: {
                replayMode: 'compacted_replay',
                recovered: true
              },
              vmContextId: context.vmContext.id
            });
            this.onChange();
          }
        } catch (error) {
          if (isRetryableOpenAiTransportError(error) && streamRetrySafe && !controller.signal.aborted && transportRetryAttempts < transportRetryLimit) {
            transportRetryAttempts += 1;
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'system',
              summary: 'OpenAI transport error was retryable; retrying request.',
              payload: {
                error: errorMessage(error),
                retryAttempt: transportRetryAttempts,
                retryLimit: transportRetryLimit,
                streamEventSeen,
                retryAfterResponseCreatedOnly: streamEventSeen,
                replayMode
              },
              vmContextId: context.vmContext.id
            });
            this.onChange();
            await sleep(openAiTransportRetryDelayMs(transportRetryAttempts));
            turn -= 1;
            continue;
          }
          if (openAiErrorCode(error) === 'previous_response_not_found' && previousResponseId && !replayedAfterMissingPrevious) {
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'system',
              summary: 'OpenAI previous response state was unavailable; retrying with compacted Beale replay context.',
              payload: {
                previousResponseId,
                replayMode: 'compacted_replay',
                store: body.store
              },
              vmContextId: context.vmContext.id
            });
            const compacted = this.compactReplayContext(
              context,
              {
                reason: 'previous_response_not_found',
                tokenPressure: { previousResponseId, store: body.store },
                serializedSizeBytes: serializedInputBytes(manualConversationInput)
              },
              replayMode,
              compactionPolicy.recentModelVisibleEventLimit
            );
            responseInput = compacted.responseInput;
            previousResponseId = null;
            replayMode = 'compacted_replay';
            replayedAfterMissingPrevious = true;
            manualConversationInput = compacted.manualConversationInput;
            latestReportedInputTokens = null;
            this.db.updateModelSessionByRun(context.run.id, {
              previousResponseId: null,
              metadata: {
                pendingInput: responseInput,
                manualConversationInput,
                replayMode,
                previousResponseRecovery: 'compacted_replay'
              }
            });
            continue;
          }
          if (isPreviousResponseIdUnsupported(error) && previousResponseId && !previousResponseIdUnsupported) {
            const rejectedPreviousResponseId = previousResponseId;
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'system',
              summary: 'OpenAI backend rejected previous_response_id; retrying with compacted Beale replay context.',
              payload: {
                previousResponseId,
                replayMode: 'compacted_replay',
                store: body.store
              },
              vmContextId: context.vmContext.id
            });
            previousResponseIdUnsupported = true;
            previousResponseId = null;
            const compacted = this.compactReplayContext(
              context,
              {
                reason: 'previous_response_id_unsupported',
                tokenPressure: { previousResponseId: rejectedPreviousResponseId, store: body.store },
                serializedSizeBytes: serializedInputBytes(manualConversationInput)
              },
              replayMode,
              compactionPolicy.recentModelVisibleEventLimit
            );
            responseInput = compacted.responseInput;
            manualConversationInput = compacted.manualConversationInput;
            replayMode = 'compacted_replay';
            latestReportedInputTokens = null;
            this.db.updateModelSessionByRun(context.run.id, {
              previousResponseId: null,
              metadata: {
                pendingInput: responseInput,
                manualConversationInput,
                previousResponseIdUnsupported,
                replayMode,
                previousResponseRecovery: 'compacted_replay'
              }
            });
            continue;
          }
          if (isContextWindowError(error) && contextWindowRetryAttempts < contextWindowRetryLimit) {
            contextWindowRetryAttempts += 1;
            const recentEventLimit = recentEventLimitForContextWindowRetry(compactionPolicy.recentModelVisibleEventLimit, contextWindowRetryAttempts);
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'system',
              summary: 'OpenAI context window pressure triggered compacted retry.',
              payload: {
                error: errorMessage(error),
                replayMode,
                retryAttempted: true,
                retryAttempt: contextWindowRetryAttempts,
                retryLimit: contextWindowRetryLimit,
                recentModelVisibleEventLimit: recentEventLimit
              },
              vmContextId: context.vmContext.id
            });
            const compacted = this.compactReplayContext(
              context,
              {
                reason: 'context_window_error',
                tokenPressure: { error: errorMessage(error), latestReportedInputTokens },
                serializedSizeBytes: serializedInputBytes(manualConversationInput)
              },
              replayMode,
              recentEventLimit,
              true
            );
            responseInput = compacted.responseInput;
            manualConversationInput = compacted.manualConversationInput;
            previousResponseId = null;
            replayMode = 'compacted_replay';
            latestReportedInputTokens = null;
            pendingContextWindowRecoveryTrace = true;
            this.onChange();
            continue;
          }
          throw error;
        }

        if (functionCalls.length === 0) {
          if (latestCompletedModelOutput) {
            this.db.createNotification({
              runId: context.run.id,
              traceEventId: latestCompletedModelOutput.traceEventId,
              kind: 'session_final_response',
              title: context.run.title,
              bodyMarkdown: latestCompletedModelOutput.text
            });
          }
          this.db.updateAttemptState(context.attempt.id, 'completed', 'OpenAI run completed without additional tool requests.');
          this.db.updateRunStatus(context.run.id, 'completed', 'OpenAI run completed.');
          this.db.updateModelSessionByRun(context.run.id, { status: 'completed', metadata: { completed: true, pendingInput: [] } });
          this.db.updateVmState(context.vmContext.id, 'destroyed');
          this.adapter.closeWebSocketSession(context.run.id);
          return;
        }

        const toolOutputs: FunctionCallOutputItem[] = [];
        for (const call of functionCalls) {
          const startedAt = performance.now();
          try {
            toolOutputs.push(await router.executeAsync(context, call));
          } finally {
            this.recordProfilingTiming('openai.tool.execute', performance.now() - startedAt, {
              run: context.run.id,
              tool: call.name,
              calls: functionCalls.length,
              sandboxProfile: context.run.sandboxProfile
            });
          }
          this.onChange();
          await yieldImmediate();
        }
        manualConversationInput = [...manualConversationInput, ...functionCalls.map(functionCallInputItem), ...toolOutputs];
        if (previousResponseIdUnsupported) {
          responseInput = manualConversationInput;
          previousResponseId = null;
          replayMode = 'manual_response_replay';
        } else {
          responseInput = toolOutputs;
          replayMode = 'previous_response';
        }
        this.db.updateModelSessionByRun(context.run.id, {
          metadata: {
            pendingInput: responseInput,
            manualConversationInput,
            pendingToolOutputCount: toolOutputs.length,
            previousResponseIdUnsupported,
            replayMode
          }
        });
      }

      this.db.updateAttemptState(context.attempt.id, 'paused', 'Paused after OpenAI internal safety turn limit was reached.');
      this.db.updateRunStatus(context.run.id, 'paused', 'Paused after OpenAI internal safety turn limit was reached.');
      this.db.updateModelSessionByRun(context.run.id, {
        status: 'paused_safety_turn_limit',
        metadata: { maxToolTurns, pendingInput: responseInput, manualConversationInput, previousResponseIdUnsupported, replayMode }
      });
      this.adapter.closeWebSocketSession(context.run.id);
    } catch (error) {
      if (controller.signal.aborted) {
        this.db.updateAttemptState(context.attempt.id, 'paused', 'Paused by user steering.');
        this.db.updateRunStatus(context.run.id, 'paused', 'Paused by user steering.');
        this.db.updateModelSessionByRun(context.run.id, { status: 'paused' });
        this.adapter.closeWebSocketSession(context.run.id);
        return;
      }
      this.db.updateAttemptState(context.attempt.id, 'failed', 'OpenAI Responses run failed.');
      this.db.updateRunStatus(context.run.id, 'failed', 'OpenAI Responses run failed.');
      this.db.updateModelSessionByRun(context.run.id, { status: 'failed', metadata: { error: errorMessage(error) } });
      this.adapter.closeWebSocketSession(context.run.id);
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'model_message',
        source: 'system',
        summary: 'OpenAI Responses run failed.',
        payload: {
          error: errorMessage(error)
        }
      });
    }
  }

  private compactReplayContext(
    context: CreatedRunContext,
    decision: OpenAiCompactionDecision,
    previousReplayMode: OpenAiReplayMode,
    recentEventLimit: number,
    followedApiFailure = false
  ): { responseInput: ResponseInputItem[]; manualConversationInput: ResponseInputItem[] } {
    const detail = this.db.getRunDetail(context.run.id);
    const previousCompaction = detail.contextCompactions.at(-1) ?? null;
    const responseInput = buildCompactedReplayOpenAiInput(detail, {
      reason: decision.reason,
      previousCompaction,
      recentEventLimit
    });
    const ranges = contextCompactionRanges(detail, recentEventLimit);
    const compaction = this.db.createContextCompaction({
      runId: context.run.id,
      attemptId: context.attempt.id,
      previousCompactionId: previousCompaction?.id ?? null,
      reason: decision.reason,
      previousReplayMode,
      newReplayMode: 'compacted_replay',
      traceRangeSummarized: ranges.summarized,
      traceRangeKept: ranges.kept,
      traceHighWaterMark: ranges.highWaterMark,
      tokenPressure: decision.tokenPressure,
      serializedSizeBytes: decision.serializedSizeBytes,
      redactionPolicyVersion: openAiCompactionPolicyFromEnv().redactionPolicyVersion,
      summarySource: 'deterministic_beale_state',
      representedState: representedCompactionState(detail),
      compactedInput: { input: responseInput }
    });
    const traceEvent = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'system',
      summary: 'Context compacted for long-running session.',
      payload: {
        compactionId: compaction.id,
        previousCompactionId: compaction.previousCompactionId,
        reason: decision.reason,
        previousReplayMode,
        newReplayMode: 'compacted_replay',
        traceRangeSummarized: ranges.summarized,
        traceRangeKept: ranges.kept,
        traceHighWaterMark: ranges.highWaterMark,
        tokenPressure: decision.tokenPressure,
        serializedSizeBytes: decision.serializedSizeBytes,
        summarySource: 'deterministic_beale_state',
        redactionPolicyVersion: compaction.redactionPolicyVersion,
        followedApiFailure
      },
      vmContextId: context.vmContext.id
    });
    this.db.setContextCompactionTrace(compaction.id, traceEvent.id);
    this.db.updateModelSessionByRun(context.run.id, {
      previousResponseId: null,
      metadata: {
        pendingInput: responseInput,
        manualConversationInput: responseInput,
        replayMode: 'compacted_replay',
        latestCompactionId: compaction.id,
        latestCompactionReason: decision.reason
      }
    });
    return { responseInput, manualConversationInput: responseInput };
  }

  private handleStreamEvent(context: CreatedRunContext, event: OpenAiStreamEvent, functionCalls: OpenAiFunctionCall[], streamTraceState: StreamTraceState): TraceEventRecord[] {
    switch (event.type) {
      case 'response.created':
        return [
          this.db.appendTraceEvent({
            runId: context.run.id,
            attemptId: context.attempt.id,
            type: 'model_message',
            source: 'system',
            summary: 'OpenAI response created.',
            payload: summarizeEvent(event)
          })
        ];
      case 'response.output_text.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        const now = Date.now();
        if (delta.trim().length > 0 && now - streamTraceState.lastOutputDeltaTraceAt >= OUTPUT_DELTA_TRACE_INTERVAL_MS) {
          streamTraceState.lastOutputDeltaTraceAt = now;
          return [
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'model',
              summary: 'OpenAI streamed model output delta.',
              payload: {
                delta,
                claimStatus: 'model_claim'
              },
              vmContextId: context.vmContext.id
            })
          ];
        }
        return [];
      }
      case 'response.output_text.done': {
        const text = typeof event.text === 'string' ? event.text : '';
        const key = transcriptKeyFromEvent(event, 'agent_output', text);
        if (text.trim() && streamTraceState.persistedTranscriptKeys.has(key)) return [];
        return [
          this.db.appendTraceEvent({
            runId: context.run.id,
            attemptId: context.attempt.id,
            type: 'model_message',
            source: 'model',
            summary: text ? summarizeText(text) : 'OpenAI completed a model output item.',
            payload: {
              text,
              claimStatus: 'model_claim',
              transcriptKind: 'agent_output',
              transcriptKey: key,
              responseId: responseIdFromEvent(event),
              itemId: stringEventValue(event, 'item_id'),
              outputIndex: primitiveEventValue(event, 'output_index'),
              contentIndex: primitiveEventValue(event, 'content_index')
            },
            vmContextId: context.vmContext.id
          })
        ];
      }
      case 'response.reasoning_summary_text.done':
      case 'response.reasoning_summary.done': {
        const text = streamReasoningSummaryText(event);
        if (!text) return [];
        const key = transcriptKeyFromEvent(event, 'reasoning_summary', text);
        if (streamTraceState.persistedTranscriptKeys.has(key)) return [];
        rememberReasoningSummary(streamTraceState, stringEventValue(event, 'item_id'), text);
        return [
          this.db.appendTraceEvent({
            runId: context.run.id,
            attemptId: context.attempt.id,
            type: 'model_message',
            source: 'model',
            summary: 'OpenAI completed thought.',
            payload: {
              text,
              claimStatus: 'reasoning_summary',
              transcriptKind: 'reasoning_summary',
              transcriptKey: key,
              responseId: responseIdFromEvent(event),
              itemId: stringEventValue(event, 'item_id'),
              outputIndex: primitiveEventValue(event, 'output_index'),
              summaryIndex: primitiveEventValue(event, 'summary_index')
            },
            vmContextId: context.vmContext.id
          })
        ];
      }
      case 'response.function_call_arguments.done':
      case 'response.output_item.done': {
        const call = functionCallFromEvent(event);
        if (call && !functionCalls.some((existing) => existing.callId === call.callId)) {
          functionCalls.push(call);
          return [
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'tool_call',
              source: 'model',
              summary: `OpenAI completed function call arguments for ${call.name}.`,
              payload: {
                openaiCallId: call.callId,
                responseItemId: call.responseItemId ?? null,
                toolName: call.name,
                arguments: parseFunctionArguments(call.argumentsJson)
              },
              vmContextId: context.vmContext.id
            })
          ];
        }

        const item = eventItemRecord(event);
        const messageText = item ? outputTextFromMessageItem(item) : '';
        if (messageText) {
          const key = transcriptKeyFromOutputItem(event, 'agent_output', messageText);
          if (streamTraceState.persistedTranscriptKeys.has(key)) return [];
          return [
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'model',
              summary: summarizeText(messageText),
              payload: {
                text: messageText,
                claimStatus: 'model_claim',
                transcriptKind: 'agent_output',
                transcriptKey: key,
                responseId: responseIdFromEvent(event),
                itemId: item && typeof item.id === 'string' ? item.id : stringEventValue(event, 'item_id'),
                outputIndex: primitiveEventValue(event, 'output_index')
              },
              vmContextId: context.vmContext.id
            })
          ];
        }

        const reasoningSummary = item ? reasoningSummaryTextFromItem(item) : '';
        if (reasoningSummary) {
          const itemId = item && typeof item.id === 'string' ? item.id : stringEventValue(event, 'item_id');
          if (shouldSkipAggregateReasoningSummary(streamTraceState, itemId, reasoningSummary)) return [];
          const key = transcriptKeyFromOutputItem(event, 'reasoning_summary', reasoningSummary);
          if (streamTraceState.persistedTranscriptKeys.has(key)) return [];
          rememberReasoningSummary(streamTraceState, itemId, reasoningSummary);
          return [
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'model',
              summary: 'OpenAI completed thought.',
              payload: {
                text: reasoningSummary,
                claimStatus: 'reasoning_summary',
                transcriptKind: 'reasoning_summary',
                transcriptKey: key,
                responseId: responseIdFromEvent(event),
                itemId: item && typeof item.id === 'string' ? item.id : stringEventValue(event, 'item_id'),
                outputIndex: primitiveEventValue(event, 'output_index')
              },
              vmContextId: context.vmContext.id
            })
          ];
        }
        return [];
      }
      case 'response.completed': {
        const completed = this.db.appendTraceEvent({
          runId: context.run.id,
          attemptId: context.attempt.id,
          type: 'model_message',
          source: 'system',
          summary: 'OpenAI response completed.',
          payload: summarizeEvent(event)
        });
        return [completed, ...this.completedResponseTranscriptTraceEvents(context, event, streamTraceState)];
      }
      case 'error':
        throw openAiApiErrorFromEvent(event);
      default:
        return [];
    }
  }

  private completedResponseTranscriptTraceEvents(context: CreatedRunContext, event: OpenAiStreamEvent, streamTraceState: StreamTraceState): TraceEventRecord[] {
    const response = event.response;
    if (!response || typeof response !== 'object' || Array.isArray(response)) return [];
    const output = (response as Record<string, unknown>).output;
    if (!Array.isArray(output)) return [];

    const events: TraceEventRecord[] = [];
    const seenKeys = new Set(streamTraceState.persistedTranscriptKeys);
    for (const item of output) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const messageText = outputTextFromMessageItem(record);
      if (messageText) {
        const key = transcriptKeyFromResponseItem(event, record, 'agent_output', messageText);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          events.push(
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'model',
              summary: summarizeText(messageText),
              payload: {
                text: messageText,
                claimStatus: 'model_claim',
                transcriptKind: 'agent_output',
                transcriptKey: key,
                responseId: responseIdFromEvent(event),
                itemId: typeof record.id === 'string' ? record.id : null
              },
              vmContextId: context.vmContext.id
            })
          );
        }
      }

      const reasoningSummary = reasoningSummaryTextFromItem(record);
      if (reasoningSummary) {
        const itemId = typeof record.id === 'string' ? record.id : null;
        if (shouldSkipAggregateReasoningSummary(streamTraceState, itemId, reasoningSummary)) continue;
        const key = transcriptKeyFromResponseItem(event, record, 'reasoning_summary', reasoningSummary);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          rememberReasoningSummary(streamTraceState, itemId, reasoningSummary);
          events.push(
            this.db.appendTraceEvent({
              runId: context.run.id,
              attemptId: context.attempt.id,
              type: 'model_message',
              source: 'model',
              summary: 'OpenAI completed thought.',
              payload: {
                text: reasoningSummary,
                claimStatus: 'reasoning_summary',
                transcriptKind: 'reasoning_summary',
                transcriptKey: key,
                responseId: responseIdFromEvent(event),
                itemId: typeof record.id === 'string' ? record.id : null
              },
              vmContextId: context.vmContext.id
            })
          );
        }
      }
    }

    return events;
  }

  private recordTranscriptFromTraceEvent(
    context: CreatedRunContext,
    traceEvent: TraceEventRecord,
    streamEvent: OpenAiStreamEvent,
    streamTraceState: StreamTraceState
  ): { source: string; text: string } | null {
    if (traceEvent.source !== 'model' || traceEvent.type !== 'model_message') return null;
    const text = stringPayloadValue(traceEvent.payload, 'text').trim();
    if (!text) return null;

    const transcriptKind = stringPayloadValue(traceEvent.payload, 'transcriptKind') || 'agent_output';
    const source = transcriptKind === 'reasoning_summary' ? 'openai_reasoning_summary' : 'openai_response_output';
    const key = stringPayloadValue(traceEvent.payload, 'transcriptKey') || `${source}:${traceEvent.id}`;
    if (streamTraceState.persistedTranscriptKeys.has(key)) return null;
    streamTraceState.persistedTranscriptKeys.add(key);

    this.db.createTranscriptMessage({
      runId: context.run.id,
      attemptId: context.attempt.id,
      traceEventId: traceEvent.id,
      role: 'assistant',
      contentMarkdown: text,
      source,
      metadata: {
        responseId: stringPayloadValue(traceEvent.payload, 'responseId') || responseIdFromEvent(streamEvent),
        eventType: streamEvent.type,
        transcriptKind,
        itemId: traceEvent.payload.itemId ?? null,
        outputIndex: traceEvent.payload.outputIndex ?? null,
        contentIndex: traceEvent.payload.contentIndex ?? null,
        summaryIndex: traceEvent.payload.summaryIndex ?? null,
        claimStatus: stringPayloadValue(traceEvent.payload, 'claimStatus') || 'model_claim'
      }
    });

    return { source, text };
  }

  private recordProfilingTiming(name: string, durationMs: number, detail: ProfilingMetricDetail): void {
    this.profilingRecorder?.(name, Math.round(durationMs * 10) / 10, detail);
  }
}

function buildResumeState(session: ModelSessionRecord | undefined, detail: RunDetail): RunLoopState {
  const pendingInput = responseInputFromMetadata(session?.metadata.pendingInput);
  const manualConversationInput = responseInputFromMetadata(session?.metadata.manualConversationInput);
  const previousResponseIdUnsupported = session?.metadata.previousResponseIdUnsupported === true;
  if (pendingInput) {
    return {
      responseInput: pendingInput,
      previousResponseId: session?.previousResponseId ?? null,
      manualConversationInput: manualConversationInput ?? pendingInput,
      previousResponseIdUnsupported,
      replayMode: 'pending_input'
    };
  }
  if (session?.previousResponseId && !previousResponseIdUnsupported) {
    return {
      responseInput: buildResumeOpenAiInput(detail),
      previousResponseId: session.previousResponseId,
      manualConversationInput: manualConversationInput ?? buildInitialOpenAiInput(startInputFromRun(detail.run)),
      previousResponseIdUnsupported,
      replayMode: 'previous_response'
    };
  }
  const responseInput = buildCompactedReplayOpenAiInput(detail, {
    reason: 'resume_without_provider_state',
    previousCompaction: detail.contextCompactions.at(-1) ?? null
  });
  return {
    responseInput,
    previousResponseId: null,
    manualConversationInput: responseInput,
    previousResponseIdUnsupported,
    replayMode: 'compacted_replay'
  };
}

function buildSteeredRunState(session: ModelSessionRecord | undefined, detail: RunDetail, instruction: string): RunLoopState {
  const base = buildResumeState(session, detail);
  const steeringInput = userSteeringInput(instruction, detail);
  const canUsePreviousResponseState = Boolean(base.previousResponseId && !base.previousResponseIdUnsupported);

  return {
    responseInput: canUsePreviousResponseState ? steeringInput : [...base.responseInput, ...steeringInput],
    previousResponseId: base.previousResponseId,
    manualConversationInput: [...base.manualConversationInput, ...steeringInput],
    previousResponseIdUnsupported: base.previousResponseIdUnsupported,
    replayMode: canUsePreviousResponseState ? 'previous_response' : base.replayMode
  };
}

function userSteeringInput(instruction: string, detail: RunDetail): ResponseInputItem[] {
  return [
    {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            '# User Steering',
            'The user added this direction to the current Beale research session. Continue the same session; do not restart from scratch or create a new branch unless explicitly asked.',
            `Run id: ${detail.run.id}`,
            `Run status before steering: ${detail.run.status}`,
            '',
            '## Direction',
            redactForModelText(instruction)
          ].join('\n')
        }
      ]
    }
  ];
}

function responseInputFromMetadata(value: unknown): ResponseInputItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every(isResponseInputItem) ? value : null;
}

function isResponseInputItem(value: unknown): value is ResponseInputItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.type === 'function_call_output') {
    return typeof record.call_id === 'string' && typeof record.output === 'string';
  }
  if (record.type === 'function_call') {
    return typeof record.call_id === 'string' && typeof record.name === 'string' && typeof record.arguments === 'string' && optionalString(record.id) && optionalCompletedStatus(record.status);
  }
  if (record.type !== 'message') return false;
  if (record.role !== 'user' && record.role !== 'developer' && record.role !== 'system') return false;
  if (!Array.isArray(record.content)) return false;
  return record.content.every((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
    const content = part as Record<string, unknown>;
    return content.type === 'input_text' && typeof content.text === 'string';
  });
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalCompletedStatus(value: unknown): boolean {
  return value === undefined || value === 'completed';
}

function startInputFromRun(run: RunRecord): StartRunInput {
  return {
    runEngine: 'openai_responses',
    promptMarkdown: run.promptMarkdown,
    mode: run.mode,
    attemptStrategy: run.attemptStrategy,
    model: run.model,
    reasoningEffort: run.reasoningEffort,
    networkProfile: run.networkProfile,
    sandboxProfile: run.sandboxProfile,
    targetAssetId: run.targetAssetId,
    targetPath: run.targetPath,
    budget: {
      maxMinutes: numberFromBudget(run.budget, 'maxMinutes', UNBOUNDED_RUN_MINUTES),
      maxAttempts: numberFromBudget(run.budget, 'maxAttempts', UNBOUNDED_RUN_ATTEMPTS),
      maxCostUsd: numberFromBudget(run.budget, 'maxCostUsd', 0)
    },
    fakeScenario: fakeScenarioFromBudget(run.budget)
  };
}

function numberFromBudget(budget: Record<string, unknown>, key: string, fallback: number): number {
  const value = budget[key];
  return typeof value === 'number' ? value : fallback;
}

function fakeScenarioFromBudget(budget: Record<string, unknown>): FakeScenario {
  const value = budget.fakeScenario;
  if (
    value === 'adaptive_portfolio' ||
    value === 'source_logic_bug' ||
    value === 'memory_corruption' ||
    value === 'policy_block' ||
    value === 'verified_finding'
  ) {
    return value;
  }
  return 'adaptive_portfolio';
}

function responseIdFromEvent(event: OpenAiStreamEvent): string | null {
  const response = event.response;
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const id = (response as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
  }
  const responseId = event.response_id;
  return typeof responseId === 'string' ? responseId : null;
}

function functionCallFromEvent(event: OpenAiStreamEvent): OpenAiFunctionCall | null {
  const item = event.item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  if (record.type !== 'function_call') return null;
  const callId = record.call_id;
  const name = record.name;
  const argumentsJson = record.arguments;
  if (typeof callId !== 'string' || typeof name !== 'string') return null;
  return {
    callId,
    name,
    argumentsJson: typeof argumentsJson === 'string' ? argumentsJson : '{}',
    responseItemId: typeof record.id === 'string' ? record.id : undefined
  };
}

function eventItemRecord(event: OpenAiStreamEvent): Record<string, unknown> | null {
  const item = event.item;
  return item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
}

function outputTextFromMessageItem(item: Record<string, unknown>): string {
  if (item.type !== 'message') return '';
  const content = item.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return '';
      const record = part as Record<string, unknown>;
      if (record.type !== 'output_text') return '';
      return typeof record.text === 'string' ? record.text.trim() : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function reasoningSummaryTextFromItem(item: Record<string, unknown>): string {
  if (item.type !== 'reasoning') return '';
  return reasoningSummaryTextFromUnknown(item.summary).trim();
}

function streamReasoningSummaryText(event: OpenAiStreamEvent): string {
  const directText = typeof event.text === 'string' ? event.text : typeof event.delta === 'string' ? event.delta : '';
  if (directText.trim()) return directText.trim();
  return reasoningSummaryTextFromUnknown(event.summary || event.part).trim();
}

function reasoningSummaryTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => reasoningSummaryTextFromUnknown(item))
      .filter(Boolean)
      .join('\n\n');
  }
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  if (type && !type.includes('summary')) return '';
  if (typeof record.text === 'string') return record.text;
  if (typeof record.summary === 'string') return record.summary;
  return reasoningSummaryTextFromUnknown(record.content);
}

function transcriptKeyFromEvent(event: OpenAiStreamEvent, kind: string, text: string): string {
  return transcriptKey(kind, responseIdFromEvent(event), stringEventValue(event, 'item_id'), text);
}

function transcriptKeyFromOutputItem(event: OpenAiStreamEvent, kind: string, text: string): string {
  const item = eventItemRecord(event);
  const itemId = item && typeof item.id === 'string' ? item.id : stringEventValue(event, 'item_id');
  return transcriptKey(kind, responseIdFromEvent(event), itemId, text);
}

function transcriptKeyFromResponseItem(event: OpenAiStreamEvent, item: Record<string, unknown>, kind: string, text: string): string {
  return transcriptKey(kind, responseIdFromEvent(event), typeof item.id === 'string' ? item.id : null, text);
}

function transcriptKey(kind: string, responseId: string | null, itemId: string | null, text: string): string {
  const stableItem = itemId || responseId || 'text';
  return `${kind}:${stableItem}:${transcriptTextDigest(text)}`;
}

function transcriptTextDigest(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

function rememberReasoningSummary(state: StreamTraceState, itemId: string | null, text: string): void {
  const normalized = normalizeTranscriptText(text);
  if (!itemId || !normalized) return;
  const existing = state.reasoningSummaryTextsByItemId.get(itemId) ?? [];
  if (!existing.some((value) => normalizeTranscriptText(value) === normalized)) {
    existing.push(text);
  }
  state.reasoningSummaryTextsByItemId.set(itemId, existing);
}

function shouldSkipAggregateReasoningSummary(state: StreamTraceState, itemId: string | null, text: string): boolean {
  if (!itemId) return false;
  const previous = state.reasoningSummaryTextsByItemId.get(itemId) ?? [];
  if (previous.length === 0) return false;
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;
  if (previous.some((value) => normalizeTranscriptText(value) === normalized)) return true;
  if (previous.length < 2) return false;
  return previous.every((value) => {
    const normalizedPrevious = normalizeTranscriptText(value);
    return normalizedPrevious.length > 0 && normalized.includes(normalizedPrevious);
  });
}

function normalizeTranscriptText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stringEventValue(event: OpenAiStreamEvent, key: string): string | null {
  const value = event[key];
  return typeof value === 'string' ? value : null;
}

function primitiveEventValue(event: OpenAiStreamEvent, key: string): string | number | null {
  const value = event[key];
  if (typeof value === 'string' || typeof value === 'number') return value;
  return null;
}

function functionCallInputItem(call: OpenAiFunctionCall): FunctionCallInputItem {
  return {
    type: 'function_call',
    ...(call.responseItemId ? { id: call.responseItemId } : {}),
    call_id: call.callId,
    name: call.name,
    arguments: call.argumentsJson,
    status: 'completed'
  };
}

function parseFunctionArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function summarizeEvent(event: OpenAiStreamEvent): Record<string, unknown> {
  return {
    type: event.type,
    responseId: responseIdFromEvent(event),
    usage: event.type === 'response.completed' && event.response && typeof event.response === 'object' ? (event.response as Record<string, unknown>).usage : undefined
  };
}

function stringPayloadValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function summarizeText(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 180 ? `${oneLine.slice(0, 177)}...` : oneLine;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}

function isPreviousResponseIdUnsupported(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes('Unsupported parameter') && message.includes('previous_response_id');
}

function isRetryableOpenAiTransportError(error: unknown): boolean {
  if (error instanceof OpenAiApiError && error.status !== null) {
    return [408, 409, 429, 500, 502, 503, 504].includes(error.status);
  }
  const message = errorMessage(error).toLowerCase();
  return /\b(fetch failed|network|socket|econnreset|etimedout|eai_again|enotfound|und_err|terminated)\b/.test(message);
}

function openAiToolTurnLimit(): number {
  const configured = Number(process.env.BEALE_OPENAI_MAX_TOOL_TURNS);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.min(configured, MAX_OPENAI_TOOL_TURN_LIMIT);
  }
  return DEFAULT_OPENAI_TOOL_TURN_LIMIT;
}

function openAiTransportRetryLimit(): number {
  const configured = Number(process.env.BEALE_OPENAI_TRANSPORT_RETRY_LIMIT);
  if (Number.isInteger(configured) && configured >= 0) {
    return Math.min(configured, 10);
  }
  return DEFAULT_OPENAI_TRANSPORT_RETRY_LIMIT;
}

function openAiContextWindowRetryLimit(): number {
  const configured = Number(process.env.BEALE_OPENAI_CONTEXT_WINDOW_RETRY_LIMIT);
  if (Number.isInteger(configured) && configured >= 0) {
    return Math.min(configured, MAX_OPENAI_CONTEXT_WINDOW_RETRY_LIMIT);
  }
  return DEFAULT_OPENAI_CONTEXT_WINDOW_RETRY_LIMIT;
}

function recentEventLimitForContextWindowRetry(baseLimit: number, attempt: number): number {
  const divisor = 2 ** Math.max(0, attempt - 1);
  return Math.max(5, Math.floor(Math.max(1, baseLimit) / divisor));
}

function openAiTransportRetryDelayMs(attempt: number): number {
  const configured = Number(process.env.BEALE_OPENAI_TRANSPORT_RETRY_DELAY_MS);
  const base = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_OPENAI_TRANSPORT_RETRY_DELAY_MS;
  return Math.min(5000, base * Math.max(1, attempt));
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
