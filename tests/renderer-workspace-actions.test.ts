import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '@shared/types';
import { researchSessionNeedsLoading } from '../src/renderer/hooks/useWorkspaceActions';

describe('renderer workspace actions', () => {
  it('preserves live detail when opening a room from the already selected session', () => {
    const snapshot = {
      workspace: { workspacePath: 'C:\\research\\snapchat' }
    } as WorkspaceSnapshot;
    const workspace = { workspacePath: 'C:\\research\\snapchat' };
    const session = { runId: 'run_selected' };

    expect(researchSessionNeedsLoading(snapshot, 'run_selected', workspace, session)).toBe(false);
    expect(researchSessionNeedsLoading(snapshot, 'run_other', workspace, session)).toBe(true);
    expect(researchSessionNeedsLoading(snapshot, 'run_selected', { workspacePath: 'C:\\research\\other' }, session)).toBe(true);
  });
});
