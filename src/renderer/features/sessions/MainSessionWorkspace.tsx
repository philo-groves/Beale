import { memo } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { HoneycrispMemorySummary, HoneycrispRunbookDocument, HoneycrispRunbookSummary, ResearchModelSelection, ResearchProfile, ResearchProviderModelCatalog, ResearchSubject, SteeringAction, WorkspaceScopeVersion, RunDetail } from '@shared/types';
import { WorkspaceUnderstandingView } from '../workspaces/WorkspaceUnderstandingView';
import { ResearchSidePanel } from '../research/MemorySidePanel';
import { CommentaryView } from '../commentary/CommentaryView';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { ChatView } from '../../view-models/chatView';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import {
  MIN_RESEARCH_SIDE_PANEL_WIDTH,
  useResizableResearchSidePanel
} from '../../hooks/useResizableResearchSidePanel';

export const MainSessionWorkspace = memo(function MainSessionWorkspace({
  detail,
  events,
  allEvents,
  chatView,
  providerModelCatalog,
  honeycrispMemory,
  researchProfile,
  researchSubject,
  runCount,
  scope,
  selectedRunId,
  researchDetailsOpen,
  selectedRunbookId,
  selectedRunbook,
  selectedRunbookDocument,
  runbookLoading,
  runbookError,
  selectedSubagentPath,
  selectedTraceEventId,
  searchHighlightQuery,
  visibleTraceCategories,
  busy,
  memoryDreamingInProgress,
  traceFilterCount,
  totalTraceFilterCount,
  onOpenTraceFilters,
  onOpenHoneycrispMemoryDirectory,
  onRestoreMemoryDreamingChange,
  onRunMemoryDreaming,
  onResearchDetailsOpenChange,
  onOpenHoneycrispRunbook,
  onBackToRunbooks,
  onBackToSubagents,
  onSelectTraceEvent,
  onSelectSubagent,
  onSessionAction,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  allEvents: TraceDisplayEvent[];
  chatView: ChatView;
  providerModelCatalog: ResearchProviderModelCatalog[];
  honeycrispMemory: HoneycrispMemorySummary | null;
  researchProfile: ResearchProfile | null;
  researchSubject: ResearchSubject | null;
  runCount: number;
  scope: WorkspaceScopeVersion | null;
  selectedRunId: string | null;
  researchDetailsOpen: boolean;
  selectedRunbookId: string | null;
  selectedRunbook: HoneycrispRunbookSummary | null;
  selectedRunbookDocument: HoneycrispRunbookDocument | null;
  runbookLoading: boolean;
  runbookError: string | null;
  selectedSubagentPath: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  memoryDreamingInProgress: boolean;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  onOpenTraceFilters: () => void;
  onOpenHoneycrispMemoryDirectory: (name: HoneycrispMemorySummary['directories'][number]['name']) => void;
  onRestoreMemoryDreamingChange: (changeId: string) => void;
  onRunMemoryDreaming: () => void;
  onResearchDetailsOpenChange: (expanded: boolean) => void;
  onOpenHoneycrispRunbook: (runbookId: string) => void;
  onBackToRunbooks: () => void;
  onBackToSubagents: () => void;
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
        memoryDreamingInProgress={memoryDreamingInProgress}
        honeycrispMemory={honeycrispMemory}
        researchProfile={researchProfile}
        researchSubject={researchSubject}
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
      className={`main-session-grid ${researchDetailsOpen ? 'research-details-open' : ''}`}
      style={{ '--research-side-panel-width': `${panelWidth}px` } as CSSProperties}
    >
      {chatView === 'commentary' ? (
        <CommentaryView
          busy={busy}
          detail={detail}
          events={events}
          providerModelCatalog={providerModelCatalog}
          selectedRunId={selectedRunId}
          showBackToMain={false}
          selectedTraceEventId={selectedTraceEventId}
          searchHighlightQuery={searchHighlightQuery}
          onBackToMain={() => undefined}
          onSessionAction={onSessionAction}
          onSteerInstruction={onSteerInstruction}
        />
      ) : (
        <TraceView
          busy={busy}
          detail={detail}
          events={events}
          providerModelCatalog={providerModelCatalog}
          selectedRunId={selectedRunId}
          traceScopeKey="main"
          showBackToMain={false}
          selectedTraceEventId={selectedTraceEventId}
          searchHighlightQuery={searchHighlightQuery}
          traceFilterCount={traceFilterCount}
          totalTraceFilterCount={totalTraceFilterCount}
          visibleTraceCategories={visibleTraceCategories}
          onOpenTraceFilters={onOpenTraceFilters}
          onBackToMain={() => undefined}
          onSelectTraceEvent={onSelectTraceEvent}
          onSessionAction={onSessionAction}
          onSteerInstruction={onSteerInstruction}
        />
      )}
      <div
        className="research-side-resize-handle"
        role="separator"
        aria-label="Resize Memory, Runbooks, and Subagents sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN_RESEARCH_SIDE_PANEL_WIDTH}
        aria-valuemax={maximumPanelWidth}
        aria-valuenow={panelWidth}
        aria-hidden={researchDetailsOpen}
        tabIndex={researchDetailsOpen ? -1 : 0}
        onKeyDown={researchDetailsOpen ? undefined : handleResizeKeyDown}
        onPointerDown={researchDetailsOpen ? undefined : beginResize}
      />
      <ResearchSidePanel
        chatView={chatView}
        detail={detail}
        events={allEvents}
        memory={detail?.honeycrispMemory ?? null}
        researchProfile={researchProfile}
        providerModelCatalog={providerModelCatalog}
        runId={selectedRunId}
        runStatus={detail?.run.status ?? null}
        expanded={researchDetailsOpen}
        selectedRunbook={selectedRunbook}
        selectedRunbookDocument={selectedRunbookDocument}
        selectedRunbookId={selectedRunbookId}
        runbookLoading={runbookLoading}
        runbookError={runbookError}
        selectedSubagentPath={selectedSubagentPath}
        selectedTraceEventId={selectedTraceEventId}
        searchHighlightQuery={searchHighlightQuery}
        visibleTraceCategories={visibleTraceCategories}
        onSelectSubagent={onSelectSubagent}
        onOpenRunbook={onOpenHoneycrispRunbook}
        onBackToRunbooks={onBackToRunbooks}
        onBackToSubagents={onBackToSubagents}
        onSelectTraceEvent={onSelectTraceEvent}
        onExpandedChange={onResearchDetailsOpenChange}
      />
    </div>
  );
});
