import { memo } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { HoneycrispMemorySummary, WorkspaceScopeVersion, RunDetail, SteeringAction } from '@shared/types';
import { WorkspaceUnderstandingView } from '../workspaces/WorkspaceUnderstandingView';
import { ResearchSidePanel } from '../research/MemorySidePanel';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { ContextSessionView } from './ContextSessionView';
import { SessionViewControls } from './SessionHeaderControls';
import type { SessionMainView } from './sessionViews';
import {
  MIN_RESEARCH_SIDE_PANEL_WIDTH,
  useResizableResearchSidePanel
} from '../../hooks/useResizableResearchSidePanel';

export const MainSessionWorkspace = memo(function MainSessionWorkspace({
  detail,
  events,
  allEvents,
  honeycrispMemory,
  runCount,
  scope,
  selectedRunId,
  selectedSubagentPath,
  selectedTraceEventId,
  searchHighlightQuery,
  sessionView,
  visibleTraceCategories,
  busy,
  traceFilterCount,
  totalTraceFilterCount,
  onOpenTraceFilters,
  onOpenHoneycrispMemoryDirectory,
  onBackToMain,
  onSelectTraceEvent,
  onSelectSubagent,
  onSessionAction,
  onSessionViewChange,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  allEvents: TraceDisplayEvent[];
  honeycrispMemory: HoneycrispMemorySummary | null;
  runCount: number;
  scope: WorkspaceScopeVersion | null;
  selectedRunId: string | null;
  selectedSubagentPath: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  sessionView: SessionMainView;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  onOpenTraceFilters: () => void;
  onOpenHoneycrispMemoryDirectory: (name: HoneycrispMemorySummary['directories'][number]['name']) => void;
  onBackToMain: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSelectSubagent: (path: string) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSessionViewChange: (view: SessionMainView) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  const {
    containerRef,
    panelWidth,
    maximumPanelWidth,
    beginResize,
    handleResizeKeyDown
  } = useResizableResearchSidePanel(selectedRunId !== null && sessionView === 'list');

  if (!selectedRunId) {
    return (
      <WorkspaceUnderstandingView
        busy={busy}
        honeycrispMemory={honeycrispMemory}
        runCount={runCount}
        scope={scope}
        onOpenHoneycrispMemoryDirectory={onOpenHoneycrispMemoryDirectory}
      />
    );
  }

  return (
    <div className={`session-content-workspace view-${sessionView}`}>
      <div className="session-content-view-controls">
        <SessionViewControls
          sessionView={sessionView}
          onSessionViewChange={onSessionViewChange}
        />
      </div>
      {sessionView === 'context' ? (
        <ContextSessionView honeycrispMemory={detail?.honeycrispMemory ?? null} selectedRunId={selectedRunId} />
      ) : (
        <div
          ref={containerRef}
          className="main-session-grid"
          style={{ '--research-side-panel-width': `${panelWidth}px` } as CSSProperties}
        >
          <TraceView
            busy={busy}
            detail={detail}
            events={events}
            selectedRunId={selectedRunId}
            traceScopeKey={selectedSubagentPath ?? 'main'}
            showBackToMain={selectedSubagentPath !== null}
            selectedTraceEventId={selectedTraceEventId}
            searchHighlightQuery={searchHighlightQuery}
            traceFilterCount={traceFilterCount}
            totalTraceFilterCount={totalTraceFilterCount}
            visibleTraceCategories={visibleTraceCategories}
            onOpenTraceFilters={onOpenTraceFilters}
            onBackToMain={onBackToMain}
            onSelectTraceEvent={onSelectTraceEvent}
            onSessionAction={onSessionAction}
            onSteerInstruction={onSteerInstruction}
          />
          <div
            className="research-side-resize-handle"
            role="separator"
            aria-label="Resize Memory and Subagents sidebar"
            aria-orientation="vertical"
            aria-valuemin={MIN_RESEARCH_SIDE_PANEL_WIDTH}
            aria-valuemax={maximumPanelWidth}
            aria-valuenow={panelWidth}
            tabIndex={0}
            onKeyDown={handleResizeKeyDown}
            onPointerDown={beginResize}
          />
          <ResearchSidePanel
            events={allEvents}
            memory={detail?.honeycrispMemory ?? null}
            runId={selectedRunId}
            selectedSubagentPath={selectedSubagentPath}
            onSelectSubagent={onSelectSubagent}
          />
        </div>
      )}
    </div>
  );
});
