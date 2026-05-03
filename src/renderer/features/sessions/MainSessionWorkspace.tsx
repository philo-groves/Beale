import { memo } from 'react';
import type { JSX } from 'react';
import { Network } from 'lucide-react';
import type { RunDetail, SteeringAction } from '@shared/types';
import { ResearchSidePanel } from '../research/ResearchSidePanel';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import type { SessionMainView } from './sessionViews';

export const MainSessionWorkspace = memo(function MainSessionWorkspace({
  detail,
  events,
  researchPanelCollapsed,
  selectedRunId,
  selectedTraceEventId,
  searchHighlightQuery,
  sessionView,
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
  sessionView: SessionMainView;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  onExpandResearchPanel: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  if (!selectedRunId) return null;

  if (sessionView === 'graph') {
    return (
      <div className="program-graph-workspace" aria-label="Program graph view">
        <div className="program-graph-placeholder">
          <span className="program-graph-placeholder-icon" aria-hidden="true">
            <Network size={22} />
          </span>
          <strong>Program Graph</strong>
        </div>
      </div>
    );
  }

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
