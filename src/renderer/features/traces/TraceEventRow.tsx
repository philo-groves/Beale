import { memo, useMemo } from 'react';
import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { traceLabel } from '../../lib/formatting';
import { honeycrispToolEventKind, honeycrispToolName, toolNameFromSummary, traceCategoryForEvent, traceEventOutcome } from '../../traceClassification';
import { tracePayloadPrimitive } from '../../traceClassification';
import {
  codeBrowserTracePreview,
  duplicateBlockedTraceDetail,
  evidenceTracePreview,
  honeycrispToolTraceSubtext,
  isEmptyHoneycrispMemorySearchObservation,
  isHoneycrispToolObservationError,
  isProseTraceEvent,
  isPythonExecutionTraceEvent,
  reasoningTraceSummariesForEvent,
  pythonTracePreview,
  traceEventDetailText,
  traceEventSummary,
  verifierTracePreview,
  type CodeBrowserTracePreview,
  type DuplicateBlockedTraceDetail,
  type PythonToolCallPreview,
  type ReasoningTraceSummarySegment,
  type TraceStructuredPreview
} from '../../view-models/traceContent';
import { traceDisplayEventIds, type TraceDisplayEvent } from '../../view-models/traceDisplay';
import { renderSearchHighlightedText, searchHighlightTerms } from '../search/searchHighlight';
import { codeBlockLineRows, highlightPythonCode, renderTraceProseText, type CodeBlockLineNumberMode } from './traceMarkup';
import { traceCategoryBadgeLabel, traceEventIcon, traceEventMarkerToneClass } from './traceVisuals';

interface TraceEventRowProps {
  detail: RunDetail | null;
  entering: boolean;
  event: TraceDisplayEvent;
  searchHighlightQuery: string;
  selected: boolean;
  onSelect: (event: TraceDisplayEvent) => void;
}

