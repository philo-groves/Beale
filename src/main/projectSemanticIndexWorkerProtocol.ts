import type { ProfilingMetricDetail, ProjectSemanticSummary } from '@shared/types';

export interface ProjectSemanticIndexWorkerInput {
  databasePath: string;
  artifactRoot: string;
  workspacePath: string;
  scopeVersionId: string;
  reason: string;
  batchSize: number;
  batchDelayMs: number;
  refreshInventory?: boolean;
}

export type ProjectSemanticIndexWorkerMessage =
  | {
      type: 'timing';
      name: string;
      durationMs: number;
      detail: ProfilingMetricDetail;
    }
  | {
      type: 'progress';
      processed: number;
      total: number;
    }
  | {
      type: 'completed';
      summary: ProjectSemanticSummary;
    }
  | {
      type: 'canceled';
    }
  | {
      type: 'error';
      message: string;
      stack?: string;
    };

export interface ProjectSemanticIndexWorkerControlMessage {
  type: 'cancel';
}
