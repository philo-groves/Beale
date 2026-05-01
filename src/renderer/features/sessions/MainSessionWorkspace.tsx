import { memo } from 'react';
import type { JSX } from 'react';
import type { RunDetail, SteeringAction } from '@shared/types';
import { ResearchSidePanel } from '../research/ResearchSidePanel';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';

export const MainSessionWorkspace = memo(function MainSessionWorkspace({
  detail,
  events,
  researchPanelCollapsed,
  selectedRunId,
  selectedTraceEventId,
  searchHighlightQuery,
  visibleTraceCategories,
  busy,
  onExpandResearchPanel,
  onSelectTraceEvent,
  onSessionAction,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  researchPanelCollapsed: boolean;
  selectedRunId: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  onExpandResearchPanel: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  if (!selectedRunId) return null;

  return (
    <div className={`main-session-grid ${researchPanelCollapsed ? 'research-collapsed' : ''}`}>
      <TraceView
        busy={busy}
        detail={detail}
        events={events}
        selectedRunId={selectedRunId}
        selectedTraceEventId={selectedTraceEventId}
        searchHighlightQuery={searchHighlightQuery}
        visibleTraceCategories={visibleTraceCategories}
        onSelectTraceEvent={onSelectTraceEvent}
        onSessionAction={onSessionAction}
        onSteerInstruction={onSteerInstruction}
      />
      <ResearchSidePanel
        collapsed={researchPanelCollapsed}
        detail={detail}
        events={events}
        selectedTraceEventId={selectedTraceEventId}
        onExpand={onExpandResearchPanel}
        onSelectTraceEvent={onSelectTraceEvent}
      />
    </div>
  );
});
