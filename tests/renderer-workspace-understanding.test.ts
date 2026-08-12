import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispMemorySummary, RunRow, SessionRunActivity } from '../src/shared/types';
import { MainSessionWorkspace } from '../src/renderer/features/sessions/MainSessionWorkspace';
import {
  memoryCountSinceLastDream,
  memoryDreamHeat,
  workspaceDejunkHeat,
  WorkspaceUnderstandingView
} from '../src/renderer/features/workspaces/WorkspaceUnderstandingView';
import { buildWorkspaceTimeline } from '../src/renderer/view-models/workspaceTimeline';
import { testResearchProfile } from './researchProfileFixture';

const NOW = Date.parse('2026-08-12T12:00:00.000Z');

describe('workspace dashboard', () => {
  it('caps only the timeline panel while the dreaming panel fills the remaining height', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const dashboardStyles = styles.match(/\.workspace-dashboard\s*\{([^}]*)\}/)?.[1] ?? '';
    const sharedPanelStyles = styles.match(/\.workspace-dashboard-half\s*\{([^}]*)\}/)?.[1] ?? '';
    const timelinePanelStyles = styles.match(/\.workspace-timeline-card\s*\{([^}]*)\}/)?.[1] ?? '';
    const chartStyles = styles.match(/\.workspace-timeline-chart\s*\{([^}]*)\}/)?.[1] ?? '';
    const axisStyles = styles.match(/\.workspace-timeline-axis\s*\{([^}]*)\}/)?.[1] ?? '';
    const timelineRowsStyles = styles.match(/\.workspace-timeline-rows\s*\{([^}]*)\}/)?.[1] ?? '';
    const timelineResultStyles = styles.match(/\.workspace-timeline-result\s*\{([^}]*)\}/)?.[1] ?? '';
    const timelineLegendButtonStyles = styles.match(/\.workspace-timeline-legend-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const surfaceAreaStyles = styles.match(/\.workspace-surface-area\s*\{([^}]*)\}/)?.[1] ?? '';
    const sharedSectionHeaderStyles = styles.match(/\.workspace-surface-header,\s*\.workspace-housekeeping-header\s*\{([^}]*)\}/)?.[1] ?? '';
    const dreamAreaStyles = styles.match(/\.workspace-dream-area\s*\{([^}]*)\}/)?.[1] ?? '';
    const dreamContentStyles = styles.match(/\.workspace-dream-content\s*\{([^}]*)\}/)?.[1] ?? '';
    const housekeepingCardStyles = styles.match(/\.workspace-dejunk-card,\s*\.workspace-dream-card\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(dashboardStyles).toContain('grid-template-rows: fit-content(50%) fit-content(33%) minmax(0, 1fr)');
    expect(sharedPanelStyles).toContain('min-height: 0');
    expect(sharedPanelStyles).not.toContain('height: 100%');
    expect(timelinePanelStyles).not.toContain('border-bottom');
    expect(timelinePanelStyles).toContain('grid-template-rows: minmax(0, 1fr)');
    expect(timelinePanelStyles).toContain('gap: 0');
    expect(chartStyles).toContain('grid-template-rows: 22px minmax(0, 1fr)');
    expect(axisStyles).toContain('border-bottom: 1px solid var(--panel-border)');
    expect(axisStyles).not.toContain('padding-bottom');
    expect(timelineRowsStyles).toContain('padding-top: 8px');
    expect(timelineRowsStyles).not.toContain('scrollbar-gutter');
    expect(timelineResultStyles).toContain('justify-items: end');
    expect(timelineLegendButtonStyles).toContain('top: -6px');
    expect(surfaceAreaStyles).toContain('grid-template-rows: 22px minmax(0, 1fr)');
    expect(sharedSectionHeaderStyles).toContain('border-bottom: 1px solid var(--panel-border)');
    expect(dreamAreaStyles).toContain('grid-template-rows: 22px minmax(0, 1fr)');
    expect(dreamAreaStyles).toContain('padding: 8px 18px 18px');
    expect(dreamContentStyles).toContain('padding-top: 8px');
    expect(dreamContentStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(housekeepingCardStyles).toContain('width: 100%');
    expect(housekeepingCardStyles).toContain('height: 100%');
    expect(housekeepingCardStyles).toContain('border: 0');
    expect(housekeepingCardStyles).toContain('border-radius: 24px');
    expect(housekeepingCardStyles).toContain('radial-gradient');
  });

  it('maps memories created since the latest dream to profile heat thresholds', () => {
    expect(memoryDreamHeat(19)).toBe('none');
    expect(memoryDreamHeat(20)).toBe('low');
    expect(memoryDreamHeat(49)).toBe('low');
    expect(memoryDreamHeat(50)).toBe('medium');
    expect(memoryDreamHeat(100)).toBe('high');
    expect(memoryDreamHeat(150)).toBe('critical');
    expect(workspaceDejunkHeat(9)).toBe('none');
    expect(workspaceDejunkHeat(10)).toBe('low');
    expect(workspaceDejunkHeat(50)).toBe('medium');
    expect(workspaceDejunkHeat(200)).toBe('high');
    expect(workspaceDejunkHeat(1_000)).toBe('critical');

    const memory = memorySummary({
      nodes: [
        { id: 'before', createdAt: '2026-08-12T09:00:00.000Z' },
        { id: 'after_one', createdAt: '2026-08-12T11:00:00.000Z' },
        { id: 'after_two', createdAt: '2026-08-12T12:00:00.000Z' }
      ],
      lastDreamCompletedAt: '2026-08-12T10:00:00.000Z'
    });
    expect(memoryCountSinceLastDream(memory)).toBe(2);
  });

  it('places the two-part workspace dashboard beside the compact workspace research sidenav', () => {
    const memory = memorySummary();
    const html = renderToStaticMarkup(createElement(MainSessionWorkspace, {
      detail: null,
      events: [],
      allEvents: [],
      chatView: 'commentary',
      providerModelCatalog: [],
      honeycrispMemory: memory,
      researchProfile: testResearchProfile(),
      workspaceName: 'Parser Workspace',
      runs: [],
      selectedRunId: null,
      researchDetailsOpen: false,
      selectedRunbookId: null,
      selectedRunbook: null,
      selectedRunbookDocument: null,
      runbookLoading: false,
      runbookError: null,
      selectedSubagentPath: null,
      selectedTraceEventId: null,
      searchHighlightQuery: '',
      visibleTraceCategories: [],
      busy: false,
      memoryDreamingInProgress: false,
      traceFilterCount: 0,
      totalTraceFilterCount: 0,
      onOpenTraceFilters: () => undefined,
      onRunMemoryDreaming: () => undefined,
      onResearchDetailsOpenChange: () => undefined,
      onOpenHoneycrispRunbook: () => undefined,
      onBackToRunbooks: () => undefined,
      onBackToSubagents: () => undefined,
      onSelectTraceEvent: () => undefined,
      onSelectSubagent: () => undefined,
      onSelectNextStep: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));

    expect(html).toContain('class="main-session-grid "');
    expect(html).toContain('class="workspace-dashboard"');
    expect(html.match(/class="workspace-dashboard-half/g)).toHaveLength(3);
    expect(html).toContain('>Surface</span>');
    expect(html).not.toContain('Research Surface');
    expect(html).not.toContain('Workspace inputs and coverage');
    expect(html).not.toContain('workspace-surface-card');
    expect(html).toContain('aria-label="0 in scope, 0 researched"');
    expect(html).toContain('>Housekeeping</span>');
    expect(html).toContain('>0 new files</span>');
    expect(html).toContain('>0 new memories</span>');
    expect(html).toContain('>Dejunk</button>');
    expect(html.indexOf('>Dejunk</button>')).toBeLessThan(html.indexOf('>Dream</button>'));
    expect(html.indexOf('>0 new files</span>')).toBeLessThan(html.indexOf('>0 new memories</span>'));
    expect(html).toContain('No workspace sources or references recorded.');
    expect(html).not.toContain('Parser Workspace Activity');
    expect(html).toContain('aria-label="Parser Workspace — most recent 12 hours of session activity"');
    expect(html).toContain('<span>Activity</span>');
    expect(html).toContain('aria-label="Show activity legend"');
    expect(html).toContain('aria-expanded="false"');
    expect(html.indexOf('workspace-timeline-legend-popover')).toBeLessThan(html.indexOf('workspace-timeline-rows'));
    expect(html).toContain('No session activity recorded.');
    expect(html).toContain('<span>0 Runbooks</span>');
    expect(html).toContain('<span>0 Reports</span>');
    expect(html).toContain('<span>0 Memories</span>');
    expect(html).not.toContain('<span>0 Subagents</span>');
  });

  it('renders split work intervals and per-memory-type timeline markers', () => {
    const profile = testResearchProfile();
    const memoryType = profile.memory.types[0];
    const runs = [runRow('run_one', [
      ['2026-08-12T02:00:00.000Z', '2026-08-12T04:00:00.000Z'],
      ['2026-08-12T09:00:00.000Z', null]
    ])];
    const memory = memorySummary({
      nodes: [{
        id: 'memory_one',
        sessionIds: ['run_one'],
        type: memoryType.id,
        title: 'Parser state transition',
        createdAt: '2026-08-12T10:00:00.000Z'
      }],
      runbooks: [{
        id: 'runbook_one',
        sessionId: 'run_one',
        title: 'Parser proof',
        revision: 2,
        revisions: [
          { revision: 1, sessionId: 'run_one', createdAt: '2026-08-12T10:30:00.000Z' },
          { revision: 2, sessionId: 'run_one', createdAt: '2026-08-12T11:00:00.000Z' }
        ]
      }],
      reports: [{
        id: 'report_one',
        sessionId: 'run_one',
        title: 'Parser result',
        revision: 1,
        revisions: [{ revision: 1, sessionId: 'run_one', createdAt: '2026-08-12T11:30:00.000Z' }]
      }]
    });
    const timeline = buildWorkspaceTimeline(runs, memory.nodes, memory.runbooks, memory.reports, profile.memory.types, NOW);
    const rows = timeline.rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.segments).toHaveLength(2);
    expect(rows[0]?.totalDurationMs).toBe(5 * 60 * 60 * 1_000);
    expect(timeline.windowDurationMs).toBe(5 * 60 * 60 * 1_000);
    expect(rows[0]?.segments[0]?.leftPercent).toBeCloseTo(0);
    expect((rows[0]?.segments[0]?.leftPercent ?? 0) + (rows[0]?.segments[0]?.widthPercent ?? 0))
      .toBeCloseTo(rows[0]?.segments[1]?.leftPercent ?? 0);
    expect((rows[0]?.segments[1]?.leftPercent ?? 0) + (rows[0]?.segments[1]?.widthPercent ?? 0))
      .toBeCloseTo(100);
    expect(rows[0]?.memoryMarkers).toEqual([
      expect.objectContaining({ id: 'memory_one', type: memoryType.id, color: memoryType.color ?? null })
    ]);
    expect(rows[0]?.memoryMarkers[0]?.leftPercent).toBeCloseTo(60);
    expect(rows[0]?.runbookRevisionMarkers).toEqual([
      expect.objectContaining({ id: 'runbook_one:1', revision: 1 }),
      expect.objectContaining({ id: 'runbook_one:2', revision: 2 })
    ]);
    expect(rows[0]?.reportRevisionMarkers).toEqual([
      expect.objectContaining({ id: 'report_one:1', revision: 1 })
    ]);

    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      workspaceDejunk: {
        available: true,
        newFileCount: 50,
        newFileCountCapped: false,
        baselineAt: '2026-08-12T08:00:00.000Z',
        lastRun: null
      },
      memoryDreamingInProgress: false,
      honeycrispMemory: memory,
      researchProfile: profile,
      workspaceName: 'Parser Workspace',
      runs,
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).not.toContain('>Past 12 Hours<');
    expect(html).toContain('>-5h<');
    expect(html).toContain('>-3h 45m<');
    expect(html).toContain('>Latest<');
    expect(html).toContain('Recent session');
    expect(html).not.toContain('<strong>Recent session</strong>');
    expect(html).not.toContain('5h total');
    expect(html.match(/workspace-timeline-segment/g)).toHaveLength(2);
    expect(html).toContain(`workspace-timeline-memory-marker memory-type-${memoryType.id}`);
    expect(html).toContain(`memory recorded: Parser state transition`);
    expect(html.match(/workspace-timeline-runbook-marker/g)).toHaveLength(2);
    expect(html).toContain('Runbook revision 2: Parser proof');
    expect(html).toContain('workspace-timeline-report-marker');
    expect(html).toContain('Report revision 1: Parser result');
    expect(html).toContain('data-dejunk-heat="medium"');
    expect(html).toContain('>50 new files</span>');
    expect(html).toContain('>Dream</button>');
  });

  it('shows workspace sources with session, memory, and recency coverage', () => {
    const run = runRow('run_surface', [['2026-08-12T10:00:00.000Z', '2026-08-12T11:00:00.000Z']]);
    run.run.targetAssetId = 'asset_repo';
    const memory = memorySummary({
      nodes: [{ id: 'memory_repo', assetIds: ['asset_repo'], createdAt: '2026-08-12T11:30:00.000Z' }]
    });
    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      memoryDreamingInProgress: false,
      honeycrispMemory: memory,
      activeScope: {
        id: 'scope_surface',
        version: 1,
        status: 'active',
        workspaceName: 'Parser Workspace',
        scopeOwner: 'Researcher',
        descriptionMarkdown: '',
        rulesMarkdown: '',
        activeFrom: '2026-08-12T00:00:00.000Z',
        expiresAt: null,
        createdAt: '2026-08-12T00:00:00.000Z',
        createdBy: 'user',
        assets: [{
          id: 'asset_repo',
          scopeVersionId: 'scope_surface',
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://github.com/example/parser.git',
          sensitivity: 'public',
          attributes: {},
          createdAt: '2026-08-12T00:00:00.000Z'
        }]
      },
      researchProfile: testResearchProfile(),
      workspaceName: 'Parser Workspace',
      runs: [run],
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).toContain('>parser</strong>');
    expect(html).toContain('class="workspace-surface-scroll"');
    expect(html).toContain('>Repository</span>');
    expect(html).toContain('>1 session</span>');
    expect(html).toContain('>1 memory</span>');
    expect(html).toContain('>Last 2h ago</span>');
  });

  it('keeps terminal session runs immutable when the session is continued', () => {
    const continued = runRow('run_continued', [], { status: 'active' });
    continued.sessionRuns = [
      sessionRun('run_continued', 'attempt_failed', [
        ['2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z']
      ], { status: 'failed' }),
      sessionRun('run_continued', 'attempt_continued', [
        ['2026-08-12T10:00:00.000Z', null]
      ], { status: 'active' })
    ];

    const timeline = buildWorkspaceTimeline(
      [continued],
      [],
      [],
      [],
      testResearchProfile().memory.types,
      NOW
    );
    const failed = timeline.rows.find((row) => row.sessionRunId === 'attempt_failed');
    const active = timeline.rows.find((row) => row.sessionRunId === 'attempt_continued');

    expect(timeline.rows).toHaveLength(2);
    expect(failed).toMatchObject({ runId: 'run_continued', result: 'unexpected_error', totalDurationMs: 60 * 60 * 1_000 });
    expect(failed?.segments).toEqual([expect.objectContaining({ endedAt: '2026-08-12T09:00:00.000Z' })]);
    expect(active).toMatchObject({ runId: 'run_continued', result: null, totalDurationMs: 2 * 60 * 60 * 1_000 });
  });

  it('renders timeline symbols with a single-pixel border and no outer halo', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const memoryMarkerStyles = styles.match(/\.workspace-timeline-memory-marker\s*\{([^}]*)\}/)?.[1] ?? '';
    const revisionMarkerStyles = styles.match(/\.workspace-timeline-runbook-marker,\s*\.workspace-timeline-report-marker\s*\{([^}]*)\}/)?.[1] ?? '';
    const resultMarkerStyles = styles.match(/\.workspace-timeline-result-symbol\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(memoryMarkerStyles).toContain('border: 1px solid');
    expect(memoryMarkerStyles).not.toContain('box-shadow:');
    expect(revisionMarkerStyles).toContain('border: 1px solid');
    expect(revisionMarkerStyles).not.toContain('box-shadow:');
    expect(resultMarkerStyles).toContain('border: 1px solid');
    expect(resultMarkerStyles).toContain('border-radius: 0');
    expect(resultMarkerStyles).not.toContain('box-shadow:');
  });

  it('records natural, unexpected-error, and safeguard-error session results', () => {
    const interval: Array<[string, string | null]> = [['2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z']];
    const natural = runRow('run_natural', interval, { status: 'completed' });
    const unexpected = runRow('run_unexpected', interval, { status: 'failed' });
    const safeguard = runRow('run_safeguard', interval, { status: 'failed', terminationCause: 'safeguard' });
    const recovered = runRow('run_recovered', interval, { status: 'paused', terminationCause: 'workspace_recovery' });
    const active = runRow('run_active', [['2026-08-12T09:00:00.000Z', null]]);
    const timeline = buildWorkspaceTimeline(
      [natural, unexpected, safeguard, recovered, active],
      [],
      [],
      [],
      testResearchProfile().memory.types,
      NOW
    );
    const resultByRunId = new Map(timeline.rows.map((row) => [row.runId, row.result]));

    expect(resultByRunId).toEqual(new Map([
      ['run_active', null],
      ['run_natural', 'natural_end'],
      ['run_recovered', 'unexpected_error'],
      ['run_safeguard', 'safeguard_error'],
      ['run_unexpected', 'unexpected_error']
    ]));

    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      memoryDreamingInProgress: false,
      honeycrispMemory: memorySummary(),
      researchProfile: testResearchProfile(),
      workspaceName: 'Parser Workspace',
      runs: [natural, unexpected, safeguard, recovered, active],
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).toContain('class="workspace-timeline-result-symbol is-natural-end"');
    expect(html).toContain('class="workspace-timeline-result-symbol is-unexpected-error"');
    expect(html).toContain('class="workspace-timeline-result-symbol is-safeguard-error"');
    expect(html).toContain('class="workspace-timeline-legend-row is-session-items"');
    expect(html).toContain('class="workspace-timeline-legend-row is-session-results"');
    const sessionItemsRow = html.match(/<div class="workspace-timeline-legend-row is-session-items">([\s\S]*?)<\/div>/)?.[1] ?? '';
    const sessionResultsRow = html.match(/<div class="workspace-timeline-legend-row is-session-results">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(sessionItemsRow).toContain('Work duration');
    expect(sessionItemsRow).toContain('Report revision');
    expect(sessionItemsRow).not.toContain('No error');
    expect(sessionResultsRow).toContain('No error');
    expect(sessionResultsRow).toContain('Unexpected error');
    expect(sessionResultsRow).toContain('Safeguard error');
    expect(html).toContain('>No error</span>');
    expect(html.indexOf('>No error</span>')).toBeLessThan(html.indexOf('>Unexpected error</span>'));
    expect(html).toContain('>Safeguard error</span>');
  });

  it('uses the latest 12 cumulative activity hours and collapses wall-clock gaps', () => {
    const timeline = buildWorkspaceTimeline([
      runRow('run_one', [
        ['2026-08-01T00:00:00.000Z', '2026-08-01T08:00:00.000Z'],
        ['2026-08-12T00:00:00.000Z', '2026-08-12T08:00:00.000Z']
      ])
    ], [], [], [], testResearchProfile().memory.types, NOW);
    const rows = timeline.rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.segments).toHaveLength(2);
    expect(timeline.windowDurationMs).toBe(12 * 60 * 60 * 1_000);
    expect(rows[0]?.windowDurationMs).toBe(12 * 60 * 60 * 1_000);
    expect(rows[0]?.segments[0]).toMatchObject({ leftPercent: 0 });
    expect(rows[0]?.segments[0]?.widthPercent).toBeCloseTo((4 / 12) * 100);
    expect(rows[0]?.segments[1]?.leftPercent).toBeCloseTo((4 / 12) * 100);
    expect(rows[0]?.segments[1]?.widthPercent).toBeCloseTo((8 / 12) * 100);
  });

  it('keeps concurrent sessions aligned without double-counting overlapping activity', () => {
    const timeline = buildWorkspaceTimeline([
      runRow('run_one', [['2026-08-12T00:00:00.000Z', '2026-08-12T04:00:00.000Z']]),
      runRow('run_two', [['2026-08-12T02:00:00.000Z', '2026-08-12T06:00:00.000Z']])
    ], [], [], [], testResearchProfile().memory.types, NOW);
    const first = timeline.rows.find((row) => row.runId === 'run_one');
    const second = timeline.rows.find((row) => row.runId === 'run_two');

    expect(timeline.windowDurationMs).toBe(6 * 60 * 60 * 1_000);
    expect(first?.segments[0]?.leftPercent).toBeCloseTo(0);
    expect(first?.segments[0]?.widthPercent).toBeCloseTo((4 / 6) * 100);
    expect(second?.segments[0]?.leftPercent).toBeCloseTo((2 / 6) * 100);
    expect(second?.segments[0]?.widthPercent).toBeCloseTo((4 / 6) * 100);
  });

  it('shows Dreaming progress and honors profiles with memory disabled', () => {
    const profile = testResearchProfile();
    const inProgressHtml = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: true,
      memoryDreamingInProgress: true,
      honeycrispMemory: memorySummary(),
      researchProfile: profile,
      workspaceName: 'Parser Workspace',
      runs: [],
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));
    expect(inProgressHtml).toContain('Dreaming…');
    expect(inProgressHtml).toContain('disabled=""');

    const disabledHtml = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      memoryDreamingInProgress: false,
      honeycrispMemory: memorySummary(),
      researchProfile: {
        ...profile,
        capabilities: { ...profile.capabilities, memoryEnabled: false }
      },
      workspaceName: 'Parser Workspace',
      runs: [],
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));
    expect(disabledHtml).toContain('disabled="" title="Memory Dreaming is disabled by the active research profile"');
  });
});

