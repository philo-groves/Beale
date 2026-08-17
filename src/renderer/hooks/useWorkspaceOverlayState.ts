import { useEffect, useState } from 'react';
import type { WorkspaceRegistryState } from '@shared/types';
import { workspaceExists } from '../view-models/workspaceDisplay';

export function useWorkspaceOverlayState(workspaceRegistry: WorkspaceRegistryState | null): {
  openRegisteredWorkspaceMenuId: string | null;
  setOpenWorkspaceMenuId: (registryWorkspaceId: string | null) => void;
} {
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
  }, [openRegisteredWorkspaceMenuId, workspaceRegistry]);

  return {
    openRegisteredWorkspaceMenuId,
    setOpenWorkspaceMenuId
  };
}
