import type { HoneycrispReportSummary } from '@shared/types';

export function reportCatalogGroups(reports: readonly HoneycrispReportSummary[]): {
  complete: HoneycrispReportSummary[];
  stale: HoneycrispReportSummary[];
} {
  const complete: HoneycrispReportSummary[] = [];
  const stale: HoneycrispReportSummary[] = [];
  for (const report of reports) (report.status === 'stale' ? stale : complete).push(report);
  const newestFirst = (left: HoneycrispReportSummary, right: HoneycrispReportSummary): number =>
    right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
  complete.sort(newestFirst);
  stale.sort(newestFirst);
  return { complete, stale };
}
