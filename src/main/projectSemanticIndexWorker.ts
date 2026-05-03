import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import type { ProfilingMetricDetail } from '@shared/types';
import { WorkspaceDatabase } from './database';
import type { ProjectSemanticIndexWorkerControlMessage, ProjectSemanticIndexWorkerInput, ProjectSemanticIndexWorkerMessage } from './projectSemanticIndexWorkerProtocol';

const input = workerData as ProjectSemanticIndexWorkerInput;
let canceled = false;

parentPort?.on('message', (message: ProjectSemanticIndexWorkerControlMessage) => {
  if (message?.type === 'cancel') canceled = true;
});

void runWorker();

async function runWorker(): Promise<void> {
  const db = new WorkspaceDatabase(input.databasePath, input.artifactRoot);
  try {
    db.initialize();
    const detail = workerDetail(input);
    if (input.refreshInventory) {
      profile('projectSemantic.worker.refreshInventory', detail, () => db.refreshProjectInventory(input.scopeVersionId));
      post({ type: 'progress', processed: 0, total: 0 });
    }
    const refresh = profile('projectSemantic.worker.begin', detail, () => db.beginProjectSemanticIndexRefresh(input.scopeVersionId, input.reason));
    await sleep(0);

    let processed = 0;
    while (processed < refresh.sourceDocumentCount) {
      if (canceled || !db.getProjectSemanticIndexEnabled(input.scopeVersionId)) {
        post({ type: 'canceled' });
        return;
      }

      const documents = profile('projectSemantic.worker.loadBatch', { ...detail, processed }, () =>
        db.listProjectSemanticSourceDocuments(input.scopeVersionId, input.batchSize, processed)
      );
      if (documents.length === 0) break;
      processed += documents.length;
      profile('projectSemantic.worker.indexBatch', { ...detail, processed, total: refresh.sourceDocumentCount, documents: documents.length }, () =>
        db.indexProjectSemanticSourceDocuments(input.scopeVersionId, documents, refresh.indexedAt, processed, refresh.sourceDocumentCount)
      );
      post({ type: 'progress', processed, total: refresh.sourceDocumentCount });
      await sleep(input.batchDelayMs);
    }

    if (canceled) {
      post({ type: 'canceled' });
      return;
    }

    const summary = profile('projectSemantic.worker.finish', detail, () =>
      db.finishProjectSemanticIndexRefresh(input.scopeVersionId, refresh.indexedAt, refresh.startedAtMs, refresh.sourceDocumentCount)
    );
    post({ type: 'completed', summary });
  } catch (error) {
    try {
      db.markProjectSemanticIndexingFailed(input.scopeVersionId, error, input.reason);
    } catch {
      // Preserve the original worker error for the host process.
    }
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  } finally {
    db.close();
    parentPort?.close();
  }
}

function profile<T>(name: string, detail: ProfilingMetricDetail, operation: () => T): T {
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    post({ type: 'timing', name, durationMs: performance.now() - startedAt, detail });
  }
}

function post(message: ProjectSemanticIndexWorkerMessage): void {
  parentPort?.postMessage(message);
}

function workerDetail(input: ProjectSemanticIndexWorkerInput): ProfilingMetricDetail {
  return {
    workspace: input.workspacePath.split(/[\\/]/).pop() ?? 'workspace',
    reason: input.reason,
    executor: 'worker'
  };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolveSleep) => setTimeout(resolveSleep, ms)) : Promise.resolve();
}
