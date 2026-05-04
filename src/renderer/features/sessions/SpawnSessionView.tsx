import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { Bug, ClipboardCheck, FileOutput, Search, X } from 'lucide-react';
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
import {
  codeBrowserTracePreview,
  pythonToolCallPreview,
  pythonTracePreview,
  reasoningTraceThoughtsFromText,
  searchTracePreview,
  type CodeBrowserTracePreview,
  type PythonToolCallPreview,
  type SearchTracePreview
} from '../../view-models/traceContent';
import { formatPriorityPill, formatSessionTime, stateClass, traceLabel, truncateText } from '../../lib/formatting';
import { codeBlockLineRows, highlightPythonCode, type CodeBlockLineNumberMode } from '../traces/traceMarkup';

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
  kind: 'python';
  id: string;
  event: TraceDisplayEvent;
  codeEvent: TraceDisplayEvent;
  resultEvent: TraceDisplayEvent | null;
  preview: PythonToolCallPreview;
}

interface SpawnCodeBrowserPreview {
  kind: 'code_browser';
  id: string;
  event: TraceDisplayEvent;
  preview: CodeBrowserTracePreview;
}

interface SpawnSearchPreview {
  kind: 'search';
  id: string;
  event: TraceDisplayEvent;
  preview: SearchTracePreview;
}

