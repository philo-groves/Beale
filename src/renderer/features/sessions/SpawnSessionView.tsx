import { memo, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { Bug, ClipboardCheck, FileOutput, Search, X } from 'lucide-react';
import type { EvidenceRecord, FindingRecord, HypothesisRecord, RunDetail } from '@shared/types';
import {
  buildEvidenceTrails,
  traceEventForEvidence,
  traceEventForFinding,
  traceEventForHypothesis,
  type EvidenceTrail
} from '../../view-models/researchItems';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { reasoningTraceThoughtsFromText } from '../../view-models/traceContent';
import { formatPriorityPill, formatSessionTime, stateClass, traceLabel, truncateText } from '../../lib/formatting';

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

type SpawnTrailSurface = 'evidence' | 'finding' | null;

const SPAWN_SLOT_POSITIONS: Array<[number, number]> = [
  [-31, -21],
  [31, -21],
  [-35, 17],
  [35, 17],
  [0, -34],
  [0, 34],
  [-46, -4],
  [46, -4],
  [-20, 36],
  [20, 36],
  [-20, -38],
  [20, -38]
];

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const trails = useMemo(() => (detail ? buildEvidenceTrails(detail.hypotheses, detail.findings, detail.evidence) : []), [detail]);
  const latestThought = useMemo(() => latestAgentThought(events), [events]);
  const [visibleThought, setVisibleThought] = useState<SpawnThought>(latestThought);
  const [thoughtPhase, setThoughtPhase] = useState<'enter' | 'exit'>('enter');
  const normalizedSearch = normalizeSpawnSearch(searchQuery);
  const displayedTrails = useMemo(() => spawnTrailLayouts(trails, normalizedSearch), [normalizedSearch, trails]);
  const hiddenCount = Math.max(0, trails.length - displayedTrails.length);
  const artifactById = useMemo(() => new Map((detail?.artifacts ?? []).map((artifact) => [artifact.id, artifact])), [detail?.artifacts]);
  const verifierRunById = useMemo(() => new Map((detail?.verifierRuns ?? []).map((run) => [run.id, run])), [detail?.verifierRuns]);

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
    <div className="spawn-session-workspace" aria-label="Spawn view">
      <div className="spawn-trail-field" aria-hidden={displayedTrails.length === 0}>
        {displayedTrails.map((layout) => (
          <SpawnTrail
            artifactById={artifactById}
            events={events}
            key={layout.trail.id}
            layout={layout}
            selectedTraceEventId={selectedTraceEventId}
            verifierRunById={verifierRunById}
            onSelectTraceEvent={onSelectTraceEvent}
          />
        ))}
      </div>

      <section className="spawn-core" aria-label="Latest agent thought" style={{ '--spawn-core-min-height': `${Math.max(176, visibleThought.estimatedHeight)}px` } as CSSProperties}>
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
    </div>
  );
});

function SpawnTrail({
  artifactById,
  events,
  layout,
  selectedTraceEventId,
  verifierRunById,
  onSelectTraceEvent
}: {
  artifactById: Map<string, RunDetail['artifacts'][number]>;
  events: TraceDisplayEvent[];
  layout: SpawnTrailLayout;
  selectedTraceEventId: string | null;
  verifierRunById: Map<string, RunDetail['verifierRuns'][number]>;
  onSelectTraceEvent: (event: TraceDisplayEvent) => void;
}): JSX.Element {
  const evidenceCount = layout.trail.evidence.length;
  const findingCount = layout.trail.findings.length;
  const standaloneEvidence = !layout.trail.hypothesis && evidenceCount > 0 && findingCount === 0;
  const firstExtensionSurface: SpawnTrailSurface = evidenceCount > 0 ? 'evidence' : findingCount > 0 ? 'finding' : null;

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
            {layout.trail.evidence.map((item, index) => (
              <SpawnEvidenceNode
                artifactKind={item.artifactId ? artifactById.get(item.artifactId)?.kind ?? null : null}
                evidence={item}
                event={traceEventForEvidence(events, item)}
                key={item.id}
                nextSurface={index < evidenceCount - 1 ? 'evidence' : findingCount > 0 ? 'finding' : null}
                selectedTraceEventId={selectedTraceEventId}
                verifierStatus={item.verifierRunId ? verifierRunById.get(item.verifierRunId)?.status ?? null : null}
                onSelectTraceEvent={onSelectTraceEvent}
              />
            ))}
            {layout.trail.findings.map((finding, index) => (
              <SpawnFindingNode
                events={events}
                finding={finding}
                hypothesis={layout.trail.hypothesis}
                key={finding.id}
                nextSurface={index < findingCount - 1 ? 'finding' : null}
                selectedTraceEventId={selectedTraceEventId}
                onSelectTraceEvent={onSelectTraceEvent}
              />
            ))}
          </div>
        )}
      </div>
    </article>
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

function SquircleBackdrop({ className }: { className: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 560 320" preserveAspectRatio="none" aria-hidden="true">
      <path d={superellipsePath(560, 320, 4, 96)} />
    </svg>
  );
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

function spawnTrailLayouts(trails: EvidenceTrail[], normalizedSearch: string): SpawnTrailLayout[] {
  const filtered = normalizedSearch ? trails.filter((trail) => spawnTrailMatches(trail, normalizedSearch)) : trails.slice(0, SPAWN_SLOT_POSITIONS.length);
  return filtered.slice(0, normalizedSearch ? 18 : SPAWN_SLOT_POSITIONS.length).map((trail, index) => {
    const [x, y] = SPAWN_SLOT_POSITIONS[index % SPAWN_SLOT_POSITIONS.length];
    const itemCount = Math.max(1, trail.evidence.length + trail.findings.length + (trail.hypothesis ? 1 : 0));
    return {
      trail,
      x: `${x}%`,
      y: `${y}%`,
      delayMs: Math.min(520, index * 70),
      width: normalizedSearch ? 280 : itemCount > 3 ? 278 : 248,
      estimateHeight: Math.max(156, 86 + itemCount * 54)
    };
  });
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
  return normalized || null;
}

function normalizeSpawnThoughtDescription(description: string): string {
  return description.replace(/\s+/g, ' ').trim().replace(/^[.!?]\s+/, '');
}

function estimateSpawnThoughtHeight(thoughts: SpawnThoughtSegment[]): number {
  const textLength = thoughts.reduce((total, thought) => total + (thought.title?.length ?? 12) + thought.description.length, 0);
  return Math.min(360, 132 + thoughts.length * 34 + Math.ceil(textLength / 104) * 18);
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
