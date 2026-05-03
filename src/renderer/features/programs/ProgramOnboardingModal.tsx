import { useState } from 'react';
import type { JSX } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ProgramOnboardingProgressUpdate, ProgramOnboardingRepositoryProgress } from '@shared/types';
import { Modal } from '../../app/Modal';
import { errorMessage } from '../../lib/errors';
import { emptyDateClass } from '../../lib/formatting';
import {
  addRepositoryToOnboardingForm,
  hasIndexNowRepository,
  onboardingRepositories,
  removeRepositoryFromOnboardingForm,
  setRepositoryIndexNow,
  templateLabel,
  type OnboardingRepository,
  type ProgramOnboardingFormState,
  type ProgramTemplateKind
} from '../../view-models/programOnboarding';

export function ProgramOnboardingModal({
  form,
  busy,
  progress,
  onChange,
  onCancel,
  onLookupHackerOne,
  onSkipRepository,
  onTemplate,
  onSubmit
}: {
  form: ProgramOnboardingFormState;
  busy: boolean;
  progress: ProgramOnboardingProgressUpdate | null;
  onChange: (next: ProgramOnboardingFormState) => void;
  onCancel: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onSkipRepository: (repositoryUrl: string, stage: 'clone' | 'index') => Promise<void>;
  onTemplate: (templateKind: ProgramTemplateKind) => void;
  onSubmit: () => void;
}): JSX.Element {
  const [hackerOneIdentifier, setHackerOneIdentifier] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const update = (key: keyof ProgramOnboardingFormState, value: string): void => {
    onChange({ ...form, [key]: value });
  };
  const canSubmit = form.programName.trim().length > 0;
  const repositories = onboardingRepositories(form);
  const indexNowSelected = hasIndexNowRepository(form);
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
      title="New Program"
      wide
      className="program-onboarding-modal"
      onClose={submitting && !progressComplete ? () => undefined : onCancel}
      footer={
        <div className="program-onboarding-footer-content">
          {indexNowSelected ? <div className="program-onboarding-index-warning">Repository cloning and indexing may take several minutes.</div> : null}
          <div className="program-onboarding-footer-actions">
            <button type="button" disabled={busy || (submitting && !progressComplete)} onClick={onCancel}>
              {submitting ? 'Close' : 'Cancel'}
            </button>
            {submitting ? (
              <button className="primary-button" type="button" disabled={!progressComplete} onClick={onCancel}>
                {progressComplete ? 'Done' : 'Working...'}
              </button>
            ) : (
              <button className="primary-button" type="submit" form="program-onboarding-form" disabled={busy || lookupBusy || !canSubmit}>
                {lookupBusy ? 'Importing Program...' : 'Create Program'}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="program-onboarding-layout">
        <form
          id="program-onboarding-form"
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
          <div className="template-toggle-row" role="group" aria-label="Program template">
            {(['manual', 'hackerone', 'apple', 'msrc'] as ProgramTemplateKind[]).map((templateKind) => (
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
          {form.templateKind === 'hackerone' ? (
            <div className="hackerone-lookup">
              <label>
                Program Identifier
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
              Program name
              <input value={form.programName} disabled={submitting} onChange={(event) => update('programName', event.target.value)} autoFocus />
            </label>
            <label>
              Organization (optional)
              <input value={form.organizationName} disabled={submitting} onChange={(event) => update('organizationName', event.target.value)} />
            </label>
          </div>
          <label>
            Description
            <textarea rows={3} value={form.descriptionMarkdown} disabled={submitting} onChange={(event) => update('descriptionMarkdown', event.target.value)} />
          </label>
          <div className="form-grid">
            <label>
              Network
              <select value={form.networkProfile} disabled={submitting} onChange={(event) => update('networkProfile', event.target.value)}>
                <option value="offline">offline</option>
                <option value="scoped">scoped</option>
                <option value="elevated">elevated</option>
              </select>
            </label>
            <label>
              Authorization expires (empty = never)
              <input type="date" className={emptyDateClass(form.expiresAt)} value={form.expiresAt} disabled={submitting} onChange={(event) => update('expiresAt', event.target.value)} />
            </label>
          </div>
          <label>
            Scope and Rules
            <textarea rows={3} value={form.rulesMarkdown} disabled={submitting} onChange={(event) => update('rulesMarkdown', event.target.value)} />
          </label>
        </form>
        <RepositoryOnboardingPanel
          repositories={repositories}
          progress={progress}
          repositoryError={repositoryError}
          repositoryUrl={repositoryUrl}
          onAddRepository={addRepository}
          onChangeRepositoryUrl={setRepositoryUrl}
          onRemoveRepository={(assetIndex) => onChange(removeRepositoryFromOnboardingForm(form, assetIndex))}
          onSetIndexNow={(assetIndex, indexNow) => onChange(setRepositoryIndexNow(form, assetIndex, indexNow))}
          onSkipRepository={onSkipRepository}
        />
      </div>
    </Modal>
  );
}

function RepositoryOnboardingPanel({
  repositories,
  progress,
  repositoryError,
  repositoryUrl,
  onAddRepository,
  onChangeRepositoryUrl,
  onRemoveRepository,
  onSetIndexNow,
  onSkipRepository
}: {
  repositories: OnboardingRepository[];
  progress: ProgramOnboardingProgressUpdate | null;
  repositoryError: string | null;
  repositoryUrl: string;
  onAddRepository: () => void;
  onChangeRepositoryUrl: (value: string) => void;
  onRemoveRepository: (assetIndex: number) => void;
  onSetIndexNow: (assetIndex: number, indexNow: boolean) => void;
  onSkipRepository: (repositoryUrl: string, stage: 'clone' | 'index') => Promise<void>;
}): JSX.Element {
  const submitting = Boolean(progress);
  const rows = progress ? progress.repositories : repositories;
  return (
    <aside className="program-repository-panel" aria-label="Program repositories">
      <div className="program-repository-header">
        <div>
          <span>Repositories</span>
          <strong>{rows.length}</strong>
        </div>
      </div>
      {!submitting ? (
        <>
          <div className="program-repository-add">
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
        </>
      ) : (
        <div className="program-repository-progress-summary">{progress?.phase === 'complete' ? 'Repository onboarding complete.' : 'Creating program and preparing selected repositories.'}</div>
      )}
      {rows.length === 0 ? (
        <div className="program-repository-empty">No repositories listed.</div>
      ) : (
        <div className="program-repository-list">
          {progress
            ? progress.repositories.map((repository) => <RepositoryProgressItem key={repository.repositoryUrl} repository={repository} onSkipRepository={onSkipRepository} />)
            : repositories.map((repository) => (
                <div className="program-repository-item" key={`${repository.assetIndex}:${repository.url}`}>
                  <div className="program-repository-main">
                    <strong>{repository.label}</strong>
                    <span>{repository.url}</span>
                  </div>
                  <label className="program-repository-index">
                    <input type="checkbox" checked={repository.indexNow} onChange={(event) => onSetIndexNow(repository.assetIndex, event.target.checked)} />
                    <span>Index Now</span>
                  </label>
                  <button type="button" title="Remove repository" onClick={() => onRemoveRepository(repository.assetIndex)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
        </div>
      )}
    </aside>
  );
}

function RepositoryProgressItem({
  repository,
  onSkipRepository
}: {
  repository: ProgramOnboardingRepositoryProgress;
  onSkipRepository: (repositoryUrl: string, stage: 'clone' | 'index') => Promise<void>;
}): JSX.Element {
  const skipStage = repositorySkipStage(repository);
  return (
    <div className={`program-repository-item progress-stage-${repository.stage}`}>
      <div className="program-repository-main">
        <strong>{repository.label}</strong>
        <span>{repository.repositoryUrl}</span>
        <em>{repository.error ? `${repository.message} ${repository.error}` : repository.message}</em>
      </div>
      <span className="program-repository-stage">{progressStageLabel(repository.stage)}</span>
      {skipStage ? (
        <button type="button" className="program-repository-skip-button" onClick={() => void onSkipRepository(repository.repositoryUrl, skipStage)}>
          {skipStage === 'clone' ? 'Clone Later' : 'Index Later'}
        </button>
      ) : null}
    </div>
  );
}

function repositorySkipStage(repository: ProgramOnboardingRepositoryProgress): 'clone' | 'index' | null {
  if (repository.stage === 'queued' || repository.stage === 'cloning' || repository.stage === 'clone_failed') return 'clone';
  if (repository.stage === 'index_queued' || repository.stage === 'indexing') return 'index';
  return null;
}

function progressStageLabel(stage: ProgramOnboardingRepositoryProgress['stage']): string {
  switch (stage) {
    case 'queued':
      return 'Queued';
    case 'cloning':
      return 'Cloning';
    case 'clone_skipped':
      return 'Clone Later';
    case 'clone_failed':
      return 'Clone Failed';
    case 'index_queued':
      return 'Index Queued';
    case 'indexing':
      return 'Indexing';
    case 'index_skipped':
      return 'Index Later';
    case 'indexed':
      return 'Indexed';
  }
}
