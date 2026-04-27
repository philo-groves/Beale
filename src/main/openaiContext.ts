import type { ProgramScopeVersion, StartRunInput } from '@shared/types';
import type { ResponseInputMessage } from './openaiAdapter';

export function buildOpenAiInstructions(scope: ProgramScopeVersion, input: StartRunInput): string {
  const inScope = scope.assets
    .filter((asset) => asset.direction === 'in_scope')
    .slice(0, 30)
    .map((asset) => `${asset.kind}: ${asset.value}`)
    .join('\n');
  const outOfScope = scope.assets
    .filter((asset) => asset.direction === 'out_of_scope')
    .slice(0, 30)
    .map((asset) => `${asset.kind}: ${asset.value}`)
    .join('\n');

  return [
    'You are the model inside Beale, an authorized vulnerability research workbench.',
    'Beale owns authorization, sandbox policy, trace, evidence, artifacts, hypotheses, findings, and verifier promotion.',
    'If a target-behavior fact did not come from a Beale tool result, artifact, or verifier result, treat it as a hypothesis rather than an observation.',
    'Use Beale tools for observations. Do not claim that code ran, a debugger attached, a network request was sent, or a verifier passed unless a tool result says so.',
    'Target execution is currently simulated. No target code, build scripts, generated PoCs, tests, fuzzing, or debugger sessions run in this milestone.',
    'When proposing a vulnerability, keep model claims distinct from tool-backed observations and ask for verifier evidence before promoting confidence.',
    `Program: ${scope.programName}`,
    `Organization: ${scope.organizationName || 'unspecified'}`,
    `Network profile: ${input.networkProfile}`,
    `Sandbox profile: ${input.sandboxProfile}`,
    `Mode: ${input.mode}`,
    `Attempt strategy: ${input.attemptStrategy}`,
    'In scope:',
    inScope || 'No scoped assets recorded yet.',
    'Out of scope:',
    outOfScope || 'No explicit out-of-scope assets recorded yet.',
    'Program rules:',
    scope.rulesMarkdown || 'No additional rules recorded.'
  ].join('\n\n');
}

export function buildInitialOpenAiInput(input: StartRunInput): ResponseInputMessage[] {
  return [
    {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: input.promptMarkdown
        }
      ]
    }
  ];
}
