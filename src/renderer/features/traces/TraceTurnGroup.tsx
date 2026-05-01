import type { JSX } from 'react';
import type { RunDetail, RunStatus } from '@shared/types';
import { traceGroupStatusLabel, type TraceDisplayEvent, type TraceTimelineEntry, type TraceTimelineGroup } from '../../view-models/traceDisplay';
import { TraceEventRow } from './TraceEventRow';
import { formatTraceTimestamp } from './traceVisuals';

export function TraceTurnGroup({
  detail,
  group,
  entries,
  enteringTraceEventIds,
  latest,
  runStatus,
  selectedTraceEventId,
  searchHighlightQuery,
  onSelectTraceEvent
}: {
  detail: RunDetail;
  group: TraceTimelineGroup;
  entries: TraceTimelineEntry[];
  enteringTraceEventIds: Set<string>;
  latest: boolean;
  runStatus: RunStatus;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const status = traceGroupStatusLabel(group, latest, runStatus);
  const activitySummary = group.toolCount > 0 ? `${group.toolCount} ops` : group.modelCount > 0 ? `${group.modelCount} model` : 'system';
  const headerEntering = entries[0] ? enteringTraceEventIds.has(entries[0].event.id) : false;

  return (
    <section className={`main-trace-turn ${headerEntering ? 'trace-turn-entering' : ''}`} aria-label={group.label}>
      <div className="main-trace-turn-header">
        <div>
          <span className="main-trace-turn-label">{group.label}</span>
          <span>
            {formatTraceTimestamp(group.startedAt)}
            {group.updatedAt !== group.startedAt ? ` - ${formatTraceTimestamp(group.updatedAt)}` : ''}
          </span>
        </div>
        <div>
          <span>{group.visibleCount} events</span>
          <span>{activitySummary}</span>
          <span className={`main-trace-turn-state state-${status.kind}`}>{status.label}</span>
        </div>
      </div>
      <div className="main-trace-turn-events">
        {entries.map(({ event }) => (
          <TraceEventRow
            detail={detail}
            entering={enteringTraceEventIds.has(event.id)}
            event={event}
            key={event.id}
            searchHighlightQuery={searchHighlightQuery}
            selected={event.id === selectedTraceEventId}
            onSelect={onSelectTraceEvent}
          />
        ))}
      </div>
    </section>
  );
}
