import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Clock, FileText, GitFork } from 'lucide-react';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import type { TraceCategoryId } from '../../traceClassification';
import { sessionHeaderTiming } from '../../view-models/sessionHeader';
import { SessionUsageStatus } from '../momentum/SessionUsageStatus';

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
      <SessionUsageStatus detail={detail} />
      <span
        className="session-header-metric session-stat-tooltip"
        data-tooltip={`Model turns\n${timing.latestTurn}\n${timing.turnTooltip}`}
        aria-label={`Current model turn ${timing.latestTurn}`}
      >
        <GitFork size={13} />
        <span>{timing.latestTurn}</span>
      </span>
      <span
        className="session-header-metric session-stat-tooltip"
        data-tooltip={`Trace events\n${timing.totalEventCount.toLocaleString()} recorded this session`}
        aria-label={`${timing.totalEventCount} total trace events`}
      >
        <FileText size={13} />
        <span>{timing.eventMetric}</span>
      </span>
      <span
        className="session-header-metric session-duration-metric session-stat-tooltip"
        data-tooltip={`Session duration\n${timing.durationLabel}\n${timing.durationTooltip}`}
        aria-label={`Session duration ${timing.durationLabel}`}
      >
        <Clock size={13} />
        <span>{timing.durationLabel}</span>
      </span>
    </div>
  );
}
