import type { JSX } from 'react';
import type {
  NotificationRecord,
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
  ShellSafetyMode,
  WorkspaceSnapshot
} from '@shared/types';
import type { TraceCategoryId } from '../traceClassification';
import { NotificationDetailModal } from '../features/notifications/Notifications';
import { WorkspaceOnboardingModal } from '../features/workspaces/WorkspaceOnboardingModal';
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
  busy,
  newResearchOpen,
  newResearchInitialGoal,
  openAiStatus,
  defaultProviderId,
  dangerModeEnabled,
  defaultShellSafetyMode,
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
  selectedTraceEvent,
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
  onCloseTraceDetail,
  onCloseTraceFilters,
  onLookupHackerOne,
  onWorkspaceTemplate,
  onFlushProfilingReport,
  onLoadResearchGoalSuggestions,
  onSelectResearchGoalSuggestion,
  onRetryResearchGoalSuggestions,
  onStartedNewResearch,
  onSteerNotification,
  onSubmitWorkspaceOnboarding,
  runAction
}: {
  activeNotification: NotificationRecord | null;
  activeRunDetail: RunDetail | null;
  busy: boolean;
  newResearchOpen: boolean;
  newResearchInitialGoal: ResearchGoalSeed | null;
  openAiStatus: OpenAiAccountStatus | null;
  defaultProviderId: ResearchModelProviderId | null | undefined;
  dangerModeEnabled: boolean;
  defaultShellSafetyMode: ShellSafetyMode;
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
  selectedTraceEvent: TraceDisplayEvent | null;
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
  onCloseTraceDetail: () => void;
  onCloseTraceFilters: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onWorkspaceTemplate: (templateKind: WorkspaceTemplateKind) => void;
  onFlushProfilingReport: () => void;
  onLoadResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onSelectResearchGoalSuggestion: (phase: ResearchGoalPhase, suggestion: string) => void;
  onRetryResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onStartedNewResearch: (runId: string) => void;
  onSteerNotification: (notification: NotificationRecord, instruction: string) => void;
  onSubmitWorkspaceOnboarding: () => void;
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
          dangerModeEnabled={dangerModeEnabled}
          defaultShellSafetyMode={defaultShellSafetyMode}
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
