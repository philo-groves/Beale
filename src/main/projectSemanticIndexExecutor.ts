import { performance } from 'node:perf_hooks';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ProfilingMetricDetail } from '@shared/types';
import type { WorkspaceDatabase } from './database';
import type { ProjectSemanticIndexWorkerInput, ProjectSemanticIndexWorkerMessage } from './projectSemanticIndexWorkerProtocol';

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
      if (this.workerAvailable()) {
        await this.runWorkerRefresh(runtime, scopeVersionId, reason);
      } else {
        await this.runCooperativeRefresh(runtime, scopeVersionId, reason);
      }
    } catch (error) {
      runtime.db.markProjectSemanticIndexingFailed(scopeVersionId, error, reason);
    } finally {
      this.options.emitChange(workspacePath);
    }
  }

  private async runWorkerRefresh(runtime: ProjectSemanticIndexRuntime, scopeVersionId: string, reason: string): Promise<void> {
    const workerPath = this.workerPath();
    if (!workerPath) {
      await this.runCooperativeRefresh(runtime, scopeVersionId, reason);
      return;
    }

    const worker = new Worker(workerPath, {
      workerData: {
        databasePath: runtime.db.getDatabasePath(),
        artifactRoot: runtime.db.getArtifactRoot(),
        workspacePath: runtime.workspacePath,
        scopeVersionId,
        reason,
        batchSize: this.batchSize,
        batchDelayMs: this.batchDelayMs
      } satisfies ProjectSemanticIndexWorkerInput
    });

    let settled = false;
    let requeuedForActiveWork = false;

    await new Promise<void>((resolvePromise, rejectPromise) => {
      worker.on('message', (message: ProjectSemanticIndexWorkerMessage) => {
        switch (message.type) {
          case 'timing':
            this.options.recordTiming(message.name, message.durationMs, message.detail);
            break;
          case 'progress':
            this.options.emitChange(runtime.workspacePath);
            if (this.options.hasActiveWork(runtime) && !requeuedForActiveWork) {
              requeuedForActiveWork = true;
              runtime.db.queueProjectSemanticIndex(scopeVersionId, reason);
              this.schedule(scopeVersionId, reason, runtime.workspacePath, this.activeRetryDelayMs);
              worker.postMessage({ type: 'cancel' });
            }
            break;
          case 'completed':
            settled = true;
            this.options.emitChange(runtime.workspacePath);
            resolvePromise();
            break;
          case 'canceled':
            settled = true;
            if (!requeuedForActiveWork) {
              runtime.db.queueProjectSemanticIndex(scopeVersionId, reason);
            }
            this.options.emitChange(runtime.workspacePath);
            resolvePromise();
            break;
          case 'error':
            settled = true;
            rejectPromise(new Error(message.message));
            break;
          default: {
            const exhaustive: never = message;
            rejectPromise(new Error(`Unknown semantic index worker message: ${JSON.stringify(exhaustive)}`));
          }
        }
      });
      worker.on('error', (error) => {
        if (!settled) rejectPromise(error);
      });
      worker.on('exit', (code) => {
        if (!settled && code !== 0) {
          rejectPromise(new Error(`Semantic index worker exited with status ${code}`));
        } else if (!settled) {
          resolvePromise();
        }
      });
    }).finally(() => {
      worker.removeAllListeners();
    });
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

  private workerAvailable(): boolean {
    return Boolean(this.workerPath());
  }

  private workerPath(): string | null {
    if (process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test') return null;
    const candidate = join(__dirname, 'projectSemanticIndexWorker.js');
    return existsSync(candidate) ? candidate : null;
  }
}

function semanticIndexJobKey(workspacePath: string, scopeVersionId: string): string {
  return `${resolve(workspacePath)}::${scopeVersionId}`;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolveSleep) => setTimeout(resolveSleep, ms)) : Promise.resolve();
}
