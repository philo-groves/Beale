import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components, Options as ReactMarkdownOptions } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { devInstrumentation } from '../../devInstrumentation';
import type { TraceCategoryId } from '../../traceClassification';

const TRACE_MARKUP_CACHE_MAX_ENTRIES = 320;
const TRACE_MARKUP_CACHE_MAX_CHARS = 50_000;
const proseMarkupCache = new Map<string, ReactNode>();
const inlineMarkupCache = new Map<string, ReactNode[]>();
const pythonMarkupCache = new Map<string, ReactNode[]>();
const jsonMarkupCache = new Map<string, ReactNode[]>();
const TRACE_MARKDOWN_REMARK_PLUGINS: NonNullable<ReactMarkdownOptions['remarkPlugins']> = [remarkGfm, remarkMath, remarkBreaks];
const TRACE_MARKDOWN_REHYPE_PLUGINS: NonNullable<ReactMarkdownOptions['rehypePlugins']> = [
  [rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false }],
  [rehypeHighlight, { detect: false, plainText: ['text', 'txt', 'plaintext'] }]
];
const TRACE_MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, children, ...props }) => (
    <a {...props} rel="noreferrer" target="_blank" onClick={(event) => event.stopPropagation()}>
      {children}
    </a>
  ),
  code: ({ node: _node, className, children, ...props }) => {
    const fenced = Boolean(className?.split(/\s+/).some((value) => value === 'hljs' || value.startsWith('language-')));
    return (
      <code {...props} className={fenced ? className : ['main-trace-inline-code', className].filter(Boolean).join(' ')}>
        {children}
      </code>
    );
  },
  img: ({ node: _node, alt }) => <span className="main-trace-markdown-image-label">{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
  pre: ({ node: _node, children, ...props }) => {
    const codeElement = Children.toArray(children).find((child) => isValidElement<{ className?: string }>(child));
    const codeClassName = isValidElement<{ className?: string }>(codeElement) ? codeElement.props.className ?? '' : '';
    const language = codeClassName.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? null;
    return (
      <div className="main-trace-markdown-code-block">
        {language ? <span className="main-trace-markdown-code-language">{language}</span> : null}
        <pre {...props}>{children}</pre>
      </div>
    );
  }
};

export type CodeBlockLineNumberMode = 'generated' | 'source-prefix';

export interface CodeBlockLineRows {
  codeLines: string[];
  lineNumbers: string[];
}

export function renderTraceProseText(text: string, category: TraceCategoryId): ReactNode {
  const proseCategory = category === 'agent_output' || category === 'artifacts' || category === 'failure_recovery' || category === 'research' || category === 'reasoning';
  const cache = proseCategory ? proseMarkupCache : inlineMarkupCache;
  return cachedMarkup(cache, `${category}\0${text}`, () =>
    devInstrumentation.time(
      'trace.renderProseText',
      () => (proseCategory ? renderMarkdownTraceText(text) : renderInlineCodeText(text)),
      { category, chars: text.length, lines: countLines(text) }
    )
  );
}

export function renderHighlightedCodeBlock(code: string, language: string | null): ReactNode {
  const normalizedLanguage = language && /^[a-zA-Z0-9_+.-]+$/.test(language) ? language : 'text';
  const longestBacktickRun = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return renderMarkdownTraceText(`${fence}${normalizedLanguage}\n${code}\n${fence}`);
}

export function renderInlineCodeText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`+)([^`\n]+?)\1/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const codeText = match[2] ?? '';
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    nodes.push(
      <code className="main-trace-inline-code" key={`${index}-${codeText}`}>
        {codeText}
      </code>
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length > 0 ? nodes : [text];
}

