import type { JSX } from 'react';
import type { WorkspaceRegistryEntry, ResearchSessionSummary } from '@shared/types';
import { BottomSheet } from '../../app/Modal';
import { promptSessionTitle, shortRelativeAge } from '../../view-models/workspaceDisplay';

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

export function WorkspaceSessionHistorySheet({
  workspace,
  sessions,
  selectedRunId,
  onClose,
  onOpenSession
}: {
  workspace: WorkspaceRegistryEntry;
  sessions: ResearchSessionSummary[];
  selectedRunId: string | null;
  onClose: () => void;
  onOpenSession: (session: ResearchSessionSummary) => void;
}): JSX.Element {
  return (
    <BottomSheet title={`${workspace.workspaceName} Sessions`} wide onClose={onClose}>
      <div className="session-history-list">
        {sessions.length > 0 ? (
          sessions.map((session) => (
            <button
              type="button"
              className={`session-history-item ${selectedRunId === session.runId ? 'active' : ''}`}
              key={session.id}
              onClick={() => onOpenSession(session)}
            >
              <span className="session-history-title">{promptSessionTitle(session)}</span>
              <span className="session-history-meta">
                {session.status} · Updated {shortRelativeAge(session.updatedAt)}
              </span>
            </button>
          ))
        ) : (
          <span className="session-history-empty">No Session Yet...</span>
        )}
      </div>
    </BottomSheet>
  );
}
