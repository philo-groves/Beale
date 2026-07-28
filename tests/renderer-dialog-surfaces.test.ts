import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HoneycrispMemoryNodeSummary, ResearchSessionSummary, WorkspaceRegistryEntry } from '@shared/types';
import { BottomSheet, Modal } from '../src/renderer/app/Modal';
import { MemoryDetailSheet } from '../src/renderer/features/research/MemorySidePanel';
import { TranscriptSearchSheet } from '../src/renderer/features/search/TranscriptSearchSheet';
import { HamModeStartSheet } from '../src/renderer/features/sessions/HamModeStartSheet';
import { WorkspaceSessionHistorySheet } from '../src/renderer/features/workspaces/WorkspaceModals';

describe('renderer dialog surfaces', () => {
  it('renders the reusable bottom-sheet presentation with shared dialog semantics', () => {
    const html = renderToStaticMarkup(
      createElement(
        BottomSheet,
        {
          title: 'Session Summary',
          onClose: () => undefined,
          wide: true,
          children: createElement('p', null, 'Summary content')
        }
      )
    );

    expect(html).toContain('class="modal-backdrop bottom-sheet-backdrop"');
    expect(html).toContain('class="modal-panel bottom-sheet-panel wide-modal"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    expect(html).toContain('aria-label="Close Session Summary"');
    expect(html).not.toContain('class="modal-footer"');
  });

  it('keeps centered modals on the standard presentation', () => {
    const html = renderToStaticMarkup(
      createElement(
        Modal,
        {
          title: 'Search',
          footer: createElement('button', null, 'Done'),
          onClose: () => undefined,
          children: createElement('p', null, 'Search content')
        }
      )
    );

    expect(html).toContain('class="modal-backdrop"');
    expect(html).toContain('class="modal-panel"');
    expect(html).not.toContain('bottom-sheet');
  });

  it('uses bottom sheets for session history and transcript search', () => {
    const workspace: WorkspaceRegistryEntry = {
      id: 'registry_workspace',
      workspacePath: '/tmp/workspace',
      workspaceId: 'workspace_one',
      workspaceName: 'Parser Research',
      scopeOwner: 'Example Org',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      networkProfile: 'offline',
      expiresAt: null,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
      lastOpenedAt: '2026-07-28T00:00:00.000Z',
      runCount: 1,
      lastRunAt: '2026-07-28T00:00:00.000Z'
    };
    const session: ResearchSessionSummary = {
      id: 'session_one',
      registryWorkspaceId: workspace.id,
      workspacePath: workspace.workspacePath,
      workspaceId: workspace.workspaceId,
      runId: 'run_one',
      title: 'Review parser bounds',
      status: 'completed',
      runEngine: 'honeycrisp',
      mode: 'dynamic',
      promptMarkdown: 'Review parser bounds.',
      summary: 'Review complete.',
      model: 'gpt-5.6',
      reasoningEffort: 'medium',
      networkProfile: 'offline',
      sandboxProfile: 'host',
      createdAt: '2026-07-28T00:00:00.000Z',
      startedAt: '2026-07-28T00:00:00.000Z',
      endedAt: '2026-07-28T00:05:00.000Z',
      updatedAt: '2026-07-28T00:05:00.000Z'
    };
    const historyHtml = renderToStaticMarkup(
      createElement(WorkspaceSessionHistorySheet, {
        workspace,
        sessions: [session],
        selectedRunId: session.runId,
        onClose: () => undefined,
        onOpenSession: () => undefined
      })
    );
    const searchHtml = renderToStaticMarkup(
      createElement(TranscriptSearchSheet, {
        activeWorkspaceName: workspace.workspaceName,
        workspaceOpen: true,
        selectedRunId: session.runId,
        onClose: () => undefined,
        onOpenResult: () => undefined
      })
    );

    expect(historyHtml).toContain('bottom-sheet-panel');
    expect(historyHtml).toContain('Review parser bounds');
    expect(historyHtml).not.toContain('modal-footer');
    expect(searchHtml).toContain('bottom-sheet-panel');
    expect(searchHtml).toContain('Search session transcripts...');
    expect(searchHtml).not.toContain('modal-footer');
  });

  it('renders memory record details in a bottom sheet', () => {
    const node: HoneycrispMemoryNodeSummary = {
      id: 'primitive_one',
      tier: 'session',
      sessionId: 'run_one',
      workspaceId: 'workspace_one',
      workspaceName: 'Parser Research',
      subjectId: null,
      subjectName: null,
      type: 'primitive',
      title: 'Unchecked parser length',
      summary: 'The captured source multiplies a length before checking bounds.',
      body: 'Detailed parser analysis.',
      status: 'suspected',
      confidence: 0.8,
      assetIds: ['src/parser.c'],
      tags: ['parser'],
      attributes: {},
      evidenceRefs: [],
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:05:00.000Z',
      revision: 2
    };
    const html = renderToStaticMarkup(
      createElement(MemoryDetailSheet, {
        node,
        nodeById: new Map([[node.id, node]]),
        relationships: [],
        onClose: () => undefined
      })
    );

    expect(html).toContain('bottom-sheet-panel');
    expect(html).toContain('Memory Details');
    expect(html).toContain('Unchecked parser length');
    expect(html).toContain('Detailed parser analysis.');
  });

  it('renders HAM prompt guidance, reasoning status, and the streamed prompt in a bottom sheet', () => {
    const html = renderToStaticMarkup(
      createElement(HamModeStartSheet, {
        busy: false,
        hamMode: {
          enabled: true,
          phase: 'reviewing_research',
          promptGuidance: 'Favor parser boundaries.',
          startRequestedAt: '2026-07-28T10:00:00.000Z',
          activeRunId: null,
          lastHandledRunId: 'run_seed',
          lastStartedRunId: null,
          lastError: null,
          updatedAt: '2026-07-28T10:00:00.000Z'
        },
        generationUpdate: {
          workspaceId: 'workspace_one',
          requestId: 'ham_request',
          reasoningSummary: '**Extending** the strongest unresolved path.',
          promptMarkdown: '# Parser boundary\n\nEstablish one verifier-backed result.'
        },
        onClose: () => undefined,
        onStart: () => undefined
      })
    );

    expect(html).toContain('bottom-sheet-panel');
    expect(html).toContain('Prompt Guidance');
    expect(html).toContain('Go HAM');
    expect(html).toContain('ham-mode-start-button is-running');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/<textarea[^>]*disabled=""[^>]*>Favor parser boundaries\.<\/textarea>/);
    expect(html).toContain('Agent Status');
    expect(html).toContain('<strong>Extending</strong>');
    expect(html).toContain('Generated Prompt');
    expect(html).toContain('<h1>Parser boundary</h1>');
  });

  it('keeps first-session HAM guidance and Go HAM controls interactive', () => {
    const html = renderToStaticMarkup(
      createElement(HamModeStartSheet, {
        busy: false,
        hamMode: {
          enabled: false,
          phase: 'disabled',
          promptGuidance: 'Favor parser boundaries.',
          startRequestedAt: null,
          activeRunId: null,
          lastHandledRunId: null,
          lastStartedRunId: null,
          lastError: null,
          updatedAt: null
        },
        generationUpdate: null,
        onClose: () => undefined,
        onStart: () => undefined
      })
    );

    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('ham-mode-start-button is-running');
    expect(html).not.toMatch(/<textarea[^>]*disabled=/);
  });
});
