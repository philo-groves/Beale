import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { Bug, ClipboardCheck, FileOutput, RefreshCw, Search, X } from 'lucide-react';
import type { EvidenceRecord, FindingRecord, HypothesisRecord, RunDetail } from '@shared/types';
import { Modal } from '../../app/Modal';
import {
  buildEvidenceTrails,
  traceEventForEvidence,
  traceEventForFinding,
  traceEventForHypothesis,
  type EvidenceTrail
} from '../../view-models/researchItems';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { pythonToolCallPreview, pythonTracePreview, reasoningTraceThoughtsFromText, type PythonToolCallPreview } from '../../view-models/traceContent';
import { formatPriorityPill, formatSessionTime, stateClass, traceLabel, truncateText } from '../../lib/formatting';
import { highlightPythonCode } from '../traces/traceMarkup';

interface SpawnTrailLayout {
  trail: EvidenceTrail;
  x: string;
  y: string;
  delayMs: number;
  width: number;
  estimateHeight: number;
}

interface SpawnThought {
  id: string;
  sourceText: string;
  thoughts: SpawnThoughtSegment[];
  estimatedHeight: number;
}

interface SpawnThoughtSegment {
  title: string | null;
  description: string;
}

interface SpawnPythonPreview {
  id: string;
  codeEvent: TraceDisplayEvent;
  resultEvent: TraceDisplayEvent | null;
  preview: PythonToolCallPreview;
}

interface SpawnWorkspaceSize {
  width: number;
  height: number;
}

interface SpawnLayoutMetrics {
  centerWidth: number;
  workspaceWidth: number;
  workspaceHeight: number;
}

interface SpawnTrailSize {
  trail: EvidenceTrail;
  width: number;
  height: number;
}

interface SpawnLane {
  side: 'left' | 'right';
  left: number;
  right: number;
  occupied: SpawnRect[];
}

interface SpawnRect {
  top: number;
  bottom: number;
}

type SpawnTrailSurface = 'evidence' | 'finding' | 'overflow' | null;

type SpawnTrailListItem =
  | { kind: 'overflow'; hiddenCount: number }
  | { kind: 'evidence'; evidence: EvidenceRecord }
  | { kind: 'finding'; finding: FindingRecord };

const SPAWN_FALLBACK_WORKSPACE: SpawnWorkspaceSize = { width: 1180, height: 720 };
const SPAWN_CENTER_MAX_WIDTH = 640;
const SPAWN_CENTER_MIN_WIDTH = 320;
const SPAWN_CENTER_COMPACT_MIN_WIDTH = 280;
const SPAWN_CENTER_LANE_GAP = 34;
const SPAWN_EDGE_PADDING = 24;
const SPAWN_SEARCH_CONTROL_CLEARANCE = 84;
const SPAWN_TRAIL_GAP = 28;
const SPAWN_TRAIL_MIN_WIDTH = 208;
const SPAWN_MAX_TRAIL_LIST_ITEMS = 4;
const SPAWN_TRAIL_VERTICAL_ANCHORS = [0, -0.24, 0.24, -0.38, 0.38, -0.12, 0.12, -0.5, 0.5];

