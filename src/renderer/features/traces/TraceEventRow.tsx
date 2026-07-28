import { memo, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { traceLabel } from '../../lib/formatting';
import { honeycrispToolEventKind, honeycrispToolName, toolNameFromSummary, traceCategoryForEvent, traceEventOutcome } from '../../traceClassification';
import { tracePayloadPrimitive } from '../../traceClassification';
import {
  codeBrowserTracePreview,
  duplicateBlockedTraceDetail,
  honeycrispAgentListResults,
  honeycrispCollaborationTraceSummary,
  honeycrispMemoryCorrectionSummary,
  honeycrispMemoryGetSummary,
  honeycrispMemorySearchResults,
  honeycrispShellTraceOutput,
  honeycrispToolTraceSubtext,
  honeycrispToolTraceSubtextPill,
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
  type HoneycrispAgentListPreview,
  type HoneycrispMemorySearchResultsPreview,
  type HoneycrispShellTraceOutput,
  type PythonToolCallPreview,
  type ReasoningTraceSummarySegment,
  type TraceStructuredPreview
} from '../../view-models/traceContent';
import { traceDisplayEventIds, type TraceDisplayEvent } from '../../view-models/traceDisplay';
import { renderSearchHighlightedText, searchHighlightTerms } from '../search/searchHighlight';
import { highlightPythonCode, renderTraceProseText } from './traceMarkup';
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
  const [limitedOutputExpanded, setLimitedOutputExpanded] = useState(false);
  const hasSearchHighlight = searchHighlightTerms(searchHighlightQuery).length > 0;
  const detailForEvent = traceEventNeedsRunDetail(event) ? detail : null;
  const category = useMemo(() => traceCategoryForEvent(event), [event]);
  const outcome = useMemo(() => traceEventOutcome(event), [event]);
  const markerToneClass = useMemo(() => traceEventMarkerToneClass(event), [event]);
  const toolClassName = useMemo(() => traceToolClassName(event), [event]);
  const summary = useMemo(() => traceEventSummary(event, category), [category, event]);
  const icon = useMemo(() => traceEventIcon(event, category), [category, event]);
  const verifierPreview = useMemo(() => verifierTracePreview(event), [event]);
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
  const honeycrispToolRequest = honeycrispToolEventKind(event) === 'tool.requested';
  const honeycrispToolObservation = honeycrispToolEventKind(event) === 'tool.observed';
  const honeycrispToolNameValue = honeycrispToolName(event);
  const shellToolTrace = honeycrispToolNameValue === 'shell.run';
  const memoryCorrectionTrace = honeycrispToolNameValue === 'memory.correct';
  const memoryGetTrace = honeycrispToolNameValue === 'memory.get';
  const memorySearchTrace = honeycrispToolNameValue === 'memory.search';
  const collaborationToolTrace = isCollaborationToolName(honeycrispToolNameValue);
  const memoryCorrectionSummary = memoryCorrectionTrace ? honeycrispMemoryCorrectionSummary(event) : '';
  const memoryGetSummary = memoryGetTrace ? honeycrispMemoryGetSummary(event, detailForEvent) : '';
  const memorySummary = memoryCorrectionSummary || memoryGetSummary;
  const collaborationSummary = collaborationToolTrace ? honeycrispCollaborationTraceSummary(event) : '';
  const fileReadObservation = honeycrispToolObservation && honeycrispToolNameValue === 'file.read';
  const toolTraceSubtext = honeycrispToolRequest || honeycrispToolObservation ? honeycrispToolTraceSubtext(event, detailForEvent) : '';
  const toolTraceSubtextPill = honeycrispToolRequest || honeycrispToolObservation ? honeycrispToolTraceSubtextPill(event) : null;
  const toolObservationSubtext = honeycrispToolObservation ? toolTraceSubtext : '';
  const emptyMemorySearchObservation = honeycrispToolObservation && isEmptyHoneycrispMemorySearchObservation(event);
  const memorySearchResults = useMemo(() => honeycrispMemorySearchResults(event), [event]);
  const agentListResults = useMemo(() => honeycrispAgentListResults(event), [event]);
  const shellTraceOutput = useMemo(() => honeycrispShellTraceOutput(event), [event]);
  const structuredContextContent = pythonPreview ? (
    <PythonTracePreview preview={pythonPreview} />
  ) : verifierPreview ? (
    <StructuredTracePreview preview={verifierPreview} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
  ) : codeBrowserPreview ? (
    <CodeBrowserTracePreviewRow
      preview={codeBrowserPreview}
      expanded={limitedOutputExpanded}
      hideTitle={honeycrispToolObservation && toolObservationSubtext === codeBrowserPreview.title}
      plainTitle={fileReadObservation}
      hasSearchHighlight={hasSearchHighlight}
      searchHighlightQuery={searchHighlightQuery}
      onToggleExpanded={() => setLimitedOutputExpanded((current) => !current)}
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
      <div className="main-trace-prose">{hasSearchHighlight ? renderSearchHighlightedText(detailText, searchHighlightQuery) : renderTraceProseText(detailText, category)}</div>
    ) : (
      <code>{hasSearchHighlight ? renderSearchHighlightedText(detailText, searchHighlightQuery) : detailText}</code>
    )
  ) : null;
  const toolSubtextContent = toolTraceSubtext ? (
    <span className="main-trace-tool-subtext-row">
      <code className={`main-trace-tool-subtext ${shellToolTrace ? 'is-multiline' : ''}`}>
        {hasSearchHighlight ? renderSearchHighlightedText(toolTraceSubtext, searchHighlightQuery) : toolTraceSubtext}
      </code>
    </span>
  ) : null;
  const memorySummaryContent = memorySummary ? (
    <span className="main-trace-memory-summary">
      {hasSearchHighlight ? renderSearchHighlightedText(memorySummary, searchHighlightQuery) : memorySummary}
    </span>
  ) : null;
  const collaborationSummaryContent = collaborationSummary ? (
    <span className="main-trace-tool-summary">
      {hasSearchHighlight ? renderSearchHighlightedText(collaborationSummary, searchHighlightQuery) : collaborationSummary}
    </span>
  ) : null;
  const shellOutputContent = shellTraceOutput ? (
    <ShellTraceOutput
      output={shellTraceOutput}
      expanded={limitedOutputExpanded}
      fallbackError={toolObservationError && hasDetail && !shellTraceOutput.stderr ? detailText : ''}
      hasSearchHighlight={hasSearchHighlight}
      searchHighlightQuery={searchHighlightQuery}
      onToggleExpanded={() => setLimitedOutputExpanded((current) => !current)}
    />
  ) : null;
  const memorySearchResultsContent = memorySearchResults ? (
    <MemorySearchResults
      results={memorySearchResults}
      expanded={limitedOutputExpanded}
      hasSearchHighlight={hasSearchHighlight}
      searchHighlightQuery={searchHighlightQuery}
      onToggleExpanded={() => setLimitedOutputExpanded((current) => !current)}
    />
  ) : null;
  const agentListResultsContent = agentListResults ? (
    <AgentListResults
      results={agentListResults}
      expanded={limitedOutputExpanded}
      hasSearchHighlight={hasSearchHighlight}
      searchHighlightQuery={searchHighlightQuery}
      onToggleExpanded={() => setLimitedOutputExpanded((current) => !current)}
    />
  ) : null;
  const contextContent = honeycrispToolObservation ? (
    <div className={`main-trace-tool-observation-detail ${memoryCorrectionTrace || memoryGetTrace || collaborationSummary ? 'is-natural-summary' : ''}`}>
      {toolSubtextContent}
      {memorySummaryContent}
      {collaborationSummaryContent}
      {emptyMemorySearchObservation ? (
        <span className="main-trace-tool-empty-memory">No memories were found</span>
      ) : memorySearchTrace ? (
        memorySearchResultsContent
      ) : honeycrispToolNameValue === 'list_agents' ? (
        agentListResultsContent
      ) : (
        shellOutputContent ?? structuredContextContent
      )}
    </div>
  ) : honeycrispToolRequest && (shellToolTrace || memoryCorrectionTrace || memoryGetTrace || collaborationToolTrace) ? (
    memoryCorrectionTrace || memoryGetTrace || collaborationToolTrace ? (
      <span className="main-trace-tool-observation-detail is-natural-summary">
        {toolSubtextContent}
        {memorySummaryContent}
        {collaborationSummaryContent}
      </span>
    ) : (
      toolSubtextContent
    )
  ) : (
    structuredContextContent ?? fallbackContextContent
  );
  return (
    <div
      className={`main-trace-event source-${event.source} type-${event.type} category-${category} ${toolClassName} ${eventKindClass} ${markerToneClass} ${
        outcome ? `outcome-${outcome}` : ''
      } ${
        selected ? 'selected' : ''
      } ${
        entering ? 'trace-entering' : ''
      }`}
      data-trace-event-id={event.id}
      data-trace-event-ids={traceDisplayEventIds(event).join(' ')}
    >
      <div className="main-trace-marker">
        <button
          type="button"
          className="main-trace-marker-button"
          aria-label={`Open trace details: ${displaySummary}`}
          aria-pressed={selected}
          onClick={() => onSelect(event)}
        >
          <span aria-hidden="true">{icon}</span>
        </button>
      </div>
      <div className="main-trace-event-body">
        <div className="main-trace-line">
          <div className="main-trace-title">
            <span className="main-trace-title-text">{hasSearchHighlight ? renderSearchHighlightedText(displaySummary, searchHighlightQuery) : displaySummary}</span>
            <span className="main-trace-source-label">{sourceLabel}</span>
          </div>
          <div className="main-trace-flags">
            <div className="main-trace-badges">
              {toolTraceSubtextPill ? <span>{toolTraceSubtextPill}</span> : null}
              <span>{traceCategoryBadgeLabel(category)}</span>
              {!event.modelVisible ? <span>Hidden</span> : null}
            </div>
          </div>
        </div>
        {reasoningSummaries.length > 0 && !hasReasoningContinuation ? null : (
          <div className="main-trace-context">{contextContent}</div>
        )}
      </div>
    </div>
  );
}, traceEventRowPropsEqual);

