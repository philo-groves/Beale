import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, Brain, Wrench } from 'lucide-react';
import type {
  ResearchModelSelection,
  ResearchProviderModelCatalog,
  RunDetail,
  SteeringAction
} from '@shared/types';
import { renderSearchHighlightedText, searchHighlightTerms } from '../search/searchHighlight';
import { renderTraceProseText } from '../traces/traceMarkup';
import { MainSteerArea } from '../traces/TraceView';
import {
  commentaryMessagesForSession,
  type CommentaryMessage
} from '../../view-models/commentary';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';

export const CommentaryView = memo(function CommentaryView({
  busy,
  detail,
  events,
  providerModelCatalog,
  selectedRunId,
  showBackToMain,
  selectedTraceEventId,
  searchHighlightQuery,
  onBackToMain,
  onSessionAction,
  onSteerInstruction
}: {
  busy: boolean;
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  selectedRunId: string | null;
  showBackToMain: boolean;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  onBackToMain: () => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element | null {
  const messages = useMemo(
    () => commentaryMessagesForSession(detail, events, { includeInitialPrompt: !showBackToMain }),
    [detail, events, showBackToMain]
  );
  const messageUpdateKey = useMemo(
    () => messages.map((message) => `${message.id}:${message.contentMarkdown.length}`).join('|'),
    [messages]
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);

  const scrollToLatest = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
  }, []);

  useLayoutEffect(() => {
    if (!followLatestRef.current) return undefined;
    const frame = window.requestAnimationFrame(scrollToLatest);
    return () => window.cancelAnimationFrame(frame);
  }, [messageUpdateKey, scrollToLatest, selectedRunId]);

  useLayoutEffect(() => {
    if (!selectedTraceEventId) return;
    const list = listRef.current;
    if (!list) return;
    const selected = Array.from(list.querySelectorAll<HTMLElement>('[data-commentary-event-id]')).find(
      (node) => node.dataset.commentaryEventId === selectedTraceEventId || node.dataset.commentaryTraceId === selectedTraceEventId
    );
    if (!selected) return;
    followLatestRef.current = false;
    selected.scrollIntoView({ block: 'center' });
  }, [messageUpdateKey, selectedTraceEventId]);

  if (!selectedRunId) return null;

  return (
    <section className={`main-trace-view main-commentary-view${showBackToMain ? ' is-subagent-trace' : ''}`} aria-label="Agent commentary">
      {showBackToMain ? (
        <button
          type="button"
          className="back-to-main-button trace-back-to-main-button"
          title="Return to the main agent commentary"
          onClick={onBackToMain}
        >
          <ArrowLeft size={14} />
          <span>Back to Main</span>
        </button>
      ) : null}
      {!detail ? <div className="main-trace-empty">Loading commentary.</div> : null}
      {detail && messages.length === 0 ? <div className="main-trace-empty">No commentary recorded yet.</div> : null}
      {detail && messages.length > 0 ? (
        <div className="main-commentary-scroll">
          <div
            className="main-commentary-list"
            ref={listRef}
            onScroll={() => {
              const list = listRef.current;
              if (!list) return;
              followLatestRef.current = list.scrollHeight - list.clientHeight - list.scrollTop <= 24;
            }}
          >
            {messages.map((message) => (
              <CommentaryMessageRow
                key={message.id}
                message={message}
                searchHighlightQuery={searchHighlightQuery}
                selected={selectedTraceEventId === message.id || selectedTraceEventId === message.traceEventId}
              />
            ))}
          </div>
        </div>
      ) : null}
      {!showBackToMain ? (
        <MainSteerArea
          busy={busy}
          detail={detail}
          providerModelCatalog={providerModelCatalog}
          runId={detail?.run.id ?? null}
          showTraceFilters={false}
          traceFilterCount={0}
          totalTraceFilterCount={0}
          onOpenTraceFilters={() => undefined}
          onSessionAction={onSessionAction}
          onSteerInstruction={onSteerInstruction}
        />
      ) : null}
    </section>
  );
});

function CommentaryMessageRow({
  message,
  searchHighlightQuery,
  selected
}: {
  message: CommentaryMessage;
  searchHighlightQuery: string;
  selected: boolean;
}): JSX.Element {
  const hasSearchHighlight = searchHighlightTerms(searchHighlightQuery).length > 0;
  const label = commentaryMessageLabel(message.kind, message.taskAction);
  const icon = commentaryMessageIcon(message.kind);
  return (
    <article
      className={`main-commentary-message kind-${message.kind} ${selected ? 'selected' : ''}`}
      data-commentary-event-id={message.id}
      data-commentary-trace-id={message.traceEventId ?? undefined}
    >
      {icon ? <span className="main-commentary-message-icon" aria-hidden="true">{icon}</span> : null}
      {label ? <span className="main-commentary-message-label">{label}</span> : null}
      <div className="main-commentary-message-content">
        {hasSearchHighlight
          ? renderSearchHighlightedText(message.contentMarkdown, searchHighlightQuery)
          : renderTraceProseText(message.contentMarkdown, message.kind === 'commentary' || message.kind === 'progress' || message.kind === 'tool' ? 'reasoning' : 'agent_output')}
      </div>
    </article>
  );
}

export function commentaryMessageIcon(kind: CommentaryMessage['kind']): JSX.Element | null {
  if (kind === 'progress') return <Brain size={16} />;
  if (kind === 'tool') return <Wrench size={16} />;
  return null;
}

export function commentaryMessageLabel(
  kind: CommentaryMessage['kind'],
  taskAction?: CommentaryMessage['taskAction']
): string | null {
  if (kind === 'task') return taskAction === 'spawn' ? 'Subagent Spawn' : 'Subagent Follow-up';
  if (kind === 'error') return 'Error';
  if (kind === 'final_answer') return 'Agent';
  return null;
}
