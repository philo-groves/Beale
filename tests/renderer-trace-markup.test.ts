import { describe, expect, it } from 'vitest';
import { codeBlockLineRows } from '../src/renderer/features/traces/traceMarkup';

describe('renderer trace markup helpers', () => {
  it('builds generated code block line numbers without changing code text', () => {
    expect(codeBlockLineRows(['print(1)', 'print(2)'])).toEqual({
      codeLines: ['print(1)', 'print(2)'],
      lineNumbers: ['1', '2']
    });
  });

  it('moves source-prefixed line numbers into a separate gutter model', () => {
    expect(codeBlockLineRows(['650: export function tool() {', '651:   return true;', '  continued string'], 'source-prefix')).toEqual({
      codeLines: ['export function tool() {', '  return true;', '  continued string'],
      lineNumbers: ['650', '651', '']
    });
  });
});
