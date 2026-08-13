import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunDetail } from '@shared/types';
import { BreakoutRoomView } from '../src/renderer/features/sessions/BreakoutRoomView';

describe('breakout room view', () => {
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
      onBack: () => undefined
    }));

    expect(html).toContain('breakout-room-member-provider-icon');
    expect(html).toContain('<span class="breakout-room-member-name">Parser Review</span><small>challenger</small>');
  });
});
