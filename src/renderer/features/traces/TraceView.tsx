import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ChevronRight } from 'lucide-react';
import type { RunDetail } from '@shared/types';
import { devInstrumentation, recordNextFrameTiming, useDevRenderProbe } from '../../devInstrumentation';
import type { TraceCategoryId } from '../../traceClassification';
import { buildTraceTimelineEntries, groupRenderedTraceEntries, latestTraceGroupKey, type TraceDisplayEvent } from '../../view-models/traceDisplay';
import { TraceTurnGroup } from './TraceTurnGroup';

interface TraceScrollAnchor {
  eventId: string;
  offsetTop: number;
}

const TRACE_RENDER_WINDOW_SIZE = 50;
const TRACE_ESTIMATED_EVENT_HEIGHT = 58;
const TRACE_AUTO_FOLLOW_THRESHOLD = TRACE_ESTIMATED_EVENT_HEIGHT * 2;
const TRACE_WINDOW_SLIDE_STEP = 12;
const TRACE_WINDOW_EDGE_BUFFER = TRACE_ESTIMATED_EVENT_HEIGHT * 6;
const TRACE_WINDOW_ANCHOR_BUFFER = 8;
const TRACE_REVEAL_ANIMATION_MS = 240;
const TRACE_REVEAL_RECENT_MS = TRACE_REVEAL_ANIMATION_MS + 280;
const TRACE_REVEAL_INTERVAL_MS = 64;

