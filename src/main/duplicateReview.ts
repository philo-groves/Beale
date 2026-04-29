import type { FindingRecord, HypothesisRecord } from '@shared/types';

export type ClaimEntityKind = 'hypothesis' | 'finding';
export type DuplicateReviewOutcome = 'new_claim' | 'duplicate' | 'variant' | 'chain_candidate' | 'ambiguous';

export interface ClaimDraft {
  entityKind: ClaimEntityKind;
  title: string;
  bodyMarkdown: string;
  component: string;
  bugClass: string;
  impactMarkdown: string;
  affectedAssets?: Record<string, unknown>;
  cweMappings: ClaimWeaknessMapping[];
}

export interface ClaimCandidate {
  entityKind: ClaimEntityKind;
  id: string;
  runId: string;
  state: string;
  title: string;
  bodyMarkdown: string;
  component: string;
  bugClass: string;
  impactMarkdown: string;
  affectedAssets?: Record<string, unknown>;
  cweMappings: ClaimWeaknessMapping[];
}

interface ClaimWeaknessMapping {
  cweId: string;
}

export interface DuplicateReview {
  outcome: DuplicateReviewOutcome;
  confidence: 'none' | 'low' | 'medium' | 'high';
  matchedEntityKind: ClaimEntityKind | null;
  matchedEntityId: string | null;
  relationship: 'none' | 'duplicate' | 'variant' | 'chain_candidate' | 'ambiguous';
  score: number;
  matchedFields: string[];
  rationale: string;
  recommendedNextAction: string;
}

interface PreparedClaim {
  entityKind: ClaimEntityKind;
  id: string | null;
  state: string;
  title: string;
  titleKey: string;
  titleTokens: Set<string>;
  surfaceKey: string;
  surfaceTokens: Set<string>;
  mechanismKey: string;
  mechanismTokens: Set<string>;
  impactTokens: Set<string>;
  cweIds: Set<string>;
}

const NEGATIVE_STATES = new Set(['dismissed', 'false_positive', 'false-positive', 'out_of_scope', 'out-of-scope']);
const STOP_WORDS = new Set([
  'about',
  'across',
  'after',
  'again',
  'against',
  'allows',
  'because',
  'before',
  'being',
  'between',
  'could',
  'from',
  'have',
  'into',
  'that',
  'their',
  'there',
  'these',
  'this',
  'through',
  'under',
  'using',
  'when',
  'where',
  'with',
  'without',
  'value',
  'values'
]);

export function claimCandidateFromHypothesis(hypothesis: HypothesisRecord): ClaimCandidate {
  return {
    entityKind: 'hypothesis',
    id: hypothesis.id,
    runId: hypothesis.runId,
    state: hypothesis.state,
    title: hypothesis.title,
    bodyMarkdown: hypothesis.descriptionMarkdown,
    component: hypothesis.component,
    bugClass: hypothesis.bugClass,
    impactMarkdown: hypothesis.impact,
    cweMappings: hypothesis.cweMappings
  };
}

export function claimCandidateFromFinding(finding: FindingRecord, linkedHypothesis: HypothesisRecord | null = null): ClaimCandidate {
  return {
    entityKind: 'finding',
    id: finding.id,
    runId: finding.runId,
    state: finding.state,
    title: finding.title,
    bodyMarkdown: finding.summaryMarkdown,
    component: componentFromAffectedAssets(finding.affectedAssets) || linkedHypothesis?.component || '',
    bugClass: linkedHypothesis?.bugClass ?? '',
    impactMarkdown: finding.impactMarkdown,
    affectedAssets: finding.affectedAssets,
    cweMappings: finding.cweMappings
  };
}

export function reviewClaimDuplicate(draft: ClaimDraft, candidates: ClaimCandidate[], options: { skipEntityIds?: string[] } = {}): DuplicateReview {
  const skipEntityIds = new Set(options.skipEntityIds ?? []);
  const preparedDraft = prepareDraft(draft);
  let best: { candidate: ClaimCandidate; prepared: PreparedClaim; score: number; matchedFields: string[]; outcome: DuplicateReviewOutcome } | null = null;

  for (const candidate of candidates) {
    if (skipEntityIds.has(candidate.id)) continue;
    const preparedCandidate = prepareCandidate(candidate);
    const comparison = compareClaims(preparedDraft, preparedCandidate);
    if (!best || betterDuplicateMatch(candidate, comparison, best)) {
      best = { candidate, prepared: preparedCandidate, ...comparison };
    }
  }

  if (!best || best.score < 0.34) {
    return newClaimReview();
  }

  const matchedTerminalNegative = NEGATIVE_STATES.has(normalizeState(best.candidate.state));
  const outcome = matchedTerminalNegative && best.outcome === 'duplicate' ? 'ambiguous' : best.outcome;
  const confidence = confidenceForScore(best.score, outcome);
  const relationship = outcome === 'new_claim' ? 'none' : outcome;
  const matchedLabel = `${best.candidate.entityKind} ${best.candidate.id}`;
  const rationale = rationaleForOutcome(outcome, matchedLabel, best.matchedFields, best.score, best.candidate.state);

  return {
    outcome,
    confidence,
    matchedEntityKind: best.candidate.entityKind,
    matchedEntityId: best.candidate.id,
    relationship,
    score: Number(best.score.toFixed(3)),
    matchedFields: best.matchedFields,
    rationale,
    recommendedNextAction: recommendedActionForOutcome(outcome, best.candidate)
  };
}

