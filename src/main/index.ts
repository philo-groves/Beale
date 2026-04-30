import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  BenchmarkRunInput,
  ProfilingReport,
  ProgramOnboardingInput,
  ProgramScopeDraft,
  ResearchPromptGenerationInput,
  RunDetailUpdateCursor,
  StartRunInput,
  SteeringAction,
  VmPreferenceInput,
  WorkspacePickerMode
} from '@shared/types';
import { getHostEnvironment, WorkspaceService } from './workspaceService';

let mainWindow: BrowserWindow | null = null;
let workspaceService: WorkspaceService;
const smokeTestMode = process.argv.includes('--smoke-test');

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const appIcon = createAppIcon();
  if (appIcon && isMac && app.dock) {
    app.dock.setIcon(appIcon);
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    title: 'Beale',
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    transparent: true,
    hasShadow: true,
    roundedCorners: true,
    ...(appIcon ? { icon: appIcon } : {}),
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 12, y: 13 }
        }
      : {
          frame: false
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.setBackgroundColor('#00000000');
  mainWindow.setMenuBarVisibility(false);
  registerWindowChromeStateEvents(mainWindow);
  registerRendererDevToolsControls(mainWindow);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createAppIcon(): Electron.NativeImage | null {
  const sourcePath = appIconSourcePath();
  if (!sourcePath) return null;
  const source = nativeImage.createFromPath(sourcePath);
  if (source.isEmpty()) return null;

  const size = source.getSize();
  const cropSize = Math.min(size.width, size.height);
  if (cropSize <= 0) return null;
  const cropped = source.crop({
    x: Math.max(0, Math.floor((size.width - cropSize) / 2)),
    y: Math.max(0, Math.floor((size.height - cropSize) / 2)),
    width: cropSize,
    height: cropSize
  });
  return cropped.resize({ width: 256, height: 256, quality: 'best' });
}

function appIconSourcePath(): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources/app-icon.png'),
    join(process.cwd(), 'resources/app-icon.png'),
    join(__dirname, '../../resources/app-icon.png'),
    join(process.resourcesPath, 'app-icon.png'),
    join(process.resourcesPath, 'resources/app-icon.png')
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function windowForEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function windowChromeState(window: BrowserWindow | null): { isMaximized: boolean; isFullScreen: boolean } {
  return {
    isMaximized: window?.isMaximized() ?? false,
    isFullScreen: window?.isFullScreen() ?? false
  };
}

function sendWindowChromeState(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.windowChromeStateUpdated, windowChromeState(window));
  }
}

function registerWindowChromeStateEvents(window: BrowserWindow): void {
  const send = (): void => sendWindowChromeState(window);
  window.on('maximize', send);
  window.on('unmaximize', send);
  window.on('enter-full-screen', send);
  window.on('leave-full-screen', send);
  window.webContents.once('did-finish-load', send);
}

function registerRendererDevToolsControls(window: BrowserWindow): void {
  if (!rendererDevToolsAllowed()) return;

  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const toggleRequested = input.key === 'F12' || ((input.control || input.meta) && input.shift && key === 'i');
    if (!toggleRequested) return;

    event.preventDefault();
    toggleRendererDevTools(window);
  });

  window.webContents.once('did-finish-load', () => {
    if (rendererDevToolsAutoOpen()) {
      toggleRendererDevTools(window, true);
    }
  });
}

function rendererDevToolsAllowed(): boolean {
  return !app.isPackaged || process.env.BEALE_ENABLE_DEVTOOLS === '1';
}

function rendererDevToolsAutoOpen(): boolean {
  return process.argv.includes('--open-devtools') || process.env.BEALE_OPEN_DEVTOOLS === '1';
}

function toggleRendererDevTools(window: BrowserWindow, openOnly = false): void {
  if (window.isDestroyed()) return;
  if (window.webContents.isDevToolsOpened()) {
    if (!openOnly) {
      window.webContents.closeDevTools();
    }
    return;
  }
  window.webContents.openDevTools({ mode: 'detach' });
}

function timedMainIpc<T>(name: string, detail: Record<string, string | number | boolean>, operation: () => T): T {
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    const durationMs = performance.now() - startedAt;
    if (mainPerformanceLoggingEnabled()) {
      console.info(`[Beale main perf] ${name} ${roundMetricMs(durationMs)}ms ${formatMainMetricDetail(detail)}`);
    }
    workspaceService?.recordProfilingMainTiming(name, durationMs, detail);
  }
}

async function timedMainIpcAsync<T>(name: string, detail: Record<string, string | number | boolean>, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    const durationMs = performance.now() - startedAt;
    if (mainPerformanceLoggingEnabled()) {
      console.info(`[Beale main perf] ${name} ${roundMetricMs(durationMs)}ms ${formatMainMetricDetail(detail)}`);
    }
    workspaceService?.recordProfilingMainTiming(name, durationMs, detail);
  }
}

function mainPerformanceLoggingEnabled(): boolean {
  return process.env.BEALE_MAIN_PERF === '1' || process.env.BEALE_DEV_PERFORMANCE === '1';
}

