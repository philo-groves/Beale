import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties } from 'react';
import 'katex/dist/katex.min.css';
import './styles.css';
import { devInstrumentation, useDevInputLatencyProbe, useDevRenderProbe } from './devInstrumentation';
import type {
  ApprovalRecord,
  AgentPluginRegistryState,
  AutomationSummary,
  AutomationUpdateInput,
  ComputerUsePermissionMode,
  ComputerUseSettings,
  ProviderSettings,
  ProviderAuthenticationMethod,
  ProviderModelDefaults,
  HoneycrispRunbookDocument,
  HoneycrispReportDocument,
  HoneycrispReportSummary,
  MemoryDreamingProgressUpdate,
  NotificationRecord,
  OpenAiOAuthStartResult,
  PolicyReviewDecision,
  ResearchModelSelection,
  ResearchModelProviderId,
  ResearchProviderId,
  ResearchProviderOAuthStartResult,
  ResearchProviderModelCatalog,
  ResearchKitRefreshInput,
  ResearchKitRefreshResult,
  ResolvedResearchProfile,
  ResearchProviderStatus,
  RunStatus,
  RunbookProofTargetSelection,
  ScopeAssetInput,
  WorkspaceOnboardingProgressUpdate,
  RunDetail,
  ShellSafetyMode,
  SteeringAction,
  TicketingMode,
  TicketingProviderId,
  TicketingSettings,
  TicketingTarget,
  TicketSubmissionResult,
  WorkspaceEditorCatalog,
  WorkspaceEditorId,
  WorkspaceRegistryEntry,
  WorkspaceSnapshot
} from '@shared/types';
import { AppModals } from './app/AppModals';
import { AppBackgroundPulses } from './app/AppBackgroundPulses';
import { BottomPanel, DEFAULT_BOTTOM_PANEL_OPEN } from './app/BottomPanel';
import { StatusBar } from './app/StatusBar';
import { TopBar } from './app/TopBar';
import { NotificationStack, type WorkspaceAlert } from './features/notifications/Notifications';
import { WorkspaceSidebar } from './features/workspaces/WorkspaceSidebar';
import { WorkspaceStartupView } from './features/workspaces/WorkspaceStartupView';
import { WorkspaceCreationView } from './features/workspaces/WorkspaceCreationView';
import { MainSessionWorkspace } from './features/sessions/MainSessionWorkspace';
import { workspaceScopeDraftForConfigurationUpdate } from './features/workspaces/WorkspaceUnderstandingView';
import type { WorkspaceConfigurationInput } from './features/workspaces/WorkspaceUnderstandingView';
import { ReportsIndex, ReportSessionWorkspace } from './features/reports/ReportsWorkspace';
import { AutomationsWorkspace } from './features/automations/AutomationsWorkspace';
import { PluginManagerWorkspace } from './features/plugins/PluginManagerWorkspace';
import type { ResearchGoalSeed } from './features/sessions/SessionNextSteps';
import {
  isInlineApproval,
  pendingShellApproval,
  ShellApprovalModal
} from './features/sessions/ShellApprovalModal';
import { subagentSummaries, traceEventsForSubagent } from './view-models/subagents';
import { SettingsSidebar, SettingsView, settingsSectionLabel, type SettingsSection } from './features/settings/SettingsModal';
import { useInsetScrollbarActivation } from './hooks/useInsetScrollbarActivation';
import { useWorkspaceActions, type WorkspaceActionOptions } from './hooks/useWorkspaceActions';
import { useProfilingRuntime } from './hooks/useProfilingRuntime';
import { useResizableSidebar } from './hooks/useResizableSidebar';
import { useRunDetailPolling } from './hooks/useRunDetailPolling';
import { useResearchGoalSuggestions } from './hooks/useResearchGoalSuggestions';
import { useSidebarPerformanceProbe } from './hooks/useSidebarPerformanceProbe';
import { usePermissionSettings } from './hooks/usePermissionSettings';
import { useAppearanceTheme } from './hooks/useAppearanceTheme';
import { useSessionHeatPreferences } from './hooks/useSessionHeatPreferences';
import { useSuggestionPreferences } from './hooks/useSuggestionPreferences';
import { filterEnabledProviderModelCatalogs } from '../shared/optionalProviderModels';
import { useWorkspaceRuntime } from './hooks/useWorkspaceRuntime';
import { errorMessage } from './lib/errors';
import {
  activeRunDetailForSelection,
  appShellClassName,
  selectedRunStatus,
  shouldShowHeaderResearchControls,
  workspaceHasLiveResearchRun,
  windowControlPlatformForState
} from './view-models/appShell';
import type { WorkspaceOnboardingFormState } from './view-models/workspaceOnboarding';
import {
  EMPTY_SESSION_HEAT_DISPLAY_STATE,
  sessionHeatDisplayStateForSelection,
  sessionHeatPaletteForProfile,
  sessionHeatPaletteStyle
} from './view-models/sessionHeat';
import { buildTraceDisplayEvents, buildTraceDisplayEventsForAgentPath } from './view-models/traceDisplay';
import { runDetailMetricDetail, shortMetricId } from './view-models/runDetailUpdates';
import { hasResearchProfileDetailFeatures, researchProfileFeatureAvailability } from './view-models/researchProfileFeatures';
import { isReportResourceRun, reportsForReportingScope, reportSessionDefaultModelSelection } from './view-models/reports';
import {
  clearConfirmedProviderOAuthResults,
  isSubscriptionAuthenticationConfirmed
} from './view-models/providerAuthentication';

