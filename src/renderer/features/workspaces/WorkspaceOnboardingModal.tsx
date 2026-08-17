import { useState } from 'react';
import type { JSX } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { WorkspaceOnboardingProgressUpdate } from '@shared/types';
import { Modal } from '../../app/Modal';
import { errorMessage } from '../../lib/errors';
import {
  addRepositoryToOnboardingForm,
  onboardingRepositories,
  workspaceOnboardingFormForProfile,
  removeRepositoryFromOnboardingForm,
  setOnboardingRepositorySelected,
  templateLabel,
  type OnboardingRepository,
  type WorkspaceOnboardingFormState,
  type WorkspaceTemplateKind
} from '../../view-models/workspaceOnboarding';

export function WorkspaceOnboardingModal({
  form,
  busy,
  progress,
  onChange,
  onCancel,
  onLookupHackerOne,
  onTemplate,
  onSubmit
}: {
  form: WorkspaceOnboardingFormState;
  busy: boolean;
  progress: WorkspaceOnboardingProgressUpdate | null;
  onChange: (next: WorkspaceOnboardingFormState) => void;
  onCancel: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onTemplate: (templateKind: WorkspaceTemplateKind) => void;
  onSubmit: () => void;
}): JSX.Element {
  const [hackerOneIdentifier, setHackerOneIdentifier] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const update = (key: keyof WorkspaceOnboardingFormState, value: string): void => {
    onChange({ ...form, [key]: value });
  };
  const canSubmit = form.workspaceName.trim().length > 0;
  const repositories = onboardingRepositories(form);
  const submitting = Boolean(progress);
  const progressComplete = progress?.phase === 'complete';
  const lookupHackerOne = (): void => {
    if (!hackerOneIdentifier.trim()) return;
    setLookupBusy(true);
    setLookupError(null);
    onLookupHackerOne(hackerOneIdentifier)
      .catch((caught: unknown) => setLookupError(errorMessage(caught)))
      .finally(() => setLookupBusy(false));
  };
  const addRepository = (): void => {
    try {
      const next = addRepositoryToOnboardingForm(form, repositoryUrl);
      onChange(next);
      setRepositoryUrl('');
      setRepositoryError(null);
    } catch (caught: unknown) {
      setRepositoryError(errorMessage(caught));
    }
  };

  return (
    <Modal
      title="New Workspace"
      wide
      className="start-run-dialog workspace-onboarding-modal"
      onClose={submitting && !progressComplete ? () => undefined : onCancel}
      footer={
        <div className="workspace-onboarding-footer-content">
          <div className="workspace-onboarding-footer-actions">
            {submitting ? (
              <button className="primary-button" type="button" disabled={!progressComplete} onClick={onCancel}>
                {progressComplete ? 'Done' : 'Working...'}
              </button>
            ) : (
              <button className="primary-button" type="submit" form="workspace-onboarding-form" disabled={busy || lookupBusy || !canSubmit}>
                {lookupBusy ? 'Importing Scope...' : 'Create Workspace'}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="workspace-onboarding-layout">
        <form
          id="workspace-onboarding-form"
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!submitting && canSubmit) onSubmit();
          }}
        >
          <label>
            Workspace directory
            <input value={form.workspacePath} readOnly />
          </label>
          {form.researchProfileId === 'security-research' ? (
            <div className="template-toggle-row" role="group" aria-label="Workspace template">
              {(['manual', 'hackerone', 'apple', 'msrc'] as WorkspaceTemplateKind[]).map((templateKind) => (
                <button
                  type="button"
                  className={`template-toggle ${form.templateKind === templateKind ? 'active' : ''}`}
                  key={templateKind}
                  disabled={submitting}
                  onClick={() => onTemplate(templateKind)}
                >
                  {templateLabel(templateKind)}
                </button>
              ))}
            </div>
          ) : null}
          {form.templateKind === 'hackerone' ? (
            <div className="hackerone-lookup">
              <label>
                HackerOne handle or URL
                <input value={hackerOneIdentifier} placeholder="github" disabled={submitting} onChange={(event) => setHackerOneIdentifier(event.target.value)} />
              </label>
              <button type="button" disabled={submitting || busy || lookupBusy || !hackerOneIdentifier.trim()} onClick={lookupHackerOne}>
                {lookupBusy ? 'Loading...' : 'Look Up'}
              </button>
              {lookupError ? <div className="error-box">{lookupError}</div> : null}
            </div>
          ) : null}
          <div className="form-grid">
            <label>
              Workspace name
              <input value={form.workspaceName} disabled={submitting} onChange={(event) => update('workspaceName', event.target.value)} autoFocus />
            </label>
            <label>
              Research subject
              <input value={form.researchSubjectName} disabled={submitting} onChange={(event) => update('researchSubjectName', event.target.value)} />
            </label>
          </div>
          <label>
            Research Profile
            <select
              value={form.researchProfileId}
              disabled={submitting}
              onChange={(event) => onChange(workspaceOnboardingFormForProfile(
                { ...form, researchProfileId: event.target.value as 'security-research' | 'mathematics' },
                event.target.value as 'security-research' | 'mathematics'
              ))}
            >
              <option value="security-research">Security</option>
              <option value="mathematics">Mathematics</option>
            </select>
          </label>
          <label>
            Description
            <textarea rows={3} value={form.descriptionMarkdown} disabled={submitting} onChange={(event) => update('descriptionMarkdown', event.target.value)} />
          </label>
          <label>
            Scope and Rules
            <textarea rows={3} value={form.rulesMarkdown} disabled={submitting} onChange={(event) => update('rulesMarkdown', event.target.value)} />
          </label>
        </form>
        <RepositoryOnboardingPanel
          repositories={repositories}
          repositoryCatalogLoading={form.repositoryCatalogLoading}
          repositoryCatalogError={form.repositoryCatalogError}
          progress={progress}
          repositoryError={repositoryError}
          repositoryUrl={repositoryUrl}
          onAddRepository={addRepository}
          onChangeRepositoryUrl={setRepositoryUrl}
          onRemoveRepository={(assetIndex) => onChange(removeRepositoryFromOnboardingForm(form, assetIndex))}
          onSelectRepository={(candidateIndex, selected) => onChange(setOnboardingRepositorySelected(form, candidateIndex, selected))}
        />
      </div>
    </Modal>
  );
}

