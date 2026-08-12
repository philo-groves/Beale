import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { MoonStar } from 'lucide-react';
import type { HoneycrispMemorySummary, ResearchProfile, RunRow } from '@shared/types';
import { memoryTypeClassName, memoryTypeLabel } from '../research/MemoryTypeLabel';
import {
  buildWorkspaceTimeline,
  formatWorkspaceTimelineDuration,
  WORKSPACE_TIMELINE_WINDOW_MS
} from '../../view-models/workspaceTimeline';

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
  const timelineRows = useMemo(
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
  const memoryEnabled = researchProfile?.capabilities.memoryEnabled !== false;
  const dreamDisabled = busy || memoryDreamingInProgress || !memoryEnabled || honeycrispMemory?.dreaming.available === false;
  const activityTitle = `${workspaceName.trim() || 'Workspace'} Activity`;

  return (
    <main className="workspace-dashboard" aria-label="Workspace dashboard">
      <section className="workspace-dashboard-half workspace-timeline-card" aria-label="Session activity over the past 12 hours">
        <header className="workspace-timeline-header">
          <h2>{activityTitle}</h2>
          <div className="workspace-timeline-legend" aria-label="Timeline legend">
            <span><i className="workspace-timeline-duration-swatch" />Work duration</span>
            <span><i className="workspace-timeline-memory-swatch" />Memory recorded</span>
            <span><i className="workspace-timeline-runbook-swatch" />Runbook revision</span>
            <span><i className="workspace-timeline-report-swatch" />Report revision</span>
          </div>
        </header>

        <div className="workspace-timeline-chart">
          <div className="workspace-timeline-axis" aria-hidden="true">
            <span />
            <div className="workspace-timeline-axis-track">
              {TIMELINE_TICK_HOURS.map((hour) => {
                const tickMs = timelineNowMs - WORKSPACE_TIMELINE_WINDOW_MS + hour * 60 * 60 * 1_000;
                return (
                  <span key={hour} style={{ left: `${(hour / TIMELINE_WINDOW_HOURS) * 100}%` }}>
                    {hour === TIMELINE_WINDOW_HOURS ? 'Now' : formatTimelineTick(tickMs)}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="workspace-timeline-rows">
            {timelineRows.length > 0 ? timelineRows.map((row) => (
              <div className="workspace-timeline-row" key={row.runId}>
                <div className="workspace-timeline-session-label" title={row.title}>
                  <strong>{row.title}</strong>
                  <span>{formatWorkspaceTimelineDuration(row.totalDurationMs)} total</span>
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
              </div>
            )) : (
              <div className="workspace-timeline-empty">No session activity in the past 12 hours.</div>
            )}
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

function formatTimelineTick(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(timestampMs);
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
