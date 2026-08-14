import type {
  GeneratedResearchGoalSuggestions,
  ResearchProfileWorkflow
} from '@shared/types';

const MAX_CANDIDATE_POOL_SIZE = 12;
const MAX_GROUNDING_REFS_PER_CANDIDATE = 4;
const SEMANTIC_DUPLICATE_THRESHOLD = 0.62;

export interface ResearchGoalCandidate {
  goal: string;
  groundingRefs: string[];
  rationale: string;
  noveltyAxis: string;
}

export interface ResearchGoalCandidateSelectionInput {
  workflow: ResearchProfileWorkflow;
  suggestionCount: number;
  candidateCount: number;
  allowedGroundingRefs: ReadonlySet<string>;
  requiredGroundingRefs?: ReadonlySet<string>;
  previousResearchTexts: readonly string[];
  relevanceTexts: readonly string[];
}

export interface ResearchGoalCandidateSelection {
  result: GeneratedResearchGoalSuggestions;
  candidates: ResearchGoalCandidate[];
  selected: ResearchGoalCandidate[];
  rejectedSemanticDuplicates: number;
}

export function researchGoalCandidateCount(suggestionCount: number): number {
  return Math.min(MAX_CANDIDATE_POOL_SIZE, Math.max(suggestionCount + 2, suggestionCount * 2));
}

export function researchGoalSuggestionTextFormat(candidateCount: number): {
  type: 'json_schema';
  name: string;
  strict: true;
  schema: Record<string, unknown>;
} {
  return {
    type: 'json_schema',
    name: 'beale_research_goal_candidates',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['candidates'],
      properties: {
        candidates: {
          type: 'array',
          minItems: candidateCount,
          maxItems: candidateCount,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['goal', 'groundingRefs', 'rationale', 'noveltyAxis'],
            properties: {
              goal: { type: 'string', minLength: 24, maxLength: 320 },
              groundingRefs: {
                type: 'array',
                minItems: 1,
                maxItems: MAX_GROUNDING_REFS_PER_CANDIDATE,
                items: { type: 'string' }
              },
              rationale: { type: 'string', minLength: 12, maxLength: 500 },
              noveltyAxis: { type: 'string', minLength: 3, maxLength: 120 }
            }
          }
        }
      }
    }
  };
}

export function parseAndSelectResearchGoalCandidates(
  output: string,
  input: ResearchGoalCandidateSelectionInput
): ResearchGoalCandidateSelection {
  const record = parseOutputRecord(output);
  const rawCandidates = record.candidates;
  if (!Array.isArray(rawCandidates) || rawCandidates.length !== input.candidateCount) {
    throw new Error(
      `${input.workflow.name} research goal recommendations must contain exactly ${input.candidateCount} candidates.`
    );
  }
  const candidates = rawCandidates.map((value, index) => parseCandidate(value, index, input));
  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: candidateScore(candidate, input)
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: ResearchGoalCandidate[] = [];
  let rejectedSemanticDuplicates = 0;
  for (const item of scored) {
    const similarity = selected.reduce(
      (maximum, selectedCandidate) => Math.max(maximum, semanticGoalSimilarity(item.candidate.goal, selectedCandidate.goal)),
      0
    );
    if (similarity >= SEMANTIC_DUPLICATE_THRESHOLD) {
      rejectedSemanticDuplicates += 1;
      continue;
    }
    selected.push(item.candidate);
    if (selected.length === input.suggestionCount) break;
  }
  if (selected.length !== input.suggestionCount) {
    throw new Error(
      `${input.workflow.name} research goal recommendations must be distinct; the host could not select ${input.suggestionCount} semantically distinct grounded candidates.`
    );
  }
  return {
    result: { phase: input.workflow.id, suggestions: selected.map((candidate) => candidate.goal) },
    candidates,
    selected,
    rejectedSemanticDuplicates
  };
}

export function semanticGoalSimilarity(left: string, right: string): number {
  const leftTokens = semanticTokens(left);
  const rightTokens = semanticTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const overlap = intersection / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, overlap * 0.9);
}

function parseOutputRecord(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Research goal recommendations must be a JSON object.');
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(first, last + 1));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Research goal recommendations must be a JSON object.');
  }
}

