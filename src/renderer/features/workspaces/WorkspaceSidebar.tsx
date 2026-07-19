import { memo } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { FolderPlus, ListChecks, MoreVertical, Play, RefreshCw, Search, Server, Terminal } from 'lucide-react';
import type { WorkspaceRegistryEntry, WorkspaceRegistryState, ResearchSessionSummary, RunStatus, WorkspaceSnapshot } from '@shared/types';
import { useDevRenderProbe } from '../../devInstrumentation';
import { promptSessionTitle, researchSessionsForWorkspace, shortRelativeAge } from '../../view-models/workspaceDisplay';

const SIDEBAR_SESSION_LIMIT = 4;

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  busy,
  collapsed,
  error,
  openRegisteredWorkspaceMenuId,
  workspaceRegistry,
  selectedRunId,
  snapshot,
  onAddWorkspace,
  onOpenWorkspace,
  onOpenWorkspaceInfo,
  onOpenResearchSession,
  onRemoveWorkspace,
  onResizePointerDown,
  onSetOpenWorkspaceMenuId,
  onShowMoreSessions,
  onShowMcpServers,
  onSearch,
  onShowSkills,
  onStartNewResearch
}: {
  busy: boolean;
  collapsed: boolean;
  error: string | null;
  openRegisteredWorkspaceMenuId: string | null;
  workspaceRegistry: WorkspaceRegistryState | null;
  selectedRunId: string | null;
  snapshot: WorkspaceSnapshot | null;
  onAddWorkspace: () => void;
  onOpenWorkspace: (workspace: WorkspaceRegistryEntry) => void;
  onOpenWorkspaceInfo: (workspace: WorkspaceRegistryEntry) => void;
  onOpenResearchSession: (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary) => void;
  onRemoveWorkspace: (workspace: WorkspaceRegistryEntry) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSetOpenWorkspaceMenuId: (registryWorkspaceId: string | null) => void;
  onShowMoreSessions: (registryWorkspaceId: string) => void;
  onShowMcpServers: () => void;
  onSearch: () => void;
  onShowSkills: () => void;
  onStartNewResearch: () => void;
}): JSX.Element {
  useDevRenderProbe('sidebar.workspaces', () => ({
    collapsed,
    workspaces: workspaceRegistry?.workspaces.length ?? 0,
    sessions: workspaceRegistry?.researchSessions.length ?? 0
  }));
  const workspaces = workspaceRegistry?.workspaces ?? [];

  return (
    <aside className="sidebar" aria-hidden={collapsed} inert={collapsed}>
      <button type="button" className="sidebar-new-research" title="Start new research" disabled={busy || !snapshot} onClick={onStartNewResearch}>
        <Play size={15} />
        <span>New Research</span>
      </button>
      <div className="sidebar-quick-actions">
        <button type="button" className="sidebar-utility-button" title="Search" onClick={onSearch}>
          <Search size={15} />
          <span>Search</span>
        </button>
        <button type="button" className="sidebar-utility-button" title="Skills" disabled={!snapshot} onClick={onShowSkills}>
          <ListChecks size={15} />
          <span>Skills</span>
        </button>
        <button type="button" className="sidebar-utility-button" title="MCP Servers" disabled={!snapshot} onClick={onShowMcpServers}>
          <Server size={15} />
          <span>MCP Servers</span>
        </button>
      </div>
      <div className="sidebar-section workspace-list">
        <div className="section-row">
          <div className="meta-label">Research Workspaces</div>
          <button type="button" title="Add research workspace" disabled={busy} onClick={onAddWorkspace}>
            <FolderPlus size={15} />
          </button>
        </div>
        {workspaces.map((workspace) => {
          const active = snapshot?.workspace.workspacePath === workspace.workspacePath;
          const menuOpen = openRegisteredWorkspaceMenuId === workspace.id;
          const sessions = workspaceRegistry ? researchSessionsForWorkspace(workspaceRegistry, workspace) : [];
          const visibleSessions = sessions.slice(0, SIDEBAR_SESSION_LIMIT);
          return (
            <div className="workspace-group" key={workspace.id}>
              <div className={`workspace-item-row ${active ? 'active' : ''} ${menuOpen ? 'menu-open' : ''}`} data-workspace-menu-root>
                <button type="button" className="workspace-item" title={workspace.workspacePath} onClick={() => onOpenWorkspace(workspace)}>
                  <Terminal size={15} />
                  <span>{workspace.workspaceName}</span>
                </button>
                <button
                  type="button"
                  className="workspace-menu-button"
                  title={`${workspace.workspaceName} options`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetOpenWorkspaceMenuId(menuOpen ? null : workspace.id);
                  }}
                >
                  <MoreVertical size={14} />
                </button>
                {menuOpen ? (
                  <div className="workspace-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onOpenWorkspaceInfo(workspace);
                        onSetOpenWorkspaceMenuId(null);
                      }}
                    >
                      Workspace Information
                    </button>
                    <button type="button" role="menuitem" className="danger" onClick={() => onRemoveWorkspace(workspace)}>
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="workspace-session-list">
                {visibleSessions.length > 0 ? (
                  visibleSessions.map((session) => (
                    <div className="workspace-session-row" key={session.id}>
                      <SessionActiveIndicator status={session.status} />
                      <button
                        type="button"
                        className={`workspace-session-item ${selectedRunId === session.runId ? 'active' : ''}`}
                        title={promptSessionTitle(session)}
                        onClick={() => onOpenResearchSession(workspace, session)}
                      >
                        <span className="workspace-session-title">{promptSessionTitle(session)}</span>
                        <span className="workspace-session-age">{shortRelativeAge(session.updatedAt)}</span>
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="workspace-session-empty">No Session Yet...</span>
                )}
                {sessions.length > SIDEBAR_SESSION_LIMIT ? (
                  <button type="button" className="workspace-session-more" onClick={() => onShowMoreSessions(workspace.id)}>
                    More Sessions...
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      <div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" onPointerDown={onResizePointerDown} />
    </aside>
  );
});

function SessionActiveIndicator({ status }: { status: RunStatus }): JSX.Element {
  return (
    <span className="workspace-session-status" title={sessionStatusLabel(status)} aria-label={`Session status: ${sessionStatusLabel(status)}`}>
      {status === 'active' ? <RefreshCw size={10} /> : null}
    </span>
  );
}

function sessionStatusLabel(value: string): string {
  return value
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}
