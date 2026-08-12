import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getWorkspaceDejunkSummary,
  invalidateWorkspaceDejunkSummary,
  runWorkspaceDejunk
} from '../src/main/workspaceDejunk';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('workspace Dejunk', () => {
  it('starts an existing workspace from a zero-file baseline', () => {
    const workspace = temporaryWorkspace();
    writeFileSync(join(workspace, 'existing-research.txt'), 'already present');

    expect(getWorkspaceDejunkSummary(workspace)).toEqual(expect.objectContaining({
      newFileCount: 0,
      newFileCountCapped: false,
      lastRun: null
    }));
    expect(existsSync(join(workspace, '.beale', 'dejunk.json'))).toBe(true);
  });

  it('tracks files created after the persisted housekeeping baseline', () => {
    const workspace = temporaryWorkspace();
    writeDejunkBaseline(workspace, '2026-08-12T10:00:00.000Z');
    writeFileSync(join(workspace, 'new-research-file.txt'), 'new');
    mkdirSync(join(workspace, 'nested-repository', '.git'), { recursive: true });
    writeFileSync(join(workspace, 'nested-repository', 'ignored-source'), 'ignored');
    invalidateWorkspaceDejunkSummary(workspace);

    expect(getWorkspaceDejunkSummary(workspace)).toEqual(expect.objectContaining({
      available: true,
      newFileCount: 1,
      newFileCountCapped: false,
      baselineAt: '2026-08-12T10:00:00.000Z'
    }));
  });

  it('organizes recognizable loose research and removes a large extracted IPSW tree', () => {
    const workspace = temporaryWorkspace();
    writeDejunkBaseline(workspace, '2026-08-12T10:00:00.000Z');
    writeFileSync(join(workspace, 'research-notes.md'), 'notes');
    writeFileSync(join(workspace, 'poc-trigger.py'), 'print("poc")');
    writeFileSync(join(workspace, 'capture.log'), 'evidence');

    const protectedRepository = join(workspace, 'target-source');
    mkdirSync(join(protectedRepository, '.git'), { recursive: true });
    writeFileSync(join(protectedRepository, 'poc-do-not-move.py'), 'tracked workspace material');

    const extractedIpsw = join(workspace, 'phone-ipsw-extracted');
    mkdirSync(join(extractedIpsw, 'Firmware'), { recursive: true });
    writeFileSync(join(extractedIpsw, 'BuildManifest.plist'), 'manifest');
    const reclaimablePath = join(extractedIpsw, 'Firmware', 'reclaimable.bin');
    writeFileSync(reclaimablePath, '');
    truncateSync(reclaimablePath, 128 * 1024 * 1024 + 1);

    const summary = runWorkspaceDejunk(workspace);

    expect(existsSync(join(workspace, 'research', 'notes', 'research-notes.md'))).toBe(true);
    expect(existsSync(join(workspace, 'research', 'pocs', 'poc-trigger.py'))).toBe(true);
    expect(existsSync(join(workspace, 'research', 'evidence', 'capture.log'))).toBe(true);
    expect(existsSync(join(protectedRepository, 'poc-do-not-move.py'))).toBe(true);
    expect(existsSync(extractedIpsw)).toBe(false);
    expect(summary.newFileCount).toBe(0);
    expect(summary.lastRun).toEqual(expect.objectContaining({
      status: 'completed',
      movedFileCount: 3,
      deletedPathCount: 1,
      reclaimedBytes: expect.any(Number),
      errorMessage: null
    }));
    expect(summary.lastRun?.reclaimedBytes ?? 0).toBeGreaterThan(128 * 1024 * 1024);
  });

  it('does not reorganize or delete inside a workspace that is itself a repository', () => {
    const workspace = temporaryWorkspace();
    mkdirSync(join(workspace, '.git'));
    writeFileSync(join(workspace, 'research-notes.md'), 'keep in place');
    const extractedIpsw = join(workspace, 'ipsw-extracted');
    mkdirSync(join(extractedIpsw, 'Firmware'), { recursive: true });
    writeFileSync(join(extractedIpsw, 'BuildManifest.plist'), 'manifest');
    const reclaimablePath = join(extractedIpsw, 'Firmware', 'reclaimable.bin');
    writeFileSync(reclaimablePath, '');
    truncateSync(reclaimablePath, 128 * 1024 * 1024 + 1);

    const summary = runWorkspaceDejunk(workspace);

    expect(existsSync(join(workspace, 'research-notes.md'))).toBe(true);
    expect(existsSync(extractedIpsw)).toBe(true);
    expect(summary.lastRun).toEqual(expect.objectContaining({ movedFileCount: 0, deletedPathCount: 0 }));
  });
});

function temporaryWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'beale-dejunk-test-'));
  createdDirectories.push(workspace);
  mkdirSync(join(workspace, '.beale'), { recursive: true });
  return workspace;
}

function writeDejunkBaseline(workspace: string, baselineAt: string): void {
  writeFileSync(join(workspace, '.beale', 'dejunk.json'), JSON.stringify({
    version: 1,
    baselineAt,
    lastRun: null
  }));
}
