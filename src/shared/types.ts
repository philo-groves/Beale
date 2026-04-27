export type ScopeAssetDirection = 'in_scope' | 'out_of_scope';

export type ScopeAssetKind =
  | 'domain'
  | 'host'
  | 'ip_range'
  | 'repo'
  | 'binary'
  | 'path'
  | 'account'
  | 'credential_ref'
  | 'service'
  | 'documentation'
  | 'other';

export type RunStatus =
  | 'queued'
  | 'active'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'stopped';

export type AttemptStatus = 'queued' | 'active' | 'paused' | 'blocked' | 'completed' | 'failed' | 'stopped';

export type TraceSource = 'user' | 'model' | 'tool' | 'executor' | 'verifier' | 'policy' | 'system';

export type TraceEventType =
  | 'user_scope'
  | 'user_note'
  | 'model_message'
  | 'tool_call'
  | 'tool_result'
  | 'artifact_created'
  | 'vm_event'
  | 'approval_event'
  | 'hypothesis_event'
  | 'verifier_result'
  | 'finding_event'
  | 'network_event';

export type FakeScenario = 'adaptive_portfolio' | 'source_logic_bug' | 'memory_corruption' | 'policy_block' | 'verified_finding';

export interface ScopeAssetInput {
  direction: ScopeAssetDirection;
  kind: ScopeAssetKind;
  value: string;
  sensitivity: string;
  attributes?: Record<string, unknown>;
}

export interface ScopeAsset extends ScopeAssetInput {
  id: string;
  scopeVersionId: string;
  createdAt: string;
}

export interface ProgramScopeDraft {
  programName: string;
  organizationName: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  expiresAt: string | null;
  assets: ScopeAssetInput[];
}

export interface ProgramScopeVersion {
  id: string;
  version: number;
  status: 'active' | 'archived';
  programName: string;
  organizationName: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  networkPolicy: Record<string, unknown>;
  activeFrom: string;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string;
  assets: ScopeAsset[];
}

export interface WorkspaceSummary {
  workspaceId: string;
  workspacePath: string;
  databasePath: string;
  artifactRoot: string;
  openedAt: string;
  fakeExecutorLabel: string;
}

export interface StartRunInput {
  promptMarkdown: string;
  mode: string;
  attemptStrategy: string;
  model: string;
  reasoningEffort: string;
  networkProfile: string;
  sandboxProfile: string;
  budget: {
    maxMinutes: number;
    maxAttempts: number;
    maxCostUsd: number;
  };
  fakeScenario: FakeScenario;
}

