import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, BookOpen, CircleAlert, LoaderCircle } from 'lucide-react';
import type {
  HoneycrispRunbookCell,
  HoneycrispRunbookDocument,
  HoneycrispRunbookOutput,
  HoneycrispRunbookSummary
} from '@shared/types';
import { traceLabel } from '../../lib/formatting';
import { runbookDescriptionText } from '../../view-models/runbooks';
import { renderHighlightedCodeBlock, renderTraceProseText } from '../traces/traceMarkup';

export const RunbookView = memo(function RunbookView({
  runbook,
  document,
  loading,
  error,
  onBackToMain,
  showBackButton = true,
  followLatest = false
}: {
  runbook: HoneycrispRunbookSummary;
  document: HoneycrispRunbookDocument | null;
  loading: boolean;
  error: string | null;
  onBackToMain: () => void;
  showBackButton?: boolean;
  followLatest?: boolean;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const runbookIdRef = useRef(runbook.id);
  const updateKey = useMemo(
    () => runbookViewUpdateKey(runbook, document, loading, error),
    [document, error, loading, runbook]
  );

  const scrollToLatest = useCallback((): void => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  }, []);

  const syncScroll = useCallback((): void => {
    if (followLatest && followLatestRef.current) scrollToLatest();
  }, [followLatest, scrollToLatest]);

  useLayoutEffect(() => {
    if (runbookIdRef.current !== runbook.id) {
      runbookIdRef.current = runbook.id;
      followLatestRef.current = true;
    }
    const frame = window.requestAnimationFrame(syncScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [runbook.id, syncScroll, updateKey]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(syncScroll);
    observer.observe(scroll);
    Array.from(scroll.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [syncScroll, updateKey]);

  const handleScroll = useCallback((): void => {
    const scroll = scrollRef.current;
    if (!followLatest || !scroll) return;
    const distanceFromBottom = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
    followLatestRef.current = distanceFromBottom <= 24;
  }, [followLatest]);

  return (
    <section className="main-trace-view runbook-view" aria-label={`Runbook: ${runbook.title}`}>
      {showBackButton ? (
        <button type="button" className="back-to-main-button trace-back-to-main-button" onClick={onBackToMain}>
          <ArrowLeft size={15} aria-hidden="true" />
          Back to Main
        </button>
      ) : null}
      <div className="runbook-view-scroll" ref={scrollRef} onScroll={handleScroll}>
        <header className="runbook-view-header">
          <span className="runbook-view-eyebrow"><BookOpen size={15} aria-hidden="true" /> Runbook</span>
          <h2>{runbook.title}</h2>
          {runbook.purpose ? <p>{runbookDescriptionText(runbook.purpose)}</p> : null}
          <div className="runbook-view-meta">
            <span>{traceLabel(runbook.status)}</span>
            <span>Update {runbook.revision}</span>
            {document?.language ? <span>{document.language}</span> : null}
          </div>
        </header>

        {loading ? (
          <div className="runbook-view-state"><LoaderCircle className="runbook-view-spinner" size={18} aria-hidden="true" /> Loading runbook.</div>
        ) : error ? (
          <div className="runbook-view-state is-error"><CircleAlert size={18} aria-hidden="true" /> {error}</div>
        ) : document && document.cells.length > 0 ? (
          <div className="runbook-cell-list">
            {document.cells.map((cell, index) => <RunbookCellView cell={cell} index={index} key={`${cell.id}:${index}`} />)}
          </div>
        ) : (
          <div className="runbook-view-state">This runbook has no cells.</div>
        )}
      </div>
    </section>
  );
});

export function runbookViewUpdateKey(
  runbook: HoneycrispRunbookSummary,
  document: HoneycrispRunbookDocument | null,
  loading: boolean,
  error: string | null
): string {
  const cells = document?.cells.map((cell) => [
    cell.id,
    cell.type,
    cell.source.length,
    cell.executionCount ?? '',
    ...cell.outputs.flatMap((output) => [output.kind, output.streamName ?? '', output.mimeType ?? '', output.text.length])
  ].join(':')).join('|') ?? '';
  return `${runbook.id}:${runbook.revision}:${loading ? 'loading' : 'ready'}:${error ?? ''}:${cells}`;
}

function RunbookCellView({ cell, index }: { cell: HoneycrispRunbookCell; index: number }): JSX.Element {
  return (
    <article className={`runbook-cell runbook-cell-${cell.type}`}>
      <header className="runbook-cell-header">
        <span>{cell.type === 'code' ? cell.language ?? 'Code' : traceLabel(cell.type)}</span>
        <span>Cell {index + 1}{cell.executionCount === null ? '' : ` · [${cell.executionCount}]`}</span>
      </header>
      <div className="runbook-cell-content">
        {cell.type === 'markdown'
          ? renderTraceProseText(cell.source, 'agent_output')
          : cell.type === 'code'
            ? renderHighlightedCodeBlock(cell.source, cell.language)
            : <pre>{cell.source}</pre>}
      </div>
      {cell.outputs.length > 0 ? (
        <div className="runbook-output-list" aria-label={`Outputs for cell ${index + 1}`}>
          {cell.outputs.map((output, outputIndex) => (
            <RunbookOutputView key={`${cell.id}-output-${outputIndex}`} output={output} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function RunbookOutputView({ output }: { output: HoneycrispRunbookOutput }): JSX.Element {
  const label = output.kind === 'stream'
    ? output.streamName ?? 'output'
    : output.kind === 'error'
      ? 'error'
      : output.mimeType ?? 'output';
  return (
    <section className={`runbook-output runbook-output-${output.kind} ${output.streamName === 'stderr' ? 'is-stderr' : ''}`}>
      <span className="runbook-output-label">{label}</span>
      {output.mimeType === 'text/markdown'
        ? renderTraceProseText(output.text, 'agent_output')
        : <pre>{output.text}</pre>}
    </section>
  );
}
