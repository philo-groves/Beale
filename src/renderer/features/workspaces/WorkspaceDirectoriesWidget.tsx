import { useState, type JSX } from 'react';
import { CircleDot, Folder, Plus, Trash2 } from 'lucide-react';
import type { WorkspaceDirectorySelection } from '@shared/types';
import { errorMessage } from '../../lib/errors';
import { compactUserPath } from '../../lib/paths';

export function WorkspaceDirectoriesField({
  directories,
  disabled = false,
  lockedDirectory = null,
  onAdd,
  onRemove
}: {
  directories: readonly string[];
  disabled?: boolean;
  lockedDirectory?: string | null;
  onAdd: (selection: WorkspaceDirectorySelection) => Promise<void> | void;
  onRemove: (directory: string) => Promise<void> | void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addDirectory = (): void => {
    setAdding(true);
    setError(null);
    void window.beale.selectWorkspaceDirectory()
      .then(async (selection) => {
        if (!selection.canceled && selection.path) await onAdd(selection);
      })
      .catch((caught: unknown) => setError(errorMessage(caught)))
      .finally(() => setAdding(false));
  };
  const removeDirectory = (directory: string): void => {
    setError(null);
    void Promise.resolve(onRemove(directory)).catch((caught: unknown) => setError(errorMessage(caught)));
  };

  return (
    <div className="settings-form-control-row workspace-overview-control-row workspace-directories-field">
      <span className="settings-form-control-copy">
        <strong>Workspace Directories</strong>
        <small>Local directories included in this workspace.</small>
      </span>
      <div className="workspace-directories-field-control">
        {directories.length > 0 ? (
          <button
            aria-label="Add workspace directory"
            className="workspace-directories-field-add"
            disabled={disabled || adding}
            onClick={addDirectory}
            title="Add workspace directory"
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
          </button>
        ) : null}
        <div
          aria-label="Workspace directories"
          className={`workspace-directories-input-area ${directories.length === 0 ? 'is-empty' : ''}`}
          role="group"
        >
          {directories.length === 0 ? (
            <button
              aria-label="Choose workspace directory"
              className="workspace-directories-empty-input"
              disabled={disabled || adding}
              onClick={addDirectory}
              title="Choose workspace directory"
              type="button"
            >
              <span aria-hidden="true">&nbsp;</span>
            </button>
          ) : directories.map((directory, index) => {
            const locked = lockedDirectory !== null && directoryKey(directory) === directoryKey(lockedDirectory);
            return (
              <div className="workspace-directories-input-row" key={directoryKey(directory)} title={directory}>
                <span className="workspace-directories-input-path">{compactUserPath(directory)}</span>
                {index === 0 ? (
                  <span
                    aria-label="Primary directory"
                    className="workspace-directory-primary-indicator"
                    role="img"
                    title="Primary directory"
                  />
                ) : (
                  <button
                    aria-label={`Remove workspace directory ${directory}`}
                    className="workspace-directories-input-remove"
                    disabled={disabled || locked}
                    onClick={() => removeDirectory(directory)}
                    title={locked ? 'The workspace storage directory cannot be removed.' : 'Remove directory'}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {error ? <p className="workspace-directories-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

export function WorkspaceDirectoriesWidget({
  directories,
  disabled = false,
  lockedDirectory = null,
  onAdd,
  onMakePrimary,
  onRemove
}: {
  directories: readonly string[];
  disabled?: boolean;
  lockedDirectory?: string | null;
  onAdd: (selection: WorkspaceDirectorySelection) => Promise<void> | void;
  onMakePrimary?: (directory: string) => Promise<void> | void;
  onRemove: (directory: string) => Promise<void> | void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addDirectory = (): void => {
    setAdding(true);
    setError(null);
    void window.beale.selectWorkspaceDirectory()
      .then(async (selection) => {
        if (!selection.canceled && selection.path) await onAdd(selection);
      })
      .catch((caught: unknown) => setError(errorMessage(caught)))
      .finally(() => setAdding(false));
  };
  const removeDirectory = (directory: string): void => {
    setError(null);
    void Promise.resolve(onRemove(directory)).catch((caught: unknown) => setError(errorMessage(caught)));
  };
  const makePrimary = (directory: string): void => {
    setError(null);
    void Promise.resolve(onMakePrimary?.(directory)).catch((caught: unknown) => setError(errorMessage(caught)));
  };

  return (
    <section className="workspace-directories-widget" aria-label="Workspace directories">
      <header className="workspace-directories-widget-heading">
        <strong>Directories</strong>
        <button
          aria-label="Add workspace directory"
          disabled={disabled || adding}
          onClick={addDirectory}
          title="Add workspace directory"
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
        </button>
      </header>
      <div className="workspace-directories-list">
        {directories.map((directory, index) => {
          const locked = lockedDirectory !== null && directoryKey(directory) === directoryKey(lockedDirectory);
          const removable = directories.length > 1 && !locked;
          return (
            <div className="workspace-directory-item" key={directoryKey(directory)} title={directory}>
              <Folder aria-hidden="true" size={14} />
              <span>{compactUserPath(directory)}</span>
              <span className="workspace-directory-actions">
                {index === 0 ? (
                  <span
                    aria-label="Primary directory"
                    className="workspace-directory-primary-indicator"
                    role="img"
                    title="Primary directory"
                  />
                ) : onMakePrimary ? (
                  <button
                    aria-label={`Make workspace directory primary ${directory}`}
                    className="workspace-directory-primary-button"
                    disabled={disabled}
                    onClick={() => makePrimary(directory)}
                    title="Make primary directory"
                    type="button"
                  >
                    <CircleDot aria-hidden="true" size={13} />
                  </button>
                ) : (
                  <span aria-hidden="true" className="workspace-directory-action-spacer" />
                )}
                <button
                  aria-label={`Remove workspace directory ${directory}`}
                  disabled={disabled || !removable}
                  onClick={() => removeDirectory(directory)}
                  title={locked ? 'The workspace storage directory cannot be removed.' : removable ? 'Remove directory' : 'A workspace requires at least one directory.'}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              </span>
            </div>
          );
        })}
        {directories.length === 0 ? <p>Select at least one directory.</p> : null}
      </div>
      {error ? <p className="workspace-directories-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function promoteWorkspaceDirectory(directories: readonly string[], directory: string): string[] {
  const promotedKey = directoryKey(directory);
  return [
    ...directories.filter((candidate) => directoryKey(candidate) === promotedKey),
    ...directories.filter((candidate) => directoryKey(candidate) !== promotedKey)
  ];
}

function directoryKey(directory: string): string {
  return directory.replace(/[\\/]+$/u, '').toLowerCase();
}
