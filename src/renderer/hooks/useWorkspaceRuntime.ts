import { startTransition, useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  HostEnvironment,
  OpenAiAccountStatus,
  ProgramRegistryState,
  WindowChromeState,
  WorkspaceSnapshot
} from '@shared/types';
import { devInstrumentation, recordNextFrameTiming } from '../devInstrumentation';
import { errorMessage } from '../lib/errors';
import {
  selectRunId,
  snapshotMetricDetail
} from '../view-models/runDetailUpdates';

export function useWorkspaceRuntime(onError: (message: string) => void): {
  snapshot: WorkspaceSnapshot | null;
  programRegistry: ProgramRegistryState | null;
  hostEnvironment: HostEnvironment | null;
  windowChromeState: WindowChromeState;
  openAiStatus: OpenAiAccountStatus | null;
  selectedRunId: string | null;
  setProgramRegistry: Dispatch<SetStateAction<ProgramRegistryState | null>>;
  setOpenAiStatus: Dispatch<SetStateAction<OpenAiAccountStatus | null>>;
  setSelectedRunId: Dispatch<SetStateAction<string | null>>;
  applySnapshot: (next: WorkspaceSnapshot | null) => void;
  loadSnapshot: () => Promise<void>;
  loadProgramRegistry: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [programRegistry, setProgramRegistry] = useState<ProgramRegistryState | null>(null);
  const [hostEnvironment, setHostEnvironment] = useState<HostEnvironment | null>(null);
  const [windowChromeState, setWindowChromeState] = useState<WindowChromeState>({ isMaximized: false, isFullScreen: false });
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiAccountStatus | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const applySnapshot = useCallback((next: WorkspaceSnapshot | null) => {
    devInstrumentation.recordPayload('ipc.snapshot.apply', next, snapshotMetricDetail(next));
    setSnapshot(next);
    if (next) {
      setOpenAiStatus(next.openAi);
    }
    setSelectedRunId((current) => selectRunId(current, next));
  }, []);

  const loadSnapshot = useCallback(async () => {
    const next = await devInstrumentation.timeAsync('ipc.getSnapshot', () => window.beale.getSnapshot());
    applySnapshot(next);
  }, [applySnapshot]);

  const loadProgramRegistry = useCallback(async () => {
    const next = await devInstrumentation.timeAsync('ipc.getProgramRegistry', () => window.beale.getProgramRegistry());
    devInstrumentation.recordPayload('ipc.programRegistry.apply', next, programRegistryMetricDetail(next));
    setProgramRegistry(next);
  }, []);

  useEffect(() => {
    window.beale
      .getHostEnvironment()
      .then(setHostEnvironment)
      .catch((caught: unknown) => onError(errorMessage(caught)));

    devInstrumentation
      .timeAsync('ipc.getSnapshot.initial', () => window.beale.getSnapshot())
      .then((initial) => {
        applySnapshot(initial);
      })
      .catch((caught: unknown) => onError(errorMessage(caught)));

    devInstrumentation
      .timeAsync('ipc.getProgramRegistry.initial', () => window.beale.getProgramRegistry())
      .then((initial) => {
        devInstrumentation.recordPayload('ipc.programRegistry.initial', initial, programRegistryMetricDetail(initial));
        setProgramRegistry(initial);
      })
      .catch((caught: unknown) => onError(errorMessage(caught)));

    window.beale
      .getOpenAiStatus()
      .then(setOpenAiStatus)
      .catch((caught: unknown) => onError(errorMessage(caught)));

    window.beale
      .getWindowChromeState()
      .then(setWindowChromeState)
      .catch((caught: unknown) => onError(errorMessage(caught)));

    const unsubscribeSnapshot = window.beale.onSnapshot((next) => {
      const applyStartedAt = performance.now();
      const detail = snapshotMetricDetail(next);
      devInstrumentation.recordPayload('ipc.snapshot.event', next, detail);
      startTransition(() => applySnapshot(next));
      recordNextFrameTiming('ipc.snapshot.event.apply.nextFrameLatency', applyStartedAt, detail);
    });
    const unsubscribeProgramRegistry = window.beale.onProgramRegistry((next) => {
      const applyStartedAt = performance.now();
      const detail = programRegistryMetricDetail(next);
      devInstrumentation.recordPayload('ipc.programRegistry.event', next, detail);
      startTransition(() => setProgramRegistry(next));
      recordNextFrameTiming('ipc.programRegistry.event.apply.nextFrameLatency', applyStartedAt, detail);
    });
    const unsubscribeWindowChromeState = window.beale.onWindowChromeState(setWindowChromeState);
    return () => {
      unsubscribeSnapshot();
      unsubscribeProgramRegistry();
      unsubscribeWindowChromeState();
    };
  }, [applySnapshot, onError]);

  return {
    snapshot,
    programRegistry,
    hostEnvironment,
    windowChromeState,
    openAiStatus,
    selectedRunId,
    setProgramRegistry,
    setOpenAiStatus,
    setSelectedRunId,
    applySnapshot,
    loadSnapshot,
    loadProgramRegistry
  };
}

function programRegistryMetricDetail(registry: ProgramRegistryState | null): Record<string, number> {
  return {
    programs: registry?.programs.length ?? 0,
    sessions: registry?.researchSessions.length ?? 0
  };
}
