import { describe, expect, it } from 'vitest';
import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary } from '@shared/types';
import { filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogUpdateKey } from '../src/renderer/view-models/memoryCatalog';

describe('renderer memory catalog', () => {
  it('filters across tiers, types, node text, tags, and references', () => {
    const sessionFinding = memoryNode({ id: 'session_finding', tier: 'session', type: 'finding', title: 'ZFTP length confusion', tags: ['parser'] });
    const subjectInvariant = memoryNode({
      id: 'subject_invariant',
      tier: 'subject',
      type: 'invariant',
      title: 'Apple parser boundary',
      evidenceRefs: [{ id: 'ref_one', kind: 'code', pathBase: 'repository', path: 'Src/Modules/zftp.c', locator: {}, summary: 'Length check', createdAt: '2026-07-19T12:00:00.000Z' }]
    });
    const nodes = [sessionFinding, subjectInvariant];

    expect(filterMemoryCatalogNodes(nodes, { query: '', tier: 'session', type: 'all' })).toEqual([sessionFinding]);
    expect(filterMemoryCatalogNodes(nodes, { query: '', tier: 'all', type: 'invariant' })).toEqual([subjectInvariant]);
    expect(filterMemoryCatalogNodes(nodes, { query: 'zftp.c', tier: 'all', type: 'all' })).toEqual([subjectInvariant]);
    expect(filterMemoryCatalogNodes(nodes, { query: 'parser', tier: 'all', type: 'all' })).toEqual(nodes);
  });

  it('indexes relationships at both endpoints and versions visible rows', () => {
    const edge = memoryEdge();
    const nodes = [memoryNode({ id: 'a' }), memoryNode({ id: 'b', updatedAt: '2026-07-19T13:00:00.000Z' })];
    const grouped = groupMemoryRelationships([edge]);

    expect(grouped.get('a')).toEqual([edge]);
    expect(grouped.get('b')).toEqual([edge]);
    expect(memoryCatalogUpdateKey(nodes)).toBe('a:2026-07-19T12:00:00.000Z|b:2026-07-19T13:00:00.000Z');
  });
});

function memoryNode(overrides: Partial<HoneycrispMemoryNodeSummary> = {}): HoneycrispMemoryNodeSummary {
  return {
    id: 'node_one',
    tier: 'workspace',
    sessionId: null,
    workspaceId: 'workspace_zsh',
    workspaceName: 'Zsh',
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    type: 'finding',
    title: 'Memory title',
    summary: 'Memory summary',
    body: 'Memory body',
    status: 'suspected',
    confidence: 0.7,
    assetIds: [],
    tags: [],
    attributes: {},
    evidenceRefs: [],
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z',
    revision: 1,
    ...overrides
  };
}

function memoryEdge(): HoneycrispMemoryEdgeSummary {
  return {
    fromId: 'a',
    toId: 'b',
    relation: 'supports',
    note: '',
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z'
  };
}
