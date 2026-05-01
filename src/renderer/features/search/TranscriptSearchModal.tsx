import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { SessionTranscriptSearchResult } from '@shared/types';
import { Modal } from '../../app/Modal';
import { formatSessionDateTime, traceLabel } from '../../lib/formatting';
import { renderSearchHighlightedText } from './searchHighlight';

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_RESULT_LIMIT = 30;
const MIN_SEARCH_CHARS = 2;

export function TranscriptSearchModal({
  workspaceOpen,
  selectedRunId,
  onClose,
  onOpenResult
}: {
  workspaceOpen: boolean;
  selectedRunId: string | null;
  onClose: () => void;
  onOpenResult: (result: SessionTranscriptSearchResult, query: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SessionTranscriptSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    requestRef.current += 1;
    const requestId = requestRef.current;
    const trimmed = query.trim();
    setError(null);

    if (!workspaceOpen || trimmed.length < MIN_SEARCH_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(() => {
      window.beale
        .searchSessionTranscripts({ query: trimmed, limit: SEARCH_RESULT_LIMIT })
        .then((nextResults) => {
          if (requestRef.current === requestId) {
            setResults(nextResults);
          }
        })
        .catch((caught: unknown) => {
          if (requestRef.current === requestId) {
            setResults([]);
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        })
        .finally(() => {
          if (requestRef.current === requestId) {
            setSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, workspaceOpen]);

  const trimmed = query.trim();
  const statusText = searchStatusText({ workspaceOpen, query: trimmed, searching, error, results });

  return (
    <Modal title="Search" wide onClose={onClose} footer={<button type="button" onClick={onClose}>Done</button>}>
      <div className="transcript-search">
        <label className="transcript-search-input-row">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search session transcripts..."
            disabled={!workspaceOpen}
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching ? <Loader2 className="transcript-search-spinner" size={15} /> : null}
        </label>
        <div className="transcript-search-status">{statusText}</div>
        <div className="transcript-search-results" aria-live="polite">
          {results.map((result) => (
            <button
              type="button"
              className={`transcript-search-result ${selectedRunId === result.runId ? 'active' : ''}`}
              key={result.transcriptMessageId}
              onClick={() => onOpenResult(result, trimmed)}
            >
              <span className="transcript-search-result-meta">
                <strong>{result.sessionTitle || 'Untitled Session'}</strong>
                <small>{result.programName} • {formatSessionDateTime(result.createdAt)}</small>
              </span>
              <span className="transcript-search-result-preview">{renderSearchHighlightedText(result.contentPreview, trimmed)}</span>
              <span className="transcript-search-result-source">
                {traceLabel(result.role)} / {traceLabel(result.source)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function searchStatusText({
  workspaceOpen,
  query,
  searching,
  error,
  results
}: {
  workspaceOpen: boolean;
  query: string;
  searching: boolean;
  error: string | null;
  results: SessionTranscriptSearchResult[];
}): string {
  if (!workspaceOpen) return 'Open a research program to search its session transcripts.';
  if (error) return error;
  if (query.length < MIN_SEARCH_CHARS) return 'Type two or more characters to search transcripts.';
  if (searching) return 'Searching transcripts...';
  if (!results.length) return 'No transcript matches.';
  return `${results.length} transcript match${results.length === 1 ? '' : 'es'}.`;
}
