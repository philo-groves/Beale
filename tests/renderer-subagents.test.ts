import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '@shared/types';
import { formatRelativeActivity, subagentSummaries, traceEventsForSubagent } from '../src/renderer/view-models/subagents';

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
        lastActiveAt: '2026-07-20T10:04:00.000Z'
      }
    ]);
  });

  it('filters traces by exact canonical child path', () => {
    const events = [
      traceEvent({ id: 'root', payload: { agentPath: '/root' } }),
      traceEvent({ id: 'one', payload: { agentPath: '/root/one' } }),
      traceEvent({ id: 'two', payload: { agentPath: '/root/two' } })
    ];

    expect(traceEventsForSubagent(events, '/root/one').map((event) => event.id)).toEqual(['one']);
    expect(traceEventsForSubagent(events, null)).toBe(events);
  });

  it('formats compact relative activity labels', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    expect(formatRelativeActivity('2026-07-20T11:59:40.000Z', now)).toBe('now');
    expect(formatRelativeActivity('2026-07-20T11:57:00.000Z', now)).toBe('3m');
    expect(formatRelativeActivity('2026-07-20T07:00:00.000Z', now)).toBe('5h');
    expect(formatRelativeActivity('2026-07-18T12:00:00.000Z', now)).toBe('2d');
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
