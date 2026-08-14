import { memo } from 'react';
import type { JSX } from 'react';
import type { WorkspaceRegistryEntry, RunDetail } from '@shared/types';
import { displaySessionTitle } from '../../shared/sessionTitle';
import { useDevRenderProbe } from '../devInstrumentation';
import { displayBreakoutRoomTitle, displayWorkspaceHeaderName } from '../view-models/appHeader';

export const AppHeaderTitle = memo(function AppHeaderTitle({
  workspaceName,
  activeWorkspace,
  detail,
  breakoutRoomTitle,
  onOpenWorkspaceInfo,
  onOpenSessionSummary
}: {
  workspaceName: string;
  activeWorkspace: WorkspaceRegistryEntry | null;
  detail: RunDetail | null;
  breakoutRoomTitle?: string | null;
  onOpenWorkspaceInfo: (workspace: WorkspaceRegistryEntry) => void;
  onOpenSessionSummary: (detail: RunDetail) => void;
}): JSX.Element {
  const workspaceLabel = displayWorkspaceHeaderName(workspaceName);
  const sessionTitle = detail ? displaySessionTitle(detail.run.title, detail.run.promptMarkdown) : null;
  const breakoutRoomLabel = breakoutRoomTitle ? displayBreakoutRoomTitle(breakoutRoomTitle) : null;
  const headerSegments = [
    workspaceLabel,
    ...(sessionTitle ? [sessionTitle] : []),
    ...(breakoutRoomLabel ? [breakoutRoomLabel] : [])
  ];
  useDevRenderProbe('appHeaderTitle', () => ({
    workspace: workspaceLabel,
    run: detail?.run.id ?? 'none',
    breakoutRoom: breakoutRoomLabel ?? 'none'
  }));

  return (
    <div className="app-header-title" aria-label={headerSegments.join(', ')}>
      <div className="app-header-identity">
        <button
          type="button"
          className="app-header-workspace-title"
          title={activeWorkspace ? 'Open workspace information' : workspaceLabel}
          disabled={!activeWorkspace}
          onClick={() => {
            if (activeWorkspace) onOpenWorkspaceInfo(activeWorkspace);
          }}
        >
          <span>{workspaceLabel}</span>
        </button>
        {detail && sessionTitle ? (
          <>
            <span className="app-header-divider" aria-hidden="true" />
            <button type="button" className="app-header-session-title" title="View session summary" onClick={() => onOpenSessionSummary(detail)}>
              <span>{sessionTitle}</span>
            </button>
          </>
        ) : null}
        {breakoutRoomLabel ? (
          <>
            <span className="app-header-divider" aria-hidden="true" />
            <span className="app-header-breakout-room-title app-header-static-title" title={breakoutRoomLabel}>
              <span>{breakoutRoomLabel}</span>
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
});

export const StaticAppHeaderTitle = memo(function StaticAppHeaderTitle({
  primaryTitle,
  secondaryTitle
}: {
  primaryTitle: string;
  secondaryTitle: string;
}): JSX.Element {
  return (
    <div className="app-header-title" aria-label={`${primaryTitle}, ${secondaryTitle}`}>
      <div className="app-header-identity">
        <span className="app-header-workspace-title app-header-static-title">
          <span>{primaryTitle}</span>
        </span>
        <span className="app-header-divider" aria-hidden="true" />
        <span className="app-header-session-title app-header-static-title">
          <span>{secondaryTitle}</span>
        </span>
      </div>
    </div>
  );
});
