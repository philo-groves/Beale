import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceOnboardingProgressUpdate, WorkspaceRegistryEntry, ResearchSessionSummary, WorkspaceSnapshot } from '@shared/types';
import {
  applyGitHubRepositoryCatalog,
  applyWorkspaceTemplate,
  emptyWorkspaceOnboardingForm,
  onboardingFormFromHackerOneLookup,
  workspaceOnboardingFormForProfile,
  onboardingInputFromForm,
  type WorkspaceOnboardingFormState,
  type WorkspaceTemplateKind
} from '../view-models/workspaceOnboarding';
import { errorMessage } from '../lib/errors';

export interface WorkspaceActions {
  addWorkspace: () => void;
  openRegisteredWorkspace: (workspace: WorkspaceRegistryEntry) => void;
  openResearchSession: (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary) => void;
  removeRegisteredWorkspace: (workspace: WorkspaceRegistryEntry) => Promise<void>;
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
  selectedRunId,
  workspaceDraft,
  runWorkspaceAction,
  applySnapshot,
  clearRunDetail,
  setSelectedRunId,
  setWorkspaceDraft,
  setWorkspaceOnboardingProgress,
  setOpenWorkspaceMenuId
}: {
  snapshot: WorkspaceSnapshot | null;
  selectedRunId: string | null;
  workspaceDraft: WorkspaceOnboardingFormState | null;
  runWorkspaceAction: (action: () => Promise<void>, options?: WorkspaceActionOptions) => Promise<void>;
  applySnapshot: (next: WorkspaceSnapshot | null) => void;
  clearRunDetail: () => void;
  setSelectedRunId: Dispatch<SetStateAction<string | null>>;
  setWorkspaceDraft: Dispatch<SetStateAction<WorkspaceOnboardingFormState | null>>;
  setWorkspaceOnboardingProgress: Dispatch<SetStateAction<WorkspaceOnboardingProgressUpdate | null>>;
  setOpenWorkspaceMenuId: (registryWorkspaceId: string | null) => void;
}): WorkspaceActions {
  const addWorkspace = useCallback((): void => {
    setWorkspaceDraft(emptyWorkspaceOnboardingForm());
  }, [setWorkspaceDraft]);

  const openRegisteredWorkspace = useCallback(
    (workspace: WorkspaceRegistryEntry): void => {
      void runWorkspaceAction(async () => {
        clearRunDetail();
        setSelectedRunId(null);
        const next = await window.beale.openRegisteredWorkspace(workspace.id);
        applySnapshot(next);
        setSelectedRunId(null);
      }, { reloadRegistry: false });
    },
    [applySnapshot, clearRunDetail, runWorkspaceAction, setSelectedRunId]
  );

  const openResearchSession = useCallback(
    (workspace: WorkspaceRegistryEntry, session: ResearchSessionSummary): void => {
      if (!researchSessionNeedsLoading(snapshot, selectedRunId, workspace, session)) return;
      void runWorkspaceAction(async () => {
        clearRunDetail();
        const activeWorkspace = snapshot?.workspace.workspacePath === workspace.workspacePath;
        if (!activeWorkspace) {
          applySnapshot(await window.beale.openRegisteredWorkspace(workspace.id));
        }
        setSelectedRunId(session.runId);
      }, { markBusy: false, reloadRegistry: false });
    },
    [applySnapshot, clearRunDetail, runWorkspaceAction, selectedRunId, setSelectedRunId, snapshot]
  );

  const removeRegisteredWorkspace = useCallback(
    (workspace: WorkspaceRegistryEntry): Promise<void> => {
      return runWorkspaceAction(async () => {
        setOpenWorkspaceMenuId(null);
        applySnapshot(await window.beale.removeRegisteredWorkspace(workspace.id));
      });
    },
    [applySnapshot, runWorkspaceAction, setOpenWorkspaceMenuId]
  );

  const submitWorkspaceOnboarding = useCallback((): void => {
    if (!workspaceDraft) return;
    const submittedDraft = workspaceOnboardingFormForProfile(workspaceDraft, workspaceDraft.researchProfileId);
    void runWorkspaceAction(async () => {
      setWorkspaceOnboardingProgress(null);
      try {
        const next = await window.beale.createScopedWorkspace(onboardingInputFromForm(submittedDraft));
        clearRunDetail();
        setSelectedRunId(null);
        applySnapshot(next);
        setSelectedRunId(null);
        setWorkspaceDraft(null);
      } catch (error) {
        setWorkspaceOnboardingProgress(null);
        throw error;
      }
    });
  }, [applySnapshot, clearRunDetail, workspaceDraft, runWorkspaceAction, setWorkspaceDraft, setWorkspaceOnboardingProgress, setSelectedRunId]);

  const applyOnboardingTemplate = useCallback(
    (templateKind: WorkspaceTemplateKind): void => {
      if (workspaceDraft?.researchProfileId === 'mathematics' && templateKind !== 'manual') return;
      setWorkspaceDraft((current) => (current ? applyWorkspaceTemplate(current, templateKind) : current));
      if (templateKind !== 'apple') return;
      void window.beale.listGitHubOrganizationRepositories('apple-oss-distributions')
        .then((repositories) => {
          setWorkspaceDraft((current) => (
            current?.templateKind === 'apple' ? applyGitHubRepositoryCatalog(current, repositories) : current
          ));
        })
        .catch((caught: unknown) => {
          setWorkspaceDraft((current) => (
            current?.templateKind === 'apple'
              ? { ...current, repositoryCatalogLoading: false, repositoryCatalogError: errorMessage(caught) }
              : current
          ));
        });
    },
    [setWorkspaceDraft, workspaceDraft?.researchProfileId]
  );

  const lookupHackerOneScope = useCallback(
    async (identifier: string): Promise<void> => {
      if (workspaceDraft?.researchProfileId === 'mathematics') {
        throw new Error('HackerOne workspace autofill is unavailable for the Mathematics research profile.');
      }
      const lookup = await window.beale.lookupHackerOneScope(identifier);
      setWorkspaceDraft((current) => (current ? onboardingFormFromHackerOneLookup(current, lookup) : current));
    },
    [setWorkspaceDraft, workspaceDraft?.researchProfileId]
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

export function researchSessionNeedsLoading(
  snapshot: WorkspaceSnapshot | null,
  selectedRunId: string | null,
  workspace: Pick<WorkspaceRegistryEntry, 'workspacePath'>,
  session: Pick<ResearchSessionSummary, 'runId'>
): boolean {
  return snapshot?.workspace.workspacePath !== workspace.workspacePath || selectedRunId !== session.runId;
}
