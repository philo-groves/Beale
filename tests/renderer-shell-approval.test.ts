import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApprovalRecord, RunDetail } from '@shared/types';
import {
  isAutoReviewOverrideApproval,
  isInlineApproval,
  pendingShellApproval,
  ShellApprovalModal,
  ShellApprovalQuestion
} from '../src/renderer/features/sessions/ShellApprovalModal';

describe('renderer shell approval modal', () => {
  it('shows the bounded command audit and researcher choices', () => {
    const html = renderApproval(false);

    expect(html).toContain('Approve shell command?');
    expect(html).toContain('Manual Approval pauses every shell command');
    expect(html).toContain('Workspace: Example Workspace');
    expect(html).toContain('Session: Parser boundary review');
    expect(html).toContain('Requested by root/reviewer');
    expect(html).toContain('&quot;utility&quot;: &quot;rm&quot;');
    expect(html).toContain('&quot;stdinHash&quot;: &quot;sha256:fixture&quot;');
    expect(html).toContain('>Deny</button>');
    expect(html).toContain('>Approve</button>');
  });

  it('disables close and both decisions while a decision is in flight', () => {
    const html = renderApproval(true);

    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it('renders an Auto-Review override as an inline Approve Once question', () => {
    const approval = approvalRecord({
      approvalKind: 'auto_review_override',
      mode: 'auto_review',
      reviewReason: 'The temporary target executable needs researcher confirmation.'
    });
    const html = renderToStaticMarkup(createElement(ShellApprovalQuestion, {
      approval,
      busy: false,
      onDecision: () => undefined
    }));

    expect(isAutoReviewOverrideApproval(approval)).toBe(true);
    expect(html).toContain('aria-label="Approve shell command once"');
    expect(html).toContain('Approve this command once?');
    expect(html).toContain('The temporary target executable needs researcher confirmation.');
    expect(html).toContain('>Keep Blocked</button>');
    expect(html).toContain('class="primary-button">Approve Once</button>');
    expect(html).not.toContain('class="modal-overlay"');
  });

  it('renders Every Action computer use as a concise inline approval', () => {
    const approval = approvalRecord({
      permissionMode: 'every_action',
      targetBinary: 'calculator',
      toolName: 'click'
    }, 'computer_use');
    const html = renderToStaticMarkup(createElement(ShellApprovalQuestion, {
      approval,
      busy: false,
      onDecision: () => undefined
    }));

    expect(isInlineApproval(approval)).toBe(true);
    expect(html).toContain('aria-label="Approve computer action"');
    expect(html).toContain('Approve this computer action?');
    expect(html).toContain('click in calculator.');
    expect(html).toContain('>Approve Once</button>');
    expect(html).not.toContain('class="modal-overlay"');
  });

  it('explains that Once Per Session approval is bound to the target binary', () => {
    const approval = approvalRecord({
      permissionMode: 'once_per_session',
      targetBinary: 'calculator',
      toolName: 'click'
    }, 'computer_use');
    const html = renderToStaticMarkup(createElement(ShellApprovalQuestion, {
      approval,
      busy: false,
      onDecision: () => undefined
    }));

    expect(html).toContain('Allow calculator for this session?');
    expect(html).toContain('later computer actions targeting calculator.');
    expect(html).toContain('>Allow for Session</button>');
  });

  it('surfaces pending approvals only while their session is active', () => {
    const approval = approvalRecord();
    const detail = {
      run: { id: approval.runId, status: 'active' },
      policyEvents: [approval]
    } as RunDetail;

    expect(pendingShellApproval(detail)?.id).toBe(approval.id);
    expect(pendingShellApproval({
      ...detail,
      run: { ...detail.run, status: 'completed' }
    })).toBeNull();
  });
});

function renderApproval(busy: boolean): string {
  return renderToStaticMarkup(createElement(ShellApprovalModal, {
    approval: approvalRecord(),
    busy,
    onDecision: () => undefined
  }));
}

function approvalRecord(
  requestedActionPatch: Record<string, unknown> = {},
  requestKind: ApprovalRecord['requestKind'] = 'shell_command'
): ApprovalRecord {
  return {
    id: 'approval_fixture',
    runId: 'run_fixture',
    attemptId: 'attempt_fixture',
    requestKind,
    requestedAction: {
      approvalRequestId: 'shell_approval_fixture',
      workspaceName: 'Example Workspace',
      workspacePath: '/workspace/example',
      runTitle: 'Parser boundary review',
      agentPath: 'root/reviewer',
      command: {
        utility: 'rm',
        args: ['-rf', 'build'],
        cwd: '/workspace',
        stdinPresent: true,
        stdinBytes: 7,
        stdinHash: 'sha256:fixture'
      },
      ...requestedActionPatch
    },
    decision: 'pending',
    reason: 'Waiting for manual researcher approval before shell execution.',
    scopeAmendmentId: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    decidedAt: null
  };
}
