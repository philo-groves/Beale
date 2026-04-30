import type { FindingRecord, HypothesisRecord, RunDetail } from '@shared/types';
import {
  findingForTraceEvent,
  hypothesisForTraceEvent
} from './traceContent';
import type { TraceDisplayEvent } from './traceDisplay';

export interface TraceSelectionDetail {
  event: TraceDisplayEvent | null;
  finding: FindingRecord | null;
  hypothesis: HypothesisRecord | null;
}

export function selectedTraceEventForId(events: TraceDisplayEvent[], selectedTraceEventId: string | null): TraceDisplayEvent | null {
  if (!selectedTraceEventId) return null;
  return events.find((event) => event.id === selectedTraceEventId) ?? null;
}

export function traceSelectionDetail(detail: RunDetail | null, events: TraceDisplayEvent[], selectedTraceEventId: string | null): TraceSelectionDetail {
  const event = selectedTraceEventForId(events, selectedTraceEventId);
  return {
    event,
    finding: event ? findingForTraceEvent(detail, event) : null,
    hypothesis: event ? hypothesisForTraceEvent(detail, event) : null
  };
}
