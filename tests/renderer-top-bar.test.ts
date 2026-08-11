import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HostEnvironment } from '@shared/types';
import { StatusBar } from '../src/renderer/app/StatusBar';
import { TopBar } from '../src/renderer/app/TopBar';

describe('renderer top bar', () => {
  it('keeps only the sidebar control in the macOS window header', () => {
    const html = renderTopBar('darwin');

    expect(html).toContain('aria-label="Sidebar controls"');
    expect(html).toContain('aria-label="Hide sidebar"');
    expect(html).not.toMatch(/>File<\/button>|>Edit<\/button>|>View<\/button>|>Window<\/button>/);
  });

  it('retains the in-window application menus on non-macOS platforms', () => {
    const html = renderTopBar('win32');

    expect(html).toContain('aria-label="Application menu"');
    expect(html).toMatch(/>File<\/button>/);
    expect(html).toMatch(/>Edit<\/button>/);
    expect(html).toMatch(/>View<\/button>/);
    expect(html).toMatch(/>Window<\/button>/);
  });

  it('reflects the right sidenav expansion state in the session header toggle', () => {
    const collapsed = renderTopBar('darwin', true, false);
    const expanded = renderTopBar('darwin', true, true);

    expect(collapsed).toContain('aria-label="Show detailed sidebar"');
    expect(collapsed).toContain('aria-pressed="false"');
    expect(collapsed).toContain('lucide-panel-right-open');
    expect(expanded).toContain('aria-label="Show summary sidebar"');
    expect(expanded).toContain('aria-pressed="true"');
    expect(expanded).toContain('lucide-panel-right-close');
  });

  it('hides workspace and session identity while the contextual title is disabled', () => {
    const html = renderTopBar('win32', false, false, false);

    expect(html).not.toContain('class="app-header-title"');
    expect(html).not.toContain('Security');
  });

  it('renders an unclickable static identity for the active Agent Settings view', () => {
    const html = renderTopBar('win32', false, false, false, { primary: 'Agent Settings', secondary: 'Shell Options' });

    expect(html).toContain('aria-label="Agent Settings, Shell Options"');
    expect(html).toContain('<span class="app-header-workspace-title app-header-static-title"><span>Agent Settings</span></span>');
    expect(html).toContain('<span class="app-header-session-title app-header-static-title"><span>Shell Options</span></span>');
    expect(html).not.toContain('title="Open workspace information"');
    expect(html).not.toContain('title="View session summary"');
  });

  it('labels the lower-left settings action as Agent Settings', () => {
    const html = renderToStaticMarkup(createElement(StatusBar, { onOpenSettings: () => undefined }));

    expect(html).toContain('aria-label="Agent Settings"');
    expect(html).toContain('<span>Agent Settings</span>');
  });
});

function renderTopBar(
  platform: HostEnvironment['platform'],
  rightSidenavAvailable = false,
  rightSidenavExpanded = false,
  contextualTitleVisible = true,
  staticContextTitle: { primary: string; secondary: string } | null = null
): string {
  return renderToStaticMarkup(createElement(TopBar, {
    sidebarCollapsed: false,
    platform,
    workspaceName: 'Security',
    activeWorkspace: null,
    activeRunDetail: null,
    rightSidenavAvailable,
    rightSidenavExpanded,
    contextualTitleVisible,
    staticContextTitle,
    profilingEnabled: false,
    onOpenSessionSummary: () => undefined,
    onOpenWorkspaceInfo: () => undefined,
    onOpenProfiling: () => undefined,
    onAddWorkspace: () => undefined,
    onToggleRightSidenav: () => undefined,
    onToggleSidebar: () => undefined
  }));
}
