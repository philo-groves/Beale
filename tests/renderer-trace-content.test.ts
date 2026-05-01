import { describe, expect, it } from 'vitest';
import type { FindingRecord, HypothesisRecord, RunDetail, TraceEventRecord } from '@shared/types';
import {
  codeBrowserTracePreview,
  compactTracePath,
  duplicateBlockedTraceDetail,
  evidenceTracePreview,
  findingForTraceEvent,
  formatReasoningTraceText,
  hypothesisForTraceEvent,
  isProseTraceEvent,
  lineRangePart,
  pythonTracePreview,
  pythonToolCallPreview,
  reasoningTraceThoughtsFromText,
  traceEventDetailText,
  traceEventSummary,
  verifierTracePreview
} from '../src/renderer/view-models/traceContent';

describe('renderer trace content view models', () => {
  it('normalizes trace summaries into skimmable verb-led labels', () => {
    expect(traceEventSummary(traceEvent({ type: 'model_message', summary: 'OpenAI response completed.' }), 'agent_output')).toBe('Response Completed');
    expect(traceEventSummary(traceEvent({ type: 'model_message', summary: 'OpenAI Responses request sent for turn 12.' }), 'agent_output')).toBe('Request for Turn 12');
    expect(traceEventSummary(traceEvent({ type: 'model_message', summary: 'OpenAI streamed model output delta.' }), 'agent_output')).toBe('Model Output');
    expect(
      traceEventSummary(
        traceEvent({ type: 'tool_call', summary: 'OpenAI completed function call arguments for python.', payload: { toolName: 'python' } }),
        'tools'
      )
    ).toBe('Prepare Python');
    expect(traceEventSummary(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: python.' }), 'tools')).toBe('Queue Python');
    expect(traceEventSummary(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: hypothesis.' }), 'hypotheses')).toBe('Queue Hypothesis');
    expect(traceEventSummary(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: finding.' }), 'evidence')).toBe('Queue Finding');
    expect(traceEventSummary(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: evidence.' }), 'non_standard')).toBe('Queue Evidence');
    expect(traceEventSummary(traceEvent({ type: 'tool_call', summary: 'OpenAI completed function call arguments for verifier.', payload: { toolName: 'verifier' } }), 'non_standard')).toBe(
      'Prepare Verifier'
    );
    expect(traceEventSummary(traceEvent({ type: 'tool_call', summary: 'OpenAI completed function call arguments for code_browser.', payload: { toolName: 'code_browser' } }), 'non_standard')).toBe(
      'Prepare Code Browser'
    );
    expect(traceEventSummary(traceEvent({ type: 'tool_call', summary: 'OpenAI completed function call arguments for search.', payload: { toolName: 'search' } }), 'code_navigation')).toBe(
      'Prepare Search'
    );
    expect(traceEventSummary(traceEvent({ type: 'tool_call', summary: 'OpenAI requested Beale tool: search.' }), 'non_standard')).toBe('Queue Search');
    expect(traceEventSummary(traceEvent({ type: 'tool_result', summary: 'Search examined 6 scoped files and returned 40 matches.' }), 'code_navigation')).toBe(
      'Examined 6 files and returned 40 matches'
    );
    expect(traceEventSummary(traceEvent({ type: 'tool_result', summary: 'Examined 1 file and returned 1 match.' }), 'code_navigation')).toBe('Examined 1 file and returned 1 match');
    expect(traceEventSummary(traceEvent({ type: 'tool_result', summary: 'Code browser returned 156 bounded lines.' }), 'code_navigation')).toBe('Read Code');
    expect(traceEventSummary(traceEvent({ type: 'tool_result', summary: 'Code browser could not read the requested bounded text.' }), 'failure_recovery')).toBe('Code Browser Error');
    expect(traceEventSummary(traceEvent({ type: 'artifact_created', summary: 'Evidence recorded: Verifier confirmed the auth bypass.' }), 'evidence')).toBe('Evidence Recorded');
    expect(traceEventSummary(traceEvent({ type: 'verifier_result', summary: 'Verifier contract executed with pass; finding promotion remains gated.' }), 'verifier')).toBe('Verifier Execution');
    expect(traceEventSummary(traceEvent({ type: 'verifier_result', summary: 'Verifier contract executed on host with pass.' }), 'verifier')).toBe('Verifier Execution');
    expect(traceEventSummary(traceEvent({ type: 'tool_result', summary: 'Host python operation finished with success.' }), 'tools')).toBe('Run Python: success');
    expect(
      traceEventSummary(
        traceEvent({
          type: 'hypothesis_event',
          summary: 'Duplicate hypothesis blocked before creation: ACME challenge middleware bypasses Pages access control',
          payload: { action: 'duplicate_blocked' }
        }),
        'failure_recovery'
      )
    ).toBe('Duplicate Blocked');
    expect(traceEventSummary(traceEvent({ summary: 'Search completed.' }), 'code_navigation')).toBe('Search completed');
    expect(traceEventSummary(traceEvent({ summary: 'Repository status changed.' }), 'events')).toBe('Note: Repository status changed');
  });

  it('formats reasoning summaries while preserving thought boundaries', () => {
    expect(formatReasoningTraceText('**Focus** Check parser\nwith range checks\n\n**Risk** Validate index use')).toBe(
      '**Focus**\nCheck parser with range checks\n\n**Risk**\nValidate index use'
    );
    expect(reasoningTraceThoughtsFromText('**Focus** Check parser\nwith range checks\n\n**Risk** Validate index use')).toEqual([
      { title: 'Focus', description: 'Check parser with range checks' },
      { title: 'Risk', description: 'Validate index use' }
    ]);
    expect(
      traceEventDetailText(
        traceEvent({
          type: 'model_message',
          source: 'model',
          summary: 'OpenAI completed thought.',
          payload: {
            text: '**Focus** Check parser',
            transcriptKind: 'reasoning_summary'
          }
        }),
        'agent_output'
      )
    ).toBe('**Focus**\nCheck parser');
  });

  it('formats key trace detail content without raw JSON noise', () => {
    const search = traceEvent({
      type: 'tool_result',
      source: 'tool',
      summary: 'Search returned results.',
      payload: { query: 'decodeToken', matches: ['a', 'b'], filesConsidered: 14, target: 'auth' }
    });
    expect(traceEventDetailText(search, 'code_navigation')).toBe('query "decodeToken" · 2 matches · files 14 · target auth');

    const hypothesisTool = traceEvent({
      type: 'tool_call',
      source: 'model',
      summary: 'OpenAI completed function call arguments for hypothesis.',
      payload: {
        toolName: 'hypothesis',
        arguments: {
          title: 'Reflected callback parameter reaches HTML',
          primary_cwe_id: '79',
          primary_cwe_name: 'Cross-site Scripting'
        }
      }
    });
    expect(traceEventDetailText(hypothesisTool, 'hypotheses')).toBe('Cross-site Scripting (CWE-79): Reflected callback parameter reaches HTML');

    const duplicate = traceEvent({
      type: 'hypothesis_event',
      source: 'system',
      summary: 'Duplicate hypothesis blocked before creation: ACME challenge middleware bypasses Pages access control.',
      payload: {
        claimStatus: 'duplicate_review',
        action: 'duplicate_blocked',
        proposedTitle: 'ACME challenge middleware bypasses Pages access control',
        matchedEntityKind: 'finding',
        matchedEntityId: 'finding_existing'
      }
    });
    expect(traceEventDetailText(duplicate, 'failure_recovery')).toBe(
      'ACME challenge middleware bypasses Pages access control\nclaim Duplicate Review · action Duplicate Blocked · matched finding finding_existing'
    );
    expect(duplicateBlockedTraceDetail(duplicate)).toEqual({
      attributes: 'claim Duplicate Review · action Duplicate Blocked · matched finding finding_existing',
      title: 'ACME challenge middleware bypasses Pages access control'
    });
    expect(isProseTraceEvent(duplicate, 'failure_recovery')).toBe(true);
  });

  it('builds python previews and prose decisions for trace rows', () => {
    const python = traceEvent({
      type: 'tool_call',
      summary: 'OpenAI completed function call arguments for python.',
      payload: {
        toolName: 'python',
        arguments: {
          task: 'Check parser edge cases',
          script: Array.from({ length: 10 }, (_, index) => `print(${index})`).join('\n')
        }
      }
    });

    expect(pythonToolCallPreview(python)).toMatchObject({
      task: 'Check parser edge cases',
      scriptLines: ['print(0)', 'print(1)', 'print(2)', 'print(3)', 'print(4)'],
      scriptLineCount: 10,
      truncated: true,
      outputLines: []
    });

    const result = traceEvent({
      id: 'trace_result',
      type: 'tool_result',
      summary: 'Host python operation finished with success.',
      toolCallId: 'tool_python',
      payload: { exitCode: 0, stdoutSummary: 'ok\nnext', stderrSummary: '' }
    });
    const detail = runDetail({
      traceEvents: [
        traceEvent({
          id: 'trace_tool_call',
          type: 'tool_call',
          summary: 'OpenAI requested Beale tool: python.',
          toolCallId: 'tool_python',
          payload: python.payload
        }),
        result
      ]
    });
    expect(pythonTracePreview(result, detail)).toMatchObject({
      task: 'Check parser edge cases',
      scriptLines: ['print(0)', 'print(1)', 'print(2)', 'print(3)', 'print(4)'],
      scriptLineCount: 10,
      truncated: true,
      outputLines: ['ok', 'next'],
      outputLineCount: 2,
      outputTruncated: false,
      exitCode: '0'
    });

    expect(
      pythonTracePreview(
        traceEvent({
          id: 'trace_no_output',
          type: 'tool_result',
          summary: 'Host python operation finished with success.',
          toolCallId: 'tool_python',
          payload: { exitCode: 0 }
        }),
        detail
      )
    ).toMatchObject({
      outputLines: ['No output recorded.'],
      exitCode: '0'
    });
    expect(isProseTraceEvent(traceEvent({ source: 'model', type: 'model_message', payload: { text: 'Agent response', transcriptRole: 'assistant' } }), 'agent_output')).toBe(true);
    expect(lineRangePart({ lineStart: 12, lineEnd: 19 })).toBe('lines 12-19');
  });

  it('builds structured verifier and evidence previews without raw id-heavy detail text', () => {
    expect(
      verifierTracePreview(
        traceEvent({
          type: 'verifier_result',
          source: 'verifier',
          summary: 'Verifier contract executed on host with pass.',
          payload: {
            status: 'pass',
            realExecution: true,
            hostExecution: true,
            vmExecution: false,
            artifactId: 'artifact_test',
            verifierRunId: 'verifier_run_test',
            contractId: 'verifier_contract_test'
          }
        })
      )
    ).toEqual({
      title: 'PASS',
      description: 'Host verifier · real execution · output artifact recorded',
      facts: []
    });

    expect(
      evidenceTracePreview(
        traceEvent({
          type: 'artifact_created',
          source: 'tool',
          summary: 'Evidence recorded: Verifier confirmed the auth bypass.',
          payload: {
            evidenceId: 'evidence_test',
            kind: 'verifier',
            summary: 'Verifier confirmed the auth bypass.',
            verifierRunId: 'verifier_run_test',
            hypothesisId: 'hypothesis_test'
          }
        })
      )
    ).toEqual({
      title: 'Verifier evidence',
      description: 'Verifier confirmed the auth bypass.',
      facts: ['Verifier run referenced', 'Linked hypothesis']
    });
  });

  it('builds structured code browser previews from bounded excerpts', () => {
    expect(
      codeBrowserTracePreview(
        traceEvent({
          type: 'tool_result',
          source: 'tool',
          summary: 'Code browser returned 12 bounded lines.',
          payload: {
            sourcePath: '/repo/services/payments/src/main/java/com/example/security/Decoder.java',
            lineStart: 10,
            lineEnd: 21,
            symbol: 'decode',
            truncated: true,
            excerpt: ['10: public void decode() {', '11:   parse(input);', '12: }', '13:', '14: // extra', '15: audit();'].join('\n')
          }
        })
      )
    ).toEqual({
      title: '.../example/security/Decoder.java',
      description: '',
      facts: ['lines 10-21', '12 lines', 'symbol decode', 'truncated yes'],
      excerptLines: ['10: public void decode() {', '11:   parse(input);', '12: }', '13:', '14: // extra'],
      excerptLineCount: 12,
      excerptTruncated: true
    });
  });

  it('uses session records for hypothesis and finding trace details when available', () => {
    const detail = runDetail({
      hypotheses: [
        hypothesisRecord({
          id: 'hypothesis_one',
          createdTraceEventId: 'trace_hypothesis_created',
          title: 'Stored hypothesis title',
          descriptionMarkdown: 'Stored hypothesis description.'
        })
      ],
      findings: [
        findingRecord({
          id: 'finding_one',
          hypothesisId: 'hypothesis_one',
          title: 'Stored finding title',
          impactMarkdown: 'Stored finding impact.'
        })
      ]
    });

    const hypothesisEvent = traceEvent({ id: 'trace_hypothesis_created', type: 'hypothesis_event', payload: { title: 'Payload title' } });
    const findingEvent = traceEvent({ id: 'trace_finding', type: 'finding_event', payload: { findingId: 'finding_one', title: 'Payload finding' } });

    expect(hypothesisForTraceEvent(detail, hypothesisEvent)?.id).toBe('hypothesis_one');
    expect(findingForTraceEvent(detail, findingEvent)?.id).toBe('finding_one');
    expect(traceEventDetailText(hypothesisEvent, 'hypotheses', detail)).toBe('**Stored hypothesis title**\nStored hypothesis description.');
    expect(traceEventDetailText(findingEvent, 'evidence', detail)).toBe('**Stored finding title**\nStored finding impact.');
  });

  it('compacts long trace paths from the right-hand side', () => {
    expect(compactTracePath('/repo/services/payments/src/main/java/com/example/security/Decoder.java')).toBe('.../example/security/Decoder.java');
  });
});

function runDetail(input: { traceEvents?: TraceEventRecord[]; hypotheses?: HypothesisRecord[]; findings?: FindingRecord[] } = {}): RunDetail {
  return {
    run: {
      id: 'run_test',
      status: 'completed',
      createdAt: '2026-04-30T10:00:00.000Z',
      startedAt: '2026-04-30T10:00:00.000Z',
      endedAt: null,
      mode: 'dynamic',
      attemptStrategy: 'breadth_first',
      networkProfile: 'scoped',
      title: '',
      promptMarkdown: ''
    },
    attempts: [],
    traceEvents: input.traceEvents ?? [],
    transcriptMessages: [],
    hypotheses: input.hypotheses ?? [],
    artifacts: [],
    evidence: [],
    findings: input.findings ?? [],
    verifierContracts: [],
    verifierRuns: [],
    vmContexts: [],
    modelSessions: [],
    contextCompactions: [],
    policyEvents: [],
    exports: []
  } as unknown as RunDetail;
}

function hypothesisRecord(input: Partial<HypothesisRecord> = {}): HypothesisRecord {
  return {
    id: 'hypothesis_test',
    title: 'Hypothesis',
    state: 'needs_evidence',
    priorityScore: 10,
    descriptionMarkdown: '',
    createdTraceEventId: null,
    cweMappings: [],
    ...input
  } as unknown as HypothesisRecord;
}

function findingRecord(input: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'finding_test',
    hypothesisId: 'hypothesis_test',
    title: 'Finding',
    state: 'verified',
    priorityScore: 50,
    impactMarkdown: '',
    summaryMarkdown: '',
    cweMappings: [],
    ...input
  } as unknown as FindingRecord;
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
