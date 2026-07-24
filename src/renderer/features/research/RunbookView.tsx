import { memo } from 'react';
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
  onBackToMain
}: {
  runbook: HoneycrispRunbookSummary;
  document: HoneycrispRunbookDocument | null;
  loading: boolean;
  error: string | null;
  onBackToMain: () => void;
}): JSX.Element {
  return (
    <section className="main-trace-view runbook-view" aria-label={`Runbook: ${runbook.title}`}>
      <button type="button" className="back-to-main-button trace-back-to-main-button" onClick={onBackToMain}>
        <ArrowLeft size={15} aria-hidden="true" />
        Back to Main
      </button>
      <div className="runbook-view-scroll">
        <header className="runbook-view-header">
          <span className="runbook-view-eyebrow"><BookOpen size={15} aria-hidden="true" /> Runbook</span>
          <h2>{runbook.title}</h2>
          {runbook.purpose ? <p>{runbookDescriptionText(runbook.purpose)}</p> : null}
          <div className="runbook-view-meta">
            <span>{traceLabel(runbook.status)}</span>
            <span>Revision {runbook.revision}</span>
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
