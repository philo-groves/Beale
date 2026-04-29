import type { TraceEventRecord } from '@shared/types';

export type TraceCategoryId =
  | 'agent_output'
  | 'reasoning'
  | 'tools'
  | 'vm_execution'
  | 'hypotheses'
  | 'evidence'
  | 'verifier'
  | 'policy_scope'
  | 'code_navigation'
  | 'failure_recovery'
  | 'events';

export type TraceEventOutcome = 'success' | 'failure' | null;

const SUCCESS_STATUSES = new Set(['success', 'completed', 'complete', 'pass', 'passed', 'ok']);
const FAILURE_STATUSES = new Set(['failure', 'failed', 'timeout', 'timed_out', 'policy_blocked', 'executor_error', 'error', 'blocked']);
const CODE_NAVIGATION_TOOLS = new Set(['source', 'search', 'code_browser']);
const FAILURE_SUMMARY_PATTERN = /\b(failed|failure|timeout|timed out|blocked|errored|error|could not|unable to|requires setup|missing)\b/i;
const RECOVERY_SUMMARY_PATTERN = /\b(retry|retried|recover|recovered|recovery|fallback)\b/i;

export function traceCategoryForEvent(event: TraceEventRecord): TraceCategoryId {
  const transcriptRole = tracePayloadPrimitive(event.payload, 'transcriptRole');
  const transcriptSource = tracePayloadPrimitive(event.payload, 'transcriptSource');
  if (transcriptSource === 'openai_reasoning_summary') return 'reasoning';
  if (transcriptRole === 'assistant') return 'agent_output';
  if (transcriptRole === 'user' || transcriptRole === 'system') return 'events';

  const toolName = traceToolName(event);
  if (event.type === 'tool_call' && toolName === 'hypothesis') return 'hypotheses';
  if (event.type === 'tool_call' && toolName === 'finding') return 'evidence';

  if (traceEventOutcome(event) === 'failure' || summaryIndicatesRecovery(event.summary)) return 'failure_recovery';
  if (isPolicyScopeEvent(event)) return 'policy_scope';
  if (event.type === 'verifier_result' || event.source === 'verifier') return 'verifier';
  if (event.type === 'hypothesis_event') return 'hypotheses';
  if (isEvidenceEvent(event)) return 'evidence';
  if (isVmExecutionEvent(event)) return 'vm_execution';
  if (isToolEvent(event)) return isCodeNavigationEvent(event, toolName) ? 'code_navigation' : 'tools';
  if (event.source === 'model' || event.type === 'model_message') {
    return modelEventLooksLikeReasoning(event) ? 'reasoning' : 'agent_output';
  }
  return 'events';
}

export function traceEventOutcome(event: TraceEventRecord): TraceEventOutcome {
  const status = normalizeStatus(tracePayloadPrimitive(event.payload, 'status'));
  if (status && SUCCESS_STATUSES.has(status)) return 'success';
  if (status && FAILURE_STATUSES.has(status)) return 'failure';
  if (hasStructuredFailureField(event.payload)) return 'failure';

  if (summaryIndicatesFailure(event.summary)) return 'failure';
  if (summaryIndicatesSuccess(event.summary)) return 'success';
  if (event.source === 'tool' && event.type === 'tool_result') return 'success';
  return null;
}

export function tracePayloadPrimitive(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function tracePayloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = payload[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function tracePayloadArray(payload: Record<string, unknown>, key: string): unknown[] | null {
  const value = payload[key];
  return Array.isArray(value) ? value : null;
}

export function stringRecordValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function toolNameFromSummary(summary: string): string | null {
  const requested = summary.match(/OpenAI requested Beale tool: ([^.]+)\./);
  if (requested) return requested[1];
  const completed = summary.match(/OpenAI completed function call arguments for ([^.]+)\./);
  if (completed) return completed[1];
  if (/^Code browser\b/i.test(summary)) return 'code_browser';
  if (/^Search\b/i.test(summary)) return 'search';
  if (/^Source repository\b/i.test(summary)) return 'source';
  if (/^(Host|Guest) python\b/i.test(summary)) return 'python';
  return null;
}

export function isToolCallNamed(event: TraceEventRecord, toolName: string): boolean {
  return event.type === 'tool_call' && traceToolName(event) === toolName;
}

function traceToolName(event: TraceEventRecord): string | null {
  return tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
}

function isPolicyScopeEvent(event: TraceEventRecord): boolean {
  return event.source === 'policy' || event.type === 'approval_event' || event.type === 'network_event' || event.type === 'user_scope';
}

function isEvidenceEvent(event: TraceEventRecord): boolean {
  const summary = event.summary.toLowerCase();
  return event.type === 'artifact_created' || event.type === 'finding_event' || /\b(evidence|artifact|export|finding)\b/.test(summary);
}

function isVmExecutionEvent(event: TraceEventRecord): boolean {
  const summary = event.summary.toLowerCase();
  return event.source === 'executor' || event.type === 'vm_event' || /\b(vm|guest|firecracker|docker|snapshot|sandbox)\b/.test(summary);
}

function isToolEvent(event: TraceEventRecord): boolean {
  return event.source === 'tool' || event.type === 'tool_call' || event.type === 'tool_result';
}

function isCodeNavigationEvent(event: TraceEventRecord, toolName: string | null): boolean {
  if (toolName && CODE_NAVIGATION_TOOLS.has(toolName)) return true;
  if (tracePayloadPrimitive(event.payload, 'sourcePath') || tracePayloadPrimitive(event.payload, 'query')) return true;
  if (tracePayloadArray(event.payload, 'availableRepositories')) return true;
  return /\b(code browser|search examined|source repository|repository materialized)\b/i.test(event.summary);
}

function modelEventLooksLikeReasoning(event: TraceEventRecord): boolean {
  return /\b(plan|planned|prepared|objective|rationale|reason|strategy|hypothesis|intent|thought)\b/i.test(event.summary);
}

function normalizeStatus(status: string | null): string | null {
  return status ? status.trim().toLowerCase().replace(/[-\s]+/g, '_') : null;
}

function hasStructuredFailureField(payload: Record<string, unknown>): boolean {
  return Boolean(
    tracePayloadPrimitive(payload, 'error') ||
      tracePayloadPrimitive(payload, 'blockedIssue') ||
      tracePayloadPrimitive(payload, 'blockedReason') ||
      normalizeStatus(tracePayloadPrimitive(payload, 'decision')) === 'blocked'
  );
}

function summaryIndicatesFailure(summary: string): boolean {
  return FAILURE_SUMMARY_PATTERN.test(summary);
}

function summaryIndicatesRecovery(summary: string): boolean {
  return RECOVERY_SUMMARY_PATTERN.test(summary);
}

function summaryIndicatesSuccess(summary: string): boolean {
  return /\b(finished with success|returned \d+ bounded lines|materialized for scoped analysis|succeeded)\b/i.test(summary);
}
