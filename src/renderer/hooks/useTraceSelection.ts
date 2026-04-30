import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunDetail } from '@shared/types';
import type { TraceDisplayEvent } from '../view-models/traceDisplay';
import { traceSelectionDetail } from '../view-models/traceSelection';

export function useTraceSelection({
  detail,
  events,
  selectedRunId
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  selectedRunId: string | null;
}): {
  selectedTraceEventId: string | null;
  traceDetailOpen: boolean;
  selectedTraceEvent: TraceDisplayEvent | null;
  selectedTraceFinding: ReturnType<typeof traceSelectionDetail>['finding'];
  selectedTraceHypothesis: ReturnType<typeof traceSelectionDetail>['hypothesis'];
  selectTraceEvent: (event: TraceDisplayEvent) => void;
  closeTraceDetail: () => void;
} {
  const [selectedTraceEventId, setSelectedTraceEventId] = useState<string | null>(null);
  const [traceDetailOpen, setTraceDetailOpen] = useState(false);

  useEffect(() => {
    setSelectedTraceEventId(null);
    setTraceDetailOpen(false);
  }, [selectedRunId]);

  const selection = useMemo(() => traceSelectionDetail(detail, events, selectedTraceEventId), [detail, events, selectedTraceEventId]);

  useEffect(() => {
    if (!selectedTraceEventId || selection.event) return;
    setSelectedTraceEventId(null);
    setTraceDetailOpen(false);
  }, [selectedTraceEventId, selection.event]);

  const selectTraceEvent = useCallback((event: TraceDisplayEvent): void => {
    setSelectedTraceEventId(event.id);
    setTraceDetailOpen(true);
  }, []);

  const closeTraceDetail = useCallback(() => setTraceDetailOpen(false), []);

  return {
    selectedTraceEventId,
    traceDetailOpen,
    selectedTraceEvent: selection.event,
    selectedTraceFinding: selection.finding,
    selectedTraceHypothesis: selection.hypothesis,
    selectTraceEvent,
    closeTraceDetail
  };
}
