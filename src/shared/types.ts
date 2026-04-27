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

export type RunEngineKind = 'fake' | 'openai_responses' | 'executor_alpha';

export type OpenAiAuthSource = 'oauth_command' | 'oauth_bearer_env' | 'api_key_env' | 'not_configured';

export type OpenAiTransport = 'websocket' | 'sse_http';

export type ExecutorProviderKind = 'fake' | 'vmctl';

export type ExecutorNetworkProfile = 'offline' | 'scoped' | 'elevated';

export interface ExecutorStatus {
  provider: ExecutorProviderKind;
  configured: boolean;
  available: boolean;
  label: string;
  reason: string | null;
  targetExecution: boolean;
  supportedNetworkProfiles: ExecutorNetworkProfile[];
  supports: {
    snapshots: boolean;
    clone: boolean;
    import: boolean;
    export: boolean;
    shell: boolean;
    python: boolean;
    debugger: boolean;
  };
}

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
  lastWorkspaceBackup: WorkspaceExportResult | null;
}

export interface WorkspaceRecoveryReport {
  recoveredAt: string;
  reason: string;
  interruptedRuns: number;
  interruptedAttempts: number;
  interruptedModelSessions: number;
  interruptedToolCalls: number;
  interruptedVerifierRuns: number;
  interruptedVmContexts: number;
  interruptedBenchmarkRuns: number;
  notes: string[];
}

export interface WorkspacePolicyReview {
  networkProfile: string;
  inScopeAssetCount: number;
  outOfScopeAssetCount: number;
  localImportAssetCount: number;
  credentialReferenceCount: number;
  allowedDestinations: string[];
  warnings: string[];
  liveTargetTestingRequiresApproval: boolean;
}

export interface WorkspaceExportResult {
  kind: 'workspace_backup' | 'evidence_bundle';
  relativePath: string;
  absolutePath: string;
  createdAt: string;
  includesSensitiveData: boolean;
  redactionApplied: boolean;
  userReviewRequired: boolean;
  manifest: Record<string, unknown>;
}

export interface OpenAiAccountStatus {
  configured: boolean;
  source: OpenAiAuthSource;
  label: string;
  credentialHint: string;
  credentialsHostOnly: boolean;
  defaultModel: string;
  defaultReasoningEffort: string;
  supportsWebSocket: boolean;
  preferredTransport: OpenAiTransport;
}

