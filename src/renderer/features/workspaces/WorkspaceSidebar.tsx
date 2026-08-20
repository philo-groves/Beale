import { memo, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { CalendarClock, FileText, Folder, FolderPlus, LoaderCircle, Plug, RefreshCw, Search, SquarePen, X } from 'lucide-react';
import type { WorkspaceRegistryEntry, WorkspaceRegistryState, ResearchSessionSummary, RunStatus, WorkspaceSnapshot } from '@shared/types';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { useDevRenderProbe } from '../../devInstrumentation';
import { promptSessionTitle, researchSessionsForWorkspace, shortRelativeAge } from '../../view-models/workspaceDisplay';

const SIDEBAR_SESSION_LIMIT = 4;

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  busy,
  collapsed,
  error,
  workspaceRegistry,
  workspaceRegistryLoading = false,
  selectedRunId,
  newResearchActive = false,
  automationsActive = false,
  reportsActive = false,
  pluginsActive = false,
  snapshot,
  onAddWorkspace,
  onOpenWorkspace,
  onOpenResearchSession,
  onResizePointerDown,
  onOpenAutomations = () => undefined,
  onOpenReports = () => undefined,
  onOpenPlugins = () => undefined,
  onStartNewResearch,
  onStartNewResearchForWorkspace
}: {
  busy: boolean;
  collapsed: boolean;
  error: string | null;
  workspaceRegistry: WorkspaceRegistryState | null;
  workspaceRegistryLoading?: boolean;
  selectedRunId: string | null;
  newResearchActive?: boolean;
  automationsActive?: boolean;
  reportsActive?: boolean;
  pluginsActive?: boolean;
  snapshot: WorkspaceSnapshot | null;
  onAddWorkspace: () => void;
  onOpenWorkspace: (workspace: WorkspaceRegistryEntry) => void;
  onOpenResearchSession: (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onOpenAutomations?: () => void;
  onOpenReports?: () => void;
  onOpenPlugins?: () => void;
  onStartNewResearch: () => void;
  onStartNewResearchForWorkspace: (workspace: WorkspaceRegistryEntry) => void;
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
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const normalizedSessionSearchQuery = sessionSearchQuery.trim();
  const filteringSessions = normalizedSessionSearchQuery.length > 0;
  const workspaceRows = workspaces
    .map((workspace) => {
      const sessions = workspaceRegistry ? researchSessionsForWorkspace(workspaceRegistry, workspace) : [];
      return {
        workspace,
        sessions: filteringSessions
          ? sessions.filter((session) => sessionMatchesSidebarSearch(session, normalizedSessionSearchQuery))
          : sessions
      };
    })
    .filter(({ workspace, sessions }) => (
      !filteringSessions
      || sessions.length > 0
      || (newResearchActive && snapshot?.workspace.workspacePath === workspace.workspacePath)
    ));
  const listUpdateKey = [
    workspaceRegistryLoading,
    workspaces.length,
    workspaceRegistry?.researchSessions.length ?? 0,
    [...expandedWorkspaceIds].sort().join(','),
    normalizedSessionSearchQuery
  ].join(':');
  const closeSessionSearch = (): void => {
    setSessionSearchOpen(false);
    setSessionSearchQuery('');
  };

  return (
    <aside className="sidebar" aria-hidden={collapsed} inert={collapsed}>
      <button type="button" className="sidebar-new-research" title={`Start ${newResearchLabel.toLocaleLowerCase()}`} disabled={busy || !snapshot} onClick={onStartNewResearch}>
        <SquarePen size={15} />
        <span>{newResearchLabel}</span>
      </button>
      <div className="sidebar-quick-actions">
        <button type="button" className={`sidebar-utility-button${automationsActive ? ' active' : ''}`} title="Automations" aria-current={automationsActive ? 'page' : undefined} onClick={onOpenAutomations}>
          <CalendarClock size={15} />
          <span>Automations</span>
        </button>
        <button type="button" className={`sidebar-utility-button${reportsActive ? ' active' : ''}`} title="Reporting" aria-current={reportsActive ? 'page' : undefined} onClick={onOpenReports}>
          <FileText size={15} />
          <span>Reporting</span>
        </button>
        <button type="button" className={`sidebar-utility-button${pluginsActive ? ' active' : ''}`} title="Plugins" aria-current={pluginsActive ? 'page' : undefined} onClick={onOpenPlugins}>
          <Plug size={15} />
          <span>Plugins</span>
        </button>
      </div>
      <div className="sidebar-section workspace-list">
        <div className="section-row workspace-list-header">
          {sessionSearchOpen ? (
            <div className="workspace-list-search" role="search">
              <input
                autoFocus
                value={sessionSearchQuery}
                aria-label="Search sessions"
                placeholder="Search sessions"
                onChange={(event) => setSessionSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeSessionSearch();
                }}
              />
              <button type="button" className="workspace-list-search-close" title="Close session search" aria-label="Close session search" onClick={closeSessionSearch}>
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="workspace-list-title">
              <span>Workspaces</span>
              {workspaceRegistryLoading ? (
                <span className="workspace-list-title-loading" role="status" aria-label="Loading workspaces">
                  <LoaderCircle aria-hidden="true" size={13} />
                </span>
              ) : null}
            </div>
          )}
          <div className="workspace-list-header-actions">
            {!sessionSearchOpen ? (
              <button type="button" title="Search sessions" aria-label="Search sessions" onClick={() => setSessionSearchOpen(true)}>
                <Search size={15} />
              </button>
            ) : null}
            <button type="button" className="workspace-list-add-button" title={`Add ${workspaceNoun.toLocaleLowerCase()}`} disabled={busy || workspaceRegistryLoading} onClick={onAddWorkspace}>
              <FolderPlus size={15} />
            </button>
          </div>
        </div>
        <MainSideScrollRegion
          className="sidebar-list-scroll-region"
          listClassName="sidebar-list-scroll workspace-list-items"
          updateKey={listUpdateKey}
        >
          <div className="sidebar-list-scroll-content">
            {!workspaceRegistryLoading && workspaces.length === 0 ? (
              <span className="workspace-session-empty">No Workspaces Yet...</span>
            ) : null}
            {!workspaceRegistryLoading && workspaces.length > 0 && filteringSessions && workspaceRows.length === 0 ? (
              <span className="workspace-session-empty">No matching sessions.</span>
            ) : null}
            {workspaceRows.map(({ workspace, sessions }) => {
              const workspaceLoaded = snapshot?.workspace.workspacePath === workspace.workspacePath;
              const newResearchSessionActive = workspaceLoaded && newResearchActive;
              const dashboardActive = workspaceLoaded && selectedRunId === null && !newResearchActive && !automationsActive && !reportsActive && !pluginsActive;
              const sessionsExpanded = expandedWorkspaceIds.has(workspace.id);
              const visibleSessions = filteringSessions ? sessions : sessions.slice(0, SIDEBAR_SESSION_LIMIT);
              const hiddenSessions = filteringSessions ? [] : sessions.slice(SIDEBAR_SESSION_LIMIT);
              const renderSession = (session: ResearchSessionSummary): JSX.Element => {
                return (
                  <div className="workspace-session-row" key={session.id}>
                    <button
                      type="button"
                      className={`workspace-session-item ${!newResearchActive && selectedRunId === session.runId ? 'active' : ''}`}
                      title={promptSessionTitle(session)}
                      onClick={() => onOpenResearchSession(workspace, session)}
                    >
                      <SessionLeadingIndicator session={session} />
                      <span className="workspace-session-title">{promptSessionTitle(session)}</span>
                      <span className="workspace-session-age">{shortRelativeAge(session.updatedAt)}</span>
                    </button>
                  </div>
                );
              };
              return (
                <div className="workspace-group" key={workspace.id}>
                  <div className={`workspace-item-row ${dashboardActive ? 'active' : ''}`}>
                    <button type="button" className="workspace-item" title={workspace.workspacePath} onClick={() => onOpenWorkspace(workspace)}>
                      <Folder size={15} aria-hidden="true" />
                      <span>{workspace.workspaceName}</span>
                    </button>
                    <button
                      type="button"
                      className="workspace-new-research-button"
                      title={`Start new research in ${workspace.workspaceName}`}
                      aria-label={`Start new research in ${workspace.workspaceName}`}
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartNewResearchForWorkspace(workspace);
                      }}
                    >
                      <SquarePen size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="workspace-session-list">
                    {newResearchSessionActive ? (
                      <div className="workspace-session-row workspace-new-research-session-row">
                        <button
                          type="button"
                          className="workspace-session-item workspace-new-research-session-item active"
                          aria-current="page"
                          onClick={onStartNewResearch}
                        >
                          <span className="workspace-new-research-session-indent" aria-hidden="true" />
                          <span className="workspace-session-title">{newResearchLabel}</span>
                        </button>
                      </div>
                    ) : null}
                    {visibleSessions.length > 0 ? (
                      visibleSessions.map(renderSession)
                    ) : !newResearchSessionActive ? (
                      <span className="workspace-session-empty">No {sessionLabel} Yet...</span>
                    ) : null}
                    {hiddenSessions.length > 0 ? (
                      <>
                        <div
                          className={`workspace-session-overflow ${sessionsExpanded ? 'expanded' : ''}`.trim()}
                          aria-hidden={!sessionsExpanded}
                          inert={!sessionsExpanded}
                        >
                          <div className="workspace-session-overflow-inner">
                            {hiddenSessions.map(renderSession)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="session-memory-type-toggle"
                          aria-expanded={sessionsExpanded}
                          onClick={() => setExpandedWorkspaceIds((current) => {
                            const next = new Set(current);
                            if (next.has(workspace.id)) next.delete(workspace.id);
                            else next.add(workspace.id);
                            return next;
                          })}
                        >
                          {sessionsExpanded ? 'Show less' : `Show ${hiddenSessions.length} more`}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </MainSideScrollRegion>
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      <div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" onPointerDown={onResizePointerDown} />
    </aside>
  );
});

export function sessionMatchesSidebarSearch(session: ResearchSessionSummary, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return true;
  const searchableText = [
    promptSessionTitle(session),
    session.promptMarkdown,
    session.summary,
    session.model,
    session.reasoningEffort,
    session.status
  ].join('\n').toLocaleLowerCase();
  return terms.every((term) => searchableText.includes(term));
}

function SessionLeadingIndicator({ session }: { session: ResearchSessionSummary }): JSX.Element {
  if (session.status === 'active') {
    return (
      <span className="workspace-session-leading-status" title="Active" aria-label="Session status: Active">
        <RefreshCw size={10} aria-hidden="true" />
      </span>
    );
  }
  if (isEndedResearchRunStatus(session.status) && session.resultViewedAt === null) {
    return (
      <span className="workspace-session-leading-status" title="Unviewed result" aria-label="Session result not viewed">
        <span className="workspace-session-unviewed-dot" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="workspace-session-leading-status" aria-hidden="true" />
  );
}

function isEndedResearchRunStatus(status: RunStatus): boolean {
  return status === 'blocked' || status === 'completed' || status === 'failed' || status === 'stopped';
}
