import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, BookOpen, Bot, Brain, ChevronRight, Database, Terminal, Wrench } from 'lucide-react';
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
  showBackButton = showBackToMain,
  scrollScopeKey = selectedRunId,
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
  showBackButton?: boolean;
  scrollScopeKey?: string | null;
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const scrollScopeKeyRef = useRef(scrollScopeKey);

  const updateScrollEdges = useCallback((): void => {
    const scroll = scrollRef.current;
    const list = listRef.current;
    if (!scroll) return;
    if (!list) {
      scroll.classList.remove('has-top-fade', 'has-bottom-fade');
      return;
    }
    const fadeClasses = commentaryScrollFadeClasses({
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      scrollTop: list.scrollTop
    });
    scroll.classList.toggle('has-top-fade', fadeClasses['has-top-fade']);
    scroll.classList.toggle('has-bottom-fade', fadeClasses['has-bottom-fade']);
  }, []);

  const scrollToLatest = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    updateScrollEdges();
  }, [updateScrollEdges]);

  const syncScrollState = useCallback((): void => {
    if (followLatestRef.current) {
      scrollToLatest();
      return;
    }
    updateScrollEdges();
  }, [scrollToLatest, updateScrollEdges]);

  useLayoutEffect(() => {
    if (scrollScopeKeyRef.current !== scrollScopeKey) {
      scrollScopeKeyRef.current = scrollScopeKey;
      followLatestRef.current = true;
    }
    const frame = window.requestAnimationFrame(syncScrollState);
    return () => window.cancelAnimationFrame(frame);
  }, [messageUpdateKey, scrollScopeKey, syncScrollState]);

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
    const frame = window.requestAnimationFrame(updateScrollEdges);
    return () => window.cancelAnimationFrame(frame);
  }, [messageUpdateKey, selectedTraceEventId, updateScrollEdges]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [messageUpdateKey, scrollScopeKey, syncScrollState]);

  const handleScroll = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    followLatestRef.current = distanceFromBottom <= 24;
    updateScrollEdges();
  }, [updateScrollEdges]);

  if (!selectedRunId) return null;

  return (
    <section className={`main-trace-view main-commentary-view${showBackToMain ? ' is-subagent-trace' : ''}`} aria-label="Agent commentary">
      {showBackButton ? (
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
        <div className="main-commentary-scroll" ref={scrollRef}>
          <div
            className="main-commentary-list"
            ref={listRef}
            onScroll={handleScroll}
          >
            {messages.map((message, index) => (
              <CommentaryMessageRow
                key={message.id}
                message={message}
                autoExpandToolKey={shouldAutoExpandToolMessage(messages, index)
                  ? `${message.id}:${message.toolCalls?.length ?? 0}`
                  : null}
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
  autoExpandToolKey,
  searchHighlightQuery,
  selected
}: {
  message: CommentaryMessage;
  autoExpandToolKey: string | null;
  searchHighlightQuery: string;
  selected: boolean;
}): JSX.Element {
  const hasSearchHighlight = searchHighlightTerms(searchHighlightQuery).length > 0;
  const label = commentaryMessageLabel(message.kind, message.taskAction);
  const icon = commentaryMessageIcon(message.kind, message.toolName);
  const reasoningTraceLines = message.kind === 'progress'
    ? message.reasoningTraceLines?.length ? message.reasoningTraceLines : [message.contentMarkdown]
    : [];
  return (
    <article
      className={`main-commentary-message kind-${message.kind} ${selected ? 'selected' : ''}`}
      data-commentary-event-id={message.id}
      data-commentary-trace-id={message.traceEventId ?? undefined}
    >
      {message.kind === 'progress' ? (
        <div className="main-commentary-reasoning-lines">
          {reasoningTraceLines.map((line, index) => (
            <div className="main-commentary-reasoning-line" key={`${index}:${line}`}>
              <span className="main-commentary-message-icon" aria-hidden="true">
                <Brain size={16} />
              </span>
              <div className="main-commentary-message-content">
                {hasSearchHighlight
                  ? renderSearchHighlightedText(line, searchHighlightQuery)
                  : renderTraceProseText(line, 'reasoning')}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {icon ? <span className="main-commentary-message-icon" aria-hidden="true">{icon}</span> : null}
          {label ? <span className="main-commentary-message-label">{label}</span> : null}
          <div className="main-commentary-message-content">
            {message.kind === 'tool' ? (
              <CommentaryToolMessageContent
                message={message}
                autoExpandKey={autoExpandToolKey}
                hasSearchHighlight={hasSearchHighlight}
                searchHighlightQuery={searchHighlightQuery}
              />
            ) : hasSearchHighlight ? (
              renderSearchHighlightedText(message.contentMarkdown, searchHighlightQuery)
            ) : (
              renderTraceProseText(message.contentMarkdown, message.kind === 'commentary' ? 'reasoning' : 'agent_output')
            )}
          </div>
        </>
      )}
    </article>
  );
}

function CommentaryToolMessageContent({
  message,
  autoExpandKey,
  hasSearchHighlight,
  searchHighlightQuery
}: {
  message: CommentaryMessage;
  autoExpandKey: string | null;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(autoExpandKey !== null);
  const [expandedCallIds, setExpandedCallIds] = useState<Set<string>>(() => new Set());
  const previousAutoExpandKeyRef = useRef(autoExpandKey);
  const toolCalls = message.toolCalls ?? [];

  useLayoutEffect(() => {
    const previousAutoExpandKey = previousAutoExpandKeyRef.current;
    if (autoExpandKey !== null && autoExpandKey !== previousAutoExpandKey) {
      setExpanded(true);
    } else if (autoExpandKey === null && previousAutoExpandKey !== null) {
      setExpanded(false);
    }
    previousAutoExpandKeyRef.current = autoExpandKey;
  }, [autoExpandKey]);

  return (
    <div className={`main-commentary-tool-disclosure${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="main-commentary-tool-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>
          {hasSearchHighlight
            ? renderSearchHighlightedText(message.contentMarkdown, searchHighlightQuery)
            : message.contentMarkdown}
        </span>
        <ChevronRight className="main-commentary-tool-summary-chevron" size={16} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="main-commentary-tool-call-list" role="list">
          {toolCalls.map((toolCall) => {
            const callExpanded = expandedCallIds.has(toolCall.id);
            return (
              <div className={`main-commentary-tool-call${callExpanded ? ' expanded' : ''}`} role="listitem" key={toolCall.id}>
                <button
                  type="button"
                  className="main-commentary-tool-call-summary"
                  aria-expanded={callExpanded}
                  onClick={() => setExpandedCallIds((current) => toggledSetValue(current, toolCall.id))}
                >
                  <code title={toolCall.label}>
                    {hasSearchHighlight
                      ? renderSearchHighlightedText(toolCall.label, searchHighlightQuery)
                      : toolCall.label}
                  </code>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
                {callExpanded ? (
                  <div className="main-commentary-tool-call-details">
                    <ToolCallValue label="Input" value={toolCall.input} />
                    <ToolCallValue label="Output" value={toolCall.output} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function shouldAutoExpandToolMessage(
  messages: readonly CommentaryMessage[],
  index: number
): boolean {
  return index === messages.length - 1 && messages[index]?.kind === 'tool';
}

export function commentaryScrollFadeClasses({
  scrollHeight,
  clientHeight,
  scrollTop
}: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}): { 'has-top-fade': boolean; 'has-bottom-fade': boolean } {
  const scrollableDistance = scrollHeight - clientHeight;
  const canScroll = scrollableDistance > 8;
  return {
    'has-top-fade': canScroll && scrollTop > 8,
    'has-bottom-fade': canScroll && scrollTop < scrollableDistance - 8
  };
}

function ToolCallValue({ label, value }: { label: string; value: unknown }): JSX.Element {
  return (
    <div className="main-commentary-tool-call-value">
      <span>{label}</span>
      <pre>{commentaryToolValueText(value)}</pre>
    </div>
  );
}

function toggledSetValue(values: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function commentaryToolValueText(value: unknown): string {
  if (typeof value === 'string') return value || '""';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

const SUBAGENT_TOOL_NAMES = new Set([
  'followup_task',
  'interrupt_agent',
  'list_agents',
  'send_message',
  'spawn_agent',
  'wait_agent'
]);

export function commentaryMessageIcon(
  kind: CommentaryMessage['kind'],
  toolName?: string
): JSX.Element | null {
  if (kind === 'progress') return <Brain size={16} />;
  if (kind !== 'tool') return null;
  const normalizedToolName = toolName?.trim().toLowerCase() ?? '';
  if (SUBAGENT_TOOL_NAMES.has(normalizedToolName)) return <Bot size={16} />;
  if (normalizedToolName.startsWith('runbook.') || normalizedToolName.startsWith('runbook_')) {
    return <BookOpen size={16} />;
  }
  if (normalizedToolName.startsWith('memory.') || normalizedToolName.startsWith('memory_')) {
    return <Database size={16} />;
  }
  if (
    normalizedToolName === 'experiment.run'
    || normalizedToolName === 'experiment_run'
    || normalizedToolName === 'shell.run'
    || normalizedToolName === 'shell_run'
  ) {
    return <Terminal size={16} />;
  }
  return <Wrench size={16} />;
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
