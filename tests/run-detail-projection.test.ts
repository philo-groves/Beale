import { describe, expect, it } from 'vitest';
import type { RunDetail, TraceEventRecord, TranscriptMessageRecord } from '@shared/types';
import {
  projectCommentaryTraceEvent,
  projectRunDetailForRenderer
} from '../src/shared/runDetailProjection';
import {
  commentaryMessagesForSession,
  hydrateCommentaryToolCall
} from '../src/renderer/view-models/commentary';
import {
  contextMeterForDetail,
  visibleCacheHitRateLabel,
  visibleContextWindowPercentageLabel,
  visibleSessionTokenUsageLabel
} from '../src/renderer/features/momentum/contextMeter';
import { buildTraceDisplayEventsForAgentPath } from '../src/renderer/view-models/traceDisplay';

describe('run detail commentary projection', () => {
  it('removes hidden event and tool bodies while preserving render and cursor scaffolding', () => {
    const hugeValue = 'hidden'.repeat(20_000);
    const requested = toolEvent('request', 'tool.requested', {
      toolActionId: 'action_one',
      toolName: 'file.read',
      normalizedInputs: { path: 'src/parser.ts', hidden: hugeValue }
    });
    const observed = toolEvent('observation', 'tool.observed', {
      toolActionId: 'action_one',
      toolName: 'file.read',
      normalizedInputs: { path: 'src/parser.ts', hidden: hugeValue },
      result: { text: hugeValue },
      rawOutputRef: hugeValue
    });
    const hiddenExecutor = traceEvent('hidden', {
      source: 'executor',
      type: 'research_event',
      payload: { text: hugeValue, honeycrispSessionEventId: 'session_event_hidden', agentPath: '/root' }
    });
    const detail = runDetail({
      traceEvents: [requested, observed, hiddenExecutor],
      transcriptMessages: [transcript('Visible commentary.', 'assistant'), transcript(hugeValue, 'system')]
    });

    const projected = projectRunDetailForRenderer(detail, 'commentary');

    expect(projected).not.toBe(detail);
    expect(projected.traceEvents).toHaveLength(detail.traceEvents.length);
    expect(projected.traceEvents[0]).toMatchObject({
      id: 'request',
      payload: {
        honeycrispKind: 'tool.requested',
        toolName: 'file.read',
        commentaryDetailDeferred: true,
        payload: {
          toolActionId: 'action_one',
          toolName: 'file.read',
          normalizedInputs: { path: 'src/parser.ts' }
        }
      }
    });
    expect(JSON.stringify(projected.traceEvents)).not.toContain(hugeValue);
    expect(projected.traceEvents[2]?.payload).toEqual({
      agentPath: '/root',
      honeycrispSessionEventId: 'session_event_hidden'
    });
    expect(projected.transcriptMessages[0]?.contentMarkdown).toBe('Visible commentary.');
    expect(projected.transcriptMessages[1]?.contentMarkdown).toBe('');
    expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(detail).length / 20);
    expect(projectRunDetailForRenderer(detail, 'full')).toBe(detail);
  });

  it('retains breakout-room records while projecting commentary', () => {
    const detail = runDetail({
      breakoutRooms: [{ id: 'room_one', title: 'Parser challenge', status: 'active' }] as RunDetail['breakoutRooms'],
      breakoutRoomMembers: [{ id: 'member_one', roomId: 'room_one', agentPath: '/root/reviewer', status: 'active' }] as RunDetail['breakoutRoomMembers'],
      breakoutRoomMessages: [{ id: 'message_one', roomId: 'room_one', contentMarkdown: 'Reviewing parser state.' }] as RunDetail['breakoutRoomMessages']
    });

    const projected = projectRunDetailForRenderer(detail, 'commentary');

    expect(projected.breakoutRooms).toBe(detail.breakoutRooms);
    expect(projected.breakoutRoomMembers).toBe(detail.breakoutRoomMembers);
    expect(projected.breakoutRoomMessages).toBe(detail.breakoutRoomMessages);
  });

  it('defers tool input/output until the paired records are requested', () => {
    const requested = toolEvent('request', 'tool.requested', {
      toolActionId: 'action_one',
      toolName: 'file.read',
      normalizedInputs: { path: 'src/parser.ts' }
    });
    const observed = toolEvent('observation', 'tool.observed', {
      toolActionId: 'action_one',
      toolName: 'file.read',
      normalizedInputs: { path: 'src/parser.ts' },
      result: { text: 'file body' }
    });
    const detail = runDetail({ traceEvents: [requested, observed] });
    const projected = projectRunDetailForRenderer(detail, 'commentary');
    const messages = commentaryMessagesForSession(
      projected,
      buildTraceDisplayEventsForAgentPath(projected, null)
    );
    const deferred = messages.find((message) => message.kind === 'tool')?.toolCalls?.[0];

    expect(deferred).toMatchObject({
      id: 'request',
      traceEventId: 'observation',
      requestTraceEventId: 'request',
      observationTraceEventId: 'observation',
      detailsDeferred: true,
      label: 'src/parser.ts',
      input: undefined,
      output: undefined
    });

    const hydrated = hydrateCommentaryToolCall(deferred!, [requested, observed], projected);
    expect(hydrated).toMatchObject({
      detailsDeferred: false,
      label: 'src/parser.ts',
      input: { path: 'src/parser.ts' },
      output: { text: 'file body' }
    });
  });

  it('keeps content-bearing commentary events but strips unrelated payload fields', () => {
    const projected = projectCommentaryTraceEvent(traceEvent('commentary', {
      source: 'model',
      type: 'model_message',
      payload: {
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        text: 'Rendered reasoning.',
        internalState: { large: 'not rendered' },
        metadata: { responseId: 'response_one', privateValue: 'not rendered' }
      }
    }));

    expect(projected.payload).toEqual({
      transcriptRole: 'assistant',
      transcriptSource: 'honeycrisp_commentary',
      text: 'Rendered reasoning.',
      metadata: { responseId: 'response_one' }
    });
  });

  it('retains bounded session usage telemetry in the commentary projection', () => {
    const projected = projectRunDetailForRenderer(runDetail({
      traceEvents: [
        traceEvent('root-usage', {
          source: 'model',
          type: 'model_message',
          payload: {
            agentPath: '/root',
            usage: {
              input: 10_000,
              output: 1_000,
              cacheRead: 30_000,
              totalTokens: 41_000,
              cacheHitRate: 0.75,
              source: 'Honeycrisp reported model usage',
              privateProviderDetail: 'not rendered'
            }
          }
        }),
        traceEvent('auxiliary-usage', {
          source: 'model',
          type: 'model_message',
          payload: {
            payload: { agentPath: '/auxiliary-model', contextUsageEligible: false, privateValue: 'not rendered' },
            usage: { input: 500_000, output: 10_000, totalTokens: 510_000 }
          }
        })
      ]
    }), 'commentary');

    expect(projected.traceEvents[0]?.payload.usage).toEqual({
      input: 10_000,
      output: 1_000,
      cacheRead: 30_000,
      totalTokens: 41_000,
      cacheHitRate: 0.75,
      source: 'Honeycrisp reported model usage'
    });
    expect(projected.traceEvents[1]?.payload.payload).toEqual({
      agentPath: '/auxiliary-model',
      contextUsageEligible: false
    });
    const meter = contextMeterForDetail(projected);
    expect(visibleSessionTokenUsageLabel(meter)).toBe('41k');
    expect(visibleCacheHitRateLabel(meter)).toBe('75%');
    expect(visibleContextWindowPercentageLabel(meter)).toBe('20%');
  });

  it('retains a bounded shell command for its pre-expansion label', () => {
    const command = `printf 'visible command' ${'x'.repeat(600)}`;
    const projected = projectCommentaryTraceEvent(toolEvent('shell', 'tool.requested', {
      toolActionId: 'shell_action',
      toolName: 'shell.run',
      normalizedInputs: { command, secret: 'not rendered' }
    }));

    expect(projected.payload.payload).toEqual({
      toolActionId: 'shell_action',
      toolName: 'shell.run',
      normalizedInputs: { command: `${command.slice(0, 255)}…` }
    });
  });

  it('retains only the executed shell identity needed to label null-utility requests', () => {
    const projected = projectCommentaryTraceEvent(toolEvent('shell-result', 'tool.observed', {
      toolActionId: 'shell_action',
      toolName: 'shell.run',
      normalizedInputs: { utility: null, args: [], secret: 'not rendered' },
      result: {
        utility: '/bin/sh',
        args: ['-lc', 'tools/rr ping'],
        stdout: 'large output is deferred',
        stderr: ''
      }
    }));

    expect(projected.payload.payload).toEqual({
      toolActionId: 'shell_action',
      toolName: 'shell.run',
      normalizedInputs: { args: [] },
      result: { utility: '/bin/sh', args: ['-lc', 'tools/rr ping'] }
    });
  });
});

