import { describe, expect, it } from 'vitest';
import { layoutCampaignGraph } from '../src/renderer/view-models/campaignGraph';
import { findingRevisionContext } from '../src/main/findingRevisionContext';
import type { WorkspaceScopeVersion } from '@shared/types';

describe('campaign graph projection', () => {
  it('lays out assets, memory, findings, and proof deterministically while dropping dangling edges', () => {
    const nodes = [
      { id: 'finding:f1', kind: 'finding', label: 'Finding', status: 'observed', memoryNodeId: 'm1', findingId: 'f1', assetId: null, evidenceCount: 1, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'asset:a1', kind: 'asset', label: 'Asset', status: 'covered', memoryNodeId: null, findingId: null, assetId: 'a1', evidenceCount: 0, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'memory:m1', kind: 'memory', label: 'Memory', status: 'suspected', memoryNodeId: 'm1', findingId: null, assetId: null, evidenceCount: 1, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'runbook:r1', kind: 'runbook', label: 'Proof', status: 'active', memoryNodeId: null, findingId: null, assetId: null, evidenceCount: 1, updatedAt: '2026-01-01T00:00:00Z' }
    ] as const;
    const layout = layoutCampaignGraph(nodes, [
      { fromId: 'asset:a1', toId: 'memory:m1', relation: 'covered_by', contradictory: false },
      { fromId: 'finding:f1', toId: 'runbook:r1', relation: 'reproduced_by', contradictory: false },
      { fromId: 'missing', toId: 'memory:m1', relation: 'dangling', contradictory: false }
    ]);

    expect(layout.nodes.map(({ id, x }) => [id, x])).toEqual([
      ['asset:a1', 16], ['memory:m1', 236], ['finding:f1', 456], ['runbook:r1', 676]
    ]);
    expect(layout.edges).toHaveLength(2);
    expect(layout.width).toBe(876);
  });

  it('changes finding revision identity when source or execution environment changes', () => {
    const scope = scopeFixture();
    const original = findingRevisionContext(scope);
    const sourceChanged = findingRevisionContext({
      ...scope,
      assets: [{ ...scope.assets[0]!, attributes: { ...scope.assets[0]!.attributes, head: 'commit-two' } }]
    });
    const environmentChanged = findingRevisionContext({
      ...scope,
      assets: [{ ...scope.assets[0]!, attributes: { ...scope.assets[0]!.attributes, targetVersion: '2.0' } }]
    });
    expect(original.assetIds).toEqual(['asset_repo']);
    expect(sourceChanged.sourceRevision).not.toBe(original.sourceRevision);
    expect(sourceChanged.environmentFingerprint).toBe(original.environmentFingerprint);
    expect(environmentChanged.environmentFingerprint).not.toBe(original.environmentFingerprint);
  });
});

function scopeFixture(): WorkspaceScopeVersion {
  return {
    id: 'scope_one', version: 1, status: 'active', workspaceName: 'Workspace', scopeOwner: 'Owner',
    descriptionMarkdown: '', rulesMarkdown: '', activeFrom: '2026-01-01', expiresAt: null,
    createdAt: '2026-01-01', createdBy: 'test',
    assets: [{ id: 'asset_repo', scopeVersionId: 'scope_one', createdAt: '2026-01-01', direction: 'in_scope', kind: 'repo', value: 'repo', sensitivity: 'internal', attributes: { head: 'commit-one', targetVersion: '1.0' } }]
  };
}
