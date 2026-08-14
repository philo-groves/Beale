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
});
