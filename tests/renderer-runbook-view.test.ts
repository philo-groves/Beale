import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispRunbookDocument, HoneycrispRunbookSummary } from '../src/shared/types';
import { RunbookView } from '../src/renderer/features/research/RunbookView';

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
  createdAt: '2026-07-23T10:00:00.000Z',
  updatedAt: '2026-07-23T11:00:00.000Z'
};

const document: HoneycrispRunbookDocument = {
  runbookId: summary.id,
  nbformat: 4,
  nbformatMinor: 5,
  language: 'typescript',
  cells: [
    {
      id: 'markdown',
      type: 'markdown',
      source: '# Procedure\n\n- Build fixture\n- Run verifier',
      language: null,
      executionCount: null,
      outputs: []
    },
    {
      id: 'code',
      type: 'code',
      source: 'const verified: boolean = true;',
      language: 'typescript',
      executionCount: 3,
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
    expect((html.match(/class="runbook-cell /g) ?? []).length).toBe(3);
  });
});
