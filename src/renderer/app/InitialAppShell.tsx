import type { JSX } from 'react';
import { BealeWelcomeIcon } from './BealeWelcomeIcon';

export function InitialAppShell(): JSX.Element {
  return (
    <div className="initial-app-shell" aria-busy="false">
      <header className="initial-app-topbar">
        <span aria-hidden="true" />
        <strong>No Workspace Selected</strong>
      </header>
      <aside className="initial-app-sidebar" aria-hidden="true">
        <span className="initial-app-button" />
        <span className="initial-app-line" />
        <span className="initial-app-line short" />
      </aside>
      <main className="initial-app-workspace" aria-label="No workspace selected">
        <BealeWelcomeIcon />
        <strong>No Workspace Selected</strong>
        <span>Choose a known workspace from the sidebar or add one to begin.</span>
      </main>
    </div>
  );
}
