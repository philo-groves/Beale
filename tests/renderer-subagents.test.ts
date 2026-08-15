import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '@shared/types';
import { providerIconKind } from '../src/renderer/app/ProviderIcon';
import { activeSubagentCount, filterSubagentSummaries, subagentCatalogGroups, subagentDisplayName, subagentOverviewForEvents, subagentOverviewFromSummaries, subagentOverviewStatusCountSummary, subagentStatusCountSummary, subagentStatusIconKind, subagentStatusLabel, subagentSummaries, traceEventsForSubagent } from '../src/renderer/view-models/subagents';

describe('subagent trace view models', () => {
  it('maps supported provider and model identifiers to provider marks', () => {
    expect(providerIconKind('openai-codex')).toBe('openai');
    expect(providerIconKind('gpt-5.6-sol')).toBe('openai');
    expect(providerIconKind('anthropic')).toBe('anthropic');
    expect(providerIconKind('claude-opus-4-8')).toBe('anthropic');
    expect(providerIconKind('xai')).toBe('xai');
    expect(providerIconKind('grok-4.6')).toBe('xai');
    expect(providerIconKind('zai')).toBe('zai');
    expect(providerIconKind('glm-5.3')).toBe('zai');
    expect(providerIconKind(null)).toBe('unknown');
  });

  it('formats raw subagent names for display without changing their identity', () => {
    expect(subagentDisplayName('parser_review')).toBe('Parser Review');
    expect(subagentDisplayName('deep_input_parser')).toBe('Deep Input Parser');
    expect(subagentDisplayName('HTTP_worker')).toBe('HTTP Worker');
  });

  it('filters subagents by display name, status, and latest message', () => {
    const parser = {
      id: 'agent_parser',
      path: '/root/parser_review',
      name: 'parser_review',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      status: 'running' as const,
      latestMessage: 'Checking the length boundary.',
      createdAt: '2026-07-20T10:00:00.000Z',
      lastActiveAt: '2026-07-20T10:01:00.000Z'
    };
    const verifier = {
      ...parser,
      id: 'agent_verifier',
      path: '/root/proof_verifier',
      name: 'proof_verifier',
      status: 'completed' as const,
      latestMessage: 'Reproduction confirmed.'
    };
    expect(filterSubagentSummaries([parser, verifier], 'Parser Review')).toEqual([parser]);
    expect(filterSubagentSummaries([parser, verifier], 'completed')).toEqual([verifier]);
    expect(filterSubagentSummaries([parser, verifier], 'length boundary')).toEqual([parser]);
    expect(filterSubagentSummaries([parser, verifier], 'gpt-5.6-sol')).toEqual([parser, verifier]);
  });

  it('summarizes child identity, latest message, state, and activity', () => {
    const events = [
      traceEvent({ id: 'root', sequence: 1, payload: { agentPath: '/root', text: 'Root output.' } }),
      traceEvent({
        id: 'spawn',
        sequence: 2,
        createdAt: '2026-07-20T10:00:00.000Z',
        payload: { type: 'subagent.activity', action: 'spawned', agentId: 'agent_one', agentPath: '/root/parser_review', provider: 'anthropic', model: 'claude-opus-4-8', status: 'running', message: 'Inspect parser.' }
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
        provider: 'anthropic',
        model: 'claude-opus-4-8',
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
      provider: null,
      model: null,
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

  it('groups errors and interruptions with completed subagents', () => {
    const base = {
      id: null,
      path: '/root/worker',
      name: 'worker',
      provider: null,
      model: null,
      latestMessage: '',
      createdAt: '2026-07-20T10:00:00.000Z',
      lastActiveAt: '2026-07-20T10:00:00.000Z'
    };
    const pending = { ...base, path: '/root/pending', status: 'pending' as const };
    const running = { ...base, path: '/root/running', status: 'running' as const, createdAt: '2026-07-20T10:01:00.000Z' };
    const completed = { ...base, path: '/root/completed', status: 'completed' as const };
    const interrupted = { ...base, path: '/root/interrupted', status: 'interrupted' as const };
    const errored = { ...base, path: '/root/errored', status: 'errored' as const };

    expect(subagentCatalogGroups([pending, completed, running, interrupted, errored])).toEqual({
      active: [running, pending],
      completed: [completed, errored, interrupted]
    });
  });

  it('maps subagent states to active, error, and success icons', () => {
    expect(subagentStatusIconKind('pending')).toBe('active');
    expect(subagentStatusIconKind('running')).toBe('active');
    expect(subagentStatusIconKind('completed')).toBe('success');
    expect(subagentStatusIconKind('errored')).toBe('error');
    expect(subagentStatusIconKind('interrupted')).toBe('error');
  });

  it('includes interrupted and errored agents in the completed summary count without repeating errors', () => {
    const base = {
      id: null,
      path: '/root/worker',
      name: 'worker',
      provider: null,
      model: null,
      latestMessage: '',
      createdAt: '2026-07-20T10:00:00.000Z',
      lastActiveAt: '2026-07-20T10:00:00.000Z'
    };
    expect(subagentStatusCountSummary([])).toBe('');
    expect(subagentStatusCountSummary([
      { ...base, path: '/root/running', status: 'running' },
      { ...base, path: '/root/completed-one', status: 'completed' },
      { ...base, path: '/root/completed-two', status: 'completed' },
      { ...base, path: '/root/interrupted', status: 'interrupted' },
      { ...base, path: '/root/errored', status: 'errored' }
    ])).toBe('1 Active, 4 Completed');
  });

  it('does not replace lifecycle state with child tool result status', () => {
    const events = [
      traceEvent({
        id: 'spawn',
        sequence: 1,
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentId: 'agent_worker',
          agentPath: '/root/worker',
          status: 'running'
        }
      }),
      traceEvent({
        id: 'tool-observed',
        sequence: 2,
        payload: {
          agentId: 'agent_worker',
          agentPath: '/root/worker',
          honeycrispKind: 'tool.observed',
          status: 'complete',
          summary: 'Shell completed successfully.'
        }
      })
    ];

    const subagents = subagentSummaries(events);
    expect(subagents[0]?.status).toBe('running');
    expect(activeSubagentCount(subagents)).toBe(1);
  });

  it('preserves interrupted state when late child events arrive', () => {
    const events = [
      traceEvent({
        id: 'spawn',
        sequence: 1,
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/worker',
          status: 'running'
        }
      }),
      traceEvent({
        id: 'interrupted',
        sequence: 2,
        payload: {
          type: 'subagent.activity',
          action: 'interrupted',
          agentPath: '/root/worker',
          status: 'interrupted'
        }
      }),
      traceEvent({
        id: 'late-tool-observed',
        sequence: 3,
        payload: {
          agentPath: '/root/worker',
          honeycrispKind: 'tool.observed',
          status: 'complete'
        }
      })
    ];

    const subagents = subagentSummaries(events);
    expect(subagents[0]?.status).toBe('interrupted');
    expect(activeSubagentCount(subagents)).toBe(0);
    expect(subagentStatusLabel(subagents[0]!.status)).toBe('Interrupted');
  });

  it('derives canonical lifecycle state from activity actions when status is absent', () => {
    const events = [
      traceEvent({
        id: 'spawn',
        sequence: 1,
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/worker'
        }
      }),
      traceEvent({
        id: 'errored',
        sequence: 2,
        payload: {
          type: 'subagent.activity',
          action: 'errored',
          agentPath: '/root/worker'
        }
      })
    ];

    const subagent = subagentSummaries(events)[0];
    expect(subagent?.status).toBe('errored');
    expect(subagentStatusLabel(subagent!.status)).toBe('Error');
  });

  it('interrupts unresolved agents from superseded attempts while preserving current agents', () => {
    const events = [
      traceEvent({
        id: 'old-root',
        attemptId: 'attempt_old',
        sequence: 1,
        payload: { agentPath: '/root', turn: 1 }
      }),
      traceEvent({
        id: 'old-spawn',
        attemptId: 'attempt_old',
        sequence: 2,
        createdAt: '2026-07-20T10:00:00.000Z',
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/old_worker',
          status: 'running'
        }
      }),
      traceEvent({
        id: 'current-root',
        attemptId: 'attempt_current',
        sequence: 3,
        payload: { agentPath: '/root', turn: 1 }
      }),
      traceEvent({
        id: 'current-spawn',
        attemptId: 'attempt_current',
        sequence: 4,
        createdAt: '2026-07-20T10:01:00.000Z',
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/current_worker',
          status: 'running'
        }
      })
    ];

    const subagents = subagentSummaries(events, 'active');
    expect(subagents.map((subagent) => [subagent.path, subagent.status])).toEqual([
      ['/root/old_worker', 'interrupted'],
      ['/root/current_worker', 'running']
    ]);
    expect(activeSubagentCount(subagents)).toBe(1);
  });

  it('interrupts unresolved agents when the parent session is terminal', () => {
    const events = [
      traceEvent({
        id: 'spawn',
        attemptId: 'attempt_current',
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/worker',
          status: 'running'
        }
      })
    ];

    const subagents = subagentSummaries(events, 'completed');
    expect(subagents[0]?.status).toBe('interrupted');
    expect(activeSubagentCount(subagents)).toBe(0);
  });

  it('computes a lightweight subagent overview without full message previews', () => {
    const events = [
      traceEvent({
        id: 'running',
        sequence: 1,
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/running_worker',
          status: 'running',
          message: 'This expensive preview is not needed for counts.'
        }
      }),
      traceEvent({
        id: 'completed',
        sequence: 2,
        payload: {
          type: 'subagent.activity',
          action: 'completed',
          agentPath: '/root/completed_worker',
          status: 'completed',
          message: 'Done.'
        }
      }),
      traceEvent({
        id: 'errored',
        sequence: 3,
        payload: {
          type: 'subagent.activity',
          action: 'errored',
          agentPath: '/root/errored_worker',
          status: 'errored',
          message: 'Provider failed.'
        }
      })
    ];

    const fullOverview = subagentOverviewFromSummaries(subagentSummaries(events, 'active', 'commentary'));
    const lightweightOverview = subagentOverviewForEvents(events, 'active');
    expect(lightweightOverview).toEqual(fullOverview);
    expect(subagentOverviewStatusCountSummary(lightweightOverview)).toBe('1 Active, 2 Completed');
  });

  it('interrupts unresolved agents when workspace recovery paused their parent session', () => {
    const events = [
      traceEvent({
        id: 'spawn',
        attemptId: 'attempt_interrupted',
        sequence: 1,
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/worker',
          status: 'running'
        }
      }),
      traceEvent({
        id: 'recovery',
        attemptId: 'attempt_interrupted',
        sequence: 2,
        source: 'system',
        type: 'vm_event',
        summary: 'Workspace recovery paused interrupted run after app restart.',
        payload: {}
      }),
      traceEvent({
        id: 'late-event',
        attemptId: 'attempt_interrupted',
        sequence: 3,
        payload: {
          type: 'subagent.activity',
          action: 'message',
          agentPath: '/root/worker',
          status: 'running',
          message: 'Late output from the interrupted process.'
        }
      })
    ];

    const subagents = subagentSummaries(events, 'paused');
    expect(subagents[0]?.status).toBe('interrupted');
    expect(activeSubagentCount(subagents)).toBe(0);
  });

  it('keeps agents started after recovery active during a later intentional pause', () => {
    const events = [
      traceEvent({
        id: 'recovery',
        attemptId: 'attempt_interrupted',
        sequence: 1,
        source: 'system',
        type: 'vm_event',
        summary: 'Workspace recovery paused interrupted run after app restart.',
        payload: { interruptedByRecovery: true }
      }),
      traceEvent({
        id: 'current-root',
        attemptId: 'attempt_current',
        sequence: 2,
        payload: { agentPath: '/root', turn: 1 }
      }),
      traceEvent({
        id: 'spawn',
        attemptId: 'attempt_current',
        sequence: 3,
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/worker',
          status: 'running'
        }
      })
    ];

    const subagents = subagentSummaries(events, 'paused');
    expect(subagents[0]?.status).toBe('running');
    expect(activeSubagentCount(subagents)).toBe(1);
  });

  it('uses the latest assistant commentary in Commentary mode despite later tool events', () => {
    const events = [
      traceEvent({
        id: 'spawn',
        sequence: 1,
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/worker',
          message: 'Inspect the parser.'
        }
      }),
      traceEvent({
        id: 'commentary',
        sequence: 2,
        payload: {
          agentPath: '/root/worker',
          transcriptRole: 'assistant',
          transcriptSource: 'honeycrisp_commentary',
          messagePhase: 'commentary',
          text: 'The parser boundary is promising.'
        }
      }),
      traceEvent({
        id: 'tool',
        sequence: 3,
        payload: {
          agentPath: '/root/worker',
          honeycrispKind: 'tool.observed',
          message: 'Shell completed successfully.'
        }
      })
    ];

    expect(subagentSummaries(events, 'active', 'commentary')[0]?.latestMessage).toBe(
      'The parser boundary is promising.'
    );
  });

  it('lets newer follow-up assignments and failures replace stale commentary previews', () => {
    const baseEvents = [
      traceEvent({
        id: 'commentary',
        sequence: 1,
        payload: {
          agentPath: '/root/worker',
          transcriptRole: 'assistant',
          transcriptSource: 'honeycrisp_commentary',
          messagePhase: 'commentary',
          text: 'The first parser pass is complete.'
        }
      }),
      traceEvent({
        id: 'followup',
        sequence: 2,
        payload: {
          type: 'subagent.activity',
          action: 'followup',
          agentPath: '/root/worker',
          status: 'running',
          message: 'Now inspect integer conversion paths.'
        }
      })
    ];

    expect(subagentSummaries(baseEvents, 'active', 'commentary')[0]?.latestMessage).toBe(
      'Now inspect integer conversion paths.'
    );

    const erroredEvents = [...baseEvents, traceEvent({
      id: 'error',
      sequence: 3,
      payload: {
        type: 'subagent.activity',
        action: 'errored',
        agentPath: '/root/worker',
        status: 'errored',
        message: 'Provider request failed.'
      }
    })];
    expect(subagentSummaries(erroredEvents, 'active', 'commentary')[0]?.latestMessage).toBe(
      'Provider request failed.'
    );
  });

  it('uses a newer final response after subagent commentary', () => {
    const events = [
      traceEvent({
        id: 'commentary',
        sequence: 1,
        payload: {
          agentPath: '/root/worker',
          transcriptRole: 'assistant',
          transcriptSource: 'honeycrisp_commentary',
          messagePhase: 'commentary',
          text: 'Checking the final guard.'
        }
      }),
      traceEvent({
        id: 'final',
        sequence: 2,
        payload: {
          agentPath: '/root/worker',
          transcriptRole: 'assistant',
          transcriptSource: 'honeycrisp',
          messagePhase: 'final_answer',
          text: 'The guard is complete.'
        }
      })
    ];

    expect(subagentSummaries(events, 'completed', 'commentary')[0]?.latestMessage).toBe('The guard is complete.');
  });

  it('suppresses legacy reasoning only for subagents that have native commentary', () => {
    const events = [
      traceEvent({
        id: 'one-legacy',
        sequence: 1,
        payload: {
          agentPath: '/root/one',
          responseId: 'response_one',
          transcriptRole: 'assistant',
          transcriptSource: 'openai_reasoning_summary',
          text: 'Old preview for one.'
        }
      }),
      traceEvent({
        id: 'two-legacy',
        sequence: 2,
        payload: {
          agentPath: '/root/two',
          responseId: 'response_two',
          transcriptRole: 'assistant',
          transcriptSource: 'openai_reasoning_summary',
          text: 'Legacy preview for two.'
        }
      }),
      traceEvent({
        id: 'one-native',
        sequence: 3,
        payload: {
          agentPath: '/root/one',
          responseId: 'response_one',
          transcriptRole: 'assistant',
          transcriptSource: 'honeycrisp_commentary',
          messagePhase: 'commentary',
          text: 'Native preview for one.'
        }
      })
    ];

    expect(subagentSummaries(events, 'active', 'commentary').map(({ path, latestMessage }) => [path, latestMessage])).toEqual([
      ['/root/one', 'Native preview for one.'],
      ['/root/two', 'Legacy preview for two.']
    ]);
  });

  it('uses newer fallback progress after an earlier native commentary response', () => {
    const events = [
      traceEvent({
        id: 'native',
        sequence: 1,
        payload: {
          agentPath: '/root/worker',
          responseId: 'response_native',
          transcriptRole: 'assistant',
          transcriptSource: 'honeycrisp_commentary',
          messagePhase: 'commentary',
          text: 'Native commentary from the first response.'
        }
      }),
      traceEvent({
        id: 'fallback',
        sequence: 2,
        payload: {
          agentPath: '/root/worker',
          responseId: 'response_fallback',
          transcriptRole: 'assistant',
          transcriptSource: 'openai_reasoning_summary',
          text: 'Newer fallback progress after a provider change.'
        }
      })
    ];

    expect(subagentSummaries(events, 'active', 'commentary')[0]?.latestMessage).toBe(
      'Newer fallback progress after a provider change.'
    );
  });

  it('ignores unphased intermediate child text in Commentary mode', () => {
    const events = [
      traceEvent({
        id: 'spawn',
        sequence: 1,
        payload: {
          type: 'subagent.activity',
          action: 'spawned',
          agentPath: '/root/worker',
          message: 'Inspect the parser.'
        }
      }),
      traceEvent({
        id: 'unphased',
        sequence: 2,
        payload: {
          agentPath: '/root/worker',
          transcriptRole: 'assistant',
          transcriptSource: 'model_output',
          text: 'I will run another tool now.'
        }
      })
    ];

    expect(subagentSummaries(events, 'active', 'commentary')[0]?.latestMessage).toBe('Inspect the parser.');
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
