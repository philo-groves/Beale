import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, SlidersHorizontal, Square } from 'lucide-react';
import type {
  ApprovalRecord,
  PolicyReviewDecision,
  ResearchModelEffortLevel,
  ResearchModelProviderId,
  ResearchModelSelection,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  RunDetail,
  ShellSafetyMode,
  SteeringAction
} from '@shared/types';
import { devInstrumentation, recordNextFrameTiming, useDevRenderProbe } from '../../devInstrumentation';
import { ModelSelectionPicker } from '../../app/ModelSelectionPicker';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { CenteredLoadingState } from '../../app/CenteredLoadingState';
import { researchModelNameLabel, traceLabel } from '../../lib/formatting';
import { normalizeShellSafetyMode, SHELL_SAFETY_MODE_OPTIONS } from '../../../shared/shellSafety';
export { SHELL_SAFETY_MODE_OPTIONS } from '../../../shared/shellSafety';
import type { TraceCategoryId } from '../../traceClassification';
import {
  steeringInputSuggestion,
  steeringInputTabAction,
  steeringSuggestionAutoVisible
} from '../../view-models/steeringSuggestions';
import {
  buildTraceTimelineEntries,
  coalesceConsecutiveReasoningEntries,
  groupRenderedTraceEntries,
  latestTraceGroupKey,
  traceDisplayEventIds,
  type TraceDisplayEvent
} from '../../view-models/traceDisplay';
import { TraceTurnGroup } from './TraceTurnGroup';
import { ShellApprovalQuestion } from '../sessions/ShellApprovalModal';

interface TraceScrollAnchor {
  eventId: string;
  offsetTop: number;
}

interface TraceScrollAnchorOptions {
  canUseEventId?: (eventId: string) => boolean;
  prefer?: 'first' | 'last';
}

const TRACE_RENDER_WINDOW_SIZE = 50;
const TRACE_ESTIMATED_EVENT_HEIGHT = 68;
const TRACE_AUTO_FOLLOW_THRESHOLD = TRACE_ESTIMATED_EVENT_HEIGHT * 2;
const TRACE_WINDOW_SLIDE_STEP = 12;
const TRACE_WINDOW_EDGE_BUFFER = TRACE_ESTIMATED_EVENT_HEIGHT * 6;
const TRACE_REVEAL_INTERVAL_MS = 64;
export const STEER_TEXTAREA_MAX_LINES = 7;
export const STEER_TEXTAREA_DEFAULT_EXTRA_LINES = 1;
const STEER_ACTION_ROW_HEIGHT = 35;
const STEER_COMPOSER_ROW_GAP = 0;

