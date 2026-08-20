import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScopeAsset } from '../src/shared/types';
import { selectRunTarget } from '../src/main/runTarget';

describe('run target selection', () => {
  it('matches GitLab materialized checkout paths by repository slug instead of checkout folder', () => {
    const assets: ScopeAsset[] = [{
      id: 'asset_gitlab',
      scopeVersionId: 'scope_gitlab',
      direction: 'in_scope',
      kind: 'repo',
      value: 'C:\\Users\\research\\.beale\\repositories\\gitlab.com_gitlab-org_gitlab\\default',
      sensitivity: 'public',
      attributes: {},
      createdAt: '2026-08-12T00:00:00.000Z'
    }];

    const selected = selectRunTarget(assets, {
      title: 'Audit GitLab import paths',
      promptMarkdown: '',
      targetAssetId: null,
      targetPath: null
    });

    expect(selected.targetAssetId).toBe('asset_gitlab');
    expect(selected.reason).toBe('prompt_match');
  });

  it('uses repository cloned-directory metadata as the local run target', () => {
    const clonedDirectory = mkdtempSync(join(tmpdir(), 'beale-cloned-resource-'));
    try {
      const assets: ScopeAsset[] = [{
        id: 'asset_repository',
        scopeVersionId: 'scope_repository',
        direction: 'in_scope',
        kind: 'repo',
        value: 'https://github.com/example/parser',
        sensitivity: 'internal',
        attributes: { clonedDirectory },
        createdAt: '2026-08-20T00:00:00.000Z'
      }];

      expect(selectRunTarget(assets, {
        title: 'Audit parser',
        promptMarkdown: '',
        targetAssetId: 'asset_repository',
        targetPath: null
      })).toMatchObject({
        targetAssetId: 'asset_repository',
        targetPath: resolve(clonedDirectory),
        reason: 'explicit_asset'
      });
    } finally {
      rmSync(clonedDirectory, { recursive: true, force: true });
    }
  });
});
