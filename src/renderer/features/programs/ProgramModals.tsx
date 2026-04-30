import type { JSX } from 'react';
import type { ProgramRegistryEntry, ResearchSessionSummary } from '@shared/types';
import { Modal } from '../../app/Modal';
import { promptSessionTitle, shortRelativeAge } from '../../view-models/programDisplay';

export function ProgramInformationModal({ program, onClose }: { program: ProgramRegistryEntry; onClose: () => void }): JSX.Element {
  return (
    <Modal title="Program Information" wide onClose={onClose} footer={<button type="button" onClick={onClose}>Done</button>}>
      <div className="program-info-grid">
        <div>
          <span>Program</span>
          <strong>{program.programName}</strong>
        </div>
        <div>
          <span>Organization</span>
          <strong>{program.organizationName || 'None'}</strong>
        </div>
        <div>
          <span>Workspace</span>
          <strong>{program.workspacePath}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong>{program.networkProfile}</strong>
        </div>
        <div>
          <span>Authorization Expires</span>
          <strong>{program.expiresAt ?? 'Never'}</strong>
        </div>
        <div>
          <span>Research Sessions</span>
          <strong>{program.runCount}</strong>
        </div>
        <div className="program-info-block">
          <span>Description</span>
          <p>{program.descriptionMarkdown || 'No description recorded.'}</p>
        </div>
        <div className="program-info-block">
          <span>Scope and Rules</span>
          <p>{program.rulesMarkdown || 'No scope or rules recorded.'}</p>
        </div>
      </div>
    </Modal>
  );
}

export function ProgramSessionHistoryModal({
  program,
  sessions,
  selectedRunId,
  onClose,
  onOpenSession
}: {
  program: ProgramRegistryEntry;
  sessions: ResearchSessionSummary[];
  selectedRunId: string | null;
  onClose: () => void;
  onOpenSession: (session: ResearchSessionSummary) => void;
}): JSX.Element {
  return (
    <Modal title={`${program.programName} Sessions`} wide onClose={onClose} footer={<button type="button" onClick={onClose}>Done</button>}>
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
    </Modal>
  );
}