function runRow(
  id: string,
  intervals: Array<[startedAt: string, endedAt: string | null]>,
  outcome: {
    status?: RunRow['run']['status'];
    terminationCause?: SessionRunActivity['terminationCause'];
  } = {}
): RunRow {
  return {
    run: {
      id,
      scopeVersionId: 'scope_one',
      researchProfileSnapshotId: null,
      shellSafetyMode: 'auto_review',
      mode: 'dynamic',
      status: outcome.status ?? (intervals.at(-1)?.[1] === null ? 'active' : 'completed'),
      title: 'Recent session',
      promptMarkdown: '',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'breadth_first',
      sandboxProfile: 'host',
      targetAssetId: null,
      targetPath: null,
      budget: {},
      summary: '',
      finalDisposition: null,
      createdAt: intervals[0]?.[0] ?? new Date(NOW).toISOString(),
      startedAt: intervals[0]?.[0] ?? null,
      endedAt: intervals.at(-1)?.[1] ?? null
    },
    engine: 'honeycrisp',
    sessionRuns: intervals.length > 0
      ? [sessionRun(id, `attempt_${id}`, intervals, outcome)]
      : []
  };
}

function sessionRun(
  runId: string,
  attemptId: string,
  intervals: Array<[startedAt: string, endedAt: string | null]>,
  outcome: {
    status?: SessionRunActivity['status'];
    terminationCause?: SessionRunActivity['terminationCause'];
  } = {}
): SessionRunActivity {
  return {
    id: attemptId,
    runId,
    attemptId,
    status: outcome.status ?? (intervals.at(-1)?.[1] === null ? 'active' : 'completed'),
    terminationCause: outcome.terminationCause ?? null,
    activityIntervals: intervals.map(([startedAt, endedAt], index) => ({
      id: `activity_${attemptId}_${index}`,
      runId,
      attemptId,
      startedAt,
      endedAt
    }))
  };
}

