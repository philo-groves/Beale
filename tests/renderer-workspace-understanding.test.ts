import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispMemorySummary } from '../src/shared/types';
import { WorkspaceUnderstandingView } from '../src/renderer/features/workspaces/WorkspaceUnderstandingView';

describe('WorkspaceUnderstandingView Dreaming controls', () => {
  it('shows reversible cleanup metrics and recent changes on the workspace dashboard', () => {
    const memory = {
      status: 'ready',
      source: 'honeycrisp_sqlite',
      contextWorkspaceId: 'workspace_security',
      contextSubjectId: null,
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
      nodeTierCounts: { workspace: 8 },
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
          editedNodeCount: 1,
          createdAt: '2026-07-29T11:00:00.000Z',
          completedAt: '2026-07-29T11:00:00.000Z',
          restoredAt: null
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
          }
        ]
      }
    } satisfies HoneycrispMemorySummary;

    const html = renderToStaticMarkup(
      createElement(WorkspaceUnderstandingView, {
        busy: false,
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
    expect(html).toContain('Original nodes and revisions remain stored for restoration.');
    expect(html).toContain('Hidden Nodes');
    expect(html).toContain('Restorable Changes');
    expect(html).toContain('Parser mismatch');
    expect(html).toContain('2 duplicates consolidated');
    expect(html).toContain('aria-label="Restore Dreaming change for Parser mismatch"');
  });
});
