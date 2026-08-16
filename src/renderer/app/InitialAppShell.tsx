import type { JSX } from 'react';

export function InitialAppShell(): JSX.Element {
  return (
    <div className="initial-app-shell" aria-busy="true">
      <header className="initial-app-topbar">
        <span aria-hidden="true" />
        <strong>No Workspace Selected</strong>
      </header>
      <aside className="initial-app-sidebar" aria-hidden="true">
        <span className="initial-app-button" />
        <span className="initial-app-line" />
        <span className="initial-app-line short" />
      </aside>
      <main className="initial-app-workspace" aria-label="Starting Beale">
        <span className="initial-app-spinner" aria-hidden="true" />
        <strong>No Workspace Selected</strong>
        <span role="status" aria-live="polite">Starting Beale…</span>
      </main>
    </div>
  );
}
