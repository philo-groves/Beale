import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ProgramOnboardingProgressUpdate, ProgramRegistryEntry, ResearchSessionSummary, WorkspaceSnapshot } from '@shared/types';
import {
  applyProgramTemplate,
  onboardingFormFromDefaults,
  onboardingFormFromHackerOneLookup,
  onboardingInputFromForm,
  onboardingRepositories,
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

export interface ProgramActionOptions {
  markBusy?: boolean;
  reloadRegistry?: boolean;
}

export function useProgramActions({
  snapshot,
  programDraft,
  runProgramAction,
  applySnapshot,
  clearRunDetail,
  setSelectedRunId,
  setProgramDraft,
  setProgramOnboardingProgress,
  setProgramInfo,
  setOpenProgramMenuId
}: {
  snapshot: WorkspaceSnapshot | null;
  programDraft: ProgramOnboardingFormState | null;
  runProgramAction: (action: () => Promise<void>, options?: ProgramActionOptions) => Promise<void>;
  applySnapshot: (next: WorkspaceSnapshot | null) => void;
  clearRunDetail: () => void;
  setSelectedRunId: Dispatch<SetStateAction<string | null>>;
  setProgramDraft: Dispatch<SetStateAction<ProgramOnboardingFormState | null>>;
  setProgramOnboardingProgress: Dispatch<SetStateAction<ProgramOnboardingProgressUpdate | null>>;
  setProgramInfo: Dispatch<SetStateAction<ProgramRegistryEntry | null>>;
  setOpenProgramMenuId: (programId: string | null) => void;
}): ProgramActions {
  const addProgram = useCallback((): void => {
    void runProgramAction(async () => {
      const selection = await window.beale.selectProgramDirectory();
      if (selection.canceled) return;
      if (selection.knownProgram) {
        clearRunDetail();
        setSelectedRunId(null);
        const next = await window.beale.openProgram(selection.knownProgram.id);
        applySnapshot(next);
        setSelectedRunId(null);
        return;
      }
      if (selection.defaults) {
        setProgramDraft(onboardingFormFromDefaults(selection.defaults));
      }
    });
  }, [applySnapshot, clearRunDetail, runProgramAction, setProgramDraft, setSelectedRunId]);

  const openRegisteredProgram = useCallback(
    (program: ProgramRegistryEntry): void => {
      void runProgramAction(async () => {
        clearRunDetail();
        setSelectedRunId(null);
        const next = await window.beale.openProgram(program.id);
        applySnapshot(next);
        setSelectedRunId(null);
      });
    },
    [applySnapshot, clearRunDetail, runProgramAction, setSelectedRunId]
  );

  const openResearchSession = useCallback(
    (program: ProgramRegistryEntry, session: ResearchSessionSummary): void => {
      void runProgramAction(async () => {
        clearRunDetail();
        const activeProgram = snapshot?.workspace.workspacePath === program.workspacePath;
        if (!activeProgram) {
          applySnapshot(await window.beale.openProgram(program.id));
        }
        setSelectedRunId(session.runId);
      }, { markBusy: false, reloadRegistry: false });
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
      const requestId = `onboarding_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const repositoryRows = onboardingRepositories(programDraft).filter((repository) => repository.indexNow);
      const shouldTrackProgress = repositoryRows.length > 0;
      setProgramOnboardingProgress(
        shouldTrackProgress
          ? {
              requestId,
              workspacePath: programDraft.workspacePath,
              phase: 'creating',
              repositories: repositoryRows.map((repository) => ({
                repositoryUrl: repository.url,
                label: repository.label,
                stage: 'queued',
                message: 'Waiting to create program.',
                localPath: null,
                error: null,
                updatedAt: new Date().toISOString()
              }))
            }
          : null
      );
      let unsubscribe: (() => void) | null = null;
      if (shouldTrackProgress) {
        unsubscribe = window.beale.onProgramOnboardingUpdate((update) => {
          if (update.requestId !== requestId) return;
          setProgramOnboardingProgress(update);
          if (update.phase === 'complete') {
            unsubscribe?.();
            unsubscribe = null;
          }
        });
      }
      try {
        const next = await window.beale.createProgram({ ...onboardingInputFromForm(programDraft), onboardingRequestId: shouldTrackProgress ? requestId : undefined });
        clearRunDetail();
        setSelectedRunId(null);
        applySnapshot(next);
        setSelectedRunId(null);
        if (!shouldTrackProgress) {
          setProgramDraft(null);
        }
      } catch (error) {
        unsubscribe?.();
        unsubscribe = null;
        setProgramOnboardingProgress(null);
        throw error;
      }
    });
  }, [applySnapshot, clearRunDetail, programDraft, runProgramAction, setProgramDraft, setProgramOnboardingProgress, setSelectedRunId]);

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
