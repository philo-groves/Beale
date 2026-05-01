import type { EvidenceRecord, FindingRecord, HypothesisRecord, RunDetail } from '@shared/types';
import { clampPriorityScoreForDisplay, stateClass } from '../lib/formatting';

export type SessionHeat = 'none' | 'low' | 'medium' | 'high' | 'critical';

const SESSION_HEAT_LEVELS: SessionHeat[] = ['none', 'low', 'medium', 'high', 'critical'];
const SESSION_HEAT_IGNORED_STATES = new Set(['dismissed', 'duplicate', 'false_positive', 'false-positive', 'out_of_scope', 'out-of-scope']);

export function sessionHeatForDetail(detail: RunDetail | null): SessionHeat {
  if (!detail) return 'none';

  const hypothesesById = new Map(detail.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));
  const evidenceByHypothesisId = new Map<string, EvidenceRecord[]>();
  for (const evidence of detail.evidence) {
    if (!evidence.hypothesisId) continue;
    const existing = evidenceByHypothesisId.get(evidence.hypothesisId) ?? [];
    existing.push(evidence);
    evidenceByHypothesisId.set(evidence.hypothesisId, existing);
  }
  let heat: SessionHeat = 'none';

  for (const finding of detail.findings) {
    if (isIgnoredHeatState(finding.state)) continue;
    const hypothesis = finding.hypothesisId ? (hypothesesById.get(finding.hypothesisId) ?? null) : null;
    heat = maxSessionHeat(heat, sessionHeatForFinding(finding, hypothesis));
  }

  for (const hypothesis of detail.hypotheses) {
    if (isIgnoredHeatState(hypothesis.state)) continue;
    heat = maxSessionHeat(heat, sessionHeatForHypothesis(hypothesis, evidenceByHypothesisId.get(hypothesis.id) ?? []));
  }

  return heat;
}

export function sessionHeatForFinding(finding: FindingRecord, hypothesis: HypothesisRecord | null): SessionHeat {
  if (stateClass(finding.state) === 'reportable') return 'critical';
  const impactScore = hypothesis ? heatFactorFromText(hypothesis.impact) : heatImpactFromText(`${finding.title}\n${finding.summaryMarkdown}\n${finding.impactMarkdown}`);
  const reachabilityScore = hypothesis ? heatFactorFromText(hypothesis.attackerReachability) : 1;
  const baseHeat = maxSessionHeat(sessionHeatFromImpact(impactScore, reachabilityScore), sessionHeatFromPriority(finding.priorityScore));
  return gateSessionHeat(baseHeat, findingEvidenceScore(finding, hypothesis));
}

export function sessionHeatForHypothesis(hypothesis: HypothesisRecord, evidence: EvidenceRecord[] = []): SessionHeat {
  const impactScore = heatFactorFromText(hypothesis.impact);
  const reachabilityScore = heatFactorFromText(hypothesis.attackerReachability);
  const baseHeat = maxSessionHeat(sessionHeatFromImpact(impactScore, reachabilityScore), sessionHeatFromPriority(hypothesis.priorityScore));
  return minSessionHeat(gateSessionHeat(baseHeat, hypothesisEvidenceScore(hypothesis)), hypothesisHeatCap(hypothesis, evidence));
}

function findingEvidenceScore(finding: FindingRecord, hypothesis: HypothesisRecord | null): number {
  const state = stateClass(finding.state);
  if (state === 'reportable') return 4;
  if (finding.verifiedByVerifierRunId || state === 'verified') return 3;
  if (state === 'reproduced' || state === 'promoted') return Math.max(2, hypothesis ? hypothesisEvidenceScore(hypothesis) : 2);
  if (state === 'needs_evidence' || state === 'needs-evidence') return hypothesis ? Math.max(1, hypothesisEvidenceScore(hypothesis)) : 1;
  return hypothesis ? hypothesisEvidenceScore(hypothesis) : 1;
}

function hypothesisEvidenceScore(hypothesis: HypothesisRecord): number {
  const state = stateClass(hypothesis.state);
  if (state === 'verified') return 3;
  if (state === 'promoted' || state === 'reproduced') return Math.max(2, heatFactorFromText(hypothesis.evidenceConfidence));
  return heatFactorFromText(hypothesis.evidenceConfidence);
}

