import type { TraceDisplayEvent } from './traceDisplay';

export interface TraceSelectionDetail {
  event: TraceDisplayEvent | null;
}

export function selectedTraceEventForId(events: TraceDisplayEvent[], selectedTraceEventId: string | null): TraceDisplayEvent | null {
  if (!selectedTraceEventId) return null;
  return events.find((event) => event.id === selectedTraceEventId) ?? null;
}

export function traceSelectionDetail(events: TraceDisplayEvent[], selectedTraceEventId: string | null): TraceSelectionDetail {
  return {
    event: selectedTraceEventForId(events, selectedTraceEventId)
  };
}
