import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApprovalRecord, ResearchProviderModelCatalog, RunDetail, RunStatus } from '@shared/types';
import {
  MainSteerArea,
  SHELL_SAFETY_MODE_OPTIONS,
  STEER_TEXTAREA_DEFAULT_EXTRA_LINES,
  STEER_TEXTAREA_MAX_LINES,
  TraceView
} from '../src/renderer/features/traces/TraceView';
import {
  shortSteeringSuggestion,
  steeringInputSuggestion,
  steeringInputTabAction
} from '../src/renderer/view-models/steeringSuggestions';

describe('renderer trace composer', () => {
  it('renders the trace session loading state with a spinner and no composer', () => {
    const html = renderToStaticMarkup(createElement(TraceView, {
      busy: true,
      detail: null,
      events: [],
      providerModelCatalog: providerModelCatalog(),
      selectedRunId: 'run_loading',
      traceScopeKey: 'main',
      showBackToMain: false,
      selectedTraceEventId: null,
      searchHighlightQuery: '',
      traceFilterCount: 0,
      totalTraceFilterCount: 0,
      visibleTraceCategories: [],
      onBackToMain: () => undefined,
      onOpenTraceFilters: () => undefined,
      onSelectTraceEvent: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));

    expect(html).toContain('main-trace-view is-loading');
    expect(html).toContain('class="main-session-loading"');
    expect(html).toContain('lucide-loader-circle');
    expect(html).toContain('Loading session');
    expect(html).not.toContain('Loading session.');
    expect(html).not.toContain('class="main-trace-footer"');
  });

  it('allows the steering input to grow through seven typed lines', () => {
    expect(STEER_TEXTAREA_MAX_LINES).toBe(7);
  });

  it('adds one typed row to the steering input resting height', () => {
    expect(STEER_TEXTAREA_DEFAULT_EXTRA_LINES).toBe(1);
  });

  it('replaces Send with Stop while the session is active', () => {
    const html = renderTraceComposer('active');

    expect(html).toContain('aria-label="Stop session"');
    expect(html).not.toContain('aria-label="Send steering instruction"');
    expect(html).toContain('placeholder="Steer the research"');
  });

  it('shows Send after the session is no longer active', () => {
    const html = renderTraceComposer('stopped');

    expect(html).toContain('aria-label="Send steering instruction"');
    expect(html).not.toContain('aria-label="Stop session"');
    expect(html).toContain('placeholder="Resume from the last useful result."');
  });

  it('shows a current-session continuation suggestion when the run has ended', () => {
    const html = renderTraceComposer('completed', {
      transcriptMessages: [{
        id: 'final_message',
        runId: 'run_composer',
        attemptId: 'attempt_one',
        traceEventId: 'trace_final',
        role: 'assistant',
        phase: 'final_answer',
        contentMarkdown: 'Final result.',
        source: 'honeycrisp',
        metadata: {
          nextPromptSuggestions: [{
            title: 'Validate crash',
            promptMarkdown: 'Inspect the saved crash and validate the suspected bounds check.'
          }]
        },
        createdAt: '2026-08-14T10:00:00.000Z'
      }]
    });

    expect(html).toContain('placeholder="Inspect the saved crash and validate the suspected bounds check."');
  });

  it('uses Tab to first show and then accept an input suggestion', () => {
    expect(steeringInputTabAction({
      instruction: '',
      suggestion: 'Continue from the latest findings.',
      suggestionShowing: false
    })).toBe('show_suggestion');
    expect(steeringInputTabAction({
      instruction: '',
      suggestion: 'Continue from the latest findings.',
      suggestionShowing: true
    })).toBe('accept_suggestion');
    expect(steeringInputTabAction({
      instruction: 'manual text',
      suggestion: 'Continue from the latest findings.',
      suggestionShowing: true
    })).toBe('none');
  });

  it('shows an explicit initial suggestion immediately so the first Tab accepts it', () => {
    const html = renderToStaticMarkup(createElement(MainSteerArea, {
      runId: null,
      detail: null,
      providerModelCatalog: providerModelCatalog(),
      busy: false,
      initialSuggestion: 'Review this report.',
      traceFilterCount: 0,
      totalTraceFilterCount: 0,
      showTraceFilters: false,
      onOpenTraceFilters: () => undefined,
      onInitialInstruction: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));

    expect(html).toContain('placeholder="Review this report."');
    expect(html).toContain('aria-label="Shell safety mode" aria-haspopup="listbox" aria-expanded="false"><span');
    expect(steeringInputTabAction({
      instruction: '',
      suggestion: 'Review this report.',
      suggestionShowing: true
    })).toBe('accept_suggestion');
  });

  it('keeps steering suggestions under fifteen words', () => {
    const suggestion = shortSteeringSuggestion(
      'Continue by validating the parser crash with saved artifacts and then compare adjacent bounds checks carefully.'
    );
    expect(suggestion?.split(/\s+/u).length).toBeLessThanOrEqual(14);
    expect(suggestion).toBe('Continue by validating the parser crash with saved artifacts.');
  });

  it('removes dangling conjunctions from model steering suggestions', () => {
    expect(shortSteeringSuggestion('Inspect the saved crash artifacts and.')).toBe(
      'Inspect the saved crash artifacts.'
    );
  });

  it('grounds a generic model suggestion in the latest user steering context', () => {
    const detail = composerDetail('active', {
      run: {
        ...composerDetail('active').run,
        title: 'OAuth callback validation',
        promptMarkdown: 'Review OAuth callback validation.'
      },
      transcriptMessages: [{
        id: 'steering_message',
        runId: 'run_composer',
        attemptId: 'attempt_one',
        traceEventId: 'trace_steering',
        role: 'user',
        phase: 'commentary',
        contentMarkdown: 'Investigate malformed state parameters bypassing OAuth callback validation.',
        source: 'user',
        metadata: {
          nextPromptSuggestions: [{
            title: 'Continue research',
            promptMarkdown: 'Continue from the latest findings.'
          }]
        },
        createdAt: '2026-08-15T10:00:00.000Z'
      }]
    });

    expect(steeringInputSuggestion(detail)).toBe(
      'Continue investigating malformed state parameters bypassing OAuth callback validation.'
    );
  });

  it('uses the session title when no model or steering suggestion is available', () => {
    const detail = composerDetail('paused', {
      run: {
        ...composerDetail('paused').run,
        title: 'Parser bounds-check bypass',
        promptMarkdown: 'Investigate the parser.'
      }
    });

    expect(steeringInputSuggestion(detail)).toBe(
      'Continue investigating Parser bounds-check bypass.'
    );
  });

  it('uses the completed session summary before its original objective', () => {
    const detail = composerDetail('completed', {
      run: {
        ...composerDetail('completed').run,
        title: 'Parser review',
        promptMarkdown: 'Review the request parser for memory-safety issues.',
        summary: 'The investigation confirmed that crafted length fields bypass the parser signed bounds check.'
      }
    });

    expect(steeringInputSuggestion(detail)).toBe(
      'Continue investigating crafted length fields bypass the parser signed bounds check.'
    );
  });

  it('clips long completed-session summaries at a coherent clause boundary', () => {
    const detail = composerDetail('completed', {
      run: {
        ...composerDetail('completed').run,
        title: 'Apple HTTP/2 Origin Coalescing Trust State',
        promptMarkdown: 'Characterize origin coalescing trust state.',
        finalDisposition: {
          outcome: 'objective_achieved',
          summary: 'Characterized the CFNetwork HTTP/2 ATS crossing on macOS 26.6.1 and physical iOS 26.6 across multiple pin policies.',
          blockerDependencies: [],
          externalStateRequired: false,
          source: 'agent',
          recordedAt: '2026-08-16T22:24:06.640Z'
        }
      }
    });

    expect(steeringInputSuggestion(detail)).toBe(
      'Continue investigating the CFNetwork HTTP/2 ATS crossing on macOS 26.6.1.'
    );
  });

  it('combines model and effort into one model settings picker', () => {
    const html = renderTraceComposer('stopped');
    const providerIconIndex = html.indexOf('class="model-selection-picker-provider-icon"');
    const modelNameIndex = html.indexOf('class="model-selection-picker-model"');

    expect(html).toContain('aria-label="Model settings for the next agent turn"');
    expect(providerIconIndex).toBeGreaterThanOrEqual(0);
    expect(modelNameIndex).toBeGreaterThan(providerIconIndex);
    expect(html).toContain('class="model-selection-picker-model">5.6 Sol</span>');
    expect(html).toContain('class="model-selection-picker-effort">Medium</span>');
    expect(html).not.toContain('aria-label="Model for the next agent turn"');
    expect(html).not.toContain('aria-label="Reasoning effort for the next agent turn"');
  });

  it('places the persisted shell safety picker immediately after Filters', () => {
    const html = renderTraceComposer('stopped');
    const filtersIndex = html.indexOf('aria-label="Trace filters');
    const safetyIndex = html.indexOf('aria-label="Shell safety mode"');
    const modelIndex = html.indexOf('aria-label="Model settings for the next agent turn"');

    expect(html).toContain('Auto-Review');
    expect(filtersIndex).toBeGreaterThanOrEqual(0);
    expect(safetyIndex).toBeGreaterThan(filtersIndex);
    expect(modelIndex).toBeGreaterThan(safetyIndex);
    expect(SHELL_SAFETY_MODE_OPTIONS).toEqual([
      { value: 'manual_approval', label: 'Manual Approval' },
      { value: 'auto_review', label: 'Auto-Review' },
      { value: 'danger', label: 'Danger Mode' }
    ]);
  });

  it('replaces the steering composer with an inline Auto-Review override question', () => {
    const html = renderToStaticMarkup(createElement(TraceView, {
      busy: false,
      detail: composerDetail('active'),
      events: [],
      providerModelCatalog: providerModelCatalog(),
      selectedRunId: 'run_composer',
      traceScopeKey: 'main',
      showBackToMain: false,
      selectedTraceEventId: null,
      searchHighlightQuery: '',
      shellApproval: autoReviewOverrideApproval(),
      traceFilterCount: 0,
      totalTraceFilterCount: 0,
      visibleTraceCategories: [],
      onBackToMain: () => undefined,
      onOpenTraceFilters: () => undefined,
      onSelectTraceEvent: () => undefined,
      onShellApprovalDecision: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));

    expect(html).toContain('aria-label="Approve shell command once"');
    expect(html).toContain('>Approve Once</button>');
    expect(html).not.toContain('aria-label="Steer research session"');
    expect(html).not.toContain('aria-label="Stop session"');
  });

  it('keeps trace filters out of the Commentary composer', () => {
    const html = renderToStaticMarkup(createElement(MainSteerArea, {
      busy: false,
      detail: composerDetail('stopped'),
      providerModelCatalog: providerModelCatalog(),
      runId: 'run_composer',
      showTraceFilters: false,
      traceFilterCount: 0,
      totalTraceFilterCount: 0,
      onOpenTraceFilters: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));

    expect(html).not.toContain('aria-label="Trace filters');
    expect(html).toContain('class="main-steer-input-row without-trace-filters"');
  });
});

function renderTraceComposer(status: RunStatus, detailPatch: Partial<RunDetail> = {}): string {
  return renderToStaticMarkup(createElement(TraceView, {
    busy: false,
    detail: composerDetail(status, detailPatch),
    events: [],
    providerModelCatalog: providerModelCatalog(),
    selectedRunId: 'run_composer',
    traceScopeKey: 'main',
    showBackToMain: false,
    selectedTraceEventId: null,
    searchHighlightQuery: '',
    traceFilterCount: 0,
    totalTraceFilterCount: 0,
    visibleTraceCategories: [],
    onBackToMain: () => undefined,
    onOpenTraceFilters: () => undefined,
    onSelectTraceEvent: () => undefined,
    onSessionAction: () => undefined,
    onSteerInstruction: () => undefined
  }));
}

function composerDetail(status: RunStatus, detailPatch: Partial<RunDetail> = {}): RunDetail {
  return {
    run: {
      id: 'run_composer',
      status,
      shellSafetyMode: 'auto_review',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      budget: {}
    },
    attempts: [],
    traceEvents: [],
    transcriptMessages: [],
    ...detailPatch
  } as unknown as RunDetail;
}

function autoReviewOverrideApproval(): ApprovalRecord {
  return {
    id: 'approval_auto_review_override',
    runId: 'run_composer',
    attemptId: 'attempt_one',
    requestKind: 'shell_command',
    requestedAction: {
      approvalKind: 'auto_review_override',
      mode: 'auto_review',
      reviewReason: 'The proof command needs researcher confirmation.'
    },
    decision: 'pending',
    reason: 'Waiting for the researcher to approve this Auto-Review denial once.',
    scopeAmendmentId: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    decidedAt: null
  };
}

function providerModelCatalog(): ResearchProviderModelCatalog[] {
  return [{
      providerId: 'openai-codex',
      providerName: 'OpenAI',
      models: [{
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        reasoning: true,
        effortLevels: ['low', 'medium', 'high'],
        contextWindow: 400_000,
        maxTokens: 128_000
      }]
    }];
}
