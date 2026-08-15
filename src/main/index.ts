import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell } from 'electron';
import type { IpcMainInvokeEvent, Rectangle } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  HoneycrispMemoryDirectorySummary,
  HoneycrispToolingConfigUpdate,
  NativeMenuAction,
  ProfilingReport,
  WorkspaceRegistryState,
  WorkspaceOnboardingInput,
  WorkspaceOnboardingSkipInput,
  WorkspaceScopeDraft,
  ResearchGoalSuggestionInput,
  ResearchPromptGenerationInput,
  ResearchProviderId,
  ResearchModelProviderId,
  ProviderModelDefaults,
  ProviderAuthenticationMethod,
  RunDetailUpdateCursor,
  SessionTranscriptSearchInput,
  MemoryTypeDescriptions,
  ShellOptions,
  StartRunInput,
  SteeringAction,
  WorkspaceSnapshot,
  WorkspacePickerMode
} from '@shared/types';
import { getHostEnvironment, WorkspaceService, type WorkspaceChange } from './workspaceService';
import { nativeMacApplicationMenuTemplate } from './nativeApplicationMenu';
import { ProviderCredentialStore } from './providerCredentialStore';
import { restoreAndFocusWindow } from './windowLifecycle';

const APP_NAME = 'Beale';
let mainWindow: BrowserWindow | null = null;
let workspaceService: WorkspaceService;
const smokeTestMode = process.argv.includes('--smoke-test');
const NATIVE_WINDOW_SHAPE_RADIUS_PX = 8;

// Keep the established storage location stable while correcting the displayed app identity.
app.setPath('userData', join(app.getPath('appData'), 'beale'));
app.setName(APP_NAME);
process.title = APP_NAME;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const needsNativeWindowShape = process.platform === 'linux';
  const supportsNativeRoundedCorners = process.platform === 'darwin' || process.platform === 'win32';
  const appIcon = createAppIcon();
  if (appIcon && isMac && app.dock) {
    app.dock.setIcon(appIcon);
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    show: !needsNativeWindowShape,
    title: APP_NAME,
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
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.setBackgroundColor('#00000000');
  window.setMenuBarVisibility(false);
  registerRoundedWindowShape(window, needsNativeWindowShape);
  registerRoundedWindowStartupShow(window, needsNativeWindowShape);
  registerWindowChromeStateEvents(window);
  registerRendererDevToolsControls(window);

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  installApplicationMenu();
}

function reopenMainWindow(): void {
  const existingWindow = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
  if (restoreAndFocusWindow(existingWindow)) {
    mainWindow = existingWindow;
    return;
  }
  if (app.isReady()) {
    createWindow();
  }
}

function installApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const window = nativeMenuWindow();
  const zoomPercent = window && !window.isDestroyed()
    ? Math.round(window.webContents.getZoomFactor() * 100)
    : 100;
  Menu.setApplicationMenu(Menu.buildFromTemplate(nativeMacApplicationMenuTemplate(zoomPercent, {
    dispatchRendererAction: sendNativeMenuAction,
    zoomOut: () => adjustNativeZoom(-1),
    zoomIn: () => adjustNativeZoom(1),
    minimizeWindow: () => nativeMenuWindow()?.minimize(),
    maximizeWindow: toggleNativeWindowMaximize,
    closeWindow: () => nativeMenuWindow()?.close()
  })));
}

function nativeMenuWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? mainWindow;
}

function sendNativeMenuAction(action: NativeMenuAction): void {
  const window = nativeMenuWindow();
  if (!window || window.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.nativeMenuAction, action);
}

function adjustNativeZoom(delta: -1 | 1): void {
  const window = nativeMenuWindow();
  if (!window || window.isDestroyed()) return;
  const nextLevel = Math.max(-4, Math.min(6, window.webContents.getZoomLevel() + delta));
  window.webContents.setZoomLevel(nextLevel);
  installApplicationMenu();
}

