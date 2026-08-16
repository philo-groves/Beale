import { describe, expect, it } from 'vitest';
import type { RunDetail, TraceEventRecord, TranscriptMessageRecord } from '@shared/types';
import { traceCategoryForEvent, type TraceCategoryId } from '../src/renderer/traceClassification';
import {
  buildTraceDisplayEvents,
  buildTraceDisplayEventsForAgentPath,
  buildTraceTimelineEntries,
  coalesceConsecutiveReasoningEntries,
  groupRenderedTraceEntries,
  pendingHoneycrispToolRequestEventIds,
  traceDisplayEventContainsId,
  traceGroupStatusLabel,
  type TraceTimelineGroup
} from '../src/renderer/view-models/traceDisplay';

const ALL_CATEGORIES: TraceCategoryId[] = [
  'agent_output',
  'reasoning',
  'tools',
  'execution',
  'research',
  'artifacts',
  'verifier',
  'policy_scope',
  'code_navigation',
  'failure_recovery',
  'non_standard',
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
      modelCount: 0,
      failureCount: 1,
      updatedAt: '2026-04-30T10:03:00.000Z'
    });
  });

  it('categorizes verbose model lifecycle traces as non-standard', () => {
    expect(traceCategoryForEvent(traceEvent({ summary: 'OpenAI Responses request sent for turn 12.' }))).toBe('non_standard');
    expect(traceCategoryForEvent(traceEvent({ summary: 'OpenAI response created.' }))).toBe('non_standard');
    expect(traceCategoryForEvent(traceEvent({ summary: 'OpenAI response completed.' }))).toBe('non_standard');
    expect(traceCategoryForEvent(traceEvent({ summary: 'OpenAI streamed model output delta.' }))).toBe('non_standard');
    expect(traceCategoryForEvent(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: python.' }))).toBe('non_standard');
    expect(traceCategoryForEvent(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: code_browser.' }))).toBe('non_standard');
    expect(traceCategoryForEvent(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: resource_lookup.' }))).toBe('non_standard');
    expect(traceCategoryForEvent(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: search.' }))).toBe('non_standard');
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

  it('hides host-only traces unless the non-standard filter is enabled', () => {
    const events = [
      traceEvent({ id: 'trace_visible', sequence: 1, modelVisible: true }),
      traceEvent({ id: 'trace_host_only', sequence: 2, modelVisible: false })
    ];

    expect(buildTraceTimelineEntries(events, ['events']).map((entry) => entry.event.id)).toEqual(['trace_visible']);
    expect(buildTraceTimelineEntries(events, ['events', 'non_standard']).map((entry) => entry.event.id)).toEqual([
      'trace_visible',
      'trace_host_only'
    ]);
  });

  it('temporarily shows pending Honeycrisp tool requests and hides them after matching observations', () => {
    const searchRequest = honeycrispToolEvent('tool.requested', 'action_search', 'memory.search', 1);
    const readRequest = honeycrispToolEvent('tool.requested', 'action_read', 'file.read', 2);
    const searchObservation = honeycrispToolEvent('tool.observed', 'action_search', 'memory.search', 3);
    const pendingEvents = [searchRequest, readRequest];
    const completedEvents = [...pendingEvents, searchObservation];

    expect(traceCategoryForEvent(searchRequest)).toBe('non_standard');
    expect([...pendingHoneycrispToolRequestEventIds(pendingEvents)]).toEqual(['trace_tool_1', 'trace_tool_2']);
    expect(buildTraceTimelineEntries(pendingEvents, ['tools']).map((entry) => entry.event.id)).toEqual(['trace_tool_1', 'trace_tool_2']);
    expect([...pendingHoneycrispToolRequestEventIds(completedEvents)]).toEqual(['trace_tool_2']);
    expect(buildTraceTimelineEntries(completedEvents, ['tools']).map((entry) => entry.event.id)).toEqual(['trace_tool_2', 'trace_tool_3']);
    expect(buildTraceTimelineEntries(completedEvents, ['tools', 'non_standard']).map((entry) => entry.event.id)).toEqual([
      'trace_tool_1',
      'trace_tool_2',
      'trace_tool_3'
    ]);
  });

  it('coalesces only uninterrupted reasoning summaries within the same turn', () => {
    const entries = buildTraceTimelineEntries(
      [
        traceEvent({ id: 'reasoning_one', sequence: 1, payload: { turn: 1, transcriptSource: 'openai_reasoning_summary', text: '**Inspecting parser**' } }),
        traceEvent({ id: 'reasoning_two', sequence: 2, payload: { turn: 1, transcriptSource: 'openai_reasoning_summary', text: '**Checking bounds**' } }),
        traceEvent({ id: 'tool_interrupt', sequence: 3, source: 'tool', type: 'tool_result', payload: { turn: 1 }, summary: 'Search returned output.' }),
        traceEvent({ id: 'reasoning_three', sequence: 4, payload: { turn: 1, transcriptSource: 'openai_reasoning_summary', text: '**Reviewing result**' } }),
        traceEvent({ id: 'reasoning_next_turn', sequence: 5, payload: { turn: 2, transcriptSource: 'openai_reasoning_summary', text: '**Starting next turn**' } })
      ],
      ALL_CATEGORIES
    );

    const coalesced = coalesceConsecutiveReasoningEntries(entries);

    expect(coalesced.map((entry) => entry.event.id)).toEqual(['reasoning_one', 'tool_interrupt', 'reasoning_three', 'reasoning_next_turn']);
    expect(coalesced[0].event.payload).toMatchObject({
      reasoningSummaryTexts: ['**Inspecting parser**', '**Checking bounds**'],
      coalescedTraceEventIds: ['reasoning_one', 'reasoning_two']
    });
    expect(traceDisplayEventContainsId(coalesced[0].event, 'reasoning_two')).toBe(true);
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

  it('keeps root and subagent turns in distinct agent-aware groups', () => {
    const entries = buildTraceTimelineEntries(
      [
        traceEvent({ id: 'root_thought', sequence: 1, payload: { turn: 1, agentPath: '/root' } }),
        traceEvent({ id: 'root_same_turn', sequence: 2, payload: { turn: 1, agentPath: '/root' } }),
        traceEvent({ id: 'child_turn', sequence: 3, payload: { turn: 1, agentPath: '/root/parser_review' } }),
        traceEvent({ id: 'root_return', sequence: 4, payload: { turn: 2, agentPath: '/root' } })
      ],
      ALL_CATEGORIES
    );

    expect(entries.map((entry) => [entry.event.id, entry.group.key, entry.group.label])).toEqual([
      ['root_thought', 'turn-1-1', 'Turn 1'],
      ['root_same_turn', 'turn-1-1', 'Turn 1'],
      ['child_turn', 'agent-root-parser_review-turn-1-3', '/root/parser_review · Turn 1'],
      ['root_return', 'turn-2-4', 'Turn 2']
    ]);
  });

  it('labels trace group status from errors, active latest state, completed activity, and passive events', () => {
    expect(traceGroupStatusLabel(group({ failureCount: 2 }), true, 'active')).toEqual({ kind: 'review', label: '2 Errors' });
    expect(traceGroupStatusLabel(group(), true, 'active')).toEqual({ kind: 'active', label: 'Active' });
    expect(traceGroupStatusLabel(group({ modelCount: 1 }), false, 'completed')).toEqual({ kind: 'complete', label: 'Turn Complete' });
    expect(traceGroupStatusLabel(group(), false, 'completed')).toEqual({ kind: 'events', label: 'Events' });
  });

  it('builds display events from transcripts while replacing linked trace rows', () => {
    const linkedTrace = traceEvent({
      id: 'trace_linked',
      sequence: 20,
      source: 'model',
      type: 'model_message',
      payload: { turn: 3 },
      createdAt: '2026-04-30T10:02:00.000Z'
    });
    const detail = runDetail({
      traceEvents: [traceEvent({ id: 'trace_setup', sequence: 1, createdAt: '2026-04-30T10:00:00.000Z' }), linkedTrace],
      transcriptMessages: [
        transcriptMessage({
          id: 'message_reasoning',
          traceEventId: 'trace_linked',
          role: 'assistant',
          source: 'openai_reasoning_summary',
          contentMarkdown: '**Focus** inspect auth',
          createdAt: '2026-04-30T10:02:00.000Z'
        })
      ]
    });

    const events = buildTraceDisplayEvents(detail);

    expect(events.map((event) => event.id)).toEqual(['trace_setup', 'transcript:message_reasoning']);
    expect(events[1]).toMatchObject({
      attemptId: null,
      displayOnly: true,
      modelVisible: true,
      sequence: 20.01,
      source: 'model',
      summary: 'Reasoning.',
      transcriptMessageId: 'message_reasoning',
      payload: {
        linkedTraceEventId: 'trace_linked',
        text: '**Focus** inspect auth',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        turn: 3
      }
    });
  });

  it('deduplicates transcript display events by source, response item, and normalized text', () => {
    const detail = runDetail({
      transcriptMessages: [
        transcriptMessage({ id: 'message_one', contentMarkdown: 'Hello   world', metadata: { responseId: 'resp_1', itemId: 'item_1' } }),
        transcriptMessage({ id: 'message_duplicate', contentMarkdown: 'Hello world', metadata: { responseId: 'resp_1', itemId: 'item_1' } }),
        transcriptMessage({ id: 'message_distinct', contentMarkdown: 'Hello world', metadata: { responseId: 'resp_1', itemId: 'item_2' } }),
        transcriptMessage({ id: 'message_unkeyed', contentMarkdown: 'Hello world', metadata: {} }),
        transcriptMessage({ id: 'message_unkeyed_duplicate', contentMarkdown: 'Hello world', metadata: {} })
      ]
    });

    expect(buildTraceDisplayEvents(detail).map((event) => event.id)).toEqual([
      'transcript:message_one',
      'transcript:message_distinct',
      'transcript:message_unkeyed',
      'transcript:message_unkeyed_duplicate'
    ]);
  });

  it('keeps equal transcript items distinct across agents and preserves metadata attribution', () => {
    const detail = runDetail({
      transcriptMessages: [
        transcriptMessage({
          id: 'message_root',
          phase: 'commentary',
          source: 'honeycrisp_commentary',
          contentMarkdown: 'Checking the boundary.',
          metadata: {
            agentPath: '/root',
            responseId: 'shared_response',
            itemId: 'shared_item',
            messagePhase: 'commentary'
          }
        }),
        transcriptMessage({
          id: 'message_child',
          phase: 'commentary',
          source: 'honeycrisp_commentary',
          contentMarkdown: 'Checking the boundary.',
          metadata: {
            agentPath: '/root/parser_review',
            responseId: 'shared_response',
            itemId: 'shared_item',
            messagePhase: 'commentary'
          }
        })
      ]
    });

    expect(buildTraceDisplayEvents(detail).map((event) => ({
      id: event.id,
      agentPath: event.payload.agentPath,
      messagePhase: event.payload.messagePhase
    }))).toEqual([
      { id: 'transcript:message_root', agentPath: '/root', messagePhase: 'commentary' },
      { id: 'transcript:message_child', agentPath: '/root/parser_review', messagePhase: 'commentary' }
    ]);
  });

  it('builds root-only display events without projecting child-agent transcripts', () => {
    const rootTrace = traceEvent({ id: 'trace_root', sequence: 1, payload: { agentPath: '/root', turn: 1 } });
    const childTrace = traceEvent({ id: 'trace_child', sequence: 2, payload: { agentPath: '/root/parser_review', turn: 1 } });
    const detail = runDetail({
      traceEvents: [rootTrace, childTrace],
      transcriptMessages: [
        transcriptMessage({
          id: 'message_root',
          traceEventId: 'trace_root',
          contentMarkdown: 'Root commentary.',
          metadata: { agentPath: '/root' }
        }),
        transcriptMessage({
          id: 'message_child',
          traceEventId: 'trace_child',
          contentMarkdown: 'Child commentary.',
          metadata: { agentPath: '/root/parser_review' }
        })
      ]
    });

    expect(buildTraceDisplayEventsForAgentPath(detail, null).map((event) => event.id)).toEqual([
      'transcript:message_root'
    ]);
    expect(buildTraceDisplayEventsForAgentPath(detail, '/root/parser_review').map((event) => event.id)).toEqual([
      'transcript:message_child'
    ]);
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
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}

function honeycrispToolEvent(kind: 'tool.requested' | 'tool.observed', toolActionId: string, toolName: string, sequence: number): TraceEventRecord {
  return traceEvent({
    id: `trace_tool_${sequence}`,
    sequence,
    source: kind === 'tool.requested' ? 'model' : 'tool',
    type: kind === 'tool.requested' ? 'tool_call' : 'tool_result',
    summary: `Honeycrisp ${kind}: ${toolName}`,
    payload: {
      agentPath: '/root',
      honeycrispKind: kind,
      payload: { toolActionId, toolName, normalizedInputs: {} }
    }
  });
}

function runDetail(input: { traceEvents?: TraceEventRecord[]; transcriptMessages?: TranscriptMessageRecord[] } = {}): RunDetail {
  return {
    run: {
      id: 'run_test',
      status: 'completed',
      createdAt: '2026-04-30T10:00:00.000Z',
      startedAt: '2026-04-30T10:00:00.000Z',
      endedAt: null,
      mode: 'dynamic',
      attemptStrategy: 'breadth_first',
      title: '',
      promptMarkdown: ''
    },
    attempts: [],
    traceEvents: input.traceEvents ?? [],
    transcriptMessages: input.transcriptMessages ?? [],
    hypotheses: [],
    artifacts: [],
    evidence: [],
    findings: [],
    verifierContracts: [],
    verifierRuns: [],
    modelSessions: [],
    contextCompactions: [],
    policyEvents: [],
    exports: []
  } as unknown as RunDetail;
}

function transcriptMessage(input: Partial<TranscriptMessageRecord> = {}): TranscriptMessageRecord {
  return {
    id: 'message_test',
    runId: 'run_test',
    attemptId: null,
    traceEventId: null,
    role: 'assistant',
    contentMarkdown: 'Agent response.',
    source: 'openai_output_text',
    metadata: {},
    createdAt: '2026-04-30T10:00:00.000Z',
    ...input
  };
}
