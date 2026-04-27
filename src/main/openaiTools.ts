import type { CreatedRunContext, WorkspaceDatabase } from './database';
import type { FunctionCallOutputItem } from './openaiAdapter';

export interface OpenAiToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

export interface OpenAiFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
  responseItemId?: string;
}

interface ToolResult {
  status: 'success' | 'policy_blocked' | 'error';
  summary: string;
  payload: Record<string, unknown>;
  traceEventId?: string;
  artifactId?: string;
}

const TOOL_NAMES = ['search', 'code_browser', 'python', 'debugger', 'artifact', 'verifier'] as const;
type ToolName = (typeof TOOL_NAMES)[number];

export function bealeToolDefinitions(): OpenAiToolDefinition[] {
  return [
    tool('search', 'Search scoped workspace metadata, source text, notes, and artifact summaries. Does not access live networks.', {
      query: stringProp('Search query'),
      target: stringProp('Optional scoped target hint')
    }),
    tool('code_browser', 'Read or summarize bounded source/decompiled text chunks from scoped material.', {
      path: stringProp('Scoped file or artifact path'),
      symbol: stringProp('Optional symbol name')
    }),
    tool('python', 'Run a small simulated Python analysis operation inside the fake executor. No host or target execution occurs in this milestone.', {
      task: stringProp('Analysis task'),
      script: stringProp('Script or pseudocode to simulate')
    }),
    tool('debugger', 'Request a simulated debugger observation from the fake executor. Real debugger sessions are VM-only and not implemented yet.', {
      operation: stringProp('Debugger operation'),
      target: stringProp('Target or input name')
    }),
    tool('artifact', 'Preserve a simulated artifact in the Beale content-addressed artifact store.', {
      name: stringProp('Artifact name'),
      content: stringProp('Artifact content or summary'),
      kind: stringProp('Artifact kind')
    }),
    tool('verifier', 'Run a simulated verifier contract and return pass, fail, or inconclusive evidence state.', {
      hypothesis: stringProp('Hypothesis or finding identifier'),
      expectation: stringProp('Expected observation')
    })
  ];
}

export class BealeToolRouter {
  public constructor(private readonly db: WorkspaceDatabase) {}

  public execute(context: CreatedRunContext, call: OpenAiFunctionCall): FunctionCallOutputItem {
    const args = parseArguments(call.argumentsJson);
    const result = this.executeInternal(context, call, args);
    return {
      type: 'function_call_output',
      call_id: call.callId,
      output: JSON.stringify({
        status: result.status,
        summary: result.summary,
        trace_event_id: result.traceEventId,
        artifact_id: result.artifactId,
        payload: result.payload
      })
    };
  }

