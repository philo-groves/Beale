import type { RunDetail, TraceEventRecord } from '@shared/types';
import { traceLabel, truncateText } from '../lib/formatting';
import {
  honeycrispToolEventKind,
  honeycrispToolName,
  honeycrispToolPairingKey,
  honeycrispToolPayload as honeycrispEventToolPayload,
  stringRecordValue,
  toolNameFromSummary,
  tracePayloadArray,
  tracePayloadPrimitive,
  tracePayloadRecord
} from '../traceClassification';
import type { TraceCategoryId } from '../traceClassification';

const COLLABORATION_TOOL_LABELS: Readonly<Record<string, string>> = {
  spawn_agent: 'Spawn Agent',
  send_message: 'Send Message',
  followup_task: 'Follow-up Task',
  interrupt_agent: 'Interrupt Agent',
  list_agents: 'List Agents',
  wait_agent: 'Wait for Agent Activity'
};

const RUNBOOK_TOOL_LABELS: Readonly<Record<string, string>> = {
  'runbook.list': 'Runbook List',
  'runbook.get': 'Runbook Get',
  'runbook.create': 'Runbook Creation',
  'runbook.append': 'Runbook Update'
};

const TRACE_SUMMARY_VERBS = new Set([
  'accept',
  'accepted',
  'allocate',
  'allocated',
  'ask',
  'asked',
  'block',
  'blocked',
  'call',
  'called',
  'compact',
  'compacted',
  'complete',
  'completed',
  'create',
  'created',
  'destroy',
  'destroyed',
  'enforce',
  'enforced',
  'execute',
  'executed',
  'export',
  'exported',
  'fail',
  'failed',
  'finish',
  'finished',
  'import',
  'imported',
  'inspect',
  'inspected',
  'pause',
  'paused',
  'plan',
  'planned',
  'prepare',
  'prepared',
  'read',
  'record',
  'recorded',
  'recover',
  'recovered',
  'request',
  'requested',
  'report',
  'reported',
  'resume',
  'resumed',
  'retry',
  'retried',
  'review',
  'reviewed',
  'run',
  'search',
  'send',
  'sent',
  'skip',
  'skipped',
  'start',
  'started',
  'stream',
  'streamed',
  'update',
  'updated',
  'verify',
  'verified'
]);
const DEFAULT_TRACE_PREVIEW_LINE_LIMIT = 5;
const SSH_OPTIONS_WITH_ARGUMENTS = new Set(['-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-P', '-p', '-R', '-S', '-W', '-w']);
const SSHPASS_OPTIONS_WITH_ARGUMENTS = new Set(['-d', '-f', '-p', '-P']);

export function traceEventSummary(event: TraceEventRecord, category: TraceCategoryId): string {
  return trimTraceLabelPeriod(rawTraceEventSummary(event, category));
}

export function trimTraceLabelPeriod(label: string): string {
  return label.replace(/(?<!\.)\.$/, '');
}

export function traceCategoryFallbackPrefix(category: TraceCategoryId): string {
  if (category === 'agent_output' || category === 'reasoning') return 'Report';
  if (category === 'tools') return 'Run';
  if (category === 'execution') return 'Execute';
  if (category === 'research') return 'Research';
  if (category === 'artifacts') return 'Record';
  if (category === 'verifier') return 'Verify';
  if (category === 'policy_scope') return 'Enforce';
  if (category === 'code_navigation') return 'Inspect';
  if (category === 'failure_recovery') return 'Review';
  return 'Note';
}

export function traceEventDetailText(event: TraceEventRecord, category: TraceCategoryId, detail: RunDetail | null = null): string {
  const text = tracePayloadPrimitive(event.payload, 'text') ?? tracePayloadPrimitive(event.payload, 'delta');
  if ((category === 'agent_output' || category === 'reasoning') && text) {
    return isReasoningTraceEvent(event, category) ? formatReasoningTraceText(text) : text.replace(/\r\n?/g, '\n').trim();
  }

  return tracePayloadDetailText(event, category, detail);
}

export function isHoneycrispToolObservationError(event: TraceEventRecord): boolean {
  if (honeycrispToolEventKind(event) !== 'tool.observed') return false;
  const payload = tracePayloadRecord(event.payload, 'payload');
  if (!payload) return false;
  const status = stringRecordValue(payload, 'status');
  return Boolean(tracePayloadRecord(payload, 'error') || stringRecordValue(payload, 'error') || status === 'error' || status === 'blocked');
}

export function honeycrispToolTraceSubtext(event: TraceEventRecord, detail: RunDetail | null = null): string {
  const payload = honeycrispEventToolPayload(event);
  if (!payload) return '';
  const toolName = honeycrispToolName(event);
  const inputs = tracePayloadRecord(payload, 'normalizedInputs');
  if (toolName === 'shell.run') {
    const result = tracePayloadRecord(payload, 'result');
    return shellCommandPreview(inputs) || shellCommandPreview(result);
  }
  if (!inputs) return '';
  if (toolName === 'memory.search') return stringRecordValue(inputs, 'query') ?? '';
  if (toolName === 'memory.save') {
    const result = tracePayloadRecord(payload, 'result');
    const memoryType = (result ? stringRecordValue(result, 'type') : null) ?? stringRecordValue(inputs, 'type');
    const status = (result ? stringRecordValue(result, 'status') : null) ?? stringRecordValue(inputs, 'status') ?? 'draft';
    return [memoryType, status].filter((value): value is string => Boolean(value)).map(traceLabel).join(' • ');
  }
  if (toolName === 'memory.link') {
    const fromId = stringRecordValue(inputs, 'fromId');
    const relation = stringRecordValue(inputs, 'relation');
    const toId = stringRecordValue(inputs, 'toId');
    return fromId && relation && toId ? `${fromId} → ${relation} → ${toId}` : '';
  }
  if (toolName === 'memory.correct') {
    const memoryId = stringRecordValue(inputs, 'id');
    if (!memoryId) return '';
    const memoryType = memoryTypeForGetTrace(event, memoryId, detail);
    const status = stringRecordValue(inputs, 'status');
    return [memoryType ? traceLabel(memoryType) : null, memoryId, status ? traceLabel(status) : null].filter((value): value is string => Boolean(value)).join(' · ');
  }
  if (toolName === 'runbook.list') return stringRecordValue(inputs, 'query') ?? 'All workspace runbooks';
  if (toolName === 'report.list') return stringRecordValue(inputs, 'query') ?? 'All workspace reports';
  if (toolName === 'runbook.get') return stringRecordValue(inputs, 'id') ?? '';
  if (toolName === 'runbook.create') {
    const result = tracePayloadRecord(payload, 'result');
    const title = (result ? stringRecordValue(result, 'title') : null) ?? stringRecordValue(inputs, 'title');
    const status = result ? stringRecordValue(result, 'status') : stringRecordValue(inputs, 'status');
    const revision = result ? numberRecordValue(result, 'revision') : null;
    return [title, status ? traceLabel(status) : null, revision ? `Update ${revision}` : null].filter((value): value is string => Boolean(value)).join(' · ');
  }
  if (toolName === 'runbook.append') {
    const result = tracePayloadRecord(payload, 'result');
    const id = stringRecordValue(inputs, 'id');
    const title = result ? stringRecordValue(result, 'title') : null;
    const status = result ? stringRecordValue(result, 'status') : stringRecordValue(inputs, 'status');
    const revision = result ? numberRecordValue(result, 'revision') : numberRecordValue(inputs, 'expectedRevision');
    return [title ?? id, status ? traceLabel(status) : null, revision ? `Update ${revision}` : null].filter((value): value is string => Boolean(value)).join(' · ');
  }
  if (toolName === 'file.read') return honeycrispToolEventKind(event) === 'tool.requested' ? stringRecordValue(inputs, 'path') ?? '' : '';
  if (toolName === 'spawn_agent') {
    const result = tracePayloadRecord(payload, 'result');
    const taskName = (result ? stringRecordValue(result, 'task_name') : null) ?? stringRecordValue(inputs, 'task_name');
    const forkTurns = (result ? stringRecordValue(result, 'fork_turns') : null) ?? stringRecordValue(inputs, 'fork_turns') ?? 'all';
    const model = (result ? stringRecordValue(result, 'model') : null) ?? stringRecordValue(inputs, 'model');
    const effort = (result ? stringRecordValue(result, 'reasoning_effort') : null) ?? stringRecordValue(inputs, 'reasoning_effort');
    return [taskName, inheritanceLabel(forkTurns), model, effort ? `${traceLabel(effort)} effort` : null].filter((value): value is string => Boolean(value)).join(' · ');
  }
  if (toolName === 'send_message' || toolName === 'followup_task') {
    const result = tracePayloadRecord(payload, 'result');
    const target = (result ? stringRecordValue(result, 'target') : null) ?? stringRecordValue(inputs, 'target');
    const triggeredTurn = result?.triggered_turn === true;
    return [target, toolName === 'followup_task' && result ? (triggeredTurn ? 'Turn started' : 'Queued') : null].filter((value): value is string => Boolean(value)).join(' · ');
  }
  if (toolName === 'interrupt_agent') {
    const result = tracePayloadRecord(payload, 'result');
    const target = (result ? stringRecordValue(result, 'target') : null) ?? stringRecordValue(inputs, 'target');
    const previousStatus = result ? stringRecordValue(result, 'previous_status') : null;
    return [target, previousStatus ? `Was ${traceLabel(previousStatus)}` : null].filter((value): value is string => Boolean(value)).join(' · ');
  }
  if (toolName === 'list_agents') {
    const prefix = stringRecordValue(inputs, 'path_prefix');
    const result = tracePayloadRecord(payload, 'result');
    const agents = result ? tracePayloadArray(result, 'agents') : null;
    const count = agents?.length;
    return [prefix ? `Under ${prefix}` : 'All agents', count === undefined ? null : `${count} agent${count === 1 ? '' : 's'}`].filter((value): value is string => Boolean(value)).join(' · ');
  }
  if (toolName === 'wait_agent') {
    const timeoutMs = numberRecordValue(inputs, 'timeout_ms') ?? 30_000;
    return `${formatDurationMilliseconds(timeoutMs)} timeout`;
  }
  if (toolName !== 'memory.get') return '';

  const memoryId = stringRecordValue(inputs, 'id');
  if (!memoryId) return '';
  const memoryType = memoryTypeForGetTrace(event, memoryId, detail);
  return memoryType ? `${traceLabel(memoryType)} · ${memoryId}` : memoryId;
}