function toggleNativeWindowMaximize(): void {
  const window = nativeMenuWindow();
  if (!window || window.isDestroyed()) return;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
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

function broadcastSnapshot(change: WorkspaceChange = { workspaceRegistryChanged: true }): void {
  timedMainIpc('broadcastSnapshot.total', { registry: change.workspaceRegistryChanged }, () => {
    const snapshot = timedMainIpc('broadcastSnapshot.getSnapshot', {}, () => workspaceService.getSnapshot());
    const workspaceRegistry = change.workspaceRegistryChanged
      ? timedMainIpc('broadcastSnapshot.getWorkspaceRegistry', snapshotBroadcastMetricDetail(snapshot), () => workspaceService.getCachedWorkspaceRegistryState())
      : null;
    const windows = BrowserWindow.getAllWindows();
    timedMainIpc(
      'broadcastSnapshot.sendAll',
      {
        ...snapshotBroadcastMetricDetail(snapshot),
        ...(workspaceRegistry ? workspaceRegistryBroadcastMetricDetail(workspaceRegistry) : { registryWorkspaces: 0, registrySessions: 0 }),
        registry: Boolean(workspaceRegistry),
        windows: windows.length
      },
      () => {
        for (const window of windows) {
          window.webContents.send(IPC_CHANNELS.snapshotUpdated, snapshot);
          if (workspaceRegistry) {
            window.webContents.send(IPC_CHANNELS.workspaceRegistryUpdated, workspaceRegistry);
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

function workspaceRegistryBroadcastMetricDetail(workspaceRegistry: WorkspaceRegistryState): Record<string, string | number | boolean> {
  return {
    registryWorkspaces: workspaceRegistry.workspaces.length,
    registrySessions: workspaceRegistry.researchSessions.length
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

  ipcMain.handle(IPC_CHANNELS.selectWorkspaceDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add Beale workspace',
      properties: ['openDirectory', 'createDirectory']
    });
    const path = result.filePaths[0] ?? null;
    return result.canceled || !path
      ? {
          canceled: true,
          path: null,
          knownWorkspace: null,
          requiresOnboarding: false,
          defaults: null
        }
      : workspaceService.inspectWorkspaceDirectory(path);
  });
  ipcMain.handle(IPC_CHANNELS.getWorkspaceRegistry, () => timedMainIpc('getWorkspaceRegistry', {}, () => workspaceService.getWorkspaceRegistryState()));
  ipcMain.handle(IPC_CHANNELS.getDeveloperSettings, () => workspaceService.getDeveloperSettings());
  ipcMain.handle(IPC_CHANNELS.setDeveloperModeEnabled, (_event, enabled: boolean) => workspaceService.setDeveloperModeEnabled(enabled));
  ipcMain.handle(IPC_CHANNELS.getProviderSettings, () => workspaceService.getProviderSettings());
  ipcMain.handle(IPC_CHANNELS.setDefaultProviderId, (_event, providerId: ResearchModelProviderId | null) => workspaceService.setDefaultProviderId(providerId));
  ipcMain.handle(IPC_CHANNELS.setProviderModelDefaults, (_event, providerId: ResearchModelProviderId, defaults: ProviderModelDefaults) =>
    workspaceService.setProviderModelDefaults(providerId, defaults)
  );
  ipcMain.handle(IPC_CHANNELS.setProviderOptionalModelEnabled, (
    _event,
    providerId: ResearchModelProviderId,
    modelId: string,
    enabled: boolean
  ) => workspaceService.setProviderOptionalModelEnabled(providerId, modelId, enabled));
  ipcMain.handle(IPC_CHANNELS.setProviderCyberPolicyRiskAcknowledged, (
    _event,
    providerId: ResearchModelProviderId,
    acknowledged: boolean
  ) =>
    workspaceService.setProviderCyberPolicyRiskAcknowledged(providerId, acknowledged)
  );
  ipcMain.handle(IPC_CHANNELS.setProviderPreferredAuthenticationMethod, (
    _event,
    providerId: ResearchModelProviderId,
    method: ProviderAuthenticationMethod
  ) => workspaceService.setProviderPreferredAuthenticationMethod(providerId, method));
  ipcMain.handle(IPC_CHANNELS.getResearchProfiles, () => workspaceService.getResearchProfiles());
  ipcMain.handle(IPC_CHANNELS.getAgentPlugins, () => workspaceService.getAgentPlugins());
  ipcMain.handle(IPC_CHANNELS.addAgentPluginFromFilesystem, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add Agent Plugin',
      properties: ['openDirectory']
    });
    const path = result.filePaths[0] ?? null;
    return result.canceled || !path
      ? workspaceService.getAgentPlugins()
      : workspaceService.addAgentPluginFromFilesystem(path);
  });
  ipcMain.handle(IPC_CHANNELS.addAgentPluginFromRepository, (_event, repositoryUrl: string) =>
    workspaceService.addAgentPluginFromRepository(repositoryUrl)
  );
  ipcMain.handle(IPC_CHANNELS.setAgentPluginEnabled, (_event, pluginId: string, enabled: boolean) =>
    workspaceService.setAgentPluginEnabled(pluginId, enabled)
  );
  ipcMain.handle(IPC_CHANNELS.removeAgentPlugin, (_event, pluginId: string) => workspaceService.removeAgentPlugin(pluginId));
  ipcMain.handle(IPC_CHANNELS.getMemorySettings, () => workspaceService.getMemorySettings());
  ipcMain.handle(IPC_CHANNELS.setMemoryTypeDescriptions, (_event, descriptions: MemoryTypeDescriptions) => workspaceService.setMemoryTypeDescriptions(descriptions));
  ipcMain.handle(IPC_CHANNELS.getShellOptions, () => workspaceService.getShellOptions());
  ipcMain.handle(IPC_CHANNELS.setShellOptions, (_event, options: ShellOptions) => workspaceService.setShellOptions(options));
  ipcMain.handle(IPC_CHANNELS.lookupHackerOneScope, (_event, identifier: string) => workspaceService.lookupHackerOneScope(identifier));
  ipcMain.handle(IPC_CHANNELS.listGitHubOrganizationRepositories, (_event, organization: string) =>
    workspaceService.listGitHubOrganizationRepositories(organization)
  );
  ipcMain.handle(IPC_CHANNELS.createScopedWorkspace, (event, input: WorkspaceOnboardingInput) =>
    workspaceService.createScopedWorkspace(input, (update) => event.sender.send(IPC_CHANNELS.workspaceOnboardingUpdated, update))
  );
  ipcMain.handle(IPC_CHANNELS.skipWorkspaceOnboardingRepository, (_event, input: WorkspaceOnboardingSkipInput) => workspaceService.skipWorkspaceOnboardingRepository(input));
  ipcMain.handle(IPC_CHANNELS.openRegisteredWorkspace, (_event, registryWorkspaceId: string) =>
    timedMainIpc('openRegisteredWorkspace', { workspace: shortMetricId(registryWorkspaceId) }, () => workspaceService.openRegisteredWorkspace(registryWorkspaceId))
  );
  ipcMain.handle(IPC_CHANNELS.removeRegisteredWorkspace, (_event, registryWorkspaceId: string) => workspaceService.removeRegisteredWorkspace(registryWorkspaceId));
  ipcMain.handle(IPC_CHANNELS.openWorkspace, (_event, path: string) => workspaceService.openWorkspace(path));
  ipcMain.handle(IPC_CHANNELS.createWorkspace, (_event, path: string) => workspaceService.createWorkspace(path));
  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => timedMainIpc('getSnapshot', {}, () => workspaceService.getSnapshot()));
  ipcMain.handle(IPC_CHANNELS.getHostEnvironment, () => getHostEnvironment());
  ipcMain.handle(IPC_CHANNELS.getOpenAiStatus, () => workspaceService.getOpenAiStatus());
  ipcMain.handle(IPC_CHANNELS.startOpenAiOAuth, () => workspaceService.startOpenAiOAuth());
  ipcMain.handle(IPC_CHANNELS.forgetProviderSubscription, (_event, providerId: ResearchModelProviderId) =>
    workspaceService.forgetProviderSubscription(providerId));
  ipcMain.handle(IPC_CHANNELS.removeProvider, (_event, providerId: ResearchModelProviderId) =>
    workspaceService.removeProvider(providerId));
  ipcMain.handle(IPC_CHANNELS.configureProviderApiKey, (_event, providerId: ResearchModelProviderId, apiKey: string) =>
    workspaceService.configureProviderApiKey(providerId, apiKey));
  ipcMain.handle(IPC_CHANNELS.removeProviderApiKey, (_event, providerId: ResearchModelProviderId) =>
    workspaceService.removeProviderApiKey(providerId));
  ipcMain.handle(IPC_CHANNELS.refreshOpenAiStatus, () => workspaceService.refreshOpenAiStatus());
  ipcMain.handle(IPC_CHANNELS.getResearchProviderStatuses, () => workspaceService.getResearchProviderStatuses());
  ipcMain.handle(IPC_CHANNELS.getResearchProviderModelCatalog, () => workspaceService.getResearchProviderModelCatalog());
  ipcMain.handle(IPC_CHANNELS.startResearchProviderOAuth, async (_event, providerId: ResearchProviderId) => {
    const result = await workspaceService.startResearchProviderOAuth(providerId);
    if (result.verificationUri) {
      const url = new URL(result.verificationUri);
      if (url.protocol !== 'https:') throw new Error('Provider authentication returned an untrusted URL.');
      await shell.openExternal(url.href);
    }
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.getProfilingState, () => workspaceService.getProfilingState());
  ipcMain.handle(IPC_CHANNELS.setProfilingEnabled, (_event, enabled: boolean) => workspaceService.setProfilingEnabled(enabled));
  ipcMain.handle(IPC_CHANNELS.recordProfilingReport, (_event, report: ProfilingReport) => workspaceService.recordProfilingReport(report));
  ipcMain.handle(IPC_CHANNELS.openHoneycrispMemoryDirectory, (_event, name: HoneycrispMemoryDirectorySummary['name']) =>
    timedMainIpcAsync('openHoneycrispMemoryDirectory', { directory: String(name) }, async () => {
      const path = workspaceService.resolveHoneycrispMemoryDirectoryPath(name);
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    })
  );
  ipcMain.handle(IPC_CHANNELS.getHoneycrispRunbook, (_event, runbookId: string) =>
    timedMainIpc('getHoneycrispRunbook', { runbook: shortMetricId(runbookId) }, () =>
      workspaceService.getHoneycrispRunbook(runbookId)
    )
  );
  ipcMain.handle(IPC_CHANNELS.getHoneycrispReport, (_event, reportId: string) =>
    timedMainIpc('getHoneycrispReport', { report: shortMetricId(reportId) }, () =>
      workspaceService.getHoneycrispReport(reportId)
    )
  );
  ipcMain.handle(IPC_CHANNELS.runWorkspaceDejunk, () =>
    timedMainIpc('runWorkspaceDejunk', {}, () => workspaceService.runWorkspaceDejunk())
  );
  ipcMain.handle(IPC_CHANNELS.runMemoryDreaming, (event) =>
    timedMainIpcAsync('runMemoryDreaming', {}, () => workspaceService.runMemoryDreaming((update) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.memoryDreamingUpdated, update);
    }))
  );
  ipcMain.handle(IPC_CHANNELS.restoreMemoryDreamingChange, (_event, changeId: string) =>
    timedMainIpc('restoreMemoryDreamingChange', { change: shortMetricId(changeId) }, () =>
      workspaceService.restoreMemoryDreamingChange(changeId)
    )
  );
  ipcMain.handle(IPC_CHANNELS.getHoneycrispToolingSummary, () =>
    timedMainIpc('getHoneycrispToolingSummary', {}, () => workspaceService.getHoneycrispToolingSummary())
  );
  ipcMain.handle(IPC_CHANNELS.updateHoneycrispToolingConfig, (_event, update: HoneycrispToolingConfigUpdate) =>
    timedMainIpc('updateHoneycrispToolingConfig', { type: update.type }, () => workspaceService.updateHoneycrispToolingConfig(update))
  );
  ipcMain.handle(IPC_CHANNELS.generateResearchGoalSuggestions, (_event, input: ResearchGoalSuggestionInput) =>
    timedMainIpcAsync('generateResearchGoalSuggestions', {}, () => workspaceService.generateResearchGoalSuggestions(input))
  );
  ipcMain.handle(IPC_CHANNELS.generateResearchPrompt, (event, input?: ResearchPromptGenerationInput) =>
    timedMainIpcAsync('generateResearchPrompt', { hasInput: Boolean(input) }, () =>
      workspaceService.generateResearchPrompt(input, (update) => event.sender.send(IPC_CHANNELS.researchPromptGenerationUpdated, update))
    )
  );
  ipcMain.handle(IPC_CHANNELS.cancelResearchPromptGeneration, (_event, requestId: string) => workspaceService.cancelResearchPromptGeneration(requestId));
  ipcMain.handle(IPC_CHANNELS.saveScope, (_event, scope: WorkspaceScopeDraft) => workspaceService.saveScope(scope));
  ipcMain.handle(IPC_CHANNELS.startRun, (_event, input: StartRunInput) =>
    timedMainIpcAsync('startRun', { engine: input.runEngine, mode: input.mode }, () =>
      workspaceService.startRunWithSourcePreparation(input)
    )
  );
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
    timedMainIpc('searchSessionTranscripts', { chars: input.query.length, limit: input.limit ?? 24, currentWorkspaceOnly: input.currentWorkspaceOnly !== false }, () =>
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

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', reopenMainWindow);

  app.whenReady().then(() => {
    const providerCredentialStore = new ProviderCredentialStore(
      join(app.getPath('userData'), 'provider-credentials.json'),
      {
        available: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value)
      }
    );
    workspaceService = new WorkspaceService(broadcastSnapshot, { providerCredentialStore });
    registerIpc();
    createWindow();
    setImmediate(() => {
      workspaceService.openLastWorkspaceIfAvailable();
    });
    if (smokeTestMode) {
      setTimeout(() => app.quit(), 1500);
    }

    app.on('activate', reopenMainWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    workspaceService?.dispose();
  });
}
