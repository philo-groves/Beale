import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { SessionTranscriptSearchResponse, SessionTranscriptSearchResult } from '@shared/types';
import { Modal } from '../../app/Modal';
import { formatSessionDateTime } from '../../lib/formatting';
import { renderSearchHighlightedText } from './searchHighlight';

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_RESULT_PAGE_SIZE = 25;
const MIN_SEARCH_CHARS = 2;

export function TranscriptSearchModal({
  activeProgramName,
  workspaceOpen,
  selectedRunId,
  onClose,
  onOpenResult
}: {
  activeProgramName: string;
  workspaceOpen: boolean;
  selectedRunId: string | null;
  onClose: () => void;
  onOpenResult: (result: SessionTranscriptSearchResult, query: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [searchResponse, setSearchResponse] = useState<SessionTranscriptSearchResponse>(emptySearchResponse());
  const [currentProgramOnly, setCurrentProgramOnly] = useState(true);
  const [searchLimit, setSearchLimit] = useState(SEARCH_RESULT_PAGE_SIZE);
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
      setSearchResponse(emptySearchResponse());
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(() => {
      window.beale
        .searchSessionTranscripts({ query: trimmed, limit: searchLimit, currentProgramOnly })
        .then((nextResponse) => {
          if (requestRef.current === requestId) {
            setSearchResponse(nextResponse);
          }
        })
        .catch((caught: unknown) => {
          if (requestRef.current === requestId) {
            setSearchResponse(emptySearchResponse());
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
  }, [currentProgramOnly, query, searchLimit, workspaceOpen]);

  const trimmed = query.trim();
  const groupedResults = groupSearchResults(searchResponse);
  const statusText = searchStatusText({
    workspaceOpen,
    query: trimmed,
    searching,
    error,
    totalTranscriptMatches: searchResponse.totalTranscriptMatches,
    programCount: searchResponse.programCount
  });
  const showMoreResults = (): void => {
    setSearchLimit((currentLimit) => currentLimit + SEARCH_RESULT_PAGE_SIZE);
  };

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
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchLimit(SEARCH_RESULT_PAGE_SIZE);
              setSearchResponse(emptySearchResponse());
            }}
          />
          {searching ? <Loader2 className="transcript-search-spinner" size={15} /> : null}
        </label>
        <label className="transcript-search-scope">
          <input
            type="checkbox"
            checked={currentProgramOnly}
            disabled={!workspaceOpen}
            onChange={(event) => {
              setCurrentProgramOnly(event.target.checked);
              setSearchLimit(SEARCH_RESULT_PAGE_SIZE);
              setSearchResponse(emptySearchResponse());
            }}
          />
          <span>Only show results for {activeProgramName}</span>
        </label>
        <div className="transcript-search-status">{statusText}</div>
        <div className="transcript-search-results" aria-live="polite">
          {groupedResults.map((group) => (
            <section className="transcript-search-result-group" key={group.key} aria-label={`${group.programName} search results`}>
              <div className="transcript-search-group-heading">
                <h3>{group.programName}</h3>
                <span>{group.totalTranscriptMatches} {group.totalTranscriptMatches === 1 ? 'RESULT' : 'RESULTS'}</span>
              </div>
              <div className="transcript-search-result-list">
                {group.results.map((result) => (
                  <button
                    type="button"
                    className={`transcript-search-result ${selectedRunId === result.runId ? 'active' : ''}`}
                    key={result.transcriptMessageId}
                    onClick={() => onOpenResult(result, trimmed)}
                  >
                    <span className="transcript-search-result-meta">
                      <strong>{result.sessionTitle || 'Untitled Session'}</strong>
                      <time dateTime={result.createdAt}>{formatSessionDateTime(result.createdAt)}</time>
                    </span>
                    <span className="transcript-search-result-preview">{renderSearchHighlightedText(result.contentPreview, trimmed)}</span>
                  </button>
                ))}
                {group.results.length < group.totalTranscriptMatches ? (
                  <button type="button" className="transcript-search-show-more" disabled={searching} onClick={showMoreResults}>
                    Show More
                  </button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function groupSearchResults(
  response: SessionTranscriptSearchResponse
): Array<{ key: string; programName: string; totalTranscriptMatches: number; results: SessionTranscriptSearchResult[] }> {
  const groups = new Map<string, { key: string; programName: string; totalTranscriptMatches: number; results: SessionTranscriptSearchResult[] }>();
  for (const program of response.programs) {
    const key = searchProgramKey(program.programId, program.workspacePath);
    groups.set(key, {
      key,
      programName: program.programName || 'Unknown Program',
      totalTranscriptMatches: program.totalTranscriptMatches,
      results: []
    });
  }
  for (const result of response.results) {
    const key = searchProgramKey(result.programId, result.workspacePath);
    const existing = groups.get(key);
    if (existing) {
      existing.results.push(result);
      continue;
    }
    groups.set(key, {
      key,
      programName: result.programName || 'Unknown Program',
      totalTranscriptMatches: 1,
      results: [result]
    });
  }
  return [...groups.values()].filter((group) => group.results.length > 0);
}

function searchProgramKey(programId: string | null, workspacePath: string): string {
  return programId ?? workspacePath;
}

function emptySearchResponse(): SessionTranscriptSearchResponse {
  return {
    results: [],
    totalTranscriptMatches: 0,
    programCount: 0,
    programs: []
  };
}

function searchStatusText({
  workspaceOpen,
  query,
  searching,
  error,
  totalTranscriptMatches,
  programCount
}: {
  workspaceOpen: boolean;
  query: string;
  searching: boolean;
  error: string | null;
  totalTranscriptMatches: number;
  programCount: number;
}): string {
  if (!workspaceOpen) return 'Open a research program to search its session transcripts.';
  if (error) return error;
  if (query.length < MIN_SEARCH_CHARS) return 'Type two or more characters to search transcripts.';
  if (searching) return 'Searching transcripts...';
  if (!totalTranscriptMatches) return 'No transcript matches.';
  return `${totalTranscriptMatches} transcript match${totalTranscriptMatches === 1 ? '' : 'es'} in ${programCount} program${programCount === 1 ? '' : 's'}`;
}
