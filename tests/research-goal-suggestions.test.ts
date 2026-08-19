import { describe, expect, it } from 'vitest';
import type { ResearchProfileWorkflow, RunRecord } from '@shared/types';
import {
  parseAndSelectResearchGoalCandidates,
  researchGoalCandidateCount,
  researchGoalSuggestionTextFormat,
  semanticGoalSimilarity
} from '../src/main/researchGoalSuggestions';
import { buildSessionNextStepSuggestions } from '../src/main/sessionNextStepSuggestions';

const WORKFLOW: ResearchProfileWorkflow = {
  id: 'discovery',
  name: 'Discovery',
  description: 'Find new bounded research directions.',
  goalSuggestionCount: 3,
  goalSuggestionInstructions: [],
  promptInstructions: [],
  outputRequirements: []
};

const LONGSHOT_WORKFLOW: ResearchProfileWorkflow = {
  ...WORKFLOW,
  id: 'longshot',
  name: 'Longshot',
  description: 'Pursue open-ended, high-upside research directions.'
};

describe('research goal candidate selection', () => {
  it('over-generates a bounded candidate pool and exposes a strict structured-output schema', () => {
    expect(researchGoalCandidateCount(1)).toBe(3);
    expect(researchGoalCandidateCount(4)).toBe(8);
    expect(researchGoalCandidateCount(12)).toBe(12);
    const format = researchGoalSuggestionTextFormat(8);
    expect(format).toMatchObject({
      type: 'json_schema',
      strict: true,
      schema: {
        properties: { candidates: { minItems: 8, maxItems: 8 } }
      }
    });
    expect(JSON.stringify(format.schema)).not.toContain('"uniqueItems"');
  });

  it('rejects repeated grounding references in host validation', () => {
    const candidates = Array.from({ length: 3 }, (_, index) => candidate(
      `Inspect distinct grounded research boundary ${index + 1} for authorization weaknesses.`,
      `boundary-${index + 1}`
    ));
    candidates[0] = {
      ...candidates[0]!,
      groundingRefs: ['workspace:scope', 'workspace:scope']
    };

    expect(() => parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates }), {
      workflow: WORKFLOW,
      suggestionCount: 3,
      candidateCount: 3,
      allowedGroundingRefs: new Set(['workspace:scope']),
      previousResearchTexts: [],
      relevanceTexts: []
    })).toThrow(/repeats a grounding reference/i);
  });

  it('selects grounded semantically distinct candidates while penalizing repeated prior research', () => {
    const candidates = [
      candidate('Map parser allocation boundaries for integer overflow and memory corruption.', 'parser-memory'),
      candidate('Map parser allocation boundaries for integer-overflow and memory-corruption flaws.', 'parser-overflow'),
      candidate('Audit archive path normalization for traversal across extraction boundaries.', 'archive-paths'),
      candidate('Trace workspace ownership checks for confused-deputy authorization failures.', 'workspace-ownership'),
      candidate('Explore metadata decoder object lifetimes for use-after-free conditions.', 'metadata-lifetime'),
      candidate('Review package signature transitions for trust-confusion vulnerabilities.', 'package-trust')
    ];
    const selection = parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates }), {
      workflow: WORKFLOW,
      suggestionCount: 4,
      candidateCount: 6,
      allowedGroundingRefs: new Set(['workspace:scope']),
      previousResearchTexts: ['A prior session completed archive path normalization and traversal review.'],
      relevanceTexts: ['parser workspace metadata package security boundaries']
    });

    expect(selection.selected).toHaveLength(4);
    expect(selection.rejectedSemanticDuplicates).toBeGreaterThanOrEqual(1);
    expect(selection.result.suggestions).not.toContain(candidates[2]?.goal);
    for (let index = 0; index < selection.result.suggestions.length; index += 1) {
      for (let other = index + 1; other < selection.result.suggestions.length; other += 1) {
        expect(semanticGoalSimilarity(selection.result.suggestions[index]!, selection.result.suggestions[other]!))
          .toBeLessThan(0.62);
      }
    }
  });

  it('excludes prior suggestions before ranking the next candidate set', () => {
    const candidates = [
      candidate('Map parser allocation boundaries for integer overflow and memory corruption.', 'parser-memory'),
      candidate('Audit archive path normalization for traversal across extraction boundaries.', 'archive-paths'),
      candidate('Trace workspace ownership checks for confused-deputy authorization failures.', 'workspace-ownership'),
      candidate('Explore metadata decoder object lifetimes for use-after-free conditions.', 'metadata-lifetime'),
      candidate('Review package signature transitions for trust-confusion vulnerabilities.', 'package-trust'),
      candidate('Assess update manifest parsing for canonicalization and trust-boundary weaknesses.', 'update-trust')
    ];
    const selection = parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates }), {
      workflow: WORKFLOW,
      suggestionCount: 3,
      candidateCount: 6,
      allowedGroundingRefs: new Set(['workspace:scope']),
      previousResearchTexts: [],
      priorSuggestionTexts: [candidates[0]!.goal],
      relevanceTexts: []
    });

    expect(selection.rejectedPriorSuggestions).toBe(1);
    expect(selection.candidates).toHaveLength(5);
    expect(selection.result.suggestions).not.toContain(candidates[0]!.goal);
  });

  it('rejects a response that leaves too few candidates after prior-suggestion filtering', () => {
    const candidates = [
      candidate('Map parser allocation boundaries for integer overflow and memory corruption.', 'parser-memory'),
      candidate('Audit archive path normalization for traversal across extraction boundaries.', 'archive-paths'),
      candidate('Trace workspace ownership checks for confused-deputy authorization failures.', 'workspace-ownership')
    ];

    expect(() => parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates }), {
      workflow: WORKFLOW,
      suggestionCount: 3,
      candidateCount: 3,
      allowedGroundingRefs: new Set(['workspace:scope']),
      previousResearchTexts: [],
      priorSuggestionTexts: [candidates[0]!.goal],
      relevanceTexts: []
    })).toThrow(/repeated prior suggestions/i);
  });

  it('discards invalid surplus candidates without weakening selected-candidate grounding', () => {
    const candidates = [
      candidate('Map parser allocation boundaries for integer overflow and memory corruption.', 'parser-memory'),
      candidate('Audit archive path normalization for traversal across extraction boundaries.', 'archive-paths'),
      candidate('Trace workspace ownership checks for confused-deputy authorization failures.', 'workspace-ownership'),
      candidate('Explore metadata decoder object lifetimes for use-after-free conditions.', 'metadata-lifetime'),
      candidate('Review package signature transitions for trust-confusion vulnerabilities.', 'package-trust'),
      candidate('Assess update manifest parsing for canonicalization and trust-boundary weaknesses.', 'update-trust')
    ];
    candidates[2] = {
      ...candidates[2]!,
      groundingRefs: ['memory:asset_unknown']
    };

    const selection = parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates }), {
      workflow: WORKFLOW,
      suggestionCount: 3,
      candidateCount: 6,
      allowedGroundingRefs: new Set(['workspace:scope']),
      previousResearchTexts: [],
      relevanceTexts: []
    });

    expect(selection.selected).toHaveLength(3);
    expect(selection.rejectedInvalidCandidates).toBe(1);
    expect(selection.candidates).toHaveLength(5);
    expect(selection.selected.every((candidateValue) => candidateValue.groundingRefs.includes('workspace:scope'))).toBe(true);
  });

  it('rejects invented grounding references and candidates that omit workflow eligibility evidence', () => {
    const candidates = Array.from({ length: 3 }, (_, index) => candidate(
      `Develop confirmed primitive ${index + 1} toward a bounded reachability and impact chain.`,
      `chain-${index + 1}`,
      index === 0 ? 'memory:invented' : 'workspace:scope'
    ));
    expect(() => parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates }), {
      workflow: { ...WORKFLOW, id: 'chaining', name: 'Chaining' },
      suggestionCount: 3,
      candidateCount: 3,
      allowedGroundingRefs: new Set(['workspace:scope', 'memory:primitive_one']),
      requiredGroundingRefs: new Set(['memory:primitive_one']),
      previousResearchTexts: [],
      relevanceTexts: []
    })).toThrow(/unknown grounding reference memory:invented/i);

    const ungrounded = candidates.map((value) => ({ ...value, groundingRefs: ['workspace:scope'] }));
    expect(() => parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates: ungrounded }), {
      workflow: { ...WORKFLOW, id: 'chaining', name: 'Chaining' },
      suggestionCount: 3,
      candidateCount: 3,
      allowedGroundingRefs: new Set(['workspace:scope', 'memory:primitive_one']),
      requiredGroundingRefs: new Set(['memory:primitive_one']),
      previousResearchTexts: [],
      relevanceTexts: []
    })).toThrow(/eligible Chaining memory/i);
  });

  it('rejects close-ended or low-ceiling Longshot candidates', () => {
    const closeEnded = [
      candidate('Verify whether a stale claim can execute Git operations against unauthorized local state.', 'stale-claim'),
      candidate('Determine whether one organization selector can mutate a resolved group in another organization.', 'organization-selector'),
      candidate('Establish whether a message fallback can route one request to a different project.', 'message-routing')
    ];
    expect(() => parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates: closeEnded }), {
      workflow: LONGSHOT_WORKFLOW,
      suggestionCount: 3,
      candidateCount: 3,
      allowedGroundingRefs: new Set(['workspace:scope']),
      previousResearchTexts: [],
      relevanceTexts: []
    })).toThrow(/broad research direction/i);

    const lowCeiling = Array.from({ length: 3 }, (_, index) => candidate(
      `Explore underreviewed component ${index + 1} for unusual state transitions and isolated authorization mistakes.`,
      `component-${index + 1}`
    ));
    expect(() => parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates: lowCeiling }), {
      workflow: LONGSHOT_WORKFLOW,
      suggestionCount: 3,
      candidateCount: 3,
      allowedGroundingRefs: new Set(['workspace:scope']),
      previousResearchTexts: [],
      relevanceTexts: []
    })).toThrow(/systemic-impact or major-breakthrough ceiling/i);
  });

  it('accepts open-ended Longshot programs with an explicit high-upside ceiling', () => {
    const candidates = [
      candidate('Explore cross-tenant workspace identity boundaries for systemic compromise paths that remain unknown.', 'tenant-boundaries'),
      candidate('Map update trust transitions for supply-chain compromise opportunities across the platform.', 'update-trust'),
      candidate('Develop a new framework connecting sparse invariants to a general classification theorem.', 'classification-framework')
    ];
    const selection = parseAndSelectResearchGoalCandidates(JSON.stringify({ candidates }), {
      workflow: LONGSHOT_WORKFLOW,
      suggestionCount: 3,
      candidateCount: 3,
      allowedGroundingRefs: new Set(['workspace:scope']),
      previousResearchTexts: [],
      relevanceTexts: []
    });

    expect(selection.result.suggestions).toEqual(candidates.map((value) => value.goal));
  });
});

