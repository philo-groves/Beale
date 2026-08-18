import { readFileSync } from 'node:fs';
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

  it('uses an action response as the authoritative snapshot without immediate reloads', () => {
    const source = readFileSync(
      new URL('../src/renderer/App.tsx', import.meta.url),
      'utf8'
    );
    const start = source.indexOf('  const runAction = useCallback(');
    const end = source.indexOf('  const openNotification = useCallback(', start);
    const runActionSource = source.slice(start, end);

    expect(runActionSource).toContain('if (next) applySnapshot(next);');
    expect(runActionSource).toContain('else await loadSnapshot();');
    expect(runActionSource).not.toContain('loadWorkspaceRegistry');
  });

  it('does not reload the registry after opening a workspace that already synchronized it', () => {
    const source = readFileSync(
      new URL('../src/renderer/hooks/useWorkspaceActions.ts', import.meta.url),
      'utf8'
    );
    const start = source.indexOf('  const openRegisteredWorkspace = useCallback(');
    const end = source.indexOf('  const openResearchSession = useCallback(', start);

    expect(source.slice(start, end)).toContain('{ reloadRegistry: false }');
  });
});
