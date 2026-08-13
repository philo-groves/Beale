import type { JSX } from 'react';
import type {
  NotificationRecord,
  OpenAiAccountStatus,
  ResearchProfileId,
  ResearchModelProviderId,
  ProviderModelDefaults,
  ProviderSettings,
  ResearchProviderModelCatalog,
  ResearchProviderStatus,
  ResearchGoalPhase,
  ResearchGoalSuggestionsByPhase,
  ResearchGoalSuggestionStateByPhase,
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
import { WorkspaceInformationModal, WorkspaceSessionHistorySheet } from '../features/workspaces/WorkspaceModals';
import { WorkspaceOnboardingModal } from '../features/workspaces/WorkspaceOnboardingModal';
import { SessionSummaryModal } from '../features/sessions/SessionSummaryModal';
import { TranscriptSearchSheet } from '../features/search/TranscriptSearchSheet';
import { StartRunForm } from '../features/sessions/StartRunForm';
import type { ResearchGoalSeed } from '../features/sessions/SessionNextSteps';
import { ProfilingModal } from '../features/settings/ProfilingModal';
import { TraceDetailModal } from '../features/traces/TraceDetailModal';
import { TraceFilterModal } from '../features/traces/TraceFilterModal';
import type { TraceDisplayEvent } from '../view-models/traceDisplay';
import type { WorkspaceOnboardingFormState, WorkspaceTemplateKind } from '../view-models/workspaceOnboarding';

export function AppModals({
  activeNotification,
  activeRunDetail,
  activeWorkspaceName,
  activeResearchProfileId,
  busy,
  newResearchOpen,
  newResearchInitialGoal,
  openAiStatus,
  defaultProviderId,
  providerModelDefaults,
  providerPolicyRiskAcknowledgements,
  researchProviderModelCatalog,
  researchProviderStatuses,
  researchGoalSuggestions,
  researchGoalSuggestionsLoading,
  researchGoalSuggestionErrors,
  profilingOpen,
  profilingState,
  lastProfilingReport,
  workspaceDraft,
  workspaceOnboardingProgress,
  workspaceInfo,
  sessionSummaryDetail,
  searchOpen,
  selectedRunId,
  selectedTraceEvent,
  sessionHistoryWorkspace,
  sessionHistorySessions,
  snapshot,
  traceDetailOpen,
  traceFilterOpen,
  visibleTraceCategories,
  onCancelNewResearch,
  onCancelWorkspaceOnboarding,
  onChangeWorkspaceDraft,
  onChangeVisibleTraceCategories,
  onCloseNotification,
  onCloseProfiling,
  onCloseWorkspaceInfo,
  onCloseSessionSummary,
  onCloseSearch,
  onCloseSessionHistory,
  onCloseTraceDetail,
  onCloseTraceFilters,
  onLookupHackerOne,
  onOpenSessionHistorySession,
  onWorkspaceTemplate,
  onFlushProfilingReport,
  onLoadResearchGoalSuggestions,
  onRetryResearchGoalSuggestions,
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
  activeResearchProfileId: ResearchProfileId;
  busy: boolean;
  newResearchOpen: boolean;
  newResearchInitialGoal: ResearchGoalSeed | null;
  openAiStatus: OpenAiAccountStatus | null;
  defaultProviderId: ResearchModelProviderId | null | undefined;
  providerModelDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> | undefined;
  providerPolicyRiskAcknowledgements: ProviderSettings['cyberPolicyRiskAcknowledgements'];
  researchProviderModelCatalog: ResearchProviderModelCatalog[];
  researchProviderStatuses: ResearchProviderStatus[];
  researchGoalSuggestions: ResearchGoalSuggestionsByPhase;
  researchGoalSuggestionsLoading: ResearchGoalSuggestionStateByPhase<boolean>;
  researchGoalSuggestionErrors: ResearchGoalSuggestionStateByPhase<string | null>;
  profilingOpen: boolean;
  profilingState: ProfilingState | null;
  lastProfilingReport: ProfilingReport | null;
  workspaceDraft: WorkspaceOnboardingFormState | null;
  workspaceOnboardingProgress: WorkspaceOnboardingProgressUpdate | null;
  workspaceInfo: WorkspaceRegistryEntry | null;
  sessionSummaryDetail: RunDetail | null;
  searchOpen: boolean;
  selectedRunId: string | null;
  selectedTraceEvent: TraceDisplayEvent | null;
  sessionHistoryWorkspace: WorkspaceRegistryEntry | null;
  sessionHistorySessions: ResearchSessionSummary[];
  snapshot: WorkspaceSnapshot | null;
  traceDetailOpen: boolean;
  traceFilterOpen: boolean;
  visibleTraceCategories: TraceCategoryId[];
  onCancelNewResearch: () => void;
  onCancelWorkspaceOnboarding: () => void;
  onChangeWorkspaceDraft: (next: WorkspaceOnboardingFormState) => void;
  onChangeVisibleTraceCategories: (categories: TraceCategoryId[]) => void;
  onCloseNotification: () => void;
  onCloseProfiling: () => void;
  onCloseWorkspaceInfo: () => void;
  onCloseSessionSummary: () => void;
  onCloseSearch: () => void;
  onCloseSessionHistory: () => void;
  onCloseTraceDetail: () => void;
  onCloseTraceFilters: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onOpenSessionHistorySession: (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary) => void;
  onWorkspaceTemplate: (templateKind: WorkspaceTemplateKind) => void;
  onFlushProfilingReport: () => void;
  onLoadResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onRetryResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
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
          researchProfileId={activeResearchProfileId}
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
          openAiStatus={openAiStatus}
          defaultProviderId={defaultProviderId}
          providerModelDefaults={providerModelDefaults}
          providerPolicyRiskAcknowledgements={providerPolicyRiskAcknowledgements}
          researchProviderStatuses={researchProviderStatuses}
          providerModelCatalog={researchProviderModelCatalog}
          researchGoalSuggestions={researchGoalSuggestions}
          researchGoalSuggestionsLoading={researchGoalSuggestionsLoading}
          researchGoalSuggestionErrors={researchGoalSuggestionErrors}
          initialGoal={newResearchInitialGoal}
          busy={busy}
          runAction={runAction}
          onCancel={onCancelNewResearch}
          onLoadResearchGoalSuggestions={onLoadResearchGoalSuggestions}
          onRetryResearchGoalSuggestions={onRetryResearchGoalSuggestions}
          onStarted={onStartedNewResearch}
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
        <TranscriptSearchSheet
          activeWorkspaceName={activeWorkspaceName}
          workspaceOpen={Boolean(snapshot)}
          selectedRunId={selectedRunId}
          onClose={onCloseSearch}
          onOpenResult={onOpenSearchResult}
        />
      ) : null}
      {activeNotification ? (
        <NotificationDetailModal
          notification={activeNotification}
          busy={busy}
          onClose={onCloseNotification}
          onSteer={(instruction) => onSteerNotification(activeNotification, instruction)}
        />
      ) : null}
      {sessionSummaryDetail ? <SessionSummaryModal detail={sessionSummaryDetail} onClose={onCloseSessionSummary} /> : null}
      {traceDetailOpen && selectedTraceEvent ? (
        <TraceDetailModal
          detail={activeRunDetail}
          event={selectedTraceEvent}
          onClose={onCloseTraceDetail}
        />
      ) : null}
      {workspaceInfo ? <WorkspaceInformationModal workspace={workspaceInfo} onClose={onCloseWorkspaceInfo} /> : null}
      {sessionHistoryWorkspace ? (
        <WorkspaceSessionHistorySheet
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
