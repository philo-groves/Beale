import { startTransition, useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  HostEnvironment,
  OpenAiAccountStatus,
  WorkspaceRegistryState,
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
  workspaceRegistry: WorkspaceRegistryState | null;
  hostEnvironment: HostEnvironment | null;
  windowChromeState: WindowChromeState;
  openAiStatus: OpenAiAccountStatus | null;
  selectedRunId: string | null;
  setWorkspaceRegistry: Dispatch<SetStateAction<WorkspaceRegistryState | null>>;
  setOpenAiStatus: Dispatch<SetStateAction<OpenAiAccountStatus | null>>;
  setSelectedRunId: Dispatch<SetStateAction<string | null>>;
  applySnapshot: (next: WorkspaceSnapshot | null) => void;
  loadSnapshot: () => Promise<void>;
  loadWorkspaceRegistry: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [workspaceRegistry, setWorkspaceRegistry] = useState<WorkspaceRegistryState | null>(null);
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

  const loadWorkspaceRegistry = useCallback(async () => {
    const next = await devInstrumentation.timeAsync('ipc.getWorkspaceRegistry', () => window.beale.getWorkspaceRegistry());
    devInstrumentation.recordPayload('ipc.workspaceRegistry.apply', next, workspaceRegistryMetricDetail(next));
    setWorkspaceRegistry(next);
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
      .timeAsync('ipc.getWorkspaceRegistry.initial', () => window.beale.getWorkspaceRegistry())
      .then((initial) => {
        devInstrumentation.recordPayload('ipc.workspaceRegistry.initial', initial, workspaceRegistryMetricDetail(initial));
        setWorkspaceRegistry(initial);
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
    const unsubscribeWorkspaceRegistry = window.beale.onWorkspaceRegistry((next) => {
      const applyStartedAt = performance.now();
      const detail = workspaceRegistryMetricDetail(next);
      devInstrumentation.recordPayload('ipc.workspaceRegistry.event', next, detail);
      startTransition(() => setWorkspaceRegistry(next));
      recordNextFrameTiming('ipc.workspaceRegistry.event.apply.nextFrameLatency', applyStartedAt, detail);
    });
    const unsubscribeWindowChromeState = window.beale.onWindowChromeState(setWindowChromeState);
    return () => {
      unsubscribeSnapshot();
      unsubscribeWorkspaceRegistry();
      unsubscribeWindowChromeState();
    };
  }, [applySnapshot, onError]);

  return {
    snapshot,
    workspaceRegistry,
    hostEnvironment,
    windowChromeState,
    openAiStatus,
    selectedRunId,
    setWorkspaceRegistry,
    setOpenAiStatus,
    setSelectedRunId,
    applySnapshot,
    loadSnapshot,
    loadWorkspaceRegistry
  };
}

function workspaceRegistryMetricDetail(registry: WorkspaceRegistryState | null): Record<string, number> {
  return {
    workspaces: registry?.workspaces.length ?? 0,
    sessions: registry?.researchSessions.length ?? 0
  };
}
