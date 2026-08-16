import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HostEnvironment, RunDetail } from '@shared/types';
import { StatusBar } from '../src/renderer/app/StatusBar';
import { TopBar } from '../src/renderer/app/TopBar';

describe('renderer top bar', () => {
  it('uses equal top and bottom padding for header menu and title buttons', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const menuButtonStyles = styles.match(/\.window-menu button\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceTitleStyles = styles.match(/\.app-header-workspace-title\s*\{([^}]*)\}/)?.[1] ?? '';
    const sessionTitleStyles = styles.match(/\.app-header-session-title,\s*\.app-header-breakout-room-title\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(menuButtonStyles).toContain('padding: 1px 8px');
    expect(workspaceTitleStyles).toContain('padding: 1px 6px');
    expect(sessionTitleStyles).toContain('padding: 1px 6px');
  });

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
    expect(html).not.toMatch(/>Edit<\/button>/);
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
    expect(collapsed).toMatch(/<svg[^>]*width="14"[^>]*height="14"[^>]*class="[^"]*lucide-panel-left-close/);
    expect(collapsed).toMatch(/<svg[^>]*width="14"[^>]*height="14"[^>]*class="[^"]*lucide-panel-right-open/);
  });

  it('hides workspace and session identity while the contextual title is disabled', () => {
    const html = renderTopBar('win32', false, false, false);

    expect(html).not.toContain('class="app-header-title"');
    expect(html).not.toContain('Security');
  });

  it('renders an unclickable static identity for the active Agent Settings view', () => {
    const html = renderTopBar('win32', false, false, false, { primary: 'Agent Settings', secondary: 'Memory' });

    expect(html).toContain('aria-label="Agent Settings, Memory"');
    expect(html).toContain('<span class="app-header-workspace-title app-header-static-title"><span>Agent Settings</span></span>');
    expect(html).toContain('<span class="app-header-divider" aria-hidden="true"></span>');
    expect(html).toContain('<span class="app-header-session-title app-header-static-title"><span>Memory</span></span>');
    expect(html).not.toContain('title="Open workspace information"');
    expect(html).not.toContain('title="View session summary"');
  });

  it('separates workspace, session, and breakout room names in the main header', () => {
    const detail = {
      run: {
        id: 'run_header',
        title: 'Primary session',
        promptMarkdown: ''
      }
    } as unknown as RunDetail;
    const html = renderToStaticMarkup(createElement(TopBar, {
      sidebarCollapsed: false,
      platform: 'win32',
      workspaceName: 'Security',
      activeWorkspace: null,
      activeRunDetail: detail,
      activeBreakoutRoomTitle: 'parser review',
      rightSidenavAvailable: false,
      rightSidenavExpanded: false,
      contextualTitleVisible: true,
      staticContextTitle: null,
      profilingEnabled: false,
      onOpenSessionSummary: () => undefined,
      onOpenWorkspaceInfo: () => undefined,
      onOpenProfiling: () => undefined,
      onAddWorkspace: () => undefined,
      onToggleRightSidenav: () => undefined,
      onToggleSidebar: () => undefined
    }));

    expect(html).toContain('aria-label="Security, Primary session, Parser Review"');
    expect(html.match(/app-header-divider/g)?.length).toBe(2);
    expect(html).toContain('<span class="app-header-breakout-room-title app-header-static-title" title="Parser Review"><span>Parser Review</span></span>');
  });

  it('labels the lower-left settings action as Agent Settings', () => {
    const html = renderToStaticMarkup(createElement(StatusBar, { onOpenSettings: () => undefined }));
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const settingsButtonStyles = styles.match(/\.status-settings-button\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(html).toContain('aria-label="Agent Settings"');
    expect(html).toContain('<span>Agent Settings</span>');
    expect(settingsButtonStyles).toContain('width: calc(100% + 8px)');
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
    activeBreakoutRoomTitle: null,
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
