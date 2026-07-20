import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, Braces, Clock, FileText, GitFork, List } from 'lucide-react';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import type { TraceCategoryId } from '../../traceClassification';
import { sessionHeaderTiming } from '../../view-models/sessionHeader';
import { SESSION_MAIN_VIEW_ORDER, type SessionMainView } from './sessionViews';

export function SessionViewControls({
  sessionView,
  selectedSubagentPath,
  onBackToMain,
  onSessionViewChange
}: {
  sessionView: SessionMainView;
  selectedSubagentPath: string | null;
  onBackToMain: () => void;
  onSessionViewChange: (view: SessionMainView) => void;
}): JSX.Element {
  const optionByView: Record<SessionMainView, { label: string; icon: JSX.Element }> = {
    context: { label: 'Context view', icon: <Braces size={15} /> },
    list: { label: 'Trace log', icon: <List size={15} /> }
  };
  const options = SESSION_MAIN_VIEW_ORDER.map((view) => ({ view, ...optionByView[view] }));

  return (
    <div className="app-header-view-controls">
      <div className="session-view-toggle" role="group" aria-label="Session view">
        {options.map((option) => (
          <button
            type="button"
            className={`session-view-button ${sessionView === option.view ? 'active' : ''}`}
            title={option.label}
            aria-label={option.label}
            aria-pressed={sessionView === option.view}
            key={option.view}
            onClick={() => onSessionViewChange(option.view)}
          >
            {option.icon}
          </button>
        ))}
      </div>
      {selectedSubagentPath ? (
        <button type="button" className="back-to-main-button" title="Return to the full session trace" onClick={onBackToMain}>
          <ArrowLeft size={14} />
          <span>Back to Main</span>
        </button>
      ) : null}
    </div>
  );
}

export function SessionMetrics({
  detail,
  events,
  visibleTraceCategories
}: {
  detail: RunDetail;
  events: TraceEventRecord[];
  visibleTraceCategories: TraceCategoryId[];
}): JSX.Element | null {
  const active = detail.run.status === 'active';
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active, detail.run.id]);

  const timing = sessionHeaderTiming(detail, events, visibleTraceCategories, nowMs);
  if (!timing) return null;

  return (
    <div className="session-header-metrics" aria-label="Session statistics">
      <span className="session-header-metric" title={timing.turnTooltip} aria-label={`Current model turn ${timing.latestTurn}`}>
        <GitFork size={13} />
        <span>{timing.latestTurn}</span>
      </span>
      <span className="session-header-metric" title="Total trace events recorded for this session." aria-label={`${timing.totalEventCount} total trace events`}>
        <FileText size={13} />
        <span>{timing.eventMetric}</span>
      </span>
      <span className="session-header-metric session-duration-metric" title={timing.durationTooltip} aria-label={`Session duration ${timing.durationLabel}`}>
        <Clock size={13} />
        <span>{timing.durationLabel}</span>
      </span>
    </div>
  );
}
