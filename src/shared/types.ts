import type { ResearchProfileId, ResearchProfileSnapshot, ResolvedResearchProfile } from './researchProfile';

export * from './researchProfile';

export type ScopeAssetDirection = 'in_scope' | 'out_of_scope';

export type ScopeAssetKind =
  | 'domain'
  | 'repo'
  | 'binary'
  | 'service'
  | 'documentation'
  | 'other';

export type LegacyScopeAssetKind = 'path' | 'host' | 'ip_range' | 'account' | 'credential_ref';

export interface ScopeAssetAttributes {
  [key: string]: unknown;
  displayName?: string;
  repositoryUrl?: string;
  clonedDirectory?: string;
  legacyKind?: LegacyScopeAssetKind;
}

export type RunStatus =
  | 'queued'
  | 'active'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'stopped';

export function isLiveResearchRunStatus(status: RunStatus): boolean {
  return status === 'queued' || status === 'active';
}

export type RunTerminationCause = 'safeguard' | 'workspace_recovery';

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
  | 'approval_event'
  | 'research_event'
  | 'verifier_result'
  | 'network_event';

/** Read compatibility for sessions created by the removed fixture engine. */
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

export interface ExecutorStatus {
  provider: ExecutorProviderKind;
  configured: boolean;
  available: boolean;
  label: string;
  reason: string | null;
  targetExecution: boolean;
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
}

export interface ScopeAssetInput {
  direction: ScopeAssetDirection;
  kind: ScopeAssetKind;
  value: string;
  sensitivity: string;
  attributes?: ScopeAssetAttributes;
}

export interface ScopeAsset extends ScopeAssetInput {
  id: string;
  scopeVersionId: string;
  createdAt: string;
}

export const SCOPE_ASSET_KINDS: readonly ScopeAssetKind[] = [
  'domain',
  'repo',
  'binary',
  'service',
  'documentation',
  'other'
];

const LEGACY_SCOPE_ASSET_KINDS: ReadonlySet<string> = new Set([
  'path',
  'host',
  'ip_range',
  'account',
  'credential_ref'
]);

export function scopeAssetLegacyKind(asset: Pick<ScopeAssetInput, 'attributes'>): LegacyScopeAssetKind | null {
  const value = asset.attributes?.legacyKind;
  return typeof value === 'string' && LEGACY_SCOPE_ASSET_KINDS.has(value)
    ? value as LegacyScopeAssetKind
    : null;
}

export function isCredentialReferenceResource(asset: Pick<ScopeAssetInput, 'attributes'>): boolean {
  const legacyKind = scopeAssetLegacyKind(asset);
  return legacyKind === 'account' || legacyKind === 'credential_ref';
}

