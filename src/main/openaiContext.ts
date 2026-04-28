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
    modeGuidance(input.mode),
    `Attempt strategy: ${input.attemptStrategy}`,
    'In scope:',
    inScope || 'No scoped assets recorded yet.',
    'Out of scope:',
    outOfScope || 'No explicit out-of-scope assets recorded yet.',
    'Program rules:',
    scope.rulesMarkdown ? redactForModelText(scope.rulesMarkdown) : 'No additional rules recorded.'
  ].join('\n\n');
}

function modeGuidance(mode: string): string {
  if (mode === 'dynamic') {
    return [
      'Mode guidance:',
      'Dynamic mode means you may transition between open discovery, targeted reproduction, patch validation, and variant analysis as the evidence changes.',
      'Start from the user prompt and program scope, then choose the next most useful research posture explicitly in your plan.',
      'Record mode transitions in trace-visible reasoning summaries when they affect tool choice, evidence goals, or verifier strategy.',
      'Do not stay in broad discovery after a concrete lead appears; switch to reproduction, verification, or variant analysis when that better advances vulnerability research.'
    ].join('\n');
  }
  if (mode === 'open_discovery') {
    return 'Mode guidance: Map attack surface, form hypotheses, and collect initial tool-backed evidence before narrowing.';
  }
  if (mode === 'targeted_reproduction') {
    return 'Mode guidance: Focus on reproducing a suspected issue or claim with concrete tool, artifact, and verifier-backed evidence.';
  }
  if (mode === 'patch_validation') {
    return 'Mode guidance: Evaluate whether a known fix or mitigation works, then look for bypasses and regressions.';
  }
  if (mode === 'variant_analysis') {
    return 'Mode guidance: Search related code paths, assets, inputs, and sibling components for variants of a known bug class or finding.';
  }
  return 'Mode guidance: Follow the user prompt while preserving Beale evidence, scope, and verifier requirements.';
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
  const repositoryUrl = repositoryUrlFromAsset(asset);
  const suffix = repositoryUrl && repositoryUrl !== asset.value ? ` (repository: ${redactForModelText(repositoryUrl)})` : '';
  return `${asset.kind}: ${redactForModelText(asset.value)}${suffix}`;
}

function repositoryUrlFromAsset(asset: ScopeAsset): string | null {
  const values = [asset.value, stringAttribute(asset.attributes?.repositoryUrl), stringAttribute(asset.attributes?.instruction)];
  for (const value of values) {
    const match = value.match(/\bhttps:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/i);
    if (match) return match[0].replace(/\.git$/i, '');
  }
  return null;
}

function stringAttribute(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatTraceEventForReplay(event: TraceEventRecord): string {
  const payload = JSON.stringify(redactJsonForModel(event.payload));
  const compactPayload = payload.length > 500 ? `${payload.slice(0, 497)}...` : payload;
  return `- #${event.sequence} ${event.source}/${event.type}: ${redactForModelText(event.summary)} ${compactPayload}`;
}