export interface StartRunInput {
  runEngine: RunEngineKind;
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

export interface ModelSessionRecord {
  id: string;
  runId: string;
  provider: string;
  transport: OpenAiTransport;
  previousResponseId: string | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  engine: RunEngineKind;
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
  modelSessions: ModelSessionRecord[];
  policyEvents: ApprovalRecord[];
}

export type BenchmarkSuiteKind = 'smoke' | 'tool_competency' | 'safety_policy' | 'cybergym_compat';

export type BenchmarkTaskMode = 'discovery' | 'reproduction' | 'patch_validation' | 'variant_analysis' | 'benchmark' | 'safety';

export type BenchmarkResultStatus = 'pass' | 'fail' | 'inconclusive';

export interface BenchmarkSuiteSummary {
  suiteKind: BenchmarkSuiteKind;
  suiteId: string;
  title: string;
  taskCount: number;
  benchmarkVersion: string;
}

export interface BenchmarkRunInput {
  suiteKind: BenchmarkSuiteKind;
  model?: string;
  reasoningEffort?: string;
  harnessName?: string;
  harnessVersion?: string;
  promptVersion?: string;
  toolsetVersion?: string;
  verifierVersion?: string;
  sandboxBackend?: string;
  sandboxImageVersion?: string;
  attemptStrategy?: string;
  attemptCount?: number;
  failureTaskIds?: string[];
  dockerImage?: string;
}

export interface BenchmarkHarnessIdentity {
  model: string;
  reasoningEffort: string;
  harnessName: string;
  harnessVersion: string;
  promptVersion: string;
  toolsetVersion: string;
  verifierVersion: string;
  sandboxBackend: string;
  sandboxImageVersion: string;
  networkProfile: string;
  attemptStrategy: string;
  attemptCount: number;
  taskSubsetId: string;
  taskIds: string[];
  benchmarkVersion: string;
  date: string;
  cost: Record<string, unknown>;
  tokens: Record<string, unknown>;
  wallTimeMs: number;
  passCount: number;
  totalCount: number;
  passRate: number;
  smallSampleWarning: string | null;
}

export interface BenchmarkRunRecord {
  id: string;
  suiteKind: BenchmarkSuiteKind;
  suiteId: string;
  status: 'running' | 'completed' | 'failed';
  identity: BenchmarkHarnessIdentity;
  metadata: Record<string, unknown>;
  createdAt: string;
  startedAt: string;
  endedAt: string | null;
}

export interface BenchmarkTaskResultRecord {
  id: string;
  benchmarkRunId: string;
  taskId: string;
  suiteKind: BenchmarkSuiteKind;
  mode: BenchmarkTaskMode;
  status: BenchmarkResultStatus;
  score: number;
  runId: string | null;
  isolationPassed: boolean;
  metrics: Record<string, unknown>;
  graderReport: Record<string, unknown>;
  agentOutput: Record<string, unknown>;
  createdAt: string;
}

export interface BenchmarkComparison {
  baselineRunId: string;
  candidateRunId: string;
  suiteKind: BenchmarkSuiteKind;
  taskSubsetId: string;
  model: string;
  reasoningEffort: string;
  baselineHarness: string;
  candidateHarness: string;
  baselinePassRate: number;
  candidatePassRate: number;
  passRateDelta: number;
  baselinePassCount: number;
  candidatePassCount: number;
  totalCount: number;
  wallTimeDeltaMs: number;
  costDeltaUsd: number;
  compatible: boolean;
  warning: string | null;
}

export interface BenchmarkOverview {
  suites: BenchmarkSuiteSummary[];
  latestRun: BenchmarkRunRecord | null;
  latestResults: BenchmarkTaskResultRecord[];
  recentRuns: BenchmarkRunRecord[];
  comparisons: BenchmarkComparison[];
  isolationSummary: {
    dockerizedAgentHarness: boolean;
    hostSideModelProxy: boolean;
    hostSideGrader: boolean;
    graderFilesMounted: boolean;
    groundTruthMounted: boolean;
    normalVmArchitectureChanged: boolean;
  };
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceSummary;
  openAi: OpenAiAccountStatus;
  executor: ExecutorStatus;
  activeScope: ProgramScopeVersion;
  recovery: WorkspaceRecoveryReport;
  policyReview: WorkspacePolicyReview;
  runs: RunRow[];
  benchmark: BenchmarkOverview;
}

export type WorkspacePickerMode = 'open' | 'create';

export interface WorkspacePickerResult {
  canceled: boolean;
  path: string | null;
}

export interface PriorityFactorInput {
  attackerReachability: number;
  impact: number;
  evidenceConfidence: number;
  exploitPracticality: number;
  scopeConfidence: number;
}

export type SteeringAction =
  | { type: 'pause'; runId: string; note?: string }
  | { type: 'resume'; runId: string; note?: string }
  | { type: 'stop'; runId: string; note?: string }
  | { type: 'fork'; runId: string; instruction: string }
  | { type: 'rerun_verifier'; runId: string; verifierContractId: string; note?: string }
  | { type: 'promote_artifact'; runId: string; artifactId: string; note?: string }
  | { type: 'mark_artifact_sensitive'; runId: string; artifactId: string; note?: string }
  | { type: 'promote_hypothesis'; runId: string; hypothesisId: string; note?: string }
  | { type: 'merge_hypotheses'; runId: string; sourceHypothesisId: string; targetHypothesisId: string; note?: string }
  | { type: 'adjust_priority'; runId: string; hypothesisId: string; factors: PriorityFactorInput; note?: string }
  | { type: 'request_reproduction'; runId: string; hypothesisId: string; note?: string }
  | { type: 'request_patch_validation'; runId: string; hypothesisId?: string; findingId?: string; note?: string }
  | { type: 'mark_finding_false_positive'; runId: string; findingId: string; note?: string }
  | { type: 'mark_finding_out_of_scope'; runId: string; findingId: string; note?: string }
  | { type: 'export_evidence_bundle'; runId: string; findingId?: string; note?: string }
  | { type: 'dismiss_hypothesis'; runId: string; hypothesisId: string; note?: string }
  | { type: 'mark_hypothesis_out_of_scope'; runId: string; hypothesisId: string; note?: string };

export interface BealeApi {
  selectWorkspace(mode: WorkspacePickerMode): Promise<WorkspacePickerResult>;
  openWorkspace(path: string): Promise<WorkspaceSnapshot>;
  createWorkspace(path: string): Promise<WorkspaceSnapshot>;
  getSnapshot(): Promise<WorkspaceSnapshot | null>;
  saveProgramScope(scope: ProgramScopeDraft): Promise<WorkspaceSnapshot>;
  startRun(input: StartRunInput): Promise<WorkspaceSnapshot>;
  runBenchmarkSuite(input: BenchmarkRunInput): Promise<WorkspaceSnapshot>;
  exportWorkspaceBackup(note?: string): Promise<WorkspaceSnapshot>;
  getRunDetail(runId: string): Promise<RunDetail>;
  steerRun(action: SteeringAction): Promise<WorkspaceSnapshot>;
  onSnapshot(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
}
