import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, BookOpen, CircleAlert, CircleCheck, Clock3, LoaderCircle, Play } from 'lucide-react';
import type {
  HoneycrispRunbookCell,
  HoneycrispRunbookDocument,
  HoneycrispRunbookOutput,
  HoneycrispRunbookSummary,
  RunbookExecutionSelection,
  RunbookProofTarget,
  RunbookProofTargetSelection
} from '@shared/types';
import { traceLabel } from '../../lib/formatting';
import { ModelAuthors } from '../../app/ModelAuthors';
import { runbookDescriptionText } from '../../view-models/runbooks';
import { renderHighlightedCodeBlock, renderTraceProseText } from '../traces/traceMarkup';

export const RunbookView = memo(function RunbookView({
  runbook,
  document,
  loading,
  error,
  onBackToMain,
  onRun,
  executionAvailable = false,
  connectedDeviceOs = null,
  showBackButton = true,
  followLatest = false
}: {
  runbook: HoneycrispRunbookSummary;
  document: HoneycrispRunbookDocument | null;
  loading: boolean;
  error: string | null;
  onBackToMain: () => void;
  onRun?: (selection: RunbookExecutionSelection, target: RunbookProofTargetSelection) => Promise<void>;
  executionAvailable?: boolean;
  connectedDeviceOs?: string | null;
  showBackButton?: boolean;
  followLatest?: boolean;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const runbookIdRef = useRef(runbook.id);
  const [requestedCellId, setRequestedCellId] = useState<string | null | undefined>(undefined);
  const [proofTarget, setProofTarget] = useState<RunbookProofTarget>('localhost');
  const [deviceOs, setDeviceOs] = useState('');
  const [rangeStartCellId, setRangeStartCellId] = useState('');
  const [rangeEndCellId, setRangeEndCellId] = useState('');
  const executionRunning = document?.latestRun?.status === 'running';
  const executableCellOptions = document?.cells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.type === 'code') ?? [];
  const executableCells = executableCellOptions.map(({ cell }) => cell);
  const unhealthyCells = executableCells.filter((cell) => !isSupportedRunbookLanguage(cell.language));
  const rangeStartIndex = rangeStartCellId
    ? executableCells.findIndex((cell) => cell.id === rangeStartCellId)
    : 0;
  const rangeEndIndex = rangeEndCellId
    ? executableCells.findIndex((cell) => cell.id === rangeEndCellId)
    : executableCells.length - 1;
  const rangeValid = executableCells.length > 0 && rangeStartIndex >= 0
    && rangeEndIndex >= 0 && rangeStartIndex <= rangeEndIndex;
  const selectedRangeCells = rangeValid ? executableCells.slice(rangeStartIndex, rangeEndIndex + 1) : [];
  const selectedRangeHealthy = selectedRangeCells.every((cell) => isSupportedRunbookLanguage(cell.language));
  const targetValid = proofTarget !== 'device' || deviceOs.trim().length > 0;
  const canRun = executionAvailable && Boolean(onRun) && rangeValid && selectedRangeHealthy
    && targetValid && !executionRunning && requestedCellId === undefined;
  const updateKey = useMemo(
    () => runbookViewUpdateKey(runbook, document, loading, error),
    [document, error, loading, runbook]
  );

  useEffect(() => {
    if (executionRunning) setRequestedCellId(undefined);
  }, [document?.latestRun?.runId, executionRunning]);

  useEffect(() => {
    if (proofTarget === 'device' && !deviceOs.trim() && connectedDeviceOs) setDeviceOs(connectedDeviceOs);
  }, [connectedDeviceOs, deviceOs, proofTarget]);

  useEffect(() => {
    setRangeStartCellId('');
    setRangeEndCellId('');
  }, [runbook.id]);

  const requestExecution = useCallback(async (selection: RunbookExecutionSelection = {}): Promise<void> => {
    if (!onRun) return;
    setRequestedCellId(selection.cellId ?? null);
    try {
      await onRun(selection, {
        proofTarget,
        ...(proofTarget === 'device' ? { deviceOs: deviceOs.trim() } : {})
      });
    } catch {
      setRequestedCellId(undefined);
      return;
    }
    setRequestedCellId(undefined);
  }, [deviceOs, onRun, proofTarget]);

  const scrollToLatest = useCallback((): void => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  }, []);

  const syncScroll = useCallback((): void => {
    if (followLatest && followLatestRef.current) scrollToLatest();
  }, [followLatest, scrollToLatest]);

  useLayoutEffect(() => {
    if (runbookIdRef.current !== runbook.id) {
      runbookIdRef.current = runbook.id;
      followLatestRef.current = true;
    }
    const frame = window.requestAnimationFrame(syncScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [runbook.id, syncScroll, updateKey]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(syncScroll);
    observer.observe(scroll);
    Array.from(scroll.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [syncScroll, updateKey]);

  const handleScroll = useCallback((): void => {
    const scroll = scrollRef.current;
    if (!followLatest || !scroll) return;
    const distanceFromBottom = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
    followLatestRef.current = distanceFromBottom <= 24;
  }, [followLatest]);

  return (
    <section className="main-trace-view runbook-view" aria-label={`Runbook: ${runbook.title}`}>
      {showBackButton ? (
        <button type="button" className="back-to-main-button trace-back-to-main-button" onClick={onBackToMain}>
          <ArrowLeft size={15} aria-hidden="true" />
          Back to Main
        </button>
      ) : null}
      <div className="runbook-view-scroll" ref={scrollRef} onScroll={handleScroll}>
        <header className="runbook-view-header">
          <div className="runbook-view-heading-row">
            <span className="runbook-view-eyebrow"><BookOpen size={15} aria-hidden="true" /> Runbook</span>
            <div className="runbook-run-controls">
              <label className="runbook-target-field">
                <span>Proof target</span>
                <select
                  aria-label="Proof target"
                  disabled={executionRunning || requestedCellId !== undefined}
                  value={proofTarget}
                  onChange={(event) => setProofTarget(event.currentTarget.value as RunbookProofTarget)}
                >
                  <option value="localhost">Localhost</option>
                  <option value="device">Device</option>
                  <option value="vm">VM</option>
                  <option value="web">Web</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {proofTarget === 'device' ? (
                <label className="runbook-target-field runbook-device-os-field">
                  <span>Device OS</span>
                  <input
                    aria-label="Target device OS"
                    disabled={executionRunning || requestedCellId !== undefined}
                    maxLength={120}
                    placeholder="iOS 27.0"
                    value={deviceOs}
                    onChange={(event) => setDeviceOs(event.currentTarget.value)}
                  />
                </label>
              ) : null}
              {executableCellOptions.length > 1 ? (
                <>
                  <label className="runbook-target-field runbook-range-field">
                    <span>Start</span>
                    <select
                      aria-label="Runbook range start"
                      disabled={executionRunning || requestedCellId !== undefined}
                      value={rangeStartCellId}
                      onChange={(event) => setRangeStartCellId(event.currentTarget.value)}
                    >
                      <option value="">First code cell</option>
                      {executableCellOptions.map(({ cell, index }) => (
                        <option key={`start-${cell.id}`} value={cell.id}>Cell {index + 1}</option>
                      ))}
                    </select>
                  </label>
                  <label className="runbook-target-field runbook-range-field">
                    <span>End</span>
                    <select
                      aria-label="Runbook range end"
                      disabled={executionRunning || requestedCellId !== undefined}
                      value={rangeEndCellId}
                      onChange={(event) => setRangeEndCellId(event.currentTarget.value)}
                    >
                      <option value="">Last code cell</option>
                      {executableCellOptions.map(({ cell, index }) => (
                        <option key={`end-${cell.id}`} value={cell.id}>Cell {index + 1}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <button
                type="button"
                className="runbook-run-button"
                disabled={!canRun}
                title={!executionAvailable ? 'Runbooks execute only in their active Honeycrisp session.' : !rangeValid ? 'Choose a start cell that precedes the end cell.' : !selectedRangeHealthy ? 'Every selected code cell needs a supported language.' : !targetValid ? 'Enter the target device OS.' : undefined}
                onClick={() => void requestExecution({
                  ...(rangeStartCellId ? { startCellId: rangeStartCellId } : {}),
                  ...(rangeEndCellId ? { endCellId: rangeEndCellId } : {})
                })}
              >
                {executionRunning || requestedCellId === null ? <LoaderCircle className="runbook-view-spinner" size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                {executionRunning || requestedCellId === null ? 'Running' : rangeStartCellId || rangeEndCellId ? 'Run range' : 'Run'}
              </button>
            </div>
          </div>
          <h2>{runbook.title}</h2>
          <ModelAuthors authors={runbook.authors} />
          {runbook.purpose ? <p>{runbookDescriptionText(runbook.purpose)}</p> : null}
          <div className="runbook-view-meta">
            <span>{traceLabel(runbook.status)}</span>
            <span>Content revision {runbook.contentRevision}</span>
            <span>{runbook.execution.completedRunCount} completed {runbook.execution.completedRunCount === 1 ? 'run' : 'runs'}</span>
            <span>{runbook.execution.executedCellCount} {runbook.execution.executedCellCount === 1 ? 'cell' : 'cells'} executed</span>
            {runbook.execution.latest ? <span>Latest {traceLabel(runbook.execution.latest.status)}</span> : null}
            {document?.language ? <span>{document.language}</span> : null}
            {document?.latestRun ? <RunStatus state={document.latestRun} /> : null}
          </div>
          <div className={`runbook-guidance${unhealthyCells.length > 0 || executableCells.length === 0 ? ' needs-attention' : ''}`}>
            {unhealthyCells.length > 0 || executableCells.length === 0 ? <CircleAlert size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
            <span>{runbookGuidance(executableCells.length, unhealthyCells.length, executionAvailable)}</span>
          </div>
        </header>

        {loading ? (
          <div className="runbook-view-state"><LoaderCircle className="runbook-view-spinner" size={18} aria-hidden="true" /> Loading runbook.</div>
        ) : error ? (
          <div className="runbook-view-state is-error"><CircleAlert size={18} aria-hidden="true" /> {error}</div>
        ) : document && document.cells.length > 0 ? (
          <div className="runbook-cell-list">
            {document.cells.map((cell, index) => (
              <RunbookCellView
                cell={cell}
                executionAvailable={executionAvailable}
                executionRunning={executionRunning || requestedCellId !== undefined || !targetValid}
                index={index}
                key={`${cell.id}:${index}`}
                requested={requestedCellId === cell.id}
                onRun={onRun ? () => requestExecution({ cellId: cell.id }) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="runbook-view-state">This runbook has no cells.</div>
        )}
      </div>
    </section>
  );
});

export function runbookViewUpdateKey(
  runbook: HoneycrispRunbookSummary,
  document: HoneycrispRunbookDocument | null,
  loading: boolean,
  error: string | null
): string {
  const cells = document?.cells.map((cell) => [
    cell.id,
    cell.type,
    cell.source.length,
    cell.executionCount ?? '',
    cell.latestRun?.runId ?? '',
    cell.latestRun?.status ?? '',
    cell.latestRun?.durationMs ?? '',
    cell.latestRun?.proofTarget ?? '',
    cell.latestRun?.deviceOs ?? '',
    ...cell.outputs.flatMap((output) => [output.kind, output.streamName ?? '', output.mimeType ?? '', output.text.length])
  ].join(':')).join('|') ?? '';
  return `${runbook.id}:${document?.revision ?? runbook.revision}:${document?.latestRun?.status ?? ''}:${document?.latestRun?.proofTarget ?? ''}:${document?.latestRun?.deviceOs ?? ''}:${loading ? 'loading' : 'ready'}:${error ?? ''}:${cells}`;
}

function RunbookCellView({ cell, index, executionAvailable, executionRunning, requested, onRun }: {
  cell: HoneycrispRunbookCell;
  index: number;
  executionAvailable: boolean;
  executionRunning: boolean;
  requested: boolean;
  onRun?: () => Promise<void>;
}): JSX.Element {
  const supported = isSupportedRunbookLanguage(cell.language);
  const running = cell.latestRun?.status === 'running' || requested;
  return (
    <article className={`runbook-cell runbook-cell-${cell.type}`}>
      <header className="runbook-cell-header">
        <span>{cell.type === 'code' ? cell.language ?? 'Code' : traceLabel(cell.type)}</span>
        <span className="runbook-cell-header-actions">
          {cell.latestRun ? <RunStatus state={cell.latestRun} compact /> : null}
          <span>Cell {index + 1}{cell.executionCount === null ? '' : ` · [${cell.executionCount}]`}</span>
          {cell.type === 'code' ? (
            <button
              type="button"
              className="runbook-cell-run-button"
              disabled={!executionAvailable || executionRunning || !supported || !onRun}
              title={!supported ? 'Add a supported language before running this cell.' : 'Run this cell'}
              aria-label={`Run cell ${index + 1}`}
              onClick={() => void onRun?.()}
            >
              {running ? <LoaderCircle className="runbook-view-spinner" size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
              {running ? 'Running' : 'Run'}
            </button>
          ) : null}
        </span>
      </header>
      <div className="runbook-cell-content">
        {cell.type === 'markdown'
          ? renderTraceProseText(cell.source, 'agent_output')
          : cell.type === 'code'
            ? renderHighlightedCodeBlock(cell.source, cell.language)
            : <pre>{cell.source}</pre>}
      </div>
      {cell.outputs.length > 0 ? (
        <div className="runbook-output-list" aria-label={`Outputs for cell ${index + 1}`}>
          {cell.outputs.map((output, outputIndex) => (
            <RunbookOutputView key={`${cell.id}-output-${outputIndex}`} output={output} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function RunStatus({ state, compact = false }: {
  state: NonNullable<HoneycrispRunbookDocument['latestRun']>;
  compact?: boolean;
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== 'running') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.status, state.runId]);
  const startedAt = Date.parse(state.startedAt);
  const liveDuration = state.status === 'running' && Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null;
  const durationMs = state.durationMs ?? liveDuration;
  const duration = durationMs === null ? null : formatDuration(durationMs);
  const target = state.proofTarget === 'device' && state.deviceOs
    ? `Device · ${state.deviceOs}`
    : proofTargetLabel(state.proofTarget);
  return (
    <span className={`runbook-run-status status-${state.status}`} title={state.error ?? undefined}>
      {state.status === 'running' || state.status === 'queued'
        ? <LoaderCircle className="runbook-view-spinner" size={12} aria-hidden="true" />
        : <Clock3 size={12} aria-hidden="true" />}
      {compact ? traceLabel(state.status) : `Last run ${traceLabel(state.status)}`}{duration ? ` · ${duration}` : ''}{` · ${target}`}
    </span>
  );
}

function proofTargetLabel(target: RunbookProofTarget): string {
  return target === 'localhost' ? 'Localhost' : target === 'device' ? 'Device' : target === 'vm' ? 'VM' : target === 'web' ? 'Web' : 'Other';
}

export function isSupportedRunbookLanguage(language: string | null): boolean {
  if (!language) return false;
  return ['shell', 'sh', 'posix-shell', 'bash', 'zsh', 'python', 'python3', 'py', 'javascript', 'js', 'node', 'ruby', 'perl', 'powershell', 'pwsh']
    .includes(language.trim().toLowerCase());
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function runbookGuidance(codeCells: number, unhealthyCells: number, executionAvailable: boolean): string {
  if (codeCells === 0) return 'Add code cells for each bounded proof step; keep prerequisites, expected evidence, interpretation, and cleanup in markdown.';
  if (unhealthyCells > 0) return `${unhealthyCells} code ${unhealthyCells === 1 ? 'cell needs' : 'cells need'} an explicit supported language before this runbook is healthy.`;
  if (!executionAvailable) return 'Healthy runbook: bounded, repeatable cells with explicit languages. Reopen its active session to execute it.';
  return 'Healthy runbook: run cells are bounded and repeatable; keep prerequisites, expected evidence, interpretation, and cleanup explicit.';
}

function RunbookOutputView({ output }: { output: HoneycrispRunbookOutput }): JSX.Element {
  const label = output.kind === 'stream'
    ? output.streamName ?? 'output'
    : output.kind === 'error'
      ? 'error'
      : output.mimeType ?? 'output';
  return (
    <section className={`runbook-output runbook-output-${output.kind} ${output.streamName === 'stderr' ? 'is-stderr' : ''}`}>
      <span className="runbook-output-label">{label}</span>
      {output.mimeType === 'text/markdown'
        ? renderTraceProseText(output.text, 'agent_output')
        : <pre>{output.text}</pre>}
    </section>
  );
}
