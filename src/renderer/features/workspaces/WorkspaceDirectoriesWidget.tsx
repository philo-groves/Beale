import { useState, type JSX } from 'react';
import { Folder, Plus, Trash2 } from 'lucide-react';
import type { WorkspaceDirectorySelection } from '@shared/types';
import { errorMessage } from '../../lib/errors';
import { compactUserPath } from '../../lib/paths';

export function WorkspaceDirectoriesWidget({
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
              {index === 0 ? <small>Primary</small> : null}
              <button
                aria-label={`Remove workspace directory ${directory}`}
                disabled={disabled || !removable}
                onClick={() => removeDirectory(directory)}
                title={locked ? 'The primary storage directory cannot be removed.' : removable ? 'Remove directory' : 'A workspace requires at least one directory.'}
                type="button"
              >
                <Trash2 aria-hidden="true" size={13} />
              </button>
            </div>
          );
        })}
        {directories.length === 0 ? <p>Select at least one directory.</p> : null}
      </div>
      {error ? <p className="workspace-directories-error" role="alert">{error}</p> : null}
    </section>
  );
}

function directoryKey(directory: string): string {
  return directory.replace(/[\\/]+$/u, '').toLowerCase();
}
