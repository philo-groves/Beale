import type { RunDetail, TraceEventRecord } from '@shared/types';
import type { OpenAiStreamEvent, ResponseInputItem } from './openaiAdapter';

export type OpenAiReplayMode = 'initial' | 'previous_response' | 'pending_input' | 'compacted_replay' | 'manual_response_replay';

export interface OpenAiCompactionPolicy {
  inputTokenLimit: number;
  inputTokenPressureThreshold: number;
  manualReplayToolTurnLimit: number;
  serializedReplayByteLimit: number;
  recentModelVisibleEventLimit: number;
  redactionPolicyVersion: string;
}

export interface OpenAiCompactionDecision {
  reason: string;
  tokenPressure: Record<string, unknown>;
  serializedSizeBytes: number;
}

export interface OpenAiCompactionRanges {
  summarized: Record<string, unknown>;
  kept: Record<string, unknown>;
  highWaterMark: number;
}

export const DEFAULT_OPENAI_COMPACTION_INPUT_TOKEN_LIMIT = 272_000;
const DEFAULT_OPENAI_COMPACTION_INPUT_TOKEN_MARGIN = 8_000;
const DEFAULT_MANUAL_REPLAY_TOOL_TURN_LIMIT = 96;
const DEFAULT_SERIALIZED_REPLAY_BYTE_LIMIT = 1_500_000;
const DEFAULT_RECENT_MODEL_VISIBLE_EVENT_LIMIT = 40;
const REDACTION_POLICY_VERSION = 'beale-redaction-v1';

export function openAiCompactionPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAiCompactionPolicy {
  const inputTokenLimit = positiveInteger(env.BEALE_OPENAI_COMPACT_INPUT_TOKENS) ?? positiveInteger(env.BEALE_OPENAI_CONTEXT_BUDGET_TOKENS) ?? DEFAULT_OPENAI_COMPACTION_INPUT_TOKEN_LIMIT;
  const configuredThreshold = positiveInteger(env.BEALE_OPENAI_COMPACT_INPUT_THRESHOLD_TOKENS);
  const inputTokenMargin = positiveInteger(env.BEALE_OPENAI_COMPACT_INPUT_MARGIN_TOKENS) ?? DEFAULT_OPENAI_COMPACTION_INPUT_TOKEN_MARGIN;
  const inputTokenPressureThreshold = Math.min(inputTokenLimit, configuredThreshold ?? Math.max(1, inputTokenLimit - inputTokenMargin));
  return {
    inputTokenLimit,
    inputTokenPressureThreshold,
    manualReplayToolTurnLimit: positiveInteger(env.BEALE_OPENAI_COMPACT_MANUAL_TURNS) ?? DEFAULT_MANUAL_REPLAY_TOOL_TURN_LIMIT,
    serializedReplayByteLimit: positiveInteger(env.BEALE_OPENAI_COMPACT_SERIALIZED_BYTES) ?? DEFAULT_SERIALIZED_REPLAY_BYTE_LIMIT,
    recentModelVisibleEventLimit: positiveInteger(env.BEALE_OPENAI_COMPACT_RECENT_EVENTS) ?? DEFAULT_RECENT_MODEL_VISIBLE_EVENT_LIMIT,
    redactionPolicyVersion: REDACTION_POLICY_VERSION
  };
}

export function evaluateOpenAiCompaction({
  replayMode,
  previousResponseIdUnsupported,
  manualConversationInput,
  latestReportedInputTokens,
  policy
}: {
  replayMode: OpenAiReplayMode;
  previousResponseIdUnsupported: boolean;
  manualConversationInput: ResponseInputItem[];
  latestReportedInputTokens: number | null;
  policy: OpenAiCompactionPolicy;
}): OpenAiCompactionDecision | null {
  const serializedSizeBytes = serializedInputBytes(manualConversationInput);
  const manualToolTurns = countFunctionCallOutputs(manualConversationInput);
  const tokenPressure = {
    latestReportedInputTokens,
    inputTokenLimit: policy.inputTokenLimit,
    inputTokenPressureThreshold: policy.inputTokenPressureThreshold,
    manualToolTurns,
    manualReplayToolTurnLimit: policy.manualReplayToolTurnLimit,
    serializedSizeBytes,
    serializedReplayByteLimit: policy.serializedReplayByteLimit
  };

  if (latestReportedInputTokens !== null && latestReportedInputTokens >= policy.inputTokenLimit) {
    return { reason: 'input_token_limit', tokenPressure, serializedSizeBytes };
  }
  if (latestReportedInputTokens !== null && latestReportedInputTokens >= policy.inputTokenPressureThreshold) {
    return { reason: 'input_token_pressure', tokenPressure, serializedSizeBytes };
  }
  if (previousResponseIdUnsupported && replayMode === 'manual_response_replay' && manualToolTurns >= policy.manualReplayToolTurnLimit) {
    return { reason: 'manual_replay_turn_limit', tokenPressure, serializedSizeBytes };
  }
  if (previousResponseIdUnsupported && serializedSizeBytes >= policy.serializedReplayByteLimit) {
    return { reason: 'manual_replay_size_limit', tokenPressure, serializedSizeBytes };
  }
  return null;
}

