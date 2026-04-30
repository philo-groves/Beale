import type { FindingRecord, HypothesisRecord, RunDetail, TraceEventRecord } from '@shared/types';
import { traceLabel, truncateText } from '../lib/formatting';
import {
  isToolCallNamed,
  stringRecordValue,
  toolNameFromSummary,
  tracePayloadArray,
  tracePayloadPrimitive,
  tracePayloadRecord
} from '../traceClassification';
import type { TraceCategoryId } from '../traceClassification';

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

export function traceEventSummary(event: TraceEventRecord, category: TraceCategoryId): string {
  return trimTraceLabelPeriod(rawTraceEventSummary(event, category));
}

export function trimTraceLabelPeriod(label: string): string {
  return label.replace(/(?<!\.)\.$/, '');
}

export function traceCategoryFallbackPrefix(category: TraceCategoryId): string {
  if (category === 'agent_output' || category === 'reasoning') return 'Report';
  if (category === 'tools') return 'Run';
  if (category === 'vm_execution') return 'Execute';
  if (category === 'hypotheses') return 'Track';
  if (category === 'evidence') return 'Record';
  if (category === 'verifier') return 'Verify';
  if (category === 'policy_scope') return 'Enforce';
  if (category === 'code_navigation') return 'Inspect';
  if (category === 'failure_recovery') return 'Review';
  return 'Note';
}

export function traceEventDetailText(event: TraceEventRecord, category: TraceCategoryId, detail: RunDetail | null = null): string {
  const securityRecordDetail = securityRecordToolCallDetail(event);
  if (securityRecordDetail) return securityRecordDetail;

  const hypothesisDetail = hypothesisEventDetailText(event, detail);
  if (hypothesisDetail) return hypothesisDetail;

  const findingDetail = findingEventDetailText(event, detail);
  if (findingDetail) return findingDetail;

  const text = tracePayloadPrimitive(event.payload, 'text') ?? tracePayloadPrimitive(event.payload, 'delta');
  if ((category === 'agent_output' || category === 'reasoning') && text) {
    return category === 'reasoning' ? formatReasoningTraceText(text) : text.replace(/\r\n?/g, '\n').trim();
  }

  return tracePayloadDetailText(event, category);
}

export function hasStructuredProseTraceDetail(event: TraceEventRecord, detail: RunDetail | null = null): boolean {
  return Boolean(securityRecordToolCallDetail(event) || hypothesisEventDetailText(event, detail) || findingEventDetailText(event, detail));
}

export interface PythonToolCallPreview {
  task: string;
  scriptLines: string[];
  truncated: boolean;
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

export function pythonToolCallPreview(event: TraceEventRecord): PythonToolCallPreview | null {
  if (event.type !== 'tool_call') return null;
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  if (toolName !== 'python') return null;

  const args = tracePayloadRecord(event.payload, 'arguments');
  if (!args) return null;

  const task = stringRecordValue(args, 'task') ?? '';
  const scriptValue = args.script;
  const script = typeof scriptValue === 'string' ? scriptValue.replace(/\r\n?/g, '\n').trim() : '';
  const allScriptLines = script ? script.split('\n') : [];
  const scriptLines = allScriptLines.slice(0, 8);
  const truncated = allScriptLines.length > scriptLines.length;
  if (!task && scriptLines.length === 0) return null;

  return { task, scriptLines, truncated };
}

export function formatReasoningTraceText(text: string): string {
  const thoughts: string[] = [];
  let current = '';

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/[ \t]+/g, ' ').trim();
    if (!line) continue;

    const heading = line.match(/^\*\*([^*]+?)\*\*\s*(.*)$/);
    if (heading) {
      if (current) thoughts.push(current);
      const title = heading[1].trim();
      const description = heading[2].trim();
      current = description ? `${title}: ${description}` : `${title}:`;
      continue;
    }

    current = current ? `${current} ${line}` : line;
  }

  if (current) thoughts.push(current);
  return thoughts.join('\n');
}

export function compactTracePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.length <= 68) return normalized;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return `...${normalized.slice(-64)}`;
  return `.../${parts.slice(-3).join('/')}`;
}

