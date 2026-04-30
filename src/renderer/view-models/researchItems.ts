import type { EvidenceRecord, FindingRecord, HypothesisRecord, TraceEventRecord } from '@shared/types';
import { tracePayloadPrimitive } from '../traceClassification';

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
