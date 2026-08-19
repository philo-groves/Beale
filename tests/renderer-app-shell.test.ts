import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HostEnvironment, RunDetail, WorkspaceSnapshot } from '@shared/types';
import { AppHeaderTitle, StaticAppHeaderTitle, type AppHeaderViewIcon } from '../src/renderer/app/AppHeaderTitle';
import { BottomPanel, DEFAULT_BOTTOM_PANEL_OPEN } from '../src/renderer/app/BottomPanel';
import { headerMenuInlineEnd, rightmostHeaderMenuControl, TopBar } from '../src/renderer/app/TopBar';
import {
  activeRunDetailForSelection,
  appShellClassName,
  selectedRunStatus,
  shouldShowHeaderResearchControls,
  workspaceHasLiveResearchRun,
  windowControlPlatformForState
} from '../src/renderer/view-models/appShell';

describe('renderer app shell view model', () => {
  it('matches header icons to workspace and sidenav destinations', () => {
    const workspaceHeader = renderToStaticMarkup(createElement(AppHeaderTitle, {
      workspaceName: 'Parser',
      workspaceViewTitle: 'Memory',
      detail: null,
      breakoutRoomTitle: null
    }));
    expect(workspaceHeader).toContain('lucide-folder');
    expect(workspaceHeader).toContain('aria-label="Parser, Memory"');
    expect(workspaceHeader).toContain('title="Memory"><span>Memory</span>');

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

  it('aligns header labels with content without crossing the menu controls', () => {
    expect(rightmostHeaderMenuControl(8, [42, 83, 128, 194])).toBe(194);
    expect(rightmostHeaderMenuControl(8, [])).toBe(8);
    expect(headerMenuInlineEnd(10.2, 201.1)).toBe(199);
    expect(headerMenuInlineEnd(220, 180)).toBe(0);

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('--main-content-inline-start: var(--sidebar-width)');
    expect(styles).toMatch(/\.app-shell\.sidebar-collapsed\s*\{\s*--main-content-inline-start: 0px;/u);
    expect(styles).toContain('left: max(calc(var(--main-content-inline-start) + 12px), var(--header-menu-inline-end));');
    expect(styles).toMatch(/@media \(max-width: 820px\)[\s\S]*?\.app-shell\s*\{\s*--main-content-inline-start: 0px;/u);
    expect(styles).not.toContain('left: 180px;');
  });

  it('shows the detected default workspace editor beside the right sidenav control', () => {
    const header = renderToStaticMarkup(createElement(TopBar, {
      sidebarCollapsed: false,
      rightSidenavAvailable: true,
      rightSidenavExpanded: false,
      contextualTitleVisible: false,
      staticContextTitle: null,
      platform: 'win32',
      workspaceName: 'Parser',
      workspaceViewTitle: null,
      activeRunDetail: null,
      activeBreakoutRoomTitle: null,
      profilingEnabled: false,
      bottomPanelOpen: true,
      workspaceEditors: {
        editors: [
          { id: 'vscode', name: 'Visual Studio Code', iconDataUrl: 'data:image/png;base64,dnNjb2Rl' },
          { id: 'cursor', name: 'Cursor', iconDataUrl: 'data:image/png;base64,Y3Vyc29y' }
        ],
        defaultEditorId: 'cursor'
      },
      onOpenProfiling: () => undefined,
      onToggleBottomPanel: () => undefined,
      onOpenWorkspaceInEditor: () => undefined,
      onAddWorkspace: () => undefined,
      onToggleRightSidenav: () => undefined,
      onToggleSidebar: () => undefined
    }));

    expect(header).toContain('editor-launch-available');
    expect(header).toContain('Open primary workspace directory in Cursor');
    expect(header).toContain('class="workspace-editor-icon"');
    expect(header).toContain('data:image/png;base64,Y3Vyc29y');
    expect(header.indexOf('workspace-editor-control')).toBeLessThan(header.indexOf('right-sidenav-toggle-button'));
    expect(header).toContain('aria-label="Hide bottom panel"');
    expect(header.indexOf('bottom-panel-toggle-button')).toBeLessThan(header.indexOf('right-sidenav-toggle-button'));
  });

  it('limits both header research controls to workspace and session views', () => {
    const base = {
      researchDetailsAvailable: true,
      settingsOpen: false,
      reportsOpen: false,
      automationsOpen: false,
      pluginsOpen: false
    };
    expect(shouldShowHeaderResearchControls(base)).toBe(true);
    expect(shouldShowHeaderResearchControls({ ...base, settingsOpen: true })).toBe(false);
    expect(shouldShowHeaderResearchControls({ ...base, reportsOpen: true })).toBe(false);
    expect(shouldShowHeaderResearchControls({ ...base, automationsOpen: true })).toBe(false);
    expect(shouldShowHeaderResearchControls({ ...base, pluginsOpen: true })).toBe(false);
    expect(shouldShowHeaderResearchControls({ ...base, researchDetailsAvailable: false })).toBe(false);

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toMatch(/\.workspace-editor-control\s*\{[^}]*margin: 0 16px 0 0;/u);
    expect(styles).toMatch(/\.window-control-button\.right-sidenav-toggle-button\s*\{[^}]*margin: 0;/u);
    expect(styles).toMatch(/\.top-bar\s*\{[^}]*--header-control-active-background: color-mix\(in srgb, var\(--text\) 4\.5%, transparent\);/u);
    expect(styles).toMatch(/\.workspace-editor-open-button,\s*\.workspace-editor-menu-button\s*\{[^}]*background: var\(--header-control-active-background\);/u);
    expect(styles).toMatch(
      /\.sidebar-toggle-button\[aria-pressed='true'\],\s*\.window-control-button\.bottom-panel-toggle-button\[aria-pressed='true'\],\s*\.window-control-button\.right-sidenav-toggle-button\[aria-pressed='true'\]\s*\{[^}]*background: var\(--header-control-active-background\);/u
    );
  });

  it('renders a separate fixed-height terminal panel below the workbench', () => {
    expect(DEFAULT_BOTTOM_PANEL_OPEN).toBe(false);
    const panel = renderToStaticMarkup(createElement(BottomPanel, {
      open: true,
      workspacePath: 'C:\\research\\parser',
      onClose: () => undefined
    }));
    expect(panel).toContain('aria-label="Bottom panel"');
    expect(panel).toContain('lucide-square-terminal');
    expect(panel).toContain('role="tab"');
    expect(panel).toContain('aria-selected="true"');
    expect(panel).toContain('<span>Terminal</span>');
    expect(panel).toContain('class="research-side-view-tab-close"');
    expect(panel).toContain('aria-label="Close Terminal"');
    expect(panel).toContain('lucide-x');
    expect(panel).toContain('class="bottom-panel-terminal"');

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('grid-template-rows: 38px minmax(0, 1fr) 8px 250px 8px;');
    expect(styles).toContain('grid-template-rows: 38px minmax(0, 1fr) 0 0 8px;');
    expect(styles).toMatch(/\.workbench\s*\{[^}]*margin: 0 8px 0 0;[^}]*padding: 0 12px;/u);
    expect(styles).toMatch(/\.bottom-panel\s*\{[^}]*grid-column: 2;[^}]*grid-row: 4;[^}]*height: 0;/u);
    expect(styles).toMatch(/\.bottom-panel\s*\{[^}]*margin: 0 8px 0 0;[^}]*padding: 0;/u);
    expect(styles).toMatch(/\.app-shell\.bottom-panel-open \.bottom-panel\s*\{[^}]*height: 250px;/u);
    expect(styles).toMatch(/\.bottom-panel-terminal\s*\{[^}]*padding-inline: 10px;/u);
    expect(styles).toMatch(/\.sidebar\s*\{[^}]*grid-row: 2 \/ 5;/u);
  });

  it('hides the bottom-panel toggle wherever the right-sidenav toggle is unavailable', () => {
    const header = renderToStaticMarkup(createElement(TopBar, {
      sidebarCollapsed: false,
      rightSidenavAvailable: false,
      rightSidenavExpanded: false,
      contextualTitleVisible: false,
      staticContextTitle: null,
      platform: 'win32',
      workspaceName: 'Parser',
      workspaceViewTitle: null,
      activeRunDetail: null,
      activeBreakoutRoomTitle: null,
      profilingEnabled: false,
      bottomPanelOpen: false,
      workspaceEditors: null,
      onOpenProfiling: () => undefined,
      onToggleBottomPanel: () => undefined,
      onOpenWorkspaceInEditor: () => undefined,
      onAddWorkspace: () => undefined,
      onToggleRightSidenav: () => undefined,
      onToggleSidebar: () => undefined
    }));
    expect(header).not.toContain('bottom-panel-toggle-button');
    expect(header).not.toContain('right-sidenav-toggle-button');
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