export function hypothesisForTraceEvent(detail: RunDetail | null, event: TraceEventRecord): HypothesisRecord | null {
  if (!detail) return null;

  const createdMatch = detail.hypotheses.find((hypothesis) => hypothesis.createdTraceEventId === event.id);
  if (createdMatch) return createdMatch;

  const hypothesisId =
    tracePayloadPrimitive(event.payload, 'hypothesisId') ??
    tracePayloadPrimitive(event.payload, 'targetHypothesisId') ??
    tracePayloadPrimitive(event.payload, 'sourceHypothesisId');
  if (!hypothesisId) return null;
  return detail.hypotheses.find((hypothesis) => hypothesis.id === hypothesisId) ?? null;
}

export function findingForTraceEvent(detail: RunDetail | null, event: TraceEventRecord): FindingRecord | null {
  if (!detail) return null;

  const findingId = tracePayloadPrimitive(event.payload, 'findingId');
  if (findingId) {
    const directMatch = detail.findings.find((finding) => finding.id === findingId);
    if (directMatch) return directMatch;
  }

  const hypothesis = hypothesisForTraceEvent(detail, event);
  if (!hypothesis) return null;
  return detail.findings.find((finding) => finding.hypothesisId === hypothesis.id) ?? null;
}

function rawTraceEventSummary(event: TraceEventRecord, category: TraceCategoryId): string {
  const summary = event.summary.trim();
  if (!summary) return traceCategoryFallbackPrefix(category);
  if (event.type === 'tool_call') {
    const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(summary);
    if (toolName === 'python') return 'Run Python';
    if (toolName === 'hypothesis') return 'Prepare Hypothesis';
    if (toolName === 'finding') return 'Prepare Finding';
  }

  if (summary === 'OpenAI streamed model output delta.') return 'Stream model output';
  if (summary === 'OpenAI response completed.') return 'Response Completed';
  if (summary === 'OpenAI response created.') return 'Turn Started';
  if (summary === 'OpenAI completed a model output item.') return 'Complete model output';
  if (summary === 'Report agent output.' || summary === 'Report agent output') return 'Agent Response';
  if (summary === 'Thought.' || summary === 'Thought') return 'Thought';
  if (summary === 'OpenAI completed thought.' || isLegacyThoughtSummary(summary)) return 'Thought';
  if (summary === 'OpenAI adapter prepared host-only model session.') return 'Prepare host-only model session';
  if (summary === 'OpenAI Responses run started from markdown prompt.') return 'Start run from prompt';
  if (summary === 'OpenAI run blocked because no host credential is configured.') return 'Block run: missing host credential';
  if (summary === 'OpenAI run resume blocked because no host credential is configured.') return 'Block resume: missing host credential';
  if (summary === 'OpenAI run resumed from compacted Beale replay context.') return 'Resume run from compacted replay';
  if (summary === 'OpenAI run resumed from persisted Responses state.') return 'Resume run from persisted state';
  if (summary === 'OpenAI compacted retry recovered from context window pressure.') return 'Recover compacted retry';
  if (summary === 'OpenAI previous response state was unavailable; retrying with compacted Beale replay context.') return 'Retry with compacted replay';
  if (summary === 'OpenAI backend rejected previous_response_id; retrying with compacted Beale replay context.') return 'Retry with compacted replay';
  if (summary === 'OpenAI context window pressure triggered compacted retry.') return 'Compact context for retry';
  if (summary === 'OpenAI Responses run failed.') return 'Fail Responses run';
  if (summary === 'Context compacted for long-running session.') return 'Compact context for long-running session';
  if (summary === 'Workspace recovery paused interrupted run after app restart.') return 'Pause interrupted run after restart';
  if (summary === 'Run started from markdown prompt.') return 'Start run from prompt';
  if (summary === 'Fake executor allocated a simulated disposable VM context.') return 'Allocate simulated VM context';
  if (summary === 'Simulated model planned an open-ended discovery pass.') return 'Plan discovery pass';
  if (summary === 'No network request was sent.') return 'Skip network request';
  if (summary === 'Simulated finding recorded; real VM verifier required for verified state.') return 'Record simulated finding';
  if (summary === 'Verifier failed to destroy guest after execution.') return 'Review verifier cleanup failure';
  if (summary === 'VM executor alpha failed to destroy guest after run failure.') return 'Review VM cleanup failure';
  if (summary === 'VM executor alpha run failed.') return 'Fail VM executor run';
  if (summary === 'VM executor alpha run started from markdown prompt.') return 'Start VM executor run';

  let match = summary.match(/^OpenAI Responses request sent for turn (\d+)\.$/);
  if (match) return `Request for Turn ${match[1]}`;
  match = summary.match(/^OpenAI completed function call arguments for ([^.]+)\.$/);
  if (match?.[1] === 'python') return 'Run Python';
  if (match?.[1] === 'hypothesis') return 'Prepare Hypothesis';
  if (match?.[1] === 'finding') return 'Prepare Finding';
  if (match) return `Call ${match[1]}`;
  match = summary.match(/^Guest ([\w -]+) operation sent to VM executor\.$/i);
  if (match) return `Send ${match[1].toLowerCase()} operation to VM`;
  match = summary.match(/^Guest ([\w -]+) operation finished with ([^.]+)\.$/i);
  if (match) return `Finish ${match[1].toLowerCase()} operation: ${match[2]}`;
  match = summary.match(/^Host ([\w -]+) operation finished with ([^.]+)\.$/i);
  if (match) return `Finish host ${match[1].toLowerCase()} operation: ${match[2]}`;
  match = summary.match(/^Host debugger wrapper operation finished with ([^.]+)\.$/i);
  if (match) return `Finish host debugger wrapper: ${match[1]}`;
  match = summary.match(/^Debugger wrapper operation finished with ([^.]+)\.$/i);
  if (match) return `Finish debugger wrapper: ${match[1]}`;
  match = summary.match(/^Guest artifact exported and accepted: (.+)\.$/);
  if (match) return `Accept exported artifact: ${match[1]}`;
  match = summary.match(/^VM network profile enforced: ([^.]+)\.$/);
  if (match) return `Enforce network profile: ${match[1]}`;
  match = summary.match(/^Verifier contract executed in disposable VM with ([^.]+)\.$/);
  if (match) return `Execute verifier contract: ${match[1]}`;
  match = summary.match(/^Verifier contract executed on host with ([^.]+)\.$/);
  if (match) return `Execute host verifier contract: ${match[1]}`;
  match = summary.match(/^Adaptive portfolio branch recorded: (.+)\.$/);
  if (match) return `Record portfolio branch: ${match[1]}`;
  match = summary.match(/^Requested (.+)\.$/);
  if (match) return `Request ${match[1]}`;
  match = summary.match(/^Artifact recorded: (.+)\.$/);
  if (match) return `Record artifact: ${match[1]}`;
  match = summary.match(/^Hypothesis created: (.+)\.$/);
  if (match) return 'Hypothesis Created';
  match = summary.match(/^Hypothesis updated: (.+)\.$/);
  if (match) return 'Hypothesis Updated';
  match = summary.match(/^Finding created: (.+)\.$/);
  if (match) return 'Finding Created';
  match = summary.match(/^Finding updated: (.+)\.$/);
  if (match) return 'Finding Updated';
  match = summary.match(/^Finding created from reproduced verifier-backed hypothesis: (.+)\.$/);
  if (match) return 'Finding Created';
  match = summary.match(/^Policy engine blocked (.+)\.$/);
  if (match) return `Block ${match[1]}`;
  match = summary.match(/^Paused after (.+)\.$/);
  if (match) return `Pause after ${match[1]}`;

  if (startsWithTraceVerb(summary)) return summary;
  return `${traceCategoryFallbackPrefix(category)}: ${summary}`;
}

