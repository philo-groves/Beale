import type { JSX } from 'react';
import type { ApprovalRecord, PolicyReviewDecision, RunDetail } from '@shared/types';
import { Modal } from '../../app/Modal';

export function pendingShellApproval(detail: RunDetail | null): ApprovalRecord | null {
  return detail?.policyEvents.find(
    (approval) => approval.requestKind === 'shell_command' && approval.decision === 'pending' && approval.decidedAt === null
  ) ?? null;
}

export function ShellApprovalModal({
  approval,
  busy,
  onDecision
}: {
  approval: ApprovalRecord;
  busy: boolean;
  onDecision: (decision: PolicyReviewDecision) => void;
}): JSX.Element {
  const command = approval.requestedAction.command && typeof approval.requestedAction.command === 'object'
    ? approval.requestedAction.command
    : approval.requestedAction;
  const agentPath = typeof approval.requestedAction.agentPath === 'string' ? approval.requestedAction.agentPath : null;
  const runTitle = typeof approval.requestedAction.runTitle === 'string' && approval.requestedAction.runTitle.trim()
    ? approval.requestedAction.runTitle.trim()
    : approval.runId;
  const workspaceName = typeof approval.requestedAction.workspaceName === 'string'
    && approval.requestedAction.workspaceName.trim()
    ? approval.requestedAction.workspaceName.trim()
    : null;

  return (
    <Modal
      title="Approve shell command?"
      className="shell-approval-modal"
      closeDisabled={busy}
      onClose={() => {
        if (!busy) onDecision('denied');
      }}
      footer={(
        <>
          <button type="button" className="secondary" disabled={busy} onClick={() => onDecision('denied')}>Deny</button>
          <button type="button" disabled={busy} onClick={() => onDecision('approved')}>Approve</button>
        </>
      )}
    >
      <p>Manual Approval pauses every shell command until you approve or deny it. Closing this dialog denies the command.</p>
      {workspaceName ? <p className="shell-approval-workspace">Workspace: {workspaceName}</p> : null}
      <p className="shell-approval-session">Session: {runTitle}</p>
      {agentPath ? <p className="shell-approval-agent">Requested by {agentPath}</p> : null}
      <pre className="shell-approval-command">{JSON.stringify(command, null, 2)}</pre>
    </Modal>
  );
}
