import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { ResearchSidePanel } from '../research/ResearchSidePanel';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';

export function MainSessionWorkspace({
  detail,
  events,
  selectedRunId,
  selectedTraceEventId,
  visibleTraceCategories,
  busy,
  onSelectTraceEvent,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  selectedRunId: string | null;
  selectedTraceEventId: string | null;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  if (!selectedRunId) return null;

  return (
    <div className="main-session-grid">
      <TraceView
        busy={busy}
        detail={detail}
        events={events}
        selectedRunId={selectedRunId}
        selectedTraceEventId={selectedTraceEventId}
        visibleTraceCategories={visibleTraceCategories}
        onSelectTraceEvent={onSelectTraceEvent}
        onSteerInstruction={onSteerInstruction}
      />
      <ResearchSidePanel detail={detail} events={events} selectedTraceEventId={selectedTraceEventId} onSelectTraceEvent={onSelectTraceEvent} />
    </div>
  );
}
