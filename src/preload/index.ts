import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  BealeApi,
  BenchmarkRunInput,
  HostEnvironment,
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
  refreshOpenAiStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.refreshOpenAiStatus);
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
  onSnapshot(listener: (snapshot: WorkspaceSnapshot | null) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: WorkspaceSnapshot | null): void => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.snapshotUpdated, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshotUpdated, wrapped);
  }
};

contextBridge.exposeInMainWorld('beale', api);
