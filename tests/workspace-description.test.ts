import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/main/workspaceService';
import { defaultsForWorkspaceDirectory } from '../src/main/workspaceRegistry';
import { migrateWorkspaceDescription } from '../src/main/workspaceDescription';
import { resolvedTestResearchProfile } from './researchProfileFixture';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('workspace guidance', () => {
  it('migrates a legacy stored description only when AGENTS.md is missing', () => {
    const workspace = temporaryDirectory();

    expect(migrateWorkspaceDescription(workspace, '# Legacy description\n')).toBe(true);
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toBe('# Legacy description\n');
    expect(migrateWorkspaceDescription(workspace, '# Replacement\n')).toBe(false);
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toBe('# Legacy description\n');
  });

  it('loads existing AGENTS.md content into onboarding defaults', () => {
    const workspace = temporaryDirectory();
    writeFileSync(join(workspace, 'AGENTS.md'), '# Existing workspace instructions\n', 'utf8');

    expect(defaultsForWorkspaceDirectory(workspace).descriptionMarkdown)
      .toBe('# Existing workspace instructions\n');
  });

  it('reads and writes the description through the primary workspace AGENTS.md', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'AGENTS.md'), '# Initial instructions\n', 'utf8');
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile()
    });

    try {
      const opened = service.createWorkspace(workspace);
      expect(opened.activeScope.descriptionMarkdown).toBe('# Initial instructions\n');

      const saved = service.saveScope({
        workspaceName: 'Pass-through Workspace',
        scopeOwner: opened.activeScope.scopeOwner,
        descriptionMarkdown: '# Updated instructions\n\nKeep this file portable.\n',
        rulesMarkdown: opened.activeScope.rulesMarkdown,
        expiresAt: opened.activeScope.expiresAt,
        assets: []
      });

      expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8'))
        .toBe('# Updated instructions\n\nKeep this file portable.\n');
      expect(saved.activeScope.descriptionMarkdown)
        .toBe('# Updated instructions\n\nKeep this file portable.\n');

      writeFileSync(join(workspace, 'AGENTS.md'), '# Changed outside Beale\n', 'utf8');
      expect(service.getSnapshot()?.activeScope.descriptionMarkdown).toBe('# Changed outside Beale\n');
    } finally {
      service.close();
    }
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'beale-workspace-description-'));
  createdDirectories.push(directory);
  return directory;
}