function isLegacyThoughtSummary(summary: string): boolean {
  return summary.startsWith('OpenAI completed reasoning') && summary.endsWith('summary.');
}

function startsWithTraceVerb(summary: string): boolean {
  const firstWord = summary.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '').toLowerCase() ?? '';
  return TRACE_SUMMARY_VERBS.has(firstWord);
}

function tracePayloadDetailText(event: TraceEventRecord, category: TraceCategoryId): string {
  const payload = event.payload;
  const parts =
    [
      detailPartsForToolCall(event),
      detailPartsForToolResult(event),
      detailPartsForModelSystemEvent(event),
      detailPartsForVerifierEvent(event),
      detailPartsForNetworkEvent(event),
      detailPartsForVmEvent(event),
      detailPartsForEvidenceEvent(event),
      detailPartsForReviewEvent(event),
      detailPartsForUserEvent(event),
      fallbackPayloadParts(payload, category)
    ].find((candidate): candidate is string[] => Boolean(candidate && candidate.length > 0)) ?? [];
  return truncateText(formatTraceDetailParts(parts), 300);
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
  if (toolName === 'python') return [quotedPart('task', stringRecordValue(args, 'task')), pathPart('artifact', stringRecordValue(args, 'artifact_path'))];
  if (toolName === 'debugger') return [tracePart('operation', stringRecordValue(args, 'operation')), pathPart('target', stringRecordValue(args, 'target')), pathPart('input', stringRecordValue(args, 'input_path'))];
  if (toolName === 'artifact') return [quotedPart('name', stringRecordValue(args, 'name')), tracePart('kind', stringRecordValue(args, 'kind'))];
  if (toolName === 'hypothesis') return [quotedPart('title', stringRecordValue(args, 'title')), tracePart('state', stringRecordValue(args, 'state')), tracePart('cwe', stringRecordValue(args, 'primary_cwe_id'))];
  if (toolName === 'finding') return [quotedPart('title', stringRecordValue(args, 'title')), tracePart('state', stringRecordValue(args, 'state')), tracePart('cwe', stringRecordValue(args, 'primary_cwe_id'))];
  if (toolName === 'verifier') return [quotedPart('hypothesis', stringRecordValue(args, 'hypothesis')), pathPart('artifact', stringRecordValue(args, 'artifact_id')), pathPart('trace', stringRecordValue(args, 'trace_event_id'))];
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
    tracePart('profile', tracePayloadPrimitive(payload, 'networkProfile')),
    tracePart('decision', tracePayloadPrimitive(payload, 'decision')),
    traceBooleanPart('live target', tracePayloadPrimitive(payload, 'liveTargetAllowed')),
    traceNumberPart('destinations', tracePayloadPrimitive(payload, 'allowedDestinationCount')),
    pathPart('host', tracePayloadPrimitive(payload, 'destinationHostname')),
    tracePart('port', tracePayloadPrimitive(payload, 'port')),
    tracePart('protocol', tracePayloadPrimitive(payload, 'protocol')),
    tracePart('backend', tracePayloadPrimitive(payload, 'backend')),
    tracePart('rule', tracePayloadPrimitive(payload, 'policyRule')),
    tracePart('reason', tracePayloadPrimitive(payload, 'reason'))
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForVmEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'vm_event') return null;
  const payload = event.payload;
  return [
    pathPart('vm', tracePayloadPrimitive(payload, 'vmContextId')),
    tracePart('state', tracePayloadPrimitive(payload, 'state') ?? tracePayloadPrimitive(payload, 'previousState')),
    tracePart('backend', tracePayloadPrimitive(payload, 'backend')),
    tracePart('provider', tracePayloadPrimitive(payload, 'provider')),
    pathPart('image', tracePayloadPrimitive(payload, 'imageRef')),
    tracePart('snapshot', tracePayloadPrimitive(payload, 'snapshotRef')),
    tracePart('profile', tracePayloadPrimitive(payload, 'networkProfile')),
    pathPart('host', tracePayloadPrimitive(payload, 'hostPath') ?? tracePayloadPrimitive(payload, 'requestedHostPath')),
    pathPart('guest', tracePayloadPrimitive(payload, 'guestPath')),
    tracePart('mode', tracePayloadPrimitive(payload, 'mode')),
    importSummaryPart(payload),
    providerResultPart(payload),
    traceNumberPart('destinations', arrayLengthValue(payload, 'allowedDestinations')),
    traceBooleanPart('live target', tracePayloadPrimitive(payload, 'liveTargetAllowed')),
    traceBooleanPart('target execution', tracePayloadPrimitive(payload, 'targetExecution')),
    traceBooleanPart('host db mounted', tracePayloadPrimitive(payload, 'hostDatabaseMounted')),
    traceBooleanPart('OpenAI creds mounted', tracePayloadPrimitive(payload, 'openAiCredentialsMounted')),
    traceBooleanPart('review required', tracePayloadPrimitive(payload, 'userReviewRequired')),
    tracePart('reason', tracePayloadPrimitive(payload, 'reason')),
    tracePayloadPrimitive(payload, 'error'),
    tracePart('recovered', tracePayloadPrimitive(payload, 'recoveredAt'))
  ].filter((part): part is string => Boolean(part));
}

