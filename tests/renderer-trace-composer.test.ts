import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunDetail, RunStatus } from '@shared/types';
import { TraceView } from '../src/renderer/features/traces/TraceView';

describe('renderer trace composer', () => {
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
    expect(html).toContain('placeholder="Your move"');
  });
});

function renderTraceComposer(status: RunStatus): string {
  return renderToStaticMarkup(createElement(TraceView, {
    busy: false,
    detail: {
      run: {
        id: 'run_composer',
        status,
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        budget: {}
      },
      traceEvents: []
    } as unknown as RunDetail,
    events: [],
    providerModelCatalog: [],
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
