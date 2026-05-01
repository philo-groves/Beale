import { memo } from 'react';
import type { JSX } from 'react';
import { Bug, FileOutput } from 'lucide-react';
import type { FindingRecord, HypothesisRecord, RunDetail } from '@shared/types';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { useDevRenderProbe } from '../../devInstrumentation';
import { formatPriorityPill, stateClass, traceLabel } from '../../lib/formatting';
import { findingScrollKey, hypothesisScrollKey, traceEventForFinding, traceEventForHypothesis } from '../../view-models/researchItems';
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
          <Bug size={14} />
          <span>Hypotheses</span>
          <strong>{hypothesisCount}</strong>
        </span>
        <span className="main-research-ribbon-item">
          <FileOutput size={14} />
          <span>Findings</span>
          <strong>{findingCount}</strong>
        </span>
      </button>
      <div className="main-research-panel-content" aria-hidden={collapsed} inert={collapsed}>
        <MainHypothesisList detail={detail} events={events} selectedTraceEventId={selectedTraceEventId} onSelectTraceEvent={onSelectTraceEvent} />
        <MainFindingList detail={detail} events={events} selectedTraceEventId={selectedTraceEventId} onSelectTraceEvent={onSelectTraceEvent} />
      </div>
    </div>
  );
});

const MainHypothesisList = memo(function MainHypothesisList({
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
  const hypotheses = detail?.hypotheses ?? [];
  useDevRenderProbe('hypotheses.list', () => ({
    loading,
    hypotheses: hypotheses.length,
    events: events.length
  }));

  return (
    <section className="main-side-section main-hypothesis-view" aria-label="Hypotheses">
      <div className="main-surface-header">
        <div>
          <Bug size={14} />
          <span>Hypotheses</span>
        </div>
        <span>{loading ? 'Loading' : `${hypotheses.length}`}</span>
      </div>
      {loading ? <div className="main-trace-empty">Loading hypotheses.</div> : null}
      {!loading && hypotheses.length === 0 ? <div className="main-trace-empty">No hypotheses recorded.</div> : null}
      {!loading && hypotheses.length > 0 ? (
        <MainSideScrollRegion listClassName="main-hypothesis-list" updateKey={hypothesisScrollKey(hypotheses)}>
          {hypotheses.map((hypothesis) => {
            const event = traceEventForHypothesis(events, hypothesis);
            return (
              <MainHypothesisItem
                hypothesis={hypothesis}
                key={hypothesis.id}
                selected={event?.id === selectedTraceEventId}
                onSelect={event ? () => onSelectTraceEvent(event) : undefined}
              />
            );
          })}
        </MainSideScrollRegion>
      ) : null}
    </section>
  );
});

function MainHypothesisItem({ hypothesis, selected, onSelect }: { hypothesis: HypothesisRecord; selected: boolean; onSelect?: () => void }): JSX.Element {
  const disabled = !onSelect;
  return (
    <button
      type="button"
      className={`main-research-item main-hypothesis-item state-${stateClass(hypothesis.state)} ${selected ? 'selected' : ''}`}
      disabled={disabled}
      title={disabled ? 'No trace provenance available' : 'Inspect hypothesis trace'}
      onClick={onSelect}
    >
      <div className="main-research-topline">
        <strong>{hypothesis.title}</strong>
      </div>
      <div className="main-hypothesis-meta" aria-label="Hypothesis state, priority, and CWE">
        <span className="hypothesis-pill state-pill">{traceLabel(hypothesis.state)}</span>
        <span className="hypothesis-pill priority-pill">{formatPriorityPill(hypothesis.priorityScore)}</span>
        <CwePill mappings={hypothesis.cweMappings} />
      </div>
    </button>
  );
}

const MainFindingList = memo(function MainFindingList({
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
  const findings = detail?.findings ?? [];
  const hypotheses = detail?.hypotheses ?? [];
  useDevRenderProbe('findings.list', () => ({
    loading,
    findings: findings.length,
    hypotheses: hypotheses.length,
    events: events.length
  }));

  return (
    <section className="main-side-section main-finding-view" aria-label="Findings">
      <div className="main-surface-header">
        <div>
          <FileOutput size={14} />
          <span>Findings</span>
        </div>
        <span>{loading ? 'Loading' : `${findings.length}`}</span>
      </div>
      {loading ? <div className="main-trace-empty">Loading findings.</div> : null}
      {!loading && findings.length === 0 ? <div className="main-trace-empty">No findings recorded.</div> : null}
      {!loading && findings.length > 0 ? (
        <MainSideScrollRegion listClassName="main-finding-list" stickToEnd={true} updateKey={findingScrollKey(findings)}>
          {findings.map((finding) => {
            const hypothesis = finding.hypothesisId ? hypotheses.find((candidate) => candidate.id === finding.hypothesisId) ?? null : null;
            const event = traceEventForFinding(events, finding, hypothesis);
            return (
              <MainFindingItem
                finding={finding}
                hypothesis={hypothesis}
                key={finding.id}
                selected={event?.id === selectedTraceEventId}
                onSelect={event ? () => onSelectTraceEvent(event) : undefined}
              />
            );
          })}
        </MainSideScrollRegion>
      ) : null}
    </section>
  );
});

function MainFindingItem({
  finding,
  hypothesis,
  selected,
  onSelect
}: {
  finding: FindingRecord;
  hypothesis: HypothesisRecord | null;
  selected: boolean;
  onSelect?: () => void;
}): JSX.Element {
  const disabled = !onSelect;
  const tone = sessionHeatForFinding(finding, hypothesis);

  return (
    <button
      type="button"
      className={`main-research-item main-finding-item state-${stateClass(finding.state)} power-${tone} ${selected ? 'selected' : ''}`}
      disabled={disabled}
      title={disabled ? 'No trace provenance available' : 'Inspect finding trace'}
      onClick={onSelect}
    >
      <div className="main-finding-topline">
        <strong>{finding.title}</strong>
      </div>
      <div className="main-hypothesis-meta main-finding-meta" aria-label="Finding state, priority, and CWE">
        <span className="hypothesis-pill state-pill">{traceLabel(finding.state)}</span>
        <span className="hypothesis-pill priority-pill">{formatPriorityPill(finding.priorityScore)}</span>
        <CwePill mappings={finding.cweMappings} />
      </div>
    </button>
  );
}
