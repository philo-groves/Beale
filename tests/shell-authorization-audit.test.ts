import { describe, expect, it } from 'vitest';
import { shellAuthorizationAuditPayload } from '../src/main/honeycrispRunEngine';

describe('shell authorization audit projection', () => {
  it('retains only the typed Auto-Review failure diagnostic', () => {
    const projected = shellAuthorizationAuditPayload({
      mode: 'auto_review',
      actionId: 'shell_action_1',
      command: {
        commandHash: 'sha256:example',
        utility: 'git',
        args: ['status'],
        cwd: 'C:\\workspace',
        timeoutMs: 1_000,
        stdinPresent: false,
        stdinBytes: 0
      },
      reviewer: {
        provider: 'xai',
        model: 'grok-4.3',
        reasoningEffort: 'medium'
      },
      reviewFailure: {
        category: 'invalid_schema',
        phase: 'response',
        attempts: 2,
        providerDetail: 'must-not-survive'
      }
    });

    expect(projected.reviewFailure).toEqual({
      category: 'invalid_schema',
      phase: 'response',
      attempts: 2
    });
    expect(JSON.stringify(projected)).not.toContain('must-not-survive');
  });

  it('drops unrecognized or unbounded Auto-Review failure diagnostics', () => {
    expect(shellAuthorizationAuditPayload({
      command: {},
      reviewFailure: { category: 'raw_provider_error', phase: 'response', attempts: 2 }
    })).not.toHaveProperty('reviewFailure');
    expect(shellAuthorizationAuditPayload({
      command: {},
      reviewFailure: { category: 'timeout', phase: 'request', attempts: 1_000 }
    })).not.toHaveProperty('reviewFailure');
  });
});
