import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { RunDetail, RunDetailProjection, RunStatus } from '@shared/types';
import { devInstrumentation, recordNextFrameTiming } from '../devInstrumentation';
import { errorMessage } from '../lib/errors';
import {
  mergeRunDetailUpdate,
  runDetailMetricDetail,
  runDetailUpdateCursor,
  runDetailUpdateMetricDetail,
  shortMetricId
} from '../view-models/runDetailUpdates';

const ACTIVE_RUN_DETAIL_POLL_MS = 750;
const LARGE_RUN_DETAIL_POLL_MS = 1_250;
const VERY_LARGE_RUN_DETAIL_POLL_MS = 2_000;

export function useRunDetailPolling({
  selectedRunId,
  selectedRunState,
  projection,
  refreshKey,
  onError
}: {
  selectedRunId: string | null;
  selectedRunState: RunStatus | null;
  projection: RunDetailProjection;
  refreshKey: string | null;
  onError: (message: string) => void;
}): {
  runDetail: RunDetail | null;
  clearRunDetail: () => void;
} {
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const requestSeqRef = useRef(0);
  const versionRef = useRef<string | null>(null);
  const projectionRef = useRef<RunDetailProjection | null>(null);
  const detailRef = useRef<RunDetail | null>(null);

  useEffect(() => {
    detailRef.current = runDetail;
  }, [runDetail]);

  const clearRunDetail = useCallback(() => {
    versionRef.current = null;
    projectionRef.current = null;
    detailRef.current = null;
    setRunDetail(null);
  }, []);

  useEffect(() => {
    const requestSeq = ++requestSeqRef.current;
    if (!selectedRunId || selectedRunState === null) {
      clearRunDetail();
      return undefined;
    }

    if (detailRef.current?.run.id !== selectedRunId) {
      versionRef.current = null;
      projectionRef.current = projection;
      detailRef.current = null;
      setRunDetail(null);
    } else if (projectionRef.current !== projection) {
      versionRef.current = null;
      projectionRef.current = projection;
      detailRef.current = null;
      setRunDetail(null);
    }
    let disposed = false;
    let inFlight = false;
    let consecutiveFailures = 0;
    let pollTimer: number | null = null;
    const scheduleNextPoll = (): void => {
      if (disposed || selectedRunState !== 'active') return;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(
        refreshRunDetail,
        activeRunDetailPollMs(detailRef.current, consecutiveFailures)
      );
    };
    const refreshRunDetail = (): void => {
      if (inFlight) return;
      inFlight = true;
      const currentDetail = detailRef.current;
      const request = currentDetail?.run.id !== selectedRunId
        ? devInstrumentation
            .timeAsync('ipc.getRunDetail', () => window.beale.getRunDetail(selectedRunId, projection), { run: shortMetricId(selectedRunId), projection })
            .then((detail) => ({ detail, version: `initial:${requestSeq}`, update: null }))
        : devInstrumentation
            .timeAsync(
              'ipc.getRunDetailUpdate',
              () => window.beale.getRunDetailUpdate(selectedRunId, runDetailUpdateCursor(currentDetail), projection),
              { run: shortMetricId(selectedRunId), projection }
            )
            .then((update) => {
              if (!disposed && requestSeq === requestSeqRef.current && update.version.version === versionRef.current) {
                return null;
              }
              const updateMetricDetail = runDetailUpdateMetricDetail(update);
              const detail = devInstrumentation.time('trace.mergeRunDetailUpdate', () => mergeRunDetailUpdate(currentDetail, update), {
                ...updateMetricDetail,
                currentTraceEvents: currentDetail.traceEvents.length,
                currentTranscripts: currentDetail.transcriptMessages.length
              });
              return { detail, version: update.version.version, update };
            });
      request
        .then((result) => {
          consecutiveFailures = 0;
          if (!result) return;
          const { detail, version, update } = result;
          if (update) {
            devInstrumentation.recordPayload('ipc.getRunDetailUpdate.payload', update, runDetailUpdateMetricDetail(update));
          } else {
            devInstrumentation.recordPayload('ipc.getRunDetail.payload', detail, runDetailMetricDetail(detail));
          }
          if (!disposed && requestSeq === requestSeqRef.current) {
            if (version !== versionRef.current) {
              const applyStartedAt = performance.now();
              const applyDetail = runDetailApplyMetricDetail(detail, update);
              versionRef.current = version;
              detailRef.current = detail;
              if (update) {
                // Live detail is also the source of session usage telemetry. Keep
                // incremental commits urgent so a continuous event stream cannot
                // starve usage and chat state behind interrupted transitions.
                setRunDetail(detail);
              } else {
                // Full session materialization can be large. A transition keeps
                // navigation responsive and allows a newer selection to supersede it.
                startTransition(() => setRunDetail(detail));
              }
              devInstrumentation.recordEvent(update ? 'trace.runDetail.incrementalApply' : 'trace.runDetail.fullApply', applyDetail);
              recordNextFrameTiming('trace.runDetail.apply.nextFrameLatency', applyStartedAt, applyDetail);
            } else {
              devInstrumentation.recordEvent('ipc.getRunDetail.versionRaceSkipped', {
                run: shortMetricId(detail.run.id)
              });
            }
          }
        })
        .catch((caught: unknown) => {
          if (!disposed && requestSeq === requestSeqRef.current) {
            const message = errorMessage(caught);
            if (!shouldReportRunDetailError(detailRef.current, selectedRunId)) {
              consecutiveFailures += 1;
              devInstrumentation.recordEvent('ipc.getRunDetailUpdate.retry', {
                run: shortMetricId(selectedRunId),
                consecutiveFailures,
                message
              });
            } else {
              onError(message);
            }
          }
        })
        .finally(() => {
          inFlight = false;
          scheduleNextPoll();
        });
    };

    refreshRunDetail();
    return () => {
      disposed = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      window.beale.cancelRunDetailRequests();
    };
  }, [clearRunDetail, onError, projection, refreshKey, selectedRunId, selectedRunState]);

  return { runDetail, clearRunDetail };
}

export function activeRunDetailPollMs(detail: RunDetail | null, consecutiveFailures = 0): number {
  const recordCount = (detail?.traceEvents.length ?? 0) + (detail?.transcriptMessages.length ?? 0);
  const baseDelay = recordCount >= 20_000
    ? VERY_LARGE_RUN_DETAIL_POLL_MS
    : recordCount >= 5_000
      ? LARGE_RUN_DETAIL_POLL_MS
      : ACTIVE_RUN_DETAIL_POLL_MS;
  return Math.min(10_000, baseDelay * (2 ** Math.min(4, Math.max(0, consecutiveFailures))));
}

export function shouldReportRunDetailError(detail: RunDetail | null, selectedRunId: string): boolean {
  return detail?.run.id !== selectedRunId;
}

function runDetailApplyMetricDetail(detail: RunDetail, update: { traceEvents: unknown[]; transcriptMessages: unknown[] } | null): Record<string, string | number | boolean> {
  return {
    run: shortMetricId(detail.run.id),
    status: detail.run.status,
    incremental: Boolean(update),
    addedTraceEvents: update?.traceEvents.length ?? detail.traceEvents.length,
    addedTranscripts: update?.transcriptMessages.length ?? detail.transcriptMessages.length,
    totalTraceEvents: detail.traceEvents.length,
    totalTranscripts: detail.transcriptMessages.length
  };
}
