import type { ReactNode } from 'react';
import { devInstrumentation } from '../../devInstrumentation';
import type { TraceCategoryId } from '../../traceClassification';

const TRACE_MARKUP_CACHE_MAX_ENTRIES = 320;
const TRACE_MARKUP_CACHE_MAX_CHARS = 50_000;
const proseMarkupCache = new Map<string, ReactNode[]>();
const inlineMarkupCache = new Map<string, ReactNode[]>();
const pythonMarkupCache = new Map<string, ReactNode[]>();
const jsonMarkupCache = new Map<string, ReactNode[]>();

export function renderTraceProseText(text: string, category: TraceCategoryId): ReactNode[] {
  const proseCategory = category === 'agent_output' || category === 'evidence' || category === 'failure_recovery' || category === 'hypotheses' || category === 'reasoning';
  const cache = proseCategory ? proseMarkupCache : inlineMarkupCache;
  return cachedMarkup(cache, `${category}\0${text}`, () =>
    devInstrumentation.time(
      'trace.renderProseText',
      () => (proseCategory ? renderMarkdownTraceText(text) : renderInlineCodeText(text)),
      { category, chars: text.length, lines: countLines(text) }
    )
  );
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

function cachedMarkup(cache: Map<string, ReactNode[]>, key: string, create: () => ReactNode[]): ReactNode[] {
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
  const nodes: ReactNode[] = [];
  const lines = text.split('\n');

  lines.forEach((line, lineIndex) => {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      nodes.push(
        <strong className="main-trace-markdown-heading" key={`heading-${lineIndex}`}>
          {renderMarkdownInlineText(heading[1] ?? '', `heading-${lineIndex}`)}
        </strong>
      );
    } else {
      nodes.push(...renderMarkdownInlineText(line, `line-${lineIndex}`));
    }

    if (lineIndex < lines.length - 1) nodes.push(<br key={`break-${lineIndex}`} />);
  });

  return nodes.length > 0 ? nodes : [text];
}

function renderMarkdownInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = '';
  let index = 0;
  let tokenIndex = 0;

  const flushBuffer = (): void => {
    if (!buffer) return;
    nodes.push(buffer);
    buffer = '';
  };

  const pushToken = (className: string, content: string, wrapper: 'code' | 'em' | 'strong' | 'strong-em'): void => {
    flushBuffer();
    const key = `${keyPrefix}-${tokenIndex}`;
    tokenIndex += 1;
    if (wrapper === 'code') {
      nodes.push(
        <code className="main-trace-inline-code" key={key}>
          {content}
        </code>
      );
      return;
    }
    if (wrapper === 'strong-em') {
      nodes.push(
        <strong className={className} key={key}>
          <em>{content}</em>
        </strong>
      );
      return;
    }
    const Wrapper = wrapper;
    nodes.push(
      <Wrapper className={className} key={key}>
        {content}
      </Wrapper>
    );
  };

  while (index < text.length) {
    if (text[index] === '`') {
      const tickMatch = text.slice(index).match(/^`+/);
      const ticks = tickMatch?.[0] ?? '`';
      const end = text.indexOf(ticks, index + ticks.length);
      if (end > index + ticks.length) {
        pushToken('main-trace-inline-code', text.slice(index + ticks.length, end), 'code');
        index = end + ticks.length;
        continue;
      }
    }

    if (text.startsWith('***', index)) {
      const end = text.indexOf('***', index + 3);
      const content = end > index + 3 ? text.slice(index + 3, end) : '';
      if (content.trim()) {
        pushToken('main-trace-markdown-strong main-trace-markdown-em', content, 'strong-em');
        index = end + 3;
        continue;
      }
    }

    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2);
      const content = end > index + 2 ? text.slice(index + 2, end) : '';
      if (content.trim()) {
        pushToken('main-trace-markdown-strong', content, 'strong');
        index = end + 2;
        continue;
      }
    }

    if (text[index] === '*' && text[index + 1] !== '*' && text[index + 1] !== ' ') {
      const end = text.indexOf('*', index + 1);
      const content = end > index + 1 ? text.slice(index + 1, end) : '';
      if (content.trim()) {
        pushToken('main-trace-markdown-em', content, 'em');
        index = end + 1;
        continue;
      }
    }

    buffer += text[index];
    index += 1;
  }

  flushBuffer();
  return nodes.length > 0 ? nodes : [text];
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
