import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { RunDetail, RunStatus } from '@shared/types';
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

export function useRunDetailPolling({
  selectedRunId,
  selectedRunState,
  onError
}: {
  selectedRunId: string | null;
  selectedRunState: RunStatus | null;
  onError: (message: string) => void;
}): {
  runDetail: RunDetail | null;
  clearRunDetail: () => void;
} {
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const requestSeqRef = useRef(0);
  const versionRef = useRef<string | null>(null);
  const detailRef = useRef<RunDetail | null>(null);

  useEffect(() => {
    detailRef.current = runDetail;
  }, [runDetail]);

  const clearRunDetail = useCallback(() => {
    versionRef.current = null;
    detailRef.current = null;
    setRunDetail(null);
  }, []);

  useEffect(() => {
    const requestSeq = ++requestSeqRef.current;
    if (!selectedRunId || selectedRunState === null) {
      clearRunDetail();
      return undefined;
    }

    versionRef.current = null;
    detailRef.current = null;
    let disposed = false;
    let inFlight = false;
    const refreshRunDetail = (): void => {
      if (inFlight) return;
      inFlight = true;
      devInstrumentation
        .timeAsync('ipc.getRunDetailVersion', () => window.beale.getRunDetailVersion(selectedRunId), { run: shortMetricId(selectedRunId) })
        .then(async (version) => {
          devInstrumentation.recordEvent('ipc.getRunDetailVersion.payload', {
            run: shortMetricId(version.runId),
            databaseMs: version.databaseMs,
            version: shortMetricId(version.version)
          });
          if (!disposed && requestSeq === requestSeqRef.current && version.version === versionRef.current) {
            return null;
          }
          const currentDetail = detailRef.current;
          if (currentDetail?.run.id === selectedRunId && versionRef.current) {
            const update = await devInstrumentation.timeAsync(
              'ipc.getRunDetailUpdate',
              () => window.beale.getRunDetailUpdate(selectedRunId, runDetailUpdateCursor(currentDetail)),
              { run: shortMetricId(selectedRunId) }
            );
            const updateMetricDetail = runDetailUpdateMetricDetail(update);
            const detail = devInstrumentation.time('trace.mergeRunDetailUpdate', () => mergeRunDetailUpdate(currentDetail, update), {
              ...updateMetricDetail,
              currentTraceEvents: currentDetail.traceEvents.length,
              currentTranscripts: currentDetail.transcriptMessages.length
            });
            return { detail, version: update.version.version, update };
          }
          const detail = await devInstrumentation.timeAsync('ipc.getRunDetail', () => window.beale.getRunDetail(selectedRunId), { run: shortMetricId(selectedRunId) });
          return { detail, version: version.version, update: null };
        })
        .then((result) => {
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
              startTransition(() => setRunDetail(detail));
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
            onError(errorMessage(caught));
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };

    refreshRunDetail();
    if (selectedRunState !== 'active') {
      return () => {
        disposed = true;
      };
    }

    const interval = window.setInterval(refreshRunDetail, ACTIVE_RUN_DETAIL_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [clearRunDetail, onError, selectedRunId, selectedRunState]);

  return { runDetail, clearRunDetail };
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
