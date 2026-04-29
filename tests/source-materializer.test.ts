import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProgramScopeVersion, ScopeAsset } from '@shared/types';
import {
  findScopedExistingSourceCheckout,
  materializeGitRepository,
  normalizeSourceRepositoryUrl,
  selectSourceRepository,
  sourceRepositoryCandidates
} from '../src/main/sourceMaterializer';

const createdDirs: string[] = [];

afterEach(() => {
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
