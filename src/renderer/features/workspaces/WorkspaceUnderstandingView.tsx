import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { Binary, BookOpen, Folder, GitBranch, Globe2, Info, Layers3, MoonStar, Plus, Server, Sparkles, Trash2 } from 'lucide-react';
import { isLiveResearchRunStatus } from '../../../shared/types';
import type {
  HoneycrispMemorySummary,
  MemoryDreamingProgressPhase,
  MemoryDreamingProgressUpdate,
  ResearchProfile,
  RunRow,
  ScopeAsset,
  ScopeAssetInput,
  ScopeAssetKind,
  WorkspaceDejunkSummary,
  WorkspaceScopeDraft,
  WorkspaceScopeVersion
} from '@shared/types';
import { Modal } from '../../app/Modal';
import { memoryTypeClassName, memoryTypeLabel } from '../research/MemoryTypeLabel';
import { MemoryCatalogItem, RunbookCatalogItem } from '../research/MemorySidePanel';
import {
  buildWorkspaceTimeline,
  formatWorkspaceTimelineDuration
} from '../../view-models/workspaceTimeline';
import type { WorkspaceTimelineResult } from '../../view-models/workspaceTimeline';
import type { SessionHeat } from '../../view-models/sessionHeat';
import { errorMessage } from '../../lib/errors';
import { WorkspaceDirectoriesWidget } from './WorkspaceDirectoriesWidget';

const TIMELINE_WINDOW_HOURS = 4;
const TIMELINE_TICK_HOURS = [0, 1, 2, 3, 4] as const;
const WORKSPACE_ACTIVITY_DAY_COUNT = 365;
const DAY_DURATION_MS = 24 * 60 * 60 * 1_000;
const WORKSPACE_DASHBOARD_VIEWS = ['overview', 'activity', 'resources', 'memory', 'runbooks', 'utilities'] as const;

type WorkspaceDashboardView = typeof WORKSPACE_DASHBOARD_VIEWS[number];

export interface WorkspaceConfigurationInput {
  workspaceName: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
}

export interface WorkspaceHeatmapDay {
  dateKey: string;
  timestamp: number;
  value: number;
  heatLevel: 0 | 1 | 2 | 3 | 4;
}

export interface WorkspaceHeatmapActivity {
  days: WorkspaceHeatmapDay[];
  leadingEmptyDays: number;
  total: number;
}

export interface WorkspaceTokenActivityDay extends WorkspaceHeatmapDay {
  totalTokens: number;
}

export interface WorkspaceTokenActivity extends WorkspaceHeatmapActivity {
  days: WorkspaceTokenActivityDay[];
  totalTokens: number;
}

export function workspaceTokenActivity(runs: readonly RunRow[], nowMs: number): WorkspaceTokenActivity {
  const activity = workspaceDailyActivity(runs.map(({ run, tokenUsage }) => ({
    occurredAt: run.endedAt ?? run.startedAt ?? run.createdAt,
    value: tokenUsage?.totalTokens ?? 0
  })), nowMs);
  return {
    ...activity,
    days: activity.days.map((day) => ({ ...day, totalTokens: day.value })),
    totalTokens: activity.total
  };
}

export function workspaceCreationActivity(
  items: readonly { createdAt: string }[],
  nowMs: number
): WorkspaceHeatmapActivity {
  return workspaceDailyActivity(items.map((item) => ({ occurredAt: item.createdAt, value: 1 })), nowMs);
}

function workspaceDailyActivity(
  events: readonly { occurredAt: string; value: number }[],
  nowMs: number
): WorkspaceHeatmapActivity {
  const end = startOfUtcDay(nowMs);
  const start = end - ((WORKSPACE_ACTIVITY_DAY_COUNT - 1) * DAY_DURATION_MS);
  const totalsByDate = new Map<string, number>();
  for (const event of events) {
    if (event.value <= 0) continue;
    const activityAt = Date.parse(event.occurredAt);
    if (!Number.isFinite(activityAt) || activityAt < start || activityAt >= end + DAY_DURATION_MS) continue;
    const dateKey = utcDateKey(activityAt);
    totalsByDate.set(dateKey, (totalsByDate.get(dateKey) ?? 0) + event.value);
  }
  const maximum = Math.max(0, ...totalsByDate.values());
  const days = Array.from({ length: WORKSPACE_ACTIVITY_DAY_COUNT }, (_, index): WorkspaceHeatmapDay => {
    const timestamp = start + (index * DAY_DURATION_MS);
    const dateKey = utcDateKey(timestamp);
    const value = totalsByDate.get(dateKey) ?? 0;
    return {
      dateKey,
      timestamp,
      value,
      heatLevel: workspaceHeatLevel(value, maximum)
    };
  });
  return {
    days,
    leadingEmptyDays: new Date(start).getUTCDay(),
    total: days.reduce((total, day) => total + day.value, 0)
  };
}

function workspaceHeatLevel(value: number, maximum: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((Math.log1p(value) / Math.log1p(maximum)) * 4))) as 1 | 2 | 3 | 4;
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function workspaceScopeDraftForConfigurationUpdate(
  scope: WorkspaceScopeVersion,
  configuration: WorkspaceConfigurationInput
): WorkspaceScopeDraft {
  return {
    workspaceName: configuration.workspaceName,
    scopeOwner: scope.scopeOwner,
    descriptionMarkdown: configuration.descriptionMarkdown,
    rulesMarkdown: configuration.rulesMarkdown,
    expiresAt: scope.expiresAt,
    assets: scope.assets.map((asset) => ({
      direction: asset.direction,
      kind: asset.kind,
      value: asset.value,
      sensitivity: asset.sensitivity,
      attributes: asset.attributes
    }))
  };
}

