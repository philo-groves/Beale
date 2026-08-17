import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HostEnvironment, RunDetail, WorkspaceSnapshot } from '@shared/types';
import { AppHeaderTitle, StaticAppHeaderTitle, type AppHeaderViewIcon } from '../src/renderer/app/AppHeaderTitle';
import {
  activeRunDetailForSelection,
  appShellClassName,
  selectedRunStatus,
  workspaceHasLiveResearchRun,
  windowControlPlatformForState
} from '../src/renderer/view-models/appShell';

describe('renderer app shell view model', () => {
  it('matches header icons to workspace and sidenav destinations', () => {
    const workspaceHeader = renderToStaticMarkup(createElement(AppHeaderTitle, {
      workspaceName: 'Parser',
      detail: null,
      breakoutRoomTitle: null
    }));
    expect(workspaceHeader).toContain('lucide-folder');

    const viewIcons: Array<[AppHeaderViewIcon, string]> = [
      ['settings', 'lucide-settings'],
      ['automations', 'lucide-calendar-clock'],
      ['reporting', 'lucide-file-text'],
      ['plugins', 'lucide-plug']
    ];
    for (const [icon, iconClass] of viewIcons) {
      const header = renderToStaticMarkup(createElement(StaticAppHeaderTitle, {
        primaryTitle: 'View',
        secondaryTitle: 'Detail',
        icon
      }));
      expect(header).toContain(iconClass);
    }
  });

  it('selects active run state and detail only when ids match', () => {
    const snapshot = workspaceSnapshot('run_active', 'active');
    const detail = runDetail('run_active');

    expect(selectedRunStatus(snapshot, 'run_active')).toBe('active');
    expect(selectedRunStatus(snapshot, 'run_missing')).toBeNull();
    expect(selectedRunStatus(null, 'run_active')).toBeNull();
    expect(activeRunDetailForSelection(detail, 'run_active')).toBe(detail);
    expect(activeRunDetailForSelection(detail, 'run_other')).toBeNull();
  });

  it('builds shell classes from heat, chrome, and pane state without animation state', () => {
    expect(
      appShellClassName({
        sessionHeat: 'high',
        sessionActive: true,
        platform: 'linux',
        windowChromeState: { isMaximized: true, isFullScreen: false },
        sidebarCollapsed: true
      })
    ).toBe('app-shell session-heat-high platform-linux session-active window-edge-flush sidebar-collapsed');

    expect(
      appShellClassName({
        sessionHeat: 'none',
        sessionActive: false,
        platform: 'darwin',
        windowChromeState: { isMaximized: false, isFullScreen: true },
        sidebarCollapsed: false
      })
    ).toBe('app-shell session-heat-none platform-darwin window-edge-flush window-full-screen');
  });

  it('keeps the window pulse active whenever the workspace has queued or active research', () => {
    expect(workspaceHasLiveResearchRun(workspaceSnapshot('run_active', 'active'))).toBe(true);
    expect(workspaceHasLiveResearchRun(workspaceSnapshot('run_queued', 'queued'))).toBe(true);
    expect(workspaceHasLiveResearchRun(workspaceSnapshot('run_paused', 'paused'))).toBe(false);
    expect(workspaceHasLiveResearchRun(workspaceSnapshot('run_completed', 'completed'))).toBe(false);
    expect(workspaceHasLiveResearchRun(null)).toBe(false);
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
