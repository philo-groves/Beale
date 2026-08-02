import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary, HoneycrispMemorySummary, HoneycrispRunbookSummary, RunDetail } from '@shared/types';
import { ResearchSidePanel } from '../src/renderer/features/research/MemorySidePanel';
import { activeFindingTypeSummary, activeMemoryCount, filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogUpdateKey, researchSideTabLabel } from '../src/renderer/view-models/memoryCatalog';

describe('renderer memory catalog', () => {
  it('labels sidebar tabs with live memory and subagent counts', () => {
    expect(researchSideTabLabel('memory', 0)).toBe('0 Memories');
    expect(researchSideTabLabel('memory', 1)).toBe('1 Memory');
    expect(researchSideTabLabel('memory', 42)).toBe('42 Memories');
    expect(researchSideTabLabel('runbooks', 0)).toBe('0 Runbooks');
    expect(researchSideTabLabel('runbooks', 1)).toBe('1 Runbook');
    expect(researchSideTabLabel('runbooks', 2)).toBe('2 Runbooks');
    expect(researchSideTabLabel('subagents', 0)).toBe('0 Subagents');
    expect(researchSideTabLabel('subagents', 1)).toBe('1 Subagent');
    expect(researchSideTabLabel('subagents', 2)).toBe('2 Subagents');
  });

  it('excludes stale memories from the active sidebar count', () => {
    expect(activeMemoryCount([
      memoryNode({ id: 'confirmed', status: 'confirmed' }),
      memoryNode({ id: 'suspected', status: 'suspected' }),
      memoryNode({ id: 'rejected', status: 'rejected' }),
      memoryNode({ id: 'stale', status: 'stale' })
    ])).toBe(3);
  });

  it('formats only nonzero active primitive and chain counts', () => {
    expect(activeFindingTypeSummary([])).toBe('');
    expect(activeFindingTypeSummary([
      memoryNode({ id: 'chain', type: 'chain' }),
      memoryNode({ id: 'primitive_one', type: 'primitive' }),
      memoryNode({ id: 'primitive_two', type: 'primitive' }),
      memoryNode({ id: 'stale_chain', type: 'chain', status: 'stale' })
    ])).toBe('1 Chain, 2 Primitives');
  });

  it('shows a session-scoped summary card before the detailed catalog', () => {
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, {
      detail: summaryDetail(),
      events: [],
      memory: {
        contextWorkspaceId: 'workspace_zsh',
        contextSubjectId: 'subject_apple',
        nodes: [
          memoryNode({ id: 'session_one', tier: 'session', sessionId: 'run_current' }),
          memoryNode({ id: 'session_two', tier: 'session', sessionId: 'run_current' }),
          memoryNode({ id: 'session_chain', tier: 'session', sessionId: 'run_current', type: 'chain' }),
          memoryNode({ id: 'session_stale', tier: 'session', sessionId: 'run_current', status: 'stale' }),
          memoryNode({ id: 'workspace_one' })
        ],
        edges: [],
        runbooks: [
          runbook({ id: 'runbook_one', sessionId: 'run_current', revision: 2 }),
          runbook({ id: 'runbook_two', sessionId: 'run_current', revision: 3 }),
          runbook({ id: 'runbook_archived', sessionId: 'run_current', status: 'archived', revision: 7 }),
          runbook({ id: 'runbook_workspace', sessionId: null, revision: 11 })
        ],
        lastError: null
      } as unknown as HoneycrispMemorySummary,
      runId: 'run_current',
      runStatus: null,
      selectedSubagentPath: null,
      selectedRunbookId: null,
      onOpenRunbook: () => undefined,
      onSelectSubagent: () => undefined
    }));

    expect(html).toContain('aria-label="Session summary"');
    expect(html).toContain('class="session-summary-title">Session</h2>');
    expect(html).toContain('class="session-duration-metric session-stat-tooltip session-summary-duration"');
    expect(html).toContain('aria-label="Session duration 00:05:00"');
    expect(html).toContain('<span>3 Memories</span>');
    expect(html).toContain('class="session-summary-meta">1 Chain, 2 Primitives</span>');
    expect(html).toContain('<span>2 Runbooks</span>');
    expect(html).toContain('class="session-summary-meta">5 Revisions</span>');
    expect(html).toContain('<span>0 Subagents</span>');
    expect(html).not.toContain('0 Active');
    expect(html).not.toContain('0 Completed');
    expect(html.match(/session-summary-chevron/g)).toHaveLength(3);
    expect(html).not.toContain('aria-label="Search memory"');
  });

  it('filters across context identities, types, node text, tags, and references', () => {
    const sessionPrimitive = memoryNode({ id: 'session_primitive', tier: 'session', sessionId: 'run_current', type: 'primitive', title: 'ZFTP length confusion', tags: ['parser'] });
    const workspacePrimitive = memoryNode({ id: 'workspace_primitive', type: 'primitive', title: 'ZFTP workspace boundary', tags: ['parser'] });
    const subjectInvariant = memoryNode({
      id: 'subject_invariant',
      tier: 'subject',
      sessionId: 'run_older',
      type: 'invariant',
      title: 'Apple parser boundary',
      evidenceRefs: [{ id: 'ref_one', kind: 'code', pathBase: 'repository', path: 'Src/Modules/zftp.c', locator: {}, summary: 'Length check', createdAt: '2026-07-19T12:00:00.000Z' }]
    });
    const nodes = [sessionPrimitive, workspacePrimitive, subjectInvariant];
    const context = { sessionId: 'run_current', workspaceId: 'workspace_zsh', subjectId: 'subject_apple' };

    expect(filterMemoryCatalogNodes(nodes, { query: '', scope: 'session', type: 'all', ...context })).toEqual([sessionPrimitive]);
    expect(filterMemoryCatalogNodes(nodes, { query: '', scope: 'workspace', type: 'all', ...context })).toEqual([workspacePrimitive]);
    expect(filterMemoryCatalogNodes(nodes, { query: '', scope: 'subject', type: 'all', ...context })).toEqual([subjectInvariant]);
    expect(filterMemoryCatalogNodes(nodes, { query: '', scope: 'all', type: 'invariant', ...context })).toEqual([subjectInvariant]);
    expect(filterMemoryCatalogNodes(nodes, { query: 'zftp.c', scope: 'all', type: 'all', ...context })).toEqual([subjectInvariant]);
    expect(filterMemoryCatalogNodes(nodes, { query: 'parser', scope: 'all', type: 'all', ...context })).toEqual([
      sessionPrimitive,
      subjectInvariant,
      workspacePrimitive
    ]);
  });

  it('indexes relationships at both endpoints and versions visible rows', () => {
    const edge = memoryEdge();
    const nodes = [memoryNode({ id: 'a' }), memoryNode({ id: 'b', updatedAt: '2026-07-19T13:00:00.000Z' })];
    const grouped = groupMemoryRelationships([edge]);

    expect(grouped.get('a')).toEqual([edge]);
    expect(grouped.get('b')).toEqual([edge]);
    expect(memoryCatalogUpdateKey(nodes)).toBe('a:2026-07-19T12:00:00.000Z|b:2026-07-19T13:00:00.000Z');
  });

  it('orders filtered memories chronologically with the newest at the bottom', () => {
    const newest = memoryNode({ id: 'newest', updatedAt: '2026-07-19T14:00:00.000Z' });
    const oldest = memoryNode({ id: 'oldest', updatedAt: '2026-07-19T10:00:00.000Z' });
    const middle = memoryNode({ id: 'middle', updatedAt: '2026-07-19T12:00:00.000Z' });
    const context = { query: '', scope: 'all' as const, type: 'all', sessionId: 'run_current', workspaceId: 'workspace_zsh', subjectId: 'subject_apple' };

    expect(filterMemoryCatalogNodes([newest, oldest, middle], context)).toEqual([oldest, middle, newest]);
  });
});

