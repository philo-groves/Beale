import { ArrowLeft, ChevronRight, MessagesSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
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
  onBack,
  onSelectSubagent
}: {
  detail: RunDetail | null;
  events?: TraceDisplayEvent[];
  roomId: string;
  onBack: () => void;
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  const room = detail?.breakoutRooms?.find((candidate) => candidate.id === roomId) ?? null;
  const members = (detail?.breakoutRoomMembers ?? []).filter((member) => member.roomId === roomId);
  const messages = (detail?.breakoutRoomMessages ?? []).filter((message) => message.roomId === roomId);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const memberByAgentPath = new Map(members.map((member) => [member.agentPath, member]));
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
              <span className={`breakout-room-phase phase-${room.phase}`}>{roomPhaseLabel(room.phase, room.challengeRound)}</span>
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
              <BreakoutMessage
                message={message}
                member={(message.memberId ? memberById.get(message.memberId) : undefined) ?? memberByAgentPath.get(message.senderAgentPath)}
                onSelectSubagent={onSelectSubagent}
                key={message.id}
              />
            ))}
            {room.outcomeMarkdown && !messages.some((message) => message.kind === 'outcome') ? (
              <BreakoutOutcome
                contentMarkdown={room.outcomeMarkdown}
                model={detail.run.model}
                provider={metadataText(detail.run.budget, 'modelProvider') ?? detail.run.model}
              />
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
  member,
  onSelectSubagent
}: {
  message: BreakoutRoomMessageRecord;
  member: BreakoutRoomMemberRecord | undefined;
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  const sender = breakoutMessageSenderName(message, member);
  const provider = member?.provider || metadataText(message.metadata, 'provider') || member?.model || metadataText(message.metadata, 'model') || '';
  const model = member?.model || metadataText(message.metadata, 'model') || provider;
  const subagentPath = message.senderAgentPath === '/root'
    ? null
    : member?.agentPath || message.senderAgentPath;
  return (
    <article className={`breakout-room-message kind-${message.kind}`}>
      <BreakoutMessageHeader
        kindLabel={messageKindLabel(message)}
        model={model}
        provider={provider}
        sender={sender}
        subagentPath={subagentPath}
        onSelectSubagent={onSelectSubagent}
      />
      <BreakoutMessageBody>
        <div className="breakout-room-message-content">{renderTraceProseText(message.contentMarkdown, 'agent_output')}</div>
        {message.evidenceRefs.length > 0 ? (
          <div className="breakout-room-evidence-refs">Evidence: {message.evidenceRefs.join(', ')}</div>
        ) : null}
        {roomPacketDetails(message).length > 0 ? (
          <dl className="breakout-room-packet-details">
            {roomPacketDetails(message).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        ) : null}
      </BreakoutMessageBody>
    </article>
  );
}

function BreakoutOutcome({
  contentMarkdown,
  model,
  provider
}: {
  contentMarkdown: string;
  model: string;
  provider: string;
}): JSX.Element {
  return (
    <article className="breakout-room-message kind-outcome">
      <BreakoutMessageHeader
        kindLabel="Outcome"
        model={model}
        provider={provider}
        sender="Lead Agent"
        subagentPath={null}
        onSelectSubagent={() => undefined}
      />
      <BreakoutMessageBody>
        <div className="breakout-room-message-content">{renderTraceProseText(contentMarkdown, 'agent_output')}</div>
      </BreakoutMessageBody>
    </article>
  );
}

function BreakoutMessageHeader({
  kindLabel,
  model,
  provider,
  sender,
  subagentPath,
  onSelectSubagent
}: {
  kindLabel: string;
  model: string;
  provider: string;
  sender: string;
  subagentPath: string | null;
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  return (
    <div className="run-work-header breakout-room-message-header">
      <span className="breakout-room-message-sender">
        <span className="breakout-room-message-provider" title={model}>
          <ProviderIcon className="breakout-room-message-provider-icon" provider={provider || model} size={14} aria-hidden="true" />
        </span>
        {subagentPath ? (
          <button
            type="button"
            className="breakout-room-message-subagent"
            title={`View ${sender} commentary`}
            onClick={() => onSelectSubagent(subagentPath)}
          >
            {sender}
          </button>
        ) : <span>{sender}</span>}
      </span>
      <span className="breakout-room-message-kind">{kindLabel}</span>
    </div>
  );
}

function BreakoutMessageBody({ children }: { children: ReactNode }): JSX.Element {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const updateOverflow = (): void => setOverflowing(content.scrollHeight > 400);
    updateOverflow();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateOverflow);
      return () => window.removeEventListener('resize', updateOverflow);
    }
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`breakout-room-message-body${overflowing ? ' is-overflowing' : ''}${expanded ? ' is-expanded' : ''}`}>
      <div className="breakout-room-message-clip">
        <div className="breakout-room-message-measure" ref={contentRef}>{children}</div>
      </div>
      {overflowing ? (
        <button
          type="button"
          className="breakout-room-message-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

function breakoutMessageSenderName(
  message: Pick<BreakoutRoomMessageRecord, 'senderAgentPath'>,
  member: BreakoutRoomMemberRecord | undefined
): string {
  if (message.senderAgentPath === '/root') return 'Lead Agent';
  const agentPath = member?.agentPath || message.senderAgentPath;
  const rawName = agentPath.split('/').filter(Boolean).at(-1) ?? agentPath;
  return subagentDisplayName(rawName);
}

function roomStatusLabel(status: string): string {
  if (status === 'active') return 'Active';
  if (status === 'completed') return 'Completed';
  if (status === 'interrupted') return 'Interrupted';
  return 'Error';
}

function messageKindLabel(message: BreakoutRoomMessageRecord): string {
  const packetKind = typeof message.metadata.packetKind === 'string' ? message.metadata.packetKind : message.kind;
  return packetKind.split('_').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

function roomPhaseLabel(phase: string, challengeRound: number): string {
  if (phase === 'independent') return 'Independent memos';
  if (phase === 'challenge') return `Challenge ${challengeRound}`;
  if (phase === 'response') return `Responses ${challengeRound}`;
  if (phase === 'synthesis') return 'Awaiting synthesis';
  return 'Synthesized';
}

function roomPacketDetails(message: BreakoutRoomMessageRecord): [string, string][] {
  const entries: [string, string][] = [];
  const confidence = metadataText(message.metadata, 'confidence');
  const uncertainty = metadataText(message.metadata, 'uncertainty');
  const nextExperiment = metadataText(message.metadata, 'nextExperiment');
  if (confidence) entries.push(['Confidence', confidence]);
  if (uncertainty) entries.push(['Uncertainty', uncertainty]);
  if (nextExperiment) entries.push(['Next check', nextExperiment]);
  return entries;
}

function metadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