describe('session next-step suggestions', () => {
  it('preserves captured prompts and fills missing entries locally without a model request', () => {
    const captured = [{
      title: 'Validate the parser boundary',
      promptMarkdown: 'Validate the parser boundary with the alternate encoded input.'
    }];
    const generated = buildSessionNextStepSuggestions(sessionRun(), 'discovery', captured);

    expect(generated.suggestions).toHaveLength(3);
    expect(generated.suggestions[0]).toBe(captured[0]?.title);
    expect(generated.promptSuggestions?.[0]).toEqual(captured[0]);
    expect(generated.promptSuggestions?.every((suggestion) => suggestion.promptMarkdown.length > 0)).toBe(true);
  });

  it('prioritizes an external blocker when no captured prompts are available', () => {
    const run = sessionRun();
    run.status = 'blocked';
    run.finalDisposition = {
      outcome: 'blocked',
      summary: 'Live validation needs an authorized test account.',
      blockerDependencies: [{
        kind: 'credentials',
        description: 'A second account is unavailable.',
        requiredState: 'Provide an authorized second test account.',
        external: true
      }],
      externalStateRequired: true,
      source: 'agent',
      recordedAt: '2026-08-19T12:00:00.000Z'
    };

    const generated = buildSessionNextStepSuggestions(run, 'discovery', []);
    expect(generated.suggestions).toHaveLength(3);
    expect(generated.suggestions[0]).toContain('Provide an authorized second test account');
    expect(generated.promptSuggestions?.[0]?.promptMarkdown).toContain('remaining dependency');
  });
});

function candidate(goal: string, noveltyAxis: string, groundingRef = 'workspace:scope') {
  return {
    goal,
    groundingRefs: [groundingRef],
    rationale: 'The recorded workspace context makes this a bounded and discriminating direction.',
    noveltyAxis
  };
}

function sessionRun(): RunRecord {
  return {
    id: 'run_session_suggestions',
    scopeVersionId: 'scope_one',
    researchProfileSnapshotId: null,
    shellSafetyMode: 'auto_review',
    mode: 'research',
    status: 'completed',
    title: 'Inspect parser trust boundaries',
    promptMarkdown: 'Inspect the parser trust boundaries and validate concrete failures.',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    attemptStrategy: 'iterative_research',
    sandboxProfile: 'host',
    targetAssetId: null,
    targetPath: null,
    budget: { researchWorkflowId: 'discovery' },
    summary: 'The primary encoded-input path was validated; the alternate path remains open.',
    finalDisposition: null,
    createdAt: '2026-08-19T11:00:00.000Z',
    startedAt: '2026-08-19T11:00:01.000Z',
    endedAt: '2026-08-19T12:00:00.000Z'
  };
}
