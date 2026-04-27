import type { ProgramScopeVersion, RunDetail, ScopeAsset, StartRunInput, TraceEventRecord } from '@shared/types';
import type { ResponseInputMessage } from './openaiAdapter';
import { redactForModelText, redactJsonForModel } from './redaction';

export function buildOpenAiInstructions(scope: ProgramScopeVersion, input: StartRunInput): string {
  const inScope = scope.assets
    .filter((asset) => asset.direction === 'in_scope')
    .slice(0, 30)
    .map(scopeAssetLine)
    .join('\n');
  const outOfScope = scope.assets
    .filter((asset) => asset.direction === 'out_of_scope')
    .slice(0, 30)
    .map(scopeAssetLine)
    .join('\n');

  return [
    'You are the model inside Beale, an authorized vulnerability research workbench.',
    'Beale owns authorization, sandbox policy, trace, evidence, artifacts, hypotheses, findings, and verifier promotion.',
    'If a target-behavior fact did not come from a Beale tool result, artifact, or verifier result, treat it as a hypothesis rather than an observation.',
    'Use Beale tools for observations. Do not claim that code ran, a debugger attached, a network request was sent, or a verifier passed unless a tool result says so.',
    'Target execution, generated PoCs, and debugger wrappers are VM-only through Beale tools when a disposable executor is available; the trusted host is not a target execution environment.',
    'When proposing a vulnerability, keep model claims distinct from tool-backed observations and ask for verifier evidence before promoting confidence.',
    `Program: ${redactForModelText(scope.programName)}`,
    `Organization: ${scope.organizationName ? redactForModelText(scope.organizationName) : 'unspecified'}`,
    `Network profile: ${input.networkProfile}`,
    `Sandbox profile: ${input.sandboxProfile}`,
    `Mode: ${input.mode}`,
    `Attempt strategy: ${input.attemptStrategy}`,
    'In scope:',
    inScope || 'No scoped assets recorded yet.',
    'Out of scope:',
    outOfScope || 'No explicit out-of-scope assets recorded yet.',
    'Program rules:',
    scope.rulesMarkdown ? redactForModelText(scope.rulesMarkdown) : 'No additional rules recorded.'
  ].join('\n\n');
}

export function buildInitialOpenAiInput(input: StartRunInput): ResponseInputMessage[] {
  return messageInput(redactForModelText(input.promptMarkdown));
}

export function buildResumeOpenAiInput(detail: RunDetail): ResponseInputMessage[] {
  const latestSession = detail.modelSessions.at(-1);
  return messageInput(
    [
      '# Beale Run Resume',
      'Continue this authorized Beale run from persisted state.',
      'Use the prior Responses chain when available. Do not repeat completed tool work unless it is necessary to recover context.',
      `Run id: ${detail.run.id}`,
      `Run status before resume: ${detail.run.status}`,
      `Latest previous_response_id: ${latestSession?.previousResponseId ?? 'none'}`,
      `Last recorded trace sequence: ${detail.traceEvents.at(-1)?.sequence ?? 0}`,
      'Next goal: continue vulnerability discovery while keeping model claims distinct from tool-backed observations.'
    ].join('\n')
  );
}

export function buildCompactedReplayOpenAiInput(detail: RunDetail): ResponseInputMessage[] {
  const visibleEvents = detail.traceEvents.filter((event) => event.modelVisible);
  const recentEvents = visibleEvents.slice(-60).map(formatTraceEventForReplay);
  const activeHypotheses = detail.hypotheses
    .filter((hypothesis) => !['dismissed', 'out_of_scope'].includes(hypothesis.state))
    .slice(0, 20)
    .map((hypothesis) => `- ${hypothesis.title} [${hypothesis.state}; confidence=${hypothesis.evidenceConfidence}]`);
  const findings = detail.findings
    .filter((finding) => !['dismissed', 'out_of_scope'].includes(finding.state))
    .slice(0, 20)
    .map((finding) => `- ${finding.title} [${finding.state}]`);
  const verifierRuns = detail.verifierRuns
    .slice(-20)
    .map((run) => `- ${run.id}: ${run.status}; blocked=${run.blockedIssue}; diagnostics=${run.diagnosticsClean}`);

  return messageInput(
    [
      '# Compacted Beale Run Replay',
      'Previous Responses state was unavailable or intentionally reset. Continue from this compacted, redacted Beale state.',
      'Preserve completed actions, active assumptions, tool outcomes, unresolved blockers, and the next concrete goal.',
      'Only model-visible trace events are included below.',
      '',
      '## Original Prompt',
      redactForModelText(detail.run.promptMarkdown),
      '',
      '## Recent Model-Visible Trace',
      recentEvents.join('\n') || 'No model-visible trace events were recorded.',
      '',
      '## Active Hypotheses',
      activeHypotheses.join('\n') || 'No active hypotheses recorded.',
      '',
      '## Findings',
      findings.join('\n') || 'No findings recorded.',
      '',
      '## Verifier Runs',
      verifierRuns.join('\n') || 'No verifier runs recorded.',
      '',
      '## Next Goal',
      'Continue the run from this state. Use Beale tools for observations and keep unsupported claims as hypotheses.'
    ].join('\n')
  );
}

function messageInput(text: string): ResponseInputMessage[] {
  return [
    {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text
        }
      ]
    }
  ];
}

function scopeAssetLine(asset: ScopeAsset): string {
  if (asset.kind === 'credential_ref') return `${asset.kind}: [credential reference redacted]`;
  return `${asset.kind}: ${redactForModelText(asset.value)}`;
}

function formatTraceEventForReplay(event: TraceEventRecord): string {
  const payload = JSON.stringify(redactJsonForModel(event.payload));
  const compactPayload = payload.length > 500 ? `${payload.slice(0, 497)}...` : payload;
  return `- #${event.sequence} ${event.source}/${event.type}: ${redactForModelText(event.summary)} ${compactPayload}`;
}