export function TraceView({
  busy,
  detail,
  events,
  selectedRunId,
  selectedTraceEventId,
  visibleTraceCategories,
  onSelectTraceEvent,
  onSteerInstruction
}: {
  busy: boolean;
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  selectedRunId: string | null;
  selectedTraceEventId: string | null;
  visibleTraceCategories: TraceCategoryId[];
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  const loading = !detail;
  const traceFilterKey = visibleTraceCategories.join('|');
  const timelineEntries = useMemo(
    () =>
      devInstrumentation.time('trace.buildTimelineEntries', () => buildTraceTimelineEntries(events, visibleTraceCategories), {
        events: events.length,
        categories: visibleTraceCategories.length
      }),
    [events, traceFilterKey]
  );
  const tracePresentationKey = `${selectedRunId ?? 'none'}:${traceFilterKey}`;
  const timelineEntryIds = useMemo(() => timelineEntries.map((entry) => entry.event.id), [timelineEntries]);
  const timelineEntryKey = useMemo(() => timelineEntryIds.join('|'), [timelineEntryIds]);
  const [revealedTraceEntryIds, setRevealedTraceEntryIds] = useState<Set<string>>(() => new Set(timelineEntryIds));
  const [enteringTraceEntryIds, setEnteringTraceEntryIds] = useState<Set<string>>(() => new Set());
  const [traceRevealQueueVersion, setTraceRevealQueueVersion] = useState(0);
  const presentedTimelineEntries = useMemo(() => timelineEntries.filter((entry) => revealedTraceEntryIds.has(entry.event.id)), [revealedTraceEntryIds, timelineEntries]);
  const presentedEvents = useMemo(() => presentedTimelineEntries.map((entry) => entry.event), [presentedTimelineEntries]);
  const presentedEntryIndexById = useMemo(() => new Map(presentedTimelineEntries.map((entry, index) => [entry.event.id, index])), [presentedTimelineEntries]);
  const latestPresentedEventId = presentedEvents.at(-1)?.id ?? '';
  const maxWindowStart = Math.max(0, presentedTimelineEntries.length - TRACE_RENDER_WINDOW_SIZE);
  const [traceWindowStart, setTraceWindowStart] = useState(maxWindowStart);
  const normalizedWindowStart = Math.min(traceWindowStart, maxWindowStart);
  const renderedEntries = presentedTimelineEntries.slice(normalizedWindowStart, normalizedWindowStart + TRACE_RENDER_WINDOW_SIZE);
  const renderedGroups = useMemo(
    () =>
      devInstrumentation.time('trace.groupRenderedEntries', () => groupRenderedTraceEntries(renderedEntries), {
        rendered: renderedEntries.length,
        windowStart: normalizedWindowStart
      }),
    [normalizedWindowStart, renderedEntries]
  );
  const latestGroupKey = latestTraceGroupKey(presentedEvents);
  const topSpacerHeight = normalizedWindowStart * TRACE_ESTIMATED_EVENT_HEIGHT;
  const bottomSpacerHeight = Math.max(0, presentedTimelineEntries.length - normalizedWindowStart - renderedEntries.length) * TRACE_ESTIMATED_EVENT_HEIGHT;
  const traceScrollRef = useRef<HTMLDivElement | null>(null);
  const traceListRef = useRef<HTMLDivElement | null>(null);
  const traceFollowLatestRef = useRef(true);
  const traceAutoScrollingRef = useRef(false);
  const traceRestoringAnchorRef = useRef(false);
  const traceAutoScrollFrameRef = useRef<number | null>(null);
  const traceAutoScrollSettledFrameRef = useRef<number | null>(null);
  const pendingTraceScrollAnchorRef = useRef<TraceScrollAnchor | null>(null);
  const traceKnownEntryIdsRef = useRef<Set<string>>(new Set(timelineEntryIds));
  const tracePresentationKeyRef = useRef(tracePresentationKey);
  const traceRevealQueueRef = useRef<string[]>([]);
  const traceRevealCleanupTimersRef = useRef<number[]>([]);
  const latestRenderedEvent = renderedEntries.at(-1)?.event;
  const latestRenderedPayloadLength = latestRenderedEvent ? (JSON.stringify(latestRenderedEvent.payload)?.length ?? 0) : 0;
  const latestRenderedEventVersion = latestRenderedEvent ? `${latestRenderedEvent.id}:${latestRenderedEvent.summary.length}:${latestRenderedPayloadLength}` : '';
  useDevRenderProbe('trace.list', () => ({
    events: events.length,
    visible: timelineEntries.length,
    presented: presentedTimelineEntries.length,
    rendered: renderedEntries.length,
    groups: renderedGroups.length,
    windowStart: normalizedWindowStart,
    following: traceFollowLatestRef.current
  }));

  const updateTraceScrollEdges = useCallback(() => {
    const traceScroll = traceScrollRef.current;
    const traceList = traceListRef.current;
    if (!traceScroll) return;
    if (!traceList) {
      traceScroll.classList.remove('has-top-fade', 'has-bottom-fade');
      return;
    }

    const scrollableDistance = traceList.scrollHeight - traceList.clientHeight;
    const canScroll = scrollableDistance > 8;
    const hasVirtualTop = normalizedWindowStart > 0;
    const hasVirtualBottom = normalizedWindowStart + renderedEntries.length < presentedTimelineEntries.length;
    const showTopFade = canScroll && (hasVirtualTop || traceList.scrollTop > 8);
    const showBottomFade = canScroll && (hasVirtualBottom || traceList.scrollTop < scrollableDistance - 8);

    traceScroll.classList.toggle('has-top-fade', showTopFade);
    traceScroll.classList.toggle('has-bottom-fade', showBottomFade);
  }, [normalizedWindowStart, presentedTimelineEntries.length, renderedEntries.length]);

  const cancelPendingTraceAutoScroll = useCallback(() => {
    if (traceAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(traceAutoScrollFrameRef.current);
      traceAutoScrollFrameRef.current = null;
    }
    if (traceAutoScrollSettledFrameRef.current !== null) {
      window.cancelAnimationFrame(traceAutoScrollSettledFrameRef.current);
      traceAutoScrollSettledFrameRef.current = null;
    }
  }, []);

  const scrollTraceToBottom = useCallback(() => {
    const traceList = traceListRef.current;
    if (!traceList) return;

    cancelPendingTraceAutoScroll();
    traceAutoScrollingRef.current = true;
    const alignToBottom = (): void => {
      traceList.scrollTop = Math.max(0, traceList.scrollHeight - traceList.clientHeight);
      updateTraceScrollEdges();
    };

    alignToBottom();
    traceAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      alignToBottom();
      traceAutoScrollSettledFrameRef.current = window.requestAnimationFrame(() => {
        alignToBottom();
        traceAutoScrollingRef.current = false;
        traceAutoScrollFrameRef.current = null;
        traceAutoScrollSettledFrameRef.current = null;
        updateTraceScrollEdges();
      });
    });
  }, [cancelPendingTraceAutoScroll, updateTraceScrollEdges]);

  useEffect(() => {
    if (tracePresentationKeyRef.current !== tracePresentationKey) {
      tracePresentationKeyRef.current = tracePresentationKey;
      traceKnownEntryIdsRef.current = new Set(timelineEntryIds);
      traceRevealQueueRef.current = [];
      for (const timer of traceRevealCleanupTimersRef.current.splice(0)) {
        window.clearTimeout(timer);
      }
      setRevealedTraceEntryIds(new Set(timelineEntryIds));
      setEnteringTraceEntryIds(new Set());
      traceFollowLatestRef.current = true;
      return;
    }

    const knownEntryIds = traceKnownEntryIdsRef.current;
    const newEntryIds = timelineEntryIds.filter((id) => !knownEntryIds.has(id));
    if (newEntryIds.length === 0) return;

    for (const id of newEntryIds) {
      knownEntryIds.add(id);
    }

    const shouldQueue = traceFollowLatestRef.current && revealedTraceEntryIds.size > 0;
    const receiveDetail = {
      run: selectedRunId ?? 'none',
      newEntries: newEntryIds.length,
      timelineEntries: timelineEntryIds.length,
      revealedEntries: revealedTraceEntryIds.size,
      queueBefore: traceRevealQueueRef.current.length,
      following: traceFollowLatestRef.current,
      queued: shouldQueue
    };
    devInstrumentation.recordEvent('trace.list.newEntries', receiveDetail);
    if (!shouldQueue) {
      const applyStartedAt = performance.now();
      startTransition(() => {
        setRevealedTraceEntryIds((current) => {
          const next = new Set(current);
          for (const id of newEntryIds) next.add(id);
          return next;
        });
      });
      recordNextFrameTiming('trace.list.revealImmediate.nextFrameLatency', applyStartedAt, receiveDetail);
      return;
    }

    const queued = new Set(traceRevealQueueRef.current);
    for (const id of newEntryIds) {
      if (!queued.has(id)) {
        traceRevealQueueRef.current.push(id);
      }
    }
    devInstrumentation.recordEvent('trace.list.queuedEntries', {
      ...receiveDetail,
      queueAfter: traceRevealQueueRef.current.length
    });
    startTransition(() => setTraceRevealQueueVersion((version) => version + 1));
  }, [revealedTraceEntryIds.size, selectedRunId, timelineEntryIds, timelineEntryKey, tracePresentationKey]);

  useEffect(() => {
    const queueLength = traceRevealQueueRef.current.length;
    if (queueLength === 0) return undefined;

    const timer = window.setTimeout(() => {
      const batch = traceRevealQueueRef.current.splice(0, traceRevealBatchSize(traceRevealQueueRef.current.length));
      if (batch.length === 0) return;

      const applyStartedAt = performance.now();
      const revealDetail = {
        run: selectedRunId ?? 'none',
        batch: batch.length,
        queueBefore: queueLength,
        queueAfter: traceRevealQueueRef.current.length,
        presented: presentedTimelineEntries.length,
        timelineEntries: timelineEntries.length
      };
      devInstrumentation.recordEvent('trace.list.revealBatch', revealDetail);
      startTransition(() => {
        setRevealedTraceEntryIds((current) => {
          const next = new Set(current);
          for (const id of batch) next.add(id);
          return next;
        });
        setEnteringTraceEntryIds((current) => {
          const next = new Set(current);
          for (const id of batch) next.add(id);
          return next;
        });
      });
      recordNextFrameTiming('trace.list.revealBatch.nextFrameLatency', applyStartedAt, revealDetail);

      const cleanupTimer = window.setTimeout(() => {
        startTransition(() => {
          setEnteringTraceEntryIds((current) => {
            const next = new Set(current);
            for (const id of batch) next.delete(id);
            return next;
          });
        });
        traceRevealCleanupTimersRef.current = traceRevealCleanupTimersRef.current.filter((timerId) => timerId !== cleanupTimer);
      }, TRACE_REVEAL_RECENT_MS);
      traceRevealCleanupTimersRef.current.push(cleanupTimer);

      if (traceRevealQueueRef.current.length > 0) {
        startTransition(() => setTraceRevealQueueVersion((version) => version + 1));
      }
    }, traceRevealDelayMs(queueLength));

    return () => window.clearTimeout(timer);
  }, [presentedTimelineEntries.length, selectedRunId, timelineEntries.length, traceRevealQueueVersion, tracePresentationKey]);

  useLayoutEffect(() => {
    const anchor = pendingTraceScrollAnchorRef.current;
    if (!anchor) return undefined;
    const traceList = traceListRef.current;
    if (!traceList) {
      pendingTraceScrollAnchorRef.current = null;
      return undefined;
    }

    const anchorNode = traceEventNodes(traceList).find((node) => node.dataset.traceEventId === anchor.eventId);
    pendingTraceScrollAnchorRef.current = null;
    if (!anchorNode) {
      updateTraceScrollEdges();
      return undefined;
    }

    traceRestoringAnchorRef.current = true;
    traceList.scrollTop = Math.max(0, anchorNode.offsetTop - anchor.offsetTop);
    updateTraceScrollEdges();
    const frame = window.requestAnimationFrame(() => {
      traceRestoringAnchorRef.current = false;
      updateTraceScrollEdges();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      traceRestoringAnchorRef.current = false;
    };
  }, [normalizedWindowStart, renderedEntries.length, updateTraceScrollEdges]);

  useLayoutEffect(() => {
    if (!traceFollowLatestRef.current) return;
    if (normalizedWindowStart !== maxWindowStart) {
      setTraceWindowStart(maxWindowStart);
      return;
    }
    scrollTraceToBottom();
  }, [bottomSpacerHeight, latestPresentedEventId, latestRenderedEventVersion, maxWindowStart, normalizedWindowStart, renderedEntries.length, scrollTraceToBottom, selectedRunId]);

  useEffect(() => () => {
    cancelPendingTraceAutoScroll();
    for (const timer of traceRevealCleanupTimersRef.current.splice(0)) {
      window.clearTimeout(timer);
    }
  }, [cancelPendingTraceAutoScroll]);

  useEffect(() => {
    traceFollowLatestRef.current = true;
    setTraceWindowStart(0);
  }, [selectedRunId, traceFilterKey]);

  useEffect(() => {
    setTraceWindowStart((current) => Math.min(current, maxWindowStart));
  }, [maxWindowStart]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateTraceScrollEdges);
    return () => window.cancelAnimationFrame(frame);
  }, [bottomSpacerHeight, latestPresentedEventId, latestRenderedEventVersion, renderedEntries.length, selectedRunId, topSpacerHeight, updateTraceScrollEdges]);

  useEffect(() => {
    const traceList = traceListRef.current;
    if (!traceList || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateTraceScrollEdges);
    observer.observe(traceList);
    return () => observer.disconnect();
  }, [selectedRunId, updateTraceScrollEdges]);

  const handleTraceScroll = useCallback(() => {
    const traceList = traceListRef.current;
    updateTraceScrollEdges();
    if (!traceList) return;
    if (traceRestoringAnchorRef.current) return;
    if (traceAutoScrollingRef.current) {
      traceFollowLatestRef.current = true;
      return;
    }
    const distanceFromBottom = traceList.scrollHeight - traceList.clientHeight - traceList.scrollTop;
    const nearBottom = distanceFromBottom <= TRACE_AUTO_FOLLOW_THRESHOLD;
    traceFollowLatestRef.current = nearBottom;
    if (presentedTimelineEntries.length <= TRACE_RENDER_WINDOW_SIZE) return;
    if (nearBottom) {
      if (normalizedWindowStart !== maxWindowStart) {
        setTraceWindowStart(maxWindowStart);
      }
      return;
    }

    const eventNodes = traceEventNodes(traceList);
    const anchor = captureTraceScrollAnchor(traceList);
    const anchorIndex = anchor ? presentedEntryIndexById.get(anchor.eventId) ?? null : null;
    const viewportTop = traceList.scrollTop;
    const viewportBottom = viewportTop + traceList.clientHeight;
    let nextStart = normalizedWindowStart;

    if (eventNodes.length === 0 || !anchor) {
      nextStart = Math.floor(traceList.scrollTop / TRACE_ESTIMATED_EVENT_HEIGHT);
    } else {
      const firstRenderedTop = eventNodes[0]?.offsetTop ?? 0;
      const lastNode = eventNodes.at(-1);
      const lastRenderedBottom = lastNode ? lastNode.offsetTop + lastNode.offsetHeight : firstRenderedTop;
      const edgeBuffer = Math.max(TRACE_WINDOW_EDGE_BUFFER, traceList.clientHeight * 0.35);
      const viewportMissedRenderedWindow = viewportBottom < firstRenderedTop - edgeBuffer || viewportTop > lastRenderedBottom + edgeBuffer;

      if (viewportMissedRenderedWindow) {
        nextStart = Math.floor(traceList.scrollTop / TRACE_ESTIMATED_EVENT_HEIGHT);
      } else if (viewportTop < firstRenderedTop + edgeBuffer && normalizedWindowStart > 0) {
        nextStart = normalizedWindowStart - TRACE_WINDOW_SLIDE_STEP;
      } else if (viewportBottom > lastRenderedBottom - edgeBuffer && normalizedWindowStart < maxWindowStart) {
        nextStart = normalizedWindowStart + TRACE_WINDOW_SLIDE_STEP;
      }
    }

    nextStart = clampTraceWindowStartForAnchor(nextStart, anchorIndex, maxWindowStart);
    if (nextStart !== normalizedWindowStart) {
      pendingTraceScrollAnchorRef.current = anchor;
      setTraceWindowStart(nextStart);
    }
  }, [maxWindowStart, normalizedWindowStart, presentedEntryIndexById, presentedTimelineEntries.length, updateTraceScrollEdges]);

  if (!selectedRunId) return null;

  return (
    <section className="main-trace-view" aria-label="Agent trace">
      {loading ? <div className="main-trace-empty">Loading trace.</div> : null}
      {!loading && events.length === 0 ? <div className="main-trace-empty">No trace events recorded.</div> : null}
      {!loading && events.length > 0 && timelineEntries.length === 0 ? <div className="main-trace-empty">No trace events match the active filters.</div> : null}
      {!loading && renderedEntries.length > 0 ? (
        <div className="main-trace-scroll" ref={traceScrollRef}>
          <div className="main-trace-list" ref={traceListRef} onScroll={handleTraceScroll}>
            {topSpacerHeight > 0 ? <div className="main-trace-spacer" style={{ height: topSpacerHeight }} aria-hidden="true" /> : null}
            {renderedGroups.map((group) => (
              <TraceTurnGroup
                detail={detail}
                group={group.group}
                entries={group.entries}
                enteringTraceEventIds={enteringTraceEntryIds}
                key={group.key}
                latest={group.group.key === latestGroupKey}
                runStatus={detail.run.status}
                selectedTraceEventId={selectedTraceEventId}
                onSelectTraceEvent={onSelectTraceEvent}
              />
            ))}
            {bottomSpacerHeight > 0 ? <div className="main-trace-spacer" style={{ height: bottomSpacerHeight }} aria-hidden="true" /> : null}
          </div>
        </div>
      ) : null}
      <MainSteerArea
        busy={busy}
        modelLabel={detail ? `${detail.run.model} ${detail.run.reasoningEffort}` : 'No model'}
        runId={detail?.run.id ?? null}
        onSteerInstruction={onSteerInstruction}
      />
    </section>
  );
}

