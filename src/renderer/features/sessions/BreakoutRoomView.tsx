import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { BreakoutRoomMemberRecord, BreakoutRoomMessageRecord, ResearchModelProviderId, ResearchProviderModelCatalog, RunDetail } from '@shared/types';
import { ProviderIcon } from '../../app/ProviderIcon';
import { formatDurationHms, formatSessionDateTime, formatSessionTime, researchModelNameLabel } from '../../lib/formatting';
import { commentaryMessagesForSession } from '../../view-models/commentary';
import { subagentDisplayName, traceAgentPath, traceEventsForSubagent } from '../../view-models/subagents';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { CommentaryMessageRow, commentaryFollowLatestAfterScroll, commentaryScrollFadeClasses, shouldAutoExpandToolMessage } from '../commentary/CommentaryView';
import { renderTraceProseText } from '../traces/traceMarkup';

export function BreakoutRoomView({
  detail,
  events = [],
  providerModelCatalog = [],
  roomId,
  onSelectSubagent
}: {
  detail: RunDetail | null;
  events?: TraceDisplayEvent[];
  providerModelCatalog?: ResearchProviderModelCatalog[];
  roomId: string;
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  const room = useMemo(() => detail?.breakoutRooms?.find((candidate) => candidate.id === roomId) ?? null, [detail?.breakoutRooms, roomId]);
  const members = useMemo(() => (detail?.breakoutRoomMembers ?? []).filter((member) => member.roomId === roomId), [detail?.breakoutRoomMembers, roomId]);
  const messages = useMemo(() => (detail?.breakoutRoomMessages ?? []).filter((message) => message.roomId === roomId), [detail?.breakoutRoomMessages, roomId]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const memberByAgentPath = useMemo(() => new Map(members.map((member) => [member.agentPath, member])), [members]);
  const workingMembers = useMemo(() => members.filter((member) => member.status === 'active'), [members]);
  const eventsByAgentPath = useMemo(() => traceEventsByAgentPath(events), [events]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const userScrollIntentRef = useRef(false);
  const roomIdRef = useRef(roomId);
  const transcriptUpdateKey = breakoutRoomTranscriptUpdateKey(messages, room?.outcomeMarkdown ?? null, workingMembers, eventsByAgentPath);

  const updateScrollEdges = useCallback((): void => {
    const scroll = scrollRef.current;
    const list = listRef.current;
    if (!scroll || !list) return;
    const fadeClasses = commentaryScrollFadeClasses({
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      scrollTop: list.scrollTop
    });
    scroll.classList.toggle('has-top-fade', fadeClasses['has-top-fade']);
    scroll.classList.toggle('has-bottom-fade', fadeClasses['has-bottom-fade']);
  }, []);

  const scrollToLatest = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    updateScrollEdges();
  }, [updateScrollEdges]);

  const syncScrollState = useCallback((): void => {
    if (followLatestRef.current) {
      scrollToLatest();
      return;
    }
    updateScrollEdges();
  }, [scrollToLatest, updateScrollEdges]);

  useLayoutEffect(() => {
    if (roomIdRef.current !== roomId) {
      roomIdRef.current = roomId;
      followLatestRef.current = true;
      userScrollIntentRef.current = false;
    }
    const frame = window.requestAnimationFrame(syncScrollState);
    return () => window.cancelAnimationFrame(frame);
  }, [roomId, syncScrollState, transcriptUpdateKey]);

  useEffect(() => {
    if (!followLatestRef.current) return undefined;
    const frame = window.requestAnimationFrame(syncScrollState);
    return () => window.cancelAnimationFrame(frame);
  }, [syncScrollState, transcriptUpdateKey]);

  const markUserScrollIntent = useCallback((): void => {
    userScrollIntentRef.current = true;
    followLatestRef.current = false;
  }, []);

  const handleScroll = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    updateScrollEdges();
    const distanceFromBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    followLatestRef.current = commentaryFollowLatestAfterScroll({
      wasFollowingLatest: followLatestRef.current,
      distanceFromBottom,
      userInitiated: userScrollIntentRef.current
    });
    userScrollIntentRef.current = false;
  }, [updateScrollEdges]);

  useEffect(() => {
    if (workingMembers.length === 0) return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [roomId, workingMembers.length]);

  const hasTranscriptContent = messages.length > 0 || Boolean(room?.outcomeMarkdown) || workingMembers.length > 0;

  return (
    <section className="main-trace-view breakout-room-view" aria-label={room ? `Breakout room: ${room.title}` : 'Breakout room'}>
      {!detail || !room ? <div className="main-trace-empty">Loading breakout room.</div> : null}
      {detail && room && !hasTranscriptContent ? <div className="main-trace-empty">This room has no recorded messages yet.</div> : null}
      {detail && room && hasTranscriptContent ? (
        <div className="main-commentary-scroll breakout-room-scroll" ref={scrollRef}>
          <div
            className="main-commentary-list breakout-room-transcript"
            ref={listRef}
            onScroll={handleScroll}
            onWheel={(event) => {
              if (event.deltaY < 0) markUserScrollIntent();
            }}
            onTouchMove={markUserScrollIntent}
            onPointerDown={(event) => {
              const list = listRef.current;
              if (!list || event.pointerType === 'touch') return;
              const bounds = list.getBoundingClientRect();
              const scrollbarWidth = Math.max(12, list.offsetWidth - list.clientWidth + 4);
              if (event.clientX >= bounds.right - scrollbarWidth) markUserScrollIntent();
            }}
          >
            {messages.map((message) => (
              <BreakoutMessage
                message={message}
                member={(message.memberId ? memberById.get(message.memberId) : undefined) ?? memberByAgentPath.get(message.senderAgentPath)}
                providerModelCatalog={providerModelCatalog}
                onSelectSubagent={onSelectSubagent}
                key={message.id}
              />
            ))}
            {room.outcomeMarkdown && !messages.some((message) => message.kind === 'outcome') ? (
              <BreakoutOutcome
                contentMarkdown={room.outcomeMarkdown}
                createdAt={room.closedAt ?? room.createdAt}
                model={detail.run.model}
                provider={metadataText(detail.run.budget, 'modelProvider') ?? detail.run.model}
                providerModelCatalog={providerModelCatalog}
              />
            ) : null}
            {workingMembers.length > 0 ? (
              <section className="breakout-room-working-subagents" aria-label="Working subagents">
                {workingMembers.map((member) => (
                  <WorkingSubagentDisclosure
                    detail={detail}
                    events={eventsByAgentPath.get(member.agentPath) ?? []}
                    member={member}
                    nowMs={nowMs}
                    key={member.id}
                  />
                ))}
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
  events: readonly TraceDisplayEvent[];
  member: BreakoutRoomMemberRecord;
  nowMs: number;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const rawName = member.agentPath.split('/').filter(Boolean).at(-1) ?? member.agentPath;
  const name = subagentDisplayName(rawName);
  const durationLabel = breakoutRoomWorkingDurationLabel(member, events, nowMs);
  const messages = useMemo(
    () => expanded ? commentaryMessagesForSession(detail, events, { includeInitialPrompt: false }) : [],
    [detail, events, expanded]
  );

  return (
    <details className="breakout-room-working-subagent" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary aria-label={`${name} working for ${durationLabel}`}>
        <span className="breakout-room-working-title">
          <ChevronRight size={15} aria-hidden="true" />
          <strong>{name} Working</strong>
        </span>
        <span className="breakout-room-working-duration">{durationLabel}</span>
      </summary>
      {expanded ? (
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
      ) : null}
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

function BreakoutMessage({
  message,
  member,
  providerModelCatalog,
  onSelectSubagent
}: {
  message: BreakoutRoomMessageRecord;
  member: BreakoutRoomMemberRecord | undefined;
  providerModelCatalog: ResearchProviderModelCatalog[];
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  const sender = breakoutMessageSenderName(message, member);
  const provider = member?.provider || metadataText(message.metadata, 'provider') || member?.model || metadataText(message.metadata, 'model') || '';
  const model = member?.model || metadataText(message.metadata, 'model') || provider;
  const modelDisplayName = breakoutModelDisplayName(provider, model, providerModelCatalog);
  const subagentPath = message.senderAgentPath === '/root'
    ? null
    : member?.agentPath || message.senderAgentPath;
  const direction = breakoutMessageDirection(message);
  return (
    <article className={`breakout-room-message kind-${message.kind} direction-${direction}`}>
      <BreakoutMessageBody
        header={(
          <BreakoutMessageHeader
            kindLabel={messageKindLabel(message)}
            model={modelDisplayName}
            modelTitle={model}
            provider={provider}
            sender={sender}
            subagentPath={subagentPath}
            timestamp={message.createdAt}
            onSelectSubagent={onSelectSubagent}
          />
        )}
      >
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

function breakoutMessageDirection(
  message: Pick<BreakoutRoomMessageRecord, 'kind' | 'senderAgentPath'>
): 'incoming' | 'outbound' {
  return message.senderAgentPath === '/root' && message.kind !== 'outcome' ? 'outbound' : 'incoming';
}

export function breakoutRoomTranscriptUpdateKey(
  messages: readonly BreakoutRoomMessageRecord[],
  outcomeMarkdown: string | null,
  workingMembers: readonly BreakoutRoomMemberRecord[],
  events: readonly TraceDisplayEvent[] | ReadonlyMap<string, readonly TraceDisplayEvent[]>
): string {
  const workingEventIds = workingMembers.flatMap((member) => (
    breakoutRoomEventsForAgentPath(events, member.agentPath).map((event) => event.id)
  ));
  return [
    ...messages.map((message) => `${message.id}:${message.contentMarkdown.length}:${message.evidenceRefs.length}`),
    `outcome:${outcomeMarkdown?.length ?? 0}`,
    `working:${workingMembers.map((member) => `${member.id}:${member.status}`).join(',')}`,
    `events:${workingEventIds.join(',')}`
  ].join('|');
}

export function traceEventsByAgentPath(events: readonly TraceDisplayEvent[]): Map<string, TraceDisplayEvent[]> {
  const eventsByAgentPath = new Map<string, TraceDisplayEvent[]>();
  for (const event of events) {
    const agentPath = traceAgentPath(event);
    if (!agentPath || agentPath === '/root') continue;
    const pathEvents = eventsByAgentPath.get(agentPath);
    if (pathEvents) pathEvents.push(event);
    else eventsByAgentPath.set(agentPath, [event]);
  }
  return eventsByAgentPath;
}

function breakoutRoomEventsForAgentPath(
  events: readonly TraceDisplayEvent[] | ReadonlyMap<string, readonly TraceDisplayEvent[]>,
  agentPath: string
): readonly TraceDisplayEvent[] {
  if (Array.isArray(events)) return traceEventsForSubagent(events, agentPath);
  return (events as ReadonlyMap<string, readonly TraceDisplayEvent[]>).get(agentPath) ?? [];
}

function BreakoutOutcome({
  contentMarkdown,
  createdAt,
  model,
  provider,
  providerModelCatalog
}: {
  contentMarkdown: string;
  createdAt: string;
  model: string;
  provider: string;
  providerModelCatalog: ResearchProviderModelCatalog[];
}): JSX.Element {
  const modelDisplayName = breakoutModelDisplayName(provider, model, providerModelCatalog);
  return (
    <article className="breakout-room-message kind-outcome direction-incoming">
      <BreakoutMessageBody
        header={(
          <BreakoutMessageHeader
            kindLabel="Outcome"
            model={modelDisplayName}
            modelTitle={model}
            provider={provider}
            sender="Lead Agent"
            subagentPath={null}
            timestamp={createdAt}
            onSelectSubagent={() => undefined}
          />
        )}
      >
        <div className="breakout-room-message-content">{renderTraceProseText(contentMarkdown, 'agent_output')}</div>
      </BreakoutMessageBody>
    </article>
  );
}

function BreakoutMessageHeader({
  kindLabel,
  model,
  modelTitle,
  provider,
  sender,
  subagentPath,
  timestamp,
  onSelectSubagent
}: {
  kindLabel: string;
  model: string;
  modelTitle: string;
  provider: string;
  sender: string;
  subagentPath: string | null;
  timestamp: string;
  onSelectSubagent: (path: string) => void;
}): JSX.Element {
  const timestampLabel = breakoutMessageTimestampLabel(timestamp);
  return (
    <div className="run-work-header breakout-room-message-header">
      <span className="breakout-room-message-sender">
        <span className="breakout-room-message-provider" title={modelTitle}>
          <ProviderIcon className="breakout-room-message-provider-icon" provider={provider || modelTitle} size={14} aria-hidden="true" />
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
        {model ? (
          <>
            <span className="breakout-room-message-separator" aria-hidden="true">&bull;</span>
            <span className="breakout-room-message-model" title={modelTitle}>{model}</span>
          </>
        ) : null}
      </span>
      <span className="breakout-room-message-meta">
        <span className="breakout-room-message-kind">{kindLabel}</span>
        {timestampLabel ? (
          <>
            <span className="breakout-room-message-separator" aria-hidden="true">&bull;</span>
            <time className="breakout-room-message-time" dateTime={timestamp} title={timestampLabel.title}>{timestampLabel.label}</time>
          </>
        ) : null}
      </span>
    </div>
  );
}

function BreakoutMessageBody({ children, header }: { children: ReactNode; header: ReactNode }): JSX.Element {
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
      {header}
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

function messageKindLabel(message: BreakoutRoomMessageRecord): string {
  const packetKind = typeof message.metadata.packetKind === 'string' ? message.metadata.packetKind : message.kind;
  return packetKind.split('_').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
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

function breakoutModelDisplayName(
  provider: string,
  model: string,
  catalogs: readonly ResearchProviderModelCatalog[]
): string {
  const providerId = breakoutResearchProviderId(provider) ?? breakoutResearchProviderId(model);
  const matchingCatalog = providerId
    ? catalogs.find((catalog) => catalog.providerId === providerId)
    : catalogs.find((catalog) => catalog.models.some((candidate) => candidate.id === model));
  const matchingModel = matchingCatalog?.models.find((candidate) => candidate.id === model);
  if (matchingCatalog && matchingModel) return researchModelNameLabel(matchingCatalog.providerId, matchingModel.name);
  const fallback = fallbackModelDisplayName(model);
  return providerId ? researchModelNameLabel(providerId, fallback) : fallback;
}

function breakoutResearchProviderId(value: string): ResearchModelProviderId | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'openai' || normalized === 'openai-codex' || normalized.startsWith('gpt-') || /^o\d(?:-|$)/u.test(normalized)) return 'openai-codex';
  if (normalized === 'anthropic' || normalized === 'claude' || normalized.startsWith('claude-')) return 'anthropic';
  if (normalized === 'xai' || normalized === 'grok' || normalized.startsWith('grok-')) return 'xai';
  if (normalized === 'zai' || normalized === 'z.ai' || normalized === 'glm' || normalized.startsWith('glm-')) return 'zai';
  return null;
}

function fallbackModelDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower === 'gpt-daybreak-blue-latest') return 'Daybreak Blue';
  if (lower === 'gpt-daybreak-red-latest') return 'Daybreak Red';
  if (lower.startsWith('gpt-')) return titleModelTokens(lower.slice(4));
  if (lower.startsWith('claude-')) return titleModelTokens(lower.slice(7));
  if (lower.startsWith('grok-')) return `Grok ${titleModelTokens(lower.slice(5))}`;
  if (lower.startsWith('glm-')) return `GLM-${titleModelTokens(lower.slice(4))}`;
  return titleModelTokens(normalized);
}

function titleModelTokens(value: string): string {
  return value
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(?:\.\d+)*$/u.test(part)) return part;
      if (part.toLowerCase() === 'glm') return 'GLM';
      if (part.toLowerCase() === 'gpt') return 'GPT';
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(' ');
}

function breakoutMessageTimestampLabel(value: string): { label: string; title: string } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    label: formatSessionTime(date),
    title: formatSessionDateTime(value)
  };
}

function metadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
