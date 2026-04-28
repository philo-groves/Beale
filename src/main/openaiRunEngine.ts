import type { CreatedRunContext, WorkspaceDatabase } from './database';
import {
  OpenAiResponsesAdapter,
  openAiApiErrorFromEvent,
  openAiErrorCode,
  type FunctionCallOutputItem,
  type OpenAiStreamEvent,
  type ResponseInputItem
} from './openaiAdapter';
import { OpenAiAuthService } from './openaiAuth';
import { buildCompactedReplayOpenAiInput, buildInitialOpenAiInput, buildOpenAiInstructions, buildResumeOpenAiInput } from './openaiContext';
import { bealeToolDefinitions, BealeToolRouter, type OpenAiFunctionCall } from './openaiTools';
import type { ExecutorManager } from './executorManager';
import type { FakeScenario, ModelSessionRecord, OpenAiTransport, RunDetail, RunRecord, StartRunInput } from '@shared/types';

export interface OpenAiRunHandle {
  context: CreatedRunContext;
  completion: Promise<void>;
}

const MAX_OPENAI_TOOL_TURNS = 4;
const DEFAULT_RUN_MAX_MINUTES = 180;
const UNBOUNDED_RUN_ATTEMPTS = 999_999;

interface RunLoopState {
  responseInput: ResponseInputItem[];
  previousResponseId: string | null;
  replayMode: 'initial' | 'previous_response' | 'pending_input' | 'compacted_replay';
}

export class OpenAiRunEngine {
  private readonly controllers = new Map<string, AbortController>();

  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly auth: OpenAiAuthService,
    private readonly adapter: OpenAiResponsesAdapter,
    private readonly executor: ExecutorManager | null = null,
    private readonly onChange: () => void = () => undefined
  ) {}

  public startRun(input: StartRunInput): OpenAiRunHandle {
    const scope = this.db.getActiveScope();
    const context = this.db.createRun({
      scopeVersionId: scope.id,
      title: deriveRunTitle(input.promptMarkdown),
      promptMarkdown: input.promptMarkdown,
      mode: input.mode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attemptStrategy: input.attemptStrategy,
      networkProfile: input.networkProfile,
      sandboxProfile: input.sandboxProfile,
      budget: { ...input.budget, runEngine: 'openai_responses' }
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
        runEngine: 'openai_responses'
      }
    });
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
    const completion = this.runLoop(context, input, controller).finally(() => {
      this.controllers.delete(context.run.id);
      this.onChange();
    });
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
      this.onChange();
    });
    return { context, completion };
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

  private async runLoop(context: CreatedRunContext, input: StartRunInput, controller: AbortController, state?: RunLoopState): Promise<void> {
    const router = new BealeToolRouter(this.db, this.executor);
    const scope = this.db.getActiveScope();
    let responseInput: ResponseInputItem[] = state?.responseInput ?? buildInitialOpenAiInput(input);
    let previousResponseId: string | null = state?.previousResponseId ?? null;
    let replayMode = state?.replayMode ?? 'initial';
    let replayedAfterMissingPrevious = replayMode === 'compacted_replay';

    try {
      for (let turn = 0; turn < MAX_OPENAI_TOOL_TURNS; turn += 1) {
        this.db.updateModelSessionByRun(context.run.id, {
          status: 'active',
          metadata: {
            pendingInput: responseInput,
            replayMode,
            turn: turn + 1
          }
        });
        const body = this.adapter.buildRequest({
          model: input.model,
          instructions: buildOpenAiInstructions(scope, input),
          input: responseInput,
          tools: bealeToolDefinitions(),
          reasoning: { effort: input.reasoningEffort },
          text: { verbosity: 'low' },
          previous_response_id: previousResponseId,
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
            previousResponseId,
            store: body.store,
            stream: body.stream,
            transport: this.adapter.getTransport(),
            replayMode
          },
          vmContextId: context.vmContext.id
        });
        this.onChange();

        const functionCalls: OpenAiFunctionCall[] = [];
        try {
          for await (const event of this.adapter.streamResponse({ body, signal: controller.signal })) {
            this.handleStreamEvent(context, event, functionCalls);
            const eventResponseId = responseIdFromEvent(event);
            if (eventResponseId) {
              if (event.type === 'response.completed') {
                previousResponseId = eventResponseId;
                this.db.updateModelSessionByRun(context.run.id, {
                  previousResponseId,
                  metadata: { lastResponseId: eventResponseId, lastEventType: event.type }
                });
              } else {
                this.db.updateModelSessionByRun(context.run.id, {
                  metadata: { lastResponseId: eventResponseId, lastEventType: event.type }
                });
              }
            }
            this.onChange();
          }
        } catch (error) {
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
            responseInput = buildCompactedReplayOpenAiInput(this.db.getRunDetail(context.run.id));
            previousResponseId = null;
            replayMode = 'compacted_replay';
            replayedAfterMissingPrevious = true;
            this.db.updateModelSessionByRun(context.run.id, {
              previousResponseId: null,
              metadata: {
                pendingInput: responseInput,
                replayMode,
                previousResponseRecovery: 'compacted_replay'
              }
            });
            continue;
          }
          throw error;
        }

        if (functionCalls.length === 0) {
          this.db.updateAttemptState(context.attempt.id, 'completed', 'OpenAI run completed without additional tool requests.');
          this.db.updateRunStatus(context.run.id, 'completed', 'OpenAI run completed.');
          this.db.updateModelSessionByRun(context.run.id, { status: 'completed', metadata: { completed: true, pendingInput: [] } });
          this.db.updateVmState(context.vmContext.id, 'destroyed');
          this.adapter.closeWebSocketSession(context.run.id);
          return;
        }

        const toolOutputs: FunctionCallOutputItem[] = functionCalls.map((call) => router.execute(context, call));
        responseInput = toolOutputs;
        replayMode = 'previous_response';
        this.db.updateModelSessionByRun(context.run.id, {
          metadata: {
            pendingInput: responseInput,
            pendingToolOutputCount: toolOutputs.length,
            replayMode
          }
        });
      }

      this.db.updateAttemptState(context.attempt.id, 'paused', 'Paused after OpenAI tool-turn budget was reached.');
      this.db.updateRunStatus(context.run.id, 'paused', 'Paused after OpenAI tool-turn budget was reached.');
      this.db.updateModelSessionByRun(context.run.id, {
        status: 'paused_tool_budget',
        metadata: { maxToolTurns: MAX_OPENAI_TOOL_TURNS, pendingInput: responseInput, replayMode }
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

  private handleStreamEvent(context: CreatedRunContext, event: OpenAiStreamEvent, functionCalls: OpenAiFunctionCall[]): void {
    switch (event.type) {
      case 'response.created':
        this.db.appendTraceEvent({
          runId: context.run.id,
          attemptId: context.attempt.id,
          type: 'model_message',
          source: 'system',
          summary: 'OpenAI response created.',
          payload: summarizeEvent(event)
        });
        break;
      case 'response.output_text.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta.trim().length > 0) {
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
          });
        }
        break;
      }
      case 'response.output_text.done': {
        const text = typeof event.text === 'string' ? event.text : '';
        this.db.appendTraceEvent({
          runId: context.run.id,
          attemptId: context.attempt.id,
          type: 'model_message',
          source: 'model',
          summary: text ? summarizeText(text) : 'OpenAI completed a model output item.',
          payload: {
            text,
            claimStatus: 'model_claim'
          },
          vmContextId: context.vmContext.id
        });
        break;
      }
      case 'response.function_call_arguments.done':
      case 'response.output_item.done': {
        const call = functionCallFromEvent(event);
        if (call && !functionCalls.some((existing) => existing.callId === call.callId)) {
          functionCalls.push(call);
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
          });
        }
        break;
      }
      case 'response.completed':
        this.db.appendTraceEvent({
          runId: context.run.id,
          attemptId: context.attempt.id,
          type: 'model_message',
          source: 'system',
          summary: 'OpenAI response completed.',
          payload: summarizeEvent(event)
        });
        break;
      case 'error':
        throw openAiApiErrorFromEvent(event);
      default:
        break;
    }
  }
}

