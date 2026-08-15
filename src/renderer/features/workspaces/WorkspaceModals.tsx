import type { JSX } from 'react';
import type { WorkspaceRegistryEntry } from '@shared/types';
import { BottomSheet } from '../../app/Modal';

export function WorkspaceInformationModal({ workspace, onClose }: { workspace: WorkspaceRegistryEntry; onClose: () => void }): JSX.Element {
  return (
    <BottomSheet title="Workspace Information" wide onClose={onClose}>
      <div className="workspace-info-grid">
        <div>
          <span>Workspace</span>
          <strong>{workspace.workspaceName}</strong>
        </div>
        <div>
          <span>Scope Owner or Subject</span>
          <strong>{workspace.scopeOwner || 'None'}</strong>
        </div>
        <div>
          <span>Directory</span>
          <strong>{workspace.workspacePath}</strong>
        </div>
        <div>
          <span>Authorization Expires</span>
          <strong>{workspace.expiresAt ?? 'Never'}</strong>
        </div>
        <div>
          <span>Research Sessions</span>
          <strong>{workspace.runCount}</strong>
        </div>
        <div className="workspace-info-block">
          <span>Description</span>
          <p>{workspace.descriptionMarkdown || 'No description recorded.'}</p>
        </div>
        <div className="workspace-info-block">
          <span>Scope and Rules</span>
          <p>{workspace.rulesMarkdown || 'No scope or rules recorded.'}</p>
        </div>
      </div>
    </BottomSheet>
  );
}
