import { describe, expect, it } from 'vitest';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeBlockLineRows, normalizeTraceMathDelimiters, renderTraceProseText } from '../src/renderer/features/traces/traceMarkup';

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

  it('renders inline and display mathematics while preserving code notation', () => {
    const markdown = [
      String.raw`For \(n\ge 2\), let $E(n)$ denote the property.`,
      '',
      String.raw`\[`,
      String.raw`\frac{4}{n}=\frac{1}{x}+\frac{1}{y}+\frac{1}{z}.`,
      String.raw`\]`,
      '',
      'Keep `\\(literal\\)` and:',
      '',
      '```text',
      String.raw`\[not mathematics\]`,
      '```'
    ].join('\n');
    const normalized = normalizeTraceMathDelimiters(markdown);
    const html = renderToStaticMarkup(createElement(Fragment, null, renderTraceProseText(markdown, 'agent_output')));

    expect(normalized).toContain('For $n\\ge 2$, let $E(n)$');
    expect(normalized).toContain('$$\n\\frac{4}{n}=');
    expect(normalized).toContain('`\\(literal\\)`');
    expect(normalized).toContain('\\[not mathematics\\]');
    expect(html.match(/class="katex"/g)).toHaveLength(3);
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('<annotation encoding="application/x-tex">n\\ge 2</annotation>');
    expect(html).toContain('<code class="main-trace-inline-code">\\(literal\\)</code>');
    expect(html).toContain('\\[not mathematics\\]');
  });
});
