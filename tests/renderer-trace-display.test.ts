import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '@shared/types';
import type { TraceCategoryId } from '../src/renderer/traceClassification';
import { buildTraceTimelineEntries, groupRenderedTraceEntries, traceGroupStatusLabel, type TraceTimelineGroup } from '../src/renderer/view-models/traceDisplay';

const ALL_CATEGORIES: TraceCategoryId[] = [
  'agent_output',
  'reasoning',
  'tools',
  'vm_execution',
  'hypotheses',
  'evidence',
  'verifier',
  'policy_scope',
  'code_navigation',
  'failure_recovery',
  'events'
];

describe('renderer trace display view models', () => {
  it('builds trace timeline entries with setup and turn groups', () => {
    const events = [
      traceEvent({ id: 'trace_setup', sequence: 1, source: 'system', type: 'user_note', summary: 'Run created.', createdAt: '2026-04-30T10:00:00.000Z' }),
      traceEvent({
        id: 'trace_turn',
        sequence: 2,
        source: 'model',
        type: 'model_message',
        summary: 'OpenAI response created.',
        payload: { turn: 1 },
        createdAt: '2026-04-30T10:01:00.000Z'
      }),
      traceEvent({ id: 'trace_tool', sequence: 3, source: 'tool', type: 'tool_result', summary: 'Search returned 4 results.', createdAt: '2026-04-30T10:02:00.000Z' }),
      traceEvent({ id: 'trace_error', sequence: 4, source: 'tool', type: 'tool_result', summary: 'Search failed.', payload: { status: 'error' }, createdAt: '2026-04-30T10:03:00.000Z' })
    ];

    const entries = buildTraceTimelineEntries(events, ALL_CATEGORIES);

    expect(entries.map((entry) => [entry.event.id, entry.group.key])).toEqual([
      ['trace_setup', 'setup'],
      ['trace_turn', 'turn-1-2'],
      ['trace_tool', 'turn-1-2'],
      ['trace_error', 'turn-1-2']
    ]);
    expect(entries[0].group).toMatchObject({ label: 'Setup', visibleCount: 1, updatedAt: '2026-04-30T10:00:00.000Z' });
    expect(entries[1].group).toMatchObject({
      label: 'Turn 1',
      visibleCount: 3,
      toolCount: 1,
      modelCount: 1,
      failureCount: 1,
      updatedAt: '2026-04-30T10:03:00.000Z'
    });
  });

  it('filters hidden categories while preserving group counters for visible events only', () => {
    const entries = buildTraceTimelineEntries(
      [
        traceEvent({ id: 'trace_hidden_setup', sequence: 1, source: 'system', type: 'user_note', summary: 'Run created.' }),
        traceEvent({ id: 'trace_turn', sequence: 2, source: 'model', type: 'model_message', summary: 'OpenAI response created.', payload: { turn: 2 } }),
        traceEvent({ id: 'trace_tool', sequence: 3, source: 'tool', type: 'tool_result', summary: 'Code browser returned 10 bounded lines.' })
      ],
      ['code_navigation']
    );

    expect(entries.map((entry) => entry.event.id)).toEqual(['trace_tool']);
    expect(entries[0].group).toMatchObject({ key: 'turn-2-2', visibleCount: 1, toolCount: 1, modelCount: 0 });
  });

  it('groups rendered consecutive entries by shared timeline group', () => {
    const entries = buildTraceTimelineEntries(
      [
        traceEvent({ id: 'trace_setup', sequence: 1, source: 'system', type: 'user_note', summary: 'Run created.' }),
        traceEvent({ id: 'trace_turn', sequence: 2, source: 'model', type: 'model_message', summary: 'OpenAI response created.', payload: { turn: 1 } }),
        traceEvent({ id: 'trace_tool', sequence: 3, source: 'tool', type: 'tool_result', summary: 'Search returned 4 results.' })
      ],
      ALL_CATEGORIES
    );

    const groups = groupRenderedTraceEntries(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: 'setup-trace_setup', entries: [{ event: { id: 'trace_setup' } }] });
    expect(groups[1].key).toBe('turn-1-2-trace_turn');
    expect(groups[1].entries.map((entry) => entry.event.id)).toEqual(['trace_turn', 'trace_tool']);
  });

  it('labels trace group status from errors, active latest state, completed activity, and passive events', () => {
    expect(traceGroupStatusLabel(group({ failureCount: 2 }), true, 'active')).toEqual({ kind: 'review', label: '2 Errors' });
    expect(traceGroupStatusLabel(group(), true, 'active')).toEqual({ kind: 'active', label: 'Active' });
    expect(traceGroupStatusLabel(group({ modelCount: 1 }), false, 'completed')).toEqual({ kind: 'complete', label: 'Complete' });
    expect(traceGroupStatusLabel(group(), false, 'completed')).toEqual({ kind: 'events', label: 'Events' });
  });
});

function group(input: Partial<TraceTimelineGroup> = {}): TraceTimelineGroup {
  return {
    key: 'turn-1-1',
    label: 'Turn 1',
    startedAt: '2026-04-30T10:00:00.000Z',
    updatedAt: '2026-04-30T10:00:00.000Z',
    visibleCount: 0,
    toolCount: 0,
    modelCount: 0,
    failureCount: 0,
    ...input
  };
}

function traceEvent(input: Partial<TraceEventRecord> = {}): TraceEventRecord {
  return {
    id: 'trace_test',
    runId: 'run_test',
    attemptId: null,
    sequence: 1,
    source: 'system',
    type: 'user_note',
    summary: 'Trace event.',
    payload: {},
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-04-30T10:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}