export function honeycrispCollaborationTraceSummary(event: TraceEventRecord): string {
  const payload = honeycrispEventToolPayload(event);
  if (!payload) return '';
  const toolName = honeycrispToolName(event);
  const inputs = tracePayloadRecord(payload, 'normalizedInputs');
  if (!inputs) return '';
  if (toolName === 'spawn_agent' || toolName === 'send_message' || toolName === 'followup_task') {
    return stringRecordValue(inputs, 'message') ?? '';
  }
  if (toolName !== 'wait_agent' || honeycrispToolEventKind(event) !== 'tool.observed') return '';
  const result = tracePayloadRecord(payload, 'result');
  return result ? stringRecordValue(result, 'message') ?? '' : '';
}

export interface HoneycrispAgentListPreview {
  rows: string[];
  allRows: string[];
  count: number;
}

export function honeycrispAgentListResults(event: TraceEventRecord, maxRows = DEFAULT_TRACE_PREVIEW_LINE_LIMIT): HoneycrispAgentListPreview | null {
  if (honeycrispToolEventKind(event) !== 'tool.observed' || honeycrispToolName(event) !== 'list_agents') return null;
  const payload = honeycrispEventToolPayload(event);
  const result = payload ? tracePayloadRecord(payload, 'result') : null;
  const agents = result ? tracePayloadArray(result, 'agents') : null;
  if (!agents) return null;
  const allRows = agents.flatMap((value) => {
    if (!isRecord(value)) return [];
    const path = stringRecordValue(value, 'path');
    if (!path) return [];
    const status = stringRecordValue(value, 'status');
    const model = stringRecordValue(value, 'model');
    const effort = stringRecordValue(value, 'reasoning_effort');
    return [[path, status ? traceLabel(status) : null, model, effort ? `${traceLabel(effort)} effort` : null].filter((part): part is string => Boolean(part)).join(' · ')];
  });
  return { rows: allRows.slice(0, maxRows), allRows, count: allRows.length };
}

export function honeycrispMemoryCorrectionSummary(event: TraceEventRecord): string {
  const payload = honeycrispEventToolPayload(event);
  if (!payload || honeycrispToolName(event) !== 'memory.correct') return '';
  const inputs = tracePayloadRecord(payload, 'normalizedInputs');
  return inputs ? stringRecordValue(inputs, 'summary') ?? '' : '';
}

export function honeycrispMemorySaveSummary(event: TraceEventRecord): string {
  const payload = honeycrispEventToolPayload(event);
  if (!payload || honeycrispToolName(event) !== 'memory.save') return '';
  const result = tracePayloadRecord(payload, 'result');
  const inputs = tracePayloadRecord(payload, 'normalizedInputs');
  return (result ? stringRecordValue(result, 'summary') : null) ?? (inputs ? stringRecordValue(inputs, 'summary') : null) ?? '';
}

export function honeycrispMemoryLinkNote(event: TraceEventRecord): string {
  const payload = honeycrispEventToolPayload(event);
  if (!payload || honeycrispToolName(event) !== 'memory.link') return '';
  const inputs = tracePayloadRecord(payload, 'normalizedInputs');
  return inputs ? stringRecordValue(inputs, 'note') ?? '' : '';
}

export function honeycrispMemoryGetSummary(event: TraceEventRecord, detail: RunDetail | null = null): string {
  if (honeycrispToolName(event) !== 'memory.get') return '';
  const currentPayload = honeycrispEventToolPayload(event);
  const currentResult = currentPayload ? tracePayloadRecord(currentPayload, 'result') : null;
  const currentSummary = currentResult ? stringRecordValue(currentResult, 'summary') : null;
  if (currentSummary) return currentSummary;

  const pairingKey = honeycrispToolPairingKey(event);
  const observation = pairingKey
    ? detail?.traceEvents.find((candidate) => honeycrispToolEventKind(candidate) === 'tool.observed' && honeycrispToolPairingKey(candidate) === pairingKey)
    : null;
  const observationPayload = observation ? honeycrispEventToolPayload(observation) : null;
  const result = observationPayload ? tracePayloadRecord(observationPayload, 'result') : null;
  return result ? stringRecordValue(result, 'summary') ?? '' : '';
}

export function honeycrispToolTraceSubtextPill(event: TraceEventRecord): string | null {
  const payload = honeycrispEventToolPayload(event);
  if (!payload || honeycrispToolName(event) !== 'shell.run') return null;
  const inputs = tracePayloadRecord(payload, 'normalizedInputs');
  if (!inputs) return null;
  const utility = stringRecordValue(inputs, 'utility');
  if (!utility) return null;
  const args = tracePayloadArray(inputs, 'args')?.filter((value): value is string => typeof value === 'string') ?? [];
  return sshInvocationArguments(utility, args) ? 'SSH' : null;
}

export interface HoneycrispShellTraceStreamPreview {
  lines: string[];
  allLines: string[];
  lineCount: number;
  sourceTruncated: boolean;
  truncated: boolean;
}

export interface HoneycrispShellTraceOutput {
  stdout: HoneycrispShellTraceStreamPreview | null;
  stderr: string;
  stderrTruncated: boolean;
}

export function honeycrispShellTraceOutput(event: TraceEventRecord, maxLines = DEFAULT_TRACE_PREVIEW_LINE_LIMIT): HoneycrispShellTraceOutput | null {
  if (honeycrispToolEventKind(event) !== 'tool.observed' || honeycrispToolName(event) !== 'shell.run') return null;
  const payload = honeycrispEventToolPayload(event);
  const result = payload ? tracePayloadRecord(payload, 'result') : null;
  if (!result) return null;

  const stdout = shellOutputPreview(result.stdout, result.stdoutTruncated === true, maxLines);
  const stderr = shellOutputText(result.stderr);
  if (!stdout && !stderr) return null;
  return { stdout, stderr, stderrTruncated: result.stderrTruncated === true };
}

function shellOutputText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : '';
}

function shellOutputPreview(value: unknown, sourceTruncated: boolean, maxLines: number): HoneycrispShellTraceStreamPreview | null {
  const normalized = shellOutputText(value);
  if (!normalized) return null;
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const visibleLines = lines.slice(0, Math.max(0, maxLines));
  return {
    lines: visibleLines,
    allLines: lines,
    lineCount: lines.length,
    sourceTruncated,
    truncated: sourceTruncated || visibleLines.length < lines.length
  };
}

function shellCommandPreview(record: Record<string, unknown> | null): string {
  if (!record) return '';
  const command = stringRecordValue(record, 'command');
  if (command) return oneLineShellCommand(command);
  const utility = stringRecordValue(record, 'utility');
  if (!utility) return '';
  const args = tracePayloadArray(record, 'args')?.filter((value): value is string => typeof value === 'string') ?? [];
  const wrappedCommand = shellWrappedCommand(utility, args);
  if (wrappedCommand !== null) return oneLineShellCommand(wrappedCommand);
  const sshCommand = sshRemoteCommand(utility, args);
  if (sshCommand !== null) return oneLineShellCommand(sshCommand);
  return oneLineShellCommand([utility, ...args.map(shellArgumentPreview)].join(' '));
}

function shellWrappedCommand(utility: string, args: string[]): string | null {
  if (!['sh', 'bash', 'dash', 'ksh', 'zsh'].includes(executableName(utility))) return null;
  const commandFlagIndex = args.findIndex((argument) => argument === '-c' || /^-[^-]*c[^-]*$/u.test(argument));
  return commandFlagIndex >= 0 ? args[commandFlagIndex + 1]?.trim() ?? '' : null;
}

function sshRemoteCommand(utility: string, args: string[]): string | null {
  const sshArgs = sshInvocationArguments(utility, args);
  if (!sshArgs) return null;

  let index = 0;
  while (index < sshArgs.length) {
    const argument = sshArgs[index];
    if (argument === '--') {
      index += 1;
      break;
    }
    if (!argument.startsWith('-') || argument === '-') break;
    if (SSH_OPTIONS_WITH_ARGUMENTS.has(argument)) index += 2;
    else index += 1;
  }

  if (index >= sshArgs.length) return '';
  const remoteCommand = sshArgs.slice(index + 1).join(' ').trim();
  return remoteCommand;
}

function sshInvocationArguments(utility: string, args: string[]): string[] | null {
  const utilityName = executableName(utility);
  if (utilityName === 'ssh') return args;
  if (utilityName !== 'sshpass') return null;

  let index = 0;
  while (index < args.length) {
    const argument = args[index];
    if (argument === '--') {
      index += 1;
      break;
    }
    if (!argument.startsWith('-') || argument === '-') break;
    if (SSHPASS_OPTIONS_WITH_ARGUMENTS.has(argument)) index += 2;
    else index += 1;
  }
  if (index >= args.length || executableName(args[index]) !== 'ssh') return null;
  return args.slice(index + 1);
}

