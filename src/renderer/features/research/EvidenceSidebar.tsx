import type { JSX } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { ArtifactRecord, EvidenceRecord, FindingRecord, HypothesisRecord, RunDetail, VerifierRunRecord } from '@shared/types';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatPriorityPill, formatSessionTime, stateClass, traceLabel } from '../../lib/formatting';
import { evidenceScrollKey, sortedEvidence } from '../../view-models/researchItems';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';

export function EvidenceSidebar({
  detail,
  events,
  onSelectTraceEvent
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  useDevRenderProbe('evidence.sidebar', () => ({
    loaded: Boolean(detail),
    evidence: detail?.evidence.length ?? 0,
    traceEvents: detail?.traceEvents.length ?? 0
  }));
  if (!detail) {
    return (
      <div className="inspector-empty-state">
        <span>Evidence</span>
        <p>Open a research session to review evidence.</p>
      </div>
    );
  }

  const evidence = sortedEvidence(detail.evidence);

  return (
    <div className="evidence-sidebar">
      <div className="evidence-sidebar-heading">
        <span>Evidence</span>
        <strong>{evidence.length}</strong>
      </div>
      {evidence.length === 0 ? (
        <div className="inspector-empty-state evidence-empty-state">
          <span>No Evidence</span>
          <p>Evidence promoted from tools, artifacts, and verifier runs will appear here.</p>
        </div>
      ) : (
        <MainSideScrollRegion listClassName="evidence-sidebar-list" updateKey={evidenceScrollKey(evidence)}>
          {evidence.map((item) => {
            const hypothesis = item.hypothesisId ? detail.hypotheses.find((candidate) => candidate.id === item.hypothesisId) ?? null : null;
            const finding = item.findingId ? detail.findings.find((candidate) => candidate.id === item.findingId) ?? null : null;
            const artifact = item.artifactId ? detail.artifacts.find((candidate) => candidate.id === item.artifactId) ?? null : null;
            const verifierRun = item.verifierRunId ? detail.verifierRuns.find((candidate) => candidate.id === item.verifierRunId) ?? null : null;
            const observationEvent = item.observationTraceEventId ? events.find((event) => event.id === item.observationTraceEventId) ?? null : null;
            return (
              <EvidenceSidebarItem
                artifact={artifact}
                evidence={item}
                finding={finding}
                hypothesis={hypothesis}
                key={item.id}
                observationEvent={observationEvent}
                verifierRun={verifierRun}
                onSelectTraceEvent={onSelectTraceEvent}
              />
            );
          })}
        </MainSideScrollRegion>
      )}
    </div>
  );
}

function EvidenceSidebarItem({
  artifact,
  evidence,
  finding,
  hypothesis,
  observationEvent,
  verifierRun,
  onSelectTraceEvent
}: {
  artifact: ArtifactRecord | null;
  evidence: EvidenceRecord;
  finding: FindingRecord | null;
  hypothesis: HypothesisRecord | null;
  observationEvent: TraceDisplayEvent | null;
  verifierRun: VerifierRunRecord | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const title = finding?.title ?? hypothesis?.title ?? traceLabel(evidence.kind);
  const disabled = !observationEvent;
  return (
    <button
      type="button"
      className={`evidence-sidebar-item ${verifierRun ? `verifier-${stateClass(verifierRun.status)}` : ''}`}
      disabled={disabled}
      title={disabled ? 'No observation trace is linked to this evidence' : 'Open observation trace'}
      onClick={() => observationEvent && onSelectTraceEvent(observationEvent)}
    >
      <div className="evidence-sidebar-topline">
        <span>
          <ClipboardCheck size={13} />
          {traceLabel(evidence.kind)}
        </span>
        <span>{formatEvidenceTimestamp(evidence.createdAt)}</span>
      </div>
      <strong>{title}</strong>
      <p>{evidence.summary || 'No evidence summary recorded.'}</p>
      <div className="evidence-sidebar-meta" aria-label="Evidence references">
        {finding ? <span>{traceLabel(finding.state)}</span> : null}
        {hypothesis ? <span>{formatPriorityPill(hypothesis.priorityScore)}</span> : null}
        {artifact ? <span>{traceLabel(artifact.kind)}</span> : null}
        {verifierRun ? <span>{traceLabel(verifierRun.status)}</span> : null}
      </div>
    </button>
  );
}

function formatEvidenceTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatSessionTime(date);
}
