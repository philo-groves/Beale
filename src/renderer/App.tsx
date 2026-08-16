import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties } from 'react';
import { devInstrumentation, useDevInputLatencyProbe, useDevRenderProbe } from './devInstrumentation';
import type {
  ApprovalRecord,
  AgentPluginRegistryState,
  ProviderSettings,
  ProviderAuthenticationMethod,
  ProviderModelDefaults,
  HoneycrispRunbookDocument,
  HoneycrispReportDocument,
  MemoryDreamingProgressUpdate,
  NotificationRecord,
  OpenAiOAuthStartResult,
  PolicyReviewDecision,
  ResearchModelSelection,
  ResearchModelProviderId,
  ResearchProviderId,
  ResearchProviderOAuthStartResult,
  ResearchProviderModelCatalog,
  ResolvedResearchProfile,
  ResearchProviderStatus,
  ScopeAssetInput,
  WorkspaceOnboardingProgressUpdate,
  RunDetail,
  SessionTranscriptSearchResult,
  SteeringAction,
  WorkspaceSnapshot
} from '@shared/types';
import { AppModals } from './app/AppModals';
import { AppBackgroundPulses } from './app/AppBackgroundPulses';
import { StatusBar } from './app/StatusBar';
import { TopBar } from './app/TopBar';
import { NotificationStack, type WorkspaceAlert } from './features/notifications/Notifications';
import { WorkspaceSidebar } from './features/workspaces/WorkspaceSidebar';
import { MainSessionWorkspace } from './features/sessions/MainSessionWorkspace';
import type { ResearchGoalSeed } from './features/sessions/SessionNextSteps';
import { isAutoReviewOverrideApproval, pendingShellApproval, ShellApprovalModal } from './features/sessions/ShellApprovalModal';
import { subagentSummaries, traceEventsForSubagent } from './view-models/subagents';
import { SettingsSidebar, SettingsView, settingsSectionLabel, type SettingsSection } from './features/settings/SettingsModal';
import { ALL_TRACE_CATEGORY_IDS, DEFAULT_TRACE_CATEGORY_IDS } from './features/traces/traceVisuals';
import { useInsetScrollbarActivation } from './hooks/useInsetScrollbarActivation';
import { useWorkspaceActions, type WorkspaceActionOptions } from './hooks/useWorkspaceActions';
import { useWorkspaceOverlayState } from './hooks/useWorkspaceOverlayState';
import { useProfilingRuntime } from './hooks/useProfilingRuntime';
import { useResizableSidebar } from './hooks/useResizableSidebar';
import { useRunDetailPolling } from './hooks/useRunDetailPolling';
import { useResearchGoalSuggestions } from './hooks/useResearchGoalSuggestions';
import { useSidebarPerformanceProbe } from './hooks/useSidebarPerformanceProbe';
import { useTraceSelection } from './hooks/useTraceSelection';
import { useChatViewPreference } from './hooks/useChatViewPreference';
import { useSessionHeatPreferences } from './hooks/useSessionHeatPreferences';
import { filterEnabledProviderModelCatalogs } from '../shared/optionalProviderModels';
import { useWorkspaceRuntime } from './hooks/useWorkspaceRuntime';
import type { TraceCategoryId } from './traceClassification';
import { errorMessage } from './lib/errors';
import {
  activeRunDetailForSelection,
  appShellClassName,
  selectedRunStatus,
  workspaceHasLiveResearchRun,
  windowControlPlatformForState
} from './view-models/appShell';
import type { WorkspaceOnboardingFormState } from './view-models/workspaceOnboarding';
import { sessionHeatForDetail, sessionHeatPaletteForProfile, sessionHeatPaletteStyle } from './view-models/sessionHeat';
import { buildTraceDisplayEvents, buildTraceDisplayEventsForAgentPath, type TraceDisplayEvent } from './view-models/traceDisplay';
import { runDetailMetricDetail, shortMetricId } from './view-models/runDetailUpdates';
import { hasResearchProfileDetailFeatures, researchProfileFeatureAvailability } from './view-models/researchProfileFeatures';
import {
  clearConfirmedProviderOAuthResults,
  isSubscriptionAuthenticationConfirmed
} from './view-models/providerAuthentication';

