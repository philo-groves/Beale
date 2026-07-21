import { describe, expect, it } from 'vitest';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeBlockLineRows, renderTraceProseText } from '../src/renderer/features/traces/traceMarkup';

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

  it('renders multiline agent Markdown with fenced language highlighting', () => {
    const markdown = ['First line', 'second line', '', '- one', '- two', '', '```sh', 'if test -f file; then', '  echo found', 'fi', '```', '', '```c', 'int main(void) {', '  return 0;', '}', '```', '', '```text', 'plain  text', '  keeps spacing', '```'].join('\n');
    const html = renderToStaticMarkup(createElement(Fragment, null, renderTraceProseText(markdown, 'agent_output')));

    expect(html).toMatch(/First line<br\/?>\s*second line/);
    expect(html).toContain('<ul>');
    expect(html).toContain('main-trace-markdown-code-language">sh</span>');
    expect(html).toContain('class="hljs language-sh"');
    expect(html).toContain('main-trace-markdown-code-language">c</span>');
    expect(html).toContain('class="hljs language-c"');
    expect(html).toContain('class="language-text"');
    expect(html).toContain('plain  text\n  keeps spacing');
  });
});