function executableName(command: string): string {
  return command.split('/').pop() ?? command;
}

function shellArgumentPreview(value: string): string {
  return /\s/u.test(value) ? JSON.stringify(value) : value;
}

function oneLineShellCommand(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function isEmptyHoneycrispMemorySearchObservation(event: TraceEventRecord): boolean {
  if (honeycrispToolEventKind(event) !== 'tool.observed' || honeycrispToolName(event) !== 'memory.search' || isHoneycrispToolObservationError(event)) return false;
  const payload = honeycrispEventToolPayload(event);
  return Boolean(payload && Array.isArray(payload.result) && payload.result.length === 0);
}

export interface HoneycrispMemorySearchResultsPreview {
  titles: string[];
  allTitles: string[];
  resultCount: number;
  truncated: boolean;
}

export function honeycrispMemorySearchResults(
  event: TraceEventRecord,
  maxResults = DEFAULT_TRACE_PREVIEW_LINE_LIMIT
): HoneycrispMemorySearchResultsPreview | null {
  if (honeycrispToolEventKind(event) !== 'tool.observed' || honeycrispToolName(event) !== 'memory.search' || isHoneycrispToolObservationError(event)) return null;
  const payload = honeycrispEventToolPayload(event);
  const result = payload?.result;
  if (!Array.isArray(result) || result.length === 0) return null;

  const allTitles = result.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const title = stringRecordValue(item as Record<string, unknown>, 'title')?.trim();
    return title ? [title] : [];
  });
  if (allTitles.length === 0) return null;

  const titles = allTitles.slice(0, Math.max(0, maxResults));
  return {
    titles,
    allTitles,
    resultCount: allTitles.length,
    truncated: titles.length < allTitles.length
  };
}

export function hasStructuredProseTraceDetail(event: TraceEventRecord, detail: RunDetail | null = null): boolean {
  void detail;
  return event.type === 'research_event';
}

export interface PythonToolCallPreview {
  task: string;
  scriptLines: string[];
  scriptLineCount: number;
  truncated: boolean;
  outputLines: string[];
  outputLineCount: number;
  outputTruncated: boolean;
  exitCode: string | null;
}

export interface PythonTraceScript {
  task: string;
  script: string;
}

export interface ReasoningTraceSummarySegment {
  title: string | null;
  description: string;
}

export interface TraceStructuredPreview {
  title: string;
  description: string;
  facts: string[];
}

export interface CodeBrowserTracePreview {
  title: string;
  description: string;
  facts: string[];
  excerptLines: string[];
  excerptAllLines: string[];
  excerptLineCount: number;
  excerptSourceTruncated: boolean;
  excerptTruncated: boolean;
}

export interface SearchTracePreview {
  title: string;
  description: string;
  facts: string[];
}

export function isProseTraceEvent(event: TraceEventRecord, category: TraceCategoryId, detail: RunDetail | null = null): boolean {
  if (hasStructuredProseTraceDetail(event, detail)) return true;

  const text = tracePayloadPrimitive(event.payload, 'text') ?? tracePayloadPrimitive(event.payload, 'delta');
  if (!text) return false;
  if (tracePayloadPrimitive(event.payload, 'transcriptSource') === 'openai_reasoning_summary') return true;
  if (tracePayloadPrimitive(event.payload, 'transcriptKind') === 'reasoning_summary') return true;
  if (tracePayloadPrimitive(event.payload, 'claimStatus') === 'reasoning_summary') return true;
  if (tracePayloadPrimitive(event.payload, 'transcriptRole') === 'assistant') return true;
  if (tracePayloadPrimitive(event.payload, 'transcriptKind') === 'agent_output') return true;
  return category === 'agent_output' && event.source === 'model';
}

export function isReasoningTraceEvent(event: TraceEventRecord, category: TraceCategoryId): boolean {
  return (
    category === 'reasoning' ||
    tracePayloadPrimitive(event.payload, 'transcriptSource') === 'openai_reasoning_summary' ||
    tracePayloadPrimitive(event.payload, 'transcriptKind') === 'reasoning_summary' ||
    tracePayloadPrimitive(event.payload, 'claimStatus') === 'reasoning_summary' ||
    event.summary === 'Reasoning.' ||
    event.summary === 'Reasoning'
  );
}

export function reasoningTraceSummariesForEvent(event: TraceEventRecord, category: TraceCategoryId): ReasoningTraceSummarySegment[] {
  if (!isReasoningTraceEvent(event, category)) return [];
  const summaryTexts = (tracePayloadArray(event.payload, 'reasoningSummaryTexts') ?? []).filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  if (summaryTexts.length > 0) {
    return uniqueReasoningSummarySegments(summaryTexts.flatMap((text) => reasoningTraceSummariesFromText(text)));
  }
  const text = tracePayloadPrimitive(event.payload, 'text') ?? tracePayloadPrimitive(event.payload, 'delta');
  return text ? reasoningTraceSummariesFromText(text) : [];
}