function parseCandidate(
  value: unknown,
  index: number,
  input: ResearchGoalCandidateSelectionInput
): ResearchGoalCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${input.workflow.name} research goal candidate ${index + 1} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const goal = normalizeResearchGoalSentence(record.goal);
  const rationale = boundedText(record.rationale, 12, 500, 'candidate rationale');
  const noveltyAxis = boundedText(record.noveltyAxis, 3, 120, 'candidate novelty axis');
  if (!Array.isArray(record.groundingRefs)
    || record.groundingRefs.length < 1
    || record.groundingRefs.length > MAX_GROUNDING_REFS_PER_CANDIDATE) {
    throw new Error(`Research goal candidate ${index + 1} must cite one to ${MAX_GROUNDING_REFS_PER_CANDIDATE} grounding references.`);
  }
  const groundingRefs = record.groundingRefs.map((ref) => {
    if (typeof ref !== 'string' || !ref.trim()) throw new Error(`Research goal candidate ${index + 1} has an invalid grounding reference.`);
    return ref.trim();
  });
  if (new Set(groundingRefs).size !== groundingRefs.length) {
    throw new Error(`Research goal candidate ${index + 1} repeats a grounding reference.`);
  }
  const unknownRef = groundingRefs.find((ref) => !input.allowedGroundingRefs.has(ref));
  if (unknownRef) throw new Error(`Research goal candidate ${index + 1} cites unknown grounding reference ${unknownRef}.`);
  if (input.requiredGroundingRefs?.size
    && !groundingRefs.some((ref) => input.requiredGroundingRefs?.has(ref))) {
    throw new Error(`Research goal candidate ${index + 1} does not cite an eligible ${input.workflow.name} memory.`);
  }
  return { goal, groundingRefs, rationale, noveltyAxis };
}

function normalizeResearchGoalSentence(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Each research goal recommendation must be a string.');
  let sentence = value.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ');
  if (sentence.length < 24 || sentence.length > 320) {
    throw new Error('Each research goal recommendation must be between 24 and 320 characters.');
  }
  if (!/[.!?]$/.test(sentence)) sentence = `${sentence}.`;
  if (sentence.length > 320) throw new Error('Each research goal recommendation must be between 24 and 320 characters.');
  if (/[.!?](?:['")\]]*)\s+\S/.test(sentence.slice(0, -1))) {
    throw new Error('Each research goal recommendation must be exactly one sentence.');
  }
  return sentence;
}

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`Each research goal ${label} must be a string.`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`Each research goal ${label} must be between ${minimum} and ${maximum} characters.`);
  }
  return normalized;
}

function candidateScore(candidate: ResearchGoalCandidate, input: ResearchGoalCandidateSelectionInput): number {
  const requiredGroundingCount = candidate.groundingRefs.filter((ref) => input.requiredGroundingRefs?.has(ref)).length;
  const priorSimilarity = input.previousResearchTexts.reduce(
    (maximum, previous) => Math.max(maximum, semanticGoalSimilarity(candidate.goal, previous)),
    0
  );
  const relevanceSimilarity = input.relevanceTexts.reduce(
    (maximum, relevant) => Math.max(maximum, semanticGoalSimilarity(candidate.goal, relevant)),
    0
  );
  return candidate.groundingRefs.length * 6
    + requiredGroundingCount * 24
    + Math.min(10, relevanceSimilarity * 20)
    + Math.min(5, semanticTokens(candidate.noveltyAxis).size)
    - priorSimilarity * 32;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'its', 'of', 'on', 'or',
  'the', 'their', 'this', 'to', 'using', 'with', 'without', 'research', 'explore', 'examine', 'investigate'
]);

const SEMANTIC_ALIASES: Record<string, string> = {
  auth: 'authorization',
  authentication: 'authorization',
  access: 'authorization',
  overflow: 'integer-overflow',
  traversal: 'path-traversal',
  directory: 'path-traversal',
  filesystem: 'path-traversal',
  poc: 'proof',
  reproduction: 'proof',
  exploit: 'chain',
  reportable: 'chain'
};

function semanticTokens(value: string): Set<string> {
  const tokens = value.toLocaleLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  return new Set(tokens.flatMap((raw) => {
    if (STOP_WORDS.has(raw)) return [];
    const singular = raw.length > 5 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    return [SEMANTIC_ALIASES[singular] ?? singular];
  }));
}
