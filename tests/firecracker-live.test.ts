import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/main/workspaceService';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(process.env.BEALE_FIRECRACKER_LIVE_TEST !== '1')('Firecracker live executor', () => {
  it('runs executor_alpha through the real Firecracker vmctl controller', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beale-firecracker-live-'));
    createdDirs.push(workspace);
    const targetDir = join(workspace, 'target');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'target.txt'), 'real firecracker service target\n');

    const service = new WorkspaceService();
    try {
      service.createWorkspace(workspace);
      service.saveProgramScope({
        programName: 'Firecracker Live Program',
        organizationName: 'Local',
        descriptionMarkdown: 'Firecracker executor live smoke.',
        rulesMarkdown: 'Offline microVM execution only.',
        networkProfile: 'offline',
        expiresAt: null,
        assets: [{ direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} }]
      });

      const snapshot = service.startRun({
        runEngine: 'executor_alpha',
        promptMarkdown: '# Firecracker executor alpha\nRun through the real Firecracker controller.',
        mode: 'open_discovery',
        attemptStrategy: 'single_path',
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        networkProfile: 'offline',
        sandboxProfile: 'local_disposable_vm',
        budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0 },
        fakeScenario: 'adaptive_portfolio'
      });
      const detail = service.getRunDetail(snapshot.runs[0].run.id);

      expect(detail.run.status).toBe('completed');
      expect(detail.vmContexts[0].backend).toBe('vmctl');
      expect(detail.vmContexts[0].state).toBe('destroyed');
      expect(detail.traceEvents.some((event) => event.summary === 'Guest shell operation finished with success.')).toBe(true);
      expect(detail.traceEvents.some((event) => event.summary === 'Guest python operation finished with success.')).toBe(true);
      expect(detail.artifacts.some((artifact) => artifact.kind === 'executor_smoke')).toBe(true);
    } finally {
      service.close();
    }
  }, 60_000);
});
