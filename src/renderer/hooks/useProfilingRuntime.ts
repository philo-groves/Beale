import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfilingReport, ProfilingState } from '@shared/types';
import { devInstrumentation } from '../devInstrumentation';
import { errorMessage } from '../lib/errors';

export function useProfilingRuntime(
  onError: (message: string) => void,
  { observeReports = false }: { observeReports?: boolean } = {}
): {
  profilingState: ProfilingState | null;
  lastProfilingReport: ProfilingReport | null;
  setProfilingEnabled: (enabled: boolean) => Promise<void>;
  refreshProfilingState: () => Promise<void>;
  flushProfilingReport: () => ProfilingReport;
} {
  const [profilingState, setProfilingState] = useState<ProfilingState | null>(null);
  const [lastProfilingReport, setLastProfilingReport] = useState<ProfilingReport | null>(null);
  const observeReportsRef = useRef(observeReports);

  useEffect(() => {
    observeReportsRef.current = observeReports;
  }, [observeReports]);

  const refreshProfilingState = useCallback(async (): Promise<void> => {
    try {
      setProfilingState(await window.beale.getProfilingState());
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }, [onError]);

  useEffect(() => {
    void refreshProfilingState();
  }, [refreshProfilingState]);

  const recordReport = useCallback(
    (report: ProfilingReport): void => {
      const shouldUpdateUi = observeReportsRef.current || report.reason === 'manual';
      if (shouldUpdateUi) {
        setLastProfilingReport(report);
      }
      window.beale
        .recordProfilingReport(report)
        .then((next) => {
          if (observeReportsRef.current || report.reason === 'manual') {
            setProfilingState(next);
          }
        })
        .catch((caught: unknown) => onError(errorMessage(caught)));
    },
    [onError]
  );

  useEffect(() => {
    devInstrumentation.configureProfiling({
      enabled: profilingState?.enabled ?? false,
      onReport: recordReport
    });
  }, [profilingState?.enabled, recordReport]);

  const setProfilingEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      try {
        const next = await window.beale.setProfilingEnabled(enabled);
        setProfilingState(next);
        if (!enabled) {
          setLastProfilingReport(null);
        }
      } catch (caught) {
        onError(errorMessage(caught));
      }
    },
    [onError]
  );

  const flushProfilingReport = useCallback((): ProfilingReport => {
    const report = devInstrumentation.report();
    setLastProfilingReport(report);
    return report;
  }, []);

  return {
    profilingState,
    lastProfilingReport,
    setProfilingEnabled,
    refreshProfilingState,
    flushProfilingReport
  };
}
