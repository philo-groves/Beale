import { memo } from 'react';
import type { JSX } from 'react';
import { CalendarClock, FileText, Folder, Plug, Settings } from 'lucide-react';
import type { RunDetail } from '@shared/types';
import { displaySessionTitle } from '../../shared/sessionTitle';
import { useDevRenderProbe } from '../devInstrumentation';
import { displayBreakoutRoomTitle, displayWorkspaceHeaderName } from '../view-models/appHeader';

export type AppHeaderViewIcon = 'automations' | 'plugins' | 'reporting' | 'settings';

export const AppHeaderTitle = memo(function AppHeaderTitle({
  workspaceName,
  detail,
  breakoutRoomTitle
}: {
  workspaceName: string;
  detail: RunDetail | null;
  breakoutRoomTitle?: string | null;
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
        <span className="app-header-workspace-title app-header-static-title" title={workspaceLabel}>
          <Folder className="app-header-view-icon" size={15} aria-hidden="true" />
          <span>{workspaceLabel}</span>
        </span>
        {detail && sessionTitle ? (
          <>
            <span className="app-header-divider" aria-hidden="true" />
            <span className="app-header-session-title app-header-static-title" title={sessionTitle}>
              <span>{sessionTitle}</span>
            </span>
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
  secondaryTitle,
  icon
}: {
  primaryTitle: string;
  secondaryTitle: string;
  icon: AppHeaderViewIcon;
}): JSX.Element {
  const HeaderIcon = {
    automations: CalendarClock,
    plugins: Plug,
    reporting: FileText,
    settings: Settings
  }[icon];

  return (
    <div className="app-header-title" aria-label={`${primaryTitle}, ${secondaryTitle}`}>
      <div className="app-header-identity">
        <span className="app-header-workspace-title app-header-static-title">
          <HeaderIcon className="app-header-view-icon" size={15} aria-hidden="true" />
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
