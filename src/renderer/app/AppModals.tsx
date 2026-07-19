import type { JSX } from 'react';
import type {
  DeveloperSettings,
  FindingRecord,
  HypothesisRecord,
  NotificationRecord,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  ProfilingReport,
  ProfilingState,
  WorkspaceOnboardingProgressUpdate,
  WorkspaceRegistryEntry,
  ResearchSessionSummary,
  RunDetail,
  SessionTranscriptSearchResult,
  WorkspaceSnapshot
} from '@shared/types';
import type { TraceCategoryId } from '../traceClassification';
import { NotificationDetailModal } from '../features/notifications/Notifications';
import { WorkspaceInformationModal, WorkspaceSessionHistoryModal } from '../features/workspaces/WorkspaceModals';
import { WorkspaceOnboardingModal } from '../features/workspaces/WorkspaceOnboardingModal';
import { ResearchPromptModal } from '../features/sessions/ResearchPromptModal';
import { TranscriptSearchModal } from '../features/search/TranscriptSearchModal';
import { StartRunForm } from '../features/sessions/StartRunForm';
import { ProfilingModal } from '../features/settings/ProfilingModal';
import { SettingsModal, type SettingsSection } from '../features/settings/SettingsModal';
import { HoneycrispToolingModal, type HoneycrispToolingModalKind } from '../features/tools/HoneycrispToolingModal';
import { TraceDetailModal } from '../features/traces/TraceDetailModal';
import { TraceFilterModal } from '../features/traces/TraceFilterModal';
import type { TraceDisplayEvent } from '../view-models/traceDisplay';
import type { WorkspaceOnboardingFormState, WorkspaceTemplateKind } from '../view-models/workspaceOnboarding';

