import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '@shared/types';
import { WorkspaceSidebar } from '../src/renderer/features/workspaces/WorkspaceSidebar';

describe('workspace sidebar HAM control', () => {
  it('renders HAM Mode under Search as a pressed toggle when enabled', () => {
    const snapshot = {
      hamMode: {
        enabled: true,
        phase: 'session_active',
        promptGuidance: '',
        startRequestedAt: null,
        activeRunId: 'run_ham',
        lastHandledRunId: 'run_seed',
        lastStartedRunId: 'run_ham',
        lastError: null,
        updatedAt: '2026-07-28T10:00:00.000Z'
      },
      workspace: { workspacePath: '/workspace' }
    } as unknown as WorkspaceSnapshot;
    const html = renderToStaticMarkup(
      createElement(WorkspaceSidebar, {
        busy: false,
        collapsed: false,
        error: null,
        hamMode: snapshot.hamMode,
        openRegisteredWorkspaceMenuId: null,
        workspaceRegistry: null,
        selectedRunId: 'run_ham',
        snapshot,
        onAddWorkspace: () => undefined,
        onOpenWorkspace: () => undefined,
        onOpenWorkspaceInfo: () => undefined,
        onOpenResearchSession: () => undefined,
        onRemoveWorkspace: () => undefined,
        onResizePointerDown: () => undefined,
        onSetOpenWorkspaceMenuId: () => undefined,
        onShowMoreSessions: () => undefined,
        onSearch: () => undefined,
        onToggleHamMode: () => undefined,
        onStartNewResearch: () => undefined
      })
    );

    expect(html.indexOf('Search</span>')).toBeLessThan(html.indexOf('HAM Mode</span>'));
    expect(html).toContain('sidebar-ham-mode active');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('disable it to let this session finish without starting another');
  });

  it('renders prompt-generation failures as inactive HAM state', () => {
    const snapshot = {
      hamMode: {
        enabled: false,
        phase: 'disabled',
        promptGuidance: '',
        startRequestedAt: null,
        activeRunId: null,
        lastHandledRunId: 'run_seed',
        lastStartedRunId: null,
        lastError: 'Prompt generation failed.',
        updatedAt: '2026-07-29T10:00:00.000Z'
      },
      workspace: { workspacePath: '/workspace' }
    } as unknown as WorkspaceSnapshot;
    const html = renderToStaticMarkup(
      createElement(WorkspaceSidebar, {
        busy: false,
        collapsed: false,
        error: null,
        hamMode: snapshot.hamMode,
        openRegisteredWorkspaceMenuId: null,
        workspaceRegistry: null,
        selectedRunId: null,
        snapshot,
        onAddWorkspace: () => undefined,
        onOpenWorkspace: () => undefined,
        onOpenWorkspaceInfo: () => undefined,
        onOpenResearchSession: () => undefined,
        onRemoveWorkspace: () => undefined,
        onResizePointerDown: () => undefined,
        onSetOpenWorkspaceMenuId: () => undefined,
        onShowMoreSessions: () => undefined,
        onSearch: () => undefined,
        onToggleHamMode: () => undefined,
        onStartNewResearch: () => undefined
      })
    );

    expect(html).toContain('sidebar-ham-mode  error');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('HAM Mode stopped: Prompt generation failed.');
  });
});
