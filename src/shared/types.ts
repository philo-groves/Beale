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

export type SessionDispositionOutcome =
  | 'objective_achieved'
  | 'objective_partially_achieved'
  | 'blocked'
  | 'inconclusive'
  | 'failed'
  | 'stopped';

export type SessionBlockerDependencyKind =
  | 'user_input'
  | 'credentials'
  | 'authorization'
  | 'source_material'
  | 'environment'
  | 'network_access'
  | 'external_service'
  | 'target_state'
  | 'other';

export interface SessionBlockerDependency {
  kind: SessionBlockerDependencyKind;
  description: string;
  requiredState: string;
  external: boolean;
}

export interface SessionFinalDisposition {
  outcome: SessionDispositionOutcome;
  summary: string;
  blockerDependencies: SessionBlockerDependency[];
  externalStateRequired: boolean;
  source: 'agent' | 'host' | 'fixture' | 'migration';
  recordedAt: string;
}

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
  | 'research_event'
  | 'verifier_result'
  | 'network_event';

export type FixtureScenario = 'multi_branch_trace' | 'source_review' | 'crash_artifact' | 'scope_block' | 'verifier_pass';

export type RunEngineKind = 'honeycrisp' | 'fixture';

export type ShellSafetyMode = 'manual_approval' | 'auto_review' | 'danger';

export type OpenAiAuthSource = 'oauth_command' | 'oauth_bearer_env' | 'codex_oauth_file' | 'api_key_env' | 'not_configured';

export type OpenAiTransport = 'websocket' | 'sse_http' | 'host_process';

export type OpenAiAuthReadiness = 'oauth_ready' | 'development_fallback' | 'oauth_command_failed' | 'not_configured';

export type OpenAiOnboardingStepStatus = 'complete' | 'current' | 'blocked' | 'warning';

export interface OpenAiOnboardingStep {
  id: string;
  label: string;
  status: OpenAiOnboardingStepStatus;
  detail: string;
  command: string | null;
}

export type ExecutorProviderKind = 'host';

export type ExecutorNetworkProfile = 'offline' | 'scoped' | 'elevated';

export type ExecutorBackendKind = never;

export interface VmPreference {
  enabled: boolean;
  backendKind: ExecutorBackendKind | null;
  updatedAt: string | null;
}

export interface ExecutorBackendStatus {
  kind: ExecutorBackendKind;
  label: string;
  platform: 'linux' | 'win32' | 'darwin' | 'any';
  configured: boolean;
  available: boolean;
  recommended: boolean;
  reason: string | null;
}

