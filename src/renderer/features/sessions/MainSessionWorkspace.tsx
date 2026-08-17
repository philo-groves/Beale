import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { ApprovalRecord, HoneycrispMemorySummary, HoneycrispReportDocument, HoneycrispReportSummary, HoneycrispRunbookDocument, HoneycrispRunbookSummary, MemoryDreamingProgressUpdate, PolicyReviewDecision, ResearchModelSelection, ResearchProfile, ResearchProviderModelCatalog, RunDetail, RunRow, ScopeAssetInput, SteeringAction, WorkspaceDejunkSummary, WorkspaceScopeVersion } from '@shared/types';
import { WorkspaceUnderstandingView } from '../workspaces/WorkspaceUnderstandingView';
import type { WorkspaceConfigurationInput } from '../workspaces/WorkspaceUnderstandingView';
import { ResearchSidePanel } from '../research/MemorySidePanel';
import { CommentaryView } from '../commentary/CommentaryView';
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
  researchProfile,
  sessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES,
  researchSubjectName = '',
  workspacePath = '',
  workspaceDirectories,
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
  onSaveWorkspaceConfiguration = async () => undefined,
  onChangeWorkspaceDirectories = async () => undefined,
  onOpenSession = () => undefined,
  onResearchDetailsOpenChange,
  onOpenHoneycrispRunbook,
  onBackToRunbooks,
  onOpenHoneycrispReport = () => undefined,
  onBackToReports = () => undefined,
  onOpenBreakoutRoom = () => undefined,
  onBackToRooms = () => undefined,
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
  researchProfile: ResearchProfile | null;
  sessionHeatPreferences?: SessionHeatPreferences;
  researchSubjectName?: string;
  workspacePath?: string;
  workspaceDirectories?: readonly string[];
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
  onSaveWorkspaceConfiguration?: (configuration: WorkspaceConfigurationInput) => Promise<void>;
  onChangeWorkspaceDirectories?: (directories: string[]) => Promise<void>;
  onOpenSession?: (runId: string) => void;
  onResearchDetailsOpenChange: (expanded: boolean) => void;
  onOpenHoneycrispRunbook: (runbookId: string) => void;
  onBackToRunbooks: () => void;
  onOpenHoneycrispReport?: (reportId: string) => void;
  onBackToReports?: () => void;
  onOpenBreakoutRoom?: (roomId: string) => void;
  onBackToRooms?: () => void;
  onBackToSubagents: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSelectSubagent: (path: string) => void;
  onSelectNextStep: (goal: ResearchGoalSeed) => void;
  onShellApprovalDecision?: (decision: PolicyReviewDecision) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element | null {
  const [selectedWorkspaceMemoryId, setSelectedWorkspaceMemoryId] = useState<string | null>(null);
  const showResearchSidePanel = selectedRunId !== null || researchDetailsOpen;
  const {
    containerRef,
    panelWidth,
    maximumPanelWidth,
    beginResize,
    handleResizeKeyDown
  } = useResizableResearchSidePanel(showResearchSidePanel);
  const viewSpace = selectedRunId ? 'session' : 'workspace';
  const researchSidePanelKey = selectedRunId ?? `workspace:${honeycrispMemory?.contextWorkspaceId ?? 'current'}`;
  const previousRunRef = useRef<{ id: string; status: RunDetail['run']['status'] } | null>(null);
  const currentRun = detail ? { id: detail.run.id, status: detail.run.status } : null;
  const autoGenerateNextSteps = shouldAutoGenerateSessionNextSteps(previousRunRef.current, currentRun);
  useEffect(() => {
    previousRunRef.current = currentRun;
  }, [currentRun?.id, currentRun?.status]);
  useEffect(() => {
    setSelectedWorkspaceMemoryId(null);
  }, [honeycrispMemory?.contextWorkspaceId, selectedRunId]);

  const openWorkspaceMemory = (nodeId: string): void => {
    onBackToRunbooks();
    setSelectedWorkspaceMemoryId(nodeId);
    onResearchDetailsOpenChange(true);
  };
  const openWorkspaceRunbook = (runbookId: string): void => {
    setSelectedWorkspaceMemoryId(null);
    onOpenHoneycrispRunbook(runbookId);
    onResearchDetailsOpenChange(true);
  };
  const closeWorkspaceMemory = (): void => {
    setSelectedWorkspaceMemoryId(null);
    onResearchDetailsOpenChange(false);
  };
  const closeWorkspaceRunbook = (): void => {
    onBackToRunbooks();
    onResearchDetailsOpenChange(false);
  };
  const changeResearchDetailsOpen = (expanded: boolean): void => {
    if (!expanded && !selectedRunId) setSelectedWorkspaceMemoryId(null);
    onResearchDetailsOpenChange(expanded);
  };

  const postSessionContent = detail && isEndedResearchRunStatus(detail.run.status)
    ? (
        <SessionNextSteps
          key={detail.run.id}
          detail={detail}
          autoGenerate={autoGenerateNextSteps}
          onSelect={onSelectNextStep}
        />
      )
    : null;

  return (
    <div
      ref={containerRef}
      className={`main-session-grid${researchDetailsOpen ? ' research-details-open' : ''}${showResearchSidePanel ? '' : ' workspace-main-only'}`}
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
          researchProfile={researchProfile}
          researchSubjectName={researchSubjectName}
          workspacePath={workspacePath}
          workspaceDirectories={workspaceDirectories}
          workspaceName={workspaceName}
          runs={runs}
          onRunWorkspaceDejunk={onRunWorkspaceDejunk}
          onRunMemoryDreaming={onRunMemoryDreaming}
          onAddResource={onAddWorkspaceResource}
          onChangeResource={onChangeWorkspaceResource}
          onSaveConfiguration={onSaveWorkspaceConfiguration}
          onChangeWorkspaceDirectories={onChangeWorkspaceDirectories}
          onOpenSession={onOpenSession}
          onOpenMemory={openWorkspaceMemory}
          onOpenRunbook={openWorkspaceRunbook}
        />
      ) : chatView === 'commentary' ? (
        <CommentaryView
          busy={busy}
          detail={detail}
          events={events}
          activeScope={activeScope}
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
      {showResearchSidePanel ? (
        <div
          className="research-side-resize-handle"
          role="separator"
          aria-label={selectedRunId ? 'Resize Runbooks, Reports, Subagents, and Memories sidebar' : 'Resize workspace detail sidebar'}
          aria-orientation="vertical"
          aria-valuemin={MIN_RESEARCH_SIDE_PANEL_WIDTH}
          aria-valuemax={maximumPanelWidth}
          aria-valuenow={panelWidth}
          aria-hidden={researchDetailsOpen}
          tabIndex={researchDetailsOpen ? -1 : 0}
          onKeyDown={researchDetailsOpen ? undefined : handleResizeKeyDown}
          onPointerDown={researchDetailsOpen ? undefined : beginResize}
        />
      ) : null}
      {showResearchSidePanel ? <div className="research-side-column">
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
          selectedMemoryNodeId={!selectedRunId ? selectedWorkspaceMemoryId : undefined}
          runbookLoading={runbookLoading}
          runbookError={runbookError}
          selectedReport={selectedReport}
          selectedReportDocument={selectedReportDocument}
          selectedReportId={selectedReportId}
          reportLoading={reportLoading}
          reportError={reportError}
          selectedBreakoutRoomId={selectedBreakoutRoomId}
          selectedSubagentPath={selectedSubagentPath}
          selectedTraceEventId={selectedTraceEventId}
          searchHighlightQuery={searchHighlightQuery}
          visibleTraceCategories={visibleTraceCategories}
          onSelectSubagent={onSelectSubagent}
          onOpenRunbook={selectedRunId ? onOpenHoneycrispRunbook : openWorkspaceRunbook}
          onBackToRunbooks={selectedRunId ? onBackToRunbooks : closeWorkspaceRunbook}
          onBackToMemory={!selectedRunId ? closeWorkspaceMemory : undefined}
          onOpenReport={onOpenHoneycrispReport}
          onBackToReports={onBackToReports}
          onOpenBreakoutRoom={onOpenBreakoutRoom}
          onBackToRooms={onBackToRooms}
          onBackToSubagents={onBackToSubagents}
          onSelectTraceEvent={onSelectTraceEvent}
          onExpandedChange={changeResearchDetailsOpen}
          viewSpace={viewSpace}
        />
      </div> : null}
    </div>
  );
});

export function shouldAutoGenerateSessionNextSteps(
  previous: { id: string; status: RunDetail['run']['status'] } | null,
  current: { id: string; status: RunDetail['run']['status'] } | null
): boolean {
  return Boolean(
    previous
    && current
    && previous.id === current.id
    && !isEndedResearchRunStatus(previous.status)
    && isEndedResearchRunStatus(current.status)
  );
}