function AgentListResults({
  results,
  expanded,
  hasSearchHighlight,
  searchHighlightQuery,
  onToggleExpanded
}: {
  results: HoneycrispAgentListPreview;
  expanded: boolean;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
  onToggleExpanded: () => void;
}): JSX.Element {
  if (results.count === 0) return <span className="main-trace-tool-summary">No agents found</span>;
  const rows = expanded ? results.allRows : results.rows;
  return (
    <TraceCodePreview
      expanded={expanded}
      expandable={results.allRows.length > results.rows.length}
      label="Agents"
      meta={`${results.count} agent${results.count === 1 ? '' : 's'}`}
      onToggleExpanded={onToggleExpanded}
      searchHighlightQuery={hasSearchHighlight ? searchHighlightQuery : ''}
      text={rows.map((row) => `- ${row}`).join('\n')}
      truncated={!expanded && results.allRows.length > results.rows.length}
    />
  );
}

function MemorySearchResults({
  results,
  expanded,
  hasSearchHighlight,
  searchHighlightQuery,
  onToggleExpanded
}: {
  results: HoneycrispMemorySearchResultsPreview;
  expanded: boolean;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
  onToggleExpanded: () => void;
}): JSX.Element {
  const titles = expanded ? results.allTitles : results.titles;
  return (
    <TraceCodePreview
      expanded={expanded}
      expandable={results.allTitles.length > results.titles.length}
      label="Results"
      meta={`${results.resultCount} result${results.resultCount === 1 ? '' : 's'}`}
      onToggleExpanded={onToggleExpanded}
      searchHighlightQuery={hasSearchHighlight ? searchHighlightQuery : ''}
      text={titles.map((title) => `- ${title}`).join('\n')}
      truncated={!expanded && results.truncated}
    />
  );
}

