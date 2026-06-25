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
  ProgramOnboardingProgressUpdate,
  ProgramRegistryEntry,
  ResearchSessionSummary,
  RunDetail,
  SessionTranscriptSearchResult,
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
import { HoneycrispToolingModal, type HoneycrispToolingModalKind } from '../features/tools/HoneycrispToolingModal';
import { TraceDetailModal } from '../features/traces/TraceDetailModal';
import { TraceFilterModal } from '../features/traces/TraceFilterModal';
import type { TraceDisplayEvent } from '../view-models/traceDisplay';
import type { ProgramOnboardingFormState, ProgramTemplateKind } from '../view-models/programOnboarding';

export function AppModals({
  activeNotification,
  activeRunDetail,
  activeProgramName,
  busy,
  developerSettings,
  newResearchOpen,
  openAiOAuthResult,
  openAiStatus,
  profilingOpen,
  profilingState,
  lastProfilingReport,
  programDraft,
  programOnboardingProgress,
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
  toolingModal,
  visibleTraceCategories,
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
  onCloseTooling,
  onCloseTraceDetail,
  onCloseTraceFilters,
  onLookupHackerOne,
  onOpenSessionHistorySession,
  onProgramTemplate,
  onRefreshOpenAi,
  onFlushProfilingReport,
  onSetDeveloperModeEnabled,
  onStartOpenAiOAuth,
  onStartedNewResearch,
  onSteerNotification,
  onSubmitProgramOnboarding,
  onSkipProgramOnboardingRepository,
  onOpenSearchResult,
  runAction
}: {
  activeNotification: NotificationRecord | null;
  activeRunDetail: RunDetail | null;
  activeProgramName: string;
  busy: boolean;
  developerSettings: DeveloperSettings | null;
  newResearchOpen: boolean;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  openAiStatus: OpenAiAccountStatus | null;
  profilingOpen: boolean;
  profilingState: ProfilingState | null;
  lastProfilingReport: ProfilingReport | null;
  programDraft: ProgramOnboardingFormState | null;
  programOnboardingProgress: ProgramOnboardingProgressUpdate | null;
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
  toolingModal: HoneycrispToolingModalKind | null;
  visibleTraceCategories: TraceCategoryId[];
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
  onCloseTooling: () => void;
  onCloseTraceDetail: () => void;
  onCloseTraceFilters: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onOpenSessionHistorySession: (program: ProgramRegistryEntry, session: ResearchSessionSummary) => void;
  onProgramTemplate: (templateKind: ProgramTemplateKind) => void;
  onRefreshOpenAi: () => Promise<void>;
  onFlushProfilingReport: () => void;
  onSetDeveloperModeEnabled: (enabled: boolean) => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
  onStartedNewResearch: (runId: string) => void;
  onSteerNotification: (notification: NotificationRecord, instruction: string) => void;
  onSubmitProgramOnboarding: () => void;
  onSkipProgramOnboardingRepository: (repositoryUrl: string, stage: 'clone' | 'index') => Promise<void>;
  onOpenSearchResult: (result: SessionTranscriptSearchResult, query: string) => void;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  return (
    <>
      {programDraft ? (
        <ProgramOnboardingModal
          busy={busy}
          form={programDraft}
          progress={programOnboardingProgress}
          onCancel={onCancelProgramOnboarding}
          onChange={onChangeProgramDraft}
          onLookupHackerOne={onLookupHackerOne}
          onSkipRepository={onSkipProgramOnboardingRepository}
          onTemplate={onProgramTemplate}
          onSubmit={onSubmitProgramOnboarding}
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
          programName={activeProgramName}
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
          activeProgramName={activeProgramName}
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
