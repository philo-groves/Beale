import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Braces, Check, Clock, FileText, GitFork, List, Pause, RefreshCw, X } from 'lucide-react';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { stateClass, traceLabel } from '../../lib/formatting';
import type { TraceCategoryId } from '../../traceClassification';
import { runStatusClass, sessionConfigPills, sessionHeaderTiming } from '../../view-models/sessionHeader';
import { SESSION_MAIN_VIEW_ORDER, type SessionMainView } from './sessionViews';

export function SessionHeader({
  detail,
  events,
  honeycrispMemoryStatus,
  workspaceOpen,
  visibleTraceCategories,
  sessionView,
  onSessionViewChange
}: {
  detail: RunDetail | null;
  events: TraceEventRecord[];
  honeycrispMemoryStatus: string | null;
  workspaceOpen: boolean;
  visibleTraceCategories: TraceCategoryId[];
  sessionView: SessionMainView;
  onSessionViewChange: (view: SessionMainView) => void;
}): JSX.Element {
  return (
    <div className="workbench-header">
      <div className="workbench-workspace">
        {detail ? (
          <>
            <RunStatusIndicator detail={detail} />
            <SessionViewToggle sessionView={sessionView} onSessionViewChange={onSessionViewChange} />
          </>
        ) : workspaceOpen ? (
          <span className="workspace-header-view-title">Honeycrisp Memory</span>
        ) : null}
      </div>
      <div className="workbench-session-controls">
        {detail ? (
          <>
            <SessionConfigPills detail={detail} />
            <SessionTimestamps detail={detail} events={events} visibleTraceCategories={visibleTraceCategories} />
          </>
        ) : workspaceOpen ? (
          <WorkspaceHeaderStatusPills memoryStatus={honeycrispMemoryStatus} />
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceHeaderStatusPills({ memoryStatus }: { memoryStatus: string | null }): JSX.Element {
  return (
    <div className="workspace-header-status-strip" aria-label="Workspace memory status">
      <WorkspaceHeaderStatusPill label="Memory" value={memoryStatus ?? 'missing'} />
    </div>
  );
}

function WorkspaceHeaderStatusPill({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className={`workspace-understanding-status status-${stateClass(value)}`} title={`${label}: ${traceLabel(value)}`}>
      {label}: {traceLabel(value)}
    </span>
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
      <Check size={17} strokeWidth={3} />
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
  const optionByView: Record<SessionMainView, { label: string; icon: JSX.Element }> = {
    context: { label: 'Context view', icon: <Braces size={15} /> },
    list: { label: 'Trace log', icon: <List size={15} /> }
  };
  const options = SESSION_MAIN_VIEW_ORDER.map((view) => ({ view, ...optionByView[view] }));

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
