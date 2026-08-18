import type { JSX } from 'react';

export function CenteredLoadingState({ label, className }: { label: string; className?: string }): JSX.Element {
  return (
    <div className={`centered-loading-state${className ? ` ${className}` : ''}`} role="status" aria-live="polite">
      <span className="centered-loading-state-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
