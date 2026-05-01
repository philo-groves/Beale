import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '@shared/types';
import { traceCategoryForEvent, traceEventOutcome } from '../src/renderer/traceClassification';

describe('trace classification', () => {
  it('does not classify successful code browser excerpts as errors because source text contains error words', () => {
    const event = traceEvent({
      source: 'tool',
      type: 'tool_result',
      summary: 'Code browser returned 180 bounded lines.',
      payload: {
        observationBacked: true,
        simulated: false,
        sourcePath: '/scope/src/Parser.scala',
        excerpt: [
          '173: throw new IllegalStateException("stream with id has not been registered")',
          '174: val diagnosticMessage = parseDiagnosticMessage(parser)',
          '175: // timeout and failed appear here as source-code text, not tool status'
        ].join('\n')
      }
    });

    expect(traceEventOutcome(event)).toBe('success');
    expect(traceCategoryForEvent(event)).toBe('code_navigation');
  });

  it('classifies tool results with structured errors as failure recovery', () => {
    const event = traceEvent({
      source: 'tool',
      type: 'tool_result',
      summary: 'Code browser could not read the requested bounded text.',
      payload: {
        observationBacked: false,
        path: '/scope/missing.scala',
        error: 'unreadable_or_too_large'
      }
    });

    expect(traceEventOutcome(event)).toBe('failure');
    expect(traceCategoryForEvent(event)).toBe('failure_recovery');
  });

  it('keeps verifier contract fail results under verifier instead of operational error', () => {
    const event = traceEvent({
      source: 'verifier',
      type: 'verifier_result',
      summary: 'Verifier contract executed on host with fail.',
      payload: {
        status: 'fail',
        realExecution: true,
        hostExecution: true
      }
    });

    expect(traceEventOutcome(event)).toBeNull();
    expect(traceCategoryForEvent(event)).toBe('verifier');
  });

  it('hides verbose lifecycle tool rows as non-standard traces', () => {
    expect(
      traceCategoryForEvent(
        traceEvent({
          source: 'model',
          type: 'tool_call',
          summary: 'OpenAI completed function call arguments for verifier.',
          payload: { toolName: 'verifier' }
        })
      )
    ).toBe('non_standard');
    expect(
      traceCategoryForEvent(
        traceEvent({
          source: 'model',
          type: 'tool_call',
          summary: 'OpenAI requested Beale tool: evidence.',
          payload: { toolName: 'evidence' }
        })
      )
    ).toBe('non_standard');
    expect(
      traceCategoryForEvent(
        traceEvent({
          source: 'model',
          type: 'tool_call',
          summary: 'OpenAI completed function call arguments for code_browser.',
          payload: { toolName: 'code_browser' }
        })
      )
    ).toBe('non_standard');
    expect(
      traceCategoryForEvent(
        traceEvent({
          source: 'model',
          type: 'tool_call',
          summary: 'OpenAI completed function call arguments for resource_lookup.',
          payload: { toolName: 'resource_lookup' }
        })
      )
    ).toBe('non_standard');
    expect(
      traceCategoryForEvent(
        traceEvent({
          source: 'model',
          type: 'tool_call',
          summary: 'OpenAI requested Beale tool: code_browser.',
          payload: { toolName: 'code_browser' }
        })
      )
    ).toBe('non_standard');
    expect(
      traceCategoryForEvent(
        traceEvent({
          source: 'model',
          type: 'tool_call',
          summary: 'OpenAI requested Beale tool: search.',
          payload: { toolName: 'search' }
        })
      )
    ).toBe('non_standard');
    expect(
      traceCategoryForEvent(
        traceEvent({
          source: 'tool',
          type: 'tool_result',
          summary: 'Examined 6 files and returned 40 matches.',
          payload: { query: 'EvalSymlinks' }
        })
      )
    ).toBe('code_navigation');
    expect(
      traceCategoryForEvent(
        traceEvent({
          source: 'tool',
          type: 'tool_result',
          summary: 'Resource lookup returned 1 current-run match.',
          payload: { resourceId: 'verifier_run_test', kind: 'verifier_run' }
        })
      )
    ).toBe('code_navigation');
  });
});

function traceEvent(input: Pick<TraceEventRecord, 'source' | 'type' | 'summary' | 'payload'>): TraceEventRecord {
  return {
    id: 'trace_test',
    runId: 'run_test',
    attemptId: null,
    sequence: 1,
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-04-29T00:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}
