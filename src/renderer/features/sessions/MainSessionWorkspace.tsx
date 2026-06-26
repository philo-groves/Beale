import { memo } from 'react';
import type { JSX } from 'react';
import type { HoneycrispMemorySummary, ProgramScopeVersion, RunDetail, SteeringAction } from '@shared/types';
import { ProgramUnderstandingView } from '../programs/ProgramUnderstandingView';
import { ResearchSidePanel } from '../research/ResearchSidePanel';
import { TraceView } from '../traces/TraceView';
import type { TraceCategoryId } from '../../traceClassification';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { ContextSessionView } from './ContextSessionView';
import { SpawnSessionView } from './SpawnSessionView';
import type { SessionMainView } from './sessionViews';

export const MainSessionWorkspace = memo(function MainSessionWorkspace({
  detail,
  events,
  honeycrispMemory,
  researchPanelCollapsed,
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
  onExpandResearchPanel,
  onOpenTraceFilters,
  onOpenHoneycrispMemoryDirectory,
  onSelectTraceEvent,
  onSessionAction,
  onStartNextPrompt,
  onSteerInstruction
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  honeycrispMemory: HoneycrispMemorySummary | null;
  researchPanelCollapsed: boolean;
  runCount: number;
  scope: ProgramScopeVersion | null;
  selectedRunId: string | null;
  selectedTraceEventId: string | null;
  searchHighlightQuery: string;
  sessionView: SessionMainView;
  visibleTraceCategories: TraceCategoryId[];
  busy: boolean;
  traceFilterCount: number;
  totalTraceFilterCount: number;
  onExpandResearchPanel: () => void;
  onOpenTraceFilters: () => void;
  onOpenHoneycrispMemoryDirectory: (name: HoneycrispMemorySummary['directories'][number]['name']) => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
  onSessionAction: (action: SteeringAction) => void;
  onStartNextPrompt: (promptMarkdown: string) => void;
  onSteerInstruction: (runId: string, instruction: string) => void;
}): JSX.Element | null {
  if (!selectedRunId) {
    return (
      <ProgramUnderstandingView
        busy={busy}
        honeycrispMemory={honeycrispMemory}
        runCount={runCount}
        scope={scope}
        onOpenHoneycrispMemoryDirectory={onOpenHoneycrispMemoryDirectory}
      />
    );
  }

  if (sessionView === 'spawn') {
    return (
      <SpawnSessionView
        busy={busy}
        detail={detail}
        events={events}
        selectedTraceEventId={selectedTraceEventId}
        onSelectTraceEvent={onSelectTraceEvent}
        onStartNextPrompt={onStartNextPrompt}
      />
    );
  }

  if (sessionView === 'context') {
    return <ContextSessionView honeycrispMemory={detail?.honeycrispMemory ?? null} selectedRunId={selectedRunId} />;
  }

  return (
    <div className={`main-session-grid ${researchPanelCollapsed ? 'research-collapsed' : ''}`}>
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
      <ResearchSidePanel
        collapsed={researchPanelCollapsed}
        detail={detail}
        events={events}
        selectedTraceEventId={selectedTraceEventId}
        onExpand={onExpandResearchPanel}
        onSelectTraceEvent={onSelectTraceEvent}
      />
    </div>
  );
});
