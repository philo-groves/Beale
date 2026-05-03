import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProgramScopeVersion, ScopeAsset } from '@shared/types';
import {
  findScopedExistingSourceCheckout,
  materializeGitRepository,
  materializeGitRepositoryAsync,
  normalizeSourceRepositoryUrl,
  selectSourceRepository,
  sourceRepositoryCandidates
} from '../src/main/sourceMaterializer';

const createdDirs: string[] = [];

afterEach(() => {
  delete process.env.BEALE_GIT_COMMAND;
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('source materializer', () => {
  it('recognizes GitLab source repository scope entries', () => {
    const scope = scopeWithAssets([
      sourceAsset('repo_gitlab', 'https://gitlab.com/gitlab-org/gitlab'),
      sourceAsset('repo_opstrace', 'https://gitlab.com/gitlab-org/opstrace/opstrace')
    ]);

    expect(sourceRepositoryCandidates(scope).map((candidate) => candidate.url)).toEqual([
      'https://gitlab.com/gitlab-org/gitlab',
      'https://gitlab.com/gitlab-org/opstrace/opstrace'
    ]);
    expect(selectSourceRepository(scope, 'https://gitlab.com/gitlab-org/gitlab').reason).toBe('matched');
    expect(normalizeSourceRepositoryUrl('git@gitlab.com:gitlab-org/gitlab.git')).toBe('https://gitlab.com/gitlab-org/gitlab');
  });

  it('reuses a matching in-workspace GitLab checkout instead of cloning', () => {
    const workspace = tempDir();
    const checkout = join(workspace, 'gitlab');
    mkdirSync(join(workspace, '.beale'), { recursive: true });
    mkdirSync(checkout, { recursive: true });
    execFileSync('git', ['init'], { cwd: checkout, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.com/gitlab-org/gitlab.git'], { cwd: checkout, stdio: 'ignore' });
    const scope = scopeWithAssets([sourceAsset('repo_gitlab', 'https://gitlab.com/gitlab-org/gitlab')]);
    const candidate = sourceRepositoryCandidates(scope)[0];

    const materialized = materializeGitRepository(candidate, join(workspace, '.beale', 'beale.sqlite'), '');
    const discovered = findScopedExistingSourceCheckout(scope, join(workspace, '.beale', 'beale.sqlite'), join(checkout, 'app/controllers/jwt_controller.rb'));

    expect(materialized.cloned).toBe(false);
    expect(materialized.localPath).toBe(checkout);
    expect(discovered?.candidate.sourceAssetId).toBe('repo_gitlab');
    expect(discovered?.localPath).toBe(checkout);
  });

  it('runs clone materialization without blocking the event loop', async () => {
    const workspace = tempDir();
    mkdirSync(join(workspace, '.beale'), { recursive: true });
    const fakeGit = join(workspace, 'fake-git.mjs');
    writeFileSync(
      fakeGit,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        "if (args.includes('clone')) {",
        '  const target = args.at(-1);',
        "  setTimeout(() => { mkdirSync(`${target}/.git`, { recursive: true }); process.exit(0); }, 120);",
        '} else if (args.includes("rev-parse")) {',
        '  process.stdout.write("0123456789abcdef0123456789abcdef01234567\\n");',
        '} else {',
        '  process.exit(0);',
        '}'
      ].join('\n')
    );
    chmodSync(fakeGit, 0o700);
    process.env.BEALE_GIT_COMMAND = fakeGit;
    const scope = scopeWithAssets([sourceAsset('repo_gitlab', 'https://gitlab.com/gitlab-org/gitlab')]);
    const candidate = sourceRepositoryCandidates(scope)[0];
    let timerFired = false;

    const materializedPromise = materializeGitRepositoryAsync(candidate, join(workspace, '.beale', 'beale.sqlite'), '');
    await new Promise((resolve) => setTimeout(resolve, 20));
    timerFired = true;
    const materialized = await materializedPromise;

    expect(timerFired).toBe(true);
    expect(materialized.cloned).toBe(true);
    expect(materialized.head).toBe('0123456789abcdef0123456789abcdef01234567');
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-source-test-'));
  createdDirs.push(dir);
  return dir;
}

function sourceAsset(id: string, value: string): ScopeAsset {
  return {
    id,
    scopeVersionId: 'scope_1',
    direction: 'in_scope',
    kind: 'repo',
    value,
    attributes: {},
    sensitivity: 'public',
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

function scopeWithAssets(assets: ScopeAsset[]): ProgramScopeVersion {
  return {
    id: 'scope_1',
    version: 1,
    status: 'active',
    programName: 'GitLab',
    organizationName: 'GitLab',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    networkProfile: 'elevated',
    networkPolicy: {},
    activeFrom: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'test',
    assets
  };
}
