import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  BealeApi,
  DeveloperSettings,
  ShellOptions,
  GeneratedResearchPrompt,
  HostEnvironment,
  HackerOneScopeLookupResult,
  HoneycrispMemoryDirectorySummary,
  HoneycrispRunbookDocument,
  HoneycrispToolingConfigUpdate,
  WorkspaceOnboardingInput,
  WorkspaceOnboardingProgressUpdate,
  WorkspaceOnboardingSkipInput,
  WorkspaceRegistryState,
  ProfilingReport,
  ProfilingState,
  WorkspaceScopeDraft,
  ResearchPromptGenerationInput,
  ResearchPromptGenerationUpdate,
  HamModeGenerationUpdate,
  ResearchProviderId,
  ResearchProviderModelCatalog,
  ResearchProviderOAuthStartResult,
  ResearchProviderStatus,
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
  getShellOptions(): Promise<ShellOptions> {
    return ipcRenderer.invoke(IPC_CHANNELS.getShellOptions);
  },
  setShellOptions(options: ShellOptions): Promise<ShellOptions> {
    return ipcRenderer.invoke(IPC_CHANNELS.setShellOptions, options);
  },
  lookupHackerOneScope(identifier: string): Promise<HackerOneScopeLookupResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.lookupHackerOneScope, identifier);
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
  runMemoryDreaming() {
    return ipcRenderer.invoke(IPC_CHANNELS.runMemoryDreaming);
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
  onHamModeGenerationUpdate(listener: (update: HamModeGenerationUpdate) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, update: HamModeGenerationUpdate): void => listener(update);
    ipcRenderer.on(IPC_CHANNELS.hamModeGenerationUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.hamModeGenerationUpdated, wrapped);
  },
  saveScope(scope: WorkspaceScopeDraft) {
    return ipcRenderer.invoke(IPC_CHANNELS.saveScope, scope);
  },
  setHamModeEnabled(enabled: boolean, promptGuidance?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.setHamModeEnabled, enabled, promptGuidance);
  },
  startRun(input: StartRunInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.startRun, input);
  },
  exportWorkspaceBackup(note?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.exportWorkspaceBackup, note);
  },
  getRunDetail(runId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.getRunDetail, runId);
  },
  getRunDetailVersion(runId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.getRunDetailVersion, runId);
  },
  getRunDetailUpdate(runId: string, cursor) {
    return ipcRenderer.invoke(IPC_CHANNELS.getRunDetailUpdate, runId, cursor);
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
