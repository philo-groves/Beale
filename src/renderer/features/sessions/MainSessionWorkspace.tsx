import { memo } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { HoneycrispMemorySummary, HoneycrispRunbookDocument, HoneycrispRunbookSummary, ResearchModelSelection, ResearchProviderModelCatalog, SteeringAction, WorkspaceScopeVersion, RunDetail } from '@shared/types';
import { WorkspaceUnderstandingView } from '../workspaces/WorkspaceUnderstandingView';
import { ResearchSidePanel } from '../research/MemorySidePanel';
import { RunbookView } from '../research/RunbookView';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import {
  MIN_RESEARCH_SIDE_PANEL_WIDTH,
  useResizableResearchSidePanel
} from '../../hooks/useResizableResearchSidePanel';

export const MainSessionWorkspace = memo(function MainSessionWorkspace({
  detail,
  events,
  allEvents,
  providerModelCatalog,
  honeycrispMemory,
  runCount,
  scope,
  selectedRunId,
  selectedRunbook,
  selectedRunbookDocument,
  runbookLoading,
  runbookError,
  selectedSubagentPath,
  selectedTraceEventId,
  searchHighlightQuery,
  visibleTraceCategories,
  busy,
  traceFilterCount,
  totalTraceFilterCount,
  onOpenTraceFilters,
  onOpenHoneycrispMemoryDirectory,
  onRestoreMemoryDreamingChange,
  onRunMemoryDreaming,
  onOpenHoneycrispRunbook,
  onBackToMain,
  onSelectTraceEvent,
  onSelectSubagent,
  onSessionAction,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  allEvents: TraceDisplayEvent[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  honeycrispMemory: HoneycrispMemorySummary | null;
  runCount: number;
  scope: WorkspaceScopeVersion | null;
  selectedRunId: string | null;
  selectedRunbook: HoneycrispRunbookSummary | null;
  selectedRunbookDocument: HoneycrispRunbookDocument | null;
  runbookLoading: boolean;
  runbookError: string | null;
  selectedSubagentPath: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  onOpenTraceFilters: () => void;
  onOpenHoneycrispMemoryDirectory: (name: HoneycrispMemorySummary['directories'][number]['name']) => void;
  onRestoreMemoryDreamingChange: (changeId: string) => void;
  onRunMemoryDreaming: () => void;
  onOpenHoneycrispRunbook: (runbookId: string) => void;
  onBackToMain: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSelectSubagent: (path: string) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element | null {
  const {
    containerRef,
    panelWidth,
    maximumPanelWidth,
    beginResize,
    handleResizeKeyDown
  } = useResizableResearchSidePanel(selectedRunId !== null);

  if (!selectedRunId) {
    return (
      <WorkspaceUnderstandingView
        busy={busy}
        honeycrispMemory={honeycrispMemory}
        runCount={runCount}
        scope={scope}
        onOpenHoneycrispMemoryDirectory={onOpenHoneycrispMemoryDirectory}
        onRestoreMemoryDreamingChange={onRestoreMemoryDreamingChange}
        onRunMemoryDreaming={onRunMemoryDreaming}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="main-session-grid"
      style={{ '--research-side-panel-width': `${panelWidth}px` } as CSSProperties}
    >
      {selectedRunbook ? <RunbookView
        document={selectedRunbookDocument}
        error={runbookError}
        loading={runbookLoading}
        runbook={selectedRunbook}
        onBackToMain={onBackToMain}
      /> : <TraceView
        busy={busy}
        detail={detail}
        events={events}
        providerModelCatalog={providerModelCatalog}
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
      />}
      <div
        className="research-side-resize-handle"
        role="separator"
        aria-label="Resize Memory, Runbooks, and Subagents sidebar"
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
        runStatus={detail?.run.status ?? null}
        selectedRunbookId={selectedRunbook?.id ?? null}
        selectedSubagentPath={selectedSubagentPath}
        onSelectSubagent={onSelectSubagent}
        onOpenRunbook={onOpenHoneycrispRunbook}
      />
    </div>
  );
});
