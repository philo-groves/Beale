import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ProgramRegistryEntry, ResearchSessionSummary, WorkspaceSnapshot } from '@shared/types';
import {
  applyProgramTemplate,
  onboardingFormFromDefaults,
  onboardingFormFromHackerOneLookup,
  onboardingInputFromForm,
  type ProgramOnboardingFormState,
  type ProgramTemplateKind
} from '../view-models/programOnboarding';

export interface ProgramActions {
  addProgram: () => void;
  openRegisteredProgram: (program: ProgramRegistryEntry) => void;
  openResearchSession: (program: ProgramRegistryEntry, session: ResearchSessionSummary) => void;
  removeRegisteredProgram: (program: ProgramRegistryEntry) => void;
  submitProgramOnboarding: () => void;
  applyOnboardingTemplate: (templateKind: ProgramTemplateKind) => void;
  lookupHackerOneProgram: (identifier: string) => Promise<void>;
}

export function useProgramActions({
  snapshot,
  programDraft,
  runProgramAction,
  applySnapshot,
  clearRunDetail,
  setSelectedRunId,
  setProgramDraft,
  setProgramInfo,
  setOpenProgramMenuId
}: {
  snapshot: WorkspaceSnapshot | null;
  programDraft: ProgramOnboardingFormState | null;
  runProgramAction: (action: () => Promise<void>) => Promise<void>;
  applySnapshot: (next: WorkspaceSnapshot | null) => void;
  clearRunDetail: () => void;
  setSelectedRunId: Dispatch<SetStateAction<string | null>>;
  setProgramDraft: Dispatch<SetStateAction<ProgramOnboardingFormState | null>>;
  setProgramInfo: Dispatch<SetStateAction<ProgramRegistryEntry | null>>;
  setOpenProgramMenuId: (programId: string | null) => void;
}): ProgramActions {
  const addProgram = useCallback((): void => {
    void runProgramAction(async () => {
      const selection = await window.beale.selectProgramDirectory();
      if (selection.canceled) return;
      if (selection.knownProgram) {
        applySnapshot(await window.beale.openProgram(selection.knownProgram.id));
        return;
      }
      if (selection.defaults) {
        setProgramDraft(onboardingFormFromDefaults(selection.defaults));
      }
    });
  }, [applySnapshot, runProgramAction, setProgramDraft]);

  const openRegisteredProgram = useCallback(
    (program: ProgramRegistryEntry): void => {
      void runProgramAction(async () => {
        applySnapshot(await window.beale.openProgram(program.id));
      });
    },
    [applySnapshot, runProgramAction]
  );

  const openResearchSession = useCallback(
    (program: ProgramRegistryEntry, session: ResearchSessionSummary): void => {
      void runProgramAction(async () => {
        clearRunDetail();
        const activeProgram = snapshot?.workspace.workspacePath === program.workspacePath;
        const next = activeProgram ? await window.beale.getSnapshot() : await window.beale.openProgram(program.id);
        applySnapshot(next);
        setSelectedRunId(session.runId);
      });
    },
    [applySnapshot, clearRunDetail, runProgramAction, setSelectedRunId, snapshot]
  );

  const removeRegisteredProgram = useCallback(
    (program: ProgramRegistryEntry): void => {
      void runProgramAction(async () => {
        setProgramInfo((current) => (current?.id === program.id ? null : current));
        setOpenProgramMenuId(null);
        applySnapshot(await window.beale.removeProgram(program.id));
      });
    },
    [applySnapshot, runProgramAction, setOpenProgramMenuId, setProgramInfo]
  );

  const submitProgramOnboarding = useCallback((): void => {
    if (!programDraft) return;
    void runProgramAction(async () => {
      const next = await window.beale.createProgram(onboardingInputFromForm(programDraft));
      setProgramDraft(null);
      applySnapshot(next);
    });
  }, [applySnapshot, programDraft, runProgramAction, setProgramDraft]);

  const applyOnboardingTemplate = useCallback(
    (templateKind: ProgramTemplateKind): void => {
      setProgramDraft((current) => (current ? applyProgramTemplate(current, templateKind) : current));
    },
    [setProgramDraft]
  );

  const lookupHackerOneProgram = useCallback(
    async (identifier: string): Promise<void> => {
      const lookup = await window.beale.lookupHackerOneProgram(identifier);
      setProgramDraft((current) => (current ? onboardingFormFromHackerOneLookup(current, lookup) : current));
    },
    [setProgramDraft]
  );

  return {
    addProgram,
    openRegisteredProgram,
    openResearchSession,
    removeRegisteredProgram,
    submitProgramOnboarding,
    applyOnboardingTemplate,
    lookupHackerOneProgram
  };
}