export function highlightPythonCode(code: string): ReactNode[] {
  return cachedMarkup(pythonMarkupCache, code, () =>
    devInstrumentation.time(
      'syntax.python',
      () =>
        highlightCode(
          code,
          /([rRuUbBfF]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|#[^\n]*|\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b|\b(?:abs|all|any|bool|dict|enumerate|filter|float|int|len|list|map|max|min|open|print|range|set|sorted|str|sum|tuple|type|zip)\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[()[\]{}.,:;=+\-*/%<>!&|^~@]+)/g,
          pythonTokenKind
        ),
      { chars: code.length, lines: countLines(code) }
    )
  );
}

export function highlightJsonCode(code: string): ReactNode[] {
  return cachedMarkup(jsonMarkupCache, code, () =>
    devInstrumentation.time(
      'syntax.json',
      () => highlightCode(code, new RegExp('("(?:\\\\.|[^"\\\\])*")(\\s*:)?|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|\\b(?:true|false|null)\\b|[{}\\[\\],:]', 'g'), jsonTokenKind),
      { chars: code.length, lines: countLines(code) }
    )
  );
}

export function codeBlockLineRows(lines: string[], mode: CodeBlockLineNumberMode = 'generated'): CodeBlockLineRows {
  if (mode === 'source-prefix') {
    return lines.reduce<CodeBlockLineRows>(
      (rows, line, index) => {
        const match = line.match(/^\s*(\d+)(?::|\|)\s?(.*)$/);
        rows.lineNumbers.push(match?.[1] ?? '');
        rows.codeLines.push(match?.[2] ?? line);
        return rows;
      },
      { codeLines: [], lineNumbers: [] }
    );
  }

  return {
    codeLines: lines,
    lineNumbers: lines.map((_, index) => String(index + 1))
  };
}

function cachedMarkup<T>(cache: Map<string, T>, key: string, create: () => T): T {
  if (key.length > TRACE_MARKUP_CACHE_MAX_CHARS) return create();
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const nodes = create();
  cache.set(key, nodes);
  while (cache.size > TRACE_MARKUP_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return nodes;
}

function renderMarkdownTraceText(text: string): ReactNode[] {
  return [
    <div className="main-trace-markdown" key="markdown">
      <ReactMarkdown components={TRACE_MARKDOWN_COMPONENTS} rehypePlugins={TRACE_MARKDOWN_REHYPE_PLUGINS} remarkPlugins={TRACE_MARKDOWN_REMARK_PLUGINS} skipHtml>
        {normalizeTraceMathDelimiters(text)}
      </ReactMarkdown>
    </div>
  ];
}

export function normalizeTraceMathDelimiters(text: string): string {
  let fencedCode: { marker: '`' | '~'; length: number } | null = null;
  let inlineCodeTicks = 0;
  return text
    .split('\n')
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const fence = fenceMatch[1] ?? '';
        const marker = fence[0] as '`' | '~';
        if (!fencedCode) fencedCode = { marker, length: fence.length };
        else if (fencedCode.marker === marker && fence.length >= fencedCode.length) fencedCode = null;
        return line;
      }
      if (fencedCode) return line;

      let normalized = '';
      for (let index = 0; index < line.length;) {
        if (line[index] === '`') {
          let end = index + 1;
          while (line[end] === '`') end += 1;
          const ticks = end - index;
          if (inlineCodeTicks === 0) inlineCodeTicks = ticks;
          else if (inlineCodeTicks === ticks) inlineCodeTicks = 0;
          normalized += line.slice(index, end);
          index = end;
          continue;
        }
        const delimiter = line.slice(index, index + 2);
        if (inlineCodeTicks === 0 && line[index - 1] !== '\\') {
          if (delimiter === '\\(' || delimiter === '\\)') {
            normalized += '$';
            index += 2;
            continue;
          }
          if (delimiter === '\\[' || delimiter === '\\]') {
            normalized += '$$';
            index += 2;
            continue;
          }
        }
        normalized += line[index];
        index += 1;
      }
      return normalized;
    })
    .join('\n');
}

function highlightCode(code: string, pattern: RegExp, tokenKind: (token: string) => string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;

  for (const match of code.matchAll(pattern)) {
    const token = match[0];
    const tokenIndex = match.index ?? 0;
    if (tokenIndex > lastIndex) nodes.push(code.slice(lastIndex, tokenIndex));

    if (match[2] && token.endsWith(match[2])) {
      const value = token.slice(0, token.length - match[2].length);
      nodes.push(
        <span className={`syntax-token ${tokenKind(token)}`} key={`token-${index}`}>
          {value}
        </span>
      );
      nodes.push(
        <span className="syntax-token punctuation" key={`token-${index}-separator`}>
          {match[2]}
        </span>
      );
    } else {
      nodes.push(
        <span className={`syntax-token ${tokenKind(token)}`} key={`token-${index}`}>
          {token}
        </span>
      );
    }

    lastIndex = tokenIndex + token.length;
    index += 1;
  }

  if (lastIndex < code.length) nodes.push(code.slice(lastIndex));
  return nodes.length > 0 ? nodes : [code];
}

function pythonTokenKind(token: string): string {
  if (token.startsWith('#')) return 'comment';
  if (/^[rRuUbBfF]{0,2}("""|'''|"|')/.test(token)) return 'string';
  if (/^(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)$/.test(token)) {
    return 'keyword';
  }
  if (/^(abs|all|any|bool|dict|enumerate|filter|float|int|len|list|map|max|min|open|print|range|set|sorted|str|sum|tuple|type|zip)$/.test(token)) return 'builtin';
  if (/^\d/.test(token)) return 'number';
  if ([...token].every((char) => '()[]{}.,:;'.includes(char))) return 'punctuation';
  return 'operator';
}

function jsonTokenKind(token: string): string {
  if (token.endsWith(':') && token.startsWith('"')) return 'key';
  if (token.startsWith('"')) return 'string';
  if (token === 'true' || token === 'false') return 'boolean';
  if (token === 'null') return 'null';
  if (/^-?\d/.test(token)) return 'number';
  return 'punctuation';
}

function countLines(value: string): number {
  if (!value) return 0;
  return value.split('\n').length;
}
