import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Clock, FileText, GitBranch, GitFork, List, Network, Pause, RefreshCw, Square, X } from 'lucide-react';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { stateClass, traceLabel } from '../../lib/formatting';
import type { ProgramMainView } from '../programs/programViews';
import type { TraceCategoryId } from '../../traceClassification';
import { runStatusClass, sessionConfigPills, sessionHeaderTiming } from '../../view-models/sessionHeader';
import type { SessionMainView } from './sessionViews';

export function SessionHeader({
  detail,
  events,
  programGraphStatus,
  programSemanticStatus,
  programView,
  visibleTraceCategories,
  sessionView,
  onProgramViewChange,
  onSessionViewChange
}: {
  detail: RunDetail | null;
  events: TraceEventRecord[];
  programGraphStatus: string | null;
  programSemanticStatus: string | null;
  programView: ProgramMainView | null;
  visibleTraceCategories: TraceCategoryId[];
  sessionView: SessionMainView;
  onProgramViewChange: (view: ProgramMainView) => void;
  onSessionViewChange: (view: SessionMainView) => void;
}): JSX.Element {
  return (
    <div className="workbench-header">
      <div className="workbench-program">
        {detail ? (
          <>
            <RunStatusIndicator detail={detail} />
            <SessionViewToggle sessionView={sessionView} onSessionViewChange={onSessionViewChange} />
          </>
        ) : programView ? (
          <>
            <ProgramViewToggle programView={programView} onProgramViewChange={onProgramViewChange} />
            <span className="program-header-view-title">{programViewTitle(programView)}</span>
          </>
        ) : null}
      </div>
      <div className="workbench-session-controls">
        {detail ? (
          <>
            <SessionConfigPills detail={detail} />
            <SessionTimestamps detail={detail} events={events} visibleTraceCategories={visibleTraceCategories} />
          </>
        ) : programView ? (
          <ProgramHeaderStatusPills graphStatus={programGraphStatus} semanticStatus={programSemanticStatus} />
        ) : null}
      </div>
    </div>
  );
}

function programViewTitle(programView: ProgramMainView): string {
  return programView === 'graph' ? 'Relationship Graph' : 'Program Understanding';
}

function ProgramHeaderStatusPills({
  graphStatus,
  semanticStatus
}: {
  graphStatus: string | null;
  semanticStatus: string | null;
}): JSX.Element {
  return (
    <div className="program-header-status-strip" aria-label="Index status">
      <ProgramHeaderStatusPill label="Graph" value={graphStatus ?? 'empty'} />
      <ProgramHeaderStatusPill label="Search Memory" value={semanticStatus ?? 'empty'} />
    </div>
  );
}

function ProgramHeaderStatusPill({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className={`program-understanding-status status-${stateClass(value)}`} title={`${label}: ${traceLabel(value)}`}>
      {label}: {traceLabel(value)}
    </span>
  );
}

function ProgramViewToggle({
  programView,
  onProgramViewChange
}: {
  programView: ProgramMainView;
  onProgramViewChange: (view: ProgramMainView) => void;
}): JSX.Element {
  const options: Array<{ view: ProgramMainView; label: string; icon: JSX.Element }> = [
    { view: 'understanding', label: 'Program Understanding', icon: <GitBranch size={15} /> },
    { view: 'graph', label: 'Relationship graph visualization', icon: <Network size={15} /> }
  ];

  return (
    <div className="session-view-toggle" role="group" aria-label="Program view">
      {options.map((option) => (
        <button
          type="button"
          className={`session-view-button ${programView === option.view ? 'active' : ''}`}
          title={option.label}
          aria-label={option.label}
          aria-pressed={programView === option.view}
          key={option.view}
          onClick={() => onProgramViewChange(option.view)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

function RunStatusIndicator({ detail }: { detail: RunDetail | null }): JSX.Element | null {
  if (!detail) return null;
  const status = detail.run.status;
  const statusClass = runStatusClass(status);
  const label = traceLabel(status);
  const icon =
    statusClass === 'active' ? (
      <RefreshCw size={13} />
    ) : statusClass === 'paused' ? (
      <Pause size={17} strokeWidth={2.8} />
    ) : statusClass === 'completed' ? (
      <Square size={16} strokeWidth={2.6} />
    ) : statusClass === 'failed' ? (
      <X size={17} strokeWidth={3.2} />
    ) : null;

  if (!icon) return null;
  return (
    <span className={`workbench-run-status run-status-${statusClass}`} title={`Run status: ${label}`} aria-label={`Run status: ${label}`}>
      {icon}
    </span>
  );
}

function SessionConfigPills({ detail }: { detail: RunDetail }): JSX.Element {
  const pills = sessionConfigPills(detail);

  return (
    <div className="session-config-pills" aria-label="Session configuration">
      {pills.map((pill) => (
        <span className="session-config-pill" title={pill.tooltip} aria-label={pill.tooltip} key={pill.tooltip}>
          {pill.label}
        </span>
      ))}
    </div>
  );
}

function SessionTimestamps({
  detail,
  events,
  visibleTraceCategories
}: {
  detail: RunDetail | null;
  events: TraceEventRecord[];
  visibleTraceCategories: TraceCategoryId[];
}): JSX.Element | null {
  const active = detail?.run.status === 'active';
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active, detail?.run.id]);

  if (!detail) return null;
  const timing = sessionHeaderTiming(detail, events, visibleTraceCategories, nowMs);
  if (!timing) return null;

  return (
    <div className="session-start-time">
      <span className="session-header-metric" title={timing.turnTooltip} aria-label={`Current model turn ${timing.latestTurn}`}>
        <GitFork size={13} />
        <span>{timing.latestTurn}</span>
      </span>
      <span
        className="session-header-metric"
        title="Total trace events recorded for this session."
        aria-label={`${timing.totalEventCount} total trace events`}
      >
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

function SessionViewToggle({
  sessionView,
  onSessionViewChange
}: {
  sessionView: SessionMainView;
  onSessionViewChange: (view: SessionMainView) => void;
}): JSX.Element {
  const options: Array<{ view: SessionMainView; label: string; icon: JSX.Element }> = [
    { view: 'list', label: 'Trace and evidence lists', icon: <List size={15} /> },
    { view: 'graph', label: 'Graph view', icon: <Network size={15} /> }
  ];

  return (
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
  );
}