export const TraceEventRow = memo(function TraceEventRow({
  detail,
  entering,
  event,
  searchHighlightQuery,
  selected,
  onSelect
}: TraceEventRowProps): JSX.Element {
  const hasSearchHighlight = searchHighlightTerms(searchHighlightQuery).length > 0;
  const detailForEvent = traceEventNeedsRunDetail(event) ? detail : null;
  const category = useMemo(() => traceCategoryForEvent(event), [event]);
  const outcome = useMemo(() => traceEventOutcome(event), [event]);
  const markerToneClass = useMemo(() => traceEventMarkerToneClass(event), [event]);
  const toolClassName = useMemo(() => traceToolClassName(event), [event]);
  const summary = useMemo(() => traceEventSummary(event, category), [category, event]);
  const icon = useMemo(() => traceEventIcon(event, category), [category, event]);
  const verifierPreview = useMemo(() => verifierTracePreview(event), [event]);
  const evidencePreview = useMemo(() => evidenceTracePreview(event), [event]);
  const codeBrowserPreview = useMemo(() => codeBrowserTracePreview(event), [event]);
  const duplicateBlockedDetail = useMemo(() => duplicateBlockedTraceDetail(event), [event]);
  const reasoningSummaries = useMemo(() => reasoningTraceSummariesForEvent(event, category), [category, event]);
  const primaryReasoningSummary = reasoningSummaries[0] ?? null;
  const displaySummary = primaryReasoningSummary ? reasoningSummaryHeading(primaryReasoningSummary) : summary;
  const hasReasoningContinuation = Boolean(reasoningSummaryDescription(primaryReasoningSummary ?? undefined) || reasoningSummaries.length > 1);
  const sourceLabel = traceLabel(event.source);
  const detailText = useMemo(() => traceEventDetailText(event, category, detailForEvent), [category, detailForEvent, event]);
  const hasDetail = detailText.length > 0;
  const toolObservationError = useMemo(() => isHoneycrispToolObservationError(event), [event]);
  const proseDetail = useMemo(() => isProseTraceEvent(event, category, detailForEvent), [category, detailForEvent, event]);
  const eventKindClass = proseDetail ? '' : 'trace-compact-sublabel';
  const pythonPreview = useMemo(() => pythonTracePreview(event, detailForEvent), [detailForEvent, event]);
  const honeycrispToolObservation = honeycrispToolEventKind(event) === 'tool.observed';
  const fileReadObservation = honeycrispToolObservation && honeycrispToolName(event) === 'file.read';
  const toolObservationSubtext = honeycrispToolObservation ? honeycrispToolTraceSubtext(event, detailForEvent) : '';
  const emptyMemorySearchObservation = honeycrispToolObservation && isEmptyHoneycrispMemorySearchObservation(event);
  const structuredContextContent = pythonPreview ? (
    <PythonTracePreview preview={pythonPreview} />
  ) : verifierPreview ? (
    <StructuredTracePreview preview={verifierPreview} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
  ) : evidencePreview ? (
    <StructuredTracePreview preview={evidencePreview} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
  ) : codeBrowserPreview ? (
    <CodeBrowserTracePreviewRow
      preview={codeBrowserPreview}
      hideTitle={honeycrispToolObservation && toolObservationSubtext === codeBrowserPreview.title}
      plainTitle={fileReadObservation}
      hasSearchHighlight={hasSearchHighlight}
      searchHighlightQuery={searchHighlightQuery}
    />
  ) : duplicateBlockedDetail ? (
    <DuplicateBlockedTracePreview detail={duplicateBlockedDetail} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
  ) : reasoningSummaries.length > 0 ? (
    <ReasoningTraceContinuation summaries={reasoningSummaries} sourceLabel={sourceLabel} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
  ) : toolObservationError && hasDetail ? (
    <span className="main-trace-tool-error-detail">{hasSearchHighlight ? renderSearchHighlightedText(detailText, searchHighlightQuery) : detailText}</span>
  ) : null;
  const fallbackContextContent = hasDetail ? (
    proseDetail ? (
      <span className="main-trace-prose">{hasSearchHighlight ? renderSearchHighlightedText(detailText, searchHighlightQuery) : renderTraceProseText(detailText, category)}</span>
    ) : (
      <code>{hasSearchHighlight ? renderSearchHighlightedText(detailText, searchHighlightQuery) : detailText}</code>
    )
  ) : null;
  const contextContent = honeycrispToolObservation ? (
    <div className="main-trace-tool-observation-detail">
      {toolObservationSubtext ? (
        <code className="main-trace-tool-subtext">
          {hasSearchHighlight ? renderSearchHighlightedText(toolObservationSubtext, searchHighlightQuery) : toolObservationSubtext}
        </code>
      ) : null}
      {emptyMemorySearchObservation ? <span className="main-trace-tool-empty-memory">No memories were found</span> : structuredContextContent}
    </div>
  ) : (
    structuredContextContent ?? fallbackContextContent
  );
  return (
    <button
      type="button"
      className={`main-trace-event source-${event.source} type-${event.type} category-${category} ${toolClassName} ${eventKindClass} ${markerToneClass} ${
        outcome ? `outcome-${outcome}` : ''
      } ${
        selected ? 'selected' : ''
      } ${
        entering ? 'trace-entering' : ''
      }`}
      data-trace-event-id={event.id}
      data-trace-event-ids={traceDisplayEventIds(event).join(' ')}
      aria-pressed={selected}
      onClick={() => onSelect(event)}
    >
      <div className="main-trace-marker" aria-hidden="true">
        <span>{icon}</span>
      </div>
      <div className="main-trace-event-body">
        <div className="main-trace-line">
          <div className="main-trace-title">
            <span className="main-trace-title-text">{hasSearchHighlight ? renderSearchHighlightedText(displaySummary, searchHighlightQuery) : displaySummary}</span>
            <span className="main-trace-source-label">{sourceLabel}</span>
          </div>
          <div className="main-trace-flags">
            <div className="main-trace-badges">
              <span>{traceCategoryBadgeLabel(category)}</span>
              {!event.modelVisible ? <span>Hidden</span> : null}
            </div>
          </div>
        </div>
        {reasoningSummaries.length > 0 && !hasReasoningContinuation ? null : (
          <div className="main-trace-context">{contextContent}</div>
        )}
      </div>
    </button>
  );
}, traceEventRowPropsEqual);

