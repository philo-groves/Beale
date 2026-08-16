import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  BealeApi,
  DeveloperSettings,
  ProviderSettings,
  ProviderAuthenticationMethod,
  ProviderModelDefaults,
  AgentPluginRegistryState,
  MemorySettings,
  MemoryTypeDescriptions,
  ShellOptions,
  GeneratedResearchGoalSuggestions,
  GeneratedResearchPrompt,
  HostEnvironment,
  HackerOneScopeLookupResult,
  GitHubRepositorySummary,
  HoneycrispMemoryDirectorySummary,
  MemoryDreamingProgressUpdate,
  HoneycrispRunbookDocument,
  HoneycrispReportDocument,
  HoneycrispToolingConfigUpdate,
  NativeMenuAction,
  WorkspaceOnboardingInput,
  WorkspaceOnboardingProgressUpdate,
  WorkspaceOnboardingSkipInput,
  WorkspaceRegistryState,
  ProfilingReport,
  ProfilingState,
  WorkspaceScopeDraft,
  ResolvedResearchProfile,
  ResearchPromptGenerationInput,
  ResearchPromptGenerationUpdate,
  ResearchGoalSuggestionInput,
  ResearchGoalSuggestionSelectionInput,
  ResearchProviderId,
  ResearchModelProviderId,
  ResearchProviderModelCatalog,
  ResearchProviderOAuthStartResult,
  ResearchProviderStatus,
  RunDetail,
  RunDetailUpdate,
  SessionTranscriptSearchInput,
  SessionTranscriptSearchResponse,
  StartRunInput,
  SteeringAction,
  WindowChromeState,
  WorkspacePickerMode,
  WorkspaceSnapshot,
  ZoomState
} from '@shared/types';

function zoomState(): ZoomState {
  return {
    level: webFrame.getZoomLevel(),
    percent: Math.round(webFrame.getZoomFactor() * 100)
  };
}

async function invokeRunDetail<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args) as
    | { canceled: true }
    | { canceled: false; value: T };
  if (result.canceled) throw new Error('Beale session detail request was canceled.');
  return result.value;
}

