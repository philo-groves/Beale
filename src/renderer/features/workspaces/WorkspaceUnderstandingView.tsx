import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { Binary, BookOpen, Folder, GitBranch, Globe2, Info, Layers3, MoonStar, Server } from 'lucide-react';
import type {
  HoneycrispMemorySummary,
  ProjectGraphSummary,
  ProjectSemanticSummary,
  ResearchProfile,
  RunRow,
  ScopeAsset,
  ScopeAssetKind,
  WorkspaceScopeVersion
} from '@shared/types';
import { memoryTypeClassName, memoryTypeLabel } from '../research/MemoryTypeLabel';
import {
  buildWorkspaceTimeline,
  formatWorkspaceTimelineDuration
} from '../../view-models/workspaceTimeline';
import type { WorkspaceTimelineResult } from '../../view-models/workspaceTimeline';
import type { SessionHeat } from '../../view-models/sessionHeat';

const TIMELINE_WINDOW_HOURS = 12;
const TIMELINE_TICK_HOURS = [0, 3, 6, 9, 12] as const;

export function WorkspaceUnderstandingView({
  busy,
  memoryDreamingInProgress,
  honeycrispMemory,
  activeScope = null,
  researchProfile = null,
  workspaceName,
  runs,
  onRunMemoryDreaming,
  nowMs
}: {
  busy: boolean;
  memoryDreamingInProgress: boolean;
  honeycrispMemory: HoneycrispMemorySummary | null;
  activeScope?: WorkspaceScopeVersion | null;
  projectGraph?: ProjectGraphSummary | null;
  projectSemantic?: ProjectSemanticSummary | null;
  researchProfile?: ResearchProfile | null;
  workspaceName: string;
  runs: RunRow[];
  onRunMemoryDreaming: () => void;
  nowMs?: number;
}): JSX.Element {
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [timelineLegendOpen, setTimelineLegendOpen] = useState(false);
  const timelineLegendRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (nowMs !== undefined) return undefined;
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [nowMs]);
  useEffect(() => {
    if (!timelineLegendOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!timelineLegendRef.current?.contains(event.target as Node)) setTimelineLegendOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setTimelineLegendOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [timelineLegendOpen]);
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
  const memoriesSinceDream = memoryCountSinceLastDream(honeycrispMemory);
  const dreamHeat = memoryDreamHeat(memoriesSinceDream);
  const timelineAriaLabel = `${workspaceName.trim() || 'Workspace'} — most recent 12 hours of session activity`;

  return (
    <main className="workspace-dashboard" aria-label="Workspace dashboard">
      <section className="workspace-dashboard-half workspace-timeline-card" aria-label={timelineAriaLabel}>
        <div className="workspace-timeline-chart">
          <div className="workspace-timeline-axis">
            <div className="workspace-timeline-heading">
              <span>Activity</span>
              <div
                className={`workspace-timeline-legend-trigger ${timelineLegendOpen ? 'is-open' : ''}`.trim()}
                ref={timelineLegendRef}
              >
                <button
                  aria-controls="workspace-timeline-legend"
                  aria-expanded={timelineLegendOpen}
                  aria-label="Show activity legend"
                  className="workspace-timeline-legend-button"
                  onClick={() => setTimelineLegendOpen((open) => !open)}
                  type="button"
                >
                  <Info aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
                <WorkspaceTimelineLegend open={timelineLegendOpen} />
              </div>
            </div>
            <div className="workspace-timeline-axis-track" aria-hidden="true">
              {TIMELINE_TICK_HOURS.map((hour) => {
                const remainingDurationMs = axisWindowDurationMs * ((TIMELINE_WINDOW_HOURS - hour) / TIMELINE_WINDOW_HOURS);
                return (
                  <span key={hour} style={{ left: `${(hour / TIMELINE_WINDOW_HOURS) * 100}%` }}>
                    {hour === TIMELINE_WINDOW_HOURS ? 'Latest' : `-${formatWorkspaceTimelineDuration(remainingDurationMs)}`}
                  </span>
                );
              })}
            </div>
            <span aria-hidden="true" />
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
      </section>

      <WorkspaceResearchSurface
        activeScope={activeScope}
        honeycrispMemory={honeycrispMemory}
        nowMs={timelineNowMs}
        runs={runs}
      />

      <section className="workspace-dashboard-half workspace-dream-area" aria-label="Memory dreaming">
        <header className="workspace-housekeeping-header">
          <span>Housekeeping</span>
          <span>{memoriesSinceDream} new {memoriesSinceDream === 1 ? 'memory' : 'memories'}</span>
        </header>
        <div className="workspace-dream-content">
          <article
            className="workspace-dream-card"
            data-dream-heat={dreamHeat}
            data-memory-count-since-dream={memoriesSinceDream}
          >
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
        </div>
      </section>
    </main>
  );
}

