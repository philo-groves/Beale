import { useLayoutEffect, useRef } from 'react';
import type { JSX } from 'react';
import type { ApprovalRecord, PolicyReviewDecision, RunDetail } from '@shared/types';
import { Modal } from '../../app/Modal';

export function pendingShellApproval(detail: RunDetail | null): ApprovalRecord | null {
  if (detail?.run.status !== 'active') return null;
  return detail?.policyEvents.find(
    (approval) => ['shell_command', 'computer_use'].includes(approval.requestKind)
      && approval.decision === 'pending'
      && approval.decidedAt === null
  ) ?? null;
}

export function isAutoReviewOverrideApproval(approval: ApprovalRecord | null): boolean {
  return approval?.requestedAction.approvalKind === 'auto_review_override';
}

export function isInlineApproval(approval: ApprovalRecord | null): boolean {
  return approval?.requestKind === 'computer_use' || isAutoReviewOverrideApproval(approval);
}

export function ShellApprovalQuestion({
  approval,
  busy,
  onDecision
}: {
  approval: ApprovalRecord;
  busy: boolean;
  onDecision: (decision: PolicyReviewDecision) => void;
}): JSX.Element {
  const footerRef = useRef<HTMLElement | null>(null);
  const computerUse = approval.requestKind === 'computer_use';
  const permissionMode = approval.requestedAction.permissionMode;
  const targetBinary = typeof approval.requestedAction.targetBinary === 'string'
    ? approval.requestedAction.targetBinary
    : null;
  const toolName = typeof approval.requestedAction.toolName === 'string'
    ? approval.requestedAction.toolName
    : 'act';
  const sessionBinaryGrant = computerUse && permissionMode === 'once_per_session' && targetBinary;
  const reviewReason = typeof approval.requestedAction.reviewReason === 'string'
    && approval.requestedAction.reviewReason.trim()
    ? approval.requestedAction.reviewReason.trim()
    : 'Auto-Review did not approve this command.';

  useLayoutEffect(() => {
    const sessionView = footerRef.current?.parentElement;
    if (!sessionView) return undefined;
    sessionView.style.removeProperty('--trace-footer-height');
    sessionView.style.setProperty('--trace-footer-content-height', 'var(--trace-footer-min-height)');
    return () => {
      sessionView.style.removeProperty('--trace-footer-content-height');
    };
  }, [approval.id]);

  return (
    <footer
      ref={footerRef}
      className="main-trace-footer shell-approval-question"
      aria-label={computerUse ? 'Approve computer action' : 'Approve shell command once'}
    >
      <div className="shell-approval-question-surface">
        <div className="shell-approval-question-content">
          <strong>{sessionBinaryGrant
            ? `Allow ${targetBinary} for this session?`
            : computerUse ? 'Approve this computer action?' : 'Approve this command once?'}</strong>
          <span>{sessionBinaryGrant
            ? `Allow this and later computer actions targeting ${targetBinary}.`
            : computerUse
              ? `${toolName} in ${targetBinary ?? 'the target application'}.`
              : reviewReason}</span>
        </div>
        <div className="shell-approval-question-actions">
          <button type="button" disabled={busy} onClick={() => onDecision('denied')}>Keep Blocked</button>
          <button type="button" className="primary-button" disabled={busy} onClick={() => onDecision('approved')}>
            {sessionBinaryGrant ? 'Allow for Session' : 'Approve Once'}
          </button>
        </div>
      </div>
    </footer>
  );
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
  const computerUse = approval.requestKind === 'computer_use';
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
      title={computerUse ? 'Approve computer-use action?' : 'Approve shell command?'}
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
      <p>{computerUse
        ? 'This Windows UI mutation runs only after one explicit approval. Closing this dialog denies the action.'
        : 'Manual Approval pauses every shell command until you approve or deny it. Closing this dialog denies the command.'}</p>
      {workspaceName ? <p className="shell-approval-workspace">Workspace: {workspaceName}</p> : null}
      <p className="shell-approval-session">Session: {runTitle}</p>
      {agentPath ? <p className="shell-approval-agent">Requested by {agentPath}</p> : null}
      <pre className="shell-approval-command">{JSON.stringify(command, null, 2)}</pre>
    </Modal>
  );
}
