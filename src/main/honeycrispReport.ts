import { readFileSync, statSync } from 'node:fs';
import type { HoneycrispReportDocument } from '@shared/types';

const MAX_REPORT_BYTES = 2 * 1024 * 1024;

export function readHoneycrispReport(path: string, reportId: string): HoneycrispReportDocument {
  if (statSync(path).size > MAX_REPORT_BYTES) throw new Error(`Report artifact is too large to display: ${reportId}`);
  return { reportId, content: readFileSync(path, 'utf8') };
}
