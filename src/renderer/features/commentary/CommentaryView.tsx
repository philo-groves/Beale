import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { ArrowLeft, BookOpen, Bot, Brain, ChevronRight, CircleAlert, Database, FileText, Terminal, Wrench } from 'lucide-react';
import type {
  ApprovalRecord,
  PolicyReviewDecision,
  ResearchModelSelection,
  ResearchProviderModelCatalog,
  RunDetail,
  ShellSafetyMode,
  SteeringAction,
  WorkspaceScopeVersion
} from '@shared/types';
import { renderSearchHighlightedText, searchHighlightTerms } from '../search/searchHighlight';
import { renderTraceProseText } from '../traces/traceMarkup';
import { MainSteerArea, SessionLoadingState } from '../sessions/SessionComposer';
import { useDevRenderProbe } from '../../devInstrumentation';
import {
  commentaryMessagesForSession,
  commentaryRepositoryMetadataForScope,
  hydrateCommentaryToolCall,
  type CommentaryToolCall,
  type CommentaryMessage
} from '../../view-models/commentary';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { formatDurationHms } from '../../lib/formatting';
import { errorMessage } from '../../lib/errors';

interface CommentaryScrollAnchor {
  messageId: string;
  offsetTop: number;
}

interface CommentaryScrollAnchorOptions {
  canUseMessageId?: (messageId: string) => boolean;
}

export const COMMENTARY_RENDER_WINDOW_SIZE = 60;
const COMMENTARY_ESTIMATED_MESSAGE_HEIGHT = 104;
const COMMENTARY_AUTO_FOLLOW_THRESHOLD = COMMENTARY_ESTIMATED_MESSAGE_HEIGHT * 2;
const COMMENTARY_WINDOW_SLIDE_STEP = 15;
const COMMENTARY_WINDOW_EDGE_BUFFER = COMMENTARY_ESTIMATED_MESSAGE_HEIGHT * 5;
const returnToolCallWithoutLoading = async (toolCall: CommentaryToolCall): Promise<CommentaryToolCall> => toolCall;
const INLINE_SINGULAR_TOOL_NAMES = new Set(['file.read', 'shell.run']);