function deriveRunTitle(promptMarkdown: string): string {
  const firstLine = promptMarkdown
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return 'OpenAI discovery run';
  return firstLine.replace(/^#+\s*/, '').slice(0, 80);
}

function buildResumeState(session: ModelSessionRecord | undefined, detail: RunDetail): RunLoopState {
  const pendingInput = responseInputFromMetadata(session?.metadata.pendingInput);
  if (pendingInput) {
    return {
      responseInput: pendingInput,
      previousResponseId: session?.previousResponseId ?? null,
      replayMode: 'pending_input'
    };
  }
  if (session?.previousResponseId) {
    return {
      responseInput: buildResumeOpenAiInput(detail),
      previousResponseId: session.previousResponseId,
      replayMode: 'previous_response'
    };
  }
  return {
    responseInput: buildCompactedReplayOpenAiInput(detail),
    previousResponseId: null,
    replayMode: 'compacted_replay'
  };
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
  if (record.type !== 'message') return false;
  if (record.role !== 'user' && record.role !== 'developer' && record.role !== 'system') return false;
  if (!Array.isArray(record.content)) return false;
  return record.content.every((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
    const content = part as Record<string, unknown>;
    return content.type === 'input_text' && typeof content.text === 'string';
  });
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
    budget: {
      maxMinutes: numberFromBudget(run.budget, 'maxMinutes', DEFAULT_RUN_MAX_MINUTES),
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

function summarizeText(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 180 ? `${oneLine.slice(0, 177)}...` : oneLine;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}
