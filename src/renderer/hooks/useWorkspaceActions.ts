import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ResearchProfileId, WorkspaceOnboardingProgressUpdate, WorkspaceRegistryEntry, ResearchSessionSummary, WorkspaceSnapshot } from '@shared/types';
import {
  applyWorkspaceTemplate,
  onboardingFormFromDefaults,
  onboardingFormFromHackerOneLookup,
  workspaceOnboardingFormForProfile,
  onboardingInputFromForm,
  onboardingRepositories,
  type WorkspaceOnboardingFormState,
  type WorkspaceTemplateKind
} from '../view-models/workspaceOnboarding';

export interface WorkspaceActions {
  addWorkspace: () => void;
  openRegisteredWorkspace: (workspace: WorkspaceRegistryEntry) => void;
  openResearchSession: (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary) => void;
  removeRegisteredWorkspace: (workspace: WorkspaceRegistryEntry) => void;
  submitWorkspaceOnboarding: () => void;
  applyOnboardingTemplate: (templateKind: WorkspaceTemplateKind) => void;
  lookupHackerOneScope: (identifier: string) => Promise<void>;
}

export interface WorkspaceActionOptions {
  markBusy?: boolean;
  reloadRegistry?: boolean;
}

export function useWorkspaceActions({
  snapshot,
  researchProfileId,
  workspaceDraft,
  runWorkspaceAction,
  applySnapshot,
  clearRunDetail,
  setSelectedRunId,
  setWorkspaceDraft,
  setWorkspaceOnboardingProgress,
  setWorkspaceInfo,
  setOpenWorkspaceMenuId
}: {
  snapshot: WorkspaceSnapshot | null;
  researchProfileId: ResearchProfileId;
  workspaceDraft: WorkspaceOnboardingFormState | null;
  runWorkspaceAction: (action: () => Promise<void>, options?: WorkspaceActionOptions) => Promise<void>;
  applySnapshot: (next: WorkspaceSnapshot | null) => void;
  clearRunDetail: () => void;
  setSelectedRunId: Dispatch<SetStateAction<string | null>>;
  setWorkspaceDraft: Dispatch<SetStateAction<WorkspaceOnboardingFormState | null>>;
  setWorkspaceOnboardingProgress: Dispatch<SetStateAction<WorkspaceOnboardingProgressUpdate | null>>;
  setWorkspaceInfo: Dispatch<SetStateAction<WorkspaceRegistryEntry | null>>;
  setOpenWorkspaceMenuId: (registryWorkspaceId: string | null) => void;
}): WorkspaceActions {
  const addWorkspace = useCallback((): void => {
    void runWorkspaceAction(async () => {
      const selection = await window.beale.selectWorkspaceDirectory();
      if (selection.canceled) return;
      if (selection.knownWorkspace) {
        clearRunDetail();
        setSelectedRunId(null);
        const next = await window.beale.openRegisteredWorkspace(selection.knownWorkspace.id);
        applySnapshot(next);
        setSelectedRunId(null);
        return;
      }
      if (selection.defaults) {
        setWorkspaceDraft(onboardingFormFromDefaults(selection.defaults));
      }
    });
  }, [applySnapshot, clearRunDetail, runWorkspaceAction, setWorkspaceDraft, setSelectedRunId]);

  const openRegisteredWorkspace = useCallback(
    (workspace: WorkspaceRegistryEntry): void => {
      void runWorkspaceAction(async () => {
        clearRunDetail();
        setSelectedRunId(null);
        const next = await window.beale.openRegisteredWorkspace(workspace.id);
        applySnapshot(next);
        setSelectedRunId(null);
      });
    },
    [applySnapshot, clearRunDetail, runWorkspaceAction, setSelectedRunId]
  );

  const openResearchSession = useCallback(
    (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary): void => {
      void runWorkspaceAction(async () => {
        clearRunDetail();
        const activeWorkspace = snapshot?.workspace.workspacePath === workspace.workspacePath;
        if (!activeWorkspace) {
          applySnapshot(await window.beale.openRegisteredWorkspace(workspace.id));
        }
        setSelectedRunId(session.runId);
      }, { markBusy: false, reloadRegistry: false });
    },
    [applySnapshot, clearRunDetail, runWorkspaceAction, setSelectedRunId, snapshot]
  );

  const removeRegisteredWorkspace = useCallback(
    (workspace: WorkspaceRegistryEntry): void => {
      void runWorkspaceAction(async () => {
        setWorkspaceInfo((current) => (current?.id === workspace.id ? null : current));
        setOpenWorkspaceMenuId(null);
        applySnapshot(await window.beale.removeRegisteredWorkspace(workspace.id));
      });
    },
    [applySnapshot, runWorkspaceAction, setOpenWorkspaceMenuId, setWorkspaceInfo]
  );

  const submitWorkspaceOnboarding = useCallback((): void => {
    if (!workspaceDraft) return;
    const submittedDraft = workspaceOnboardingFormForProfile(workspaceDraft, researchProfileId);
    void runWorkspaceAction(async () => {
      const requestId = `onboarding_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const repositoryRows = onboardingRepositories(submittedDraft).filter((repository) => repository.indexNow);
      const shouldTrackProgress = repositoryRows.length > 0;
      setWorkspaceOnboardingProgress(
        shouldTrackProgress
          ? {
              requestId,
              workspacePath: submittedDraft.workspacePath,
              phase: 'creating',
              repositories: repositoryRows.map((repository) => ({
                repositoryUrl: repository.url,
                label: repository.label,
                stage: 'queued',
                message: 'Waiting to create workspace.',
                localPath: null,
                error: null,
                updatedAt: new Date().toISOString()
              }))
            }
          : null
      );
      let unsubscribe: (() => void) | null = null;
      if (shouldTrackProgress) {
        unsubscribe = window.beale.onWorkspaceOnboardingUpdate((update) => {
          if (update.requestId !== requestId) return;
          setWorkspaceOnboardingProgress(update);
          if (update.phase === 'complete') {
            unsubscribe?.();
            unsubscribe = null;
          }
        });
      }
      try {
        const next = await window.beale.createScopedWorkspace({ ...onboardingInputFromForm(submittedDraft), onboardingRequestId: shouldTrackProgress ? requestId : undefined });
        clearRunDetail();
        setSelectedRunId(null);
        applySnapshot(next);
        setSelectedRunId(null);
        if (!shouldTrackProgress) {
          setWorkspaceDraft(null);
        }
      } catch (error) {
        unsubscribe?.();
        unsubscribe = null;
        setWorkspaceOnboardingProgress(null);
        throw error;
      }
    });
  }, [applySnapshot, clearRunDetail, researchProfileId, workspaceDraft, runWorkspaceAction, setWorkspaceDraft, setWorkspaceOnboardingProgress, setSelectedRunId]);

  const applyOnboardingTemplate = useCallback(
    (templateKind: WorkspaceTemplateKind): void => {
      if (researchProfileId === 'mathematics' && templateKind !== 'manual') return;
      setWorkspaceDraft((current) => (current ? applyWorkspaceTemplate(current, templateKind) : current));
    },
    [researchProfileId, setWorkspaceDraft]
  );

  const lookupHackerOneScope = useCallback(
    async (identifier: string): Promise<void> => {
      if (researchProfileId === 'mathematics') {
        throw new Error('HackerOne workspace autofill is unavailable for the Mathematics research profile.');
      }
      const lookup = await window.beale.lookupHackerOneScope(identifier);
      setWorkspaceDraft((current) => (current ? onboardingFormFromHackerOneLookup(current, lookup) : current));
    },
    [researchProfileId, setWorkspaceDraft]
  );

  return {
    addWorkspace,
    openRegisteredWorkspace,
    openResearchSession,
    removeRegisteredWorkspace,
    submitWorkspaceOnboarding,
    applyOnboardingTemplate,
    lookupHackerOneScope
  };
}
