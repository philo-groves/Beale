import { describe, expect, it } from 'vitest';
import type { RunDetail, RunDetailUpdate, TraceEventRecord, TranscriptMessageRecord, WorkspaceSnapshot } from '@shared/types';
import {
  mergeRunDetailUpdate,
  runDetailMetricDetail,
  runDetailUpdateCursor,
  runDetailUpdateMetricDetail,
  selectRunId,
  shortMetricId,
  snapshotMetricDetail
} from '../src/renderer/view-models/runDetailUpdates';

describe('renderer run detail update view model', () => {
  it('keeps selected run id when the run remains present', () => {
    expect(selectRunId('run_two', snapshot(['run_one', 'run_two']))).toBe('run_two');
    expect(selectRunId('missing', snapshot(['run_one', 'run_two']))).toBe('run_one');
    expect(selectRunId('run_one', null)).toBeNull();
  });

  it('builds update cursors and metric summaries', () => {
    const detail = runDetail({
      traceEvents: [traceEvent({ id: 'trace_old', sequence: 7 })],
      transcriptMessages: [transcriptMessage({ id: 'message_old' })]
    });
    const update = runDetailUpdate({
      traceEvents: [traceEvent({ id: 'trace_new', sequence: 8 })],
      transcriptMessages: [transcriptMessage({ id: 'message_new' })]
    });

    expect(runDetailUpdateCursor(detail)).toEqual({ afterTraceSequence: 7, afterTranscriptCount: 1 });
    expect(runDetailMetricDetail(detail)).toMatchObject({ run: 'run_test', traceEvents: 1, transcripts: 1 });
    expect(runDetailUpdateMetricDetail(update)).toMatchObject({ run: 'run_test', traceEvents: 1, transcripts: 1, versionDatabaseMs: 4.5 });
    expect(snapshotMetricDetail(snapshot(['run_one']))).toMatchObject({ active: true, runs: 1 });
    expect(shortMetricId('run_1234567890abcdef')).toBe('run_12...cdef');
  });

  it('merges incremental trace and transcript rows by id and stable order', () => {
    const current = runDetail({
      traceEvents: [
        traceEvent({ id: 'trace_2', sequence: 2, summary: 'old' }),
        traceEvent({ id: 'trace_4', sequence: 4 })
      ],
      transcriptMessages: [
        transcriptMessage({ id: 'message_b', createdAt: '2026-04-30T00:02:00.000Z', contentMarkdown: 'old' })
      ]
    });
    const update = runDetailUpdate({
      traceEvents: [
        traceEvent({ id: 'trace_3', sequence: 3 }),
        traceEvent({ id: 'trace_2', sequence: 2, summary: 'new' })
      ],
      transcriptMessages: [
        transcriptMessage({ id: 'message_a', createdAt: '2026-04-30T00:01:00.000Z' }),
        transcriptMessage({ id: 'message_b', createdAt: '2026-04-30T00:02:00.000Z', contentMarkdown: 'new' })
      ]
    });

    const merged = mergeRunDetailUpdate(current, update);

    expect(merged.traceEvents.map((event) => `${event.id}:${event.summary}`)).toEqual(['trace_2:new', 'trace_3:summary', 'trace_4:summary']);
    expect(merged.transcriptMessages.map((message) => `${message.id}:${message.contentMarkdown}`)).toEqual(['message_a:content', 'message_b:new']);
  });
});

function snapshot(runIds: string[]): WorkspaceSnapshot {
  return {
    workspace: { workspaceId: 'workspace_test' },
    runs: runIds.map((id) => ({ run: { id } })),
    notifications: []
  } as unknown as WorkspaceSnapshot;
}

function runDetail(input: { traceEvents?: TraceEventRecord[]; transcriptMessages?: TranscriptMessageRecord[] } = {}): RunDetail {
  return {
    run: { id: 'run_test', status: 'active' },
    attempts: [],
    traceEvents: input.traceEvents ?? [],
    transcriptMessages: input.transcriptMessages ?? [],
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

function runDetailUpdate(input: { traceEvents?: TraceEventRecord[]; transcriptMessages?: TranscriptMessageRecord[] } = {}): RunDetailUpdate {
  return {
    ...runDetail(input),
    version: {
      runId: 'run_test',
      version: 'version_test',
      databaseMs: 4.5
    }
  } as unknown as RunDetailUpdate;
}

function traceEvent(input: Partial<TraceEventRecord> = {}): TraceEventRecord {
  return {
    id: 'trace_test',
    runId: 'run_test',
    attemptId: null,
    sequence: 1,
    source: 'model',
    type: 'model_message',
    summary: 'summary',
    payload: {},
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-04-30T00:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}

function transcriptMessage(input: Partial<TranscriptMessageRecord> = {}): TranscriptMessageRecord {
  return {
    id: 'message_test',
    runId: 'run_test',
    attemptId: null,
    traceEventId: null,
    role: 'assistant',
    contentMarkdown: 'content',
    source: 'openai',
    createdAt: '2026-04-30T00:00:00.000Z',
    metadata: {},
    ...input
  };
}
