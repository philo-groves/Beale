import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readHoneycrispReport } from '../src/main/honeycrispReport';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('Honeycrisp reports', () => {
  it('reads the complete Markdown document', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-report-'));
    directories.push(directory);
    const path = join(directory, 'report.md');
    writeFileSync(path, '# Result\n\nA readable explanation.\n');
    expect(readHoneycrispReport(path, 'report_one')).toEqual({
      reportId: 'report_one',
      content: '# Result\n\nA readable explanation.\n'
    });
  });
});