export function App(): JSX.Element {
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspaceEditors, setWorkspaceEditors] = useState<WorkspaceEditorCatalog | null>(null);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(DEFAULT_BOTTOM_PANEL_OPEN);
  const handleError = useCallback((message: string) => setError(message), []);
  const {
    snapshot,
    workspaceRegistry,
    hostEnvironment,
    windowChromeState,
    openAiStatus,
    startupPhase,
    selectedRunId,
    setWorkspaceRegistry,
    setOpenAiStatus,
    setSelectedRunId,
    applySnapshot,
    loadSnapshot,
    loadWorkspaceRegistry
  } = useWorkspaceRuntime(handleError);
  useEffect(() => {
    if (startupPhase !== 'ready') return;
    let cancelled = false;
    window.beale.getWorkspaceEditors()
      .then((catalog) => {
        if (!cancelled) setWorkspaceEditors(catalog);
      })
      .catch((caught: unknown) => {
        if (!cancelled) handleError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [handleError, startupPhase]);

  useEffect(() => {
    if (startupPhase !== 'ready') return;
    let cancelled = false;
    window.beale.getDebuggingSettings()
      .then((settings) => {
        if (!cancelled) setTracesEnabled(settings.tracesEnabled);
      })
      .catch((caught: unknown) => {
        if (!cancelled) handleError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [handleError, startupPhase]);

  const openWorkspaceInEditor = useCallback((editorId: WorkspaceEditorId): void => {
    setError(null);
    void window.beale.openWorkspaceInEditor(editorId).catch((caught: unknown) => setError(errorMessage(caught)));
  }, []);
  const changeTracesEnabled = useCallback((enabled: boolean): void => {
    setTracesEnabled(enabled);
    void window.beale.setTracesEnabled(enabled)
      .then((settings) => setTracesEnabled(settings.tracesEnabled))
      .catch((caught: unknown) => handleError(errorMessage(caught)));
  }, [handleError]);
  const pendingViewedSessionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedRunId || !workspaceRegistry) return;
    const selectedSession = workspaceRegistry.researchSessions.find((session) => session.runId === selectedRunId);
    if (!selectedSession || selectedSession.resultViewedAt !== null || !isEndedResearchRunStatus(selectedSession.status)) return;
    if (pendingViewedSessionIdsRef.current.has(selectedSession.id)) return;
    pendingViewedSessionIdsRef.current.add(selectedSession.id);
    void window.beale.markResearchSessionViewed(selectedSession.id)
      .then(setWorkspaceRegistry)
      .catch((caught: unknown) => setError(errorMessage(caught)))
      .finally(() => pendingViewedSessionIdsRef.current.delete(selectedSession.id));
  }, [selectedRunId, setWorkspaceRegistry, workspaceRegistry]);
  const [suggestionPreferences, setSuggestionPreference] = useSuggestionPreferences();
  const researchGoalSuggestionState = useResearchGoalSuggestions(
    snapshot,
    openAiStatus?.configured ?? snapshot?.openAi.configured ?? false,
    suggestionPreferences.newResearchPromptSuggestionsEnabled
  );
  const [openAiOAuthResult, setOpenAiOAuthResult] = useState<OpenAiOAuthStartResult | null>(null);
  const [researchProviderStatuses, setResearchProviderStatuses] = useState<ResearchProviderStatus[]>([]);
  const [researchProviderStatusesLoaded, setResearchProviderStatusesLoaded] = useState(false);
  const [researchProviderModelCatalog, setResearchProviderModelCatalog] = useState<ResearchProviderModelCatalog[]>([]);
  const [researchProviderOAuthResults, setResearchProviderOAuthResults] = useState<Partial<Record<ResearchProviderId, ResearchProviderOAuthStartResult>>>({});
  const [providerSettings, setProviderSettings] = useState<ProviderSettings | null>(null);
  const [researchProfiles, setResearchProfiles] = useState<ResolvedResearchProfile[]>([]);
  const [researchProfilesLoading, setResearchProfilesLoading] = useState(false);
  const enabledResearchProviderModelCatalog = useMemo(
    () => filterEnabledProviderModelCatalogs(researchProviderModelCatalog, providerSettings),
    [providerSettings, researchProviderModelCatalog]
  );
  const reportSessionInitialModelSelection = useMemo(
    () => reportSessionDefaultModelSelection(providerSettings, enabledResearchProviderModelCatalog),
    [enabledResearchProviderModelCatalog, providerSettings]
  );
  const [tracesEnabled, setTracesEnabled] = useState(false);
  const [appearanceTheme, setAppearanceTheme] = useAppearanceTheme();
  const [permissionSettings, setDangerModeEnabled, setDefaultShellSafetyMode] = usePermissionSettings();
  const [sessionHeatPreferences, setSessionHeatPreference, setSessionHeatPalettePreference] = useSessionHeatPreferences();
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceOnboardingFormState | null>(null);
  const [workspaceOnboardingProgress, setWorkspaceOnboardingProgress] = useState<WorkspaceOnboardingProgressUpdate | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [workspaceDashboardViewName, setWorkspaceDashboardViewName] = useState('Overview');
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [newResearchInitialGoal, setNewResearchInitialGoal] = useState<ResearchGoalSeed | null>(null);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [automationScopeWorkspaceId, setAutomationScopeWorkspaceId] = useState<string | null>(null);
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationsError, setAutomationsError] = useState<string | null>(null);
  const [selectedAutomationRunId, setSelectedAutomationRunId] = useState<string | null>(null);
  const [selectedAutomationWorkspaceId, setSelectedAutomationWorkspaceId] = useState<string | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportingScopeWorkspaceId, setReportingScopeWorkspaceId] = useState<string | null>(null);
  const [reportingReports, setReportingReports] = useState<HoneycrispReportSummary[]>([]);
  const [reportingReportsLoading, setReportingReportsLoading] = useState(false);
  const [reportingReportsError, setReportingReportsError] = useState<string | null>(null);
  const [reportSessionRunId, setReportSessionRunId] = useState<string | null>(null);
  const [reportSessionRefreshVersion, setReportSessionRefreshVersion] = useState(0);
  const [agentPluginState, setAgentPluginState] = useState<AgentPluginRegistryState | null>(null);
  const [computerUseSettings, setComputerUseSettings] = useState<ComputerUseSettings | null>(null);
  const [ticketingSettings, setTicketingSettings] = useState<TicketingSettings | null>(null);
  const [ticketingTargets, setTicketingTargets] = useState<TicketingTarget[]>([]);
  const [ticketingLoading, setTicketingLoading] = useState(false);
  const [ticketingError, setTicketingError] = useState<string | null>(null);
  const [agentPluginsLoading, setAgentPluginsLoading] = useState(false);
  const [agentPluginsBusy, setAgentPluginsBusy] = useState(false);
  const [agentPluginsError, setAgentPluginsError] = useState<string | null>(null);
  const [pluginRepositoryUrl, setPluginRepositoryUrl] = useState('');
  const [profilingOpen, setProfilingOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationRecord | null>(null);
  const [workspaceAlerts, setWorkspaceAlerts] = useState<WorkspaceAlert[]>([]);
  const [selectedSubagentPath, setSelectedSubagentPath] = useState<string | null>(null);
  const [selectedBreakoutRoomId, setSelectedBreakoutRoomId] = useState<string | null>(null);
  const [selectedRunbookId, setSelectedRunbookId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedReportWorkspaceId, setSelectedReportWorkspaceId] = useState<string | null>(null);
  const [rightSidenavExpanded, setRightSidenavExpanded] = useState(false);
  const [selectedRunbookDocument, setSelectedRunbookDocument] = useState<HoneycrispRunbookDocument | null>(null);
  const [runbookLoading, setRunbookLoading] = useState(false);
  const [runbookError, setRunbookError] = useState<string | null>(null);
  const runbookExecutionRequestRef = useRef(0);
  const [selectedReportDocument, setSelectedReportDocument] = useState<HoneycrispReportDocument | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [workspaceDejunkInProgress, setWorkspaceDejunkInProgress] = useState(false);
  const [memoryDreamingInProgress, setMemoryDreamingInProgress] = useState(false);
  const [memoryDreamingProgress, setMemoryDreamingProgress] = useState<MemoryDreamingProgressUpdate | null>(null);
  const memoryDreamingProgressClearTimerRef = useRef<number | null>(null);
  const [shellApprovalDecisionInFlight, setShellApprovalDecisionInFlight] = useState<string | null>(null);
  const shellApprovalDecisionRef = useRef<string | null>(null);
  const { sidebarWidth, sidebarCollapsed, sidebarToggleProfile, toggleSidebar, beginSidebarResize } = useResizableSidebar();
  const {
    profilingState,
    lastProfilingReport,
    flushProfilingReport
  } = useProfilingRuntime(handleError, {
    active: startupPhase === 'ready' || profilingOpen || settingsOpen,
    observeReports: profilingOpen || settingsOpen
  });
  const selectedRunState = selectedRunStatus(snapshot, selectedRunId);
  const runDetailProjection = 'commentary' as const;
  const selectedRunRefreshKey = useMemo(() => {
    const selected = snapshot?.runs.find((row) => row.run.id === selectedRunId)?.run;
    if (!selected) return null;
    const pendingApprovalIds = snapshot?.pendingShellApprovals
      .filter((approval) => approval.runId === selected.id)
      .map((approval) => approval.id)
      .join(',') ?? '';
    return `${selected.status}:${selected.shellSafetyMode}:${pendingApprovalIds}:${reportsOpen ? reportSessionRefreshVersion : 0}`;
  }, [reportSessionRefreshVersion, reportsOpen, selectedRunId, snapshot?.pendingShellApprovals, snapshot?.runs]);
  const handleRunDetailError = useCallback((message: string) => setError(message), []);
  const { runDetail, clearRunDetail } = useRunDetailPolling({
    selectedRunId,
    selectedRunState,
    projection: runDetailProjection,
    refreshKey: selectedRunRefreshKey,
    onError: handleRunDetailError
  });
  useDevRenderProbe('app.shell', () => ({
    selectedRun: selectedRunId ? shortMetricId(selectedRunId) : 'none',
    workspaces: workspaceRegistry?.workspaces.length ?? 0,
    sessions: workspaceRegistry?.researchSessions.length ?? 0,
    traceEvents: runDetail?.traceEvents.length ?? 0,
    transcripts: runDetail?.transcriptMessages.length ?? 0
  }));
  useDevInputLatencyProbe();
  useSidebarPerformanceProbe({ appShellRef, profile: sidebarToggleProfile });
  useInsetScrollbarActivation();

  useEffect(() => {
    if (memoryDreamingProgressClearTimerRef.current !== null) {
      window.clearTimeout(memoryDreamingProgressClearTimerRef.current);
      memoryDreamingProgressClearTimerRef.current = null;
    }
    setMemoryDreamingProgress(null);
    const workspaceId = snapshot?.workspace.workspaceId;
    const unsubscribe = window.beale.onMemoryDreamingProgress((update) => {
      if (workspaceId && update.workspaceId !== workspaceId) return;
      if (memoryDreamingProgressClearTimerRef.current !== null) {
        window.clearTimeout(memoryDreamingProgressClearTimerRef.current);
        memoryDreamingProgressClearTimerRef.current = null;
      }
      setMemoryDreamingProgress(update);
      if (update.phase === 'completed' || update.phase === 'failed') {
        memoryDreamingProgressClearTimerRef.current = window.setTimeout(() => {
          setMemoryDreamingProgress((current) => current?.updatedAt === update.updatedAt ? null : current);
          memoryDreamingProgressClearTimerRef.current = null;
        }, 1_400);
      }
    });
    return () => {
      unsubscribe();
      if (memoryDreamingProgressClearTimerRef.current !== null) {
        window.clearTimeout(memoryDreamingProgressClearTimerRef.current);
        memoryDreamingProgressClearTimerRef.current = null;
      }
    };
  }, [snapshot?.workspace.workspaceId]);

  const researchViewContextKey = selectedRunId
    ?? snapshot?.workspace.workspaceId
    ?? snapshot?.workspace.workspacePath
    ?? null;
  useEffect(() => {
    setRightSidenavExpanded(false);
    setSelectedBreakoutRoomId(null);
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookLoading(false);
    setRunbookError(null);
  }, [researchViewContextKey]);

  useEffect(() => {
    if (!newResearchOpen && !automationsOpen && !reportsOpen && !(settingsOpen && settingsSection === 'providers')) return;
    window.beale
      .getProviderSettings()
      .then(setProviderSettings)
      .catch((caught: unknown) => handleError(errorMessage(caught)));
  }, [automationsOpen, handleError, newResearchOpen, reportsOpen, settingsOpen, settingsSection]);

  useEffect(() => {
    if (!settingsOpen || settingsSection !== 'profile') return;
    let cancelled = false;
    setResearchProfiles([]);
    setResearchProfilesLoading(true);
    window.beale
      .getResearchProfiles()
      .then((profiles) => {
        if (!cancelled) setResearchProfiles(profiles);
      })
      .catch((caught: unknown) => {
        if (!cancelled) handleError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setResearchProfilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handleError, settingsOpen, settingsSection, snapshot?.workspace.workspacePath]);

  const runAction = useCallback(
    async (action: () => Promise<WorkspaceSnapshot | null | void>) => {
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        if (next) applySnapshot(next);
        else await loadSnapshot();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, loadSnapshot]
  );

  const changeWorkspaceResource = useCallback(async (
    replacedAssetIds: string[],
    asset: ScopeAssetInput | null
  ): Promise<void> => {
    const activeScope = snapshot?.activeScope;
    if (!activeScope) throw new Error('The active workspace scope is unavailable.');
    setBusy(true);
    setError(null);
    try {
      const replacedAssetIdSet = new Set(replacedAssetIds);
      const assets: ScopeAssetInput[] = activeScope.assets
        .filter((existingAsset) => !replacedAssetIdSet.has(existingAsset.id))
        .map((existingAsset) => ({
          direction: existingAsset.direction,
          kind: existingAsset.kind,
          value: existingAsset.value,
          sensitivity: existingAsset.sensitivity,
          attributes: existingAsset.attributes
        }));
      applySnapshot(await window.beale.saveScope({
        workspaceName: activeScope.workspaceName,
        scopeOwner: activeScope.scopeOwner,
        descriptionMarkdown: activeScope.descriptionMarkdown,
        rulesMarkdown: '',
        expiresAt: activeScope.expiresAt,
        assets: asset ? [...assets, asset] : assets
      }));
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, snapshot?.activeScope]);

  const addWorkspaceResource = useCallback(
    (asset: ScopeAssetInput): Promise<void> => changeWorkspaceResource([], asset),
    [changeWorkspaceResource]
  );

  const cloneWorkspaceRepository = useCallback(async (assetId: string): Promise<void> => {
    setError(null);
    try {
      applySnapshot(await window.beale.cloneWorkspaceRepository(assetId));
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    }
  }, [applySnapshot]);

  const addWorkspaceRule = useCallback(async (text: string): Promise<void> => {
    setError(null);
    try {
      applySnapshot(await window.beale.addWorkspaceRule(text));
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    }
  }, [applySnapshot]);

  const refreshWorkspaceResearchKit = useCallback(async (input: ResearchKitRefreshInput): Promise<ResearchKitRefreshResult> => {
    setError(null);
    try {
      const result = await window.beale.refreshResearchKit(input);
      applySnapshot(result.snapshot);
      return result;
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    }
  }, [applySnapshot]);

  const saveWorkspaceConfiguration = useCallback(async (
    configuration: WorkspaceConfigurationInput
  ): Promise<void> => {
    const activeScope = snapshot?.activeScope;
    if (!activeScope) throw new Error('The active workspace scope is unavailable.');
    setError(null);
    try {
      applySnapshot(await window.beale.saveScope(
        workspaceScopeDraftForConfigurationUpdate(activeScope, configuration)
      ));
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    }
  }, [applySnapshot, snapshot?.activeScope]);

  const changeWorkspaceDirectories = useCallback(async (directories: string[]): Promise<void> => {
    setError(null);
    try {
      applySnapshot(await window.beale.updateWorkspaceDirectories(directories));
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      throw caught;
    }
  }, [applySnapshot]);

  const loadAgentPlugins = useCallback(async (): Promise<void> => {
    setAgentPluginsLoading(true);
    setAgentPluginsError(null);
    try {
      setAgentPluginState(await window.beale.getAgentPlugins());
    } catch (caught) {
      setAgentPluginsError(errorMessage(caught));
    } finally {
      setAgentPluginsLoading(false);
    }
  }, []);

  const loadComputerUseSettings = useCallback(async (): Promise<void> => {
    try {
      setComputerUseSettings(await window.beale.getComputerUseSettings());
    } catch (caught) {
      setAgentPluginsError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    if (!settingsOpen || settingsSection !== 'computer-use' || hostEnvironment?.platform !== 'win32') return;
    void loadAgentPlugins();
    void loadComputerUseSettings();
  }, [hostEnvironment?.platform, loadAgentPlugins, loadComputerUseSettings, settingsOpen, settingsSection]);

  const loadTicketingTargets = useCallback(async (providerId: TicketingProviderId): Promise<void> => {
    setTicketingLoading(true);
    setTicketingError(null);
    try {
      setTicketingTargets(await window.beale.listTicketingTargets(providerId));
    } catch (caught) {
      setTicketingTargets([]);
      setTicketingError(errorMessage(caught));
    } finally {
      setTicketingLoading(false);
    }
  }, []);

  const loadTicketingSettings = useCallback(async (loadTargets: boolean): Promise<void> => {
    setTicketingLoading(true);
    setTicketingError(null);
    try {
      const next = await window.beale.getTicketingSettings();
      setTicketingSettings(next);
      if (loadTargets && next.provider !== 'local' && next[next.provider].credentialConfigured) {
        setTicketingTargets(await window.beale.listTicketingTargets(next.provider));
      } else {
        setTicketingTargets([]);
      }
    } catch (caught) {
      setTicketingError(errorMessage(caught));
    } finally {
      setTicketingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTicketingSettings(false);
  }, [loadTicketingSettings]);

  useEffect(() => {
    if (!settingsOpen || settingsSection !== 'ticketing') return;
    void loadTicketingSettings(true);
  }, [loadTicketingSettings, settingsOpen, settingsSection]);

  const changeTicketingProvider = useCallback(async (providerId: TicketingMode): Promise<void> => {
    setTicketingLoading(true);
    setTicketingError(null);
    try {
      const next = await window.beale.setTicketingProvider(providerId);
      setTicketingSettings(next);
      if (providerId !== 'local' && next[providerId].credentialConfigured) {
        setTicketingTargets(await window.beale.listTicketingTargets(providerId));
      } else {
        setTicketingTargets([]);
      }
    } catch (caught) {
      setTicketingError(errorMessage(caught));
    } finally {
      setTicketingLoading(false);
    }
  }, []);

  const changeTicketingHumanInTheLoop = useCallback(async (enabled: boolean): Promise<void> => {
    setTicketingLoading(true);
    setTicketingError(null);
    try {
      setTicketingSettings(await window.beale.setTicketingHumanInTheLoop(enabled));
    } catch (caught) {
      setTicketingError(errorMessage(caught));
    } finally {
      setTicketingLoading(false);
    }
  }, []);

  const configureTicketingCredential = useCallback(async (providerId: TicketingProviderId, apiKey: string): Promise<void> => {
    setTicketingLoading(true);
    setTicketingError(null);
    try {
      setTicketingSettings(await window.beale.configureTicketingCredential(providerId, apiKey));
      setTicketingTargets(await window.beale.listTicketingTargets(providerId));
    } catch (caught) {
      setTicketingError(errorMessage(caught));
      throw caught;
    } finally {
      setTicketingLoading(false);
    }
  }, []);

  const removeTicketingCredential = useCallback(async (providerId: TicketingProviderId): Promise<void> => {
    setTicketingLoading(true);
    setTicketingError(null);
    try {
      setTicketingSettings(await window.beale.removeTicketingCredential(providerId));
      setTicketingTargets([]);
    } catch (caught) {
      setTicketingError(errorMessage(caught));
    } finally {
      setTicketingLoading(false);
    }
  }, []);

  const changeTicketingTarget = useCallback(async (providerId: TicketingProviderId, target: TicketingTarget): Promise<void> => {
    setTicketingLoading(true);
    setTicketingError(null);
    try {
      setTicketingSettings(await window.beale.setTicketingTarget(providerId, target));
    } catch (caught) {
      setTicketingError(errorMessage(caught));
    } finally {
      setTicketingLoading(false);
    }
  }, []);

  const openPlugins = useCallback((): void => {
    clearRunDetail();
    setSelectedRunId(null);
    setSelectedBreakoutRoomId(null);
    setReportsOpen(false);
    setAutomationsOpen(false);
    setPluginsOpen(true);
    void loadAgentPlugins();
  }, [clearRunDetail, loadAgentPlugins, setSelectedRunId]);

  const runAgentPluginAction = useCallback(async (action: () => Promise<AgentPluginRegistryState>): Promise<void> => {
    setAgentPluginsBusy(true);
    setAgentPluginsError(null);
    try {
      setAgentPluginState(await action());
    } catch (caught) {
      setAgentPluginsError(errorMessage(caught));
    } finally {
      setAgentPluginsBusy(false);
    }
  }, []);

  const addAgentPluginFromFilesystem = useCallback((): void => {
    void runAgentPluginAction(() => window.beale.addAgentPluginFromFilesystem());
  }, [runAgentPluginAction]);

  const addAgentPluginFromRepository = useCallback((): void => {
    const repositoryUrl = pluginRepositoryUrl.trim();
    if (!repositoryUrl) return;
    void runAgentPluginAction(async () => {
      const state = await window.beale.addAgentPluginFromRepository(repositoryUrl);
      setPluginRepositoryUrl('');
      return state;
    });
  }, [pluginRepositoryUrl, runAgentPluginAction]);

  const setAgentPluginEnabled = useCallback((pluginId: string, enabled: boolean): void => {
    void runAgentPluginAction(() => window.beale.setAgentPluginEnabled(pluginId, enabled));
  }, [runAgentPluginAction]);

  const changeComputerUsePermissionMode = useCallback((permissionMode: ComputerUsePermissionMode): void => {
    setAgentPluginsBusy(true);
    setAgentPluginsError(null);
    void window.beale.setComputerUsePermissionMode(permissionMode)
      .then(setComputerUseSettings)
      .catch((caught: unknown) => setAgentPluginsError(errorMessage(caught)))
      .finally(() => setAgentPluginsBusy(false));
  }, []);

  const removeAgentPlugin = useCallback((pluginId: string): void => {
    void runAgentPluginAction(() => window.beale.removeAgentPlugin(pluginId));
  }, [runAgentPluginAction]);

  const openNotification = useCallback(
    async (notification: NotificationRecord) => {
      setActiveNotification(notification);
      try {
        applySnapshot(await window.beale.openNotification(notification.id));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [applySnapshot]
  );

  const dismissNotification = useCallback(
    async (notificationId: string) => {
      try {
        applySnapshot(await window.beale.dismissNotification(notificationId));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [applySnapshot]
  );

  const dismissWorkspaceAlert = useCallback((alertId: string) => {
    setWorkspaceAlerts((current) => current.filter((alert) => alert.id !== alertId));
  }, []);

  const closeWorkspaceOnboarding = useCallback((): void => {
    setWorkspaceDraft(null);
    setWorkspaceOnboardingProgress(null);
    setError(null);
  }, []);

  const openWorkspaceAlert = useCallback((_alert: WorkspaceAlert) => undefined, []);

  const runWorkspaceAction = useCallback(
    async (action: () => Promise<void>, { markBusy = true, reloadRegistry = true }: WorkspaceActionOptions = {}) => {
      if (markBusy) {
        setBusy(true);
      }
      setError(null);
      try {
        await action();
        if (reloadRegistry) {
          await loadWorkspaceRegistry();
        }
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (markBusy) {
          setBusy(false);
        }
      }
    },
    [loadWorkspaceRegistry]
  );

  const runMemoryDreaming = useCallback((): void => {
    if (snapshot?.researchProfile.profile.capabilities.memoryEnabled === false) return;
    if (memoryDreamingProgressClearTimerRef.current !== null) {
      window.clearTimeout(memoryDreamingProgressClearTimerRef.current);
      memoryDreamingProgressClearTimerRef.current = null;
    }
    setMemoryDreamingProgress(null);
    setMemoryDreamingInProgress(true);
    void runAction(() => window.beale.runMemoryDreaming())
      .finally(() => setMemoryDreamingInProgress(false));
  }, [runAction, snapshot?.researchProfile.profile.capabilities.memoryEnabled]);

  const runWorkspaceDejunk = useCallback((): void => {
    setWorkspaceDejunkInProgress(true);
    void runAction(() => window.beale.runWorkspaceDejunk())
      .finally(() => setWorkspaceDejunkInProgress(false));
  }, [runAction]);

  const openHoneycrispRunbook = useCallback((runbookId: string): void => {
    setRightSidenavExpanded(true);
    setSelectedBreakoutRoomId(null);
    setSelectedSubagentPath(null);
    setSelectedReportId(null);
    setSelectedReportWorkspaceId(null);
    setSelectedReportDocument(null);
    setReportError(null);
    setSelectedRunbookId(runbookId);
  }, []);

  const openHoneycrispReport = useCallback((reportId: string): void => {
    setRightSidenavExpanded(true);
    setSelectedBreakoutRoomId(null);
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
    setSelectedReportId(reportId);
    setSelectedReportWorkspaceId(snapshot?.workspace.workspaceId ?? null);
  }, [snapshot?.workspace.workspaceId]);

  const openReports = useCallback((): void => {
    clearRunDetail();
    setSelectedRunId(null);
    setSelectedBreakoutRoomId(null);
    setSelectedReportId(null);
    setSelectedReportWorkspaceId(null);
    setSelectedReportDocument(null);
    setReportSessionRunId(null);
    setReportSessionRefreshVersion(0);
    setReportError(null);
    setError(null);
    setReportingScopeWorkspaceId(snapshot?.workspace.workspaceId ?? null);
    setAutomationsOpen(false);
    setPluginsOpen(false);
    setReportsOpen(true);
  }, [clearRunDetail, setSelectedRunId, snapshot?.workspace.workspaceId]);

  const reportingWorkspaceCatalogKey = workspaceRegistry?.workspaces
    .map((workspace) => `${workspace.id}:${workspace.workspaceId}:${workspace.updatedAt}`)
    .join('|') ?? '';
  const activeWorkspaceReportCatalogKey = snapshot?.honeycrispMemory.reports
    .map((report) => `${report.id}:${report.revision}:${report.updatedAt}`)
    .join('|') ?? '';
  const automaticTicketingEnabled = ticketingSettings?.provider !== undefined
    && ticketingSettings.provider !== 'local'
    && !ticketingSettings.automation.humanInTheLoop
    && ticketingSettings[ticketingSettings.provider].credentialConfigured
    && Boolean(ticketingSettings[ticketingSettings.provider].targetId);
  useEffect(() => {
    if (!reportsOpen && !automaticTicketingEnabled) return undefined;
    let cancelled = false;
    if (reportsOpen) {
      setReportingReportsLoading(true);
      setReportingReportsError(null);
    }
    void window.beale.listReportingReports()
      .then((reports) => {
        if (!cancelled) setReportingReports(reports);
      })
      .catch((caught: unknown) => {
        if (!cancelled && reportsOpen) setReportingReportsError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled && reportsOpen) setReportingReportsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceReportCatalogKey, automaticTicketingEnabled, reportingWorkspaceCatalogKey, reportsOpen]);

  useEffect(() => {
    if (!workspaceRegistry || !reportingScopeWorkspaceId) return;
    if (workspaceRegistry.workspaces.some((workspace) => workspace.workspaceId === reportingScopeWorkspaceId)) return;
    setReportingScopeWorkspaceId(null);
  }, [reportingScopeWorkspaceId, workspaceRegistry]);

  useEffect(() => {
    if (!automationsOpen) return undefined;
    let cancelled = false;
    setAutomationsLoading(true);
    setAutomationsError(null);
    void window.beale.listAutomations()
      .then((next) => {
        if (!cancelled) setAutomations(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setAutomationsError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setAutomationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [automationsOpen, reportingWorkspaceCatalogKey, snapshot?.version]);

  useEffect(() => {
    if (!workspaceRegistry || !automationScopeWorkspaceId) return;
    if (workspaceRegistry.workspaces.some((workspace) => workspace.workspaceId === automationScopeWorkspaceId)) return;
    setAutomationScopeWorkspaceId(null);
  }, [automationScopeWorkspaceId, workspaceRegistry]);

  useEffect(() => {
    if (!selectedAutomationRunId || !selectedAutomationWorkspaceId) return;
    if (automations.some((automation) => automation.runId === selectedAutomationRunId && automation.workspaceId === selectedAutomationWorkspaceId)) return;
    setSelectedAutomationRunId(null);
    setSelectedAutomationWorkspaceId(null);
  }, [automations, selectedAutomationRunId, selectedAutomationWorkspaceId]);

  const openReportSession = useCallback((report: HoneycrispReportSummary): void => {
    clearRunDetail();
    setSelectedRunId(null);
    setSelectedReportId(report.id);
    setSelectedReportWorkspaceId(report.workspaceId);
    setSelectedReportDocument(null);
    setReportSessionRunId(null);
    setReportSessionRefreshVersion(0);
    setReportError(null);
    setError(null);
  }, [clearRunDetail, setSelectedRunId]);

  const startReportTurn = useCallback(async (
    instruction: string,
    modelSelection?: ResearchModelSelection,
    shellSafetyMode?: ShellSafetyMode
  ): Promise<void> => {
    if (!selectedReportId || !selectedReportWorkspaceId) throw new Error('No report is selected.');
    const report = reportingReports.find((candidate) => (
      candidate.id === selectedReportId && candidate.workspaceId === selectedReportWorkspaceId
    )) ?? snapshot?.honeycrispMemory.reports.find((candidate) => (
      candidate.id === selectedReportId && candidate.workspaceId === selectedReportWorkspaceId
    ));
    if (!report) throw new Error('The selected report is no longer available.');
    setBusy(true);
    setError(null);
    try {
      const result = await window.beale.startReportSession({
        workspaceId: report.workspaceId,
        reportId: selectedReportId,
        instruction,
        ...(modelSelection ? { modelSelection } : {}),
        ...(shellSafetyMode ? { shellSafetyMode } : {})
      });
      applySnapshot(result.snapshot);
      setReportSessionRunId(result.runId);
      setSelectedRunId(result.runId);
    } catch (caught: unknown) {
      const message = errorMessage(caught);
      setReportError(message);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, reportingReports, selectedReportId, selectedReportWorkspaceId, setSelectedRunId, snapshot?.honeycrispMemory.reports]);

  const submitReportChange = useCallback(async (instruction: string): Promise<void> => {
    if (!reportSessionRunId) {
      await startReportTurn(instruction);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await window.beale.steerRun({
        type: 'steer',
        runId: reportSessionRunId,
        instruction
      });
      applySnapshot(next);
      setReportSessionRefreshVersion((version) => version + 1);
    } catch (caught: unknown) {
      const message = errorMessage(caught);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, reportSessionRunId, startReportTurn]);

  const selectSubagent = useCallback((path: string): void => {
    setRightSidenavExpanded(true);
    setSelectedBreakoutRoomId(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
    setSelectedReportId(null);
    setSelectedReportWorkspaceId(null);
    setSelectedReportDocument(null);
    setReportError(null);
    setSelectedSubagentPath(path);
  }, []);

  const openBreakoutRoom = useCallback((roomId: string): void => {
    setRightSidenavExpanded(true);
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
    setSelectedReportId(null);
    setSelectedReportWorkspaceId(null);
    setSelectedReportDocument(null);
    setReportError(null);
    setSelectedBreakoutRoomId(roomId);
  }, []);

  const backToRooms = useCallback((): void => {
    setSelectedBreakoutRoomId(null);
  }, []);

  const backToRunbooks = useCallback((): void => {
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
  }, []);

  const backToReports = useCallback((): void => {
    setSelectedReportId(null);
    setSelectedReportWorkspaceId(null);
    setSelectedReportDocument(null);
    setReportError(null);
  }, []);

  const backToSubagents = useCallback((): void => {
    setSelectedSubagentPath(null);
  }, []);

  const refreshOpenAiProvider = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (snapshot) {
        const next = await window.beale.refreshOpenAiStatus();
        applySnapshot(next);
      } else {
        setOpenAiStatus(await window.beale.getOpenAiStatus());
      }
      setResearchProviderStatuses(await window.beale.getResearchProviderStatuses());
      setResearchProviderStatusesLoaded(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, snapshot]);

  const loadResearchProviderStatuses = useCallback(async (): Promise<void> => {
    try {
      setResearchProviderStatuses(await window.beale.getResearchProviderStatuses());
      setResearchProviderStatusesLoaded(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const loadOpenAiProviderStatus = useCallback(async (): Promise<void> => {
    try {
      setOpenAiStatus(await window.beale.getOpenAiStatus());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const loadResearchProviderModelCatalog = useCallback(async (): Promise<void> => {
    try {
      setResearchProviderModelCatalog(await window.beale.getResearchProviderModelCatalog());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    if (!newResearchOpen && !automationsOpen && !(settingsOpen && settingsSection === 'providers')) return;
    void loadResearchProviderStatuses();
    void loadOpenAiProviderStatus();
  }, [automationsOpen, loadOpenAiProviderStatus, loadResearchProviderStatuses, newResearchOpen, settingsOpen, settingsSection]);

  useEffect(() => {
    if (!newResearchOpen && !automationsOpen && !reportsOpen && !selectedRunId && !(settingsOpen && settingsSection === 'providers')) return;
    void loadResearchProviderModelCatalog();
  }, [automationsOpen, loadResearchProviderModelCatalog, newResearchOpen, reportsOpen, selectedRunId, settingsOpen, settingsSection]);

  useEffect(() => {
    if (!settingsOpen || !researchProviderStatuses.some((provider) => provider.loginInProgress)) return;
    let inFlight = false;
    const poll = async (): Promise<void> => {
      if (inFlight) return;
      inFlight = true;
      try {
        await loadResearchProviderStatuses();
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadResearchProviderStatuses, researchProviderStatuses, settingsOpen]);

  const openAiConfigured = openAiStatus?.configured ?? snapshot?.openAi.configured ?? false;
  const openAiAuthenticationRunning = openAiStatus?.loginInProgress ?? false;
  useEffect(() => {
    if (!settingsOpen || settingsSection !== 'providers' || !openAiOAuthResult?.started || (openAiConfigured && !openAiAuthenticationRunning)) return;
    void loadOpenAiProviderStatus();
    const timer = window.setInterval(() => void loadOpenAiProviderStatus(), 2_000);
    const timeout = window.setTimeout(() => window.clearInterval(timer), 5 * 60_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [loadOpenAiProviderStatus, openAiAuthenticationRunning, openAiConfigured, openAiOAuthResult?.started, settingsOpen, settingsSection]);

  useEffect(() => {
    if (!openAiOAuthResult || !isSubscriptionAuthenticationConfirmed(openAiStatus)) return;
    setOpenAiOAuthResult(null);
  }, [openAiOAuthResult, openAiStatus]);

  useEffect(() => {
    setResearchProviderOAuthResults((current) =>
      clearConfirmedProviderOAuthResults(current, researchProviderStatuses));
  }, [researchProviderStatuses]);

  const setDefaultProviderId = useCallback(async (providerId: ResearchModelProviderId | null): Promise<void> => {
    setError(null);
    try {
      setProviderSettings(await window.beale.setDefaultProviderId(providerId));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const setProviderModelDefaults = useCallback(async (
    providerId: ResearchModelProviderId,
    defaults: ProviderModelDefaults
  ): Promise<void> => {
    setError(null);
    try {
      setProviderSettings(await window.beale.setProviderModelDefaults(providerId, defaults));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const setProviderOptionalModelEnabled = useCallback(async (
    providerId: ResearchModelProviderId,
    modelId: string,
    enabled: boolean
  ): Promise<void> => {
    setError(null);
    try {
      setProviderSettings(await window.beale.setProviderOptionalModelEnabled(providerId, modelId, enabled));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const setProviderCyberPolicyRiskAcknowledged = useCallback(async (
    providerId: ResearchModelProviderId,
    acknowledged: boolean
  ): Promise<void> => {
    setError(null);
    try {
      setProviderSettings(await window.beale.setProviderCyberPolicyRiskAcknowledged(providerId, acknowledged));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const setProviderPreferredAuthenticationMethod = useCallback(async (
    providerId: ResearchModelProviderId,
    method: ProviderAuthenticationMethod
  ): Promise<void> => {
    setError(null);
    try {
      setProviderSettings(await window.beale.setProviderPreferredAuthenticationMethod(providerId, method));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const startOpenAiOAuth = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.beale.startOpenAiOAuth();
      setOpenAiOAuthResult(result);
      setOpenAiStatus(await window.beale.getOpenAiStatus());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const startResearchProviderOAuth = useCallback(async (providerId: ResearchProviderId) => {
    setBusy(true);
    setError(null);
    setResearchProviderOAuthResults((current) => ({
      ...current,
      [providerId]: {
        providerId,
        started: true,
        command: `honeycrisp auth login ${providerId}`,
        detail: `Starting ${providerId === 'anthropic' ? 'Claude.ai subscription' : providerId === 'zai' ? 'Z.ai subscription' : 'provider'} authentication…`,
        verificationUri: null,
        userCode: null,
        instructions: null
      }
    }));
    try {
      const result = await window.beale.startResearchProviderOAuth(providerId);
      setResearchProviderOAuthResults((current) => ({ ...current, [providerId]: result }));
      setResearchProviderStatuses(await window.beale.getResearchProviderStatuses());
      setResearchProviderStatusesLoaded(true);
    } catch (caught) {
      setResearchProviderOAuthResults((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const reloadProviderAuthentication = useCallback(async (): Promise<void> => {
    setOpenAiStatus(await window.beale.getOpenAiStatus());
    setResearchProviderStatuses(await window.beale.getResearchProviderStatuses());
    setResearchProviderStatusesLoaded(true);
  }, []);

  const forgetProviderSubscription = useCallback(async (providerId: ResearchModelProviderId): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setProviderSettings(await window.beale.forgetProviderSubscription(providerId));
      await reloadProviderAuthentication();
      if (providerId === 'openai-codex') {
        setOpenAiOAuthResult(null);
      } else {
        setResearchProviderOAuthResults((current) => {
          if (!(providerId in current)) return current;
          const next = { ...current };
          delete next[providerId];
          return next;
        });
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [reloadProviderAuthentication]);

  const removeProvider = useCallback(async (providerId: ResearchModelProviderId): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setProviderSettings(await window.beale.removeProvider(providerId));
      await reloadProviderAuthentication();
      if (providerId === 'openai-codex') {
        setOpenAiOAuthResult(null);
      } else {
        setResearchProviderOAuthResults((current) => {
          if (!(providerId in current)) return current;
          const next = { ...current };
          delete next[providerId];
          return next;
        });
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [reloadProviderAuthentication]);

  const configureProviderApiKey = useCallback(async (providerId: ResearchModelProviderId, apiKey: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await window.beale.configureProviderApiKey(providerId, apiKey);
      await reloadProviderAuthentication();
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setBusy(false);
    }
  }, [reloadProviderAuthentication]);

  const removeProviderApiKey = useCallback(async (providerId: ResearchModelProviderId): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setProviderSettings(await window.beale.removeProviderApiKey(providerId));
      await reloadProviderAuthentication();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [reloadProviderAuthentication]);

  const {
    addWorkspace,
    openRegisteredWorkspace,
    openResearchSession,
    removeRegisteredWorkspace,
    submitWorkspaceOnboarding,
    applyOnboardingResearchKit,
    lookupHackerOneScope
  } = useWorkspaceActions({
    snapshot,
    selectedRunId,
    workspaceDraft,
    runWorkspaceAction,
    applySnapshot,
    clearRunDetail,
    setSelectedRunId,
    setWorkspaceDraft,
    setWorkspaceOnboardingProgress
  });
  const beginWorkspaceCreation = useCallback((): void => {
    setError(null);
    addWorkspace();
  }, [addWorkspace]);
  const removeActiveWorkspace = useCallback(async (): Promise<void> => {
    const workspaceId = snapshot?.workspace.workspaceId;
    const workspace = workspaceRegistry?.workspaces.find((candidate) => candidate.workspaceId === workspaceId);
    if (!workspace) throw new Error('The active workspace registry entry is unavailable.');
    await removeRegisteredWorkspace(workspace);
  }, [removeRegisteredWorkspace, snapshot?.workspace.workspaceId, workspaceRegistry?.workspaces]);

  useEffect(() => window.beale.onNativeMenuAction(() => beginWorkspaceCreation()), [beginWorkspaceCreation]);

  const handleSessionAction = useCallback(
    (action: SteeringAction): void => {
      void runAction(() => window.beale.steerRun(action));
    },
    [runAction]
  );

  const handleSteerInstruction = useCallback(
    (runId: string, instruction: string, modelSelection: ResearchModelSelection): void => {
      handleSessionAction({ type: 'steer', runId, instruction, modelSelection });
    },
    [handleSessionAction]
  );

  const activeRunDetail = activeRunDetailForSelection(runDetail, selectedRunId);
  useEffect(() => {
    if (!selectedBreakoutRoomId || !activeRunDetail) return;
    if ((activeRunDetail.breakoutRooms ?? []).some((room) => room.id === selectedBreakoutRoomId)) return;
    setSelectedBreakoutRoomId(null);
  }, [activeRunDetail, selectedBreakoutRoomId]);
  const activeResearchProfile = selectedRunId
    ? activeRunDetail?.researchProfile?.profile ?? null
    : snapshot?.researchProfile.profile ?? null;
  const activeResearchFeatures = researchProfileFeatureAvailability(activeResearchProfile);
  const researchDetailsAvailable = (selectedRunId ? activeRunDetail !== null : snapshot !== null)
    && (selectedRunId
      ? hasResearchProfileDetailFeatures(activeResearchProfile)
      : activeResearchFeatures.memory || activeResearchFeatures.runbooks || activeResearchFeatures.reports);

  const selectedShellApproval = useMemo(() => {
    if (!snapshot) return pendingShellApproval(activeRunDetail);
    return snapshot.pendingShellApprovals.find((approval) => approval.runId === selectedRunId) ?? null;
  }, [activeRunDetail?.policyEvents, selectedRunId, snapshot]);
  const inlineApproval = isInlineApproval(selectedShellApproval)
    ? selectedShellApproval
    : null;
  const activeManualShellApproval = useMemo(() => {
    if (selectedShellApproval && !isInlineApproval(selectedShellApproval)) return selectedShellApproval;
    return snapshot?.pendingShellApprovals.find((approval) => !isInlineApproval(approval)) ?? null;
  }, [selectedShellApproval, snapshot?.pendingShellApprovals]);
  const activeShellApproval = inlineApproval ?? activeManualShellApproval;
  useEffect(() => {
    if (shellApprovalDecisionRef.current === activeShellApproval?.id) return;
    shellApprovalDecisionRef.current = null;
    setShellApprovalDecisionInFlight(null);
  }, [activeShellApproval?.id]);

  const handleShellApprovalDecision = useCallback((
    approval: ApprovalRecord,
    decision: PolicyReviewDecision
  ): void => {
    if (shellApprovalDecisionRef.current) return;
    shellApprovalDecisionRef.current = approval.id;
    setShellApprovalDecisionInFlight(approval.id);
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const next = await window.beale.steerRun({
          type: 'review_shell_command',
          workspacePath: shellApprovalWorkspacePath(approval),
          runId: approval.runId,
          approvalId: approval.id,
          decision
        });
        if (next) applySnapshot(next);
      } catch (caught) {
        shellApprovalDecisionRef.current = null;
        setShellApprovalDecisionInFlight(null);
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    })();
  }, [applySnapshot]);
  const researchPanelMemory = selectedRunId
    ? activeRunDetail?.honeycrispMemory ?? null
    : snapshot?.honeycrispMemory ?? null;
  const selectedRunbook = useMemo(
    () => researchPanelMemory?.runbooks.find((runbook) => runbook.id === selectedRunbookId) ?? null,
    [researchPanelMemory?.runbooks, selectedRunbookId]
  );
  const selectedReport = useMemo(
    () => {
      if (!reportsOpen) {
        return researchPanelMemory?.reports.find((report) => (
          report.id === selectedReportId && (!selectedReportWorkspaceId || report.workspaceId === selectedReportWorkspaceId)
        )) ?? null;
      }
      const catalogReport = reportingReports.find((report) => (
        report.id === selectedReportId && report.workspaceId === selectedReportWorkspaceId
      )) ?? null;
      return snapshot?.honeycrispMemory.reports.find((report) => (
        report.id === selectedReportId && report.workspaceId === selectedReportWorkspaceId
      )) ?? catalogReport;
    },
    [reportingReports, reportsOpen, researchPanelMemory?.reports, selectedReportId, selectedReportWorkspaceId, snapshot?.honeycrispMemory.reports]
  );
  const workspaceDashboardRuns = useMemo(
    () => snapshot?.runs.filter((row) => !isReportResourceRun(row.run)) ?? [],
    [snapshot?.runs]
  );
  useEffect(() => {
    if (!selectedRunbookId || !researchPanelMemory || selectedRunbook) return;
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
  }, [researchPanelMemory, selectedRunbook, selectedRunbookId]);
  useEffect(() => () => {
    runbookExecutionRequestRef.current += 1;
  }, [selectedRunbookId]);
  useEffect(() => {
    if (!selectedRunbookId) {
      setRunbookLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRunbookLoading(selectedRunbookDocument?.runbookId !== selectedRunbookId);
    setRunbookError(null);
    setSelectedRunbookDocument((current) => current?.runbookId === selectedRunbookId ? current : null);
    void window.beale.getHoneycrispRunbook(selectedRunbookId)
      .then((document) => {
        if (cancelled || document.runbookId !== selectedRunbookId) return;
        setSelectedRunbookDocument(document);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setRunbookError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setRunbookLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunbook?.revision, selectedRunbookDocument?.runbookId, selectedRunbookId]);

  const runHoneycrispRunbook = useCallback(async (
    runbookId: string,
    cellId: string | undefined,
    target: RunbookProofTargetSelection
  ): Promise<void> => {
    const runbook = researchPanelMemory?.runbooks.find((candidate) => candidate.id === runbookId);
    if (!runbook?.sessionId) throw new Error('This runbook is not attached to an executable Honeycrisp session.');
    const previousRunId = selectedRunbookDocument?.runbookId === runbookId
      ? selectedRunbookDocument.latestRun?.runId ?? null
      : null;
    const request = runbookExecutionRequestRef.current + 1;
    runbookExecutionRequestRef.current = request;
    setRunbookError(null);
    try {
      const next = await window.beale.steerRun({
        type: 'run_runbook',
        runId: runbook.sessionId,
        runbookId,
        proofTarget: target.proofTarget,
        ...(target.deviceOs ? { deviceOs: target.deviceOs } : {}),
        ...(cellId ? { cellId } : {})
      });
      applySnapshot(next);
      let observedNewRun = false;
      for (let attempt = 0; attempt < 6_000 && runbookExecutionRequestRef.current === request; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        const document = await window.beale.getHoneycrispRunbook(runbookId);
        if (runbookExecutionRequestRef.current !== request) return;
        setSelectedRunbookDocument(document);
        setRunbookLoading(false);
        const latestRun = document.latestRun;
        if (latestRun && latestRun.runId !== previousRunId) observedNewRun = true;
        if (latestRun && latestRun.runId !== previousRunId && latestRun.status !== 'running' && latestRun.status !== 'queued') {
          runbookExecutionRequestRef.current += 1;
          const refreshed = await window.beale.getSnapshot();
          if (refreshed) applySnapshot(refreshed);
          return;
        }
        if (!observedNewRun && attempt >= 99) {
          throw new Error('Honeycrisp acknowledged the request but the runbook did not start. Inspect the session trace for the execution error.');
        }
      }
    } catch (caught: unknown) {
      const message = errorMessage(caught);
      setRunbookError(message);
      throw new Error(message);
    }
  }, [applySnapshot, researchPanelMemory?.runbooks, selectedRunbookDocument]);
  useEffect(() => {
    if (!selectedReportId || selectedReport || (reportsOpen && reportingReportsLoading)) return;
    setSelectedReportId(null);
    setSelectedReportWorkspaceId(null);
    setSelectedReportDocument(null);
    setReportError(null);
  }, [reportingReportsLoading, reportsOpen, selectedReport, selectedReportId]);
  useEffect(() => {
    if (!selectedReportId || !selectedReport) {
      setReportLoading(false);
      return undefined;
    }
    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    setSelectedReportDocument((current) => current?.reportId === selectedReportId ? current : null);
    void window.beale.getHoneycrispReport({ workspaceId: selectedReport.workspaceId, reportId: selectedReportId })
      .then((document) => {
        if (cancelled || document.reportId !== selectedReportId) return;
        setSelectedReportDocument(document);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setReportError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedReport?.revision, selectedReport?.workspaceId, selectedReportId]);

  const needsFullTraceEvents = Boolean(activeRunDetail && (selectedBreakoutRoomId || selectedSubagentPath));
  const activeTraceEvents = useMemo(
    () => (activeRunDetail && needsFullTraceEvents
      ? devInstrumentation.time('trace.buildDisplayEvents.active', () => buildTraceDisplayEvents(activeRunDetail), runDetailMetricDetail(activeRunDetail))
      : []),
    [activeRunDetail, needsFullTraceEvents]
  );
  const mainSessionTraceEvents = useMemo(
    () => {
      if (!activeRunDetail) return [];
      return needsFullTraceEvents
        ? traceEventsForSubagent(activeTraceEvents, null)
        : devInstrumentation.time('trace.buildDisplayEvents.root', () => buildTraceDisplayEventsForAgentPath(activeRunDetail, null), runDetailMetricDetail(activeRunDetail));
    },
    [activeRunDetail, activeTraceEvents, needsFullTraceEvents]
  );
  const needsSubagentSummaries = Boolean(selectedSubagentPath);
  const activeSubagents = useMemo(
    () => needsSubagentSummaries
      ? subagentSummaries(activeTraceEvents, activeRunDetail?.run.status, 'commentary')
      : [],
    [activeRunDetail?.run.status, activeTraceEvents, needsSubagentSummaries]
  );
  useEffect(() => {
    if (!selectedSubagentPath || activeSubagents.some((agent) => agent.path === selectedSubagentPath)) return;
    setSelectedSubagentPath(null);
  }, [activeSubagents, selectedSubagentPath]);
  const [sessionHeatDisplay, setSessionHeatDisplay] = useState(EMPTY_SESSION_HEAT_DISPLAY_STATE);
  useLayoutEffect(() => {
    setSessionHeatDisplay((previous) => sessionHeatDisplayStateForSelection(
      previous,
      selectedRunId,
      activeRunDetail,
      sessionHeatPreferences
    ));
  }, [activeRunDetail, selectedRunId, sessionHeatPreferences]);
  const sessionHeat = sessionHeatDisplay.heat;
  const sessionHeatProfile = sessionHeatDisplay.profile ?? snapshot?.researchProfile.profile ?? null;
  const shellStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    ...sessionHeatPaletteStyle(sessionHeatPaletteForProfile(sessionHeatProfile, sessionHeatPreferences, appearanceTheme))
  } as CSSProperties;
  const windowControlPlatform = windowControlPlatformForState(snapshot, hostEnvironment);
  const headerResearchControlsAvailable = shouldShowHeaderResearchControls({
    researchDetailsAvailable,
    settingsOpen,
    reportsOpen,
    automationsOpen,
    pluginsOpen
  });
  const bottomPanelVisible = bottomPanelOpen && headerResearchControlsAvailable;
  useEffect(() => {
    if (!headerResearchControlsAvailable) setBottomPanelOpen(false);
  }, [headerResearchControlsAvailable]);
  const shellClassName = `${appShellClassName({
    sessionHeat,
    sessionActive: workspaceHasLiveResearchRun(snapshot),
    platform: windowControlPlatform,
    windowChromeState,
    sidebarCollapsed
  })}${settingsOpen ? ' settings-open' : ''}${bottomPanelVisible ? ' bottom-panel-open' : ''}`;
  const currentWorkspaceName = snapshot?.activeScope.workspaceName ?? 'No Workspace Selected';
  const reportingScopeName = reportingScopeWorkspaceId
    ? workspaceRegistry?.workspaces.find((workspace) => workspace.workspaceId === reportingScopeWorkspaceId)?.workspaceName ?? 'Workspace'
    : 'All Reports';
  const automationScopeName = automationScopeWorkspaceId
    ? workspaceRegistry?.workspaces.find((workspace) => workspace.workspaceId === automationScopeWorkspaceId)?.workspaceName ?? 'Workspace'
    : 'All Automations';
  const selectedAutomation = useMemo(
    () => automations.find((automation) => (
      automation.runId === selectedAutomationRunId && automation.workspaceId === selectedAutomationWorkspaceId
    )) ?? null,
    [automations, selectedAutomationRunId, selectedAutomationWorkspaceId]
  );
  const scopedReportingReports = useMemo(
    () => reportsForReportingScope(reportingReports, reportingScopeWorkspaceId),
    [reportingReports, reportingScopeWorkspaceId]
  );
  const activeBreakoutRoomTitle = selectedBreakoutRoomId
    ? activeRunDetail?.breakoutRooms?.find((room) => room.id === selectedBreakoutRoomId)?.title ?? null
    : null;
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openProfiling = useCallback(() => {
    flushProfilingReport();
    setProfilingOpen(true);
  }, [flushProfilingReport]);
  const closeProfiling = useCallback(() => setProfilingOpen(false), []);
  const startNewResearch = useCallback(() => {
    if (reportsOpen) {
      clearRunDetail();
      setSelectedRunId(null);
      setReportSessionRunId(null);
      setSelectedReportId(null);
      setSelectedReportWorkspaceId(null);
      setSelectedReportDocument(null);
    }
    setReportsOpen(false);
    setAutomationsOpen(false);
    setPluginsOpen(false);
    setNewResearchInitialGoal(null);
    setNewResearchOpen(true);
  }, [clearRunDetail, reportsOpen, setSelectedRunId]);
  const startNewResearchForWorkspace = useCallback((workspace: WorkspaceRegistryEntry): void => {
    if (snapshot?.workspace.workspacePath === workspace.workspacePath) {
      startNewResearch();
      return;
    }
    void runWorkspaceAction(async () => {
      clearRunDetail();
      setSelectedRunId(null);
      applySnapshot(await window.beale.openRegisteredWorkspace(workspace.id));
      setSelectedRunId(null);
      startNewResearch();
    }, { reloadRegistry: false });
  }, [applySnapshot, clearRunDetail, runWorkspaceAction, setSelectedRunId, snapshot?.workspace.workspacePath, startNewResearch]);
  const startNewResearchFromSuggestion = useCallback((goal: ResearchGoalSeed) => {
    setNewResearchInitialGoal(goal);
    setNewResearchOpen(true);
  }, []);
  const handleResearchStarted = useCallback(
    (runId: string): void => {
      clearRunDetail();
      setSelectedRunId(runId);
      setNewResearchInitialGoal(null);
      setNewResearchOpen(false);
    },
    [clearRunDetail, setSelectedRunId]
  );
  const openWorkspaceDashboardSession = useCallback(
    (runId: string): void => {
      setReportsOpen(false);
      setAutomationsOpen(false);
      setPluginsOpen(false);
      clearRunDetail();
      setSelectedBreakoutRoomId(null);
      setSelectedRunId(runId);
    },
    [clearRunDetail, setSelectedRunId]
  );
  const openAutomations = useCallback((): void => {
    clearRunDetail();
    setSelectedRunId(null);
    setSelectedBreakoutRoomId(null);
    setSelectedAutomationRunId(null);
    setSelectedAutomationWorkspaceId(null);
    setAutomationScopeWorkspaceId(snapshot?.workspace.workspaceId ?? null);
    setAutomationsError(null);
    setReportsOpen(false);
    setPluginsOpen(false);
    setAutomationsOpen(true);
  }, [clearRunDetail, setSelectedRunId, snapshot?.workspace.workspaceId]);
  const saveAutomation = useCallback(async (input: AutomationUpdateInput): Promise<AutomationSummary> => {
    const updated = await window.beale.updateAutomation(input);
    setAutomations((current) => current.map((automation) => (
      automation.runId === updated.runId && automation.workspaceId === updated.workspaceId ? updated : automation
    )));
    return updated;
  }, []);
  return (
    <div ref={appShellRef} className={shellClassName} data-theme={appearanceTheme} style={shellStyle}>
      <AppBackgroundPulses />
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        rightSidenavAvailable={headerResearchControlsAvailable}
        rightSidenavExpanded={!reportsOpen && !automationsOpen && !pluginsOpen && rightSidenavExpanded && researchDetailsAvailable}
        contextualTitleVisible={!settingsOpen && !reportsOpen && !automationsOpen && !pluginsOpen}
        staticContextTitle={settingsOpen
          ? { primary: 'Agent Settings', secondary: settingsSectionLabel(settingsSection), icon: 'settings' }
          : reportsOpen
            ? { primary: 'Reporting', secondary: selectedReport?.title ?? reportingScopeName, icon: 'reporting' }
            : automationsOpen
              ? { primary: 'Automations', secondary: selectedAutomation?.title ?? automationScopeName, icon: 'automations' }
              : pluginsOpen
                ? { primary: 'Plugins', secondary: 'Installed Plugins', icon: 'plugins' }
              : null}
        platform={windowControlPlatform}
        workspaceName={workspaceDraft ? 'New Workspace' : currentWorkspaceName}
        workspaceViewTitle={workspaceDraft ? workspaceDashboardViewName : (snapshot && !selectedRunId ? workspaceDashboardViewName : null)}
        activeRunDetail={activeRunDetail}
        activeBreakoutRoomTitle={activeBreakoutRoomTitle}
        profilingEnabled={profilingState?.enabled ?? false}
        bottomPanelOpen={bottomPanelVisible}
        workspaceEditors={headerResearchControlsAvailable ? workspaceEditors : null}
        onOpenProfiling={openProfiling}
        onToggleBottomPanel={() => setBottomPanelOpen((current) => !current)}
        onOpenWorkspaceInEditor={openWorkspaceInEditor}
        onAddWorkspace={() => {
          beginWorkspaceCreation();
        }}
        onToggleRightSidenav={() => setRightSidenavExpanded((current) => !current)}
        onToggleSidebar={toggleSidebar}
      />
      {settingsOpen ? (
        <SettingsSidebar
          collapsed={sidebarCollapsed}
          section={settingsSection}
          error={error}
          onBack={() => setSettingsOpen(false)}
          onChangeSection={setSettingsSection}
          onResizePointerDown={beginSidebarResize}
        />
      ) : (
        <WorkspaceSidebar
          busy={busy}
          collapsed={sidebarCollapsed}
          error={error}
          workspaceRegistry={workspaceRegistry}
          workspaceRegistryLoading={startupPhase === 'shell' || startupPhase === 'registry'}
          selectedRunId={reportsOpen || automationsOpen || pluginsOpen ? null : selectedRunId}
          automationsActive={automationsOpen}
          reportsActive={reportsOpen}
          pluginsActive={pluginsOpen}
          snapshot={snapshot}
          onAddWorkspace={() => {
            beginWorkspaceCreation();
          }}
          onOpenWorkspace={(workspace) => {
            setReportsOpen(false);
            setAutomationsOpen(false);
            setPluginsOpen(false);
            openRegisteredWorkspace(workspace);
          }}
          onOpenResearchSession={(workspace, session) => {
            setReportsOpen(false);
            setAutomationsOpen(false);
            setPluginsOpen(false);
            setSelectedBreakoutRoomId(null);
            openResearchSession(workspace, session);
          }}
          onResizePointerDown={beginSidebarResize}
          onOpenAutomations={openAutomations}
          onOpenReports={openReports}
          onOpenPlugins={openPlugins}
          onStartNewResearch={startNewResearch}
          onStartNewResearchForWorkspace={startNewResearchForWorkspace}
        />
      )}

      <main className="workbench" data-session-heat={sessionHeat}>
        {settingsOpen ? (
          <SettingsView
            section={settingsSection}
            appearanceTheme={appearanceTheme}
            researchProfiles={researchProfiles}
            researchProfilesLoading={researchProfilesLoading}
            researchProfile={snapshot?.researchProfile ?? null}
            tracesEnabled={tracesEnabled}
            suggestionPreferences={suggestionPreferences}
            dangerModeEnabled={permissionSettings.dangerModeEnabled}
            defaultShellSafetyMode={permissionSettings.defaultShellSafetyMode}
            openAiOAuthResult={openAiOAuthResult}
            openAiStatus={openAiStatus ?? snapshot?.openAi ?? null}
            researchProviderOAuthResults={researchProviderOAuthResults}
            researchProviderStatuses={researchProviderStatuses}
            researchProviderModelCatalog={researchProviderModelCatalog}
            providerSettings={providerSettings}
            providerStatusesLoaded={researchProviderStatusesLoaded}
            computerUsePlatform={hostEnvironment?.platform ?? null}
            computerUseSettings={computerUseSettings}
            ticketingSettings={ticketingSettings}
            ticketingTargets={ticketingTargets}
            ticketingLoading={ticketingLoading}
            ticketingError={ticketingError}
            agentPluginState={agentPluginState}
            agentPluginsLoading={agentPluginsLoading}
            agentPluginsBusy={agentPluginsBusy}
            agentPluginsError={agentPluginsError}
            sessionHeatPreferences={sessionHeatPreferences}
            busy={busy}
            onChangeAppearanceTheme={setAppearanceTheme}
            onChangeTracesEnabled={changeTracesEnabled}
            onChangeSuggestionPreference={setSuggestionPreference}
            onChangeDangerModeEnabled={setDangerModeEnabled}
            onChangeDefaultShellSafetyMode={setDefaultShellSafetyMode}
            onRefreshOpenAi={refreshOpenAiProvider}
            onStartOpenAiOAuth={startOpenAiOAuth}
            onStartResearchProviderOAuth={startResearchProviderOAuth}
            onForgetProviderSubscription={forgetProviderSubscription}
            onRemoveProvider={removeProvider}
            onConfigureProviderApiKey={configureProviderApiKey}
            onRemoveProviderApiKey={removeProviderApiKey}
            onSetDefaultProviderId={setDefaultProviderId}
            onSetProviderModelDefaults={setProviderModelDefaults}
            onSetProviderOptionalModelEnabled={setProviderOptionalModelEnabled}
            onSetProviderCyberPolicyRiskAcknowledged={setProviderCyberPolicyRiskAcknowledged}
            onSetProviderPreferredAuthenticationMethod={setProviderPreferredAuthenticationMethod}
            onSetAgentPluginEnabled={setAgentPluginEnabled}
            onChangeComputerUsePermissionMode={changeComputerUsePermissionMode}
            onSetTicketingProvider={changeTicketingProvider}
            onSetTicketingHumanInTheLoop={changeTicketingHumanInTheLoop}
            onConfigureTicketingCredential={configureTicketingCredential}
            onRemoveTicketingCredential={removeTicketingCredential}
            onRefreshTicketingTargets={loadTicketingTargets}
            onSetTicketingTarget={changeTicketingTarget}
            onSetSessionHeatPreference={setSessionHeatPreference}
            onSetSessionHeatPalettePreference={setSessionHeatPalettePreference}
          />
        ) : (
          <div className="workspace-page">
            {workspaceDraft ? (
              <WorkspaceCreationView
                busy={busy}
                form={workspaceDraft}
                progress={workspaceOnboardingProgress}
                submissionError={error}
                onCancel={closeWorkspaceOnboarding}
                onChange={setWorkspaceDraft}
                onLookupHackerOne={lookupHackerOneScope}
                onResearchKit={applyOnboardingResearchKit}
                onSubmit={submitWorkspaceOnboarding}
                onViewChange={setWorkspaceDashboardViewName}
              />
            ) : pluginsOpen ? (
              <PluginManagerWorkspace
                state={agentPluginState}
                loading={agentPluginsLoading}
                busy={agentPluginsBusy}
                error={agentPluginsError}
                repositoryUrl={pluginRepositoryUrl}
                onRepositoryUrlChange={setPluginRepositoryUrl}
                onAddFilesystem={addAgentPluginFromFilesystem}
                onAddRepository={addAgentPluginFromRepository}
                onSetEnabled={setAgentPluginEnabled}
                onRemove={removeAgentPlugin}
              />
            ) : automationsOpen ? (
              <AutomationsWorkspace
                automations={automations}
                workspaces={workspaceRegistry?.workspaces ?? []}
                selectedWorkspaceId={automationScopeWorkspaceId}
                selectedAutomation={selectedAutomation}
                openAiStatus={snapshot?.openAi ?? openAiStatus}
                defaultProviderId={providerSettings?.defaultProviderId}
                providerModelDefaults={providerSettings?.modelDefaults}
                providerPolicyRiskAcknowledgements={providerSettings?.cyberPolicyRiskAcknowledgements}
                researchProviderStatuses={researchProviderStatuses}
                providerModelCatalog={enabledResearchProviderModelCatalog}
                loading={automationsLoading}
                error={automationsError}
                onScopeChange={(workspaceId) => {
                  setAutomationScopeWorkspaceId(workspaceId);
                  setSelectedAutomationRunId(null);
                  setSelectedAutomationWorkspaceId(null);
                }}
                onSelectAutomation={(automation) => {
                  setSelectedAutomationRunId(automation?.runId ?? null);
                  setSelectedAutomationWorkspaceId(automation?.workspaceId ?? null);
                }}
                onSaveAutomation={saveAutomation}
              />
            ) : reportsOpen ? (
              selectedReport ? (
                <ReportSessionWorkspace
                  report={selectedReport}
                  document={selectedReportDocument}
                  loading={reportLoading}
                  error={reportError}
                  detail={activeRunDetail}
                  events={mainSessionTraceEvents}
                  providerModelCatalog={enabledResearchProviderModelCatalog}
                  initialModelSelection={reportSessionInitialModelSelection}
                  responseSuggestionsEnabled={suggestionPreferences.responseSuggestionsEnabled}
                  selectedRunId={reportSessionRunId}
                  shellApproval={inlineApproval}
                  shellApprovalBusy={Boolean(inlineApproval && (busy || shellApprovalDecisionInFlight === inlineApproval.id))}
                  busy={busy}
                  ticketingSettings={ticketingSettings}
                  onInitialInstruction={(instruction, modelSelection, shellSafetyMode) => {
                    void startReportTurn(instruction, modelSelection, shellSafetyMode).catch(() => undefined);
                  }}
                  onShellApprovalDecision={(decision) => {
                    if (inlineApproval) handleShellApprovalDecision(inlineApproval, decision);
                  }}
                  onSessionAction={handleSessionAction}
                  onReportChange={submitReportChange}
                  onOpenSubmissionPacket={async () => {
                    try {
                      await window.beale.openReportSubmissionPacket({
                        workspaceId: selectedReport.workspaceId,
                        reportId: selectedReport.id
                      });
                    } catch (caught: unknown) {
                      const message = errorMessage(caught);
                      setReportError(message);
                      throw new Error(message);
                    }
                  }}
                  onSubmitTicket={async (): Promise<TicketSubmissionResult> => window.beale.submitReportTicket({
                    workspaceId: selectedReport.workspaceId,
                    reportId: selectedReport.id
                  })}
                  onOpenTicket={(url) => window.beale.openExternalUrl(url)}
                  onSteerInstruction={handleSteerInstruction}
                />
              ) : (
                <ReportsIndex
                  reports={scopedReportingReports}
                  workspaces={workspaceRegistry?.workspaces ?? []}
                  selectedWorkspaceId={reportingScopeWorkspaceId}
                  loading={reportingReportsLoading}
                  error={reportingReportsError}
                  onScopeChange={(workspaceId) => {
                    setReportingScopeWorkspaceId(workspaceId);
                    setSelectedReportId(null);
                    setSelectedReportWorkspaceId(null);
                    setSelectedReportDocument(null);
                    setReportError(null);
                  }}
                  onOpenReport={openReportSession}
                />
              )
            ) : snapshot ? <MainSessionWorkspace
              detail={activeRunDetail}
              events={mainSessionTraceEvents}
              allEvents={activeTraceEvents}
              providerModelCatalog={enabledResearchProviderModelCatalog}
              honeycrispMemory={selectedRunId ? null : snapshot?.honeycrispMemory ?? null}
              activeScope={snapshot?.activeScope ?? null}
              workspaceRules={selectedRunId ? [] : snapshot?.workspaceRules ?? []}
              researchProfile={selectedRunId ? activeRunDetail?.researchProfile?.profile ?? null : snapshot?.researchProfile.profile ?? null}
              researchKitId={snapshot.workspace.researchKitId}
              researchSubjectName={selectedRunId ? '' : snapshot?.researchSubject.name ?? ''}
              sessionHeatPreferences={sessionHeatPreferences}
              sessionEndingSuggestionsEnabled={suggestionPreferences.sessionEndingSuggestionsEnabled}
              responseSuggestionsEnabled={suggestionPreferences.responseSuggestionsEnabled}
              workspacePath={selectedRunId ? '' : snapshot?.workspace.workspacePath ?? ''}
              workspaceDirectories={selectedRunId ? [] : snapshot?.workspace.workspaceDirectories}
              workspaceName={snapshot?.activeScope.workspaceName ?? 'Workspace'}
              runs={selectedRunId ? [] : workspaceDashboardRuns}
              selectedRunId={selectedRunId}
              selectedBreakoutRoomId={selectedBreakoutRoomId}
              researchDetailsOpen={rightSidenavExpanded && researchDetailsAvailable}
              selectedRunbookId={selectedRunbookId}
              selectedRunbook={selectedRunbook}
              selectedRunbookDocument={selectedRunbookDocument}
              runbookLoading={runbookLoading}
              runbookError={runbookError}
              selectedReportId={selectedReportId}
              selectedReport={selectedReport}
              selectedReportDocument={selectedReportDocument}
              reportLoading={reportLoading}
              reportError={reportError}
              selectedSubagentPath={selectedSubagentPath}
              searchHighlightQuery=""
              shellApproval={inlineApproval}
              shellApprovalBusy={Boolean(inlineApproval && (busy || shellApprovalDecisionInFlight === inlineApproval.id))}
              busy={busy}
              connectedDeviceCaptureEnabled={windowControlPlatform === 'darwin'}
              workspaceDejunk={selectedRunId ? null : snapshot?.workspace.dejunk ?? null}
              workspaceDejunkInProgress={workspaceDejunkInProgress}
              memoryDreamingInProgress={memoryDreamingInProgress}
              memoryDreamingProgress={memoryDreamingProgress}
              onRunWorkspaceDejunk={runWorkspaceDejunk}
              onRunMemoryDreaming={runMemoryDreaming}
              onAddWorkspaceResource={addWorkspaceResource}
              onChangeWorkspaceResource={changeWorkspaceResource}
              onCloneWorkspaceRepository={cloneWorkspaceRepository}
              onRefreshWorkspaceResearchKit={refreshWorkspaceResearchKit}
              onAddWorkspaceRule={addWorkspaceRule}
              onSaveWorkspaceConfiguration={saveWorkspaceConfiguration}
              onChangeWorkspaceDirectories={changeWorkspaceDirectories}
              onRemoveWorkspace={removeActiveWorkspace}
              onOpenSession={openWorkspaceDashboardSession}
              onWorkspaceViewChange={setWorkspaceDashboardViewName}
              onResearchDetailsOpenChange={(expanded) => setRightSidenavExpanded(researchDetailsAvailable && expanded)}
              onOpenHoneycrispRunbook={openHoneycrispRunbook}
              onRunHoneycrispRunbook={runHoneycrispRunbook}
              onBackToRunbooks={backToRunbooks}
              onOpenHoneycrispReport={openHoneycrispReport}
              onBackToReports={backToReports}
              onOpenBreakoutRoom={openBreakoutRoom}
              onBackToRooms={backToRooms}
              onBackToSubagents={backToSubagents}
              onSelectSubagent={selectSubagent}
              onSelectNextStep={startNewResearchFromSuggestion}
              onShellApprovalDecision={(decision) => {
                if (inlineApproval) handleShellApprovalDecision(inlineApproval, decision);
              }}
              onSessionAction={handleSessionAction}
              onSteerInstruction={handleSteerInstruction}
            /> : <WorkspaceStartupView onAddWorkspace={beginWorkspaceCreation} />}
          </div>
        )}
      </main>
      <BottomPanel
        open={bottomPanelVisible}
        workspacePath={snapshot?.workspace.workspacePath ?? null}
        onClose={() => setBottomPanelOpen(false)}
      />
      {!settingsOpen ? <StatusBar onOpenSettings={openSettings} /> : null}
      <NotificationStack
        notifications={snapshot?.notifications ?? []}
        alerts={workspaceAlerts}
        onOpen={openNotification}
        onDismiss={dismissNotification}
        onOpenAlert={openWorkspaceAlert}
        onDismissAlert={dismissWorkspaceAlert}
      />
      <AppModals
        activeNotification={activeNotification}
        busy={busy}
        newResearchOpen={newResearchOpen}
        newResearchInitialGoal={newResearchInitialGoal}
        openAiStatus={snapshot?.openAi ?? openAiStatus}
        defaultProviderId={providerSettings?.defaultProviderId}
        dangerModeEnabled={permissionSettings.dangerModeEnabled}
        defaultShellSafetyMode={permissionSettings.defaultShellSafetyMode}
        providerModelDefaults={providerSettings?.modelDefaults}
        providerPolicyRiskAcknowledgements={providerSettings?.cyberPolicyRiskAcknowledgements}
        researchProviderModelCatalog={enabledResearchProviderModelCatalog}
        researchProviderStatuses={researchProviderStatuses}
        researchGoalSuggestions={researchGoalSuggestionState.suggestions}
        researchGoalSuggestionsLoading={researchGoalSuggestionState.loading}
        researchGoalSuggestionErrors={researchGoalSuggestionState.errors}
        newResearchPromptSuggestionsEnabled={suggestionPreferences.newResearchPromptSuggestionsEnabled}
        profilingOpen={profilingOpen}
        profilingState={profilingState}
        lastProfilingReport={lastProfilingReport}
        snapshot={snapshot}
        onCancelNewResearch={() => {
          setNewResearchInitialGoal(null);
          setNewResearchOpen(false);
        }}
        onCloseNotification={() => setActiveNotification(null)}
        onCloseProfiling={closeProfiling}
        onFlushProfilingReport={flushProfilingReport}
        onLoadResearchGoalSuggestions={researchGoalSuggestionState.load}
        onSelectResearchGoalSuggestion={researchGoalSuggestionState.consume}
        onRetryResearchGoalSuggestions={researchGoalSuggestionState.retry}
        onStartedNewResearch={handleResearchStarted}
        onSteerNotification={(notification, instruction) => {
          void runAction(() => window.beale.steerRun({ type: 'steer', runId: notification.runId, instruction }));
          setActiveNotification(null);
        }}
        runAction={runAction}
      />
      {activeManualShellApproval ? (
        <ShellApprovalModal
          approval={activeManualShellApproval}
          busy={busy || shellApprovalDecisionInFlight === activeManualShellApproval.id}
          onDecision={(decision) => handleShellApprovalDecision(activeManualShellApproval, decision)}
        />
      ) : null}
    </div>
  );
}

function isEndedResearchRunStatus(status: RunStatus): boolean {
  return status === 'blocked' || status === 'completed' || status === 'failed' || status === 'stopped';
}

function shellApprovalWorkspacePath(approval: ApprovalRecord): string {
  const workspacePath = approval.requestedAction.workspacePath;
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
    throw new Error('Shell approval is missing its originating workspace.');
  }
  return workspacePath;
}
