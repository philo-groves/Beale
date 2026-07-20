import { describe, expect, it } from 'vitest';
import type { HostEnvironment, RunDetail, WorkspaceSnapshot } from '@shared/types';
import {
  activeRunDetailForSelection,
  appShellClassName,
  selectedRunStatus,
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
        sidebarCollapsed: true
      })
    ).toBe('app-shell session-heat-high momentum-verifying platform-linux session-active window-edge-flush sidebar-collapsed');
  });

  it('resolves window control platform fallbacks', () => {
    const snapshot = workspaceSnapshot('run_test', 'completed', 'win32');
    const host = { platform: 'darwin' } as HostEnvironment;

    expect(windowControlPlatformForState(snapshot, host)).toBe('win32');
    expect(windowControlPlatformForState(null, host)).toBe('darwin');
    expect(windowControlPlatformForState(null, null)).toBe('linux');
  });
});

function workspaceSnapshot(
  runId: string,
  status: string,
  platform: HostEnvironment['platform'] = 'linux'
): WorkspaceSnapshot {
  return {
    workspace: {
      hostEnvironment: { platform }
    },
    runs: [{ run: { id: runId, status } }]
  } as unknown as WorkspaceSnapshot;
}

function runDetail(runId: string): RunDetail {
  return {
    run: { id: runId }
  } as unknown as RunDetail;
}