export function repositoryClonedDirectory(asset: Pick<ScopeAssetInput, 'kind' | 'attributes'>): string | null {
  const value = asset.kind === 'repo' ? asset.attributes?.clonedDirectory : null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface WorkspaceScopeDraft {
  workspaceName: string;
  scopeOwner: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
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
  activeFrom: string;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string;
  assets: ScopeAsset[];
}

export interface WorkspaceSummary {
  workspaceId: string;
  workspacePath: string;
  workspaceDirectories?: string[];
  databasePath: string;
  artifactRoot: string;
  openedAt: string;
  executionPostureLabel: string;
  lastWorkspaceBackup: WorkspaceExportResult | null;
  hostEnvironment: HostEnvironment;
  dejunk: WorkspaceDejunkSummary;
}

export interface WorkspaceDejunkRunSummary {
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
  movedFileCount: number;
  deletedPathCount: number;
  reclaimedBytes: number;
  errorMessage: string | null;
}

export interface WorkspaceDejunkSummary {
  available: boolean;
  /** True while the dashboard is loading the filesystem-backed summary off the initial workspace-open path. */
  loading?: boolean;
  newFileCount: number;
  newFileCountCapped: boolean;
  baselineAt: string;
  lastRun: WorkspaceDejunkRunSummary | null;
}

export interface HostEnvironment {
  platform: 'linux' | 'win32' | 'darwin' | 'other';
  osLabel: string;
  isWsl: boolean;
  remoteName: string | null;
}

export interface WorkspaceRule {
  id: string;
  workspaceId: string;
  text: string;
  createdAt: string;
  createdBy: string;
}

export type WorkspaceEditorId =
  | 'vscode'
  | 'vscode-insiders'
  | 'cursor'
  | 'windsurf'
  | 'visual-studio'
  | 'intellij-idea'
  | 'webstorm'
  | 'pycharm'
  | 'rider'
  | 'sublime-text'
  | 'zed';

export interface WorkspaceEditorSummary {
  id: WorkspaceEditorId;
  name: string;
  iconDataUrl: string | null;
}

export interface WorkspaceEditorCatalog {
  editors: WorkspaceEditorSummary[];
  defaultEditorId: WorkspaceEditorId | null;
}

export interface WorkspaceTerminalStartResult {
  sessionId: string;
  cwd: string;
  shell: string;
}

export interface WorkspaceTerminalDataEvent {
  sessionId: string;
  data: string;
}

export interface WorkspaceTerminalExitEvent {
  sessionId: string;
  exitCode: number;
  signal: number | null;
}

export interface WindowChromeState {
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface ZoomState {
  level: number;
  percent: number;
}

export type NativeMenuAction = 'new_research_workspace';

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
  workspaceDirectories?: string[];
  workspaceId: string;
  workspaceName: string;
  researchProfileId: ResearchProfileId;
  scopeOwner: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
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
  sandboxProfile: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  resultViewedAt: string | null;
  breakoutRooms?: BreakoutRoomSummary[];
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

export type HoneycrispMemoryNodeValidationKind = 'full' | 'scoped' | 'inherited';

export interface HoneycrispMemoryNodeCatalogValidationSummary {
  nodeRevision: number;
  catalogHash: string;
  contentHash: string;
  kind: HoneycrispMemoryNodeValidationKind;
  validatedAt: string;
  researchProfile?: {
    hash: string;
    id: string;
    version: string;
  };
}

export type HoneycrispMemoryNodeProvenanceSummary =
  | {
      state: 'legacy_unrecorded';
      catalogHash: null;
      activeCatalog: false;
      validation: null;
    }
  | {
      state: 'catalog_unvalidated';
      catalogHash: string;
      activeCatalog: boolean;
      validation: null;
    }
  | {
      state: 'active_validated';
      catalogHash: string;
      activeCatalog: true;
      validation: HoneycrispMemoryNodeCatalogValidationSummary;
    }
  | {
      state: 'foreign_validated';
      catalogHash: string;
      activeCatalog: false;
      validation: HoneycrispMemoryNodeCatalogValidationSummary;
    };

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
  /** Missing only on legacy summaries produced before model authorship tracking. */
  authors?: HoneycrispModelAuthor[];
  /** Optional only for compatibility with summaries produced before catalog provenance existed. */
  provenance?: HoneycrispMemoryNodeProvenanceSummary;
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
  revisions: HoneycrispArtifactRevisionSummary[];
  createdAt: string;
  updatedAt: string;
  authors?: HoneycrispModelAuthor[];
}

export interface HoneycrispModelAuthor {
  provider: string;
  model: string;
}

export interface HoneycrispRunbookOutput {
  kind: 'stream' | 'display' | 'error';
  text: string;
  streamName: 'stdout' | 'stderr' | null;
  mimeType: string | null;
}

export interface HoneycrispRunbookExecutionSummary {
  runId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  error: string | null;
  proofTarget: RunbookProofTarget;
  deviceOs: string | null;
}

export type RunbookProofTarget = 'localhost' | 'device' | 'vm' | 'web' | 'other';

export interface RunbookProofTargetSelection {
  proofTarget: RunbookProofTarget;
  deviceOs?: string;
}

export interface HoneycrispRunbookCell {
  id: string;
  type: 'markdown' | 'code' | 'raw';
  source: string;
  language: string | null;
  executionCount: number | null;
  outputs: HoneycrispRunbookOutput[];
  latestRun: HoneycrispRunbookExecutionSummary | null;
}

export interface HoneycrispRunbookDocument {
  runbookId: string;
  nbformat: 4;
  nbformatMinor: number;
  language: string | null;
  revision: number | null;
  latestRun: HoneycrispRunbookExecutionSummary | null;
  cells: HoneycrispRunbookCell[];
}

export interface HoneycrispReportSummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  subjectId: string | null;
  subjectName: string | null;
  sessionId: string | null;
  title: string;
  summary: string;
  status: 'complete' | 'stale';
  artifactId: string;
  submissionPacket: HoneycrispReportSubmissionPacket | null;
  revision: number;
  revisions: HoneycrispArtifactRevisionSummary[];
  createdAt: string;
  updatedAt: string;
  authors?: HoneycrispModelAuthor[];
}

export interface HoneycrispReportDocument {
  reportId: string;
  content: string;
}

export interface HoneycrispReportSubmissionPacket {
  artifactId: string;
  filename: string;
  sizeBytes: number;
  contentHash: string;
}

export interface HoneycrispReportLocator {
  workspaceId: string;
  reportId: string;
}

export type TicketingProviderId = 'github' | 'linear';
export type TicketingMode = 'local' | TicketingProviderId;
export type TicketingCredentialSource = 'managed' | 'environment' | null;

export interface TicketingProviderSettings {
  credentialConfigured: boolean;
  credentialSource: TicketingCredentialSource;
  targetId: string | null;
  targetLabel: string | null;
}

