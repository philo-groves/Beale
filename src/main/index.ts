import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc';
import type { BenchmarkRunInput, ProgramOnboardingInput, ProgramScopeDraft, StartRunInput, SteeringAction, WorkspacePickerMode } from '@shared/types';
import { getHostEnvironment, WorkspaceService } from './workspaceService';

let mainWindow: BrowserWindow | null = null;
let workspaceService: WorkspaceService;
const smokeTestMode = process.argv.includes('--smoke-test');

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    title: 'Beale',
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.setMenuBarVisibility(false);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function broadcastSnapshot(): void {
  const snapshot = workspaceService.getSnapshot();
  const programRegistry = workspaceService.getProgramRegistryState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.snapshotUpdated, snapshot);
    window.webContents.send(IPC_CHANNELS.programRegistryUpdated, programRegistry);
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.selectWorkspace, async (_event, mode: WorkspacePickerMode) => {
    const result = await dialog.showOpenDialog({
      title: mode === 'create' ? 'Create Beale workspace' : 'Open Beale workspace',
      properties: mode === 'create' ? ['openDirectory', 'createDirectory'] : ['openDirectory']
    });
    return {
      canceled: result.canceled,
      path: result.filePaths[0] ?? null
    };
  });

  ipcMain.handle(IPC_CHANNELS.selectProgramDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add Beale program',
      properties: ['openDirectory', 'createDirectory']
    });
    const path = result.filePaths[0] ?? null;
    return result.canceled || !path
      ? {
          canceled: true,
          path: null,
          knownProgram: null,
          requiresOnboarding: false,
          defaults: null
        }
      : workspaceService.inspectProgramDirectory(path);
  });
  ipcMain.handle(IPC_CHANNELS.getProgramRegistry, () => workspaceService.getProgramRegistryState());
  ipcMain.handle(IPC_CHANNELS.lookupHackerOneProgram, (_event, identifier: string) => workspaceService.lookupHackerOneProgram(identifier));
  ipcMain.handle(IPC_CHANNELS.createProgram, (_event, input: ProgramOnboardingInput) => workspaceService.createProgram(input));
  ipcMain.handle(IPC_CHANNELS.openProgram, (_event, programId: string) => workspaceService.openProgram(programId));
  ipcMain.handle(IPC_CHANNELS.openWorkspace, (_event, path: string) => workspaceService.openWorkspace(path));
  ipcMain.handle(IPC_CHANNELS.createWorkspace, (_event, path: string) => workspaceService.createWorkspace(path));
  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => workspaceService.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.getHostEnvironment, () => getHostEnvironment());
  ipcMain.handle(IPC_CHANNELS.getOpenAiStatus, () => workspaceService.getOpenAiStatus());
  ipcMain.handle(IPC_CHANNELS.startOpenAiOAuth, () => workspaceService.startOpenAiOAuth());
  ipcMain.handle(IPC_CHANNELS.refreshOpenAiStatus, () => workspaceService.refreshOpenAiStatus());
  ipcMain.handle(IPC_CHANNELS.saveProgramScope, (_event, scope: ProgramScopeDraft) => workspaceService.saveProgramScope(scope));
  ipcMain.handle(IPC_CHANNELS.startRun, (_event, input: StartRunInput) => workspaceService.startRun(input));
  ipcMain.handle(IPC_CHANNELS.runBenchmarkSuite, (_event, input: BenchmarkRunInput) => workspaceService.runBenchmarkSuite(input));
  ipcMain.handle(IPC_CHANNELS.exportWorkspaceBackup, (_event, note?: string) => workspaceService.exportWorkspaceBackup(note));
  ipcMain.handle(IPC_CHANNELS.getRunDetail, (_event, runId: string) => workspaceService.getRunDetail(runId));
  ipcMain.handle(IPC_CHANNELS.steerRun, (_event, action: SteeringAction) => workspaceService.steerRun(action));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  workspaceService = new WorkspaceService(broadcastSnapshot);
  workspaceService.openLastProgramIfAvailable();
  registerIpc();
  createWindow();
  if (smokeTestMode) {
    setTimeout(() => app.quit(), 1500);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  workspaceService?.dispose();
});