const MainSteerArea = memo(function MainSteerArea({
  runId,
  modelLabel,
  busy,
  onSteerInstruction
}: {
  runId: string | null;
  modelLabel: string;
  busy: boolean;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element {
  const [instruction, setInstruction] = useState('');
  const trimmedInstruction = instruction.trim();
  const disabled = busy || !runId || !trimmedInstruction;

  const submit = (): void => {
    if (disabled || !runId) return;
    onSteerInstruction(runId, trimmedInstruction);
    setInstruction('');
  };

  return (
    <footer className="main-trace-footer" aria-label="Steer research session">
      <div className="main-steer-row">
        <div className="main-steer-input-shell">
          <textarea
            rows={1}
            value={instruction}
            placeholder="Steer the agent..."
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" className="main-steer-model-picker" title="Session model and effort" aria-label="Session model and effort">
            {modelLabel}
          </button>
          <button type="button" className="main-steer-send" title="Send steering instruction" aria-label="Send steering instruction" disabled={disabled} onClick={submit}>
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </footer>
  );
});

function traceEventNodes(list: HTMLDivElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-trace-event-id]'));
}

function captureTraceScrollAnchor(list: HTMLDivElement): TraceScrollAnchor | null {
  const viewportTop = list.scrollTop;
  const viewportBottom = viewportTop + list.clientHeight;

  for (const node of traceEventNodes(list)) {
    const eventId = node.dataset.traceEventId;
    if (!eventId) continue;
    const nodeTop = node.offsetTop;
    const nodeBottom = nodeTop + node.offsetHeight;
    if (nodeBottom < viewportTop) continue;
    if (nodeTop > viewportBottom) break;
    return {
      eventId,
      offsetTop: nodeTop - viewportTop
    };
  }

  return null;
}

function clampTraceWindowStartForAnchor(nextStart: number, anchorIndex: number | null, maxWindowStart: number): number {
  const clampedStart = Math.max(0, Math.min(maxWindowStart, nextStart));
  if (anchorIndex === null) return clampedStart;

  const minStart = Math.max(0, anchorIndex - TRACE_RENDER_WINDOW_SIZE + TRACE_WINDOW_ANCHOR_BUFFER);
  const maxStart = Math.max(0, Math.min(maxWindowStart, anchorIndex - TRACE_WINDOW_ANCHOR_BUFFER));
  return Math.max(minStart, Math.min(maxStart, clampedStart));
}

function traceRevealBatchSize(queueLength: number): number {
  if (queueLength > 90) return 12;
  if (queueLength > 45) return 8;
  if (queueLength > 18) return 4;
  if (queueLength > 6) return 2;
  return 1;
}

function traceRevealDelayMs(queueLength: number): number {
  if (queueLength > 45) return 20;
  if (queueLength > 18) return 32;
  return TRACE_REVEAL_INTERVAL_MS;
}
