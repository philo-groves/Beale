import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { ApprovalRecord, HoneycrispMemorySummary, HoneycrispReportDocument, HoneycrispReportSummary, HoneycrispRunbookDocument, HoneycrispRunbookSummary, MemoryDreamingProgressUpdate, PolicyReviewDecision, ResearchModelSelection, ResearchProfile, ResearchProviderModelCatalog, RunDetail, RunRow, RunbookProofTarget, RunbookProofTargetSelection, ScopeAssetInput, SteeringAction, TraceEventRecord, WorkspaceDejunkSummary, WorkspaceScopeVersion } from '@shared/types';
import { WorkspaceUnderstandingView } from '../workspaces/WorkspaceUnderstandingView';
import type { WorkspaceConfigurationInput } from '../workspaces/WorkspaceUnderstandingView';
import { ResearchSidePanel } from '../research/MemorySidePanel';
import { CommentaryView } from '../commentary/CommentaryView';
import { TraceView } from '../traces/TraceView';
import { ConnectedDeviceCapture } from '../deviceCapture/ConnectedDeviceCapture';
import { isEndedResearchRunStatus, SessionNextSteps, type ResearchGoalSeed } from './SessionNextSteps';
import type { TraceCategoryId } from '../../traceClassification';
import type { ChatView } from '../../view-models/chatView';
import { EMPTY_SESSION_HEAT_PREFERENCES } from '../../view-models/sessionHeat';
import type { SessionHeatPreferences } from '../../view-models/sessionHeat';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import {
  MIN_TRACE_PANEL_WIDTH,
  RESEARCH_SIDE_RESIZE_HANDLE_WIDTH,
  MIN_RESEARCH_SIDE_PANEL_WIDTH,
  useResizableResearchSidePanel
} from '../../hooks/useResizableResearchSidePanel';

