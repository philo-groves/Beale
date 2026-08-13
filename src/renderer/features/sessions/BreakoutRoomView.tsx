import { ArrowLeft, MessagesSquare } from 'lucide-react';
import type { JSX } from 'react';
import type { BreakoutRoomMemberRecord, BreakoutRoomMessageRecord, RunDetail } from '@shared/types';
import { renderTraceProseText } from '../traces/traceMarkup';

export function BreakoutRoomView({
  detail,
  roomId,
  onBack
}: {
  detail: RunDetail | null;
  roomId: string;
  onBack: () => void;
}): JSX.Element {
  const room = detail?.breakoutRooms?.find((candidate) => candidate.id === roomId) ?? null;
  const members = (detail?.breakoutRoomMembers ?? []).filter((member) => member.roomId === roomId);
  const messages = (detail?.breakoutRoomMessages ?? []).filter((message) => message.roomId === roomId);
  const memberById = new Map(members.map((member) => [member.id, member]));

  return (
    <section className="main-trace-view breakout-room-view" aria-label={room ? `Breakout room: ${room.title}` : 'Breakout room'}>
      <header className="breakout-room-header">
        <button type="button" className="back-to-main-button trace-back-to-main-button" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>Back to Session</span>
        </button>
        {room ? (
          <div className="breakout-room-heading">
            <div>
              <MessagesSquare size={16} />
              <h2>{room.title}</h2>
              <span className={`breakout-room-state state-${room.status}`}>{roomStatusLabel(room.status)}</span>
            </div>
            {room.purpose ? <p>{room.purpose}</p> : null}
            <div className="breakout-room-member-chips">
              {members.map((member) => <BreakoutMemberChip member={member} key={member.id} />)}
            </div>
          </div>
        ) : null}
      </header>
      {!detail || !room ? <div className="main-trace-empty">Loading breakout room.</div> : null}
      {room && messages.length === 0 ? <div className="main-trace-empty">This room has no recorded messages yet.</div> : null}
      {room && messages.length > 0 ? (
        <div className="main-commentary-scroll breakout-room-scroll">
          <div className="main-commentary-list breakout-room-transcript">
            {messages.map((message) => (
              <BreakoutMessage message={message} member={message.memberId ? memberById.get(message.memberId) : undefined} key={message.id} />
            ))}
            {room.outcomeMarkdown && !messages.some((message) => message.kind === 'outcome') ? (
              <article className="breakout-room-message kind-outcome">
                <div className="breakout-room-message-meta"><strong>Room outcome</strong></div>
                <div className="breakout-room-message-content">{renderTraceProseText(room.outcomeMarkdown, 'agent_output')}</div>
              </article>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BreakoutMemberChip({ member }: { member: BreakoutRoomMemberRecord }): JSX.Element {
  return (
    <span className={`breakout-room-member-chip state-${member.status}`} title={`${member.agentPath} — ${member.model}`}>
      <span>{providerLabel(member.provider)}</span>
      {member.role ? <small>{member.role}</small> : null}
    </span>
  );
}

function BreakoutMessage({
  message,
  member
}: {
  message: BreakoutRoomMessageRecord;
  member: BreakoutRoomMemberRecord | undefined;
}): JSX.Element {
  const sender = message.senderAgentPath === '/root'
    ? 'Lead agent'
    : member ? `${providerLabel(member.provider)} · ${member.role || 'researcher'}` : message.senderAgentPath;
  return (
    <article className={`breakout-room-message kind-${message.kind}`}>
      <div className="breakout-room-message-meta">
        <strong>{sender}</strong>
        <span>{messageKindLabel(message.kind)}</span>
        <time dateTime={message.createdAt}>{shortTime(message.createdAt)}</time>
      </div>
      <div className="breakout-room-message-content">{renderTraceProseText(message.contentMarkdown, 'agent_output')}</div>
      {message.evidenceRefs.length > 0 ? (
        <div className="breakout-room-evidence-refs">Evidence: {message.evidenceRefs.join(', ')}</div>
      ) : null}
    </article>
  );
}

function providerLabel(provider: string): string {
  if (provider === 'openai-codex') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'xai') return 'xAI';
  return provider;
}

function roomStatusLabel(status: string): string {
  if (status === 'active') return 'Active';
  if (status === 'completed') return 'Completed';
  if (status === 'interrupted') return 'Interrupted';
  return 'Error';
}

function messageKindLabel(kind: BreakoutRoomMessageRecord['kind']): string {
  return kind.split('_').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

function shortTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