export function WorkspaceUnderstandingView({
  busy,
  honeycrispMemory,
  activeScope = null,
  researchProfile = null,
  researchSubjectName = '',
  workspacePath = '',
  workspaceDirectories,
  workspaceName,
  runs,
  workspaceDejunk = null,
  workspaceDejunkInProgress = false,
  memoryDreamingInProgress,
  memoryDreamingProgress = null,
  onAddResource = async () => undefined,
  onChangeResource = async () => undefined,
  onSaveConfiguration = async () => undefined,
  onChangeWorkspaceDirectories = async () => undefined,
  onOpenSession = () => undefined,
  onOpenMemory = () => undefined,
  onOpenRunbook = () => undefined,
  onRunWorkspaceDejunk = () => undefined,
  onRunMemoryDreaming,
  nowMs
}: {
  busy: boolean;
  workspaceDejunk?: WorkspaceDejunkSummary | null;
  workspaceDejunkInProgress?: boolean;
  memoryDreamingInProgress: boolean;
  memoryDreamingProgress?: MemoryDreamingProgressUpdate | null;
  honeycrispMemory: HoneycrispMemorySummary | null;
  activeScope?: WorkspaceScopeVersion | null;
  researchProfile?: ResearchProfile | null;
  researchSubjectName?: string;
  workspacePath?: string;
  workspaceDirectories?: readonly string[];
  workspaceName: string;
  runs: RunRow[];
  onRunWorkspaceDejunk?: () => void;
  onRunMemoryDreaming: () => void;
  onAddResource?: (asset: ScopeAssetInput) => Promise<void>;
  onChangeResource?: (assetIds: string[], asset: ScopeAssetInput | null) => Promise<void>;
  onSaveConfiguration?: (configuration: WorkspaceConfigurationInput) => Promise<void>;
  onChangeWorkspaceDirectories?: (directories: string[]) => Promise<void>;
  onOpenSession?: (runId: string) => void;
  onOpenMemory?: (nodeId: string) => void;
  onOpenRunbook?: (runbookId: string) => void;
  nowMs?: number;
}): JSX.Element {
  const [activeView, setActiveView] = useState<WorkspaceDashboardView>('overview');
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
  const workspaceId = honeycrispMemory?.contextWorkspaceId ?? null;
  const workspaceMemoryNodes = useMemo(
    () => (honeycrispMemory?.nodes ?? [])
      .filter((node) => workspaceId !== null && node.workspaces.some((workspace) => workspace.id === workspaceId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [honeycrispMemory?.nodes, workspaceId]
  );
  const workspaceRunbooks = useMemo(
    () => (honeycrispMemory?.runbooks ?? [])
      .filter((runbook) => workspaceId !== null && runbook.workspaceId === workspaceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [honeycrispMemory?.runbooks, workspaceId]
  );
  const tokenActivity = useMemo(() => workspaceTokenActivity(runs, timelineNowMs), [runs, timelineNowMs]);
  const axisWindowDurationMs = timeline.windowDurationMs || TIMELINE_WINDOW_HOURS * 60 * 60 * 1_000;
  const timelineAriaLabel = `${workspaceName.trim() || 'Workspace'} — most recent 4 hours of session activity`;

  return (
    <main className="workspace-dashboard" aria-label="Workspace dashboard">
      <div className="workspace-dashboard-tabs research-side-view-tabs" role="tablist" aria-label="Workspace dashboard views">
        {WORKSPACE_DASHBOARD_VIEWS.map((view) => {
          const selected = activeView === view;
          return (
            <div className={`research-side-view-tab provider-settings-tab workspace-dashboard-tab ${selected ? 'active' : ''}`.trim()} key={view}>
              <button
                aria-controls={`workspace-dashboard-${view}-panel`}
                aria-selected={selected}
                className="research-side-view-tab-activate"
                onClick={() => setActiveView(view)}
                role="tab"
                type="button"
              >
                <span>{workspaceDashboardViewLabel(view)}</span>
              </button>
            </div>
          );
        })}
      </div>

      <WorkspaceOverviewPanel
        activeScope={activeScope}
        busy={busy}
        hidden={activeView !== 'overview'}
        onSave={onSaveConfiguration}
        onChangeDirectories={onChangeWorkspaceDirectories}
        researchProfile={researchProfile}
        researchSubjectName={researchSubjectName}
        workspaceName={workspaceName}
        workspacePath={workspacePath}
        workspaceDirectories={workspaceDirectories ?? (workspacePath ? [workspacePath] : [])}
      />

      <section
        aria-label={`${workspaceName.trim() || 'Workspace'} activity`}
        className="workspace-dashboard-panel workspace-timeline-card"
        hidden={activeView !== 'activity'}
        id="workspace-dashboard-activity-panel"
        role="tabpanel"
      >
        <WorkspaceActivityForm
          activity={tokenActivity}
          metric="tokens"
          viewLabel="Activity"
          workspaceName={activeScope?.workspaceName || workspaceName}
        />
        <div aria-label={timelineAriaLabel} className="workspace-timeline-chart">
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
                <button
                  type="button"
                  className="workspace-timeline-session-label"
                  title={`Open ${row.title}`}
                  onClick={() => onOpenSession(row.runId)}
                >
                  {row.title}
                </button>
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
                      aria-label={`Runbook update ${marker.revision}: ${marker.title}`}
                      className="workspace-timeline-runbook-marker"
                      key={marker.id}
                      style={{ left: `${marker.leftPercent}%` }}
                      title={`Runbook · ${marker.title} · Update ${marker.revision} · ${formatDateTime(marker.createdAt)}`}
                    />
                  ))}
                  {row.reportRevisionMarkers.map((marker) => (
                    <span
                      aria-label={`Report update ${marker.revision}: ${marker.title}`}
                      className="workspace-timeline-report-marker"
                      key={marker.id}
                      style={{ left: `${marker.leftPercent}%` }}
                      title={`Report · ${marker.title} · Update ${marker.revision} · ${formatDateTime(marker.createdAt)}`}
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
        hidden={activeView !== 'resources'}
        honeycrispMemory={honeycrispMemory}
        nowMs={timelineNowMs}
        runs={runs}
        onAddResource={onAddResource}
        onChangeResource={onChangeResource}
        workspaceName={activeScope?.workspaceName || workspaceName}
      />

      <WorkspaceMemoryPanel
        hidden={activeView !== 'memory'}
        loading={honeycrispMemory === null || honeycrispMemory.loading === true}
        memoryTypes={memoryTypes}
        nowMs={timelineNowMs}
        nodes={workspaceMemoryNodes}
        onOpen={onOpenMemory}
        workspaceName={activeScope?.workspaceName || workspaceName}
      />

      <WorkspaceRunbooksPanel
        hidden={activeView !== 'runbooks'}
        loading={honeycrispMemory === null || honeycrispMemory.loading === true}
        nowMs={timelineNowMs}
        runbooks={workspaceRunbooks}
        onOpen={onOpenRunbook}
        workspaceName={activeScope?.workspaceName || workspaceName}
      />

      <WorkspaceUtilitiesPanel
        busy={busy}
        hidden={activeView !== 'utilities'}
        honeycrispMemory={honeycrispMemory}
        memoryDreamingInProgress={memoryDreamingInProgress}
        memoryDreamingProgress={memoryDreamingProgress}
        researchProfile={researchProfile}
        runs={runs}
        workspaceDejunk={workspaceDejunk}
        workspaceDejunkInProgress={workspaceDejunkInProgress}
        onRunMemoryDreaming={onRunMemoryDreaming}
        onRunWorkspaceDejunk={onRunWorkspaceDejunk}
        workspaceName={activeScope?.workspaceName || workspaceName}
      />
    </main>
  );
}

function workspaceDashboardViewLabel(view: WorkspaceDashboardView): string {
  return view.charAt(0).toUpperCase() + view.slice(1);
}

function WorkspaceOverviewPanel({
  activeScope,
  busy,
  hidden,
  onChangeDirectories,
  onSave,
  researchProfile,
  researchSubjectName,
  workspaceName,
  workspacePath,
  workspaceDirectories
}: {
  activeScope: WorkspaceScopeVersion | null;
  busy: boolean;
  hidden: boolean;
  onChangeDirectories: (directories: string[]) => Promise<void>;
  onSave: (configuration: WorkspaceConfigurationInput) => Promise<void>;
  researchProfile: ResearchProfile | null;
  researchSubjectName: string;
  workspaceName: string;
  workspacePath: string;
  workspaceDirectories: readonly string[];
}): JSX.Element {
  const resolvedWorkspaceName = activeScope?.workspaceName || workspaceName;
  const resolvedDescription = activeScope?.descriptionMarkdown ?? '';
  const resolvedRules = activeScope?.rulesMarkdown ?? '';
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState(resolvedWorkspaceName);
  const [descriptionDraft, setDescriptionDraft] = useState(resolvedDescription);
  const [rulesDraft, setRulesDraft] = useState(resolvedRules);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const resolvedConfigurationRef = useRef({
    workspaceName: resolvedWorkspaceName,
    descriptionMarkdown: resolvedDescription,
    rulesMarkdown: resolvedRules
  });
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const lastQueuedConfigurationRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = resolvedConfigurationRef.current;
    setWorkspaceNameDraft((current) => current === previous.workspaceName ? resolvedWorkspaceName : current);
    setDescriptionDraft((current) => current === previous.descriptionMarkdown ? resolvedDescription : current);
    setRulesDraft((current) => current === previous.rulesMarkdown ? resolvedRules : current);
    resolvedConfigurationRef.current = {
      workspaceName: resolvedWorkspaceName,
      descriptionMarkdown: resolvedDescription,
      rulesMarkdown: resolvedRules
    };
    if (lastQueuedConfigurationRef.current === JSON.stringify(resolvedConfigurationRef.current)) {
      lastQueuedConfigurationRef.current = null;
    }
    setSaveError(null);
  }, [activeScope?.id, resolvedDescription, resolvedRules, resolvedWorkspaceName]);
  const saveInPlace = (): void => {
    const configuration = {
      workspaceName: workspaceNameDraft,
      descriptionMarkdown: descriptionDraft,
      rulesMarkdown: rulesDraft
    };
    const configurationKey = JSON.stringify(configuration);
    const dirty = configuration.workspaceName !== resolvedWorkspaceName
      || configuration.descriptionMarkdown !== resolvedDescription
      || configuration.rulesMarkdown !== resolvedRules;
    if (!configuration.workspaceName.trim()) {
      setSaveError('Workspace name is required.');
      return;
    }
    if (!dirty || busy || configurationKey === lastQueuedConfigurationRef.current) return;
    lastQueuedConfigurationRef.current = configurationKey;
    pendingSaveCountRef.current += 1;
    setSaving(true);
    setSaveError(null);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => onSave(configuration))
      .catch((caught: unknown) => {
        lastQueuedConfigurationRef.current = null;
        setSaveError(errorMessage(caught));
      })
      .finally(() => {
        pendingSaveCountRef.current -= 1;
        if (pendingSaveCountRef.current === 0) setSaving(false);
      });
  };
  return (
    <section
      aria-label="Workspace overview"
      className="workspace-dashboard-panel workspace-overview"
      hidden={hidden}
      id="workspace-dashboard-overview-panel"
      role="tabpanel"
    >
      <div className="workspace-overview-layout settings-form">
        <header className="settings-form-heading workspace-overview-heading">
          <h2 id="workspace-overview-heading">{workspaceNameDraft.trim() || resolvedWorkspaceName} Overview</h2>
          <p>Review the workspace context and authorized research boundary.</p>
        </header>
        <div className="workspace-overview-form">
          <div className="settings-form-squircle" aria-labelledby="workspace-overview-heading">
            <div className="settings-form-control-list">
            <label className="settings-form-control-row workspace-overview-control-row">
              <span className="settings-form-control-copy">
                <strong>Workspace Name</strong>
                <small>Choose the name shown throughout Beale.</small>
              </span>
              <input
                aria-label="Workspace Name"
                className="workspace-overview-input"
                disabled={busy}
                required
                value={workspaceNameDraft}
                onChange={(event) => setWorkspaceNameDraft(event.target.value)}
                onBlur={saveInPlace}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </label>
            <label className="settings-form-control-row workspace-overview-control-row">
              <span className="settings-form-control-copy">
                <strong>Subject</strong>
                <small>The research subject shared across related workspaces.</small>
              </span>
              <input
                aria-label="Subject"
                className="workspace-overview-input"
                disabled
                value={researchSubjectName}
              />
            </label>
            <label className="settings-form-control-row workspace-overview-control-row">
              <span className="settings-form-control-copy">
                <strong>Profile</strong>
                <small>The research profile that defines this workspace.</small>
              </span>
              <input
                aria-label="Profile"
                className="workspace-overview-input"
                disabled
                value={workspaceResearchProfileLabel(researchProfile)}
              />
            </label>
            <label className="settings-form-control-row workspace-overview-control-row workspace-overview-textarea-row">
              <span className="settings-form-control-copy">
                <strong>Workspace Description</strong>
                <small>Describe the workspace's research purpose and intended use.</small>
              </span>
              <textarea
                aria-label="Workspace Description"
                disabled={busy}
                rows={5}
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                onBlur={saveInPlace}
              />
            </label>
            <label className="settings-form-control-row workspace-overview-control-row workspace-overview-textarea-row">
              <span className="settings-form-control-copy">
                <strong>Scope &amp; Rules</strong>
                <small>Record the authorized scope, exclusions, constraints, and operating rules.</small>
              </span>
              <textarea
                aria-label="Scope & Rules"
                disabled={busy}
                rows={8}
                value={rulesDraft}
                onChange={(event) => setRulesDraft(event.target.value)}
                onBlur={saveInPlace}
              />
            </label>
            </div>
          </div>
          {saveError ? <p className="workspace-overview-error" role="alert">{saveError}</p> : null}
          {saving ? <span className="workspace-overview-saving" role="status">Saving…</span> : null}
        </div>
        <WorkspaceDirectoriesWidget
          directories={workspaceDirectories}
          disabled={busy}
          lockedDirectory={workspacePath}
          onAdd={async (selection) => {
            const selectedPath = selection.path;
            if (!selectedPath || workspaceDirectories.some((directory) => workspaceDirectoryKey(directory) === workspaceDirectoryKey(selectedPath))) return;
            if (selection.knownWorkspace) {
              throw new Error(`Directory already belongs to workspace ${selection.knownWorkspace.workspaceName}.`);
            }
            await onChangeDirectories([...workspaceDirectories, selectedPath]);
          }}
          onRemove={(directory) => onChangeDirectories(workspaceDirectories.filter((item) => workspaceDirectoryKey(item) !== workspaceDirectoryKey(directory)))}
        />
      </div>
    </section>
  );
}

