import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { displaySessionTitle } from '../../../shared/sessionTitle';
import { Modal } from '../../app/Modal';

export function ResearchPromptModal({ detail, onClose }: { detail: RunDetail; onClose: () => void }): JSX.Element {
  return (
    <Modal title="Original Research Prompt" wide onClose={onClose} footer={<button type="button" onClick={onClose}>Done</button>}>
      <div className="research-prompt-detail">
        <div className="research-prompt-title">
          <span>Session</span>
          <strong>{displaySessionTitle(detail.run.title, detail.run.promptMarkdown)}</strong>
        </div>
        <pre>{detail.run.promptMarkdown || 'No prompt recorded.'}</pre>
      </div>
    </Modal>
  );
}