function WorkspaceTimelineLegend({ open }: { open: boolean }): JSX.Element {
  return (
    <div
      aria-hidden={!open}
      className="workspace-timeline-legend workspace-timeline-legend-popover"
      id="workspace-timeline-legend"
      role="tooltip"
    >
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
  );
}

interface WorkspaceResearchSurfaceItem {
  asset: ScopeAsset;
  label: string;
  sessionCount: number;
  memoryCount: number;
  lastResearchedAt: string | null;
}

export function workspaceResearchSurfaceItems(
  assets: readonly ScopeAsset[],
  runs: readonly RunRow[],
  memory: HoneycrispMemorySummary | null | undefined
): WorkspaceResearchSurfaceItem[] {
  return assets.map((asset) => {
    const assetRuns = runs.filter(({ run }) => run.targetAssetId === asset.id);
    const lastResearchedAt = assetRuns
      .map(({ run }) => run.startedAt ?? run.createdAt)
      .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
    return {
      asset,
      label: workspaceAssetLabel(asset),
      sessionCount: assetRuns.length,
      memoryCount: memory?.nodes.filter((node) => node.assetIds.includes(asset.id)).length ?? 0,
      lastResearchedAt
    };
  }).sort((left, right) => {
    if (left.asset.direction !== right.asset.direction) return left.asset.direction === 'in_scope' ? -1 : 1;
    return workspaceAssetKindOrder(left.asset.kind) - workspaceAssetKindOrder(right.asset.kind)
      || left.label.localeCompare(right.label);
  });
}