const WORKSPACE_DETAIL_TRANSITION_MS = 220;
const CONNECTED_DEVICE_DEFAULT_ASPECT_RATIO = 1290 / 2796;
const CONNECTED_DEVICE_CAPTURE_HORIZONTAL_INSET = 18;
const CONNECTED_DEVICE_CAPTURE_VERTICAL_INSET = 22;

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
  connectedDeviceCaptureEnabled = false,
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
  onCloneWorkspaceRepository = async () => undefined,
  onSaveWorkspaceConfiguration = async () => undefined,
  onChangeWorkspaceDirectories = async () => undefined,
  onOpenSession = () => undefined,
  onWorkspaceViewChange,
  onResearchDetailsOpenChange,
  onOpenHoneycrispRunbook,
  onRunHoneycrispRunbook = async () => undefined,
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
  connectedDeviceCaptureEnabled?: boolean;
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
  onCloneWorkspaceRepository?: (assetId: string) => Promise<void>;
  onSaveWorkspaceConfiguration?: (configuration: WorkspaceConfigurationInput) => Promise<void>;
  onChangeWorkspaceDirectories?: (directories: string[]) => Promise<void>;
  onOpenSession?: (runId: string) => void;
  onWorkspaceViewChange?: (viewName: string) => void;
  onResearchDetailsOpenChange: (expanded: boolean) => void;
  onOpenHoneycrispRunbook: (runbookId: string) => void;
  onRunHoneycrispRunbook?: (runbookId: string, cellId: string | undefined, target: RunbookProofTargetSelection) => Promise<void>;
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
  const [connectedDeviceCaptureVisible, setConnectedDeviceCaptureVisible] = useState(false);
  const [connectedDeviceCaptureExpanded, setConnectedDeviceCaptureExpanded] = useState(false);
  const [connectedDeviceOs, setConnectedDeviceOs] = useState<string | null>(null);
  const [connectedDeviceAspectRatio, setConnectedDeviceAspectRatio] = useState(CONNECTED_DEVICE_DEFAULT_ASPECT_RATIO);
  const [mainSessionSize, setMainSessionSize] = useState({ width: 0, height: 0 });
  const autoExpandedRunbookRunIdRef = useRef<string | null>(null);
  const workspaceView = selectedRunId === null;
  const [workspaceSidePanelMounted, setWorkspaceSidePanelMounted] = useState(workspaceView && researchDetailsOpen);
  const [workspaceSidePanelVisible, setWorkspaceSidePanelVisible] = useState(workspaceView && researchDetailsOpen);
  const showResearchSidePanel = selectedRunId !== null || workspaceSidePanelMounted;
  const visibleResearchDetails = selectedRunId !== null ? researchDetailsOpen : workspaceSidePanelVisible;
  const expandedResearchSidePanel = selectedRunId !== null ? researchDetailsOpen : workspaceSidePanelMounted;
  const researchSideResizeEnabled = selectedRunId !== null && !visibleResearchDetails && !connectedDeviceCaptureExpanded;
  const {
    containerRef,
    panelWidth,
    maximumPanelWidth,
    beginResize,
    handleResizeKeyDown
  } = useResizableResearchSidePanel(showResearchSidePanel);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const updateSize = (): void => {
      const bounds = container.getBoundingClientRect();
      setMainSessionSize((current) => current.width === bounds.width && current.height === bounds.height
        ? current
        : { width: bounds.width, height: bounds.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
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
  useEffect(() => {
    if (!workspaceView) {
      setWorkspaceSidePanelMounted(false);
      setWorkspaceSidePanelVisible(false);
      return;
    }
    let animationFrame: number | null = null;
    let closeTimer: number | null = null;
    if (researchDetailsOpen) {
      setWorkspaceSidePanelMounted(true);
      animationFrame = window.requestAnimationFrame(() => setWorkspaceSidePanelVisible(true));
    } else {
      setWorkspaceSidePanelVisible(false);
      closeTimer = window.setTimeout(() => {
        setWorkspaceSidePanelMounted(false);
        setSelectedWorkspaceMemoryId(null);
      }, WORKSPACE_DETAIL_TRANSITION_MS);
    }
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      if (closeTimer !== null) window.clearTimeout(closeTimer);
    };
  }, [researchDetailsOpen, workspaceView]);

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
    onResearchDetailsOpenChange(false);
  };
  const closeWorkspaceRunbook = (): void => {
    onBackToRunbooks();
    onResearchDetailsOpenChange(false);
  };
  const changeResearchDetailsOpen = (expanded: boolean): void => {
    onResearchDetailsOpenChange(expanded);
  };
  useEffect(() => {
    if (researchDetailsOpen) {
      autoExpandedRunbookRunIdRef.current = null;
      setConnectedDeviceCaptureExpanded(false);
    }
  }, [researchDetailsOpen]);
  useEffect(() => {
    if (!connectedDeviceCaptureVisible) {
      autoExpandedRunbookRunIdRef.current = null;
      setConnectedDeviceCaptureExpanded(false);
    }
  }, [connectedDeviceCaptureVisible]);
  const latestRunbookExecution = latestOverallRunbookExecution(detail?.traceEvents ?? []);
  useEffect(() => {
    if (!latestRunbookExecution) {
      if (autoExpandedRunbookRunIdRef.current) {
        autoExpandedRunbookRunIdRef.current = null;
        setConnectedDeviceCaptureExpanded(false);
      }
      return;
    }
    const running = latestRunbookExecution.status === 'queued' || latestRunbookExecution.status === 'running';
    if (
      running
      && !connectedDeviceCaptureExpanded
      && !researchDetailsOpen
      && connectedDeviceCaptureVisible
      && latestRunbookExecution.proofTarget === 'device'
      && isIosDeviceOs(latestRunbookExecution.deviceOs)
    ) {
      autoExpandedRunbookRunIdRef.current = latestRunbookExecution.runId;
      setConnectedDeviceCaptureExpanded(true);
      return;
    }
    if (!running && autoExpandedRunbookRunIdRef.current === latestRunbookExecution.runId) {
      autoExpandedRunbookRunIdRef.current = null;
      setConnectedDeviceCaptureExpanded(false);
    }
  }, [connectedDeviceCaptureVisible, latestRunbookExecution?.deviceOs, latestRunbookExecution?.proofTarget, latestRunbookExecution?.runId, latestRunbookExecution?.status, researchDetailsOpen]);

  const changeConnectedDeviceCaptureExpanded = (expanded: boolean): void => {
    autoExpandedRunbookRunIdRef.current = null;
    setConnectedDeviceCaptureExpanded(expanded);
  };
  const expandedDeviceCaptureWidth = useMemo(() => connectedDeviceCaptureExpanded
    ? expandedDeviceCapturePanelWidth(mainSessionSize.width, mainSessionSize.height, connectedDeviceAspectRatio)
    : null, [connectedDeviceAspectRatio, connectedDeviceCaptureExpanded, mainSessionSize.height, mainSessionSize.width]);

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
      className={`main-session-grid${workspaceView ? ' workspace-context' : ''}${visibleResearchDetails || connectedDeviceCaptureExpanded ? ' research-details-open' : ''}${workspaceView && !visibleResearchDetails ? ' workspace-main-only' : ''}`}
      style={{
        '--research-side-panel-width': `${panelWidth}px`,
        ...(expandedDeviceCaptureWidth !== null && expandedDeviceCaptureWidth > 0
          ? { '--research-side-panel-active-width': `${expandedDeviceCaptureWidth}px` }
          : {})
      } as CSSProperties}
    >
      {!selectedRunId ? (
        <WorkspaceUnderstandingView
          key={workspacePath}
          busy={busy}
          activeScope={activeScope}
          workspaceDejunk={workspaceDejunk}
          workspaceDejunkInProgress={workspaceDejunkInProgress}
          memoryDreamingInProgress={memoryDreamingInProgress}
          memoryDreamingProgress={memoryDreamingProgress}
          honeycrispMemory={honeycrispMemory}
          researchProfile={researchProfile}
          sessionHeatPreferences={sessionHeatPreferences}
          researchSubjectName={researchSubjectName}
          workspacePath={workspacePath}
          workspaceDirectories={workspaceDirectories}
          workspaceName={workspaceName}
          runs={runs}
          onRunWorkspaceDejunk={onRunWorkspaceDejunk}
          onRunMemoryDreaming={onRunMemoryDreaming}
          onAddResource={onAddWorkspaceResource}
          onChangeResource={onChangeWorkspaceResource}
          onCloneRepository={onCloneWorkspaceRepository}
          onSaveConfiguration={onSaveWorkspaceConfiguration}
          onChangeWorkspaceDirectories={onChangeWorkspaceDirectories}
          onOpenSession={onOpenSession}
          onActiveViewChange={onWorkspaceViewChange}
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
          aria-hidden={!researchSideResizeEnabled}
          tabIndex={researchSideResizeEnabled ? 0 : -1}
          onKeyDown={researchSideResizeEnabled ? handleResizeKeyDown : undefined}
          onPointerDown={researchSideResizeEnabled ? beginResize : undefined}
        />
      ) : null}
      {showResearchSidePanel ? <div className={`research-side-column${connectedDeviceCaptureVisible ? ' has-connected-device-capture' : ''}${connectedDeviceCaptureExpanded ? ' device-capture-expanded' : ''}`}>
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
          expanded={expandedResearchSidePanel}
          selectedRunbook={selectedRunbook}
          selectedRunbookDocument={selectedRunbookDocument}
          selectedRunbookId={selectedRunbookId}
          selectedMemoryNodeId={!selectedRunId ? selectedWorkspaceMemoryId : undefined}
          runbookLoading={runbookLoading}
          runbookError={runbookError}
          connectedDeviceOs={connectedDeviceOs}
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
          onRunbookExecute={selectedRunId ? onRunHoneycrispRunbook : undefined}
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
        {selectedRunId ? (
          <ConnectedDeviceCapture
            active={connectedDeviceCaptureEnabled}
            expanded={connectedDeviceCaptureExpanded}
            onAspectRatioChange={setConnectedDeviceAspectRatio}
            onDeviceOsChange={setConnectedDeviceOs}
            onExpandedChange={changeConnectedDeviceCaptureExpanded}
            onVisibilityChange={setConnectedDeviceCaptureVisible}
          />
        ) : null}
      </div> : null}
    </div>
  );
});