export interface TicketingAutomationSettings {
  humanInTheLoop: boolean;
}

export interface TicketingSettings {
  provider: TicketingMode;
  automation: TicketingAutomationSettings;
  github: TicketingProviderSettings;
  linear: TicketingProviderSettings;
}

export interface TicketingTarget {
  id: string;
  label: string;
}

export interface TicketSubmissionResult {
  provider: TicketingProviderId;
  ticketId: string;
  title: string;
  url: string;
}

export interface ReportResourceContext {
  kind: 'report';
  resourceId: string;
  title?: string;
  artifactId?: string;
  artifactRelativePath?: string;
  revision?: number;
}

export interface ReportSessionStartInput extends HoneycrispReportLocator {
  instruction: string;
  modelSelection?: ResearchModelSelection;
  shellSafetyMode?: ShellSafetyMode;
}

export interface ReportSessionStartResult {
  reportId: string;
  runId: string;
  snapshot: WorkspaceSnapshot;
}

export interface HoneycrispArtifactRevisionSummary {
  revision: number;
  sessionId: string | null;
  createdAt: string;
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

export type MemoryDreamingProgressPhase =
  | 'preparing'
  | 'gathering'
  | 'synthesizing'
  | 'compacting'
  | 'retrying'
  | 'correcting'
  | 'validating'
  | 'applying'
  | 'completed'
  | 'failed';

export interface MemoryDreamingProgressUpdate {
  workspaceId: string;
  phase: MemoryDreamingProgressPhase;
  inputNodeCount: number;
  inputSessionCount: number;
  decisionCount: number;
  updatedAt: string;
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
  /** True while the dashboard loads the Honeycrisp memory summary off the workspace-open path. */
  loading?: boolean;
  status: HoneycrispMemoryStatus;
  source: HoneycrispMemorySource;
  contextWorkspaceId: string;
  contextSubjectId: string;
  activeCatalogHash?: string | null;
  databasePath: string;
  storageRoot: string;
  artifactDirectoryPath: string;
  databaseSizeBytes: number;
  nodeCount: number;
  edgeCount: number;
  evidenceRefCount: number;
  storageArtifactCount: number;
  runbookCount: number;
  reportCount: number;
  latestNodeUpdatedAt: string | null;
  nodeTypeCounts: Record<string, number>;
  nodeStatusCounts: Record<string, number>;
  nodeProvenanceCounts?: Partial<Record<HoneycrispMemoryNodeProvenanceSummary['state'], number>>;
  nodes: HoneycrispMemoryNodeSummary[];
  edges: HoneycrispMemoryEdgeSummary[];
  runbooks: HoneycrispRunbookSummary[];
  reports: HoneycrispReportSummary[];
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
  workspaces: WorkspaceRegistryEntry[];
  researchSessions: ResearchSessionSummary[];
}

export type AgentPluginSourceKind = 'filesystem' | 'repository' | 'builtin';
export type AgentPluginStatus = 'ready' | 'invalid';
export type AgentPluginMcpTransport = 'stdio' | 'streamable-http' | 'sse' | 'unknown';

export interface AgentPluginSource {
  kind: AgentPluginSourceKind;
  path: string;
  repositoryUrl?: string;
}

export interface AgentPluginSkillSummary {
  id: string;
  name: string;
  directoryName: string;
  relativePath: string;
  description: string | null;
}

export interface AgentPluginMcpServerSummary {
  name: string;
  transport: AgentPluginMcpTransport;
  command: string | null;
  url: string | null;
  valid: boolean;
  errors: string[];
}

export interface AgentPluginRecord {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  enabled: boolean;
  status: AgentPluginStatus;
  source: AgentPluginSource;
  installedAt: string;
  updatedAt: string;
  skills: AgentPluginSkillSummary[];
  mcpServers: AgentPluginMcpServerSummary[];
  warnings: string[];
  errors: string[];
}

export interface AgentPluginRegistryState {
  registryPath: string;
  pluginStorePath: string;
  specVersion: string;
  plugins: AgentPluginRecord[];
}

export interface DeveloperSettings {
  developerModeEnabled: boolean;
}

export interface DebuggingSettings {
  tracesEnabled: boolean;
}

export type ComputerUsePermissionMode = 'once_per_session' | 'every_action';

export interface ComputerUseSettings {
  permissionMode: ComputerUsePermissionMode;
}

export interface ProviderSettings {
  defaultProviderId: ResearchModelProviderId | null;
  modelDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>>;
  enabledOptionalModels?: Partial<Record<ResearchModelProviderId, string[]>>;
  disabledOptionalModels?: Partial<Record<ResearchModelProviderId, string[]>>;
  cyberPolicyRiskAcknowledgements?: Partial<Record<ResearchModelProviderId, true>>;
  preferredAuthenticationMethods?: Partial<Record<ResearchModelProviderId, ProviderAuthenticationMethod>>;
}

export type ProviderAuthenticationMethod = 'subscription' | 'api_key';

export interface ProviderModelDefaults {
  largeModel: string;
  smallModel: string;
  reasoningEffort: ResearchModelEffortLevel;
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
  workspaceDirectories?: string[];
  workspaceName: string;
  researchSubjectName?: string;
  scopeOwner: string;
  descriptionMarkdown: string;
  rules: string[];
  expiresAt: string | null;
  assets: ScopeAssetInput[];
}

export interface WorkspaceOnboardingInput extends Omit<WorkspaceOnboardingDefaults, 'assets'> {
  researchProfileId?: ResearchProfileId;
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
  researchSubjectName?: string;
  scopeOwner: string;
  descriptionMarkdown: string;
  rules: string[];
  expiresAt: string | null;
  assets: ScopeAssetInput[];
  importedScopeCount: number;
}

export interface GitHubRepositorySummary {
  name: string;
  url: string;
  archived: boolean;
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
  notes: string[];
}

export interface WorkspacePolicyReview {
  inScopeAssetCount: number;
  outOfScopeAssetCount: number;
  localImportAssetCount: number;
  credentialReferenceCount: number;
  warnings: string[];
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
  subscriptionConfigured: boolean;
  apiKeyConfigured: boolean;
  loginInProgress: boolean;
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

export type ResearchProviderId = 'anthropic' | 'xai' | 'zai' | 'openrouter';

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
  defaultSmallModel?: string;
  models: ResearchProviderModel[];
}

export interface ResearchModelSelection {
  provider: ResearchModelProviderId;
  model: string;
  reasoningEffort: ResearchModelEffortLevel;
}

export type ResearchCollaborationMode = 'solo' | 'adaptive' | 'always';

export type ResearchCollaborationIntensity = 'focused' | 'balanced' | 'deep';

export interface ResearchCollaborationProviderPreference extends ResearchModelSelection {
  enabled: boolean;
}

export interface ResearchCollaborationPreferences {
  mode: ResearchCollaborationMode;
  intensity: ResearchCollaborationIntensity;
  providers: ResearchCollaborationProviderPreference[];
  independentFirstPass: boolean;
  peerChallengeRounds: number;
  maxConcurrentRooms: number;
  maxMembersPerRoom: number;
}

export type ResearchProviderReadiness = 'ready' | 'not_configured' | 'unavailable';

export interface ResearchProviderStatus {
  id: ResearchProviderId;
  name: string;
  configured: boolean;
  subscriptionConfigured: boolean;
  apiKeyConfigured: boolean;
  readiness: ResearchProviderReadiness;
  authMethods: ('api_key' | 'oauth')[];
  credentialType: 'api_key' | 'oauth' | null;
  source: string | null;
  defaultModel: string | null;
  credentialsHostOnly: boolean;
  loginInProgress: boolean;
  statusDetail: string;
  apiKeyEnvironmentVariable: 'ANTHROPIC_API_KEY' | 'XAI_API_KEY' | 'ZAI_API_KEY' | 'OPENROUTER_API_KEY';
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
  workflowId?: string;
  resourceContext?: ReportResourceContext;
  mode: string;
  attemptStrategy: string;
  model: string;
  reasoningEffort: string;
  collaboration?: ResearchCollaborationPreferences;
  sandboxProfile: string;
  targetAssetId?: string | null;
  targetPath?: string | null;
  budget: {
    maxMinutes: number;
    maxAttempts: number;
    maxCostUsd: number;
    repeatSchedule?: RepeatSchedule;
    automationSchedule?: RepeatSchedule;
    modelProvider?: string | null;
    goalEnabled?: boolean;
    goalObjective?: string | null;
    researchWorkflowId?: string | null;
    collaboration?: ResearchCollaborationPreferences | null;
  };
}

export type RepeatSchedule =
  | { type: 'none' }
  | { type: 'minutely'; interval: number }
  | { type: 'hourly'; interval: number }
  | { type: 'daily'; interval: number }
  | { type: 'weekly'; interval: number }
  | { type: 'monthly'; interval: number };

export type ActiveRepeatSchedule = Exclude<RepeatSchedule, { type: 'none' }>;

export interface AutomationSummary {
  runId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  promptPreview: string;
  enabled: boolean;
  schedule: ActiveRepeatSchedule;
  maxMinutes: number;
  maxAttempts: number;
  maxCostUsd: number;
  settings: StartRunInput;
  researchProfile: ResearchProfileSnapshot | null;
  sessionStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationUpdateInput {
  runId: string;
  workspaceId: string;
  title: string;
  enabled: boolean;
  settings: StartRunInput;
}

export interface ResearchSubjectInput {
  id?: string | null;
  name: string;
}

export interface ResearchSubject {
  id: string;
  name: string;
  source: 'explicit' | 'legacy_adopted';
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedResearchPrompt {
  promptMarkdown: string;
}

export type ResearchGoalPhase = string;

export type ResearchGoalSuggestionGroup = string[];

export interface SessionNextPromptSuggestion {
  title: string;
  promptMarkdown: string;
  rationale?: string;
}

export interface GeneratedResearchGoalSuggestions {
  phase: ResearchGoalPhase;
  suggestions: ResearchGoalSuggestionGroup;
  /** Structured prompts captured during session finalization. Only present for session next steps. */
  promptSuggestions?: SessionNextPromptSuggestion[];
  /** Present for workspace-level suggestions. Session next steps remain immutable session data. */
  cacheStatus?: 'fresh' | 'stale';
  contextRevision?: string;
  generatedAt?: string;
}

export type ResearchGoalSuggestionsByPhase = Partial<Record<string, string[]>>;

export type ResearchGoalSuggestionStateByPhase<T> = Record<string, T>;

export interface ResearchGoalSuggestionInput {
  phase: ResearchGoalPhase;
  requestId?: string | null;
  sourceRunId?: string | null;
  /** Bypass a durable workspace suggestion cache while preserving it if refresh fails. */
  refresh?: boolean;
}

export interface ResearchGoalSuggestionSelectionInput {
  workspaceId: string;
  scopeId: string;
  profileHash: string;
  phase: ResearchGoalPhase;
  suggestion: string;
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
  provider?: ResearchModelProviderId;
  model: string;
  reasoningEffort: string;
  sandboxProfile: string;
  targetAssetId?: string | null;
  targetPath?: string | null;
}

export interface RunRecord {
  id: string;
  scopeVersionId: string;
  researchProfileSnapshotId: string | null;
  shellSafetyMode: ShellSafetyMode;
  mode: string;
  status: RunStatus;
  title: string;
  promptMarkdown: string;
  model: string;
  reasoningEffort: string;
  attemptStrategy: string;
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

export type BreakoutRoomKind = 'exploration' | 'validation' | 'proving' | 'synthesis' | 'general';

export type BreakoutRoomStatus = 'active' | 'completed' | 'interrupted' | 'errored';

export type BreakoutRoomPhase = 'independent' | 'challenge' | 'response' | 'synthesis' | 'completed';

export type BreakoutRoomMemberStatus = 'pending' | 'active' | 'completed' | 'interrupted' | 'errored';

export type BreakoutRoomMessageKind = 'task' | 'commentary' | 'challenge' | 'evidence' | 'response' | 'outcome' | 'system';

export interface BreakoutRoomRecord {
  id: string;
  runId: string;
  attemptId: string | null;
  name: string;
  title: string;
  purpose: string;
  kind: BreakoutRoomKind;
  status: BreakoutRoomStatus;
  phase: BreakoutRoomPhase;
  challengeRound: number;
  outcomeMarkdown: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface BreakoutRoomMemberRecord {
  id: string;
  roomId: string;
  runId: string;
  attemptId: string | null;
  agentId: string;
  agentPath: string;
  provider: string;
  model: string;
  reasoningEffort: string | null;
  role: string;
  status: BreakoutRoomMemberStatus;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
}

export interface BreakoutRoomMessageRecord {
  id: string;
  roomId: string;
  runId: string;
  attemptId: string | null;
  memberId: string | null;
  senderAgentPath: string;
  recipientAgentPath: string | null;
  kind: BreakoutRoomMessageKind;
  contentMarkdown: string;
  evidenceRefs: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BreakoutRoomSummary {
  id: string;
  runId: string;
  name: string;
  title: string;
  kind: BreakoutRoomKind;
  status: BreakoutRoomStatus;
  providers: string[];
  memberCount: number;
  unreadCount: number;
  updatedAt: string;
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
  status: string;
  blockedIssue: string;
  behaviorPreserved: string;
  diagnosticsClean: string;
  regressionTests: string;
  result: Record<string, unknown>;
  startedAt: string;
  endedAt: string | null;
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

export type PolicyReviewRequestKind = 'credential_injection' | 'host_action' | 'scope_change';
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
  sessionRuns: SessionRunActivity[];
  tokenUsage?: { totalTokens: number };
  breakoutRooms?: BreakoutRoomSummary[];
}

export interface SessionRunActivity {
  id: string;
  runId: string;
  attemptId: string | null;
  status: RunStatus;
  activityIntervals: SessionActivityInterval[];
  terminationCause: RunTerminationCause | null;
}

export interface SessionActivityInterval {
  id: string;
  runId: string;
  attemptId: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface RunDetail {
  run: RunRecord;
  researchProfile?: ResearchProfileSnapshot | null;
  nextStepSuggestions?: GeneratedResearchGoalSuggestions | null;
  attempts: AttemptRecord[];
  traceEvents: TraceEventRecord[];
  transcriptMessages: TranscriptMessageRecord[];
  breakoutRooms?: BreakoutRoomRecord[];
  breakoutRoomMembers?: BreakoutRoomMemberRecord[];
  breakoutRoomMessages?: BreakoutRoomMessageRecord[];
  artifacts: ArtifactRecord[];
  verifierContracts: VerifierContractRecord[];
  verifierRuns: VerifierRunRecord[];
  modelSessions: ModelSessionRecord[];
  contextCompactions: ContextCompactionRecord[];
  policyEvents: ApprovalRecord[];
  exports: ExportRecord[];
  honeycrispMemory?: HoneycrispMemorySummary;
}

export type RunDetailProjection = 'commentary' | 'full';

export interface RunMessageDetailRequest {
  runId: string;
  traceEventIds: string[];
}

export interface RunMessageDetail {
  runId: string;
  traceEvents: TraceEventRecord[];
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
  afterTraceEventId?: string | null;
}

export interface RunDetailUpdate {
  run: RunRecord;
  researchProfile?: ResearchProfileSnapshot | null;
  nextStepSuggestions?: GeneratedResearchGoalSuggestions | null;
  version: RunDetailVersion;
  attempts: AttemptRecord[];
  traceEvents: TraceEventRecord[];
  transcriptMessages: TranscriptMessageRecord[];
  breakoutRooms?: BreakoutRoomRecord[];
  breakoutRoomMembers?: BreakoutRoomMemberRecord[];
  breakoutRoomMessages?: BreakoutRoomMessageRecord[];
  artifacts: ArtifactRecord[];
  verifierContracts: VerifierContractRecord[];
  verifierRuns: VerifierRunRecord[];
  modelSessions: ModelSessionRecord[];
  contextCompactions: ContextCompactionRecord[];
  policyEvents: ApprovalRecord[];
  exports: ExportRecord[];
  honeycrispMemory?: HoneycrispMemorySummary;
}

export interface WorkspaceSnapshot {
  /** Stable across repeated delivery of the same materialized snapshot. */
  version?: string;
  workspace: WorkspaceSummary;
  openAi: OpenAiAccountStatus;
  executor: ExecutorStatus;
  activeScope: WorkspaceScopeVersion;
  workspaceRules: WorkspaceRule[];
  researchSubject: ResearchSubject;
  researchProfile: ResearchProfileSnapshot;
  honeycrispMemory: HoneycrispMemorySummary;
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
  | { type: 'run_runbook'; runId: string; runbookId: string; cellId?: string; proofTarget: RunbookProofTarget; deviceOs?: string }
  | {
      type: 'review_shell_command';
      workspacePath: string;
      runId: string;
      approvalId: string;
      decision: PolicyReviewDecision;
      note?: string;
    }
  | { type: 'fork'; runId: string; instruction: string }
  | { type: 'update_run_budget'; runId: string; budgetPatch: Partial<StartRunInput['budget']>; note?: string }
  | { type: 'mark_artifact_sensitive'; runId: string; artifactId: string; note?: string }
  | { type: 'export_artifact_bundle'; runId: string; memoryNodeId?: string; note?: string }
  | { type: 'export_research_bundle'; runId: string; memoryNodeId?: string; note?: string }
  | { type: 'export_redacted_trace'; runId: string; memoryNodeId?: string; note?: string }
  | { type: 'generate_report_draft'; runId: string; memoryNodeId?: string; note?: string }
  | { type: 'review_export'; runId: string; exportId: string; decision: ExportReviewDecision; note?: string }
  | { type: 'review_policy_request'; runId: string; requestKind: PolicyReviewRequestKind; decision: PolicyReviewDecision; requestedAction: Record<string, unknown>; note?: string };

export interface IosDeviceCaptureDevice {
  id: string;
  udid: string;
  name: string;
  model: string;
  osVersion: string;
}

export type IosDeviceCapturePhase =
  | 'idle'
  | 'ready'
  | 'starting'
  | 'waiting_for_consent'
  | 'streaming'
  | 'error';

export interface IosDeviceCaptureState {
  supported: boolean;
  phase: IosDeviceCapturePhase;
  device: IosDeviceCaptureDevice | null;
  detail: string;
}

export interface IosDeviceCaptureFrame {
  sequence: number;
  capturedAt: string;
  jpegData: Uint8Array;
}

export interface BealeApi {
  selectWorkspace(mode: WorkspacePickerMode): Promise<WorkspacePickerResult>;
  selectWorkspaceDirectory(): Promise<WorkspaceDirectorySelection>;
  getWorkspaceRegistry(): Promise<WorkspaceRegistryState>;
  markResearchSessionViewed(sessionId: string): Promise<WorkspaceRegistryState>;
  getDeveloperSettings(): Promise<DeveloperSettings>;
  setDeveloperModeEnabled(enabled: boolean): Promise<DeveloperSettings>;
  getDebuggingSettings(): Promise<DebuggingSettings>;
  setTracesEnabled(enabled: boolean): Promise<DebuggingSettings>;
  getComputerUseSettings(): Promise<ComputerUseSettings>;
  setComputerUsePermissionMode(permissionMode: ComputerUsePermissionMode): Promise<ComputerUseSettings>;
  getProviderSettings(): Promise<ProviderSettings>;
  setDefaultProviderId(providerId: ResearchModelProviderId | null): Promise<ProviderSettings>;
  setProviderModelDefaults(providerId: ResearchModelProviderId, defaults: ProviderModelDefaults): Promise<ProviderSettings>;
  setProviderOptionalModelEnabled(providerId: ResearchModelProviderId, modelId: string, enabled: boolean): Promise<ProviderSettings>;
  setProviderCyberPolicyRiskAcknowledged(providerId: ResearchModelProviderId, acknowledged: boolean): Promise<ProviderSettings>;
  setProviderPreferredAuthenticationMethod(providerId: ResearchModelProviderId, method: ProviderAuthenticationMethod): Promise<ProviderSettings>;
  getTicketingSettings(): Promise<TicketingSettings>;
  setTicketingProvider(providerId: TicketingMode): Promise<TicketingSettings>;
  setTicketingHumanInTheLoop(enabled: boolean): Promise<TicketingSettings>;
  configureTicketingCredential(providerId: TicketingProviderId, apiKey: string): Promise<TicketingSettings>;
  removeTicketingCredential(providerId: TicketingProviderId): Promise<TicketingSettings>;
  listTicketingTargets(providerId: TicketingProviderId): Promise<TicketingTarget[]>;
  setTicketingTarget(providerId: TicketingProviderId, target: TicketingTarget): Promise<TicketingSettings>;
  getResearchProfiles(): Promise<ResolvedResearchProfile[]>;
  getAgentPlugins(): Promise<AgentPluginRegistryState>;
  addAgentPluginFromFilesystem(): Promise<AgentPluginRegistryState>;
  addAgentPluginFromRepository(repositoryUrl: string): Promise<AgentPluginRegistryState>;
  setAgentPluginEnabled(pluginId: string, enabled: boolean): Promise<AgentPluginRegistryState>;
  removeAgentPlugin(pluginId: string): Promise<AgentPluginRegistryState>;
  getMemorySettings(): Promise<MemorySettings>;
  setMemoryTypeDescriptions(descriptions: MemoryTypeDescriptions): Promise<MemorySettings>;
  getShellOptions(): Promise<ShellOptions>;
  setShellOptions(options: ShellOptions): Promise<ShellOptions>;
  lookupHackerOneScope(identifier: string): Promise<HackerOneScopeLookupResult>;
  listGitHubOrganizationRepositories(organization: string): Promise<GitHubRepositorySummary[]>;
  createScopedWorkspace(input: WorkspaceOnboardingInput): Promise<WorkspaceSnapshot>;
  updateWorkspaceDirectories(directories: string[]): Promise<WorkspaceSnapshot>;
  cloneWorkspaceRepository(assetId: string): Promise<WorkspaceSnapshot>;
  skipWorkspaceOnboardingRepository(input: WorkspaceOnboardingSkipInput): Promise<WorkspaceOnboardingProgressUpdate | null>;
  onWorkspaceOnboardingUpdate(listener: (update: WorkspaceOnboardingProgressUpdate) => void): () => void;
  openRegisteredWorkspace(registryWorkspaceId: string): Promise<WorkspaceSnapshot>;
  removeRegisteredWorkspace(registryWorkspaceId: string): Promise<WorkspaceSnapshot | null>;
  openWorkspace(path: string): Promise<WorkspaceSnapshot>;
  createWorkspace(path: string): Promise<WorkspaceSnapshot>;
  restoreLastWorkspace(): Promise<WorkspaceSnapshot | null>;
  getSnapshot(): Promise<WorkspaceSnapshot | null>;
  getHostEnvironment(): Promise<HostEnvironment>;
  getWorkspaceEditors(): Promise<WorkspaceEditorCatalog>;
  openWorkspaceInEditor(editorId: WorkspaceEditorId): Promise<void>;
  startWorkspaceTerminal(sessionId: string, columns: number, rows: number): Promise<WorkspaceTerminalStartResult>;
  writeWorkspaceTerminal(sessionId: string, data: string): Promise<void>;
  resizeWorkspaceTerminal(sessionId: string, columns: number, rows: number): Promise<void>;
  closeWorkspaceTerminal(sessionId: string): Promise<void>;
  onWorkspaceTerminalData(listener: (event: WorkspaceTerminalDataEvent) => void): () => void;
  onWorkspaceTerminalExit(listener: (event: WorkspaceTerminalExitEvent) => void): () => void;
  getIosDeviceCaptureState(): Promise<IosDeviceCaptureState>;
  startIosDeviceCapture(): Promise<IosDeviceCaptureState>;
  stopIosDeviceCapture(): Promise<IosDeviceCaptureState>;
  onIosDeviceCaptureUpdate(listener: (state: IosDeviceCaptureState) => void): () => void;
  onIosDeviceCaptureFrame(listener: (frame: IosDeviceCaptureFrame) => void): () => void;
  getOpenAiStatus(): Promise<OpenAiAccountStatus>;
  startOpenAiOAuth(): Promise<OpenAiOAuthStartResult>;
  forgetProviderSubscription(providerId: ResearchModelProviderId): Promise<ProviderSettings>;
  removeProvider(providerId: ResearchModelProviderId): Promise<ProviderSettings>;
  configureProviderApiKey(providerId: ResearchModelProviderId, apiKey: string): Promise<void>;
  removeProviderApiKey(providerId: ResearchModelProviderId): Promise<ProviderSettings>;
  refreshOpenAiStatus(): Promise<WorkspaceSnapshot>;
  getResearchProviderStatuses(): Promise<ResearchProviderStatus[]>;
  getResearchProviderModelCatalog(): Promise<ResearchProviderModelCatalog[]>;
  startResearchProviderOAuth(providerId: ResearchProviderId): Promise<ResearchProviderOAuthStartResult>;
  getProfilingState(): Promise<ProfilingState>;
  setProfilingEnabled(enabled: boolean): Promise<ProfilingState>;
  recordProfilingReport(report: ProfilingReport): Promise<ProfilingState>;
  openHoneycrispMemoryDirectory(name: HoneycrispMemoryDirectorySummary['name']): Promise<void>;
  getHoneycrispRunbook(runbookId: string): Promise<HoneycrispRunbookDocument>;
  listAutomations(): Promise<AutomationSummary[]>;
  updateAutomation(input: AutomationUpdateInput): Promise<AutomationSummary>;
  listReportingReports(): Promise<HoneycrispReportSummary[]>;
  getHoneycrispReport(locator: HoneycrispReportLocator): Promise<HoneycrispReportDocument>;
  openReportSubmissionPacket(locator: HoneycrispReportLocator): Promise<void>;
  submitReportTicket(locator: HoneycrispReportLocator): Promise<TicketSubmissionResult>;
  openExternalUrl(url: string): Promise<void>;
  startReportSession(input: ReportSessionStartInput): Promise<ReportSessionStartResult>;
  getWorkspaceDejunkSummary(workspaceId: string): Promise<WorkspaceDejunkSummary>;
  runWorkspaceDejunk(): Promise<WorkspaceSnapshot>;
  runMemoryDreaming(): Promise<WorkspaceSnapshot>;
  onMemoryDreamingProgress(listener: (update: MemoryDreamingProgressUpdate) => void): () => void;
  restoreMemoryDreamingChange(changeId: string): Promise<WorkspaceSnapshot>;
  getHoneycrispToolingSummary(): Promise<HoneycrispToolingSummary>;
  updateHoneycrispToolingConfig(update: HoneycrispToolingConfigUpdate): Promise<HoneycrispToolingSummary>;
  generateResearchGoalSuggestions(input: ResearchGoalSuggestionInput): Promise<GeneratedResearchGoalSuggestions>;
  selectResearchGoalSuggestion(input: ResearchGoalSuggestionSelectionInput): Promise<void>;
  generateResearchPrompt(input?: ResearchPromptGenerationInput): Promise<GeneratedResearchPrompt>;
  cancelResearchPromptGeneration(requestId: string): Promise<void>;
  onResearchPromptGenerationUpdate(listener: (update: ResearchPromptGenerationUpdate) => void): () => void;
  saveScope(scope: WorkspaceScopeDraft): Promise<WorkspaceSnapshot>;
  addWorkspaceRule(text: string): Promise<WorkspaceSnapshot>;
  startRun(input: StartRunInput): Promise<WorkspaceSnapshot>;
  exportWorkspaceBackup(note?: string): Promise<WorkspaceSnapshot>;
  getRunDetail(runId: string, projection?: RunDetailProjection): Promise<RunDetail>;
  getRunDetailVersion(runId: string): Promise<RunDetailVersion>;
  getRunDetailUpdate(runId: string, cursor: RunDetailUpdateCursor, projection?: RunDetailProjection): Promise<RunDetailUpdate>;
  getRunMessageDetail(input: RunMessageDetailRequest): Promise<RunMessageDetail>;
  cancelRunDetailRequests(): void;
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
