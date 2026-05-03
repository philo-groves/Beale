import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from 'electron';
import type { IpcMainInvokeEvent, Rectangle } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  BenchmarkRunInput,
  ProfilingReport,
  ProgramRegistryState,
  ProgramOnboardingInput,
  ProgramOnboardingSkipInput,
  ProgramScopeDraft,
  ResearchPromptGenerationInput,
  RunDetailUpdateCursor,
  SessionTranscriptSearchInput,
  StartRunInput,
  SteeringAction,
  VmPreferenceInput,
  WorkspaceSnapshot,
  WorkspacePickerMode
} from '@shared/types';
import { getHostEnvironment, WorkspaceService, type WorkspaceChange } from './workspaceService';

let mainWindow: BrowserWindow | null = null;
let workspaceService: WorkspaceService;
const smokeTestMode = process.argv.includes('--smoke-test');
const NATIVE_WINDOW_SHAPE_RADIUS_PX = 8;

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const needsNativeWindowShape = process.platform === 'linux';
  const supportsNativeRoundedCorners = process.platform === 'darwin' || process.platform === 'win32';
  const appIcon = createAppIcon();
  if (appIcon && isMac && app.dock) {
    app.dock.setIcon(appIcon);
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    show: !needsNativeWindowShape,
    title: 'Beale',
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    transparent: true,
    hasShadow: isMac,
    roundedCorners: supportsNativeRoundedCorners,
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
  registerRoundedWindowShape(mainWindow, needsNativeWindowShape);
  registerRoundedWindowStartupShow(mainWindow, needsNativeWindowShape);
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

function registerRoundedWindowShape(window: BrowserWindow, enabled: boolean): void {
  if (!enabled) return;

  let pending = false;
  const apply = (): void => {
    if (window.isDestroyed() || pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      applyRoundedWindowShape(window);
    });
  };

  window.on('resize', apply);
  window.on('move', apply);
  window.on('maximize', apply);
  window.on('unmaximize', apply);
  window.on('enter-full-screen', apply);
  window.on('leave-full-screen', apply);
  window.webContents.once('did-finish-load', apply);
  apply();
}

function registerRoundedWindowStartupShow(window: BrowserWindow, enabled: boolean): void {
  if (!enabled) return;

  let shown = false;
  const show = (): void => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    applyRoundedWindowShape(window);
    primeRoundedWindowShapeCompositor(window);
    refreshRoundedWindowShape(window);
    window.show();
    refreshRoundedWindowShape(window);
    setTimeout(() => refreshRoundedWindowShape(window), 120);
    setTimeout(() => refreshRoundedWindowShape(window), 360);
  };

  window.once('ready-to-show', show);
  window.webContents.once('did-finish-load', () => setImmediate(show));
}

function applyRoundedWindowShape(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const { width, height } = window.getContentBounds();
  if (width <= 0 || height <= 0) return;
  if (window.isMaximized() || window.isFullScreen()) {
    window.setShape([{ x: 0, y: 0, width, height }]);
    return;
  }
  window.setShape(roundedRectShape(width, height, NATIVE_WINDOW_SHAPE_RADIUS_PX));
}

function refreshRoundedWindowShape(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  applyRoundedWindowShape(window);
  if (window.isMaximized() || window.isFullScreen()) return;
  const bounds = window.getBounds();
  window.setBounds(bounds, false);
}

function primeRoundedWindowShapeCompositor(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return;
  const bounds = window.getBounds();
  window.setBounds({ ...bounds, x: bounds.x + 1 }, false);
  window.setBounds(bounds, false);
}

function roundedRectShape(width: number, height: number, radius: number): Rectangle[] {
  const safeRadius = Math.max(0, Math.min(radius, Math.floor(width / 2), Math.floor(height / 2)));
  if (safeRadius <= 0) return [{ x: 0, y: 0, width, height }];

  const rects: Rectangle[] = [];
  for (let y = 0; y < safeRadius; y += 1) {
    const distanceFromCenter = safeRadius - y - 0.5;
    const inset = Math.ceil(safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - distanceFromCenter * distanceFromCenter)));
    rects.push({ x: inset, y, width: Math.max(0, width - inset * 2), height: 1 });
  }

  const centerHeight = height - safeRadius * 2;
  if (centerHeight > 0) {
    rects.push({ x: 0, y: safeRadius, width, height: centerHeight });
  }

  for (let y = safeRadius - 1; y >= 0; y -= 1) {
    const distanceFromCenter = safeRadius - y - 0.5;
    const inset = Math.ceil(safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - distanceFromCenter * distanceFromCenter)));
    rects.push({ x: inset, y: height - y - 1, width: Math.max(0, width - inset * 2), height: 1 });
  }
  return rects;
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

