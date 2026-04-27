import type { HypothesisRecord } from '@shared/types';

export interface PriorityFactors {
  attackerReachability: number;
  impact: number;
  evidenceConfidence: number;
  exploitPracticality: number;
  scopeConfidence: number;
}

export function scorePriority(factors: PriorityFactors): number {
  return clamp(factors.evidenceConfidence) * (clamp(factors.attackerReachability) + clamp(factors.impact) + clamp(factors.exploitPracticality) + clamp(factors.scopeConfidence));
}

export function priorityFactorsFromHypothesis(hypothesis: HypothesisRecord): PriorityFactors {
  return {
    attackerReachability: factorFromText(hypothesis.attackerReachability),
    impact: factorFromText(hypothesis.impact),
    evidenceConfidence: factorFromText(hypothesis.evidenceConfidence),
    exploitPracticality: factorFromText(hypothesis.exploitPracticality),
    scopeConfidence: factorFromText(hypothesis.scopeConfidence)
  };
}

export function priorityFactorLabels(factors: PriorityFactors): {
  attackerReachability: string;
  impact: string;
  evidenceConfidence: string;
  exploitPracticality: string;
  scopeConfidence: string;
} {
  return {
    attackerReachability: `${clamp(factors.attackerReachability)} ${label('reachability', factors.attackerReachability)}`,
    impact: `${clamp(factors.impact)} ${label('impact', factors.impact)}`,
    evidenceConfidence: `${clamp(factors.evidenceConfidence)} ${label('evidence', factors.evidenceConfidence)}`,
    exploitPracticality: `${clamp(factors.exploitPracticality)} ${label('practicality', factors.exploitPracticality)}`,
    scopeConfidence: `${clamp(factors.scopeConfidence)} ${label('scope', factors.scopeConfidence)}`
  };
}

export function defaultHypothesisFactors(kind: 'authorization' | 'memory_corruption' | 'policy' | 'generic'): PriorityFactors {
  switch (kind) {
    case 'authorization':
      return { attackerReachability: 2, impact: 3, evidenceConfidence: 1, exploitPracticality: 2, scopeConfidence: 2 };
    case 'memory_corruption':
      return { attackerReachability: 1, impact: 2, evidenceConfidence: 2, exploitPracticality: 1, scopeConfidence: 2 };
    case 'policy':
      return { attackerReachability: 0, impact: 1, evidenceConfidence: 1, exploitPracticality: 0, scopeConfidence: 0 };
    case 'generic':
      return { attackerReachability: 1, impact: 1, evidenceConfidence: 1, exploitPracticality: 1, scopeConfidence: 1 };
  }
}

export function verifiedFindingFactors(kind: 'authorization' | 'memory_corruption' | 'generic'): PriorityFactors {
  switch (kind) {
    case 'authorization':
      return { attackerReachability: 2, impact: 3, evidenceConfidence: 3, exploitPracticality: 3, scopeConfidence: 3 };
    case 'memory_corruption':
      return { attackerReachability: 2, impact: 2, evidenceConfidence: 3, exploitPracticality: 2, scopeConfidence: 3 };
    case 'generic':
      return { attackerReachability: 2, impact: 2, evidenceConfidence: 3, exploitPracticality: 2, scopeConfidence: 2 };
  }
}

function factorFromText(value: string): number {
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) return clamp(numeric);
  const lower = value.toLowerCase();
  if (lower.includes('verifier') || lower.includes('verified')) return 3;
  if (lower.includes('reproduced') || lower.includes('dynamic') || lower.includes('controlled')) return 2;
  if (lower.includes('preliminary') || lower.includes('static') || lower.includes('plausible') || lower.includes('in_scope')) return 1;
  if (lower.includes('out_of_scope') || lower.includes('out-of-scope') || lower.includes('none')) return 0;
  return 1;
}

function label(kind: 'reachability' | 'impact' | 'evidence' | 'practicality' | 'scope', value: number): string {
  const score = clamp(value);
  const labels: Record<typeof kind, string[]> = {
    reachability: ['not reachable', 'privileged/local', 'authenticated/user-assisted', 'normal remote user', 'pre-auth remote'],
    impact: ['no security impact', 'limited impact', 'denial of service or limited exposure', 'authorization/data integrity impact', 'critical compromise'],
    evidence: ['hypothesis only', 'static/tool-backed lead', 'dynamic evidence', 'verifier-backed reproduction', 'verified plus patch/regression'],
    practicality: ['not practical', 'fragile', 'moderate constraints', 'reliable', 'easy and reliable'],
    scope: ['unknown/out of scope', 'likely in scope', 'in-scope asset', 'version/config confirmed', 'deployment context confirmed']
  };
  return labels[kind][score];
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(4, Math.round(value)));
}
