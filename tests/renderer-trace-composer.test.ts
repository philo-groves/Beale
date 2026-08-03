import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunDetail, RunStatus } from '@shared/types';
import {
  SHELL_SAFETY_MODE_OPTIONS,
  STEER_TEXTAREA_DEFAULT_EXTRA_LINES,
  STEER_TEXTAREA_MAX_LINES,
  TraceView
} from '../src/renderer/features/traces/TraceView';

describe('renderer trace composer', () => {
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
    expect(html).toContain('placeholder="Your move"');
  });

  it('combines model and effort into one model settings picker', () => {
    const html = renderTraceComposer('stopped');

    expect(html).toContain('aria-label="Model settings for the next agent turn"');
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
});

function renderTraceComposer(status: RunStatus): string {
  return renderToStaticMarkup(createElement(TraceView, {
    busy: false,
    detail: {
      run: {
        id: 'run_composer',
        status,
        shellSafetyMode: 'auto_review',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        budget: {}
      },
      traceEvents: []
    } as unknown as RunDetail,
    events: [],
    providerModelCatalog: [{
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
    }],
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