function WorkspaceResearchSurface({
  activeScope,
  honeycrispMemory,
  nowMs,
  runs
}: {
  activeScope: WorkspaceScopeVersion | null;
  honeycrispMemory: HoneycrispMemorySummary | null;
  nowMs: number;
  runs: RunRow[];
}): JSX.Element {
  const items = workspaceResearchSurfaceItems(activeScope?.assets ?? [], runs, honeycrispMemory);
  const inScopeCount = items.filter((item) => item.asset.direction === 'in_scope').length;
  const researchedCount = items.filter((item) => item.sessionCount > 0).length;
  const surfaceScrollRef = useRef<HTMLDivElement>(null);
  const surfaceListRef = useRef<HTMLDivElement>(null);
  const updateScrollFades = useCallback((): void => {
    const scroll = surfaceScrollRef.current;
    const list = surfaceListRef.current;
    if (!scroll || !list) return;
    const scrollableDistance = list.scrollHeight - list.clientHeight;
    const canScroll = scrollableDistance > 8;
    scroll.classList.toggle('has-top-fade', canScroll && list.scrollTop > 8);
    scroll.classList.toggle('has-bottom-fade', canScroll && list.scrollTop < scrollableDistance - 8);
  }, []);

  useEffect(() => {
    updateScrollFades();
    const list = surfaceListRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateScrollFades);
    observer.observe(list);
    return () => observer.disconnect();
  }, [items.length, updateScrollFades]);

  return (
    <section className="workspace-dashboard-half workspace-surface-area" aria-label="Research surface">
      <header className="workspace-surface-header">
        <span>Surface</span>
        <div className="workspace-surface-summary" aria-label={`${inScopeCount} in scope, ${researchedCount} researched`}>
          <span>{inScopeCount} in scope</span>
          <span>{researchedCount} researched</span>
        </div>
      </header>
      {items.length > 0 ? (
        <div className="workspace-surface-scroll" ref={surfaceScrollRef}>
          <div className="workspace-surface-list" onScroll={updateScrollFades} ref={surfaceListRef}>
            {items.map((item) => (
              <article className={`workspace-surface-item is-${item.asset.direction}`} key={item.asset.id}>
                <span className="workspace-surface-item-icon" aria-hidden="true">
                  <WorkspaceAssetIcon kind={item.asset.kind} />
                </span>
                <div className="workspace-surface-item-main">
                  <div className="workspace-surface-item-heading">
                    <strong title={item.asset.value}>{item.label}</strong>
                    <span>{workspaceAssetKindLabel(item.asset.kind)}</span>
                  </div>
                  <small title={item.asset.value}>{item.asset.value}</small>
                  <div className="workspace-surface-item-meta">
                    <span>{item.asset.direction === 'in_scope' ? 'In scope' : 'Out of scope'}</span>
                    <span>{item.sessionCount} {item.sessionCount === 1 ? 'session' : 'sessions'}</span>
                    <span>{item.memoryCount} {item.memoryCount === 1 ? 'memory' : 'memories'}</span>
                    <span>{item.lastResearchedAt ? `Last ${formatSurfaceRecency(item.lastResearchedAt, nowMs)}` : 'Never researched'}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className="workspace-surface-empty">No workspace sources or references recorded.</div>
      )}
    </section>
  );
}

function WorkspaceAssetIcon({ kind }: { kind: ScopeAssetKind }): JSX.Element {
  if (kind === 'repo') return <GitBranch size={16} />;
  if (kind === 'documentation') return <BookOpen size={16} />;
  if (kind === 'binary') return <Binary size={16} />;
  if (kind === 'path') return <Folder size={16} />;
  if (kind === 'service' || kind === 'host') return <Server size={16} />;
  if (kind === 'domain' || kind === 'ip_range') return <Globe2 size={16} />;
  return <Layers3 size={16} />;
}

function workspaceAssetLabel(asset: ScopeAsset): string {
  const displayName = typeof asset.attributes?.displayName === 'string' ? asset.attributes.displayName.trim() : '';
  if (displayName) return displayName;
  if (asset.kind === 'repo') {
    const repositoryName = asset.value.replace(/[\\/]+$/u, '').split(/[\\/]/u).at(-1)?.replace(/\.git$/u, '');
    if (repositoryName) return repositoryName;
  }
  return asset.value;
}

function workspaceAssetKindOrder(kind: ScopeAssetKind): number {
  const order: ScopeAssetKind[] = ['repo', 'documentation', 'binary', 'path', 'service', 'host', 'domain', 'ip_range', 'account', 'credential_ref', 'other'];
  return order.indexOf(kind);
}

function workspaceAssetKindLabel(kind: ScopeAssetKind): string {
  if (kind === 'repo') return 'Repository';
  if (kind === 'ip_range') return 'IP range';
  if (kind === 'credential_ref') return 'Credential ref';
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
}

function formatSurfaceRecency(value: string, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - Date.parse(value));
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(Date.parse(value));
}

export function memoryCountSinceLastDream(memory: HoneycrispMemorySummary | null | undefined): number {
  if (!memory || memory.status === 'missing' || memory.status === 'error') return 0;
  const lastDreamAt = Date.parse(memory.dreaming.lastRun?.completedAt ?? '');
  if (!Number.isFinite(lastDreamAt)) return memory.nodes.length;
  return memory.nodes.filter((node) => {
    const createdAt = Date.parse(node.createdAt);
    return Number.isFinite(createdAt) && createdAt > lastDreamAt;
  }).length;
}

export function memoryDreamHeat(memoryCount: number): SessionHeat {
  if (memoryCount >= 150) return 'critical';
  if (memoryCount >= 100) return 'high';
  if (memoryCount >= 50) return 'medium';
  if (memoryCount >= 20) return 'low';
  return 'none';
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
