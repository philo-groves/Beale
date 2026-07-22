import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { displaySessionTitle } from '../../../shared/sessionTitle';
import { Modal } from '../../app/Modal';
import { sessionConfigPills } from '../../view-models/sessionHeader';

export function SessionSummaryModal({ detail, onClose }: { detail: RunDetail; onClose: () => void }): JSX.Element {
  const configPills = sessionConfigPills(detail);

  return (
    <Modal title="Session Summary" wide onClose={onClose} footer={<button type="button" onClick={onClose}>Done</button>}>
      <div className="research-prompt-detail">
        <div className="research-prompt-title">
          <span>Session</span>
          <strong>{displaySessionTitle(detail.run.title, detail.run.promptMarkdown)}</strong>
          <div className="session-summary-pills" aria-label="Session configuration">
            {configPills.map((pill) => (
              <span className="session-summary-pill" title={pill.tooltip} aria-label={pill.tooltip} key={pill.tooltip}>
                {pill.label}
              </span>
            ))}
          </div>
        </div>
        <span className="research-prompt-section-label">Original research prompt</span>
        <pre>{detail.run.promptMarkdown || 'No prompt recorded.'}</pre>
      </div>
    </Modal>
  );
}
