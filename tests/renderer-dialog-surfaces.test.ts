import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HoneycrispMemoryNodeSummary, ResearchGoalSuggestionsByPhase, ResearchSessionSummary, RunDetail, WorkspaceRegistryEntry, WorkspaceSnapshot } from '@shared/types';
import { BottomSheet, Modal } from '../src/renderer/app/Modal';
import { MemoryDetailView } from '../src/renderer/features/research/MemorySidePanel';
import { TranscriptSearchSheet } from '../src/renderer/features/search/TranscriptSearchSheet';
import { SessionSummaryModal } from '../src/renderer/features/sessions/SessionSummaryModal';
import { ResearchGoalChooser, StartRunForm } from '../src/renderer/features/sessions/StartRunForm';
import { SessionNextSteps, SessionNextStepsWidget } from '../src/renderer/features/sessions/SessionNextSteps';
import { WorkspaceSessionHistorySheet } from '../src/renderer/features/workspaces/WorkspaceModals';
import { WorkspaceOnboardingModal } from '../src/renderer/features/workspaces/WorkspaceOnboardingModal';
import { onboardingFormFromDefaults } from '../src/renderer/view-models/workspaceOnboarding';

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

  it('hides cybersecurity workspace autofill controls for Mathematics', () => {
    const form = onboardingFormFromDefaults({
      workspacePath: '/math/erdos-straus',
      workspaceName: 'Erdos-Straus Conjecture',
      scopeOwner: '',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      expiresAt: null,
      assets: []
    });
    const render = (researchProfileId: 'security-research' | 'mathematics'): string => renderToStaticMarkup(
      createElement(WorkspaceOnboardingModal, {
        form,
        researchProfileId,
        busy: false,
        progress: null,
        onChange: () => undefined,
        onCancel: () => undefined,
        onLookupHackerOne: async () => undefined,
        onSkipRepository: async () => undefined,
        onTemplate: () => undefined,
        onSubmit: () => undefined
      })
    );

    const securityHtml = render('security-research');
    const mathematicsHtml = render('mathematics');
    expect(securityHtml).toContain('aria-label="Workspace template"');
    expect(securityHtml).toContain('>HackerOne</button>');
    expect(securityHtml).toContain('>Apple</button>');
    expect(securityHtml).toContain('>MSRC</button>');
    expect(mathematicsHtml).not.toContain('aria-label="Workspace template"');
    expect(mathematicsHtml).not.toContain('>HackerOne</button>');
    expect(mathematicsHtml).not.toContain('>Apple</button>');
    expect(mathematicsHtml).not.toContain('>MSRC</button>');
  });

  it('shows one lazily selected suggestion workflow at a time', () => {
    const suggestions = phaseSuggestions();
    const html = renderToStaticMarkup(
      createElement(ResearchGoalChooser, {
        suggestions,
        loading: phaseValues(false),
        errors: phaseValues(null),
        onSelect: () => undefined,
        onRetry: () => undefined
      })
    );

    expect(html.match(/aria-label="Discovery goal \d:/g)).toHaveLength(4);
    expect(html).not.toMatch(/aria-label="Chaining goal \d:/);
    expect(html).not.toMatch(/aria-label="Reporting goal \d:/);
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain('role="tab" aria-selected="true" class="selected">Discovery</button>');
    for (const suggestion of suggestions.discovery ?? []) expect(html).toContain(suggestion);
    for (const suggestion of [...(suggestions.chaining ?? []), ...(suggestions.reporting ?? [])]) expect(html).not.toContain(suggestion);
  });

  it('shows goal mode enabled by default in New Research', () => {
    const suggestions = phaseSuggestions();
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        snapshot: {
          workspace: { workspaceId: 'workspace_one' },
          activeScope: { id: 'scope_one' }
        } as WorkspaceSnapshot,
        openAiStatus: null,
        defaultProviderId: 'openai-codex',
        providerModelDefaults: {},
        researchProviderStatuses: [],
        providerModelCatalog: [],
        researchGoalSuggestions: suggestions,
        researchGoalSuggestionsLoading: phaseValues(false),
        researchGoalSuggestionErrors: phaseValues(null),
        busy: false,
        runAction: async () => undefined,
        onCancel: () => undefined,
        onRetryResearchGoalSuggestions: () => undefined,
        onStarted: () => undefined
      })
    );

    expect(html).toContain('class="new-research-goal-toggle"');
    expect(html).toContain('class="new-research-generate-toggle"');
    expect(html).toMatch(/<input type="checkbox" checked=""\/>/);
    expect(html).toContain('<span>Goal</span>');
    expect(html).toContain('<span>Generate</span>');
    expect(html).toContain('aria-label="Shell safety mode"');
    expect(html).toContain('Auto-Review');
    expect(html).toContain('aria-label="Research workflow"');
    expect(html).toContain('aria-label="Lead model settings"');
    expect(html).toContain('class="research-model-squircle research-lead-model-picker model-selection-picker');
    expect(html).toContain('aria-label="Add collaborator"');
    expect(html).not.toContain('research-collaborator-squircle');
    expect(html).toContain('>Generate</button>');
    expect(html).toContain('>Generate &amp; Start</button>');
    expect(html).not.toContain('new-research-send');
    expect(html).not.toContain('<label>Network');
    for (const suggestion of suggestions.discovery ?? []) expect(html).toContain(suggestion);
    for (const suggestion of [...(suggestions.chaining ?? []), ...(suggestions.reporting ?? [])]) expect(html).not.toContain(suggestion);
    expect(html).not.toContain('Reviewing prior research…');
    expect(html).toContain('aria-label="Research goal"');
    expect(html).toContain('class="new-research-compose-layout"');
    expect(html).toContain('class="modal-panel bottom-sheet-panel wide-modal start-run-sheet"');
  });

  it('keeps the terminal-session next-step widget structurally stable while suggestions load', () => {
    const render = (loading: boolean, suggestions: string[]): string => renderToStaticMarkup(
      createElement(SessionNextStepsWidget, {
        loading,
        suggestions,
        error: null,
        onRetry: () => undefined,
        onSelect: () => undefined
      })
    );
    const loadingHtml = render(true, []);
    const loadedHtml = render(false, [
      'Verify the strongest unresolved boundary from the completed session.',
      'Generalize the session result to the nearest related research case.',
      'Stress-test the key conclusion against a materially different construction.'
    ]);

    expect(loadingHtml).toContain('class="session-next-steps"');
    expect(loadingHtml.match(/class="session-next-step-skeleton"/g)).toHaveLength(3);
    expect(loadedHtml).toContain('class="session-next-steps"');
    expect(loadedHtml.match(/class="session-next-step-button"/g)).toHaveLength(3);
  });

  it('renders persisted session next steps immediately without a loading state', () => {
    const suggestions = [
      'Verify the strongest unresolved boundary from the completed session.',
      'Generalize the session result to the nearest related research case.',
      'Stress-test the key conclusion against a materially different construction.'
    ];
    const detail = {
      run: {
        id: 'run_complete',
        endedAt: '2026-08-12T12:00:00.000Z',
        summary: 'Completed bounded research.',
        finalDisposition: null,
        budget: { researchWorkflowId: 'discovery' }
      },
      nextStepSuggestions: { phase: 'discovery', suggestions }
    } as unknown as RunDetail;

    const html = renderToStaticMarkup(createElement(SessionNextSteps, {
      detail,
      onSelect: () => undefined
    }));

    expect(html).toContain('aria-busy="false"');
    expect(html.match(/class="session-next-step-button"/g)).toHaveLength(3);
    expect(html).not.toContain('session-next-step-skeleton');
    for (const suggestion of suggestions) expect(html).toContain(suggestion);
  });

  it('seeds the shared New Research composer from a session suggestion', () => {
    const sentence = 'Verify the strongest unresolved boundary from the completed session.';
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        snapshot: {
          workspace: { workspaceId: 'workspace_one' },
          activeScope: { id: 'scope_one' }
        } as WorkspaceSnapshot,
        openAiStatus: null,
        defaultProviderId: 'openai-codex',
        providerModelDefaults: {},
        researchProviderStatuses: [],
        providerModelCatalog: [],
        researchGoalSuggestions: phaseSuggestions(),
        researchGoalSuggestionsLoading: phaseValues(false),
        researchGoalSuggestionErrors: phaseValues(null),
        initialGoal: { sentence, phase: 'discovery' },
        busy: false,
        runAction: async () => undefined,
        onCancel: () => undefined,
        onRetryResearchGoalSuggestions: () => undefined,
        onStarted: () => undefined
      })
    );

    expect(html).toContain(sentence);
    expect(html).toContain('aria-label="Research goal"');
    expect(html).toContain('>Generate &amp; Start</button>');
    expect(html).toContain('aria-label="Research suggestions"');
    expect(html).not.toContain('Discovery suggestions');
    expect(html).toContain('research-goal-choice-scroll');
    expect(html).not.toContain('Choose another goal');
  });

  it('shows only the selected workflow error while other workflow state stays hidden', () => {
    const suggestions = phaseSuggestions();
    const html = renderToStaticMarkup(
      createElement(ResearchGoalChooser, {
        suggestions: { discovery: suggestions.discovery },
        loading: { discovery: false, chaining: false, reporting: true },
        errors: { discovery: null, chaining: 'Chaining request failed.', reporting: null },
        selectedWorkflowId: 'chaining',
        onSelect: () => undefined,
        onRetry: () => undefined
      })
    );

    expect(html).not.toMatch(/aria-label="Discovery goal \d:/);
    expect(html).toContain('Could not load chaining goals');
    expect(html).toContain('Chaining request failed.');
    expect(html).not.toContain('research-goal-choice-loading');
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

function phaseSuggestions(): ResearchGoalSuggestionsByPhase {
  return {
    discovery: [
      'Research parser allocation boundaries for integer-overflow vulnerabilities.',
      'Explore archive extraction for path-confusion vulnerabilities.',
      'Examine workspace ownership for authorization vulnerabilities.',
      'Research metadata decoding for memory-safety vulnerabilities.'
    ],
    chaining: [
      'Upgrade the parser primitive into a reportable chain with a triage-ready PoC.',
      'Develop the archive primitive into a reachable chain with a triage-ready PoC.',
      'Connect the ownership primitive to impact in a chain with a triage-ready PoC.',
      'Close the metadata primitive chain gaps and produce a triage-ready PoC.'
    ],
    reporting: [
      'Report the parser chain with its bugs, impact, triage-ready PoC, and submission.zip.',
      'Document the archive chain with its bugs, impact, triage-ready PoC, and submission.zip.',
      'Report the ownership chain with its bugs, impact, triage-ready PoC, and submission.zip.',
      'Document the metadata chain with its bugs, impact, triage-ready PoC, and submission.zip.'
    ]
  };
}

function phaseValues<T>(value: T): { discovery: T; chaining: T; reporting: T } {
  return { discovery: value, chaining: value, reporting: value };
}
