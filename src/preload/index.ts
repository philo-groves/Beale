import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  BealeApi,
  BenchmarkRunInput,
  GeneratedResearchPrompt,
  HostEnvironment,
  HackerOneProgramLookupResult,
  ProgramOnboardingInput,
  ProgramRegistryState,
  ProfilingReport,
  ProfilingState,
  ProgramScopeDraft,
  ResearchPromptGenerationInput,
  ResearchPromptGenerationUpdate,
  SessionTranscriptSearchInput,
  SessionTranscriptSearchResponse,
  StartRunInput,
  SteeringAction,
  VmPreferenceInput,
  WindowChromeState,
  WorkspacePickerMode,
  WorkspaceSnapshot
} from '@shared/types';

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
  lookupHackerOneProgram(identifier: string): Promise<HackerOneProgramLookupResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.lookupHackerOneProgram, identifier);
  },
  createProgram(input: ProgramOnboardingInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.createProgram, input);
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
  setVmPreference(input: VmPreferenceInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.setVmPreference, input);
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