export function contextCompactionRanges(detail: RunDetail, recentModelVisibleEventLimit: number): OpenAiCompactionRanges {
  const highWaterMark = detail.traceEvents.at(-1)?.sequence ?? 0;
  const visibleEvents = detail.traceEvents.filter((event) => event.modelVisible);
  const keptEvents = visibleEvents.slice(-recentModelVisibleEventLimit);
  const keptSequences = keptEvents.map((event) => event.sequence);
  const firstKeptSequence = keptSequences[0] ?? null;
  const summarizedEvents = firstKeptSequence === null ? visibleEvents : visibleEvents.filter((event) => event.sequence < firstKeptSequence);
  const summarizedSequences = summarizedEvents.map((event) => event.sequence);

  return {
    summarized: {
      modelVisible: true,
      count: summarizedEvents.length,
      from: summarizedSequences[0] ?? null,
      to: summarizedSequences.at(-1) ?? null
    },
    kept: {
      modelVisible: true,
      count: keptEvents.length,
      from: keptSequences[0] ?? null,
      to: keptSequences.at(-1) ?? null
    },
    highWaterMark
  };
}

export function representedCompactionState(detail: RunDetail): Record<string, unknown> {
  return {
    hypotheses: detail.hypotheses.map((hypothesis) => ({ id: hypothesis.id, state: hypothesis.state, cweMappings: cweMappingSnapshot(hypothesis.cweMappings) })),
    findings: detail.findings.map((finding) => ({
      id: finding.id,
      state: finding.state,
      verifiedByVerifierRunId: finding.verifiedByVerifierRunId,
      reportability: finding.reportability,
      cweMappings: cweMappingSnapshot(finding.cweMappings)
    })),
    artifacts: detail.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      modelVisible: artifact.modelVisible,
      name: stringValue(artifact.metadata.name),
      sourcePath: stringValue(artifact.metadata.sourcePath),
      sizeBytes: artifact.sizeBytes
    })),
    evidence: detail.evidence.map((evidence) => ({
      id: evidence.id,
      kind: evidence.kind,
      hypothesisId: evidence.hypothesisId,
      findingId: evidence.findingId,
      artifactId: evidence.artifactId,
      verifierRunId: evidence.verifierRunId
    })),
    latestReasoning: detail.traceEvents
      .filter((event) => event.source === 'model' && event.type === 'model_message' && typeof event.payload.text === 'string')
      .slice(-5)
      .map((event) => ({ sequence: event.sequence, summary: String(event.payload.text).replace(/\s+/g, ' ').trim().slice(0, 240) })),
    verifierRuns: detail.verifierRuns.map((run) => ({ id: run.id, status: run.status, contractId: run.contractId })),
    policyEvents: detail.policyEvents.map((event) => ({ id: event.id, decision: event.decision, requestKind: event.requestKind })),
    vmContexts: detail.vmContexts.map((context) => ({ id: context.id, backend: context.backend, state: context.state, networkProfile: context.networkProfile }))
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function cweMappingSnapshot(mappings: Array<{ cweId: string; mappingRole: string; confidence: string }>): Array<Record<string, string>> {
  return mappings.map((mapping) => ({ cweId: mapping.cweId, mappingRole: mapping.mappingRole, confidence: mapping.confidence }));
}

export function inputTokensFromOpenAiEvent(event: OpenAiStreamEvent): number | null {
  const response = recordValue(event.response);
  const usage = recordValue(response?.usage);
  return numberValue(usage?.input_tokens) ?? numberValue(usage?.prompt_tokens);
}

export function isContextWindowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /context (?:window|length)|context_window|context_length|input exceeds/i.test(message);
}

export function serializedInputBytes(input: ResponseInputItem[]): number {
  return Buffer.byteLength(JSON.stringify(input), 'utf8');
}

function countFunctionCallOutputs(input: ResponseInputItem[]): number {
  return input.filter((item) => item.type === 'function_call_output').length;
}

function positiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
