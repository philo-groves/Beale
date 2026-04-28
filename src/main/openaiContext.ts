import type { ContextCompactionRecord, ProgramScopeVersion, RunDetail, ScopeAsset, StartRunInput, TraceEventRecord } from '@shared/types';
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
    'Work autonomously inside the recorded program scope. Choose the next useful Beale tool and keep moving until Beale blocks an action, the evidence is exhausted, or user steering would materially improve the run.',
    'Use `source` to materialize scoped repositories when source is not checked out yet, then search and read code directly.',
    'Beale enforces the hard boundaries: live-target networking follows recorded scope and network profile, target execution/build/test/debug/PoC work runs in the VM, host credentials and workspace databases stay on the host, and verified findings require tool/artifact/verifier-backed evidence.',
    'Treat tool results, artifacts, and verifier output as observations. Use your own analysis freely for hypotheses, prioritization, chaining, and next-step selection.',
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
      'Dynamic mode can move between open discovery, targeted reproduction, patch validation, and variant analysis as the evidence changes.',
      'Start from the user prompt and program scope, then choose the next most useful research posture.',
      'When a concrete lead appears, shift into reproduction, verification, chaining, or variant analysis without waiting for user approval.'
    ].join('\n');
  }
  if (mode === 'open_discovery') {
    return 'Mode guidance: Map attack surface, form hypotheses, and follow promising leads into concrete evidence.';
  }
  if (mode === 'targeted_reproduction') {
    return 'Mode guidance: Reproduce or falsify the suspected issue quickly, then preserve the smallest useful evidence.';
  }
  if (mode === 'patch_validation') {
    return 'Mode guidance: Evaluate whether a known fix or mitigation works, then look for bypasses and regressions.';
  }
  if (mode === 'variant_analysis') {
    return 'Mode guidance: Search related code paths, assets, inputs, and sibling components for variants of a known bug class or finding.';
  }
  return 'Mode guidance: Follow the user prompt with high autonomy inside Beale-enforced scope.';
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
      'Use the prior Responses chain when available. Avoid repeating completed tool work unless it helps recover context.',
      `Run id: ${detail.run.id}`,
      `Run status before resume: ${detail.run.status}`,
      `Latest previous_response_id: ${latestSession?.previousResponseId ?? 'none'}`,
      `Last recorded trace sequence: ${detail.traceEvents.at(-1)?.sequence ?? 0}`,
      'Next goal: continue vulnerability discovery with high autonomy inside the recorded scope.'
    ].join('\n')
  );
}

export function buildCompactedReplayOpenAiInput(detail: RunDetail, options: { reason?: string; previousCompaction?: ContextCompactionRecord | null; recentEventLimit?: number } = {}): ResponseInputMessage[] {
  const visibleEvents = detail.traceEvents.filter((event) => event.modelVisible);
  const recentEvents = visibleEvents.slice(-(options.recentEventLimit ?? 60)).map(formatTraceEventForReplay);
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
  const previousCompaction = options.previousCompaction;

  return messageInput(
    [
      '# Compacted Beale Run Replay',
      'Previous Responses state was unavailable or intentionally reset. Continue from this compacted, redacted Beale state.',
      'Preserve completed actions, active assumptions, tool outcomes, unresolved blockers, and the next concrete goal.',
      'Only model-visible trace events are included below.',
      `Compaction reason: ${options.reason ? redactForModelText(options.reason) : 'unspecified'}`,
      previousCompaction
        ? `Previous compaction checkpoint: ${previousCompaction.id}; trace high-water mark ${previousCompaction.traceHighWaterMark}; created ${previousCompaction.createdAt}.`
        : 'Previous compaction checkpoint: none.',
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
      'Continue the run from this state. Prefer concrete next actions over asking for user help when a Beale tool can safely proceed.'
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
