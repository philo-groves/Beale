import type { JSX } from 'react';
import {
  Brain,
  CheckCircle2,
  FileOutput,
  Lightbulb,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Square,
  Terminal,
  XCircle
} from 'lucide-react';
import type { TraceEventRecord } from '@shared/types';
import { formatSessionTime, traceLabel } from '../../lib/formatting';
import {
  honeycrispToolEventKind,
  honeycrispToolPayload,
  stringRecordValue,
  traceEventOutcome,
  tracePayloadPrimitive,
  tracePayloadRecord
} from '../../traceClassification';
import type { TraceCategoryId } from '../../traceClassification';

export interface TraceCategoryOption {
  id: TraceCategoryId;
  label: string;
  description: string;
}

export const TRACE_CATEGORY_OPTIONS: TraceCategoryOption[] = [
  { id: 'agent_output', label: 'Agent Output', description: 'Model messages, status updates, and researcher-facing agent responses.' },
  { id: 'reasoning', label: 'Reasoning', description: 'Provider-generated summaries of reasoning, intent, and concise rationale. Hidden chain-of-thought is not exposed.' },
  { id: 'tools', label: 'Tools', description: 'Tool calls, tool results, and execution summaries.' },
  { id: 'vm_execution', label: 'Execution', description: 'Host execution, commands, cleanup, and target execution.' },
  { id: 'research', label: 'Research', description: 'Honeycrisp observations, inferences, hypotheses, assumptions, and research notes.' },
  { id: 'artifacts', label: 'Artifacts', description: 'Generated files, captured outputs, exports, and durable references.' },
  { id: 'verifier', label: 'Verifier', description: 'Verifier contracts, pass/fail results, and verification gating.' },
  { id: 'policy_scope', label: 'Scope / Policy', description: 'Scope checks, network decisions, approvals, and policy blocks.' },
  { id: 'code_navigation', label: 'Code Nav', description: 'Search, code browser, symbol, file, and repository inspection traces.' },
  { id: 'failure_recovery', label: 'Error', description: 'Errors, retries, cleanup issues, recovery notes, and blocked operations.' },
  { id: 'non_standard', label: 'Non-standard', description: 'Verbose lifecycle and host-only traces hidden from the default trace view.' },
  { id: 'events', label: 'Events', description: 'Run lifecycle, user steering, notes, and uncategorized system events.' }
];

export const ALL_TRACE_CATEGORY_IDS = TRACE_CATEGORY_OPTIONS.map((option) => option.id);
export const DEFAULT_TRACE_CATEGORY_IDS = ALL_TRACE_CATEGORY_IDS.filter((id) => id !== 'non_standard');

export function traceCategoryOption(category: TraceCategoryId): TraceCategoryOption {
  return TRACE_CATEGORY_OPTIONS.find((option) => option.id === category) ?? TRACE_CATEGORY_OPTIONS[TRACE_CATEGORY_OPTIONS.length - 1];
}

export function traceCategoryLabel(category: TraceCategoryId): string {
  return traceCategoryOption(category).label;
}

export function traceCategoryBadgeLabel(category: TraceCategoryId): string {
  if (category === 'reasoning') return 'Reasoning';
  return traceCategoryLabel(category);
}

export function traceEventIcon(event: TraceEventRecord, category: TraceCategoryId): JSX.Element {
  if (honeycrispToolEventKind(event)) return traceCategoryIcon('tools');
  if (category === 'reasoning') return traceCategoryIcon('reasoning');
  const outcome = traceEventOutcome(event);
  if (isVerifierFailureResult(event)) return <XCircle size={13} />;
  if (outcome === 'success') return <CheckCircle2 size={13} />;
  if (outcome === 'failure') return <XCircle size={13} />;
  return traceCategoryIcon(category);
}

export function traceEventMarkerToneClass(event: TraceEventRecord): string {
  const toolObservationOutcome = honeycrispToolObservationOutcome(event);
  if (toolObservationOutcome) return `marker-tool-observation-${toolObservationOutcome}`;
  return isVerifierFailureResult(event) ? 'marker-verifier-failure' : '';
}

export function traceCategoryIcon(category: TraceCategoryId): JSX.Element {
  if (category === 'agent_output') return <Sparkles size={13} />;
  if (category === 'reasoning') return <Brain size={13} />;
  if (category === 'tools') return <Terminal size={13} />;
  if (category === 'vm_execution') return <Server size={13} />;
  if (category === 'research') return <Lightbulb size={13} />;
  if (category === 'artifacts') return <FileOutput size={13} />;
  if (category === 'verifier') return <ShieldCheck size={13} />;
  if (category === 'policy_scope') return <ShieldAlert size={13} />;
  if (category === 'code_navigation') return <Search size={13} />;
  if (category === 'failure_recovery') return <XCircle size={13} />;
  if (category === 'non_standard') return <SlidersHorizontal size={13} />;
  return <Square size={13} />;
}

export function traceTypeLabel(value: string): string {
  return traceLabel(value);
}

export function formatTraceTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatSessionTime(date);
}

function isVerifierFailureResult(event: TraceEventRecord): boolean {
  if (event.type !== 'verifier_result' && event.source !== 'verifier') return false;
  const status = normalizeVerifierStatus(tracePayloadPrimitive(event.payload, 'status'));
  if (status === 'fail' || status === 'failed' || status === 'failure') return true;
  return /\bwith fail(?:ed|ure)?\b/i.test(event.summary);
}

function honeycrispToolObservationOutcome(event: TraceEventRecord): 'success' | 'failure' | null {
  if (honeycrispToolEventKind(event) !== 'tool.observed') return null;
  const payload = honeycrispToolPayload(event);
  const status = normalizeToolStatus(payload ? stringRecordValue(payload, 'status') : null);
  const error = payload ? tracePayloadRecord(payload, 'error') ?? stringRecordValue(payload, 'error') : null;
  if (error || status === 'error' || status === 'blocked' || status === 'failure' || status === 'failed') return 'failure';
  if (status === 'complete' || status === 'completed' || status === 'success' || status === 'ok') return 'success';
  return traceEventOutcome(event) === 'failure' ? 'failure' : 'success';
}

function normalizeVerifierStatus(value: string | null): string | null {
  return value ? value.toLowerCase().replace(/[\s-]+/g, '_') : null;
}

function normalizeToolStatus(value: string | null): string | null {
  return value ? value.toLowerCase().replace(/[\s-]+/g, '_') : null;
}
