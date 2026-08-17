import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRegistryEntry, WorkspaceRegistryState, ResearchSessionSummary, WorkspaceSnapshot } from '@shared/types';
import { WorkspaceSidebar } from '../src/renderer/features/workspaces/WorkspaceSidebar';
import { mainSideScrollHasOverflow } from '../src/renderer/app/MainSideScrollRegion';
import { INSET_SCROLLBAR_SELECTOR } from '../src/renderer/hooks/useInsetScrollbarActivation';
import {
  workspaceById,
  workspaceExists,
  promptSessionTitle,
  researchSessionsForWorkspace,
  shortRelativeAge
} from '../src/renderer/view-models/workspaceDisplay';
import { testResearchProfile } from './researchProfileFixture';

describe('renderer workspace display view models', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the session-list expansion text palette for every breakout-room state', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const roomStyles = styles.match(/\.workspace-breakout-room-item\s*\{([^}]*)\}/u)?.[1] ?? '';
    const sessionToggleStyles = styles.match(/\.session-memory-type-toggle\s*\{([^}]*)\}/u)?.[1] ?? '';
    const sessionToggleHoverStyles = styles.match(/\.session-memory-type-toggle:hover:not\(:disabled\),\s*\.session-memory-type-toggle:focus-visible\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(roomStyles).toContain('--breakout-room-title-color: var(--muted);');
    expect(roomStyles).toContain('--breakout-room-title-emphasis-color: var(--muted-strong);');
    expect(sessionToggleStyles).toContain('color: var(--muted);');
    expect(sessionToggleHoverStyles).toContain('color: var(--muted-strong);');
    expect(styles).not.toMatch(/\.workspace-breakout-room-item\[data-room-status="active"\][^{]*\{/u);
  });

  it('uses the summary sidenav transition for session-list overflow', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const overflowStyles = styles.match(/\.workspace-session-overflow\s*\{([^}]*)\}/u)?.[1] ?? '';
    const expandedStyles = styles.match(/\.workspace-session-overflow\.expanded\s*\{([^}]*)\}/u)?.[1] ?? '';
    const innerStyles = styles.match(/\.workspace-session-overflow-inner\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(overflowStyles).toContain('grid-template-rows: 0fr');
    expect(overflowStyles).toContain('transition: grid-template-rows 180ms ease');
    expect(expandedStyles).toContain('grid-template-rows: 1fr');
    expect(innerStyles).toContain('overflow: hidden');
  });

  it('keeps sessions with their fixed workspace registry id', () => {
    const first = workspace('workspace_first', '/workspace/first');
    const second = workspace('workspace_second', '/workspace/second');
    const firstSession = session({ id: 'session_first', registryWorkspaceId: first.id, workspacePath: '/workspace/renamed' });
    const secondSession = session({ id: 'session_second', registryWorkspaceId: second.id, workspacePath: second.workspacePath });
    const registry: WorkspaceRegistryState = {
      registryPath: '/home/user/.beale/workspaces.json',
      workspaces: [first, second],
      researchSessions: [firstSession, secondSession]
    };

    expect(researchSessionsForWorkspace(registry, first).map((item) => item.id)).toEqual(['session_first']);
    expect(researchSessionsForWorkspace(registry, second).map((item) => item.id)).toEqual(['session_second']);
    expect(workspaceById(registry, first.id)).toBe(first);
    expect(workspaceExists(registry, second.id)).toBe(true);
    expect(workspaceExists(registry, 'missing')).toBe(false);
  });

  it('formats session titles and compact relative ages for sidebar rows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    expect(promptSessionTitle(session({ title: 'Android Deep Link Auth Bypass', promptMarkdown: 'Audit Android links.' }))).toBe('Android Deep Link Auth Bypass');
    expect(shortRelativeAge('2026-04-30T10:00:00.000Z')).toBe('2H');
    expect(shortRelativeAge('2026-04-22T12:00:00.000Z')).toBe('1W');
  });

  it('labels the left navigation workspace section without the profile prefix', () => {
    const profile = testResearchProfile();
    const html = renderToStaticMarkup(createElement(WorkspaceSidebar, {
      busy: false,
      collapsed: false,
      error: null,
      openRegisteredWorkspaceMenuId: null,
      workspaceRegistry: null,
      selectedRunId: null,
      snapshot: {
        researchProfile: {
          profile: {
            ...profile,
            workspace: { ...profile.workspace, workspaceNoun: 'Research Workspace' }
          }
        }
      } as unknown as WorkspaceSnapshot,
      onAddWorkspace: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenResearchSession: () => undefined,
      onRemoveWorkspace: () => undefined,
      onResizePointerDown: () => undefined,
      onSetOpenWorkspaceMenuId: () => undefined,
      onSearch: () => undefined,
      onStartNewResearch: () => undefined
    }));

    expect(html).toContain('<div class="workspace-list-title">Workspaces</div>');
    expect(html).toContain('<div class="main-side-scroll sidebar-list-scroll-region">');
    expect(html).toContain('<div class="sidebar-list-scroll workspace-list-items">');
    expect(html).toContain('<div class="sidebar-list-scroll-content">');
    expect(html).toContain('class="lucide lucide-square-pen"');
    expect(html).not.toContain('class="lucide lucide-play"');
    expect(html).toContain('title="Find a Session"');
    expect(html).toContain('<span>Find a Session</span>');
    expect(html).not.toContain('<span>Search</span>');
    expect(html).not.toContain('Workspace Information');
    expect(html).not.toContain('Research Workspaces');
  });

  it('limits sidebar scrolling to the workspace items viewport', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const sidebarStyles = styles.match(/\.sidebar\s*\{([^}]*)\}/u)?.[1] ?? '';
    const workspaceListStyles = styles.match(/\.workspace-list,\s*\.settings-sidebar-section\s*\{([^}]*)\}/u)?.[1] ?? '';
    const listScrollRegionStyles = styles.match(/\.main-side-scroll\.sidebar-list-scroll-region\s*\{([^}]*)\}/u)?.[1] ?? '';
    const listScrollStyles = styles.match(/\.sidebar-list-scroll\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(sidebarStyles).toContain('overflow: hidden');
    expect(workspaceListStyles).toContain('flex: 1 1 auto');
    expect(workspaceListStyles).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(listScrollRegionStyles).toContain('width: calc(100% + 16px)');
    expect(listScrollRegionStyles).toContain('margin-inline: -4px -12px');
    expect(styles.indexOf('.main-side-scroll.sidebar-list-scroll-region')).toBeLessThan(styles.indexOf('.main-side-scroll {'));
    expect(listScrollStyles).toContain('width: 100%');
    expect(listScrollStyles).toContain('height: 100%');
    expect(listScrollStyles).toContain('overflow-y: scroll');
    expect(listScrollStyles).toContain('overscroll-behavior: contain');
    expect(styles).toMatch(/\.sidebar-list-scroll-content\s*\{[^}]*width: 100%/u);
    expect(styles).toMatch(/\.sidebar-list-scroll-region::before,\s*\.sidebar-list-scroll-region::after\s*\{[^}]*display: none/u);
    expect(styles).toMatch(/\.sidebar-list-scroll-region\.has-top-fade \.sidebar-list-scroll\s*\{[^}]*mask-image: linear-gradient/u);
    expect(styles).toMatch(/\.sidebar-list-scroll-region\.has-bottom-fade \.sidebar-list-scroll\s*\{[^}]*mask-image: linear-gradient/u);
    expect(styles).toMatch(/\.sidebar-list-scroll-region\.has-top-fade\.has-bottom-fade \.sidebar-list-scroll\s*\{[^}]*mask-image: linear-gradient/u);
    expect(styles).not.toMatch(/\.sidebar-list-scroll-region::(?:before|after)\s*\{[^}]*background:/u);
    expect(styles).toMatch(/\.sidebar-list-scroll \.workspace-item-row,\s*\.sidebar-list-scroll \.workspace-session-item\s*\{[^}]*width: 100%;[^}]*margin-inline: 0;/u);
    expect(styles).toMatch(/\.sidebar-list-scroll-region\.has-overflow \.sidebar-list-scroll:where\(:hover, :focus, :focus-within, \.scrollbar-active\)/u);
    expect(INSET_SCROLLBAR_SELECTOR).toContain('.sidebar-list-scroll');
    expect(INSET_SCROLLBAR_SELECTOR).not.toContain('.sidebar,');
    expect(mainSideScrollHasOverflow(300, 200)).toBe(true);
    expect(mainSideScrollHasOverflow(200, 200)).toBe(false);
  });

  it('shows registry loading state instead of an empty workspace list during startup', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceSidebar, {
      busy: false,
      collapsed: false,
      error: null,
      openRegisteredWorkspaceMenuId: null,
      workspaceRegistry: null,
      workspaceRegistryLoading: true,
      selectedRunId: null,
      snapshot: null,
      onAddWorkspace: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenResearchSession: () => undefined,
      onRemoveWorkspace: () => undefined,
      onResizePointerDown: () => undefined,
      onSetOpenWorkspaceMenuId: () => undefined,
      onSearch: () => undefined,
      onStartNewResearch: () => undefined
    }));

    expect(html).toContain('Loading workspaces');
    expect(html).toContain('lucide-loader-circle');
    expect(html).not.toContain('No Workspaces Yet');
  });

  it('renders selected-session breakout rooms from live detail before the workspace snapshot refreshes', () => {
    const profile = testResearchProfile();
    const registeredWorkspace = workspace('workspace_test', '/workspace/test');
    const selectedSession = session({ registryWorkspaceId: registeredWorkspace.id });
    const registry: WorkspaceRegistryState = {
      registryPath: '/home/user/.beale/workspaces.json',
      workspaces: [registeredWorkspace],
      researchSessions: [selectedSession]
    };
    const html = renderToStaticMarkup(createElement(WorkspaceSidebar, {
      busy: false,
      collapsed: false,
      error: null,
      openRegisteredWorkspaceMenuId: null,
      workspaceRegistry: registry,
      selectedRunId: selectedSession.runId,
      selectedBreakoutRoomId: null,
      selectedRunBreakoutRooms: [{
        id: 'room_live',
        runId: selectedSession.runId,
        title: 'live provider challenge',
        status: 'active'
      }],
      snapshot: {
        workspace: { workspacePath: registeredWorkspace.workspacePath },
        researchProfile: { profile },
        runs: [{ run: { id: selectedSession.runId }, breakoutRooms: [] }]
      } as unknown as WorkspaceSnapshot,
      onAddWorkspace: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenResearchSession: () => undefined,
      onOpenBreakoutRoom: () => undefined,
      onRemoveWorkspace: () => undefined,
      onResizePointerDown: () => undefined,
      onSetOpenWorkspaceMenuId: () => undefined,
      onSearch: () => undefined,
      onStartNewResearch: () => undefined
    }));

    expect(html).toContain('Live Provider Challenge');
    expect(html).toContain('title="Live Provider Challenge — Active"');
    expect(html).toContain('workspace-breakout-room-item');
    expect(html).toContain('class="workspace-breakout-room-item" data-room-status="active"');
    expect(html).toContain('class="workspace-breakout-room-reveal" data-state="open" aria-hidden="false"');
    expect(html).toContain('class="lucide lucide-folder"');
    expect(html).not.toContain('lucide-chevron');
    expect(html).not.toContain('class="lucide lucide-messages-square"');
    const statusIndex = html.indexOf('workspace-breakout-room-leading-status');
    const titleIndex = html.indexOf('class="workspace-breakout-room-title">Live Provider Challenge');
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(titleIndex).toBeGreaterThan(statusIndex);
    expect(html).toContain('class="lucide lucide-refresh-cw"');
    expect(html).not.toMatch(/class="workspace-item-row active\b/u);
    expect(html).toContain('class="workspace-session-item active"');
  });

  it('marks a workspace active only while its dashboard is selected', () => {
    const profile = testResearchProfile();
    const registeredWorkspace = { ...workspace('workspace_test', '/workspace/test'), workspaceName: 'Snapchat' };
    const registry: WorkspaceRegistryState = {
      registryPath: '/home/user/.beale/workspaces.json',
      workspaces: [registeredWorkspace],
      researchSessions: Array.from({ length: 5 }, (_, index) => session({
        id: `session_${index}`,
        runId: `run_${index}`,
        registryWorkspaceId: registeredWorkspace.id
      }))
    };
    const html = renderToStaticMarkup(createElement(WorkspaceSidebar, {
      busy: false,
      collapsed: false,
      error: null,
      openRegisteredWorkspaceMenuId: null,
      workspaceRegistry: registry,
      selectedRunId: null,
      snapshot: {
        workspace: { workspacePath: registeredWorkspace.workspacePath },
        researchProfile: { profile },
        runs: []
      } as unknown as WorkspaceSnapshot,
      onAddWorkspace: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenResearchSession: () => undefined,
      onRemoveWorkspace: () => undefined,
      onResizePointerDown: () => undefined,
      onSetOpenWorkspaceMenuId: () => undefined,
      onSearch: () => undefined,
      onStartNewResearch: () => undefined
    }));

    expect(html).toMatch(/class="workspace-item-row active\b/u);
    expect(html).toContain('class="workspace-session-overflow" aria-hidden="true" inert=""');
    expect(html).toContain('class="session-memory-type-toggle" aria-expanded="false">Show 1 more</button>');
    expect(html).not.toContain('More Sessions...');
    expect(html).not.toContain('More Snapchat Sessions');
    expect(html).not.toContain('More Research Sessions');
  });

  it('keeps breakout rooms collapsed beneath sessions that are not selected', () => {
    const profile = testResearchProfile();
    const registeredWorkspace = workspace('workspace_test', '/workspace/test');
    const selectedSession = session({ id: 'session_selected', runId: 'run_selected', registryWorkspaceId: registeredWorkspace.id });
    const previousSession = session({
      id: 'session_previous',
      runId: 'run_previous',
      registryWorkspaceId: registeredWorkspace.id,
      breakoutRooms: [{
        id: 'room_previous',
        runId: 'run_previous',
        name: 'previous_provider_challenge',
        title: 'Previous provider challenge',
        kind: 'validation',
        status: 'completed',
        updatedAt: '2026-04-29T12:05:00.000Z',
        memberCount: 2,
        providers: ['anthropic', 'openai-codex'],
        unreadCount: 0
      }]
    });
    const registry: WorkspaceRegistryState = {
      registryPath: '/home/user/.beale/workspaces.json',
      workspaces: [registeredWorkspace],
      researchSessions: [selectedSession, previousSession]
    };
    const html = renderToStaticMarkup(createElement(WorkspaceSidebar, {
      busy: false,
      collapsed: false,
      error: null,
      openRegisteredWorkspaceMenuId: null,
      workspaceRegistry: registry,
      selectedRunId: selectedSession.runId,
      snapshot: {
        workspace: { workspacePath: registeredWorkspace.workspacePath },
        researchProfile: { profile },
        runs: []
      } as unknown as WorkspaceSnapshot,
      onAddWorkspace: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenResearchSession: () => undefined,
      onOpenBreakoutRoom: () => undefined,
      onRemoveWorkspace: () => undefined,
      onResizePointerDown: () => undefined,
      onSetOpenWorkspaceMenuId: () => undefined,
      onSearch: () => undefined,
      onStartNewResearch: () => undefined
    }));

    expect(html).toContain('Previous Provider Challenge');
    expect(html).toContain('class="workspace-breakout-room-reveal" data-state="closed" aria-hidden="true" inert=""');
    expect(html).not.toContain('lucide-chevron');
  });

  it('moves an active session spinner to the leading slot and keeps its timestamp on the right', () => {
    const profile = testResearchProfile();
    const registeredWorkspace = workspace('workspace_test', '/workspace/test');
    const activeSession = session({ status: 'active', registryWorkspaceId: registeredWorkspace.id });
    const registry: WorkspaceRegistryState = {
      registryPath: '/home/user/.beale/workspaces.json',
      workspaces: [registeredWorkspace],
      researchSessions: [activeSession]
    };
    const html = renderToStaticMarkup(createElement(WorkspaceSidebar, {
      busy: false,
      collapsed: false,
      error: null,
      openRegisteredWorkspaceMenuId: null,
      workspaceRegistry: registry,
      selectedRunId: activeSession.runId,
      snapshot: {
        workspace: { workspacePath: registeredWorkspace.workspacePath },
        researchProfile: { profile },
        runs: []
      } as unknown as WorkspaceSnapshot,
      onAddWorkspace: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenResearchSession: () => undefined,
      onRemoveWorkspace: () => undefined,
      onResizePointerDown: () => undefined,
      onSetOpenWorkspaceMenuId: () => undefined,
      onSearch: () => undefined,
      onStartNewResearch: () => undefined
    }));

    expect(html).toContain('class="workspace-session-leading-status" title="Active"');
    expect(html).toContain('class="lucide lucide-refresh-cw"');
    expect(html).toContain('class="workspace-session-age"');
    expect(html.indexOf('workspace-session-leading-status')).toBeLessThan(html.indexOf('workspace-session-title'));
    expect(html.indexOf('workspace-session-age')).toBeGreaterThan(html.indexOf('workspace-session-title'));
  });

  it('uses only a muted leading spinner for active breakout rooms', () => {
    const profile = testResearchProfile();
    const registeredWorkspace = workspace('workspace_test', '/workspace/test');
    const selectedSession = session({ registryWorkspaceId: registeredWorkspace.id });
    const registry: WorkspaceRegistryState = {
      registryPath: '/home/user/.beale/workspaces.json',
      workspaces: [registeredWorkspace],
      researchSessions: [selectedSession]
    };
    const html = renderToStaticMarkup(createElement(WorkspaceSidebar, {
      busy: false,
      collapsed: false,
      error: null,
      openRegisteredWorkspaceMenuId: null,
      workspaceRegistry: registry,
      selectedRunId: selectedSession.runId,
      selectedBreakoutRoomId: 'room_loading',
      snapshot: {
        workspace: { workspacePath: registeredWorkspace.workspacePath },
        researchProfile: { profile },
        runs: [{
          run: { id: selectedSession.runId },
          breakoutRooms: [{ id: 'room_loading', runId: selectedSession.runId, title: 'Loading review', status: 'active' }]
        }]
      } as unknown as WorkspaceSnapshot,
      onAddWorkspace: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenResearchSession: () => undefined,
      onOpenBreakoutRoom: () => undefined,
      onRemoveWorkspace: () => undefined,
      onResizePointerDown: () => undefined,
      onSetOpenWorkspaceMenuId: () => undefined,
      onSearch: () => undefined,
      onStartNewResearch: () => undefined
    }));

    expect(html).toContain('class="workspace-breakout-room-leading-status" title="Active" aria-label="Breakout room status: Active"');
    expect(html).toContain('class="lucide lucide-refresh-cw"');
    expect(html).not.toContain('workspace-breakout-room-status');
  });

  it('uses the leading slot for an unviewed result dot and leaves viewed results blank', () => {
    const registeredWorkspace = workspace('workspace_test', '/workspace/test');
    const registry: WorkspaceRegistryState = {
      registryPath: '/home/user/.beale/workspaces.json',
      workspaces: [registeredWorkspace],
      researchSessions: [
        session({ id: 'session_unviewed', runId: 'run_unviewed', resultViewedAt: null }),
        session({ id: 'session_viewed', runId: 'run_viewed', resultViewedAt: '2026-04-30T02:00:00.000Z' })
      ]
    };
    const html = renderToStaticMarkup(createElement(WorkspaceSidebar, {
      busy: false,
      collapsed: false,
      error: null,
      openRegisteredWorkspaceMenuId: null,
      workspaceRegistry: registry,
      selectedRunId: null,
      snapshot: null,
      onAddWorkspace: () => undefined,
      onOpenWorkspace: () => undefined,
      onOpenResearchSession: () => undefined,
      onRemoveWorkspace: () => undefined,
      onResizePointerDown: () => undefined,
      onSetOpenWorkspaceMenuId: () => undefined,
      onSearch: () => undefined,
      onStartNewResearch: () => undefined
    }));

    expect(html.match(/workspace-session-unviewed-dot/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="Session result not viewed"');
  });
});

function workspace(id: string, workspacePath: string): WorkspaceRegistryEntry {
  return {
    id,
    workspacePath,
    workspaceId: id.replace('workspace_', 'workspace_'),
    workspaceName: id,
    scopeOwner: '',
    researchProfileId: 'security-research',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    expiresAt: null,
    createdAt: '2026-04-30T00:00:00.000Z',
    updatedAt: '2026-04-30T00:00:00.000Z',
    lastOpenedAt: null,
    runCount: 0,
    lastRunAt: null
  };
}

function session(input: Partial<ResearchSessionSummary>): ResearchSessionSummary {
  return {
    id: 'session_test',
    registryWorkspaceId: 'workspace_test',
    workspacePath: '/workspace/test',
    workspaceId: 'workspace_test',
    runId: 'run_test',
    title: '',
    status: 'completed',
    runEngine: 'honeycrisp',
    mode: 'dynamic',
    promptMarkdown: '',
    summary: '',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    sandboxProfile: 'host',
    createdAt: '2026-04-30T00:00:00.000Z',
    startedAt: '2026-04-30T00:00:00.000Z',
    endedAt: '2026-04-30T01:00:00.000Z',
    updatedAt: '2026-04-30T01:00:00.000Z',
    resultViewedAt: null,
    ...input,
    finalDisposition: input.finalDisposition ?? null
  };
}