export const CommentaryView = memo(function CommentaryView({
  busy,
  detail,
  sessionSetupPending = false,
  events,
  activeScope = null,
  providerModelCatalog,
  selectedRunId,
  showBackToMain,
  showBackButton = showBackToMain,
  scrollScopeKey = selectedRunId,
  searchHighlightQuery,
  shellApproval = null,
  shellApprovalBusy = false,
  postSessionContent,
  initialModelSelection,
  initialSuggestion,
  responseSuggestionsEnabled = true,
  onBackToMain,
  onInitialInstruction,
  onShellApprovalDecision = () => undefined,
  onSessionAction,
  onSteerInstruction
}: {
  busy: boolean;
  detail: RunDetail | null;
  sessionSetupPending?: boolean;
  events: TraceDisplayEvent[];
  activeScope?: WorkspaceScopeVersion | null;
  providerModelCatalog: ResearchProviderModelCatalog[];
  selectedRunId: string | null;
  showBackToMain: boolean;
  showBackButton?: boolean;
  scrollScopeKey?: string | null;
  searchHighlightQuery: string;
  shellApproval?: ApprovalRecord | null;
  shellApprovalBusy?: boolean;
  postSessionContent?: ReactNode;
  initialModelSelection?: ResearchModelSelection;
  initialSuggestion?: string;
  responseSuggestionsEnabled?: boolean;
  onBackToMain: () => void;
  onInitialInstruction?: (
    instruction: string,
    modelSelection: ResearchModelSelection,
    shellSafetyMode: ShellSafetyMode
  ) => void;
  onShellApprovalDecision?: (decision: PolicyReviewDecision) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element | null {
  const repositoryMetadata = useMemo(() => commentaryRepositoryMetadataForScope(activeScope), [activeScope]);
  const messages = useMemo(() => {
    const projected = commentaryMessagesForSession(detail, events, {
      includeInitialPrompt: !showBackToMain,
      repositoryMetadata
    });
    if (!sessionSetupPending || !detail) return projected;
    return [...projected, {
      id: `session-setup:${detail.run.id}`,
      traceEventId: null,
      kind: 'progress',
      contentMarkdown: 'The session is in a setup phase. Please wait…',
      reasoningTraceLines: ['The session is in a setup phase. Please wait…'],
      createdAt: detail.run.startedAt ?? detail.run.createdAt
    } satisfies CommentaryMessage];
  }, [detail, events, repositoryMetadata, sessionSetupPending, showBackToMain]);
  const messageSections = useMemo(
    () => commentaryMessageSections(messages, Boolean(detail && !isRunWorkingStatus(detail.run.status)), !showBackToMain),
    [detail, messages, showBackToMain]
  );
  const activityMessages = messageSections.activity;
  const messageUpdateKey = commentaryMessageUpdateKey(messages, events);
  const messageIndexById = useMemo(() => commentaryMessageIndex(activityMessages), [activityMessages]);
  const maxWindowStart = Math.max(0, activityMessages.length - COMMENTARY_RENDER_WINDOW_SIZE);
  const [windowStart, setWindowStart] = useState(maxWindowStart);
  const normalizedWindowStart = Math.min(windowStart, maxWindowStart);
  const renderedMessages = activityMessages.slice(normalizedWindowStart, normalizedWindowStart + COMMENTARY_RENDER_WINDOW_SIZE);
  const topSpacerHeight = normalizedWindowStart * COMMENTARY_ESTIMATED_MESSAGE_HEIGHT;
  const bottomSpacerHeight = Math.max(0, activityMessages.length - normalizedWindowStart - renderedMessages.length) * COMMENTARY_ESTIMATED_MESSAGE_HEIGHT;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const restoringAnchorRef = useRef(false);
  const pendingScrollAnchorRef = useRef<CommentaryScrollAnchor | null>(null);
  const userScrollIntentRef = useRef(false);
  const userScrollIntentTimerRef = useRef<number | null>(null);
  const scrollbarDragRef = useRef(false);
  const scrollScopeKeyRef = useRef(scrollScopeKey);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const loading = Boolean(selectedRunId && !detail);

  const requestToolCallDetail = useCallback(async (toolCall: CommentaryToolCall): Promise<CommentaryToolCall> => {
    const currentDetail = detailRef.current;
    if (!selectedRunId || !currentDetail) throw new Error('Session detail is unavailable.');
    const traceEventIds = [toolCall.requestTraceEventId, toolCall.observationTraceEventId]
      .filter((eventId): eventId is string => Boolean(eventId));
    const result = await window.beale.getRunMessageDetail({ runId: selectedRunId, traceEventIds });
    if (result.runId !== selectedRunId) throw new Error('Received tool detail for a different session.');
    return hydrateCommentaryToolCall(toolCall, result.traceEvents, currentDetail);
  }, [selectedRunId]);

  useDevRenderProbe('commentary.list', () => ({
    messages: messages.length,
    rendered: renderedMessages.length,
    windowStart: normalizedWindowStart,
    following: followLatestRef.current
  }));

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

  const markUserScrollIntent = useCallback((): void => {
    userScrollIntentRef.current = true;
    if (userScrollIntentTimerRef.current !== null) {
      window.clearTimeout(userScrollIntentTimerRef.current);
    }
    userScrollIntentTimerRef.current = window.setTimeout(() => {
      userScrollIntentRef.current = false;
      userScrollIntentTimerRef.current = null;
    }, 200);
  }, []);

  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current;
    if (!anchor) return undefined;
    const list = listRef.current;
    if (!list) {
      pendingScrollAnchorRef.current = null;
      return undefined;
    }
    const anchorNode = commentaryMessageNodes(list).find((node) => node.dataset.commentaryEventId === anchor.messageId);
    pendingScrollAnchorRef.current = null;
    if (!anchorNode) return undefined;

    restoringAnchorRef.current = true;
    list.scrollTop = Math.max(0, anchorNode.offsetTop - anchor.offsetTop);
    updateScrollEdges();
    const frame = window.requestAnimationFrame(() => {
      restoringAnchorRef.current = false;
      updateScrollEdges();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      restoringAnchorRef.current = false;
    };
  }, [normalizedWindowStart, renderedMessages.length, updateScrollEdges]);

  useLayoutEffect(() => {
    if (scrollScopeKeyRef.current !== scrollScopeKey) {
      scrollScopeKeyRef.current = scrollScopeKey;
      followLatestRef.current = true;
      userScrollIntentRef.current = false;
      scrollbarDragRef.current = false;
      pendingScrollAnchorRef.current = null;
      if (userScrollIntentTimerRef.current !== null) {
        window.clearTimeout(userScrollIntentTimerRef.current);
        userScrollIntentTimerRef.current = null;
      }
    }
    if (!followLatestRef.current) {
      const frame = window.requestAnimationFrame(updateScrollEdges);
      return () => window.cancelAnimationFrame(frame);
    }
    if (normalizedWindowStart !== maxWindowStart) {
      setWindowStart(maxWindowStart);
      return undefined;
    }
    const frame = window.requestAnimationFrame(scrollToLatest);
    return () => window.cancelAnimationFrame(frame);
  }, [maxWindowStart, messageUpdateKey, normalizedWindowStart, scrollScopeKey, scrollToLatest, updateScrollEdges]);

  useEffect(() => {
    setWindowStart((current) => Math.min(current, maxWindowStart));
  }, [maxWindowStart]);

  useEffect(() => {
    if (!followLatestRef.current) return undefined;
    const frame = window.requestAnimationFrame(syncScrollState);
    return () => window.cancelAnimationFrame(frame);
  }, [messageUpdateKey, normalizedWindowStart, renderedMessages.length, scrollScopeKey, syncScrollState]);

  useEffect(() => {
    const endScrollbarDrag = (): void => {
      scrollbarDragRef.current = false;
    };
    window.addEventListener('pointerup', endScrollbarDrag);
    window.addEventListener('pointercancel', endScrollbarDrag);
    return () => {
      window.removeEventListener('pointerup', endScrollbarDrag);
      window.removeEventListener('pointercancel', endScrollbarDrag);
      if (userScrollIntentTimerRef.current !== null) {
        window.clearTimeout(userScrollIntentTimerRef.current);
      }
    };
  }, []);

  const handleScroll = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    updateScrollEdges();
    if (restoringAnchorRef.current) return;
    const distanceFromBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    followLatestRef.current = commentaryFollowLatestAfterScroll({
      wasFollowingLatest: followLatestRef.current,
      distanceFromBottom,
      userInitiated: userScrollIntentRef.current || scrollbarDragRef.current
    });
    userScrollIntentRef.current = false;
    if (userScrollIntentTimerRef.current !== null) {
      window.clearTimeout(userScrollIntentTimerRef.current);
      userScrollIntentTimerRef.current = null;
    }
    if (messages.length <= COMMENTARY_RENDER_WINDOW_SIZE) return;
    if (distanceFromBottom <= COMMENTARY_AUTO_FOLLOW_THRESHOLD) {
      if (normalizedWindowStart !== maxWindowStart) setWindowStart(maxWindowStart);
      return;
    }

    const messageNodes = commentaryMessageNodes(list);
    const visibleAnchor = captureCommentaryScrollAnchor(list);
    const viewportTop = list.scrollTop;
    const viewportBottom = viewportTop + list.clientHeight;
    let nextStart = normalizedWindowStart;

    if (messageNodes.length === 0 || !visibleAnchor) {
      nextStart = Math.floor(list.scrollTop / COMMENTARY_ESTIMATED_MESSAGE_HEIGHT);
    } else {
      const firstRenderedTop = messageNodes[0]?.offsetTop ?? 0;
      const lastNode = messageNodes.at(-1);
      const lastRenderedBottom = lastNode ? lastNode.offsetTop + lastNode.offsetHeight : firstRenderedTop;
      const edgeBuffer = Math.max(COMMENTARY_WINDOW_EDGE_BUFFER, list.clientHeight * 0.35);
      const viewportMissedWindow = viewportBottom < firstRenderedTop - edgeBuffer || viewportTop > lastRenderedBottom + edgeBuffer;

      if (viewportMissedWindow) {
        nextStart = Math.floor(list.scrollTop / COMMENTARY_ESTIMATED_MESSAGE_HEIGHT);
      } else if (viewportTop < firstRenderedTop + edgeBuffer && normalizedWindowStart > 0) {
        nextStart = normalizedWindowStart - COMMENTARY_WINDOW_SLIDE_STEP;
      } else if (viewportBottom > lastRenderedBottom - edgeBuffer && normalizedWindowStart < maxWindowStart) {
        nextStart = normalizedWindowStart + COMMENTARY_WINDOW_SLIDE_STEP;
      }
    }

    nextStart = Math.max(0, Math.min(maxWindowStart, nextStart));
    if (nextStart !== normalizedWindowStart) {
      pendingScrollAnchorRef.current = captureCommentaryScrollAnchor(list, {
        canUseMessageId: (messageId) => {
          const index = messageIndexById.get(messageId);
          return index !== undefined && index >= nextStart && index < nextStart + COMMENTARY_RENDER_WINDOW_SIZE;
        }
      });
      setWindowStart(nextStart);
    }
  }, [activityMessages.length, maxWindowStart, messageIndexById, normalizedWindowStart, updateScrollEdges]);

  if (!selectedRunId && !onInitialInstruction) return null;

  return (
    <section className={`main-trace-view main-commentary-view${showBackToMain ? ' is-subagent-trace' : ''}${loading ? ' is-loading' : ''}`} aria-label="Agent commentary">
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
      {loading ? <SessionLoadingState label="Loading session" /> : null}
      {!detail && onInitialInstruction ? (
        <div className="main-commentary-scroll" aria-label="No report review started yet">
          <div className="main-commentary-list" />
        </div>
      ) : null}
      {detail && showBackToMain && messages.length === 0 && !postSessionContent ? <div className="main-trace-empty">No commentary recorded yet.</div> : null}
      {detail && (!showBackToMain || messages.length > 0 || postSessionContent) ? (
        <div className="main-commentary-scroll" ref={scrollRef}>
          <div
            className="main-commentary-list"
            ref={listRef}
            onScroll={handleScroll}
            onWheel={(event) => {
              if (event.deltaY < 0) markUserScrollIntent();
            }}
            onTouchMove={markUserScrollIntent}
            onPointerDown={(event) => {
              const list = listRef.current;
              if (!list || event.pointerType === 'touch') return;
              const bounds = list.getBoundingClientRect();
              const scrollbarWidth = Math.max(12, list.offsetWidth - list.clientWidth + 4);
              if (event.clientX < bounds.right - scrollbarWidth) return;
              scrollbarDragRef.current = true;
              markUserScrollIntent();
            }}
          >
            {messageSections.leading.map((message) => (
              <CommentaryMessageRow
                key={message.id}
                message={message}
                autoExpandToolKey={null}
                searchHighlightQuery={searchHighlightQuery}
                selected={false}
                onRequestToolCallDetail={requestToolCallDetail}
              />
            ))}
            {!showBackToMain ? (
              <RunWorkDisclosure detail={detail}>
                {() => (
                  <>
                    {topSpacerHeight > 0 ? <div className="main-commentary-spacer" style={{ height: topSpacerHeight }} aria-hidden="true" /> : null}
                    {renderedMessages.map((message, index) => (
                      <CommentaryMessageRow
                        key={message.id}
                        message={message}
                        autoExpandToolKey={shouldAutoExpandToolMessage(activityMessages, normalizedWindowStart + index)
                          ? `${message.id}:${message.toolCalls?.length ?? 0}`
                          : null}
                        searchHighlightQuery={searchHighlightQuery}
                        selected={false}
                        onRequestToolCallDetail={requestToolCallDetail}
                      />
                    ))}
                    {bottomSpacerHeight > 0 ? <div className="main-commentary-spacer" style={{ height: bottomSpacerHeight }} aria-hidden="true" /> : null}
                  </>
                )}
              </RunWorkDisclosure>
            ) : (
              <>
                {topSpacerHeight > 0 ? <div className="main-commentary-spacer" style={{ height: topSpacerHeight }} aria-hidden="true" /> : null}
                {renderedMessages.map((message, index) => (
                  <CommentaryMessageRow
                    key={message.id}
                    message={message}
                    autoExpandToolKey={shouldAutoExpandToolMessage(activityMessages, normalizedWindowStart + index)
                      ? `${message.id}:${message.toolCalls?.length ?? 0}`
                      : null}
                    searchHighlightQuery={searchHighlightQuery}
                    selected={false}
                    onRequestToolCallDetail={requestToolCallDetail}
                  />
                ))}
                {bottomSpacerHeight > 0 ? <div className="main-commentary-spacer" style={{ height: bottomSpacerHeight }} aria-hidden="true" /> : null}
              </>
            )}
            {messageSections.trailing.map((message) => (
              <CommentaryMessageRow
                key={message.id}
                message={message}
                autoExpandToolKey={null}
                searchHighlightQuery={searchHighlightQuery}
                selected={false}
                onRequestToolCallDetail={requestToolCallDetail}
              />
            ))}
            {postSessionContent}
          </div>
        </div>
      ) : null}
      {!showBackToMain && !loading ? (
        <MainSteerArea
          busy={busy}
          detail={detail}
          providerModelCatalog={providerModelCatalog}
          initialModelSelection={initialModelSelection}
          runId={detail?.run.id ?? selectedRunId}
          initialSuggestion={initialSuggestion}
          responseSuggestionsEnabled={responseSuggestionsEnabled}
          shellApproval={shellApproval}
          shellApprovalBusy={shellApprovalBusy}
          onInitialInstruction={onInitialInstruction}
          onShellApprovalDecision={onShellApprovalDecision}
          onSessionAction={onSessionAction}
          onSteerInstruction={onSteerInstruction}
        />
      ) : null}
    </section>
  );
});