export function duplicateReviewPayload(review: DuplicateReview): Record<string, unknown> {
  return {
    outcome: review.outcome,
    confidence: review.confidence,
    matchedEntityKind: review.matchedEntityKind,
    matchedEntityId: review.matchedEntityId,
    relationship: review.relationship,
    score: review.score,
    matchedFields: review.matchedFields,
    rationale: review.rationale,
    recommendedNextAction: review.recommendedNextAction
  };
}

function betterDuplicateMatch(
  candidate: ClaimCandidate,
  comparison: { score: number; outcome: DuplicateReviewOutcome },
  best: { candidate: ClaimCandidate; score: number; outcome: DuplicateReviewOutcome }
): boolean {
  if (comparison.outcome === 'duplicate' && best.outcome !== 'duplicate') return true;
  if (comparison.outcome !== 'duplicate' && best.outcome === 'duplicate') return false;
  if (candidate.entityKind === 'finding' && best.candidate.entityKind === 'hypothesis' && comparison.outcome === 'duplicate') return true;
  if (comparison.score > best.score + 0.04) return true;
  if (comparison.score + 0.04 < best.score) return false;
  return false;
}

function prepareDraft(draft: ClaimDraft): PreparedClaim {
  return prepareClaim({
    entityKind: draft.entityKind,
    id: null,
    state: 'proposed',
    title: draft.title,
    component: draft.component,
    bugClass: draft.bugClass,
    bodyMarkdown: draft.bodyMarkdown,
    impactMarkdown: draft.impactMarkdown,
    affectedAssets: draft.affectedAssets,
    cweMappings: draft.cweMappings
  });
}

function prepareCandidate(candidate: ClaimCandidate): PreparedClaim {
  return prepareClaim(candidate);
}

function prepareClaim(claim: Omit<ClaimCandidate, 'id' | 'runId'> & { id: string | null }): PreparedClaim {
  const affectedAssetText = flattenJsonStrings(claim.affectedAssets ?? {}).join(' ');
  const surfaceText = [claim.component, affectedAssetText].filter(Boolean).join(' ');
  const mechanismText = [claim.bugClass, claim.title, claim.bodyMarkdown].filter(Boolean).join(' ');
  const cweIds = new Set(claim.cweMappings.map((mapping) => normalizeCweId(mapping.cweId)).filter((id): id is string => id.length > 0));

  return {
    entityKind: claim.entityKind,
    id: claim.id,
    state: claim.state,
    title: claim.title,
    titleKey: normalizeKey(claim.title),
    titleTokens: tokenize(claim.title),
    surfaceKey: normalizeKey(surfaceText),
    surfaceTokens: tokenize(surfaceText),
    mechanismKey: normalizeKey(claim.bugClass),
    mechanismTokens: tokenize(mechanismText),
    impactTokens: tokenize(claim.impactMarkdown),
    cweIds
  };
}

