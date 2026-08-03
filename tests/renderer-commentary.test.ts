import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import { commentaryMessageIcon, commentaryMessageLabel } from '../src/renderer/features/commentary/CommentaryView';
import { commentaryMessagesForSession, commentaryToolUsageText } from '../src/renderer/view-models/commentary';
import type { TraceDisplayEvent } from '../src/renderer/view-models/traceDisplay';

describe('renderer commentary projection', () => {
  it('labels subagent assignments by lifecycle action', () => {
    expect(commentaryMessageLabel('user')).toBeNull();
    expect(commentaryMessageLabel('commentary')).toBeNull();
    expect(commentaryMessageLabel('progress')).toBeNull();
    expect(commentaryMessageLabel('tool')).toBeNull();
    expect(commentaryMessageLabel('task', 'spawn')).toBe('Subagent Spawn');
    expect(commentaryMessageLabel('task', 'followup')).toBe('Subagent Follow-up');
    expect(commentaryMessageLabel('final_answer')).toBe('Agent');
    expect(commentaryMessageLabel('error')).toBe('Error');
  });

  it('uses distinct icons for reasoning progress and tool usage messages', () => {
    const progressIcon = commentaryMessageIcon('progress');
    expect(progressIcon).not.toBeNull();
    if (progressIcon) expect(renderToStaticMarkup(progressIcon)).toContain('lucide-brain');
    const toolIcon = commentaryMessageIcon('tool');
    expect(toolIcon).not.toBeNull();
    if (toolIcon) expect(renderToStaticMarkup(toolIcon)).toContain('lucide-wrench');
    expect(commentaryMessageIcon('commentary')).toBeNull();
    expect(commentaryMessageIcon('final_answer')).toBeNull();
  });

  it('uses concise singular and plural copy for known and fallback tools', () => {
    expect(commentaryToolUsageText('list_agents', 1)).toBe('Check Subagents');
    expect(commentaryToolUsageText('list_agents', 2)).toBe('Checked Subagents 2 Times');
    expect(commentaryToolUsageText('file.read', 1)).toBe('Read a File');
    expect(commentaryToolUsageText('file.read', 3)).toBe('Read 3 Files');
    expect(commentaryToolUsageText('shell.run', 1)).toBe('Ran a Command');
    expect(commentaryToolUsageText('shell.run', 4)).toBe('Ran 4 Commands');
    expect(commentaryToolUsageText('mcp.browser.snapshot', 1)).toBe('Used Snapshot');
    expect(commentaryToolUsageText('custom.scan', 2)).toBe('Used Custom Scan 2 Times');
  });

  it('shows one activity row per tool call, coalesces repeats, and suppresses paired results', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      toolEvent('agents-request', 'tool.requested', 'list_agents', 'agents'),
      toolEvent('agents-result', 'tool.observed', 'list_agents', 'agents'),
      toolEvent('read-one-request', 'tool.requested', 'file.read', 'read-one'),
      toolEvent('read-one-result', 'tool.observed', 'file.read', 'read-one'),
      toolEvent('read-two-request', 'tool.requested', 'file.read', 'read-two'),
      toolEvent('read-two-result', 'tool.observed', 'file.read', 'read-two'),
      toolEvent('shell-request', 'tool.requested', 'shell.run', 'shell'),
      toolEvent('repository-result', 'tool.observed', 'repository.search', 'repository-only'),
      toolEvent('spawn-request', 'tool.requested', 'spawn_agent', 'spawn'),
      displayEvent('spawn', {
        type: 'subagent.activity',
        action: 'spawned',
        agentPath: '/root/parser_review',
        message: 'Inspect the parser boundary.'
      }, { source: 'system' })
    ]);

    expect(messages.map(({ kind, toolName, toolCount, contentMarkdown }) => [
      kind,
      toolName,
      toolCount,
      contentMarkdown
    ])).toEqual([
      ['user', undefined, undefined, 'Inspect the parser.'],
      ['tool', 'list_agents', 1, 'Check Subagents'],
      ['tool', 'file.read', 2, 'Read 2 Files'],
      ['tool', 'shell.run', 1, 'Ran a Command'],
      ['tool', 'repository.search', 1, 'Searched the Repository'],
      ['task', undefined, undefined, 'Inspect the parser boundary.']
    ]);
  });

  it('shows user, native commentary, and final messages while suppressing paired reasoning fallback', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      displayEvent('prompt', {
        transcriptRole: 'user',
        transcriptSource: 'run_prompt',
        text: 'Inspect the parser.'
      }),
      displayEvent('reasoning', {
        agentPath: '/root',
        responseId: 'response_one',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        text: 'Checking parser entrypoints.'
      }),
      displayEvent('commentary', {
        agentPath: '/root',
        responseId: 'response_one',
        messagePhase: 'commentary',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        text: 'I found two parser entrypoints and am checking their shared guard.'
      }),
      displayEvent('tool', { agentPath: '/root', text: 'Raw shell output.' }, { source: 'tool', type: 'tool_result' }),
      displayEvent('final', {
        agentPath: '/root',
        responseId: 'response_two',
        messagePhase: 'final_answer',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp',
        text: 'The shared guard rejects the boundary safely.'
      })
    ]);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Inspect the parser.'],
      ['commentary', 'I found two parser entrypoints and am checking their shared guard.'],
      ['final_answer', 'The shared guard rejects the boundary safely.']
    ]);
  });

  it('retains newer fallback progress after native commentary and coalesces its snapshots', () => {
    const messages = commentaryMessagesForSession(runDetail('Continue the review.'), [
      displayEvent('paired-reasoning', {
        agentPath: '/root',
        responseId: 'response_native',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_native',
        text: 'Paired provider reasoning.'
      }),
      displayEvent('native', {
        agentPath: '/root',
        responseId: 'response_native',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'Native commentary for the first response.'
      }),
      displayEvent('progress-first', {
        agentPath: '/root',
        responseId: 'response_fallback',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_fallback',
        text: 'Initial fallback snapshot.'
      }),
      displayEvent('progress-completed', {
        agentPath: '/root',
        responseId: 'response_fallback',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_fallback',
        text: 'Completed fallback snapshot.'
      })
    ]);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Continue the review.'],
      ['commentary', 'Native commentary for the first response.'],
      ['progress', 'Completed fallback snapshot.']
    ]);
  });

  it('pairs native commentary with reasoning by turn when a provider omits the response ID', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      displayEvent('reasoning', {
        agentPath: '/root',
        turn: 3,
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        text: 'Private provider summary.'
      }),
      displayEvent('commentary', {
        agentPath: '/root',
        turn: 3,
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        messagePhase: 'commentary',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        text: 'I found the parser boundary and am testing its guard.'
      })
    ]);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Inspect the parser.'],
      ['commentary', 'I found the parser boundary and am testing its guard.']
    ]);
  });

  it('keeps only the latest message in a consecutive legacy progress burst', () => {
    const messages = commentaryMessagesForSession(runDetail('Review the target.'), [
      displayEvent('progress-one', {
        agentPath: '/root',
        responseId: 'response_one',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_one',
        text: 'Reading the entrypoint.'
      }),
      displayEvent('tool', { agentPath: '/root', text: 'Raw shell output.' }, { source: 'tool', type: 'tool_result' }),
      displayEvent('progress-two', {
        agentPath: '/root',
        responseId: 'response_two',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_two',
        text: 'Confirmed the input reaches the parser.'
      })
    ]);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Review the target.'],
      ['progress', 'Confirmed the input reaches the parser.']
    ]);
  });

  it('shows spawned and follow-up tasks in a selected subagent feed', () => {
    const messages = commentaryMessagesForSession(runDetail('Root prompt.'), [
      displayEvent('spawn', {
        type: 'subagent.activity',
        action: 'spawned',
        agentPath: '/root/parser_review',
        message: 'Inspect the parser boundary.'
      }, { source: 'system' }),
      displayEvent('followup', {
        type: 'subagent.activity',
        action: 'followup',
        agentPath: '/root/parser_review',
        message: 'Also check the length conversion.'
      }, { source: 'system' }),
      displayEvent('message', {
        type: 'subagent.activity',
        action: 'message',
        agentPath: '/root/parser_review',
        message: 'Compare the result with the caller contract.'
      }, { source: 'system' })
    ], { includeInitialPrompt: false });

    expect(messages.map(({ kind, taskAction, contentMarkdown }) => [kind, taskAction, contentMarkdown])).toEqual([
      ['task', 'spawn', 'Inspect the parser boundary.'],
      ['task', 'followup', 'Also check the length conversion.'],
      ['task', 'followup', 'Compare the result with the caller contract.']
    ]);
  });

  it('shows subagent failures as terminal Commentary messages', () => {
    const messages = commentaryMessagesForSession(runDetail('Root prompt.'), [
      displayEvent('commentary', {
        agentPath: '/root/parser_review',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'I am checking the parser boundary.'
      }),
      displayEvent('error', {
        type: 'subagent.activity',
        action: 'errored',
        agentPath: '/root/parser_review',
        message: 'Provider request failed.'
      }, { source: 'system' })
    ], { includeInitialPrompt: false });

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['commentary', 'I am checking the parser boundary.'],
      ['error', 'Provider request failed.']
    ]);
  });
});

function displayEvent(
  id: string,
  payload: Record<string, unknown>,
  overrides: Partial<TraceEventRecord> = {}
): TraceDisplayEvent {
  return {
    id,
    runId: 'run_commentary',
    attemptId: 'attempt_one',
    sequence: 1,
    source: 'model',
    type: 'model_message',
    summary: 'Event.',
    payload,
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-08-03T10:00:00.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...overrides
  };
}

function toolEvent(
  id: string,
  kind: 'tool.requested' | 'tool.observed',
  toolName: string,
  toolActionId: string
): TraceDisplayEvent {
  return displayEvent(id, {
    honeycrispKind: kind,
    agentPath: '/root',
    toolName,
    payload: {
      toolName,
      toolActionId
    }
  }, {
    source: 'system',
    type: 'research_event',
    summary: `Honeycrisp ${kind}: ${toolName}.`
  });
}

function runDetail(promptMarkdown: string): RunDetail {
  return {
    run: {
      id: 'run_commentary',
      promptMarkdown,
      createdAt: '2026-08-03T09:59:00.000Z'
    },
    traceEvents: [],
    transcriptMessages: []
  } as unknown as RunDetail;
}
