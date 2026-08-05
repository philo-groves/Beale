import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunDetail, TraceEventRecord } from '@shared/types';
import {
  COMMENTARY_RENDER_WINDOW_SIZE,
  CommentaryView,
  commentaryFollowLatestAfterScroll,
  commentaryMessageIcon,
  commentaryMessageLabel,
  commentaryScrollFadeClasses,
  commentaryToolValueText,
  commentaryWindowStartForIndex,
  shouldAutoExpandToolMessage
} from '../src/renderer/features/commentary/CommentaryView';
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

  it('uses distinct icons for reasoning and each tool family', () => {
    const progressIcon = commentaryMessageIcon('progress');
    expect(progressIcon).not.toBeNull();
    if (progressIcon) expect(renderToStaticMarkup(progressIcon)).toContain('lucide-brain');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'list_agents')!)).toContain('lucide-bot');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'wait_agent')!)).toContain('lucide-bot');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'runbook.get')!)).toContain('lucide-book-open');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'memory.search')!)).toContain('lucide-database');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'shell.run')!)).toContain('lucide-terminal');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'experiment.run')!)).toContain('lucide-terminal');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'file.read')!)).toContain('lucide-wrench');
    expect(commentaryMessageIcon('commentary')).toBeNull();
    expect(commentaryMessageIcon('final_answer')).toBeNull();
  });

  it('uses concise singular and plural copy for known and fallback tools', () => {
    expect(commentaryToolUsageText('list_agents', 1)).toBe('Checking Subagents');
    expect(commentaryToolUsageText('list_agents', 2)).toBe('Checking Subagents 2 Times');
    expect(commentaryToolUsageText('file.read', 1)).toBe('Reading a File');
    expect(commentaryToolUsageText('file.read', 3)).toBe('Reading 3 Files');
    expect(commentaryToolUsageText('shell.run', 1)).toBe('Running a Command');
    expect(commentaryToolUsageText('shell.run', 4)).toBe('Running 4 Commands');
    expect(commentaryToolUsageText('memory.request', 1)).toBe('Requesting a Memory');
    expect(commentaryToolUsageText('memory.request', 3)).toBe('Requesting 3 Memories');
    expect(commentaryToolUsageText('memory.curator', 1)).toBe('Curating Memory');
    expect(commentaryToolUsageText('mcp.browser.snapshot', 1)).toBe('Using Snapshot');
    expect(commentaryToolUsageText('custom.scan', 2)).toBe('Using Custom Scan 2 Times');
  });

  it('shows one activity row per tool call, coalesces repeats, and suppresses paired results', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      toolEvent('agents-request', 'tool.requested', 'list_agents', 'agents', {}),
      toolEvent('agents-result', 'tool.observed', 'list_agents', 'agents', {}, { agents: [{ path: '/root/parser' }] }),
      toolEvent('read-one-request', 'tool.requested', 'file.read', 'read-one', { path: 'src/parser.ts' }),
      toolEvent('read-one-result', 'tool.observed', 'file.read', 'read-one', { path: 'src/parser.ts' }, { text: 'first file' }),
      toolEvent('read-two-request', 'tool.requested', 'file.read', 'read-two', { path: 'src/token.ts' }),
      toolEvent('read-two-result', 'tool.observed', 'file.read', 'read-two', { path: 'src/token.ts' }, { text: 'second file' }),
      toolEvent('shell-request', 'tool.requested', 'shell.run', 'shell', { utility: 'npm', args: ['test'] }),
      toolEvent('repository-result', 'tool.observed', 'repository.search', 'repository-only', { query: 'decodeToken' }, { matches: 2 }),
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
      ['tool', 'list_agents', 1, 'Checking Subagents'],
      ['tool', 'file.read', 2, 'Reading 2 Files'],
      ['tool', 'shell.run', 1, 'Running a Command'],
      ['tool', 'repository.search', 1, 'Searching the Repository'],
      ['task', undefined, undefined, 'Inspect the parser boundary.']
    ]);

    expect(messages.find((message) => message.toolName === 'file.read')?.toolCalls).toEqual([
      {
        id: 'read-one-request',
        traceEventId: 'read-one-result',
        label: 'src/parser.ts',
        input: { path: 'src/parser.ts' },
        output: { text: 'first file' }
      },
      {
        id: 'read-two-request',
        traceEventId: 'read-two-result',
        label: 'src/token.ts',
        input: { path: 'src/token.ts' },
        output: { text: 'second file' }
      }
    ]);
    expect(messages.find((message) => message.toolName === 'shell.run')?.toolCalls).toEqual([
      {
        id: 'shell-request',
        traceEventId: 'shell-request',
        label: 'npm test',
        input: { utility: 'npm', args: ['test'] },
        output: 'Waiting for output.'
      }
    ]);
    expect(messages.find((message) => message.toolName === 'repository.search')?.toolCalls).toEqual([
      {
        id: 'repository-result',
        traceEventId: 'repository-result',
        label: 'Repository Search',
        input: { query: 'decodeToken' },
        output: { matches: 2 }
      }
    ]);
  });

  it('renders memory requests but hides background curator activity', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      toolEvent(
        'memory-request',
        'tool.requested',
        'memory.request',
        'memory-request',
        {
          intent: 'create',
          reason: 'The primitive is missing.',
          candidate: { type: 'primitive', title: 'Unchecked parser length', claim: 'The length is unchecked.' }
        }
      ),
      toolEvent(
        'memory-curator-request',
        'tool.requested',
        'memory.curator',
        'memory-curator',
        { kind: 'turn', agentPath: '/root', turn: 3 }
      ),
      toolEvent(
        'memory-curator-result',
        'tool.observed',
        'memory.curator',
        'memory-curator',
        { kind: 'turn', agentPath: '/root', turn: 3 },
        { changes: [] }
      )
    ]);
    const request = messages.find((message) => message.toolName === 'memory.request');

    expect(request).toMatchObject({
      kind: 'tool',
      contentMarkdown: 'Requesting a Memory',
      toolCount: 1
    });
    expect(request?.toolCalls?.[0]).toMatchObject({
      label: 'Unchecked parser length',
      input: {
        intent: 'create',
        reason: 'The primitive is missing.',
        candidate: { type: 'primitive', title: 'Unchecked parser length', claim: 'The length is unchecked.' }
      },
      output: 'Waiting for output.'
    });
    expect(messages.some((message) => message.toolName === 'memory.curator')).toBe(false);
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'memory.request')!)).toContain('lucide-database');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'memory.curator')!)).toContain('lucide-database');
  });

  it('formats tool input and output values for expanded details', () => {
    expect(commentaryToolValueText({ path: 'src/parser.ts', lines: [1, 2] })).toBe(
      '{\n  "path": "src/parser.ts",\n  "lines": [\n    1,\n    2\n  ]\n}'
    );
    expect(commentaryToolValueText('Waiting for output.')).toBe('Waiting for output.');
    expect(commentaryToolValueText(null)).toBe('null');
  });

  it('auto-expands a tool summary only while it is the latest chat item', () => {
    const trailingToolMessages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      toolEvent('read-request', 'tool.requested', 'file.read', 'read', { path: 'src/parser.ts' })
    ]);
    expect(shouldAutoExpandToolMessage(trailingToolMessages, 0)).toBe(false);
    expect(shouldAutoExpandToolMessage(trailingToolMessages, 1)).toBe(true);

    const followedToolMessages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      toolEvent('read-request', 'tool.requested', 'file.read', 'read', { path: 'src/parser.ts' }),
      displayEvent('commentary-after-tool', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'The parser is ready for the next check.'
      })
    ]);
    expect(shouldAutoExpandToolMessage(followedToolMessages, 1)).toBe(false);
    expect(shouldAutoExpandToolMessage(followedToolMessages, 2)).toBe(false);
  });

  it('shows chat scroll fades only where more content remains', () => {
    expect(commentaryScrollFadeClasses({ scrollHeight: 100, clientHeight: 100, scrollTop: 0 })).toEqual({
      'has-top-fade': false,
      'has-bottom-fade': false
    });
    expect(commentaryScrollFadeClasses({ scrollHeight: 300, clientHeight: 100, scrollTop: 0 })).toEqual({
      'has-top-fade': false,
      'has-bottom-fade': true
    });
    expect(commentaryScrollFadeClasses({ scrollHeight: 300, clientHeight: 100, scrollTop: 100 })).toEqual({
      'has-top-fade': true,
      'has-bottom-fade': true
    });
    expect(commentaryScrollFadeClasses({ scrollHeight: 300, clientHeight: 100, scrollTop: 200 })).toEqual({
      'has-top-fade': true,
      'has-bottom-fade': false
    });
  });

  it('preserves bottom stickiness across layout-driven tool expansion and collapse', () => {
    expect(commentaryFollowLatestAfterScroll({
      wasFollowingLatest: true,
      distanceFromBottom: 180,
      userInitiated: false
    })).toBe(true);
    expect(commentaryFollowLatestAfterScroll({
      wasFollowingLatest: true,
      distanceFromBottom: 180,
      userInitiated: true
    })).toBe(false);
    expect(commentaryFollowLatestAfterScroll({
      wasFollowingLatest: false,
      distanceFromBottom: 180,
      userInitiated: false
    })).toBe(false);
    expect(commentaryFollowLatestAfterScroll({
      wasFollowingLatest: false,
      distanceFromBottom: 12,
      userInitiated: false
    })).toBe(true);
  });

  it('centers selected history within a bounded commentary render window', () => {
    expect(commentaryWindowStartForIndex(140, 0)).toBe(0);
    expect(commentaryWindowStartForIndex(140, 70)).toBe(50);
    expect(commentaryWindowStartForIndex(140, 139)).toBe(80);
  });

  it('renders only the latest bounded window for long commentary histories', () => {
    const detail = runDetail('Review the target.');
    const events = Array.from({ length: 100 }, (_, index) => displayEvent(`commentary-${index}`, {
      agentPath: '/root',
      transcriptRole: 'assistant',
      transcriptSource: 'honeycrisp_commentary',
      messagePhase: 'commentary',
      text: `Commentary message ${index}`
    }, { sequence: index }));

    const html = renderToStaticMarkup(
      createElement(CommentaryView, {
        busy: false,
        detail,
        events,
        providerModelCatalog: [],
        selectedRunId: detail.run.id,
        showBackToMain: true,
        selectedTraceEventId: null,
        searchHighlightQuery: '',
        onBackToMain: () => undefined,
        onSessionAction: () => undefined,
        onSteerInstruction: () => undefined
      })
    );

    expect(html.match(/data-commentary-event-id=/g)).toHaveLength(COMMENTARY_RENDER_WINDOW_SIZE);
    expect(html).toContain('Commentary message 99');
    expect(html).not.toContain('Commentary message 0<');
    expect(html).toContain('main-commentary-spacer');
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

  it('preserves each coalesced reasoning trace as its own commentary line', () => {
    const messages = commentaryMessagesForSession(runDetail('Review the parser.'), [
      displayEvent('reasoning-group', {
        agentPath: '/root',
        responseId: 'response_group',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        text: '**Inspecting the parser**\n\n**Checking bounds**',
        reasoningSummaryTexts: ['**Inspecting the parser**', '**Checking bounds**']
      })
    ]);

    expect(messages.find((message) => message.kind === 'progress')?.reasoningTraceLines).toEqual([
      '**Inspecting the parser**',
      '**Checking bounds**'
    ]);
  });

  it('renders a brain icon for every plain-text fixture reasoning line', () => {
    const fixtureReasoning = displayEvent('fixture-reasoning', {
      fixtureOnly: true,
      text: 'Planning synthetic fixture mode\nDesigning password input via stdin'
    });
    const detail = runDetail('Exercise the fixture.');
    const messages = commentaryMessagesForSession(detail, [fixtureReasoning]);

    expect(messages.find((message) => message.kind === 'progress')?.reasoningTraceLines).toEqual([
      'Planning synthetic fixture mode',
      'Designing password input via stdin'
    ]);

    const html = renderToStaticMarkup(
      createElement(CommentaryView, {
        busy: false,
        detail,
        events: [fixtureReasoning],
        providerModelCatalog: [],
        selectedRunId: detail.run.id,
        showBackToMain: true,
        selectedTraceEventId: null,
        searchHighlightQuery: '',
        onBackToMain: () => undefined,
        onSessionAction: () => undefined,
        onSteerInstruction: () => undefined
      })
    );

    expect(html.match(/lucide-brain/g)).toHaveLength(2);
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
  toolActionId: string,
  normalizedInputs: Record<string, unknown> = {},
  result?: unknown
): TraceDisplayEvent {
  return displayEvent(id, {
    honeycrispKind: kind,
    agentPath: '/root',
    toolName,
    payload: {
      toolName,
      toolActionId,
      normalizedInputs,
      ...(kind === 'tool.observed' ? { status: 'complete' } : {}),
      ...(result !== undefined ? { result } : {})
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