function compareClaims(draft: PreparedClaim, candidate: PreparedClaim): { score: number; matchedFields: string[]; outcome: DuplicateReviewOutcome } {
  const matchedFields: string[] = [];
  const titleOverlap = jaccard(draft.titleTokens, candidate.titleTokens);
  const surfaceOverlap = jaccard(draft.surfaceTokens, candidate.surfaceTokens);
  const mechanismOverlap = jaccard(draft.mechanismTokens, candidate.mechanismTokens);
  const impactOverlap = jaccard(draft.impactTokens, candidate.impactTokens);
  const cweOverlap = intersectionSize(draft.cweIds, candidate.cweIds) > 0;
  const exactTitle = draft.titleKey.length > 0 && draft.titleKey === candidate.titleKey;
  const exactSurface = draft.surfaceKey.length > 0 && draft.surfaceKey === candidate.surfaceKey;
  const exactMechanism = draft.mechanismKey.length > 0 && draft.mechanismKey === candidate.mechanismKey;
  const surfaceStrong = exactSurface || surfaceOverlap >= 0.58;
  const surfaceWeak = surfaceStrong || surfaceOverlap >= 0.34;
  const mechanismStrong = cweOverlap || exactMechanism || mechanismOverlap >= 0.42;
  const titleStrong = exactTitle || titleOverlap >= 0.7;

  if (exactTitle) matchedFields.push('title');
  else if (titleOverlap >= 0.45) matchedFields.push('title_terms');
  if (exactSurface) matchedFields.push('surface');
  else if (surfaceOverlap >= 0.34) matchedFields.push('surface_terms');
  if (cweOverlap) matchedFields.push('cwe');
  if (exactMechanism) matchedFields.push('bug_class');
  else if (mechanismOverlap >= 0.42) matchedFields.push('mechanism_terms');
  if (impactOverlap >= 0.3) matchedFields.push('impact_terms');

  let score = 0;
  if (exactTitle) score += 0.24;
  else score += titleOverlap * 0.2;
  if (exactSurface) score += 0.34;
  else score += surfaceOverlap * 0.3;
  if (cweOverlap) score += 0.24;
  if (exactMechanism) score += 0.16;
  else score += mechanismOverlap * 0.14;
  score += impactOverlap * 0.12;
  score = Math.min(score, 1);

  if ((surfaceStrong && mechanismStrong && (titleOverlap >= 0.18 || impactOverlap >= 0.2 || exactTitle)) || (titleStrong && surfaceWeak && mechanismStrong)) {
    return { score: Math.max(score, 0.82), matchedFields, outcome: 'duplicate' };
  }

  if (mechanismStrong && !surfaceWeak && (titleOverlap >= 0.25 || impactOverlap >= 0.24)) {
    return { score: Math.max(score, 0.56), matchedFields, outcome: 'variant' };
  }

  if (mechanismStrong && surfaceWeak) {
    return { score: Math.max(score, 0.48), matchedFields, outcome: 'ambiguous' };
  }

  if (titleStrong || score >= 0.5) {
    return { score: Math.max(score, 0.5), matchedFields, outcome: 'ambiguous' };
  }

  return { score, matchedFields, outcome: 'new_claim' };
}

function newClaimReview(): DuplicateReview {
  return {
    outcome: 'new_claim',
    confidence: 'none',
    matchedEntityKind: null,
    matchedEntityId: null,
    relationship: 'none',
    score: 0,
    matchedFields: [],
    rationale: 'No matching prior program record was found.',
    recommendedNextAction: 'Create the claim and continue gathering evidence.'
  };
}

function confidenceForScore(score: number, outcome: DuplicateReviewOutcome): DuplicateReview['confidence'] {
  if (outcome === 'new_claim') return 'none';
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

function rationaleForOutcome(outcome: DuplicateReviewOutcome, matchedLabel: string, fields: string[], score: number, state: string): string {
  const fieldText = fields.length > 0 ? fields.join(', ') : 'weak textual similarity';
  if (outcome === 'duplicate') {
    return `Matched ${matchedLabel} as the same underlying claim using ${fieldText} (score ${score.toFixed(2)}, state ${state}).`;
  }
  if (outcome === 'variant') {
    return `Matched ${matchedLabel} as a possible variant using ${fieldText} (score ${score.toFixed(2)}, state ${state}).`;
  }
  if (outcome === 'chain_candidate') {
    return `Matched ${matchedLabel} as a possible chain candidate using ${fieldText} (score ${score.toFixed(2)}, state ${state}).`;
  }
  return `Matched ${matchedLabel} ambiguously using ${fieldText} (score ${score.toFixed(2)}, state ${state}).`;
}

function recommendedActionForOutcome(outcome: DuplicateReviewOutcome, candidate: ClaimCandidate): string {
  if (outcome === 'duplicate') {
    return `Do not create a new record. Add evidence to ${candidate.entityKind} ${candidate.id}, test a distinct variant, or investigate chaining.`;
  }
  if (outcome === 'variant') {
    return `Continue only if the affected surface, attacker path, or impact differs from ${candidate.entityKind} ${candidate.id}.`;
  }
  if (outcome === 'chain_candidate') {
    return `Investigate whether this combines with ${candidate.entityKind} ${candidate.id} into a stronger exploit chain.`;
  }
  if (outcome === 'ambiguous') {
    return `Gather discriminating evidence before promoting this beyond a hypothesis. Compare against ${candidate.entityKind} ${candidate.id}.`;
  }
  return 'Create the claim and continue gathering evidence.';
}

function componentFromAffectedAssets(value: Record<string, unknown>): string {
  const component = value.component;
  if (typeof component === 'string') return component;
  const asset = value.asset;
  if (typeof asset === 'string') return asset;
  const endpoint = value.endpoint;
  if (typeof endpoint === 'string') return endpoint;
  return flattenJsonStrings(value).slice(0, 4).join(' ');
}

function flattenJsonStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => flattenJsonStrings(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...flattenJsonStrings(entry)]);
  }
  return [];
}

function tokenize(value: string): Set<string> {
  const tokens = normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9_.:/-]+/g, ' ')
    .replace(/[_.:/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, '');
}

function normalizeState(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_');
}

function normalizeCweId(value: string): string {
  const match = value.trim().toUpperCase().match(/^CWE-\d+$/);
  return match ? match[0] : '';
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = intersectionSize(left, right);
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) count += 1;
  }
  return count;
}