function detailPartsForEvidenceEvent(event: TraceEventRecord): string[] | null {
  if (event.type !== 'artifact_created' && event.type !== 'finding_event' && event.type !== 'hypothesis_event') return null;
  const payload = event.payload;
  return [
    pathPart('hypothesis', tracePayloadPrimitive(payload, 'hypothesisId')),
    pathPart('source hypothesis', tracePayloadPrimitive(payload, 'sourceHypothesisId')),
    pathPart('target hypothesis', tracePayloadPrimitive(payload, 'targetHypothesisId')),
    pathPart('finding', tracePayloadPrimitive(payload, 'findingId')),
    tracePart('title', tracePayloadPrimitive(payload, 'title')),
    tracePart('component', tracePayloadPrimitive(payload, 'component')),
    tracePart('cwe', cweMappingLabel(payload)),
    tracePart('severity', tracePayloadPrimitive(payload, 'severity')),
    tracePart('state', tracePayloadPrimitive(payload, 'findingState') ?? tracePayloadPrimitive(payload, 'state')),
    traceNumberPart('priority', tracePayloadPrimitive(payload, 'priorityScore')),
    pathPart('artifact', tracePayloadPrimitive(payload, 'artifactId')),
    pathPart('evidence', tracePayloadPrimitive(payload, 'evidenceId')),
    pathPart('export', tracePayloadPrimitive(payload, 'exportId')),
    pathPart('path', tracePayloadPrimitive(payload, 'relativePath')),
    tracePart('decision', tracePayloadPrimitive(payload, 'decision')),
    traceBooleanPart('reversible', tracePayloadPrimitive(payload, 'reversible')),
    tracePayloadPrimitive(payload, 'note')
  ].filter((part): part is string => Boolean(part));
}