function ShellTraceOutput({
  output,
  expanded,
  fallbackError,
  hasSearchHighlight,
  searchHighlightQuery,
  onToggleExpanded
}: {
  output: HoneycrispShellTraceOutput;
  expanded: boolean;
  fallbackError: string;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
  onToggleExpanded: () => void;
}): JSX.Element {
  return (
    <div className="main-trace-shell-output">
      {output.stdout ? (
        <TraceCodePreview
          expanded={expanded}
          expandable={output.stdout.allLines.length > output.stdout.lines.length}
          label="stdout"
          meta={`${output.stdout.lineCount} line${output.stdout.lineCount === 1 ? '' : 's'}`}
          onToggleExpanded={onToggleExpanded}
          truncated={expanded ? output.stdout.sourceTruncated : output.stdout.truncated}
          text={(expanded ? output.stdout.allLines : output.stdout.lines).join('\n')}
          searchHighlightQuery={hasSearchHighlight ? searchHighlightQuery : ''}
        />
      ) : null}
      {output.stderr ? (
        <span className="main-trace-tool-error-detail">
          {hasSearchHighlight ? renderSearchHighlightedText(output.stderr, searchHighlightQuery) : output.stderr}
          {output.stderrTruncated ? <span className="main-trace-shell-output-truncated">stderr truncated by Honeycrisp</span> : null}
        </span>
      ) : fallbackError ? (
        <span className="main-trace-tool-error-detail">{hasSearchHighlight ? renderSearchHighlightedText(fallbackError, searchHighlightQuery) : fallbackError}</span>
      ) : null}
    </div>
  );
}