function CodeBrowserTracePreviewRow({
  preview,
  hideTitle,
  plainTitle,
  hasSearchHighlight,
  searchHighlightQuery
}: {
  preview: CodeBrowserTracePreview;
  hideTitle: boolean;
  plainTitle: boolean;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
}): JSX.Element {
  return (
    <div className={`main-trace-code-browser-preview ${plainTitle ? 'title-plain' : ''}`}>
      <StructuredTracePreview preview={preview} hideTitle={hideTitle} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
      {preview.excerptLines.length > 0 ? (
        <PythonTraceBlock
          label="Excerpt"
          meta={`${preview.excerptLineCount} line${preview.excerptLineCount === 1 ? '' : 's'}`}
          lineNumberMode="source-prefix"
          text={preview.excerptLines.join('\n')}
          truncated={preview.excerptTruncated}
        />
      ) : null}
    </div>
  );
}

function DuplicateBlockedTracePreview({
  detail,
  hasSearchHighlight,
  searchHighlightQuery
}: {
  detail: DuplicateBlockedTraceDetail;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
}): JSX.Element {
  return (
    <span className="main-trace-duplicate-detail">
      <span className="main-trace-prose main-trace-duplicate-title">
        {hasSearchHighlight ? renderSearchHighlightedText(detail.title, searchHighlightQuery) : renderTraceProseText(detail.title, 'agent_output')}
      </span>
      {detail.attributes ? <code className="main-trace-duplicate-attributes">{hasSearchHighlight ? renderSearchHighlightedText(detail.attributes, searchHighlightQuery) : detail.attributes}</code> : null}
    </span>
  );
}

