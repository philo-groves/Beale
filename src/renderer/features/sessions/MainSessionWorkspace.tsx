import { memo } from 'react';
import type { JSX } from 'react';
import { Network } from 'lucide-react';
import type { ProgramScopeVersion, ProjectGraphSummary, ProjectSemanticSummary, RunDetail, SteeringAction } from '@shared/types';
import { ProgramUnderstandingView } from '../programs/ProgramUnderstandingView';
import type { ProgramMainView } from '../programs/programViews';
import { ResearchSidePanel } from '../research/ResearchSidePanel';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import type { SessionMainView } from './sessionViews';

export const MainSessionWorkspace = memo(function MainSessionWorkspace({
  detail,
  events,
  graph,
  programView,
  researchPanelCollapsed,
  runCount,
  scope,
  selectedRunId,
  selectedTraceEventId,
  searchHighlightQuery,
  semantic,
  sessionView,
  visibleTraceCategories,
  busy,
  traceFilterCount,
  totalTraceFilterCount,
  onExpandResearchPanel,
  onOpenTraceFilters,
  onSelectTraceEvent,
  onSessionAction,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  graph: ProjectGraphSummary | null;
  programView: ProgramMainView;
  researchPanelCollapsed: boolean;
  runCount: number;
  scope: ProgramScopeVersion | null;
  selectedRunId: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  semantic: ProjectSemanticSummary | null;
  sessionView: SessionMainView;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  onExpandResearchPanel: () => void;
  onOpenTraceFilters: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  if (!selectedRunId) return <ProgramUnderstandingView graph={graph} programView={programView} runCount={runCount} scope={scope} semantic={semantic} />;

  if (sessionView === 'graph') {
    return <SessionGraphWorkspace />;
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
        traceFilterCount={traceFilterCount}
        totalTraceFilterCount={totalTraceFilterCount}
        visibleTraceCategories={visibleTraceCategories}
        onOpenTraceFilters={onOpenTraceFilters}
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

function SessionGraphWorkspace(): JSX.Element {
  return (
    <div className="program-graph-workspace" aria-label="Session graph view">
      <div className="program-graph-placeholder">
        <span className="program-graph-placeholder-icon" aria-hidden="true">
          <Network size={22} />
        </span>
        <strong>Session Graph</strong>
      </div>
    </div>
  );
}