type SpawnSecondaryPreview = SpawnPythonPreview | SpawnCodeBrowserPreview | SpawnSearchPreview;
type SpawnSecondaryPhase = 'enter' | 'exit';

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
const SPAWN_SECONDARY_MIN_DWELL_MS = 1800;
const SPAWN_SECONDARY_EXIT_MS = 180;
const SPAWN_CODE_PREVIEW_LINE_LIMIT = 24;
const SPAWN_HYPOTHESIS_HIGH_STATE_CLASSES = new Set(['verified', 'promoted', 'reproduced', 'reportable', 'disclosure_ready', 'disclosure-ready']);
const SPAWN_FINDING_HIGH_STATE_CLASSES = new Set(['reportable', 'verified', 'disclosure_ready', 'disclosure-ready']);
const SPAWN_HYPOTHESIS_MEDIUM_STATE_CLASSES = new Set(['needs_evidence', 'needs-evidence', 'inconclusive', 'open']);
const SPAWN_FINDING_MEDIUM_STATE_CLASSES = new Set(['needs_evidence', 'needs-evidence', 'inconclusive', 'open', 'reproduced']);
const SPAWN_DISMISSED_STATE_CLASSES = new Set(['false_positive', 'false-positive', 'out_of_scope', 'out-of-scope', 'dismissed', 'duplicate']);

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
  const latestSecondary = useMemo(() => latestSpawnSecondaryPreview(events, detail), [detail, events]);
  const [visibleThought, setVisibleThought] = useState<SpawnThought>(latestThought);
  const [thoughtPhase, setThoughtPhase] = useState<'enter' | 'exit'>('enter');
  const [visibleSecondary, setVisibleSecondary] = useState<SpawnSecondaryPreview | null>(latestSecondary);
  const [secondaryPhase, setSecondaryPhase] = useState<SpawnSecondaryPhase>('enter');
  const secondaryShownAtRef = useRef(Date.now());
  const pendingSecondaryRef = useRef<SpawnSecondaryPreview | null>(latestSecondary);
  const normalizedSearch = normalizeSpawnSearch(searchQuery);
  const layoutMetrics = useMemo(() => spawnLayoutMetrics(trails, normalizedSearch, workspaceSize), [normalizedSearch, trails, workspaceSize]);
  const displayedTrails = useMemo(() => spawnTrailLayouts(trails, normalizedSearch, layoutMetrics), [layoutMetrics, normalizedSearch, trails]);
  const hiddenCount = Math.max(0, trails.length - displayedTrails.length);
  const expandedTrail = expandedTrailId ? trails.find((trail) => trail.id === expandedTrailId) ?? null : null;
  const artifactById = useMemo(() => new Map((detail?.artifacts ?? []).map((artifact) => [artifact.id, artifact])), [detail?.artifacts]);
  const verifierRunById = useMemo(() => new Map((detail?.verifierRuns ?? []).map((run) => [run.id, run])), [detail?.verifierRuns]);
  const coreMinHeight = Math.max(136, visibleThought.estimatedHeight);

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

  useEffect(() => {
    if (sameSpawnSecondaryPreview(latestSecondary, visibleSecondary)) {
      if (latestSecondary && latestSecondary !== visibleSecondary) {
        setVisibleSecondary(latestSecondary);
        secondaryShownAtRef.current = Date.now();
      }
      return undefined;
    }

    pendingSecondaryRef.current = latestSecondary;
    const elapsedMs = Date.now() - secondaryShownAtRef.current;
    const dwellDelayMs = visibleSecondary ? Math.max(0, SPAWN_SECONDARY_MIN_DWELL_MS - elapsedMs) : 0;
    let exitTimeout = 0;
    const dwellTimeout = window.setTimeout(() => {
      setSecondaryPhase('exit');
      exitTimeout = window.setTimeout(() => {
        setVisibleSecondary(pendingSecondaryRef.current);
        secondaryShownAtRef.current = Date.now();
        setSecondaryPhase('enter');
      }, SPAWN_SECONDARY_EXIT_MS);
    }, dwellDelayMs);

    return () => {
      window.clearTimeout(dwellTimeout);
      if (exitTimeout !== 0) window.clearTimeout(exitTimeout);
    };
  }, [latestSecondary, visibleSecondary]);

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

      <div
        className="spawn-center-stack"
        style={
          {
            '--spawn-center-width': `${layoutMetrics.centerWidth}px`,
            '--spawn-core-min-height': `${coreMinHeight}px`,
            '--spawn-workspace-height': `${layoutMetrics.workspaceHeight}px`
          } as CSSProperties
        }
      >
        <section className="spawn-core" aria-label="Latest agent thought">
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
        {visibleSecondary ? (
          <SpawnSecondaryChain
            key={visibleSecondary.id}
            phase={secondaryPhase}
            secondary={visibleSecondary}
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
  const firstExtensionItem = spawnTrailFirstContentItem(listItems);
  const firstExtensionSurface = spawnTrailItemSurface(firstExtensionItem);
  const firstExtensionSurfaceValue = spawnTrailItemSurfaceCssValue(firstExtensionItem);
  const hypothesisStateClass = layout.trail.hypothesis ? stateClass(layout.trail.hypothesis.state) : null;
  const dismissedClass = hypothesisStateClass && SPAWN_DISMISSED_STATE_CLASSES.has(hypothesisStateClass) ? 'dismissed' : '';

  return (
    <article
      className={`spawn-trail ${hypothesisStateClass ? `state-${hypothesisStateClass}` : ''} ${dismissedClass}`}
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
            nextSurfaceValue={firstExtensionSurfaceValue}
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
            {listItems.map((item, index) => {
              const nextItem = listItems[index + 1] ?? null;
              return (
                <SpawnTrailListItemNode
                  artifactById={artifactById}
                  events={events}
                  item={item}
                  key={spawnTrailListItemKey(item)}
                  nextSurface={spawnTrailItemSurface(nextItem)}
                  nextSurfaceValue={spawnTrailItemSurfaceCssValue(nextItem)}
                  selectedTraceEventId={selectedTraceEventId}
                  trail={layout.trail}
                  verifierRunById={verifierRunById}
                  onOpenFullTrail={onOpenFullTrail}
                  onSelectTraceEvent={onSelectTraceEvent}
                />
              );
            })}
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
  nextSurfaceValue,
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
  nextSurfaceValue: string;
  selectedTraceEventId: string | null;
  trail: EvidenceTrail;
  verifierRunById: Map<string, RunDetail['verifierRuns'][number]>;
  onOpenFullTrail: (trailId: string) => void;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  if (item.kind === 'overflow') {
    return <SpawnTrailOverflowNode hiddenCount={item.hiddenCount} nextSurface={nextSurface} nextSurfaceValue={nextSurfaceValue} onOpen={() => onOpenFullTrail(trail.id)} />;
  }
  if (item.kind === 'evidence') {
    const evidence = item.evidence;
    return (
      <SpawnEvidenceNode
        artifactKind={evidence.artifactId ? artifactById.get(evidence.artifactId)?.kind ?? null : null}
        evidence={evidence}
        event={traceEventForEvidence(events, evidence)}
        nextSurface={nextSurface}
        nextSurfaceValue={nextSurfaceValue}
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
      nextSurfaceValue={nextSurfaceValue}
      selectedTraceEventId={selectedTraceEventId}
      onSelectTraceEvent={onSelectTraceEvent}
    />
  );
}

function SpawnHypothesisNode({
  events,
  hypothesis,
  nextSurface,
  nextSurfaceValue,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  events: TraceDisplayEvent[];
  hypothesis: HypothesisRecord;
  nextSurface: SpawnTrailSurface;
  nextSurfaceValue: string;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const event = traceEventForHypothesis(events, hypothesis);
  const disabled = !event;
  return (
    <button
      type="button"
      className={`spawn-trail-hypothesis ${spawnNextSurfaceClass(nextSurface)} state-${stateClass(hypothesis.state)} ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      style={
        {
          '--spawn-next-surface': nextSurfaceValue,
          '--spawn-squircle-surface': spawnHypothesisStateSurfaceCssValue(hypothesis.state)
        } as CSSProperties
      }
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

function SpawnTrailOverflowNode({
  hiddenCount,
  nextSurface,
  nextSurfaceValue,
  onOpen
}: {
  hiddenCount: number;
  nextSurface: SpawnTrailSurface;
  nextSurfaceValue: string;
  onOpen: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`spawn-trail-extension spawn-trail-overflow ${spawnNextSurfaceClass(nextSurface)}`}
      style={{ '--spawn-next-surface': nextSurfaceValue } as CSSProperties}
      onClick={onOpen}
    >
      <strong>{`Show ${hiddenCount} More Artifact${hiddenCount === 1 ? '' : 's'}`}</strong>
    </button>
  );
}

function SpawnFindingNode({
  events,
  finding,
  hypothesis,
  nextSurface,
  nextSurfaceValue,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  events: TraceDisplayEvent[];
  finding: FindingRecord;
  hypothesis: HypothesisRecord | null;
  nextSurface: SpawnTrailSurface;
  nextSurfaceValue: string;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const event = traceEventForFinding(events, finding, hypothesis);
  const disabled = !event;
  return (
    <button
      type="button"
      className={`spawn-trail-extension spawn-trail-finding ${spawnNextSurfaceClass(nextSurface)} state-${stateClass(finding.state)} ${event?.id === selectedTraceEventId ? 'selected' : ''}`}
      style={{ '--spawn-next-surface': nextSurfaceValue } as CSSProperties}
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
  nextSurfaceValue,
  selectedTraceEventId,
  verifierStatus,
  onSelectTraceEvent
}: {
  artifactKind: string | null;
  evidence: EvidenceRecord;
  event: TraceDisplayEvent | null;
  nextSurface: SpawnTrailSurface;
  nextSurfaceValue: string;
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
      style={{ '--spawn-next-surface': nextSurfaceValue } as CSSProperties}
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

function SpawnSecondaryChain({
  phase,
  secondary,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  phase: SpawnSecondaryPhase;
  secondary: SpawnSecondaryPreview;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  if (secondary.kind === 'python') {
    return <SpawnPythonChain phase={phase} python={secondary} selectedTraceEventId={selectedTraceEventId} onSelectTraceEvent={onSelectTraceEvent} />;
  }
  if (secondary.kind === 'code_browser') {
    return <SpawnCodeBrowserChain phase={phase} read={secondary} selectedTraceEventId={selectedTraceEventId} onSelectTraceEvent={onSelectTraceEvent} />;
  }
  return <SpawnSearchChain phase={phase} search={secondary} selectedTraceEventId={selectedTraceEventId} onSelectTraceEvent={onSelectTraceEvent} />;
}

function SpawnPythonChain({
  phase,
  python,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  phase: SpawnSecondaryPhase;
  python: SpawnPythonPreview;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const resultEvent = python.resultEvent;
  const exitCode = python.preview.exitCode ?? '?';
  const statusClass = resultEvent ? (exitCode === '0' ? 'success' : 'review') : 'running';
  const statusEvent = resultEvent ?? python.codeEvent;
  const statusLabel = resultEvent ? `Exit ${exitCode}` : 'Running...';
  const hasOutput = Boolean(resultEvent && hasRecordedPythonOutput(python.preview));
  return (
    <div className={`spawn-python-chain spawn-secondary-chain ${phase}`} aria-label="Latest Python execution">
      <button
        type="button"
        className={`spawn-python-node spawn-python-code-node ${python.codeEvent.id === selectedTraceEventId ? 'selected' : ''}`}
        onClick={() => onSelectTraceEvent(python.codeEvent)}
      >
        <span className="spawn-python-shape" aria-hidden="true" />
        <div className="spawn-python-content">
          {python.preview.task ? <p className="spawn-python-task">{python.preview.task}</p> : null}
          <SpawnPythonBlock
            label="Code"
            language="python"
            lines={python.preview.scriptLines}
            lineCount={python.preview.scriptLineCount}
            truncated={python.preview.truncated}
          />
        </div>
      </button>
      <button
        type="button"
        className={`spawn-python-result-node ${statusClass} ${hasOutput ? 'has-output' : ''} ${statusEvent.id === selectedTraceEventId ? 'selected' : ''}`}
        onClick={() => onSelectTraceEvent(statusEvent)}
      >
        <SquircleBackdrop className="spawn-python-result-shape" />
        <div className="spawn-python-result-content">
          {hasOutput ? (
            <SpawnPythonBlock
              label="Output"
              lines={python.preview.outputLines}
              lineCount={python.preview.outputLineCount}
              truncated={python.preview.outputTruncated}
            />
          ) : null}
          <span className="spawn-python-result-label">{statusLabel}</span>
        </div>
      </button>
    </div>
  );
}

function SpawnCodeBrowserChain({
  phase,
  read,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  phase: SpawnSecondaryPhase;
  read: SpawnCodeBrowserPreview;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  return (
    <div className={`spawn-python-chain spawn-secondary-chain spawn-secondary-read-chain ${phase}`} aria-label="Latest file read">
      <button
        type="button"
        className={`spawn-python-node spawn-secondary-node ${read.event.id === selectedTraceEventId ? 'selected' : ''}`}
        onClick={() => onSelectTraceEvent(read.event)}
      >
        <span className="spawn-python-shape" aria-hidden="true" />
        <div className="spawn-python-content spawn-secondary-content">
          <SpawnSecondarySummary eyebrow="File read" title={read.preview.title} description={read.preview.description} facts={read.preview.facts} />
          <SpawnPythonBlock
            label="Excerpt"
            lines={read.preview.excerptLines}
            lineCount={read.preview.excerptLineCount}
            lineNumberMode="source-prefix"
            truncated={read.preview.excerptTruncated}
          />
        </div>
      </button>
    </div>
  );
}

function SpawnSearchChain({
  phase,
  search,
  selectedTraceEventId,
  onSelectTraceEvent
}: {
  phase: SpawnSecondaryPhase;
  search: SpawnSearchPreview;
  selectedTraceEventId: string | null;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  return (
    <div className={`spawn-python-chain spawn-secondary-chain spawn-secondary-search-chain ${phase}`} aria-label="Latest search">
      <button
        type="button"
        className={`spawn-python-node spawn-secondary-node spawn-secondary-search-node ${search.event.id === selectedTraceEventId ? 'selected' : ''}`}
        onClick={() => onSelectTraceEvent(search.event)}
      >
        <span className="spawn-python-shape" aria-hidden="true" />
        <div className="spawn-python-content spawn-secondary-content">
          <SpawnSecondarySummary eyebrow="Search" title={search.preview.title} description={search.preview.description} facts={search.preview.facts} />
        </div>
      </button>
    </div>
  );
}

function SpawnSecondarySummary({ eyebrow, title, description, facts }: { eyebrow: string; title: string; description: string; facts: string[] }): JSX.Element {
  return (
    <div className="spawn-secondary-summary">
      <span className="spawn-secondary-eyebrow">{eyebrow}</span>
      <strong className="spawn-secondary-title">{title}</strong>
      {description ? <p className="spawn-secondary-description">{description}</p> : null}
      {facts.length > 0 ? (
        <div className="spawn-secondary-facts">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SpawnPythonBlock({
  label,
  language,
  lineCount,
  lineNumberMode = 'generated',
  lines,
  meta,
  truncated
}: {
  label: string;
  language?: 'python';
  lineCount: number;
  lineNumberMode?: CodeBlockLineNumberMode;
  lines: string[];
  meta?: string;
  truncated: boolean;
}): JSX.Element | null {
  if (lines.length === 0) return null;
  const lineLabel = meta ?? `${lineCount} line${lineCount === 1 ? '' : 's'}`;
  const rows = codeBlockLineRows(lines, lineNumberMode);
  const text = rows.codeLines.join('\n');
  return (
    <div className="spawn-python-block">
      <div className="spawn-python-heading">
        <span>{label}</span>
        <span>{lineLabel}</span>
      </div>
      <pre className={truncated ? 'is-truncated' : undefined}>
        <span className="code-line-gutter" aria-hidden="true">
          {rows.lineNumbers.map((lineNumber, index) => (
            <span data-line={lineNumber} key={`${lineNumber}-${index}`} />
          ))}
        </span>
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

function latestSpawnSecondaryPreview(events: TraceDisplayEvent[], detail: RunDetail | null): SpawnSecondaryPreview | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;

    const python = spawnPythonPreviewForEvent(events, event, detail);
    if (python) return python;

    if (event.type !== 'tool_result' && event.type !== 'artifact_created') continue;

    const codeBrowser = codeBrowserTracePreview(event, SPAWN_CODE_PREVIEW_LINE_LIMIT);
    if (codeBrowser) {
      return {
        kind: 'code_browser',
        id: `code_browser:${event.id}`,
        event,
        preview: codeBrowser
      };
    }

    const search = searchTracePreview(event);
    if (search) {
      return {
        kind: 'search',
        id: `search:${event.id}`,
        event,
        preview: search
      };
    }
  }
  return null;
}

function spawnPythonPreviewForEvent(events: TraceDisplayEvent[], event: TraceDisplayEvent, detail: RunDetail | null): SpawnPythonPreview | null {
  const resultPreview = pythonTracePreview(event, detail, SPAWN_CODE_PREVIEW_LINE_LIMIT);
  if (resultPreview && (resultPreview.scriptLines.length > 0 || resultPreview.outputLines.length > 0)) {
    const codeEvent = pythonCodeEventForResult(events, event) ?? event;
    return {
      kind: 'python',
      id: spawnPythonPreviewId(codeEvent, event),
      event,
      codeEvent,
      resultEvent: event,
      preview: resultPreview
    };
  }

  const codePreview = pythonToolCallPreview(event, SPAWN_CODE_PREVIEW_LINE_LIMIT);
  if (codePreview && (codePreview.scriptLines.length > 0 || codePreview.task)) {
    const resultEvent = pythonResultEventForCall(events, event, detail);
    const preview = resultEvent ? pythonTracePreview(resultEvent, detail, SPAWN_CODE_PREVIEW_LINE_LIMIT) ?? codePreview : codePreview;
    return {
      kind: 'python',
      id: spawnPythonPreviewId(event, resultEvent),
      event: resultEvent ?? event,
      codeEvent: event,
      resultEvent,
      preview
    };
  }

  return null;
}

function hasRecordedPythonOutput(preview: PythonToolCallPreview): boolean {
  return preview.outputLines.some((line) => line.trim() && line !== 'No output recorded.');
}

function spawnPythonPreviewId(codeEvent: TraceDisplayEvent, resultEvent: TraceDisplayEvent | null): string {
  return `python:${codeEvent.toolCallId ?? resultEvent?.toolCallId ?? codeEvent.id}`;
}

function sameSpawnSecondaryPreview(left: SpawnSecondaryPreview | null, right: SpawnSecondaryPreview | null): boolean {
  if (!left || !right) return left === right;
  return left.kind === right.kind && left.id === right.id;
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

function spawnTrailFirstContentItem(items: SpawnTrailListItem[]): SpawnTrailListItem | null {
  return items.find((item) => item.kind !== 'overflow') ?? null;
}

function spawnTrailItemSurfaceCssValue(item: SpawnTrailListItem | null): string {
  if (!item) return 'transparent';
  if (item.kind === 'evidence') return 'var(--spawn-evidence-surface)';
  if (item.kind === 'finding') return spawnFindingStateSurfaceCssValue(item.finding.state);
  return 'var(--spawn-overflow-surface)';
}

function spawnFindingStateSurfaceCssValue(state: string): string {
  const normalizedState = stateClass(state);
  if (SPAWN_FINDING_HIGH_STATE_CLASSES.has(normalizedState)) return 'var(--spawn-state-high-surface)';
  if (SPAWN_FINDING_MEDIUM_STATE_CLASSES.has(normalizedState)) return 'var(--spawn-state-medium-surface)';
  if (SPAWN_DISMISSED_STATE_CLASSES.has(normalizedState)) return 'var(--spawn-state-dismissed-surface)';
  return 'var(--spawn-finding-surface)';
}

function spawnHypothesisStateSurfaceCssValue(state: string): string {
  const normalizedState = stateClass(state);
  if (SPAWN_HYPOTHESIS_HIGH_STATE_CLASSES.has(normalizedState)) return 'var(--spawn-state-high-surface)';
  if (SPAWN_HYPOTHESIS_MEDIUM_STATE_CLASSES.has(normalizedState)) return 'var(--spawn-state-medium-surface)';
  if (SPAWN_DISMISSED_STATE_CLASSES.has(normalizedState)) return 'var(--spawn-state-dismissed-surface)';
  return 'var(--spawn-hypothesis-surface)';
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
