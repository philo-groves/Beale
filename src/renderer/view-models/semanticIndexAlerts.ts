import type { ProjectSemanticSummary } from '@shared/types';

const QUIET_SEMANTIC_INDEX_JOB_REASONS = new Set(['onboarding_repository_index', 'onboarding_repository_index_stale', 'search_document_changed', 'search_documents_changed']);

export function semanticIndexRunningKey(summary: ProjectSemanticSummary): string {
  return `${summary.scopeVersionId}:${summary.queuedAt ?? summary.startedAt ?? ''}`;
}

export function shouldSuppressSemanticIndexInfoAlert(summary: ProjectSemanticSummary): boolean {
  return QUIET_SEMANTIC_INDEX_JOB_REASONS.has(summary.jobReason ?? '');
}

export function semanticIndexAlertBody(summary: ProjectSemanticSummary, programName: string): string {
  if (summary.status === 'queued') {
    const pending = semanticPendingDocumentCount(summary);
    const sourceText =
      pending > 0
        ? ` ${pending.toLocaleString()} new or changed search document${pending === 1 ? '' : 's'} are waiting to be indexed.`
        : semanticQueuedRefreshText(summary);
    return `Semantic indexing is queued for ${programName}.${sourceText} Waiting for the background worker to start. Search remains available with exact and stale indexed results.`;
  }
  const progress = semanticIndexProgressText(summary);
  return `Semantic indexing is running for ${programName}.${progress} Search remains available with exact and stale indexed results.`;
}

export function semanticIndexProgressText(summary: ProjectSemanticSummary): string {
  const processed = Math.max(0, typeof summary.progressProcessed === 'number' ? summary.progressProcessed : 0);
  const total = Math.max(0, typeof summary.progressTotal === 'number' ? summary.progressTotal : summary.sourceDocumentCount);
  if (total <= 0) return ` ${processed.toLocaleString()} source documents processed.`;
  const percent = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
  return ` ${processed.toLocaleString()}/${total.toLocaleString()} source documents processed (${percent}%).`;
}

function semanticPendingDocumentCount(summary: ProjectSemanticSummary): number {
  return Math.max(0, summary.sourceDocumentCount - summary.indexedSourceDocumentCount);
}

function semanticQueuedRefreshText(summary: ProjectSemanticSummary): string {
  const total = Math.max(0, summary.progressTotal ?? summary.sourceDocumentCount);
  return total > 0 ? ` The existing ${total.toLocaleString()} search-document index will be refreshed.` : '';
}
