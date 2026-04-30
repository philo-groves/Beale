import type { JSX } from 'react';

export function StatusPill({ status }: { status: string }): JSX.Element {
  return <span className={`status-pill status-${status}`}>{status}</span>;
}
