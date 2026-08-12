import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispMemorySummary, RunRow } from '../src/shared/types';
import { MainSessionWorkspace } from '../src/renderer/features/sessions/MainSessionWorkspace';
import { WorkspaceUnderstandingView } from '../src/renderer/features/workspaces/WorkspaceUnderstandingView';
import { buildWorkspaceTimeline } from '../src/renderer/view-models/workspaceTimeline';
import { testResearchProfile } from './researchProfileFixture';

const NOW = Date.parse('2026-08-12T12:00:00.000Z');

describe('workspace dashboard', () => {
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
    expect(html.match(/class="workspace-dashboard-half/g)).toHaveLength(2);
    expect(html).toContain('Parser Workspace Activity');
    expect(html).toContain('No session activity in the past 12 hours.');
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
      }]
    });
    const rows = buildWorkspaceTimeline(runs, memory.nodes, profile.memory.types, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.segments).toHaveLength(2);
    expect(rows[0]?.totalDurationMs).toBe(5 * 60 * 60 * 1_000);
    expect(rows[0]?.memoryMarkers).toEqual([
      expect.objectContaining({ id: 'memory_one', type: memoryType.id, color: memoryType.color ?? null })
    ]);

    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      memoryDreamingInProgress: false,
      honeycrispMemory: memory,
      researchProfile: profile,
      workspaceName: 'Parser Workspace',
      runs,
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).toContain('Past 12 Hours');
    expect(html).toContain('Recent session');
    expect(html).toContain('5h total');
    expect(html.match(/workspace-timeline-segment/g)).toHaveLength(2);
    expect(html).toContain(`workspace-timeline-memory-marker memory-type-${memoryType.id}`);
    expect(html).toContain(`memory recorded: Parser state transition`);
    expect(html).toContain('>Dream</button>');
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
  intervals: Array<[startedAt: string, endedAt: string | null]>
): RunRow {
  return {
    run: {
      id,
      scopeVersionId: 'scope_one',
      researchProfileSnapshotId: null,
      shellSafetyMode: 'auto_review',
      mode: 'dynamic',
      status: intervals.at(-1)?.[1] === null ? 'active' : 'completed',
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
    activityIntervals: intervals.map(([startedAt, endedAt], index) => ({
      id: `activity_${index}`,
      runId: id,
      startedAt,
      endedAt
    }))
  };
}

function memorySummary(input: { nodes?: Array<Partial<HoneycrispMemorySummary['nodes'][number]>> } = {}): HoneycrispMemorySummary {
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
    runbookCount: 0,
    reportCount: 0,
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
    runbooks: [],
    reports: [],
    directories: [],
    lastError: null,
    dreaming: {
      available: true,
      scope: 'workspace',
      hiddenNodeCount: 0,
      restorableChangeCount: 0,
      lastRun: null,
      changes: []
    }
  };
}
