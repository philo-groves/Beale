import type { EvidenceRecord, FindingRecord, HypothesisRecord, TraceEventRecord } from '@shared/types';
import { tracePayloadPrimitive } from '../traceClassification';

export interface EvidenceTrail {
  id: string;
  hypothesis: HypothesisRecord | null;
  findings: FindingRecord[];
  evidence: EvidenceRecord[];
  latestAt: string;
}

export function hypothesisScrollKey(hypotheses: HypothesisRecord[]): string {
  return hypotheses
    .map((hypothesis) => `${hypothesis.id}:${hypothesis.state}:${hypothesis.priorityScore}:${hypothesis.title}:${hypothesis.descriptionMarkdown.length}`)
    .join('|');
}

export function findingScrollKey(findings: FindingRecord[]): string {
  return findings.map((finding) => `${finding.id}:${finding.state}:${finding.priorityScore}:${finding.title}:${finding.summaryMarkdown.length}`).join('|');
}

export function sortedEvidence(evidence: EvidenceRecord[]): EvidenceRecord[] {
  return [...evidence].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function evidenceScrollKey(evidence: EvidenceRecord[]): string {
  return evidence.map((item) => `${item.id}:${item.kind}:${item.summary}:${item.createdAt}`).join('|');
}

export function buildEvidenceTrails(hypotheses: HypothesisRecord[], findings: FindingRecord[], evidence: EvidenceRecord[]): EvidenceTrail[] {
  const hypothesesById = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const findingsByHypothesisId = groupBy(findings, (finding) => finding.hypothesisId);
  const evidenceByHypothesisId = groupBy(evidence, (item) => item.hypothesisId);
  const evidenceByFindingId = groupBy(evidence, (item) => item.findingId);
  const consumedFindingIds = new Set<string>();
  const consumedEvidenceIds = new Set<string>();

  const trails: EvidenceTrail[] = hypotheses.map((hypothesis) => {
    const linkedFindings = findingsByHypothesisId.get(hypothesis.id) ?? [];
    linkedFindings.forEach((finding) => consumedFindingIds.add(finding.id));
    const linkedEvidence = uniqueEvidence([
      ...(evidenceByHypothesisId.get(hypothesis.id) ?? []),
      ...linkedFindings.flatMap((finding) => evidenceByFindingId.get(finding.id) ?? [])
    ]);
    linkedEvidence.forEach((item) => consumedEvidenceIds.add(item.id));
    return {
      id: `hypothesis:${hypothesis.id}`,
      hypothesis,
      findings: sortFindings(linkedFindings),
      evidence: sortedEvidence(linkedEvidence),
      latestAt: latestTrailTimestamp(hypothesis, linkedFindings, linkedEvidence)
    };
  });

  for (const finding of findings) {
    if (consumedFindingIds.has(finding.id)) continue;
    const linkedEvidence = evidenceByFindingId.get(finding.id) ?? [];
    linkedEvidence.forEach((item) => consumedEvidenceIds.add(item.id));
    trails.push({
      id: `finding:${finding.id}`,
      hypothesis: finding.hypothesisId ? hypothesesById.get(finding.hypothesisId) ?? null : null,
      findings: [finding],
      evidence: sortedEvidence(linkedEvidence),
      latestAt: latestTrailTimestamp(null, [finding], linkedEvidence)
    });
  }

  const looseEvidence = evidence.filter((item) => !consumedEvidenceIds.has(item.id));
  for (const item of looseEvidence) {
    const finding = item.findingId ? findingsById.get(item.findingId) ?? null : null;
    const hypothesis = item.hypothesisId ? hypothesesById.get(item.hypothesisId) ?? null : null;
    trails.push({
      id: `evidence:${item.id}`,
      hypothesis,
      findings: finding ? [finding] : [],
      evidence: [item],
      latestAt: item.createdAt
    });
  }

  return trails.sort((left, right) => Date.parse(right.latestAt) - Date.parse(left.latestAt));
}

export function evidenceTrailScrollKey(trails: EvidenceTrail[]): string {
  return trails
    .map(
      (trail) =>
        `${trail.id}:${trail.latestAt}:${trail.hypothesis?.state ?? 'none'}:${trail.hypothesis?.title ?? ''}:${trail.findings
          .map((finding) => `${finding.id}:${finding.state}:${finding.title}:${finding.priorityScore}`)
          .join(',')}:${trail.evidence.map((item) => `${item.id}:${item.kind}:${item.createdAt}`).join(',')}`
    )
    .join('|');
}

export function traceEventForHypothesis<T extends TraceEventRecord>(events: T[], hypothesis: HypothesisRecord): T | null {
  if (hypothesis.createdTraceEventId) {
    const createdEvent = events.find((event) => event.id === hypothesis.createdTraceEventId);
    if (createdEvent) return createdEvent;
  }

  return (
    [...events]
      .reverse()
      .find(
        (event) =>
          event.type === 'hypothesis_event' &&
          (tracePayloadPrimitive(event.payload, 'hypothesisId') === hypothesis.id ||
            tracePayloadPrimitive(event.payload, 'sourceHypothesisId') === hypothesis.id ||
            tracePayloadPrimitive(event.payload, 'targetHypothesisId') === hypothesis.id)
      ) ?? null
  );
}

export function traceEventForFinding<T extends TraceEventRecord>(events: T[], finding: FindingRecord, hypothesis: HypothesisRecord | null): T | null {
  const directEvent =
    [...events].reverse().find((event) => event.type === 'finding_event' && tracePayloadPrimitive(event.payload, 'findingId') === finding.id) ?? null;
  if (directEvent) return directEvent;
  return hypothesis ? traceEventForHypothesis(events, hypothesis) : null;
}

export function traceEventForEvidence<T extends TraceEventRecord>(events: T[], evidence: EvidenceRecord): T | null {
  if (evidence.observationTraceEventId) {
    const observationEvent = events.find((event) => event.id === evidence.observationTraceEventId);
    if (observationEvent) return observationEvent;
  }

  return (
    [...events]
      .reverse()
      .find(
        (event) =>
          (evidence.artifactId && tracePayloadAny(event.payload, ['artifactId', 'artifact_id']) === evidence.artifactId) ||
          (evidence.verifierRunId && tracePayloadAny(event.payload, ['verifierRunId', 'verifier_run_id']) === evidence.verifierRunId) ||
          tracePayloadAny(event.payload, ['evidenceId', 'evidence_id']) === evidence.id
      ) ?? null
  );
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function uniqueEvidence(items: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function sortFindings(findings: FindingRecord[]): FindingRecord[] {
  return [...findings].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function latestTrailTimestamp(hypothesis: HypothesisRecord | null, findings: FindingRecord[], evidence: EvidenceRecord[]): string {
  return [hypothesis?.updatedAt, ...findings.map((finding) => finding.updatedAt), ...evidence.map((item) => item.createdAt)]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? new Date(0).toISOString();
}

function tracePayloadAny(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = tracePayloadPrimitive(payload, key);
    if (value) return value;
  }
  return null;
}
