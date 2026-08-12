import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { MoonStar } from 'lucide-react';
import type { HoneycrispMemorySummary, ResearchProfile, RunRow } from '@shared/types';
import { memoryTypeClassName, memoryTypeLabel } from '../research/MemoryTypeLabel';
import {
  buildWorkspaceTimeline,
  formatWorkspaceTimelineDuration
} from '../../view-models/workspaceTimeline';
import type { WorkspaceTimelineResult } from '../../view-models/workspaceTimeline';

const TIMELINE_WINDOW_HOURS = 12;
const TIMELINE_TICK_HOURS = [0, 3, 6, 9, 12] as const;

export function WorkspaceUnderstandingView({
  busy,
  memoryDreamingInProgress,
  honeycrispMemory,
  researchProfile = null,
  workspaceName,
  runs,
  onRunMemoryDreaming,
  nowMs
}: {
  busy: boolean;
  memoryDreamingInProgress: boolean;
  honeycrispMemory: HoneycrispMemorySummary | null;
  researchProfile?: ResearchProfile | null;
  workspaceName: string;
  runs: RunRow[];
  onRunMemoryDreaming: () => void;
  nowMs?: number;
}): JSX.Element {
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (nowMs !== undefined) return undefined;
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [nowMs]);
  const timelineNowMs = nowMs ?? clockNowMs;
  const memoryTypes = researchProfile?.memory.types ?? [];
  const timeline = useMemo(
    () => buildWorkspaceTimeline(
      runs,
      honeycrispMemory?.nodes ?? [],
      honeycrispMemory?.runbooks ?? [],
      honeycrispMemory?.reports ?? [],
      memoryTypes,
      timelineNowMs
    ),
    [honeycrispMemory?.nodes, honeycrispMemory?.reports, honeycrispMemory?.runbooks, memoryTypes, runs, timelineNowMs]
  );
  const timelineRows = timeline.rows;
  const axisWindowDurationMs = timeline.windowDurationMs || TIMELINE_WINDOW_HOURS * 60 * 60 * 1_000;
  const memoryEnabled = researchProfile?.capabilities.memoryEnabled !== false;
  const dreamDisabled = busy || memoryDreamingInProgress || !memoryEnabled || honeycrispMemory?.dreaming.available === false;
  const timelineAriaLabel = `${workspaceName.trim() || 'Workspace'} — most recent 12 hours of session activity`;

  return (
    <main className="workspace-dashboard" aria-label="Workspace dashboard">
      <section className="workspace-dashboard-half workspace-timeline-card" aria-label={timelineAriaLabel}>
        <div className="workspace-timeline-chart">
          <div className="workspace-timeline-axis" aria-hidden="true">
            <span />
            <div className="workspace-timeline-axis-track">
              {TIMELINE_TICK_HOURS.map((hour) => {
                const remainingDurationMs = axisWindowDurationMs * ((TIMELINE_WINDOW_HOURS - hour) / TIMELINE_WINDOW_HOURS);
                return (
                  <span key={hour} style={{ left: `${(hour / TIMELINE_WINDOW_HOURS) * 100}%` }}>
                    {hour === TIMELINE_WINDOW_HOURS ? 'Latest' : `-${formatWorkspaceTimelineDuration(remainingDurationMs)}`}
                  </span>
                );
              })}
            </div>
            <span />
          </div>
          <div className="workspace-timeline-rows">
            {timelineRows.length > 0 ? timelineRows.map((row) => (
              <div className="workspace-timeline-row" key={row.sessionRunId}>
                <div className="workspace-timeline-session-label" title={row.title}>
                  {row.title}
                </div>
                <div className="workspace-timeline-track">
                  {TIMELINE_TICK_HOURS.map((hour) => (
                    <i
                      aria-hidden="true"
                      className="workspace-timeline-gridline"
                      key={hour}
                      style={{ left: `${(hour / TIMELINE_WINDOW_HOURS) * 100}%` }}
                    />
                  ))}
                  {row.segments.map((segment) => (
                    <span
                      aria-label={`${row.title} work interval`}
                      className="workspace-timeline-segment"
                      key={segment.id}
                      style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
                      title={`${formatDateTime(segment.startedAt)} – ${segment.endedAt ? formatDateTime(segment.endedAt) : 'Now'}`}
                    />
                  ))}
                  {row.memoryMarkers.map((marker) => (
                    <span
                      aria-label={`${memoryTypeLabel(marker.type, memoryTypes)} memory recorded: ${marker.title}`}
                      className={`workspace-timeline-memory-marker ${memoryTypeClassName(marker.type, memoryTypes)}`}
                      key={marker.id}
                      style={{
                        left: `${marker.leftPercent}%`,
                        ...(marker.color ? { '--memory-type-color': marker.color } : {})
                      } as CSSProperties}
                      title={`${memoryTypeLabel(marker.type, memoryTypes)} · ${marker.title} · ${formatDateTime(marker.createdAt)}`}
                    />
                  ))}
                  {row.runbookRevisionMarkers.map((marker) => (
                    <span
                      aria-label={`Runbook revision ${marker.revision}: ${marker.title}`}
                      className="workspace-timeline-runbook-marker"
                      key={marker.id}
                      style={{ left: `${marker.leftPercent}%` }}
                      title={`Runbook · ${marker.title} · Revision ${marker.revision} · ${formatDateTime(marker.createdAt)}`}
                    />
                  ))}
                  {row.reportRevisionMarkers.map((marker) => (
                    <span
                      aria-label={`Report revision ${marker.revision}: ${marker.title}`}
                      className="workspace-timeline-report-marker"
                      key={marker.id}
                      style={{ left: `${marker.leftPercent}%` }}
                      title={`Report · ${marker.title} · Revision ${marker.revision} · ${formatDateTime(marker.createdAt)}`}
                    />
                  ))}
                </div>
                <div className="workspace-timeline-result">
                  {row.result ? <WorkspaceTimelineResultSymbol result={row.result} /> : null}
                </div>
              </div>
            )) : (
              <div className="workspace-timeline-empty">No session activity recorded.</div>
            )}
          </div>
        </div>
        <div className="workspace-timeline-legend" aria-label="Timeline legend">
          <div className="workspace-timeline-legend-row is-session-items">
            <span><i className="workspace-timeline-duration-swatch" />Work duration</span>
            <span><i className="workspace-timeline-memory-swatch" />Memory recorded</span>
            <span><i className="workspace-timeline-runbook-swatch" />Runbook revision</span>
            <span><i className="workspace-timeline-report-swatch" />Report revision</span>
          </div>
          <div className="workspace-timeline-legend-row is-session-results">
            <span><WorkspaceTimelineResultSymbol result="natural_end" />No error</span>
            <span><WorkspaceTimelineResultSymbol result="unexpected_error" />Unexpected error</span>
            <span><WorkspaceTimelineResultSymbol result="safeguard_error" />Safeguard error</span>
          </div>
        </div>
      </section>

      <section className="workspace-dashboard-half workspace-dream-area" aria-label="Memory dreaming">
        <article className="workspace-dream-card">
          <button
            type="button"
            className="workspace-dream-button"
            disabled={dreamDisabled}
            title={!memoryEnabled ? 'Memory Dreaming is disabled by the active research profile' : 'Dream across workspace memories'}
            onClick={onRunMemoryDreaming}
          >
            <MoonStar size={18} />
            {memoryDreamingInProgress ? 'Dreaming…' : 'Dream'}
          </button>
        </article>
      </section>
    </main>
  );
}

function WorkspaceTimelineResultSymbol({ result }: { result: WorkspaceTimelineResult }): JSX.Element {
  const label = result === 'natural_end'
    ? 'No error'
    : result === 'safeguard_error'
      ? 'Safeguard error'
      : 'Unexpected error';
  return (
    <i
      aria-label={label}
      className={`workspace-timeline-result-symbol is-${result.replace('_', '-')}`}
      role="img"
      title={label}
    />
  );
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(timestamp);
}