function hypothesisHeatCap(hypothesis: HypothesisRecord, evidence: EvidenceRecord[]): SessionHeat {
  const state = stateClass(hypothesis.state);
  if (state === 'verified') return 'critical';
  if (state === 'promoted' || state === 'reproduced') return 'high';
  if (hasVerifierEvidence(evidence)) return 'critical';
  if (hasDynamicEvidence(evidence) || evidenceTextLooksDynamic(hypothesis.evidenceConfidence)) return 'high';
  if (evidence.length > 0 || evidenceTextLooksStatic(hypothesis.evidenceConfidence)) return 'medium';
  return 'low';
}

function hasVerifierEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some((item) => Boolean(item.verifierRunId) || /\bverifier\b/i.test(item.kind));
}

function hasDynamicEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some((item) => /\b(dynamic|runtime|repro|reproduction|debugger|crash|sanitizer|poc|exploit)\b/i.test(`${item.kind}\n${item.summary}`));
}

function evidenceTextLooksDynamic(value: string): boolean {
  return /\b(dynamic|runtime|reproduced|controlled reproduction|debugger|crash|sanitizer|poc|exploit)\b/i.test(value);
}

function evidenceTextLooksStatic(value: string): boolean {
  return /\b(static|tool-backed|lead|plausible|identified|present|not proven|not reproduced|hypothesis only)\b/i.test(value);
}

function gateSessionHeat(heat: SessionHeat, evidenceScore: number): SessionHeat {
  if (heat === 'none') return 'none';
  if (evidenceScore <= 0) return 'low';
  if (evidenceScore === 1) return minSessionHeat(heat, 'medium');
  if (evidenceScore === 2) return minSessionHeat(heat, 'high');
  return heat;
}

function sessionHeatFromImpact(impactScore: number, reachabilityScore: number): SessionHeat {
  if (impactScore >= 4 && reachabilityScore >= 3) return 'critical';
  if (impactScore >= 4 || (impactScore >= 3 && reachabilityScore >= 3)) return 'high';
  if (impactScore >= 2) return 'medium';
  if (impactScore >= 1) return 'low';
  return 'none';
}

function sessionHeatFromPriority(priorityScore: number): SessionHeat {
  const score = clampPriorityScoreForDisplay(priorityScore);
  if (score >= 42) return 'critical';
  if (score >= 24) return 'high';
  if (score >= 10) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

function maxSessionHeat(left: SessionHeat, right: SessionHeat): SessionHeat {
  return SESSION_HEAT_LEVELS[Math.max(SESSION_HEAT_LEVELS.indexOf(left), SESSION_HEAT_LEVELS.indexOf(right))];
}

function minSessionHeat(left: SessionHeat, right: SessionHeat): SessionHeat {
  return SESSION_HEAT_LEVELS[Math.min(SESSION_HEAT_LEVELS.indexOf(left), SESSION_HEAT_LEVELS.indexOf(right))];
}

export function isIgnoredHeatState(state: string): boolean {
  return SESSION_HEAT_IGNORED_STATES.has(stateClass(state));
}

function heatFactorFromText(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return Math.max(0, Math.min(4, parsed));
  const lower = value.toLowerCase();
  if (lower.includes('critical') || lower.includes('compromise') || lower.includes('code execution') || lower.includes('privilege escalation')) return 4;
  if (lower.includes('verified') || lower.includes('verifier')) return 3;
  if (lower.includes('dynamic') || lower.includes('reproduced') || lower.includes('controlled')) return 2;
  if (lower.includes('static') || lower.includes('tool-backed') || lower.includes('plausible') || lower.includes('lead')) return 1;
  if (lower.includes('hypothesis only') || lower.includes('out_of_scope') || lower.includes('out-of-scope') || lower.includes('none')) return 0;
  return 1;
}

function heatImpactFromText(value: string): number {
  const lower = value.toLowerCase();
  if (/\b(rce|remote code execution|code execution|sandbox escape|privilege escalation|credential compromise|cross-tenant|critical compromise)\b/.test(lower)) return 4;
  if (/\b(authorization bypass|data integrity|sensitive data|service compromise|account takeover|tenant)\b/.test(lower)) return 3;
  if (/\b(denial of service|dos|limited data exposure|limited exposure|integrity violation)\b/.test(lower)) return 2;
  if (/\b(crash|info leak|information leak|limited impact)\b/.test(lower)) return 1;
  return 1;
}