function formatMainMetricDetail(detail: Record<string, string | number | boolean>): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
}

function roundMetricMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function shortMetricId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}...${id.slice(-4)}`;
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
  ipcMain.handle(IPC_CHANNELS.removeProgram, (_event, programId: string) => workspaceService.removeProgram(programId));
  ipcMain.handle(IPC_CHANNELS.openWorkspace, (_event, path: string) => workspaceService.openWorkspace(path));
  ipcMain.handle(IPC_CHANNELS.createWorkspace, (_event, path: string) => workspaceService.createWorkspace(path));
  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => workspaceService.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.getHostEnvironment, () => getHostEnvironment());
  ipcMain.handle(IPC_CHANNELS.setVmPreference, (_event, input: VmPreferenceInput) => workspaceService.setVmPreference(input));
  ipcMain.handle(IPC_CHANNELS.getOpenAiStatus, () => workspaceService.getOpenAiStatus());
  ipcMain.handle(IPC_CHANNELS.startOpenAiOAuth, () => workspaceService.startOpenAiOAuth());
  ipcMain.handle(IPC_CHANNELS.refreshOpenAiStatus, () => workspaceService.refreshOpenAiStatus());
  ipcMain.handle(IPC_CHANNELS.getProfilingState, () => workspaceService.getProfilingState());
  ipcMain.handle(IPC_CHANNELS.setProfilingEnabled, (_event, enabled: boolean) => workspaceService.setProfilingEnabled(enabled));
  ipcMain.handle(IPC_CHANNELS.recordProfilingReport, (_event, report: ProfilingReport) => workspaceService.recordProfilingReport(report));
  ipcMain.handle(IPC_CHANNELS.generateResearchPrompt, (event, input?: ResearchPromptGenerationInput) =>
    timedMainIpcAsync('generateResearchPrompt', { hasInput: Boolean(input) }, () =>
      workspaceService.generateResearchPrompt(input, (update) => event.sender.send(IPC_CHANNELS.researchPromptGenerationUpdated, update))
    )
  );
  ipcMain.handle(IPC_CHANNELS.cancelResearchPromptGeneration, (_event, requestId: string) => workspaceService.cancelResearchPromptGeneration(requestId));
  ipcMain.handle(IPC_CHANNELS.saveProgramScope, (_event, scope: ProgramScopeDraft) => workspaceService.saveProgramScope(scope));
  ipcMain.handle(IPC_CHANNELS.startRun, (_event, input: StartRunInput) =>
    timedMainIpc('startRun', { engine: input.runEngine, mode: input.mode, network: input.networkProfile }, () => workspaceService.startRun(input))
  );
  ipcMain.handle(IPC_CHANNELS.runBenchmarkSuite, (_event, input: BenchmarkRunInput) => workspaceService.runBenchmarkSuite(input));
  ipcMain.handle(IPC_CHANNELS.exportWorkspaceBackup, (_event, note?: string) => workspaceService.exportWorkspaceBackup(note));
  ipcMain.handle(IPC_CHANNELS.getRunDetail, (_event, runId: string) =>
    timedMainIpc('getRunDetail', { run: shortMetricId(runId) }, () => workspaceService.getRunDetail(runId))
  );
  ipcMain.handle(IPC_CHANNELS.getRunDetailVersion, (_event, runId: string) =>
    timedMainIpc('getRunDetailVersion', { run: shortMetricId(runId) }, () => workspaceService.getRunDetailVersion(runId))
  );
  ipcMain.handle(IPC_CHANNELS.getRunDetailUpdate, (_event, runId: string, cursor: RunDetailUpdateCursor) =>
    timedMainIpc('getRunDetailUpdate', { run: shortMetricId(runId), afterTrace: cursor.afterTraceSequence, afterTranscript: cursor.afterTranscriptCount }, () =>
      workspaceService.getRunDetailUpdate(runId, cursor)
    )
  );
  ipcMain.handle(IPC_CHANNELS.steerRun, (_event, action: SteeringAction) =>
    timedMainIpc('steerRun', { type: action.type, run: shortMetricId(action.runId) }, () => workspaceService.steerRun(action))
  );
  ipcMain.handle(IPC_CHANNELS.openNotification, (_event, notificationId: string) => workspaceService.openNotification(notificationId));
  ipcMain.handle(IPC_CHANNELS.dismissNotification, (_event, notificationId: string) => workspaceService.dismissNotification(notificationId));
  ipcMain.handle(IPC_CHANNELS.minimizeWindow, (event) => {
    windowForEvent(event)?.minimize();
  });
  ipcMain.handle(IPC_CHANNELS.toggleMaximizeWindow, (event) => {
    const window = windowForEvent(event);
    if (!window) return;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });
  ipcMain.handle(IPC_CHANNELS.closeWindow, (event) => {
    windowForEvent(event)?.close();
  });
  ipcMain.handle(IPC_CHANNELS.getWindowChromeState, (event) => windowChromeState(windowForEvent(event)));
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