function RepositoryOnboardingPanel({
  repositories,
  repositoryCatalogLoading,
  repositoryCatalogError,
  progress,
  repositoryError,
  repositoryUrl,
  onAddRepository,
  onChangeRepositoryUrl,
  onRemoveRepository,
  onSelectRepository
}: {
  repositories: OnboardingRepository[];
  repositoryCatalogLoading: boolean;
  repositoryCatalogError: string | null;
  progress: WorkspaceOnboardingProgressUpdate | null;
  repositoryError: string | null;
  repositoryUrl: string;
  onAddRepository: () => void;
  onChangeRepositoryUrl: (value: string) => void;
  onRemoveRepository: (assetIndex: number) => void;
  onSelectRepository: (candidateIndex: number, selected: boolean) => void;
}): JSX.Element {
  const submitting = Boolean(progress);
  const rows = progress ? progress.repositories : repositories;
  return (
    <aside className="workspace-repository-panel" aria-label="Workspace repositories">
      {!submitting ? (
        <>
          <div className="workspace-repository-add">
            <label>
              Repository URL
              <input
                value={repositoryUrl}
                placeholder="https://github.com/org/repo"
                onChange={(event) => onChangeRepositoryUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onAddRepository();
                  }
                }}
              />
            </label>
            <button type="button" title="Add repository" disabled={!repositoryUrl.trim()} onClick={onAddRepository}>
              <Plus size={15} />
            </button>
          </div>
          {repositoryError ? <div className="error-box">{repositoryError}</div> : null}
          {repositoryCatalogError ? <div className="error-box">{repositoryCatalogError}</div> : null}
        </>
      ) : (
        <div className="workspace-repository-progress-summary">{progress?.phase === 'complete' ? 'Workspace created.' : 'Creating workspace.'}</div>
      )}
      {repositoryCatalogLoading ? (
        <div className="workspace-repository-empty workspace-repository-loading">
          <Loader2 size={15} />
          <span>Loading Apple OSS repositories...</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="workspace-repository-empty">No repositories listed.</div>
      ) : (
        <div className="workspace-repository-list">
          {progress
            ? progress.repositories.map((repository) => (
                <div className="workspace-repository-item" key={repository.repositoryUrl}>
                  <div className="workspace-repository-main">
                    <strong>{repository.label}</strong>
                    <span>{repository.repositoryUrl}</span>
                  </div>
                </div>
              ))
            : repositories.map((repository) => {
                const repositoryContent = (
                  <div className="workspace-repository-main">
                    <strong>{repository.label}</strong>
                    <span title={repository.url}>{repository.url}</span>
                    {repository.archived ? <em>Archived</em> : null}
                  </div>
                );
                return (
                  <div
                    className={`workspace-repository-item ${repository.candidateIndex !== null ? 'has-selection' : ''}`}
                    key={`${repository.assetIndex ?? `candidate-${repository.candidateIndex}`}:${repository.url}`}
                  >
                    {repository.candidateIndex !== null ? (
                      <label className="workspace-repository-selection">
                        <input
                          type="checkbox"
                          checked={repository.selected}
                          aria-label={`Include ${repository.label}`}
                          onChange={(event) => onSelectRepository(repository.candidateIndex!, event.target.checked)}
                        />
                        {repositoryContent}
                      </label>
                    ) : (
                      repositoryContent
                    )}
                    {repository.assetIndex !== null ? (
                      <button type="button" title="Remove repository" onClick={() => onRemoveRepository(repository.assetIndex!)}>
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
        </div>
      )}
    </aside>
  );
}
