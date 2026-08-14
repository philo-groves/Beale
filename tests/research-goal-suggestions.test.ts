import { describe, expect, it } from 'vitest';
import type { ResearchProfileWorkflow } from '@shared/types';
import {
  parseAndSelectResearchGoalCandidates,
  researchGoalCandidateCount,
  researchGoalSuggestionTextFormat,
  semanticGoalSimilarity
} from '../src/main/researchGoalSuggestions';

const WORKFLOW: ResearchProfileWorkflow = {
  id: 'discovery',
  name: 'Discovery',
  description: 'Find new bounded research directions.',
  goalSuggestionCount: 3,
  goalSuggestionInstructions: [],
  promptInstructions: [],
  outputRequirements: []
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
});

function candidate(goal: string, noveltyAxis: string, groundingRef = 'workspace:scope') {
  return {
    goal,
    groundingRefs: [groundingRef],
    rationale: 'The recorded workspace context makes this a bounded and discriminating direction.',
    noveltyAxis
  };
}
