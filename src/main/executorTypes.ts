import type { CreatedRunContext } from './database';
import type { ExecutorNetworkProfile, ExecutorStatus } from '@shared/types';

export type GuestOperationKind = 'shell' | 'python';
export type GuestExecutionStatus = 'success' | 'failure' | 'timeout' | 'policy_blocked' | 'executor_error';

export interface ExecutorCapabilities extends ExecutorStatus {
  protocolVersion: number;
}

export interface GuestContextRequest {
  context: CreatedRunContext;
  imageRef: string;
  snapshotRef: string;
  networkProfile: ExecutorNetworkProfile;
  networkPolicy: GuestNetworkPolicy;
}

export interface GuestNetworkDestination {
  kind: 'domain' | 'host' | 'ip_range' | 'service';
  value: string;
  protocol: string | null;
  port: number | null;
  sourceAssetId: string;
  sensitivity: string;
}

export interface GuestNetworkPolicy {
  profile: ExecutorNetworkProfile;
  scopeVersionId: string;
  allowedDestinations: GuestNetworkDestination[];
  liveTargetAllowed: boolean;
  userApprovalRequired: boolean;
  failClosed: boolean;
  enforcement: 'host_vm_controller';
}

export interface GuestImportSpec {
  hostPath: string;
  guestPath: string;
  mode: 'read_only' | 'copy';
}

export interface GuestExecuteRequest {
  operationKind: GuestOperationKind;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  networkProfile: ExecutorNetworkProfile;
  networkPolicy?: GuestNetworkPolicy;
  telemetry?: GuestExecutionTelemetry;
  expectedOutput: 'summary' | 'artifact';
}

export interface GuestExecutionTelemetry {
  operationId: string;
  runId: string;
  attemptId: string;
  vmContextId: string;
  toolCallId: string;
}

export type GuestExecutionEventPhase =
  | 'container_spawned'
  | 'container_started'
  | 'stdout'
  | 'stderr'
  | 'resource_sample'
  | 'container_finished'
  | 'container_timeout'
  | 'container_cleanup';

export interface GuestExecutionEvent {
  phase: GuestExecutionEventPhase;
  at: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface GuestExecutionObserver {
  onEvent(event: GuestExecutionEvent): void;
}

export interface GuestCandidateArtifact {
  guestPath: string;
  kind: string;
  mimeType: string;
  sensitivity: string;
  modelVisible: boolean;
  contentBase64?: string;
  summary?: string;
}

export interface GuestExecuteResult {
  status: GuestExecutionStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  structured: Record<string, unknown>;
  candidateArtifacts: GuestCandidateArtifact[];
  contaminated: boolean;
  error: string | null;
}

export interface GuestExportRequest {
  guestPath: string;
  kind: string;
  mimeType: string;
  sensitivity: string;
  modelVisible: boolean;
}

export interface GuestExportResult extends GuestCandidateArtifact {
  contentBase64: string;
}

export interface ExecutorProvider {
  getStatus(): ExecutorCapabilities;
  createContext(request: GuestContextRequest): Record<string, unknown>;
  restoreSnapshot(context: CreatedRunContext, snapshotRef: string): Record<string, unknown>;
  cloneContext(context: CreatedRunContext, snapshotRef: string): Record<string, unknown>;
  importWorkspaceMaterial(context: CreatedRunContext, spec: GuestImportSpec): Record<string, unknown>;
  execute(context: CreatedRunContext, request: GuestExecuteRequest): GuestExecuteResult;
  executeAsync?(context: CreatedRunContext, request: GuestExecuteRequest, observer?: GuestExecutionObserver): Promise<GuestExecuteResult>;
  exportArtifact(context: CreatedRunContext, request: GuestExportRequest): GuestExportResult;
  revert(context: CreatedRunContext, snapshotRef: string): Record<string, unknown>;
  preserve(context: CreatedRunContext, reason: string): Record<string, unknown>;
  destroy(context: CreatedRunContext): Record<string, unknown>;
}
