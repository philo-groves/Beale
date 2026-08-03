import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary, HoneycrispMemorySummary, HoneycrispRunbookSummary, RunDetail, TraceEventRecord } from '@shared/types';
import { ResearchSidePanel } from '../src/renderer/features/research/MemorySidePanel';
import { activeMemoryCount, filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogUpdateKey, sessionMemoryActivitySummary, sessionMemoryTypeSummaries } from '../src/renderer/view-models/memoryCatalog';

describe('renderer memory catalog', () => {
  it('excludes stale memories from the active sidebar count', () => {
    expect(activeMemoryCount([
      memoryNode({ id: 'confirmed', status: 'confirmed' }),
      memoryNode({ id: 'suspected', status: 'suspected' }),
      memoryNode({ id: 'rejected', status: 'rejected' }),
      memoryNode({ id: 'stale', status: 'stale' })
    ])).toBe(3);
  });

  it('counts paired memory searches and updates once', () => {
    expect(sessionMemoryActivitySummary([])).toBe('');
    expect(sessionMemoryActivitySummary([
      memoryToolEvent('tool.requested', 'search_one', 'memory.search', 1),
      memoryToolEvent('tool.observed', 'search_one', 'memory.search', 2),
      memoryToolEvent('tool.requested', 'save_one', 'memory.save', 3),
      memoryToolEvent('tool.observed', 'save_one', 'memory.save', 4),
      memoryToolEvent('tool.requested', 'correct_one', 'memory.correct', 5)
    ])).toBe('1 Search, 2 Updates');
    expect(sessionMemoryActivitySummary([
      memoryToolEvent('tool.requested', 'search_one', 'memory.search', 1),
      memoryToolEvent('tool.observed', 'search_one', 'memory.search', 2),
      memoryToolEvent('tool.requested', 'search_two', 'memory.search', 3),
      memoryToolEvent('tool.observed', 'search_two', 'memory.search', 4)
    ])).toBe('2 Searches');
  });

  it('groups active memories into primitive, chain, sink, and other summaries', () => {
    expect(sessionMemoryTypeSummaries([
      memoryNode({ id: 'primitive_confirmed', type: 'primitive', status: 'confirmed' }),
      memoryNode({ id: 'primitive_suspected', type: 'primitive', status: 'suspected' }),
      memoryNode({ id: 'primitive_rejected', type: 'primitive', status: 'rejected' }),
      memoryNode({ id: 'chain_confirmed', type: 'chain', status: 'confirmed' }),
      memoryNode({ id: 'sink_confirmed', type: 'sink', status: 'confirmed' }),
      memoryNode({ id: 'sink_suspected', type: 'sink', status: 'suspected' }),
      memoryNode({ id: 'trajectory_confirmed', type: 'trajectory', status: 'confirmed' }),
      memoryNode({ id: 'trajectory_suspected', type: 'trajectory', status: 'suspected' }),
      memoryNode({ id: 'evidence_confirmed', type: 'evidence', status: 'confirmed' }),
      memoryNode({ id: 'evidence_suspected', type: 'evidence', status: 'suspected' }),
      memoryNode({ id: 'custom_signal', type: 'custom_signal', status: 'suspected' }),
      memoryNode({ id: 'custom_rejected', type: 'custom_signal', status: 'rejected' }),
      memoryNode({ id: 'stale_type', type: 'sink', status: 'stale' })
    ])).toEqual([
      { type: 'sink', count: 2, confirmedCount: 1, suspectedCount: 1, rejectedCount: 0, countLabel: '2 Sinks', statusLabel: '1 Confirmed, 1 Suspected' },
      { type: 'primitive', count: 3, confirmedCount: 1, suspectedCount: 1, rejectedCount: 1, countLabel: '3 Primitives', statusLabel: '1 Confirmed, 1 Suspected, 1 Rejected' },
      { type: 'chain', count: 1, confirmedCount: 1, suspectedCount: 0, rejectedCount: 0, countLabel: '1 Chain', statusLabel: '1 Confirmed' },
      { type: 'other', count: 6, confirmedCount: 2, suspectedCount: 3, rejectedCount: 1, countLabel: '6 Boring', statusLabel: '' }
    ]);
  });

  it('shows a session-scoped summary card before the detailed catalog', () => {
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, {
      detail: summaryDetail(),
      events: [
        memoryToolEvent('tool.requested', 'search_one', 'memory.search', 1),
        memoryToolEvent('tool.observed', 'search_one', 'memory.search', 2),
        memoryToolEvent('tool.requested', 'save_one', 'memory.save', 3),
        memoryToolEvent('tool.observed', 'save_one', 'memory.save', 4),
        memoryToolEvent('tool.requested', 'correct_one', 'memory.correct', 5)
      ],
      memory: {
        contextWorkspaceId: 'workspace_zsh',
        contextSubjectId: 'subject_apple',
        nodes: [
          memoryNode({ id: 'session_one', tier: 'session', sessionId: 'run_current', status: 'confirmed' }),
          memoryNode({ id: 'session_two', tier: 'session', sessionId: 'run_current' }),
          memoryNode({ id: 'session_chain', tier: 'session', sessionId: 'run_current', type: 'chain', status: 'confirmed' }),
          memoryNode({ id: 'session_sink', tier: 'session', sessionId: 'run_current', type: 'sink' }),
          memoryNode({ id: 'session_other', tier: 'session', sessionId: 'run_current', type: 'invariant' }),
          memoryNode({ id: 'session_other_rejected', tier: 'session', sessionId: 'run_current', type: 'invariant', status: 'rejected' }),
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
    expect(html).toContain('class="session-summary-divider"');
    expect(html).toContain('60k Tokens');
    expect(html).toContain('50k In, 10k Out');
    expect(html).toContain('80% Hit Rate');
    expect(html).toContain('40k Cached');
    expect(html).toContain('25% Context');
    expect(html).toContain('50k Used');
    expect(html).toContain('lucide-coins');
    expect(html).toContain('lucide-badge-percent');
    expect(html).toContain('lucide-gauge');
    expect(html).toContain('<span>6 Memories</span>');
    expect(html).toContain('class="session-summary-meta">1 Search, 2 Updates</span>');
    expect(html).toContain('class="session-memory-type-item"><span>2 Primitives</span><span class="session-summary-meta">1 Confirmed, 1 Suspected</span></div>');
    expect(html).toContain('class="session-memory-type-item"><span>1 Chain</span><span class="session-summary-meta">1 Confirmed</span></div>');
    expect(html).toContain('class="session-memory-type-item"><span>1 Sink</span><span class="session-summary-meta">1 Suspected</span></div>');
    expect(html).toContain('class="session-memory-type-item"><span>2 Boring</span></div>');
    expect(html).not.toContain('0 Confirmed');
    expect(html).not.toContain('0 Suspected');
    expect(html).not.toContain('0 Rejected');
    expect(html.indexOf('<span>1 Sink</span>')).toBeLessThan(html.indexOf('<span>2 Primitives</span>'));
    expect(html.indexOf('<span>2 Primitives</span>')).toBeLessThan(html.indexOf('<span>1 Chain</span>'));
    expect(html.indexOf('<span>1 Chain</span>')).toBeLessThan(html.indexOf('<span>2 Boring</span>'));
    expect(html.match(/session-memory-type-item/g)).toHaveLength(4);
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

function memoryToolEvent(
  kind: 'tool.requested' | 'tool.observed',
  actionId: string,
  toolName: string,
  sequence: number
): TraceEventRecord {
  return {
    id: `trace_memory_${sequence}`,
    runId: 'run_current',
    attemptId: 'attempt_current',
    sequence,
    source: kind === 'tool.requested' ? 'model' : 'tool',
    type: kind === 'tool.requested' ? 'tool_call' : 'tool_result',
    summary: `Honeycrisp ${kind}: ${toolName}`,
    payload: {
      agentPath: '/root',
      honeycrispKind: kind,
      payload: { toolActionId: actionId, toolName, normalizedInputs: {} }
    },
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: `2026-07-19T12:0${sequence}:00.000Z`,
    vmContextId: null,
    artifactId: null,
    toolCallId: actionId,
    approvalId: null
  };
}
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
    traceEvents: [
      {
        id: 'trace_usage',
        type: 'model_message',
        createdAt: '2026-07-19T12:04:00.000Z',
        payload: {
          usage: {
            input_tokens: 10_000,
            prompt_tokens: 50_000,
            cache_read_tokens: 40_000,
            total_tokens: 60_000,
            output_tokens: 10_000,
            source: 'reported input tokens'
          }
        }
      }
    ],
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