const api: BealeApi = {
  selectWorkspace(mode: WorkspacePickerMode) {
    return ipcRenderer.invoke(IPC_CHANNELS.selectWorkspace, mode);
  },
  selectWorkspaceDirectory() {
    return ipcRenderer.invoke(IPC_CHANNELS.selectWorkspaceDirectory);
  },
  getWorkspaceRegistry() {
    return ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceRegistry);
  },
  getDeveloperSettings(): Promise<DeveloperSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.getDeveloperSettings);
  },
  setDeveloperModeEnabled(enabled: boolean): Promise<DeveloperSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.setDeveloperModeEnabled, enabled);
  },
  getProviderSettings(): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.getProviderSettings);
  },
  setDefaultProviderId(providerId: ResearchModelProviderId | null): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.setDefaultProviderId, providerId);
  },
  setProviderModelDefaults(providerId: ResearchModelProviderId, defaults: ProviderModelDefaults): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.setProviderModelDefaults, providerId, defaults);
  },
  setProviderOptionalModelEnabled(
    providerId: ResearchModelProviderId,
    modelId: string,
    enabled: boolean
  ): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.setProviderOptionalModelEnabled, providerId, modelId, enabled);
  },
  setProviderCyberPolicyRiskAcknowledged(providerId: ResearchModelProviderId, acknowledged: boolean): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.setProviderCyberPolicyRiskAcknowledged, providerId, acknowledged);
  },
  setProviderPreferredAuthenticationMethod(
    providerId: ResearchModelProviderId,
    method: ProviderAuthenticationMethod
  ): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.setProviderPreferredAuthenticationMethod, providerId, method);
  },
  getResearchProfiles(): Promise<ResolvedResearchProfile[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.getResearchProfiles);
  },
  getAgentPlugins(): Promise<AgentPluginRegistryState> {
    return ipcRenderer.invoke(IPC_CHANNELS.getAgentPlugins);
  },
  addAgentPluginFromFilesystem(): Promise<AgentPluginRegistryState> {
    return ipcRenderer.invoke(IPC_CHANNELS.addAgentPluginFromFilesystem);
  },
  addAgentPluginFromRepository(repositoryUrl: string): Promise<AgentPluginRegistryState> {
    return ipcRenderer.invoke(IPC_CHANNELS.addAgentPluginFromRepository, repositoryUrl);
  },
  setAgentPluginEnabled(pluginId: string, enabled: boolean): Promise<AgentPluginRegistryState> {
    return ipcRenderer.invoke(IPC_CHANNELS.setAgentPluginEnabled, pluginId, enabled);
  },
  removeAgentPlugin(pluginId: string): Promise<AgentPluginRegistryState> {
    return ipcRenderer.invoke(IPC_CHANNELS.removeAgentPlugin, pluginId);
  },
  getMemorySettings(): Promise<MemorySettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.getMemorySettings);
  },
  setMemoryTypeDescriptions(descriptions: MemoryTypeDescriptions): Promise<MemorySettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.setMemoryTypeDescriptions, descriptions);
  },
  getShellOptions(): Promise<ShellOptions> {
    return ipcRenderer.invoke(IPC_CHANNELS.getShellOptions);
  },
  setShellOptions(options: ShellOptions): Promise<ShellOptions> {
    return ipcRenderer.invoke(IPC_CHANNELS.setShellOptions, options);
  },
  lookupHackerOneScope(identifier: string): Promise<HackerOneScopeLookupResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.lookupHackerOneScope, identifier);
  },
  listGitHubOrganizationRepositories(organization: string): Promise<GitHubRepositorySummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.listGitHubOrganizationRepositories, organization);
  },
  createScopedWorkspace(input: WorkspaceOnboardingInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.createScopedWorkspace, input);
  },
  skipWorkspaceOnboardingRepository(input: WorkspaceOnboardingSkipInput): Promise<WorkspaceOnboardingProgressUpdate | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.skipWorkspaceOnboardingRepository, input);
  },
  onWorkspaceOnboardingUpdate(listener: (update: WorkspaceOnboardingProgressUpdate) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, update: WorkspaceOnboardingProgressUpdate): void => listener(update);
    ipcRenderer.on(IPC_CHANNELS.workspaceOnboardingUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceOnboardingUpdated, wrapped);
  },
  openRegisteredWorkspace(registryWorkspaceId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.openRegisteredWorkspace, registryWorkspaceId);
  },
  removeRegisteredWorkspace(registryWorkspaceId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.removeRegisteredWorkspace, registryWorkspaceId);
  },
  openWorkspace(path: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.openWorkspace, path);
  },
  createWorkspace(path: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.createWorkspace, path);
  },
  restoreLastWorkspace(): Promise<WorkspaceSnapshot | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.restoreLastWorkspace);
  },
  getSnapshot() {
    return ipcRenderer.invoke(IPC_CHANNELS.getSnapshot);
  },
  getHostEnvironment(): Promise<HostEnvironment> {
    return ipcRenderer.invoke(IPC_CHANNELS.getHostEnvironment);
  },
  getOpenAiStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.getOpenAiStatus);
  },
  startOpenAiOAuth() {
    return ipcRenderer.invoke(IPC_CHANNELS.startOpenAiOAuth);
  },
  forgetProviderSubscription(providerId: ResearchModelProviderId): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.forgetProviderSubscription, providerId);
  },
  removeProvider(providerId: ResearchModelProviderId): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.removeProvider, providerId);
  },
  configureProviderApiKey(providerId: ResearchModelProviderId, apiKey: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.configureProviderApiKey, providerId, apiKey);
  },
  removeProviderApiKey(providerId: ResearchModelProviderId): Promise<ProviderSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.removeProviderApiKey, providerId);
  },
  refreshOpenAiStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.refreshOpenAiStatus);
  },
  getResearchProviderStatuses(): Promise<ResearchProviderStatus[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.getResearchProviderStatuses);
  },
  getResearchProviderModelCatalog(): Promise<ResearchProviderModelCatalog[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.getResearchProviderModelCatalog);
  },
  startResearchProviderOAuth(providerId: ResearchProviderId): Promise<ResearchProviderOAuthStartResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.startResearchProviderOAuth, providerId);
  },
  getProfilingState(): Promise<ProfilingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.getProfilingState);
  },
  setProfilingEnabled(enabled: boolean): Promise<ProfilingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.setProfilingEnabled, enabled);
  },
  recordProfilingReport(report: ProfilingReport): Promise<ProfilingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.recordProfilingReport, report);
  },
  openHoneycrispMemoryDirectory(name: HoneycrispMemoryDirectorySummary['name']) {
    return ipcRenderer.invoke(IPC_CHANNELS.openHoneycrispMemoryDirectory, name);
  },
  getHoneycrispRunbook(runbookId: string): Promise<HoneycrispRunbookDocument> {
    return ipcRenderer.invoke(IPC_CHANNELS.getHoneycrispRunbook, runbookId);
  },
  getHoneycrispReport(reportId: string): Promise<HoneycrispReportDocument> {
    return ipcRenderer.invoke(IPC_CHANNELS.getHoneycrispReport, reportId);
  },
  runWorkspaceDejunk() {
    return ipcRenderer.invoke(IPC_CHANNELS.runWorkspaceDejunk);
  },
  runMemoryDreaming() {
    return ipcRenderer.invoke(IPC_CHANNELS.runMemoryDreaming);
  },
  onMemoryDreamingProgress(listener: (update: MemoryDreamingProgressUpdate) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, update: MemoryDreamingProgressUpdate): void => listener(update);
    ipcRenderer.on(IPC_CHANNELS.memoryDreamingUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.memoryDreamingUpdated, wrapped);
  },
  restoreMemoryDreamingChange(changeId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.restoreMemoryDreamingChange, changeId);
  },
  getHoneycrispToolingSummary() {
    return ipcRenderer.invoke(IPC_CHANNELS.getHoneycrispToolingSummary);
  },
  updateHoneycrispToolingConfig(update: HoneycrispToolingConfigUpdate) {
    return ipcRenderer.invoke(IPC_CHANNELS.updateHoneycrispToolingConfig, update);
  },
  generateResearchGoalSuggestions(input: ResearchGoalSuggestionInput): Promise<GeneratedResearchGoalSuggestions> {
    return ipcRenderer.invoke(IPC_CHANNELS.generateResearchGoalSuggestions, input);
  },
  selectResearchGoalSuggestion(input: ResearchGoalSuggestionSelectionInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.selectResearchGoalSuggestion, input);
  },
  generateResearchPrompt(input?: ResearchPromptGenerationInput): Promise<GeneratedResearchPrompt> {
    return ipcRenderer.invoke(IPC_CHANNELS.generateResearchPrompt, input);
  },
  cancelResearchPromptGeneration(requestId: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.cancelResearchPromptGeneration, requestId);
  },
  onResearchPromptGenerationUpdate(listener: (update: ResearchPromptGenerationUpdate) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, update: ResearchPromptGenerationUpdate): void => listener(update);
    ipcRenderer.on(IPC_CHANNELS.researchPromptGenerationUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.researchPromptGenerationUpdated, wrapped);
  },
  saveScope(scope: WorkspaceScopeDraft) {
    return ipcRenderer.invoke(IPC_CHANNELS.saveScope, scope);
  },
  startRun(input: StartRunInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.startRun, input);
  },
  exportWorkspaceBackup(note?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.exportWorkspaceBackup, note);
  },
  getRunDetail(runId: string) {
    return invokeRunDetail<RunDetail>(IPC_CHANNELS.getRunDetail, runId);
  },
  getRunDetailVersion(runId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.getRunDetailVersion, runId);
  },
  getRunDetailUpdate(runId: string, cursor) {
    return invokeRunDetail<RunDetailUpdate>(IPC_CHANNELS.getRunDetailUpdate, runId, cursor);
  },
  cancelRunDetailRequests() {
    ipcRenderer.send(IPC_CHANNELS.cancelRunDetailRequests);
  },
  searchSessionTranscripts(input: SessionTranscriptSearchInput): Promise<SessionTranscriptSearchResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.searchSessionTranscripts, input);
  },
  steerRun(action: SteeringAction) {
    return ipcRenderer.invoke(IPC_CHANNELS.steerRun, action);
  },
  openNotification(notificationId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.openNotification, notificationId);
  },
  dismissNotification(notificationId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.dismissNotification, notificationId);
  },
  minimizeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.minimizeWindow);
  },
  toggleMaximizeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.toggleMaximizeWindow);
  },
  closeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.closeWindow);
  },
  getZoomState() {
    return zoomState();
  },
  zoomIn() {
    const nextLevel = Math.min(6, webFrame.getZoomLevel() + 1);
    webFrame.setZoomLevel(nextLevel);
    return zoomState();
  },
  zoomOut() {
    const nextLevel = Math.max(-4, webFrame.getZoomLevel() - 1);
    webFrame.setZoomLevel(nextLevel);
    return zoomState();
  },
  getWindowChromeState(): Promise<WindowChromeState> {
    return ipcRenderer.invoke(IPC_CHANNELS.getWindowChromeState);
  },
  onWindowChromeState(listener: (state: WindowChromeState) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, state: WindowChromeState): void => listener(state);
    ipcRenderer.on(IPC_CHANNELS.windowChromeStateUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.windowChromeStateUpdated, wrapped);
  },
  onNativeMenuAction(listener: (action: NativeMenuAction) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, action: NativeMenuAction): void => listener(action);
    ipcRenderer.on(IPC_CHANNELS.nativeMenuAction, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.nativeMenuAction, wrapped);
  },
  onSnapshot(listener: (snapshot: WorkspaceSnapshot | null) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: WorkspaceSnapshot | null): void => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.snapshotUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshotUpdated, wrapped);
  },
  onWorkspaceRegistry(listener: (state: WorkspaceRegistryState) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, state: WorkspaceRegistryState): void => listener(state);
    ipcRenderer.on(IPC_CHANNELS.workspaceRegistryUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceRegistryUpdated, wrapped);
  }
};

contextBridge.exposeInMainWorld('beale', api);
