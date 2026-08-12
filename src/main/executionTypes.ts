export type ToolOperationKind = 'shell' | 'python';
export type ToolExecutionStatus = 'success' | 'failure' | 'timeout' | 'policy_blocked' | 'executor_error';

export interface ToolExecutionRequest {
  operationKind: ToolOperationKind;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  expectedOutput: 'summary' | 'artifact';
}

export interface ToolCandidateArtifact {
  path: string;
  kind: string;
  mimeType: string;
  sensitivity: string;
  modelVisible: boolean;
  contentBase64?: string;
  summary?: string;
}

export interface ToolExecutionResult {
  status: ToolExecutionStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  structured: Record<string, unknown>;
  candidateArtifacts: ToolCandidateArtifact[];
  contaminated: boolean;
  error: string | null;
}
