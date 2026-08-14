import { memo } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderPlus, MoreVertical, Play, RefreshCw, Search } from 'lucide-react';
import type { BreakoutRoomStatus, BreakoutRoomSummary, WorkspaceRegistryEntry, WorkspaceRegistryState, ResearchSessionSummary, RunStatus, WorkspaceSnapshot } from '@shared/types';
import { useDevRenderProbe } from '../../devInstrumentation';
import { promptSessionTitle, researchSessionsForWorkspace, shortRelativeAge } from '../../view-models/workspaceDisplay';

const SIDEBAR_SESSION_LIMIT = 4;
type SidebarBreakoutRoom = Pick<BreakoutRoomSummary, 'id' | 'runId' | 'title' | 'status'>;

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  busy,
  collapsed,
  error,
  openRegisteredWorkspaceMenuId,
  workspaceRegistry,
  selectedRunId,
  selectedBreakoutRoomId = null,
  selectedRunBreakoutRooms,
  selectedRunBreakoutRoomsLoading = false,
  snapshot,
  onAddWorkspace,
  onOpenWorkspace,
  onOpenWorkspaceInfo,
  onOpenResearchSession,
  onOpenBreakoutRoom = () => undefined,
  onRemoveWorkspace,
  onResizePointerDown,
  onSetOpenWorkspaceMenuId,
  onShowMoreSessions,
  onSearch,
  onStartNewResearch
}: {
  busy: boolean;
  collapsed: boolean;
  error: string | null;
  openRegisteredWorkspaceMenuId: string | null;
  workspaceRegistry: WorkspaceRegistryState | null;
  selectedRunId: string | null;
  selectedBreakoutRoomId?: string | null;
  selectedRunBreakoutRooms?: readonly SidebarBreakoutRoom[];
  selectedRunBreakoutRoomsLoading?: boolean;
  snapshot: WorkspaceSnapshot | null;
  onAddWorkspace: () => void;
  onOpenWorkspace: (workspace: WorkspaceRegistryEntry) => void;
  onOpenWorkspaceInfo: (workspace: WorkspaceRegistryEntry) => void;
  onOpenResearchSession: (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary) => void;
  onOpenBreakoutRoom?: (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary, roomId: string) => void;
  onRemoveWorkspace: (workspace: WorkspaceRegistryEntry) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSetOpenWorkspaceMenuId: (registryWorkspaceId: string | null) => void;
  onShowMoreSessions: (registryWorkspaceId: string) => void;
  onSearch: () => void;
  onStartNewResearch: () => void;
}): JSX.Element {
  useDevRenderProbe('sidebar.workspaces', () => ({
    collapsed,
    workspaces: workspaceRegistry?.workspaces.length ?? 0,
    sessions: workspaceRegistry?.researchSessions.length ?? 0
  }));
  const workspaces = workspaceRegistry?.workspaces ?? [];
  const presentation = snapshot?.researchProfile?.profile.presentation;
  const newResearchLabel = presentation?.newResearchLabel ?? 'New Research';
  const sessionLabel = presentation?.sessionLabel ?? 'Session';
  const workspaceNoun = snapshot?.researchProfile?.profile.workspace.workspaceNoun ?? 'Research Workspace';

  return (
    <aside className="sidebar" aria-hidden={collapsed} inert={collapsed}>
      <button type="button" className="sidebar-new-research" title={`Start ${newResearchLabel.toLocaleLowerCase()}`} disabled={busy || !snapshot} onClick={onStartNewResearch}>
        <Play size={15} />
        <span>{newResearchLabel}</span>
      </button>
      <div className="sidebar-quick-actions">
        <button type="button" className="sidebar-utility-button" title="Search" onClick={onSearch}>
          <Search size={15} />
          <span>Search</span>
        </button>
      </div>
      <div className="sidebar-section workspace-list">
        <div className="section-row">
          <div className="workspace-list-title">Workspaces</div>
          <button type="button" title={`Add ${workspaceNoun.toLocaleLowerCase()}`} disabled={busy} onClick={onAddWorkspace}>
            <FolderPlus size={15} />
          </button>
        </div>
        {workspaces.map((workspace) => {
          const workspaceLoaded = snapshot?.workspace.workspacePath === workspace.workspacePath;
          const dashboardActive = workspaceLoaded && selectedRunId === null;
          const menuOpen = openRegisteredWorkspaceMenuId === workspace.id;
          const sessions = workspaceRegistry ? researchSessionsForWorkspace(workspaceRegistry, workspace) : [];
          const visibleSessions = sessions.slice(0, SIDEBAR_SESSION_LIMIT);
          return (
            <div className="workspace-group" key={workspace.id}>
              <div className={`workspace-item-row ${dashboardActive ? 'active' : ''} ${menuOpen ? 'menu-open' : ''}`} data-workspace-menu-root>
                <button type="button" className="workspace-item" title={workspace.workspacePath} onClick={() => onOpenWorkspace(workspace)}>
                  <Folder size={15} aria-hidden="true" />
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
                  visibleSessions.map((session) => {
                    const rooms = selectedRunId === session.runId && selectedRunBreakoutRooms !== undefined
                      ? selectedRunBreakoutRooms
                      : workspaceLoaded
                        ? snapshot?.runs.find((row) => row.run.id === session.runId)?.breakoutRooms ?? session.breakoutRooms ?? []
                        : session.breakoutRooms ?? [];
                    const roomsVisible = selectedRunId === session.runId && rooms.length > 0;
                    return (
                    <div className="workspace-session-row" key={session.id}>
                      <button
                        type="button"
                        className={`workspace-session-item ${selectedRunId === session.runId ? 'active' : ''}`}
                        title={promptSessionTitle(session)}
                        onClick={() => onOpenResearchSession(workspace, session)}
                      >
                        {selectedRunId === session.runId
                          ? <ChevronDown size={14} aria-hidden="true" />
                          : <ChevronRight size={14} aria-hidden="true" />}
                        <span className="workspace-session-title">{promptSessionTitle(session)}</span>
                        {session.status !== 'active'
                          ? <span className="workspace-session-age">{shortRelativeAge(session.updatedAt)}</span>
                          : null}
                        <SessionActiveIndicator status={session.status} />
                      </button>
                      {rooms.length > 0 ? (
                        <div
                          className="workspace-breakout-room-reveal"
                          data-state={roomsVisible ? 'open' : 'closed'}
                          aria-hidden={!roomsVisible}
                          inert={!roomsVisible}
                        >
                          <div className="workspace-breakout-room-list">
                            {rooms.map((room) => (
                              <button
                                type="button"
                                className={`workspace-breakout-room-item${selectedBreakoutRoomId === room.id ? ' active' : ''}`}
                                data-room-status={room.status}
                                title={`${room.title} — ${breakoutRoomStatusLabel(room.status)}`}
                                onClick={() => onOpenBreakoutRoom(workspace, session, room.id)}
                                key={room.id}
                              >
                                <span
                                  className={`workspace-breakout-room-status ${selectedRunId === session.runId && selectedRunBreakoutRoomsLoading ? 'status-loading' : `status-${room.status}`}`}
                                  aria-label={selectedRunId === session.runId && selectedRunBreakoutRoomsLoading ? 'Loading room status' : breakoutRoomStatusLabel(room.status)}
                                />
                                <span className="workspace-breakout-room-title">{room.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    );
                  })
                ) : (
                  <span className="workspace-session-empty">No {sessionLabel} Yet...</span>
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

function SessionActiveIndicator({ status }: { status: RunStatus }): JSX.Element | null {
  if (status !== 'active') return null;
  return (
    <span className="workspace-session-status" title={sessionStatusLabel(status)} aria-label={`Session status: ${sessionStatusLabel(status)}`}>
      <RefreshCw size={10} />
    </span>
  );
}

function breakoutRoomStatusLabel(status: BreakoutRoomStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'completed') return 'Completed';
  if (status === 'interrupted') return 'Interrupted';
  return 'Error';
}

function sessionStatusLabel(value: string): string {
  return value
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}
