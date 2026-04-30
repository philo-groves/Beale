import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { traceLabel } from '../../lib/formatting';
import { traceCategoryForEvent, traceEventOutcome } from '../../traceClassification';
import { isProseTraceEvent, pythonToolCallPreview, traceEventDetailText, traceEventSummary, type PythonToolCallPreview } from '../../view-models/traceContent';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { highlightPythonCode, renderTraceProseText } from './traceMarkup';
import { traceCategoryLabel, traceEventIcon } from './traceVisuals';

export function TraceEventRow({
  detail,
  entering,
  event,
  selected,
  onSelect
}: {
  detail: RunDetail | null;
  entering: boolean;
  event: TraceDisplayEvent;
  selected: boolean;
  onSelect: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const category = traceCategoryForEvent(event);
  const outcome = traceEventOutcome(event);
  const detailText = traceEventDetailText(event, category, detail);
  const hasDetail = detailText.length > 0;
  const proseDetail = isProseTraceEvent(event, category, detail);
  const eventKindClass = proseDetail ? '' : 'trace-compact-sublabel';
  const pythonPreview = pythonToolCallPreview(event);
  return (
    <button
      type="button"
      className={`main-trace-event source-${event.source} type-${event.type} category-${category} ${eventKindClass} ${outcome ? `outcome-${outcome}` : ''} ${
        selected ? 'selected' : ''
      } ${
        entering ? 'trace-entering' : ''
      }`}
      data-trace-event-id={event.id}
      aria-pressed={selected}
      onClick={() => onSelect(event)}
    >
      <div className="main-trace-marker" aria-hidden="true">
        <span>{traceEventIcon(event, category)}</span>
      </div>
      <div className="main-trace-event-body">
        <div className="main-trace-line">
          <div className="main-trace-title">
            <strong>{traceEventSummary(event, category)}</strong>
            <span className="main-trace-source-label">{traceLabel(event.source)}</span>
          </div>
          <div className="main-trace-flags">
            <div className="main-trace-badges">
              <span>{traceCategoryLabel(category)}</span>
              {!event.modelVisible ? <span>Hidden</span> : null}
            </div>
          </div>
        </div>
        <div className="main-trace-context">
          {pythonPreview ? (
            <PythonTracePreview preview={pythonPreview} />
          ) : hasDetail ? (
            proseDetail ? (
              <span className="main-trace-prose">{renderTraceProseText(detailText, category)}</span>
            ) : (
              <code>{detailText}</code>
            )
          ) : null}
        </div>
      </div>
    </button>
  );
}

function PythonTracePreview({ preview }: { preview: PythonToolCallPreview }): JSX.Element {
  return (
    <div className="main-trace-python-preview">
      {preview.task ? <p>{preview.task}</p> : null}
      {preview.scriptLines.length > 0 ? (
        <pre className={preview.truncated ? 'is-truncated' : undefined}>
          <code className="syntax-code language-python">{highlightPythonCode(preview.scriptLines.join('\n'))}</code>
          {preview.truncated ? (
            <span className="main-trace-python-more" aria-hidden="true">
              <span>View More</span>
            </span>
          ) : null}
        </pre>
      ) : null}
    </div>
  );
}