function memorySummary(input: {
  nodes?: Array<Partial<HoneycrispMemorySummary['nodes'][number]>>;
  runbooks?: Array<Partial<HoneycrispMemorySummary['runbooks'][number]>>;
  reports?: Array<Partial<HoneycrispMemorySummary['reports'][number]>>;
  lastDreamCompletedAt?: string;
} = {}): HoneycrispMemorySummary {
  return {
    status: 'ready',
    source: 'honeycrisp_sqlite',
    contextWorkspaceId: 'workspace_security',
    contextSubjectId: 'subject_security',
    databasePath: '/memory.sqlite',
    storageRoot: '/storage',
    artifactDirectoryPath: '/artifacts',
    databaseSizeBytes: 1_024,
    nodeCount: input.nodes?.length ?? 0,
    edgeCount: 0,
    evidenceRefCount: 0,
    storageArtifactCount: 0,
    runbookCount: input.runbooks?.length ?? 0,
    reportCount: input.reports?.length ?? 0,
    latestNodeUpdatedAt: null,
    nodeTypeCounts: {},
    nodeStatusCounts: {},
    nodes: (input.nodes ?? []).map((node) => ({
      sessionIds: [],
      workspaces: [],
      subjectId: 'subject_security',
      subjectName: 'Security',
      summary: '',
      body: '',
      status: 'suspected',
      confidence: 0.5,
      assetIds: [],
      tags: [],
      attributes: {},
      evidenceRefs: [],
      updatedAt: node.createdAt ?? new Date(NOW).toISOString(),
      revision: 1,
      id: 'memory',
      type: 'other',
      title: 'Memory',
      createdAt: new Date(NOW).toISOString(),
      ...node
    })),
    edges: [],
    runbooks: (input.runbooks ?? []).map((runbook) => ({
      id: 'runbook',
      workspaceId: 'workspace_security',
      workspaceName: 'Security',
      subjectId: 'subject_security',
      subjectName: 'Security',
      sessionId: null,
      title: 'Runbook',
      purpose: '',
      status: 'active',
      artifactId: 'runbook',
      revision: 1,
      revisions: [],
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      ...runbook
    })),
    reports: (input.reports ?? []).map((report) => ({
      id: 'report',
      workspaceId: 'workspace_security',
      workspaceName: 'Security',
      subjectId: 'subject_security',
      subjectName: 'Security',
      sessionId: null,
      title: 'Report',
      summary: '',
      status: 'complete',
      artifactId: 'report',
      revision: 1,
      revisions: [],
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      ...report
    })),
    directories: [],
    lastError: null,
    dreaming: {
      available: true,
      scope: 'workspace',
      hiddenNodeCount: 0,
      restorableChangeCount: 0,
      lastRun: input.lastDreamCompletedAt ? {
        id: 'dream_one',
        status: 'completed',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        inputNodeCount: 1,
        inputSessionCount: 1,
        prunedNodeCount: 0,
        duplicateHiddenCount: 0,
        duplicateGroupCount: 0,
        reclassifiedNodeCount: 0,
        editedNodeCount: 0,
        createdAt: input.lastDreamCompletedAt,
        completedAt: input.lastDreamCompletedAt,
        restoredAt: null,
        errorMessage: null
      } : null,
      changes: []
    }
  };
}