interface CommentaryMessageSections {
  leading: CommentaryMessage[];
  activity: CommentaryMessage[];
  trailing: CommentaryMessage[];
}

export function commentaryMessageSections(
  messages: readonly CommentaryMessage[],
  terminal: boolean,
  enabled = true
): CommentaryMessageSections {
  if (!enabled) return { leading: [], activity: [...messages], trailing: [] };

  let leadingEnd = 0;
  while (messages[leadingEnd]?.kind === 'user') leadingEnd += 1;

  let trailingStart = messages.length;
  if (terminal) {
    while (trailingStart > leadingEnd) {
      const kind = messages[trailingStart - 1]?.kind;
      if (kind !== 'final_answer' && kind !== 'error') break;
      trailingStart -= 1;
    }
  }

  return {
    leading: messages.slice(0, leadingEnd),
    activity: messages.slice(leadingEnd, trailingStart),
    trailing: messages.slice(trailingStart)
  };
}

function RunWorkDisclosure({ detail, children }: { detail: RunDetail; children: ReactNode | (() => ReactNode) }): JSX.Element {
  const working = isRunWorkingStatus(detail.run.status);
  const [expanded, setExpanded] = useState(() => working);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useLayoutEffect(() => {
    setExpanded(working);
  }, [detail.run.id, working]);

  useEffect(() => {
    if (!working) return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [detail.run.id, working]);

  const durationEndMs = working ? nowMs : stoppedWorkEndMs(detail, nowMs);
  const durationLabel = formatDurationHms(runWorkingDurationMs(detail, durationEndMs));
  const label = `${working ? 'Working' : 'Worked'} for ${durationLabel}`;

  return (
    <section className={`run-work-disclosure${working ? ' is-working' : ' is-terminal'}${expanded ? ' is-expanded' : ''}`}>
      <div className="run-work-header">
        {!working ? (
          <button
            type="button"
            className="run-work-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <span>{label}</span>
            <ChevronRight className="run-work-chevron" size={14} aria-hidden="true" />
          </button>
        ) : (
          <span className="run-work-label">{label}</span>
        )}
      </div>
      {expanded ? <div className="run-work-history">{typeof children === 'function' ? children() : children}</div> : null}
    </section>
  );
}

export function runWorkingDurationMs(detail: RunDetail, nowMs: number): number {
  const attempts = detail.attempts ?? [];
  const attemptDuration = attempts.reduce((total, attempt) => {
    const startMs = Date.parse(attempt.startedAt);
    if (!Number.isFinite(startMs)) return total;
    const parsedEndMs = attempt.endedAt ? Date.parse(attempt.endedAt) : Number.NaN;
    const endMs = Number.isFinite(parsedEndMs) ? parsedEndMs : nowMs;
    return total + Math.max(0, endMs - startMs);
  }, 0);
  if (attempts.length > 0) return attemptDuration;

  const startMs = detail.run.startedAt ? Date.parse(detail.run.startedAt) : Number.NaN;
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, nowMs - startMs);
}

