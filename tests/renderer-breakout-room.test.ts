import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BreakoutRoomMemberRecord, BreakoutRoomMessageRecord, RunDetail } from '@shared/types';
import {
  BreakoutRoomView,
  breakoutRoomTranscriptUpdateKey,
  breakoutRoomWorkingDurationLabel
} from '../src/renderer/features/sessions/BreakoutRoomView';
import type { TraceDisplayEvent } from '../src/renderer/view-models/traceDisplay';

describe('breakout room view', () => {
  it('aligns room header content to the commentary width', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const headingStyles = styles.match(/\.breakout-room-heading\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(headingStyles).toContain('width: 100%');
    expect(headingStyles).toContain('max-width: var(--trace-content-max-width)');
    expect(headingStyles).toContain('margin-inline: auto');
  });

  it('shows the provider mark, formatted subagent name, and role in member pills', () => {
    const detail = {
      breakoutRooms: [{
        id: 'room_review',
        title: 'Parser review',
        purpose: '',
        status: 'active'
      }],
      breakoutRoomMembers: [{
        id: 'member_review',
        roomId: 'room_review',
        agentPath: '/root/parser_review',
        provider: 'anthropic',
        model: 'claude-opus-5',
        role: 'challenger',
        status: 'active'
      }],
      breakoutRoomMessages: []
    } as unknown as RunDetail;

    const html = renderToStaticMarkup(createElement(BreakoutRoomView, {
      detail,
      roomId: 'room_review',
      onBack: () => undefined,
      onSelectSubagent: () => undefined
    }));

    expect(html).toContain('breakout-room-member-provider-icon');
    expect(html).toContain('<span class="breakout-room-member-name">Parser Review</span><small>challenger</small>');
    expect(html).toContain('<details class="breakout-room-working-subagent">');
    expect(html).toContain('class="lucide lucide-chevron-right"');
    expect(html).toContain('<strong>Parser Review Working</strong>');
    expect(html).not.toContain('<details class="breakout-room-working-subagent" open="">');
  });

  it('projects live subagent commentary inside the collapsed working disclosure', () => {
    const detail = {
      breakoutRooms: [{
        id: 'room_live',
        title: 'Live review',
        purpose: '',
        status: 'active'
      }],
      breakoutRoomMembers: [{
        id: 'member_live',
        roomId: 'room_live',
        agentPath: '/root/live_parser',
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        role: 'reviewer',
        status: 'active',
        startedAt: '2026-08-12T12:00:00.000Z'
      }, {
        id: 'member_finished',
        roomId: 'room_live',
        agentPath: '/root/finished_worker',
        provider: 'anthropic',
        model: 'claude-opus-5',
        role: 'challenger',
        status: 'completed',
        startedAt: '2026-08-12T11:55:00.000Z'
      }],
      breakoutRoomMessages: []
    } as unknown as RunDetail;
    const events: TraceDisplayEvent[] = [traceEvent({
      id: 'live-commentary',
      payload: {
        agentPath: '/root/live_parser',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        text: 'Inspecting live parser state.'
      }
    }), traceEvent({
      id: 'finished-commentary',
      payload: {
        agentPath: '/root/finished_worker',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        text: 'Finished review history.'
      }
    })];

    const html = renderToStaticMarkup(createElement(BreakoutRoomView, {
      detail,
      events,
      roomId: 'room_live',
      onBack: () => undefined,
      onSelectSubagent: () => undefined
    }));

    expect(html).toContain('<strong>Live Parser Working</strong>');
    expect(html).toContain('Inspecting live parser state.');
    expect(html).not.toContain('<strong>Finished Worker Working</strong>');
    expect(html).not.toContain('Finished review history.');
  });

  it('renders persisted agent messages with provider-attributed subagent navigation', () => {
    const detail = {
      breakoutRooms: [{
        id: 'room_messages',
        title: 'Message review',
        purpose: '',
        status: 'completed',
        phase: 'completed',
        challengeRound: 1
      }],
      breakoutRoomMembers: [{
        id: 'member_parser',
        roomId: 'room_messages',
        agentPath: '/root/parser_reviewer',
        provider: 'xai',
        model: 'grok-4.6',
        role: 'reviewer',
        status: 'completed'
      }],
      breakoutRoomMessages: [{
        id: 'message_commentary',
        roomId: 'room_messages',
        memberId: 'member_parser',
        senderAgentPath: '/root/parser_reviewer',
        kind: 'commentary',
        contentMarkdown: 'Inspecting the parser boundary.',
        evidenceRefs: [],
        metadata: { provider: 'xai', model: 'grok-4.6' },
        createdAt: '2026-08-12T12:00:01.000Z'
      }]
    } as unknown as RunDetail;

    const html = renderToStaticMarkup(createElement(BreakoutRoomView, {
      detail,
      roomId: 'room_messages',
      onBack: () => undefined,
      onSelectSubagent: () => undefined
    }));

    expect(html).toContain('<article class="breakout-room-message kind-commentary">');
    expect(html).not.toContain('<details class="breakout-room-message kind-commentary"');
    expect(html).toContain('class="run-work-header breakout-room-message-header"');
    expect(html).toContain('class="breakout-room-message-provider" title="grok-4.6"');
    expect(html).toContain('breakout-room-message-provider-icon');
    expect(html).toContain('class="breakout-room-message-subagent" title="View Parser Reviewer commentary"');
    expect(html).toContain('Parser Reviewer</button>');
    expect(html).toContain('<span class="breakout-room-message-kind">Commentary</span>');
    expect(html).toContain('Inspecting the parser boundary.');
    expect(html).toContain('class="breakout-room-message-clip"');
    expect(html).not.toContain('class="breakout-room-message-more"');
  });

  it('formats working duration from the member start time', () => {
    expect(breakoutRoomWorkingDurationLabel(
      { startedAt: '2026-08-12T12:00:00.000Z' },
      [],
      Date.parse('2026-08-12T12:02:03.000Z')
    )).toBe('00:02:03');
  });

  it('changes the transcript follow key when room content arrives', () => {
    const firstMessage: BreakoutRoomMessageRecord = {
      id: 'message_one',
      roomId: 'room_live',
      runId: 'run_live',
      attemptId: null,
      memberId: 'member_live',
      senderAgentPath: '/root/live_parser',
      recipientAgentPath: null,
      kind: 'commentary',
      contentMarkdown: 'First update.',
      evidenceRefs: [],
      metadata: {},
      createdAt: '2026-08-12T12:00:01.000Z'
    };
    const member: BreakoutRoomMemberRecord = {
      id: 'member_live',
      roomId: 'room_live',
      runId: 'run_live',
      attemptId: null,
      agentId: 'agent_live',
      agentPath: '/root/live_parser',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      role: 'reviewer',
      status: 'active',
      startedAt: '2026-08-12T12:00:00.000Z',
      endedAt: null,
      error: null
    };

    const initialKey = breakoutRoomTranscriptUpdateKey([firstMessage], null, [member], []);
    const messageKey = breakoutRoomTranscriptUpdateKey([
      firstMessage,
      { ...firstMessage, id: 'message_two', contentMarkdown: 'Second update.' }
    ], null, [member], []);
    const eventKey = breakoutRoomTranscriptUpdateKey([firstMessage], null, [member], [traceEvent({
      id: 'live-update',
      payload: { agentPath: '/root/live_parser' }
    })]);

    expect(messageKey).not.toBe(initialKey);
    expect(eventKey).not.toBe(initialKey);
  });
});

function traceEvent(input: Partial<TraceDisplayEvent>): TraceDisplayEvent {
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
    createdAt: '2026-08-12T12:00:01.000Z',
    vmContextId: null,
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...input
  };
}
