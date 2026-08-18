import { isLiveResearchRunStatus } from '../../shared/types';
import type {
  HostEnvironment,
  RunDetail,
  RunStatus,
  WindowChromeState,
  WorkspaceSnapshot
} from '@shared/types';
import type { SessionHeat } from './sessionHeat';

export function selectedRunStatus(snapshot: WorkspaceSnapshot | null, selectedRunId: string | null): RunStatus | null {
  if (!snapshot || !selectedRunId) return null;
  return snapshot.runs.find((row) => row.run.id === selectedRunId)?.run.status ?? null;
}

export function activeRunDetailForSelection(runDetail: RunDetail | null, selectedRunId: string | null): RunDetail | null {
  if (!runDetail || runDetail.run.id !== selectedRunId) return null;
  return runDetail;
}

export function workspaceHasLiveResearchRun(snapshot: WorkspaceSnapshot | null): boolean {
  return snapshot?.runs.some(({ run }) => isLiveResearchRunStatus(run.status)) ?? false;
}

export function shouldShowHeaderResearchControls(input: {
  researchDetailsAvailable: boolean;
  settingsOpen: boolean;
  reportsOpen: boolean;
  automationsOpen: boolean;
  pluginsOpen: boolean;
}): boolean {
  return input.researchDetailsAvailable
    && !input.settingsOpen
    && !input.reportsOpen
    && !input.automationsOpen
    && !input.pluginsOpen;
}

export function appShellClassName(input: {
  sessionHeat: SessionHeat;
  sessionActive: boolean;
  platform: HostEnvironment['platform'];
  windowChromeState: WindowChromeState;
  sidebarCollapsed: boolean;
}): string {
  return [
    'app-shell',
    `session-heat-${input.sessionHeat}`,
    `platform-${input.platform}`,
    input.sessionActive ? 'session-active' : '',
    input.windowChromeState.isMaximized || input.windowChromeState.isFullScreen ? 'window-edge-flush' : '',
    input.windowChromeState.isFullScreen ? 'window-full-screen' : '',
    input.sidebarCollapsed ? 'sidebar-collapsed' : ''
  ]
    .filter(Boolean)
    .join(' ');
}

export function windowControlPlatformForState(
  snapshot: WorkspaceSnapshot | null,
  hostEnvironment: HostEnvironment | null
): HostEnvironment['platform'] {
  return (snapshot?.workspace.hostEnvironment ?? hostEnvironment)?.platform ?? 'linux';
}
