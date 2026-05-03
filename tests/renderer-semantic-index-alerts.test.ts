import { describe, expect, it } from 'vitest';
import type { ProjectSemanticSummary } from '../src/shared/types';
import { semanticIndexAlertBody, shouldSuppressSemanticIndexInfoAlert } from '../src/renderer/view-models/semanticIndexAlerts';

describe('renderer semantic index alert helpers', () => {
  it('suppresses onboarding and first-session research-memory refresh toasts', () => {
    expect(shouldSuppressSemanticIndexInfoAlert(summary({ jobReason: 'onboarding_repository_index' }))).toBe(true);
    expect(shouldSuppressSemanticIndexInfoAlert(summary({ jobReason: 'onboarding_repository_index_stale' }))).toBe(true);
    expect(shouldSuppressSemanticIndexInfoAlert(summary({ jobReason: 'search_document_changed' }))).toBe(true);
    expect(shouldSuppressSemanticIndexInfoAlert(summary({ jobReason: 'search_documents_changed' }))).toBe(true);
    expect(shouldSuppressSemanticIndexInfoAlert(summary({ jobReason: 'manual_rebuild' }))).toBe(false);
  });

  it('describes queued pending documents instead of the full indexed corpus', () => {
    const body = semanticIndexAlertBody(
      summary({
        status: 'queued',
        sourceDocumentCount: 4009,
        indexedSourceDocumentCount: 4007,
        jobReason: 'manual_rebuild'
      }),
      'Supabase'
    );

    expect(body).toContain('2 new or changed search documents');
    expect(body).not.toContain('4,009 source documents are waiting');
  });
});

function summary(overrides: Partial<ProjectSemanticSummary> = {}): ProjectSemanticSummary {
  return {
    scopeVersionId: 'scope_test',
    enabled: true,
    status: 'queued',
    provider: 'local_hash',
    model: 'local_hash_v1',
    remoteEmbeddingEnabled: false,
    chunkCount: 0,
    embeddedChunkCount: 0,
    sourceDocumentCount: 0,
    indexedSourceDocumentCount: 0,
    indexSizeBytes: 0,
    lastRefreshDurationMs: null,
    namespaceCounts: {},
    indexedAt: null,
    queuedAt: '2026-05-03T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    jobReason: null,
    lastError: null,
    progressProcessed: null,
    progressTotal: null,
    ...overrides
  };
}
