import type { CreatedRunContext, WorkspaceDatabase } from './database';
import { OpenAiResponsesAdapter, type FunctionCallOutputItem, type OpenAiStreamEvent, type ResponseInputItem } from './openaiAdapter';
import { OpenAiAuthService } from './openaiAuth';
import { buildInitialOpenAiInput, buildOpenAiInstructions } from './openaiContext';
import { bealeToolDefinitions, BealeToolRouter, type OpenAiFunctionCall } from './openaiTools';
import type { OpenAiTransport, StartRunInput } from '@shared/types';

export interface OpenAiRunHandle {
  context: CreatedRunContext;
  completion: Promise<void>;
}

const MAX_OPENAI_TOOL_TURNS = 4;

export class OpenAiRunEngine {
  private readonly controllers = new Map<string, AbortController>();

  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly auth: OpenAiAuthService,
    private readonly adapter: OpenAiResponsesAdapter,
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
    const transport: OpenAiTransport = 'sse_http';
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
  }

  private async runLoop(context: CreatedRunContext, input: StartRunInput, controller: AbortController): Promise<void> {
    const router = new BealeToolRouter(this.db);
    const scope = this.db.getActiveScope();
    let responseInput: ResponseInputItem[] = buildInitialOpenAiInput(input);
    let previousResponseId: string | null = null;

    try {
      for (let turn = 0; turn < MAX_OPENAI_TOOL_TURNS; turn += 1) {
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
            stream: body.stream
          },
          vmContextId: context.vmContext.id
        });
        this.onChange();

        const functionCalls: OpenAiFunctionCall[] = [];
        for await (const event of this.adapter.streamResponse({ body, signal: controller.signal })) {
          this.handleStreamEvent(context, event, functionCalls);
          const eventResponseId = responseIdFromEvent(event);
          if (eventResponseId) {
            previousResponseId = eventResponseId;
            this.db.updateModelSessionByRun(context.run.id, {
              previousResponseId,
              metadata: { lastResponseId: previousResponseId, lastEventType: event.type }
            });
          }
          this.onChange();
        }

        if (functionCalls.length === 0) {
          this.db.updateAttemptState(context.attempt.id, 'completed', 'OpenAI run completed without additional tool requests.');
          this.db.updateRunStatus(context.run.id, 'completed', 'OpenAI run completed.');
          this.db.updateModelSessionByRun(context.run.id, { status: 'completed', metadata: { completed: true } });
          this.db.updateVmState(context.vmContext.id, 'destroyed');
          return;
        }

        const toolOutputs: FunctionCallOutputItem[] = functionCalls.map((call) => router.execute(context, call));
        responseInput = toolOutputs;
      }

      this.db.updateAttemptState(context.attempt.id, 'paused', 'Paused after OpenAI tool-turn budget was reached.');
      this.db.updateRunStatus(context.run.id, 'paused', 'Paused after OpenAI tool-turn budget was reached.');
      this.db.updateModelSessionByRun(context.run.id, { status: 'paused_tool_budget', metadata: { maxToolTurns: MAX_OPENAI_TOOL_TURNS } });
    } catch (error) {
      if (controller.signal.aborted) {
        this.db.updateAttemptState(context.attempt.id, 'paused', 'Paused by user steering.');
        this.db.updateRunStatus(context.run.id, 'paused', 'Paused by user steering.');
        this.db.updateModelSessionByRun(context.run.id, { status: 'paused' });
        return;
      }
      this.db.updateAttemptState(context.attempt.id, 'failed', 'OpenAI Responses run failed.');
      this.db.updateRunStatus(context.run.id, 'failed', 'OpenAI Responses run failed.');
      this.db.updateModelSessionByRun(context.run.id, { status: 'failed', metadata: { error: errorMessage(error) } });
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
        throw new Error(errorMessage(event.error ?? event));
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
