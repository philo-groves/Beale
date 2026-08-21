import type { JSX } from 'react';
import { FolderPlus } from 'lucide-react';
import { BealeWelcomeIcon } from '../../app/BealeWelcomeIcon';

export function WorkspaceStartupView({
  onAddWorkspace
}: {
  onAddWorkspace: () => void;
}): JSX.Element {
  return (
    <main className="workspace-startup-view" aria-busy="false" aria-label="No workspace selected">
      <div className="workspace-startup-content">
        <BealeWelcomeIcon />
        <strong>No Workspace Selected</strong>
        <span>Choose a known workspace from the sidebar or add one to begin.</span>
        <button type="button" onClick={onAddWorkspace}>
          <FolderPlus aria-hidden="true" size={15} />
          Add Workspace
        </button>
      </div>
    </main>
  );
}