  private executeInternal(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    if (!isToolName(call.name)) {
      return this.recordError(context, call, args, `Unknown Beale tool requested: ${call.name}`);
    }

    const destination = extractDestination(args);
    if (destination && !this.destinationAllowed(destination)) {
      return this.recordPolicyBlock(context, call, args, destination);
    }

    const toolCallId = this.db.createToolCall({
      runId: context.run.id,
      attemptId: context.attempt.id,
      toolName: call.name,
      toolVersion: 'openai-adapter-v1',
      input: {
        openaiCallId: call.callId,
        responseItemId: call.responseItemId ?? null,
        arguments: args
      },
      status: 'completed',
      resultSummary: `Simulated ${call.name} result recorded after policy check.`,
      result: { simulated: true, toolName: call.name },
      vmContextId: context.vmContext.id
    });

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_call',
      source: 'model',
      summary: `OpenAI requested Beale tool: ${call.name}.`,
      payload: {
        openaiCallId: call.callId,
        responseItemId: call.responseItemId ?? null,
        arguments: args,
        policyChecked: true
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'approval_event',
      source: 'policy',
      summary: `Policy approved simulated ${call.name} tool call.`,
      payload: {
        decision: 'approved',
        simulated: true,
        targetExecution: false
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });

    const result = this.fakeToolResult(context, call.name, args);
    const event = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: result.artifactId ? 'artifact_created' : 'tool_result',
      source: result.artifactId ? 'tool' : 'tool',
      summary: result.summary,
      payload: result.payload,
      artifactId: result.artifactId,
      toolCallId,
      vmContextId: context.vmContext.id
    });
    this.db.linkToolCallTrace(toolCallId, event.id);
    return { ...result, traceEventId: event.id };
  }

  private fakeToolResult(context: CreatedRunContext, toolName: ToolName, args: Record<string, unknown>): ToolResult {
    switch (toolName) {
      case 'search':
        return {
          status: 'success',
          summary: 'Search returned scoped simulated matches.',
          payload: {
            observationBacked: true,
            simulated: true,
            matches: this.db.getActiveScope().assets.slice(0, 5).map((asset) => ({
              kind: asset.kind,
              value: asset.value,
              direction: asset.direction
            })),
            query: args.query ?? ''
          }
        };
      case 'code_browser':
        return {
          status: 'success',
          summary: 'Code browser returned a bounded simulated source observation.',
          payload: {
            observationBacked: true,
            simulated: true,
            path: args.path ?? '',
            symbol: args.symbol ?? '',
            excerpt: 'Simulated bounded code excerpt. Real source reads will be scoped and trace-backed in the executor milestone.'
          }
        };
      case 'python':
        return {
          status: 'success',
          summary: 'Python tool simulated guest-only analysis without executing code.',
          payload: {
            observationBacked: true,
            simulated: true,
            targetExecution: false,
            task: args.task ?? ''
          }
        };
      case 'debugger':
        return {
          status: 'success',
          summary: 'Debugger tool simulated a VM-only runtime observation.',
          payload: {
            observationBacked: true,
            simulated: true,
            targetExecution: false,
            stopReason: 'simulated_breakpoint'
          }
        };
      case 'artifact': {
        const name = stringValue(args.name, 'openai-artifact.txt');
        const content = stringValue(args.content, 'Simulated artifact created by OpenAI tool routing.');
        const kind = stringValue(args.kind, 'model_proposed_artifact');
        const artifact = this.db.createArtifact({
          kind,
          mimeType: 'text/plain',
          sensitivity: 'internal',
          modelVisible: true,
          source: 'report',
          metadata: { name, openaiToolCall: true, simulated: true },
          content
        });
        return {
          status: 'success',
          summary: `Artifact tool preserved simulated artifact: ${name}.`,
          artifactId: artifact.id,
          payload: {
            observationBacked: true,
            simulated: true,
            artifactId: artifact.id,
            sha256: artifact.sha256,
            name
          }
        };
      }
      case 'verifier': {
        const contract = this.db.createVerifierContract({
          runId: context.run.id,
          mode: 'reproduction',
          status: 'approved_fake',
          setupStepsMarkdown: 'Simulated OpenAI verifier request. No target execution.',
          triggerStepsMarkdown: stringValue(args.expectation, 'Simulated trigger'),
          targetStates: { vmContextId: context.vmContext.id },
          expectedObservations: { expectation: args.expectation ?? '' },
          invariants: { noHostExecution: true },
          artifactsToCollect: { trace: true },
          passCriteria: { simulated: true }
        });
        const verifierRun = this.db.createVerifierRun({
          contractId: contract.id,
          runId: context.run.id,
          attemptId: context.attempt.id,
          vmContextId: context.vmContext.id,
          status: 'inconclusive',
          blockedIssue: 'inconclusive',
          behaviorPreserved: 'not_applicable',
          diagnosticsClean: 'inconclusive',
          regressionTests: 'not_run',
          result: { simulated: true, hypothesis: args.hypothesis ?? '' }
        });
        return {
          status: 'success',
          summary: 'Verifier tool recorded an inconclusive simulated verifier result.',
          payload: {
            observationBacked: true,
            simulated: true,
            verifierRunId: verifierRun.id,
            contractId: contract.id,
            status: 'inconclusive'
          }
        };
      }
    }
  }

  private recordPolicyBlock(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>, destination: string): ToolResult {
    const approval = this.db.createApproval({
      runId: context.run.id,
      attemptId: context.attempt.id,
      requestKind: 'tool_call',
      requestedAction: {
        toolName: call.name,
        openaiCallId: call.callId,
        arguments: args
      },
      decision: 'blocked',
      reason: `Blocked out-of-scope tool destination: ${destination}`
    });
    const event = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'approval_event',
      source: 'policy',
      summary: `Policy blocked OpenAI tool call: ${call.name}.`,
      payload: {
        decision: 'blocked',
        destination,
        arguments: args
      },
      approvalId: approval.id,
      vmContextId: context.vmContext.id
    });
    return {
      status: 'policy_blocked',
      summary: `Policy blocked ${call.name} for out-of-scope destination.`,
      traceEventId: event.id,
      payload: {
        blocked: true,
        destination,
        approvalId: approval.id
      }
    };
  }

  private recordError(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>, message: string): ToolResult {
    const event = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_result',
      source: 'tool',
      summary: message,
      payload: {
        status: 'error',
        toolName: call.name,
        arguments: args
      },
      vmContextId: context.vmContext.id
    });
    return {
      status: 'error',
      summary: message,
      traceEventId: event.id,
      payload: { message }
    };
  }

  private destinationAllowed(destination: string): boolean {
    const scope = this.db.getActiveScope();
    const outOfScope = scope.assets.filter((asset) => asset.direction === 'out_of_scope').some((asset) => destination.includes(asset.value));
    if (outOfScope) return false;
    const inScopeNetworkAsset = scope.assets
      .filter((asset) => asset.direction === 'in_scope' && ['domain', 'host', 'service'].includes(asset.kind))
      .some((asset) => destination.includes(asset.value));
    return inScopeNetworkAsset;
  }
}

function tool(name: ToolName, description: string, properties: Record<string, unknown>): OpenAiToolDefinition {
  return {
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    },
    strict: true
  };
}

function stringProp(description: string): Record<string, unknown> {
  return { type: 'string', description };
}

function parseArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isToolName(value: string): value is ToolName {
  return TOOL_NAMES.includes(value as ToolName);
}

function extractDestination(args: Record<string, unknown>): string | null {
  const destination = args.destination ?? args.url ?? args.host ?? args.target;
  return typeof destination === 'string' && /^https?:\/\//.test(destination) ? destination : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
