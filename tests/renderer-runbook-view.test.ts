import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispRunbookDocument, HoneycrispRunbookSummary } from '../src/shared/types';
import { RunbookView, runbookViewUpdateKey } from '../src/renderer/features/research/RunbookView';

const summary: HoneycrispRunbookSummary = {
  id: 'runbook-1',
  workspaceId: 'workspace-1',
  workspaceName: 'Demo',
  subjectId: null,
  subjectName: null,
  sessionId: 'session-1',
  title: 'Validate parser boundary',
  purpose: 'Capture a repeatable validation\n  procedure with one display line.',
  status: 'active',
  artifactId: 'artifact-1',
  revision: 4,
  revisions: [],
  createdAt: '2026-07-23T10:00:00.000Z',
  updatedAt: '2026-07-23T11:00:00.000Z'
};

const document: HoneycrispRunbookDocument = {
  runbookId: summary.id,
  nbformat: 4,
  nbformatMinor: 5,
  language: 'typescript',
  revision: 4,
  latestRun: null,
  cells: [
    {
      id: 'markdown',
      type: 'markdown',
      source: '# Procedure\n\n- Build fixture\n- Run verifier',
      language: null,
      executionCount: null,
      latestRun: null,
      outputs: []
    },
    {
      id: 'code',
      type: 'code',
      source: 'const verified: boolean = true;',
      language: 'typescript',
      executionCount: 3,
      latestRun: {
        runId: 'runbook-run-3',
        status: 'succeeded',
        startedAt: '2026-07-23T10:59:58.750Z',
        completedAt: '2026-07-23T11:00:00.000Z',
        durationMs: 1250,
        exitCode: 0,
        error: null
      },
      outputs: [
        { kind: 'stream', text: 'verified\n', streamName: 'stdout', mimeType: 'text/plain' },
        { kind: 'display', text: '**Result:** pass', streamName: null, mimeType: 'text/markdown' }
      ]
    },
    {
      id: 'raw',
      type: 'raw',
      source: 'Keep this note visible.',
      language: null,
      executionCount: null,
      latestRun: null,
      outputs: []
    }
  ]
};

describe('RunbookView', () => {
  it('renders all cells, formatted Markdown, highlighted code, outputs, and Back navigation', () => {
    const html = renderToStaticMarkup(createElement(RunbookView, {
      runbook: summary,
      document,
      loading: false,
      error: null,
      onBackToMain: () => undefined
    }));

    expect(html).toContain('Back to Main');
    expect(html).toContain('<p>Capture a repeatable validation procedure with one display line.</p>');
    expect(html).toContain('<h1>Procedure</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('class="hljs language-typescript"');
    expect(html).toContain('verified');
    expect(html).toContain('<strong>Result:</strong> pass');
    expect(html).toContain('Keep this note visible.');
    expect(html).toContain('Succeeded · 1.3s');
    expect(html).toContain('aria-label="Run cell 2"');
    expect((html.match(/class="runbook-cell /g) ?? []).length).toBe(3);
  });

  it('enables whole-run and cell controls for a healthy runbook in its live session', () => {
    const executableDocument: HoneycrispRunbookDocument = {
      ...document,
      language: 'sh',
      latestRun: null,
      cells: document.cells.map((cell) => cell.id === 'code'
        ? { ...cell, language: 'sh', latestRun: null }
        : cell)
    };
    const html = renderToStaticMarkup(createElement(RunbookView, {
      runbook: summary,
      document: executableDocument,
      loading: false,
      error: null,
      executionAvailable: true,
      onRun: async () => undefined,
      onBackToMain: () => undefined
    }));

    expect(html).toContain('Healthy runbook: run cells are bounded and repeatable');
    expect(html).toContain('class="runbook-run-button"');
    expect(html).toContain('aria-label="Run cell 2"');
    expect(html).not.toContain('class="runbook-run-button" disabled=""');
  });

  it('supports embedded rendering and versions appended content for follow-to-bottom updates', () => {
    const appendedDocument: HoneycrispRunbookDocument = {
      ...document,
      cells: document.cells.map((cell, index) => index === 1
        ? { ...cell, outputs: [...cell.outputs, { kind: 'stream', text: 'new output\n', streamName: 'stdout', mimeType: 'text/plain' }] }
        : cell)
    };
    const html = renderToStaticMarkup(createElement(RunbookView, {
      runbook: summary,
      document: appendedDocument,
      loading: false,
      error: null,
      followLatest: true,
      showBackButton: false,
      onBackToMain: () => undefined
    }));

    expect(html).not.toContain('Back to Main');
    expect(html).toContain('new output');
    expect(runbookViewUpdateKey(summary, appendedDocument, false, null)).not.toBe(
      runbookViewUpdateKey(summary, document, false, null)
    );
  });
});
