import { memo } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { ApprovalRecord, HoneycrispMemorySummary, HoneycrispReportDocument, HoneycrispReportSummary, HoneycrispRunbookDocument, HoneycrispRunbookSummary, MemoryDreamingProgressUpdate, PolicyReviewDecision, ProjectGraphSummary, ProjectSemanticSummary, ResearchModelSelection, ResearchProfile, ResearchProviderModelCatalog, RunDetail, RunRow, ScopeAssetInput, SteeringAction, WorkspaceDejunkSummary, WorkspaceScopeVersion } from '@shared/types';
import { WorkspaceHousekeepingPanel, WorkspaceUnderstandingView } from '../workspaces/WorkspaceUnderstandingView';
import { ResearchSidePanel } from '../research/MemorySidePanel';
import { CommentaryView } from '../commentary/CommentaryView';
import { BreakoutRoomView } from './BreakoutRoomView';
import { TraceView } from '../traces/TraceView';
import { isEndedResearchRunStatus, SessionNextSteps, type ResearchGoalSeed } from './SessionNextSteps';
import type { TraceCategoryId } from '../../traceClassification';
import type { ChatView } from '../../view-models/chatView';
import { EMPTY_SESSION_HEAT_PREFERENCES } from '../../view-models/sessionHeat';
import type { SessionHeatPreferences } from '../../view-models/sessionHeat';
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
  activeScope = null,
  projectGraph = null,
  projectSemantic = null,
  researchProfile,
  sessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES,
  workspaceName,
  runs,
  selectedRunId,
  selectedBreakoutRoomId = null,
  researchDetailsOpen,
  selectedRunbookId,
  selectedRunbook,
  selectedRunbookDocument,
  runbookLoading,
  runbookError,
  selectedReportId = null,
  selectedReport = null,
  selectedReportDocument = null,
  reportLoading = false,
  reportError = null,
  selectedSubagentPath,
  selectedTraceEventId,
  searchHighlightQuery,
  shellApproval = null,
  shellApprovalBusy = false,
  visibleTraceCategories,
  busy,
  workspaceDejunk = null,
  workspaceDejunkInProgress = false,
  memoryDreamingInProgress,
  memoryDreamingProgress = null,
  traceFilterCount,
  totalTraceFilterCount,
  onOpenTraceFilters,
  onRunWorkspaceDejunk = () => undefined,
  onRunMemoryDreaming,
  onAddWorkspaceResource = async () => undefined,
  onChangeWorkspaceResource = async () => undefined,
  onOpenSession = () => undefined,
  onResearchDetailsOpenChange,
  onOpenHoneycrispRunbook,
  onBackToRunbooks,
  onOpenHoneycrispReport = () => undefined,
  onBackToReports = () => undefined,
  onBackToSubagents,
  onSelectTraceEvent,
  onSelectSubagent,
  onSelectNextStep,
  onShellApprovalDecision = () => undefined,
  onSessionAction,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  allEvents: TraceDisplayEvent[];
  chatView: ChatView;
  providerModelCatalog: ResearchProviderModelCatalog[];
  honeycrispMemory: HoneycrispMemorySummary | null;
  activeScope?: WorkspaceScopeVersion | null;
  projectGraph?: ProjectGraphSummary | null;
  projectSemantic?: ProjectSemanticSummary | null;
  researchProfile: ResearchProfile | null;
  sessionHeatPreferences?: SessionHeatPreferences;
  workspaceName: string;
  runs: RunRow[];
  selectedRunId: string | null;
  selectedBreakoutRoomId?: string | null;
  researchDetailsOpen: boolean;
  selectedRunbookId: string | null;
  selectedRunbook: HoneycrispRunbookSummary | null;
  selectedRunbookDocument: HoneycrispRunbookDocument | null;
  runbookLoading: boolean;
  runbookError: string | null;
  selectedReportId?: string | null;
  selectedReport?: HoneycrispReportSummary | null;
  selectedReportDocument?: HoneycrispReportDocument | null;
  reportLoading?: boolean;
  reportError?: string | null;
  selectedSubagentPath: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  shellApproval?: ApprovalRecord | null;
  shellApprovalBusy?: boolean;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  workspaceDejunk?: WorkspaceDejunkSummary | null;
  workspaceDejunkInProgress?: boolean;
  memoryDreamingInProgress: boolean;
  memoryDreamingProgress?: MemoryDreamingProgressUpdate | null;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  onOpenTraceFilters: () => void;
  onRunWorkspaceDejunk?: () => void;
  onRunMemoryDreaming: () => void;
  onAddWorkspaceResource?: (asset: ScopeAssetInput) => Promise<void>;
  onChangeWorkspaceResource?: (assetIds: string[], asset: ScopeAssetInput | null) => Promise<void>;
  onOpenSession?: (runId: string) => void;
  onResearchDetailsOpenChange: (expanded: boolean) => void;
  onOpenHoneycrispRunbook: (runbookId: string) => void;
  onBackToRunbooks: () => void;
  onOpenHoneycrispReport?: (reportId: string) => void;
  onBackToReports?: () => void;
  onBackToSubagents: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSelectSubagent: (path: string) => void;
  onSelectNextStep: (goal: ResearchGoalSeed) => void;
  onShellApprovalDecision?: (decision: PolicyReviewDecision) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element | null {
  const {
    containerRef,
    panelWidth,
    maximumPanelWidth,
    beginResize,
    handleResizeKeyDown
  } = useResizableResearchSidePanel(selectedRunId !== null || honeycrispMemory !== null);
  const viewSpace = selectedRunId ? 'session' : 'workspace';
  const researchSidePanelKey = selectedRunId ?? `workspace:${honeycrispMemory?.contextWorkspaceId ?? 'current'}`;

  const postSessionContent = detail && isEndedResearchRunStatus(detail.run.status)
    ? <SessionNextSteps detail={detail} onSelect={onSelectNextStep} />
    : null;

  return (
    <div
      ref={containerRef}
      className={`main-session-grid ${researchDetailsOpen ? 'research-details-open' : ''}`}
      style={{ '--research-side-panel-width': `${panelWidth}px` } as CSSProperties}
    >
      {!selectedRunId ? (
        <WorkspaceUnderstandingView
          busy={busy}
          activeScope={activeScope}
          workspaceDejunk={workspaceDejunk}
          workspaceDejunkInProgress={workspaceDejunkInProgress}
          memoryDreamingInProgress={memoryDreamingInProgress}
          memoryDreamingProgress={memoryDreamingProgress}
          honeycrispMemory={honeycrispMemory}
          projectGraph={projectGraph}
          projectSemantic={projectSemantic}
          researchProfile={researchProfile}
          workspaceName={workspaceName}
          runs={runs}
          onRunWorkspaceDejunk={onRunWorkspaceDejunk}
          onRunMemoryDreaming={onRunMemoryDreaming}
          onAddResource={onAddWorkspaceResource}
          onChangeResource={onChangeWorkspaceResource}
          onOpenSession={onOpenSession}
        />
      ) : selectedBreakoutRoomId ? (
        <BreakoutRoomView
          detail={detail}
          events={allEvents}
          providerModelCatalog={providerModelCatalog}
          roomId={selectedBreakoutRoomId}
          onSelectSubagent={onSelectSubagent}
        />
      ) : chatView === 'commentary' ? (
        <CommentaryView
          busy={busy}
          detail={detail}
          events={events}
          providerModelCatalog={providerModelCatalog}
          selectedRunId={selectedRunId}
          showBackToMain={false}
          selectedTraceEventId={selectedTraceEventId}
          searchHighlightQuery={searchHighlightQuery}
          shellApproval={shellApproval}
          shellApprovalBusy={shellApprovalBusy}
          postSessionContent={postSessionContent}
          onBackToMain={() => undefined}
          onShellApprovalDecision={onShellApprovalDecision}
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
          shellApproval={shellApproval}
          shellApprovalBusy={shellApprovalBusy}
          postSessionContent={postSessionContent}
          traceFilterCount={traceFilterCount}
          totalTraceFilterCount={totalTraceFilterCount}
          visibleTraceCategories={visibleTraceCategories}
          onOpenTraceFilters={onOpenTraceFilters}
          onBackToMain={() => undefined}
          onSelectTraceEvent={onSelectTraceEvent}
          onShellApprovalDecision={onShellApprovalDecision}
          onSessionAction={onSessionAction}
          onSteerInstruction={onSteerInstruction}
        />
      )}
      <div
        className="research-side-resize-handle"
        role="separator"
        aria-label={selectedRunId ? 'Resize Runbooks, Reports, Subagents, and Memories sidebar' : 'Resize Runbooks, Reports, and Memories sidebar'}
        aria-orientation="vertical"
        aria-valuemin={MIN_RESEARCH_SIDE_PANEL_WIDTH}
        aria-valuemax={maximumPanelWidth}
        aria-valuenow={panelWidth}
        aria-hidden={researchDetailsOpen}
        tabIndex={researchDetailsOpen ? -1 : 0}
        onKeyDown={researchDetailsOpen ? undefined : handleResizeKeyDown}
        onPointerDown={researchDetailsOpen ? undefined : beginResize}
      />
      <div className={`research-side-column ${!selectedRunId && !researchDetailsOpen ? 'workspace-side-stack' : ''}`.trim()}>
        <ResearchSidePanel
          chatView={chatView}
          detail={detail}
          events={allEvents}
          memory={viewSpace === 'workspace' ? honeycrispMemory : detail?.honeycrispMemory ?? null}
          researchProfile={researchProfile}
          sessionHeatPreferences={sessionHeatPreferences}
          providerModelCatalog={providerModelCatalog}
          runId={researchSidePanelKey}
          runStatus={detail?.run.status ?? null}
          expanded={researchDetailsOpen}
          selectedRunbook={selectedRunbook}
          selectedRunbookDocument={selectedRunbookDocument}
          selectedRunbookId={selectedRunbookId}
          runbookLoading={runbookLoading}
          runbookError={runbookError}
          selectedReport={selectedReport}
          selectedReportDocument={selectedReportDocument}
          selectedReportId={selectedReportId}
          reportLoading={reportLoading}
          reportError={reportError}
          selectedSubagentPath={selectedSubagentPath}
          selectedTraceEventId={selectedTraceEventId}
          searchHighlightQuery={searchHighlightQuery}
          visibleTraceCategories={visibleTraceCategories}
          onSelectSubagent={onSelectSubagent}
          onOpenRunbook={onOpenHoneycrispRunbook}
          onBackToRunbooks={onBackToRunbooks}
          onOpenReport={onOpenHoneycrispReport}
          onBackToReports={onBackToReports}
          onBackToSubagents={onBackToSubagents}
          onSelectTraceEvent={onSelectTraceEvent}
          onExpandedChange={onResearchDetailsOpenChange}
          viewSpace={viewSpace}
        />
        {!selectedRunId && !researchDetailsOpen ? (
          <WorkspaceHousekeepingPanel
            busy={busy}
            honeycrispMemory={honeycrispMemory}
            memoryDreamingInProgress={memoryDreamingInProgress}
            memoryDreamingProgress={memoryDreamingProgress}
            researchProfile={researchProfile}
            runs={runs}
            workspaceDejunk={workspaceDejunk}
            workspaceDejunkInProgress={workspaceDejunkInProgress}
            onRunMemoryDreaming={onRunMemoryDreaming}
            onRunWorkspaceDejunk={onRunWorkspaceDejunk}
          />
        ) : null}
      </div>
    </div>
  );
});
