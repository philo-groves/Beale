import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApprovalRecord } from '@shared/types';
import { ShellApprovalModal } from '../src/renderer/features/sessions/ShellApprovalModal';

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
});

function renderApproval(busy: boolean): string {
  const approval: ApprovalRecord = {
    id: 'approval_fixture',
    runId: 'run_fixture',
    attemptId: 'attempt_fixture',
    requestKind: 'shell_command',
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
      }
    },
    decision: 'pending',
    reason: 'Waiting for manual researcher approval before shell execution.',
    scopeAmendmentId: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    decidedAt: null
  };
  return renderToStaticMarkup(createElement(ShellApprovalModal, {
    approval,
    busy,
    onDecision: () => undefined
  }));
}