export const TraceView = memo(function TraceView({
  busy,
  detail,
  events,
  providerModelCatalog,
  selectedRunId,
  traceScopeKey,
  showBackToMain,
  showBackButton = showBackToMain,
  selectedTraceEventId,
  searchHighlightQuery,
  shellApproval = null,
  shellApprovalBusy = false,
  postSessionContent,
  traceFilterCount,
  totalTraceFilterCount,
  visibleTraceCategories,
  onBackToMain,
  onOpenTraceFilters,
  onSelectTraceEvent,
  onShellApprovalDecision = () => undefined,
  onSessionAction,
  onSteerInstruction
}: {
  busy: boolean;
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  selectedRunId: string | null;
  traceScopeKey: string;
  showBackToMain: boolean;
  showBackButton?: boolean;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  shellApproval?: ApprovalRecord | null;
  shellApprovalBusy?: boolean;
  postSessionContent?: ReactNode;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  visibleTraceCategories: TraceCategoryId[];
  onBackToMain: () => void;
  onOpenTraceFilters: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onShellApprovalDecision?: (decision: PolicyReviewDecision) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element | null {
  const loading = !detail;
  const traceFilterKey = visibleTraceCategories.join('|');
  const timelineEntries = useMemo(
    () =>
      devInstrumentation.time('trace.buildTimelineEntries', () => coalesceConsecutiveReasoningEntries(buildTraceTimelineEntries(events, visibleTraceCategories)), {
        events: events.length,
        categories: visibleTraceCategories.length
      }),
    [events, traceFilterKey]
  );
  const tracePresentationKey = `${selectedRunId ?? 'none'}:${traceScopeKey}:${traceFilterKey}`;
  const timelineEntryIds = useMemo(() => timelineEntries.map((entry) => entry.event.id), [timelineEntries]);
  const [revealedTraceEntryIds, setRevealedTraceEntryIds] = useState<Set<string>>(() => new Set(timelineEntryIds));
  const [enteringTraceEntryIds, setEnteringTraceEntryIds] = useState<Set<string>>(() => new Set());
  const [traceRevealQueueVersion, setTraceRevealQueueVersion] = useState(0);
  const presentedTimelineEntries = useMemo(() => timelineEntries.filter((entry) => revealedTraceEntryIds.has(entry.event.id)), [revealedTraceEntryIds, timelineEntries]);
  const presentedEvents = useMemo(() => presentedTimelineEntries.map((entry) => entry.event), [presentedTimelineEntries]);
  const presentedEntryIndexById = useMemo(
    () => new Map(presentedTimelineEntries.flatMap((entry, index) => traceDisplayEventIds(entry.event).map((eventId) => [eventId, index] as const))),
    [presentedTimelineEntries]
  );
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
  const pendingSelectedTraceCenterRef = useRef<string | null>(selectedTraceEventId);
  const traceKnownEntryIdsRef = useRef<Set<string>>(new Set(timelineEntryIds));
  const tracePresentationKeyRef = useRef(tracePresentationKey);
  const traceRevealQueueRef = useRef<string[]>([]);
  const latestRenderedEvent = renderedEntries.at(-1)?.event;
  const latestRenderedEventVersion = latestRenderedEvent
    ? `${latestRenderedEvent.id}:${latestRenderedEvent.sequence}:${latestRenderedEvent.summary.length}:${tracePayloadVersion(latestRenderedEvent.payload)}`
    : '';
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
  }, [revealedTraceEntryIds.size, selectedRunId, timelineEntries, tracePresentationKey]);

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
          while (next.size > TRACE_RENDER_WINDOW_SIZE * 2) {
            const oldest = next.values().next().value;
            if (oldest === undefined) break;
            next.delete(oldest);
          }
          return next;
        });
      });
      recordNextFrameTiming('trace.list.revealBatch.nextFrameLatency', applyStartedAt, revealDetail);

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
    pendingSelectedTraceCenterRef.current = selectedTraceEventId;
  }, [selectedTraceEventId]);

  useLayoutEffect(() => {
    if (!selectedTraceEventId) return;
    if (pendingSelectedTraceCenterRef.current !== selectedTraceEventId) return;
    const selectedIndex = presentedEntryIndexById.get(selectedTraceEventId);
    if (selectedIndex === undefined) return;
    traceFollowLatestRef.current = false;

    const windowEnd = normalizedWindowStart + renderedEntries.length;
    if (selectedIndex >= normalizedWindowStart && selectedIndex < windowEnd) return;

    const targetStart = Math.max(0, Math.min(maxWindowStart, selectedIndex - Math.floor(TRACE_RENDER_WINDOW_SIZE / 3)));
    if (targetStart !== normalizedWindowStart) {
      setTraceWindowStart(targetStart);
    }
  }, [maxWindowStart, normalizedWindowStart, presentedEntryIndexById, renderedEntries.length, selectedTraceEventId]);

  useLayoutEffect(() => {
    if (!selectedTraceEventId) return undefined;
    if (pendingSelectedTraceCenterRef.current !== selectedTraceEventId) return undefined;
    const traceList = traceListRef.current;
    if (!traceList) return undefined;
    const selectedNode = traceEventNodes(traceList).find((node) => traceNodeContainsEventId(node, selectedTraceEventId));
    if (!selectedNode) return undefined;

    traceFollowLatestRef.current = false;
    traceRestoringAnchorRef.current = true;
    const centeredTop = selectedNode.offsetTop - Math.max(16, (traceList.clientHeight - selectedNode.offsetHeight) / 2);
    traceList.scrollTop = Math.max(0, centeredTop);
    pendingSelectedTraceCenterRef.current = null;
    updateTraceScrollEdges();
    const frame = window.requestAnimationFrame(() => {
      traceRestoringAnchorRef.current = false;
      updateTraceScrollEdges();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      traceRestoringAnchorRef.current = false;
    };
  }, [normalizedWindowStart, renderedEntries.length, selectedTraceEventId, updateTraceScrollEdges]);

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
  }, [cancelPendingTraceAutoScroll]);

  useEffect(() => {
    traceFollowLatestRef.current = true;
    setTraceWindowStart(0);
  }, [selectedRunId, traceFilterKey, traceScopeKey]);

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
    const visibleAnchor = captureTraceScrollAnchor(traceList);
    const viewportTop = traceList.scrollTop;
    const viewportBottom = viewportTop + traceList.clientHeight;
    let nextStart = normalizedWindowStart;

    if (eventNodes.length === 0 || !visibleAnchor) {
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

    nextStart = Math.max(0, Math.min(maxWindowStart, nextStart));
    if (nextStart !== normalizedWindowStart) {
      pendingTraceScrollAnchorRef.current = captureTraceScrollAnchor(traceList, {
        canUseEventId: (eventId) => {
          const index = presentedEntryIndexById.get(eventId);
          return index !== undefined && index >= nextStart && index < nextStart + TRACE_RENDER_WINDOW_SIZE;
        }
      });
      setTraceWindowStart(nextStart);
    }
  }, [maxWindowStart, normalizedWindowStart, presentedEntryIndexById, presentedTimelineEntries.length, updateTraceScrollEdges]);

  if (!selectedRunId) return null;

  return (
    <section className={`main-trace-view${showBackToMain ? ' is-subagent-trace' : ''}${loading ? ' is-loading' : ''}`} aria-label="Agent trace">
      {showBackButton ? (
        <button
          type="button"
          className="back-to-main-button trace-back-to-main-button"
          title="Return to the full session trace"
          onClick={onBackToMain}
        >
          <ArrowLeft size={14} />
          <span>Back to Main</span>
        </button>
      ) : null}
      {loading ? <SessionLoadingState label="Loading session" /> : null}
      {!loading && events.length === 0 && !postSessionContent ? <div className="main-trace-empty">No trace events recorded.</div> : null}
      {!loading && events.length > 0 && timelineEntries.length === 0 && !postSessionContent ? <div className="main-trace-empty">No trace events match the active filters.</div> : null}
      {!loading && (renderedEntries.length > 0 || postSessionContent) ? (
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
                searchHighlightQuery={searchHighlightQuery}
                onSelectTraceEvent={onSelectTraceEvent}
              />
            ))}
            {bottomSpacerHeight > 0 ? <div className="main-trace-spacer" style={{ height: bottomSpacerHeight }} aria-hidden="true" /> : null}
            {postSessionContent}
          </div>
        </div>
      ) : null}
      {!showBackToMain && !loading ? (
        <MainSteerArea
          busy={busy}
          detail={detail}
          providerModelCatalog={providerModelCatalog}
          runId={detail?.run.id ?? null}
          shellApproval={shellApproval}
          shellApprovalBusy={shellApprovalBusy}
          traceFilterCount={traceFilterCount}
          totalTraceFilterCount={totalTraceFilterCount}
          onOpenTraceFilters={onOpenTraceFilters}
          onShellApprovalDecision={onShellApprovalDecision}
          onSessionAction={onSessionAction}
          onSteerInstruction={onSteerInstruction}
        />
      ) : null}
    </section>
  );
});

