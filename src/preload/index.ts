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
  ProgramScopeDraft,
  StartRunInput,
  SteeringAction,
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
  getOpenAiStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.getOpenAiStatus);
  },
  startOpenAiOAuth() {
    return ipcRenderer.invoke(IPC_CHANNELS.startOpenAiOAuth);
  },
  refreshOpenAiStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.refreshOpenAiStatus);
  },
  generateResearchPrompt(): Promise<GeneratedResearchPrompt> {
    return ipcRenderer.invoke(IPC_CHANNELS.generateResearchPrompt);
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
  steerRun(action: SteeringAction) {
    return ipcRenderer.invoke(IPC_CHANNELS.steerRun, action);
  },
  openNotification(notificationId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.openNotification, notificationId);
  },
  dismissNotification(notificationId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.dismissNotification, notificationId);
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
