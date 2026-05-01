import { describe, expect, it } from 'vitest';
import type { HostEnvironment, ProgramRegistryState, RunDetail, VmPreference, WorkspaceSnapshot } from '@shared/types';
import {
  activeRunDetailForSelection,
  appShellClassName,
  DEFAULT_VM_PREFERENCE,
  selectedRunStatus,
  vmPreferenceForState,
  windowControlPlatformForState
} from '../src/renderer/view-models/appShell';

describe('renderer app shell view model', () => {
  it('selects active run state and detail only when ids match', () => {
    const snapshot = workspaceSnapshot('run_active', 'active');
    const detail = runDetail('run_active');

    expect(selectedRunStatus(snapshot, 'run_active')).toBe('active');
    expect(selectedRunStatus(snapshot, 'run_missing')).toBeNull();
    expect(selectedRunStatus(null, 'run_active')).toBeNull();
    expect(activeRunDetailForSelection(detail, 'run_active')).toBe(detail);
    expect(activeRunDetailForSelection(detail, 'run_other')).toBeNull();
  });

  it('builds shell classes from heat, momentum, chrome, and pane state', () => {
    expect(
      appShellClassName({
        sessionHeat: 'high',
        momentumState: 'verifying',
        sessionActive: true,
        platform: 'linux',
        windowChromeState: { isMaximized: true, isFullScreen: false },
        sidebarCollapsed: true,
        inspectorOpen: true
      })
    ).toBe('app-shell session-heat-high momentum-verifying platform-linux session-active window-edge-flush sidebar-collapsed inspector-open');
  });

  it('resolves VM preference and window control platform fallbacks', () => {
    const snapshotPreference: VmPreference = { enabled: true, backendKind: 'firecracker', updatedAt: '2026-04-30T00:00:00.000Z' };
    const registryPreference: VmPreference = { enabled: false, backendKind: 'tart', updatedAt: '2026-04-30T00:01:00.000Z' };
    const snapshot = workspaceSnapshot('run_test', 'completed', snapshotPreference, 'win32');
    const registry = { vmPreference: registryPreference } as unknown as ProgramRegistryState;
    const host = { platform: 'darwin' } as HostEnvironment;

    expect(vmPreferenceForState(registry, snapshot)).toBe(registryPreference);
    expect(vmPreferenceForState(null, snapshot)).toBe(snapshotPreference);
    expect(vmPreferenceForState(null, null)).toEqual(DEFAULT_VM_PREFERENCE);
    expect(windowControlPlatformForState(snapshot, host)).toBe('win32');
    expect(windowControlPlatformForState(null, host)).toBe('darwin');
    expect(windowControlPlatformForState(null, null)).toBe('linux');
  });
});

function workspaceSnapshot(
  runId: string,
  status: string,
  vmPreference: VmPreference = DEFAULT_VM_PREFERENCE,
  platform: HostEnvironment['platform'] = 'linux'
): WorkspaceSnapshot {
  return {
    workspace: {
      hostEnvironment: { platform }
    },
    runs: [{ run: { id: runId, status } }],
    vmPreference
  } as unknown as WorkspaceSnapshot;
}

function runDetail(runId: string): RunDetail {
  return {
    run: { id: runId }
  } as unknown as RunDetail;
}
