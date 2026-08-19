import type {
  GeneratedResearchGoalSuggestions,
  RunRecord,
  SessionNextPromptSuggestion
} from '@shared/types';

export function buildSessionNextStepSuggestions(
  run: RunRecord,
  phase: string,
  captured: readonly SessionNextPromptSuggestion[]
): GeneratedResearchGoalSuggestions {
  const promptSuggestions: SessionNextPromptSuggestion[] = [];
  const identities = new Set<string>();
  const append = (candidate: SessionNextPromptSuggestion): void => {
    const title = candidate.title.replace(/\s+/g, ' ').trim();
    const promptMarkdown = candidate.promptMarkdown.trim();
    const rationale = candidate.rationale?.replace(/\s+/g, ' ').trim();
    const identity = title.toLocaleLowerCase();
    if (!title || !promptMarkdown || identities.has(identity) || promptSuggestions.length >= 3) return;
    identities.add(identity);
    promptSuggestions.push({ title, promptMarkdown, ...(rationale ? { rationale } : {}) });
  };
  for (const candidate of captured) append(candidate);

  const sessionTitle = boundedText(run.title || 'the completed session', 120);
  const sessionSummary = boundedText(
    run.finalDisposition?.summary || run.summary || run.promptMarkdown || run.title,
    600
  );
  for (const dependency of run.finalDisposition?.blockerDependencies ?? []) {
    const requiredState = boundedText(dependency.requiredState, 160);
    append({
      title: `Resolve ${requiredState.replace(/[.!?]+$/u, '')}`,
      promptMarkdown: `Resolve the remaining dependency from ${sessionTitle}: ${requiredState}\n\nContinue from the prior session state and verify the result with concrete evidence.`
    });
  }
  const fallbackCandidates: SessionNextPromptSuggestion[] = run.status === 'failed'
    ? [{
        title: 'Diagnose the session failure and resume',
        promptMarkdown: `Diagnose why ${sessionTitle} failed, recover the useful completed work, and resume from the narrowest reliable checkpoint. Prior state: ${sessionSummary}`
      }]
    : [];
  fallbackCandidates.push(
    {
      title: 'Pursue the strongest unresolved lead',
      promptMarkdown: `Continue from ${sessionTitle} by identifying and pursuing its strongest unresolved lead. Preserve verified conclusions and avoid repeating completed work. Prior state: ${sessionSummary}`
    },
    {
      title: 'Challenge the session’s main conclusion',
      promptMarkdown: `Stress-test the main conclusion from ${sessionTitle} with a materially different construction or counterexample. Record evidence that confirms, narrows, or overturns it. Prior state: ${sessionSummary}`
    },
    {
      title: 'Extend the result to an adjacent attack surface',
      promptMarkdown: `Use the result from ${sessionTitle} to investigate the nearest related attack surface or boundary. Focus on a concrete, testable extension and reuse the prior evidence where applicable. Prior state: ${sessionSummary}`
    },
    {
      title: 'Turn the session result into a reproducible validation',
      promptMarkdown: `Convert the most important result from ${sessionTitle} into a concise reproducible validation, including prerequisites, expected evidence, and failure interpretation. Prior state: ${sessionSummary}`
    }
  );
  for (const candidate of fallbackCandidates) append(candidate);
  return {
    phase,
    suggestions: promptSuggestions.map((suggestion) => suggestion.title),
    promptSuggestions
  };
}

function boundedText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
