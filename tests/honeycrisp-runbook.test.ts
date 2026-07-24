import { describe, expect, it } from 'vitest';
import { parseHoneycrispRunbook } from '../src/main/honeycrispRunbook';

describe('Honeycrisp runbook parsing', () => {
  it('normalizes nbformat 4 cells and bounded text outputs for the renderer', () => {
    const document = parseHoneycrispRunbook(JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        language_info: { name: 'python' }
      },
      cells: [
        {
          id: 'intro',
          cell_type: 'markdown',
          metadata: {},
          source: ['# Triage\n', '\n', '- Reproduce\n']
        },
        {
          id: 'proof',
          cell_type: 'code',
          metadata: {},
          execution_count: 2,
          source: ['print(', '"ready"', ')\n'],
          outputs: [
            { output_type: 'stream', name: 'stdout', text: ['ready', '\n'] },
            { output_type: 'display_data', data: { 'text/markdown': ['**verified**'] } },
            { output_type: 'error', ename: 'ValueError', evalue: 'bad input', traceback: ['line one', 'line two'] }
          ]
        },
        {
          cell_type: 'raw',
          metadata: {},
          source: 'analyst note'
        }
      ]
    }), 'runbook-1');

    expect(document).toEqual({
      runbookId: 'runbook-1',
      nbformat: 4,
      nbformatMinor: 5,
      language: 'python',
      cells: [
        {
          id: 'intro',
          type: 'markdown',
          source: '# Triage\n\n- Reproduce\n',
          language: null,
          executionCount: null,
          outputs: []
        },
        {
          id: 'proof',
          type: 'code',
          source: 'print("ready")\n',
          language: 'python',
          executionCount: 2,
          outputs: [
            { kind: 'stream', text: 'ready\n', streamName: 'stdout', mimeType: 'text/plain' },
            { kind: 'display', text: '**verified**', streamName: null, mimeType: 'text/markdown' },
            { kind: 'error', text: 'line one\nline two', streamName: null, mimeType: 'text/plain' }
          ]
        },
        {
          id: 'cell-3',
          type: 'raw',
          source: 'analyst note',
          language: null,
          executionCount: null,
          outputs: []
        }
      ]
    });
  });

  it('rejects notebooks outside the supported nbformat boundary', () => {
    expect(() => parseHoneycrispRunbook('{"nbformat":3,"cells":[]}', 'legacy')).toThrow(
      'Runbook must use Jupyter nbformat 4'
    );
  });
});
