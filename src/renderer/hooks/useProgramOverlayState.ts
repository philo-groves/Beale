import { useEffect, useMemo, useState } from 'react';
import type { ProgramRegistryEntry, ProgramRegistryState } from '@shared/types';
import {
  programExists,
  sessionHistoryForProgramId
} from '../view-models/programDisplay';

export function useProgramOverlayState(programRegistry: ProgramRegistryState | null): {
  openProgramMenuId: string | null;
  setOpenProgramMenuId: (programId: string | null) => void;
  programInfo: ProgramRegistryEntry | null;
  setProgramInfo: (program: ProgramRegistryEntry | null | ((current: ProgramRegistryEntry | null) => ProgramRegistryEntry | null)) => void;
  sessionHistoryProgramId: string | null;
  setSessionHistoryProgramId: (programId: string | null) => void;
  sessionHistoryProgram: ProgramRegistryEntry | null;
  sessionHistorySessions: ReturnType<typeof sessionHistoryForProgramId>['sessions'];
} {
  const [programInfo, setProgramInfo] = useState<ProgramRegistryEntry | null>(null);
  const [sessionHistoryProgramId, setSessionHistoryProgramId] = useState<string | null>(null);
  const [openProgramMenuId, setOpenProgramMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!openProgramMenuId) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Element && !event.target.closest('[data-program-menu-root]')) {
        setOpenProgramMenuId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenProgramMenuId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openProgramMenuId]);

  useEffect(() => {
    if (!programRegistry) return;
    if (openProgramMenuId && !programExists(programRegistry, openProgramMenuId)) {
      setOpenProgramMenuId(null);
    }
    if (programInfo && !programExists(programRegistry, programInfo.id)) {
      setProgramInfo(null);
    }
    if (sessionHistoryProgramId && !programExists(programRegistry, sessionHistoryProgramId)) {
      setSessionHistoryProgramId(null);
    }
  }, [openProgramMenuId, programInfo, programRegistry, sessionHistoryProgramId]);

  const { program: sessionHistoryProgram, sessions: sessionHistorySessions } = useMemo(
    () => sessionHistoryForProgramId(programRegistry, sessionHistoryProgramId),
    [programRegistry, sessionHistoryProgramId]
  );

  return {
    openProgramMenuId,
    setOpenProgramMenuId,
    programInfo,
    setProgramInfo,
    sessionHistoryProgramId,
    setSessionHistoryProgramId,
    sessionHistoryProgram,
    sessionHistorySessions
  };
}