function CodeBrowserTracePreviewRow({
  preview,
  expanded,
  hideTitle,
  plainTitle,
  hasSearchHighlight,
  searchHighlightQuery,
  onToggleExpanded
}: {
  preview: CodeBrowserTracePreview;
  expanded: boolean;
  hideTitle: boolean;
  plainTitle: boolean;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
  onToggleExpanded: () => void;
}): JSX.Element {
  const excerptLines = expanded ? preview.excerptAllLines : preview.excerptLines;
  return (
    <div className={`main-trace-code-browser-preview ${plainTitle ? 'title-plain' : ''}`}>
      <StructuredTracePreview preview={preview} hideTitle={hideTitle} hasSearchHighlight={hasSearchHighlight} searchHighlightQuery={searchHighlightQuery} />
      {excerptLines.length > 0 ? (
        <TraceCodePreview
          expanded={expanded}
          expandable={preview.excerptAllLines.length > preview.excerptLines.length}
          label="Excerpt"
          meta={`${preview.excerptLineCount} line${preview.excerptLineCount === 1 ? '' : 's'}`}
          onToggleExpanded={onToggleExpanded}
          text={excerptLines.join('\n')}
          truncated={expanded ? preview.excerptSourceTruncated : preview.excerptTruncated}
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
      <div className="main-trace-prose main-trace-duplicate-title">
        {hasSearchHighlight ? renderSearchHighlightedText(detail.title, searchHighlightQuery) : renderTraceProseText(detail.title, 'agent_output')}
      </div>
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
        <div className="main-trace-prose main-trace-reasoning-description">
          {hasSearchHighlight ? renderSearchHighlightedText(firstDescription, searchHighlightQuery) : renderTraceProseText(firstDescription, 'agent_output')}
        </div>
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
              <div className="main-trace-prose main-trace-reasoning-description">
                {hasSearchHighlight ? renderSearchHighlightedText(description, searchHighlightQuery) : renderTraceProseText(description, 'agent_output')}
              </div>
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
        <div className="main-trace-prose">{hasSearchHighlight ? renderSearchHighlightedText(preview.description, searchHighlightQuery) : renderTraceProseText(preview.description, 'agent_output')}</div>
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
        <TraceCodePreview
          label="Code"
          meta={`${preview.scriptLineCount} line${preview.scriptLineCount === 1 ? '' : 's'}`}
          truncated={preview.truncated}
          language="python"
          text={preview.scriptLines.join('\n')}
        />
      ) : null}
      {preview.outputLines.length > 0 ? (
        <TraceCodePreview label="Output" meta={`Exit ${preview.exitCode ?? '?'}`} truncated={preview.outputTruncated} text={preview.outputLines.join('\n')} />
      ) : null}
    </div>
  );
}

function TraceCodePreview({
  expanded = false,
  expandable = false,
  label,
  language,
  meta,
  onToggleExpanded,
  searchHighlightQuery = '',
  text,
  truncated
}: {
  expanded?: boolean;
  expandable?: boolean;
  label: string;
  language?: 'python';
  meta: string;
  onToggleExpanded?: () => void;
  searchHighlightQuery?: string;
  text: string;
  truncated: boolean;
}): JSX.Element {
  const codeText = text;
  return (
    <div className={`main-trace-python-block ${expandable ? 'has-expand-toggle' : ''}`}>
      <div className="main-trace-python-heading">
        <span>{label}</span>
        <span>{meta}</span>
      </div>
      <pre className={truncated ? 'is-truncated' : undefined}>
        <code className={language === 'python' ? 'syntax-code language-python' : undefined}>
          {language === 'python' ? highlightPythonCode(codeText) : searchHighlightQuery ? renderSearchHighlightedText(codeText, searchHighlightQuery) : codeText}
        </code>
      </pre>
      {expandable && onToggleExpanded ? (
        <button type="button" className="main-trace-output-toggle" aria-expanded={expanded} onClick={onToggleExpanded}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      ) : null}
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
  return previous.detail?.honeycrispMemory?.nodes === next.detail?.honeycrispMemory?.nodes;
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

function isCollaborationToolName(toolName: string | null): boolean {
  return toolName === 'spawn_agent'
    || toolName === 'send_message'
    || toolName === 'followup_task'
    || toolName === 'interrupt_agent'
    || toolName === 'list_agents'
    || toolName === 'wait_agent';
}
