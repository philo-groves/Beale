import type { JSX } from 'react';
import {
  Bug,
  CheckCircle2,
  FileOutput,
  GitFork,
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
import { traceEventOutcome, tracePayloadPrimitive } from '../../traceClassification';
import type { TraceCategoryId } from '../../traceClassification';

export interface TraceCategoryOption {
  id: TraceCategoryId;
  label: string;
  description: string;
}

export const TRACE_CATEGORY_OPTIONS: TraceCategoryOption[] = [
  { id: 'agent_output', label: 'Agent Output', description: 'Model messages, status updates, and researcher-facing agent responses.' },
  { id: 'reasoning', label: 'Thought', description: 'Agent thought summaries, intent, and concise rationale without hidden chain-of-thought.' },
  { id: 'tools', label: 'Tools', description: 'Tool calls, tool results, and execution summaries.' },
  { id: 'vm_execution', label: 'VM / Execution', description: 'Guest VM lifecycle, imports, commands, cleanup, and target execution.' },
  { id: 'hypotheses', label: 'Hypotheses', description: 'Hypothesis creation, priority changes, merges, dismissals, and scope decisions.' },
  { id: 'evidence', label: 'Evidence / Artifacts', description: 'Artifacts, evidence promotion, finding records, and exportable observations.' },
  { id: 'verifier', label: 'Verifier', description: 'Verifier contracts, pass/fail results, and verification gating.' },
  { id: 'policy_scope', label: 'Scope / Policy', description: 'Scope checks, network decisions, approvals, and policy blocks.' },
  { id: 'code_navigation', label: 'Code Nav', description: 'Search, code browser, symbol, file, and repository inspection traces.' },
  { id: 'failure_recovery', label: 'Error', description: 'Errors, retries, cleanup issues, recovery notes, and blocked operations.' },
  { id: 'non_standard', label: 'Non-standard', description: 'Verbose model lifecycle events hidden from the default trace view.' },
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
  if (category === 'evidence') return 'Evidence';
  if (category === 'reasoning') return 'Agent Output';
  return traceCategoryLabel(category);
}

export function traceEventIcon(event: TraceEventRecord, category: TraceCategoryId): JSX.Element {
  const outcome = traceEventOutcome(event);
  if (isVerifierFailureResult(event)) return <XCircle size={13} />;
  if (outcome === 'success') return <CheckCircle2 size={13} />;
  if (outcome === 'failure') return <XCircle size={13} />;
  return traceCategoryIcon(category);
}

export function traceEventMarkerToneClass(event: TraceEventRecord): string {
  return isVerifierFailureResult(event) ? 'marker-verifier-failure' : '';
}

export function traceCategoryIcon(category: TraceCategoryId): JSX.Element {
  if (category === 'agent_output') return <Sparkles size={13} />;
  if (category === 'reasoning') return <GitFork size={13} />;
  if (category === 'tools') return <Terminal size={13} />;
  if (category === 'vm_execution') return <Server size={13} />;
  if (category === 'hypotheses') return <Bug size={13} />;
  if (category === 'evidence') return <FileOutput size={13} />;
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

function normalizeVerifierStatus(value: string | null): string | null {
  return value ? value.toLowerCase().replace(/[\s-]+/g, '_') : null;
}