export interface RunRecord {
  id: string;
  scopeVersionId: string;
  mode: string;
  status: RunStatus;
  title: string;
  promptMarkdown: string;
  model: string;
  reasoningEffort: string;
  attemptStrategy: string;
  networkProfile: string;
  sandboxProfile: string;
  budget: Record<string, unknown>;
  summary: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface AttemptRecord {
  id: string;
  runId: string;
  parentAttemptId: string | null;
  status: AttemptStatus;
  shortState: string;
  seed: string;
  strategyRole: string;
  vmContextId: string | null;
  cost: Record<string, unknown>;
  tokenUsage: Record<string, unknown>;
  startedAt: string;
  endedAt: string | null;
}

export interface TraceEventRecord {
  id: string;
  runId: string;
  attemptId: string | null;
  sequence: number;
  type: TraceEventType;
  source: TraceSource;
  summary: string;
  payload: Record<string, unknown>;
  sensitivity: string;
  modelVisible: boolean;
  createdAt: string;
  vmContextId: string | null;
  artifactId: string | null;
  toolCallId: string | null;
  approvalId: string | null;
}

export interface HypothesisRecord {
  id: string;
  runId: string;
  parentHypothesisId: string | null;
  state: string;
  title: string;
  descriptionMarkdown: string;
  component: string;
  bugClass: string;
  priorityScore: number;
  attackerReachability: string;
  impact: string;
  evidenceConfidence: string;
  exploitPracticality: string;
  scopeConfidence: string;
  createdTraceEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  id: string;
  sha256: string;
  relativePath: string;
  kind: string;
  sizeBytes: number;
  mimeType: string;
  sensitivity: string;
  modelVisible: boolean;
  provenanceTraceEventId: string | null;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface FindingRecord {
  id: string;
  runId: string;
  hypothesisId: string | null;
  state: string;
  title: string;
  summaryMarkdown: string;
  affectedAssets: Record<string, unknown>;
  affectedVersions: Record<string, unknown>;
  impactMarkdown: string;
  priorityScore: number;
  verifiedByVerifierRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerifierContractRecord {
  id: string;
  runId: string;
  hypothesisId: string | null;
  findingId: string | null;
  mode: string;
  status: string;
  targetStates: Record<string, unknown>;
  setupStepsMarkdown: string;
  triggerStepsMarkdown: string;
  expectedObservations: Record<string, unknown>;
  invariants: Record<string, unknown>;
  artifactsToCollect: Record<string, unknown>;
  passCriteria: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface VerifierRunRecord {
  id: string;
  contractId: string;
  runId: string;
  attemptId: string | null;
  vmContextId: string | null;
  status: string;
  blockedIssue: string;
  behaviorPreserved: string;
  diagnosticsClean: string;
  regressionTests: string;
  result: Record<string, unknown>;
  startedAt: string;
  endedAt: string | null;
}

export interface VmContextRecord {
  id: string;
  backend: string;
  imageId: string;
  snapshotId: string;
  state: string;
  networkProfile: string;
  scopeVersionId: string;
  createdAt: string;
  destroyedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  attemptId: string | null;
  requestKind: string;
  requestedAction: Record<string, unknown>;
  decision: string;
  reason: string;
  scopeAmendmentId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface RunRow {
  run: RunRecord;
  attemptCount: number;
  latestAttemptState: string;
  topHypothesis: string | null;
  topFinding: string | null;
  verifierState: string | null;
  policyBlocker: string | null;
  artifactCount: number;
  costLabel: string;
}

export interface RunDetail {
  run: RunRecord;
  attempts: AttemptRecord[];
  traceEvents: TraceEventRecord[];
  hypotheses: HypothesisRecord[];
  artifacts: ArtifactRecord[];
  findings: FindingRecord[];
  verifierContracts: VerifierContractRecord[];
  verifierRuns: VerifierRunRecord[];
  vmContexts: VmContextRecord[];
  policyEvents: ApprovalRecord[];
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceSummary;
  activeScope: ProgramScopeVersion;
  runs: RunRow[];
}

export type WorkspacePickerMode = 'open' | 'create';

export interface WorkspacePickerResult {
  canceled: boolean;
  path: string | null;
}

export type SteeringAction =
  | { type: 'pause'; runId: string; note?: string }
  | { type: 'resume'; runId: string; note?: string }
  | { type: 'stop'; runId: string; note?: string }
  | { type: 'fork'; runId: string; instruction: string }
  | { type: 'rerun_verifier'; runId: string; verifierContractId: string; note?: string }
  | { type: 'promote_artifact'; runId: string; artifactId: string; note?: string }
  | { type: 'mark_artifact_sensitive'; runId: string; artifactId: string; note?: string }
  | { type: 'dismiss_hypothesis'; runId: string; hypothesisId: string; note?: string }
  | { type: 'mark_hypothesis_out_of_scope'; runId: string; hypothesisId: string; note?: string };

export interface BealeApi {
  selectWorkspace(mode: WorkspacePickerMode): Promise<WorkspacePickerResult>;
  openWorkspace(path: string): Promise<WorkspaceSnapshot>;
  createWorkspace(path: string): Promise<WorkspaceSnapshot>;
  getSnapshot(): Promise<WorkspaceSnapshot | null>;
  saveProgramScope(scope: ProgramScopeDraft): Promise<WorkspaceSnapshot>;
  startRun(input: StartRunInput): Promise<WorkspaceSnapshot>;
  getRunDetail(runId: string): Promise<RunDetail>;
  steerRun(action: SteeringAction): Promise<WorkspaceSnapshot>;
  onSnapshot(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
}
