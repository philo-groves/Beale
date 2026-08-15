import { useEffect, useState } from 'react';
import type { WorkspaceRegistryEntry, WorkspaceRegistryState } from '@shared/types';
import { workspaceExists } from '../view-models/workspaceDisplay';

export function useWorkspaceOverlayState(workspaceRegistry: WorkspaceRegistryState | null): {
  openRegisteredWorkspaceMenuId: string | null;
  setOpenWorkspaceMenuId: (registryWorkspaceId: string | null) => void;
  workspaceInfo: WorkspaceRegistryEntry | null;
  setWorkspaceInfo: (workspace: WorkspaceRegistryEntry | null | ((current: WorkspaceRegistryEntry | null) => WorkspaceRegistryEntry | null)) => void;
} {
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceRegistryEntry | null>(null);
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
  }, [openRegisteredWorkspaceMenuId, workspaceInfo, workspaceRegistry]);

  return {
    openRegisteredWorkspaceMenuId,
    setOpenWorkspaceMenuId,
    workspaceInfo,
    setWorkspaceInfo
  };
}