export function AppModals({
  activeNotification,
  activeRunDetail,
  activeWorkspaceName,
  busy,
  developerSettings,
  newResearchOpen,
  openAiOAuthResult,
  openAiStatus,
  profilingOpen,
  profilingState,
  lastProfilingReport,
  workspaceDraft,
  workspaceOnboardingProgress,
  workspaceInfo,
  researchPromptDetail,
  searchOpen,
  selectedRunId,
  selectedTraceEvent,
  selectedTraceFinding,
  selectedTraceHypothesis,
  sessionHistoryWorkspace,
  sessionHistorySessions,
  settingsOpen,
  settingsSection,
  snapshot,
  traceDetailOpen,
  traceFilterOpen,
  toolingModal,
  visibleTraceCategories,
  onCancelNewResearch,
  onCancelWorkspaceOnboarding,
  onChangeWorkspaceDraft,
  onChangeSettingsSection,
  onChangeVisibleTraceCategories,
  onCloseNotification,
  onCloseProfiling,
  onCloseWorkspaceInfo,
  onCloseResearchPrompt,
  onCloseSearch,
  onCloseSessionHistory,
  onCloseSettings,
  onCloseTooling,
  onCloseTraceDetail,
  onCloseTraceFilters,
  onLookupHackerOne,
  onOpenSessionHistorySession,
  onWorkspaceTemplate,
  onRefreshOpenAi,
  onFlushProfilingReport,
  onSetDeveloperModeEnabled,
  onStartOpenAiOAuth,
  onStartedNewResearch,
  onSteerNotification,
  onSubmitWorkspaceOnboarding,
  onSkipWorkspaceOnboardingRepository,
  onOpenSearchResult,
  runAction
}: {
  activeNotification: NotificationRecord | null;
  activeRunDetail: RunDetail | null;
  activeWorkspaceName: string;
  busy: boolean;
  developerSettings: DeveloperSettings | null;
  newResearchOpen: boolean;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  openAiStatus: OpenAiAccountStatus | null;
  profilingOpen: boolean;
  profilingState: ProfilingState | null;
  lastProfilingReport: ProfilingReport | null;
  workspaceDraft: WorkspaceOnboardingFormState | null;
  workspaceOnboardingProgress: WorkspaceOnboardingProgressUpdate | null;
  workspaceInfo: WorkspaceRegistryEntry | null;
  researchPromptDetail: RunDetail | null;
  searchOpen: boolean;
  selectedRunId: string | null;
  selectedTraceEvent: TraceDisplayEvent | null;
  selectedTraceFinding: FindingRecord | null;
  selectedTraceHypothesis: HypothesisRecord | null;
  sessionHistoryWorkspace: WorkspaceRegistryEntry | null;
  sessionHistorySessions: ResearchSessionSummary[];
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  snapshot: WorkspaceSnapshot | null;
  traceDetailOpen: boolean;
  traceFilterOpen: boolean;
  toolingModal: HoneycrispToolingModalKind | null;
  visibleTraceCategories: TraceCategoryId[];
  onCancelNewResearch: () => void;
  onCancelWorkspaceOnboarding: () => void;
  onChangeWorkspaceDraft: (next: WorkspaceOnboardingFormState) => void;
  onChangeSettingsSection: (section: SettingsSection) => void;
  onChangeVisibleTraceCategories: (categories: TraceCategoryId[]) => void;
  onCloseNotification: () => void;
  onCloseProfiling: () => void;
  onCloseWorkspaceInfo: () => void;
  onCloseResearchPrompt: () => void;
  onCloseSearch: () => void;
  onCloseSessionHistory: () => void;
  onCloseSettings: () => void;
  onCloseTooling: () => void;
  onCloseTraceDetail: () => void;
  onCloseTraceFilters: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onOpenSessionHistorySession: (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary) => void;
  onWorkspaceTemplate: (templateKind: WorkspaceTemplateKind) => void;
  onRefreshOpenAi: () => Promise<void>;
  onFlushProfilingReport: () => void;
  onSetDeveloperModeEnabled: (enabled: boolean) => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
  onStartedNewResearch: (runId: string) => void;
  onSteerNotification: (notification: NotificationRecord, instruction: string) => void;
  onSubmitWorkspaceOnboarding: () => void;
  onSkipWorkspaceOnboardingRepository: (repositoryUrl: string, stage: 'clone' | 'index') => Promise<void>;
  onOpenSearchResult: (result: SessionTranscriptSearchResult, query: string) => void;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  return (
    <>
      {workspaceDraft ? (
        <WorkspaceOnboardingModal
          busy={busy}
          form={workspaceDraft}
          progress={workspaceOnboardingProgress}
          onCancel={onCancelWorkspaceOnboarding}
          onChange={onChangeWorkspaceDraft}
          onLookupHackerOne={onLookupHackerOne}
          onSkipRepository={onSkipWorkspaceOnboardingRepository}
          onTemplate={onWorkspaceTemplate}
          onSubmit={onSubmitWorkspaceOnboarding}
        />
      ) : null}
      {newResearchOpen && snapshot ? (
        <StartRunForm
          snapshot={snapshot}
          busy={busy}
          runAction={runAction}
          onCancel={onCancelNewResearch}
          onStarted={onStartedNewResearch}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          section={settingsSection}
          developerSettings={developerSettings}
          workspaceName={activeWorkspaceName}
          openAiOAuthResult={openAiOAuthResult}
          openAiStatus={openAiStatus}
          busy={busy}
          onChangeSection={onChangeSettingsSection}
          onClose={onCloseSettings}
          onSetDeveloperModeEnabled={onSetDeveloperModeEnabled}
          onRefreshOpenAi={onRefreshOpenAi}
          onStartOpenAiOAuth={onStartOpenAiOAuth}
        />
      ) : null}
      {profilingOpen ? (
        <ProfilingModal
          state={profilingState}
          report={lastProfilingReport}
          onClose={onCloseProfiling}
          onFlush={onFlushProfilingReport}
        />
      ) : null}
      {traceFilterOpen ? (
        <TraceFilterModal
          visibleCategories={visibleTraceCategories}
          onChange={onChangeVisibleTraceCategories}
          onClose={onCloseTraceFilters}
        />
      ) : null}
      {searchOpen ? (
        <TranscriptSearchModal
          activeWorkspaceName={activeWorkspaceName}
          workspaceOpen={Boolean(snapshot)}
          selectedRunId={selectedRunId}
          onClose={onCloseSearch}
          onOpenResult={onOpenSearchResult}
        />
      ) : null}
      {toolingModal ? <HoneycrispToolingModal kind={toolingModal} onClose={onCloseTooling} /> : null}
      {activeNotification ? (
        <NotificationDetailModal
          notification={activeNotification}
          busy={busy}
          onClose={onCloseNotification}
          onSteer={(instruction) => onSteerNotification(activeNotification, instruction)}
        />
      ) : null}
      {researchPromptDetail ? <ResearchPromptModal detail={researchPromptDetail} onClose={onCloseResearchPrompt} /> : null}
      {traceDetailOpen && selectedTraceEvent ? (
        <TraceDetailModal
          detail={activeRunDetail}
          event={selectedTraceEvent}
          finding={selectedTraceFinding}
          hypothesis={selectedTraceHypothesis}
          onClose={onCloseTraceDetail}
        />
      ) : null}
      {workspaceInfo ? <WorkspaceInformationModal workspace={workspaceInfo} onClose={onCloseWorkspaceInfo} /> : null}
      {sessionHistoryWorkspace ? (
        <WorkspaceSessionHistoryModal
          workspace={sessionHistoryWorkspace}
          sessions={sessionHistorySessions}
          selectedRunId={selectedRunId}
          onClose={onCloseSessionHistory}
          onOpenSession={(session) => onOpenSessionHistorySession(sessionHistoryWorkspace, session)}
        />
      ) : null}
    </>
  );
}