function summaryDetail(): RunDetail {
  return {
    run: {
      id: 'run_current',
      status: 'completed',
      createdAt: '2026-07-19T12:00:00.000Z',
      startedAt: '2026-07-19T12:00:00.000Z',
      endedAt: '2026-07-19T12:05:00.000Z',
      mode: 'dynamic',
      attemptStrategy: 'breadth_first',
      networkProfile: 'scoped',
      title: '',
      promptMarkdown: ''
    },
    attempts: [],
    traceEvents: [],
    transcriptMessages: [],
    hypotheses: [],
    artifacts: [],
    evidence: [],
    findings: [],
    verifierContracts: [],
    verifierRuns: [],
    vmContexts: [],
    modelSessions: [],
    contextCompactions: [],
    policyEvents: [],
    exports: []
  } as unknown as RunDetail;
}
function memoryNode(overrides: Partial<HoneycrispMemoryNodeSummary> = {}): HoneycrispMemoryNodeSummary {
  return {
    id: 'node_one',
    tier: 'workspace',
    sessionId: null,
    workspaceId: 'workspace_zsh',
    workspaceName: 'Zsh',
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    type: 'primitive',
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

function runbook(overrides: Partial<HoneycrispRunbookSummary> = {}): HoneycrispRunbookSummary {
  return {
    id: 'runbook_one',
    workspaceId: 'workspace_zsh',
    workspaceName: 'Zsh',
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    sessionId: 'run_current',
    title: 'Runbook title',
    purpose: 'Runbook purpose',
    status: 'active',
    artifactId: 'artifact_one',
    revision: 1,
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z',
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
