import { memo, useMemo } from 'react';
import type { JSX } from 'react';
import { Bug, ClipboardCheck, FileOutput, GitBranch } from 'lucide-react';
import type { EvidenceRecord, FindingRecord, HypothesisRecord, RunDetail } from '@shared/types';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatPriorityPill, formatSessionTime, stateClass, traceLabel } from '../../lib/formatting';
import {
  buildEvidenceTrails,
  evidenceTrailScrollKey,
  traceEventForEvidence,
  traceEventForFinding,
  traceEventForHypothesis,
  type EvidenceTrail
} from '../../view-models/researchItems';
import { sessionHeatForFinding } from '../../view-models/sessionHeat';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { CwePill } from './CwePill';

export const ResearchSidePanel = memo(function ResearchSidePanel({
  collapsed,
  detail,
  events,
  selectedTraceEventId,
  onExpand,
  onSelectTraceEvent
}: {
  collapsed: boolean;
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  selectedTraceEventId: string | null;
  onExpand: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const hypothesisCount = detail?.hypotheses.length ?? 0;
  const findingCount = detail?.findings.length ?? 0;
  const evidenceCount = detail?.evidence.length ?? 0;

  return (
    <div className={`main-session-side ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="main-research-ribbon"
        aria-label="Show hypotheses and findings"
        aria-expanded={!collapsed}
        aria-hidden={!collapsed}
        tabIndex={collapsed ? 0 : -1}
        onClick={onExpand}
      >
        <span className="main-research-ribbon-item">
          <GitBranch size={14} />
          <span>Trails</span>
          <strong>{Math.max(hypothesisCount, findingCount)}</strong>
        </span>
        <span className="main-research-ribbon-item">
          <ClipboardCheck size={14} />
          <span>Evidence</span>
          <strong>{evidenceCount}</strong>
        </span>
      </button>
      <div className="main-research-panel-content" aria-hidden={collapsed} inert={collapsed}>
        <EvidenceTrailList detail={detail} events={events} selectedTraceEventId={selectedTraceEventId} onSelectTraceEvent={onSelectTraceEvent} />
      </div>
    </div>
  );
});

const EvidenceTrailList = memo(function EvidenceTrailList({
  detail,
  events,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const loading = !detail;
  const trails = useMemo(() => (detail ? buildEvidenceTrails(detail.hypotheses, detail.findings, detail.evidence) : []), [detail]);
  const artifactById = useMemo(() => new Map((detail?.artifacts ?? []).map((artifact) => [artifact.id, artifact])), [detail?.artifacts]);
  const verifierRunById = useMemo(() => new Map((detail?.verifierRuns ?? []).map((run) => [run.id, run])), [detail?.verifierRuns]);

  useDevRenderProbe('research.trails', () => ({
    loading,
    trails: trails.length,
    hypotheses: detail?.hypotheses.length ?? 0,
    findings: detail?.findings.length ?? 0,
    evidence: detail?.evidence.length ?? 0,
    events: events.length
  }));

  return (
    <section className="main-side-section main-trail-view" aria-label="Evidence Trail">
      <div className="main-surface-header">
        <div>
          <GitBranch size={14} />
          <span>Evidence Trail</span>
        </div>
        <span>{loading ? 'Loading' : `${trails.length}`}</span>
      </div>
      {loading ? <div className="main-trace-empty">Loading evidence trail.</div> : null}
      {!loading && trails.length === 0 ? <div className="main-trace-empty">No hypotheses, findings, or evidence recorded.</div> : null}
      {!loading && trails.length > 0 ? (
        <MainSideScrollRegion listClassName="main-trail-list" updateKey={evidenceTrailScrollKey(trails)}>
          {trails.map((trail) => (
            <EvidenceTrailItem
              artifactById={artifactById}
              events={events}
              key={trail.id}
              selectedTraceEventId={selectedTraceEventId}
              trail={trail}
              verifierRunById={verifierRunById}
              onSelectTraceEvent={onSelectTraceEvent}
            />
          ))}
        </MainSideScrollRegion>
      ) : null}
    </section>
  );
});

function EvidenceTrailItem({
  artifactById,
  events,
  selectedTraceEventId,
  trail,
  verifierRunById,
  onSelectTraceEvent
}: {
  artifactById: Map<string, RunDetail['artifacts'][number]>;
  events: TraceDisplayEvent[];
  selectedTraceEventId: string | null;
  trail: EvidenceTrail;
  verifierRunById: Map<string, RunDetail['verifierRuns'][number]>;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const hasRoot = Boolean(trail.hypothesis);
  return (
    <article className={`main-trail-card ${hasRoot ? '' : 'rootless'}`}>
      {trail.hypothesis ? (
        <HypothesisTrailNode
          events={events}
          hypothesis={trail.hypothesis}
          selectedTraceEventId={selectedTraceEventId}
          onSelectTraceEvent={onSelectTraceEvent}
        />
      ) : null}
      <div className={`main-trail-children ${hasRoot ? '' : 'rootless'}`}>
        {trail.evidence.map((item) => (
          <EvidenceTrailNode
            artifactKind={item.artifactId ? artifactById.get(item.artifactId)?.kind ?? null : null}
            evidence={item}
            event={traceEventForEvidence(events, item)}
            key={item.id}
            selectedTraceEventId={selectedTraceEventId}
            verifierStatus={item.verifierRunId ? verifierRunById.get(item.verifierRunId)?.status ?? null : null}
            onSelectTraceEvent={onSelectTraceEvent}
          />
        ))}
        {trail.findings.map((finding) => (
          <FindingTrailNode
            events={events}
            finding={finding}
            hypothesis={trail.hypothesis}
            key={finding.id}
            selectedTraceEventId={selectedTraceEventId}
            onSelectTraceEvent={onSelectTraceEvent}
          />
        ))}
      </div>
    </article>
  );
}

function HypothesisTrailNode({
  events,
  hypothesis,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  events: TraceDisplayEvent[];
  hypothesis: HypothesisRecord;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const event = traceEventForHypothesis(events, hypothesis);
  const disabled = !event;
  return (
    <button
      type="button"
      className={`main-trail-node main-trail-hypothesis state-${stateClass(hypothesis.state)} ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      disabled={disabled}
      title={disabled ? 'No trace provenance available' : 'Inspect hypothesis trace'}
      onClick={() => event && onSelectTraceEvent(event)}
    >
      <div className="main-trail-node-topline">
        <span>
          <Bug size={13} />
          Hypothesis
        </span>
        <span>{traceLabel(hypothesis.state)}</span>
      </div>
      <strong>{hypothesis.title}</strong>
      <div className="main-trail-meta" aria-label="Hypothesis state, priority, and CWE">
        <span className="hypothesis-pill state-pill">{traceLabel(hypothesis.state)}</span>
        <span className="hypothesis-pill priority-pill">{formatPriorityPill(hypothesis.priorityScore)}</span>
        <CwePill mappings={hypothesis.cweMappings} />
      </div>
    </button>
  );
}

function FindingTrailNode({
  events,
  finding,
  hypothesis,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  events: TraceDisplayEvent[];
  finding: FindingRecord;
  hypothesis: HypothesisRecord | null;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const event = traceEventForFinding(events, finding, hypothesis);
  const disabled = !event;
  const tone = sessionHeatForFinding(finding, hypothesis);

  return (
    <button
      type="button"
      className={`main-trail-node main-trail-finding state-${stateClass(finding.state)} power-${tone} ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      disabled={disabled}
      title={disabled ? 'No trace provenance available' : 'Inspect finding trace'}
      onClick={() => event && onSelectTraceEvent(event)}
    >
      <div className="main-trail-node-topline">
        <span>
          <FileOutput size={13} />
          Finding
        </span>
        <span>{traceLabel(finding.state)}</span>
      </div>
      <strong>{finding.title}</strong>
      <div className="main-trail-meta" aria-label="Finding state, priority, and CWE">
        <span className="hypothesis-pill state-pill">{traceLabel(finding.state)}</span>
        <span className="hypothesis-pill priority-pill">{formatPriorityPill(finding.priorityScore)}</span>
        <CwePill mappings={finding.cweMappings} />
      </div>
    </button>
  );
}

function EvidenceTrailNode({
  artifactKind,
  evidence,
  event,
  selectedTraceEventId,
  verifierStatus,
  onSelectTraceEvent
}: {
  artifactKind: string | null;
  evidence: EvidenceRecord;
  event: TraceDisplayEvent | null;
  selectedTraceEventId: string | null;
  verifierStatus: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const disabled = !event;
  const date = new Date(evidence.createdAt);
  const time = Number.isNaN(date.getTime()) ? '' : formatSessionTime(date);

  return (
    <button
      type="button"
      className={`main-trail-node main-trail-evidence ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      disabled={disabled}
      title={disabled ? 'No observation trace is linked to this evidence' : 'Inspect evidence trace'}
      onClick={() => event && onSelectTraceEvent(event)}
    >
      <div className="main-trail-node-topline">
        <span>
          <ClipboardCheck size={13} />
          Evidence
        </span>
        <span>{time}</span>
      </div>
      <strong>{evidence.summary || traceLabel(evidence.kind)}</strong>
      <div className="main-trail-meta" aria-label="Evidence references">
        <span className="hypothesis-pill state-pill">{traceLabel(evidence.kind)}</span>
        {artifactKind ? <span className="hypothesis-pill">{traceLabel(artifactKind)}</span> : null}
        {verifierStatus ? <span className={`hypothesis-pill verifier-${stateClass(verifierStatus)}`}>{traceLabel(verifierStatus)}</span> : null}
      </div>
    </button>
  );
}
