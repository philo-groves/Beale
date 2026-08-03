import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HoneycrispMemoryNodeSummary, ResearchSessionSummary, RunDetail, WorkspaceRegistryEntry, WorkspaceSnapshot } from '@shared/types';
import { BottomSheet, Modal } from '../src/renderer/app/Modal';
import { MemoryDetailView } from '../src/renderer/features/research/MemorySidePanel';
import { TranscriptSearchSheet } from '../src/renderer/features/search/TranscriptSearchSheet';
import { SessionSummaryModal } from '../src/renderer/features/sessions/SessionSummaryModal';
import { ResearchGoalChooser, StartRunForm } from '../src/renderer/features/sessions/StartRunForm';
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

  it('shows three prior-research goal sentences and a fourth custom option', () => {
    const suggestions: [string, string, string] = [
      'Determine whether the parser length primitive reaches an attacker-controlled allocation sink.',
      'Close the verifier gap around cross-tenant object lookup using the existing local fixtures.',
      'Inspect the unreviewed archive import boundary for a source-to-sink path with concrete impact.'
    ];
    const html = renderToStaticMarkup(
      createElement(ResearchGoalChooser, {
        suggestions,
        loading: false,
        error: null,
        onSelect: () => undefined,
        onSomethingElse: () => undefined,
        onRetry: () => undefined
      })
    );

    expect(html.match(/aria-label="Goal \d:/g)).toHaveLength(3);
    expect(html.match(/<button/g)).toHaveLength(4);
    for (const suggestion of suggestions) expect(html).toContain(suggestion);
    expect(html).toContain('<strong>Something Else</strong>');
    expect(html).toContain('Write your own research prompt.');
  });

  it('shows goal mode enabled by default in New Research', () => {
    const suggestions: [string, string, string] = [
      'Inspect the unreviewed parser boundary.',
      'Validate the unresolved tenant-isolation path.',
      'Revisit the archive extraction sink with stronger evidence.'
    ];
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        snapshot: {
          workspace: { workspaceId: 'workspace_one' },
          activeScope: { id: 'scope_one' }
        } as WorkspaceSnapshot,
        openAiStatus: null,
        researchProviderStatuses: [],
        providerModelCatalog: [],
        researchGoalSuggestions: suggestions,
        researchGoalSuggestionsLoading: false,
        researchGoalSuggestionError: null,
        busy: false,
        runAction: async () => undefined,
        onCancel: () => undefined,
        onRetryResearchGoalSuggestions: () => undefined,
        onStarted: () => undefined
      })
    );

    expect(html).toContain('class="goal-option"');
    expect(html).toMatch(/<input type="checkbox" checked=""\/>/);
    expect(html).toContain('Keep working across turns until the objective is complete or genuinely blocked.');
    for (const suggestion of suggestions) expect(html).toContain(suggestion);
    expect(html).not.toContain('Reviewing prior research…');
    expect(html).toContain('<strong>Something Else</strong>');
    expect(html).not.toContain('<textarea');
  });

  it('shows the structured final disposition and blocker dependencies in session summaries', () => {
    const detail = {
      run: {
        id: 'run_one',
        title: 'Validate account boundary',
        promptMarkdown: 'Validate the account boundary.',
        mode: 'dynamic',
        attemptStrategy: 'iterative_research',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        networkProfile: 'scoped',
        sandboxProfile: 'host',
        finalDisposition: {
          outcome: 'blocked',
          summary: 'Validation requires an authorized second account.',
          blockerDependencies: [{ kind: 'credentials', description: 'No second test account is recorded.', requiredState: 'Provide an authorized credential reference.', external: true }],
          externalStateRequired: true,
          source: 'agent',
          recordedAt: '2026-07-31T12:00:00.000Z'
        }
      }
    } as unknown as RunDetail;
    const html = renderToStaticMarkup(createElement(SessionSummaryModal, { detail, onClose: () => undefined }));

    expect(html).toContain('Final disposition');
    expect(html).toContain('Blocked');
    expect(html).toContain('External state required');
    expect(html).toContain('Provide an authorized credential reference.');
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
      finalDisposition: null,
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
      sessionIds: ['run_one'],
      workspaces: [{ id: 'workspace_one', name: 'Parser Research' }],
      subjectId: 'subject_parser',
      subjectName: 'Parser Research',
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
      createElement(MemoryDetailView, {
        node,
        nodeById: new Map([[node.id, node]]),
        relationships: []
      })
    );

    expect(html).not.toContain('bottom-sheet-panel');
    expect(html).toContain('Unchecked parser length');
    expect(html).toContain('Detailed parser analysis.');
    expect(html).toContain('class="memory-type-label memory-type-primitive"');
    expect(html).toContain('class="memory-type-dot memory-type-primitive" aria-hidden="true"');
  });

});