function broadcastSnapshot(change: WorkspaceChange = { programRegistryChanged: true }): void {
  timedMainIpc('broadcastSnapshot.total', { registry: change.programRegistryChanged }, () => {
    const snapshot = timedMainIpc('broadcastSnapshot.getSnapshot', {}, () => workspaceService.getSnapshot());
    const programRegistry = change.programRegistryChanged
      ? timedMainIpc('broadcastSnapshot.getProgramRegistry', snapshotBroadcastMetricDetail(snapshot), () => workspaceService.getCachedProgramRegistryState())
      : null;
    const windows = BrowserWindow.getAllWindows();
    timedMainIpc(
      'broadcastSnapshot.sendAll',
      {
        ...snapshotBroadcastMetricDetail(snapshot),
        ...(programRegistry ? programRegistryBroadcastMetricDetail(programRegistry) : { registryPrograms: 0, registrySessions: 0 }),
        registry: Boolean(programRegistry),
        windows: windows.length
      },
      () => {
        for (const window of windows) {
          window.webContents.send(IPC_CHANNELS.snapshotUpdated, snapshot);
          if (programRegistry) {
            window.webContents.send(IPC_CHANNELS.programRegistryUpdated, programRegistry);
          }
        }
      }
    );
  });
}

function snapshotBroadcastMetricDetail(snapshot: WorkspaceSnapshot | null): Record<string, string | number | boolean> {
  return {
    active: Boolean(snapshot),
    runs: snapshot?.runs.length ?? 0,
    notifications: snapshot?.notifications.length ?? 0,
    workspace: Boolean(snapshot?.workspace)
  };
}

function programRegistryBroadcastMetricDetail(programRegistry: ProgramRegistryState): Record<string, string | number | boolean> {
  return {
    registryPrograms: programRegistry.programs.length,
    registrySessions: programRegistry.researchSessions.length
  };
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
  ipcMain.handle(IPC_CHANNELS.getProgramRegistry, () => timedMainIpc('getProgramRegistry', {}, () => workspaceService.getProgramRegistryState()));
  ipcMain.handle(IPC_CHANNELS.lookupHackerOneProgram, (_event, identifier: string) => workspaceService.lookupHackerOneProgram(identifier));
  ipcMain.handle(IPC_CHANNELS.createProgram, (event, input: ProgramOnboardingInput) =>
    workspaceService.createProgram(input, (update) => event.sender.send(IPC_CHANNELS.programOnboardingUpdated, update))
  );
  ipcMain.handle(IPC_CHANNELS.skipProgramOnboardingRepository, (_event, input: ProgramOnboardingSkipInput) => workspaceService.skipProgramOnboardingRepository(input));
  ipcMain.handle(IPC_CHANNELS.openProgram, (_event, programId: string) =>
    timedMainIpc('openProgram', { program: shortMetricId(programId) }, () => workspaceService.openProgram(programId))
  );
  ipcMain.handle(IPC_CHANNELS.removeProgram, (_event, programId: string) => workspaceService.removeProgram(programId));
  ipcMain.handle(IPC_CHANNELS.openWorkspace, (_event, path: string) => workspaceService.openWorkspace(path));
  ipcMain.handle(IPC_CHANNELS.createWorkspace, (_event, path: string) => workspaceService.createWorkspace(path));
  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => timedMainIpc('getSnapshot', {}, () => workspaceService.getSnapshot()));
  ipcMain.handle(IPC_CHANNELS.getHostEnvironment, () => getHostEnvironment());
  ipcMain.handle(IPC_CHANNELS.setVmPreference, (_event, input: VmPreferenceInput) => workspaceService.setVmPreference(input));
  ipcMain.handle(IPC_CHANNELS.getOpenAiStatus, () => workspaceService.getOpenAiStatus());
  ipcMain.handle(IPC_CHANNELS.startOpenAiOAuth, () => workspaceService.startOpenAiOAuth());
  ipcMain.handle(IPC_CHANNELS.refreshOpenAiStatus, () => workspaceService.refreshOpenAiStatus());
  ipcMain.handle(IPC_CHANNELS.getProfilingState, () => workspaceService.getProfilingState());
  ipcMain.handle(IPC_CHANNELS.setProfilingEnabled, (_event, enabled: boolean) => workspaceService.setProfilingEnabled(enabled));
  ipcMain.handle(IPC_CHANNELS.recordProfilingReport, (_event, report: ProfilingReport) => workspaceService.recordProfilingReport(report));
  ipcMain.handle(IPC_CHANNELS.setProjectSemanticIndexEnabled, (_event, enabled: boolean) =>
    timedMainIpc('setProjectSemanticIndexEnabled', { enabled }, () => workspaceService.setProjectSemanticIndexEnabled(enabled))
  );
  ipcMain.handle(IPC_CHANNELS.refreshProjectSemanticIndex, () => timedMainIpc('refreshProjectSemanticIndex', {}, () => workspaceService.refreshProjectSemanticIndex()));
  ipcMain.handle(IPC_CHANNELS.getProgramGraphVisualization, () =>
    timedMainIpc('getProgramGraphVisualization', {}, () => workspaceService.getProgramGraphVisualization())
  );
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
  ipcMain.handle(IPC_CHANNELS.searchSessionTranscripts, (_event, input: SessionTranscriptSearchInput) =>
    timedMainIpc('searchSessionTranscripts', { chars: input.query.length, limit: input.limit ?? 24, currentProgramOnly: input.currentProgramOnly !== false }, () =>
      workspaceService.searchSessionTranscripts(input)
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
  registerIpc();
  createWindow();
  setImmediate(() => {
    workspaceService.openLastProgramIfAvailable();
  });
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
