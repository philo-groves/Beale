import type { JSX } from 'react';
import type {
  NotificationRecord,
  AgentPluginRegistryState,
  OpenAiAccountStatus,
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
  RunDetail,
  SessionTranscriptSearchResult,
  WorkspaceSnapshot
} from '@shared/types';
import type { TraceCategoryId } from '../traceClassification';
import { NotificationDetailModal } from '../features/notifications/Notifications';
import { WorkspaceOnboardingModal } from '../features/workspaces/WorkspaceOnboardingModal';
import { TranscriptSearchSheet } from '../features/search/TranscriptSearchSheet';
import { StartRunForm } from '../features/sessions/StartRunForm';
import { PluginManagerModal } from '../features/plugins/PluginManagerModal';
import { AutomationsModal } from '../features/plugins/AutomationsModal';
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
  busy,
  newResearchOpen,
  newResearchInitialGoal,
  automationsOpen,
  pluginsOpen,
  agentPluginState,
  agentPluginsLoading,
  agentPluginsBusy,
  agentPluginsError,
  pluginRepositoryUrl,
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
  searchOpen,
  selectedRunId,
  selectedTraceEvent,
  snapshot,
  traceDetailOpen,
  traceFilterOpen,
  visibleTraceCategories,
  onCancelNewResearch,
  onCloseAutomations,
  onClosePlugins,
  onCancelWorkspaceOnboarding,
  onPluginRepositoryUrlChange,
  onChangeWorkspaceDraft,
  onChangeVisibleTraceCategories,
  onCloseNotification,
  onCloseProfiling,
  onCloseSearch,
  onCloseTraceDetail,
  onCloseTraceFilters,
  onLookupHackerOne,
  onWorkspaceTemplate,
  onFlushProfilingReport,
  onLoadResearchGoalSuggestions,
  onSelectResearchGoalSuggestion,
  onRetryResearchGoalSuggestions,
  onStartedNewResearch,
  onCancelRepeatAutomation,
  onOpenAutomationSession,
  onSteerNotification,
  onSubmitWorkspaceOnboarding,
  onOpenSearchResult,
  onAddAgentPluginFromFilesystem,
  onAddAgentPluginFromRepository,
  onSetAgentPluginEnabled,
  onRemoveAgentPlugin,
  runAction
}: {
  activeNotification: NotificationRecord | null;
  activeRunDetail: RunDetail | null;
  activeWorkspaceName: string;
  busy: boolean;
  newResearchOpen: boolean;
  newResearchInitialGoal: ResearchGoalSeed | null;
  automationsOpen: boolean;
  pluginsOpen: boolean;
  agentPluginState: AgentPluginRegistryState | null;
  agentPluginsLoading: boolean;
  agentPluginsBusy: boolean;
  agentPluginsError: string | null;
  pluginRepositoryUrl: string;
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
  searchOpen: boolean;
  selectedRunId: string | null;
  selectedTraceEvent: TraceDisplayEvent | null;
  snapshot: WorkspaceSnapshot | null;
  traceDetailOpen: boolean;
  traceFilterOpen: boolean;
  visibleTraceCategories: TraceCategoryId[];
  onCancelNewResearch: () => void;
  onCloseAutomations: () => void;
  onClosePlugins: () => void;
  onCancelWorkspaceOnboarding: () => void;
  onPluginRepositoryUrlChange: (value: string) => void;
  onChangeWorkspaceDraft: (next: WorkspaceOnboardingFormState) => void;
  onChangeVisibleTraceCategories: (categories: TraceCategoryId[]) => void;
  onCloseNotification: () => void;
  onCloseProfiling: () => void;
  onCloseSearch: () => void;
  onCloseTraceDetail: () => void;
  onCloseTraceFilters: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onWorkspaceTemplate: (templateKind: WorkspaceTemplateKind) => void;
  onFlushProfilingReport: () => void;
  onLoadResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onSelectResearchGoalSuggestion: (phase: ResearchGoalPhase, suggestion: string) => void;
  onRetryResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onStartedNewResearch: (runId: string) => void;
  onCancelRepeatAutomation: (runId: string) => void;
  onOpenAutomationSession: (runId: string) => void;
  onSteerNotification: (notification: NotificationRecord, instruction: string) => void;
  onSubmitWorkspaceOnboarding: () => void;
  onOpenSearchResult: (result: SessionTranscriptSearchResult, query: string) => void;
  onAddAgentPluginFromFilesystem: () => void;
  onAddAgentPluginFromRepository: () => void;
  onSetAgentPluginEnabled: (pluginId: string, enabled: boolean) => void;
  onRemoveAgentPlugin: (pluginId: string) => void;
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
          onSelectResearchGoalSuggestion={onSelectResearchGoalSuggestion}
          onRetryResearchGoalSuggestions={onRetryResearchGoalSuggestions}
          onStarted={onStartedNewResearch}
        />
      ) : null}
      {pluginsOpen ? (
        <PluginManagerModal
          state={agentPluginState}
          loading={agentPluginsLoading}
          busy={agentPluginsBusy}
          error={agentPluginsError}
          repositoryUrl={pluginRepositoryUrl}
          onRepositoryUrlChange={onPluginRepositoryUrlChange}
          onAddFilesystem={onAddAgentPluginFromFilesystem}
          onAddRepository={onAddAgentPluginFromRepository}
          onSetEnabled={onSetAgentPluginEnabled}
          onRemove={onRemoveAgentPlugin}
          onClose={onClosePlugins}
        />
      ) : null}
      {automationsOpen ? (
        <AutomationsModal
          snapshot={snapshot}
          busy={busy}
          onCancelRepeat={onCancelRepeatAutomation}
          onOpenSession={onOpenAutomationSession}
          onClose={onCloseAutomations}
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
      {traceDetailOpen && selectedTraceEvent ? (
        <TraceDetailModal
          detail={activeRunDetail}
          event={selectedTraceEvent}
          onClose={onCloseTraceDetail}
        />
      ) : null}
    </>
  );
}
