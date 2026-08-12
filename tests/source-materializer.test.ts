import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScopeVersion, ScopeAsset } from '@shared/types';
import {
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

    const materializedPromise = materializeGitRepositoryAsync(candidate, '', {
      repositoryStoreDirectory: join(workspace, 'beale-home', 'repositories')
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    timerFired = true;
    const materialized = await materializedPromise;

    expect(timerFired).toBe(true);
    expect(materialized.cloned).toBe(true);
    expect(materialized.head).toBe('0123456789abcdef0123456789abcdef01234567');
  });

  it('fetches and checks out requested refs in managed existing checkouts', () => {
    const workspace = tempDir();
    mkdirSync(join(workspace, '.beale'), { recursive: true });
    const repositoryStore = join(workspace, 'beale-home', 'repositories');
    const refDigest = createHash('sha256').update('feature-ref').digest('hex').slice(0, 12);
    const managedCheckout = join(repositoryStore, 'github.com_Netflix_zuul', `feature-ref-${refDigest}`);
    mkdirSync(join(managedCheckout, '.git'), { recursive: true });
    const stateFile = join(workspace, 'git-head.txt');
    writeFileSync(stateFile, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const fakeGit = join(workspace, 'fake-git-ref.mjs');
    writeFileSync(
      fakeGit,
      [
        '#!/usr/bin/env node',
        "import { readFileSync, writeFileSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        `const stateFile = ${JSON.stringify(stateFile)};`,
        'const command = args.find((arg) => ["rev-parse", "fetch", "checkout"].includes(arg));',
        'if (command === "rev-parse" && args.at(-1) === "HEAD") { process.stdout.write(`${readFileSync(stateFile, "utf8").trim()}\\n`); process.exit(0); }',
        'if (command === "rev-parse" && args.at(-1) === "feature-ref^{commit}") { process.stdout.write("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n"); process.exit(0); }',
        'if (command === "fetch") process.exit(0);',
        'if (command === "checkout") { writeFileSync(stateFile, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"); process.exit(0); }',
        'process.exit(1);'
      ].join('\n')
    );
    chmodSync(fakeGit, 0o700);
    process.env.BEALE_GIT_COMMAND = fakeGit;
    const scope = scopeWithAssets([sourceAsset('repo_zuul', 'https://github.com/Netflix/zuul')]);
    const candidate = sourceRepositoryCandidates(scope)[0];

    const materialized = materializeGitRepository(candidate, 'feature-ref', {
      repositoryStoreDirectory: repositoryStore
    });

    expect(materialized.localPath).toBe(managedCheckout);
    expect(materialized.requestedRefHead).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(materialized.requestedRefMatchesHead).toBe(true);
  });

  it('reuses one user-global checkout across materializations', async () => {
    const repositoryStore = join(tempDir(), 'repositories');
    const fakeGit = join(tempDir(), 'fake-git-global.mjs');
    writeFileSync(
      fakeGit,
      [
        '#!/usr/bin/env node',
        "import { mkdirSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        "if (args.includes('clone')) { mkdirSync(`${args.at(-1)}/.git`, { recursive: true }); process.exit(0); }",
        "if (args.includes('rev-parse') && args.at(-1) === 'HEAD') { process.stdout.write('0123456789abcdef0123456789abcdef01234567\\n'); process.exit(0); }",
        'process.exit(1);'
      ].join('\n')
    );
    chmodSync(fakeGit, 0o700);
    process.env.BEALE_GIT_COMMAND = fakeGit;
    const candidate = sourceRepositoryCandidates(scopeWithAssets([sourceAsset('repo_zuul', 'https://github.com/Netflix/zuul')]))[0];

    const first = await materializeGitRepositoryAsync(candidate, '', {
      repositoryStoreDirectory: repositoryStore
    });
    const second = await materializeGitRepositoryAsync(candidate, '', {
      repositoryStoreDirectory: repositoryStore
    });

    expect(first.cloned).toBe(true);
    expect(second.cloned).toBe(false);
    expect(second.localPath).toBe(first.localPath);
    expect(first.localPath).toBe(join(repositoryStore, 'github.com_Netflix_zuul', 'default'));
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

function scopeWithAssets(assets: ScopeAsset[]): WorkspaceScopeVersion {
  return {
    id: 'scope_1',
    version: 1,
    status: 'active',
    workspaceName: 'GitLab',
    scopeOwner: 'GitLab',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    activeFrom: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'test',
    assets
  };
}
