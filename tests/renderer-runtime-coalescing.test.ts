import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('renderer runtime update coalescing', () => {
  it('keeps only the latest snapshot and registry event per animation frame', () => {
    const source = readFileSync(
      new URL('../src/renderer/hooks/useWorkspaceRuntime.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('pendingSnapshotRef.current = next;');
    expect(source).toContain('pendingWorkspaceRegistryRef.current = next;');
    expect(source).toContain('window.requestAnimationFrame(() => {');
    expect(source).toContain('startTransition(() => applySnapshot(latest));');
    expect(source).toContain('startTransition(() => setWorkspaceRegistry(latest));');
  });

  it('aborts a superseded main-process detail read before starting another', () => {
    const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');

    expect(source).toContain('withLatestRunDetailRequest(event, (signal) =>');
    expect(source).toContain('cancelRunDetailRequest(senderId);');
    expect(source).toContain('controller.abort();');
    expect(source).toContain('IPC_CHANNELS.cancelRunDetailRequests');
  });
});