function uniqueReasoningSummarySegments(segments: ReasoningTraceSummarySegment[]): ReasoningTraceSummarySegment[] {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    const key = `${segment.title ?? ''}\u0000${segment.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function pythonToolCallPreview(event: TraceEventRecord, maxLines = DEFAULT_TRACE_PREVIEW_LINE_LIMIT): PythonToolCallPreview | null {
  if (event.type !== 'tool_call') return null;
  const script = pythonTraceScript(event, null);
  return script ? pythonPreviewFromScript(script, null, maxLines) : null;
}

export function pythonTracePreview(event: TraceEventRecord, detail: RunDetail | null = null, maxLines = DEFAULT_TRACE_PREVIEW_LINE_LIMIT): PythonToolCallPreview | null {
  if (!isPythonExecutionTraceEvent(event)) return null;
  const script = pythonTraceScript(event, detail);
  return script ? pythonPreviewFromScript(script, event, maxLines) : null;
}

export function pythonTraceScript(event: TraceEventRecord, detail: RunDetail | null = null): PythonTraceScript | null {
  const args = pythonArgumentsForTraceEvent(event, detail);
  if (!args) return null;

  const task = tracePayloadPrimitive(event.payload, 'task') ?? stringRecordValue(args, 'task') ?? '';
  const scriptValue = args.script;
  const script = typeof scriptValue === 'string' ? scriptValue.replace(/\r\n?/g, '\n').trim() : '';
  if (!task && !script) return null;

  return { task, script };
}

export function verifierTracePreview(event: TraceEventRecord): TraceStructuredPreview | null {
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  if (event.type === 'tool_call' && toolName === 'verifier') {
    const args = tracePayloadRecord(event.payload, 'arguments');
    if (!args) return null;
    const contractId = stringRecordValue(args, 'contractId');
    const mode = stringRecordValue(args, 'mode');
    return {
      title: 'Verifier prepared',
      description: mode ? `${traceLabel(mode)} verifier request prepared.` : 'Verifier request prepared.',
      facts: [
        contractId ? `Contract ${contractId}` : null
      ].filter((part): part is string => Boolean(part))
    };
  }

  if (event.type !== 'verifier_result' && event.source !== 'verifier') return null;
  const status = tracePayloadPrimitive(event.payload, 'status') ?? verifierStatusFromSummary(event.summary) ?? 'recorded';
  const substrate = verifierExecutionSubstrate(event.payload);
  const artifactRecorded = Boolean(tracePayloadPrimitive(event.payload, 'artifactId'));
  const blockedIssue = tracePayloadPrimitive(event.payload, 'blockedIssue');
  const issues = tracePayloadArray(event.payload, 'issues');
  return {
    title: traceLabel(status).toUpperCase(),
    description: [substrate, tracePayloadPrimitive(event.payload, 'realExecution') === 'true' ? 'real execution' : null, artifactRecorded ? 'output artifact recorded' : null]
      .filter(Boolean)
      .join(' · '),
    facts: [blockedIssue ? `Blocked: ${traceLabel(blockedIssue)}` : null, firstArrayPart('Issue', issues)].filter((part): part is string => Boolean(part))
  };
}

export function codeBrowserTracePreview(event: TraceEventRecord, maxLines = DEFAULT_TRACE_PREVIEW_LINE_LIMIT): CodeBrowserTracePreview | null {
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  if (event.type === 'tool_call' && toolName === 'code_browser') {
    const args = tracePayloadRecord(event.payload, 'arguments');
    if (!args) return null;
    const path = stringRecordValue(args, 'path');
    const symbol = stringRecordValue(args, 'symbol');
    return {
      title: path ? compactTracePath(path) : 'Code browser request',
      description: symbol ? `Symbol ${symbol}` : 'Source read prepared.',
      facts: [rangePart(args), policyPart(event.payload)].filter((part): part is string => Boolean(part)),
      excerptLines: [],
      excerptAllLines: [],
      excerptLineCount: 0,
      excerptSourceTruncated: false,
      excerptTruncated: false
    };
  }

  const honeycrispFileRead = honeycrispFileReadPreview(event, maxLines);
  if (honeycrispFileRead) return honeycrispFileRead;

  if (event.type !== 'tool_result' && event.type !== 'artifact_created') return null;
  const isCodeBrowserEvent = toolName === 'code_browser' || /^Code browser\b/i.test(event.summary);
  if (!isCodeBrowserEvent) return null;

  const sourcePath = tracePayloadPrimitive(event.payload, 'sourcePath') ?? tracePayloadPrimitive(event.payload, 'path');
  const excerpt = tracePayloadPrimitive(event.payload, 'excerpt') ?? '';
  const excerptLines = excerpt ? excerpt.replace(/\r\n?/g, '\n').trim().split('\n').filter(Boolean) : [];
  const visibleExcerptLines = excerptLines.slice(0, maxLines);
  const boundedLineCount = boundedLineCountFromSummary(event.summary) ?? excerptLines.length;
  const reason = tracePayloadPrimitive(event.payload, 'reason') ?? tracePayloadPrimitive(event.payload, 'error');
  const status = tracePayloadPrimitive(event.payload, 'status');
  const symbol = tracePayloadPrimitive(event.payload, 'symbol');
  return {
    title: sourcePath ? compactTracePath(sourcePath) : 'Code browser result',
    description: reason ? traceLabel(reason) : status && status !== 'success' ? traceLabel(status) : '',
    facts: [
      lineRangePart(event.payload),
      boundedLineCount > 0 ? `${boundedLineCount} line${boundedLineCount === 1 ? '' : 's'}` : null,
      symbol ? `symbol ${symbol}` : null,
      tracePayloadPrimitive(event.payload, 'largeFile') === 'true' ? 'large file' : null,
      tracePayloadPrimitive(event.payload, 'nextLineStart') ? `next line ${tracePayloadPrimitive(event.payload, 'nextLineStart')}` : null,
      traceBooleanPart('truncated', tracePayloadPrimitive(event.payload, 'truncated'))
    ].filter((part): part is string => Boolean(part)),
    excerptLines: visibleExcerptLines,
    excerptAllLines: excerptLines,
    excerptLineCount: boundedLineCount,
    excerptSourceTruncated: tracePayloadPrimitive(event.payload, 'truncated') === 'true',
    excerptTruncated: excerptLines.length > visibleExcerptLines.length || tracePayloadPrimitive(event.payload, 'truncated') === 'true'
  };
}

export function searchTracePreview(event: TraceEventRecord): SearchTracePreview | null {
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  if (event.type === 'tool_call' && toolName === 'search') {
    const args = tracePayloadRecord(event.payload, 'arguments');
    if (!args) return null;
    const query = stringRecordValue(args, 'query');
    const target = stringRecordValue(args, 'target');
    return {
      title: 'Search prepared',
      description: query ?? 'Scoped search prepared.',
      facts: [target ? compactTracePath(target) : null, policyPart(event.payload)].filter((part): part is string => Boolean(part))
    };
  }

  const honeycrispSearch = honeycrispRepositorySearchPreview(event);
  if (honeycrispSearch) return honeycrispSearch;

  if (event.type !== 'tool_result') return null;
  const query = tracePayloadPrimitive(event.payload, 'query');
  const counts = searchCountsFromTraceEvent(event);
  const isSearchResult = toolName === 'search' || Boolean(query && counts);
  if (!isSearchResult) return null;
  const matchCount = counts?.matches ?? tracePayloadArray(event.payload, 'matches')?.length ?? 0;
  const filesConsidered = counts?.files ?? numberPayloadValue(event.payload, 'filesConsidered');
  const target = tracePayloadPrimitive(event.payload, 'targetHint');
  const metadataMatches = numberPayloadValue(event.payload, 'metadataMatches');
  const semanticMatches = numberPayloadValue(event.payload, 'semanticMatches');
  const graphMatches = numberPayloadValue(event.payload, 'graphMatches');
  return {
    title: query ? `Search ${truncateText(query, 64)}` : 'Search result',
    description: `${matchCount} match${matchCount === 1 ? '' : 'es'}`,
    facts: [
      filesConsidered !== null ? `${filesConsidered} file${filesConsidered === 1 ? '' : 's'}` : null,
      target ? compactTracePath(target) : null,
      metadataMatches && metadataMatches > 0 ? `${metadataMatches} metadata` : null,
      semanticMatches && semanticMatches > 0 ? `${semanticMatches} semantic` : null,
      graphMatches && graphMatches > 0 ? `${graphMatches} graph` : null
    ].filter((part): part is string => Boolean(part))
  };
}

function honeycrispFileReadPreview(event: TraceEventRecord, maxLines: number): CodeBrowserTracePreview | null {
  if (event.type !== 'tool_result' && event.type !== 'artifact_created') return null;
  const toolPayload = honeycrispToolPayload(event, 'file.read');
  if (!toolPayload) return null;
  const result = tracePayloadRecord(toolPayload, 'result');
  const inputs = tracePayloadRecord(toolPayload, 'normalizedInputs');
  const sourcePath = stringRecordValue(result ?? {}, 'resolvedPath') ?? stringRecordValue(result ?? {}, 'requestedPath') ?? stringRecordValue(inputs ?? {}, 'path');
  const text = typeof result?.text === 'string' ? result.text : '';
  const allExcerptLines = splitHoneycrispExcerptLines(text);
  const visibleExcerptLines = allExcerptLines.slice(0, maxLines);
  const bytesRead = numberPayloadValue(result ?? {}, 'bytesRead');
  const offset = numberPayloadValue(result ?? {}, 'offset');
  const status = stringRecordValue(toolPayload, 'status');
  const truncated = stringRecordValue(result ?? {}, 'truncated') === 'true';
  const containsNulByte = stringRecordValue(result ?? {}, 'containsNulByte') === 'true';

  return {
    title: sourcePath ? compactTracePath(sourcePath) : 'File read result',
    description: status && status !== 'complete' ? traceLabel(status) : '',
    facts: [
      bytesRead !== null ? `${bytesRead} byte${bytesRead === 1 ? '' : 's'}` : null,
      offset && offset > 0 ? `offset ${offset}` : null,
      stringRecordValue(result ?? {}, 'encoding') ?? null,
      containsNulByte ? 'contains NUL' : null,
      traceBooleanPart('truncated', truncated ? 'true' : null)
    ].filter((part): part is string => Boolean(part)),
    excerptLines: visibleExcerptLines,
    excerptAllLines: allExcerptLines,
    excerptLineCount: allExcerptLines.length,
    excerptSourceTruncated: truncated,
    excerptTruncated: allExcerptLines.length > visibleExcerptLines.length || truncated
  };
}

function honeycrispRepositorySearchPreview(event: TraceEventRecord): SearchTracePreview | null {
  if (event.type !== 'tool_result') return null;
  const toolPayload = honeycrispToolPayload(event, 'repository.search');
  if (!toolPayload) return null;
  const result = tracePayloadRecord(toolPayload, 'result');
  const inputs = tracePayloadRecord(toolPayload, 'normalizedInputs');
  const query = stringRecordValue(result ?? {}, 'query') ?? stringRecordValue(inputs ?? {}, 'query');
  const matches = tracePayloadArray(result ?? {}, 'matches');
  const roots = tracePayloadArray(result ?? {}, 'roots');
  const matchCount = matches?.length ?? 0;
  const path = stringRecordValue(inputs ?? {}, 'path') ?? firstStringArrayValue(roots);
  const status = stringRecordValue(toolPayload, 'status');

  return {
    title: query ? `Search ${truncateText(query, 64)}` : 'Repository search result',
    description: status && status !== 'complete' ? traceLabel(status) : `${matchCount} match${matchCount === 1 ? '' : 'es'}`,
    facts: [
      roots ? `${roots.length} context root${roots.length === 1 ? '' : 's'}` : null,
      path ? compactTracePath(path) : null,
      stringRecordValue(inputs ?? {}, 'maxResults') ? `limit ${stringRecordValue(inputs ?? {}, 'maxResults')}` : null
    ].filter((part): part is string => Boolean(part))
  };
}

export function isPythonExecutionTraceEvent(event: TraceEventRecord): boolean {
  if (event.type !== 'tool_result' && event.type !== 'artifact_created') return false;
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  return toolName === 'python' || /^(Host|Guest) python operation finished with /i.test(event.summary);
}

function verifierExecutionSubstrate(payload: Record<string, unknown>): string {
  if (tracePayloadPrimitive(payload, 'vmExecution') === 'true') return 'Disposable sandbox verifier';
  if (tracePayloadPrimitive(payload, 'hostExecution') === 'true') return 'Host verifier';
  if (tracePayloadPrimitive(payload, 'realExecution') === 'true') return 'Real verifier';
  return 'Verifier review';
}

function verifierStatusFromSummary(summary: string): string | null {
  const match = summary.match(/^Verifier contract executed (?:in disposable (?:VM|sandbox)|on host|with) with ([^.]+)\./i);
  return match?.[1]?.trim() || null;
}

function honeycrispToolPayload(event: TraceEventRecord, expectedToolName: string): Record<string, unknown> | null {
  const kind = tracePayloadPrimitive(event.payload, 'honeycrispKind');
  if (kind !== 'tool.observed' && kind !== 'tool.requested') return null;
  const payload = tracePayloadRecord(event.payload, 'payload');
  if (!payload) return null;
  return stringRecordValue(payload, 'toolName') === expectedToolName ? payload : null;
}

function splitHoneycrispExcerptLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return normalized ? normalized.split('\n') : [];
}

function firstStringArrayValue(values: unknown[] | null): string | null {
  if (!values) return null;
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function boundedLineCountFromSummary(summary: string): number | null {
  const match = summary.match(/^Code browser returned (\d+) bounded lines?\.$/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

function searchCountsFromTraceEvent(event: TraceEventRecord): { files: number; matches: number } | null {
  const match =
    event.summary.match(/^Search examined (\d+) scoped files? and returned (\d+) match(?:es)?\.$/i) ??
    event.summary.match(/^Examined (\d+) files? and returned (\d+) match(?:es)?\.$/i);
  if (!match) return null;
  const files = Number(match[1]);
  const matches = Number(match[2]);
  return Number.isFinite(files) && Number.isFinite(matches) ? { files, matches } : null;
}

function numberPayloadValue(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pythonPreviewFromScript({ task, script }: PythonTraceScript, event: TraceEventRecord | null, maxLines: number): PythonToolCallPreview | null {
  const allScriptLines = script ? script.split('\n') : [];
  const scriptLines = allScriptLines.slice(0, maxLines);
  const truncated = allScriptLines.length > scriptLines.length;
  const output = event ? pythonExecutionOutput(event, maxLines) : null;
  if (!task && scriptLines.length === 0 && !output) return null;

  return {
    task,
    scriptLines,
    scriptLineCount: allScriptLines.length,
    truncated,
    outputLines: output?.lines ?? [],
    outputLineCount: output?.lineCount ?? 0,
    outputTruncated: output?.truncated ?? false,
    exitCode: output?.exitCode ?? null
  };
}

function pythonExecutionOutput(event: TraceEventRecord, maxLines: number): { lines: string[]; lineCount: number; truncated: boolean; exitCode: string | null } {
  const stdout = tracePayloadPrimitive(event.payload, 'stdoutSummary') ?? '';
  const stderr = tracePayloadPrimitive(event.payload, 'stderrSummary') ?? '';
  const text = formatPythonExecutionOutput(stdout, stderr);
  const allLines = text.split('\n');
  const lines = allLines.slice(0, maxLines);
  return {
    lines,
    lineCount: allLines.length,
    truncated: allLines.length > lines.length,
    exitCode: tracePayloadPrimitive(event.payload, 'exitCode')
  };
}

function formatPythonExecutionOutput(stdout: string, stderr: string): string {
  const cleanStdout = stdout.replace(/\r\n?/g, '\n').trim();
  const cleanStderr = stderr.replace(/\r\n?/g, '\n').trim();
  if (cleanStdout && cleanStderr) return `stdout:\n${cleanStdout}\n\nstderr:\n${cleanStderr}`;
  if (cleanStdout) return cleanStdout;
  if (cleanStderr) return cleanStderr;
  return 'No output recorded.';
}

function pythonArgumentsForTraceEvent(event: TraceEventRecord, detail: RunDetail | null): Record<string, unknown> | null {
  if (isPythonToolCallEvent(event)) return tracePayloadRecord(event.payload, 'arguments');
  if (!isPythonExecutionTraceEvent(event)) return null;

  const directArgs = tracePayloadRecord(event.payload, 'arguments');
  if (directArgs) return directArgs;
  if (!detail || !event.toolCallId) return null;

  const toolCall = detail.traceEvents.find((candidate) => candidate.id !== event.id && candidate.toolCallId === event.toolCallId && isPythonToolCallEvent(candidate));
  return toolCall ? tracePayloadRecord(toolCall.payload, 'arguments') : null;
}

function isPythonToolCallEvent(event: TraceEventRecord): boolean {
  if (event.type !== 'tool_call') return false;
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  return toolName === 'python';
}

export function formatReasoningTraceText(text: string): string {
  return reasoningTraceSummariesFromText(text)
    .map((segment) => {
      if (!segment.title) return segment.description;
      return segment.description ? `**${segment.title}**\n${segment.description}` : `**${segment.title}**`;
    })
    .join('\n\n');
}

export function reasoningTraceSummariesFromText(text: string): ReasoningTraceSummarySegment[] {
  const summaries: ReasoningTraceSummarySegment[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  const flushCurrent = (): void => {
    const description = currentLines.join(' ').trim();
    if (currentTitle || description) summaries.push({ title: currentTitle, description });
    currentTitle = null;
    currentLines = [];
  };

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/[ \t]+/g, ' ').trim();
    if (!line) continue;

    const heading = line.match(/^\*\*([^*]+?)\*\*\s*(.*)$/);
    if (heading) {
      flushCurrent();
      const title = heading[1].trim();
      const description = heading[2].trim();
      currentTitle = title || null;
      currentLines = description ? [description] : [];
      continue;
    }

    currentLines.push(line);
  }

  flushCurrent();
  return summaries;
}

export function compactTracePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.length <= 68) return normalized;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return `...${normalized.slice(-64)}`;
  return `.../${parts.slice(-3).join('/')}`;
}

function rawTraceEventSummary(event: TraceEventRecord, category: TraceCategoryId): string {
  const summary = event.summary.trim();
  if (!summary) return traceCategoryFallbackPrefix(category);
  if (event.type === 'tool_call') {
    const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(summary);
    if (toolName === 'python') return /^OpenAI requested Beale tool: python\.$/i.test(summary) ? 'Queue Python' : 'Prepare Python';
    if (toolName === 'verifier') return /^OpenAI requested Beale tool: verifier\.$/i.test(summary) ? 'Queue Verifier' : 'Prepare Verifier';
    if (toolName === 'code_browser') return /^OpenAI requested Beale tool: code_browser\.$/i.test(summary) ? 'Queue Code Browser' : 'Prepare Code Browser';
    if (toolName === 'resource_lookup') return /^OpenAI requested Beale tool: resource_lookup\.$/i.test(summary) ? 'Queue Resource Lookup' : 'Prepare Resource Lookup';
    if (toolName === 'search') return /^OpenAI requested Beale tool: search\.$/i.test(summary) ? 'Queue Search' : 'Prepare Search';
  }

  if (summary === 'OpenAI streamed model output delta.') return 'Model Output';
  if (summary === 'OpenAI response completed.') return 'Response Completed';
  if (summary === 'OpenAI response created.') return 'Turn Started';
  if (summary === 'OpenAI completed a model output item.') return 'Complete model output';
  if (summary === 'Report agent output.' || summary === 'Report agent output') return 'Agent Response';
  if (summary === 'Reasoning.' || summary === 'Reasoning') return 'Reasoning';
  if (summary === 'OpenAI adapter prepared host-only model session.') return 'Prepare host-only model session';
  if (summary === 'OpenAI Responses run started from markdown prompt.') return 'Start run from prompt';
  if (summary === 'OpenAI run blocked because no host credential is configured.') return 'Block run: missing host credential';
  if (summary === 'OpenAI run resume blocked because no host credential is configured.') return 'Block resume: missing host credential';
  if (summary === 'OpenAI run resumed from compacted Beale replay context.') return 'Resume run from compacted replay';
  if (summary === 'OpenAI run resumed from persisted Responses state.') return 'Resume run from persisted state';
  if (summary === 'OpenAI compacted retry recovered from context window pressure.') return 'Recover compacted retry';
  if (summary === 'OpenAI previous response state was unavailable; retrying with compacted Beale replay context.') return 'Retry with compacted replay';
  if (summary === 'OpenAI backend rejected previous_response_id; retrying with compacted Beale replay context.') return 'Retry with compacted replay';
  if (
    summary === 'Provider context window pressure triggered a Honeycrisp compacted retry.'
    || summary === 'OpenAI context window pressure triggered compacted retry.'
  ) return 'Compact context for retry';
  if (summary === 'OpenAI Responses run failed.') return 'Fail Responses run';
  if (/^Honeycrisp tool\.requested(?::|$)/.test(summary)) return honeycrispToolTraceTitle(event, summary, 'Requested');
  if (/^Honeycrisp tool\.observed(?::|$)/.test(summary)) return honeycrispToolTraceTitle(event, summary, 'Observed');
  if (/^Honeycrisp context\.compiled(?::|$)/i.test(summary)) return 'Honeycrisp Context Compiled';
  if (summary === 'Context compacted for long-running session.') return 'Compact context for long-running session';
  if (summary === 'Workspace recovery paused interrupted run after app restart.') return 'Pause interrupted run after restart';
  if (summary === 'Run started from markdown prompt.') return 'Start run from prompt';
  if (summary === 'Fake executor allocated a simulated disposable VM context.' || summary === 'Fake executor allocated a simulated disposable sandbox context.') return 'Allocate simulated sandbox context';
  if (summary === 'Simulated model planned an open-ended discovery pass.') return 'Plan discovery pass';
  if (summary === 'No network request was sent.') return 'Skip network request';
  if (summary === 'Verifier failed to destroy guest after execution.') return 'Review verifier cleanup failure';
  if (summary === 'VM executor alpha failed to destroy guest after run failure.' || summary === 'Sandbox executor alpha failed to destroy context after run failure.') return 'Review sandbox cleanup failure';
  if (summary === 'VM executor alpha run failed.' || summary === 'Sandbox executor alpha run failed.') return 'Fail sandbox executor run';
  if (summary === 'VM executor alpha run started from markdown prompt.' || summary === 'Sandbox executor alpha run started from markdown prompt.') return 'Start sandbox executor run';
  let match = summary.match(/^OpenAI Responses request sent for turn (\d+)\.$/);
  if (match) return `Request for Turn ${match[1]}`;
  match = summary.match(/^OpenAI completed function call arguments for ([^.]+)\.$/);
  if (match?.[1] === 'python') return 'Prepare Python';
  if (match?.[1] === 'verifier') return 'Prepare Verifier';
  if (match?.[1] === 'code_browser') return 'Prepare Code Browser';
  if (match?.[1] === 'resource_lookup') return 'Prepare Resource Lookup';
  if (match?.[1] === 'search') return 'Prepare Search';
  if (match) return `Call ${match[1]}`;
  match = summary.match(/^Search examined (\d+) scoped files? and returned (\d+) match(?:es)?\.$/i);
  if (match) return `Examined ${match[1]} file${match[1] === '1' ? '' : 's'} and returned ${match[2]} match${match[2] === '1' ? '' : 'es'}`;
  match = summary.match(/^Examined (\d+) files? and returned (\d+) match(?:es)?\.$/i);
  if (match) return `Examined ${match[1]} file${match[1] === '1' ? '' : 's'} and returned ${match[2]} match${match[2] === '1' ? '' : 'es'}`;
  match = summary.match(/^Code browser returned \d+ bounded lines?\.$/i);
  if (match) return 'Read Code';
  if (summary === 'Code browser could not read the requested bounded text.') return 'Code Browser Error';
  if (summary === 'Code browser requires a scoped file path or artifact id.') return 'Code Browser Error';
  match = summary.match(/^Guest ([\w -]+) operation sent to (?:VM|sandbox) executor\.$/i);
  if (match) return `Send ${match[1].toLowerCase()} operation to sandbox`;
  match = summary.match(/^Guest ([\w -]+) operation finished with ([^.]+)\.$/i);
  if (match?.[1].toLowerCase() === 'python') return `Run Python: ${match[2]}`;
  if (match) return `Finish ${match[1].toLowerCase()} operation: ${match[2]}`;
  match = summary.match(/^Host ([\w -]+) operation finished with ([^.]+)\.$/i);
  if (match?.[1].toLowerCase() === 'python') return `Run Python: ${match[2]}`;
  if (match) return `Finish host ${match[1].toLowerCase()} operation: ${match[2]}`;
  match = summary.match(/^Host debugger wrapper operation finished with ([^.]+)\.$/i);
  if (match) return `Finish host debugger wrapper: ${match[1]}`;
  match = summary.match(/^Debugger wrapper operation finished with ([^.]+)\.$/i);
  if (match) return `Finish debugger wrapper: ${match[1]}`;
  match = summary.match(/^Guest artifact exported and accepted: (.+)\.$/);
  if (match) return `Accept exported artifact: ${match[1]}`;
  match = summary.match(/^Verifier contract executed in disposable (?:VM|sandbox) with ([^.]+)\.$/);
  if (match) return 'Verifier Execution';
  match = summary.match(/^Verifier contract executed on host with ([^.]+)\.$/);
  if (match) return 'Verifier Execution';
  match = summary.match(/^Verifier contract executed with ([^.;]+);/);
  if (match) return 'Verifier Execution';
  match = summary.match(/^Verifier recorded ([^.;]+) result;/);
  if (match) return `Record verifier result: ${match[1]}`;
  match = summary.match(/^Fixture branch recorded: (.+)\.$/);
  if (match) return `Record fixture branch: ${match[1]}`;
  match = summary.match(/^Requested (.+)\.$/);
  if (match) return `Request ${match[1]}`;
  match = summary.match(/^Artifact recorded: (.+)\.$/);
  if (match) return `Record artifact: ${match[1]}`;
  match = summary.match(/^Policy engine blocked (.+)\.$/);
  if (match) return `Block ${match[1]}`;
  match = summary.match(/^Paused after (.+)\.$/);
  if (match) return `Pause after ${match[1]}`;

  if (startsWithTraceVerb(summary)) return summary;
  return `${traceCategoryFallbackPrefix(category)}: ${summary}`;
}

function honeycrispToolTraceTitle(event: TraceEventRecord, summary: string, action: 'Requested' | 'Observed'): string {
  const nestedPayload = tracePayloadRecord(event.payload, 'payload');
  const toolName =
    tracePayloadPrimitive(event.payload, 'toolName') ??
    (nestedPayload ? stringRecordValue(nestedPayload, 'toolName') : null) ??
    honeycrispToolNameFromSummary(summary);
  const collaborationLabel = toolName ? COLLABORATION_TOOL_LABELS[toolName] : undefined;
  const runbookLabel = toolName ? RUNBOOK_TOOL_LABELS[toolName] : undefined;
  const label = toolName === 'shell.run'
    ? 'Shell'
    : toolName === 'memory.correct'
      ? 'Memory Correction'
      : runbookLabel ?? collaborationLabel ?? (toolName ? traceLabel(toolName.replace(/[^a-zA-Z0-9]+/g, '_')) : 'Tool');
  return action === 'Requested' ? `${label} Requested` : label;
}

function honeycrispToolNameFromSummary(summary: string): string | null {
  const match = summary.match(/^Honeycrisp tool\.(?:requested|observed):\s*([a-zA-Z][a-zA-Z0-9_.-]*?)\s*\.?$/);
  return match?.[1] ?? null;
}

function inheritanceLabel(forkTurns: string): string {
  if (forkTurns === 'all') return 'Full context';
  if (forkTurns === 'none') return 'Fresh context';
  return `Last ${forkTurns} turn${forkTurns === '1' ? '' : 's'}`;
}

function formatDurationMilliseconds(milliseconds: number): string {
  if (milliseconds >= 1_000 && milliseconds % 1_000 === 0) return `${milliseconds / 1_000}s`;
  return `${milliseconds}ms`;
}

function numberRecordValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function startsWithTraceVerb(summary: string): boolean {
  const firstWord = summary.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '').toLowerCase() ?? '';
  return TRACE_SUMMARY_VERBS.has(firstWord);
}

function tracePayloadDetailText(event: TraceEventRecord, category: TraceCategoryId, detail: RunDetail | null): string {
  const honeycrispToolDetail = honeycrispToolTraceDetailText(event, detail);
  if (honeycrispToolDetail !== null) return honeycrispToolDetail;

  const payload = event.payload;
  const parts =
    [
      detailPartsForToolCall(event),
      detailPartsForToolResult(event),
      detailPartsForModelSystemEvent(event),
      detailPartsForVerifierEvent(event),
      detailPartsForNetworkEvent(event),
      detailPartsForResearchArtifactEvent(event),
      detailPartsForReviewEvent(event),
      detailPartsForUserEvent(event),
      fallbackPayloadParts(payload, category)
    ].find((candidate): candidate is string[] => Boolean(candidate && candidate.length > 0)) ?? [];
  return truncateText(formatTraceDetailParts(parts), 300);
}

function honeycrispToolTraceDetailText(event: TraceEventRecord, detail: RunDetail | null): string | null {
  const kind = honeycrispToolEventKind(event);
  if (kind !== 'tool.requested' && kind !== 'tool.observed') return null;

  const payload = honeycrispEventToolPayload(event);
  if (!payload) return '';
  if (kind === 'tool.requested') return honeycrispToolTraceSubtext(event, detail);
  const status = stringRecordValue(payload, 'status');
  const error = tracePayloadRecord(payload, 'error');
  const errorMessage = error ? stringRecordValue(error, 'message') : stringRecordValue(payload, 'error');
  if (errorMessage) return errorMessage;
  const subtext = honeycrispToolTraceSubtext(event, detail);
  return subtext || (status && status !== 'complete' ? traceLabel(status) : '');
}

function memoryTypeForGetTrace(event: TraceEventRecord, memoryId: string, detail: RunDetail | null): string | null {
  const catalogType = detail?.honeycrispMemory?.nodes.find((node) => node.id === memoryId)?.type;
  if (catalogType) return catalogType;

  const currentPayload = honeycrispEventToolPayload(event);
  const currentResult = currentPayload ? tracePayloadRecord(currentPayload, 'result') : null;
  const currentType = currentResult ? stringRecordValue(currentResult, 'type') : null;
  if (currentType) return currentType;

  const pairingKey = honeycrispToolPairingKey(event);
  const observation = pairingKey
    ? detail?.traceEvents.find((candidate) => honeycrispToolEventKind(candidate) === 'tool.observed' && honeycrispToolPairingKey(candidate) === pairingKey)
    : null;
  const observationPayload = observation ? honeycrispEventToolPayload(observation) : null;
  const result = observationPayload ? tracePayloadRecord(observationPayload, 'result') : null;
  const observedType = result ? stringRecordValue(result, 'type') : null;
  if (observedType) return observedType;

  const stableIdType = memoryId.match(/^([a-z][a-z0-9]*)_[a-f0-9]{12,}$/i)?.[1];
  return stableIdType ?? null;
}

function detailPartsForToolCall(event: TraceEventRecord): string[] | null {
  if (event.type !== 'tool_call') return null;
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  const args = tracePayloadRecord(event.payload, 'arguments');
  const parts = [toolName ? `tool ${toolName}` : null, ...toolArgumentParts(toolName, args), policyPart(event.payload)].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts : null;
}

function toolArgumentParts(toolName: string | null, args: Record<string, unknown> | null): Array<string | null> {
  if (!args) return [];
  if (toolName === 'search') return [quotedPart('query', stringRecordValue(args, 'query')), targetPart(args)];
  if (toolName === 'source') return [pathPart('repo', stringRecordValue(args, 'repository')), quotedPart('ref', stringRecordValue(args, 'ref'))];
  if (toolName === 'code_browser') return [pathPart('path', stringRecordValue(args, 'path')), quotedPart('symbol', stringRecordValue(args, 'symbol')), rangePart(args)];
  if (toolName === 'resource_lookup') return [pathPart('resource', stringRecordValue(args, 'resource_id')), tracePart('kind', stringRecordValue(args, 'kind')), quotedPart('query', stringRecordValue(args, 'query'))];
  if (toolName === 'python') return [quotedPart('task', stringRecordValue(args, 'task')), pathPart('artifact', stringRecordValue(args, 'artifact_path'))];
  if (toolName === 'debugger') return [tracePart('operation', stringRecordValue(args, 'operation')), pathPart('target', stringRecordValue(args, 'target')), pathPart('input', stringRecordValue(args, 'input_path'))];
  if (toolName === 'artifact') return [quotedPart('name', stringRecordValue(args, 'name')), tracePart('kind', stringRecordValue(args, 'kind'))];
  if (toolName === 'verifier') return [pathPart('contract', stringRecordValue(args, 'contractId')), tracePart('mode', stringRecordValue(args, 'mode'))];
  return Object.entries(args)
    .slice(0, 3)
    .map(([key, value]) => primitiveValuePart(key, value));
}

function detailPartsForToolResult(event: TraceEventRecord): string[] | null {
  if (event.type !== 'tool_result' && event.type !== 'artifact_created') return null;
  const payload = event.payload;
  const error = tracePayloadPrimitive(payload, 'error');
  if (error) {
    return [
      tracePart('status', tracePayloadPrimitive(payload, 'status') ?? 'error'),
      tracePart('error', error),
      pathPart('path', tracePayloadPrimitive(payload, 'path')),
      tracePart('tool', tracePayloadPrimitive(payload, 'toolName')),
      ...nestedArgumentsParts(payload)
    ].filter((part): part is string => Boolean(part));
  }

  const query = tracePayloadPrimitive(payload, 'query');
  if (query) {
    return [
      quotedPart('query', query),
      matchCountPart(payload),
      traceNumberPart('files', tracePayloadPrimitive(payload, 'filesConsidered')),
      traceNumberPart('skipped', tracePayloadPrimitive(payload, 'skippedFiles')),
      availableRepositoriesPart(payload),
      targetPart(payload),
      tracePayloadPrimitive(payload, 'sourceAcquisitionHint')
    ].filter((part): part is string => Boolean(part));
  }

  const repositoryUrl = tracePayloadPrimitive(payload, 'repositoryUrl') ?? tracePayloadPrimitive(payload, 'requestedRepository');
  if (repositoryUrl || tracePayloadArray(payload, 'availableRepositories')) {
    return [
      pathPart('repo', repositoryUrl),
      pathPart('local', tracePayloadPrimitive(payload, 'localPath')),
      traceBooleanPart('cloned', tracePayloadPrimitive(payload, 'cloned')),
      shortHashPart('head', tracePayloadPrimitive(payload, 'head')),
      tracePart('reason', tracePayloadPrimitive(payload, 'reason')),
      availableRepositoriesPart(payload)
    ].filter((part): part is string => Boolean(part));
  }

  const sourcePath = tracePayloadPrimitive(payload, 'sourcePath') ?? tracePayloadPrimitive(payload, 'path');
  if (sourcePath && (event.summary.includes('Code browser') || payload.excerpt)) {
    return [
      pathPart('path', sourcePath),
      lineRangePart(payload),
      quotedPart('symbol', tracePayloadPrimitive(payload, 'symbol')),
      traceBooleanPart('truncated', tracePayloadPrimitive(payload, 'truncated')),
      shortHashPart('hash', tracePayloadPrimitive(payload, 'contentHash')),
      tracePart('reason', tracePayloadPrimitive(payload, 'reason'))
    ].filter((part): part is string => Boolean(part));
  }

  const artifactId = tracePayloadPrimitive(payload, 'artifactId') ?? tracePayloadPrimitive(payload, 'exportedArtifactId');
  if (artifactId || event.type === 'artifact_created') {
    return [
      pathPart('artifact', artifactId),
      pathPart('path', tracePayloadPrimitive(payload, 'relativePath') ?? tracePayloadPrimitive(payload, 'guestPath')),
      quotedPart('name', tracePayloadPrimitive(payload, 'name')),
      tracePart('kind', tracePayloadPrimitive(payload, 'kind')),
      shortHashPart('sha256', tracePayloadPrimitive(payload, 'sha256'))
    ].filter((part): part is string => Boolean(part));
  }

  return executionParts(payload);
}

function detailPartsForModelSystemEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'model_message') return null;
  const payload = event.payload;
  const responseId = tracePayloadPrimitive(payload, 'responseId');
  const usage = tracePayloadRecord(payload, 'usage');
  const tokenParts = usage
    ? [
        traceNumberPart('input', stringRecordValue(usage, 'input_tokens')),
        traceNumberPart('output', stringRecordValue(usage, 'output_tokens')),
        traceNumberPart('reasoning', tracePayloadRecord(usage, 'output_tokens_details') ? stringRecordValue(tracePayloadRecord(usage, 'output_tokens_details') ?? {}, 'reasoning_tokens') : null)
      ]
    : [];

  return [
    tracePart('model', tracePayloadPrimitive(payload, 'model')),
    tracePart('effort', reasoningEffortPart(payload)),
    traceNumberPart('tools', tracePayloadPrimitive(payload, 'toolCount')),
    tracePart('transport', tracePayloadPrimitive(payload, 'transport')),
    replayPart(payload),
    tracePart('reason', tracePayloadPrimitive(payload, 'reason')),
    traceNumberPart('high water', tracePayloadPrimitive(payload, 'traceHighWaterMark')),
    byteSizePart(tracePayloadPrimitive(payload, 'serializedSizeBytes')),
    shortHashPart('response', responseId),
    shortHashPart('previous response', tracePayloadPrimitive(payload, 'previousResponseId')),
    tracePart('auth', tracePayloadPrimitive(payload, 'authSource')),
    traceBooleanPart('auth configured', tracePayloadPrimitive(payload, 'authConfigured')),
    traceBooleanPart('credentials host-only', tracePayloadPrimitive(payload, 'credentialsHostOnly')),
    traceBooleanPart('recovered', tracePayloadPrimitive(payload, 'recovered')),
    traceBooleanPart('retry', tracePayloadPrimitive(payload, 'retryAttempted')),
    tracePart('error', tracePayloadPrimitive(payload, 'error')),
    ...tokenParts
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForVerifierEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'verifier_result' && event.source !== 'verifier') return null;
  const payload = event.payload;
  return [
    tracePart('status', tracePayloadPrimitive(payload, 'status')),
    pathPart('contract', tracePayloadPrimitive(payload, 'contractId')),
    pathPart('run', tracePayloadPrimitive(payload, 'verifierRunId')),
    traceBooleanPart('real', tracePayloadPrimitive(payload, 'realExecution')),
    traceBooleanPart('vm', tracePayloadPrimitive(payload, 'vmExecution')),
    traceBooleanPart('host', tracePayloadPrimitive(payload, 'hostExecution')),
    pathPart('artifact', tracePayloadPrimitive(payload, 'artifactId')),
    tracePart('blocked', tracePayloadPrimitive(payload, 'blockedIssue')),
    firstArrayPart('issue', tracePayloadArray(payload, 'issues'))
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForNetworkEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'network_event') return null;
  const payload = event.payload;
  return [
    tracePart('decision', tracePayloadPrimitive(payload, 'decision')),
    pathPart('host', tracePayloadPrimitive(payload, 'destinationHostname')),
    tracePart('port', tracePayloadPrimitive(payload, 'port')),
    tracePart('protocol', tracePayloadPrimitive(payload, 'protocol')),
    tracePart('backend', tracePayloadPrimitive(payload, 'backend')),
    tracePart('rule', tracePayloadPrimitive(payload, 'policyRule')),
    tracePart('reason', tracePayloadPrimitive(payload, 'reason'))
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForResearchArtifactEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'artifact_created' && event.type !== 'research_event') return null;
  const payload = event.payload;
  return [
    pathPart('memory node', tracePayloadPrimitive(payload, 'memoryNodeId')),
    tracePart('title', tracePayloadPrimitive(payload, 'title')),
    tracePart('component', tracePayloadPrimitive(payload, 'component')),
    tracePart('severity', tracePayloadPrimitive(payload, 'severity')),
    tracePart('status', tracePayloadPrimitive(payload, 'status') ?? tracePayloadPrimitive(payload, 'state')),
    pathPart('artifact', tracePayloadPrimitive(payload, 'artifactId')),
    pathPart('export', tracePayloadPrimitive(payload, 'exportId')),
    pathPart('path', tracePayloadPrimitive(payload, 'relativePath')),
    tracePart('decision', tracePayloadPrimitive(payload, 'decision')),
    traceBooleanPart('reversible', tracePayloadPrimitive(payload, 'reversible')),
    tracePayloadPrimitive(payload, 'text'),
    tracePayloadPrimitive(payload, 'description'),
    tracePayloadPrimitive(payload, 'impact'),
    tracePayloadPrimitive(payload, 'note')
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForReviewEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'approval_event') return null;
  const payload = event.payload;
  return [
    tracePart('decision', tracePayloadPrimitive(payload, 'decision')),
    tracePart('request', tracePayloadPrimitive(payload, 'requestKind')),
    pathPart('approval', tracePayloadPrimitive(payload, 'approvalId')),
    tracePart('tool', tracePayloadPrimitive(payload, 'toolName')),
    tracePayloadPrimitive(payload, 'credentialHint'),
    tracePayloadPrimitive(payload, 'note'),
    tracePayloadPrimitive(payload, 'reason'),
    ...nestedArgumentsParts(payload)
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForUserEvent(event: TraceEventRecord): string[] | null {
  if (event.source !== 'user' && event.type !== 'user_note') return null;
  const payload = event.payload;
  return [
    tracePayloadPrimitive(payload, 'instruction'),
    tracePayloadPrimitive(payload, 'note'),
    tracePart('mode', tracePayloadPrimitive(payload, 'mode')),
    tracePart('strategy', tracePayloadPrimitive(payload, 'attemptStrategy')),
    tracePart('engine', tracePayloadPrimitive(payload, 'runEngine'))
  ].filter((part): part is string => Boolean(part));
}

function executionParts(payload: Record<string, unknown>): string[] | null {
  const status = tracePayloadPrimitive(payload, 'status');
  const operation = tracePayloadPrimitive(payload, 'operationKind') ?? tracePayloadPrimitive(payload, 'operation') ?? tracePayloadPrimitive(payload, 'wrapper');
  const parts = [
    quotedPart('task', tracePayloadPrimitive(payload, 'task')),
    tracePart('operation', operation),
    tracePart('status', status),
    traceNumberPart('exit', tracePayloadPrimitive(payload, 'exitCode')),
    tracePart('signal', tracePayloadPrimitive(payload, 'signal')),
    durationPart(tracePayloadPrimitive(payload, 'durationMs')),
    shortHashPart('script', tracePayloadPrimitive(payload, 'scriptHash')),
    pathPart('imported', tracePayloadPrimitive(payload, 'importedHostPath')),
    pathPart('artifact', tracePayloadPrimitive(payload, 'exportedArtifactId')),
    traceNumberPart('artifact candidates', tracePayloadPrimitive(payload, 'candidateArtifactCount')),
    structuredSummaryPart(payload),
    tracePayloadPrimitive(payload, 'stdoutSummary'),
    tracePayloadPrimitive(payload, 'stderrSummary'),
    firstArrayPart('artifact candidates', tracePayloadArray(payload, 'candidateArtifacts'))
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts : null;
}

function fallbackPayloadParts(payload: Record<string, unknown>, category: TraceCategoryId): string[] {
  const preferredKeys =
    category === 'failure_recovery'
      ? ['error', 'status', 'reason', 'message', 'blockedIssue']
      : ['status', 'reason', 'message', 'path', 'target', 'query', 'name', 'operationKind', 'command', 'cwd'];
  const preferred = preferredKeys.map((key) => primitiveValuePart(key, payload[key])).filter((part): part is string => Boolean(part));
  if (preferred.length > 0) return preferred;
  return Object.entries(payload)
    .map(([key, value]) => primitiveValuePart(key, value))
    .filter((part): part is string => Boolean(part))
    .slice(0, 4);
}

function formatTraceDetailParts(parts: string[]): string {
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
}

function primitiveValuePart(key: string, value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? `${traceLabel(key)} ${truncateText(value.trim(), 72)}` : null;
  if (typeof value === 'number' || typeof value === 'boolean') return `${traceLabel(key)} ${String(value)}`;
  if (Array.isArray(value)) return `${traceLabel(key)} ${value.length}`;
  return null;
}

function tracePart(label: string, value: string | null): string | null {
  return value ? `${label} ${value}` : null;
}

function quotedPart(label: string, value: string | null): string | null {
  return value ? `${label} "${truncateText(value, 72)}"` : null;
}

function pathPart(label: string, value: string | null): string | null {
  return value ? `${label} ${compactTracePath(value)}` : null;
}

function targetPart(record: Record<string, unknown>): string | null {
  return pathPart('target', stringRecordValue(record, 'target') ?? stringRecordValue(record, 'targetHint'));
}

function nestedArgumentsParts(payload: Record<string, unknown>): string[] {
  const args = tracePayloadRecord(payload, 'arguments');
  if (!args) return [];
  return [
    quotedPart('query', stringRecordValue(args, 'query')),
    targetPart(args),
    pathPart('repo', stringRecordValue(args, 'repository')),
    pathPart('path', stringRecordValue(args, 'path')),
    quotedPart('task', stringRecordValue(args, 'task')),
    tracePart('operation', stringRecordValue(args, 'operation'))
  ].filter((part): part is string => Boolean(part));
}

function policyPart(payload: Record<string, unknown>): string | null {
  const policy = tracePayloadRecord(payload, 'policy');
  if (!policy) return null;
  const execution = stringRecordValue(policy, 'execution');
  const targetExecution = stringRecordValue(policy, 'targetExecution');
  return [execution, targetExecution ? `target ${targetExecution}` : null].filter(Boolean).join(' / ') || null;
}

function rangePart(record: Record<string, unknown>): string | null {
  const start = stringRecordValue(record, 'line_start') ?? stringRecordValue(record, 'lineStart');
  const end = stringRecordValue(record, 'line_end') ?? stringRecordValue(record, 'lineEnd');
  if (start && end) return `lines ${start}-${end}`;
  if (start) return `line ${start}`;
  return null;
}

export function lineRangePart(payload: Record<string, unknown>): string | null {
  const start = tracePayloadPrimitive(payload, 'lineStart');
  const end = tracePayloadPrimitive(payload, 'lineEnd');
  if (start && end) return `lines ${start}-${end}`;
  if (start) return `line ${start}`;
  return null;
}

function matchCountPart(payload: Record<string, unknown>): string | null {
  const matches = tracePayloadArray(payload, 'matches');
  return matches ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : null;
}

function availableRepositoriesPart(payload: Record<string, unknown>): string | null {
  const repositories = tracePayloadArray(payload, 'sourceRepositoriesAvailable') ?? tracePayloadArray(payload, 'availableRepositories');
  if (!repositories) return null;
  return `${repositories.length} source repo${repositories.length === 1 ? '' : 's'}`;
}

function reasoningEffortPart(payload: Record<string, unknown>): string | null {
  const reasoning = tracePayloadRecord(payload, 'reasoning');
  return reasoning ? stringRecordValue(reasoning, 'effort') : tracePayloadPrimitive(payload, 'reasoningEffort');
}

function replayPart(payload: Record<string, unknown>): string | null {
  const previousReplay = tracePayloadPrimitive(payload, 'previousReplayMode');
  const nextReplay = tracePayloadPrimitive(payload, 'newReplayMode');
  if (previousReplay && nextReplay) return `replay ${previousReplay} -> ${nextReplay}`;
  return tracePart('replay', tracePayloadPrimitive(payload, 'replayMode') ?? nextReplay);
}

function arrayLengthValue(payload: Record<string, unknown>, key: string): string | null {
  const value = tracePayloadArray(payload, key);
  return value ? String(value.length) : null;
}

function importSummaryPart(payload: Record<string, unknown>): string | null {
  const summary = tracePayloadRecord(payload, 'importSummary');
  if (!summary) return null;
  const kind = stringRecordValue(summary, 'kind');
  const files = stringRecordValue(summary, 'fileCount');
  const directories = stringRecordValue(summary, 'directoryCount');
  const size = byteSizePart(stringRecordValue(summary, 'sizeBytes'))?.replace(/^size /, '');
  return [kind, files ? `${files} files` : null, directories ? `${directories} dirs` : null, size].filter(Boolean).join(' · ') || null;
}

function providerResultPart(payload: Record<string, unknown>): string | null {
  const result = tracePayloadRecord(payload, 'providerResult');
  if (!result) return null;
  return (
    [
      traceBooleanPart('destroyed', stringRecordValue(result, 'destroyed')),
      traceBooleanPart('reset', stringRecordValue(result, 'reset')),
      traceBooleanPart('preserved', stringRecordValue(result, 'preserved')),
      tracePart('snapshot', stringRecordValue(result, 'snapshotRef')),
      pathPart('path', stringRecordValue(result, 'path'))
    ]
      .filter(Boolean)
      .join(' · ') || null
  );
}

function structuredSummaryPart(payload: Record<string, unknown>): string | null {
  const structured = tracePayloadRecord(payload, 'structured');
  if (!structured) return null;
  return [
    tracePart('backend', stringRecordValue(structured, 'backend')),
    pathPart('artifact', stringRecordValue(structured, 'artifactPath') ?? stringRecordValue(structured, 'artifact_path')),
    tracePart('result', stringRecordValue(structured, 'result')),
    tracePart('status', stringRecordValue(structured, 'status'))
  ]
    .filter(Boolean)
    .join(' · ');
}

function traceNumberPart(label: string, value: string | null): string | null {
  if (!value) return null;
  return `${label} ${value}`;
}

function traceBooleanPart(label: string, value: string | null): string | null {
  if (value !== 'true' && value !== 'false') return null;
  return `${label} ${value === 'true' ? 'yes' : 'no'}`;
}

function durationPart(value: string | null): string | null {
  if (!value) return null;
  const ms = Number(value);
  if (!Number.isFinite(ms)) return `duration ${value}`;
  if (ms < 1000) return `duration ${Math.round(ms)}ms`;
  return `duration ${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function byteSizePart(value: string | null): string | null {
  if (!value) return null;
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return `size ${value}`;
  if (bytes < 1024) return `size ${bytes}B`;
  if (bytes < 1024 * 1024) return `size ${(bytes / 1024).toFixed(1)}KB`;
  return `size ${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function shortHashPart(label: string, value: string | null): string | null {
  if (!value) return null;
  return `${label} ${value.length > 16 ? value.slice(0, 12) : value}`;
}

function firstArrayPart(label: string, value: unknown[] | null): string | null {
  if (!value) return null;
  if (value.length === 0) return `${label} 0`;
  const first = value[0];
  if (typeof first === 'string') return `${label} ${truncateText(first, 72)}`;
  return `${label} ${value.length}`;
}