export const SpawnSessionView = memo(function SpawnSessionView({
  detail,
  events,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [workspaceSize, setWorkspaceSize] = useState<SpawnWorkspaceSize>({ width: 0, height: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTrailId, setExpandedTrailId] = useState<string | null>(null);
  const trails = useMemo(() => (detail ? buildEvidenceTrails(detail.hypotheses, detail.findings, detail.evidence) : []), [detail]);
  const latestThought = useMemo(() => latestAgentThought(events), [events]);
  const latestPython = useMemo(() => latestSpawnPythonPreview(events, detail), [detail, events]);
  const [visibleThought, setVisibleThought] = useState<SpawnThought>(latestThought);
  const [thoughtPhase, setThoughtPhase] = useState<'enter' | 'exit'>('enter');
  const normalizedSearch = normalizeSpawnSearch(searchQuery);
  const layoutMetrics = useMemo(() => spawnLayoutMetrics(trails, normalizedSearch, workspaceSize), [normalizedSearch, trails, workspaceSize]);
  const displayedTrails = useMemo(() => spawnTrailLayouts(trails, normalizedSearch, layoutMetrics), [layoutMetrics, normalizedSearch, trails]);
  const hiddenCount = Math.max(0, trails.length - displayedTrails.length);
  const expandedTrail = expandedTrailId ? trails.find((trail) => trail.id === expandedTrailId) ?? null : null;
  const artifactById = useMemo(() => new Map((detail?.artifacts ?? []).map((artifact) => [artifact.id, artifact])), [detail?.artifacts]);
  const verifierRunById = useMemo(() => new Map((detail?.verifierRuns ?? []).map((run) => [run.id, run])), [detail?.verifierRuns]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof window === 'undefined') return undefined;
    let frame = 0;
    const updateSize = (): void => {
      frame = 0;
      const rect = workspace.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setWorkspaceSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    const requestUpdate = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(updateSize);
    };
    requestUpdate();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(requestUpdate);
      observer.observe(workspace);
      return () => {
        observer.disconnect();
        if (frame !== 0) window.cancelAnimationFrame(frame);
      };
    }
    window.addEventListener('resize', requestUpdate);
    return () => {
      window.removeEventListener('resize', requestUpdate);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (latestThought.id === visibleThought.id && latestThought.sourceText === visibleThought.sourceText) return undefined;
    setThoughtPhase('exit');
    const timeout = window.setTimeout(() => {
      setVisibleThought(latestThought);
      setThoughtPhase('enter');
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [latestThought, visibleThought.id, visibleThought.sourceText]);

  return (
    <div className="spawn-session-workspace" ref={workspaceRef} aria-label="Spawn view">
      <div className="spawn-trail-field" aria-hidden={displayedTrails.length === 0}>
        {displayedTrails.map((layout) => (
          <SpawnTrail
            artifactById={artifactById}
            events={events}
            key={layout.trail.id}
            layout={layout}
            selectedTraceEventId={selectedTraceEventId}
            verifierRunById={verifierRunById}
            onOpenFullTrail={setExpandedTrailId}
            onSelectTraceEvent={onSelectTraceEvent}
          />
        ))}
      </div>

      <div className="spawn-center-stack" style={{ '--spawn-center-width': `${layoutMetrics.centerWidth}px` } as CSSProperties}>
        <section className="spawn-core" aria-label="Latest agent thought" style={{ '--spawn-core-min-height': `${Math.max(136, visibleThought.estimatedHeight)}px` } as CSSProperties}>
          <SquircleBackdrop className="spawn-core-shape" />
          <div className={`spawn-core-content ${thoughtPhase}`} key={visibleThought.id}>
            <div className="spawn-thought-list">
              {visibleThought.thoughts.map((thought, index) => {
                const title = thought.title ?? 'Latest Thought';
                return (
                  <section className="spawn-thought-item" key={`${title}-${index}`}>
                    <strong className={`spawn-thought-title ${thought.title ? '' : 'fallback'}`}>{renderSpawnInlineText(title, `thought-title-${index}`)}</strong>
                    {thought.description ? <p className="spawn-thought-description">{renderSpawnInlineText(thought.description, `thought-description-${index}`)}</p> : null}
                  </section>
                );
              })}
            </div>
          </div>
        </section>
        {latestPython ? (
          <SpawnPythonChain
            key={latestPython.id}
            python={latestPython}
            selectedTraceEventId={selectedTraceEventId}
            onSelectTraceEvent={onSelectTraceEvent}
          />
        ) : null}
      </div>

      <div className={`spawn-search-control ${searchOpen ? 'open' : ''}`}>
        {searchOpen ? (
          <>
            <input
              autoFocus
              aria-label="Filter spawn trails"
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Filter trails"
              type="search"
              value={searchQuery}
            />
            <button
              type="button"
              aria-label="Close trail filter"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery('');
              }}
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <button type="button" aria-label="Filter spawn trails" onClick={() => setSearchOpen(true)}>
            <Search size={18} />
          </button>
        )}
        {searchOpen && hiddenCount > 0 && !normalizedSearch ? <span>{hiddenCount} hidden</span> : null}
      </div>
      {expandedTrail ? (
        <SpawnTrailDetailModal
          artifactById={artifactById}
          events={events}
          trail={expandedTrail}
          verifierRunById={verifierRunById}
          onClose={() => setExpandedTrailId(null)}
          onSelectTraceEvent={(event) => {
            onSelectTraceEvent(event);
            setExpandedTrailId(null);
          }}
        />
      ) : null}
    </div>
  );
});

function SpawnTrail({
  artifactById,
  events,
  layout,
  selectedTraceEventId,
  verifierRunById,
  onOpenFullTrail,
  onSelectTraceEvent
}: {
  artifactById: Map<string, RunDetail['artifacts'][number]>;
  events: TraceDisplayEvent[];
  layout: SpawnTrailLayout;
  selectedTraceEventId: string | null;
  verifierRunById: Map<string, RunDetail['verifierRuns'][number]>;
  onOpenFullTrail: (trailId: string) => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const evidenceCount = layout.trail.evidence.length;
  const findingCount = layout.trail.findings.length;
  const standaloneEvidence = !layout.trail.hypothesis && evidenceCount > 0 && findingCount === 0;
  const listItems = compactSpawnTrailItems(layout.trail);
  const firstExtensionSurface = spawnTrailFirstContentSurface(listItems);

  return (
    <article
      className="spawn-trail"
      style={
        {
          '--trail-x': layout.x,
          '--trail-y': layout.y,
          '--trail-delay': `${layout.delayMs}ms`,
          '--trail-width': `${layout.width}px`,
          '--trail-min-height': `${layout.estimateHeight}px`
        } as CSSProperties
      }
    >
      <div className="spawn-trail-float">
        {layout.trail.hypothesis ? (
          <SpawnHypothesisNode
            events={events}
            hypothesis={layout.trail.hypothesis}
            nextSurface={firstExtensionSurface}
            selectedTraceEventId={selectedTraceEventId}
            onSelectTraceEvent={onSelectTraceEvent}
          />
        ) : null}
        {standaloneEvidence ? (
          layout.trail.evidence.map((item) => (
            <SpawnStandaloneEvidenceNode
              artifactKind={item.artifactId ? artifactById.get(item.artifactId)?.kind ?? null : null}
              evidence={item}
              event={traceEventForEvidence(events, item)}
              key={item.id}
              selectedTraceEventId={selectedTraceEventId}
              verifierStatus={item.verifierRunId ? verifierRunById.get(item.verifierRunId)?.status ?? null : null}
              onSelectTraceEvent={onSelectTraceEvent}
            />
          ))
        ) : (
          <div className={`spawn-trail-stack ${layout.trail.hypothesis ? '' : 'rootless'}`}>
            {listItems.map((item, index) => (
              <SpawnTrailListItemNode
                artifactById={artifactById}
                events={events}
                item={item}
                key={spawnTrailListItemKey(item)}
                nextSurface={spawnTrailItemSurface(listItems[index + 1] ?? null)}
                selectedTraceEventId={selectedTraceEventId}
                trail={layout.trail}
                verifierRunById={verifierRunById}
                onOpenFullTrail={onOpenFullTrail}
                onSelectTraceEvent={onSelectTraceEvent}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function SpawnTrailListItemNode({
  artifactById,
  events,
  item,
  nextSurface,
  selectedTraceEventId,
  trail,
  verifierRunById,
  onOpenFullTrail,
  onSelectTraceEvent
}: {
  artifactById: Map<string, RunDetail['artifacts'][number]>;
  events: TraceDisplayEvent[];
  item: SpawnTrailListItem;
  nextSurface: SpawnTrailSurface;
  selectedTraceEventId: string | null;
  trail: EvidenceTrail;
  verifierRunById: Map<string, RunDetail['verifierRuns'][number]>;
  onOpenFullTrail: (trailId: string) => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  if (item.kind === 'overflow') {
    return <SpawnTrailOverflowNode hiddenCount={item.hiddenCount} nextSurface={nextSurface} onOpen={() => onOpenFullTrail(trail.id)} />;
  }
  if (item.kind === 'evidence') {
    const evidence = item.evidence;
    return (
      <SpawnEvidenceNode
        artifactKind={evidence.artifactId ? artifactById.get(evidence.artifactId)?.kind ?? null : null}
        evidence={evidence}
        event={traceEventForEvidence(events, evidence)}
        nextSurface={nextSurface}
        selectedTraceEventId={selectedTraceEventId}
        verifierStatus={evidence.verifierRunId ? verifierRunById.get(evidence.verifierRunId)?.status ?? null : null}
        onSelectTraceEvent={onSelectTraceEvent}
      />
    );
  }
  return (
    <SpawnFindingNode
      events={events}
      finding={item.finding}
      hypothesis={trail.hypothesis}
      nextSurface={nextSurface}
      selectedTraceEventId={selectedTraceEventId}
      onSelectTraceEvent={onSelectTraceEvent}
    />
  );
}

function SpawnHypothesisNode({
  events,
  hypothesis,
  nextSurface,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  events: TraceDisplayEvent[];
  hypothesis: HypothesisRecord;
  nextSurface: SpawnTrailSurface;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const event = traceEventForHypothesis(events, hypothesis);
  const disabled = !event;
  return (
    <button
      type="button"
      className={`spawn-trail-hypothesis ${spawnNextSurfaceClass(nextSurface)} state-${stateClass(hypothesis.state)} ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      style={{ '--spawn-next-surface': spawnTrailSurfaceCssValue(nextSurface) } as CSSProperties}
      disabled={disabled}
      onClick={() => event && onSelectTraceEvent(event)}
    >
      <SquircleBackdrop className="spawn-trail-hypothesis-shape" />
      <div className="spawn-trail-hypothesis-content">
        <div className="spawn-trail-hypothesis-meta">
          <span>
            <Bug size={12} />
            Hypothesis
          </span>
          <em>{traceLabel(hypothesis.state)}</em>
        </div>
        <strong>{truncateText(hypothesis.title, 86)}</strong>
        <small>{formatPriorityPill(hypothesis.priorityScore)}</small>
      </div>
    </button>
  );
}

function SpawnTrailOverflowNode({ hiddenCount, nextSurface, onOpen }: { hiddenCount: number; nextSurface: SpawnTrailSurface; onOpen: () => void }): JSX.Element {
  return (
    <button type="button" className={`spawn-trail-extension spawn-trail-overflow ${spawnNextSurfaceClass(nextSurface)}`} onClick={onOpen}>
      <strong>{`Show ${hiddenCount} More Artifact${hiddenCount === 1 ? '' : 's'}`}</strong>
    </button>
  );
}

function SpawnFindingNode({
  events,
  finding,
  hypothesis,
  nextSurface,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  events: TraceDisplayEvent[];
  finding: FindingRecord;
  hypothesis: HypothesisRecord | null;
  nextSurface: SpawnTrailSurface;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const event = traceEventForFinding(events, finding, hypothesis);
  const disabled = !event;
  return (
    <button
      type="button"
      className={`spawn-trail-extension spawn-trail-finding ${spawnNextSurfaceClass(nextSurface)} state-${stateClass(finding.state)} ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      disabled={disabled}
      onClick={() => event && onSelectTraceEvent(event)}
    >
      <span>
        <FileOutput size={12} />
        Finding
      </span>
      <strong>{truncateText(finding.title, 92)}</strong>
      <small>{traceLabel(finding.state)}</small>
    </button>
  );
}

function SpawnEvidenceNode({
  artifactKind,
  evidence,
  event,
  nextSurface,
  selectedTraceEventId,
  verifierStatus,
  onSelectTraceEvent
}: {
  artifactKind: string | null;
  evidence: EvidenceRecord;
  event: TraceDisplayEvent | null;
  nextSurface: SpawnTrailSurface;
  selectedTraceEventId: string | null;
  verifierStatus: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const disabled = !event;
  const date = new Date(evidence.createdAt);
  const time = Number.isNaN(date.getTime()) ? '' : formatSessionTime(date);
  return (
    <button
      type="button"
      className={`spawn-trail-extension spawn-trail-evidence ${spawnNextSurfaceClass(nextSurface)} ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      disabled={disabled}
      onClick={() => event && onSelectTraceEvent(event)}
    >
      <span>
        <ClipboardCheck size={12} />
        Evidence
      </span>
      <strong>{truncateText(evidence.summary || traceLabel(evidence.kind), 92)}</strong>
      <small>{[traceLabel(evidence.kind), artifactKind ? traceLabel(artifactKind) : '', verifierStatus ? traceLabel(verifierStatus) : '', time].filter(Boolean).join(' / ')}</small>
    </button>
  );
}

function SpawnPythonChain({
  python,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  python: SpawnPythonPreview;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const resultEvent = python.resultEvent;
  const exitCode = python.preview.exitCode ?? '?';
  const statusClass = resultEvent ? (exitCode === '0' ? 'success' : 'review') : 'running';
  return (
    <div className="spawn-python-chain" aria-label="Latest Python execution">
      <button
        type="button"
        className={`spawn-python-node spawn-python-code-node ${python.codeEvent.id === selectedTraceEventId ? 'selected' : ''}`}
        onClick={() => onSelectTraceEvent(python.codeEvent)}
      >
        <SquircleBackdrop className="spawn-python-shape" />
        <div className="spawn-python-content">
          {python.preview.task ? <p className="spawn-python-task">{python.preview.task}</p> : null}
          <SpawnPythonBlock
            label="Code"
            language="python"
            lines={python.preview.scriptLines}
            lineCount={python.preview.scriptLineCount}
            truncated={python.preview.truncated}
          />
          {!resultEvent ? (
            <div className="spawn-python-status running">
              <RefreshCw size={11} />
              <span>Running...</span>
            </div>
          ) : null}
        </div>
      </button>
      {resultEvent ? (
        <button
          type="button"
          className={`spawn-python-result-node ${statusClass} ${resultEvent.id === selectedTraceEventId ? 'selected' : ''}`}
          onClick={() => onSelectTraceEvent(resultEvent)}
        >
          <SquircleBackdrop className="spawn-python-result-shape" />
          <span>Exit {exitCode}</span>
        </button>
      ) : null}
    </div>
  );
}

function SpawnPythonBlock({
  label,
  language,
  lineCount,
  lines,
  meta,
  truncated
}: {
  label: string;
  language?: 'python';
  lineCount: number;
  lines: string[];
  meta?: string;
  truncated: boolean;
}): JSX.Element | null {
  if (lines.length === 0) return null;
  const lineLabel = meta ?? `${lineCount} line${lineCount === 1 ? '' : 's'}`;
  const text = lines.join('\n');
  return (
    <div className="spawn-python-block">
      <div className="spawn-python-heading">
        <span>{label}</span>
        <span>{lineLabel}</span>
      </div>
      <pre className={truncated ? 'is-truncated' : undefined}>
        <code className={language === 'python' ? 'syntax-code language-python' : undefined}>{language === 'python' ? highlightPythonCode(text) : text}</code>
      </pre>
    </div>
  );
}

function SpawnStandaloneEvidenceNode({
  artifactKind,
  evidence,
  event,
  selectedTraceEventId,
  verifierStatus,
  onSelectTraceEvent
}: {
  artifactKind: string | null;
  evidence: EvidenceRecord;
  event: TraceDisplayEvent | null;
  selectedTraceEventId: string | null;
  verifierStatus: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const disabled = !event;
  const date = new Date(evidence.createdAt);
  const time = Number.isNaN(date.getTime()) ? '' : formatSessionTime(date);
  return (
    <button
      type="button"
      className={`spawn-trail-hypothesis spawn-trail-standalone-evidence ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      disabled={disabled}
      onClick={() => event && onSelectTraceEvent(event)}
    >
      <SquircleBackdrop className="spawn-trail-hypothesis-shape" />
      <div className="spawn-trail-hypothesis-content">
        <div className="spawn-trail-hypothesis-meta">
          <span>
            <ClipboardCheck size={12} />
            Evidence
          </span>
          <em>{traceLabel(evidence.kind)}</em>
        </div>
        <strong>{truncateText(evidence.summary || traceLabel(evidence.kind), 92)}</strong>
        <small>{[artifactKind ? traceLabel(artifactKind) : '', verifierStatus ? traceLabel(verifierStatus) : '', time].filter(Boolean).join(' / ')}</small>
      </div>
    </button>
  );
}

function SpawnTrailDetailModal({
  artifactById,
  events,
  trail,
  verifierRunById,
  onClose,
  onSelectTraceEvent
}: {
  artifactById: Map<string, RunDetail['artifacts'][number]>;
  events: TraceDisplayEvent[];
  trail: EvidenceTrail;
  verifierRunById: Map<string, RunDetail['verifierRuns'][number]>;
  onClose: () => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const items = fullSpawnTrailItems(trail);
  const hypothesisEvent = trail.hypothesis ? traceEventForHypothesis(events, trail.hypothesis) : null;
  return (
    <Modal title="Evidence Trail" wide className="spawn-trail-detail-modal" onClose={onClose} footer={<button type="button" onClick={onClose}>Close</button>}>
      <div className="spawn-trail-modal">
        {trail.hypothesis ? (
          <button
            type="button"
            className="spawn-trail-modal-summary"
            disabled={!hypothesisEvent}
            onClick={() => hypothesisEvent && onSelectTraceEvent(hypothesisEvent)}
          >
            <span>Hypothesis</span>
            <strong>{trail.hypothesis.title}</strong>
            <small>{[traceLabel(trail.hypothesis.state), formatPriorityPill(trail.hypothesis.priorityScore)].filter(Boolean).join(' / ')}</small>
          </button>
        ) : null}
        {items.length > 0 ? (
          <div className="spawn-trail-modal-list">
            {items.map((item) => (
              <SpawnTrailModalItem
                artifactById={artifactById}
                events={events}
                item={item}
                key={spawnTrailListItemKey(item)}
                trail={trail}
                verifierRunById={verifierRunById}
                onSelectTraceEvent={onSelectTraceEvent}
              />
            ))}
          </div>
        ) : (
          <p className="spawn-trail-modal-empty">No evidence or findings are recorded for this trail yet.</p>
        )}
      </div>
    </Modal>
  );
}

function SpawnTrailModalItem({
  artifactById,
  events,
  item,
  trail,
  verifierRunById,
  onSelectTraceEvent
}: {
  artifactById: Map<string, RunDetail['artifacts'][number]>;
  events: TraceDisplayEvent[];
  item: Exclude<SpawnTrailListItem, { kind: 'overflow' }>;
  trail: EvidenceTrail;
  verifierRunById: Map<string, RunDetail['verifierRuns'][number]>;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  if (item.kind === 'evidence') {
    const evidence = item.evidence;
    const event = traceEventForEvidence(events, evidence);
    const artifactKind = evidence.artifactId ? artifactById.get(evidence.artifactId)?.kind ?? null : null;
    const verifierStatus = evidence.verifierRunId ? verifierRunById.get(evidence.verifierRunId)?.status ?? null : null;
    const date = new Date(evidence.createdAt);
    const time = Number.isNaN(date.getTime()) ? '' : formatSessionTime(date);
    return (
      <button type="button" className="spawn-trail-modal-item evidence" disabled={!event} onClick={() => event && onSelectTraceEvent(event)}>
        <span>Evidence</span>
        <strong>{evidence.summary || traceLabel(evidence.kind)}</strong>
        <small>{[traceLabel(evidence.kind), artifactKind ? traceLabel(artifactKind) : '', verifierStatus ? traceLabel(verifierStatus) : '', time].filter(Boolean).join(' / ')}</small>
      </button>
    );
  }
  const event = traceEventForFinding(events, item.finding, trail.hypothesis);
  return (
    <button type="button" className="spawn-trail-modal-item finding" disabled={!event} onClick={() => event && onSelectTraceEvent(event)}>
      <span>Finding</span>
      <strong>{item.finding.title}</strong>
      <small>{traceLabel(item.finding.state)}</small>
    </button>
  );
}

function SquircleBackdrop({ className }: { className: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 560 320" preserveAspectRatio="none" aria-hidden="true">
      <path d={superellipsePath(560, 320, 4, 96)} />
    </svg>
  );
}

function latestSpawnPythonPreview(events: TraceDisplayEvent[], detail: RunDetail | null): SpawnPythonPreview | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;

    const resultPreview = pythonTracePreview(event, detail);
    if (resultPreview && (resultPreview.scriptLines.length > 0 || resultPreview.outputLines.length > 0)) {
      const codeEvent = pythonCodeEventForResult(events, event) ?? event;
      return {
        id: `${codeEvent.id}:${event.id}`,
        codeEvent,
        resultEvent: event,
        preview: resultPreview
      };
    }

    const codePreview = pythonToolCallPreview(event);
    if (codePreview && (codePreview.scriptLines.length > 0 || codePreview.task)) {
      const resultEvent = pythonResultEventForCall(events, event, detail);
      const preview = resultEvent ? pythonTracePreview(resultEvent, detail) ?? codePreview : codePreview;
      return {
        id: resultEvent ? `${event.id}:${resultEvent.id}` : event.id,
        codeEvent: event,
        resultEvent,
        preview
      };
    }
  }
  return null;
}

function pythonCodeEventForResult(events: TraceDisplayEvent[], resultEvent: TraceDisplayEvent): TraceDisplayEvent | null {
  if (!resultEvent.toolCallId) return null;
  return (
    [...events]
      .reverse()
      .find((event) => event.id !== resultEvent.id && event.toolCallId === resultEvent.toolCallId && Boolean(pythonToolCallPreview(event))) ?? null
  );
}

function pythonResultEventForCall(events: TraceDisplayEvent[], callEvent: TraceDisplayEvent, detail: RunDetail | null): TraceDisplayEvent | null {
  if (!callEvent.toolCallId) return null;
  return events.find((event) => event.id !== callEvent.id && event.toolCallId === callEvent.toolCallId && Boolean(pythonTracePreview(event, detail))) ?? null;
}

function fullSpawnTrailItems(trail: EvidenceTrail): Array<Exclude<SpawnTrailListItem, { kind: 'overflow' }>> {
  return [
    ...trail.evidence.map((evidence): Exclude<SpawnTrailListItem, { kind: 'overflow' }> => ({ kind: 'evidence', evidence })),
    ...trail.findings.map((finding): Exclude<SpawnTrailListItem, { kind: 'overflow' }> => ({ kind: 'finding', finding }))
  ];
}

function compactSpawnTrailItems(trail: EvidenceTrail): SpawnTrailListItem[] {
  const items = fullSpawnTrailItems(trail);
  if (items.length <= SPAWN_MAX_TRAIL_LIST_ITEMS) return items;
  const firstItem = items[0];
  if (!firstItem) return [];
  const visibleTailItems = items.slice(1, SPAWN_MAX_TRAIL_LIST_ITEMS - 1);
  return [firstItem, { kind: 'overflow', hiddenCount: items.length - 1 - visibleTailItems.length }, ...visibleTailItems];
}

function spawnTrailListItemKey(item: SpawnTrailListItem): string {
  if (item.kind === 'overflow') return `overflow:${item.hiddenCount}`;
  if (item.kind === 'evidence') return `evidence:${item.evidence.id}`;
  return `finding:${item.finding.id}`;
}

function spawnTrailItemSurface(item: SpawnTrailListItem | null): SpawnTrailSurface {
  if (!item) return null;
  return item.kind;
}

function spawnTrailFirstContentSurface(items: SpawnTrailListItem[]): SpawnTrailSurface {
  return spawnTrailItemSurface(items.find((item) => item.kind !== 'overflow') ?? null);
}

function spawnTrailSurfaceCssValue(surface: SpawnTrailSurface): string {
  if (surface === 'evidence') return 'var(--spawn-evidence-surface)';
  if (surface === 'finding') return 'var(--spawn-finding-surface)';
  if (surface === 'overflow') return 'var(--spawn-overflow-surface)';
  return 'transparent';
}

function latestAgentThought(events: TraceDisplayEvent[]): SpawnThought {
  const event = [...events].reverse().find((candidate) => {
    const text = thoughtText(candidate);
    return Boolean(text);
  });
  const text = event ? thoughtText(event) : 'Awaiting the next agent thought.';
  const thoughts = spawnThoughtSegmentsFromText(text);
  return {
    id: event?.id ?? 'empty',
    sourceText: text,
    thoughts,
    estimatedHeight: estimateSpawnThoughtHeight(thoughts)
  };
}

function thoughtText(event: TraceDisplayEvent): string {
  const text = typeof event.payload.text === 'string' ? event.payload.text.trim() : '';
  const transcriptSource = typeof event.payload.transcriptSource === 'string' ? event.payload.transcriptSource : '';
  const transcriptKind = typeof event.payload.transcriptKind === 'string' ? event.payload.transcriptKind : '';
  const claimStatus = typeof event.payload.claimStatus === 'string' ? event.payload.claimStatus : '';
  if (transcriptSource === 'openai_reasoning_summary' || transcriptKind === 'reasoning_summary' || claimStatus === 'reasoning_summary') return text || event.summary;
  if (/completed thought|^thought\.?$/i.test(event.summary)) return text || event.summary;
  return '';
}

function spawnLayoutMetrics(trails: EvidenceTrail[], normalizedSearch: string, workspaceSize: SpawnWorkspaceSize): SpawnLayoutMetrics {
  const workspaceWidth = workspaceSize.width > 0 ? workspaceSize.width : SPAWN_FALLBACK_WORKSPACE.width;
  const workspaceHeight = workspaceSize.height > 0 ? workspaceSize.height : SPAWN_FALLBACK_WORKSPACE.height;
  const candidateTrails = normalizedSearch ? trails.filter((trail) => spawnTrailMatches(trail, normalizedSearch)) : trails;
  const maxTrailWidth = candidateTrails.reduce((maxWidth, trail) => Math.max(maxWidth, estimateSpawnTrailSize(trail, normalizedSearch).width), 0);
  const maxCenterWidth = Math.min(SPAWN_CENTER_MAX_WIDTH, Math.max(SPAWN_CENTER_COMPACT_MIN_WIDTH, workspaceWidth - SPAWN_EDGE_PADDING * 2));
  if (candidateTrails.length === 0 || maxTrailWidth === 0) {
    return {
      centerWidth: maxCenterWidth,
      workspaceWidth,
      workspaceHeight
    };
  }
  const reservedSideWidth = maxTrailWidth + SPAWN_CENTER_LANE_GAP + SPAWN_EDGE_PADDING;
  const laneAwareCenterWidth = workspaceWidth - reservedSideWidth * 2;
  return {
    centerWidth: clampNumber(laneAwareCenterWidth, Math.min(SPAWN_CENTER_MIN_WIDTH, maxCenterWidth), maxCenterWidth),
    workspaceWidth,
    workspaceHeight
  };
}

function spawnTrailLayouts(trails: EvidenceTrail[], normalizedSearch: string, metrics: SpawnLayoutMetrics): SpawnTrailLayout[] {
  const filtered = normalizedSearch ? trails.filter((trail) => spawnTrailMatches(trail, normalizedSearch)) : trails;
  const candidateLimit = normalizedSearch ? 30 : filtered.length;
  const candidates = filtered.slice(0, candidateLimit).map((trail) => estimateSpawnTrailSize(trail, normalizedSearch));
  const lanes = spawnTrailLanes(metrics);
  if (lanes.length === 0) return [];
  const layouts: SpawnTrailLayout[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const placement = placeSpawnTrail(candidate, lanes, metrics, index);
    if (!placement) continue;
    layouts.push({
      trail: candidate.trail,
      x: `${placement.centerX - metrics.workspaceWidth / 2}px`,
      y: `${placement.centerY - metrics.workspaceHeight / 2}px`,
      delayMs: Math.min(520, layouts.length * 70),
      width: placement.width,
      estimateHeight: candidate.height
    });
  }

  return layouts;
}

function estimateSpawnTrailSize(trail: EvidenceTrail, normalizedSearch: string): SpawnTrailSize {
  const evidenceCount = trail.evidence.length;
  const findingCount = trail.findings.length;
  const compactListCount = compactSpawnTrailItems(trail).length;
  const itemCount = Math.max(1, evidenceCount + findingCount + (trail.hypothesis ? 1 : 0));
  const standaloneEvidence = !trail.hypothesis && evidenceCount > 0 && findingCount === 0;
  const width = normalizedSearch ? 280 : itemCount > 3 ? 278 : 248;
  const visibleStandaloneCount = Math.min(evidenceCount, SPAWN_MAX_TRAIL_LIST_ITEMS);
  const height = standaloneEvidence
    ? Math.max(156, visibleStandaloneCount * 110 + Math.max(0, visibleStandaloneCount - 1) * 12)
    : Math.max(156, (trail.hypothesis ? 108 : 20) + compactListCount * 72 + 20);
  return { trail, width, height };
}

function spawnTrailLanes(metrics: SpawnLayoutMetrics): SpawnLane[] {
  const centerLeft = (metrics.workspaceWidth - metrics.centerWidth) / 2;
  const centerRight = centerLeft + metrics.centerWidth;
  const lanes: SpawnLane[] = [];
  const leftLane = {
    side: 'left' as const,
    left: SPAWN_EDGE_PADDING,
    right: centerLeft - SPAWN_CENTER_LANE_GAP,
    occupied: []
  };
  const rightLane = {
    side: 'right' as const,
    left: centerRight + SPAWN_CENTER_LANE_GAP,
    right: metrics.workspaceWidth - SPAWN_EDGE_PADDING,
    occupied: []
  };
  if (leftLane.right - leftLane.left >= SPAWN_TRAIL_MIN_WIDTH) lanes.push(leftLane);
  if (rightLane.right - rightLane.left >= SPAWN_TRAIL_MIN_WIDTH) lanes.push(rightLane);
  return lanes;
}

function placeSpawnTrail(
  candidate: SpawnTrailSize,
  lanes: SpawnLane[],
  metrics: SpawnLayoutMetrics,
  index: number
): { centerX: number; centerY: number; width: number } | null {
  const preferredSide = index % 2 === 0 ? 'left' : 'right';
  const anchor = SPAWN_TRAIL_VERTICAL_ANCHORS[index % SPAWN_TRAIL_VERTICAL_ANCHORS.length] ?? 0;
  const preferredCenterY = metrics.workspaceHeight / 2 + metrics.workspaceHeight * anchor;
  const preferredTop = preferredCenterY - candidate.height / 2;
  const placements = lanes
    .map((lane) => {
      const laneWidth = lane.right - lane.left;
      const width = Math.min(candidate.width, laneWidth);
      if (width < SPAWN_TRAIL_MIN_WIDTH) return null;
      const top = fitSpawnTrailTop(lane.occupied, candidate.height, preferredTop, metrics.workspaceHeight);
      if (top === null) return null;
      const left = lane.side === 'left' ? lane.right - width : lane.left;
      const centerY = top + candidate.height / 2;
      const sidePenalty = lane.side === preferredSide ? 0 : 18;
      const loadPenalty = lane.occupied.length * 24;
      return {
        lane,
        left,
        top,
        width,
        centerY,
        score: Math.abs(centerY - preferredCenterY) + sidePenalty + loadPenalty
      };
    })
    .filter((placement): placement is NonNullable<typeof placement> => Boolean(placement))
    .sort((first, second) => first.score - second.score);

  const placement = placements[0];
  if (!placement) return null;
  placement.lane.occupied.push({ top: placement.top, bottom: placement.top + candidate.height });
  placement.lane.occupied.sort((first, second) => first.top - second.top);
  return {
    centerX: placement.left + placement.width / 2,
    centerY: placement.centerY,
    width: placement.width
  };
}

function fitSpawnTrailTop(occupied: SpawnRect[], height: number, preferredTop: number, workspaceHeight: number): number | null {
  const minTop = SPAWN_EDGE_PADDING;
  const maxTop = workspaceHeight - SPAWN_EDGE_PADDING - SPAWN_SEARCH_CONTROL_CLEARANCE - height;
  if (maxTop < minTop) return null;
  const candidates = new Set<number>([clampNumber(preferredTop, minTop, maxTop), minTop, maxTop]);
  for (const rect of occupied) {
    candidates.add(clampNumber(rect.bottom + SPAWN_TRAIL_GAP, minTop, maxTop));
    candidates.add(clampNumber(rect.top - SPAWN_TRAIL_GAP - height, minTop, maxTop));
  }
  return (
    [...candidates]
      .sort((first, second) => Math.abs(first - preferredTop) - Math.abs(second - preferredTop))
      .find((top) => occupied.every((rect) => top + height + SPAWN_TRAIL_GAP <= rect.top || top >= rect.bottom + SPAWN_TRAIL_GAP)) ?? null
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function spawnTrailMatches(trail: EvidenceTrail, normalizedSearch: string): boolean {
  return [
    trail.hypothesis?.title,
    trail.hypothesis?.descriptionMarkdown,
    trail.hypothesis?.state,
    ...trail.evidence.flatMap((item) => [item.summary, item.kind]),
    ...trail.findings.flatMap((finding) => [finding.title, finding.summaryMarkdown, finding.state])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(normalizedSearch);
}

function normalizeSpawnSearch(value: string): string {
  return value.trim().toLowerCase();
}

function spawnThoughtSegmentsFromText(text: string): SpawnThoughtSegment[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [{ title: null, description: 'Awaiting the next agent thought.' }];
  const parsed = reasoningTraceThoughtsFromText(normalized).map((thought, index, thoughts) => {
    const title = normalizeSpawnThoughtTitle(thought.title);
    const maxDescriptionLength = thoughts.length > 1 ? 280 : 620;
    return {
      title,
      description: truncateText(normalizeSpawnThoughtDescription(thought.description), maxDescriptionLength)
    };
  });
  return parsed.length > 0 ? parsed : [{ title: null, description: truncateText(normalized, 620) }];
}

function normalizeSpawnThoughtTitle(title: string | null): string | null {
  if (!title) return null;
  const normalized = title.replace(/\s+/g, ' ').trim().replace(/[.!?]\s*$/, '');
  return normalized ? capitalizeSpawnThoughtTitle(normalized) : null;
}

function normalizeSpawnThoughtDescription(description: string): string {
  return description.replace(/\s+/g, ' ').trim().replace(/^[.!?]\s+/, '');
}

function capitalizeSpawnThoughtTitle(value: string): string {
  const pattern = /(`+)([^`\n]+?)\1/g;
  let result = '';
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const tokenIndex = match.index ?? 0;
    if (tokenIndex > lastIndex) result += capitalizeSpawnTitleWords(value.slice(lastIndex, tokenIndex));
    result += match[0];
    lastIndex = tokenIndex + match[0].length;
  }
  if (lastIndex < value.length) result += capitalizeSpawnTitleWords(value.slice(lastIndex));
  return result;
}

function capitalizeSpawnTitleWords(value: string): string {
  return value.replace(/\b([A-Za-z]{3,})\b/g, (word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`);
}

function estimateSpawnThoughtHeight(thoughts: SpawnThoughtSegment[]): number {
  const textLength = thoughts.reduce((total, thought) => total + (thought.title?.length ?? 12) + thought.description.length, 0);
  return Math.min(300, 76 + thoughts.length * 28 + Math.ceil(textLength / 118) * 16);
}

function renderSpawnInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`+)([^`\n]+?)\1/g;
  let lastIndex = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const tokenIndex = match.index ?? 0;
    if (tokenIndex > lastIndex) nodes.push(text.slice(lastIndex, tokenIndex));
    nodes.push(
      <code className="spawn-thought-code" key={`${keyPrefix}-${index}`}>
        {match[2] ?? ''}
      </code>
    );
    lastIndex = tokenIndex + match[0].length;
    index += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length > 0 ? nodes : [text];
}

function spawnNextSurfaceClass(surface: SpawnTrailSurface): string {
  return surface ? `spawn-next-${surface}` : 'spawn-next-none';
}

function superellipsePath(width: number, height: number, exponent: number, steps: number): string {
  const points: Array<[number, number]> = [];
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const power = 2 / exponent;
  for (let index = 0; index < steps; index += 1) {
    const theta = (Math.PI * 2 * index) / steps;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    points.push([halfWidth + halfWidth * Math.sign(cos) * Math.abs(cos) ** power, halfHeight + halfHeight * Math.sign(sin) * Math.abs(sin) ** power]);
  }
  return `M ${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;
}