function stoppedWorkEndMs(detail: RunDetail, fallbackMs: number): number {
  const runEndMs = detail.run.endedAt ? Date.parse(detail.run.endedAt) : Number.NaN;
  if (Number.isFinite(runEndMs)) return runEndMs;
  const timestamps = [
    ...(detail.attempts ?? []).map((attempt) => attempt.endedAt),
    ...(detail.traceEvents ?? []).map((event) => event.createdAt),
    ...(detail.transcriptMessages ?? []).map((message) => message.createdAt)
  ];
  return timestamps.reduce((latest, value) => {
    if (!value) return latest;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0) || fallbackMs;
}

export function isRunWorkingStatus(status: RunDetail['run']['status']): boolean {
  return status === 'active';
}

export const CommentaryMessageRow = memo(function CommentaryMessageRow({
  message,
  autoExpandToolKey,
  searchHighlightQuery,
  selected,
  onRequestToolCallDetail = returnToolCallWithoutLoading
}: {
  message: CommentaryMessage;
  autoExpandToolKey: string | null;
  searchHighlightQuery: string;
  selected: boolean;
  onRequestToolCallDetail?: (toolCall: CommentaryToolCall) => Promise<CommentaryToolCall>;
}): JSX.Element {
  const hasSearchHighlight = searchHighlightTerms(searchHighlightQuery).length > 0;
  const label = commentaryMessageLabel(message.kind, message.taskAction);
  const icon = commentaryMessageIcon(message.kind, message.toolName);
  const communicationClass = message.kind === 'task' ? 'agent-communication-outbound' : '';
  const reasoningTraceLines = message.kind === 'progress'
    ? message.reasoningTraceLines?.length ? message.reasoningTraceLines : [message.contentMarkdown]
    : [];
  return (
    <article
      className={`main-commentary-message kind-${message.kind} ${communicationClass} ${selected ? 'selected' : ''}`}
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
                onRequestToolCallDetail={onRequestToolCallDetail}
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
}, commentaryMessageRowPropsEqual);

function CommentaryToolMessageContent({
  message,
  autoExpandKey,
  hasSearchHighlight,
  searchHighlightQuery,
  onRequestToolCallDetail
}: {
  message: CommentaryMessage;
  autoExpandKey: string | null;
  hasSearchHighlight: boolean;
  searchHighlightQuery: string;
  onRequestToolCallDetail: (toolCall: CommentaryToolCall) => Promise<CommentaryToolCall>;
}): JSX.Element {
  const [expanded, setExpanded] = useState(autoExpandKey !== null);
  const [expandedCallIds, setExpandedCallIds] = useState<Set<string>>(() => new Set());
  const [resolvedToolCalls, setResolvedToolCalls] = useState<Map<string, CommentaryToolCall>>(() => new Map());
  const [loadingCallIds, setLoadingCallIds] = useState<Set<string>>(() => new Set());
  const [callErrors, setCallErrors] = useState<Map<string, string>>(() => new Map());
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

  const toggleToolCall = (toolCall: CommentaryToolCall): void => {
    const expanding = !expandedCallIds.has(toolCall.id);
    const callLoading = loadingCallIds.has(toolCall.id);
    setExpandedCallIds((current) => toggledSetValue(current, toolCall.id));
    if (!expanding || !toolCall.detailsDeferred || resolvedToolCalls.has(toolCall.id) || callLoading) return;
    setLoadingCallIds((current) => addedSetValue(current, toolCall.id));
    setCallErrors((current) => mapWithoutKey(current, toolCall.id));
    void onRequestToolCallDetail(toolCall)
      .then((resolved) => {
        setResolvedToolCalls((current) => new Map(current).set(toolCall.id, resolved));
      })
      .catch((caught: unknown) => {
        setCallErrors((current) => new Map(current).set(toolCall.id, errorMessage(caught)));
      })
      .finally(() => setLoadingCallIds((current) => setWithoutValue(current, toolCall.id)));
  };

  if (INLINE_SINGULAR_TOOL_NAMES.has(message.toolName ?? '') && (message.toolCount ?? 1) === 1 && toolCalls.length === 1) {
    const toolCall = toolCalls[0];
    const callExpanded = expandedCallIds.has(toolCall.id);
    const resolvedToolCall = resolvedToolCalls.get(toolCall.id) ?? toolCall;
    const callLoading = loadingCallIds.has(toolCall.id);
    const callError = callErrors.get(toolCall.id) ?? null;
    return (
      <div className={`main-commentary-tool-call main-commentary-single-tool-disclosure${callExpanded ? ' expanded' : ''}`}>
        <button
          aria-expanded={callExpanded}
          className="main-commentary-tool-call-summary main-commentary-single-tool"
          onClick={() => toggleToolCall(toolCall)}
          title={message.contentMarkdown}
          type="button"
        >
          <span className="main-commentary-single-tool-label">
            {hasSearchHighlight
              ? renderSearchHighlightedText(message.contentMarkdown, searchHighlightQuery)
              : message.contentMarkdown}
          </span>
          <ChevronRight className="main-commentary-single-tool-chevron" size={14} aria-hidden="true" />
        </button>
        {callExpanded ? (
          <div className="main-commentary-tool-call-details">
            {callLoading ? <div className="main-commentary-tool-call-loading">Loading details…</div> : null}
            {callError ? <div className="main-commentary-tool-call-loading">{callError}</div> : null}
            {!callLoading && !callError ? (
              <>
                <ToolCallValue label="Input" value={resolvedToolCall.input} />
                <ToolCallValue label="Output" value={resolvedToolCall.output} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

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
            const resolvedToolCall = resolvedToolCalls.get(toolCall.id) ?? toolCall;
            const callLoading = loadingCallIds.has(toolCall.id);
            const callError = callErrors.get(toolCall.id) ?? null;
            return (
              <div className={`main-commentary-tool-call${callExpanded ? ' expanded' : ''}`} role="listitem" key={toolCall.id}>
                <button
                  type="button"
                  className="main-commentary-tool-call-summary"
                  aria-expanded={callExpanded}
                  onClick={() => toggleToolCall(toolCall)}
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
                    {callLoading ? <div className="main-commentary-tool-call-loading">Loading details…</div> : null}
                    {callError ? <div className="main-commentary-tool-call-loading">{callError}</div> : null}
                    {!callLoading && !callError ? (
                      <>
                        <ToolCallValue label="Input" value={resolvedToolCall.input} />
                        <ToolCallValue label="Output" value={resolvedToolCall.output} />
                      </>
                    ) : null}
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

function commentaryMessageUpdateKey(
  messages: readonly CommentaryMessage[],
  events: readonly TraceDisplayEvent[]
): string {
  const latestMessage = messages.at(-1);
  const latestEvent = events.at(-1);
  return [
    messages.length,
    latestMessage?.id ?? '',
    latestMessage?.contentMarkdown.length ?? 0,
    latestMessage?.toolCalls?.length ?? 0,
    events.length,
    latestEvent?.id ?? '',
    latestEvent?.summary.length ?? 0
  ].join(':');
}

function commentaryMessageIndex(messages: readonly CommentaryMessage[]): Map<string, number> {
  const index = new Map<string, number>();
  messages.forEach((message, messageIndex) => {
    index.set(message.id, messageIndex);
    if (message.traceEventId) index.set(message.traceEventId, messageIndex);
    message.toolCalls?.forEach((toolCall) => {
      index.set(toolCall.id, messageIndex);
      index.set(toolCall.traceEventId, messageIndex);
    });
  });
  return index;
}

export function commentaryWindowStartForIndex(messageCount: number, messageIndex: number): number {
  const maxWindowStart = Math.max(0, messageCount - COMMENTARY_RENDER_WINDOW_SIZE);
  return Math.max(0, Math.min(maxWindowStart, messageIndex - Math.floor(COMMENTARY_RENDER_WINDOW_SIZE / 3)));
}

function commentaryMessageNodes(list: HTMLDivElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-commentary-event-id]'));
}

function captureCommentaryScrollAnchor(
  list: HTMLDivElement,
  options: CommentaryScrollAnchorOptions = {}
): CommentaryScrollAnchor | null {
  const viewportTop = list.scrollTop;
  const viewportBottom = viewportTop + list.clientHeight;
  for (const node of commentaryMessageNodes(list)) {
    const messageId = node.dataset.commentaryEventId;
    if (!messageId || (options.canUseMessageId && !options.canUseMessageId(messageId))) continue;
    const nodeTop = node.offsetTop;
    const nodeBottom = nodeTop + node.offsetHeight;
    if (nodeBottom < viewportTop) continue;
    if (nodeTop > viewportBottom) break;
    return { messageId, offsetTop: nodeTop - viewportTop };
  }
  return null;
}

function commentaryMessageRowPropsEqual(
  left: { message: CommentaryMessage; autoExpandToolKey: string | null; searchHighlightQuery: string; selected: boolean; onRequestToolCallDetail?: (toolCall: CommentaryToolCall) => Promise<CommentaryToolCall> },
  right: { message: CommentaryMessage; autoExpandToolKey: string | null; searchHighlightQuery: string; selected: boolean; onRequestToolCallDetail?: (toolCall: CommentaryToolCall) => Promise<CommentaryToolCall> }
): boolean {
  if (
    left.autoExpandToolKey !== right.autoExpandToolKey ||
    left.searchHighlightQuery !== right.searchHighlightQuery ||
    left.selected !== right.selected ||
    left.onRequestToolCallDetail !== right.onRequestToolCallDetail
  ) return false;
  return commentaryMessagesRenderEqual(left.message, right.message);
}

function commentaryMessagesRenderEqual(left: CommentaryMessage, right: CommentaryMessage): boolean {
  if (
    left.id !== right.id ||
    left.traceEventId !== right.traceEventId ||
    left.kind !== right.kind ||
    left.taskAction !== right.taskAction ||
    left.toolName !== right.toolName ||
    left.toolCount !== right.toolCount ||
    left.contentMarkdown !== right.contentMarkdown
  ) return false;
  if (!stringArraysEqual(left.reasoningTraceLines, right.reasoningTraceLines)) return false;
  const leftCalls = left.toolCalls ?? [];
  const rightCalls = right.toolCalls ?? [];
  if (leftCalls.length !== rightCalls.length) return false;
  return leftCalls.every((call, index) => {
    const candidate = rightCalls[index];
    return candidate !== undefined &&
      call.id === candidate.id &&
      call.traceEventId === candidate.traceEventId &&
      call.label === candidate.label &&
      call.requestTraceEventId === candidate.requestTraceEventId &&
      call.observationTraceEventId === candidate.observationTraceEventId &&
      call.detailsDeferred === candidate.detailsDeferred &&
      repositorySearchDetailsEqual(call.repositorySearch, candidate.repositorySearch) &&
      call.input === candidate.input &&
      call.output === candidate.output;
  });
}

function repositorySearchDetailsEqual(
  left: CommentaryToolCall['repositorySearch'],
  right: CommentaryToolCall['repositorySearch']
): boolean {
  if (left === right) return true;
  return Boolean(
    left
    && right
    && left.query === right.query
    && stringArraysEqual(left.repositories, right.repositories)
    && stringArraysEqual(left.repositoryNames, right.repositoryNames)
  );
}

function stringArraysEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
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

export function commentaryFollowLatestAfterScroll({
  wasFollowingLatest,
  distanceFromBottom,
  userInitiated
}: {
  wasFollowingLatest: boolean;
  distanceFromBottom: number;
  userInitiated: boolean;
}): boolean {
  if (distanceFromBottom <= 24) return true;
  if (userInitiated) return false;
  return wasFollowingLatest;
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

function addedSetValue(values: ReadonlySet<string>, value: string): Set<string> {
  return new Set(values).add(value);
}

function setWithoutValue(values: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(values);
  next.delete(value);
  return next;
}

function mapWithoutKey<T>(values: ReadonlyMap<string, T>, key: string): Map<string, T> {
  const next = new Map(values);
  next.delete(key);
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
  if (kind === 'error') return <CircleAlert size={16} />;
  if (kind !== 'tool') return null;
  const normalizedToolName = toolName?.trim().toLowerCase() ?? '';
  if (SUBAGENT_TOOL_NAMES.has(normalizedToolName)) return <Bot size={16} />;
  if (normalizedToolName.startsWith('runbook.') || normalizedToolName.startsWith('runbook_')) {
    return <BookOpen size={16} />;
  }
  if (normalizedToolName.startsWith('report.') || normalizedToolName.startsWith('report_')) {
    return <FileText size={16} />;
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
  return null;
}
