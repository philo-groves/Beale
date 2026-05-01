import { memo, useMemo } from 'react';
import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { traceLabel } from '../../lib/formatting';
import { toolNameFromSummary, traceCategoryForEvent, traceEventOutcome } from '../../traceClassification';
import { tracePayloadPrimitive } from '../../traceClassification';
import {
  duplicateBlockedTraceDetail,
  evidenceTracePreview,
  isProseTraceEvent,
  isPythonExecutionTraceEvent,
  reasoningTraceThoughtsForEvent,
  pythonTracePreview,
  traceEventDetailText,
  traceEventSummary,
  verifierTracePreview,
  type DuplicateBlockedTraceDetail,
  type PythonToolCallPreview,
  type ReasoningTraceThought,
  type TraceStructuredPreview
} from '../../view-models/traceContent';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { renderSearchHighlightedText, searchHighlightTerms } from '../search/searchHighlight';
import { highlightPythonCode, renderTraceProseText } from './traceMarkup';
import { traceCategoryBadgeLabel, traceEventIcon } from './traceVisuals';

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
  const toolClassName = useMemo(() => traceToolClassName(event), [event]);
  const summary = useMemo(() => traceEventSummary(event, category), [category, event]);
  const icon = useMemo(() => traceEventIcon(event, category), [category, event]);
  const verifierPreview = useMemo(() => verifierTracePreview(event), [event]);
  const evidencePreview = useMemo(() => evidenceTracePreview(event), [event]);
  const duplicateBlockedDetail = useMemo(() => duplicateBlockedTraceDetail(event), [event]);
  const reasoningThoughts = useMemo(() => reasoningTraceThoughtsForEvent(event, category), [category, event]);
  const detailText = useMemo(() => traceEventDetailText(event, category, detailForEvent), [category, detailForEvent, event]);
  const hasDetail = detailText.length > 0;
  const proseDetail = useMemo(() => isProseTraceEvent(event, category, detailForEvent), [category, detailForEvent, event]);
  const eventKindClass = proseDetail ? '' : 'trace-compact-sublabel';
  const pythonPreview = useMemo(() => pythonTracePreview(event, detailForEvent), [detailForEvent, event]);
  return (
    <button
      type="button"
      className={`main-trace-event source-${event.source} type-${event.type} category-${category} ${toolClassName} ${eventKindClass} ${outcome ? `outcome-${outcome}` : ''} ${
        selected ? 'selected' : ''
      } ${
        entering ? 'trace-entering' : ''
      }`}
      data-trace-event-id={event.id}
      aria-pressed={selected}
      onClick={() => onSelect(event)}
    >
      <div className="main-trace-marker" aria-hidden="true">
        <span>{icon}</span>
      </div>
      <div className="main-trace-event-body">
        <div className="main-trace-line">
          <div className="main-trace-title">
            <strong>{hasSearchHighlight ? renderSearchHighlightedText(summary, searchHighlightQuery) : summary}</strong>
            <span className="main-trace-source-label">{traceLabel(event.source)}</span>
          </div>
          <div className="main-trace-flags">
            <div className="main-trace-badges">
              <span>{traceCategoryBadgeLabel(category)}</span>
              {!event.modelVisible ? <span>Hidden</span> : null}
            </div>
          </div>
        </div>
        <div className="main-trace-context">
          {pythonPreview ? (
            <PythonTracePreview preview={pythonPreview} />
          ) : verifierPreview ? (
            <StructuredTracePreview preview={verifierPreview} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
          ) : evidencePreview ? (
            <StructuredTracePreview preview={evidencePreview} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
          ) : duplicateBlockedDetail ? (
            <DuplicateBlockedTracePreview detail={duplicateBlockedDetail} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
          ) : reasoningThoughts.length > 0 ? (
            <ReasoningTracePreview thoughts={reasoningThoughts} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
          ) : hasDetail ? (
            proseDetail ? (
              <span className="main-trace-prose">{hasSearchHighlight ? renderSearchHighlightedText(detailText, searchHighlightQuery) : renderTraceProseText(detailText, category)}</span>
            ) : (
              <code>{hasSearchHighlight ? renderSearchHighlightedText(detailText, searchHighlightQuery) : detailText}</code>
            )
          ) : null}
        </div>
      </div>
    </button>
  );
}, traceEventRowPropsEqual);

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
      {detail.attributes ? <code className="main-trace-duplicate-attributes">{hasSearchHighlight ? renderSearchHighlightedText(detail.attributes, searchHighlightQuery) : detail.attributes}</code> : null}
      <span className="main-trace-prose main-trace-duplicate-title">
        {hasSearchHighlight ? renderSearchHighlightedText(detail.title, searchHighlightQuery) : renderTraceProseText(detail.title, 'agent_output')}
      </span>
    </span>
  );
}

function ReasoningTracePreview({
  thoughts,
  hasSearchHighlight,
  searchHighlightQuery
}: {
  thoughts: ReasoningTraceThought[];
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
}): JSX.Element {
  return (
    <span className="main-trace-reasoning-detail">
      {thoughts.map((thought, index) => (
        <span className="main-trace-reasoning-thought" key={`${thought.title ?? 'thought'}-${index}`}>
          {thought.title ? (
            <strong className="main-trace-markdown-strong main-trace-reasoning-title">
              {hasSearchHighlight ? renderSearchHighlightedText(thought.title, searchHighlightQuery) : thought.title}
            </strong>
          ) : null}
          {thought.description ? (
            <span className="main-trace-prose main-trace-reasoning-description">
              {hasSearchHighlight ? renderSearchHighlightedText(thought.description, searchHighlightQuery) : renderTraceProseText(thought.description, 'agent_output')}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

function StructuredTracePreview({
  preview,
  hasSearchHighlight,
  searchHighlightQuery
}: {
  preview: TraceStructuredPreview;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
}): JSX.Element {
  return (
    <span className="main-trace-structured-preview">
      <strong>{hasSearchHighlight ? renderSearchHighlightedText(preview.title, searchHighlightQuery) : preview.title}</strong>
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
  meta,
  text,
  truncated
}: {
  label: string;
  language?: 'python';
  meta: string;
  text: string;
  truncated: boolean;
}): JSX.Element {
  return (
    <div className="main-trace-python-block">
      <div className="main-trace-python-heading">
        <span>{label}</span>
        <span>{meta}</span>
      </div>
      <pre className={truncated ? 'is-truncated' : undefined}>
        <code className={language === 'python' ? 'syntax-code language-python' : undefined}>{language === 'python' ? highlightPythonCode(text) : text}</code>
      </pre>
    </div>
  );
}

function traceEventRowPropsEqual(previous: TraceEventRowProps, next: TraceEventRowProps): boolean {
  if (previous.selected !== next.selected || previous.entering !== next.entering || previous.searchHighlightQuery !== next.searchHighlightQuery || previous.onSelect !== next.onSelect) return false;
  if (!sameTraceDisplayEvent(previous.event, next.event)) return false;
  if (!traceEventNeedsRunDetail(previous.event) && !traceEventNeedsRunDetail(next.event)) return true;
  if (isPythonExecutionTraceEvent(previous.event) || isPythonExecutionTraceEvent(next.event)) {
    return previous.detail?.traceEvents === next.detail?.traceEvents;
  }
  return previous.detail?.hypotheses === next.detail?.hypotheses && previous.detail?.findings === next.detail?.findings;
}

function traceToolClassName(event: TraceDisplayEvent): string {
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
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
  return event.type === 'hypothesis_event' || event.type === 'finding_event' || isPythonExecutionTraceEvent(event);
}
