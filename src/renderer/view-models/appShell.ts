import type {
  HostEnvironment,
  ProgramRegistryState,
  RunDetail,
  RunStatus,
  VmPreference,
  WindowChromeState,
  WorkspaceSnapshot
} from '@shared/types';
import type { ResearchMomentumState } from '../features/momentum/types';
import type { SessionHeat } from './sessionHeat';

export const DEFAULT_VM_PREFERENCE: VmPreference = {
  enabled: false,
  backendKind: null,
  updatedAt: null
};

export function selectedRunStatus(snapshot: WorkspaceSnapshot | null, selectedRunId: string | null): RunStatus | null {
  if (!snapshot || !selectedRunId) return null;
  return snapshot.runs.find((row) => row.run.id === selectedRunId)?.run.status ?? null;
}

export function activeRunDetailForSelection(runDetail: RunDetail | null, selectedRunId: string | null): RunDetail | null {
  if (!runDetail || runDetail.run.id !== selectedRunId) return null;
  return runDetail;
}

export function appShellClassName(input: {
  sessionHeat: SessionHeat;
  momentumState: ResearchMomentumState;
  sessionActive: boolean;
  platform: HostEnvironment['platform'];
  windowChromeState: WindowChromeState;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
}): string {
  return [
    'app-shell',
    `session-heat-${input.sessionHeat}`,
    `momentum-${input.momentumState}`,
    `platform-${input.platform}`,
    input.sessionActive ? 'session-active' : '',
    input.windowChromeState.isMaximized || input.windowChromeState.isFullScreen ? 'window-edge-flush' : '',
    input.sidebarCollapsed ? 'sidebar-collapsed' : '',
    input.inspectorOpen ? 'inspector-open' : ''
  ]
    .filter(Boolean)
    .join(' ');
}

export function vmPreferenceForState(programRegistry: ProgramRegistryState | null, snapshot: WorkspaceSnapshot | null): VmPreference {
  return programRegistry?.vmPreference ?? snapshot?.vmPreference ?? DEFAULT_VM_PREFERENCE;
}

export function windowControlPlatformForState(
  snapshot: WorkspaceSnapshot | null,
  hostEnvironment: HostEnvironment | null
): HostEnvironment['platform'] {
  return (snapshot?.workspace.hostEnvironment ?? hostEnvironment)?.platform ?? 'linux';
}
