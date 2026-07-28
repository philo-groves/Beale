import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '@shared/types';
import { activeSubagentCount, subagentSummaries, traceEventsForSubagent } from '../src/renderer/view-models/subagents';

describe('subagent trace view models', () => {
  it('summarizes child identity, latest message, state, and activity', () => {
    const events = [
      traceEvent({ id: 'root', sequence: 1, payload: { agentPath: '/root', text: 'Root output.' } }),
      traceEvent({
        id: 'spawn',
        sequence: 2,
        createdAt: '2026-07-20T10:00:00.000Z',
        payload: { type: 'subagent.activity', action: 'spawned', agentId: 'agent_one', agentPath: '/root/parser_review', status: 'running', message: 'Inspect parser.' }
      }),
      traceEvent({
        id: 'output',
        sequence: 3,
        createdAt: '2026-07-20T10:03:00.000Z',
        payload: { agentId: 'agent_one', agentPath: '/root/parser_review', text: 'Found a bounded parser edge.\nNeeds verification.' }
      }),
      traceEvent({
        id: 'completed',
        sequence: 4,
        createdAt: '2026-07-20T10:04:00.000Z',
        payload: { type: 'subagent.activity', action: 'completed', agentId: 'agent_one', agentPath: '/root/parser_review', status: 'completed', message: 'Parser review complete.' }
      })
    ];

    expect(subagentSummaries(events)).toEqual([
      {
        id: 'agent_one',
        path: '/root/parser_review',
        name: 'parser_review',
        status: 'completed',
        latestMessage: 'Parser review complete.',
        createdAt: '2026-07-20T10:00:00.000Z',
        lastActiveAt: '2026-07-20T10:04:00.000Z'
      }
    ]);
  });

  it('keeps subagents in creation order when their activity changes', () => {
    const events = [
      traceEvent({
        id: 'first-spawn',
        createdAt: '2026-07-20T10:00:00.000Z',
        payload: { agentPath: '/root/first', status: 'running', message: 'First task.' }
      }),
      traceEvent({
        id: 'second-spawn',
        createdAt: '2026-07-20T10:01:00.000Z',
        payload: { agentPath: '/root/second', status: 'running', message: 'Second task.' }
      }),
      traceEvent({
        id: 'first-update',
        createdAt: '2026-07-20T10:03:00.000Z',
        payload: { agentPath: '/root/first', status: 'completed', message: 'First task complete.' }
      })
    ];

    expect(subagentSummaries(events).map((subagent) => subagent.path)).toEqual([
      '/root/first',
      '/root/second'
    ]);
  });

  it('prefers explicit spawn timestamps over earlier imported child activity', () => {
    const events = [
      traceEvent({
        id: 'late-child-import',
        createdAt: '2026-07-20T12:00:00.000Z',
        payload: {
          agentPath: '/root/created_second',
          honeycrispTimestamp: '2026-07-20T09:00:00.000Z',
          payload: { status: 'running', message: 'Imported activity.' }
        }
      }),
      traceEvent({
        id: 'first-spawn',
        createdAt: '2026-07-20T12:00:01.000Z',
        payload: {
          agentPath: '/root/created_first',
          honeycrispTimestamp: '2026-07-20T10:00:00.000Z',
          payload: { type: 'subagent.activity', action: 'spawned', status: 'running', message: 'First task.' }
        }
      }),
      traceEvent({
        id: 'second-spawn',
        createdAt: '2026-07-20T12:00:02.000Z',
        payload: {
          agentPath: '/root/created_second',
          honeycrispTimestamp: '2026-07-20T10:01:00.000Z',
          payload: { type: 'subagent.activity', action: 'spawned', status: 'running', message: 'Second task.' }
        }
      })
    ];

    expect(subagentSummaries(events).map((subagent) => [subagent.path, subagent.createdAt])).toEqual([
      ['/root/created_first', '2026-07-20T10:00:00.000Z'],
      ['/root/created_second', '2026-07-20T10:01:00.000Z']
    ]);
  });

  it('renders Markdown preview messages as compact plain text', () => {
    const events = [
      traceEvent({
        payload: {
          agentPath: '/root/reviewer',
          text: '## Review complete\n\nFound **two issues** in [`parser.ts`](src/parser.ts).\n- Validate `length`.'
        }
      })
    ];

    expect(subagentSummaries(events)[0]?.latestMessage).toBe(
      'Review complete Found two issues in parser.ts. Validate length.'
    );
  });

  it('filters traces by exact canonical child path', () => {
    const events = [
      traceEvent({ id: 'setup', payload: {} }),
      traceEvent({ id: 'root', payload: { agentPath: '/root' } }),
      traceEvent({ id: 'one', payload: { agentPath: '/root/one' } }),
      traceEvent({ id: 'two', payload: { agentPath: '/root/two' } })
    ];

    expect(traceEventsForSubagent(events, '/root/one').map((event) => event.id)).toEqual(['one']);
    expect(traceEventsForSubagent(events, null).map((event) => event.id)).toEqual(['setup', 'root']);
  });

  it('counts only pending and running subagents as active', () => {
    const base = {
      id: null,
      path: '/root/worker',
      name: 'worker',
      latestMessage: '',
      createdAt: '2026-07-20T10:00:00.000Z',
      lastActiveAt: '2026-07-20T10:00:00.000Z'
    };
    expect(activeSubagentCount([
      { ...base, path: '/root/pending', status: 'pending' },
      { ...base, path: '/root/running', status: 'running' },
      { ...base, path: '/root/completed', status: 'completed' },
      { ...base, path: '/root/interrupted', status: 'interrupted' },
      { ...base, path: '/root/errored', status: 'errored' }
    ])).toBe(2);
  });

});

function traceEvent(input: Partial<TraceEventRecord>): TraceEventRecord {
  return {
    id: 'trace_test',
    runId: 'run_test',
    attemptId: null,
    sequence: 1,
    source: 'model',
    type: 'model_message',
    summary: 'Trace.',
    payload: {},
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-07-20T10:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}
