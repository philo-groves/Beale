import type { HoneycrispRunbookSummary } from '@shared/types';

export function runbookDescriptionText(value: string): string {
  return value
    .replace(/[ \t]*(?:\r\n|\r|\n)[ \t]*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function runbookCatalogGroups(runbooks: readonly HoneycrispRunbookSummary[]): {
  active: HoneycrispRunbookSummary[];
  archived: HoneycrispRunbookSummary[];
} {
  const active: HoneycrispRunbookSummary[] = [];
  const archived: HoneycrispRunbookSummary[] = [];
  for (const runbook of runbooks) {
    (runbook.status === 'archived' ? archived : active).push(runbook);
  }
  const newestFirst = (left: HoneycrispRunbookSummary, right: HoneycrispRunbookSummary): number =>
    right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
  active.sort(newestFirst);
  archived.sort(newestFirst);
  return { active, archived };
}
