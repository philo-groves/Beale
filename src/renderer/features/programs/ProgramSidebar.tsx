import { memo } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { DatabaseZap, FolderPlus, MoreVertical, Play, RefreshCw, Search, Terminal } from 'lucide-react';
import type { ProgramRegistryEntry, ProgramRegistryState, ResearchSessionSummary, RunStatus, WorkspaceSnapshot } from '@shared/types';
import { useDevRenderProbe } from '../../devInstrumentation';
import { promptSessionTitle, researchSessionsForProgram, shortRelativeAge } from '../../view-models/programDisplay';

const SIDEBAR_SESSION_LIMIT = 4;
const CYBERGYM_PROGRAM_NAME = 'CyberGym';

export const ProgramSidebar = memo(function ProgramSidebar({
  busy,
  cyberGymActive,
  collapsed,
  developerModeEnabled,
  error,
  openProgramMenuId,
  programRegistry,
  selectedRunId,
  snapshot,
  onAddProgram,
  onOpenBenchmarkingSettings,
  onOpenCyberGymWorkspace,
  onOpenProgram,
  onOpenProgramInfo,
  onOpenResearchSession,
  onRemoveProgram,
  onResizePointerDown,
  onSetOpenProgramMenuId,
  onShowMoreSessions,
  onSearch,
  onStartNewResearch
}: {
  busy: boolean;
  cyberGymActive: boolean;
  collapsed: boolean;
  developerModeEnabled: boolean;
  error: string | null;
  openProgramMenuId: string | null;
  programRegistry: ProgramRegistryState | null;
  selectedRunId: string | null;
  snapshot: WorkspaceSnapshot | null;
  onAddProgram: () => void;
  onOpenBenchmarkingSettings: () => void;
  onOpenCyberGymWorkspace: () => void;
  onOpenProgram: (program: ProgramRegistryEntry) => void;
  onOpenProgramInfo: (program: ProgramRegistryEntry) => void;
  onOpenResearchSession: (program: ProgramRegistryEntry, session: ResearchSessionSummary) => void;
  onRemoveProgram: (program: ProgramRegistryEntry) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSetOpenProgramMenuId: (programId: string | null) => void;
  onShowMoreSessions: (programId: string) => void;
  onSearch: () => void;
  onStartNewResearch: () => void;
}): JSX.Element {
  useDevRenderProbe('sidebar.programs', () => ({
    collapsed,
    programs: programRegistry?.programs.length ?? 0,
    sessions: programRegistry?.researchSessions.length ?? 0
  }));
  const programs = programRegistry?.programs ?? [];
  const cyberGymProgram = programs.find(isCyberGymProgram) ?? null;
  const regularPrograms = programs.filter((program) => !isCyberGymProgram(program));
  const cyberGymSessions = cyberGymProgram && programRegistry ? researchSessionsForProgram(programRegistry, cyberGymProgram) : [];
  const visibleCyberGymSessions = cyberGymSessions.slice(0, SIDEBAR_SESSION_LIMIT);

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
      </div>
      <div className="sidebar-section program-list">
        <div className="section-row">
          <div className="meta-label">Research Programs</div>
          <button type="button" title="Add research program" disabled={busy} onClick={onAddProgram}>
            <FolderPlus size={15} />
          </button>
        </div>
        {developerModeEnabled ? (
          <div className="program-group developer-program-group">
            <div className={`program-item-row developer-program-row ${cyberGymActive ? 'active' : ''}`}>
              <button type="button" className="program-item developer-program-item" title="Open CyberGym scenarios" onClick={onOpenCyberGymWorkspace}>
                <DatabaseZap size={15} />
                <span>CyberGym</span>
              </button>
              <button type="button" className="program-menu-button cybergym-scenario-button" title="CyberGym benchmarking settings" onClick={onOpenBenchmarkingSettings}>
                <MoreVertical size={14} />
              </button>
            </div>
            {cyberGymProgram ? (
              <div className="program-session-list">
                {visibleCyberGymSessions.length > 0 ? (
                  visibleCyberGymSessions.map((session) => (
                    <div className="program-session-row" key={session.id}>
                      <SessionActiveIndicator status={session.status} />
                      <button
                        type="button"
                        className={`program-session-item ${selectedRunId === session.runId ? 'active' : ''}`}
                        title={promptSessionTitle(session)}
                        onClick={() => onOpenResearchSession(cyberGymProgram, session)}
                      >
                        <span className="program-session-title">{promptSessionTitle(session)}</span>
                        <span className="program-session-age">{shortRelativeAge(session.updatedAt)}</span>
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="program-session-empty">No Session Yet...</span>
                )}
                {cyberGymSessions.length > SIDEBAR_SESSION_LIMIT ? (
                  <button type="button" className="program-session-more" onClick={() => onShowMoreSessions(cyberGymProgram.id)}>
                    More Sessions...
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {regularPrograms.map((program) => {
          const active = snapshot?.workspace.workspacePath === program.workspacePath;
          const menuOpen = openProgramMenuId === program.id;
          const sessions = programRegistry ? researchSessionsForProgram(programRegistry, program) : [];
          const visibleSessions = sessions.slice(0, SIDEBAR_SESSION_LIMIT);
          return (
            <div className="program-group" key={program.id}>
              <div className={`program-item-row ${active ? 'active' : ''} ${menuOpen ? 'menu-open' : ''}`} data-program-menu-root>
                <button type="button" className="program-item" title={program.workspacePath} onClick={() => onOpenProgram(program)}>
                  <Terminal size={15} />
                  <span>{program.programName}</span>
                </button>
                <button
                  type="button"
                  className="program-menu-button"
                  title={`${program.programName} options`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetOpenProgramMenuId(menuOpen ? null : program.id);
                  }}
                >
                  <MoreVertical size={14} />
                </button>
                {menuOpen ? (
                  <div className="program-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onOpenProgramInfo(program);
                        onSetOpenProgramMenuId(null);
                      }}
                    >
                      Program Information
                    </button>
                    <button type="button" role="menuitem" className="danger" onClick={() => onRemoveProgram(program)}>
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="program-session-list">
                {visibleSessions.length > 0 ? (
                  visibleSessions.map((session) => (
                    <div className="program-session-row" key={session.id}>
                      <SessionActiveIndicator status={session.status} />
                      <button
                        type="button"
                        className={`program-session-item ${selectedRunId === session.runId ? 'active' : ''}`}
                        title={promptSessionTitle(session)}
                        onClick={() => onOpenResearchSession(program, session)}
                      >
                        <span className="program-session-title">{promptSessionTitle(session)}</span>
                        <span className="program-session-age">{shortRelativeAge(session.updatedAt)}</span>
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="program-session-empty">No Session Yet...</span>
                )}
                {sessions.length > SIDEBAR_SESSION_LIMIT ? (
                  <button type="button" className="program-session-more" onClick={() => onShowMoreSessions(program.id)}>
                    More Sessions...
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {!programRegistry && snapshot ? (
          <button type="button" className="program-item active" title={snapshot.workspace.workspacePath}>
            <Terminal size={15} />
            <span>{snapshot.activeScope.programName}</span>
          </button>
        ) : null}
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      <div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" onPointerDown={onResizePointerDown} />
    </aside>
  );
});

function isCyberGymProgram(program: ProgramRegistryEntry): boolean {
  return program.programName === CYBERGYM_PROGRAM_NAME && program.organizationName === CYBERGYM_PROGRAM_NAME;
}

function SessionActiveIndicator({ status }: { status: RunStatus }): JSX.Element {
  return (
    <span className="program-session-status" title={sessionStatusLabel(status)} aria-label={`Session status: ${sessionStatusLabel(status)}`}>
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
