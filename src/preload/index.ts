import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  BealeApi,
  BenchmarkRunInput,
  CyberGymScenarioRunInput,
  CyberGymScenarioRunStartResult,
  CyberGymScenarioList,
  CyberGymSettingsInput,
  CyberGymStorageActionResult,
  DeveloperSettings,
  ExecutorStatus,
  GeneratedResearchPrompt,
  HostEnvironment,
  HackerOneProgramLookupResult,
  ProgramOnboardingInput,
  ProgramOnboardingProgressUpdate,
  ProgramOnboardingSkipInput,
  ProgramRegistryState,
  ProfilingReport,
  ProfilingState,
  ProgramGraphProjection,
  ProgramGraphVisualization,
  ProgramScopeDraft,
  ResearchPromptGenerationInput,
  ResearchPromptGenerationUpdate,
  SandboxSetupInput,
  SandboxSetupResult,
  SessionTranscriptSearchInput,
  SessionTranscriptSearchResponse,
  StartRunInput,
  SteeringAction,
  VmPreferenceInput,
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
  selectProgramDirectory() {
    return ipcRenderer.invoke(IPC_CHANNELS.selectProgramDirectory);
  },
  getProgramRegistry() {
    return ipcRenderer.invoke(IPC_CHANNELS.getProgramRegistry);
  },
  getDeveloperSettings(): Promise<DeveloperSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.getDeveloperSettings);
  },
  setDeveloperModeEnabled(enabled: boolean): Promise<DeveloperSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.setDeveloperModeEnabled, enabled);
  },
  updateCyberGymSettings(input: CyberGymSettingsInput): Promise<DeveloperSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateCyberGymSettings, input);
  },
  prepareCyberGymStorage(): Promise<CyberGymStorageActionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.prepareCyberGymStorage);
  },
  clearCyberGymCache(): Promise<CyberGymStorageActionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.clearCyberGymCache);
  },
  getCyberGymScenarios(): Promise<CyberGymScenarioList> {
    return ipcRenderer.invoke(IPC_CHANNELS.getCyberGymScenarios);
  },
  openCyberGymProgram(): Promise<WorkspaceSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.openCyberGymProgram);
  },
  startCyberGymScenarioRun(input: CyberGymScenarioRunInput): Promise<CyberGymScenarioRunStartResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.startCyberGymScenarioRun, input);
  },
  lookupHackerOneProgram(identifier: string): Promise<HackerOneProgramLookupResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.lookupHackerOneProgram, identifier);
  },
  createProgram(input: ProgramOnboardingInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.createProgram, input);
  },
  skipProgramOnboardingRepository(input: ProgramOnboardingSkipInput): Promise<ProgramOnboardingProgressUpdate | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.skipProgramOnboardingRepository, input);
  },
  onProgramOnboardingUpdate(listener: (update: ProgramOnboardingProgressUpdate) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, update: ProgramOnboardingProgressUpdate): void => listener(update);
    ipcRenderer.on(IPC_CHANNELS.programOnboardingUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.programOnboardingUpdated, wrapped);
  },
  openProgram(programId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.openProgram, programId);
  },
  removeProgram(programId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.removeProgram, programId);
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
  getExecutorStatus(): Promise<ExecutorStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.getExecutorStatus);
  },
  setVmPreference(input: VmPreferenceInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.setVmPreference, input);
  },
  setupSandbox(input: SandboxSetupInput): Promise<SandboxSetupResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.setupSandbox, input);
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
  getProfilingState(): Promise<ProfilingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.getProfilingState);
  },
  setProfilingEnabled(enabled: boolean): Promise<ProfilingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.setProfilingEnabled, enabled);
  },
  recordProfilingReport(report: ProfilingReport): Promise<ProfilingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.recordProfilingReport, report);
  },
  setProjectSemanticIndexEnabled(enabled: boolean) {
    return ipcRenderer.invoke(IPC_CHANNELS.setProjectSemanticIndexEnabled, enabled);
  },
  refreshProjectSemanticIndex() {
    return ipcRenderer.invoke(IPC_CHANNELS.refreshProjectSemanticIndex);
  },
  getProgramGraphVisualization(): Promise<ProgramGraphVisualization> {
    return ipcRenderer.invoke(IPC_CHANNELS.getProgramGraphVisualization);
  },
  getProgramGraphProjection(): Promise<ProgramGraphProjection> {
    return ipcRenderer.invoke(IPC_CHANNELS.getProgramGraphProjection);
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
  saveProgramScope(scope: ProgramScopeDraft) {
    return ipcRenderer.invoke(IPC_CHANNELS.saveProgramScope, scope);
  },
  startRun(input: StartRunInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.startRun, input);
  },
  runBenchmarkSuite(input: BenchmarkRunInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.runBenchmarkSuite, input);
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
  onProgramRegistry(listener: (state: ProgramRegistryState) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, state: ProgramRegistryState): void => listener(state);
    ipcRenderer.on(IPC_CHANNELS.programRegistryUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.programRegistryUpdated, wrapped);
  }
};

contextBridge.exposeInMainWorld('beale', api);
