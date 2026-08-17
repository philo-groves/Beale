import { describe, expect, it } from 'vitest';
import type { RunRow } from '@shared/types';
import { isUntrackedResourceSession } from '../src/main/workspaceRegistry';

function row(resourceContext?: Record<string, unknown>): RunRow {
  return {
    engine: 'honeycrisp',
    sessionRuns: [],
    run: {
      id: 'run_one',
      scopeVersionId: 'scope_one',
      researchProfileSnapshotId: null,
      shellSafetyMode: 'auto_review',
      mode: 'reporting',
      status: 'active',
      title: 'Report session',
      promptMarkdown: 'Refine a report.',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      targetAssetId: null,
      targetPath: null,
      budget: resourceContext ? { resourceContext } : {},
      summary: '',
      finalDisposition: null,
      createdAt: '2026-08-16T12:00:00.000Z',
      startedAt: '2026-08-16T12:00:00.000Z',
      endedAt: null
    }
  };
}

describe('report session tracking', () => {
  it('keeps report work sessions out of the workspace research session registry', () => {
    expect(isUntrackedResourceSession(row({ kind: 'report', resourceId: 'report_one' }))).toBe(true);
    expect(isUntrackedResourceSession(row())).toBe(false);
    expect(isUntrackedResourceSession(row({ kind: 'runbook', resourceId: 'runbook_one' }))).toBe(false);
  });
});
