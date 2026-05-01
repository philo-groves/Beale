import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import type { ProfilingMetricDetail } from '@shared/types';
import type { WorkspaceDatabase } from './database';

const DEFAULT_SEMANTIC_INDEX_BATCH_SIZE = 25;
const DEFAULT_SEMANTIC_INDEX_BATCH_DELAY_MS = 10;
const DEFAULT_SEMANTIC_INDEX_ACTIVE_RETRY_DELAY_MS = 5000;

export interface ProjectSemanticIndexRuntime {
  workspacePath: string;
  db: WorkspaceDatabase;
}

export interface ProjectSemanticIndexExecutorOptions {
  getRuntime(workspacePath: string): ProjectSemanticIndexRuntime | null;
  hasActiveWork(runtime: ProjectSemanticIndexRuntime): boolean;
  emitChange(workspacePath: string): void;
  recordTiming(name: string, durationMs: number, detail?: ProfilingMetricDetail): void;
  batchSize?: number;
  batchDelayMs?: number;
  activeRetryDelayMs?: number;
}

export class ProjectSemanticIndexExecutor {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly batchSize: number;
  private readonly batchDelayMs: number;
  private readonly activeRetryDelayMs: number;

  public constructor(private readonly options: ProjectSemanticIndexExecutorOptions) {
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_SEMANTIC_INDEX_BATCH_SIZE));
    this.batchDelayMs = Math.max(0, Math.floor(options.batchDelayMs ?? DEFAULT_SEMANTIC_INDEX_BATCH_DELAY_MS));
    this.activeRetryDelayMs = Math.max(0, Math.floor(options.activeRetryDelayMs ?? DEFAULT_SEMANTIC_INDEX_ACTIVE_RETRY_DELAY_MS));
  }

  public schedule(scopeVersionId: string, reason: string, workspacePath: string | null, delayMs = 0): void {
    if (!workspacePath) return;
    const key = semanticIndexJobKey(workspacePath, scopeVersionId);
    if (this.timers.has(key)) return;
    const timer = setTimeout(() => {
      void this.runScheduled(workspacePath, scopeVersionId, reason);
    }, Math.max(0, delayMs));
    timer.unref?.();
    this.timers.set(key, timer);
  }

  public cancel(scopeVersionId: string, workspacePath: string | null): void {
    if (!workspacePath) return;
    this.cancelKey(semanticIndexJobKey(workspacePath, scopeVersionId));
  }

  public cancelWorkspace(workspacePath: string): void {
    const prefix = `${resolve(workspacePath)}::`;
    for (const key of Array.from(this.timers.keys())) {
      if (key.startsWith(prefix)) this.cancelKey(key);
    }
  }

  public resume(runtime: ProjectSemanticIndexRuntime): void {
    const activeScope = runtime.db.getActiveScope();
    const key = semanticIndexJobKey(runtime.workspacePath, activeScope.id);
    if (this.timers.has(key)) return;
    const summary = runtime.db.getProjectSemanticSummary(activeScope.id);
    if (summary.enabled && (summary.status === 'queued' || summary.status === 'indexing')) {
      const reason = summary.status === 'indexing' ? 'resume_interrupted' : summary.jobReason ?? 'resume_queued';
      runtime.db.queueProjectSemanticIndex(activeScope.id, reason);
      this.schedule(activeScope.id, reason, runtime.workspacePath);
    }
  }

  public dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private cancelKey(key: string): void {
    const timer = this.timers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(key);
  }

  private async runScheduled(workspacePath: string, scopeVersionId: string, reason: string): Promise<void> {
    this.timers.delete(semanticIndexJobKey(workspacePath, scopeVersionId));
    const runtime = this.options.getRuntime(workspacePath);
    if (!runtime || !runtime.db.getProjectSemanticIndexEnabled(scopeVersionId)) return;
    if (this.options.hasActiveWork(runtime)) {
      this.schedule(scopeVersionId, reason, workspacePath, this.activeRetryDelayMs);
      return;
    }

    try {
      await this.runCooperativeRefresh(runtime, scopeVersionId, reason);
    } catch (error) {
      runtime.db.markProjectSemanticIndexingFailed(scopeVersionId, error, reason);
    } finally {
      this.options.emitChange(workspacePath);
    }
  }

  private async runCooperativeRefresh(runtime: ProjectSemanticIndexRuntime, scopeVersionId: string, reason: string): Promise<void> {
    const workspacePath = runtime.workspacePath;
    const detail = { workspace: workspacePath.split(/[\\/]/).pop() ?? 'workspace', reason };
    const refresh = this.profile('projectSemantic.refresh.begin', detail, () => runtime.db.beginProjectSemanticIndexRefresh(scopeVersionId, reason));
    this.options.emitChange(workspacePath);
    await sleep(0);

    let processed = 0;
    while (processed < refresh.sourceDocumentCount) {
      if (!runtime.db.getProjectSemanticIndexEnabled(scopeVersionId)) return;
      if (this.options.hasActiveWork(runtime)) {
        runtime.db.queueProjectSemanticIndex(scopeVersionId, reason);
        this.schedule(scopeVersionId, reason, workspacePath, this.activeRetryDelayMs);
        this.options.emitChange(workspacePath);
        return;
      }

      const documents = this.profile('projectSemantic.refresh.loadBatch', { ...detail, processed }, () =>
        runtime.db.listProjectSemanticSourceDocuments(scopeVersionId, this.batchSize, processed)
      );
      if (documents.length === 0) break;
      processed += documents.length;
      this.profile('projectSemantic.refresh.indexBatch', { ...detail, processed, total: refresh.sourceDocumentCount, documents: documents.length }, () =>
        runtime.db.indexProjectSemanticSourceDocuments(scopeVersionId, documents, refresh.indexedAt, processed, refresh.sourceDocumentCount)
      );
      this.options.emitChange(workspacePath);
      await sleep(this.batchDelayMs);
    }

    this.profile('projectSemantic.refresh.finish', detail, () =>
      runtime.db.finishProjectSemanticIndexRefresh(scopeVersionId, refresh.indexedAt, refresh.startedAtMs, refresh.sourceDocumentCount)
    );
  }

  private profile<T>(name: string, detail: ProfilingMetricDetail, operation: () => T): T {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      this.options.recordTiming(name, performance.now() - startedAt, detail);
    }
  }
}

function semanticIndexJobKey(workspacePath: string, scopeVersionId: string): string {
  return `${resolve(workspacePath)}::${scopeVersionId}`;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolveSleep) => setTimeout(resolveSleep, ms)) : Promise.resolve();
}
