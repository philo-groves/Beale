import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Clock, FileText, GitFork, Pause, RefreshCw, Square, X } from 'lucide-react';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { displaySessionTitle } from '../../../shared/sessionTitle';
import { traceLabel } from '../../lib/formatting';
import type { TraceCategoryId } from '../../traceClassification';
import { runStatusClass, sessionConfigPills, sessionHeaderTiming } from '../../view-models/sessionHeader';

export function SessionHeader({
  programName,
  detail,
  events,
  visibleTraceCategories,
  onOpenResearchPrompt
}: {
  programName: string;
  detail: RunDetail | null;
  events: TraceEventRecord[];
  visibleTraceCategories: TraceCategoryId[];
  onOpenResearchPrompt: (detail: RunDetail) => void;
}): JSX.Element {
  return (
    <div className="workbench-header">
      <div className="workbench-program">
        <RunStatusIndicator detail={detail} />
        <span className="workbench-title">{programName}</span>
        {detail ? (
          <button type="button" className="workbench-session-title" title="View original research prompt" onClick={() => onOpenResearchPrompt(detail)}>
            <span>{displaySessionTitle(detail.run.title, detail.run.promptMarkdown)}</span>
          </button>
        ) : null}
        {detail ? <SessionConfigPills detail={detail} /> : null}
      </div>
      <SessionTimestamps detail={detail} events={events} visibleTraceCategories={visibleTraceCategories} />
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
        title="Visible trace events after filters, followed by total trace events when filters are active."
        aria-label={`${timing.visibleEventCount} visible trace events out of ${timing.totalEventCount} total trace events`}
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
