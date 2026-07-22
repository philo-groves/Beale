import { memo } from 'react';
import type { JSX } from 'react';
import type { WorkspaceRegistryEntry, RunDetail, TraceEventRecord } from '@shared/types';
import { displaySessionTitle } from '../../shared/sessionTitle';
import { useDevRenderProbe } from '../devInstrumentation';
import type { TraceCategoryId } from '../traceClassification';
import { SessionMetrics } from '../features/sessions/SessionMetrics';
import { displayWorkspaceHeaderName } from '../view-models/appHeader';

export const AppHeaderTitle = memo(function AppHeaderTitle({
  workspaceName,
  activeWorkspace,
  detail,
  events,
  visibleTraceCategories,
  onOpenWorkspaceInfo,
  onOpenSessionSummary
}: {
  workspaceName: string;
  activeWorkspace: WorkspaceRegistryEntry | null;
  detail: RunDetail | null;
  events: TraceEventRecord[];
  visibleTraceCategories: TraceCategoryId[];
  onOpenWorkspaceInfo: (workspace: WorkspaceRegistryEntry) => void;
  onOpenSessionSummary: (detail: RunDetail) => void;
}): JSX.Element {
  const workspaceLabel = displayWorkspaceHeaderName(workspaceName);
  const sessionTitle = detail ? displaySessionTitle(detail.run.title, detail.run.promptMarkdown) : null;
  useDevRenderProbe('appHeaderTitle', () => ({ workspace: workspaceLabel, run: detail?.run.id ?? 'none' }));

  return (
    <div className="app-header-title" aria-label="Current workspace and session">
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
          <button type="button" className="app-header-session-title" title="View session summary" onClick={() => onOpenSessionSummary(detail)}>
            <span>{sessionTitle}</span>
          </button>
        ) : null}
      </div>
      {detail ? <SessionMetrics detail={detail} events={events} visibleTraceCategories={visibleTraceCategories} /> : null}
    </div>
  );
});
