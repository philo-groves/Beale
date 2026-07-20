import { memo } from 'react';
import type { JSX } from 'react';
import type { HoneycrispMemorySummary, WorkspaceScopeVersion, RunDetail, SteeringAction } from '@shared/types';
import { WorkspaceUnderstandingView } from '../workspaces/WorkspaceUnderstandingView';
import { MemorySidePanel } from '../research/MemorySidePanel';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { ContextSessionView } from './ContextSessionView';
import type { SessionMainView } from './sessionViews';

export const MainSessionWorkspace = memo(function MainSessionWorkspace({
  detail,
  events,
  honeycrispMemory,
  runCount,
  scope,
  selectedRunId,
  selectedTraceEventId,
  searchHighlightQuery,
  sessionView,
  visibleTraceCategories,
  busy,
  traceFilterCount,
  totalTraceFilterCount,
  onOpenTraceFilters,
  onOpenHoneycrispMemoryDirectory,
  onSelectTraceEvent,
  onSessionAction,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  honeycrispMemory: HoneycrispMemorySummary | null;
  runCount: number;
  scope: WorkspaceScopeVersion | null;
  selectedRunId: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  sessionView: SessionMainView;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  onOpenTraceFilters: () => void;
  onOpenHoneycrispMemoryDirectory: (name: HoneycrispMemorySummary['directories'][number]['name']) => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSessionAction: (action: SteeringAction) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  if (!selectedRunId) {
    return (
      <WorkspaceUnderstandingView
        busy={busy}
        honeycrispMemory={honeycrispMemory}
        runCount={runCount}
        scope={scope}
        onOpenHoneycrispMemoryDirectory={onOpenHoneycrispMemoryDirectory}
      />
    );
  }

  if (sessionView === 'context') {
    return <ContextSessionView honeycrispMemory={detail?.honeycrispMemory ?? null} selectedRunId={selectedRunId} />;
  }

  return (
    <div className="main-session-grid">
      <TraceView
        busy={busy}
        detail={detail}
        events={events}
        selectedRunId={selectedRunId}
        selectedTraceEventId={selectedTraceEventId}
        searchHighlightQuery={searchHighlightQuery}
        traceFilterCount={traceFilterCount}
        totalTraceFilterCount={totalTraceFilterCount}
        visibleTraceCategories={visibleTraceCategories}
        onOpenTraceFilters={onOpenTraceFilters}
        onSelectTraceEvent={onSelectTraceEvent}
        onSessionAction={onSessionAction}
        onSteerInstruction={onSteerInstruction}
      />
      <MemorySidePanel memory={detail?.honeycrispMemory ?? null} />
    </div>
  );
});
