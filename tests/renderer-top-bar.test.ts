import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HostEnvironment } from '@shared/types';
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
});

function renderTopBar(platform: HostEnvironment['platform']): string {
  return renderToStaticMarkup(createElement(TopBar, {
    sidebarCollapsed: false,
    platform,
    workspaceName: 'Security',
    activeWorkspace: null,
    activeRunDetail: null,
    profilingEnabled: false,
    onOpenSessionSummary: () => undefined,
    onOpenWorkspaceInfo: () => undefined,
    onOpenProfiling: () => undefined,
    onAddWorkspace: () => undefined,
    onToggleSidebar: () => undefined
  }));
}
