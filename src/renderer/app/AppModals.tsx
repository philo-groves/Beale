import type { JSX } from 'react';
import type {
  FindingRecord,
  HypothesisRecord,
  NotificationRecord,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  ProfilingReport,
  ProfilingState,
  ProgramRegistryEntry,
  ResearchSessionSummary,
  RunDetail,
  SessionTranscriptSearchResult,
  VmPreference,
  VmPreferenceInput,
  WorkspaceSnapshot
} from '@shared/types';
import type { TraceCategoryId } from '../traceClassification';
import { NotificationDetailModal } from '../features/notifications/Notifications';
import { ProgramInformationModal, ProgramSessionHistoryModal } from '../features/programs/ProgramModals';
import { ProgramOnboardingModal } from '../features/programs/ProgramOnboardingModal';
import { ResearchPromptModal } from '../features/sessions/ResearchPromptModal';
import { TranscriptSearchModal } from '../features/search/TranscriptSearchModal';
import { StartRunForm } from '../features/sessions/StartRunForm';
import { ProfilingModal } from '../features/settings/ProfilingModal';
import { SettingsModal, type SettingsSection } from '../features/settings/SettingsModal';
import { TraceDetailModal } from '../features/traces/TraceDetailModal';
import { TraceFilterModal } from '../features/traces/TraceFilterModal';
import type { TraceDisplayEvent } from '../view-models/traceDisplay';
import type { ProgramOnboardingFormState, ProgramTemplateKind } from '../view-models/programOnboarding';

export function AppModals({
  activeNotification,
  activeRunDetail,
  busy,
  newResearchOpen,
  openAiOAuthResult,
  openAiStatus,
  profilingOpen,
  profilingState,
  lastProfilingReport,
  programDraft,
  programInfo,
  researchPromptDetail,
  searchOpen,
  selectedRunId,
  selectedTraceEvent,
  selectedTraceFinding,
  selectedTraceHypothesis,
  sessionHistoryProgram,
  sessionHistorySessions,
  settingsOpen,
  settingsSection,
  snapshot,
  traceDetailOpen,
  traceFilterOpen,
  visibleTraceCategories,
  vmPreference,
  onCancelNewResearch,
  onCancelProgramOnboarding,
  onChangeProgramDraft,
  onChangeSettingsSection,
  onChangeVisibleTraceCategories,
  onCloseNotification,
  onCloseProfiling,
  onCloseProgramInfo,
  onCloseResearchPrompt,
  onCloseSearch,
  onCloseSessionHistory,
  onCloseSettings,
  onCloseTraceDetail,
  onCloseTraceFilters,
  onLookupHackerOne,
  onOpenSessionHistorySession,
  onProgramTemplate,
  onRefreshOpenAi,
  onFlushProfilingReport,
  onSetProfilingEnabled,
  onSetVmPreference,
  onStartOpenAiOAuth,
  onStartedNewResearch,
  onSteerNotification,
  onSubmitProgramOnboarding,
  onOpenSearchResult,
  runAction
}: {
  activeNotification: NotificationRecord | null;
  activeRunDetail: RunDetail | null;
  busy: boolean;
  newResearchOpen: boolean;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  openAiStatus: OpenAiAccountStatus | null;
  profilingOpen: boolean;
  profilingState: ProfilingState | null;
  lastProfilingReport: ProfilingReport | null;
  programDraft: ProgramOnboardingFormState | null;
  programInfo: ProgramRegistryEntry | null;
  researchPromptDetail: RunDetail | null;
  searchOpen: boolean;
  selectedRunId: string | null;
  selectedTraceEvent: TraceDisplayEvent | null;
  selectedTraceFinding: FindingRecord | null;
  selectedTraceHypothesis: HypothesisRecord | null;
  sessionHistoryProgram: ProgramRegistryEntry | null;
  sessionHistorySessions: ResearchSessionSummary[];
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  snapshot: WorkspaceSnapshot | null;
  traceDetailOpen: boolean;
  traceFilterOpen: boolean;
  visibleTraceCategories: TraceCategoryId[];
  vmPreference: VmPreference;
  onCancelNewResearch: () => void;
  onCancelProgramOnboarding: () => void;
  onChangeProgramDraft: (next: ProgramOnboardingFormState) => void;
  onChangeSettingsSection: (section: SettingsSection) => void;
  onChangeVisibleTraceCategories: (categories: TraceCategoryId[]) => void;
  onCloseNotification: () => void;
  onCloseProfiling: () => void;
  onCloseProgramInfo: () => void;
  onCloseResearchPrompt: () => void;
  onCloseSearch: () => void;
  onCloseSessionHistory: () => void;
  onCloseSettings: () => void;
  onCloseTraceDetail: () => void;
  onCloseTraceFilters: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onOpenSessionHistorySession: (program: ProgramRegistryEntry, session: ResearchSessionSummary) => void;
  onProgramTemplate: (templateKind: ProgramTemplateKind) => void;
  onRefreshOpenAi: () => Promise<void>;
  onFlushProfilingReport: () => void;
  onSetProfilingEnabled: (enabled: boolean) => Promise<void>;
  onSetVmPreference: (input: VmPreferenceInput) => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
  onStartedNewResearch: (runId: string) => void;
  onSteerNotification: (notification: NotificationRecord, instruction: string) => void;
  onSubmitProgramOnboarding: () => void;
  onOpenSearchResult: (result: SessionTranscriptSearchResult, query: string) => void;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  return (
    <>
      {programDraft ? (
        <ProgramOnboardingModal
          busy={busy}
          form={programDraft}
          onCancel={onCancelProgramOnboarding}
          onChange={onChangeProgramDraft}
          onLookupHackerOne={onLookupHackerOne}
          onTemplate={onProgramTemplate}
          onSubmit={onSubmitProgramOnboarding}
        />
      ) : null}
      {newResearchOpen && snapshot ? (
        <StartRunForm
          snapshot={snapshot}
          vmPreference={vmPreference}
          busy={busy}
          runAction={runAction}
          onCancel={onCancelNewResearch}
          onStarted={onStartedNewResearch}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          section={settingsSection}
          executor={snapshot?.executor ?? null}
          vmPreference={vmPreference}
          openAiOAuthResult={openAiOAuthResult}
          openAiStatus={openAiStatus}
          profilingState={profilingState}
          busy={busy}
          onChangeSection={onChangeSettingsSection}
          onClose={onCloseSettings}
          onSetVmPreference={onSetVmPreference}
          onSetProfilingEnabled={onSetProfilingEnabled}
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
      {programInfo ? <ProgramInformationModal program={programInfo} onClose={onCloseProgramInfo} /> : null}
      {sessionHistoryProgram ? (
        <ProgramSessionHistoryModal
          program={sessionHistoryProgram}
          sessions={sessionHistorySessions}
          selectedRunId={selectedRunId}
          onClose={onCloseSessionHistory}
          onOpenSession={(session) => onOpenSessionHistorySession(sessionHistoryProgram, session)}
        />
      ) : null}
    </>
  );
}
