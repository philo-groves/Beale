import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispMemorySummary, ResearchSubject, WorkspaceScopeVersion } from '../src/shared/types';
import { MainSessionWorkspace } from '../src/renderer/features/sessions/MainSessionWorkspace';
import { WorkspaceUnderstandingView } from '../src/renderer/features/workspaces/WorkspaceUnderstandingView';
import { testResearchProfile } from './researchProfileFixture';

describe('WorkspaceUnderstandingView Dreaming controls', () => {
  it('places Workspace Understanding beside the compact workspace research sidenav', () => {
    const memory = {
      contextWorkspaceId: 'workspace_security',
      contextSubjectId: 'subject_security',
      nodes: [],
      edges: [],
      runbooks: [],
      directories: [],
      dreaming: { status: 'idle', changes: [] },
      lastError: null
    } as unknown as HoneycrispMemorySummary;
    const html = renderToStaticMarkup(createElement(MainSessionWorkspace, {
      detail: null,
      events: [],
      allEvents: [],
      chatView: 'commentary',
      providerModelCatalog: [],
      honeycrispMemory: memory,
      researchProfile: null,
      researchSubject: null,
      runCount: 0,
      scope: null,
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
      onOpenHoneycrispMemoryDirectory: () => undefined,
      onRestoreMemoryDreamingChange: () => undefined,
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
    expect(html).toContain('class="workspace-understanding-workspace"');
    expect(html).toContain('aria-label="Workspace summary"');
    expect(html).toContain('<span>0 Runbooks</span>');
    expect(html).toContain('<span>0 Memories</span>');
    expect(html).not.toContain('<span>0 Subagents</span>');
  });

  it('shows reversible cleanup metrics and recent changes on the workspace dashboard', () => {
    const memory = {
      status: 'ready',
      source: 'honeycrisp_sqlite',
      contextWorkspaceId: 'workspace_security',
      contextSubjectId: 'subject_security',
      databasePath: '/memory.sqlite',
      storageRoot: '/storage',
      artifactDirectoryPath: '/artifacts',
      databaseSizeBytes: 1024,
      nodeCount: 8,
      edgeCount: 2,
      evidenceRefCount: 4,
      storageArtifactCount: 0,
      runbookCount: 0,
      latestNodeUpdatedAt: '2026-07-29T10:00:00.000Z',
      nodeTypeCounts: { primitive: 2 },
      nodeStatusCounts: { confirmed: 2 },
      nodes: [],
      edges: [],
      runbooks: [],
      directories: [],
      lastError: null,
      dreaming: {
        available: true,
        scope: 'workspace',
        hiddenNodeCount: 3,
        restorableChangeCount: 1,
        lastRun: {
          id: 'dream_one',
          status: 'completed',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
          inputNodeCount: 8,
          inputSessionCount: 2,
          prunedNodeCount: 1,
          duplicateHiddenCount: 2,
          duplicateGroupCount: 1,
          reclassifiedNodeCount: 1,
          editedNodeCount: 2,
          createdAt: '2026-07-29T11:00:00.000Z',
          completedAt: '2026-07-29T11:00:00.000Z',
          restoredAt: null,
          errorMessage: null
        },
        changes: [
          {
            id: 'change_one',
            runId: 'dream_one',
            action: 'merge_duplicates',
            title: 'Parser mismatch',
            nodeType: 'primitive',
            hiddenNodeIds: ['duplicate_one', 'duplicate_two'],
            survivorNodeId: 'survivor',
            reason: 'Merged exact duplicates.',
            createdAt: '2026-07-29T11:00:00.000Z',
            restoredAt: null,
            canRestore: true
          },
          {
            id: 'change_two',
            runId: 'dream_one',
            action: 'reclassify',
            title: 'Mounted images synthesize quarantine state',
            nodeType: 'invariant',
            hiddenNodeIds: [],
            survivorNodeId: 'quarantine_behavior',
            reason: 'The node records platform behavior rather than a flaw.',
            createdAt: '2026-07-29T11:00:00.000Z',
            restoredAt: null,
            canRestore: true
          }
        ]
      }
    } satisfies HoneycrispMemorySummary;

    const html = renderToStaticMarkup(
      createElement(WorkspaceUnderstandingView, {
        busy: false,
        memoryDreamingInProgress: false,
        honeycrispMemory: memory,
        runCount: 2,
        scope: null,
        onOpenHoneycrispMemoryDirectory: () => undefined,
        onRestoreMemoryDreamingChange: () => undefined,
        onRunMemoryDreaming: () => undefined
      })
    );

    expect(html).toContain('aria-label="Memory dreaming"');
    expect(html).toContain('Dreaming');
    expect(html).toContain('>Dream</button>');
    expect(html).toContain('up to 100 past session transcripts');
    expect(html).toContain('reclassifies');
    expect(html).toContain('Original nodes and revisions remain stored for restoration.');
    expect(html).toContain('class="memory-type-label memory-type-primitive"');
    expect(html).toContain('class="memory-type-dot memory-type-primitive" aria-hidden="true"');
    expect(html).toContain('Hidden Nodes');
    expect(html).toContain('Restorable Changes');
    expect(html).toContain('Last Reclassified');
    expect(html).toContain('Parser mismatch');
    expect(html).toContain('2 duplicates consolidated');
    expect(html).toContain('Memory reclassified as invariant');
    expect(html).toContain('aria-label="Restore Dreaming change for Parser mismatch"');

    const profile = testResearchProfile();
    const memoryDisabledHtml = renderToStaticMarkup(
      createElement(WorkspaceUnderstandingView, {
        busy: false,
        memoryDreamingInProgress: false,
        honeycrispMemory: memory,
        researchProfile: {
          ...profile,
          capabilities: { ...profile.capabilities, memoryEnabled: false }
        },
        runCount: 2,
        scope: null,
        onOpenHoneycrispMemoryDirectory: () => undefined,
        onRestoreMemoryDreamingChange: () => undefined,
        onRunMemoryDreaming: () => undefined
      })
    );
    expect(memoryDisabledHtml).toContain('disabled="" title="Memory Dreaming is disabled by the active research profile"');
    expect(memoryDisabledHtml).toContain('Parser mismatch');
    expect(memoryDisabledHtml).toContain('aria-label="Restore Dreaming change for Parser mismatch"');

    const inProgressHtml = renderToStaticMarkup(
      createElement(WorkspaceUnderstandingView, {
        busy: true,
        memoryDreamingInProgress: true,
        honeycrispMemory: memory,
        runCount: 2,
        scope: null,
        onOpenHoneycrispMemoryDirectory: () => undefined,
        onRestoreMemoryDreamingChange: () => undefined,
        onRunMemoryDreaming: () => undefined
      })
    );
    expect(inProgressHtml).toContain('In Progress');
    expect(inProgressHtml).toContain('Dreaming…');

    const failedMemory: HoneycrispMemorySummary = {
      ...memory,
      dreaming: {
        ...memory.dreaming,
        lastRun: {
          ...memory.dreaming.lastRun!,
          status: 'failed',
          editedNodeCount: 0,
          errorMessage: 'The provider returned a temporary error.'
        }
      }
    };
    const failedHtml = renderToStaticMarkup(
      createElement(WorkspaceUnderstandingView, {
        busy: false,
        memoryDreamingInProgress: false,
        honeycrispMemory: failedMemory,
        runCount: 2,
        scope: null,
        onOpenHoneycrispMemoryDirectory: () => undefined,
        onRestoreMemoryDreamingChange: () => undefined,
        onRunMemoryDreaming: () => undefined
      })
    );
    expect(failedHtml).toContain('Last Dreaming attempt failed before applying changes');
    expect(failedHtml).toContain('The provider returned a temporary error.');
    expect(failedHtml).toContain('no changes applied');

    const subjectHtml = renderToStaticMarkup(
      createElement(WorkspaceUnderstandingView, {
        busy: false,
        memoryDreamingInProgress: false,
        honeycrispMemory: memory,
        researchSubject: {
          id: 'subject_parser',
          name: 'Parser Runtime',
          source: 'explicit',
          createdAt: '2026-07-29T10:00:00.000Z',
          updatedAt: '2026-07-29T10:00:00.000Z'
        } satisfies ResearchSubject,
        runCount: 2,
        scope: {
          id: 'scope_parser',
          status: 'active',
          workspaceName: 'Parser Research',
          scopeOwner: 'Authorization Team',
          descriptionMarkdown: '',
          rulesMarkdown: '',
          networkProfile: 'offline',
          networkPolicy: {},
          version: 2,
          activeFrom: '2026-07-29T10:00:00.000Z',
          expiresAt: null,
          createdAt: '2026-07-29T10:00:00.000Z',
          createdBy: 'local_user',
          assets: []
        } satisfies WorkspaceScopeVersion,
        onOpenHoneycrispMemoryDirectory: () => undefined,
        onRestoreMemoryDreamingChange: () => undefined,
        onRunMemoryDreaming: () => undefined
      })
    );
    expect(subjectHtml).toContain('Parser Runtime');
    expect(subjectHtml).toContain('Authorization Owner');
    expect(subjectHtml).toContain('Authorization Team');
  });
});
