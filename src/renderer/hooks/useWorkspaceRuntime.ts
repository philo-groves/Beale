import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
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

export type WorkspaceStartupPhase = 'shell' | 'registry' | 'workspace' | 'ready';

export function useWorkspaceRuntime(onError: (message: string) => void): {
  snapshot: WorkspaceSnapshot | null;
  workspaceRegistry: WorkspaceRegistryState | null;
  hostEnvironment: HostEnvironment | null;
  windowChromeState: WindowChromeState;
  openAiStatus: OpenAiAccountStatus | null;
  startupPhase: WorkspaceStartupPhase;
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
  const [startupPhase, setStartupPhase] = useState<WorkspaceStartupPhase>('shell');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const pendingSnapshotRef = useRef<WorkspaceSnapshot | null | undefined>(undefined);
  const pendingWorkspaceRegistryRef = useRef<WorkspaceRegistryState | null>(null);
  const snapshotFrameRef = useRef<number | null>(null);
  const workspaceRegistryFrameRef = useRef<number | null>(null);

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
    const unsubscribeSnapshot = window.beale.onSnapshot((next) => {
      const applyStartedAt = performance.now();
      const detail = snapshotMetricDetail(next);
      devInstrumentation.recordPayload('ipc.snapshot.event', next, detail);
      pendingSnapshotRef.current = next;
      if (snapshotFrameRef.current === null) {
        snapshotFrameRef.current = window.requestAnimationFrame(() => {
          snapshotFrameRef.current = null;
          const latest = pendingSnapshotRef.current;
          pendingSnapshotRef.current = undefined;
          if (latest === undefined) return;
          startTransition(() => applySnapshot(latest));
          recordNextFrameTiming('ipc.snapshot.event.apply.nextFrameLatency', applyStartedAt, snapshotMetricDetail(latest));
        });
      }
    });
    const unsubscribeWorkspaceRegistry = window.beale.onWorkspaceRegistry((next) => {
      const applyStartedAt = performance.now();
      const detail = workspaceRegistryMetricDetail(next);
      devInstrumentation.recordPayload('ipc.workspaceRegistry.event', next, detail);
      pendingWorkspaceRegistryRef.current = next;
      if (workspaceRegistryFrameRef.current === null) {
        workspaceRegistryFrameRef.current = window.requestAnimationFrame(() => {
          workspaceRegistryFrameRef.current = null;
          const latest = pendingWorkspaceRegistryRef.current;
          pendingWorkspaceRegistryRef.current = null;
          if (!latest) return;
          startTransition(() => setWorkspaceRegistry(latest));
          recordNextFrameTiming('ipc.workspaceRegistry.event.apply.nextFrameLatency', applyStartedAt, workspaceRegistryMetricDetail(latest));
        });
      }
    });
    const unsubscribeWindowChromeState = window.beale.onWindowChromeState(setWindowChromeState);
    let cancelled = false;
    const startupFrame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      setStartupPhase('registry');
      void window.beale
        .getHostEnvironment()
        .then((next) => {
          if (!cancelled) setHostEnvironment(next);
        })
        .catch((caught: unknown) => {
          if (!cancelled) onError(errorMessage(caught));
        });
      void window.beale
        .getWindowChromeState()
        .then((next) => {
          if (!cancelled) setWindowChromeState(next);
        })
        .catch((caught: unknown) => {
          if (!cancelled) onError(errorMessage(caught));
        });
      void (async () => {
        try {
          const registry = await devInstrumentation.timeAsync(
            'ipc.getWorkspaceRegistry.initial',
            () => window.beale.getWorkspaceRegistry()
          );
          if (cancelled) return;
          devInstrumentation.recordPayload(
            'ipc.workspaceRegistry.initial',
            registry,
            workspaceRegistryMetricDetail(registry)
          );
          setWorkspaceRegistry(registry);
          setStartupPhase('workspace');
          await nextRendererFrame();
          if (cancelled) return;
          const restored = await devInstrumentation.timeAsync(
            'ipc.restoreLastWorkspace.initial',
            () => window.beale.restoreLastWorkspace()
          );
          if (!cancelled) applySnapshot(restored);
        } catch (caught) {
          if (!cancelled) onError(errorMessage(caught));
        } finally {
          if (!cancelled) setStartupPhase('ready');
        }
      })();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(startupFrame);
      unsubscribeSnapshot();
      unsubscribeWorkspaceRegistry();
      unsubscribeWindowChromeState();
      if (snapshotFrameRef.current !== null) window.cancelAnimationFrame(snapshotFrameRef.current);
      if (workspaceRegistryFrameRef.current !== null) window.cancelAnimationFrame(workspaceRegistryFrameRef.current);
      snapshotFrameRef.current = null;
      workspaceRegistryFrameRef.current = null;
      pendingSnapshotRef.current = undefined;
      pendingWorkspaceRegistryRef.current = null;
    };
  }, [applySnapshot, onError]);

  return {
    snapshot,
    workspaceRegistry,
    hostEnvironment,
    windowChromeState,
    openAiStatus,
    startupPhase,
    selectedRunId,
    setWorkspaceRegistry,
    setOpenAiStatus,
    setSelectedRunId,
    applySnapshot,
    loadSnapshot,
    loadWorkspaceRegistry
  };
}

function nextRendererFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function workspaceRegistryMetricDetail(registry: WorkspaceRegistryState | null): Record<string, number> {
  return {
    workspaces: registry?.workspaces.length ?? 0,
    sessions: registry?.researchSessions.length ?? 0
  };
}
