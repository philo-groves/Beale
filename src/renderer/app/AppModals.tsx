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
  ShellSafetyMode,
  WorkspaceSnapshot
} from '@shared/types';
import { NotificationDetailModal } from '../features/notifications/Notifications';
import { StartRunForm } from '../features/sessions/StartRunForm';
import type { ResearchGoalSeed } from '../features/sessions/SessionNextSteps';
import { ProfilingModal } from '../features/settings/ProfilingModal';

export function AppModals({
  activeNotification,
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
  newResearchPromptSuggestionsEnabled = true,
  profilingOpen,
  profilingState,
  lastProfilingReport,
  snapshot,
  onCancelNewResearch,
  onCloseNotification,
  onCloseProfiling,
  onFlushProfilingReport,
  onLoadResearchGoalSuggestions,
  onSelectResearchGoalSuggestion,
  onRetryResearchGoalSuggestions,
  onStartedNewResearch,
  onSteerNotification,
  runAction
}: {
  activeNotification: NotificationRecord | null;
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
  newResearchPromptSuggestionsEnabled?: boolean;
  profilingOpen: boolean;
  profilingState: ProfilingState | null;
  lastProfilingReport: ProfilingReport | null;
  snapshot: WorkspaceSnapshot | null;
  onCancelNewResearch: () => void;
  onCloseNotification: () => void;
  onCloseProfiling: () => void;
  onFlushProfilingReport: () => void;
  onLoadResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onSelectResearchGoalSuggestion: (phase: ResearchGoalPhase, suggestion: string) => void;
  onRetryResearchGoalSuggestions: (phase: ResearchGoalPhase) => void;
  onStartedNewResearch: (runId: string) => void;
  onSteerNotification: (notification: NotificationRecord, instruction: string) => void;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  return (
    <>
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
          showSuggestions={newResearchPromptSuggestionsEnabled}
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
      {activeNotification ? (
        <NotificationDetailModal
          notification={activeNotification}
          busy={busy}
          onClose={onCloseNotification}
          onSteer={(instruction) => onSteerNotification(activeNotification, instruction)}
        />
      ) : null}
    </>
  );
}