export interface ExecutorStatus {
  provider: ExecutorProviderKind;
  configured: boolean;
  available: boolean;
  label: string;
  reason: string | null;
  targetExecution: boolean;
  supportedNetworkProfiles: ExecutorNetworkProfile[];
  metadata?: Record<string, unknown>;
  supports: {
    snapshots: boolean;
    clone: boolean;
    import: boolean;
    export: boolean;
    shell: boolean;
    python: boolean;
    debugger: boolean;
  };
  backends: ExecutorBackendStatus[];
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

export interface WorkspaceScopeDraft {
  workspaceName: string;
  scopeOwner: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  expiresAt: string | null;
  assets: ScopeAssetInput[];
}

export interface WorkspaceScopeVersion {
  id: string;
  version: number;
  status: 'active' | 'archived';
  workspaceName: string;
  scopeOwner: string;
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
  executionPostureLabel: string;
  lastWorkspaceBackup: WorkspaceExportResult | null;
  hostEnvironment: HostEnvironment;
}

export interface HostEnvironment {
  platform: 'linux' | 'win32' | 'darwin' | 'other';
  osLabel: string;
  isWsl: boolean;
  remoteName: string | null;
}

export interface WindowChromeState {
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface ZoomState {
  level: number;
  percent: number;
}

export type NativeMenuAction = 'new_research_workspace' | 'paste_steering';

export type ProfilingMetricValue = string | number | boolean | null | undefined;
export type ProfilingMetricDetail = Record<string, ProfilingMetricValue>;

export interface ProfilingRenderReportRow {
  surface: string;
  renders: number;
  lastRender: number;
  detail: ProfilingMetricDetail;
}

export interface ProfilingTimingReportRow {
  name: string;
  count: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
  detail: ProfilingMetricDetail;
}

export interface ProfilingEventReportRow {
  name: string;
  count: number;
  detail: ProfilingMetricDetail;
}

export interface ProfilingReport {
  enabled: boolean;
  empty: boolean;
  reason: 'manual' | 'interval' | 'disabled';
  generatedAt: string;
  renders: ProfilingRenderReportRow[];
  timings: ProfilingTimingReportRow[];
  events: ProfilingEventReportRow[];
}

export interface ProfilingState {
  enabled: boolean;
  outputPath: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  lastReportAt: string | null;
  reportCount: number;
}

export interface WorkspaceRegistryEntry {
  id: string;
  workspacePath: string;
  workspaceId: string;
  workspaceName: string;
  scopeOwner: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  runCount: number;
  lastRunAt: string | null;
}

export interface ResearchSessionSummary {
  id: string;
  registryWorkspaceId: string;
  workspacePath: string;
  workspaceId: string;
  runId: string;
  title: string;
  status: RunStatus;
  runEngine: RunEngineKind;
  mode: string;
  promptMarkdown: string;
  summary: string;
  finalDisposition: SessionFinalDisposition | null;
  model: string;
  reasoningEffort: string;
  networkProfile: string;
  sandboxProfile: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

export interface SessionTranscriptSearchInput {
  query: string;
  limit?: number;
  currentWorkspaceOnly?: boolean;
}

export interface SessionTranscriptSearchResult {
  registryWorkspaceId: string;
  workspacePath: string;
  runId: string;
  transcriptMessageId: string;
  traceEventId: string | null;
  role: TranscriptRole;
  source: string;
  sessionTitle: string;
  workspaceName: string;
  contentPreview: string;
  createdAt: string;
}

export interface SessionTranscriptSearchWorkspaceSummary {
  registryWorkspaceId: string;
  workspacePath: string;
  workspaceName: string;
  totalTranscriptMatches: number;
}

export interface SessionTranscriptSearchResponse {
  results: SessionTranscriptSearchResult[];
  totalTranscriptMatches: number;
  workspaceCount: number;
  workspaces: SessionTranscriptSearchWorkspaceSummary[];
}

export interface ProjectInventorySummary {
  scopeVersionId: string;
  itemCount: number;
  fileCount: number;
  manifestCount: number;
  binaryCount: number;
  indexedAt: string | null;
}

export interface ProjectInventoryRefreshReport extends ProjectInventorySummary {
  rootCount: number;
  skippedCount: number;
  truncated: boolean;
}

export interface ProjectStructureSummary {
  scopeVersionId: string;
  status: string;
  entityCount: number;
  relationCount: number;
  indexedFileCount: number;
  unresolvedRelationCount: number;
  truncatedEntityCount: number;
  definitionCount: number;
  routeCount: number;
  importCount: number;
  indexedAt: string | null;
}

export interface ProjectGraphSummary {
  scopeVersionId: string;
  status: string;
  nodeCount: number;
  edgeCount: number;
  structuralEdgeCount: number;
  unresolvedEdgeCount: number;
  expectedNodeCount: number;
  staleReasons: string[];
  rebuildReason: string | null;
  buildCount: number;
  nodeFamilyCounts: Record<string, number>;
  edgeFamilyCounts: Record<string, number>;
  extractionFamilyCounts: Record<string, number>;
  indexedAt: string | null;
}

export interface WorkspaceGraphVisualizationNode {
  id: string;
  nodeKind: string;
  entityType: string;
  entityId: string;
  label: string;
  sourcePath: string | null;
  degree: number;
  indexedAt: string;
}

export interface WorkspaceGraphVisualizationEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeKind: string;
  targetLabel: string;
  indexedAt: string;
}

export interface WorkspaceGraphVisualization {
  scopeVersionId: string;
  status: string;
  nodeCount: number;
  edgeCount: number;
  sampledNodeCount: number;
  sampledEdgeCount: number;
  truncated: boolean;
  nodes: WorkspaceGraphVisualizationNode[];
  edges: WorkspaceGraphVisualizationEdge[];
  generatedAt: string;
}

export interface WorkspaceGraphProjectionNode extends WorkspaceGraphVisualizationNode {
  clusterIds: string[];
  qualityFlags: string[];
  pathLabel: string;
  repositoryLabel: string | null;
  sourceGroupLabel: string | null;
}

export interface WorkspaceGraphProjectionEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string | null;
  edgeKind: string;
  targetEntityType: string;
  targetEntityId: string | null;
  targetLabel: string;
  clusterIds: string[];
  qualityFlags: string[];
  indexedAt: string;
}

export interface WorkspaceGraphProjectionCluster {
  id: string;
  kind: 'repository' | 'source_group' | 'entity_family' | 'relationship_family' | 'repeated_label' | 'quality';
  label: string;
  nodeCount: number;
  edgeCount: number;
  qualityFlags: string[];
  parentId: string | null;
}

export interface WorkspaceGraphProjectionDiagnostics {
  nodeCount: number;
  edgeCount: number;
  resolvedEdgeCount: number;
  unresolvedEdgeCount: number;
  selfEdgeCount: number;
  genericLabelNodeCount: number;
  repeatedLabelNodeCount: number;
  testOrDocNodeCount: number;
  nodeFamilyCounts: Record<string, number>;
  edgeFamilyCounts: Record<string, number>;
  repositoryCounts: Record<string, number>;
  sourceGroupCounts: Record<string, number>;
  genericLabelCounts: Record<string, number>;
  repeatedLabelCounts: Record<string, number>;
  qualityFlagCounts: Record<string, number>;
}

export interface WorkspaceGraphProjection {
  scopeVersionId: string;
  status: string;
  nodes: WorkspaceGraphProjectionNode[];
  edges: WorkspaceGraphProjectionEdge[];
  clusters: WorkspaceGraphProjectionCluster[];
  diagnostics: WorkspaceGraphProjectionDiagnostics;
  generatedAt: string;
}

export interface ProjectSemanticSummary {
  scopeVersionId: string;
  enabled: boolean;
  status: 'disabled' | 'empty' | 'queued' | 'indexing' | 'ready' | 'stale' | 'error' | 'canceled';
  provider: string;
  model: string;
  remoteEmbeddingEnabled: boolean;
  chunkCount: number;
  embeddedChunkCount: number;
  sourceDocumentCount: number;
  indexedSourceDocumentCount: number;
  indexSizeBytes: number;
  lastRefreshDurationMs: number | null;
  namespaceCounts: Record<string, number>;
  indexedAt: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  jobReason: string | null;
  lastError: string | null;
  progressProcessed: number | null;
  progressTotal: number | null;
}

export type HoneycrispMemoryStatus = 'missing' | 'empty' | 'ready' | 'error';

export interface HoneycrispMemoryDirectorySummary {
  name: 'artifacts';
  path: string;
  purpose: string;
  exists: boolean;
  entryCount: number;
}

export type HoneycrispMemorySource = 'none' | 'honeycrisp_sqlite';

export interface HoneycrispMemoryEvidenceRefSummary {
  id: string;
  kind: 'code' | 'artifact' | 'command' | 'url' | 'human_note' | string;
  pathBase: string | null;
  path: string | null;
  locator: Record<string, unknown>;
  summary: string;
  createdAt: string;
}

export interface HoneycrispMemoryNodeSummary {
  id: string;
  sessionIds: string[];
  workspaces: Array<{ id: string; name: string }>;
  subjectId: string;
  subjectName: string;
  type: string;
  title: string;
  summary: string;
  body: string;
  status: string;
  confidence: number;
  assetIds: string[];
  tags: string[];
  attributes: Record<string, unknown>;
  evidenceRefs: HoneycrispMemoryEvidenceRefSummary[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface HoneycrispMemoryEdgeSummary {
  fromId: string;
  toId: string;
  relation: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface HoneycrispRunbookSummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  subjectId: string | null;
  subjectName: string | null;
  sessionId: string | null;
  title: string;
  purpose: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  artifactId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface HoneycrispRunbookOutput {
  kind: 'stream' | 'display' | 'error';
  text: string;
  streamName: 'stdout' | 'stderr' | null;
  mimeType: string | null;
}

export interface HoneycrispRunbookCell {
  id: string;
  type: 'markdown' | 'code' | 'raw';
  source: string;
  language: string | null;
  executionCount: number | null;
  outputs: HoneycrispRunbookOutput[];
}

export interface HoneycrispRunbookDocument {
  runbookId: string;
  nbformat: 4;
  nbformatMinor: number;
  language: string | null;
  cells: HoneycrispRunbookCell[];
}

export type MemoryDreamingAction = 'prune' | 'merge_duplicates' | 'revise' | 'reclassify';

export interface MemoryDreamingChangeSummary {
  id: string;
  runId: string;
  action: MemoryDreamingAction;
  title: string;
  nodeType: string;
  hiddenNodeIds: string[];
  survivorNodeId: string | null;
  reason: string;
  createdAt: string;
  restoredAt: string | null;
  canRestore: boolean;
}

export interface MemoryDreamingRunSummary {
  id: string;
  status: 'completed' | 'restored' | 'failed';
  model: string;
  reasoningEffort: string;
  inputNodeCount: number;
  inputSessionCount: number;
  prunedNodeCount: number;
  duplicateHiddenCount: number;
  duplicateGroupCount: number;
  reclassifiedNodeCount: number;
  editedNodeCount: number;
  createdAt: string;
  completedAt: string;
  restoredAt: string | null;
  errorMessage: string | null;
}

export interface MemoryDreamingSummary {
  available: boolean;
  scope: 'workspace';
  hiddenNodeCount: number;
  restorableChangeCount: number;
  lastRun: MemoryDreamingRunSummary | null;
  changes: MemoryDreamingChangeSummary[];
}

export interface HoneycrispMemorySummary {
  status: HoneycrispMemoryStatus;
  source: HoneycrispMemorySource;
  contextWorkspaceId: string;
  contextSubjectId: string;
  databasePath: string;
  storageRoot: string;
  artifactDirectoryPath: string;
  databaseSizeBytes: number;
  nodeCount: number;
  edgeCount: number;
  evidenceRefCount: number;
  storageArtifactCount: number;
  runbookCount: number;
  latestNodeUpdatedAt: string | null;
  nodeTypeCounts: Record<string, number>;
  nodeStatusCounts: Record<string, number>;
  nodes: HoneycrispMemoryNodeSummary[];
  edges: HoneycrispMemoryEdgeSummary[];
  runbooks: HoneycrispRunbookSummary[];
  dreaming: MemoryDreamingSummary;
  directories: HoneycrispMemoryDirectorySummary[];
  lastError: string | null;
}

export interface HoneycrispToolingToolSummary {
  name: string;
  transportName: string | null;
  actionClasses: string[];
  sideEffects: string[];
  requiredPermissions: string[];
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface HoneycrispToolingSkillSummary {
  id: string;
  version: string | null;
  description: string;
  domainTags: string[];
  source: Record<string, unknown> | null;
  selected: boolean;
  raw: Record<string, unknown>;
}

export interface HoneycrispToolingMcpCapabilitySummary {
  name: string;
  transportName: string | null;
  actionClasses: string[];
  sideEffects: string[];
  requiredPermissions: string[];
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface HoneycrispToolingMcpSummary {
  status: string;
  configPath: string | null;
  configuredServers: string[];
  allowedServers: string[];
  timeoutMs: number | null;
  discoveredCapabilities: HoneycrispToolingMcpCapabilitySummary[];
  deniedCapabilities: Record<string, unknown>[];
  resourceTemplates: Record<string, unknown>[];
  raw: Record<string, unknown>;
}

export interface HoneycrispToolingConfigSummary {
  configPath: string;
  exists: boolean;
  loaded: boolean;
  defaultDisabled: boolean;
  preference: {
    skillDirs: string[];
    selectedSkillIds: string[];
    mcpConfigPath: string | null;
    allowedMcpServers: string[];
    mcpTimeoutMs: number | null;
    raw: Record<string, unknown>;
  };
  raw: Record<string, unknown>;
}

export interface HoneycrispToolingSummary {
  source: 'honeycrisp_cli';
  workspaceRoot: string;
  config: HoneycrispToolingConfigSummary;
  tools: HoneycrispToolingToolSummary[];
  toolFamilies: {
    enabled: string[];
    requested: string[];
    disabled: string[];
  };
  skills: {
    loaded: HoneycrispToolingSkillSummary[];
    selectedIds: string[];
  };
  mcp: HoneycrispToolingMcpSummary;
  raw: Record<string, unknown>;
}

export type HoneycrispToolingConfigUpdate =
  | { type: 'add_skill_dir'; path: string }
  | { type: 'remove_skill_dir'; path: string }
  | { type: 'select_skill'; id: string }
  | { type: 'deselect_skill'; id: string }
  | { type: 'set_mcp_config_path'; path: string }
  | { type: 'clear_mcp_config_path' }
  | { type: 'allow_mcp_server'; name: string }
  | { type: 'disallow_mcp_server'; name: string }
  | { type: 'set_mcp_timeout_ms'; timeoutMs: number }
  | { type: 'clear_mcp_timeout_ms' };

export interface ProjectSemanticSearchResult {
  chunkId: string;
  scopeVersionId: string;
  runId: string | null;
  sourceDocumentId: string;
  namespace: string;
  entityType: string;
  entityId: string;
  title: string;
  sourcePath: string | null;
  snippet: string;
  score: number;
  vectorScore: number;
  lexicalScore: number;
  titleScore: number;
  namespaceScore: number;
  entityScore: number;
  matchedTerms: string[];
  rankReason: string;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

export interface ProjectSearchResult {
  documentId: string;
  scopeVersionId: string;
  runId: string | null;
  entityType: string;
  entityId: string;
  title: string;
  sourcePath: string | null;
  snippet: string;
  metadata: Record<string, unknown>;
  rank: number;
  updatedAt: string;
}

export interface WorkspaceRegistryState {
  registryPath: string;
  vmPreference: VmPreference;
  workspaces: WorkspaceRegistryEntry[];
  researchSessions: ResearchSessionSummary[];
}

export interface DeveloperSettings {
  developerModeEnabled: boolean;
}

export const MEMORY_NODE_TYPES = [
  'asset',
  'bug',
  'invariant',
  'mitigation',
  'source',
  'sink',
  'hypothesis',
  'primitive',
  'chain',
  'procedure',
  'trajectory'
] as const;

export type MemoryNodeType = (typeof MEMORY_NODE_TYPES)[number];
export type MemoryTypeDescriptions = Record<MemoryNodeType, string>;

export interface MemorySettings {
  typeDescriptions: MemoryTypeDescriptions;
}

export const DEFAULT_MEMORY_TYPE_DESCRIPTIONS = Object.freeze({
  asset: 'A security-relevant component, service, data object, credential, interface, or execution boundary whose compromise or protection matters. Use it to anchor affected ownership and impact; do not use it for arbitrary files with no security role.',
  bug: 'A confirmed historical flaw precedent that predates the current research, backed by a fixed advisory, patch, prior incident, or equivalent evidence. It must identify affected assets and set attributes.historicalPrecedent=true; a flaw established during the current research is a primitive, not a bug.',
  invariant: 'A security property that must remain true across relevant states or transitions. State it as a falsifiable rule whose violation would create security impact, not as a one-off observation.',
  mitigation: 'A concrete product, platform, hardware, policy, or deployment control that prevents or materially constrains exploitation. Record what it blocks and its assumptions; an ordinary validation step is not automatically a mitigation.',
  source: 'An attacker-controlled or lower-trust ingress from which data, control, identity, or state enters the investigated system. Name the trust boundary and reachable input, not merely a function that reads bytes.',
  sink: 'A security-sensitive operation or state transition whose unsafe reachability can produce impact, such as memory access, code execution, authorization, disclosure, or persistence. Name the dangerous effect and required conditions.',
  hypothesis: 'A specific, testable, currently unproven security proposition. Keep it draft or suspected while active, reject it when disproven, and reclassify it as a primitive or chain when evidence proves that role; never confirm a hypothesis in place. For a flaw hypothesis, record the suspected mechanism in attributes.rootCause and a stable lowercase-hyphenated attributes.rootCauseKey.',
  primitive: 'One independently proven security flaw or exploitation capability established during the current research, with direct code, artifact, command, or verifier evidence. Store the underlying root-cause mechanism, not each symptom, experiment, call site, or copy path, as the unit of identity; record attributes.rootCause and a stable lowercase-hyphenated attributes.rootCauseKey.',
  chain: 'An end-to-end attacker path linking one or more primitives to demonstrated security impact. Record reachability and affected context; source, sink, and asset relationships are ideal when supported but are not required. A confirmed chain requires proof-of-vulnerability evidence and independent review approval; do not use chain for an isolated flaw or an unlinked list of observations. Record its mechanism in attributes.rootCause and a stable lowercase-hyphenated attributes.rootCauseKey.',
  procedure: 'A concise, reusable operational method for performing a bounded research task or verification. Store essential prerequisites and decision points; use a runbook for an executable multi-step command sequence or environment setup.',
  trajectory: 'A reusable sequence of significant research choices and results that explains how an investigation advanced or why a path failed. Omit routine narration and transcripts; preserve the discriminating steps and outcome.'
} satisfies MemoryTypeDescriptions);

export interface ShellOptions {
  defaultConcurrency: number;
  utilities: Record<string, number>;
}

export interface WorkspaceOnboardingDefaults {
  workspacePath: string;
  workspaceName: string;
  scopeOwner: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  expiresAt: string | null;
  assets: ScopeAssetInput[];
}

export interface WorkspaceOnboardingInput extends Omit<WorkspaceOnboardingDefaults, 'assets'> {
  assets?: ScopeAssetInput[];
  onboardingRequestId?: string;
}

export type WorkspaceOnboardingRepositoryStage =
  | 'queued'
  | 'cloning'
  | 'clone_skipped'
  | 'clone_failed'
  | 'index_queued'
  | 'indexing'
  | 'index_skipped'
  | 'indexed';

export interface WorkspaceOnboardingRepositoryProgress {
  repositoryUrl: string;
  label: string;
  stage: WorkspaceOnboardingRepositoryStage;
  message: string;
  localPath: string | null;
  error: string | null;
  updatedAt: string;
}

export interface WorkspaceOnboardingProgressUpdate {
  requestId: string;
  workspacePath: string;
  phase: 'creating' | 'repositories' | 'complete';
  repositories: WorkspaceOnboardingRepositoryProgress[];
}

export interface WorkspaceOnboardingSkipInput {
  requestId: string;
  repositoryUrl: string;
  stage: 'clone' | 'index';
}

export interface HackerOneScopeLookupResult {
  handle: string;
  sourceUrl: string;
  workspaceName: string;
  scopeOwner: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  expiresAt: string | null;
  assets: ScopeAssetInput[];
  importedScopeCount: number;
}

export interface WorkspaceDirectorySelection {
  canceled: boolean;
  path: string | null;
  knownWorkspace: WorkspaceRegistryEntry | null;
  requiresOnboarding: boolean;
  defaults: WorkspaceOnboardingDefaults | null;
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
  liveTargetAllowed: boolean;
  liveTargetTestingRequiresApproval: boolean;
  credentialInjectionRequiresApproval: boolean;
}

export interface WorkspaceExportResult {
  kind: 'workspace_backup';
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
  readiness: OpenAiAuthReadiness;
  statusDetail: string;
  userAction: string | null;
  setupCommand: string | null;
  oauthCommandConfigured: boolean;
  codexCliAvailable: boolean;
  onboardingSteps: OpenAiOnboardingStep[];
}

export interface OpenAiOAuthStartResult {
  started: boolean;
  command: string;
  detail: string;
  verificationUri: string | null;
  userCode: string | null;
  instructions: string | null;
}

export type ResearchProviderId = 'anthropic' | 'xai';

export type ResearchModelProviderId = 'openai-codex' | ResearchProviderId;

export type ResearchModelEffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ResearchProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
  effortLevels: ResearchModelEffortLevel[];
  contextWindow: number;
  maxTokens: number;
}

export interface ResearchProviderModelCatalog {
  providerId: ResearchModelProviderId;
  providerName: string;
  models: ResearchProviderModel[];
}

export interface ResearchModelSelection {
  provider: ResearchModelProviderId;
  model: string;
  reasoningEffort: ResearchModelEffortLevel;
}

export type ResearchProviderReadiness = 'ready' | 'not_configured' | 'unavailable';

export interface ResearchProviderStatus {
  id: ResearchProviderId;
  name: string;
  configured: boolean;
  readiness: ResearchProviderReadiness;
  authMethods: ('api_key' | 'oauth')[];
  credentialType: 'api_key' | 'oauth' | null;
  source: string | null;
  defaultModel: string | null;
  credentialsHostOnly: boolean;
  loginInProgress: boolean;
  statusDetail: string;
  apiKeyEnvironmentVariable: 'ANTHROPIC_API_KEY' | 'XAI_API_KEY';
}

export interface ResearchProviderOAuthStartResult {
  providerId: ResearchProviderId;
  started: boolean;
  command: string;
  detail: string;
  verificationUri: string | null;
  userCode: string | null;
  instructions: string | null;
}

export interface StartRunInput {
  runEngine: RunEngineKind;
  provider?: string;
  shellSafetyMode: ShellSafetyMode;
  goalEnabled: boolean;
  goalObjective: string | null;
  promptMarkdown: string;
  mode: string;
  attemptStrategy: string;
  model: string;
  reasoningEffort: string;
  networkProfile: string;
  sandboxProfile: string;
  targetAssetId?: string | null;
  targetPath?: string | null;
  budget: {
    maxMinutes: number;
    maxAttempts: number;
    maxCostUsd: number;
  };
  fixtureScenario?: FixtureScenario;
}

export interface GeneratedResearchPrompt {
  promptMarkdown: string;
}

export type ResearchGoalPhase = 'discovery' | 'chaining' | 'reporting';

export type ResearchGoalSuggestionGroup = [string, string, string, string];

export interface GeneratedResearchGoalSuggestions {
  phase: ResearchGoalPhase;
  suggestions: ResearchGoalSuggestionGroup;
}

export type ResearchGoalSuggestionsByPhase = Partial<Record<ResearchGoalPhase, ResearchGoalSuggestionGroup>>;

export type ResearchGoalSuggestionStateByPhase<T> = Record<ResearchGoalPhase, T>;

export interface ResearchGoalSuggestionInput {
  phase: ResearchGoalPhase;
  requestId?: string | null;
}

export interface ResearchPromptGenerationUpdate {
  requestId: string;
  promptMarkdown: string;
  reasoningSummary?: string | null;
}

export interface ResearchPromptGenerationInput {
  requestId?: string | null;
  operation?: 'generate' | 'refine' | 'expand_goal';
  researchPhase?: ResearchGoalPhase | null;
  goalSentence?: string | null;
  draftPromptMarkdown?: string | null;
  mode: string;
  attemptStrategy: string;
  model: string;
  reasoningEffort: string;
  networkProfile: string;
  sandboxProfile: string;
  targetAssetId?: string | null;
  targetPath?: string | null;
}

export interface RunRecord {
  id: string;
  scopeVersionId: string;
  shellSafetyMode: ShellSafetyMode;
  mode: string;
  status: RunStatus;
  title: string;
  promptMarkdown: string;
  model: string;
  reasoningEffort: string;
  attemptStrategy: string;
  networkProfile: string;
  sandboxProfile: string;
  targetAssetId: string | null;
  targetPath: string | null;
  budget: Record<string, unknown>;
  summary: string;
  finalDisposition: SessionFinalDisposition | null;
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

export type TranscriptRole = 'user' | 'assistant' | 'system';

export type TranscriptMessagePhase = 'commentary' | 'final_answer';

export interface TranscriptMessageRecord {
  id: string;
  runId: string;
  attemptId: string | null;
  traceEventId: string | null;
  role: TranscriptRole;
  phase?: TranscriptMessagePhase | null;
  contentMarkdown: string;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type NotificationStatus = 'unread' | 'opened' | 'dismissed';

export interface NotificationRecord {
  id: string;
  runId: string;
  traceEventId: string | null;
  kind: 'session_final_response';
  title: string;
  bodyMarkdown: string;
  status: NotificationStatus;
  createdAt: string;
  openedAt: string | null;
  dismissedAt: string | null;
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

export interface VerifierContractRecord {
  id: string;
  runId: string;
  memoryNodeId: string | null;
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

export interface ContextCompactionRecord {
  id: string;
  runId: string;
  attemptId: string | null;
  previousCompactionId: string | null;
  traceEventId: string | null;
  reason: string;
  previousReplayMode: string;
  newReplayMode: string;
  traceRangeSummarized: Record<string, unknown>;
  traceRangeKept: Record<string, unknown>;
  traceHighWaterMark: number;
  tokenPressure: Record<string, unknown>;
  serializedSizeBytes: number;
  redactionPolicyVersion: string;
  summarySource: string;
  representedState: Record<string, unknown>;
  compactedInput: Record<string, unknown>;
  createdAt: string;
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

export type ExportReviewDecision = 'approved' | 'needs_more_evidence' | 'rejected';

export type PolicyReviewRequestKind = 'network_profile_change' | 'credential_injection' | 'host_action' | 'scope_change';
export type PolicyReviewDecision = 'approved' | 'denied';

export type VerifierContractReviewDecision = 'approved' | 'rejected';

export interface VerifierContractEditInput {
  setupStepsMarkdown?: string;
  triggerStepsMarkdown?: string;
  expectedObservations?: Record<string, unknown>;
  invariants?: Record<string, unknown>;
  artifactsToCollect?: Record<string, unknown>;
  passCriteria?: Record<string, unknown>;
}

export interface ExportRecord {
  id: string;
  runId: string;
  memoryNodeId: string | null;
  kind: string;
  relativePath: string;
  status: 'pending_review' | ExportReviewDecision;
  reviewDecision: ExportReviewDecision | null;
  reviewNote: string | null;
  redactionPolicy: Record<string, unknown>;
  includedArtifacts: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
}

export interface RunRow {
  run: RunRecord;
  engine: RunEngineKind;
}

export interface RunDetail {
  run: RunRecord;
  attempts: AttemptRecord[];
  traceEvents: TraceEventRecord[];
  transcriptMessages: TranscriptMessageRecord[];
  artifacts: ArtifactRecord[];
  verifierContracts: VerifierContractRecord[];
  verifierRuns: VerifierRunRecord[];
  vmContexts: VmContextRecord[];
  modelSessions: ModelSessionRecord[];
  contextCompactions: ContextCompactionRecord[];
  policyEvents: ApprovalRecord[];
  exports: ExportRecord[];
  honeycrispMemory?: HoneycrispMemorySummary;
}

export interface RunDetailVersion {
  runId: string;
  version: string;
  generatedAt: string;
  databaseMs: number;
}

export interface RunDetailUpdateCursor {
  afterTraceSequence: number;
  afterTranscriptCount: number;
}

export interface RunDetailUpdate {
  run: RunRecord;
  version: RunDetailVersion;
  attempts: AttemptRecord[];
  traceEvents: TraceEventRecord[];
  transcriptMessages: TranscriptMessageRecord[];
  artifacts: ArtifactRecord[];
  verifierContracts: VerifierContractRecord[];
  verifierRuns: VerifierRunRecord[];
  vmContexts: VmContextRecord[];
  modelSessions: ModelSessionRecord[];
  contextCompactions: ContextCompactionRecord[];
  policyEvents: ApprovalRecord[];
  exports: ExportRecord[];
  honeycrispMemory?: HoneycrispMemorySummary;
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceSummary;
  openAi: OpenAiAccountStatus;
  executor: ExecutorStatus;
  vmPreference: VmPreference;
  activeScope: WorkspaceScopeVersion;
  honeycrispMemory: HoneycrispMemorySummary;
  projectGraph: ProjectGraphSummary;
  projectSemantic: ProjectSemanticSummary;
  recovery: WorkspaceRecoveryReport;
  policyReview: WorkspacePolicyReview;
  runs: RunRow[];
  pendingShellApprovals: ApprovalRecord[];
  notifications: NotificationRecord[];
}

export type WorkspacePickerMode = 'open' | 'create';

export interface WorkspacePickerResult {
  canceled: boolean;
  path: string | null;
}

export type SteeringAction =
  | { type: 'pause'; runId: string; note?: string }
  | { type: 'resume'; runId: string; instruction?: string; modelSelection?: ResearchModelSelection; note?: string }
  | { type: 'stop'; runId: string; note?: string }
  | { type: 'steer'; runId: string; instruction: string; modelSelection?: ResearchModelSelection }
  | { type: 'set_shell_safety_mode'; runId: string; shellSafetyMode: ShellSafetyMode }
  | {
      type: 'review_shell_command';
      workspacePath: string;
      runId: string;
      approvalId: string;
      decision: PolicyReviewDecision;
      note?: string;
    }
  | { type: 'fork'; runId: string; instruction: string }
  | { type: 'restart_from_snapshot'; runId: string; snapshotRef?: string; note?: string }
  | { type: 'update_run_budget'; runId: string; budgetPatch: Partial<StartRunInput['budget']>; note?: string }
  | { type: 'rerun_verifier'; runId: string; verifierContractId: string; note?: string }
  | { type: 'edit_verifier_contract'; runId: string; verifierContractId: string; patch: VerifierContractEditInput; note?: string }
  | { type: 'review_verifier_contract'; runId: string; verifierContractId: string; decision: VerifierContractReviewDecision; note?: string }
  | { type: 'mark_artifact_sensitive'; runId: string; artifactId: string; note?: string }
  | { type: 'export_artifact_bundle'; runId: string; memoryNodeId?: string; note?: string }
  | { type: 'export_research_bundle'; runId: string; memoryNodeId?: string; note?: string }
  | { type: 'export_redacted_trace'; runId: string; memoryNodeId?: string; note?: string }
  | { type: 'generate_report_draft'; runId: string; memoryNodeId?: string; note?: string }
  | { type: 'review_export'; runId: string; exportId: string; decision: ExportReviewDecision; note?: string }
  | { type: 'review_policy_request'; runId: string; requestKind: PolicyReviewRequestKind; decision: PolicyReviewDecision; requestedAction: Record<string, unknown>; note?: string }
  | { type: 'preserve_vm'; runId: string; vmContextId?: string; reason?: string }
  | { type: 'destroy_vm'; runId: string; vmContextId?: string; reason?: string };

export interface BealeApi {
  selectWorkspace(mode: WorkspacePickerMode): Promise<WorkspacePickerResult>;
  selectWorkspaceDirectory(): Promise<WorkspaceDirectorySelection>;
  getWorkspaceRegistry(): Promise<WorkspaceRegistryState>;
  getDeveloperSettings(): Promise<DeveloperSettings>;
  setDeveloperModeEnabled(enabled: boolean): Promise<DeveloperSettings>;
  getMemorySettings(): Promise<MemorySettings>;
  setMemoryTypeDescriptions(descriptions: MemoryTypeDescriptions): Promise<MemorySettings>;
  getShellOptions(): Promise<ShellOptions>;
  setShellOptions(options: ShellOptions): Promise<ShellOptions>;
  lookupHackerOneScope(identifier: string): Promise<HackerOneScopeLookupResult>;
  createScopedWorkspace(input: WorkspaceOnboardingInput): Promise<WorkspaceSnapshot>;
  skipWorkspaceOnboardingRepository(input: WorkspaceOnboardingSkipInput): Promise<WorkspaceOnboardingProgressUpdate | null>;
  onWorkspaceOnboardingUpdate(listener: (update: WorkspaceOnboardingProgressUpdate) => void): () => void;
  openRegisteredWorkspace(registryWorkspaceId: string): Promise<WorkspaceSnapshot>;
  removeRegisteredWorkspace(registryWorkspaceId: string): Promise<WorkspaceSnapshot | null>;
  openWorkspace(path: string): Promise<WorkspaceSnapshot>;
  createWorkspace(path: string): Promise<WorkspaceSnapshot>;
  getSnapshot(): Promise<WorkspaceSnapshot | null>;
  getHostEnvironment(): Promise<HostEnvironment>;
  getOpenAiStatus(): Promise<OpenAiAccountStatus>;
  startOpenAiOAuth(): Promise<OpenAiOAuthStartResult>;
  refreshOpenAiStatus(): Promise<WorkspaceSnapshot>;
  getResearchProviderStatuses(): Promise<ResearchProviderStatus[]>;
  getResearchProviderModelCatalog(): Promise<ResearchProviderModelCatalog[]>;
  startResearchProviderOAuth(providerId: ResearchProviderId): Promise<ResearchProviderOAuthStartResult>;
  getProfilingState(): Promise<ProfilingState>;
  setProfilingEnabled(enabled: boolean): Promise<ProfilingState>;
  recordProfilingReport(report: ProfilingReport): Promise<ProfilingState>;
  openHoneycrispMemoryDirectory(name: HoneycrispMemoryDirectorySummary['name']): Promise<void>;
  getHoneycrispRunbook(runbookId: string): Promise<HoneycrispRunbookDocument>;
  runMemoryDreaming(): Promise<WorkspaceSnapshot>;
  restoreMemoryDreamingChange(changeId: string): Promise<WorkspaceSnapshot>;
  getHoneycrispToolingSummary(): Promise<HoneycrispToolingSummary>;
  updateHoneycrispToolingConfig(update: HoneycrispToolingConfigUpdate): Promise<HoneycrispToolingSummary>;
  generateResearchGoalSuggestions(input: ResearchGoalSuggestionInput): Promise<GeneratedResearchGoalSuggestions>;
  generateResearchPrompt(input?: ResearchPromptGenerationInput): Promise<GeneratedResearchPrompt>;
  cancelResearchPromptGeneration(requestId: string): Promise<void>;
  onResearchPromptGenerationUpdate(listener: (update: ResearchPromptGenerationUpdate) => void): () => void;
  saveScope(scope: WorkspaceScopeDraft): Promise<WorkspaceSnapshot>;
  startRun(input: StartRunInput): Promise<WorkspaceSnapshot>;
  exportWorkspaceBackup(note?: string): Promise<WorkspaceSnapshot>;
  getRunDetail(runId: string): Promise<RunDetail>;
  getRunDetailVersion(runId: string): Promise<RunDetailVersion>;
  getRunDetailUpdate(runId: string, cursor: RunDetailUpdateCursor): Promise<RunDetailUpdate>;
  searchSessionTranscripts(input: SessionTranscriptSearchInput): Promise<SessionTranscriptSearchResponse>;
  steerRun(action: SteeringAction): Promise<WorkspaceSnapshot>;
  openNotification(notificationId: string): Promise<WorkspaceSnapshot>;
  dismissNotification(notificationId: string): Promise<WorkspaceSnapshot>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  getZoomState(): ZoomState;
  zoomIn(): ZoomState;
  zoomOut(): ZoomState;
  getWindowChromeState(): Promise<WindowChromeState>;
  onWindowChromeState(listener: (state: WindowChromeState) => void): () => void;
  onNativeMenuAction(listener: (action: NativeMenuAction) => void): () => void;
  onSnapshot(listener: (snapshot: WorkspaceSnapshot | null) => void): () => void;
  onWorkspaceRegistry(listener: (state: WorkspaceRegistryState) => void): () => void;
}
