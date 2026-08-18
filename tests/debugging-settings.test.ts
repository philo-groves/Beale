import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceRegistry } from '../src/main/workspaceRegistry';

describe('debugging settings', () => {
  it('defaults trace retention off and persists explicit enablement', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-debugging-settings-'));
    try {
      const registry = new WorkspaceRegistry(directory);
      expect(registry.getDebuggingSettings()).toEqual({ tracesEnabled: false });
      expect(registry.setTracesEnabled(true)).toEqual({ tracesEnabled: true });
      registry.close();

      const reopened = new WorkspaceRegistry(directory);
      expect(reopened.getDebuggingSettings()).toEqual({ tracesEnabled: true });
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