export function App(): JSX.Element {
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleError = useCallback((message: string) => setError(message), []);
  const {
    snapshot,
    workspaceRegistry,
    hostEnvironment,
    windowChromeState,
    openAiStatus,
    selectedRunId,
    setWorkspaceRegistry,
    setOpenAiStatus,
    setSelectedRunId,
    applySnapshot,
    loadSnapshot,
    loadWorkspaceRegistry
  } = useWorkspaceRuntime(handleError);
  const researchGoalSuggestionState = useResearchGoalSuggestions(
    snapshot,
    openAiStatus?.configured ?? snapshot?.openAi.configured ?? false
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
  const [chatView, setChatView] = useChatViewPreference();
  const [sessionHeatPreferences, setSessionHeatPreference, setSessionHeatPalettePreference] = useSessionHeatPreferences();
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceOnboardingFormState | null>(null);
  const [workspaceOnboardingProgress, setWorkspaceOnboardingProgress] = useState<WorkspaceOnboardingProgressUpdate | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [newResearchInitialGoal, setNewResearchInitialGoal] = useState<ResearchGoalSeed | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [agentPluginState, setAgentPluginState] = useState<AgentPluginRegistryState | null>(null);
  const [agentPluginsLoading, setAgentPluginsLoading] = useState(false);
  const [agentPluginsBusy, setAgentPluginsBusy] = useState(false);
  const [agentPluginsError, setAgentPluginsError] = useState<string | null>(null);
  const [pluginRepositoryUrl, setPluginRepositoryUrl] = useState('');
  const [pendingSearchTarget, setPendingSearchTarget] = useState<SessionTranscriptSearchResult | null>(null);
  const [traceSearchHighlightQuery, setTraceSearchHighlightQuery] = useState('');
  const [profilingOpen, setProfilingOpen] = useState(false);
  const [traceFilterOpen, setTraceFilterOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationRecord | null>(null);
  const [workspaceAlerts, setWorkspaceAlerts] = useState<WorkspaceAlert[]>([]);
  const [sessionSummaryDetail, setSessionSummaryDetail] = useState<RunDetail | null>(null);
  const [visibleTraceCategories, setVisibleTraceCategories] = useState<TraceCategoryId[]>(DEFAULT_TRACE_CATEGORY_IDS);
  const [selectedSubagentPath, setSelectedSubagentPath] = useState<string | null>(null);
  const [selectedBreakoutRoomId, setSelectedBreakoutRoomId] = useState<string | null>(null);
  const [selectedRunbookId, setSelectedRunbookId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [rightSidenavExpanded, setRightSidenavExpanded] = useState(false);
  const [selectedRunbookDocument, setSelectedRunbookDocument] = useState<HoneycrispRunbookDocument | null>(null);
  const [runbookLoading, setRunbookLoading] = useState(false);
  const [runbookError, setRunbookError] = useState<string | null>(null);
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
    openRegisteredWorkspaceMenuId,
    setOpenWorkspaceMenuId,
    workspaceInfo,
    setWorkspaceInfo
  } = useWorkspaceOverlayState(workspaceRegistry);
  const {
    profilingState,
    lastProfilingReport,
    flushProfilingReport
  } = useProfilingRuntime(handleError, { observeReports: profilingOpen || settingsOpen });
  const selectedRunState = selectedRunStatus(snapshot, selectedRunId);
  const selectedRunRefreshKey = useMemo(() => {
    const selected = snapshot?.runs.find((row) => row.run.id === selectedRunId)?.run;
    if (!selected) return null;
    const pendingApprovalIds = snapshot?.pendingShellApprovals
      .filter((approval) => approval.runId === selected.id)
      .map((approval) => approval.id)
      .join(',') ?? '';
    return `${selected.status}:${selected.shellSafetyMode}:${pendingApprovalIds}`;
  }, [selectedRunId, snapshot?.pendingShellApprovals, snapshot?.runs]);
  const handleRunDetailError = useCallback((message: string) => setError(message), []);
  const { runDetail, clearRunDetail } = useRunDetailPolling({
    selectedRunId,
    selectedRunState,
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
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookLoading(false);
    setRunbookError(null);
  }, [researchViewContextKey]);

  useEffect(() => {
    window.beale
      .getProviderSettings()
      .then(setProviderSettings)
      .catch((caught: unknown) => handleError(errorMessage(caught)));
  }, [handleError]);

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
        rulesMarkdown: activeScope.rulesMarkdown,
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

  const openPlugins = useCallback((): void => {
    setPluginsOpen(true);
    void loadAgentPlugins();
  }, [loadAgentPlugins]);

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
    setSelectedSubagentPath(null);
    setSelectedReportId(null);
    setSelectedReportDocument(null);
    setReportError(null);
    setSelectedRunbookId(runbookId);
  }, []);

  const openHoneycrispReport = useCallback((reportId: string): void => {
    setRightSidenavExpanded(true);
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
    setSelectedReportId(reportId);
  }, []);

  const selectSubagent = useCallback((path: string): void => {
    setRightSidenavExpanded(true);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
    setSelectedReportId(null);
    setSelectedReportDocument(null);
    setReportError(null);
    setSelectedSubagentPath(path);
  }, []);

  const backToRunbooks = useCallback((): void => {
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
  }, []);

  const backToReports = useCallback((): void => {
    setSelectedReportId(null);
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
    if (!newResearchOpen && !(settingsOpen && settingsSection === 'providers')) return;
    void loadResearchProviderStatuses();
  }, [loadResearchProviderStatuses, newResearchOpen, settingsOpen, settingsSection]);

  useEffect(() => {
    if (!newResearchOpen && !selectedRunId && !(settingsOpen && settingsSection === 'providers')) return;
    void loadResearchProviderModelCatalog();
  }, [loadResearchProviderModelCatalog, newResearchOpen, selectedRunId, settingsOpen, settingsSection]);

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
    applyOnboardingTemplate,
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
    setWorkspaceOnboardingProgress,
    setWorkspaceInfo,
    setOpenWorkspaceMenuId
  });

  useEffect(() => window.beale.onNativeMenuAction(() => addWorkspace()), [addWorkspace]);

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
  }, [activeRunDetail?.policyEvents, selectedRunId, snapshot?.pendingShellApprovals]);
  const autoReviewOverrideApproval = isAutoReviewOverrideApproval(selectedShellApproval)
    ? selectedShellApproval
    : null;
  const activeManualShellApproval = useMemo(() => {
    if (selectedShellApproval && !isAutoReviewOverrideApproval(selectedShellApproval)) return selectedShellApproval;
    return snapshot?.pendingShellApprovals.find((approval) => !isAutoReviewOverrideApproval(approval)) ?? null;
  }, [selectedShellApproval, snapshot?.pendingShellApprovals]);
  const activeShellApproval = autoReviewOverrideApproval ?? activeManualShellApproval;
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
  const activeWorkspaceEntry = useMemo(() => {
    if (!snapshot || !workspaceRegistry) return null;
    return (
      workspaceRegistry.workspaces.find(
        (workspace) =>
          (snapshot.workspace.workspaceId.length > 0 && workspace.workspaceId === snapshot.workspace.workspaceId) ||
          workspace.workspacePath === snapshot.workspace.workspacePath
      ) ?? null
    );
  }, [workspaceRegistry, snapshot?.workspace.workspaceId, snapshot?.workspace.workspacePath]);
  const researchPanelMemory = selectedRunId
    ? activeRunDetail?.honeycrispMemory ?? null
    : snapshot?.honeycrispMemory ?? null;
  const selectedRunbook = useMemo(
    () => researchPanelMemory?.runbooks.find((runbook) => runbook.id === selectedRunbookId) ?? null,
    [researchPanelMemory?.runbooks, selectedRunbookId]
  );
  const selectedReport = useMemo(
    () => researchPanelMemory?.reports.find((report) => report.id === selectedReportId) ?? null,
    [researchPanelMemory?.reports, selectedReportId]
  );
  useEffect(() => {
    if (!selectedRunbookId || !researchPanelMemory || selectedRunbook) return;
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
  }, [researchPanelMemory, selectedRunbook, selectedRunbookId]);
  useEffect(() => {
    if (!selectedRunbookId) {
      setRunbookLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRunbookLoading(true);
    setRunbookError(null);
    setSelectedRunbookDocument(null);
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
  }, [selectedRunbook?.revision, selectedRunbookId]);
  useEffect(() => {
    if (!selectedReportId || !researchPanelMemory || selectedReport) return;
    setSelectedReportId(null);
    setSelectedReportDocument(null);
    setReportError(null);
  }, [researchPanelMemory, selectedReport, selectedReportId]);
  useEffect(() => {
    if (!selectedReportId) {
      setReportLoading(false);
      return undefined;
    }
    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    setSelectedReportDocument(null);
    void window.beale.getHoneycrispReport(selectedReportId)
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
  }, [selectedReport?.revision, selectedReportId]);

  const needsFullTraceEvents = Boolean(activeRunDetail && (selectedBreakoutRoomId || selectedSubagentPath || pendingSearchTarget));
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
      ? subagentSummaries(activeTraceEvents, activeRunDetail?.run.status, chatView)
      : [],
    [activeRunDetail?.run.status, activeTraceEvents, chatView, needsSubagentSummaries]
  );
  useEffect(() => {
    if (!selectedSubagentPath || activeSubagents.some((agent) => agent.path === selectedSubagentPath)) return;
    setSelectedSubagentPath(null);
  }, [activeSubagents, selectedSubagentPath]);
  const {
    selectedTraceEventId,
    traceDetailOpen,
    selectedTraceEvent,
    selectTraceEvent,
    focusTraceEvent,
    closeTraceDetail
  } = useTraceSelection({
    events: needsFullTraceEvents ? activeTraceEvents : mainSessionTraceEvents,
    selectedRunId
  });
  const sessionHeat = useMemo(
    () => sessionHeatForDetail(activeRunDetail, sessionHeatPreferences),
    [activeRunDetail, sessionHeatPreferences]
  );
  const sessionHeatProfile = activeRunDetail?.researchProfile?.profile ?? snapshot?.researchProfile.profile ?? null;
  const shellStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    ...sessionHeatPaletteStyle(sessionHeatPaletteForProfile(sessionHeatProfile, sessionHeatPreferences, 'dark'))
  } as CSSProperties;
  const windowControlPlatform = windowControlPlatformForState(snapshot, hostEnvironment);
  const shellClassName = `${appShellClassName({
    sessionHeat,
    sessionActive: workspaceHasLiveResearchRun(snapshot),
    platform: windowControlPlatform,
    windowChromeState,
    sidebarCollapsed
  })}${settingsOpen ? ' settings-open' : ''}`;
  const currentWorkspaceName = snapshot?.activeScope.workspaceName ?? 'No Workspace Selected';
  const activeBreakoutRoomTitle = selectedBreakoutRoomId
    ? activeRunDetail?.breakoutRooms?.find((room) => room.id === selectedBreakoutRoomId)?.title ?? null
    : null;
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openProfiling = useCallback(() => {
    flushProfilingReport();
    setProfilingOpen(true);
  }, [flushProfilingReport]);
  const closeProfiling = useCallback(() => setProfilingOpen(false), []);
  const openTraceFilters = useCallback(() => setTraceFilterOpen(true), []);
  const startNewResearch = useCallback(() => {
    setNewResearchInitialGoal(null);
    setNewResearchOpen(true);
  }, []);
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
      clearRunDetail();
      setSelectedBreakoutRoomId(null);
      setSelectedRunId(runId);
    },
    [clearRunDetail, setSelectedRunId]
  );
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const openAutomations = useCallback(() => setAutomationsOpen(true), []);
  const cancelRepeatAutomation = useCallback((runId: string): void => {
    void runAction(() => window.beale.steerRun({
      type: 'update_run_budget',
      runId,
      budgetPatch: { repeatSchedule: { type: 'none' } },
      note: 'Repeat automation canceled by user.'
    }));
  }, [runAction]);
  const openSearchResult = useCallback(
    (result: SessionTranscriptSearchResult, query: string): void => {
      setPendingSearchTarget(result);
      setTraceSearchHighlightQuery(query);
      const targetWorkspace = workspaceRegistry?.workspaces.find((workspace) => workspace.id === result.registryWorkspaceId) ?? null;
      const activeWorkspace = snapshot?.workspace.workspacePath === result.workspacePath;
      if (targetWorkspace && !activeWorkspace) {
        void runWorkspaceAction(async () => {
          clearRunDetail();
          applySnapshot(await window.beale.openRegisteredWorkspace(targetWorkspace.id));
          setSelectedRunId(result.runId);
        }, { markBusy: false, reloadRegistry: false });
        setSearchOpen(false);
        return;
      }
      if (selectedRunId !== result.runId) {
        clearRunDetail();
      }
      setSelectedRunId(result.runId);
      setSearchOpen(false);
    },
    [applySnapshot, clearRunDetail, workspaceRegistry, runWorkspaceAction, selectedRunId, setSelectedRunId, snapshot]
  );
  useEffect(() => {
    if (!pendingSearchTarget || activeRunDetail?.run.id !== pendingSearchTarget.runId) return;
    const targetEvent = traceEventForSearchResult(activeTraceEvents, pendingSearchTarget);
    if (!targetEvent) return;
    setSelectedSubagentPath(null);
    setSelectedRunbookId(null);
    setSelectedRunbookDocument(null);
    setRunbookError(null);
    focusTraceEvent(targetEvent);
    setPendingSearchTarget(null);
  }, [activeRunDetail?.run.id, activeTraceEvents, focusTraceEvent, pendingSearchTarget]);

  return (
    <div ref={appShellRef} className={shellClassName} style={shellStyle}>
      <AppBackgroundPulses />
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        rightSidenavAvailable={!settingsOpen && researchDetailsAvailable}
        rightSidenavExpanded={rightSidenavExpanded && researchDetailsAvailable}
        contextualTitleVisible={!settingsOpen}
        staticContextTitle={settingsOpen ? { primary: 'Agent Settings', secondary: settingsSectionLabel(settingsSection) } : null}
        platform={windowControlPlatform}
        workspaceName={currentWorkspaceName}
        activeWorkspace={activeWorkspaceEntry}
        activeRunDetail={activeRunDetail}
        activeBreakoutRoomTitle={activeBreakoutRoomTitle}
        profilingEnabled={profilingState?.enabled ?? false}
        onOpenSessionSummary={setSessionSummaryDetail}
        onOpenWorkspaceInfo={setWorkspaceInfo}
        onOpenProfiling={openProfiling}
        onAddWorkspace={() => {
          addWorkspace();
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
          openRegisteredWorkspaceMenuId={openRegisteredWorkspaceMenuId}
          workspaceRegistry={workspaceRegistry}
          selectedRunId={selectedRunId}
          selectedBreakoutRoomId={selectedBreakoutRoomId}
          selectedRunBreakoutRooms={activeRunDetail?.breakoutRooms}
          selectedRunBreakoutRoomsLoading={selectedRunId !== null && activeRunDetail === null}
          snapshot={snapshot}
          onAddWorkspace={() => {
            addWorkspace();
          }}
          onOpenWorkspace={(workspace) => {
            openRegisteredWorkspace(workspace);
          }}
          onOpenWorkspaceInfo={setWorkspaceInfo}
          onOpenResearchSession={(workspace, session) => {
            setSelectedBreakoutRoomId(null);
            openResearchSession(workspace, session);
          }}
          onOpenBreakoutRoom={(workspace, session, roomId) => {
            openResearchSession(workspace, session);
            setSelectedBreakoutRoomId(roomId);
          }}
          onRemoveWorkspace={removeRegisteredWorkspace}
          onResizePointerDown={beginSidebarResize}
          onSetOpenWorkspaceMenuId={setOpenWorkspaceMenuId}
          onOpenAutomations={openAutomations}
          onOpenPlugins={openPlugins}
          onSearch={openSearch}
          onStartNewResearch={startNewResearch}
        />
      )}

      <main className="workbench" data-session-heat={sessionHeat}>
        {settingsOpen ? (
          <SettingsView
            section={settingsSection}
            researchProfiles={researchProfiles}
            researchProfilesLoading={researchProfilesLoading}
            researchProfile={snapshot?.researchProfile ?? null}
            chatView={chatView}
            openAiOAuthResult={openAiOAuthResult}
            openAiStatus={openAiStatus ?? snapshot?.openAi ?? null}
            researchProviderOAuthResults={researchProviderOAuthResults}
            researchProviderStatuses={researchProviderStatuses}
            researchProviderModelCatalog={researchProviderModelCatalog}
            providerSettings={providerSettings}
            providerStatusesLoaded={researchProviderStatusesLoaded}
            sessionHeatPreferences={sessionHeatPreferences}
            busy={busy}
            onChangeChatView={setChatView}
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
            onSetSessionHeatPreference={setSessionHeatPreference}
            onSetSessionHeatPalettePreference={setSessionHeatPalettePreference}
          />
        ) : (
          <div className="workspace-page">
            <MainSessionWorkspace
              chatView={chatView}
              detail={activeRunDetail}
              events={mainSessionTraceEvents}
              allEvents={activeTraceEvents}
              providerModelCatalog={enabledResearchProviderModelCatalog}
              honeycrispMemory={selectedRunId ? null : snapshot?.honeycrispMemory ?? null}
              activeScope={selectedRunId ? null : snapshot?.activeScope ?? null}
              researchProfile={selectedRunId ? activeRunDetail?.researchProfile?.profile ?? null : snapshot?.researchProfile.profile ?? null}
              sessionHeatPreferences={sessionHeatPreferences}
              workspaceName={snapshot?.activeScope.workspaceName ?? 'Workspace'}
              runs={selectedRunId ? [] : snapshot?.runs ?? []}
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
              selectedTraceEventId={selectedTraceEventId}
              searchHighlightQuery={traceSearchHighlightQuery}
              shellApproval={autoReviewOverrideApproval}
              shellApprovalBusy={Boolean(autoReviewOverrideApproval && (busy || shellApprovalDecisionInFlight === autoReviewOverrideApproval.id))}
              visibleTraceCategories={visibleTraceCategories}
              busy={busy}
              workspaceDejunk={selectedRunId ? null : snapshot?.workspace.dejunk ?? null}
              workspaceDejunkInProgress={workspaceDejunkInProgress}
              memoryDreamingInProgress={memoryDreamingInProgress}
              memoryDreamingProgress={memoryDreamingProgress}
              traceFilterCount={visibleTraceCategories.length}
              totalTraceFilterCount={ALL_TRACE_CATEGORY_IDS.length}
              onOpenTraceFilters={openTraceFilters}
              onRunWorkspaceDejunk={runWorkspaceDejunk}
              onRunMemoryDreaming={runMemoryDreaming}
              onAddWorkspaceResource={addWorkspaceResource}
              onChangeWorkspaceResource={changeWorkspaceResource}
              onOpenSession={openWorkspaceDashboardSession}
              onResearchDetailsOpenChange={(expanded) => setRightSidenavExpanded(researchDetailsAvailable && expanded)}
              onOpenHoneycrispRunbook={openHoneycrispRunbook}
              onBackToRunbooks={backToRunbooks}
              onOpenHoneycrispReport={openHoneycrispReport}
              onBackToReports={backToReports}
              onBackToSubagents={backToSubagents}
              onSelectTraceEvent={selectTraceEvent}
              onSelectSubagent={selectSubagent}
              onSelectNextStep={startNewResearchFromSuggestion}
              onShellApprovalDecision={(decision) => {
                if (autoReviewOverrideApproval) handleShellApprovalDecision(autoReviewOverrideApproval, decision);
              }}
              onSessionAction={handleSessionAction}
              onSteerInstruction={handleSteerInstruction}
            />
          </div>
        )}
      </main>
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
        activeRunDetail={activeRunDetail}
        activeWorkspaceName={snapshot?.activeScope.workspaceName ?? 'current workspace'}
        busy={busy}
        newResearchOpen={newResearchOpen}
        newResearchInitialGoal={newResearchInitialGoal}
        automationsOpen={automationsOpen}
        pluginsOpen={pluginsOpen}
        agentPluginState={agentPluginState}
        agentPluginsLoading={agentPluginsLoading}
        agentPluginsBusy={agentPluginsBusy}
        agentPluginsError={agentPluginsError}
        pluginRepositoryUrl={pluginRepositoryUrl}
        openAiStatus={snapshot?.openAi ?? openAiStatus}
        defaultProviderId={providerSettings?.defaultProviderId}
        providerModelDefaults={providerSettings?.modelDefaults}
        providerPolicyRiskAcknowledgements={providerSettings?.cyberPolicyRiskAcknowledgements}
        researchProviderModelCatalog={enabledResearchProviderModelCatalog}
        researchProviderStatuses={researchProviderStatuses}
        researchGoalSuggestions={researchGoalSuggestionState.suggestions}
        researchGoalSuggestionsLoading={researchGoalSuggestionState.loading}
        researchGoalSuggestionErrors={researchGoalSuggestionState.errors}
        profilingOpen={profilingOpen}
        profilingState={profilingState}
        lastProfilingReport={lastProfilingReport}
        workspaceDraft={workspaceDraft}
        workspaceOnboardingProgress={workspaceOnboardingProgress}
        workspaceInfo={workspaceInfo}
        sessionSummaryDetail={sessionSummaryDetail}
        searchOpen={searchOpen}
        selectedRunId={selectedRunId}
        selectedTraceEvent={selectedTraceEvent}
        snapshot={snapshot}
        traceDetailOpen={traceDetailOpen}
        traceFilterOpen={traceFilterOpen}
        visibleTraceCategories={visibleTraceCategories}
        onCancelNewResearch={() => {
          setNewResearchInitialGoal(null);
          setNewResearchOpen(false);
        }}
        onCloseAutomations={() => setAutomationsOpen(false)}
        onClosePlugins={() => setPluginsOpen(false)}
        onCancelWorkspaceOnboarding={closeWorkspaceOnboarding}
        onPluginRepositoryUrlChange={setPluginRepositoryUrl}
        onChangeWorkspaceDraft={setWorkspaceDraft}
        onChangeVisibleTraceCategories={setVisibleTraceCategories}
        onCloseNotification={() => setActiveNotification(null)}
        onCloseProfiling={closeProfiling}
        onCloseWorkspaceInfo={() => setWorkspaceInfo(null)}
        onCloseSessionSummary={() => setSessionSummaryDetail(null)}
        onCloseSearch={() => setSearchOpen(false)}
        onCloseTraceDetail={closeTraceDetail}
        onCloseTraceFilters={() => setTraceFilterOpen(false)}
        onLookupHackerOne={lookupHackerOneScope}
        onWorkspaceTemplate={applyOnboardingTemplate}
        onFlushProfilingReport={flushProfilingReport}
        onLoadResearchGoalSuggestions={researchGoalSuggestionState.load}
        onRetryResearchGoalSuggestions={researchGoalSuggestionState.retry}
        onStartedNewResearch={handleResearchStarted}
        onCancelRepeatAutomation={cancelRepeatAutomation}
        onOpenAutomationSession={(runId) => {
          openWorkspaceDashboardSession(runId);
          setAutomationsOpen(false);
        }}
        onOpenSearchResult={openSearchResult}
        onSteerNotification={(notification, instruction) => {
          void runAction(() => window.beale.steerRun({ type: 'steer', runId: notification.runId, instruction }));
          setActiveNotification(null);
        }}
        onSubmitWorkspaceOnboarding={submitWorkspaceOnboarding}
        onAddAgentPluginFromFilesystem={addAgentPluginFromFilesystem}
        onAddAgentPluginFromRepository={addAgentPluginFromRepository}
        onSetAgentPluginEnabled={setAgentPluginEnabled}
        onRemoveAgentPlugin={removeAgentPlugin}
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

function shellApprovalWorkspacePath(approval: ApprovalRecord): string {
  const workspacePath = approval.requestedAction.workspacePath;
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
    throw new Error('Shell approval is missing its originating workspace.');
  }
  return workspacePath;
}


function traceEventForSearchResult(events: TraceDisplayEvent[], result: SessionTranscriptSearchResult): TraceDisplayEvent | null {
  const transcriptEventId = `transcript:${result.transcriptMessageId}`;
  return (
    events.find((event) => {
      if (event.id === transcriptEventId || event.transcriptMessageId === result.transcriptMessageId) return true;
      if (event.payload.transcriptMessageId === result.transcriptMessageId) return true;
      if (!result.traceEventId) return false;
      return event.id === result.traceEventId || event.payload.linkedTraceEventId === result.traceEventId;
    }) ?? null
  );
}
