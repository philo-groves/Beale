import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Clock } from 'lucide-react';
import type { RunDetail } from '@shared/types';
import { sessionDurationTiming } from '../../view-models/sessionHeader';

export function SessionDurationMetric({ detail, className = '' }: { detail: RunDetail; className?: string }): JSX.Element | null {
  const active = detail.run.status === 'active';
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active, detail.run.id]);

  const timing = sessionDurationTiming(detail, nowMs);
  if (!timing) return null;

  return (
    <span
      className={`session-duration-metric session-stat-tooltip ${className}`.trim()}
      data-tooltip={`Session duration\n${timing.durationLabel}\n${timing.durationTooltip}`}
      aria-label={`Session duration ${timing.durationLabel}`}
    >
      <Clock size={13} />
      <span>{timing.durationLabel}</span>
    </span>
  );
}

export function SessionDurationMetricLoading({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span
      aria-label="Loading session duration"
      aria-busy="true"
      className={`session-summary-duration-loading ${className}`.trim()}
    >
      <Clock aria-hidden="true" size={13} />
      <span aria-hidden="true" className="session-summary-loading-line" />
    </span>
  );
}