function toolEvent(id: string, kind: 'tool.requested' | 'tool.observed', payload: Record<string, unknown>): TraceEventRecord {
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'file.read';
  return traceEvent(id, {
    source: 'executor',
    type: 'research_event',
    summary: `Honeycrisp ${kind}: ${toolName}.`,
    payload: {
      honeycrispKind: kind,
      toolName,
      agentPath: '/root',
      honeycrispSessionEventId: id,
      payload
    }
  });
}

function traceEvent(
  id: string,
  input: Partial<TraceEventRecord> & Pick<TraceEventRecord, 'source' | 'type' | 'payload'>
): TraceEventRecord {
  return {
    id,
    runId: 'run_one',
    attemptId: 'attempt_one',
    sequence: id === 'request' ? 1 : id === 'observation' ? 2 : 3,
    summary: input.summary ?? 'Event.',
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-08-16T12:00:00.000Z',
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}

function transcript(contentMarkdown: string, role: TranscriptMessageRecord['role']): TranscriptMessageRecord {
  return {
    id: `transcript_${role}`,
    runId: 'run_one',
    attemptId: 'attempt_one',
    traceEventId: null,
    role,
    contentMarkdown,
    source: role === 'assistant' ? 'honeycrisp_commentary' : 'system',
    metadata: { agentPath: '/root', privateValue: 'not rendered' },
    createdAt: '2026-08-16T12:00:01.000Z'
  };
}

function runDetail(input: {
  traceEvents?: TraceEventRecord[];
  transcriptMessages?: TranscriptMessageRecord[];
  breakoutRooms?: RunDetail['breakoutRooms'];
  breakoutRoomMembers?: RunDetail['breakoutRoomMembers'];
  breakoutRoomMessages?: RunDetail['breakoutRoomMessages'];
}): RunDetail {
  return {
    run: {
      id: 'run_one',
      promptMarkdown: '',
      createdAt: '2026-08-16T12:00:00.000Z',
      status: 'active'
    },
    attempts: [],
    traceEvents: input.traceEvents ?? [],
    transcriptMessages: input.transcriptMessages ?? [],
    breakoutRooms: input.breakoutRooms,
    breakoutRoomMembers: input.breakoutRoomMembers,
    breakoutRoomMessages: input.breakoutRoomMessages,
    artifacts: [],
    verifierContracts: [],
    verifierRuns: [],
    modelSessions: [],
    contextCompactions: [],
    policyEvents: [],
    exports: []
  } as unknown as RunDetail;
}
