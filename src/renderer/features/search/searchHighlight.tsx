import { Fragment } from 'react';
import type { JSX } from 'react';

const MIN_SEARCH_TERM_CHARS = 2;

export function searchHighlightTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of query.split(/\s+/)) {
    const trimmed = term.trim();
    const normalized = trimmed.toLowerCase();
    if (normalized.length < MIN_SEARCH_TERM_CHARS || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(trimmed);
  }
  return terms;
}

export function renderSearchHighlightedText(text: string, query: string): JSX.Element[] | string {
  const terms = searchHighlightTerms(query);
  if (!terms.length) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  return parts.map((part, index) => {
    const matched = terms.some((term) => part.toLowerCase() === term.toLowerCase());
    return matched ? (
      <mark className="main-search-highlight" key={`${part}-${index}`}>
        {part}
      </mark>
    ) : (
      <Fragment key={`${part}-${index}`}>{part}</Fragment>
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