function cweMappingLabel(payload: Record<string, unknown>): string | null {
  const mappings = tracePayloadArray(payload, 'cweMappings');
  if (!mappings) return null;
  const records = mappings
    .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const selected = records.find((item) => stringRecordValue(item, 'mappingRole') === 'primary') ?? records[0];
  if (!selected) return null;
  return stringRecordValue(selected, 'cweId');
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
    tracePart('network', tracePayloadPrimitive(payload, 'networkProfile')),
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

function securityRecordToolCallDetail(event: TraceEventRecord): string | null {
  return cweTitleToolCallDetail(event, 'hypothesis', 'Untitled hypothesis') ?? cweTitleToolCallDetail(event, 'finding', 'Untitled finding');
}

function hypothesisEventDetailText(event: TraceEventRecord, detail: RunDetail | null): string | null {
  if (event.type !== 'hypothesis_event') return null;
  const hypothesis = hypothesisForTraceEvent(detail, event);
  const title = hypothesis?.title ?? tracePayloadPrimitive(event.payload, 'title');
  const description = hypothesis?.descriptionMarkdown ?? tracePayloadPrimitive(event.payload, 'description');
  const lines = [boldTraceTitle(title), description?.trim()].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join('\n') : null;
}

function findingEventDetailText(event: TraceEventRecord, detail: RunDetail | null): string | null {
  if (event.type !== 'finding_event') return null;
  const finding = findingForTraceEvent(detail, event);
  const title = finding?.title ?? tracePayloadPrimitive(event.payload, 'title');
  const impact = finding?.impactMarkdown ?? tracePayloadPrimitive(event.payload, 'impact');
  const lines = [boldTraceTitle(title), impact?.trim()].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join('\n') : null;
}

function boldTraceTitle(value: string | null | undefined): string | null {
  const title = value?.trim();
  return title ? `**${title}**` : null;
}

function cweTitleToolCallDetail(event: TraceEventRecord, toolName: string, fallbackTitle: string): string | null {
  if (!isToolCallNamed(event, toolName)) return null;
  const args = tracePayloadRecord(event.payload, 'arguments');
  if (!args) return null;

  const title = stringRecordValue(args, 'title') ?? fallbackTitle;
  const cweName = stringRecordValue(args, 'primary_cwe_name') ?? 'Unclassified weakness';
  const cweId = formatToolCallCweId(stringRecordValue(args, 'primary_cwe_id'));
  return `${cweName} (${cweId}): ${title}`;
}

function formatToolCallCweId(value: string | null): string {
  if (!value || /^(unknown|none|null|n\/a|needs[_ -]?classification)$/i.test(value)) return 'CWE TBD';
  const cweMatch = value.match(/^CWE-(\d{1,8})$/i);
  if (cweMatch) return `CWE-${cweMatch[1]}`;
  const numericMatch = value.match(/^(\d{1,8})$/);
  return numericMatch ? `CWE-${numericMatch[1]}` : value;
}
