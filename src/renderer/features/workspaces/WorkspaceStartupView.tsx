import type { JSX } from 'react';
import { FolderPlus, LoaderCircle } from 'lucide-react';
import type { WorkspaceStartupPhase } from '../../hooks/useWorkspaceRuntime';

export function WorkspaceStartupView({
  phase,
  onAddWorkspace
}: {
  phase: WorkspaceStartupPhase;
  onAddWorkspace: () => void;
}): JSX.Element {
  const loading = phase !== 'ready';
  const message = phase === 'workspace'
    ? 'Opening your last workspace…'
    : 'Loading workspaces…';

  return (
    <main className="workspace-startup-view" aria-busy={loading} aria-label="Workspace startup">
      <div className="workspace-startup-content">
        {loading ? (
          <>
            <LoaderCircle className="workspace-startup-spinner" aria-hidden="true" size={20} />
            <strong>No Workspace Selected</strong>
            <span role="status" aria-live="polite">{message}</span>
          </>
        ) : (
          <>
            <strong>No Workspace Selected</strong>
            <span>Choose a known workspace from the sidebar or add one to begin.</span>
            <button type="button" onClick={onAddWorkspace}>
              <FolderPlus aria-hidden="true" size={15} />
              Add Workspace
            </button>
          </>
        )}
      </div>
    </main>
  );
}