export interface RunbookExecutionLifecycle {
  runId: string;
  status: string;
  proofTarget: RunbookProofTarget;
  deviceOs: string | null;
}

export function expandedDeviceCapturePanelWidth(
  containerWidth: number,
  containerHeight: number,
  aspectRatio: number
): number {
  if (containerWidth <= 0 || containerHeight <= 0 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return 0;
  const desiredWidth = Math.max(0, containerHeight - CONNECTED_DEVICE_CAPTURE_VERTICAL_INSET) * aspectRatio
    + CONNECTED_DEVICE_CAPTURE_HORIZONTAL_INSET;
  const maximumWidth = Math.max(0, containerWidth - MIN_TRACE_PANEL_WIDTH - RESEARCH_SIDE_RESIZE_HANDLE_WIDTH);
  return Math.round(Math.min(desiredWidth, maximumWidth));
}

export function latestOverallRunbookExecution(events: readonly TraceEventRecord[]): RunbookExecutionLifecycle | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]?.payload;
    if (!payload || payload.eventType !== 'runbook_execution' || payload.cellId !== null) continue;
    const runId = typeof payload.runbookRunId === 'string' ? payload.runbookRunId : '';
    const status = typeof payload.status === 'string' ? payload.status : '';
    const proofTarget = payload.proofTarget;
    if (!runId || !status || !isRunbookProofTarget(proofTarget)) continue;
    return {
      runId,
      status,
      proofTarget,
      deviceOs: typeof payload.deviceOs === 'string' ? payload.deviceOs : null
    };
  }
  return null;
}

export function isIosDeviceOs(deviceOs: string | null): boolean {
  return Boolean(deviceOs && /^(?:ios|iphone os)(?:\s|\d|$)/i.test(deviceOs.trim()));
}

function isRunbookProofTarget(value: unknown): value is RunbookProofTarget {
  return value === 'localhost' || value === 'device' || value === 'vm' || value === 'web' || value === 'other';
}

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
