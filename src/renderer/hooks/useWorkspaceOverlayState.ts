import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceRegistryEntry, WorkspaceRegistryState } from '@shared/types';
import {
  workspaceExists,
  sessionHistoryForWorkspaceId
} from '../view-models/workspaceDisplay';

export function useWorkspaceOverlayState(workspaceRegistry: WorkspaceRegistryState | null): {
  openRegisteredWorkspaceMenuId: string | null;
  setOpenWorkspaceMenuId: (registryWorkspaceId: string | null) => void;
  workspaceInfo: WorkspaceRegistryEntry | null;
  setWorkspaceInfo: (workspace: WorkspaceRegistryEntry | null | ((current: WorkspaceRegistryEntry | null) => WorkspaceRegistryEntry | null)) => void;
  sessionHistoryWorkspaceId: string | null;
  setSessionHistoryWorkspaceId: (registryWorkspaceId: string | null) => void;
  sessionHistoryWorkspace: WorkspaceRegistryEntry | null;
  sessionHistorySessions: ReturnType<typeof sessionHistoryForWorkspaceId>['sessions'];
} {
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceRegistryEntry | null>(null);
  const [sessionHistoryWorkspaceId, setSessionHistoryWorkspaceId] = useState<string | null>(null);
  const [openRegisteredWorkspaceMenuId, setOpenWorkspaceMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!openRegisteredWorkspaceMenuId) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Element && !event.target.closest('[data-workspace-menu-root]')) {
        setOpenWorkspaceMenuId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenWorkspaceMenuId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openRegisteredWorkspaceMenuId]);

  useEffect(() => {
    if (!workspaceRegistry) return;
    if (openRegisteredWorkspaceMenuId && !workspaceExists(workspaceRegistry, openRegisteredWorkspaceMenuId)) {
      setOpenWorkspaceMenuId(null);
    }
    if (workspaceInfo && !workspaceExists(workspaceRegistry, workspaceInfo.id)) {
      setWorkspaceInfo(null);
    }
    if (sessionHistoryWorkspaceId && !workspaceExists(workspaceRegistry, sessionHistoryWorkspaceId)) {
      setSessionHistoryWorkspaceId(null);
    }
  }, [openRegisteredWorkspaceMenuId, workspaceInfo, workspaceRegistry, sessionHistoryWorkspaceId]);

  const { workspace: sessionHistoryWorkspace, sessions: sessionHistorySessions } = useMemo(
    () => sessionHistoryForWorkspaceId(workspaceRegistry, sessionHistoryWorkspaceId),
    [workspaceRegistry, sessionHistoryWorkspaceId]
  );

  return {
    openRegisteredWorkspaceMenuId,
    setOpenWorkspaceMenuId,
    workspaceInfo,
    setWorkspaceInfo,
    sessionHistoryWorkspaceId,
    setSessionHistoryWorkspaceId,
    sessionHistoryWorkspace,
    sessionHistorySessions
  };
}
