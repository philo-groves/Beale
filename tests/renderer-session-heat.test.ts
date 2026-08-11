import { describe, expect, it } from 'vitest';
import type { HoneycrispMemoryNodeSummary, HoneycrispMemorySummary, RunDetail } from '@shared/types';
import { sessionHeatForDetail, sessionHeatForHoneycrispMemory } from '../src/renderer/view-models/sessionHeat';

describe('renderer session heat view models', () => {
  it('uses none when no session is selected or no triggering memory exists in the session', () => {
    expect(sessionHeatForDetail(null)).toBe('none');
    expect(sessionHeatForDetail(runDetail())).toBe('none');
    expect(sessionHeatForDetail(runDetail({
      nodes: [memoryNode({ type: 'source', status: 'confirmed' })]
    }))).toBe('none');
  });

  it.each([
    ['sink', 'confirmed', 'low'],
    ['primitive', 'suspected', 'medium'],
    ['primitive', 'confirmed', 'medium'],
    ['chain', 'suspected', 'high'],
    ['chain', 'confirmed', 'critical']
  ] as const)('maps a %s in %s state to %s heat', (type, status, expected) => {
    expect(sessionHeatForDetail(runDetail({ nodes: [memoryNode({ type, status })] }))).toBe(expected);
  });

  it('ignores triggering memories from other sessions', () => {
    const memory = honeycrispMemory([
      memoryNode({ sessionIds: ['run_older'], type: 'chain', status: 'confirmed' }),
      memoryNode({ sessionIds: ['run_current'], type: 'sink', status: 'confirmed' })
    ]);

    expect(sessionHeatForHoneycrispMemory(memory, 'run_current')).toBe('low');
  });

  it('downgrades when a triggering memory is rejected', () => {
    const suspectedChain = memoryNode({ id: 'chain_test', type: 'chain', status: 'suspected' });
    const confirmedPrimitive = memoryNode({ id: 'primitive_test', type: 'primitive', status: 'confirmed' });
    expect(sessionHeatForDetail(runDetail({ nodes: [suspectedChain, confirmedPrimitive] }))).toBe('high');

    const rejectedChain = { ...suspectedChain, status: 'rejected', revision: 2 };
    expect(sessionHeatForDetail(runDetail({ nodes: [rejectedChain, confirmedPrimitive] }))).toBe('medium');
  });

  it('does not apply security-specific heat semantics to a recorded general profile', () => {
    const detail = runDetail({ nodes: [memoryNode({ type: 'chain', status: 'confirmed' })] });
    detail.researchProfile = {
      profileId: 'general-research',
      profile: { id: 'general-research' }
    } as RunDetail['researchProfile'];

    expect(sessionHeatForDetail(detail)).toBe('none');
  });
});

function runDetail(input: { nodes?: HoneycrispMemoryNodeSummary[] } = {}): RunDetail {
  return {
    run: { id: 'run_current' },
    honeycrispMemory: honeycrispMemory(input.nodes ?? [])
  } as unknown as RunDetail;
}

function honeycrispMemory(nodes: HoneycrispMemoryNodeSummary[]): HoneycrispMemorySummary {
  return {
    status: nodes.length > 0 ? 'ready' : 'empty',
    source: 'honeycrisp_sqlite',
    nodes
  } as HoneycrispMemorySummary;
}

function memoryNode(overrides: Partial<HoneycrispMemoryNodeSummary> = {}): HoneycrispMemoryNodeSummary {
  return {
    id: 'memory_test',
    sessionIds: ['run_current'],
    workspaces: [{ id: 'workspace_zsh', name: 'Zsh' }],
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    type: 'primitive',
    title: 'Memory title',
    summary: 'Memory summary',
    body: '',
    status: 'suspected',
    confidence: 0.8,
    assetIds: [],
    tags: [],
    attributes: {},
    evidenceRefs: [],
    createdAt: '2026-07-21T12:00:00.000Z',
    updatedAt: '2026-07-21T12:00:00.000Z',
    revision: 1,
    ...overrides
  };
}
