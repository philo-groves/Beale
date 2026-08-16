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
});

function toolEvent(id: string, kind: 'tool.requested' | 'tool.observed', payload: Record<string, unknown>): TraceEventRecord {
  return traceEvent(id, {
    source: 'executor',
    type: 'research_event',
    summary: `Honeycrisp ${kind}: file.read.`,
    payload: {
      honeycrispKind: kind,
      toolName: 'file.read',
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
    artifacts: [],
    verifierContracts: [],
    verifierRuns: [],
    modelSessions: [],
    contextCompactions: [],
    policyEvents: [],
    exports: []
  } as unknown as RunDetail;
}
