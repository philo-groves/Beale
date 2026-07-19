import { memo } from 'react';
import type { JSX } from 'react';
import type { WorkspaceRegistryEntry, RunDetail } from '@shared/types';
import { displaySessionTitle } from '../../shared/sessionTitle';
import { useDevRenderProbe } from '../devInstrumentation';
import { displayWorkspaceHeaderName } from '../view-models/appHeader';

export const AppHeaderTitle = memo(function AppHeaderTitle({
  workspaceName,
  activeWorkspace,
  detail,
  onOpenWorkspaceInfo,
  onOpenResearchPrompt
}: {
  workspaceName: string;
  activeWorkspace: WorkspaceRegistryEntry | null;
  detail: RunDetail | null;
  onOpenWorkspaceInfo: (workspace: WorkspaceRegistryEntry) => void;
  onOpenResearchPrompt: (detail: RunDetail) => void;
}): JSX.Element {
  const workspaceLabel = displayWorkspaceHeaderName(workspaceName);
  const sessionTitle = detail ? displaySessionTitle(detail.run.title, detail.run.promptMarkdown) : null;
  useDevRenderProbe('appHeaderTitle', () => ({ workspace: workspaceLabel, run: detail?.run.id ?? 'none' }));

  return (
    <div className="app-header-title" aria-label="Current workspace and session">
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
          <span className="app-header-title-separator" aria-hidden="true" />
          <button type="button" className="app-header-session-title" title="View original research prompt" onClick={() => onOpenResearchPrompt(detail)}>
            <span>{sessionTitle}</span>
          </button>
        </>
      ) : null}
    </div>
  );
});