export function SessionLoadingState({ label }: { label: string }): JSX.Element {
  return <CenteredLoadingState className="main-session-loading" label={label} />;
}

export const MainSteerArea = memo(function MainSteerArea({
  runId,
  detail,
  providerModelCatalog,
  busy,
  shellApproval = null,
  shellApprovalBusy = false,
  initialModelSelection,
  initialSuggestion,
  traceFilterCount,
  totalTraceFilterCount,
  showTraceFilters = true,
  onOpenTraceFilters,
  onInitialInstruction,
  onShellApprovalDecision = () => undefined,
  onSessionAction,
  onSteerInstruction
}: {
  runId: string | null;
  detail: RunDetail | null;
  providerModelCatalog: ResearchProviderModelCatalog[];
  busy: boolean;
  shellApproval?: ApprovalRecord | null;
  shellApprovalBusy?: boolean;
  initialModelSelection?: ResearchModelSelection;
  initialSuggestion?: string;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  showTraceFilters?: boolean;
  onOpenTraceFilters: () => void;
  onInitialInstruction?: (
    instruction: string,
    modelSelection: ResearchModelSelection,
    shellSafetyMode: ShellSafetyMode
  ) => void;
  onShellApprovalDecision?: (decision: PolicyReviewDecision) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element {
  const [instruction, setInstruction] = useState('');
  const [tabSuggestionVisible, setTabSuggestionVisible] = useState(false);
  const runProviderId = runModelProvider(detail, providerModelCatalog);
  const initialProviderId = detail ? runProviderId : initialModelSelection?.provider ?? runProviderId;
  const initialProvider = providerModelCatalog.find((catalog) => catalog.providerId === initialProviderId)
    ?? providerModelCatalog.find((catalog) => catalog.models.length > 0)
    ?? null;
  const initialModel = initialProvider?.models.find((model) => model.id === initialModelSelection?.model)
    ?? initialProvider?.models[0]
    ?? null;
  const [selectedProviderId, setSelectedProviderId] = useState<ResearchModelProviderId>(initialProvider?.providerId ?? runProviderId);
  const [selectedModelId, setSelectedModelId] = useState(detail?.run.model ?? initialModel?.id ?? '');
  const [selectedEffort, setSelectedEffort] = useState<ResearchModelEffortLevel>(() => detail
    ? researchEffort(detail.run.reasoningEffort)
    : preferredResearchEffort(initialModel?.effortLevels ?? [], initialModelSelection?.reasoningEffort ?? 'high'));
  const [initialShellSafetyMode, setInitialShellSafetyMode] = useState<ShellSafetyMode>(() =>
    normalizeShellSafetyMode(detail?.run.shellSafetyMode)
  );
  const footerRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedRunIdRef = useRef<string | null>(null);
  const trimmedInstruction = instruction.trim();
  const disabled = busy || (!runId && !onInitialInstruction) || !trimmedInstruction || !selectedModelId;
  const status = detail?.run.status ?? null;
  const steeringSuggestion = initialSuggestion ?? steeringInputSuggestion(detail);
  const suggestionShowing = Boolean(
    steeringSuggestion && (initialSuggestion || tabSuggestionVisible || steeringSuggestionAutoVisible(status))
  );
  const shellSafetyMode = detail
    ? normalizeShellSafetyMode(detail.run.shellSafetyMode)
    : initialShellSafetyMode;
  const sessionControlsDisabled = busy || !runId;
  const composerControlsDisabled = busy || (!runId && !onInitialInstruction);
  const fallbackModel = detail ? fallbackResearchModel(detail.run.model, researchEffort(detail.run.reasoningEffort)) : null;
  const providerOptions = detail && !providerModelCatalog.some((catalog) => catalog.providerId === runProviderId)
    ? [
        ...providerModelCatalog,
        {
          providerId: runProviderId,
          providerName: researchProviderLabel(runProviderId, runProviderId),
          models: fallbackModel ? [fallbackModel] : []
        }
      ]
    : providerModelCatalog;
  const providerCatalog = providerOptions.find((catalog) => catalog.providerId === selectedProviderId) ?? null;
  const modelOptions = providerCatalog?.models.length
    ? providerCatalog.models
    : fallbackModel && selectedProviderId === runProviderId ? [fallbackModel] : [];
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId) ?? modelOptions[0] ?? null;
  const modelSelection: ResearchModelSelection = {
    provider: selectedProviderId,
    model: selectedModel?.id ?? detail?.run.model ?? '',
    reasoningEffort: selectedEffort
  };

  useEffect(() => {
    if (!detail) {
      const nextProvider = providerModelCatalog.find((catalog) => catalog.providerId === initialModelSelection?.provider)
        ?? providerModelCatalog.find((catalog) => catalog.models.length > 0);
      const nextModel = nextProvider?.models.find((model) => model.id === initialModelSelection?.model)
        ?? nextProvider?.models[0];
      if (!nextProvider || !nextModel) return;
      setSelectedProviderId(nextProvider.providerId);
      setSelectedModelId(nextModel.id);
      setSelectedEffort((current) => preferredResearchEffort(
        nextModel.effortLevels,
        initialModelSelection?.reasoningEffort ?? (current === 'off' ? 'high' : current)
      ));
      return;
    }
    const nextModel = providerModelCatalog
      .find((catalog) => catalog.providerId === runModelProvider(detail, providerModelCatalog))
      ?.models.find((model) => model.id === detail.run.model);
    const nextEffort = preferredResearchEffort(nextModel?.effortLevels ?? [researchEffort(detail.run.reasoningEffort)], researchEffort(detail.run.reasoningEffort));
    setSelectedProviderId(runModelProvider(detail, providerModelCatalog));
    setSelectedModelId(nextModel?.id ?? detail.run.model);
    setSelectedEffort(nextEffort);
  }, [
    detail?.run.id,
    detail?.run.model,
    detail?.run.reasoningEffort,
    initialModelSelection?.model,
    initialModelSelection?.provider,
    initialModelSelection?.reasoningEffort,
    providerModelCatalog
  ]);

  useEffect(() => {
    setTabSuggestionVisible(false);
  }, [runId, status, steeringSuggestion]);

  const resizeTextarea = useCallback((): void => {
    const textarea = textareaRef.current;
    const footer = footerRef.current;
    if (!textarea || !footer) return;

    textarea.style.height = '0px';
    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 16;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const baseMinHeight = Number.parseFloat(computedStyle.minHeight) || 44;
    const minHeight = baseMinHeight + lineHeight * STEER_TEXTAREA_DEFAULT_EXTRA_LINES;
    const maxHeight = lineHeight * STEER_TEXTAREA_MAX_LINES + paddingTop + paddingBottom;
    const nextHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    const nextFooterHeight = nextHeight + STEER_ACTION_ROW_HEIGHT + STEER_COMPOSER_ROW_GAP;

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    const traceView = footer.parentElement;
    traceView?.style.removeProperty('--trace-footer-height');
    traceView?.style.setProperty('--trace-footer-content-height', `${nextFooterHeight}px`);
  }, []);

  useLayoutEffect(() => resizeTextarea(), [instruction, resizeTextarea, shellApproval, status]);

  useEffect(() => {
    window.addEventListener('resize', resizeTextarea);
    return () => window.removeEventListener('resize', resizeTextarea);
  }, [resizeTextarea]);

  useEffect(() => {
    if (!runId || focusedRunIdRef.current === runId) return undefined;
    focusedRunIdRef.current = runId;

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [runId]);

  const submit = (): void => {
    if (disabled) return;
    if (runId) onSteerInstruction(runId, trimmedInstruction, modelSelection);
    else onInitialInstruction?.(trimmedInstruction, modelSelection, shellSafetyMode);
    setInstruction('');
    setTabSuggestionVisible(false);
  };

  const stopSession = (): void => {
    if (sessionControlsDisabled || !runId) return;
    onSessionAction({ type: 'stop', runId, note: 'Stop requested from session composer.' });
  };

  const sessionActive = status === 'active';
  const defaultPlaceholder = sessionActive ? 'Steer the research' : 'Your move';
  const placeholder = suggestionShowing && steeringSuggestion ? steeringSuggestion : defaultPlaceholder;

  if (shellApproval) {
    return (
      <ShellApprovalQuestion
        approval={shellApproval}
        busy={shellApprovalBusy}
        onDecision={onShellApprovalDecision}
      />
    );
  }

  return (
    <footer className="main-trace-footer" ref={footerRef} aria-label="Steer research session">
      <div className={`main-steer-input-row${showTraceFilters ? '' : ' without-trace-filters'}`}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={instruction}
          placeholder={placeholder}
          onChange={(event) => {
            setInstruction(event.target.value);
            setTabSuggestionVisible(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
              const action = steeringInputTabAction({
                instruction,
                suggestion: steeringSuggestion,
                suggestionShowing
              });
              if (action !== 'none') {
                event.preventDefault();
                if (action === 'accept_suggestion' && steeringSuggestion) {
                  setInstruction(steeringSuggestion);
                  setTabSuggestionVisible(false);
                } else {
                  setTabSuggestionVisible(true);
                }
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {showTraceFilters ? (
          <button
            type="button"
            className="main-steer-filter-button"
            title={`Trace filters (${traceFilterCount}/${totalTraceFilterCount} shown)`}
            aria-label={`Trace filters (${traceFilterCount}/${totalTraceFilterCount} shown)`}
            onClick={onOpenTraceFilters}
          >
            <SlidersHorizontal size={14} />
          </button>
        ) : null}
        <FloatingTextPicker
          className={`main-steer-safety-mode-picker mode-${shellSafetyMode}`}
          value={shellSafetyMode}
          options={SHELL_SAFETY_MODE_OPTIONS}
          title="Shell safety mode"
          ariaLabel="Shell safety mode"
          disabled={busy || status === 'paused' || (!runId && !onInitialInstruction)}
          onChange={(value) => {
            const nextMode = normalizeShellSafetyMode(value);
            if (nextMode === shellSafetyMode) return;
            if (!runId) {
              setInitialShellSafetyMode(nextMode);
              return;
            }
            onSessionAction({ type: 'set_shell_safety_mode', runId, shellSafetyMode: nextMode });
          }}
        />
        <ModelSelectionPicker
          className="main-steer-model-selection-picker"
          providerValue={selectedProviderId}
          modelValue={selectedModel?.id ?? ''}
          effortValue={selectedEffort}
          title="Model settings for the next agent turn"
          ariaLabel="Model settings for the next agent turn"
          disabled={!selectedModel || composerControlsDisabled}
          providerOptions={providerOptions.map((provider) => ({
            value: provider.providerId,
            label: researchProviderLabel(provider.providerId, provider.providerName),
            disabled: provider.models.length === 0
          }))}
          modelOptions={modelOptions.map((model) => ({
            value: model.id,
            label: researchModelNameLabel(selectedProviderId, model.name)
          }))}
          effortOptions={(selectedModel?.effortLevels ?? []).map((effort) => ({ value: effort, label: researchEffortLabel(effort) }))}
          onSelectProvider={(value) => {
            const providerId = value as ResearchModelProviderId;
            const nextProvider = providerOptions.find((provider) => provider.providerId === providerId);
            const nextModel = nextProvider?.models.find((model) => model.id === selectedModelId) ?? nextProvider?.models[0];
            if (!nextModel) return;
            setSelectedProviderId(providerId);
            setSelectedModelId(nextModel.id);
            setSelectedEffort((current) => preferredResearchEffort(nextModel.effortLevels, current));
          }}
          onSelectModel={(value) => {
            const model = modelOptions.find((candidate) => candidate.id === value);
            if (!model) return;
            setSelectedModelId(model.id);
            setSelectedEffort((current) => preferredResearchEffort(model.effortLevels, current));
          }}
          onSelectEffort={(value) => setSelectedEffort(value as ResearchModelEffortLevel)}
        />
        {sessionActive ? (
          <button type="button" className="main-steer-send main-steer-stop" title="Stop session" aria-label="Stop session" disabled={sessionControlsDisabled} onClick={stopSession}>
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button type="button" className="main-steer-send" title="Send steering instruction" aria-label="Send steering instruction" disabled={disabled} onClick={submit}>
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </footer>
  );
});

function runModelProvider(detail: RunDetail | null, catalogs: ResearchProviderModelCatalog[]): ResearchModelProviderId {
  const stored = detail?.run.budget.modelProvider;
  if (stored === 'openai-codex' || stored === 'anthropic' || stored === 'xai') return stored;
  const matchingCatalog = catalogs.find((catalog) => catalog.models.some((model) => model.id === detail?.run.model));
  return matchingCatalog?.providerId ?? 'openai-codex';
}

function researchEffort(value: string | undefined): ResearchModelEffortLevel {
  if (
    value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'
    || value === 'xhigh' || value === 'max'
  ) return value;
  return 'off';
}

function preferredResearchEffort(
  levels: ResearchModelEffortLevel[],
  current: ResearchModelEffortLevel
): ResearchModelEffortLevel {
  if (levels.includes(current)) return current;
  if (levels.includes('high')) return 'high';
  return levels[0] ?? 'off';
}

function fallbackResearchModel(model: string, effort: ResearchModelEffortLevel): ResearchProviderModel {
  return { id: model, name: model, reasoning: effort !== 'off', effortLevels: [effort], contextWindow: 0, maxTokens: 0 };
}

function researchProviderLabel(providerId: ResearchModelProviderId, fallback: string): string {
  if (providerId === 'openai-codex') return 'OpenAI (Codex)';
  if (providerId === 'anthropic') return 'Anthropic (Claude)';
  if (providerId === 'xai') return 'xAI (Grok/X)';
  return fallback;
}

function researchEffortLabel(effort: ResearchModelEffortLevel): string {
  if (effort === 'xhigh') return 'XHigh';
  return `${effort.slice(0, 1).toUpperCase()}${effort.slice(1)}`;
}

function traceEventNodes(list: HTMLDivElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-trace-event-id]'));
}

function traceNodeContainsEventId(node: HTMLElement, eventId: string): boolean {
  if (node.dataset.traceEventId === eventId) return true;
  return (node.dataset.traceEventIds ?? '').split(' ').includes(eventId);
}

function captureTraceScrollAnchor(list: HTMLDivElement, options: TraceScrollAnchorOptions = {}): TraceScrollAnchor | null {
  const viewportTop = list.scrollTop;
  const viewportBottom = viewportTop + list.clientHeight;
  const candidates: TraceScrollAnchor[] = [];

  for (const node of traceEventNodes(list)) {
    const eventId = node.dataset.traceEventId;
    if (!eventId) continue;
    if (options.canUseEventId && !options.canUseEventId(eventId)) continue;
    const nodeTop = node.offsetTop;
    const nodeBottom = nodeTop + node.offsetHeight;
    if (nodeBottom < viewportTop) continue;
    if (nodeTop > viewportBottom) break;
    candidates.push({
      eventId,
      offsetTop: nodeTop - viewportTop
    });
  }

  return options.prefer === 'last' ? candidates.at(-1) ?? null : candidates[0] ?? null;
}

function tracePayloadVersion(payload: Record<string, unknown>): string {
  let stringBytes = 0;
  let arrayItems = 0;
  for (const value of Object.values(payload)) {
    if (typeof value === 'string') stringBytes += value.length;
    else if (Array.isArray(value)) arrayItems += value.length;
  }
  return `${Object.keys(payload).length}:${stringBytes}:${arrayItems}`;
}

function traceRevealBatchSize(queueLength: number): number {
  if (queueLength > 90) return 12;
  if (queueLength > 45) return 8;
  if (queueLength > 18) return 4;
  if (queueLength > 6) return 2;
  if (queueLength > 1) return 2;
  return 1;
}

function traceRevealDelayMs(queueLength: number): number {
  if (queueLength > 45) return 20;
  if (queueLength > 18) return 32;
  return TRACE_REVEAL_INTERVAL_MS;
}
