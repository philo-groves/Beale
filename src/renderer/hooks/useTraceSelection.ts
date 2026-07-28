import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TraceDisplayEvent } from '../view-models/traceDisplay';
import { traceSelectionDetail } from '../view-models/traceSelection';

export function useTraceSelection({
  events,
  selectedRunId
}: {
  events: TraceDisplayEvent[];
  selectedRunId: string | null;
}): {
  selectedTraceEventId: string | null;
  traceDetailOpen: boolean;
  selectedTraceEvent: TraceDisplayEvent | null;
  selectTraceEvent: (event: TraceDisplayEvent) => void;
  focusTraceEvent: (event: TraceDisplayEvent) => void;
  closeTraceDetail: () => void;
} {
  const [selectedTraceEventId, setSelectedTraceEventId] = useState<string | null>(null);
  const [traceDetailOpen, setTraceDetailOpen] = useState(false);

  useEffect(() => {
    setSelectedTraceEventId(null);
    setTraceDetailOpen(false);
  }, [selectedRunId]);

  const selection = useMemo(() => traceSelectionDetail(events, selectedTraceEventId), [events, selectedTraceEventId]);

  useEffect(() => {
    if (!selectedTraceEventId || selection.event) return;
    setSelectedTraceEventId(null);
    setTraceDetailOpen(false);
  }, [selectedTraceEventId, selection.event]);

  const selectTraceEvent = useCallback((event: TraceDisplayEvent): void => {
    setSelectedTraceEventId(event.id);
    setTraceDetailOpen(true);
  }, []);

  const focusTraceEvent = useCallback((event: TraceDisplayEvent): void => {
    setSelectedTraceEventId(event.id);
    setTraceDetailOpen(false);
  }, []);

  const closeTraceDetail = useCallback(() => setTraceDetailOpen(false), []);

  return {
    selectedTraceEventId,
    traceDetailOpen,
    selectedTraceEvent: selection.event,
    selectTraceEvent,
    focusTraceEvent,
    closeTraceDetail
  };
}
