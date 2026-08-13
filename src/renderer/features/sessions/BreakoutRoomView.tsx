import { ArrowLeft, ChevronRight, MessagesSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { BreakoutRoomMemberRecord, BreakoutRoomMessageRecord, RunDetail } from '@shared/types';
import { ProviderIcon } from '../../app/ProviderIcon';
import { formatDurationHms } from '../../lib/formatting';
import { commentaryMessagesForSession } from '../../view-models/commentary';
import { subagentDisplayName, traceEventsForSubagent } from '../../view-models/subagents';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { CommentaryMessageRow, shouldAutoExpandToolMessage } from '../commentary/CommentaryView';
import { renderTraceProseText } from '../traces/traceMarkup';

export function BreakoutRoomView({
  detail,
  events = [],
  roomId,
  onBack
}: {
  detail: RunDetail | null;
  events?: TraceDisplayEvent[];
  roomId: string;
  onBack: () => void;
}): JSX.Element {
  const room = detail?.breakoutRooms?.find((candidate) => candidate.id === roomId) ?? null;
  const members = (detail?.breakoutRoomMembers ?? []).filter((member) => member.roomId === roomId);
  const messages = (detail?.breakoutRoomMessages ?? []).filter((message) => message.roomId === roomId);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const workingMembers = members.filter((member) => member.status === 'active');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (workingMembers.length === 0) return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [roomId, workingMembers.length]);

  const hasTranscriptContent = messages.length > 0 || Boolean(room?.outcomeMarkdown) || workingMembers.length > 0;

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
      {detail && room && !hasTranscriptContent ? <div className="main-trace-empty">This room has no recorded messages yet.</div> : null}
      {detail && room && hasTranscriptContent ? (
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
            {workingMembers.length > 0 ? (
              <section className="breakout-room-working-subagents" aria-label="Working subagents">
                {workingMembers.map((member) => {
                  const memberEvents = traceEventsForSubagent(events, member.agentPath);
                  return (
                    <WorkingSubagentDisclosure
                      detail={detail}
                      events={memberEvents}
                      member={member}
                      nowMs={nowMs}
                      key={member.id}
                    />
                  );
                })}
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WorkingSubagentDisclosure({
  detail,
  events,
  member,
  nowMs
}: {
  detail: RunDetail;
  events: TraceDisplayEvent[];
  member: BreakoutRoomMemberRecord;
  nowMs: number;
}): JSX.Element {
  const rawName = member.agentPath.split('/').filter(Boolean).at(-1) ?? member.agentPath;
  const name = subagentDisplayName(rawName);
  const durationLabel = breakoutRoomWorkingDurationLabel(member, events, nowMs);
  const messages = commentaryMessagesForSession(detail, events, { includeInitialPrompt: false });

  return (
    <details className="breakout-room-working-subagent">
      <summary aria-label={`${name} working for ${durationLabel}`}>
        <span className="breakout-room-working-title">
          <ChevronRight size={15} aria-hidden="true" />
          <strong>{name} Working</strong>
        </span>
        <span className="breakout-room-working-duration">{durationLabel}</span>
      </summary>
      <div className="breakout-room-working-history">
        {messages.length > 0 ? messages.map((message, index) => (
          <CommentaryMessageRow
            key={message.id}
            message={message}
            autoExpandToolKey={shouldAutoExpandToolMessage(messages, index)
              ? `${message.id}:${message.toolCalls?.length ?? 0}`
              : null}
            searchHighlightQuery=""
            selected={false}
          />
        )) : <p className="breakout-room-working-empty">No commentary recorded yet.</p>}
      </div>
    </details>
  );
}

export function breakoutRoomWorkingDurationLabel(
  member: Pick<BreakoutRoomMemberRecord, 'startedAt'>,
  events: readonly TraceDisplayEvent[],
  nowMs: number
): string {
  const memberStartMs = member.startedAt ? Date.parse(member.startedAt) : Number.NaN;
  const eventStartMs = events.reduce<number | null>((earliest, event) => {
    const timestamp = Date.parse(event.createdAt);
    if (!Number.isFinite(timestamp)) return earliest;
    return earliest === null ? timestamp : Math.min(earliest, timestamp);
  }, null);
  const startedAtMs = Number.isFinite(memberStartMs) ? memberStartMs : eventStartMs ?? nowMs;
  return formatDurationHms(Math.max(0, nowMs - startedAtMs));
}

function BreakoutMemberChip({ member }: { member: BreakoutRoomMemberRecord }): JSX.Element {
  const rawName = member.agentPath.split('/').filter(Boolean).at(-1) ?? member.agentPath;
  return (
    <span className={`breakout-room-member-chip state-${member.status}`} title={`${member.agentPath} — ${member.model}`}>
      <ProviderIcon className="breakout-room-member-provider-icon" provider={member.provider || member.model} size={12} aria-hidden="true" />
      <span className="breakout-room-member-name">{subagentDisplayName(rawName)}</span>
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