function ReasoningTraceContinuation({
  summaries,
  sourceLabel,
  hasSearchHighlight,
  searchHighlightQuery
}: {
  summaries: ReasoningTraceSummarySegment[];
  sourceLabel: string;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
}): JSX.Element | null {
  const firstDescription = reasoningSummaryDescription(summaries[0]);
  const remaining = summaries.slice(1);
  if (!firstDescription && remaining.length === 0) return null;

  return (
    <span className={`main-trace-reasoning-detail ${firstDescription ? 'has-leading-description' : 'title-only'}`}>
      {firstDescription ? (
        <span className="main-trace-prose main-trace-reasoning-description">
          {hasSearchHighlight ? renderSearchHighlightedText(firstDescription, searchHighlightQuery) : renderTraceProseText(firstDescription, 'agent_output')}
        </span>
      ) : null}
      {remaining.map((summary, index) => {
        const heading = reasoningSummaryHeading(summary);
        const description = reasoningSummaryDescription(summary);
        return (
          <span className="main-trace-reasoning-summary" key={`${heading}-${index}`}>
            <span className="main-trace-reasoning-line">
              <span className="main-trace-title-text">
                {hasSearchHighlight ? renderSearchHighlightedText(heading, searchHighlightQuery) : heading}
              </span>
              <span className="main-trace-source-label">{sourceLabel}</span>
            </span>
            {description ? (
              <span className="main-trace-prose main-trace-reasoning-description">
                {hasSearchHighlight ? renderSearchHighlightedText(description, searchHighlightQuery) : renderTraceProseText(description, 'agent_output')}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

function reasoningSummaryHeading(summary: ReasoningTraceSummarySegment): string {
  return summary.title ?? summary.description;
}

function reasoningSummaryDescription(summary: ReasoningTraceSummarySegment | undefined): string {
  return summary?.title ? summary.description : '';
}
function StructuredTracePreview({
  preview,
  hideTitle = false,
  hasSearchHighlight,
  searchHighlightQuery
}: {
  preview: TraceStructuredPreview;
  hideTitle?: boolean;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
}): JSX.Element {
  return (
    <span className="main-trace-structured-preview">
      {!hideTitle ? <strong>{hasSearchHighlight ? renderSearchHighlightedText(preview.title, searchHighlightQuery) : preview.title}</strong> : null}
      {preview.description ? (
        <span className="main-trace-prose">{hasSearchHighlight ? renderSearchHighlightedText(preview.description, searchHighlightQuery) : renderTraceProseText(preview.description, 'agent_output')}</span>
      ) : null}
      {preview.facts.length > 0 ? (
        <span className="main-trace-structured-facts">
          {preview.facts.map((fact, index) => (
            <span key={`${fact}-${index}`}>{hasSearchHighlight ? renderSearchHighlightedText(fact, searchHighlightQuery) : fact}</span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function PythonTracePreview({ preview }: { preview: PythonToolCallPreview }): JSX.Element {
  return (
    <div className="main-trace-python-preview">
      {preview.task ? <p>{preview.task}</p> : null}
      {preview.scriptLines.length > 0 ? (
        <PythonTraceBlock
          label="Code"
          meta={`${preview.scriptLineCount} line${preview.scriptLineCount === 1 ? '' : 's'}`}
          truncated={preview.truncated}
          language="python"
          text={preview.scriptLines.join('\n')}
        />
      ) : null}
      {preview.outputLines.length > 0 ? (
        <PythonTraceBlock label="Output" meta={`Exit ${preview.exitCode ?? '?'}`} truncated={preview.outputTruncated} text={preview.outputLines.join('\n')} />
      ) : null}
    </div>
  );
}

function PythonTraceBlock({
  label,
  language,
  lineNumberMode = 'generated',
  meta,
  text,
  truncated
}: {
  label: string;
  language?: 'python';
  lineNumberMode?: CodeBlockLineNumberMode;
  meta: string;
  text: string;
  truncated: boolean;
}): JSX.Element {
  const rows = codeBlockLineRows(text.split('\n'), lineNumberMode);
  const codeText = rows.codeLines.join('\n');
  return (
    <div className="main-trace-python-block">
      <div className="main-trace-python-heading">
        <span>{label}</span>
        <span>{meta}</span>
      </div>
      <pre className={truncated ? 'is-truncated' : undefined}>
        <span className="code-line-gutter" aria-hidden="true">
          {rows.lineNumbers.map((lineNumber, index) => (
            <span data-line={lineNumber} key={`${lineNumber}-${index}`} />
          ))}
        </span>
        <code className={language === 'python' ? 'syntax-code language-python' : undefined}>{language === 'python' ? highlightPythonCode(codeText) : codeText}</code>
      </pre>
    </div>
  );
}

function traceEventRowPropsEqual(previous: TraceEventRowProps, next: TraceEventRowProps): boolean {
  if (previous.selected !== next.selected || previous.entering !== next.entering || previous.searchHighlightQuery !== next.searchHighlightQuery || previous.onSelect !== next.onSelect) return false;
  if (!sameTraceDisplayEvent(previous.event, next.event)) return false;
  if (!traceEventNeedsRunDetail(previous.event) && !traceEventNeedsRunDetail(next.event)) return true;
  if (isHoneycrispMemoryGetRequest(previous.event) || isHoneycrispMemoryGetRequest(next.event)) {
    return previous.detail?.traceEvents === next.detail?.traceEvents && previous.detail?.honeycrispMemory?.nodes === next.detail?.honeycrispMemory?.nodes;
  }
  if (isPythonExecutionTraceEvent(previous.event) || isPythonExecutionTraceEvent(next.event)) {
    return previous.detail?.traceEvents === next.detail?.traceEvents;
  }
  return previous.detail?.hypotheses === next.detail?.hypotheses && previous.detail?.findings === next.detail?.findings;
}

function traceToolClassName(event: TraceDisplayEvent): string {
  const toolName = honeycrispToolName(event) ?? tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  if (!toolName) return '';
  const safeName = toolName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return safeName ? `tool-${safeName}` : '';
}

function sameTraceDisplayEvent(previous: TraceDisplayEvent, next: TraceDisplayEvent): boolean {
  if (previous === next) return true;
  if (
    previous.id !== next.id ||
    previous.sequence !== next.sequence ||
    previous.summary !== next.summary ||
    previous.source !== next.source ||
    previous.type !== next.type ||
    previous.modelVisible !== next.modelVisible ||
    previous.createdAt !== next.createdAt ||
    previous.displayOnly !== next.displayOnly
  ) {
    return false;
  }
  if (!previous.displayOnly && previous.payload !== next.payload) return false;
  return tracePayloadPrimitive(previous.payload, 'text') === tracePayloadPrimitive(next.payload, 'text');
}

function traceEventNeedsRunDetail(event: TraceDisplayEvent): boolean {
  return event.type === 'hypothesis_event' || event.type === 'finding_event' || isPythonExecutionTraceEvent(event) || isHoneycrispMemoryGetRequest(event);
}

function isHoneycrispMemoryGetRequest(event: TraceDisplayEvent): boolean {
  return honeycrispToolEventKind(event) === 'tool.requested' && honeycrispToolName(event) === 'memory.get';
}