function workspaceDirectoryKey(directory: string): string {
  return directory.replace(/[\\/]+$/u, '').toLowerCase();
}

function workspaceResearchProfileLabel(profile: ResearchProfile | null): string {
  if (!profile) return '';
  if (profile.id === 'security-research') return 'Security';
  if (profile.id === 'mathematics') return 'Mathematics';
  return profile.name;
}

function WorkspaceActivityForm({
  activity,
  metric,
  viewLabel,
  workspaceName
}: {
  activity: WorkspaceHeatmapActivity;
  metric: WorkspaceHeatmapMetric;
  viewLabel: string;
  workspaceName: string;
}): JSX.Element {
  const metricCopy = workspaceHeatmapMetricCopy(metric);
  return (
    <section className="settings-form workspace-activity-form" aria-label={`${workspaceName} ${viewLabel.toLowerCase()} yearly ${metricCopy.activityLabel}`}>
      <header className="settings-form-heading">
        <h2>{workspaceName} {viewLabel}</h2>
        <p>{workspaceHeatmapValueLabel(activity.total, metric)} over the past year.</p>
      </header>
      <div className="workspace-activity-grid-scroll">
        <div className="workspace-activity-grid" role="grid" aria-label={`Daily ${metricCopy.activityLabel} over the past year`}>
          {Array.from({ length: activity.leadingEmptyDays }, (_, index) => (
            <span aria-hidden="true" className="workspace-activity-cell is-empty" key={`empty-${index}`} />
          ))}
          {activity.days.map((day) => {
            const dateLabel = new Date(day.timestamp).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC'
            });
            const label = `${dateLabel}: ${workspaceHeatmapValueLabel(day.value, metric)}`;
            return (
              <span
                aria-label={label}
                className={`workspace-activity-cell heat-${day.heatLevel}`}
                data-activity-count={day.value}
                data-date={day.dateKey}
                data-metric={metric}
                key={day.dateKey}
                role="gridcell"
                title={label}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

type WorkspaceHeatmapMetric = 'tokens' | 'resources' | 'memories' | 'runbooks';

function workspaceHeatmapMetricCopy(metric: WorkspaceHeatmapMetric): { activityLabel: string } {
  switch (metric) {
    case 'tokens': return { activityLabel: 'token usage' };
    case 'resources': return { activityLabel: 'resource creation' };
    case 'memories': return { activityLabel: 'memory creation' };
    case 'runbooks': return { activityLabel: 'runbook creation' };
  }
}

function workspaceHeatmapValueLabel(value: number, metric: WorkspaceHeatmapMetric): string {
  const formattedValue = value.toLocaleString();
  switch (metric) {
    case 'tokens': return `${formattedValue} ${value === 1 ? 'token' : 'tokens'} used`;
    case 'resources': return `${formattedValue} ${value === 1 ? 'resource' : 'resources'} created`;
    case 'memories': return `${formattedValue} ${value === 1 ? 'memory' : 'memories'} created`;
    case 'runbooks': return `${formattedValue} ${value === 1 ? 'runbook' : 'runbooks'} created`;
  }
}

function WorkspaceMemoryPanel({
  hidden,
  loading,
  memoryTypes,
  nowMs,
  nodes,
  onOpen,
  workspaceName
}: {
  hidden: boolean;
  loading: boolean;
  memoryTypes: ResearchProfile['memory']['types'];
  nowMs: number;
  nodes: HoneycrispMemorySummary['nodes'];
  onOpen: (nodeId: string) => void;
  workspaceName: string;
}): JSX.Element {
  const activity = useMemo(() => workspaceCreationActivity(nodes, nowMs), [nodes, nowMs]);
  return (
    <section
      aria-label="Workspace memory"
      className="workspace-dashboard-panel workspace-catalog-view"
      hidden={hidden}
      id="workspace-dashboard-memory-panel"
      role="tabpanel"
    >
      <WorkspaceActivityForm activity={activity} metric="memories" viewLabel="Memory" workspaceName={workspaceName} />
      <div className="workspace-catalog-list memory-catalog-list">
        {nodes.map((node) => (
          <MemoryCatalogItem
            key={node.id}
            memoryTypes={memoryTypes}
            node={node}
            selected={false}
            onOpen={() => onOpen(node.id)}
          />
        ))}
        {nodes.length === 0 ? (
          <p className="workspace-catalog-empty">{loading ? 'Loading memory.' : 'No workspace memory yet.'}</p>
        ) : null}
      </div>
    </section>
  );
}

function WorkspaceRunbooksPanel({
  hidden,
  loading,
  nowMs,
  runbooks,
  onOpen,
  workspaceName
}: {
  hidden: boolean;
  loading: boolean;
  nowMs: number;
  runbooks: HoneycrispMemorySummary['runbooks'];
  onOpen: (runbookId: string) => void;
  workspaceName: string;
}): JSX.Element {
  const activity = useMemo(() => workspaceCreationActivity(runbooks, nowMs), [nowMs, runbooks]);
  return (
    <section
      aria-label="Workspace runbooks"
      className="workspace-dashboard-panel workspace-catalog-view"
      hidden={hidden}
      id="workspace-dashboard-runbooks-panel"
      role="tabpanel"
    >
      <WorkspaceActivityForm activity={activity} metric="runbooks" viewLabel="Runbooks" workspaceName={workspaceName} />
      <div className="workspace-catalog-list runbook-catalog-list">
        {runbooks.map((runbook) => (
          <RunbookCatalogItem
            key={runbook.id}
            runbook={runbook}
            selected={false}
            onOpen={() => onOpen(runbook.id)}
          />
        ))}
        {runbooks.length === 0 ? (
          <p className="workspace-catalog-empty">{loading ? 'Loading runbooks.' : 'No workspace runbooks yet.'}</p>
        ) : null}
      </div>
    </section>
  );
}

function WorkspaceUtilitiesPanel({
  busy,
  hidden,
  honeycrispMemory,
  memoryDreamingInProgress,
  memoryDreamingProgress,
  researchProfile,
  runs,
  workspaceDejunk,
  workspaceDejunkInProgress,
  onRunMemoryDreaming,
  onRunWorkspaceDejunk,
  workspaceName
}: {
  busy: boolean;
  hidden: boolean;
  honeycrispMemory: HoneycrispMemorySummary | null;
  memoryDreamingInProgress: boolean;
  memoryDreamingProgress: MemoryDreamingProgressUpdate | null;
  researchProfile: ResearchProfile | null;
  runs: RunRow[];
  workspaceDejunk: WorkspaceDejunkSummary | null;
  workspaceDejunkInProgress: boolean;
  onRunMemoryDreaming: () => void;
  onRunWorkspaceDejunk: () => void;
  workspaceName: string;
}): JSX.Element {
  const memoryEnabled = researchProfile?.capabilities.memoryEnabled !== false;
  const memoryLoading = honeycrispMemory?.loading === true;
  const dreamDisabled = busy || memoryDreamingInProgress || memoryLoading || !memoryEnabled || honeycrispMemory?.dreaming.available === false;
  const dreamProgressPhase = memoryDreamingProgress?.phase ?? (memoryDreamingInProgress ? 'preparing' : null);
  const dreamProgressLabel = dreamProgressPhase ? memoryDreamingProgressLabel(dreamProgressPhase) : null;
  const memoriesSinceDream = memoryCountSinceLastDream(honeycrispMemory);
  const newFileCount = workspaceDejunk?.newFileCount ?? 0;
  const activeSession = runs.some(({ run }) => isLiveResearchRunStatus(run.status));
  const dejunkLoading = workspaceDejunk?.loading === true;
  const dejunkDisabled = busy || workspaceDejunkInProgress || dejunkLoading || activeSession || workspaceDejunk?.available === false;
  const dejunkStatus = workspaceDejunkInProgress ? 'Dejunking workspace files…' : dejunkLoading ? 'Checking workspace files…' : null;
  return (
    <section
      aria-label="Workspace utilities"
      className="workspace-dashboard-panel workspace-cleaning-view"
      hidden={hidden}
      id="workspace-dashboard-utilities-panel"
      role="tabpanel"
    >
      <div className="settings-form workspace-cleaning-form">
        <header className="settings-form-heading">
          <h2>{workspaceName} Utilities</h2>
          <p>Organize loose files and consolidate workspace memory.</p>
        </header>
        <div className="settings-form-squircle">
          <div className="settings-form-control-list">
            <div className="settings-form-control-row workspace-cleaning-row">
              <span className="settings-form-control-copy">
                <strong>Dejunk</strong>
                {dejunkStatus ? <WorkspaceCleaningStatus label={dejunkStatus} /> : (
                  <small>{workspaceDejunk?.newFileCountCapped ? `${newFileCount.toLocaleString()}+` : newFileCount.toLocaleString()} New {newFileCount === 1 ? 'File' : 'Files'}</small>
                )}
              </span>
              <button className="workspace-cleaning-action" disabled={dejunkDisabled} onClick={onRunWorkspaceDejunk} type="button">Dejunk Now</button>
            </div>
            <div className="settings-form-control-row workspace-cleaning-row">
              <span className="settings-form-control-copy">
                <strong>Dream</strong>
                {dreamProgressLabel || memoryLoading ? (
                  <WorkspaceCleaningStatus label={dreamProgressLabel ?? 'Loading workspace memory…'} />
                ) : (
                  <small>{memoriesSinceDream.toLocaleString()} New {memoriesSinceDream === 1 ? 'Memory' : 'Memories'}</small>
                )}
              </span>
              <button className="workspace-cleaning-action" disabled={dreamDisabled} onClick={onRunMemoryDreaming} type="button">Dream Now</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceCleaningStatus({ label }: { label: string }): JSX.Element {
  return (
    <span aria-live="polite" className="workspace-cleaning-status" role="status">
      <span aria-hidden="true" className="provider-settings-loading-indicator" />
      {label}
    </span>
  );
}

export function WorkspaceHousekeepingPanel({
  busy,
  workspaceDejunk = null,
  workspaceDejunkInProgress = false,
  memoryDreamingInProgress,
  memoryDreamingProgress = null,
  honeycrispMemory,
  researchProfile = null,
  runs,
  onRunWorkspaceDejunk = () => undefined,
  onRunMemoryDreaming
}: {
  busy: boolean;
  workspaceDejunk?: WorkspaceDejunkSummary | null;
  workspaceDejunkInProgress?: boolean;
  memoryDreamingInProgress: boolean;
  memoryDreamingProgress?: MemoryDreamingProgressUpdate | null;
  honeycrispMemory: HoneycrispMemorySummary | null;
  researchProfile?: ResearchProfile | null;
  runs: RunRow[];
  onRunWorkspaceDejunk?: () => void;
  onRunMemoryDreaming: () => void;
}): JSX.Element {
  const memoryEnabled = researchProfile?.capabilities.memoryEnabled !== false;
  const memoryLoading = honeycrispMemory?.loading === true;
  const dreamDisabled = busy || memoryDreamingInProgress || memoryLoading || !memoryEnabled || honeycrispMemory?.dreaming.available === false;
  const dreamProgressPhase = memoryDreamingProgress?.phase ?? (memoryDreamingInProgress ? 'preparing' : null);
  const dreamProgressLabel = dreamProgressPhase ? memoryDreamingProgressLabel(dreamProgressPhase) : null;
  const memoriesSinceDream = memoryCountSinceLastDream(honeycrispMemory);
  const dreamHeat = memoryDreamHeat(memoriesSinceDream);
  const newFileCount = workspaceDejunk?.newFileCount ?? 0;
  const dejunkHeat = workspaceDejunkHeat(newFileCount);
  const activeSession = runs.some(({ run }) => isLiveResearchRunStatus(run.status));
  const dejunkLoading = workspaceDejunk?.loading === true;
  const dejunkDisabled = busy || workspaceDejunkInProgress || dejunkLoading || activeSession || workspaceDejunk?.available === false;

  return (
    <section className="workspace-side-housekeeping workspace-dream-area" aria-label="Workspace housekeeping">
      <div className="workspace-dream-content">
        <button
          className="workspace-dejunk-card workspace-housekeeping-card"
          data-dejunk-heat={dejunkHeat}
          data-new-file-count={newFileCount}
          disabled={dejunkDisabled}
          onClick={onRunWorkspaceDejunk}
          title={activeSession ? 'Dejunk is unavailable while a research session is active' : 'Organize loose research files and remove large reclaimable artifacts'}
          type="button"
        >
          <span className="workspace-housekeeping-card-count">
            {dejunkLoading
              ? 'Loading workspace files…'
              : <>{workspaceDejunk?.newFileCountCapped ? `${newFileCount.toLocaleString()}+` : newFileCount.toLocaleString()} New {newFileCount === 1 ? 'File' : 'Files'}</>}
          </span>
          <span className="workspace-housekeeping-card-label">
            <Sparkles aria-hidden="true" size={18} />
            {workspaceDejunkInProgress ? 'Dejunking…' : dejunkLoading ? 'Loading…' : 'Dejunk'}
          </span>
        </button>
        <button
          className="workspace-dream-card workspace-housekeeping-card"
          data-dream-heat={dreamHeat}
          data-memory-count-since-dream={memoriesSinceDream}
          disabled={dreamDisabled}
          onClick={onRunMemoryDreaming}
          title={!memoryEnabled ? 'Memory Dreaming is disabled by the active research profile' : 'Dream across workspace memories'}
          type="button"
        >
          <span className="workspace-housekeeping-card-count">
            {memoryLoading
              ? 'Loading workspace memory…'
              : <>{memoriesSinceDream.toLocaleString()} New {memoriesSinceDream === 1 ? 'Memory' : 'Memories'}</>}
          </span>
          {dreamProgressLabel ? (
            <span
              aria-live="polite"
              className={`workspace-dream-state is-${dreamProgressPhase}`}
              data-dream-phase={dreamProgressPhase}
              key={dreamProgressPhase}
              role="status"
            >
              {dreamProgressLabel}
            </span>
          ) : (
            <span className="workspace-housekeeping-card-label">
              <MoonStar aria-hidden="true" size={18} />
              {memoryLoading ? 'Loading…' : 'Dream'}
            </span>
          )}
        </button>
      </div>
    </section>
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
        <span><i className="workspace-timeline-runbook-swatch" />Runbook update</span>
        <span><i className="workspace-timeline-report-swatch" />Report update</span>
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
  assetIds: string[];
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
  const assetGroups = new Map<string, ScopeAsset[]>();
  for (const asset of assets) {
    const key = workspaceAssetGroupKey(asset);
    assetGroups.set(key, [...(assetGroups.get(key) ?? []), asset]);
  }
  const runStatsByAssetId = new Map<string, { count: number; lastResearchedAt: string | null }>();
  for (const { run } of runs) {
    if (!run.targetAssetId) continue;
    const researchedAt = run.startedAt ?? run.createdAt;
    const current = runStatsByAssetId.get(run.targetAssetId) ?? { count: 0, lastResearchedAt: null };
    runStatsByAssetId.set(run.targetAssetId, {
      count: current.count + 1,
      lastResearchedAt: latestTimestamp(current.lastResearchedAt, researchedAt)
    });
  }
  const memoryIdsByAssetId = new Map<string, Set<string>>();
  for (const node of memory?.nodes ?? []) {
    for (const assetId of node.assetIds) {
      const memoryIds = memoryIdsByAssetId.get(assetId) ?? new Set<string>();
      memoryIds.add(node.id);
      memoryIdsByAssetId.set(assetId, memoryIds);
    }
  }
  return [...assetGroups.values()].map((groupAssets) => {
    const asset = preferredWorkspaceSurfaceAsset(groupAssets);
    const assetIds = groupAssets.map((candidate) => candidate.id);
    const memoryIds = new Set(assetIds.flatMap((assetId) => [...(memoryIdsByAssetId.get(assetId) ?? [])]));
    const runStats = assetIds.map((assetId) => runStatsByAssetId.get(assetId));
    return {
      asset,
      assetIds,
      label: workspaceAssetLabel(asset),
      sessionCount: runStats.reduce((count, stats) => count + (stats?.count ?? 0), 0),
      memoryCount: memoryIds.size,
      lastResearchedAt: runStats.reduce<string | null>(
        (latest, stats) => latestTimestamp(latest, stats?.lastResearchedAt ?? null),
        null
      )
    };
  }).sort((left, right) => {
    if (left.asset.direction !== right.asset.direction) return left.asset.direction === 'in_scope' ? -1 : 1;
    return workspaceAssetKindOrder(left.asset.kind) - workspaceAssetKindOrder(right.asset.kind)
      || left.label.localeCompare(right.label);
  });
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = right ? Date.parse(right) : Number.NaN;
  if (!Number.isFinite(rightMs)) return Number.isFinite(leftMs) ? left : null;
  return !Number.isFinite(leftMs) || rightMs > leftMs ? right : left;
}

function workspaceAssetGroupKey(asset: ScopeAsset): string {
  if (asset.kind === 'repo') {
    const repositoryIdentity = repositoryIdentityFromAsset(asset);
    if (repositoryIdentity) return `${asset.direction}:repo:${repositoryIdentity}`;
  }
  return `${asset.direction}:${asset.kind}:${asset.id}`;
}

function preferredWorkspaceSurfaceAsset(assets: ScopeAsset[]): ScopeAsset {
  return assets.find((asset) => typeof asset.attributes?.displayName === 'string' && asset.attributes.displayName.trim())
    ?? assets.find((asset) => repositoryNameFromUrl(asset.value))
    ?? assets[0];
}

const WORKSPACE_ASSET_KINDS: ScopeAssetKind[] = [
  'repo',
  'documentation',
  'binary',
  'path',
  'service',
  'host',
  'domain',
  'ip_range',
  'account',
  'credential_ref',
  'other'
];

export function workspaceResearchSurfaceKinds(items: readonly WorkspaceResearchSurfaceItem[]): ScopeAssetKind[] {
  const representedKinds = new Set(items.map((item) => item.asset.kind));
  return WORKSPACE_ASSET_KINDS.filter((kind) => representedKinds.has(kind));
}

function WorkspaceResearchSurface({
  activeScope,
  hidden,
  honeycrispMemory,
  nowMs,
  runs,
  onAddResource,
  onChangeResource,
  workspaceName
}: {
  activeScope: WorkspaceScopeVersion | null;
  hidden: boolean;
  honeycrispMemory: HoneycrispMemorySummary | null;
  nowMs: number;
  runs: RunRow[];
  onAddResource: (asset: ScopeAssetInput) => Promise<void>;
  onChangeResource: (assetIds: string[], asset: ScopeAssetInput | null) => Promise<void>;
  workspaceName: string;
}): JSX.Element {
  const items = useMemo(
    () => workspaceResearchSurfaceItems(activeScope?.assets ?? [], runs, honeycrispMemory),
    [activeScope?.assets, honeycrispMemory, runs]
  );
  const resourceActivity = useMemo(
    () => workspaceCreationActivity(items.map((item) => item.asset), nowMs),
    [items, nowMs]
  );
  const representedKinds = useMemo(() => workspaceResearchSurfaceKinds(items), [items]);
  const [activeKind, setActiveKind] = useState<ScopeAssetKind | null>(() => representedKinds[0] ?? null);
  const [dialogState, setDialogState] = useState<{ kind: ScopeAssetKind; item: WorkspaceResearchSurfaceItem | null } | null>(null);
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const kindPickerRef = useRef<HTMLDivElement>(null);
  const visibleItems = activeKind ? items.filter((item) => item.asset.kind === activeKind) : [];
  const missingKinds = WORKSPACE_ASSET_KINDS.filter((kind) => !representedKinds.includes(kind));
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
  }, [activeKind, visibleItems.length, updateScrollFades]);

  useEffect(() => {
    if (activeKind && representedKinds.includes(activeKind)) return;
    setActiveKind(representedKinds[0] ?? null);
  }, [activeKind, representedKinds]);

  useEffect(() => {
    if (!kindPickerOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!kindPickerRef.current?.contains(event.target as Node)) setKindPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setKindPickerOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [kindPickerOpen]);

  const openResourceDialog = (kind: ScopeAssetKind, item: WorkspaceResearchSurfaceItem | null = null): void => {
    setKindPickerOpen(false);
    setDialogState({ kind, item });
  };

  return (
    <section
      aria-label="Workspace resources"
      className="workspace-dashboard-panel workspace-surface-area"
      hidden={hidden}
      id="workspace-dashboard-resources-panel"
      role="tabpanel"
    >
      <WorkspaceActivityForm activity={resourceActivity} metric="resources" viewLabel="Resources" workspaceName={workspaceName} />
      <div className="workspace-resource-tabs-bar">
        <div className="research-side-view-tabs workspace-resource-tabs" role="tablist" aria-label="Workspace resource types">
          {representedKinds.map((kind) => (
            <div className={`research-side-view-tab workspace-resource-tab ${activeKind === kind ? 'active' : ''}`.trim()} key={kind}>
              <button
                aria-selected={activeKind === kind}
                className="research-side-view-tab-activate"
                onClick={() => setActiveKind(kind)}
                role="tab"
                type="button"
              >
                <WorkspaceAssetIcon kind={kind} />
                <span>{workspaceAssetKindLabel(kind)}</span>
              </button>
              <button
                aria-label={`Add ${workspaceAssetKindLabel(kind).toLowerCase()}`}
                className="research-side-view-tab-close workspace-resource-tab-add"
                onClick={() => openResourceDialog(kind)}
                title={`Add ${workspaceAssetKindLabel(kind).toLowerCase()}`}
                type="button"
              >
                <Plus aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="research-side-view-picker workspace-resource-kind-picker" ref={kindPickerRef}>
          <button
            aria-expanded={kindPickerOpen}
            aria-haspopup="menu"
            aria-label="Add resource type"
            className="research-side-view-picker-trigger"
            disabled={missingKinds.length === 0}
            onClick={() => setKindPickerOpen((open) => !open)}
            title="Add resource type"
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
          </button>
          {kindPickerOpen ? (
            <div className="research-side-view-picker-menu workspace-resource-kind-menu" role="menu">
              {missingKinds.map((kind) => (
                <button key={kind} onClick={() => openResourceDialog(kind)} role="menuitem" type="button">
                  <WorkspaceAssetIcon kind={kind} />
                  <span>{workspaceAssetKindLabel(kind)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {visibleItems.length > 0 ? (
        <div className="workspace-surface-scroll" ref={surfaceScrollRef}>
          <div
            aria-label={`${workspaceAssetKindLabel(activeKind as ScopeAssetKind)} resources`}
            className="workspace-surface-list"
            onScroll={updateScrollFades}
            ref={surfaceListRef}
            role="tabpanel"
          >
            {visibleItems.map((item) => (
              <button
                className={`workspace-surface-item is-${item.asset.direction}`}
                key={item.asset.id}
                onClick={() => openResourceDialog(item.asset.kind, item)}
                title={`Edit ${item.label}`}
                type="button"
              >
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
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="workspace-surface-empty">
          {items.length > 0 ? 'No resources of this type recorded.' : 'No workspace resources recorded.'}
        </div>
      )}
      {dialogState ? (
        <WorkspaceResourceDialog
          initialAsset={dialogState.item?.asset ?? null}
          kind={dialogState.kind}
          onClose={() => setDialogState(null)}
          onRemove={dialogState.item
            ? () => onChangeResource(dialogState.item?.assetIds ?? [], null)
            : undefined}
          onSubmit={dialogState.item
            ? (asset) => onChangeResource(dialogState.item?.assetIds ?? [], asset)
            : onAddResource}
        />
      ) : null}
    </section>
  );
}

export function WorkspaceResourceDialog({
  initialAsset,
  kind,
  onClose,
  onRemove,
  onSubmit
}: {
  initialAsset: ScopeAsset | null;
  kind: ScopeAssetKind;
  onClose: () => void;
  onRemove?: () => Promise<void>;
  onSubmit: (asset: ScopeAssetInput) => Promise<void>;
}): JSX.Element {
  const editing = initialAsset !== null;
  const initialDisplayName = typeof initialAsset?.attributes?.displayName === 'string'
    ? initialAsset.attributes.displayName
    : '';
  const [value, setValue] = useState(initialAsset?.value ?? '');
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [direction, setDirection] = useState<ScopeAssetInput['direction']>(initialAsset?.direction ?? 'in_scope');
  const [sensitivity, setSensitivity] = useState(initialAsset?.sensitivity ?? 'internal');
  const [pendingAction, setPendingAction] = useState<'save' | 'remove' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmedValue = value.trim();
    if (!trimmedValue || pendingAction) return;
    setPendingAction('save');
    setSubmitError(null);
    try {
      const attributes: Record<string, unknown> = {
        ...(initialAsset?.attributes ?? {}),
        source: 'manual',
      };
      if (displayName.trim()) attributes.displayName = displayName.trim();
      else delete attributes.displayName;
      if (kind === 'repo') attributes.repositoryUrl = trimmedValue;
      await onSubmit({ direction, kind, value: trimmedValue, sensitivity, attributes });
      onClose();
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (!onRemove || pendingAction) return;
    setPendingAction('remove');
    setSubmitError(null);
    try {
      await onRemove();
      onClose();
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Modal
      className="start-run-dialog workspace-resource-dialog"
      closeDisabled={pendingAction !== null}
      footer={(
        <>
          {onRemove ? (
            <button
              className="workspace-resource-remove-button modal-footer-leading"
              disabled={pendingAction !== null}
              onClick={() => void remove()}
              type="button"
            >
              <Trash2 aria-hidden="true" size={15} />
              <span>{pendingAction === 'remove' ? 'Removing…' : 'Remove'}</span>
            </button>
          ) : null}
          <button className="primary-button" disabled={pendingAction !== null || !value.trim()} onClick={() => void submit()} type="button">
            {pendingAction === 'save' ? (editing ? 'Saving…' : 'Adding…') : (editing ? 'Save changes' : 'Add resource')}
          </button>
        </>
      )}
      onClose={onClose}
      title={`${editing ? 'Edit' : 'Add'} ${workspaceAssetKindLabel(kind)}`}
    >
      <form className="modal-form workspace-resource-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label>
          Resource type
          <input disabled readOnly value={workspaceAssetKindLabel(kind)} />
        </label>
        <label>
          Reference
          <input
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            placeholder={workspaceAssetPlaceholder(kind)}
            required
            value={value}
          />
        </label>
        <label>
          Display name
          <input onChange={(event) => setDisplayName(event.target.value)} placeholder="Optional" value={displayName} />
        </label>
        <div className="workspace-resource-form-row">
          <label>
            Scope
            <select onChange={(event) => setDirection(event.target.value as ScopeAssetInput['direction'])} value={direction}>
              <option value="in_scope">In scope</option>
              <option value="out_of_scope">Out of scope</option>
            </select>
          </label>
          <label>
            Sensitivity
            <select onChange={(event) => setSensitivity(event.target.value)} value={sensitivity}>
              <option value="public">Public</option>
              <option value="internal">Internal</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
        </div>
        {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
      </form>
    </Modal>
  );
}

function workspaceAssetPlaceholder(kind: ScopeAssetKind): string {
  if (kind === 'repo') return 'https://github.com/owner/repository';
  if (kind === 'domain') return 'example.com';
  if (kind === 'host') return 'research-host';
  if (kind === 'ip_range') return '192.0.2.0/24';
  if (kind === 'path') return 'C:\\path\\to\\resource';
  if (kind === 'service') return 'https://service.example.com';
  if (kind === 'documentation') return 'https://docs.example.com';
  return `Enter ${workspaceAssetKindLabel(kind).toLowerCase()} reference`;
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
    const repositoryName = repositoryNameFromAsset(asset);
    if (repositoryName) return repositoryName;
  }
  return asset.value;
}

function repositoryNameFromAsset(asset: ScopeAsset): string | null {
  const repositoryUrl = typeof asset.attributes?.repositoryUrl === 'string' ? asset.attributes.repositoryUrl : '';
  const urlName = repositoryNameFromUrl(repositoryUrl);
  if (urlName) return urlName;
  const directUrlName = repositoryNameFromUrl(asset.value);
  if (directUrlName) return directUrlName;
  return repositoryNameFromPath(asset.value);
}

function repositoryIdentityFromAsset(asset: ScopeAsset): string | null {
  const repositoryUrl = typeof asset.attributes?.repositoryUrl === 'string' ? asset.attributes.repositoryUrl : '';
  return repositoryIdentityFromUrl(repositoryUrl)
    ?? repositoryIdentityFromUrl(asset.value)
    ?? repositoryIdentityFromPath(asset.value);
}

function repositoryNameFromUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\.git$/iu, '').replace(/\/+$/u, '');
  if (!trimmed || !/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) return null;
  const name = trimmed.split('/').filter(Boolean).at(-1);
  return name && !/^[a-z][a-z0-9+.-]*:$/iu.test(name) ? name : null;
}

function repositoryIdentityFromUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\.git$/iu, '').replace(/\/+$/u, '');
  if (!trimmed || !/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.split('/').filter(Boolean).join('/').toLowerCase();
    return pathname ? `${parsed.hostname.toLowerCase()}/${pathname}` : null;
  } catch {
    return null;
  }
}

function repositoryNameFromPath(value: string): string | null {
  const parts = value.replace(/[\\/]+$/u, '').split(/[\\/]/u).filter(Boolean);
  const leaf = parts.at(-1)?.replace(/\.git$/iu, '');
  const parent = parts.at(-2);
  const materializedName = parent ? repositoryNameFromMaterializedSlug(parent) : null;
  if (materializedName && (!leaf || leaf === 'default' || /^[A-Za-z0-9_.-]+-[a-f0-9]{12}$/u.test(leaf))) {
    return materializedName;
  }
  return leaf || materializedName;
}

function repositoryIdentityFromPath(value: string): string | null {
  const parts = value.replace(/[\\/]+$/u, '').split(/[\\/]/u).filter(Boolean);
  const leaf = parts.at(-1)?.replace(/\.git$/iu, '') ?? '';
  const parent = parts.at(-2) ?? '';
  const materializedIdentity = repositoryIdentityFromMaterializedSlug(parent);
  if (materializedIdentity && (!leaf || leaf === 'default' || /^[A-Za-z0-9_.-]+-[a-f0-9]{12}$/u.test(leaf))) {
    return materializedIdentity;
  }
  return repositoryIdentityFromMaterializedSlug(leaf);
}

function repositoryNameFromMaterializedSlug(value: string): string | null {
  const segments = value.split('_').filter(Boolean);
  if (segments.length < 3 || !/^(?:github|gitlab)\.com$/iu.test(segments[0])) return null;
  const name = segments.at(-1)?.replace(/\.git$/iu, '');
  return name || null;
}

function repositoryIdentityFromMaterializedSlug(value: string): string | null {
  const segments = value.split('_').filter(Boolean);
  if (segments.length < 3 || !/^(?:github|gitlab)\.com$/iu.test(segments[0])) return null;
  return `${segments[0].toLowerCase()}/${segments.slice(1).join('/').replace(/\.git$/iu, '').toLowerCase()}`;
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

export function memoryDreamingProgressLabel(phase: MemoryDreamingProgressPhase): string {
  if (phase === 'preparing') return 'Preparing…';
  if (phase === 'gathering') return 'Gathering memories…';
  if (phase === 'synthesizing') return 'Dreaming across memories…';
  if (phase === 'compacting') return 'Compacting context…';
  if (phase === 'retrying') return 'Trying again…';
  if (phase === 'correcting') return 'Refining the plan…';
  if (phase === 'validating') return 'Validating changes…';
  if (phase === 'applying') return 'Applying changes…';
  if (phase === 'completed') return 'Dream complete';
  return 'Dream failed';
}

export function workspaceDejunkHeat(newFileCount: number): SessionHeat {
  if (newFileCount >= 1_000) return 'critical';
  if (newFileCount >= 200) return 'high';
  if (newFileCount >= 50) return 'medium';
  if (newFileCount >= 10) return 'low';
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
