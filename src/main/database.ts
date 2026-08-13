import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { applyDatabaseMigrations } from './databaseMigrations';
import { MEMORY_DREAMING_RUN_PROVENANCE_TRIGGER_SQL, MEMORY_DREAMING_SCHEMA_SQL } from './memoryDreaming';
import { decodeResearchProfileJson, decodeResolvedResearchProfile, serializeResearchProfile } from '../shared/researchProfile';
import { normalizeShellSafetyMode } from '../shared/shellSafety';
import type {
  ApprovalRecord,
  ArtifactRecord,
  AttemptRecord,
  AttemptStatus,
  BreakoutRoomKind,
  BreakoutRoomMemberRecord,
  BreakoutRoomMemberStatus,
  BreakoutRoomPhase,
  BreakoutRoomMessageKind,
  BreakoutRoomMessageRecord,
  BreakoutRoomRecord,
  BreakoutRoomStatus,
  BreakoutRoomSummary,
  ContextCompactionRecord,
  ExportRecord,
  ExportReviewDecision,
  GeneratedResearchGoalSuggestions,
  ModelSessionRecord,
  NotificationRecord,
  NotificationStatus,
  OpenAiTransport,
  ProjectInventoryRefreshReport,
  ProjectInventorySummary,
  WorkspaceGraphProjection,
  WorkspaceGraphVisualization,
  ProjectGraphSummary,
  ProjectSearchResult,
  ProjectSemanticSearchResult,
  ProjectSemanticSummary,
  ProjectStructureSummary,
  ResearchModelSelection,
  ResearchProfileSnapshot,
  ResearchSubject,
  ResearchSubjectInput,
  ResolvedResearchProfile,
  WorkspaceScopeDraft,
  WorkspaceScopeVersion,
  RunDetail,
  RunDetailUpdate,
  RunDetailUpdateCursor,
  RunDetailVersion,
  RunEngineKind,
  RunRecord,
  RunRow,
  RunStatus,
  RunTerminationCause,
  SessionActivityInterval,
  ScopeAsset,
  ScopeAssetInput,
  ShellSafetyMode,
  SessionBlockerDependency,
  SessionBlockerDependencyKind,
  SessionFinalDisposition,
  SessionDispositionOutcome,
  SessionTranscriptSearchInput,
  SessionTranscriptSearchResponse,
  SessionTranscriptSearchResult,
  StartRunInput,
  TraceEventRecord,
  TraceEventType,
  TraceSource,
  TranscriptMessageRecord,
  TranscriptMessagePhase,
  TranscriptRole,
  VerifierContractEditInput,
  VerifierContractRecord,
  VerifierRunRecord,
  VmContextRecord,
  WorkspaceExportResult,
  WorkspaceRecoveryReport
} from '@shared/types';
import { selectRunTarget } from './runTarget';

type SqlPrimitive = string | number | bigint | null;
type SqlRow = Record<string, SqlPrimitive>;

export interface AppendTraceInput {
  runId: string;
  attemptId?: string | null;
  type: TraceEventType;
  source: TraceSource;
  summary: string;
  payload?: Record<string, unknown>;
  sensitivity?: string;
  modelVisible?: boolean;
  vmContextId?: string | null;
  artifactId?: string | null;
  toolCallId?: string | null;
  approvalId?: string | null;
}

export interface CreateNotificationInput {
  runId: string;
  traceEventId?: string | null;
  kind: 'session_final_response';
  title: string;
  bodyMarkdown: string;
}

export interface CreateTranscriptMessageInput {
  runId: string;
  attemptId?: string | null;
  traceEventId?: string | null;
  role: TranscriptRole;
  phase?: TranscriptMessagePhase | null;
  contentMarkdown: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface CreateVerifierContractInput {
  runId: string;
  memoryNodeId?: string | null;
  mode: string;
  status: string;
  targetStates?: Record<string, unknown>;
  setupStepsMarkdown: string;
  triggerStepsMarkdown: string;
  expectedObservations?: Record<string, unknown>;
  invariants?: Record<string, unknown>;
  artifactsToCollect?: Record<string, unknown>;
  passCriteria?: Record<string, unknown>;
}

export interface CreateVerifierRunInput {
  contractId: string;
  runId: string;
  attemptId?: string | null;
  vmContextId?: string | null;
  status: string;
  blockedIssue: string;
  behaviorPreserved: string;
  diagnosticsClean: string;
  regressionTests: string;
  result?: Record<string, unknown>;
  endedAt?: string | null;
}

export interface CreateArtifactInput {
  kind: string;
  mimeType: string;
  sensitivity: string;
  modelVisible: boolean;
  source: string;
  metadata?: Record<string, unknown>;
  content: string | Buffer;
}

export interface CreateApprovalInput {
  runId: string;
  attemptId?: string | null;
  requestKind: string;
  requestedAction: Record<string, unknown>;
  decision: string;
  reason: string;
  pending?: boolean;
  scopeAmendmentId?: string | null;
}

export interface CreateToolCallInput {
  runId: string;
  attemptId: string;
  toolName: string;
  toolVersion: string;
  input: Record<string, unknown>;
  status: string;
  resultSummary?: string;
  result?: Record<string, unknown>;
  policyDecisionId?: string | null;
  vmContextId?: string | null;
}

export interface CreateAttemptInput {
  runId: string;
  parentAttemptId?: string | null;
  status?: AttemptStatus;
  shortState: string;
  strategyRole: string;
  vmBackend?: string;
  vmImageId?: string;
  vmSnapshotId?: string;
  vmState?: string;
  vmMetadata?: Record<string, unknown>;
  cost?: Record<string, unknown>;
  tokenUsage?: Record<string, unknown>;
}

export interface CreateModelSessionInput {
  runId: string;
  provider: string;
  transport: OpenAiTransport;
  previousResponseId?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface CreateContextCompactionInput {
  runId: string;
  attemptId?: string | null;
  previousCompactionId?: string | null;
  reason: string;
  previousReplayMode: string;
  newReplayMode: string;
  traceRangeSummarized: Record<string, unknown>;
  traceRangeKept: Record<string, unknown>;
  traceHighWaterMark: number;
  tokenPressure?: Record<string, unknown>;
  serializedSizeBytes: number;
  redactionPolicyVersion: string;
  summarySource: string;
  representedState?: Record<string, unknown>;
  compactedInput?: Record<string, unknown>;
}

export interface StartRunRecordInput {
  scopeVersionId: string;
  researchProfileSnapshotId?: string | null;
  title: string;
  promptMarkdown: string;
  shellSafetyMode: ShellSafetyMode;
  mode: string;
  model: string;
  reasoningEffort: string;
  attemptStrategy: string;
  sandboxProfile: string;
  targetAssetId?: string | null;
  targetPath?: string | null;
  budget: Record<string, unknown>;
  vmBackend?: string;
  vmImageId?: string;
  vmSnapshotId?: string;
  vmState?: string;
  vmMetadata?: Record<string, unknown>;
}

export interface ResearchRecommendationRunContext {
  run: RunRecord;
  finalResponseMarkdown: string | null;
  verifierContracts: Array<{
    memoryNodeId: string | null;
    mode: string;
    status: string;
    passCriteria: Record<string, unknown>;
  }>;
  verifierRuns: Array<{
    status: string;
    result: Record<string, unknown>;
    blockedIssue: string;
  }>;
  notableTraceEvents: Array<{
    type: TraceEventType;
    source: TraceSource;
    summary: string;
    modelVisible: boolean;
  }>;
}

export interface CreateExportInput {
  runId: string;
  memoryNodeId?: string | null;
  kind: string;
  relativePath: string;
  redactionPolicy?: Record<string, unknown>;
  includedArtifacts?: Record<string, unknown>;
  status?: ExportRecord['status'];
}

interface ProjectSearchDocumentInput {
  scopeVersionId: string;
  runId?: string | null;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  sourcePath?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

interface ProjectSearchDocumentRecord {
  id: string;
  scopeVersionId: string;
  runId: string | null;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  sourcePath: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

interface ProjectSemanticChunkInput {
  scopeVersionId: string;
  runId?: string | null;
  sourceDocumentId: string;
  namespace: string;
  entityType: string;
  entityId: string;
  title: string;
  content: string;
  contentHash: string;
  sourcePath?: string | null;
  chunkIndex: number;
  tokenCount: number;
  vectorProvider: string;
  vectorModel: string;
  vector: Record<string, number>;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

interface ProjectSemanticQueryProfile {
  terms: string[];
  termWeights: Map<string, number>;
  namespaceWeights: Record<string, number>;
  totalWeight: number;
}

interface ProjectSemanticRankScore {
  score: number;
  baseScore: number;
  rerankScore: number;
  vectorScore: number;
  lexicalScore: number;
  titleScore: number;
  namespaceScore: number;
  entityScore: number;
  pathScore: number;
  proximityScore: number;
  provenanceScore: number;
  securityScore: number;
  scopeScore: number;
  structureScore: number;
  researchMemoryScore: number;
  duplicateRiskPenalty: number;
  matchedTerms: string[];
  rankReason: string;
}

interface ProjectSemanticDirectSourceText {
  text: string;
  truncated: boolean;
}

interface ProjectInventoryInsertInput {
  scopeVersionId: string;
  asset: ScopeAsset;
  itemKind: string;
  resourceKind: string;
  absolutePath: string;
  language: string;
  sizeBytes: number | null;
  mtimeMs: number | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

interface ProjectInventoryScanState {
  indexedAt: string;
  scannedFiles: number;
  skippedCount: number;
  truncated: boolean;
}

interface ProjectStructureEntityInput {
  scopeVersionId: string;
  inventoryItemId: string;
  assetId: string;
  entityKind: string;
  name: string;
  signature: string;
  path: string;
  language: string;
  lineStart: number;
  lineEnd: number;
  parentId?: string | null;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

interface ProjectStructureRelationInput {
  scopeVersionId: string;
  sourceEntityId: string;
  relationKind: string;
  targetKind: string;
  targetName: string;
  targetEntityId?: string | null;
  metadata?: Record<string, unknown>;
  indexedAt: string;
}

interface ProjectStructureCandidate {
  entityKind: string;
  name: string;
  signature: string;
  lineStart: number;
  lineEnd?: number | null;
  metadata: Record<string, unknown>;
  relations?: Array<Omit<ProjectStructureRelationInput, 'scopeVersionId' | 'sourceEntityId' | 'indexedAt'>>;
}

type ProjectSemanticJobStatus = Extract<ProjectSemanticSummary['status'], 'queued' | 'indexing' | 'error' | 'canceled'>;

interface ProjectSemanticJobState {
  status: ProjectSemanticJobStatus;
  reason: string;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  processed: number | null;
  total: number | null;
}

interface ProjectSemanticDirtyState {
  reason: string;
  markedAt: string;
}

interface ProjectSemanticRefreshState {
  indexedAt: string | null;
  durationMs: number | null;
  sourceDocumentCount: number;
  chunkCount: number;
  indexSizeBytes: number;
}

export interface ProjectStructureEntityRecord {
  id: string;
  scopeVersionId: string;
  inventoryItemId: string;
  assetId: string;
  entityKind: string;
  name: string;
  signature: string;
  path: string;
  language: string;
  lineStart: number;
  lineEnd: number;
  parentId: string | null;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

export interface ProjectStructureRelationRecord {
  id: string;
  scopeVersionId: string;
  sourceEntityId: string;
  relationKind: string;
  targetKind: string;
  targetName: string;
  targetEntityId: string | null;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

export interface ProjectSourceReviewObservation {
  runId: string;
  traceEventId: string;
  toolName: string;
  path: string;
  symbol: string | null;
  lineStart: number | null;
  lineEnd: number | null;
}

export interface ProjectSourceCoveragePathRecord {
  assetId: string;
  path: string;
  language: string;
  indexedAt: string;
}

export interface ProjectGraphNodeRecord {
  id: string;
  scopeVersionId: string;
  nodeKind: string;
  entityType: string;
  entityId: string;
  label: string;
  sourcePath: string | null;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

export interface ProjectGraphEdgeRecord {
  id: string;
  scopeVersionId: string;
  sourceNodeId: string;
  edgeKind: string;
  targetNodeId: string | null;
  targetEntityType: string;
  targetEntityId: string | null;
  targetLabel: string;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

export interface ProjectGraphNeighborhood {
  status: 'hit' | 'miss';
  root: ProjectGraphNodeRecord | null;
  depth: number;
  nodes: ProjectGraphNodeRecord[];
  edges: ProjectGraphEdgeRecord[];
}

export interface ProjectGraphVariantRecord {
  node: ProjectGraphNodeRecord;
  edge: ProjectGraphEdgeRecord;
}

export interface CreatedRunContext {
  run: RunRecord;
  attempt: AttemptRecord;
  vmContext: VmContextRecord;
}

const PROJECT_INVENTORY_MAX_FILES = 10_000;
const PROJECT_INVENTORY_FRESHNESS_MAX_ITEMS = 10_000;
const PROJECT_INVENTORY_HASH_MAX_BYTES = 1024 * 1024;
const PROJECT_INVENTORY_PREVIEW_MAX_BYTES = 128 * 1024;
const PROJECT_INVENTORY_BINARY_SCAN_MAX_BYTES = 512 * 1024;
const PROJECT_INVENTORY_BINARY_STRINGS_MAX_CHARS = 16 * 1024;
const PROJECT_STRUCTURE_MAX_FILE_BYTES = 2 * 1024 * 1024;
const PROJECT_STRUCTURE_MAX_ENTITIES_PER_FILE = 400;
const PROJECT_STRUCTURE_MAX_DEFINITION_LINES = 300;
const PROJECT_STRUCTURE_BINARY_MAX_ENTITIES_PER_FILE = 80;
const BINARY_GRAPH_EDGE_KINDS = new Set(['imports_symbol', 'exports_symbol', 'contains_string', 'references_url', 'references_permission']);
const PROJECT_SEMANTIC_ENABLED_META_KEY = 'project_semantic_index_enabled';
const PROJECT_SEMANTIC_JOB_META_KEY = 'project_semantic_index_job';
const PROJECT_SEMANTIC_DIRTY_META_KEY = 'project_semantic_index_dirty';
const PROJECT_SEMANTIC_VECTOR_PROVIDER = 'local_hash';
const PROJECT_SEMANTIC_VECTOR_MODEL = 'local-hash-v3';
const PROJECT_SEMANTIC_MAX_SOURCE_CHARS = 64 * 1024;
const PROJECT_SEMANTIC_CHUNK_MAX_CHARS = 2400;
const PROJECT_SEMANTIC_CHUNK_OVERLAP_CHARS = 240;
const PROJECT_SEMANTIC_MAX_CHUNKS_PER_DOCUMENT = 12;
const PROJECT_SEMANTIC_SOURCE_CHUNK_BASE_INDEX = 1000;
const PROJECT_SEMANTIC_ENTITY_CHUNK_BASE_INDEX = 2000;
const PROJECT_SEMANTIC_SOURCE_CHUNK_MAX_LINES = 80;
const PROJECT_SEMANTIC_SOURCE_CHUNK_OVERLAP_LINES = 8;
const PROJECT_SEMANTIC_MAX_SOURCE_CHUNKS_PER_DOCUMENT = 24;
const PROJECT_SEMANTIC_MAX_ENTITY_CHUNKS_PER_DOCUMENT = 8;
const PROJECT_SEMANTIC_ENTITY_CONTEXT_LINES = 3;
const PROJECT_SEMANTIC_MAX_VECTOR_TERMS = 256;
const PROJECT_SEMANTIC_SEARCH_CANDIDATE_LIMIT = 768;
const PROJECT_SEMANTIC_SEARCH_PREFILTER_TERM_LIMIT = 18;
const PROJECT_GRAPH_GENERIC_LABELS = new Set([
  'api',
  'app',
  'async',
  'auth',
  'authorization',
  'body',
  'client',
  'data',
  'delete',
  'error',
  'exec',
  'fetch',
  'get',
  'handler',
  'headers',
  'id',
  'input',
  'insert',
  'list',
  'method',
  'middleware',
  'object',
  'params',
  'parse',
  'permission',
  'permissions',
  'policy',
  'post',
  'query',
  'request',
  'response',
  'route',
  'select',
  'string',
  'test',
  'token',
  'update',
  'url',
  'user',
  'value'
]);

function projectSemanticEnabledMetaKey(scopeVersionId: string): string {
  return `${PROJECT_SEMANTIC_ENABLED_META_KEY}:${scopeVersionId}`;
}

function projectSemanticRefreshMetaKey(scopeVersionId: string): string {
  return `${PROJECT_SEMANTIC_ENABLED_META_KEY}:${scopeVersionId}:last_refresh`;
}

function projectSemanticJobMetaKey(scopeVersionId: string): string {
  return `${PROJECT_SEMANTIC_JOB_META_KEY}:${scopeVersionId}`;
}

function projectSemanticDirtyMetaKey(scopeVersionId: string): string {
  return `${PROJECT_SEMANTIC_DIRTY_META_KEY}:${scopeVersionId}`;
}

function normalizeProjectGraphLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function projectGraphClusterId(kind: string, value: string): string {
  const normalized = normalizeProjectGraphLabel(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${kind}:${normalized || 'unknown'}`.slice(0, 120);
}

function isProjectGraphGenericLabel(value: string): boolean {
  const normalized = normalizeProjectGraphLabel(value);
  if (!normalized || normalized.length <= 2 || /^\d+$/.test(normalized)) return true;
  if (PROJECT_GRAPH_GENERIC_LABELS.has(normalized)) return true;
  return /^[a-z]+$/.test(normalized) && normalized.length <= 4;
}

function projectGraphRepositoryLabel(sourcePath: string | null): string | null {
  const segments = projectGraphPathSegments(sourcePath);
  const repositorySegment = segments.find((segment) => /^(github\.com|gitlab\.com|bitbucket\.org)_/.test(segment));
  if (!repositorySegment) return null;
  const match = /^(github\.com|gitlab\.com|bitbucket\.org)_(.+)$/.exec(repositorySegment);
  if (!match) return repositorySegment;
  const repositoryParts = match[2].split('_').filter(Boolean);
  if (repositoryParts.length >= 2) return `${repositoryParts[0]}/${repositoryParts[1]}`;
  return `${match[1]}/${repositoryParts.join('/') || repositorySegment}`;
}

function projectGraphPathLabel(sourcePath: string | null): string {
  const segments = projectGraphPathSegments(sourcePath);
  const repositoryIndex = segments.findIndex((segment) => /^(github\.com|gitlab\.com|bitbucket\.org)_/.test(segment));
  const relevantSegments = repositoryIndex >= 0 ? segments.slice(repositoryIndex + 1) : segments;
  return relevantSegments.slice(-4).join('/');
}

function projectGraphSourceGroupLabel(sourcePath: string | null): string | null {
  const segments = projectGraphPathSegments(sourcePath);
  const repositoryIndex = segments.findIndex((segment) => /^(github\.com|gitlab\.com|bitbucket\.org)_/.test(segment));
  const relevantSegments = repositoryIndex >= 0 ? segments.slice(repositoryIndex + 1) : segments;
  if (relevantSegments.length === 0) return null;
  if (['apps', 'packages', 'crates', 'src', 'lib', 'cmd', 'internal', 'pkg'].includes(relevantSegments[0]) && relevantSegments.length > 1) {
    return `${relevantSegments[0]}/${relevantSegments[1]}`;
  }
  return relevantSegments[0];
}

function projectGraphPathSegments(sourcePath: string | null): string[] {
  if (!sourcePath) return [];
  return sourcePath.replace(/\\/g, '/').split('/').filter(Boolean);
}

function isProjectGraphTestOrDocPath(sourcePath: string | null): boolean {
  const path = (sourcePath ?? '').replace(/\\/g, '/').toLowerCase();
  return path.includes('/test/') || path.includes('/tests/') || path.includes('__tests__') || path.includes('/docs/') || path.endsWith('/readme.md') || path.includes('/.github/');
}

function topProjectGraphCounts(counts: Map<string, number>, limit: number): Record<string, number> {
  return Object.fromEntries(
    [...counts.entries()]
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
  );
}

const PROJECT_INDEX_SKIPPED_DIRS = new Set(['.beale', '.git', 'node_modules', 'dist', 'out', 'coverage', '.cache', '.next', 'target', 'build']);
const PROJECT_INDEX_MANIFEST_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'gemfile',
  'gemfile.lock',
  'composer.json',
  'composer.lock',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'androidmanifest.xml',
  'info.plist',
  'pubspec.yaml',
  'mix.exs'
]);
const PROJECT_INDEX_SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.m',
  '.mm',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scala',
  '.swift',
  '.ts',
  '.tsx'
]);
const PROJECT_INDEX_TEXT_EXTENSIONS = new Set([
  '.cfg',
  '.conf',
  '.css',
  '.csv',
  '.env',
  '.graphql',
  '.html',
  '.ini',
  '.json',
  '.lock',
  '.log',
  '.md',
  '.properties',
  '.proto',
  '.sql',
  '.toml',
  '.txt',
  '.xml',
  '.yaml',
  '.yml'
]);
const PROJECT_INDEX_BINARY_EXTENSIONS = new Set(['.apk', '.aab', '.bin', '.dll', '.dmg', '.dylib', '.elf', '.exe', '.ipa', '.jar', '.o', '.so', '.wasm']);
const SEMANTIC_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'onto',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'not',
  'but',
  'all',
  'any',
  'can',
  'will',
  'should',
  'would',
  'could',
  'http',
  'https',
  'com',
  'org',
  'net',
  'www'
]);
const SEMANTIC_SYNONYMS: Record<string, string[]> = {
  access: ['authorization', 'auth', 'permission', 'control'],
  auth: ['authorization', 'authentication', 'permission', 'access'],
  authn: ['authentication', 'identity', 'login'],
  authz: ['authorization', 'permission', 'access', 'control'],
  authorize: ['authorization', 'permission', 'access'],
  authorization: ['auth', 'authz', 'permission', 'access', 'guard'],
  authenticated: ['authentication', 'auth', 'identity'],
  authentication: ['authn', 'identity', 'login', 'credential'],
  permission: ['authorization', 'access', 'scope'],
  guard: ['auth', 'authorization', 'middleware'],
  middleware: ['guard', 'handler', 'route'],
  token: ['credential', 'secret', 'bearer'],
  credential: ['secret', 'token', 'password', 'key'],
  secret: ['credential', 'token', 'key', 'leak'],
  key: ['credential', 'secret', 'token'],
  route: ['endpoint', 'handler', 'controller'],
  endpoint: ['route', 'api', 'handler'],
  api: ['endpoint', 'route', 'request'],
  handler: ['route', 'endpoint', 'controller'],
  input: ['parameter', 'request', 'parser', 'validation'],
  validate: ['validation', 'sanitize', 'check'],
  validation: ['validate', 'sanitize', 'input', 'check'],
  sanitize: ['validation', 'escape', 'encode'],
  query: ['database', 'sql', 'injection', 'filter'],
  sql: ['database', 'query', 'injection', 'sqli'],
  sqli: ['sql', 'injection', 'database', 'query'],
  database: ['query', 'sql', 'storage', 'persistence'],
  deserialize: ['deserialization', 'unserialize', 'parser', 'object'],
  deserialization: ['deserialize', 'unserialize', 'parser', 'object'],
  parser: ['parse', 'deserialize', 'input', 'decode'],
  redirect: ['url', 'navigation', 'response'],
  file: ['filesystem', 'path', 'read'],
  path: ['filesystem', 'file', 'traversal', 'directory'],
  traversal: ['path', 'filesystem', 'file'],
  injection: ['sql', 'command', 'template', 'input'],
  command: ['exec', 'shell', 'process', 'injection'],
  template: ['render', 'injection', 'html'],
  native: ['jni', 'binary', 'symbol'],
  jni: ['native', 'android', 'symbol'],
  mobile: ['android', 'ios', 'permission'],
  exported: ['android', 'component', 'activity', 'service'],
  camera: ['permission', 'android', 'mobile'],
  crash: ['fault', 'signal', 'sigsegv'],
  ssrf: ['url', 'request', 'internal', 'metadata'],
  xss: ['script', 'html', 'dom'],
  csrf: ['request', 'token', 'state'],
  idor: ['authorization', 'access', 'object', 'reference'],
  evidence: ['artifact', 'observation', 'verifier'],
  memory: ['artifact', 'observation', 'verifier', 'trajectory', 'primitive', 'chain']
};

export function createId(prefix: string): string {
  const time = Date.now().toString(36);
  const random = randomBytes(6).toString('hex');
  return `${prefix}_${time}_${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function toJson(value: Record<string, unknown> | unknown[] | null | undefined): string {
  return JSON.stringify(value ?? {});
}

function parseJson(value: SqlPrimitive | undefined): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

export interface UpsertBreakoutRoomInput {
  id: string;
  runId: string;
  attemptId?: string | null;
  name: string;
  title: string;
  purpose?: string;
  kind?: BreakoutRoomKind;
  status?: BreakoutRoomStatus;
  phase?: BreakoutRoomPhase;
  challengeRound?: number;
  outcomeMarkdown?: string | null;
  createdAt?: string;
  closedAt?: string | null;
}

export interface UpsertBreakoutRoomMemberInput {
  id: string;
  roomId: string;
  runId: string;
  attemptId?: string | null;
  agentId: string;
  agentPath: string;
  provider: string;
  model: string;
  reasoningEffort?: string | null;
  role?: string;
  status: BreakoutRoomMemberStatus;
  startedAt?: string | null;
  endedAt?: string | null;
  error?: string | null;
}

export interface CreateBreakoutRoomMessageInput {
  id: string;
  roomId: string;
  runId: string;
  attemptId?: string | null;
  memberId?: string | null;
  senderAgentPath: string;
  recipientAgentPath?: string | null;
  kind: BreakoutRoomMessageKind;
  contentMarkdown: string;
  evidenceRefs?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

function parseStoredSessionNextStepSuggestions(value: SqlPrimitive | undefined): GeneratedResearchGoalSuggestions | null {
  const parsed = parseJson(value);
  const phase = typeof parsed.phase === 'string' ? parsed.phase.trim() : '';
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.map((suggestion) => typeof suggestion === 'string' ? suggestion.replace(/\s+/g, ' ').trim() : '')
    : [];
  const identities = new Set(suggestions.map((suggestion) => suggestion.toLocaleLowerCase()));
  if (!phase || suggestions.length !== 3 || suggestions.some((suggestion) => !suggestion) || identities.size !== 3) return null;
  return { phase, suggestions };
}

function transcriptMessagePhase(metadata: Record<string, unknown>): TranscriptMessagePhase | null {
  const explicitPhase = metadata.messagePhase;
  if (explicitPhase === 'commentary' || explicitPhase === 'final_answer') return explicitPhase;
  return null;
}

function parseStringArray(value: SqlPrimitive | undefined): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function text(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

function nullableText(row: SqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableNumber(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nestedValue(records: Record<string, unknown>[], keys: string[]): unknown {
  const wanted = new Set(keys);
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 4 || !value || typeof value !== 'object') return undefined;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 40)) {
        const found = visit(item, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (wanted.has(key) && record[key] !== undefined) return record[key];
    }
    for (const child of Object.values(record).slice(0, 80)) {
      const found = visit(child, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const record of records) {
    const found = visit(record, 0);
    if (found !== undefined) return found;
  }
  return undefined;
}

function nestedString(records: Record<string, unknown>[], keys: string[]): string | null {
  return stringFromUnknown(nestedValue(records, keys));
}

function nestedNumber(records: Record<string, unknown>[], keys: string[]): number | null {
  const value = nestedValue(records, keys);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.floor(value));
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Math.max(1, Number.parseInt(value, 10));
  return null;
}

function nestedStringArray(records: Record<string, unknown>[], keys: string[]): string[] {
  const value = nestedValue(records, keys);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function shellSourceReviewLocations(
  records: Record<string, unknown>[]
): Array<{ path: string; symbol: string | null; lineStart: number | null; lineEnd: number | null }> {
  const utilityValue = nestedString(records, ['utility', 'command']);
  const utility = utilityValue ? basename(utilityValue).toLowerCase() : '';
  const args = nestedStringArray(records, ['args', 'arguments']);
  const sourceReadUtilities = new Set(['awk', 'cat', 'grep', 'head', 'rg', 'sed', 'tail']);
  const gitSourceRead = utility === 'git' && ['blame', 'diff', 'show'].includes(args[0]?.toLowerCase() ?? '');
  if ((!sourceReadUtilities.has(utility) && !gitSourceRead) || args.length === 0) return [];

  const paths = args.filter((argument) => {
    if (!argument || argument === '-' || argument.startsWith('-')) return false;
    const resourceKind = classifyProjectResourceKind(argument, false);
    return resourceKind === 'source' || resourceKind === 'manifest';
  });
  if (paths.length === 0) return [];

  let lineStart: number | null = null;
  let lineEnd: number | null = null;
  if (utility === 'sed') {
    const range = args.map((argument) => argument.trim()).find((argument) => /^\d+(?:,\d+)?p$/.test(argument));
    const match = range?.match(/^(\d+)(?:,(\d+))?p$/);
    if (match) {
      lineStart = Math.max(1, Number.parseInt(match[1], 10));
      lineEnd = Math.max(lineStart, Number.parseInt(match[2] ?? match[1], 10));
    }
  } else if (utility === 'head') {
    const countIndex = args.findIndex((argument) => argument === '-n' || argument === '--lines');
    const countValue = countIndex >= 0 ? args[countIndex + 1] : args.find((argument) => /^-\d+$/.test(argument))?.slice(1);
    if (countValue && /^\d+$/.test(countValue)) {
      lineStart = 1;
      lineEnd = Math.max(1, Number.parseInt(countValue, 10));
    }
  } else if (utility === 'awk') {
    const expression = args.find((argument) => /NR\s*(?:>=|==)/.test(argument));
    const startMatch = expression?.match(/NR\s*(?:>=|==)\s*(\d+)/);
    const endMatch = expression?.match(/NR\s*<=\s*(\d+)/);
    if (startMatch) {
      lineStart = Math.max(1, Number.parseInt(startMatch[1], 10));
      lineEnd = endMatch ? Math.max(lineStart, Number.parseInt(endMatch[1], 10)) : lineStart;
    }
  }

  return paths.map((path) => ({ path, symbol: null, lineStart, lineEnd }));
}

function stringValueForJson(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function uniqueStringsForJson(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function artifactRunId(db: DatabaseSync, artifactId: string): string | null {
  const row = rowOrUndefined(db.prepare('SELECT run_id FROM trace_events WHERE artifact_id = ? ORDER BY created_at ASC LIMIT 1').get(artifactId));
  return row ? text(row, 'run_id') : null;
}

function transcriptSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of query.split(/\s+/)) {
    const normalized = term.trim().toLowerCase();
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms.slice(0, 8);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function transcriptSearchPreview(content: string, terms: string[], maxLength = 320): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  const lower = compact.toLowerCase();
  const firstMatch = terms.reduce((best, term) => {
    const index = lower.indexOf(term);
    if (index < 0) return best;
    return best < 0 ? index : Math.min(best, index);
  }, -1);
  const anchor = firstMatch >= 0 ? firstMatch : 0;
  const start = Math.max(0, anchor - 90);
  const end = Math.min(compact.length, start + maxLength);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < compact.length ? '...' : '';
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

function emptyTranscriptSearchResponse(): SessionTranscriptSearchResponse {
  return {
    results: [],
    totalTranscriptMatches: 0,
    workspaceCount: 0,
    workspaces: []
  };
}

function projectSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of query.toLowerCase().split(/[^a-z0-9_.$/@:-]+/i)) {
    const normalized = term.trim();
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms.slice(0, 16);
}

function projectFtsQuery(query: string): string | null {
  const terms = projectSearchTerms(query);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ');
}

function projectSemanticPrefilterTerms(query: string, profile: ProjectSemanticQueryProfile): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  const add = (term: string): void => {
    const normalized = term.trim().toLowerCase();
    if (normalized.length < 2 || seen.has(normalized)) return;
    seen.add(normalized);
    terms.push(normalized);
  };
  for (const term of projectSearchTerms(query)) add(term);
  for (const term of profile.terms) add(term);
  return terms.slice(0, PROJECT_SEMANTIC_SEARCH_PREFILTER_TERM_LIMIT);
}

function projectSearchPreview(title: string, body: string, query: string, maxLength = 260): string {
  const terms = projectSearchTerms(query);
  const compact = `${title}\n${body}`.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  const lower = compact.toLowerCase();
  const firstMatch = terms.reduce((best, term) => {
    const index = lower.indexOf(term);
    if (index < 0) return best;
    return best < 0 ? index : Math.min(best, index);
  }, -1);
  const anchor = firstMatch >= 0 ? firstMatch : 0;
  const start = Math.max(0, anchor - 80);
  const end = Math.min(compact.length, start + maxLength);
  return `${start > 0 ? '...' : ''}${compact.slice(start, end).trim()}${end < compact.length ? '...' : ''}`;
}

function semanticSearchPreview(content: string, query: string, maxLength = 300): string {
  const terms = semanticTokens(query).map((token) => token.term);
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  const lower = compact.toLowerCase();
  const firstMatch = terms.reduce((best, term) => {
    const index = lower.indexOf(term);
    if (index < 0) return best;
    return best < 0 ? index : Math.min(best, index);
  }, -1);
  const anchor = firstMatch >= 0 ? firstMatch : 0;
  const start = Math.max(0, anchor - 90);
  const end = Math.min(compact.length, start + maxLength);
  return `${start > 0 ? '...' : ''}${compact.slice(start, end).trim()}${end < compact.length ? '...' : ''}`;
}

function projectSemanticNamespace(document: ProjectSearchDocumentRecord): string {
  if (document.entityType === 'structure_entity') {
    const entityKind = typeof document.metadata.entityKind === 'string' ? document.metadata.entityKind : '';
    if (entityKind.startsWith('binary_')) return 'binary';
    if (entityKind.startsWith('mobile_') || entityKind === 'url_scheme') return 'mobile';
    if (entityKind === 'web_endpoint' || entityKind === 'graphql_operation' || entityKind === 'route') return 'web';
    return 'code';
  }
  if (document.entityType === 'inventory_item') {
    const resourceKind = typeof document.metadata.resourceKind === 'string' ? document.metadata.resourceKind : '';
    if (resourceKind === 'binary') return 'binary';
    if (resourceKind === 'manifest') return 'docs';
    return 'code';
  }
  if (['verifier_run', 'verifier_contract', 'artifact', 'trace_event', 'transcript', 'run'].includes(document.entityType)) return 'research_memory';
  return 'docs';
}

function semanticChunksForDocument(document: ProjectSearchDocumentRecord, indexedAt: string, sourceTextCache: Map<string, ProjectSemanticDirectSourceText | null>): ProjectSemanticChunkInput[] {
  const namespace = projectSemanticNamespace(document);
  const source = `${document.title}\n${document.body}`.trim().slice(0, PROJECT_SEMANTIC_MAX_SOURCE_CHARS);
  const chunks: ProjectSemanticChunkInput[] = [];
  let offset = 0;
  let chunkIndex = 0;
  while (offset < source.length && chunkIndex < PROJECT_SEMANTIC_MAX_CHUNKS_PER_DOCUMENT) {
    const end = Math.min(source.length, offset + PROJECT_SEMANTIC_CHUNK_MAX_CHARS);
    const content = source.slice(offset, end).trim();
    if (content) {
      chunks.push(
        projectSemanticChunkFromContent(document, {
          namespace,
          title: document.title,
          content,
          chunkIndex,
          metadata: {
            ...document.metadata,
            semanticSourceKind: 'search_document'
          },
          indexedAt
        })
      );
      chunkIndex += 1;
    }
    if (end >= source.length) break;
    offset = Math.max(end - PROJECT_SEMANTIC_CHUNK_OVERLAP_CHARS, offset + 1);
  }
  chunks.push(...semanticDirectSourceChunksForDocument(document, namespace, indexedAt, sourceTextCache));
  return chunks;
}

function projectSemanticChunkFromContent(
  document: ProjectSearchDocumentRecord,
  input: {
    namespace: string;
    title: string;
    content: string;
    chunkIndex: number;
    metadata: Record<string, unknown>;
    indexedAt: string;
  }
): ProjectSemanticChunkInput {
  const content = input.content.trim();
  const vector = semanticVectorForText(semanticVectorInput(input.namespace, input.title, content, input.metadata), input.namespace);
  const tokenCount = semanticTokens(content).length;
  const contentHash = createHash('sha256').update(content).digest('hex');
  return {
    scopeVersionId: document.scopeVersionId,
    runId: document.runId,
    sourceDocumentId: document.id,
    namespace: input.namespace,
    entityType: document.entityType,
    entityId: document.entityId,
    title: input.title,
    content,
    contentHash,
    sourcePath: document.sourcePath,
    chunkIndex: input.chunkIndex,
    tokenCount,
    vectorProvider: PROJECT_SEMANTIC_VECTOR_PROVIDER,
    vectorModel: PROJECT_SEMANTIC_VECTOR_MODEL,
    vector,
    metadata: {
      ...input.metadata,
      sourceDocumentId: document.id,
      namespace: input.namespace,
      chunkIndex: input.chunkIndex,
      provider: PROJECT_SEMANTIC_VECTOR_PROVIDER,
      model: PROJECT_SEMANTIC_VECTOR_MODEL,
      localOnly: true
    },
    indexedAt: input.indexedAt
  };
}

function semanticDirectSourceChunksForDocument(
  document: ProjectSearchDocumentRecord,
  namespace: string,
  indexedAt: string,
  sourceTextCache: Map<string, ProjectSemanticDirectSourceText | null>
): ProjectSemanticChunkInput[] {
  if (!document.sourcePath || !isAbsolute(document.sourcePath)) return [];
  if (document.entityType === 'inventory_item') {
    const resourceKind = typeof document.metadata.resourceKind === 'string' ? document.metadata.resourceKind : '';
    if (!semanticResourceKindSupportsDirectText(resourceKind)) return [];
    const sourceText = getSemanticDirectSourceText(document.sourcePath, resourceKind, sourceTextCache);
    if (!sourceText) return [];
    const lines = sourceText.text.split('\n');
    return semanticLineRangeChunks(document, {
      namespace,
      indexedAt,
      lines,
      titlePrefix: `${document.title} source`,
      lineStart: 1,
      lineEnd: lines.length,
      chunkBaseIndex: PROJECT_SEMANTIC_SOURCE_CHUNK_BASE_INDEX,
      maxChunks: PROJECT_SEMANTIC_MAX_SOURCE_CHUNKS_PER_DOCUMENT,
      metadata: {
        ...document.metadata,
        semanticSourceKind: 'source_range',
        sourcePath: document.sourcePath,
        resourceKind,
        language: typeof document.metadata.language === 'string' ? document.metadata.language : '',
        truncatedFile: sourceText.truncated
      }
    });
  }

  if (document.entityType !== 'structure_entity') return [];
  const resourceKind = typeof document.metadata.resourceKind === 'string' ? document.metadata.resourceKind : 'source';
  if (!semanticResourceKindSupportsDirectText(resourceKind)) return [];
  const sourceText = getSemanticDirectSourceText(document.sourcePath, resourceKind, sourceTextCache);
  if (!sourceText) return [];
  const lines = sourceText.text.split('\n');
  const lineStart = semanticMetadataNumber(document.metadata.lineStart);
  const lineEnd = semanticMetadataNumber(document.metadata.lineEnd) ?? lineStart;
  if (!lineStart || !lineEnd) return [];
  const entityKind = typeof document.metadata.entityKind === 'string' ? document.metadata.entityKind : '';
  const contextLines = projectStructureEntityOwnsRange(entityKind) ? PROJECT_SEMANTIC_ENTITY_CONTEXT_LINES : 0;
  const start = Math.max(1, lineStart - contextLines);
  const end = Math.min(lines.length, Math.max(lineStart, lineEnd) + contextLines);
  return semanticLineRangeChunks(document, {
    namespace,
    indexedAt,
    lines,
    titlePrefix: `${document.title} ${basename(document.sourcePath)}`,
    lineStart: start,
    lineEnd: end,
    chunkBaseIndex: PROJECT_SEMANTIC_ENTITY_CHUNK_BASE_INDEX,
    maxChunks: PROJECT_SEMANTIC_MAX_ENTITY_CHUNKS_PER_DOCUMENT,
    metadata: {
      ...document.metadata,
      semanticSourceKind: 'entity_range',
      sourcePath: document.sourcePath,
      resourceKind,
      entityKind,
      entityName: typeof document.metadata.name === 'string' ? document.metadata.name : document.entityId,
      entityLineStart: lineStart,
      entityLineEnd: lineEnd,
      truncatedFile: sourceText.truncated
    }
  });
}

function semanticLineRangeChunks(
  document: ProjectSearchDocumentRecord,
  input: {
    namespace: string;
    indexedAt: string;
    lines: string[];
    titlePrefix: string;
    lineStart: number;
    lineEnd: number;
    chunkBaseIndex: number;
    maxChunks: number;
    metadata: Record<string, unknown>;
  }
): ProjectSemanticChunkInput[] {
  const chunks: ProjectSemanticChunkInput[] = [];
  const firstLine = Math.max(1, Math.min(input.lines.length, Math.floor(input.lineStart)));
  const lastLine = Math.max(firstLine, Math.min(input.lines.length, Math.floor(input.lineEnd)));
  let start = firstLine;
  while (start <= lastLine && chunks.length < input.maxChunks) {
    const selectedLines: string[] = [];
    let end = start - 1;
    while (end < lastLine && selectedLines.length < PROJECT_SEMANTIC_SOURCE_CHUNK_MAX_LINES) {
      const candidateLine = (input.lines[end] ?? '').slice(0, PROJECT_SEMANTIC_CHUNK_MAX_CHARS);
      const candidate = [...selectedLines, candidateLine].join('\n');
      if (selectedLines.length > 0 && candidate.length > PROJECT_SEMANTIC_CHUNK_MAX_CHARS) break;
      selectedLines.push(candidateLine);
      end += 1;
      if (candidate.length >= PROJECT_SEMANTIC_CHUNK_MAX_CHARS) break;
    }
    if (selectedLines.length === 0) {
      selectedLines.push((input.lines[start - 1] ?? '').slice(0, PROJECT_SEMANTIC_CHUNK_MAX_CHARS));
      end = start;
    }
    const excerpt = selectedLines.join('\n').trim();
    if (excerpt) {
      const lineTitle = `${input.titlePrefix}:${start}-${end}`;
      chunks.push(
        projectSemanticChunkFromContent(document, {
          namespace: input.namespace,
          title: lineTitle,
          content: `${lineTitle}\n${excerpt}`,
          chunkIndex: input.chunkBaseIndex + chunks.length,
          metadata: {
            ...input.metadata,
            lineStart: start,
            lineEnd: end,
            sourceRange: `${start}-${end}`
          },
          indexedAt: input.indexedAt
        })
      );
    }
    if (end >= lastLine) break;
    start = Math.max(start + 1, end + 1 - PROJECT_SEMANTIC_SOURCE_CHUNK_OVERLAP_LINES);
  }
  return chunks;
}

function semanticResourceKindSupportsDirectText(resourceKind: string): boolean {
  return resourceKind === 'source' || resourceKind === 'text' || resourceKind === 'manifest';
}

function getSemanticDirectSourceText(path: string, resourceKind: string, sourceTextCache: Map<string, ProjectSemanticDirectSourceText | null>): ProjectSemanticDirectSourceText | null {
  const key = `${resourceKind}:${path}`;
  if (sourceTextCache.has(key)) return sourceTextCache.get(key) ?? null;
  let result: ProjectSemanticDirectSourceText | null = null;
  try {
    const stat = lstatSync(path);
    if (stat.isFile() && !stat.isSymbolicLink()) {
      result = readProjectStructureText(path, resourceKind, stat.size);
    }
  } catch {
    result = null;
  }
  sourceTextCache.set(key, result);
  return result;
}

function semanticMetadataNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : null;
}

function semanticVectorInput(namespace: string, title: string, content: string, metadata: Record<string, unknown>): string {
  return [namespace, title, content, semanticMetadataText(metadata)].filter(Boolean).join('\n');
}

function semanticMetadataText(metadata: Record<string, unknown>): string {
  const values: string[] = [];
  const keys = [
    'sourcePath',
    'relativePath',
    'language',
    'resourceKind',
    'entityKind',
    'entityName',
    'name',
    'signature',
    'component',
    'bugClass',
    'state',
    'kind',
    'mode',
    'sourceRange'
  ];
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) values.push(value);
    else if (typeof value === 'number' && Number.isFinite(value)) values.push(String(value));
  }
  const cweMappings = metadata.cweMappings;
  if (Array.isArray(cweMappings)) {
    for (const mapping of cweMappings) {
      if (!mapping || typeof mapping !== 'object') continue;
      const record = mapping as Record<string, unknown>;
      for (const key of ['cweId', 'cweName']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) values.push(value);
      }
    }
  }
  return values.join('\n');
}

function semanticTokens(value: string): Array<{ term: string; weight: number }> {
  const raw = value
    .split(/[^a-z0-9_.$/@:-]+/i)
    .flatMap((token) => semanticTokenCandidates(token))
    .filter((token): token is string => Boolean(token && token.length >= 2 && !SEMANTIC_STOP_WORDS.has(token)));
  const tokens: Array<{ term: string; weight: number }> = [];
  for (const term of raw) {
    tokens.push({ term, weight: 1 });
    for (const synonym of semanticSynonymsForTerm(term)) tokens.push({ term: synonym, weight: 0.45 });
  }
  return tokens;
}

function semanticSynonymsForTerm(term: string): string[] {
  if (!Object.prototype.hasOwnProperty.call(SEMANTIC_SYNONYMS, term)) return [];
  const synonyms = SEMANTIC_SYNONYMS[term];
  return Array.isArray(synonyms) ? synonyms : [];
}

function semanticTokenCandidates(value: string): string[] {
  const stripped = value.trim().replace(/^[-_.:/]+|[-_.:/]+$/g, '');
  if (!stripped) return [];
  const candidates = new Set<string>();
  const normalizedFull = semanticNormalizeToken(stripped.toLowerCase());
  if (normalizedFull) candidates.add(normalizedFull);
  const expanded = stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[_.$/@:-]+|\s+/)
    .map((part) => semanticNormalizeToken(part.toLowerCase()))
    .filter((part) => part.length >= 2);
  for (const part of expanded) candidates.add(part);
  return Array.from(candidates);
}

function semanticNormalizeToken(value: string): string {
  const token = value.trim().replace(/^[-_.:/]+|[-_.:/]+$/g, '');
  if (!token) return '';
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function semanticVectorForText(value: string, namespace: string): Record<string, number> {
  const sorted = Array.from(semanticWeightedTerms(`${namespace} ${value}`).entries())
    .map(([term, weight]) => [term, Math.round((1 + Math.log(weight)) * 1000) / 1000] as const)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, PROJECT_SEMANTIC_MAX_VECTOR_TERMS);
  return Object.fromEntries(sorted);
}

function semanticWeightedTerms(value: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const { term, weight } of semanticTokens(value)) {
    weights.set(term, (weights.get(term) ?? 0) + weight);
  }
  return weights;
}

function semanticCosineSimilarity(left: Record<string, number>, right: Record<string, number>): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of Object.values(left)) leftNorm += value * value;
  for (const [term, value] of Object.entries(right)) {
    rightNorm += value * value;
    dot += (left[term] ?? 0) * value;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function semanticQueryProfile(query: string): ProjectSemanticQueryProfile {
  const termWeights = semanticWeightedTerms(query);
  const terms = Array.from(termWeights.keys());
  const namespaceWeights = semanticNamespaceWeights(termWeights);
  const totalWeight = Array.from(termWeights.values()).reduce((sum, weight) => sum + weight, 0);
  return { terms, termWeights, namespaceWeights, totalWeight };
}

function semanticNamespaceWeights(termWeights: Map<string, number>): Record<string, number> {
  const namespaceHints: Record<string, string[]> = {
    binary: ['binary', 'crash', 'fault', 'jni', 'native', 'signal', 'sigsegv', 'symbol', 'wasm'],
    code: ['auth', 'authorization', 'class', 'function', 'guard', 'handler', 'import', 'method', 'middleware', 'parser', 'query', 'route', 'sql'],
    docs: ['policy', 'readme', 'rule', 'scope'],
    mobile: ['activity', 'android', 'camera', 'exported', 'ios', 'manifest', 'mobile', 'permission', 'provider', 'receiver', 'service'],
    research_memory: ['artifact', 'chain', 'evidence', 'impact', 'memory', 'observation', 'primitive', 'reproduced', 'trajectory', 'verifier'],
    web: ['api', 'csrf', 'endpoint', 'graphql', 'http', 'request', 'response', 'route', 'ssrf', 'url', 'xss']
  };
  const weights: Record<string, number> = {};
  for (const [namespace, hints] of Object.entries(namespaceHints)) {
    const score = hints.reduce((sum, hint) => sum + (termWeights.get(hint) ?? 0), 0);
    if (score > 0) weights[namespace] = Math.min(0.16, score * 0.035);
  }
  return weights;
}

const SEMANTIC_SECURITY_SIGNAL_TERMS = new Set([
  'access',
  'account',
  'admin',
  'auth',
  'authentication',
  'authorization',
  'authorize',
  'authz',
  'bypass',
  'check',
  'cookie',
  'credential',
  'csrf',
  'deserialization',
  'deserialize',
  'exposure',
  'exported',
  'guard',
  'idor',
  'injection',
  'intent',
  'key',
  'native',
  'oauth',
  'parser',
  'permission',
  'privilege',
  'redirect',
  'route',
  'secret',
  'session',
  'signature',
  'sink',
  'sql',
  'sqli',
  'ssrf',
  'token',
  'traversal',
  'validation',
  'xss'
]);

const SEMANTIC_HIGH_VALUE_ENTITY_KINDS = new Set([
  'binary_exported_symbol',
  'binary_imported_symbol',
  'binary_string',
  'binary_symbol',
  'function',
  'graphql_operation',
  'method',
  'mobile_permission',
  'permission_marker',
  'route',
  'security_marker',
  'sink',
  'web_endpoint'
]);

const SEMANTIC_RESEARCH_MEMORY_ENTITY_TYPES = new Set(['artifact', 'verifier_contract', 'verifier_run']);
const SEMANTIC_STRONG_RESEARCH_STATES = new Set(['pass', 'completed', 'approved']);
const SEMANTIC_DUPLICATE_RISK_STATES = new Set(['failed', 'error', 'rejected']);
const SEMANTIC_DUPLICATE_RISK_TERMS = ['failed', 'error', 'rejected', 'not reproducible', 'out of scope'];

function semanticRankScore(row: SqlRow, profile: ProjectSemanticQueryProfile, queryVector: Record<string, number>): ProjectSemanticRankScore {
  const vectorScore = semanticCosineSimilarity(parseSemanticVector(row.vector_json), queryVector);
  const titleWeights = semanticWeightedTerms(text(row, 'title'));
  const metadata = parseJson(row.metadata_json);
  const content = text(row, 'content');
  const rankingText = `${text(row, 'title')}\n${content}\n${nullableText(row, 'source_path') ?? ''}\n${semanticMetadataText(metadata)}`;
  const contentWeights = semanticWeightedTerms(rankingText);
  const matchedTerms = profile.terms.filter((term) => contentWeights.has(term)).slice(0, 12);
  const matchedWeight = matchedTerms.reduce((sum, term) => sum + (profile.termWeights.get(term) ?? 0), 0);
  const lexicalScore = profile.totalWeight > 0 ? Math.min(1, matchedWeight / profile.totalWeight) : 0;
  const titleMatchedWeight = profile.terms.filter((term) => titleWeights.has(term)).reduce((sum, term) => sum + (profile.termWeights.get(term) ?? 0), 0);
  const titleScore = profile.totalWeight > 0 ? Math.min(1, titleMatchedWeight / profile.totalWeight) : 0;
  const namespaceScore = profile.namespaceWeights[text(row, 'namespace')] ?? 0;
  const entityScore = semanticEntityScore(text(row, 'entity_type'));
  const pathScore = semanticPathScore(nullableText(row, 'source_path'), profile);
  const proximityScore = semanticProximityScore(content, matchedTerms);
  const provenanceScore = semanticProvenanceScore(text(row, 'entity_type'), metadata);
  const baseScore = vectorScore * 0.56 + lexicalScore * 0.2 + titleScore * 0.08 + proximityScore + pathScore + namespaceScore + entityScore + provenanceScore;
  const securityScore = semanticSecurityScore(contentWeights);
  const scopeScore = semanticScopeScore(row, metadata);
  const structureScore = semanticStructureScore(row, metadata);
  const researchMemoryScore = semanticResearchMemoryScore(row, metadata);
  const duplicateRiskPenalty = semanticDuplicateRiskPenalty(row, metadata, rankingText);
  const rerankScore = securityScore + scopeScore + structureScore + researchMemoryScore - duplicateRiskPenalty;
  const score = Math.max(0, baseScore + rerankScore);
  const rounded: ProjectSemanticRankScore = {
    score: roundSemanticScore(score),
    baseScore: roundSemanticScore(baseScore),
    rerankScore: roundSemanticScore(rerankScore),
    vectorScore: roundSemanticScore(vectorScore),
    lexicalScore: roundSemanticScore(lexicalScore),
    titleScore: roundSemanticScore(titleScore),
    namespaceScore: roundSemanticScore(namespaceScore),
    entityScore: roundSemanticScore(entityScore),
    pathScore: roundSemanticScore(pathScore),
    proximityScore: roundSemanticScore(proximityScore),
    provenanceScore: roundSemanticScore(provenanceScore),
    securityScore: roundSemanticScore(securityScore),
    scopeScore: roundSemanticScore(scopeScore),
    structureScore: roundSemanticScore(structureScore),
    researchMemoryScore: roundSemanticScore(researchMemoryScore),
    duplicateRiskPenalty: roundSemanticScore(duplicateRiskPenalty),
    matchedTerms,
    rankReason: ''
  };
  return { ...rounded, rankReason: semanticRankReason(rounded) };
}

function semanticEntityScore(entityType: string): number {
  if (entityType === 'structure_entity') return 0.035;
  if (entityType === 'artifact') return 0.03;
  if (entityType === 'verifier_run' || entityType === 'verifier_contract') return 0.025;
  if (entityType === 'inventory_item') return 0.015;
  return 0;
}

function semanticPathScore(sourcePath: string | null, profile: ProjectSemanticQueryProfile): number {
  if (!sourcePath || profile.totalWeight <= 0) return 0;
  const pathWeights = semanticWeightedTerms(sourcePath);
  const matchedWeight = profile.terms.filter((term) => pathWeights.has(term)).reduce((sum, term) => sum + (profile.termWeights.get(term) ?? 0), 0);
  return Math.min(0.055, (matchedWeight / profile.totalWeight) * 0.055);
}

function semanticProximityScore(content: string, matchedTerms: string[]): number {
  if (matchedTerms.length < 2) return 0;
  const lower = content.toLowerCase();
  const positions = matchedTerms
    .map((term) => lower.indexOf(term))
    .filter((position) => position >= 0)
    .sort((left, right) => left - right);
  if (positions.length < 2) return 0;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (let index = 1; index < positions.length; index += 1) {
    bestSpan = Math.min(bestSpan, positions[index] - positions[index - 1]);
  }
  if (bestSpan <= 160) return 0.07;
  if (bestSpan <= 420) return 0.045;
  return 0.02;
}

function semanticProvenanceScore(entityType: string, metadata: Record<string, unknown>): number {
  const sourceKind = typeof metadata.semanticSourceKind === 'string' ? metadata.semanticSourceKind : '';
  if (sourceKind === 'entity_range') return 0.055;
  if (sourceKind === 'source_range') return 0.04;
  if (entityType === 'structure_entity') return 0.025;
  if (entityType === 'inventory_item') return 0.01;
  return 0;
}

function semanticSecurityScore(weights: Map<string, number>): number {
  let matched = 0;
  for (const term of SEMANTIC_SECURITY_SIGNAL_TERMS) {
    if (weights.has(term)) matched += 1;
  }
  if (matched === 0) return 0;
  return Math.min(0.09, 0.025 + matched * 0.012);
}

function semanticScopeScore(row: SqlRow, metadata: Record<string, unknown>): number {
  let score = 0;
  const sourcePath = nullableText(row, 'source_path');
  const metadataSourcePath = typeof metadata.sourcePath === 'string' ? metadata.sourcePath : '';
  const sourceKind = typeof metadata.semanticSourceKind === 'string' ? metadata.semanticSourceKind : '';
  if ((sourcePath && isAbsolute(sourcePath)) || (metadataSourcePath && isAbsolute(metadataSourcePath))) score += 0.02;
  if (sourceKind === 'source_range' || sourceKind === 'entity_range') score += 0.015;
  if (typeof metadata.resourceKind === 'string' && metadata.resourceKind.trim()) score += 0.005;
  if (semanticMetadataNumber(metadata.lineStart) || semanticMetadataNumber(metadata.entityLineStart)) score += 0.005;
  if (typeof metadata.sourceDocumentId === 'string' && metadata.sourceDocumentId.trim()) score += 0.005;
  return Math.min(0.045, score);
}

function semanticStructureScore(row: SqlRow, metadata: Record<string, unknown>): number {
  let score = 0;
  const entityType = text(row, 'entity_type');
  const entityKind = typeof metadata.entityKind === 'string' ? metadata.entityKind : '';
  const sourceKind = typeof metadata.semanticSourceKind === 'string' ? metadata.semanticSourceKind : '';
  if (entityType === 'structure_entity') score += 0.025;
  if (sourceKind === 'entity_range') score += 0.015;
  if (SEMANTIC_HIGH_VALUE_ENTITY_KINDS.has(entityKind)) score += 0.02;
  if (typeof metadata.signature === 'string' && metadata.signature.trim()) score += 0.005;
  if (typeof metadata.name === 'string' && metadata.name.trim()) score += 0.005;
  if (semanticMetadataNumber(metadata.lineStart) || semanticMetadataNumber(metadata.entityLineStart)) score += 0.005;
  return Math.min(0.055, score);
}

function semanticResearchMemoryScore(row: SqlRow, metadata: Record<string, unknown>): number {
  let score = 0;
  const namespace = text(row, 'namespace');
  const entityType = text(row, 'entity_type');
  const state = typeof metadata.state === 'string' ? metadata.state : '';
  if (namespace === 'research_memory') score += 0.012;
  if (SEMANTIC_RESEARCH_MEMORY_ENTITY_TYPES.has(entityType)) score += 0.018;
  if (SEMANTIC_STRONG_RESEARCH_STATES.has(state)) score += 0.025;
  if (Array.isArray(metadata.cweMappings) && metadata.cweMappings.length > 0) score += 0.01;
  if (typeof metadata.primaryCweId === 'string' && metadata.primaryCweId.trim()) score += 0.01;
  return Math.min(0.05, score);
}

function semanticDuplicateRiskPenalty(row: SqlRow, metadata: Record<string, unknown>, rankingText: string): number {
  let penalty = 0;
  const state = typeof metadata.state === 'string' ? metadata.state : '';
  if (SEMANTIC_DUPLICATE_RISK_STATES.has(state)) penalty += 0.075;
  const lower = `${text(row, 'title')}\n${rankingText}`.toLowerCase();
  if (SEMANTIC_DUPLICATE_RISK_TERMS.some((term) => lower.includes(term))) penalty += 0.045;
  if (typeof metadata.duplicateOf === 'string' && metadata.duplicateOf.trim()) penalty += 0.04;
  return Math.min(0.12, penalty);
}

function semanticRankReason(score: ProjectSemanticRankScore): string {
  const reasons: string[] = [];
  if (score.vectorScore >= 0.18) reasons.push('strong local vector overlap');
  else if (score.vectorScore >= 0.06) reasons.push('local vector overlap');
  if (score.lexicalScore >= 0.5) reasons.push('term overlap');
  else if (score.lexicalScore > 0) reasons.push('partial term overlap');
  if (score.titleScore > 0) reasons.push('title overlap');
  if (score.proximityScore > 0) reasons.push('nearby term evidence');
  if (score.pathScore > 0) reasons.push('path fit');
  if (score.namespaceScore > 0) reasons.push('namespace fit');
  if (score.entityScore > 0 || score.provenanceScore > 0) reasons.push('indexed source provenance');
  if (score.securityScore > 0) reasons.push('security-relevant surface');
  if (score.scopeScore > 0) reasons.push('scope-backed source');
  if (score.structureScore > 0) reasons.push('code-structure fit');
  if (score.researchMemoryScore > 0) reasons.push('prior research signal');
  if (score.duplicateRiskPenalty > 0) reasons.push('duplicate or dismissed risk penalty');
  return reasons.join('; ') || 'local semantic similarity';
}

function roundSemanticScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseSemanticVector(value: SqlPrimitive | undefined): Record<string, number> {
  const parsed = parseJson(value);
  const vector: Record<string, number> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item === 'number' && Number.isFinite(item)) vector[key] = item;
  }
  return vector;
}

function semanticDiversifyRankedCandidates(
  candidates: Array<{ row: SqlRow; score: ProjectSemanticRankScore }>,
  limit: number
): Array<{ row: SqlRow; score: ProjectSemanticRankScore }> {
  const max = Math.max(1, Math.floor(limit));
  const selected: Array<{ row: SqlRow; score: ProjectSemanticRankScore }> = [];
  const selectedIds = new Set<string>();
  const pathCounts = new Map<string, number>();
  const documentCounts = new Map<string, number>();

  const tryAdd = (candidate: { row: SqlRow; score: ProjectSemanticRankScore }, strict: boolean): void => {
    if (selected.length >= max) return;
    const id = text(candidate.row, 'id');
    if (selectedIds.has(id)) return;
    const sourcePath = nullableText(candidate.row, 'source_path');
    const sourceDocumentId = text(candidate.row, 'source_document_id');
    const sourceKind = semanticRowSourceKind(candidate.row);
    if (strict) {
      const pathCount = sourcePath ? (pathCounts.get(sourcePath) ?? 0) : 0;
      if (sourcePath && pathCount >= 3 && sourceKind !== 'source_range') return;
      if (sourcePath && pathCount >= 4) return;
      if ((documentCounts.get(sourceDocumentId) ?? 0) >= 2 && sourceKind !== 'entity_range') return;
    }
    selectedIds.add(id);
    if (sourcePath) pathCounts.set(sourcePath, (pathCounts.get(sourcePath) ?? 0) + 1);
    documentCounts.set(sourceDocumentId, (documentCounts.get(sourceDocumentId) ?? 0) + 1);
    selected.push(candidate);
  };

  for (const candidate of candidates) tryAdd(candidate, true);
  for (const candidate of candidates) tryAdd(candidate, false);
  return selected.sort((left, right) => right.score.score - left.score.score || text(right.row, 'indexed_at').localeCompare(text(left.row, 'indexed_at')));
}

function semanticRowSourceKind(row: SqlRow): string {
  const metadata = parseJson(row.metadata_json);
  return typeof metadata.semanticSourceKind === 'string' ? metadata.semanticSourceKind : '';
}

function projectSearchDocumentId(scopeVersionId: string, entityType: string, entityId: string): string {
  return createHash('sha256').update(`${scopeVersionId}\n${entityType}\n${entityId}`).digest('hex');
}

function projectInventoryItemId(scopeVersionId: string, assetId: string, itemKind: string, value: string): string {
  return `inventory_${createHash('sha256').update(`${scopeVersionId}\n${assetId}\n${itemKind}\n${value}`).digest('hex').slice(0, 32)}`;
}

function projectStructureEntityId(scopeVersionId: string, path: string, entityKind: string, name: string, lineStart: number): string {
  return `structure_${createHash('sha256').update(`${scopeVersionId}\n${path}\n${entityKind}\n${name}\n${lineStart}`).digest('hex').slice(0, 32)}`;
}

function projectStructureRelationId(scopeVersionId: string, sourceEntityId: string, relationKind: string, targetKind: string, targetName: string): string {
  return `structure_rel_${createHash('sha256').update(`${scopeVersionId}\n${sourceEntityId}\n${relationKind}\n${targetKind}\n${targetName}`).digest('hex').slice(0, 32)}`;
}

function projectGraphNodeId(scopeVersionId: string, entityType: string, entityId: string): string {
  return `graph_node_${createHash('sha256').update(`${scopeVersionId}\n${entityType}\n${entityId}`).digest('hex').slice(0, 32)}`;
}

function researchComponentEntityId(component: string): string {
  return `component_${createHash('sha256').update(component.trim().toLowerCase()).digest('hex').slice(0, 24)}`;
}

function projectGraphEdgeId(scopeVersionId: string, sourceNodeId: string, edgeKind: string, targetEntityType: string, targetEntityId: string | null, targetLabel: string): string {
  return `graph_edge_${createHash('sha256').update(`${scopeVersionId}\n${sourceNodeId}\n${edgeKind}\n${targetEntityType}\n${targetEntityId ?? ''}\n${targetLabel}`).digest('hex').slice(0, 32)}`;
}

function projectSemanticChunkId(scopeVersionId: string, sourceDocumentId: string, chunkIndex: number, contentHash: string): string {
  return `semantic_${createHash('sha256').update(`${scopeVersionId}\n${sourceDocumentId}\n${chunkIndex}\n${contentHash}`).digest('hex').slice(0, 32)}`;
}

function normalizedProjectPath(path: string): string {
  return resolve(path);
}

function shouldSkipProjectIndexEntry(name: string): boolean {
  return PROJECT_INDEX_SKIPPED_DIRS.has(name.toLowerCase());
}

function classifyProjectResourceKind(path: string, isDirectory: boolean): string {
  if (isDirectory) return 'directory';
  const lowerName = basename(path).toLowerCase();
  const ext = extname(lowerName);
  if (PROJECT_INDEX_MANIFEST_FILES.has(lowerName)) return 'manifest';
  if (PROJECT_INDEX_SOURCE_EXTENSIONS.has(ext)) return 'source';
  if (PROJECT_INDEX_BINARY_EXTENSIONS.has(ext)) return 'binary';
  if (PROJECT_INDEX_TEXT_EXTENSIONS.has(ext)) return 'text';
  if (ext === '.zip' || ext === '.tar' || ext === '.gz' || ext === '.tgz' || ext === '.7z') return 'archive';
  return 'unknown';
}

function languageForProjectPath(path: string): string {
  const lowerName = basename(path).toLowerCase();
  const ext = extname(lowerName);
  if (lowerName === 'dockerfile') return 'dockerfile';
  const byExtension: Record<string, string> = {
    '.c': 'c',
    '.cc': 'cpp',
    '.conf': 'config',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.css': 'css',
    '.go': 'go',
    '.graphql': 'graphql',
    '.h': 'c',
    '.hpp': 'cpp',
    '.html': 'html',
    '.ini': 'config',
    '.java': 'java',
    '.js': 'javascript',
    '.json': 'json',
    '.jsx': 'javascript',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.lock': 'lockfile',
    '.m': 'objective-c',
    '.md': 'markdown',
    '.mm': 'objective-cpp',
    '.php': 'php',
    '.plist': 'plist',
    '.properties': 'properties',
    '.proto': 'protobuf',
    '.py': 'python',
    '.rb': 'ruby',
    '.rs': 'rust',
    '.scala': 'scala',
    '.sql': 'sql',
    '.swift': 'swift',
    '.toml': 'toml',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.txt': 'text',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml'
  };
  return byExtension[ext] ?? '';
}

function hashProjectFileIfCheap(path: string, sizeBytes: number): string | null {
  if (sizeBytes > PROJECT_INVENTORY_HASH_MAX_BYTES) return null;
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

function readProjectSearchPreview(path: string, resourceKind: string, sizeBytes: number): string {
  if (sizeBytes <= 0) return '';
  if (resourceKind === 'binary') return readProjectBinaryStringsPreview(path, sizeBytes);
  if (sizeBytes > PROJECT_INVENTORY_PREVIEW_MAX_BYTES) return '';
  if (resourceKind !== 'manifest' && resourceKind !== 'text') return '';
  try {
    const buffer = readFileSync(path);
    if (!projectBufferLooksTextual(buffer)) return '';
    return buffer.toString('utf8').slice(0, PROJECT_INVENTORY_PREVIEW_MAX_BYTES);
  } catch {
    return '';
  }
}

function readProjectStructureText(path: string, resourceKind: string, sizeBytes: number): { text: string; truncated: boolean } | null {
  if (resourceKind !== 'source' && resourceKind !== 'text' && resourceKind !== 'manifest') return null;
  if (sizeBytes <= 0) return null;
  const bytesToRead = Math.min(sizeBytes, PROJECT_STRUCTURE_MAX_FILE_BYTES);
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
    if (bytesRead <= 0) return null;
    const sample = buffer.subarray(0, bytesRead);
    if (!projectBufferLooksTextual(sample)) return null;
    return {
      text: sample.toString('utf8').replace(/\r\n?/g, '\n'),
      truncated: sizeBytes > bytesRead
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function readProjectBinaryStringsPreview(path: string, sizeBytes: number): string {
  if (sizeBytes <= 0) return '';
  const bytesToRead = Math.min(sizeBytes, PROJECT_INVENTORY_BINARY_SCAN_MAX_BYTES);
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
    if (bytesRead <= 0) return '';
    return extractProjectBinaryStrings(buffer.subarray(0, bytesRead)).join('\n');
  } catch {
    return '';
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function extractProjectBinaryStrings(buffer: Buffer): string[] {
  const strings: string[] = [];
  let current = '';
  let totalChars = 0;
  const flush = (): void => {
    const trimmed = current.trim();
    current = '';
    if (trimmed.length < 4) return;
    strings.push(trimmed);
    totalChars += trimmed.length;
  };

  for (const byte of buffer) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      if (current.length >= 256) flush();
    } else {
      flush();
    }
    if (totalChars >= PROJECT_INVENTORY_BINARY_STRINGS_MAX_CHARS) break;
  }
  flush();
  return strings.slice(0, 256);
}

function parseProjectManifestMetadata(path: string, preview: string): Record<string, unknown> {
  if (!preview.trim()) return {};
  const lowerName = basename(path).toLowerCase();
  if (lowerName === 'package.json') return parsePackageJsonManifest(preview);
  if (lowerName === 'requirements.txt') return parseRequirementsManifest(preview);
  if (lowerName === 'go.mod') return parseGoModManifest(preview);
  if (lowerName === 'cargo.toml') return parseCargoTomlManifest(preview);
  if (lowerName === 'pom.xml') return parsePomXmlManifest(preview);
  return { manifestType: lowerName };
}

function parsePackageJsonManifest(preview: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(preview);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { manifestType: 'package.json' };
    const data = parsed as Record<string, unknown>;
    const dependencyGroups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    const dependencies: Record<string, string[]> = {};
    for (const group of dependencyGroups) {
      const value = data[group];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      dependencies[group] = Object.keys(value as Record<string, unknown>).sort();
    }
    return {
      manifestType: 'package.json',
      packageName: typeof data.name === 'string' ? data.name : '',
      packageVersion: typeof data.version === 'string' ? data.version : '',
      dependencyNames: Object.values(dependencies).flat(),
      dependencyGroups,
      dependencies
    };
  } catch {
    return { manifestType: 'package.json', parseError: 'invalid_json' };
  }
}

function parseRequirementsManifest(preview: string): Record<string, unknown> {
  const dependencyNames = preview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
    .map((line) => line.split(/[<>=!~;\[\]\s]/)[0]?.trim())
    .filter((line): line is string => Boolean(line));
  return { manifestType: 'requirements.txt', dependencyNames };
}

function parseGoModManifest(preview: string): Record<string, unknown> {
  const moduleName = /^module\s+(.+)$/m.exec(preview)?.[1]?.trim() ?? '';
  const dependencyNames: string[] = [];
  for (const match of preview.matchAll(/^\s*(?:require\s+)?([A-Za-z0-9_.~/-]+\.[A-Za-z0-9_.~/-]+)\s+v?\d/mg)) {
    dependencyNames.push(match[1]);
  }
  return { manifestType: 'go.mod', moduleName, dependencyNames: Array.from(new Set(dependencyNames)).sort() };
}

function parseCargoTomlManifest(preview: string): Record<string, unknown> {
  const packageName = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(preview)?.[1] ?? '';
  const dependencyNames = new Set<string>();
  let inDependencySection = false;
  for (const line of preview.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)]\s*$/.exec(line)?.[1]?.trim() ?? '';
    if (section) {
      inDependencySection = ['dependencies', 'dev-dependencies', 'build-dependencies'].includes(section);
      continue;
    }
    if (!inDependencySection) continue;
    const name = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1];
    if (name) dependencyNames.add(name);
  }
  return { manifestType: 'Cargo.toml', packageName, dependencyNames: Array.from(dependencyNames).sort() };
}

function parsePomXmlManifest(preview: string): Record<string, unknown> {
  const artifactIds = Array.from(preview.matchAll(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/g)).map((match) => match[1].trim());
  const groupIds = Array.from(preview.matchAll(/<groupId>\s*([^<]+?)\s*<\/groupId>/g)).map((match) => match[1].trim());
  return {
    manifestType: 'pom.xml',
    packageName: artifactIds[0] ?? '',
    groupName: groupIds[0] ?? '',
    dependencyNames: Array.from(new Set(artifactIds.slice(1))).sort()
  };
}

function binaryStructureCandidate(value: string, lineStart: number): ProjectStructureCandidate | null {
  const trimmed = value.trim();
  if (trimmed.length < 4 || trimmed.length > 300) return null;

  const importedSymbol = binaryImportedSymbolFromString(trimmed);
  if (importedSymbol) {
    return {
      entityKind: 'binary_imported_symbol',
      name: importedSymbol,
      signature: trimmed,
      lineStart,
      lineEnd: lineStart,
      metadata: { relationKind: 'imports_symbol', binaryStringKind: 'imported_symbol', binarySymbolRole: 'imported' },
      relations: [{ relationKind: 'imports_symbol', targetKind: 'symbol', targetName: importedSymbol }]
    };
  }

  const exportedSymbol = binaryExportedSymbolFromString(trimmed);
  if (exportedSymbol) {
    return {
      entityKind: 'binary_exported_symbol',
      name: exportedSymbol,
      signature: trimmed,
      lineStart,
      lineEnd: lineStart,
      metadata: { relationKind: 'exports_symbol', binaryStringKind: 'exported_symbol', binarySymbolRole: 'exported' },
      relations: [{ relationKind: 'exports_symbol', targetKind: 'symbol', targetName: exportedSymbol }]
    };
  }

  const url = /https?:\/\/[A-Za-z0-9_~:/?#[\]@!$&'()*+,;=.%.-]+/.exec(trimmed)?.[0];
  if (url) {
    return {
      entityKind: 'binary_url',
      name: url.slice(0, 240),
      signature: trimmed,
      lineStart,
      lineEnd: lineStart,
      metadata: { relationKind: 'references_url', binaryStringKind: 'url' },
      relations: [{ relationKind: 'references_url', targetKind: 'url', targetName: url.slice(0, 240) }]
    };
  }

  const endpoint = /\/(?:api|oauth|auth|graphql|v\d)[A-Za-z0-9_./{}:*-]*/.exec(trimmed)?.[0];
  if (endpoint && endpoint.length > 4) {
    return {
      entityKind: 'web_endpoint',
      name: endpoint.slice(0, 240),
      signature: trimmed,
      lineStart,
      lineEnd: lineStart,
      metadata: { relationKind: 'contains_endpoint', endpointStyle: 'binary_string' },
      relations: [{ relationKind: 'contains_endpoint', targetKind: 'endpoint', targetName: endpoint.slice(0, 240) }]
    };
  }

  const permission = /android\.permission\.[A-Z0-9_.]+/.exec(trimmed)?.[0];
  if (permission) {
    return {
      entityKind: 'mobile_permission',
      name: permission,
      signature: trimmed,
      lineStart,
      lineEnd: lineStart,
      metadata: { platform: 'android', relationKind: 'references_permission', binaryStringKind: 'permission' },
      relations: [{ relationKind: 'references_permission', targetKind: 'permission', targetName: permission }]
    };
  }

  const jniSymbol = /Java_[A-Za-z0-9_]+/.exec(trimmed)?.[0];
  if (jniSymbol) {
    return {
      entityKind: 'binary_symbol',
      name: jniSymbol.slice(0, 240),
      signature: trimmed,
      lineStart,
      lineEnd: lineStart,
      metadata: { relationKind: 'exports_symbol', binaryStringKind: 'jni_symbol', binarySymbolRole: 'exported' },
      relations: [{ relationKind: 'exports_symbol', targetKind: 'symbol', targetName: jniSymbol.slice(0, 240) }]
    };
  }

  if (isNotableBinaryString(trimmed)) {
    return {
      entityKind: 'binary_string',
      name: trimmed.slice(0, 120),
      signature: trimmed,
      lineStart,
      lineEnd: lineStart,
      metadata: { relationKind: 'contains_string', binaryStringKind: 'notable_string' },
      relations: [{ relationKind: 'contains_string', targetKind: 'string', targetName: trimmed.slice(0, 240) }]
    };
  }

  return null;
}

function binaryImportedSymbolFromString(value: string): string | null {
  const explicit = /^(?:IMPORT|IMPORTED|import|imported)(?::|\s+symbol:|\s+)([A-Za-z_.$@?][A-Za-z0-9_.$@?/-]{2,})$/.exec(value)?.[1];
  if (explicit) return explicit.slice(0, 240);
  const impPrefix = /^__imp_([A-Za-z_.$@?][A-Za-z0-9_.$@?/-]{2,})$/.exec(value)?.[1];
  return impPrefix ? impPrefix.slice(0, 240) : null;
}

function binaryExportedSymbolFromString(value: string): string | null {
  const explicit = /^(?:EXPORT|EXPORTED|export|exported)(?::|\s+symbol:|\s+)([A-Za-z_.$@?][A-Za-z0-9_.$@?/-]{2,})$/.exec(value)?.[1];
  if (explicit) return explicit.slice(0, 240);
  const commonEntrypoint = /^(JNI_OnLoad|DllMain|main|_start)$/.exec(value)?.[1];
  return commonEntrypoint ?? null;
}

function isNotableBinaryString(value: string): boolean {
  if (/\s/.test(value) && value.length > 160) return false;
  return /(?:CRASH|SIGSEGV|SIGABRT|FATAL|ERROR|DEBUG|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|SQL|SELECT|INSERT|UPDATE|DELETE|PRIVATE_KEY|API_KEY)/i.test(value);
}

function extractProjectStructureCandidates(path: string, language: string, text: string, truncatedFile: boolean): ProjectStructureCandidate[] {
  const lines = text.split('\n');
  const candidates: ProjectStructureCandidate[] = [];
  const add = (candidate: ProjectStructureCandidate): void => {
    if (candidates.length >= PROJECT_STRUCTURE_MAX_ENTITIES_PER_FILE) return;
    if (!candidate.name.trim()) return;
    candidates.push({
      ...candidate,
      name: candidate.name.trim().slice(0, 240),
      signature: candidate.signature.trim().slice(0, 1000),
      metadata: {
        ...candidate.metadata,
        truncatedFile
      }
    });
  };

  extractTypeScriptAstStructureCandidates(path, language, text, lines, add);
  extractJavaParserLightStructureCandidates(language, lines, add);
  extractGoParserLightStructureCandidates(lines, language, add);

  for (const [index, line] of lines.entries()) {
    const lineStart = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    extractImportCandidate(line, language, lineStart, add);
    extractExportCandidate(line, language, lineStart, add);
    extractFileBackedRouteCandidate(path, line, language, lineStart, add);
    extractRouteCandidate(line, language, lineStart, add);
    extractDefinitionCandidate(line, language, lineStart, add);
    extractFrameworkDataFlowCandidate(line, language, lineStart, add);
    extractSecurityMarkerCandidate(line, language, lineStart, add);
    extractSinkCandidate(line, language, lineStart, add);
    extractMobileManifestCandidate(path, line, language, lineStart, add);
    extractWebEndpointCandidate(path, line, language, lineStart, add);
    extractCallSiteCandidate(line, language, lineStart, add);
  }

  return finalizeProjectStructureCandidates(candidates, lines.length, path);
}

function extractImportCandidate(line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  const jsImport = /^\s*import(?:\s+.+?\s+from)?\s+['"]([^'"]+)['"]/.exec(line) ?? /^\s*(?:const|let|var)\s+.+?\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
  if ((language === 'javascript' || language === 'typescript') && jsImport?.[1]) {
    add({
      entityKind: 'import',
      name: jsImport[1],
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { module: jsImport[1], importStyle: 'javascript' },
      relations: [{ relationKind: 'imports', targetKind: 'module', targetName: jsImport[1] }]
    });
    return;
  }

  const pyImport = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(line);
  if (language === 'python' && (pyImport?.[1] || pyImport?.[2])) {
    const moduleName = pyImport[1] ?? pyImport[2];
    add({
      entityKind: 'import',
      name: moduleName,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { module: moduleName, importStyle: 'python' },
      relations: [{ relationKind: 'imports', targetKind: 'module', targetName: moduleName }]
    });
    return;
  }

  const javaImport = /^\s*import\s+(?:static\s+)?([^;]+);/.exec(line);
  if ((language === 'java' || language === 'kotlin' || language === 'csharp') && javaImport?.[1]) {
    add({
      entityKind: 'import',
      name: javaImport[1],
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { module: javaImport[1], importStyle: language },
      relations: [{ relationKind: 'imports', targetKind: 'module', targetName: javaImport[1] }]
    });
    return;
  }

  const rustUse = /^\s*use\s+([^;]+);/.exec(line);
  if (language === 'rust' && rustUse?.[1]) {
    add({
      entityKind: 'import',
      name: rustUse[1],
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { module: rustUse[1], importStyle: 'rust' },
      relations: [{ relationKind: 'imports', targetKind: 'module', targetName: rustUse[1] }]
    });
    return;
  }

  const goImport = /^\s*import\s+(?:[A-Za-z_]\w*\s+)?["`]([^"`]+)["`]/.exec(line);
  if (language === 'go' && goImport?.[1]) {
    add({
      entityKind: 'import',
      name: goImport[1],
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { module: goImport[1], importStyle: 'go' },
      relations: [{ relationKind: 'imports', targetKind: 'module', targetName: goImport[1] }]
    });
  }
}

function extractExportCandidate(line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  if (language === 'javascript' || language === 'typescript') {
    const namedExport = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
    const exportList = /^\s*export\s*\{([^}]+)}/.exec(line);
    const commonJsExport = /^\s*(?:module\.)?exports(?:\.([A-Za-z_$][\w$]*))?\s*=\s*(.*)$/.exec(line);
    if (namedExport?.[1]) {
      add({
        entityKind: 'export',
        name: namedExport[1],
        signature: line,
        lineStart,
        lineEnd: lineStart,
        metadata: { exportedName: namedExport[1], exportStyle: 'named_declaration' },
        relations: [{ relationKind: 'exports', targetKind: 'symbol', targetName: namedExport[1] }]
      });
      return;
    }
    if (exportList?.[1]) {
      for (const name of exportList[1].split(',').map((item) => item.trim().split(/\s+as\s+/i)[0]?.trim()).filter(Boolean)) {
        add({
          entityKind: 'export',
          name,
          signature: line,
          lineStart,
          lineEnd: lineStart,
          metadata: { exportedName: name, exportStyle: 'export_list' },
          relations: [{ relationKind: 'exports', targetKind: 'symbol', targetName: name }]
        });
      }
      return;
    }
    if (commonJsExport) {
      const objectExports = commonJsExport[2] ? commonJsObjectExportNames(commonJsExport[2]) : [];
      if (objectExports.length > 0) {
        for (const exportedName of objectExports) {
          add({
            entityKind: 'export',
            name: exportedName,
            signature: line,
            lineStart,
            lineEnd: lineStart,
            metadata: { exportedName, exportStyle: 'commonjs_object' },
            relations: [{ relationKind: 'exports', targetKind: 'symbol', targetName: exportedName }]
          });
        }
        return;
      }
      const exportedName = commonJsExport[1] ?? 'module.exports';
      add({
        entityKind: 'export',
        name: exportedName,
        signature: line,
        lineStart,
        lineEnd: lineStart,
        metadata: { exportedName, exportStyle: 'commonjs' },
        relations: [{ relationKind: 'exports', targetKind: 'symbol', targetName: exportedName }]
      });
    }
  }
}

function commonJsObjectExportNames(value: string): string[] {
  const match = /^\s*\{(.+)}\s*;?\s*$/.exec(value);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.trim().split(/\s*:\s*/)[0]?.trim())
    .filter((part): part is string => Boolean(part && /^[A-Za-z_$][\w$]*$/.test(part)));
}

function extractFileBackedRouteCandidate(path: string, line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  if (language !== 'javascript' && language !== 'typescript') return;
  const nextRoutePath = routePathFromNextRouteFile(path);
  const nextMethod = /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/.exec(line)?.[1];
  if (nextRoutePath && nextMethod) {
    add({
      entityKind: 'route',
      name: `${nextMethod} ${nextRoutePath}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method: nextMethod, routePath: nextRoutePath, routeStyle: 'nextjs_app_route', relationKinds: ['routes_to', 'handles_with'] },
      relations: [
        { relationKind: 'routes_to', targetKind: 'route', targetName: `${nextMethod} ${nextRoutePath}` },
        { relationKind: 'handles_with', targetKind: 'function', targetName: nextMethod }
      ]
    });
    return;
  }

  const pagesRoutePath = routePathFromPagesApiFile(path);
  if (pagesRoutePath && /^\s*export\s+default\s+(?:async\s+)?function\b/.test(line)) {
    add({
      entityKind: 'route',
      name: `ANY ${pagesRoutePath}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method: 'ANY', routePath: pagesRoutePath, routeStyle: 'nextjs_pages_api', relationKinds: ['routes_to'] },
      relations: [{ relationKind: 'routes_to', targetKind: 'route', targetName: `ANY ${pagesRoutePath}` }]
    });
  }
}

function extractRouteCandidate(line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  const jsRoute = /\b(?:app|router|server|fastify)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/i.exec(line);
  if ((language === 'javascript' || language === 'typescript') && jsRoute) {
    const method = jsRoute[1].toUpperCase();
    const routePath = jsRoute[2];
    const participants = routeParticipantsFromCall(line);
    const routeStyle = /\bfastify\./i.test(line) ? 'fastify' : 'express_or_koa';
    add({
      entityKind: 'route',
      name: `${method} ${routePath}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method, routePath, routeStyle, middleware: participants.middleware, handlers: participants.handlers, relationKinds: ['routes_to', 'uses_middleware', 'handles_with'] },
      relations: [
        { relationKind: 'routes_to', targetKind: 'route', targetName: `${method} ${routePath}` },
        ...participants.middleware.map((name) => ({ relationKind: 'uses_middleware', targetKind: 'function', targetName: name })),
        ...participants.handlers.map((name) => ({ relationKind: 'handles_with', targetKind: 'function', targetName: name }))
      ]
    });
    return;
  }

  const fastifyRoute = /\bfastify\.route\s*\(\s*\{(.+)}\s*\)/i.exec(line);
  if ((language === 'javascript' || language === 'typescript') && fastifyRoute?.[1]) {
    const body = fastifyRoute[1];
    const method = /method\s*:\s*['"`]([A-Z]+)['"`]/i.exec(body)?.[1]?.toUpperCase() ?? 'ANY';
    const routePath = /url\s*:\s*['"`]([^'"`]+)['"`]/i.exec(body)?.[1] ?? /path\s*:\s*['"`]([^'"`]+)['"`]/i.exec(body)?.[1] ?? '';
    const handler = /handler\s*:\s*([A-Za-z_$][\w$]*)/.exec(body)?.[1] ?? '';
    if (routePath) {
      add({
        entityKind: 'route',
        name: `${method} ${routePath}`,
        signature: line,
        lineStart,
        lineEnd: lineStart,
        metadata: { method, routePath, routeStyle: 'fastify_route_object', handlers: handler ? [handler] : [], relationKinds: ['routes_to', 'handles_with'] },
        relations: [
          { relationKind: 'routes_to', targetKind: 'route', targetName: `${method} ${routePath}` },
          ...(handler ? [{ relationKind: 'handles_with', targetKind: 'function', targetName: handler }] : [])
        ]
      });
      return;
    }
  }

  const jsUseRoute = /\b(?:app|router|server)\.use\s*\(\s*['"`]([^'"`]+)['"`]/i.exec(line);
  if ((language === 'javascript' || language === 'typescript') && jsUseRoute) {
    const routePath = jsUseRoute[1];
    const participants = routeParticipantsFromCall(line);
    add({
      entityKind: 'route',
      name: `USE ${routePath}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method: 'USE', routePath, routeStyle: 'express_middleware', middleware: participants.middleware, handlers: participants.handlers, relationKinds: ['routes_to', 'uses_middleware'] },
      relations: [
        { relationKind: 'routes_to', targetKind: 'route', targetName: `USE ${routePath}` },
        ...[...participants.middleware, ...participants.handlers].map((name) => ({ relationKind: 'uses_middleware', targetKind: 'function', targetName: name }))
      ]
    });
    return;
  }

  const pyRoute = /^\s*@\w+(?:\.\w+)?\.(get|post|put|patch|delete|options|head|route)\s*\(\s*['"]([^'"]+)['"]/i.exec(line);
  if (language === 'python' && pyRoute) {
    const method = pyRoute[1].toLowerCase() === 'route' ? pythonRouteMethodFromDecorator(line) : pyRoute[1].toUpperCase();
    const routePath = pyRoute[2];
    add({
      entityKind: 'route',
      name: `${method} ${routePath}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method, routePath, routeStyle: 'python_decorator', relationKinds: ['routes_to'] },
      relations: [{ relationKind: 'routes_to', targetKind: 'route', targetName: `${method} ${routePath}` }]
    });
    return;
  }

  const djangoRoute = /^\s*(?:re_)?path\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:views\.)?([A-Za-z_]\w*)/i.exec(line);
  if (language === 'python' && djangoRoute) {
    const routePath = djangoRoute[1].startsWith('/') ? djangoRoute[1] : `/${djangoRoute[1]}`;
    const handler = djangoRoute[2];
    add({
      entityKind: 'route',
      name: `ANY ${routePath}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method: 'ANY', routePath, routeStyle: 'django_urlconf', handlers: [handler], relationKinds: ['routes_to', 'handles_with'] },
      relations: [
        { relationKind: 'routes_to', targetKind: 'route', targetName: `ANY ${routePath}` },
        { relationKind: 'handles_with', targetKind: 'function', targetName: handler }
      ]
    });
    return;
  }

  const javaRoute = /^\s*@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']+)["'])?/i.exec(line);
  if ((language === 'java' || language === 'kotlin') && javaRoute) {
    const annotation = javaRoute[1];
    const method = annotation === 'RequestMapping' ? jvmRequestMappingMethod(line) : annotation.replace('Mapping', '').toUpperCase();
    const routePath = javaRoute[2] ?? jvmRequestMappingPath(line);
    add({
      entityKind: 'route',
      name: `${method}${routePath ? ` ${routePath}` : ''}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method, routePath, routeStyle: 'jvm_annotation', annotation, relationKinds: ['routes_to'] },
      relations: [{ relationKind: 'routes_to', targetKind: 'route', targetName: `${method} ${routePath}`.trim() }]
    });
    return;
  }

  const railsRoute = /^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]\s*,\s*to:\s*['"]([^#'"]+)#([^'"]+)['"]/i.exec(line);
  if (language === 'ruby' && railsRoute) {
    const method = railsRoute[1].toUpperCase();
    const routePath = railsRoute[2];
    const controller = railsRoute[3];
    const action = railsRoute[4];
    add({
      entityKind: 'route',
      name: `${method} ${routePath}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method, routePath, routeStyle: 'rails_routes', controller, action, relationKinds: ['routes_to', 'handles_with'] },
      relations: [
        { relationKind: 'routes_to', targetKind: 'route', targetName: `${method} ${routePath}` },
        { relationKind: 'handles_with', targetKind: 'function', targetName: action },
        { relationKind: 'handles_with', targetKind: 'controller', targetName: controller }
      ]
    });
    return;
  }

  const railsResource = /^\s*resources\s+:([A-Za-z_]\w*)/.exec(line);
  if (language === 'ruby' && railsResource?.[1]) {
    const resource = railsResource[1];
    add({
      entityKind: 'route',
      name: `RESOURCE /${resource}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method: 'RESOURCE', routePath: `/${resource}`, routeStyle: 'rails_resource', resource, relationKinds: ['routes_to', 'handles_with'] },
      relations: [
        { relationKind: 'routes_to', targetKind: 'route', targetName: `RESOURCE /${resource}` },
        { relationKind: 'handles_with', targetKind: 'controller', targetName: resource }
      ]
    });
    return;
  }

  const laravelRoute = /^\s*Route::(get|post|put|patch|delete|any)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(.+)\)/i.exec(line);
  if (language === 'php' && laravelRoute) {
    const method = laravelRoute[1].toUpperCase();
    const routePath = laravelRoute[2].startsWith('/') ? laravelRoute[2] : `/${laravelRoute[2]}`;
    const target = laravelRoute[3];
    const controller = /([A-Za-z_]\w*)Controller::class/.exec(target)?.[1];
    const action = /['"]([A-Za-z_]\w*)['"]/.exec(target)?.[1];
    add({
      entityKind: 'route',
      name: `${method} ${routePath}`,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { method, routePath, routeStyle: 'laravel_route', controller, action, relationKinds: ['routes_to', 'handles_with'] },
      relations: [
        { relationKind: 'routes_to', targetKind: 'route', targetName: `${method} ${routePath}` },
        ...(action ? [{ relationKind: 'handles_with', targetKind: 'function', targetName: action }] : []),
        ...(controller ? [{ relationKind: 'handles_with', targetKind: 'controller', targetName: `${controller}Controller` }] : [])
      ]
    });
  }
}

function routeParticipantsFromCall(line: string): { middleware: string[]; handlers: string[] } {
  const args = /\((.*)\)/.exec(line)?.[1] ?? '';
  const parts = args.split(',').map((part) => part.trim()).filter(Boolean);
  const symbolArgs = parts
    .slice(1)
    .map((part) => /^([A-Za-z_$][\w$]*)$/.exec(part)?.[1] ?? '')
    .filter(Boolean);
  if (symbolArgs.length === 0) return { middleware: [], handlers: [] };
  return {
    middleware: symbolArgs.slice(0, -1),
    handlers: symbolArgs.slice(-1)
  };
}

function routePathFromNextRouteFile(path: string): string | null {
  const parts = path.split(/[\\/]+/);
  const routeIndex = parts.findIndex((part) => /^route\.[cm]?[jt]sx?$/.test(part));
  if (routeIndex < 0) return null;
  const appIndex = parts.lastIndexOf('app', routeIndex);
  if (appIndex < 0 || parts[appIndex + 1] !== 'api') return null;
  return routePathFromSegments(parts.slice(appIndex + 1, routeIndex));
}

function routePathFromPagesApiFile(path: string): string | null {
  const parts = path.split(/[\\/]+/);
  const apiIndex = parts.findIndex((part, index) => part === 'api' && parts[index - 1] === 'pages');
  if (apiIndex < 0) return null;
  const segments = parts.slice(apiIndex, -1);
  const fileBase = basename(path).replace(/\.[cm]?[jt]sx?$/, '');
  if (fileBase !== 'index') segments.push(fileBase);
  return routePathFromSegments(segments);
}

function routePathFromSegments(segments: string[]): string {
  const normalized = segments
    .filter((segment) => segment && !/^\(.+\)$/.test(segment))
    .map((segment) => {
      if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return `*${segment.slice(4, -1)}`;
      if (/^\[[^\]]+\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
      return segment;
    });
  return `/${normalized.join('/')}`.replace(/\/+/g, '/');
}

function pythonRouteMethodFromDecorator(line: string): string {
  const methods = /methods\s*=\s*\[([^\]]+)]/i.exec(line)?.[1];
  const method = methods?.match(/['"]([A-Z]+)['"]/i)?.[1];
  return method ? method.toUpperCase() : 'ANY';
}

function jvmRequestMappingMethod(line: string): string {
  const method = /method\s*=\s*RequestMethod\.([A-Z]+)/i.exec(line)?.[1];
  return method ? method.toUpperCase() : 'ANY';
}

function jvmRequestMappingPath(line: string): string {
  return /(?:path|value)\s*=\s*["']([^"']+)["']/i.exec(line)?.[1] ?? '';
}

function extractDefinitionCandidate(line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  const jsClass = /^\s*(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line);
  if ((language === 'javascript' || language === 'typescript') && jsClass?.[1]) {
    add({ entityKind: 'class', name: jsClass[1], signature: line, lineStart, metadata: { definitionStyle: 'class' } });
    return;
  }
  const jsFunction =
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line) ??
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.exec(line);
  if ((language === 'javascript' || language === 'typescript') && jsFunction?.[1]) {
    add({ entityKind: 'function', name: jsFunction[1], signature: line, lineStart, metadata: { definitionStyle: 'function' } });
    return;
  }

  const pyClass = /^\s*class\s+([A-Za-z_]\w*)/.exec(line);
  if (language === 'python' && pyClass?.[1]) {
    add({ entityKind: 'class', name: pyClass[1], signature: line, lineStart, metadata: { definitionStyle: 'class' } });
    return;
  }
  const pyFunction = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
  if (language === 'python' && pyFunction?.[1]) {
    add({ entityKind: 'function', name: pyFunction[1], signature: line, lineStart, metadata: { definitionStyle: 'function' } });
    return;
  }

  const goFunction = /^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/.exec(line);
  if (language === 'go' && goFunction?.[1]) {
    add({ entityKind: 'function', name: goFunction[1], signature: line, lineStart, metadata: { definitionStyle: 'function' } });
    return;
  }

  const rustDefinition = /^\s*(?:pub\s+)?(fn|struct|enum|trait)\s+([A-Za-z_]\w*)/.exec(line);
  if (language === 'rust' && rustDefinition) {
    const kind = rustDefinition[1] === 'fn' ? 'function' : 'type';
    add({ entityKind: kind, name: rustDefinition[2], signature: line, lineStart, metadata: { definitionStyle: rustDefinition[1] } });
    return;
  }

  const jvmType = /^\s*(?:public|private|protected|abstract|final|sealed|data|open|internal|\s)*\s*(class|interface|enum|object)\s+([A-Za-z_]\w*)/.exec(line);
  if ((language === 'java' || language === 'kotlin' || language === 'csharp') && jvmType) {
    add({ entityKind: 'class', name: jvmType[2], signature: line, lineStart, metadata: { definitionStyle: jvmType[1] } });
    return;
  }

  const kotlinFunction = /^\s*(?:public|private|protected|internal|override|suspend|inline|\s)*fun\s+([A-Za-z_]\w*)\s*\(/.exec(line);
  if (language === 'kotlin' && kotlinFunction?.[1]) {
    add({ entityKind: 'function', name: kotlinFunction[1], signature: line, lineStart, metadata: { definitionStyle: 'function' } });
    return;
  }

  const jvmMethod = /^\s*(?:public|private|protected|static|final|abstract|synchronized|native|\s)+(?:[\w<>\[\],.?]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:\{|throws\b)/.exec(line);
  if ((language === 'java' || language === 'csharp') && jvmMethod?.[1] && !isControlKeyword(jvmMethod[1])) {
    add({ entityKind: 'method', name: jvmMethod[1], signature: line, lineStart, metadata: { definitionStyle: 'method' } });
    return;
  }

  const cFunction = /^\s*(?:[A-Za-z_][\w:*<>,\[\]\s&]+[*&\s]+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/.exec(line);
  if ((language === 'c' || language === 'cpp' || language === 'objective-c' || language === 'objective-cpp') && cFunction?.[1] && !isControlKeyword(cFunction[1])) {
    add({ entityKind: 'function', name: cFunction[1], signature: line, lineStart, metadata: { definitionStyle: 'function' } });
    return;
  }

  const rubyDefinition = /^\s*(?:class|module|def)\s+([A-Za-z_]\w*[!?=]?)/.exec(line);
  if (language === 'ruby' && rubyDefinition?.[1]) {
    add({ entityKind: line.trim().startsWith('def') ? 'function' : 'class', name: rubyDefinition[1], signature: line, lineStart, metadata: { definitionStyle: 'ruby' } });
    return;
  }

  const phpDefinition = /^\s*(?:final\s+|abstract\s+)?(?:class|interface|trait|function)\s+([A-Za-z_]\w*)/.exec(line);
  if (language === 'php' && phpDefinition?.[1]) {
    add({ entityKind: line.includes('function') ? 'function' : 'class', name: phpDefinition[1], signature: line, lineStart, metadata: { definitionStyle: 'php' } });
  }
}

function extractFrameworkDataFlowCandidate(line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  const flow = frameworkDataFlowFromLine(line, language);
  if (!flow) return;
  add({
    entityKind: 'framework_flow',
    name: flow.name,
    signature: line,
    lineStart,
    lineEnd: lineStart,
    metadata: { frameworkFlowKind: flow.kind, language, relationKind: flow.relationKind, framework: flow.framework },
    relations: [{ relationKind: flow.relationKind, targetKind: flow.targetKind, targetName: flow.targetName }]
  });
}

function frameworkDataFlowFromLine(line: string, language: string): { kind: string; framework: string; name: string; relationKind: string; targetKind: string; targetName: string } | null {
  if (language === 'javascript' || language === 'typescript') {
    if (/\b(?:req|request)\.(?:body|params|query|cookies|headers)\b/.test(line) || /\bctx\.(?:request\.)?(?:body|params|query|cookies|headers)\b/.test(line)) {
      const targetName = /\b(body|params|query|cookies|headers)\b/.exec(line)?.[1] ?? 'request';
      return { kind: 'request_parse', framework: 'js_web', name: targetName, relationKind: 'parses_body', targetKind: 'request_data', targetName };
    }
    if (/\b(?:res|reply|response)\.(?:json|send|render|redirect|setHeader|status)\s*\(/.test(line) || /\bctx\.(?:body|status)\s*=/.test(line)) {
      const targetName = /\b(json|send|render|redirect|setHeader|status|body)\b/.exec(line)?.[1] ?? 'response';
      return { kind: 'response_serialization', framework: 'js_web', name: targetName, relationKind: 'serializes_response', targetKind: 'response', targetName };
    }
    const prisma = /\b(?:prisma|db)\.([A-Za-z_$][\w$]*)\.(findMany|findUnique|findFirst|create|update|upsert|delete|deleteMany|updateMany)\s*\(/.exec(line);
    if (prisma) {
      const relationKind = /^(find)/.test(prisma[2]) ? 'reads_model' : 'writes_model';
      return { kind: 'model_access', framework: 'js_orm', name: prisma[1], relationKind, targetKind: 'model', targetName: prisma[1] };
    }
    const modelCall = /\b([A-Z][A-Za-z0-9_]*)\.(find|findByPk|findOne|findAll|create|update|destroy|deleteOne|deleteMany|save)\s*\(/.exec(line);
    if (modelCall) {
      const relationKind = /^find/.test(modelCall[2]) ? 'reads_model' : 'writes_model';
      return { kind: 'model_access', framework: 'js_orm', name: modelCall[1], relationKind, targetKind: 'model', targetName: modelCall[1] };
    }
    return null;
  }

  if (language === 'python') {
    if (/\brequest\.(?:POST|GET|data|body|json|args|form|headers|cookies)\b/.test(line)) {
      const targetName = /\b(POST|GET|data|body|json|args|form|headers|cookies)\b/.exec(line)?.[1] ?? 'request';
      return { kind: 'request_parse', framework: 'python_web', name: targetName, relationKind: 'parses_body', targetKind: 'request_data', targetName };
    }
    if (/\b(?:JsonResponse|Response|render|redirect)\s*\(/.test(line)) {
      const targetName = /\b(JsonResponse|Response|render|redirect)\b/.exec(line)?.[1] ?? 'response';
      return { kind: 'response_serialization', framework: 'python_web', name: targetName, relationKind: 'serializes_response', targetKind: 'response', targetName };
    }
    const pyModel = /\b([A-Z][A-Za-z0-9_]*)\.objects\.(filter|get|all|create|update|delete)\s*\(/.exec(line);
    if (pyModel) {
      const relationKind = ['filter', 'get', 'all'].includes(pyModel[2]) ? 'reads_model' : 'writes_model';
      return { kind: 'model_access', framework: 'django_orm', name: pyModel[1], relationKind, targetKind: 'model', targetName: pyModel[1] };
    }
    return null;
  }

  if (language === 'ruby') {
    if (/\bparams\b/.test(line)) {
      return { kind: 'request_parse', framework: 'rails', name: 'params', relationKind: 'parses_body', targetKind: 'request_data', targetName: 'params' };
    }
    if (/\b(?:render|redirect_to|send_data|send_file)\b/.test(line)) {
      const targetName = /\b(render|redirect_to|send_data|send_file)\b/.exec(line)?.[1] ?? 'response';
      return { kind: 'response_serialization', framework: 'rails', name: targetName, relationKind: 'serializes_response', targetKind: 'response', targetName };
    }
    const rubyModel = /\b([A-Z][A-Za-z0-9_]*)\.(find|where|all|create|update|destroy|delete)\b/.exec(line);
    if (rubyModel) {
      const relationKind = ['find', 'where', 'all'].includes(rubyModel[2]) ? 'reads_model' : 'writes_model';
      return { kind: 'model_access', framework: 'rails_model', name: rubyModel[1], relationKind, targetKind: 'model', targetName: rubyModel[1] };
    }
    return null;
  }

  if (language === 'php') {
    if (/\$request->(?:input|all|json|query|post|header|cookie)\s*\(/.test(line)) {
      const targetName = /\$request->(input|all|json|query|post|header|cookie)/.exec(line)?.[1] ?? 'request';
      return { kind: 'request_parse', framework: 'laravel', name: targetName, relationKind: 'parses_body', targetKind: 'request_data', targetName };
    }
    if (/\b(?:response|view|redirect)\s*\(/.test(line)) {
      const targetName = /\b(response|view|redirect)\b/.exec(line)?.[1] ?? 'response';
      return { kind: 'response_serialization', framework: 'laravel', name: targetName, relationKind: 'serializes_response', targetKind: 'response', targetName };
    }
    const phpModel = /\b([A-Z][A-Za-z0-9_]*)::(find|where|all|create|update|destroy|delete)\s*\(/.exec(line);
    if (phpModel) {
      const relationKind = ['find', 'where', 'all'].includes(phpModel[2]) ? 'reads_model' : 'writes_model';
      return { kind: 'model_access', framework: 'laravel_model', name: phpModel[1], relationKind, targetKind: 'model', targetName: phpModel[1] };
    }
  }

  return null;
}

function extractSecurityMarkerCandidate(line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  const marker = /\b(requireAuth|requireUser|authorize!?|authorized|authorization|authenticate|authenticated|permission|permissions|hasRole|check_access|accessControl|csrf|validateToken|before_action|skip_before_action|policy|permit|allowed\?)\b/i.exec(line);
  if (!marker) return;
  const name = marker[1];
  add({
    entityKind: 'security_marker',
    name,
    signature: line,
    lineStart,
    lineEnd: lineStart,
    metadata: { markerKind: 'permission_or_auth_check', language, relationKind: 'checks_permission' },
    relations: [{ relationKind: 'checks_permission', targetKind: 'security_control', targetName: name }]
  });
}

function extractSinkCandidate(line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  const sink = /\b(eval|exec|spawn|system|popen|innerHTML|dangerouslySetInnerHTML|deserialize|unserialize|pickle\.loads|yaml\.load|query|rawQuery|sendFile|redirect|setHeader|render|send_data|open|readFile|writeFile|createReadStream|fetch|request|axios)\b/.exec(line);
  if (!sink) return;
  const name = sink[1];
  add({
    entityKind: 'sink',
    name,
    signature: line,
    lineStart,
    lineEnd: lineStart,
    metadata: { sinkKind: classifyProjectSink(name), language, relationKind: 'reaches_sink' },
    relations: [{ relationKind: 'reaches_sink', targetKind: 'sink', targetName: name }]
  });
}

function extractMobileManifestCandidate(path: string, line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  const lowerName = basename(path).toLowerCase();
  if (lowerName !== 'androidmanifest.xml' && lowerName !== 'info.plist' && language !== 'plist') return;

  const permission = /android:name\s*=\s*["'](android\.permission\.[^"']+)["']/i.exec(line);
  if (lowerName === 'androidmanifest.xml' && /<uses-permission\b/i.test(line) && permission?.[1]) {
    add({
      entityKind: 'mobile_permission',
      name: permission[1],
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { platform: 'android', manifestKind: 'uses_permission', relationKind: 'declares_permission' },
      relations: [{ relationKind: 'declares_permission', targetKind: 'permission', targetName: permission[1] }]
    });
    return;
  }

  const androidComponent = /<(activity|service|receiver|provider)\b/i.exec(line);
  const componentName = /android:name\s*=\s*["']([^"']+)["']/i.exec(line)?.[1];
  if (lowerName === 'androidmanifest.xml' && androidComponent?.[1] && componentName) {
    const exported = /android:exported\s*=\s*["']true["']/i.test(line) ? true : /android:exported\s*=\s*["']false["']/i.test(line) ? false : null;
    add({
      entityKind: 'mobile_component',
      name: componentName,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { platform: 'android', componentKind: androidComponent[1].toLowerCase(), exported, relationKind: 'declares_component' },
      relations: [{ relationKind: 'declares_component', targetKind: 'mobile_component', targetName: componentName }]
    });
    return;
  }

  const scheme = /android:scheme\s*=\s*["']([^"']+)["']/i.exec(line)?.[1];
  if (lowerName === 'androidmanifest.xml' && scheme) {
    add({
      entityKind: 'url_scheme',
      name: scheme,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { platform: 'android', relationKind: 'declares_url_scheme' },
      relations: [{ relationKind: 'declares_url_scheme', targetKind: 'url_scheme', targetName: scheme }]
    });
  }
}

function extractWebEndpointCandidate(path: string, line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  const lowerName = basename(path).toLowerCase();
  const openApiPath = /^\s*["']?(\/[A-Za-z0-9_./{}:*-]+)["']?\s*:\s*$/.exec(line)?.[1];
  if ((language === 'yaml' || language === 'json' || lowerName.includes('openapi') || lowerName.includes('swagger')) && openApiPath) {
    add({
      entityKind: 'web_endpoint',
      name: openApiPath,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { endpointStyle: 'api_schema_path', routePath: openApiPath, relationKind: 'declares_endpoint' },
      relations: [{ relationKind: 'declares_endpoint', targetKind: 'endpoint', targetName: openApiPath }]
    });
    return;
  }

  const clientRequest = /\b(?:fetch|request|axios\.(?:get|post|put|patch|delete)|http\.(?:get|post|request))\s*\(\s*['"`]((?:https?:\/\/|\/)[^'"`]+)['"`]/i.exec(line);
  if (clientRequest?.[1]) {
    const endpoint = clientRequest[1];
    add({
      entityKind: 'web_endpoint',
      name: endpoint,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { endpointStyle: 'client_request', routePath: endpoint, relationKind: 'requests_endpoint' },
      relations: [{ relationKind: 'requests_endpoint', targetKind: 'endpoint', targetName: endpoint }]
    });
    return;
  }

  const graphqlOperation = /^\s*(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/.exec(line);
  if (language === 'graphql' && graphqlOperation?.[1]) {
    add({
      entityKind: 'graphql_operation',
      name: graphqlOperation[1],
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { endpointStyle: 'graphql_operation', relationKind: 'declares_operation' },
      relations: [{ relationKind: 'declares_operation', targetKind: 'graphql_operation', targetName: graphqlOperation[1] }]
    });
  }
}

function extractCallSiteCandidate(line: string, language: string, lineStart: number, add: (candidate: ProjectStructureCandidate) => void): void {
  if (!projectLanguageSupportsCallSites(language)) return;
  if (definitionLineLooksLikeDeclaration(line, language)) return;
  const callees = new Set<string>();
  for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (isControlKeyword(name) || isCommonStructuralNoise(name)) continue;
    callees.add(name);
    if (callees.size >= 6) break;
  }
  for (const name of callees) {
    add({
      entityKind: 'call_site',
      name,
      signature: line,
      lineStart,
      lineEnd: lineStart,
      metadata: { callee: name, language, relationKind: 'calls' },
      relations: [{ relationKind: 'calls', targetKind: 'function', targetName: name }]
    });
  }
}

function extractTypeScriptAstStructureCandidates(path: string, language: string, text: string, lines: string[], add: (candidate: ProjectStructureCandidate) => void): void {
  if (language !== 'javascript' && language !== 'typescript') return;
  const scriptKind = typeScriptScriptKindForPath(path, language);
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
  const ownerStack: Array<{ name: string; kind: string; lineStart: number }> = [];
  const callKeys = new Set<string>();

  const lineForPosition = (position: number): number => sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  const lineText = (lineStart: number): string => lines[lineStart - 1] ?? '';
  const nodeText = (node: ts.Node): string => node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 1000);

  const addDefinition = (node: ts.Node, name: string, entityKind: 'function' | 'method' | 'class', style: string): void => {
    const lineStart = lineForPosition(node.getStart(sourceFile));
    const lineEnd = lineForPosition(node.getEnd());
    add({
      entityKind,
      name,
      signature: nodeText(node),
      lineStart,
      lineEnd,
      metadata: { definitionStyle: style, extractionFamily: 'typescript_ast' }
    });
  };

  const visit = (node: ts.Node): void => {
    const className = typeScriptClassName(node);
    if (className) {
      const lineStart = lineForPosition(node.getStart(sourceFile));
      addDefinition(node, className, 'class', 'typescript_ast_class');
      ownerStack.push({ name: className, kind: 'class', lineStart });
      ts.forEachChild(node, visit);
      ownerStack.pop();
      return;
    }

    const functionName = typeScriptFunctionName(node);
    if (functionName) {
      const lineStart = lineForPosition(node.getStart(sourceFile));
      addDefinition(node, functionName, 'function', 'typescript_ast_function');
      ownerStack.push({ name: functionName, kind: 'function', lineStart });
      ts.forEachChild(node, visit);
      ownerStack.pop();
      return;
    }

    const methodName = typeScriptMethodName(node);
    if (methodName) {
      const lineStart = lineForPosition(node.getStart(sourceFile));
      addDefinition(node, methodName, 'method', 'typescript_ast_method');
      ownerStack.push({ name: methodName, kind: 'method', lineStart });
      ts.forEachChild(node, visit);
      ownerStack.pop();
      return;
    }

    if (ts.isCallExpression(node)) {
      const callee = typeScriptCalleeName(node.expression);
      if (callee && !isControlKeyword(callee) && !isCommonStructuralNoise(callee)) {
        const lineStart = lineForPosition(node.getStart(sourceFile));
        const owner = ownerStack.at(-1) ?? null;
        const key = `${callee}:${lineStart}:${owner?.name ?? ''}`;
        if (!callKeys.has(key)) {
          callKeys.add(key);
          add({
            entityKind: 'call_site',
            name: callee,
            signature: lineText(lineStart).trim() || nodeText(node),
            lineStart,
            lineEnd: lineStart,
            metadata: {
              callee,
              language,
              relationKind: 'calls',
              extractionFamily: 'typescript_ast_call_graph',
              ownerKind: owner?.kind ?? null,
              ownerName: owner?.name ?? null,
              ownerLineStart: owner?.lineStart ?? null
            },
            relations: [{ relationKind: 'calls', targetKind: 'function', targetName: callee, metadata: { extractionFamily: 'typescript_ast_call_graph' } }]
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function typeScriptScriptKindForPath(path: string, language: string): ts.ScriptKind {
  const extension = extname(path).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.mts') return ts.ScriptKind.TS;
  if (extension === '.cts') return ts.ScriptKind.TS;
  if (extension === '.ts') return ts.ScriptKind.TS;
  return language === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

function typeScriptClassName(node: ts.Node): string | null {
  if (!ts.isClassDeclaration(node) || !node.name?.text) return null;
  return node.name.text;
}

function typeScriptFunctionName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name?.text) return node.name.text;
  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return null;
}

function typeScriptMethodName(node: ts.Node): string | null {
  if (!ts.isMethodDeclaration(node) && !ts.isGetAccessorDeclaration(node) && !ts.isSetAccessorDeclaration(node)) return null;
  return typeScriptPropertyName(node.name);
}

function typeScriptPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function typeScriptCalleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) return expression.argumentExpression.text;
  return null;
}

interface ParserLightOwnerRange {
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
}

function extractJavaParserLightStructureCandidates(language: string, lines: string[], add: (candidate: ProjectStructureCandidate) => void): void {
  if (language !== 'java') return;
  const owners: ParserLightOwnerRange[] = [];
  for (const [index, line] of lines.entries()) {
    const lineStart = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('@')) continue;

    const typeMatch = /^\s*(?:public|private|protected|abstract|final|sealed|static|\s)*(class|interface|enum|record)\s+([A-Za-z_]\w*)/.exec(line);
    if (typeMatch) {
      const lineEnd = parserLightBlockEnd(lines, index);
      owners.push({ name: typeMatch[2], kind: 'class', lineStart, lineEnd });
      add({
        entityKind: 'class',
        name: typeMatch[2],
        signature: trimmed,
        lineStart,
        lineEnd,
        metadata: { definitionStyle: typeMatch[1], extractionFamily: 'java_parser_light' }
      });
      continue;
    }

    const methodMatch =
      /^\s*(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp|\s)*(?:<[^>]+>\s*)?(?:[A-Za-z_$][\w$]*(?:<[^>{};]+>)?(?:\[\])?(?:\s*,\s*)?\s+)+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^{]+)?\{/.exec(line) ??
      /^\s*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/.exec(line);
    if (methodMatch?.[1] && !isControlKeyword(methodMatch[1]) && !javaParserLightLooksLikeConstructor(methodMatch[1], owners, lineStart)) {
      const lineEnd = parserLightBlockEnd(lines, index);
      owners.push({ name: methodMatch[1], kind: 'method', lineStart, lineEnd });
      add({
        entityKind: 'method',
        name: methodMatch[1],
        signature: trimmed,
        lineStart,
        lineEnd,
        metadata: { definitionStyle: 'java_parser_light_method', extractionFamily: 'java_parser_light' }
      });
    }
  }

  extractParserLightCallSites(lines, 'java', owners, 'java_parser_light_call_graph', add);
}

function javaParserLightLooksLikeConstructor(name: string, owners: ParserLightOwnerRange[], lineStart: number): boolean {
  const owner = parserLightOwnerForLine(owners, lineStart);
  return owner?.kind === 'class' && owner.name === name;
}

function extractGoParserLightStructureCandidates(lines: string[], language: string, add: (candidate: ProjectStructureCandidate) => void): void {
  if (language !== 'go') return;
  const owners: ParserLightOwnerRange[] = [];
  let inImportBlock = false;
  for (const [index, line] of lines.entries()) {
    const lineStart = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (/^import\s*\(\s*$/.test(trimmed)) {
      inImportBlock = true;
      continue;
    }
    if (inImportBlock) {
      if (trimmed === ')') {
        inImportBlock = false;
        continue;
      }
      const blockImport = /^(?:[A-Za-z_]\w*|\.)?\s*["`]([^"`]+)["`]/.exec(trimmed);
      if (blockImport?.[1]) {
        add({
          entityKind: 'import',
          name: blockImport[1],
          signature: line,
          lineStart,
          lineEnd: lineStart,
          metadata: { module: blockImport[1], importStyle: 'go_block', extractionFamily: 'go_parser_light' },
          relations: [{ relationKind: 'imports', targetKind: 'module', targetName: blockImport[1] }]
        });
      }
      continue;
    }

    const typeMatch = /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/.exec(line);
    if (typeMatch?.[1]) {
      const lineEnd = parserLightBlockEnd(lines, index);
      owners.push({ name: typeMatch[1], kind: 'type', lineStart, lineEnd });
      add({
        entityKind: 'type',
        name: typeMatch[1],
        signature: trimmed,
        lineStart,
        lineEnd,
        metadata: { definitionStyle: 'go_type', extractionFamily: 'go_parser_light' }
      });
      continue;
    }

    const functionMatch = /^\s*func\s+(?:\(([^)]+)\)\s*)?([A-Za-z_]\w*)\s*\(/.exec(line);
    if (functionMatch?.[2]) {
      const receiver = goReceiverType(functionMatch[1] ?? '');
      const lineEnd = parserLightBlockEnd(lines, index);
      const entityKind = receiver ? 'method' : 'function';
      owners.push({ name: functionMatch[2], kind: entityKind, lineStart, lineEnd });
      add({
        entityKind,
        name: functionMatch[2],
        signature: trimmed,
        lineStart,
        lineEnd,
        metadata: { definitionStyle: receiver ? 'go_method' : 'go_function', extractionFamily: 'go_parser_light', receiver: receiver ?? null }
      });
    }
  }

  extractParserLightCallSites(lines, 'go', owners, 'go_parser_light_call_graph', add);
}

function goReceiverType(receiver: string): string | null {
  if (!receiver.trim()) return null;
  const parts = receiver.trim().split(/\s+/);
  const typeName = (parts.at(-1) ?? '').replace(/^\*/, '');
  return typeName || null;
}

function extractParserLightCallSites(
  lines: string[],
  language: string,
  owners: ParserLightOwnerRange[],
  extractionFamily: string,
  add: (candidate: ProjectStructureCandidate) => void
): void {
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const lineStart = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('@')) continue;
    if (definitionLineLooksLikeDeclaration(line, language)) continue;
    const owner = parserLightOwnerForLine(owners, lineStart);
    for (const callee of parserLightCalleesFromLine(line, language)) {
      const key = `${callee}:${lineStart}:${owner?.name ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add({
        entityKind: 'call_site',
        name: callee,
        signature: trimmed,
        lineStart,
        lineEnd: lineStart,
        metadata: {
          callee,
          language,
          relationKind: 'calls',
          extractionFamily,
          ownerKind: owner?.kind ?? null,
          ownerName: owner?.name ?? null,
          ownerLineStart: owner?.lineStart ?? null
        },
        relations: [{ relationKind: 'calls', targetKind: 'function', targetName: callee, metadata: { extractionFamily } }]
      });
    }
  }
}

function parserLightCalleesFromLine(line: string, language: string): string[] {
  const callees = new Set<string>();
  const pattern = language === 'go' ? /\b(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*\(/g : /\b(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of line.matchAll(pattern)) {
    const name = match[1];
    if (!name || isControlKeyword(name) || isCommonStructuralNoise(name)) continue;
    if (language === 'java' && /^[A-Z]/.test(name) && /\bnew\s+[A-Za-z_$][\w$]*\s*\(/.test(line)) continue;
    callees.add(name);
    if (callees.size >= 8) break;
  }
  return Array.from(callees);
}

function parserLightOwnerForLine(owners: ParserLightOwnerRange[], lineStart: number): ParserLightOwnerRange | null {
  return (
    owners
      .filter((owner) => owner.lineStart <= lineStart && owner.lineEnd >= lineStart)
      .sort((left, right) => left.lineEnd - left.lineStart - (right.lineEnd - right.lineStart))[0] ?? null
  );
}

function parserLightBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawBrace = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const withoutStrings = lines[index].replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    for (const char of withoutStrings) {
      if (char === '{') {
        depth += 1;
        sawBrace = true;
      } else if (char === '}') {
        depth -= 1;
        if (sawBrace && depth <= 0) return index + 1;
      }
    }
  }
  return startIndex + 1;
}

function classifyProjectSink(name: string): string {
  const normalized = name.toLowerCase();
  if (['eval', 'exec', 'spawn', 'system', 'popen'].includes(normalized)) return 'command_or_code_execution';
  if (['innerhtml', 'dangerouslysetinnerhtml'].includes(normalized)) return 'html_dom_injection';
  if (['deserialize', 'unserialize', 'pickle.loads', 'yaml.load'].includes(normalized)) return 'deserialization';
  if (['query', 'rawquery'].includes(normalized)) return 'database_query';
  if (['sendfile', 'redirect', 'setheader', 'render', 'send_data'].includes(normalized)) return 'http_response';
  if (['open', 'readfile', 'writefile', 'createreadstream'].includes(normalized)) return 'filesystem';
  if (['fetch', 'request', 'axios'].includes(normalized)) return 'network_request';
  return 'sensitive_sink';
}

function projectLanguageSupportsCallSites(language: string): boolean {
  return ['javascript', 'typescript', 'python', 'java', 'kotlin', 'csharp', 'go', 'rust', 'c', 'cpp', 'ruby', 'php'].includes(language);
}

function definitionLineLooksLikeDeclaration(line: string, language: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('function ') || trimmed.startsWith('def ') || trimmed.startsWith('async def ') || trimmed.startsWith('func ')) return true;
  if (/^(?:export\s+)?(?:async\s+)?function\s+/.test(trimmed)) return true;
  if (/^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/.test(trimmed)) return true;
  if (language === 'java' || language === 'csharp' || language === 'kotlin') {
    return /\)\s*(?:\{|throws\b)/.test(trimmed) && /^(?:public|private|protected|static|final|abstract|override|suspend|internal|\s)+/.test(trimmed);
  }
  return false;
}

function isCommonStructuralNoise(value: string): boolean {
  return ['require', 'include', 'println', 'print', 'console', 'log', 'json', 'stringify', 'parse', 'map', 'filter', 'reduce', 'forEach', 'then', 'catch'].includes(value);
}

function finalizeProjectStructureCandidates(candidates: ProjectStructureCandidate[], lineCount: number, path: string): ProjectStructureCandidate[] {
  const sorted = candidates
    .slice()
    .sort((left, right) => left.lineStart - right.lineStart || left.entityKind.localeCompare(right.entityKind) || left.name.localeCompare(right.name));
  const seen = new Set<string>();
  const finalized: ProjectStructureCandidate[] = [];
  for (const [index, candidate] of sorted.entries()) {
    const key = `${candidate.entityKind}:${candidate.name}:${candidate.lineStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nextBlock = sorted.slice(index + 1).find((item) => item.lineStart > candidate.lineStart && projectStructureEntityOwnsRange(item.entityKind));
    const defaultEnd = projectStructureEntityOwnsRange(candidate.entityKind)
      ? Math.min(lineCount, nextBlock ? nextBlock.lineStart - 1 : candidate.lineStart + PROJECT_STRUCTURE_MAX_DEFINITION_LINES)
      : candidate.lineStart;
    finalized.push({
      ...candidate,
      lineEnd: Math.max(candidate.lineStart, Math.min(lineCount, candidate.lineEnd ?? defaultEnd)),
      metadata: {
        ...candidate.metadata,
        relativeDisplayPath: basename(path)
      }
    });
  }
  return finalized.slice(0, PROJECT_STRUCTURE_MAX_ENTITIES_PER_FILE);
}

function projectStructureEntityOwnsRange(entityKind: string): boolean {
  return entityKind === 'function' || entityKind === 'method' || entityKind === 'class' || entityKind === 'type';
}

function projectStructureCandidateMatchesRelationTarget(candidate: ProjectStructureCandidate, relation: Omit<ProjectStructureRelationInput, 'scopeVersionId' | 'sourceEntityId' | 'indexedAt'>): boolean {
  if (candidate.name.toLowerCase() !== relation.targetName.toLowerCase()) return false;
  if (relation.targetKind === 'function') return candidate.entityKind === 'function' || candidate.entityKind === 'method';
  if (relation.targetKind === 'route') return candidate.entityKind === 'route';
  if (relation.targetKind === 'sink') return candidate.entityKind === 'sink';
  if (relation.targetKind === 'security_control') return candidate.entityKind === 'security_marker';
  return true;
}

function projectStructureTargetEntityKinds(targetKind: string): string[] {
  switch (targetKind) {
    case 'function':
      return ['function', 'method'];
    case 'symbol':
      return ['function', 'method', 'class', 'type', 'export', 'binary_symbol', 'binary_imported_symbol', 'binary_exported_symbol'];
    case 'route':
      return ['route'];
    case 'sink':
      return ['sink'];
    case 'security_control':
      return ['security_marker'];
    case 'request_data':
      return ['framework_flow'];
    case 'response':
      return ['framework_flow'];
    case 'model':
      return ['framework_flow', 'class', 'type'];
    case 'controller':
      return ['class'];
    case 'endpoint':
      return ['web_endpoint', 'route'];
    case 'permission':
      return ['mobile_permission'];
    case 'mobile_component':
      return ['mobile_component'];
    case 'url':
      return ['binary_url', 'web_endpoint'];
    case 'string':
      return ['binary_string'];
    case 'url_scheme':
      return ['url_scheme'];
    case 'graphql_operation':
      return ['graphql_operation'];
    default:
      return [];
  }
}

function isControlKeyword(value: string): boolean {
  return ['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof'].includes(value);
}

function projectBufferLooksTextual(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  let suspicious = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length < 0.05;
}

function looksLikeProjectUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function safeRelativePath(root: string, path: string): string {
  try {
    return relative(resolve(root), resolve(path)) || '.';
  } catch {
    return path;
  }
}

function redactSearchPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/token|secret|credential|authorization|cookie|password/i.test(key)) {
      redacted[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') {
      redacted[key] = value.length > 1000 ? `${value.slice(0, 1000)}...` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      redacted[key] = value;
    } else if (Array.isArray(value)) {
      redacted[key] = value.slice(0, 12);
    } else if (value && typeof value === 'object') {
      redacted[key] = '[object]';
    }
  }
  return redacted;
}

function optionalDateOrNever(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function numberValue(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

function roundMetricMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function booleanValue(row: SqlRow, key: string): boolean {
  return numberValue(row, key) === 1;
}

const SESSION_DISPOSITION_OUTCOMES = new Set<SessionDispositionOutcome>([
  'objective_achieved',
  'objective_partially_achieved',
  'blocked',
  'inconclusive',
  'failed',
  'stopped'
]);
const SESSION_BLOCKER_DEPENDENCY_KINDS = new Set<SessionBlockerDependencyKind>([
  'user_input',
  'credentials',
  'authorization',
  'source_material',
  'environment',
  'network_access',
  'external_service',
  'target_state',
  'other'
]);
const SESSION_DISPOSITION_SOURCES = new Set<SessionFinalDisposition['source']>(['agent', 'host', 'fixture', 'migration']);

function isFinalRunStatus(status: RunStatus): boolean {
  return status === 'blocked' || status === 'completed' || status === 'failed' || status === 'stopped';
}

function normalizeSessionFinalDisposition(
  status: RunStatus,
  summary: string,
  input?: Omit<SessionFinalDisposition, 'recordedAt'> & { recordedAt?: string }
): SessionFinalDisposition {
  if (!input) return fallbackSessionFinalDisposition(status, summary, 'host');
  if (!SESSION_DISPOSITION_OUTCOMES.has(input.outcome)) throw new Error(`Unsupported session disposition outcome: ${input.outcome}`);
  if (!SESSION_DISPOSITION_SOURCES.has(input.source)) throw new Error(`Unsupported session disposition source: ${input.source}`);
  const dependencies = input.blockerDependencies.map(normalizeSessionBlockerDependency);
  if (input.externalStateRequired !== dependencies.some((dependency) => dependency.external)) {
    throw new Error('Session externalStateRequired must match the presence of external blocker dependencies.');
  }
  if (input.outcome === 'blocked' && dependencies.length === 0) {
    throw new Error('A blocked session disposition requires at least one blocker dependency.');
  }
  if (input.outcome === 'objective_achieved' && dependencies.length > 0) {
    throw new Error('An achieved session disposition cannot retain blocker dependencies.');
  }
  return {
    outcome: input.outcome,
    summary: input.summary.trim() || summary.trim() || `Session ended with status ${status}.`,
    blockerDependencies: dependencies,
    externalStateRequired: input.externalStateRequired,
    source: input.source,
    recordedAt: input.recordedAt?.trim() || nowIso()
  };
}

function fallbackSessionFinalDisposition(
  status: RunStatus,
  summary: string,
  source: SessionFinalDisposition['source'],
  recordedAt = nowIso()
): SessionFinalDisposition {
  const outcome: SessionDispositionOutcome = status === 'failed'
    ? 'failed'
    : status === 'stopped'
      ? 'stopped'
      : status === 'blocked'
        ? 'blocked'
        : 'inconclusive';
  return {
    outcome,
    summary: summary.trim() || `Session ended with status ${status}.`,
    blockerDependencies: status === 'blocked'
      ? [{ kind: 'other', description: 'The session ended in a blocked state without a structured dependency.', requiredState: 'Review the session trace and supply the missing state.', external: true }]
      : [],
    externalStateRequired: status === 'blocked',
    source,
    recordedAt
  };
}

function normalizeSessionBlockerDependency(dependency: SessionBlockerDependency): SessionBlockerDependency {
  if (!SESSION_BLOCKER_DEPENDENCY_KINDS.has(dependency.kind)) throw new Error(`Unsupported session blocker dependency kind: ${dependency.kind}`);
  const description = dependency.description.trim();
  const requiredState = dependency.requiredState.trim();
  if (!description || !requiredState) throw new Error('Session blocker dependencies require description and requiredState.');
  return { kind: dependency.kind, description, requiredState, external: dependency.external };
}

function dispositionMetadata(disposition: SessionFinalDisposition): Record<string, unknown> {
  return {
    outcome: disposition.outcome,
    summary: disposition.summary,
    source: disposition.source,
    recordedAt: disposition.recordedAt
  };
}

function mapSessionFinalDisposition(row: SqlRow): SessionFinalDisposition | null {
  const metadata = parseJson(row.final_disposition_json);
  if (!SESSION_DISPOSITION_OUTCOMES.has(metadata.outcome as SessionDispositionOutcome)) return null;
  const rawDependencies = typeof row.blocker_dependencies_json === 'string'
    ? JSON.parse(row.blocker_dependencies_json) as unknown
    : [];
  const blockerDependencies = Array.isArray(rawDependencies)
    ? rawDependencies.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const dependency = value as Record<string, unknown>;
        const kind = dependency.kind as SessionBlockerDependencyKind;
        if (!SESSION_BLOCKER_DEPENDENCY_KINDS.has(kind)) return [];
        if (typeof dependency.description !== 'string' || typeof dependency.requiredState !== 'string' || typeof dependency.external !== 'boolean') return [];
        return [{ kind, description: dependency.description, requiredState: dependency.requiredState, external: dependency.external }];
      })
    : [];
  const source = SESSION_DISPOSITION_SOURCES.has(metadata.source as SessionFinalDisposition['source'])
    ? metadata.source as SessionFinalDisposition['source']
    : 'host';
  return {
    outcome: metadata.outcome as SessionDispositionOutcome,
    summary: typeof metadata.summary === 'string' ? metadata.summary : text(row, 'summary'),
    blockerDependencies,
    externalStateRequired: booleanValue(row, 'external_state_required'),
    source,
    recordedAt: typeof metadata.recordedAt === 'string' ? metadata.recordedAt : nullableText(row, 'ended_at') ?? text(row, 'created_at')
  };
}

function rowOrUndefined(value: unknown): SqlRow | undefined {
  return value ? (value as SqlRow) : undefined;
}

function tableHasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>).some((row) => row.name === column);
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function rows(value: unknown[]): SqlRow[] {
  return value as SqlRow[];
}

function memorySubjectId(subjectName: string): string {
  const normalized = subjectName.trim().replace(/\s+/g, ' ').toLowerCase();
  return `subject_${createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`;
}

function workspaceIdForPath(workspacePath: string): string {
  return `workspace_${createHash('sha256').update(resolve(workspacePath)).digest('hex').slice(0, 20)}`;
}

export class WorkspaceDatabase {
  private readonly db: DatabaseSync;
  private workspaceId = '';

  public constructor(
    private readonly databasePath: string,
    private readonly artifactRoot: string,
    private readonly workspaceIdentity: { workspacePath: string; workspaceId?: string } = {
      workspacePath: dirname(databasePath)
    }
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    if (databasePath !== ':memory:') chmodSync(databasePath, 0o600);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  public initialize(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.createSchema();
    this.ensureWorkspaceIdentity();
    this.ensureWorkspaceMeta();
    this.ensureDefaultScope();
    this.ensureProjectSearchIndexSeeded();
    this.ensureProjectStructureIndexSeeded();
  }

  public checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(FULL);');
  }

  public close(): void {
    this.db.close();
  }

  public getWorkspaceId(): string {
    return this.workspaceId;
  }

  public getDatabasePath(): string {
    return this.databasePath;
  }

  public getWorkspacePath(): string {
    return this.workspaceIdentity.workspacePath;
  }

  public getArtifactRoot(): string {
    return this.artifactRoot;
  }

  public getHoneycrispRunbookRelativePath(runbookId: string): string | null {
    const table = rowOrUndefined(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'honeycrisp_runbooks'").get());
    if (!table) return null;
    const row = rowOrUndefined(
      this.db.prepare('SELECT relative_path FROM honeycrisp_runbooks WHERE id = ? AND workspace_id = ?').get(runbookId, this.workspaceId)
    );
    return row ? text(row, 'relative_path') : null;
  }

  public getHoneycrispReportRelativePath(reportId: string): string | null {
    const table = rowOrUndefined(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'honeycrisp_reports'").get());
    if (!table) return null;
    const row = rowOrUndefined(
      this.db.prepare('SELECT relative_path FROM honeycrisp_reports WHERE id = ? AND workspace_id = ?').get(reportId, this.workspaceId)
    );
    return row ? text(row, 'relative_path') : null;
  }

  public getLastWorkspaceBackup(): WorkspaceExportResult | null {
    const value = this.getMetaValue('last_workspace_backup_json');
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as WorkspaceExportResult;
    }
    return null;
  }

  public recordWorkspaceBackup(result: WorkspaceExportResult): void {
    this.setMetaValue('last_workspace_backup_json', JSON.stringify(result), result.createdAt);
  }

  public recoverInterruptedState(reason = 'workspace_open'): WorkspaceRecoveryReport {
    const recoveredAt = nowIso();
    const interruptedRunRows = rows(
      this.db
        .prepare("SELECT r.id FROM runs r JOIN scope_versions s ON s.id = r.scope_version_id WHERE s.workspace_id = ? AND r.status IN ('queued', 'active')")
        .all(this.workspaceId)
    );
    const interruptedAttemptRows = rows(
      this.db
        .prepare("SELECT a.id, a.run_id, a.vm_context_id FROM attempts a JOIN runs r ON r.id = a.run_id JOIN scope_versions s ON s.id = r.scope_version_id WHERE s.workspace_id = ? AND a.status IN ('queued', 'active')")
        .all(this.workspaceId)
    );
    const interruptedModelRows = rows(
      this.db
        .prepare("SELECT m.id, m.metadata_json, m.status FROM model_sessions m JOIN runs r ON r.id = m.run_id JOIN scope_versions s ON s.id = r.scope_version_id WHERE s.workspace_id = ? AND m.status IN ('active', 'running')")
        .all(this.workspaceId)
    );
    const interruptedToolRows = rows(
      this.db
        .prepare("SELECT t.id, t.result_json FROM tool_calls t JOIN runs r ON r.id = t.run_id JOIN scope_versions s ON s.id = r.scope_version_id WHERE s.workspace_id = ? AND t.status = 'running'")
        .all(this.workspaceId)
    );
    const interruptedVerifierRows = rows(
      this.db
        .prepare("SELECT v.id, v.result_json, v.status FROM verifier_runs v JOIN runs r ON r.id = v.run_id JOIN scope_versions s ON s.id = r.scope_version_id WHERE s.workspace_id = ? AND v.status IN ('queued', 'running')")
        .all(this.workspaceId)
    );
    const interruptedApprovalRows = rows(
      this.db
        .prepare(
          "SELECT p.id FROM approvals p JOIN runs r ON r.id = p.run_id JOIN scope_versions s ON s.id = r.scope_version_id WHERE s.workspace_id = ? AND p.request_kind = 'shell_command' AND p.decision = 'pending' AND p.decided_at IS NULL"
        )
        .all(this.workspaceId)
    );
    const interruptedVmRows = rows(
      this.db
        .prepare(
          `SELECT DISTINCT v.* FROM vm_contexts v
           JOIN attempts a ON a.vm_context_id = v.id
           JOIN runs r ON r.id = a.run_id
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE v.destroyed_at IS NULL
             AND s.workspace_id = ?
             AND v.state NOT IN ('destroyed', 'preserved', 'recovery_pending')
             AND (r.status IN ('queued', 'active') OR a.status IN ('queued', 'active'))`
        )
        .all(this.workspaceId)
    );
    const report: WorkspaceRecoveryReport = {
      recoveredAt,
      reason,
      interruptedRuns: interruptedRunRows.length,
      interruptedAttempts: interruptedAttemptRows.length,
      interruptedModelSessions: interruptedModelRows.length,
      interruptedToolCalls: interruptedToolRows.length,
      interruptedVerifierRuns: interruptedVerifierRows.length,
      interruptedVmContexts: interruptedVmRows.length,
      notes: []
    };

    const total =
      report.interruptedRuns +
      report.interruptedAttempts +
      report.interruptedModelSessions +
      report.interruptedToolCalls +
      report.interruptedVerifierRuns +
      report.interruptedVmContexts +
      interruptedApprovalRows.length;
    if (total === 0) {
      report.notes.push('No interrupted authoritative state found.');
      this.setMetaValue('last_recovery_json', JSON.stringify(report), recoveredAt);
      return report;
    }

    report.notes.push('Interrupted active work was paused or marked for review on workspace open.');
    if (report.interruptedVmContexts > 0) {
      report.notes.push('VM contexts that were not known destroyed were marked recovery_pending for user review.');
    }
    if (interruptedApprovalRows.length > 0) {
      report.notes.push(`${interruptedApprovalRows.length} pending shell approval request${interruptedApprovalRows.length === 1 ? '' : 's'} denied during recovery.`);
    }
    this.transaction(() => {
      for (const row of interruptedRunRows) {
        this.db
          .prepare('UPDATE session_activity_intervals SET ended_at = ? WHERE run_id = ? AND ended_at IS NULL')
          .run(recoveredAt, text(row, 'id'));
        this.db
          .prepare("UPDATE runs SET status = ?, summary = ?, ended_at = NULL, final_disposition_json = NULL, blocker_dependencies_json = '[]', external_state_required = 0, next_step_suggestions_json = NULL WHERE id = ?")
          .run('paused', 'Paused by workspace recovery after previous interruption.', text(row, 'id'));
      }
      for (const row of interruptedAttemptRows) {
        this.db
          .prepare('UPDATE attempts SET status = ?, short_state = ? WHERE id = ?')
          .run('paused', 'Paused by workspace recovery after previous interruption.', text(row, 'id'));
      }
      for (const row of interruptedModelRows) {
        const metadata = {
          ...parseJson(row.metadata_json),
          interruptedByRecovery: true,
          previousStatus: text(row, 'status'),
          recoveredAt,
          reason
        };
        this.db
          .prepare('UPDATE model_sessions SET status = ?, metadata_json = ?, updated_at = ? WHERE id = ?')
          .run('paused_recovered', toJson(metadata), recoveredAt, text(row, 'id'));
      }
      for (const row of interruptedToolRows) {
        const result = {
          ...parseJson(row.result_json),
          interruptedByRecovery: true,
          recoveredAt,
          reason
        };
        this.db
          .prepare('UPDATE tool_calls SET status = ?, result_summary = ?, result_json = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?')
          .run('interrupted', 'Interrupted by workspace recovery before a final tool result was recorded.', toJson(result), recoveredAt, text(row, 'id'));
      }
      for (const row of interruptedVerifierRows) {
        const result = {
          ...parseJson(row.result_json),
          interruptedByRecovery: true,
          previousStatus: text(row, 'status'),
          recoveredAt,
          reason
        };
        this.db
          .prepare('UPDATE verifier_runs SET status = ?, result_json = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?')
          .run('error', toJson(result), recoveredAt, text(row, 'id'));
      }
      for (const row of interruptedApprovalRows) {
        this.db
          .prepare("UPDATE approvals SET decision = 'denied', reason = ?, decided_at = ? WHERE id = ? AND decision = 'pending' AND decided_at IS NULL")
          .run('Shell approval denied because the prior Honeycrisp process was interrupted.', recoveredAt, text(row, 'id'));
      }
      for (const row of interruptedVmRows) {
        const metadata = {
          ...parseJson(row.metadata_json),
          recoveryRequired: true,
          recoveredAt,
          previousState: text(row, 'state'),
          reason
        };
        this.db.prepare('UPDATE vm_contexts SET state = ?, metadata_json = ? WHERE id = ?').run('recovery_pending', toJson(metadata), text(row, 'id'));
      }
      for (const row of interruptedRunRows) {
        const runId = text(row, 'id');
        const attempt = interruptedAttemptRows.find((attemptRow) => text(attemptRow, 'run_id') === runId);
        this.appendTraceEvent({
          runId,
          attemptId: attempt ? text(attempt, 'id') : null,
          type: 'vm_event',
          source: 'system',
          summary: 'Workspace recovery paused interrupted run after app restart.',
          payload: {
            recoveredAt,
            reason,
            interruptedByRecovery: true,
            authoritativeStatePreserved: true,
            userReviewRequired: true
          },
          vmContextId: attempt ? nullableText(attempt, 'vm_context_id') : null,
          modelVisible: false
        });
      }
      this.setMetaValue('last_recovery_json', JSON.stringify(report), recoveredAt);
    });

    return report;
  }

  public getActiveScope(): WorkspaceScopeVersion {
    const row = rowOrUndefined(
      this.db
        .prepare('SELECT * FROM scope_versions WHERE workspace_id = ? AND status = ? ORDER BY version DESC LIMIT 1')
        .get(this.workspaceId, 'active')
    );
    if (!row) {
      throw new Error('Workspace has no active scope version');
    }
    return this.mapScope(row);
  }

  public getScopeVersion(scopeVersionId: string): WorkspaceScopeVersion {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM scope_versions WHERE id = ? AND workspace_id = ?').get(scopeVersionId, this.workspaceId));
    if (!row) {
      throw new Error(`Workspace scope version not found: ${scopeVersionId}`);
    }
    return this.mapScope(row);
  }

  public activateResearchProfileSnapshot(resolvedProfile: ResolvedResearchProfile): ResearchProfileSnapshot {
    const resolved = decodeResolvedResearchProfile(resolvedProfile);
    const profileJson = serializeResearchProfile(resolved.profile);
    const calculatedHash = createHash('sha256')
      .update('honeycrisp:research-profile:v1\0')
      .update(profileJson)
      .digest('hex');
    if (calculatedHash !== resolved.hash) {
      throw new Error(`Research profile hash mismatch for ${resolved.profile.id}@${resolved.profile.version}.`);
    }
    const sourcePath = resolved.path ? resolve(resolved.path) : null;

    return this.transaction(() => {
      const existing = rowOrUndefined(
        this.db
          .prepare(
            `SELECT * FROM research_profile_snapshots
             WHERE workspace_id = ? AND profile_hash = ? AND source = ?
               AND COALESCE(source_path, '') = COALESCE(?, '')`
          )
          .get(this.workspaceId, resolved.hash, resolved.source, sourcePath)
      );
      let snapshotId: string;
      if (existing) {
        if (
          text(existing, 'profile_id') !== resolved.profile.id
          || text(existing, 'profile_version') !== resolved.profile.version
          || text(existing, 'profile_json') !== profileJson
        ) {
          throw new Error(`Research profile hash collision for workspace ${this.workspaceId}: ${resolved.hash}`);
        }
        snapshotId = text(existing, 'id');
      } else {
        snapshotId = createId('research_profile');
        this.db
          .prepare(
            `INSERT INTO research_profile_snapshots (
              id, workspace_id, profile_id, profile_version, profile_hash, source,
              source_path, profile_json, active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
          )
          .run(
            snapshotId,
            this.workspaceId,
            resolved.profile.id,
            resolved.profile.version,
            resolved.hash,
            resolved.source,
            sourcePath,
            profileJson,
            nowIso()
          );
      }

      this.db.prepare('UPDATE research_profile_snapshots SET active = 0 WHERE workspace_id = ? AND active = 1').run(this.workspaceId);
      this.db.prepare('UPDATE research_profile_snapshots SET active = 1 WHERE id = ? AND workspace_id = ?').run(snapshotId, this.workspaceId);
      const activated = this.getResearchProfileSnapshot(snapshotId);
      if (!activated) throw new Error(`Activated research profile snapshot not found: ${snapshotId}`);
      return activated;
    });
  }

  public getActiveResearchProfileSnapshot(): ResearchProfileSnapshot | null {
    const row = rowOrUndefined(
      this.db.prepare('SELECT * FROM research_profile_snapshots WHERE workspace_id = ? AND active = 1').get(this.workspaceId)
    );
    return row ? this.mapResearchProfileSnapshot(row) : null;
  }

  public getResearchProfileSnapshot(snapshotId: string): ResearchProfileSnapshot | null {
    const row = rowOrUndefined(
      this.db.prepare('SELECT * FROM research_profile_snapshots WHERE id = ? AND workspace_id = ?').get(snapshotId, this.workspaceId)
    );
    return row ? this.mapResearchProfileSnapshot(row) : null;
  }

  public getRunResearchProfileSnapshot(runId: string): ResearchProfileSnapshot | null {
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT p.*
           FROM runs r
           JOIN scope_versions s ON s.id = r.scope_version_id
           JOIN research_profile_snapshots p ON p.id = r.research_profile_snapshot_id
           WHERE r.id = ? AND s.workspace_id = ? AND p.workspace_id = ?`
        )
        .get(runId, this.workspaceId, this.workspaceId)
    );
    return row ? this.mapResearchProfileSnapshot(row) : null;
  }

  public getResearchSubject(): ResearchSubject {
    const existing = rowOrUndefined(
      this.db.prepare('SELECT * FROM workspace_research_subjects WHERE workspace_id = ?').get(this.workspaceId)
    );
    if (existing) return this.mapResearchSubject(existing);

    const scope = this.getActiveScope();
    const scopeOwner = scope.scopeOwner.trim();
    const displayName = scopeOwner || scope.workspaceName.trim() || 'Untitled subject';
    const subjectId = scopeOwner ? memorySubjectId(scopeOwner) : `subject_workspace:${this.workspaceId}`;
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO workspace_research_subjects (
           workspace_id, subject_id, display_name, source, created_at, updated_at
         ) VALUES (?, ?, ?, 'legacy_adopted', ?, ?)`
      )
      .run(this.workspaceId, subjectId, displayName, createdAt, createdAt);
    return this.mapResearchSubject(
      rowOrUndefined(this.db.prepare('SELECT * FROM workspace_research_subjects WHERE workspace_id = ?').get(this.workspaceId))!
    );
  }

  public setResearchSubject(input: ResearchSubjectInput): ResearchSubject {
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Research subject name is required.');
    if (name.length > 500 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error('Research subject name must be at most 500 printable characters.');
    }
    const existing = rowOrUndefined(
      this.db.prepare('SELECT * FROM workspace_research_subjects WHERE workspace_id = ?').get(this.workspaceId)
    );
    const requestedId = input.id?.trim() ?? '';
    const existingId = existing ? text(existing, 'subject_id') : '';
    const isWorkspacePlaceholder = existing
      ? text(existing, 'source') === 'legacy_adopted' && existingId === `subject_workspace:${this.workspaceId}`
      : false;
    const placeholderHasMemory =
      !requestedId
      && isWorkspacePlaceholder
      && tableExists(this.db, 'memory_nodes')
      && tableHasColumn(this.db, 'memory_nodes', 'subject_id')
      && Boolean(this.db.prepare('SELECT 1 FROM memory_nodes WHERE subject_id = ? LIMIT 1').get(existingId));
    const subjectId = requestedId
      || (existingId && (!isWorkspacePlaceholder || placeholderHasMemory) ? existingId : memorySubjectId(name));
    if (subjectId.length > 256 || /[\u0000-\u001f\u007f\s]/.test(subjectId)) {
      throw new Error('Research subject id must be a printable, whitespace-free value of at most 256 characters.');
    }
    const updatedAt = nowIso();
    const createdAt = existing ? text(existing, 'created_at') : updatedAt;
    this.db
      .prepare(
        `INSERT INTO workspace_research_subjects (
           workspace_id, subject_id, display_name, source, created_at, updated_at
         ) VALUES (?, ?, ?, 'explicit', ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           subject_id = excluded.subject_id,
           display_name = excluded.display_name,
           source = 'explicit',
           updated_at = excluded.updated_at`
      )
      .run(this.workspaceId, subjectId, name, createdAt, updatedAt);
    return this.mapResearchSubject(
      rowOrUndefined(this.db.prepare('SELECT * FROM workspace_research_subjects WHERE workspace_id = ?').get(this.workspaceId))!
    );
  }

  public saveScope(draft: WorkspaceScopeDraft, options: { refreshInventory?: boolean } = {}): WorkspaceScopeVersion {
    const cleanedAssets = draft.assets
      .map((asset) => ({
        ...asset,
        value: asset.value.trim(),
        sensitivity: asset.sensitivity.trim() || 'internal'
      }))
      .filter((asset) => asset.value.length > 0);
    const createdAt = nowIso();
    const id = createId('scope');
    const versionRow = rowOrUndefined(this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM scope_versions').get());
    const nextVersion = numberValue(versionRow ?? { version: 0 }, 'version') + 1;

    this.transaction(() => {
      this.db.prepare('UPDATE scope_versions SET status = ? WHERE workspace_id = ? AND status = ?').run('archived', this.workspaceId, 'active');
      this.db
        .prepare(
          `INSERT INTO scope_versions (
            id, workspace_id, version, status, workspace_name, scope_owner, description_markdown,
            rules_markdown, active_from, expires_at, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          this.workspaceId,
          nextVersion,
          'active',
          draft.workspaceName.trim() || 'Untitled Workspace',
          draft.scopeOwner.trim(),
          draft.descriptionMarkdown.trim(),
          draft.rulesMarkdown.trim(),
          createdAt,
          optionalDateOrNever(draft.expiresAt),
          createdAt,
          'local_user'
        );

      for (const asset of cleanedAssets) {
        this.insertScopeAsset(id, asset, createdAt);
      }
      this.setMetaValue(projectSemanticEnabledMetaKey(id), '0', createdAt);
    });

    const scope = this.getActiveScope();
    if (options.refreshInventory === true) {
      this.refreshProjectInventory(scope.id);
    }
    return scope;
  }

  public createRun(input: StartRunRecordInput): CreatedRunContext {
    const runId = createId('run');
    const attemptId = createId('attempt');
    const vmContextId = createId('vm');
    const createdAt = nowIso();
    const scope = this.getScopeVersion(input.scopeVersionId);
    const researchProfileSnapshotId = input.researchProfileSnapshotId?.trim() || null;
    if (input.researchProfileSnapshotId !== undefined && input.researchProfileSnapshotId !== null && !researchProfileSnapshotId) {
      throw new Error('Research profile snapshot id must be non-empty when provided.');
    }
    if (researchProfileSnapshotId !== null && !this.getResearchProfileSnapshot(researchProfileSnapshotId)) {
      throw new Error(`Research profile snapshot not found for workspace: ${researchProfileSnapshotId}`);
    }
    const target = selectRunTarget(scope.assets, input);
    const promptMarkdown = input.promptMarkdown.trim();
    const promptTranscriptId = promptMarkdown ? createId('transcript') : null;

    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO vm_contexts (
            id, backend, image_id, snapshot_id, state, scope_version_id,
            created_at, destroyed_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          vmContextId,
          input.vmBackend ?? 'host',
          input.vmImageId ?? 'host-machine',
          input.vmSnapshotId ?? 'none',
          input.vmState ?? 'host_active',
          input.scopeVersionId,
          createdAt,
          null,
          toJson(input.vmMetadata ?? { executor: 'host', targetExecution: true, executionPosture: 'host_process' })
        );

      this.db
        .prepare(
          `INSERT INTO runs (
            id, scope_version_id, research_profile_snapshot_id, shell_safety_mode, mode, status, title, prompt_markdown, model, reasoning_effort,
            attempt_strategy, sandbox_profile, target_asset_id, target_path,
            budget_json, summary, created_at, started_at, ended_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          runId,
          input.scopeVersionId,
          researchProfileSnapshotId,
          input.shellSafetyMode,
          input.mode,
          'active',
          input.title,
          input.promptMarkdown,
          input.model,
          input.reasoningEffort,
          input.attemptStrategy,
          input.sandboxProfile,
          target.targetAssetId,
          target.targetPath,
          toJson(input.budget),
          'Starting host-process research run.',
          createdAt,
          createdAt,
          null
        );

      this.db
        .prepare(
          `INSERT INTO attempts (
            id, run_id, parent_attempt_id, status, short_state, seed, strategy_role, vm_context_id,
            cost_json, token_usage_json, started_at, ended_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          attemptId,
          runId,
          null,
          'active',
          'Initializing host-process research plan.',
          randomUUID(),
          'initial_portfolio',
          vmContextId,
          toJson({ label: '$0.00' }),
          toJson({ promptTokens: 0, completionTokens: 0, source: 'not_reported' }),
          createdAt,
          null
        );

      this.db
        .prepare(
          `INSERT INTO session_activity_intervals (id, run_id, attempt_id, started_at, ended_at)
           VALUES (?, ?, ?, ?, NULL)`
        )
        .run(createId('activity'), runId, attemptId, createdAt);

      if (promptMarkdown && promptTranscriptId) {
        this.db
          .prepare(
            `INSERT INTO transcript_messages (
              id, run_id, attempt_id, trace_event_id, role, content_markdown, source, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            promptTranscriptId,
            runId,
            attemptId,
            null,
            'user',
            promptMarkdown,
            'run_prompt',
            toJson({
              mode: input.mode,
              model: input.model,
              reasoningEffort: input.reasoningEffort,
              sandboxProfile: input.sandboxProfile
            }),
            createdAt
          );
      }
    });

    const run = this.getRun(runId);
    const attempt = this.getAttempt(attemptId);
    const vmContext = this.getVmContext(vmContextId);
    if (!run || !attempt || !vmContext) {
      throw new Error('Failed to create run context');
    }
    this.indexRunSearchDocument(run);
    if (promptTranscriptId) {
      const promptMessage = this.getTranscriptMessage(promptTranscriptId);
      if (promptMessage) this.indexTranscriptSearchDocument(promptMessage);
    }
    this.refreshProjectGraph(run.scopeVersionId);
    return { run, attempt, vmContext };
  }

  public createModelSession(input: CreateModelSessionInput): ModelSessionRecord {
    const id = createId('model_session');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO model_sessions (
          id, run_id, provider, transport, previous_response_id, status,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.provider,
        input.transport,
        input.previousResponseId ?? null,
        input.status,
        toJson(input.metadata),
        createdAt,
        createdAt
      );
    const session = this.getModelSession(id);
    if (!session) throw new Error('Failed to create model session');
    return session;
  }

  public createContextCompaction(input: CreateContextCompactionInput): ContextCompactionRecord {
    const id = createId('compaction');
    const createdAt = nowIso();
    const previousCompactionId =
      input.previousCompactionId === undefined ? this.getLatestContextCompaction(input.runId)?.id ?? null : input.previousCompactionId;

    this.db
      .prepare(
        `INSERT INTO context_compactions (
          id, run_id, attempt_id, previous_compaction_id, trace_event_id, reason,
          previous_replay_mode, new_replay_mode, trace_range_summarized_json,
          trace_range_kept_json, trace_high_water_mark, token_pressure_json,
          serialized_size_bytes, redaction_policy_version, summary_source,
          represented_state_json, compacted_input_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.attemptId ?? null,
        previousCompactionId,
        null,
        input.reason,
        input.previousReplayMode,
        input.newReplayMode,
        toJson(input.traceRangeSummarized),
        toJson(input.traceRangeKept),
        input.traceHighWaterMark,
        toJson(input.tokenPressure),
        input.serializedSizeBytes,
        input.redactionPolicyVersion,
        input.summarySource,
        toJson(input.representedState),
        toJson(input.compactedInput),
        createdAt
      );

    const compaction = this.getContextCompaction(id);
    if (!compaction) throw new Error('Failed to create context compaction');
    return compaction;
  }

  public setContextCompactionTrace(compactionId: string, traceEventId: string): void {
    this.db.prepare('UPDATE context_compactions SET trace_event_id = ? WHERE id = ?').run(traceEventId, compactionId);
  }

  public createAttempt(input: CreateAttemptInput): AttemptRecord {
    const run = this.getRun(input.runId);
    if (!run) throw new Error(`Run not found: ${input.runId}`);
    const vmContextId = createId('vm');
    const attemptId = createId('attempt');
    const createdAt = nowIso();
    const vmState = input.vmState ?? 'working';
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO vm_contexts (
            id, backend, image_id, snapshot_id, state, scope_version_id,
            created_at, destroyed_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          vmContextId,
          input.vmBackend ?? 'host',
          input.vmImageId ?? 'host-machine',
          input.vmSnapshotId ?? 'none',
          vmState,
          run.scopeVersionId,
          createdAt,
          vmState === 'destroyed' ? createdAt : null,
          toJson(input.vmMetadata ?? { executor: 'host', targetExecution: true, executionPosture: 'host_process' })
        );
      this.db
        .prepare(
          `INSERT INTO attempts (
            id, run_id, parent_attempt_id, status, short_state, seed, strategy_role, vm_context_id,
            cost_json, token_usage_json, started_at, ended_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          attemptId,
          input.runId,
          input.parentAttemptId ?? null,
          input.status ?? 'active',
          input.shortState,
          randomUUID(),
          input.strategyRole,
          vmContextId,
          toJson(input.cost ?? { label: '$0.00' }),
          toJson(input.tokenUsage ?? { promptTokens: 0, completionTokens: 0, source: 'not_reported' }),
          createdAt,
          input.status === 'completed' || input.status === 'failed' || input.status === 'stopped' ? createdAt : null
        );
    });
    const attempt = this.getAttempt(attemptId);
    if (!attempt) throw new Error('Failed to create attempt');
    return attempt;
  }

  public updateModelSessionByRun(runId: string, patch: { previousResponseId?: string | null; status?: string; metadata?: Record<string, unknown> }): void {
    const existing = rowOrUndefined(this.db.prepare('SELECT * FROM model_sessions WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(runId));
    if (!existing) return;
    const nextPreviousResponseId = Object.prototype.hasOwnProperty.call(patch, 'previousResponseId')
      ? patch.previousResponseId ?? null
      : nullableText(existing, 'previous_response_id');
    const metadata = patch.metadata ? { ...parseJson(existing.metadata_json), ...patch.metadata } : parseJson(existing.metadata_json);
    this.db
      .prepare(
        `UPDATE model_sessions
         SET previous_response_id = ?,
             status = COALESCE(?, status),
             metadata_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(nextPreviousResponseId, patch.status ?? null, toJson(metadata), nowIso(), text(existing, 'id'));
  }

  public appendTraceEvent(input: AppendTraceInput): TraceEventRecord {
    const id = createId('trace');
    const createdAt = nowIso();
    const sequenceRow = rowOrUndefined(
      this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM trace_events WHERE run_id = ?').get(input.runId)
    );
    const sequence = numberValue(sequenceRow ?? { next_sequence: 1 }, 'next_sequence');

    this.db
      .prepare(
        `INSERT INTO trace_events (
          id, run_id, attempt_id, sequence, type, source, summary, payload_json, sensitivity,
          model_visible, created_at, vm_context_id, artifact_id, tool_call_id, approval_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.attemptId ?? null,
        sequence,
        input.type,
        input.source,
        input.summary,
        toJson(input.payload),
        input.sensitivity ?? 'internal',
        input.modelVisible === false ? 0 : 1,
        createdAt,
        input.vmContextId ?? null,
        input.artifactId ?? null,
        input.toolCallId ?? null,
        input.approvalId ?? null
      );

    const event = this.getTraceEvent(id);
    if (!event) {
      throw new Error('Failed to append trace event');
    }
    this.indexTraceSearchDocument(event);
    this.refreshProjectGraphForRun(input.runId);
    return event;
  }

  public createTranscriptMessage(input: CreateTranscriptMessageInput): TranscriptMessageRecord {
    const id = createId('transcript');
    const createdAt = nowIso();
    const contentMarkdown = input.contentMarkdown.trim();
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.phase ? { messagePhase: input.phase } : {})
    };
    this.db
      .prepare(
        `INSERT INTO transcript_messages (
          id, run_id, attempt_id, trace_event_id, role, content_markdown, source, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.attemptId ?? null,
        input.traceEventId ?? null,
        input.role,
        contentMarkdown,
        input.source,
        toJson(metadata),
        createdAt
      );

    const message = this.getTranscriptMessage(id);
    if (!message) {
      throw new Error('Failed to create transcript message');
    }
    this.indexTranscriptSearchDocument(message);
    this.refreshProjectGraphForRun(input.runId);
    return message;
  }

  public upsertBreakoutRoom(input: UpsertBreakoutRoomInput): BreakoutRoomRecord {
    const createdAt = input.createdAt ?? nowIso();
    this.db.prepare(
      `INSERT INTO breakout_rooms (
         id, run_id, attempt_id, name, title, purpose, kind, status, phase, challenge_round, outcome_markdown, created_at, closed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         purpose = CASE
           WHEN excluded.purpose <> '' THEN excluded.purpose
           ELSE breakout_rooms.purpose
         END,
         kind = CASE WHEN ? = 1 THEN excluded.kind ELSE breakout_rooms.kind END,
         status = excluded.status,
         phase = CASE WHEN ? = 1 THEN excluded.phase ELSE breakout_rooms.phase END,
         challenge_round = CASE WHEN ? = 1 THEN excluded.challenge_round ELSE breakout_rooms.challenge_round END,
         outcome_markdown = COALESCE(excluded.outcome_markdown, breakout_rooms.outcome_markdown),
         closed_at = CASE WHEN excluded.status = 'active' THEN NULL ELSE COALESCE(excluded.closed_at, breakout_rooms.closed_at) END`
    ).run(
      input.id,
      input.runId,
      input.attemptId ?? null,
      input.name.trim(),
      input.title.trim(),
      input.purpose?.trim() ?? '',
      input.kind ?? 'general',
      input.status ?? 'active',
      input.phase ?? (input.status === 'completed' ? 'completed' : 'independent'),
      input.challengeRound ?? 0,
      input.outcomeMarkdown?.trim() || null,
      createdAt,
      input.closedAt ?? null,
      input.kind !== undefined ? 1 : 0,
      input.phase !== undefined ? 1 : 0,
      input.challengeRound !== undefined ? 1 : 0
    );
    const room = this.getBreakoutRoom(input.id);
    if (!room) throw new Error('Failed to upsert breakout room');
    return room;
  }

  public upsertBreakoutRoomMember(input: UpsertBreakoutRoomMemberInput): BreakoutRoomMemberRecord {
    this.db.prepare(
      `INSERT INTO breakout_room_members (
         id, room_id, run_id, attempt_id, agent_id, agent_path, provider, model,
         reasoning_effort, role, status, started_at, ended_at, error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         provider = excluded.provider,
         model = excluded.model,
         reasoning_effort = excluded.reasoning_effort,
         role = excluded.role,
         status = excluded.status,
         started_at = COALESCE(breakout_room_members.started_at, excluded.started_at),
         ended_at = excluded.ended_at,
         error = excluded.error`
    ).run(
      input.id,
      input.roomId,
      input.runId,
      input.attemptId ?? null,
      input.agentId,
      input.agentPath,
      input.provider,
      input.model,
      input.reasoningEffort ?? null,
      input.role?.trim() ?? '',
      input.status,
      input.startedAt ?? null,
      input.endedAt ?? null,
      input.error?.trim() || null
    );
    const member = this.getBreakoutRoomMember(input.id);
    if (!member) throw new Error('Failed to upsert breakout room member');
    return member;
  }

  public createBreakoutRoomMessage(input: CreateBreakoutRoomMessageInput): BreakoutRoomMessageRecord {
    this.db.prepare(
      `INSERT OR IGNORE INTO breakout_room_messages (
         id, room_id, run_id, attempt_id, member_id, sender_agent_path, recipient_agent_path,
         kind, content_markdown, evidence_refs_json, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.roomId,
      input.runId,
      input.attemptId ?? null,
      input.memberId ?? null,
      input.senderAgentPath,
      input.recipientAgentPath ?? null,
      input.kind,
      input.contentMarkdown.trim(),
      toJson(input.evidenceRefs ?? []),
      toJson(input.metadata ?? {}),
      input.createdAt ?? nowIso()
    );
    const message = this.getBreakoutRoomMessage(input.id);
    if (!message) throw new Error('Failed to create breakout room message');
    return message;
  }

  public interruptActiveBreakoutRooms(runId: string, attemptId?: string | null): void {
    const endedAt = nowIso();
    const attemptClause = attemptId ? ' AND attempt_id = ?' : '';
    const params = attemptId ? [endedAt, runId, attemptId] : [endedAt, runId];
    const roomIds = rows(this.db.prepare(
      `SELECT DISTINCT room_id FROM breakout_room_members
       WHERE run_id = ?${attemptClause} AND status IN ('pending', 'active')`
    ).all(...(attemptId ? [runId, attemptId] : [runId])))
      .map((row) => text(row, 'room_id'));
    this.db.prepare(
      `UPDATE breakout_room_members
       SET status = 'interrupted', ended_at = COALESCE(ended_at, ?)
       WHERE run_id = ?${attemptClause} AND status IN ('pending', 'active')`
    ).run(...params);
    for (const roomId of roomIds) this.refreshBreakoutRoomStatus(roomId);
  }

  public findBreakoutRoomMember(runId: string, attemptId: string | null, agentPath: string): BreakoutRoomMemberRecord | null {
    const row = rowOrUndefined(this.db.prepare(
      `SELECT * FROM breakout_room_members
       WHERE run_id = ? AND agent_path = ? AND (attempt_id = ? OR (? IS NULL AND attempt_id IS NULL))
       ORDER BY COALESCE(started_at, '') DESC, rowid DESC LIMIT 1`
    ).get(runId, agentPath, attemptId, attemptId));
    return row ? this.mapBreakoutRoomMember(row) : null;
  }

  public refreshBreakoutRoomStatus(roomId: string): BreakoutRoomRecord | null {
    const room = this.getBreakoutRoom(roomId);
    if (!room) return null;
    const statuses = rows(this.db.prepare('SELECT status FROM breakout_room_members WHERE room_id = ?').all(roomId))
      .map((row) => text(row, 'status') as BreakoutRoomMemberStatus);
    const status: BreakoutRoomStatus = room.phase === 'completed'
      ? 'completed'
      : statuses.some((value) => value === 'active' || value === 'pending')
        ? 'active'
        : statuses.some((value) => value === 'errored')
          ? 'errored'
          : statuses.length > 0 && statuses.every((value) => value === 'interrupted')
            ? 'interrupted'
            : 'active';
    const closedAt = status === 'active' ? null : nowIso();
    this.db.prepare('UPDATE breakout_rooms SET status = ?, closed_at = ? WHERE id = ?').run(status, closedAt, roomId);
    return this.getBreakoutRoom(roomId);
  }

  public listBreakoutRoomSummaries(runId: string): BreakoutRoomSummary[] {
    return rows(this.db.prepare(
      `SELECT room.*,
              COUNT(DISTINCT member.id) AS member_count,
              COALESCE(MAX(message.created_at), room.created_at) AS updated_at
       FROM breakout_rooms room
       LEFT JOIN breakout_room_members member ON member.room_id = room.id
       LEFT JOIN breakout_room_messages message ON message.room_id = room.id
       WHERE room.run_id = ?
       GROUP BY room.id
       HAVING COUNT(DISTINCT member.id) >= 2
       ORDER BY room.created_at DESC, room.id DESC`
    ).all(runId)).map((row) => {
      const room = this.mapBreakoutRoom(row);
      const providerRows = rows(this.db.prepare(
        'SELECT DISTINCT provider FROM breakout_room_members WHERE room_id = ? ORDER BY provider'
      ).all(room.id));
      return {
        id: room.id,
        runId: room.runId,
        name: room.name,
        title: room.title,
        kind: room.kind,
        status: room.status,
        providers: providerRows.map((providerRow) => text(providerRow, 'provider')),
        memberCount: numberValue(row, 'member_count'),
        unreadCount: 0,
        updatedAt: text(row, 'updated_at')
      };
    });
  }

  public createNotification(input: CreateNotificationInput): NotificationRecord {
    const id = createId('notification');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications (
          id, run_id, trace_event_id, kind, title, body_markdown, status, created_at, opened_at, dismissed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'unread', ?, NULL, NULL)`
      )
      .run(id, input.runId, input.traceEventId ?? null, input.kind, input.title, input.bodyMarkdown, createdAt);

    const notification =
      (input.traceEventId ? this.getNotificationByTraceEvent(input.traceEventId) : null) ??
      this.getNotification(id);
    if (!notification) {
      throw new Error('Failed to create notification');
    }
    return notification;
  }

  public listNotifications(status: NotificationStatus = 'unread'): NotificationRecord[] {
    return rows(
      this.db
        .prepare(
          `SELECT n.* FROM notifications n
           JOIN runs r ON r.id = n.run_id
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE s.workspace_id = ? AND n.status = ?
           ORDER BY n.created_at ASC`
        )
        .all(this.workspaceId, status)
    ).map((row) => this.mapNotification(row));
  }

  public markNotificationOpened(notificationId: string): NotificationRecord | null {
    const openedAt = nowIso();
    this.db
      .prepare(
        `UPDATE notifications
         SET status = 'opened',
             opened_at = COALESCE(opened_at, ?)
         WHERE id = ?`
      )
      .run(openedAt, notificationId);
    return this.getNotification(notificationId);
  }

  public dismissNotification(notificationId: string): NotificationRecord | null {
    const dismissedAt = nowIso();
    this.db
      .prepare(
        `UPDATE notifications
         SET status = 'dismissed',
             dismissed_at = COALESCE(dismissed_at, ?)
         WHERE id = ?`
      )
      .run(dismissedAt, notificationId);
    return this.getNotification(notificationId);
  }

  public createToolCall(input: CreateToolCallInput): string {
    const id = createId('tool');
    const startedAt = nowIso();
    const endedAt = input.status === 'running' ? null : startedAt;
    this.db
      .prepare(
        `INSERT INTO tool_calls (
          id, run_id, attempt_id, tool_name, tool_version, input_json, status,
          result_summary, result_json, started_at, ended_at, policy_decision_id,
          vm_context_id, trace_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.attemptId,
        input.toolName,
        input.toolVersion,
        toJson(input.input),
        input.status,
        input.resultSummary ?? '',
        toJson(input.result),
        startedAt,
        endedAt,
        input.policyDecisionId ?? null,
        input.vmContextId ?? null,
        null
      );
    return id;
  }

  public linkToolCallTrace(toolCallId: string, traceEventId: string): void {
    this.db.prepare('UPDATE tool_calls SET trace_event_id = ? WHERE id = ?').run(traceEventId, toolCallId);
  }

  public finishToolCall(toolCallId: string, status: string, resultSummary: string, result: Record<string, unknown>): void {
    this.db
      .prepare(
        `UPDATE tool_calls
         SET status = ?,
             result_summary = ?,
             result_json = ?,
             ended_at = COALESCE(ended_at, ?)
         WHERE id = ?`
      )
      .run(status, resultSummary, toJson(result), nowIso(), toolCallId);
  }

  public updateRunStatus(
    runId: string,
    status: RunStatus,
    summary: string,
    dispositionInput?: Omit<SessionFinalDisposition, 'recordedAt'> & { recordedAt?: string }
  ): void {
    const previous = this.getRun(runId);
    const terminal = isFinalRunStatus(status);
    const transitionedAt = nowIso();
    const endedAt = status === 'completed' || status === 'failed' || status === 'stopped' ? transitionedAt : null;
    const disposition = terminal ? normalizeSessionFinalDisposition(status, summary, dispositionInput) : null;
    this.transaction(() => {
      if (previous?.status === 'active' && status !== 'active') {
        this.db
          .prepare('UPDATE session_activity_intervals SET ended_at = ? WHERE run_id = ? AND ended_at IS NULL')
          .run(transitionedAt, runId);
      } else if (previous && previous.status !== 'active' && status === 'active') {
        const attempt = rowOrUndefined(
          this.db.prepare('SELECT id FROM attempts WHERE run_id = ? ORDER BY started_at DESC, id DESC LIMIT 1').get(runId)
        );
        this.db
          .prepare(
            `INSERT INTO session_activity_intervals (id, run_id, attempt_id, started_at, ended_at)
             SELECT ?, ?, ?, ?, NULL
             WHERE NOT EXISTS (
               SELECT 1 FROM session_activity_intervals WHERE run_id = ? AND ended_at IS NULL
             )`
          )
          .run(createId('activity'), runId, attempt ? text(attempt, 'id') : null, transitionedAt, runId);
      }
      this.db
        .prepare(
          `UPDATE runs
           SET status = ?, summary = ?, ended_at = ?, final_disposition_json = ?,
               blocker_dependencies_json = ?, external_state_required = ?, next_step_suggestions_json = NULL
           WHERE id = ?`
        )
        .run(
          status,
          summary,
          endedAt,
          disposition ? toJson(dispositionMetadata(disposition)) : null,
          toJson(disposition?.blockerDependencies ?? []),
          disposition?.externalStateRequired ? 1 : 0,
          runId
        );
    });
    const run = this.getRun(runId);
    if (run) this.indexRunSearchDocument(run);
  }

  public beginSessionRunActivity(runId: string, attemptId: string): void {
    const attempt = this.getAttempt(attemptId);
    if (!attempt || attempt.runId !== runId) {
      throw new Error(`Attempt ${attemptId} does not belong to run ${runId}.`);
    }
    const startedAt = nowIso();
    this.transaction(() => {
      this.db
        .prepare('UPDATE session_activity_intervals SET ended_at = ? WHERE run_id = ? AND ended_at IS NULL')
        .run(startedAt, runId);
      this.db
        .prepare(
          `INSERT INTO session_activity_intervals (id, run_id, attempt_id, started_at, ended_at)
           VALUES (?, ?, ?, ?, NULL)`
        )
        .run(createId('activity'), runId, attemptId, startedAt);
    });
  }

  public getSessionNextStepSuggestions(runId: string): GeneratedResearchGoalSuggestions | null {
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT r.next_step_suggestions_json
           FROM runs r
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE r.id = ? AND s.workspace_id = ?`
        )
        .get(runId, this.workspaceId)
    );
    if (!row) throw new Error(`Run not found: ${runId}`);
    return parseStoredSessionNextStepSuggestions(row.next_step_suggestions_json);
  }

  public saveSessionNextStepSuggestions(
    runId: string,
    value: GeneratedResearchGoalSuggestions
  ): GeneratedResearchGoalSuggestions {
    const phase = value.phase.trim();
    const suggestions = value.suggestions.map((suggestion) => suggestion.replace(/\s+/g, ' ').trim());
    const identities = new Set(suggestions.map((suggestion) => suggestion.toLocaleLowerCase()));
    if (!phase || suggestions.length !== 3 || suggestions.some((suggestion) => !suggestion) || identities.size !== 3) {
      throw new Error('Session next-step suggestions must contain a workflow and exactly three distinct non-empty suggestions.');
    }
    const normalized: GeneratedResearchGoalSuggestions = { phase, suggestions };
    const result = this.db
      .prepare(
        `UPDATE runs
         SET next_step_suggestions_json = ?
         WHERE id = ?
           AND status IN ('blocked', 'completed', 'failed', 'stopped')
           AND scope_version_id IN (SELECT id FROM scope_versions WHERE workspace_id = ?)`
      )
      .run(JSON.stringify(normalized), runId, this.workspaceId);
    if (Number(result.changes) !== 1) {
      throw new Error(`Ended run not found for next-step suggestions: ${runId}`);
    }
    return normalized;
  }

  public updateRunTitle(runId: string, title: string): RunRecord {
    const normalized = title.replace(/\s+/g, ' ').trim();
    if (!normalized) throw new Error('Run title cannot be empty.');
    this.db.prepare('UPDATE runs SET title = ? WHERE id = ?').run(normalized, runId);
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found after title update: ${runId}`);
    this.indexRunSearchDocument(run);
    return run;
  }

  public updateRunModelSelection(runId: string, selection: ResearchModelSelection): RunRecord {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const model = selection.model.trim();
    if (!model) throw new Error('Research model cannot be empty.');
    const nextBudget = { ...run.budget, modelProvider: selection.provider };
    const reasoningEffort = selection.reasoningEffort === 'off' ? '' : selection.reasoningEffort;
    this.db
      .prepare('UPDATE runs SET model = ?, reasoning_effort = ?, budget_json = ? WHERE id = ?')
      .run(model, reasoningEffort, toJson(nextBudget), runId);
    const updated = this.getRun(runId);
    if (!updated) throw new Error(`Run not found after model selection update: ${runId}`);
    this.indexRunSearchDocument(updated);
    return updated;
  }

  public updateRunShellSafetyMode(runId: string, shellSafetyMode: ShellSafetyMode): RunRecord {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    this.db.prepare('UPDATE runs SET shell_safety_mode = ? WHERE id = ?').run(shellSafetyMode, runId);
    const updated = this.getRun(runId);
    if (!updated) throw new Error(`Run not found after shell safety mode update: ${runId}`);
    this.indexRunSearchDocument(updated);
    return updated;
  }

  public updateRunBudget(runId: string, budgetPatch: Partial<StartRunInput['budget']>): RunRecord {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const nextBudget: Record<string, unknown> = { ...run.budget };
    for (const key of ['maxMinutes', 'maxAttempts', 'maxCostUsd'] as const) {
      const value = budgetPatch[key];
      if (value === undefined) continue;
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid budget value for ${key}.`);
      }
      if ((key === 'maxMinutes' || key === 'maxAttempts') && value < 1) {
        throw new Error(`${key} must be at least 1.`);
      }
      if (key === 'maxCostUsd' && value < 0) {
        throw new Error('maxCostUsd must be zero or greater.');
      }
      nextBudget[key] = value;
    }
    this.db.prepare('UPDATE runs SET budget_json = ? WHERE id = ?').run(toJson(nextBudget), runId);
    const updated = this.getRun(runId);
    if (!updated) throw new Error(`Run not found after budget update: ${runId}`);
    this.indexRunSearchDocument(updated);
    return updated;
  }

  public updateAttemptState(attemptId: string, status: AttemptStatus, shortState: string): void {
    const endedAt = status === 'completed' || status === 'failed' || status === 'stopped' ? nowIso() : null;
    this.db
      .prepare('UPDATE attempts SET status = ?, short_state = ?, ended_at = ? WHERE id = ?')
      .run(status, shortState, endedAt, attemptId);
  }

  public updateVmState(vmContextId: string, state: string): void {
    const destroyedAt = state === 'destroyed' ? nowIso() : null;
    this.db.prepare('UPDATE vm_contexts SET state = ?, destroyed_at = COALESCE(?, destroyed_at) WHERE id = ?').run(state, destroyedAt, vmContextId);
  }

  public updateVmContext(
    vmContextId: string,
    patch: { backend?: string; imageId?: string; snapshotId?: string; state?: string; metadata?: Record<string, unknown> }
  ): void {
    const existing = this.getVmContext(vmContextId);
    if (!existing) return;
    const state = patch.state ?? existing.state;
    const destroyedAt = state === 'destroyed' ? nowIso() : null;
    this.db
      .prepare(
        `UPDATE vm_contexts
         SET backend = ?,
             image_id = ?,
             snapshot_id = ?,
             state = ?,
             destroyed_at = COALESCE(?, destroyed_at),
             metadata_json = ?
         WHERE id = ?`
      )
      .run(
        patch.backend ?? existing.backend,
        patch.imageId ?? existing.imageId,
        patch.snapshotId ?? existing.snapshotId,
        state,
        destroyedAt,
        toJson(patch.metadata ? { ...existing.metadata, ...patch.metadata } : existing.metadata),
        vmContextId
      );
  }

  public createArtifact(input: CreateArtifactInput): ArtifactRecord {
    const id = createId('artifact');
    const buffer = typeof input.content === 'string' ? Buffer.from(input.content) : input.content;
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const storageDir = join(this.artifactRoot, 'sha256', sha256.slice(0, 2));
    const absolutePath = join(storageDir, sha256);
    mkdirSync(storageDir, { recursive: true });
    if (!existsSync(absolutePath)) {
      writeFileSync(absolutePath, buffer, { flag: 'wx' });
    }

    const relativePath = posix.join('.beale', 'artifacts', 'sha256', sha256.slice(0, 2), sha256);
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO artifacts (
          id, sha256, relative_path, kind, size_bytes, mime_type, sensitivity, model_visible,
          provenance_trace_event_id, source, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sha256,
        relativePath,
        input.kind,
        buffer.byteLength,
        input.mimeType,
        input.sensitivity,
        input.modelVisible ? 1 : 0,
        null,
        input.source,
        toJson(input.metadata),
        createdAt
      );

    const artifact = this.getArtifact(id);
    if (!artifact) throw new Error('Failed to create artifact');
    this.indexArtifactSearchDocument(artifact);
    const runId = artifactRunId(this.db, artifact.id);
    if (runId) this.refreshProjectGraphForRun(runId);
    return artifact;
  }

  public setArtifactProvenance(artifactId: string, traceEventId: string): void {
    this.db.prepare('UPDATE artifacts SET provenance_trace_event_id = ? WHERE id = ?').run(traceEventId, artifactId);
    const artifact = this.getArtifact(artifactId);
    if (artifact) this.indexArtifactSearchDocument(artifact);
    const event = this.getTraceEvent(traceEventId);
    if (event) this.refreshProjectGraphForRun(event.runId);
  }

  public markArtifactSensitive(artifactId: string): void {
    this.db.prepare('UPDATE artifacts SET sensitivity = ?, model_visible = ? WHERE id = ?').run('sensitive', 0, artifactId);
    this.deleteProjectSearchDocuments("entity_type = 'artifact' AND entity_id = ?", [artifactId]);
    const runId = artifactRunId(this.db, artifactId);
    if (runId) this.refreshProjectGraphForRun(runId);
  }

  public createVerifierContract(input: CreateVerifierContractInput): VerifierContractRecord {
    const id = createId('verifier');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO verifier_contracts (
          id, run_id, memory_node_id, mode, status, target_states_json,
          setup_steps_markdown, trigger_steps_markdown, expected_observations_json,
          invariants_json, artifacts_to_collect_json, pass_criteria_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.memoryNodeId ?? null,
        input.mode,
        input.status,
        toJson(input.targetStates),
        input.setupStepsMarkdown,
        input.triggerStepsMarkdown,
        toJson(input.expectedObservations),
        toJson(input.invariants),
        toJson(input.artifactsToCollect),
        toJson(input.passCriteria),
        createdAt,
        createdAt
      );
    const contract = this.getVerifierContract(id);
    if (!contract) throw new Error('Failed to create verifier contract');
    this.indexVerifierContractSearchDocument(contract);
    this.refreshProjectGraphForRun(contract.runId);
    return contract;
  }

  public updateVerifierContract(contractId: string, patch: VerifierContractEditInput & { status?: string }): VerifierContractRecord {
    const existing = this.getVerifierContract(contractId);
    if (!existing) throw new Error(`Verifier contract not found: ${contractId}`);
    this.db
      .prepare(
        `UPDATE verifier_contracts
         SET status = ?,
             setup_steps_markdown = ?,
             trigger_steps_markdown = ?,
             expected_observations_json = ?,
             invariants_json = ?,
             artifacts_to_collect_json = ?,
             pass_criteria_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.status ?? existing.status,
        patch.setupStepsMarkdown ?? existing.setupStepsMarkdown,
        patch.triggerStepsMarkdown ?? existing.triggerStepsMarkdown,
        toJson(patch.expectedObservations ?? existing.expectedObservations),
        toJson(patch.invariants ?? existing.invariants),
        toJson(patch.artifactsToCollect ?? existing.artifactsToCollect),
        toJson(patch.passCriteria ?? existing.passCriteria),
        nowIso(),
        contractId
      );
    const updated = this.getVerifierContract(contractId);
    if (!updated) throw new Error(`Verifier contract not found after update: ${contractId}`);
    this.indexVerifierContractSearchDocument(updated);
    this.refreshProjectGraphForRun(updated.runId);
    return updated;
  }

  public createVerifierRun(input: CreateVerifierRunInput): VerifierRunRecord {
    const id = createId('verifier_run');
    const startedAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO verifier_runs (
          id, contract_id, run_id, attempt_id, vm_context_id, status, blocked_issue,
          behavior_preserved, diagnostics_clean, regression_tests, result_json, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.contractId,
        input.runId,
        input.attemptId ?? null,
        input.vmContextId ?? null,
        input.status,
        input.blockedIssue,
        input.behaviorPreserved,
        input.diagnosticsClean,
        input.regressionTests,
        toJson(input.result),
        startedAt,
        input.endedAt ?? (input.status === 'running' || input.status === 'queued' ? null : startedAt)
      );
    const verifierRun = this.getVerifierRun(id);
    if (!verifierRun) throw new Error('Failed to create verifier run');
    this.indexVerifierRunSearchDocument(verifierRun);
    this.refreshProjectGraphForRun(verifierRun.runId);
    return verifierRun;
  }

  public countCodeBrowserReadsForPath(runId: string, sourcePath: string): number {
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM trace_events
           WHERE run_id = ?
             AND type = 'tool_result'
             AND summary LIKE 'Code browser returned%'
             AND instr(payload_json, ?) > 0`
        )
        .get(runId, JSON.stringify(sourcePath))
    );
    return numberValue(row ?? { count: 0 }, 'count');
  }

  public countCodeBrowserReadsForPathAndHash(runId: string, sourcePath: string, contentHash: string): number {
    if (!contentHash) return 0;
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM trace_events
           WHERE run_id = ?
             AND type = 'tool_result'
             AND summary LIKE 'Code browser returned%'
             AND instr(payload_json, ?) > 0
             AND instr(payload_json, ?) > 0`
        )
        .get(runId, JSON.stringify(sourcePath), JSON.stringify(contentHash))
    );
    return numberValue(row ?? { count: 0 }, 'count');
  }

  public countCodeBrowserReadsForPathHashAndRange(runId: string, sourcePath: string, contentHash: string, lineStart: number | null, lineEnd: number | null): number {
    if (!contentHash || lineStart === null || lineEnd === null) return 0;
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM trace_events
           WHERE run_id = ?
             AND type = 'tool_result'
             AND summary LIKE 'Code browser returned%'
             AND instr(payload_json, ?) > 0
             AND instr(payload_json, ?) > 0
             AND instr(payload_json, ?) > 0
             AND instr(payload_json, ?) > 0`
        )
        .get(runId, JSON.stringify(sourcePath), JSON.stringify(contentHash), `"lineStart":${lineStart}`, `"lineEnd":${lineEnd}`)
    );
    return numberValue(row ?? { count: 0 }, 'count');
  }

  public countBroadSearchesForRun(runId: string, fileLimit: number): number {
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM trace_events
           WHERE run_id = ?
             AND type = 'tool_result'
             AND summary LIKE ?`
        )
        .get(runId, `Examined ${fileLimit} files%`)
    );
    return numberValue(row ?? { count: 0 }, 'count');
  }

  public markPostSourceIndexingDeferred(scopeVersionId: string, reason: string): void {
    const markedAt = nowIso();
    this.setMetaValue(
      `project_indexing_deferred:${scopeVersionId}`,
      JSON.stringify({
        reason,
        markedAt,
        inventory: 'deferred',
        structure: 'external',
        graph: 'disabled',
        semantic: 'disabled'
      }),
      markedAt
    );
  }

  public getProjectIndexingDeferredState(scopeVersionId: string): Record<string, unknown> | null {
    const value = this.getMetaValue(`project_indexing_deferred:${scopeVersionId}`);
    if (!value) return null;
    const parsed = parseJson(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  }

  private clearProjectIndexingDeferredState(scopeVersionId: string): void {
    this.deleteMetaValue(`project_indexing_deferred:${scopeVersionId}`);
  }

  public recordRunSetupState(runId: string, update: Record<string, unknown>): Record<string, unknown> {
    const key = `run_setup_state:${runId}`;
    const existing = this.getRunSetupState(runId) ?? {};
    const probes = Array.isArray(existing.probes) ? existing.probes : [];
    const next = {
      ...existing,
      ...update,
      probes: [...probes, { ...update, recordedAt: nowIso() }].slice(-25),
      updatedAt: nowIso()
    };
    this.setMetaValue(key, JSON.stringify(next));
    this.upsertRunFixtureSetupFromState(runId, next);
    return next;
  }

  public getRunSetupState(runId: string): Record<string, unknown> | null {
    const value = this.getMetaValue(`run_setup_state:${runId}`);
    if (!value) return null;
    const parsed = parseJson(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  }

  public listRunFixtureSetups(runId: string): Array<Record<string, unknown>> {
    return rows(this.db.prepare('SELECT * FROM run_fixture_setups WHERE run_id = ? ORDER BY updated_at DESC').all(runId)).map((row) => ({
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      fixturePath: text(row, 'fixture_path'),
      framework: text(row, 'framework'),
      frameworkVersion: text(row, 'framework_version'),
      dependencySetup: text(row, 'dependency_setup'),
      buildSetup: text(row, 'build_setup'),
      knownGoodBuildFlags: parseStringArray(row.known_good_build_flags_json),
      knownBadBuildFlags: parseStringArray(row.known_bad_build_flags_json),
      metadata: parseJson(row.metadata_json),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at')
    }));
  }

  private upsertRunFixtureSetupFromState(runId: string, setupState: Record<string, unknown>): void {
    const fixturePath = stringValueForJson(setupState.fixturePath);
    if (!fixturePath) return;
    const now = nowIso();
    const existing = rowOrUndefined(this.db.prepare('SELECT id, created_at FROM run_fixture_setups WHERE run_id = ? AND fixture_path = ?').get(runId, fixturePath));
    this.db
      .prepare(
        `INSERT INTO run_fixture_setups (
          id, run_id, fixture_path, framework, framework_version, dependency_setup, build_setup,
          known_good_build_flags_json, known_bad_build_flags_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, fixture_path) DO UPDATE SET
          framework = excluded.framework,
          framework_version = excluded.framework_version,
          dependency_setup = excluded.dependency_setup,
          build_setup = excluded.build_setup,
          known_good_build_flags_json = excluded.known_good_build_flags_json,
          known_bad_build_flags_json = excluded.known_bad_build_flags_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`
      )
      .run(
        existing ? text(existing, 'id') : createId('fixture'),
        runId,
        fixturePath,
        stringValueForJson(setupState.framework),
        stringValueForJson(setupState.frameworkVersion),
        stringValueForJson(setupState.dependencySetup),
        stringValueForJson(setupState.buildSetup),
        toJson(arrayOfStrings(setupState.knownGoodBuildFlags)),
        toJson(arrayOfStrings(setupState.knownBadBuildFlags)),
        toJson(setupState),
        existing ? text(existing, 'created_at') : now,
        now
      );
  }

  public createExportRecord(input: CreateExportInput): string {
    const id = createId('export');
    this.db
      .prepare(
        `INSERT INTO exports (
          id, run_id, memory_node_id, kind, relative_path, redaction_policy_json,
          included_artifacts_json, status, review_decision, review_note, created_at, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.memoryNodeId ?? null,
        input.kind,
        input.relativePath,
        toJson(input.redactionPolicy),
        toJson(input.includedArtifacts),
        input.status ?? 'pending_review',
        null,
        null,
        nowIso(),
        null
      );
    return id;
  }

  public updateExportReview(exportId: string, decision: ExportReviewDecision, note: string): ExportRecord {
    const reviewedAt = nowIso();
    this.db
      .prepare(
        `UPDATE exports
         SET status = ?,
             review_decision = ?,
             review_note = ?,
             reviewed_at = ?
         WHERE id = ?`
      )
      .run(decision, decision, note, reviewedAt, exportId);
    const exportRecord = this.getExportRecord(exportId);
    if (!exportRecord) throw new Error(`Export not found: ${exportId}`);
    return exportRecord;
  }

  public createApproval(input: CreateApprovalInput): ApprovalRecord {
    const id = createId('approval');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO approvals (
          id, run_id, attempt_id, request_kind, requested_action_json, decision,
          reason, scope_amendment_id, created_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.attemptId ?? null,
        input.requestKind,
        toJson(input.requestedAction),
        input.pending ? 'pending' : input.decision,
        input.reason,
        input.scopeAmendmentId ?? null,
        createdAt,
        input.pending ? null : createdAt
      );
    const approval = this.getApproval(id);
    if (!approval) throw new Error('Failed to create approval');
    return approval;
  }

  public updateApprovalDecision(approvalId: string, runId: string, decision: string, reason: string): ApprovalRecord {
    const decidedAt = nowIso();
    const result = this.db
      .prepare("UPDATE approvals SET decision = ?, reason = ?, decided_at = ? WHERE id = ? AND run_id = ? AND decision = 'pending' AND decided_at IS NULL")
      .run(decision, reason, decidedAt, approvalId, runId);
    if (result.changes === 0) {
      const existing = this.getApproval(approvalId);
      if (!existing || existing.runId !== runId) throw new Error(`Approval not found for run ${runId}: ${approvalId}`);
      if (existing.decision !== decision) throw new Error(`Approval ${approvalId} has already been decided.`);
      return existing;
    }
    const approval = this.getApproval(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    return approval;
  }

  public listPendingShellApprovals(): ApprovalRecord[] {
    return rows(
      this.db
        .prepare(
          `SELECT p.* FROM approvals p
           JOIN runs r ON r.id = p.run_id
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE s.workspace_id = ?
             AND p.request_kind = 'shell_command'
             AND p.decision = 'pending'
             AND p.decided_at IS NULL
           ORDER BY p.created_at ASC`
        )
        .all(this.workspaceId)
    ).map((row) => this.mapApproval(row));
  }

  public listRunRows(): RunRow[] {
    const runRows = rows(
      this.db
        .prepare('SELECT r.* FROM runs r JOIN scope_versions s ON s.id = r.scope_version_id WHERE s.workspace_id = ? ORDER BY r.created_at DESC')
        .all(this.workspaceId)
    );
    const intervalRows = rows(
      this.db
        .prepare(
          `SELECT interval.*
           FROM session_activity_intervals interval
           JOIN runs r ON r.id = interval.run_id
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE s.workspace_id = ?
           ORDER BY interval.started_at ASC, interval.id ASC`
        )
        .all(this.workspaceId)
    );
    const attemptRows = rows(
      this.db
        .prepare(
          `SELECT attempt.id, attempt.run_id, attempt.status, attempt.started_at
           FROM attempts attempt
           JOIN runs r ON r.id = attempt.run_id
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE s.workspace_id = ?`
        )
        .all(this.workspaceId)
    );
    const safeguardFailureRows = rows(
      this.db
        .prepare(
          `SELECT DISTINCT trace.run_id, trace.attempt_id
           FROM trace_events trace
           JOIN runs r ON r.id = trace.run_id
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE s.workspace_id = ?
             AND json_valid(trace.payload_json)
             AND (
               (
                 json_extract(trace.payload_json, '$.recoveryKind') = 'safety_guardrail'
                 AND json_extract(trace.payload_json, '$.awaitingSteering') = 1
               )
               OR (
                 json_extract(trace.payload_json, '$.honeycrispKind') = 'error.observed'
                 AND (
                   instr(lower(COALESCE(json_extract(trace.payload_json, '$.payload.summary'), '')), 'cybersecurity risk') > 0
                   OR instr(lower(COALESCE(json_extract(trace.payload_json, '$.payload.summary'), '')), 'safety guardrail') > 0
                   OR instr(lower(COALESCE(json_extract(trace.payload_json, '$.payload.summary'), '')), 'provider safeguard') > 0
                 )
               )
             )`
        )
        .all(this.workspaceId)
    );
    const recoveryInterruptionRows = rows(
      this.db
        .prepare(
          `SELECT DISTINCT trace.run_id, trace.attempt_id
           FROM trace_events trace
           JOIN runs r ON r.id = trace.run_id
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE s.workspace_id = ?
             AND (
               (
                 json_valid(trace.payload_json)
                 AND json_extract(trace.payload_json, '$.interruptedByRecovery') = 1
               )
               OR trace.summary = 'Workspace recovery paused interrupted run after app restart.'
             )`
        )
        .all(this.workspaceId)
    );
    const terminationCauseBySessionRun = new Map<string, RunTerminationCause>();
    const fallbackTerminationCauseByRun = new Map<string, RunTerminationCause>();
    for (const row of recoveryInterruptionRows) {
      const runId = text(row, 'run_id');
      const attemptId = nullableText(row, 'attempt_id');
      if (attemptId) terminationCauseBySessionRun.set(`${runId}:${attemptId}`, 'workspace_recovery');
      else fallbackTerminationCauseByRun.set(runId, 'workspace_recovery');
    }
    for (const row of safeguardFailureRows) {
      const runId = text(row, 'run_id');
      const attemptId = nullableText(row, 'attempt_id');
      if (attemptId) terminationCauseBySessionRun.set(`${runId}:${attemptId}`, 'safeguard');
      else fallbackTerminationCauseByRun.set(runId, 'safeguard');
    }
    const attemptById = new Map(attemptRows.map((row) => [text(row, 'id'), row] as const));
    const intervalsBySessionRun = new Map<string, SessionActivityInterval[]>();
    for (const intervalRow of intervalRows) {
      const interval = this.mapSessionActivityInterval(intervalRow);
      const sessionRunId = interval.attemptId ?? `legacy:${interval.runId}`;
      const key = `${interval.runId}:${sessionRunId}`;
      const sessionRunIntervals = intervalsBySessionRun.get(key) ?? [];
      sessionRunIntervals.push(interval);
      intervalsBySessionRun.set(key, sessionRunIntervals);
    }
    return runRows.map((runRow) => {
      const run = this.mapRun(runRow);
      const sessionRuns = [...intervalsBySessionRun.entries()]
        .filter(([key]) => key.startsWith(`${run.id}:`))
        .map(([key, activityIntervals]) => {
          const attemptId = activityIntervals[0]?.attemptId ?? null;
          const attempt = attemptId ? attemptById.get(attemptId) : undefined;
          return {
            id: attemptId ?? `legacy:${run.id}`,
            runId: run.id,
            attemptId,
            status: (attempt ? text(attempt, 'status') : run.status) as RunStatus,
            activityIntervals,
            terminationCause: terminationCauseBySessionRun.get(key) ?? null
          };
        })
        .sort((left, right) => {
          const leftStartedAt = left.activityIntervals[0]?.startedAt ?? '';
          const rightStartedAt = right.activityIntervals[0]?.startedAt ?? '';
          return leftStartedAt.localeCompare(rightStartedAt) || left.id.localeCompare(right.id);
        });
      const fallbackTerminationCause = fallbackTerminationCauseByRun.get(run.id) ?? null;
      if (fallbackTerminationCause && sessionRuns.length > 0) {
        const lastSessionRun = sessionRuns.at(-1);
        if (lastSessionRun && !lastSessionRun.terminationCause) lastSessionRun.terminationCause = fallbackTerminationCause;
      }
      return {
        run,
        engine: this.runEngineFromBudget(run.budget),
        sessionRuns,
        breakoutRooms: this.listBreakoutRoomSummaries(run.id)
      };
    });
  }

  public listResearchRecommendationRuns(limit = 12, prioritizeRunId: string | null = null): ResearchRecommendationRunContext[] {
    const requestedLimit = Math.floor(limit);
    const boundedLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(24, requestedLimit)) : 12;
    const runRows = rows(
      this.db
        .prepare(
          `SELECT r.*
           FROM runs r
           JOIN scope_versions s ON s.id = r.scope_version_id
           WHERE s.workspace_id = ?
           ORDER BY CASE WHEN r.id = ? THEN 0 ELSE 1 END, r.created_at DESC
           LIMIT ?`
          )
        .all(this.workspaceId, prioritizeRunId ?? '', boundedLimit)
    );
    return runRows.map((runRow) => {
      const run = this.mapRun(runRow);
      const verifierContracts = rows(
        this.db
          .prepare(
            `SELECT memory_node_id, mode, status, pass_criteria_json
             FROM verifier_contracts
             WHERE run_id = ?
             ORDER BY created_at DESC, rowid DESC
             LIMIT 8`
          )
          .all(run.id)
      ).reverse().map((row) => ({
        memoryNodeId: nullableText(row, 'memory_node_id'),
        mode: text(row, 'mode'),
        status: text(row, 'status'),
        passCriteria: parseJson(row.pass_criteria_json)
      }));
      const verifierRuns = rows(
        this.db
          .prepare(
            `SELECT status, result_json, blocked_issue
             FROM verifier_runs
             WHERE run_id = ?
             ORDER BY started_at DESC, rowid DESC
             LIMIT 8`
          )
          .all(run.id)
      ).reverse().map((row) => ({
        status: text(row, 'status'),
        result: parseJson(row.result_json),
        blockedIssue: text(row, 'blocked_issue')
      }));
      const notableTraceEvents = rows(
        this.db
          .prepare(
            `SELECT type, source, summary, model_visible
             FROM trace_events
             WHERE run_id = ?
               AND type IN ('tool_result', 'verifier_result', 'artifact_created', 'approval_event', 'research_event')
             ORDER BY sequence DESC
             LIMIT 10`
          )
          .all(run.id)
      ).reverse().map((row) => ({
        type: text(row, 'type') as TraceEventType,
        source: text(row, 'source') as TraceSource,
        summary: text(row, 'summary'),
        modelVisible: booleanValue(row, 'model_visible')
      }));
      const assistantMessages = rows(
        this.db
          .prepare(
            `SELECT * FROM transcript_messages
             WHERE run_id = ? AND role = 'assistant'
             ORDER BY created_at DESC, rowid DESC`
          )
          .all(run.id)
      )
        .map((row) => this.mapTranscriptMessage(row));
      const finalResponseMarkdown = assistantMessages.find((message) => message.phase === 'final_answer')
        ?.contentMarkdown ?? assistantMessages[0]?.contentMarkdown ?? null;
      return { run, finalResponseMarkdown, verifierContracts, verifierRuns, notableTraceEvents };
    });
  }

  public getRunDetail(runId: string): RunDetail {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return {
      run,
      researchProfile: this.getRunResearchProfileSnapshot(runId),
      nextStepSuggestions: this.getSessionNextStepSuggestions(runId),
      attempts: rows(this.db.prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at ASC').all(runId)).map((row) => this.mapAttempt(row)),
      traceEvents: rows(this.db.prepare('SELECT * FROM trace_events WHERE run_id = ? ORDER BY sequence ASC').all(runId)).map((row) => this.mapTraceEvent(row)),
      transcriptMessages: rows(this.db.prepare('SELECT * FROM transcript_messages WHERE run_id = ? ORDER BY created_at ASC, rowid ASC').all(runId)).map((row) =>
        this.mapTranscriptMessage(row)
      ),
      breakoutRooms: rows(this.db.prepare(
        `SELECT * FROM breakout_rooms
         WHERE run_id = ?
           AND id IN (
             SELECT room_id FROM breakout_room_members WHERE run_id = ? GROUP BY room_id HAVING COUNT(DISTINCT id) >= 2
           )
         ORDER BY created_at DESC, rowid DESC`
      ).all(runId, runId)).map((row) =>
        this.mapBreakoutRoom(row)
      ),
      breakoutRoomMembers: rows(this.db.prepare(
        `SELECT * FROM breakout_room_members
         WHERE run_id = ?
           AND room_id IN (
             SELECT room_id FROM breakout_room_members WHERE run_id = ? GROUP BY room_id HAVING COUNT(DISTINCT id) >= 2
           )
         ORDER BY started_at ASC, rowid ASC`
      ).all(runId, runId)).map((row) =>
        this.mapBreakoutRoomMember(row)
      ),
      breakoutRoomMessages: rows(this.db.prepare(
        `SELECT * FROM breakout_room_messages
         WHERE run_id = ?
           AND room_id IN (
             SELECT room_id FROM breakout_room_members WHERE run_id = ? GROUP BY room_id HAVING COUNT(DISTINCT id) >= 2
           )
         ORDER BY created_at ASC, rowid ASC`
      ).all(runId, runId)).map((row) =>
        this.mapBreakoutRoomMessage(row)
      ),
      artifacts: rows(
        this.db
          .prepare(
            `SELECT DISTINCT a.* FROM artifacts a
             JOIN trace_events t ON t.artifact_id = a.id
             WHERE t.run_id = ?
             ORDER BY a.created_at ASC`
          )
          .all(runId)
      ).map((row) => this.mapArtifact(row)),
      verifierContracts: rows(this.db.prepare('SELECT * FROM verifier_contracts WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapVerifierContract(row)),
      verifierRuns: rows(this.db.prepare('SELECT * FROM verifier_runs WHERE run_id = ? ORDER BY started_at ASC, rowid ASC').all(runId)).map((row) => this.mapVerifierRun(row)),
      vmContexts: rows(
        this.db
          .prepare(
            `SELECT DISTINCT v.* FROM vm_contexts v
             LEFT JOIN attempts a ON a.vm_context_id = v.id
             WHERE a.run_id = ? OR v.id IN (SELECT vm_context_id FROM trace_events WHERE run_id = ? AND vm_context_id IS NOT NULL)
             ORDER BY v.created_at ASC`
          )
          .all(runId, runId)
      ).map((row) => this.mapVmContext(row)),
      modelSessions: rows(this.db.prepare('SELECT * FROM model_sessions WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapModelSession(row)),
      contextCompactions: rows(this.db.prepare('SELECT * FROM context_compactions WHERE run_id = ? ORDER BY created_at ASC, rowid ASC').all(runId)).map((row) =>
        this.mapContextCompaction(row)
      ),
      policyEvents: rows(this.db.prepare('SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapApproval(row)),
      exports: rows(this.db.prepare('SELECT * FROM exports WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapExport(row))
    };
  }

  public searchTranscriptMessages(
    input: SessionTranscriptSearchInput,
    context: { registryWorkspaceId: string; workspacePath: string; workspaceName: string }
  ): SessionTranscriptSearchResponse {
    return this.searchTranscriptMessagesAcrossWorkspaces(input, [{
      databaseWorkspaceId: this.workspaceId,
      ...context
    }]);
  }

  public searchTranscriptMessagesAcrossWorkspaces(
    input: SessionTranscriptSearchInput,
    contexts: readonly {
      databaseWorkspaceId: string;
      registryWorkspaceId: string;
      workspacePath: string;
      workspaceName: string;
    }[]
  ): SessionTranscriptSearchResponse {
    const query = input.query.trim();
    if (!query) return emptyTranscriptSearchResponse();
    const terms = transcriptSearchTerms(query);
    if (!terms.length) return emptyTranscriptSearchResponse();
    const contextByWorkspaceId = new Map(
      contexts.map((context) => [context.databaseWorkspaceId, context] as const)
    );
    if (contextByWorkspaceId.size === 0) return emptyTranscriptSearchResponse();
    const requestedLimit = Math.floor(input.limit ?? 24);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, requestedLimit) : 24;
    const conditions = terms.map(() => "LOWER(tm.content_markdown) LIKE ? ESCAPE '\\'").join(' AND ');
    const parameters = terms.map((term) => `%${escapeLike(term.toLowerCase())}%`);
    const workspaceIdsJson = JSON.stringify([...contextByWorkspaceId.keys()]);
    const countRows = rows(
      this.db
        .prepare(
          `SELECT p.workspace_id AS workspace_id, COUNT(*) AS total_matches
           FROM transcript_messages tm
           JOIN runs r ON r.id = tm.run_id
           JOIN scope_versions p ON p.id = r.scope_version_id
           WHERE p.workspace_id IN (SELECT value FROM json_each(?)) AND ${conditions}
           GROUP BY p.workspace_id`
        )
        .all(workspaceIdsJson, ...parameters)
    );
    const resultRows = rows(
      this.db
        .prepare(
          `SELECT
             p.workspace_id AS workspace_id,
             tm.id AS transcript_message_id,
             tm.run_id AS run_id,
             tm.trace_event_id AS trace_event_id,
             tm.role AS role,
             tm.source AS source,
             tm.content_markdown AS content_markdown,
             tm.created_at AS created_at,
             r.title AS session_title
           FROM transcript_messages tm
           JOIN runs r ON r.id = tm.run_id
           JOIN scope_versions p ON p.id = r.scope_version_id
           WHERE p.workspace_id IN (SELECT value FROM json_each(?)) AND ${conditions}
           ORDER BY tm.created_at DESC, tm.rowid DESC
           LIMIT ?`
        )
        .all(workspaceIdsJson, ...parameters, limit)
    );

    const results = resultRows.flatMap((row): SessionTranscriptSearchResult[] => {
      const context = contextByWorkspaceId.get(text(row, 'workspace_id'));
      if (!context) return [];
      return [{
        registryWorkspaceId: context.registryWorkspaceId,
        workspacePath: context.workspacePath,
        runId: text(row, 'run_id'),
        transcriptMessageId: text(row, 'transcript_message_id'),
        traceEventId: nullableText(row, 'trace_event_id'),
        role: text(row, 'role') as SessionTranscriptSearchResult['role'],
        source: text(row, 'source'),
        sessionTitle: text(row, 'session_title'),
        workspaceName: context.workspaceName,
        contentPreview: transcriptSearchPreview(text(row, 'content_markdown'), terms),
        createdAt: text(row, 'created_at')
      }];
    });
    const totalsByWorkspaceId = new Map(
      countRows.map((row) => [text(row, 'workspace_id'), numberValue(row, 'total_matches')] as const)
    );
    const workspaces = [...contextByWorkspaceId.values()].flatMap((context) => {
      const totalTranscriptMatches = totalsByWorkspaceId.get(context.databaseWorkspaceId) ?? 0;
      return totalTranscriptMatches > 0
        ? [{
            registryWorkspaceId: context.registryWorkspaceId,
            workspacePath: context.workspacePath,
            workspaceName: context.workspaceName,
            totalTranscriptMatches
          }]
        : [];
    });

    return {
      results,
      totalTranscriptMatches: workspaces.reduce((total, workspace) => total + workspace.totalTranscriptMatches, 0),
      workspaceCount: workspaces.length,
      workspaces
    };
  }

  public getProjectInventorySummary(scopeVersionId = this.getActiveScope().id): ProjectInventorySummary {
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT
             COUNT(*) AS item_count,
             SUM(CASE WHEN item_kind = 'file' THEN 1 ELSE 0 END) AS file_count,
             SUM(CASE WHEN resource_kind = 'manifest' THEN 1 ELSE 0 END) AS manifest_count,
             SUM(CASE WHEN resource_kind = 'binary' THEN 1 ELSE 0 END) AS binary_count,
             MAX(indexed_at) AS indexed_at
           FROM project_inventory_items
           WHERE scope_version_id = ?`
        )
        .get(scopeVersionId)
    );
    return {
      scopeVersionId,
      itemCount: row ? numberValue(row, 'item_count') : 0,
      fileCount: row ? numberValue(row, 'file_count') : 0,
      manifestCount: row ? numberValue(row, 'manifest_count') : 0,
      binaryCount: row ? numberValue(row, 'binary_count') : 0,
      indexedAt: row ? nullableText(row, 'indexed_at') : null
    };
  }

  private scopeVersionLineagePredicate(column: string): string {
    return `${column} IN (
      SELECT prior.id
      FROM scope_versions prior
      JOIN scope_versions target ON target.id = ?
      WHERE prior.workspace_id = target.workspace_id
        AND prior.version <= target.version
    )`;
  }

  public getProjectRetrievalFeedbackSummary(scopeVersionId = this.getActiveScope().id): {
    readPathCounts: Record<string, number>;
    verifiedEntityKeys: string[];
    correctedNegativeEntityKeys: string[];
  } {
    const joinedLineageRunSql = this.scopeVersionLineagePredicate('r.scope_version_id');
    const readPathCounts: Record<string, number> = {};
    const readRows = rows(
      this.db
        .prepare(
          `SELECT te.payload_json
           FROM trace_events te
           JOIN tool_calls tc ON tc.trace_event_id = te.id
           JOIN runs r ON r.id = te.run_id
           WHERE ${joinedLineageRunSql}
             AND tc.tool_name = 'code_browser'
             AND te.type = 'tool_result'`
        )
        .all(scopeVersionId)
    );
    for (const row of readRows) {
      const payload = parseJson(row.payload_json);
      const sourcePath = stringFromUnknown(payload.sourcePath) ?? stringFromUnknown(payload.path);
      if (!sourcePath) continue;
      readPathCounts[sourcePath] = (readPathCounts[sourcePath] ?? 0) + 1;
    }

    const verifiedEntityKeys = new Set<string>();
    for (const row of rows(this.db.prepare(`SELECT vc.memory_node_id FROM verifier_runs vr JOIN verifier_contracts vc ON vc.id = vr.contract_id JOIN runs r ON r.id = vr.run_id WHERE ${joinedLineageRunSql} AND vr.status = 'pass' AND vc.memory_node_id IS NOT NULL`).all(scopeVersionId))) {
      const memoryNodeId = nullableText(row, 'memory_node_id');
      if (memoryNodeId) verifiedEntityKeys.add(`memory_node:${memoryNodeId}`);
    }

    const correctedNegativeEntityKeys = new Set<string>();
    return {
      readPathCounts,
      verifiedEntityKeys: [...verifiedEntityKeys],
      correctedNegativeEntityKeys: [...correctedNegativeEntityKeys]
    };
  }

  public findProjectInventoryItemByPath(
    scopeVersionId: string,
    path: string,
    options: { refreshInventory?: boolean } = {}
  ): {
    id: string;
    assetId: string;
    itemKind: string;
    resourceKind: string;
    path: string;
    value: string;
    language: string;
    sizeBytes: number | null;
    sha256: string | null;
    sensitivity: string;
    metadata: Record<string, unknown>;
  } | null {
    if (options.refreshInventory !== false) {
      this.ensureProjectInventory(scopeVersionId);
    }
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM project_inventory_items WHERE scope_version_id = ? AND path = ? LIMIT 1').get(scopeVersionId, path));
    if (!row) return null;
    return {
      id: text(row, 'id'),
      assetId: text(row, 'asset_id'),
      itemKind: text(row, 'item_kind'),
      resourceKind: text(row, 'resource_kind'),
      path: text(row, 'path'),
      value: text(row, 'value'),
      language: text(row, 'language'),
      sizeBytes: nullableNumber(row, 'size_bytes'),
      sha256: nullableText(row, 'sha256'),
      sensitivity: text(row, 'sensitivity'),
      metadata: parseJson(row.metadata_json)
    };
  }

  public getProjectStructureSummary(scopeVersionId = this.getActiveScope().id): ProjectStructureSummary {
    const entityRow = rowOrUndefined(
      this.db
        .prepare(
          `SELECT
             COUNT(*) AS entity_count,
             COUNT(DISTINCT path) AS indexed_file_count,
             SUM(CASE WHEN entity_kind IN ('function', 'method', 'class', 'type') THEN 1 ELSE 0 END) AS definition_count,
             SUM(CASE WHEN entity_kind = 'route' THEN 1 ELSE 0 END) AS route_count,
             SUM(CASE WHEN entity_kind = 'import' THEN 1 ELSE 0 END) AS import_count,
             SUM(CASE WHEN metadata_json LIKE '%"truncatedFile":true%' THEN 1 ELSE 0 END) AS truncated_entity_count,
             MAX(indexed_at) AS indexed_at
           FROM project_structure_entities
           WHERE scope_version_id = ?`
        )
        .get(scopeVersionId)
    );
    const relationRow = rowOrUndefined(
      this.db
        .prepare(
          `SELECT
             COUNT(*) AS relation_count,
             SUM(CASE WHEN target_entity_id IS NULL THEN 1 ELSE 0 END) AS unresolved_relation_count
           FROM project_structure_relations
           WHERE scope_version_id = ?`
        )
        .get(scopeVersionId)
    );
    const entityCount = entityRow ? numberValue(entityRow, 'entity_count') : 0;
    return {
      scopeVersionId,
      status: entityCount > 0 ? 'ready' : 'empty',
      entityCount,
      relationCount: relationRow ? numberValue(relationRow, 'relation_count') : 0,
      indexedFileCount: entityRow ? numberValue(entityRow, 'indexed_file_count') : 0,
      unresolvedRelationCount: relationRow ? numberValue(relationRow, 'unresolved_relation_count') : 0,
      truncatedEntityCount: entityRow ? numberValue(entityRow, 'truncated_entity_count') : 0,
      definitionCount: entityRow ? numberValue(entityRow, 'definition_count') : 0,
      routeCount: entityRow ? numberValue(entityRow, 'route_count') : 0,
      importCount: entityRow ? numberValue(entityRow, 'import_count') : 0,
      indexedAt: entityRow ? nullableText(entityRow, 'indexed_at') : null
    };
  }

  public getProjectStructureCoverageRecords(
    scopeVersionId = this.getActiveScope().id,
    limits: { entities?: number; relations?: number; refreshIndex?: boolean } = {}
  ): {
    index: { rootCount: number; skippedCount: number; truncated: boolean };
    paths: ProjectSourceCoveragePathRecord[];
    entities: ProjectStructureEntityRecord[];
    relations: ProjectStructureRelationRecord[];
  } {
    if (limits.refreshIndex === true) this.ensureProjectStructureCoverageIndex(scopeVersionId);
    const entityLimit = Math.max(1, Math.min(25_000, Math.floor(limits.entities ?? 10_000)));
    const relationLimit = Math.max(1, Math.min(50_000, Math.floor(limits.relations ?? 25_000)));
    const paths = rows(
      this.db
        .prepare(
          `SELECT asset_id, path, language, indexed_at
           FROM project_inventory_items
           WHERE scope_version_id = ?
             AND item_kind = 'file'
             AND resource_kind IN ('source', 'manifest')
           ORDER BY path ASC
           LIMIT 25000`
        )
        .all(scopeVersionId)
    ).map((row) => ({
      assetId: text(row, 'asset_id'),
      path: text(row, 'path'),
      language: text(row, 'language'),
      indexedAt: text(row, 'indexed_at')
    }));
    const entities = rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_structure_entities
           WHERE scope_version_id = ?
           ORDER BY path ASC, line_start ASC, entity_kind ASC, name ASC
           LIMIT ?`
        )
        .all(scopeVersionId, entityLimit)
    ).map((row) => this.mapProjectStructureEntity(row));
    const relations = rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_structure_relations
           WHERE scope_version_id = ?
           ORDER BY source_entity_id ASC, relation_kind ASC, target_name ASC
           LIMIT ?`
        )
        .all(scopeVersionId, relationLimit)
    ).map((row) => this.mapProjectStructureRelation(row));
    const indexReport = parseJson(this.getMetaValue(`project_source_coverage:${scopeVersionId}:indexed_at`));
    return {
      index: {
        rootCount: typeof indexReport.rootCount === 'number' ? Math.max(0, Math.floor(indexReport.rootCount)) : 0,
        skippedCount: typeof indexReport.skippedCount === 'number' ? Math.max(0, Math.floor(indexReport.skippedCount)) : 0,
        truncated: indexReport.truncated === true
      },
      paths,
      entities,
      relations
    };
  }

  public listProjectSourceReviewObservations(
    scopeVersionId = this.getActiveScope().id,
    maxTraceRows = 2_000
  ): ProjectSourceReviewObservation[] {
    const joinedLineageRunSql = this.scopeVersionLineagePredicate('r.scope_version_id');
    const requestedLimit = Math.floor(maxTraceRows);
    const traceRowLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(5_000, requestedLimit)) : 2_000;
    const observations: ProjectSourceReviewObservation[] = [];
    const seen = new Set<string>();
    const reviewRows = rows(
      this.db
        .prepare(
          `SELECT te.id, te.run_id, te.payload_json, tc.tool_name, tc.input_json, tc.result_json
           FROM trace_events te
           JOIN runs r ON r.id = te.run_id
           LEFT JOIN tool_calls tc ON tc.id = te.tool_call_id
           WHERE ${joinedLineageRunSql}
             AND te.type = 'tool_result'
           ORDER BY te.created_at DESC, te.sequence DESC
           LIMIT ?`
        )
        .all(scopeVersionId, traceRowLimit)
    ).reverse();
    for (const row of reviewRows) {
      const payload = parseJson(row.payload_json);
      const input = parseJson(row.input_json);
      const result = parseJson(row.result_json);
      const records = [input, payload, result];
      const toolName = nullableText(row, 'tool_name') ?? nestedString(records, ['toolName', 'tool_name']) ?? '';
      const toolStatus = nestedString(records, ['status']);
      const toolError = nestedValue(records, ['error']);
      const hasToolError = toolError !== undefined && toolError !== null && toolError !== false && toolError !== '';
      if ((toolStatus && /^(?:blocked|canceled|denied|error|failed|interrupted|rejected)$/i.test(toolStatus)) || hasToolError) {
        continue;
      }
      const structuredRead = /(?:^|\.)(?:code_browser|file\.read|repository\.(?:read|open)|source\.(?:read|open))$/i.test(toolName);
      const directPath = nestedString(records, ['sourcePath', 'filePath', 'resolvedPath', 'requestedPath', 'path']);
      const directSymbol = nestedString(records, ['symbol', 'functionName', 'methodName']);
      const directLineStart = nestedNumber(records, ['lineStart', 'startLine', 'line']);
      const directLineEnd = nestedNumber(records, ['lineEnd', 'endLine']) ?? directLineStart;
      const locations = [
        ...(directPath && (structuredRead || directSymbol || directLineStart !== null)
          ? [{ path: directPath, symbol: directSymbol, lineStart: directLineStart, lineEnd: directLineEnd }]
          : []),
        ...(/^shell\.run$/i.test(toolName) ? shellSourceReviewLocations(records) : [])
      ];
      for (const location of locations) {
        const key = `${text(row, 'run_id')}\n${location.path}\n${location.symbol ?? ''}\n${location.lineStart ?? ''}\n${location.lineEnd ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        observations.push({
          runId: text(row, 'run_id'),
          traceEventId: text(row, 'id'),
          toolName: toolName || 'structured_source_read',
          ...location
        });
      }
    }
    return observations.slice(-5000);
  }

  public getProjectGraphSummary(scopeVersionId = this.getActiveScope().id): ProjectGraphSummary {
    this.db.exec(PROJECT_GRAPH_STATUS_SCHEMA_SQL);
    const nodeRow = rowOrUndefined(
      this.db
        .prepare(
          `SELECT COUNT(*) AS node_count, MAX(indexed_at) AS indexed_at
           FROM project_graph_nodes
           WHERE scope_version_id = ?`
        )
        .get(scopeVersionId)
    );
    const edgeRow = rowOrUndefined(
      this.db
        .prepare(
          `SELECT
             COUNT(*) AS edge_count,
             SUM(CASE WHEN metadata_json LIKE '%"source":"structure_relation"%' THEN 1 ELSE 0 END) AS structural_edge_count,
             SUM(CASE WHEN target_node_id IS NULL THEN 1 ELSE 0 END) AS unresolved_edge_count
           FROM project_graph_edges
           WHERE scope_version_id = ?`
        )
        .get(scopeVersionId)
    );
    const nodeCount = nodeRow ? numberValue(nodeRow, 'node_count') : 0;
    const edgeCount = edgeRow ? numberValue(edgeRow, 'edge_count') : 0;
    const expectedNodeFamilyCounts = this.projectGraphExpectedNodeFamilyCounts(scopeVersionId);
    const expectedNodeCount = Object.values(expectedNodeFamilyCounts).reduce((sum, count) => sum + count, 0);
    const nodeFamilyCounts = this.projectGraphActualNodeFamilyCounts(scopeVersionId);
    const edgeFamilyCounts = this.projectGraphActualEdgeFamilyCounts(scopeVersionId);
    const extractionFamilyCounts = this.projectGraphExtractionFamilyCounts(scopeVersionId);
    const staleReasons = this.projectGraphStaleReasons(expectedNodeFamilyCounts, nodeFamilyCounts);
    const status = nodeCount === 0 ? 'empty' : staleReasons.length > 0 ? 'stale' : 'ready';
    const statusRow = rowOrUndefined(this.db.prepare('SELECT * FROM project_graph_status WHERE scope_version_id = ?').get(scopeVersionId));
    this.recordProjectGraphStatus(scopeVersionId, {
      rebuildReason: nullableText(statusRow ?? {}, 'last_rebuild_reason'),
      indexedAt: nodeRow ? nullableText(nodeRow, 'indexed_at') : null,
      durationMs: nullableNumber(statusRow ?? {}, 'last_rebuild_duration_ms'),
      incrementBuildCount: false,
      expectedNodeCount,
      actualNodeCount: nodeCount,
      actualEdgeCount: edgeCount,
      staleReasons,
      nodeFamilyCounts,
      edgeFamilyCounts
    });
    const updatedStatusRow = rowOrUndefined(this.db.prepare('SELECT * FROM project_graph_status WHERE scope_version_id = ?').get(scopeVersionId));
    return {
      scopeVersionId,
      status,
      nodeCount,
      edgeCount,
      structuralEdgeCount: edgeRow ? numberValue(edgeRow, 'structural_edge_count') : 0,
      unresolvedEdgeCount: edgeRow ? numberValue(edgeRow, 'unresolved_edge_count') : 0,
      expectedNodeCount,
      staleReasons,
      rebuildReason: nullableText(updatedStatusRow ?? {}, 'last_rebuild_reason'),
      buildCount: updatedStatusRow ? numberValue(updatedStatusRow, 'build_count') : 0,
      nodeFamilyCounts,
      edgeFamilyCounts,
      extractionFamilyCounts,
      indexedAt: nodeRow ? nullableText(nodeRow, 'indexed_at') : null
    };
  }

  public getWorkspaceGraphVisualization(
    scopeVersionId = this.getActiveScope().id,
    options: { nodeLimit?: number; edgeLimit?: number } = {}
  ): WorkspaceGraphVisualization {
    const summary = this.getProjectGraphSummary(scopeVersionId);
    const nodeLimit = Math.max(12, Math.min(120, Math.floor(options.nodeLimit ?? 64)));
    const edgeLimit = Math.max(12, Math.min(180, Math.floor(options.edgeLimit ?? 36)));
    const candidateEdges = rows(
      this.db
        .prepare(
          `WITH candidate_edges AS (
             SELECT e.*,
                    CASE
                      WHEN COALESCE(s.source_path, '') LIKE '%.test.%' THEN 1
                      WHEN COALESCE(s.source_path, '') LIKE '%/test/%' THEN 1
                      WHEN COALESCE(s.source_path, '') LIKE '%/.github/workflows/%' THEN 2
                      WHEN COALESCE(s.source_path, '') LIKE '%README.md' THEN 2
                      ELSE 0
                    END AS source_priority,
                    ROW_NUMBER() OVER (
                      PARTITION BY e.edge_kind, LOWER(e.target_label), COALESCE(s.source_path, ''), COALESCE(t.source_path, ''), LOWER(s.label)
                      ORDER BY e.indexed_at DESC, e.id ASC
                    ) AS relation_rank
             FROM project_graph_edges e
             JOIN project_graph_nodes s ON s.scope_version_id = e.scope_version_id
              AND s.id = e.source_node_id
             LEFT JOIN project_graph_nodes t ON t.scope_version_id = e.scope_version_id
              AND t.id = e.target_node_id
             WHERE e.scope_version_id = ?
               AND e.target_node_id IS NOT NULL
               AND e.source_node_id <> e.target_node_id
           )
           SELECT *
           FROM candidate_edges
           WHERE relation_rank = 1
           ORDER BY
             CASE edge_kind
               WHEN 'routes_to' THEN 0
               WHEN 'handles_with' THEN 1
               WHEN 'uses_middleware' THEN 2
               WHEN 'checks_permission' THEN 3
               WHEN 'reaches_sink' THEN 4
               WHEN 'parses_body' THEN 5
               WHEN 'serializes_response' THEN 6
               WHEN 'reads_model' THEN 7
               WHEN 'writes_model' THEN 8
               WHEN 'supports_hypothesis' THEN 9
               WHEN 'verifies_finding' THEN 10
               WHEN 'evidence_for' THEN 11
               WHEN 'calls' THEN 12
               WHEN 'imports_symbol' THEN 13
               WHEN 'exports_symbol' THEN 14
               WHEN 'references_permission' THEN 15
               WHEN 'references_url' THEN 16
               ELSE 30
             END,
             source_priority ASC,
             indexed_at DESC,
             edge_kind ASC,
             target_label ASC
           LIMIT ?`
        )
        .all(scopeVersionId, edgeLimit * 4)
    ).map((row) => this.mapProjectGraphEdge(row));
    const selectedEdges: ProjectGraphEdgeRecord[] = [];
    const nodeIds = new Set<string>();
    const edgeKindCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();
    const edgeKindLimit = Math.max(4, Math.ceil(edgeLimit / 10));
    const targetLimit = Math.max(3, Math.ceil(edgeLimit / 14));
    for (const edge of candidateEdges) {
      if (!edge.targetNodeId) continue;
      const edgeKindCount = edgeKindCounts.get(edge.edgeKind) ?? 0;
      if (edgeKindCount >= edgeKindLimit) continue;
      const targetKey = `${edge.targetEntityType}:${edge.targetLabel.trim().toLowerCase()}`;
      const targetCount = targetCounts.get(targetKey) ?? 0;
      if (targetCount >= targetLimit) continue;
      const additions = [edge.sourceNodeId, edge.targetNodeId].filter((nodeId) => !nodeIds.has(nodeId));
      if (selectedEdges.length > 0 && nodeIds.size + additions.length > nodeLimit) continue;
      selectedEdges.push(edge);
      nodeIds.add(edge.sourceNodeId);
      nodeIds.add(edge.targetNodeId);
      edgeKindCounts.set(edge.edgeKind, edgeKindCount + 1);
      targetCounts.set(targetKey, targetCount + 1);
      if (selectedEdges.length >= edgeLimit) break;
    }
    if (selectedEdges.length === 0 && nodeIds.size < nodeLimit) {
      const supplementalLimit = nodeLimit - nodeIds.size;
      for (const node of rows(
        this.db
          .prepare(
            `SELECT n.*
             FROM project_graph_nodes n
             WHERE n.scope_version_id = ?
             ORDER BY
               CASE n.entity_type
                 WHEN 'scope_version' THEN 0
                 WHEN 'scope_asset' THEN 1
                 WHEN 'run' THEN 2
                 WHEN 'verifier_run' THEN 3
                 WHEN 'verifier_contract' THEN 4
                 WHEN 'artifact' THEN 5
                 WHEN 'structure_entity' THEN 6
                 WHEN 'inventory_item' THEN 7
                 ELSE 20
               END,
               n.indexed_at DESC,
               n.label ASC
             LIMIT ?`
          )
          .all(scopeVersionId, supplementalLimit + nodeIds.size)
      ).map((row) => this.mapProjectGraphNode(row))) {
        if (nodeIds.size >= nodeLimit) break;
        nodeIds.add(node.id);
      }
    }
    const selectedNodes = nodeIds.size > 0 ? this.getProjectGraphNodesById(scopeVersionId, [...nodeIds]) : [];
    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const displayEdges = selectedEdges.filter((edge) => selectedNodeIds.has(edge.sourceNodeId) && Boolean(edge.targetNodeId) && selectedNodeIds.has(edge.targetNodeId ?? ''));
    const selectedDegreeCounts = new Map<string, number>();
    for (const edge of displayEdges) {
      selectedDegreeCounts.set(edge.sourceNodeId, (selectedDegreeCounts.get(edge.sourceNodeId) ?? 0) + 1);
      if (edge.targetNodeId) selectedDegreeCounts.set(edge.targetNodeId, (selectedDegreeCounts.get(edge.targetNodeId) ?? 0) + 1);
    }
    return {
      scopeVersionId,
      status: summary.status,
      nodeCount: summary.nodeCount,
      edgeCount: summary.edgeCount,
      sampledNodeCount: selectedNodes.length,
      sampledEdgeCount: displayEdges.length,
      truncated: summary.nodeCount > selectedNodes.length || summary.edgeCount > displayEdges.length,
      nodes: selectedNodes.map((node) => ({
        id: node.id,
        nodeKind: node.nodeKind,
        entityType: node.entityType,
        entityId: node.entityId,
        label: node.label,
        sourcePath: node.sourcePath,
        degree: selectedDegreeCounts.get(node.id) ?? 0,
        indexedAt: node.indexedAt
      })),
      edges: displayEdges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId ?? '',
        edgeKind: edge.edgeKind,
        targetLabel: edge.targetLabel,
        indexedAt: edge.indexedAt
      })),
      generatedAt: nowIso()
    };
  }

  public getWorkspaceGraphProjection(scopeVersionId = this.getActiveScope().id): WorkspaceGraphProjection {
    const summary = this.getProjectGraphSummary(scopeVersionId);
    const nodes = rows(
      this.db
        .prepare(
          `SELECT
             id,
             scope_version_id,
             node_kind,
             entity_type,
             entity_id,
             label,
             source_path,
             indexed_at
           FROM project_graph_nodes
           WHERE scope_version_id = ?
           ORDER BY
             CASE entity_type
               WHEN 'scope_version' THEN 0
               WHEN 'scope_asset' THEN 1
               WHEN 'run' THEN 2
               WHEN 'verifier_run' THEN 3
               WHEN 'verifier_contract' THEN 4
               WHEN 'artifact' THEN 5
               WHEN 'structure_entity' THEN 6
               WHEN 'inventory_item' THEN 7
               WHEN 'trace_event' THEN 8
               WHEN 'transcript' THEN 9
               ELSE 30
             END,
             label ASC,
             id ASC`
        )
        .all(scopeVersionId)
    ).map((row) => this.mapProjectGraphProjectionNode(row));
    const edges = rows(
      this.db
        .prepare(
          `SELECT
             id,
             scope_version_id,
             source_node_id,
             edge_kind,
             target_node_id,
             target_entity_type,
             target_entity_id,
             target_label,
             indexed_at
           FROM project_graph_edges
           WHERE scope_version_id = ?
           ORDER BY
             CASE edge_kind
               WHEN 'routes_to' THEN 0
               WHEN 'handles_with' THEN 1
               WHEN 'uses_middleware' THEN 2
               WHEN 'checks_permission' THEN 3
               WHEN 'reaches_sink' THEN 4
               WHEN 'parses_body' THEN 5
               WHEN 'serializes_response' THEN 6
               WHEN 'reads_model' THEN 7
               WHEN 'writes_model' THEN 8
               WHEN 'supports_hypothesis' THEN 9
               WHEN 'verifies_finding' THEN 10
               WHEN 'evidence_for' THEN 11
               WHEN 'calls' THEN 12
               WHEN 'imports_symbol' THEN 13
               WHEN 'exports_symbol' THEN 14
               WHEN 'references_permission' THEN 15
               WHEN 'references_url' THEN 16
               ELSE 30
             END,
             target_label ASC,
             id ASC`
        )
        .all(scopeVersionId)
    ).map((row) => this.mapProjectGraphProjectionEdge(row));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const degreeCounts = new Map<string, number>();
    const nodeFamilyCounts = new Map<string, number>();
    const edgeFamilyCounts = new Map<string, number>();
    const repositoryCounts = new Map<string, number>();
    const sourceGroupCounts = new Map<string, number>();
    const labelCounts = new Map<string, number>();
    const genericLabelCounts = new Map<string, number>();
    const qualityFlagCounts = new Map<string, number>();
    const clusterMap = new Map<string, WorkspaceGraphProjection['clusters'][number]>();
    const increment = (counts: Map<string, number>, key: string, amount = 1): void => {
      counts.set(key, (counts.get(key) ?? 0) + amount);
    };
    const ensureCluster = (
      id: string,
      kind: WorkspaceGraphProjection['clusters'][number]['kind'],
      label: string,
      parentId: string | null = null,
      qualityFlags: string[] = []
    ): WorkspaceGraphProjection['clusters'][number] => {
      const existing = clusterMap.get(id);
      if (existing) return existing;
      const cluster = { id, kind, label, nodeCount: 0, edgeCount: 0, qualityFlags, parentId };
      clusterMap.set(id, cluster);
      return cluster;
    };
    const bumpNodeCluster = (id: string, kind: WorkspaceGraphProjection['clusters'][number]['kind'], label: string, parentId: string | null = null, flags: string[] = []): void => {
      ensureCluster(id, kind, label, parentId, flags).nodeCount += 1;
    };
    const bumpEdgeCluster = (id: string, kind: WorkspaceGraphProjection['clusters'][number]['kind'], label: string, parentId: string | null = null, flags: string[] = []): void => {
      ensureCluster(id, kind, label, parentId, flags).edgeCount += 1;
    };
    const noteQuality = (flag: string): string => {
      increment(qualityFlagCounts, flag);
      return flag;
    };

    for (const node of nodes) {
      increment(nodeFamilyCounts, node.entityType);
      const normalizedLabel = normalizeProjectGraphLabel(node.label);
      increment(labelCounts, normalizedLabel || 'unknown');
      const repositoryLabel = projectGraphRepositoryLabel(node.sourcePath);
      if (repositoryLabel) increment(repositoryCounts, repositoryLabel);
      const sourceGroupLabel = projectGraphSourceGroupLabel(node.sourcePath);
      if (sourceGroupLabel) increment(sourceGroupCounts, sourceGroupLabel);
    }

    let resolvedEdgeCount = 0;
    let unresolvedEdgeCount = 0;
    let selfEdgeCount = 0;
    for (const edge of edges) {
      increment(edgeFamilyCounts, edge.edgeKind);
      const targetExists = Boolean(edge.targetNodeId && nodesById.has(edge.targetNodeId));
      if (!targetExists) {
        unresolvedEdgeCount += 1;
        continue;
      }
      resolvedEdgeCount += 1;
      increment(degreeCounts, edge.sourceNodeId);
      if (edge.targetNodeId !== edge.sourceNodeId) {
        increment(degreeCounts, edge.targetNodeId ?? '');
      } else {
        selfEdgeCount += 1;
      }
    }

    const repeatedLabelCounts = new Map([...labelCounts.entries()].filter(([, count]) => count > 1));
    const projectedNodes: WorkspaceGraphProjection['nodes'] = nodes.map((node) => {
      const qualityFlags: string[] = [];
      const normalizedLabel = normalizeProjectGraphLabel(node.label);
      const repeatedLabelCount = labelCounts.get(normalizedLabel || 'unknown') ?? 0;
      if (isProjectGraphGenericLabel(node.label)) {
        qualityFlags.push(noteQuality('generic_label'));
        increment(genericLabelCounts, normalizedLabel || 'unknown');
      }
      if (repeatedLabelCount > 1) qualityFlags.push(noteQuality('repeated_label'));
      if (isProjectGraphTestOrDocPath(node.sourcePath)) qualityFlags.push(noteQuality('test_or_doc_path'));

      const entityClusterId = projectGraphClusterId('entity_family', node.entityType);
      const clusterIds = [entityClusterId];
      bumpNodeCluster(entityClusterId, 'entity_family', node.entityType);

      const repositoryLabel = projectGraphRepositoryLabel(node.sourcePath);
      if (repositoryLabel) {
        const repositoryClusterId = projectGraphClusterId('repository', repositoryLabel);
        clusterIds.push(repositoryClusterId);
        bumpNodeCluster(repositoryClusterId, 'repository', repositoryLabel);
      }

      const sourceGroupLabel = projectGraphSourceGroupLabel(node.sourcePath);
      if (sourceGroupLabel) {
        const sourceGroupClusterId = projectGraphClusterId('source_group', sourceGroupLabel);
        clusterIds.push(sourceGroupClusterId);
        bumpNodeCluster(sourceGroupClusterId, 'source_group', sourceGroupLabel);
      }

      if (repeatedLabelCount >= 3) {
        const labelClusterId = projectGraphClusterId('repeated_label', normalizedLabel || 'unknown');
        clusterIds.push(labelClusterId);
        bumpNodeCluster(labelClusterId, 'repeated_label', node.label || 'Unknown', null, ['repeated_label']);
      }

      for (const flag of qualityFlags) {
        const qualityClusterId = projectGraphClusterId('quality', flag);
        clusterIds.push(qualityClusterId);
        bumpNodeCluster(qualityClusterId, 'quality', flag, null, [flag]);
      }

      return {
        id: node.id,
        nodeKind: node.nodeKind,
        entityType: node.entityType,
        entityId: node.entityId,
        label: node.label,
        sourcePath: node.sourcePath,
        degree: degreeCounts.get(node.id) ?? 0,
        indexedAt: node.indexedAt,
        clusterIds: [...new Set(clusterIds)],
        qualityFlags: [...new Set(qualityFlags)],
        pathLabel: projectGraphPathLabel(node.sourcePath),
        repositoryLabel,
        sourceGroupLabel
      };
    });

    const projectedEdges: WorkspaceGraphProjection['edges'] = edges.map((edge) => {
      const qualityFlags: string[] = [];
      if (!edge.targetNodeId || !nodesById.has(edge.targetNodeId)) qualityFlags.push(noteQuality('unresolved_target'));
      if (edge.targetNodeId && edge.targetNodeId === edge.sourceNodeId) qualityFlags.push(noteQuality('self_relation'));
      if (isProjectGraphGenericLabel(edge.targetLabel)) qualityFlags.push(noteQuality('generic_target_label'));
      const familyClusterId = projectGraphClusterId('relationship_family', edge.edgeKind);
      const clusterIds = [familyClusterId];
      bumpEdgeCluster(familyClusterId, 'relationship_family', edge.edgeKind);
      const normalizedTargetLabel = normalizeProjectGraphLabel(edge.targetLabel);
      if ((labelCounts.get(normalizedTargetLabel) ?? 0) >= 3) {
        const repeatedClusterId = projectGraphClusterId('repeated_label', normalizedTargetLabel || 'unknown');
        clusterIds.push(repeatedClusterId);
        bumpEdgeCluster(repeatedClusterId, 'repeated_label', edge.targetLabel || 'Unknown', null, ['repeated_label']);
      }
      for (const flag of qualityFlags) {
        const qualityClusterId = projectGraphClusterId('quality', flag);
        clusterIds.push(qualityClusterId);
        bumpEdgeCluster(qualityClusterId, 'quality', flag, null, [flag]);
      }
      return {
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        edgeKind: edge.edgeKind,
        targetEntityType: edge.targetEntityType,
        targetEntityId: edge.targetEntityId,
        targetLabel: edge.targetLabel,
        clusterIds: [...new Set(clusterIds)],
        qualityFlags: [...new Set(qualityFlags)],
        indexedAt: edge.indexedAt
      };
    });

    return {
      scopeVersionId,
      status: summary.status,
      nodes: projectedNodes,
      edges: projectedEdges,
      clusters: [...clusterMap.values()].sort((left, right) => right.nodeCount + right.edgeCount - (left.nodeCount + left.edgeCount) || left.label.localeCompare(right.label)),
      diagnostics: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        resolvedEdgeCount,
        unresolvedEdgeCount,
        selfEdgeCount,
        genericLabelNodeCount: projectedNodes.filter((node) => node.qualityFlags.includes('generic_label')).length,
        repeatedLabelNodeCount: projectedNodes.filter((node) => node.qualityFlags.includes('repeated_label')).length,
        testOrDocNodeCount: projectedNodes.filter((node) => node.qualityFlags.includes('test_or_doc_path')).length,
        nodeFamilyCounts: topProjectGraphCounts(nodeFamilyCounts, 100),
        edgeFamilyCounts: topProjectGraphCounts(edgeFamilyCounts, 100),
        repositoryCounts: topProjectGraphCounts(repositoryCounts, 100),
        sourceGroupCounts: topProjectGraphCounts(sourceGroupCounts, 100),
        genericLabelCounts: topProjectGraphCounts(genericLabelCounts, 24),
        repeatedLabelCounts: topProjectGraphCounts(repeatedLabelCounts, 24),
        qualityFlagCounts: topProjectGraphCounts(qualityFlagCounts, 24)
      },
      generatedAt: nowIso()
    };
  }

  public refreshProjectGraph(scopeVersionId = this.getActiveScope().id, indexedAt = nowIso(), reason = 'manual_refresh'): ProjectGraphSummary {
    void indexedAt;
    void reason;
    return this.getProjectGraphSummary(scopeVersionId);
  }

  private refreshProjectGraphForRun(runId: string): void {
    const run = this.getRun(runId);
    if (run) {
      // Graph freshness is derived from source-table counts. Avoid rebuilding on hot trace/resource writes;
      // graph query APIs rebuild lazily when graph context is actually requested.
    }
  }

  private ensureProjectGraphFresh(scopeVersionId: string): ProjectGraphSummary {
    return this.getProjectGraphSummary(scopeVersionId);
  }

  private projectGraphExpectedNodeFamilyCounts(scopeVersionId: string): Record<string, number> {
    const count = (sql: string, ...params: SqlPrimitive[]) => {
      const row = rowOrUndefined(this.db.prepare(sql).get(...params));
      return row ? numberValue(row, 'count') : 0;
    };
    const lineageRunSql = this.scopeVersionLineagePredicate('scope_version_id');
    const joinedLineageRunSql = this.scopeVersionLineagePredicate('r.scope_version_id');
    const families: Record<string, number> = {
      scope_version: 1,
      scope_asset: count('SELECT COUNT(*) AS count FROM scope_assets WHERE scope_version_id = ?', scopeVersionId),
      inventory_item: count('SELECT COUNT(*) AS count FROM project_inventory_items WHERE scope_version_id = ?', scopeVersionId),
      structure_entity: count('SELECT COUNT(*) AS count FROM project_structure_entities WHERE scope_version_id = ?', scopeVersionId),
      run: count(`SELECT COUNT(*) AS count FROM runs WHERE ${lineageRunSql}`, scopeVersionId),
      trace_event: count(`SELECT COUNT(*) AS count FROM trace_events WHERE run_id IN (SELECT id FROM runs WHERE ${lineageRunSql})`, scopeVersionId),
      transcript: count(`SELECT COUNT(*) AS count FROM transcript_messages WHERE run_id IN (SELECT id FROM runs WHERE ${lineageRunSql})`, scopeVersionId),
      artifact: count(
        `SELECT COUNT(DISTINCT a.id) AS count
         FROM artifacts a
         JOIN trace_events t ON t.artifact_id = a.id
         JOIN runs r ON r.id = t.run_id
         WHERE ${joinedLineageRunSql}`,
        scopeVersionId
      ),
      verifier_contract: count(`SELECT COUNT(*) AS count FROM verifier_contracts WHERE run_id IN (SELECT id FROM runs WHERE ${lineageRunSql})`, scopeVersionId),
      verifier_run: count(`SELECT COUNT(*) AS count FROM verifier_runs WHERE run_id IN (SELECT id FROM runs WHERE ${lineageRunSql})`, scopeVersionId)
    };
    return Object.fromEntries(Object.entries(families).filter(([, value]) => value > 0));
  }

  private projectGraphActualNodeFamilyCounts(scopeVersionId: string): Record<string, number> {
    return Object.fromEntries(
      rows(
        this.db
          .prepare(
            `SELECT entity_type, COUNT(*) AS count
             FROM project_graph_nodes
             WHERE scope_version_id = ?
             GROUP BY entity_type
             ORDER BY entity_type ASC`
          )
          .all(scopeVersionId)
      ).map((row) => [text(row, 'entity_type'), numberValue(row, 'count')])
    );
  }

  private projectGraphActualEdgeFamilyCounts(scopeVersionId: string): Record<string, number> {
    return Object.fromEntries(
      rows(
        this.db
          .prepare(
            `SELECT edge_kind, COUNT(*) AS count
             FROM project_graph_edges
             WHERE scope_version_id = ?
             GROUP BY edge_kind
             ORDER BY edge_kind ASC`
          )
          .all(scopeVersionId)
      ).map((row) => [text(row, 'edge_kind'), numberValue(row, 'count')])
    );
  }

  private projectGraphExtractionFamilyCounts(scopeVersionId: string): Record<string, number> {
    return Object.fromEntries(
      rows(
        this.db
          .prepare(
            `SELECT json_extract(metadata_json, '$.extractionFamily') AS extraction_family, COUNT(*) AS count
             FROM project_structure_entities
             WHERE scope_version_id = ?
               AND json_extract(metadata_json, '$.extractionFamily') IS NOT NULL
               AND TRIM(json_extract(metadata_json, '$.extractionFamily')) <> ''
             GROUP BY extraction_family
             ORDER BY extraction_family ASC`
          )
          .all(scopeVersionId)
      ).map((row) => [text(row, 'extraction_family'), numberValue(row, 'count')])
    );
  }

  private projectGraphStaleReasons(expectedNodeFamilyCounts: Record<string, number>, actualNodeFamilyCounts: Record<string, number>): string[] {
    const reasons: string[] = [];
    for (const [family, expectedCount] of Object.entries(expectedNodeFamilyCounts)) {
      const actualCount = actualNodeFamilyCounts[family] ?? 0;
      if (actualCount < expectedCount) reasons.push(`missing_node_family:${family}:${actualCount}/${expectedCount}`);
    }
    return reasons;
  }

  private recordProjectGraphStatus(
    scopeVersionId: string,
    input: {
      rebuildReason: string | null;
      indexedAt: string | null;
      durationMs: number | null;
      incrementBuildCount: boolean;
      expectedNodeCount?: number;
      actualNodeCount?: number;
      actualEdgeCount?: number;
      staleReasons?: string[];
      nodeFamilyCounts?: Record<string, number>;
      edgeFamilyCounts?: Record<string, number>;
    }
  ): void {
    this.db.exec(PROJECT_GRAPH_STATUS_SCHEMA_SQL);
    const expectedNodeFamilyCounts = this.projectGraphExpectedNodeFamilyCounts(scopeVersionId);
    const nodeFamilyCounts = input.nodeFamilyCounts ?? this.projectGraphActualNodeFamilyCounts(scopeVersionId);
    const edgeFamilyCounts = input.edgeFamilyCounts ?? this.projectGraphActualEdgeFamilyCounts(scopeVersionId);
    const staleReasons = input.staleReasons ?? this.projectGraphStaleReasons(expectedNodeFamilyCounts, nodeFamilyCounts);
    const expectedNodeCount = input.expectedNodeCount ?? Object.values(expectedNodeFamilyCounts).reduce((sum, count) => sum + count, 0);
    const actualNodeCount = input.actualNodeCount ?? Object.values(nodeFamilyCounts).reduce((sum, count) => sum + count, 0);
    const actualEdgeCount = input.actualEdgeCount ?? Object.values(edgeFamilyCounts).reduce((sum, count) => sum + count, 0);
    const existing = rowOrUndefined(this.db.prepare('SELECT build_count, last_rebuild_reason, last_rebuild_duration_ms FROM project_graph_status WHERE scope_version_id = ?').get(scopeVersionId));
    const buildCount = (existing ? numberValue(existing, 'build_count') : 0) + (input.incrementBuildCount ? 1 : 0);
    this.db
      .prepare(
        `INSERT INTO project_graph_status (
          scope_version_id, build_count, last_rebuild_reason, stale_reasons_json,
          node_family_counts_json, edge_family_counts_json, expected_node_count,
          actual_node_count, actual_edge_count, last_rebuild_duration_ms, indexed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_version_id)
        DO UPDATE SET
          build_count = excluded.build_count,
          last_rebuild_reason = excluded.last_rebuild_reason,
          stale_reasons_json = excluded.stale_reasons_json,
          node_family_counts_json = excluded.node_family_counts_json,
          edge_family_counts_json = excluded.edge_family_counts_json,
          expected_node_count = excluded.expected_node_count,
          actual_node_count = excluded.actual_node_count,
          actual_edge_count = excluded.actual_edge_count,
          last_rebuild_duration_ms = excluded.last_rebuild_duration_ms,
          indexed_at = excluded.indexed_at,
          updated_at = excluded.updated_at`
      )
      .run(
        scopeVersionId,
        buildCount,
        input.rebuildReason ?? nullableText(existing ?? {}, 'last_rebuild_reason'),
        toJson(staleReasons),
        toJson(nodeFamilyCounts),
        toJson(edgeFamilyCounts),
        expectedNodeCount,
        actualNodeCount,
        actualEdgeCount,
        input.durationMs ?? nullableNumber(existing ?? {}, 'last_rebuild_duration_ms'),
        input.indexedAt,
        nowIso()
      );
  }

  public findProjectGraphNodes(
    scopeVersionId: string,
    query: string,
    filters: { entityType?: string; nodeKind?: string; limit?: number; refresh?: boolean } = {}
  ): ProjectGraphNodeRecord[] {
    if (filters.refresh !== false) this.ensureProjectGraphFresh(scopeVersionId);
    const trimmed = query.trim().toLowerCase();
    const conditions = ['scope_version_id = ?'];
    const params: SqlPrimitive[] = [scopeVersionId];
    if (filters.entityType) {
      conditions.push('entity_type = ?');
      params.push(filters.entityType);
    }
    if (filters.nodeKind) {
      conditions.push('node_kind = ?');
      params.push(filters.nodeKind);
    }
    if (trimmed) {
      conditions.push("(LOWER(label || ' ' || node_kind || ' ' || entity_type || ' ' || entity_id || ' ' || COALESCE(source_path, '') || ' ' || metadata_json) LIKE ? ESCAPE '\\')");
      params.push(`%${escapeLike(trimmed)}%`);
    }
    const limit = Math.max(1, Math.min(100, Math.floor(filters.limit ?? 20)));
    return rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_graph_nodes
           WHERE ${conditions.join(' AND ')}
           ORDER BY indexed_at DESC, node_kind ASC, label ASC
           LIMIT ?`
        )
        .all(...params, limit)
    ).map((row) => this.mapProjectGraphNode(row));
  }

  public listProjectGraphEdgesForNode(scopeVersionId: string, nodeId: string, options: { edgeKinds?: string[]; limit?: number; refresh?: boolean } = {}): ProjectGraphEdgeRecord[] {
    if (options.refresh !== false) this.ensureProjectGraphFresh(scopeVersionId);
    const edgeKinds = (options.edgeKinds ?? []).map((kind) => kind.trim()).filter(Boolean);
    const params: SqlPrimitive[] = [scopeVersionId, nodeId, nodeId];
    const edgeKindSql = edgeKinds.length > 0 ? ` AND edge_kind IN (${edgeKinds.map(() => '?').join(', ')})` : '';
    params.push(...edgeKinds);
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 40)));
    return rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_graph_edges
           WHERE scope_version_id = ?
             AND (source_node_id = ? OR target_node_id = ?)
             ${edgeKindSql}
           ORDER BY edge_kind ASC, target_label ASC
           LIMIT ?`
        )
        .all(...params, limit)
    ).map((row) => this.mapProjectGraphEdge(row));
  }

  public listProjectGraphVariantNodesForNode(scopeVersionId: string, nodeId: string, options: { edgeKinds?: string[]; limit?: number; refresh?: boolean } = {}): ProjectGraphVariantRecord[] {
    if (options.refresh !== false) this.ensureProjectGraphFresh(scopeVersionId);
    const edgeKinds = (options.edgeKinds ?? []).map((kind) => kind.trim()).filter(Boolean);
    if (edgeKinds.length === 0) return [];
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 24)));
    const records: ProjectGraphVariantRecord[] = [];
    const seen = new Set<string>();
    const seedEdges = this.listProjectGraphEdgesForNode(scopeVersionId, nodeId, { edgeKinds, limit: Math.min(100, limit * 4), refresh: false });
    for (const seed of seedEdges) {
      if (records.length >= limit) break;
      const remaining = limit - records.length;
      const targetPredicate = seed.targetNodeId
        ? 'e.target_node_id = ?'
        : "e.target_node_id IS NULL AND e.target_entity_type = ? AND LOWER(e.target_label) = LOWER(?)";
      const targetParams: SqlPrimitive[] = seed.targetNodeId ? [seed.targetNodeId] : [seed.targetEntityType, seed.targetLabel];
      const resultRows = rows(
        this.db
          .prepare(
            `SELECT n.*, e.id AS variant_edge_id, e.scope_version_id AS variant_edge_scope_version_id,
                    e.source_node_id AS variant_edge_source_node_id, e.edge_kind AS variant_edge_kind,
                    e.target_node_id AS variant_edge_target_node_id, e.target_entity_type AS variant_edge_target_entity_type,
                    e.target_entity_id AS variant_edge_target_entity_id, e.target_label AS variant_edge_target_label,
                    e.metadata_json AS variant_edge_metadata_json, e.indexed_at AS variant_edge_indexed_at
             FROM project_graph_edges e
             JOIN project_graph_nodes n ON n.scope_version_id = e.scope_version_id
              AND n.id = e.source_node_id
             WHERE e.scope_version_id = ?
               AND e.edge_kind = ?
               AND e.id <> ?
               AND e.source_node_id <> ?
               AND ${targetPredicate}
             ORDER BY
               CASE e.edge_kind
                 WHEN 'reaches_sink' THEN 0
                 WHEN 'checks_permission' THEN 1
                 WHEN 'routes_to' THEN 2
                 WHEN 'handles_with' THEN 3
                 WHEN 'uses_middleware' THEN 4
                 WHEN 'calls' THEN 5
                 WHEN 'supports_hypothesis' THEN 6
                 WHEN 'verifies_finding' THEN 7
                 WHEN 'imports_symbol' THEN 8
                 WHEN 'exports_symbol' THEN 9
                 WHEN 'references_permission' THEN 10
                 WHEN 'references_url' THEN 11
                 WHEN 'contains_string' THEN 12
                 ELSE 13
               END,
               n.node_kind ASC,
               n.label ASC
             LIMIT ?`
          )
          .all(scopeVersionId, seed.edgeKind, seed.id, seed.sourceNodeId, ...targetParams, remaining)
      );
      for (const row of resultRows) {
        if (records.length >= limit) break;
        const key = text(row, 'variant_edge_id');
        if (seen.has(key)) continue;
        seen.add(key);
        records.push({
          node: this.mapProjectGraphNode(row),
          edge: this.mapProjectGraphEdge({
            id: row.variant_edge_id,
            scope_version_id: row.variant_edge_scope_version_id,
            source_node_id: row.variant_edge_source_node_id,
            edge_kind: row.variant_edge_kind,
            target_node_id: row.variant_edge_target_node_id,
            target_entity_type: row.variant_edge_target_entity_type,
            target_entity_id: row.variant_edge_target_entity_id,
            target_label: row.variant_edge_target_label,
            metadata_json: row.variant_edge_metadata_json,
            indexed_at: row.variant_edge_indexed_at
          })
        });
      }
    }
    return records;
  }

  public getProjectGraphNeighborhood(
    scopeVersionId: string,
    entityType: string,
    entityId: string,
    options: { depth?: number; edgeKinds?: string[]; limit?: number; refresh?: boolean } = {}
  ): ProjectGraphNeighborhood {
    if (options.refresh !== false) this.ensureProjectGraphFresh(scopeVersionId);
    const root = this.getProjectGraphNode(scopeVersionId, entityType, entityId);
    if (!root) return { status: 'miss', root: null, depth: 0, nodes: [], edges: [] };
    const maxDepth = Math.max(1, Math.min(3, Math.floor(options.depth ?? 1)));
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 40)));
    const nodeMap = new Map<string, ProjectGraphNodeRecord>([[root.id, root]]);
    const edgeMap = new Map<string, ProjectGraphEdgeRecord>();
    let frontier = [root.id];
    for (let depth = 0; depth < maxDepth && frontier.length > 0 && edgeMap.size < limit; depth += 1) {
      const next = new Set<string>();
      for (const nodeId of frontier) {
        for (const edge of this.listProjectGraphEdgesForNode(scopeVersionId, nodeId, { edgeKinds: options.edgeKinds, limit, refresh: false })) {
          if (edgeMap.size >= limit) break;
          edgeMap.set(edge.id, edge);
          for (const adjacentId of [edge.sourceNodeId, edge.targetNodeId].filter((id): id is string => Boolean(id))) {
            if (nodeMap.has(adjacentId)) continue;
            const adjacent = this.getProjectGraphNodeById(scopeVersionId, adjacentId);
            if (!adjacent) continue;
            nodeMap.set(adjacent.id, adjacent);
            next.add(adjacent.id);
          }
        }
      }
      frontier = [...next];
    }
    return { status: 'hit', root, depth: maxDepth, nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
  }

  public findProjectStructureEntity(scopeVersionId: string, path: string, name: string, options: { refreshInventory?: boolean } = {}): ProjectStructureEntityRecord | null {
    if (options.refreshInventory !== false) {
      this.ensureProjectInventory(scopeVersionId);
    }
    const normalizedName = name.trim();
    if (!normalizedName) return null;
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT *
           FROM project_structure_entities
           WHERE scope_version_id = ?
             AND path = ?
             AND LOWER(name) = LOWER(?)
           ORDER BY
             CASE entity_kind
               WHEN 'function' THEN 0
               WHEN 'method' THEN 0
               WHEN 'class' THEN 1
               WHEN 'type' THEN 1
               WHEN 'route' THEN 2
               WHEN 'export' THEN 3
               ELSE 4
             END,
             line_start ASC
           LIMIT 1`
        )
        .get(scopeVersionId, path, normalizedName)
    );
    return row ? this.mapProjectStructureEntity(row) : null;
  }

  public findProjectStructureEntityContainingLine(scopeVersionId: string, path: string, line: number, options: { refreshInventory?: boolean } = {}): ProjectStructureEntityRecord | null {
    if (options.refreshInventory !== false) {
      this.ensureProjectInventory(scopeVersionId);
    }
    const lineNumber = Math.max(1, Math.floor(line));
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT *
           FROM project_structure_entities
           WHERE scope_version_id = ?
             AND path = ?
             AND line_start <= ?
             AND line_end >= ?
           ORDER BY
             CASE entity_kind
               WHEN 'function' THEN 0
               WHEN 'method' THEN 0
               WHEN 'route' THEN 1
               WHEN 'class' THEN 2
               WHEN 'type' THEN 2
               ELSE 3
             END,
             (line_end - line_start) ASC,
             line_start DESC
           LIMIT 1`
        )
        .get(scopeVersionId, path, lineNumber, lineNumber)
    );
    return row ? this.mapProjectStructureEntity(row) : null;
  }

  public listProjectStructureEntitiesInRange(
    scopeVersionId: string,
    path: string,
    lineStart: number,
    lineEnd: number,
    limit = 40,
    options: { refreshInventory?: boolean } = {}
  ): ProjectStructureEntityRecord[] {
    if (options.refreshInventory !== false) {
      this.ensureProjectInventory(scopeVersionId);
    }
    const start = Math.max(1, Math.floor(lineStart));
    const end = Math.max(start, Math.floor(lineEnd));
    return rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_structure_entities
           WHERE scope_version_id = ?
             AND path = ?
             AND line_start >= ?
             AND line_start <= ?
           ORDER BY line_start ASC, entity_kind ASC, name ASC
           LIMIT ?`
        )
        .all(scopeVersionId, path, start, end, Math.max(1, Math.floor(limit)))
    ).map((row) => this.mapProjectStructureEntity(row));
  }

  public listProjectStructureRelationsForEntity(
    scopeVersionId: string,
    entityId: string,
    limit = 40,
    options: { refreshInventory?: boolean } = {}
  ): ProjectStructureRelationRecord[] {
    if (options.refreshInventory !== false) {
      this.ensureProjectInventory(scopeVersionId);
    }
    return rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_structure_relations
           WHERE scope_version_id = ?
             AND source_entity_id = ?
           ORDER BY relation_kind ASC, target_kind ASC, target_name ASC
           LIMIT ?`
        )
        .all(scopeVersionId, entityId, Math.max(1, Math.floor(limit)))
    ).map((row) => this.mapProjectStructureRelation(row));
  }

  public listProjectStructureReferencesForTarget(
    scopeVersionId: string,
    target: { name: string; entityId?: string | null },
    limit = 40,
    options: { refreshInventory?: boolean } = {}
  ): ProjectStructureRelationRecord[] {
    if (options.refreshInventory !== false) {
      this.ensureProjectInventory(scopeVersionId);
    }
    const normalizedName = target.name.trim();
    if (!normalizedName && !target.entityId) return [];
    const clauses: string[] = [];
    const params: SqlPrimitive[] = [scopeVersionId];
    if (target.entityId) {
      clauses.push('target_entity_id = ?');
      params.push(target.entityId);
    }
    if (normalizedName) {
      clauses.push('LOWER(target_name) = LOWER(?)');
      params.push(normalizedName);
    }
    return rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_structure_relations
           WHERE scope_version_id = ?
             AND (${clauses.join(' OR ')})
           ORDER BY indexed_at DESC, relation_kind ASC, target_name ASC
           LIMIT ?`
        )
        .all(...params, Math.max(1, Math.floor(limit)))
    ).map((row) => this.mapProjectStructureRelation(row));
  }

  public getProjectSemanticIndexEnabled(scopeVersionId = this.getActiveScope().id): boolean {
    void scopeVersionId;
    return false;
  }

  public setProjectSemanticIndexEnabled(
    enabled: boolean,
    scopeVersionId = this.getActiveScope().id,
    options: { refresh?: boolean } = {}
  ): ProjectSemanticSummary {
    this.setMetaValue(projectSemanticEnabledMetaKey(scopeVersionId), enabled ? '1' : '0');
    if (enabled && options.refresh !== false) {
      return this.refreshProjectSemanticIndex(scopeVersionId, { reason: 'enabled' });
    }
    if (!enabled) {
      this.clearProjectSemanticJobState(scopeVersionId);
      this.clearProjectSemanticDirtyState(scopeVersionId);
    }
    return this.getProjectSemanticSummary(scopeVersionId);
  }

  public queueProjectSemanticIndex(scopeVersionId = this.getActiveScope().id, reason = 'manual_rebuild'): ProjectSemanticSummary {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) return this.getProjectSemanticSummary(scopeVersionId);
    const now = nowIso();
    this.setProjectSemanticJobState(scopeVersionId, {
      status: 'queued',
      reason,
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
      processed: null,
      total: null
    });
    return this.getProjectSemanticSummary(scopeVersionId);
  }

  public markProjectSemanticIndexingStarted(scopeVersionId = this.getActiveScope().id, reason = 'background_rebuild'): ProjectSemanticSummary {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) return this.getProjectSemanticSummary(scopeVersionId);
    const existing = this.getProjectSemanticJobState(scopeVersionId);
    const now = nowIso();
    this.setProjectSemanticJobState(scopeVersionId, {
      status: 'indexing',
      reason: existing?.reason ?? reason,
      queuedAt: existing?.queuedAt ?? now,
      startedAt: now,
      finishedAt: null,
      error: null,
      processed: existing?.processed ?? 0,
      total: existing?.total ?? null
    });
    return this.getProjectSemanticSummary(scopeVersionId);
  }

  public markProjectSemanticIndexingFailed(scopeVersionId = this.getActiveScope().id, error: unknown, reason = 'background_rebuild'): ProjectSemanticSummary {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) return this.getProjectSemanticSummary(scopeVersionId);
    const existing = this.getProjectSemanticJobState(scopeVersionId);
    this.setProjectSemanticJobState(scopeVersionId, {
      status: 'error',
      reason: existing?.reason ?? reason,
      queuedAt: existing?.queuedAt ?? null,
      startedAt: existing?.startedAt ?? null,
      finishedAt: nowIso(),
      error: error instanceof Error ? error.message : String(error),
      processed: existing?.processed ?? null,
      total: existing?.total ?? null
    });
    return this.getProjectSemanticSummary(scopeVersionId);
  }

  public markProjectSemanticIndexingCanceled(scopeVersionId = this.getActiveScope().id, reason = 'disabled'): ProjectSemanticSummary {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) {
      this.clearProjectSemanticJobState(scopeVersionId);
      return this.getProjectSemanticSummary(scopeVersionId);
    }
    const existing = this.getProjectSemanticJobState(scopeVersionId);
    this.setProjectSemanticJobState(scopeVersionId, {
      status: 'canceled',
      reason,
      queuedAt: existing?.queuedAt ?? null,
      startedAt: existing?.startedAt ?? null,
      finishedAt: nowIso(),
      error: null,
      processed: existing?.processed ?? null,
      total: existing?.total ?? null
    });
    return this.getProjectSemanticSummary(scopeVersionId);
  }

  public getProjectSemanticAutoRefreshReason(scopeVersionId = this.getActiveScope().id, fallbackReason = 'auto_refresh'): string | null {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) return null;
    const job = this.getProjectSemanticJobState(scopeVersionId);
    if (job?.status === 'queued' || job?.status === 'indexing' || job?.status === 'error') return null;
    if (job?.status === 'canceled') return job.reason || fallbackReason;
    const dirty = this.getProjectSemanticDirtyState(scopeVersionId);
    if (dirty) return dirty.reason;
    const summary = this.getProjectSemanticSummary(scopeVersionId);
    if (summary.status === 'empty' || summary.status === 'stale') return fallbackReason;
    return null;
  }

  public beginProjectSemanticIndexRefresh(
    scopeVersionId = this.getActiveScope().id,
    reason = 'background_rebuild'
  ): { indexedAt: string; sourceDocumentCount: number; startedAtMs: number } {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) {
      return { indexedAt: nowIso(), sourceDocumentCount: 0, startedAtMs: Date.now() };
    }
    const existing = this.getProjectSemanticJobState(scopeVersionId);
    const now = nowIso();
    const sourceRow = rowOrUndefined(this.db.prepare('SELECT COUNT(*) AS source_document_count FROM project_search_documents WHERE scope_version_id = ?').get(scopeVersionId));
    const sourceDocumentCount = sourceRow ? numberValue(sourceRow, 'source_document_count') : 0;
    this.setProjectSemanticJobState(scopeVersionId, {
      status: 'indexing',
      reason: existing?.reason ?? reason,
      queuedAt: existing?.queuedAt ?? now,
      startedAt: now,
      finishedAt: null,
      error: null,
      processed: 0,
      total: sourceDocumentCount
    });
    return { indexedAt: now, sourceDocumentCount, startedAtMs: Date.now() };
  }

  public listProjectSemanticSourceDocuments(scopeVersionId = this.getActiveScope().id, limit = 25, offset = 0): ProjectSearchDocumentRecord[] {
    return rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_search_documents
           WHERE scope_version_id = ?
           ORDER BY updated_at DESC, entity_type ASC, entity_id ASC
           LIMIT ? OFFSET ?`
        )
        .all(scopeVersionId, Math.max(1, Math.floor(limit)), Math.max(0, Math.floor(offset)))
    ).map((row) => this.mapProjectSearchDocument(row));
  }

  public indexProjectSemanticSourceDocuments(
    scopeVersionId: string,
    documents: ProjectSearchDocumentRecord[],
    indexedAt: string,
    processedCount: number,
    totalCount: number
  ): { processedCount: number; chunkCount: number } {
    const sourceTextCache = new Map<string, ProjectSemanticDirectSourceText | null>();
    const preparedDocuments = documents.map((document) => ({
      document,
      chunks: semanticChunksForDocument(document, indexedAt, sourceTextCache)
    }));
    const chunkCount = preparedDocuments.reduce((total, prepared) => total + prepared.chunks.length, 0);
    this.transaction(() => {
      const deleteChunks = this.db.prepare('DELETE FROM project_semantic_chunks WHERE scope_version_id = ? AND source_document_id = ?');
      for (const { document, chunks } of preparedDocuments) {
        deleteChunks.run(scopeVersionId, document.id);
        for (const chunk of chunks) {
          this.insertProjectSemanticChunk(chunk);
        }
      }
    });
    this.updateProjectSemanticIndexProgress(scopeVersionId, processedCount, totalCount);
    return { processedCount, chunkCount };
  }

  public finishProjectSemanticIndexRefresh(scopeVersionId: string, indexedAt: string, startedAtMs: number, sourceDocumentCount: number): ProjectSemanticSummary {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) return this.getProjectSemanticSummary(scopeVersionId);
    this.db
      .prepare(
        `DELETE FROM project_semantic_chunks
         WHERE scope_version_id = ?
           AND indexed_at <> ?`
      )
      .run(scopeVersionId, indexedAt);
    this.clearProjectSemanticDirtyState(scopeVersionId, indexedAt);
    this.clearProjectSemanticJobState(scopeVersionId);
    const refreshed = this.getProjectSemanticSummary(scopeVersionId);
    this.setMetaValue(
      projectSemanticRefreshMetaKey(scopeVersionId),
      JSON.stringify({
        indexedAt,
        durationMs: Date.now() - startedAtMs,
        sourceDocumentCount,
        chunkCount: refreshed.chunkCount,
        indexSizeBytes: refreshed.indexSizeBytes
      }),
      nowIso()
    );
    return this.getProjectSemanticSummary(scopeVersionId);
  }

  public getProjectSemanticSummary(scopeVersionId = this.getActiveScope().id): ProjectSemanticSummary {
    const enabled = this.getProjectSemanticIndexEnabled(scopeVersionId);
    const rowsByNamespace = rows(
      this.db
        .prepare(
          `SELECT namespace, COUNT(*) AS count
           FROM project_semantic_chunks
           WHERE scope_version_id = ?
           GROUP BY namespace
           ORDER BY namespace ASC`
        )
        .all(scopeVersionId)
    );
    const namespaceCounts: Record<string, number> = {};
    let chunkCount = 0;
    for (const row of rowsByNamespace) {
      const count = numberValue(row, 'count');
      namespaceCounts[text(row, 'namespace')] = count;
      chunkCount += count;
    }
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT
             SUM(CASE WHEN vector_json <> '{}' THEN 1 ELSE 0 END) AS embedded_chunk_count,
             COUNT(DISTINCT source_document_id) AS indexed_source_document_count,
             SUM(LENGTH(title) + LENGTH(content) + LENGTH(vector_json) + LENGTH(metadata_json)) AS index_size_bytes,
             MAX(indexed_at) AS indexed_at
           FROM project_semantic_chunks
           WHERE scope_version_id = ?`
        )
        .get(scopeVersionId)
    );
    const sourceRow = rowOrUndefined(this.db.prepare('SELECT COUNT(*) AS source_document_count FROM project_search_documents WHERE scope_version_id = ?').get(scopeVersionId));
    const lastRefresh = this.getProjectSemanticLastRefreshState(scopeVersionId);
    const chunkIndexedAt = row ? nullableText(row, 'indexed_at') : null;
    const indexedAt = chunkIndexedAt ?? lastRefresh?.indexedAt ?? null;
    const sourceDocumentCount = sourceRow ? numberValue(sourceRow, 'source_document_count') : 0;
    const chunkIndexedSourceDocumentCount = row ? numberValue(row, 'indexed_source_document_count') : 0;
    const indexedSourceDocumentCount =
      lastRefresh?.indexedAt === indexedAt
        ? Math.max(chunkIndexedSourceDocumentCount, Math.min(lastRefresh.sourceDocumentCount, sourceDocumentCount))
        : chunkIndexedSourceDocumentCount;
    const stale = enabled && chunkCount > 0 && (indexedSourceDocumentCount !== sourceDocumentCount || this.projectSemanticIndexLooksStale(scopeVersionId, indexedAt));
    const job = this.getProjectSemanticJobState(scopeVersionId);
    const derivedStatus: ProjectSemanticSummary['status'] = !enabled ? 'disabled' : stale ? 'stale' : chunkCount > 0 ? 'ready' : 'empty';
    const status: ProjectSemanticSummary['status'] = enabled && job ? job.status : derivedStatus;
    return {
      scopeVersionId,
      enabled,
      status,
      provider: PROJECT_SEMANTIC_VECTOR_PROVIDER,
      model: PROJECT_SEMANTIC_VECTOR_MODEL,
      remoteEmbeddingEnabled: false,
      chunkCount,
      embeddedChunkCount: row ? numberValue(row, 'embedded_chunk_count') : 0,
      sourceDocumentCount,
      indexedSourceDocumentCount,
      indexSizeBytes: row ? numberValue(row, 'index_size_bytes') : 0,
      lastRefreshDurationMs: lastRefresh?.durationMs ?? null,
      namespaceCounts,
      indexedAt,
      queuedAt: job?.queuedAt ?? null,
      startedAt: job?.startedAt ?? null,
      finishedAt: job?.finishedAt ?? null,
      jobReason: job?.reason ?? null,
      lastError: job?.error ?? null,
      progressProcessed: job?.processed ?? null,
      progressTotal: job?.total ?? null
    };
  }

  public ensureProjectSemanticIndex(scopeVersionId = this.getActiveScope().id): ProjectSemanticSummary {
    const summary = this.getProjectSemanticSummary(scopeVersionId);
    if (!summary.enabled) return summary;
    if (summary.chunkCount === 0 || this.projectSemanticIndexLooksStale(scopeVersionId, summary.indexedAt)) {
      return this.refreshProjectSemanticIndex(scopeVersionId);
    }
    return summary;
  }

  public refreshProjectSemanticIndex(scopeVersionId = this.getActiveScope().id, options: { refreshInventory?: boolean; reason?: string } = {}): ProjectSemanticSummary {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) return this.getProjectSemanticSummary(scopeVersionId);
    if (options.refreshInventory !== false) {
      this.ensureProjectInventory(scopeVersionId);
    }
    const refresh = this.beginProjectSemanticIndexRefresh(scopeVersionId, options.reason ?? 'manual_rebuild');
    let processed = 0;
    try {
      while (processed < refresh.sourceDocumentCount) {
        const documents = this.listProjectSemanticSourceDocuments(scopeVersionId, 100, processed);
        if (documents.length === 0) break;
        processed += documents.length;
        this.indexProjectSemanticSourceDocuments(scopeVersionId, documents, refresh.indexedAt, processed, refresh.sourceDocumentCount);
      }
      return this.finishProjectSemanticIndexRefresh(scopeVersionId, refresh.indexedAt, refresh.startedAtMs, refresh.sourceDocumentCount);
    } catch (error) {
      this.markProjectSemanticIndexingFailed(scopeVersionId, error, options.reason ?? 'manual_rebuild');
      throw error;
    }
  }

  public searchProjectSemanticChunksForRun(runId: string, query: string, limit = 8, options: { refreshIndex?: boolean; scopeVersionId?: string } = {}): ProjectSemanticSearchResult[] {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const scopeVersionId = options.scopeVersionId ?? run.scopeVersionId;
    const trimmed = query.trim();
    if (!trimmed || !this.getProjectSemanticIndexEnabled(scopeVersionId)) return [];
    if (options.refreshIndex !== false) {
      this.ensureProjectSemanticIndex(scopeVersionId);
    }
    const profile = semanticQueryProfile(trimmed);
    const queryVector = semanticVectorForText(trimmed, 'query');
    const rankedCandidates = this.projectSemanticCandidateRows(scopeVersionId, trimmed, profile)
      .map((row) => ({ row, score: semanticRankScore(row, profile, queryVector) }))
      .filter((candidate) => candidate.score.baseScore >= 0.08 && (candidate.score.vectorScore > 0 || candidate.score.lexicalScore > 0 || candidate.score.titleScore > 0))
      .sort((left, right) => right.score.score - left.score.score || text(right.row, 'indexed_at').localeCompare(text(left.row, 'indexed_at')));
    return semanticDiversifyRankedCandidates(rankedCandidates, limit)
      .map(({ row, score }) => this.mapProjectSemanticSearchResult(row, trimmed, score));
  }

  private projectSemanticCandidateRows(scopeVersionId: string, query: string, profile: ProjectSemanticQueryProfile): SqlRow[] {
    const candidates: SqlRow[] = [];
    const seen = new Set<string>();
    const append = (candidateRows: SqlRow[]): void => {
      for (const row of candidateRows) {
        if (candidates.length >= PROJECT_SEMANTIC_SEARCH_CANDIDATE_LIMIT) return;
        const id = text(row, 'id');
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push(row);
      }
    };
    const terms = projectSemanticPrefilterTerms(query, profile);
    if (terms.length === 0) return candidates;
    const scoreSql = terms
      .map(
        () =>
          `(CASE WHEN LOWER(c.title) LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END +
            CASE WHEN LOWER(COALESCE(c.source_path, '')) LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END +
            CASE WHEN LOWER(c.content) LIKE ? ESCAPE '\\' THEN 4 ELSE 0 END +
            CASE WHEN LOWER(c.vector_json) LIKE ? ESCAPE '\\' THEN 3 ELSE 0 END +
            CASE WHEN LOWER(c.metadata_json) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`
      )
      .join(' + ');
    const params: SqlPrimitive[] = [];
    for (const term of terms) {
      const pattern = `%${escapeLike(term)}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }
    params.push(scopeVersionId, PROJECT_SEMANTIC_SEARCH_CANDIDATE_LIMIT);
    append(
      rows(
        this.db
          .prepare(
            `SELECT *
             FROM (
               SELECT c.*, ${scoreSql} AS semantic_prefilter_score
               FROM project_semantic_chunks c
               WHERE c.scope_version_id = ?
             )
             WHERE semantic_prefilter_score > 0
             ORDER BY semantic_prefilter_score DESC, indexed_at DESC
             LIMIT ?`
          )
          .all(...params)
      )
    );
    return candidates;
  }

  public ensureProjectInventory(scopeVersionId = this.getActiveScope().id): ProjectInventorySummary {
    return this.getProjectInventorySummary(scopeVersionId);
  }

  public refreshProjectInventory(scopeVersionId = this.getActiveScope().id): ProjectInventoryRefreshReport {
    const summary = this.getProjectInventorySummary(scopeVersionId);
    return { ...summary, rootCount: 0, skippedCount: 0, truncated: false };
  }

  public rebuildProjectSearchIndex(options: { includeInventory?: boolean } = {}): void {
    this.transaction(() => {
      const workspaceDocumentIds = `SELECT id FROM project_search_documents WHERE scope_version_id IN (SELECT id FROM scope_versions WHERE workspace_id = ?)`;
      this.db.prepare(`DELETE FROM project_search_fts WHERE document_id IN (${workspaceDocumentIds})`).run(this.workspaceId);
      this.db.prepare(`DELETE FROM project_search_documents WHERE id IN (${workspaceDocumentIds})`).run(this.workspaceId);
      const scopeRows = rows(this.db.prepare('SELECT id FROM scope_versions WHERE workspace_id = ? ORDER BY version ASC').all(this.workspaceId));
      for (const scopeRow of scopeRows) {
        const scope = this.getScopeVersion(text(scopeRow, 'id'));
        for (const asset of scope.assets) {
          this.upsertProjectSearchDocument({
            scopeVersionId: scope.id,
            entityType: 'scope_asset',
            entityId: asset.id,
            title: `${asset.direction} ${asset.kind}: ${asset.value}`,
            body: [asset.value, asset.kind, asset.direction, asset.sensitivity, JSON.stringify(asset.attributes), scope.workspaceName, scope.descriptionMarkdown, scope.rulesMarkdown].join('\n'),
            sourcePath: isAbsolute(asset.value) ? asset.value : null,
            metadata: { direction: asset.direction, kind: asset.kind, sensitivity: asset.sensitivity, attributes: asset.attributes },
            createdAt: asset.createdAt,
            updatedAt: asset.createdAt
          });
        }
      }
      const workspaceRunIds = `SELECT r.id FROM runs r JOIN scope_versions s ON s.id = r.scope_version_id WHERE s.workspace_id = ?`;
      for (const row of rows(this.db.prepare(`SELECT * FROM runs WHERE id IN (${workspaceRunIds}) ORDER BY created_at ASC`).all(this.workspaceId))) this.indexRunSearchDocument(this.mapRun(row));
      for (const row of rows(this.db.prepare(`SELECT * FROM transcript_messages WHERE run_id IN (${workspaceRunIds}) ORDER BY created_at ASC, rowid ASC`).all(this.workspaceId))) this.indexTranscriptSearchDocument(this.mapTranscriptMessage(row));
      for (const row of rows(this.db.prepare(`SELECT * FROM trace_events WHERE model_visible = 1 AND run_id IN (${workspaceRunIds}) ORDER BY created_at ASC`).all(this.workspaceId))) this.indexTraceSearchDocument(this.mapTraceEvent(row));
      for (const row of rows(this.db.prepare(`SELECT DISTINCT a.* FROM artifacts a JOIN trace_events t ON t.artifact_id = a.id WHERE a.model_visible = 1 AND t.run_id IN (${workspaceRunIds}) ORDER BY a.created_at ASC`).all(this.workspaceId))) this.indexArtifactSearchDocument(this.mapArtifact(row));
      for (const row of rows(this.db.prepare(`SELECT * FROM verifier_contracts WHERE run_id IN (${workspaceRunIds}) ORDER BY created_at ASC`).all(this.workspaceId))) this.indexVerifierContractSearchDocument(this.mapVerifierContract(row));
      for (const row of rows(this.db.prepare(`SELECT * FROM verifier_runs WHERE run_id IN (${workspaceRunIds}) ORDER BY started_at ASC, rowid ASC`).all(this.workspaceId))) this.indexVerifierRunSearchDocument(this.mapVerifierRun(row));
    });

    void options;
  }

  public searchProjectDocumentsForRun(runId: string, query: string, limit = 20, options: { refreshInventory?: boolean; scopeVersionId?: string } = {}): ProjectSearchResult[] {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const scopeVersionId = options.scopeVersionId ?? run.scopeVersionId;
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (options.refreshInventory !== false) {
      this.ensureProjectInventory(scopeVersionId);
    }
    const lineageRunSql = this.scopeVersionLineagePredicate('scope_version_id');
    const visibleDocumentSql = `(d.scope_version_id = ? OR d.run_id IN (SELECT id FROM runs WHERE ${lineageRunSql}))`;

    const ftsQuery = projectFtsQuery(trimmed);
    if (ftsQuery) {
      try {
        const resultRows = rows(
          this.db
            .prepare(
              `SELECT d.*, bm25(project_search_fts) AS rank
               FROM project_search_fts
               JOIN project_search_documents d ON d.id = project_search_fts.document_id
               WHERE project_search_fts MATCH ?
                 AND ${visibleDocumentSql}
               ORDER BY rank ASC, d.updated_at DESC
               LIMIT ?`
            )
            .all(ftsQuery, scopeVersionId, scopeVersionId, Math.max(1, Math.floor(limit)))
        );
        return resultRows.map((row) => this.mapProjectSearchResult(row, trimmed));
      } catch {
        // Fall through to LIKE search for punctuation-heavy or unsupported FTS queries.
      }
    }

    const terms = projectSearchTerms(trimmed);
    if (terms.length === 0) return [];
    const conditions = terms.map(() => "LOWER(d.title || ' ' || d.body) LIKE ? ESCAPE '\\'").join(' AND ');
    const params = terms.map((term) => `%${escapeLike(term)}%`);
    const resultRows = rows(
      this.db
        .prepare(
          `SELECT d.*, 100.0 AS rank
           FROM project_search_documents d
           WHERE ${conditions}
             AND ${visibleDocumentSql}
           ORDER BY d.updated_at DESC
           LIMIT ?`
        )
        .all(...params, scopeVersionId, scopeVersionId, Math.max(1, Math.floor(limit)))
    );
    return resultRows.map((row) => this.mapProjectSearchResult(row, trimmed));
  }

  public getRunDetailUpdate(runId: string, cursor: RunDetailUpdateCursor): RunDetailUpdate {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const afterTraceSequence = Number.isFinite(cursor.afterTraceSequence) ? Math.max(-1, Math.floor(cursor.afterTraceSequence)) : -1;
    const afterTranscriptCount = Number.isFinite(cursor.afterTranscriptCount) ? Math.max(0, Math.floor(cursor.afterTranscriptCount)) : 0;

    return {
      run,
      researchProfile: this.getRunResearchProfileSnapshot(runId),
      nextStepSuggestions: this.getSessionNextStepSuggestions(runId),
      version: this.getRunDetailVersion(runId),
      attempts: rows(this.db.prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at ASC').all(runId)).map((row) => this.mapAttempt(row)),
      traceEvents: rows(this.db.prepare('SELECT * FROM trace_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC').all(runId, afterTraceSequence)).map((row) =>
        this.mapTraceEvent(row)
      ),
      transcriptMessages: rows(
        this.db
          .prepare('SELECT * FROM transcript_messages WHERE run_id = ? ORDER BY created_at ASC, rowid ASC LIMIT -1 OFFSET ?')
          .all(runId, afterTranscriptCount)
      ).map((row) => this.mapTranscriptMessage(row)),
      breakoutRooms: rows(this.db.prepare(
        `SELECT * FROM breakout_rooms
         WHERE run_id = ?
           AND id IN (
             SELECT room_id FROM breakout_room_members WHERE run_id = ? GROUP BY room_id HAVING COUNT(DISTINCT id) >= 2
           )
         ORDER BY created_at DESC, rowid DESC`
      ).all(runId, runId)).map((row) =>
        this.mapBreakoutRoom(row)
      ),
      breakoutRoomMembers: rows(this.db.prepare(
        `SELECT * FROM breakout_room_members
         WHERE run_id = ?
           AND room_id IN (
             SELECT room_id FROM breakout_room_members WHERE run_id = ? GROUP BY room_id HAVING COUNT(DISTINCT id) >= 2
           )
         ORDER BY started_at ASC, rowid ASC`
      ).all(runId, runId)).map((row) =>
        this.mapBreakoutRoomMember(row)
      ),
      breakoutRoomMessages: rows(this.db.prepare(
        `SELECT * FROM breakout_room_messages
         WHERE run_id = ?
           AND room_id IN (
             SELECT room_id FROM breakout_room_members WHERE run_id = ? GROUP BY room_id HAVING COUNT(DISTINCT id) >= 2
           )
         ORDER BY created_at ASC, rowid ASC`
      ).all(runId, runId)).map((row) =>
        this.mapBreakoutRoomMessage(row)
      ),
      artifacts: rows(
        this.db
          .prepare(
            `SELECT DISTINCT a.* FROM artifacts a
             JOIN trace_events t ON t.artifact_id = a.id
             WHERE t.run_id = ?
             ORDER BY a.created_at ASC`
          )
          .all(runId)
      ).map((row) => this.mapArtifact(row)),
      verifierContracts: rows(this.db.prepare('SELECT * FROM verifier_contracts WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapVerifierContract(row)),
      verifierRuns: rows(this.db.prepare('SELECT * FROM verifier_runs WHERE run_id = ? ORDER BY started_at ASC, rowid ASC').all(runId)).map((row) => this.mapVerifierRun(row)),
      vmContexts: rows(
        this.db
          .prepare(
            `SELECT DISTINCT v.* FROM vm_contexts v
             LEFT JOIN attempts a ON a.vm_context_id = v.id
             WHERE a.run_id = ? OR v.id IN (SELECT vm_context_id FROM trace_events WHERE run_id = ? AND vm_context_id IS NOT NULL)
             ORDER BY v.created_at ASC`
          )
          .all(runId, runId)
      ).map((row) => this.mapVmContext(row)),
      modelSessions: rows(this.db.prepare('SELECT * FROM model_sessions WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapModelSession(row)),
      contextCompactions: rows(this.db.prepare('SELECT * FROM context_compactions WHERE run_id = ? ORDER BY created_at ASC, rowid ASC').all(runId)).map((row) =>
        this.mapContextCompaction(row)
      ),
      policyEvents: rows(this.db.prepare('SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapApproval(row)),
      exports: rows(this.db.prepare('SELECT * FROM exports WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapExport(row))
    };
  }

  public getRunDetailVersion(runId: string): RunDetailVersion {
    const startedAt = performance.now();
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const revisionRow = rowOrUndefined(
      this.db.prepare('SELECT revision FROM run_detail_revisions WHERE run_id = ?').get(runId)
    );
    if (!revisionRow) throw new Error(`Run detail revision not found: ${runId}`);

    return {
      runId,
      version: `revision:${numberValue(revisionRow, 'revision')}`,
      generatedAt: nowIso(),
      databaseMs: roundMetricMs(performance.now() - startedAt)
    };
  }

  public getRun(runId: string): RunRecord | null {
    const row = rowOrUndefined(
      this.db
        .prepare('SELECT r.* FROM runs r JOIN scope_versions s ON s.id = r.scope_version_id WHERE r.id = ? AND s.workspace_id = ?')
        .get(runId, this.workspaceId)
    );
    return row ? this.mapRun(row) : null;
  }

  public getFirstAttempt(runId: string): AttemptRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at ASC LIMIT 1').get(runId));
    return row ? this.mapAttempt(row) : null;
  }

  public getFirstArtifact(runId: string): ArtifactRecord | null {
    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT a.* FROM artifacts a
           JOIN trace_events t ON t.artifact_id = a.id
           WHERE t.run_id = ?
           ORDER BY a.created_at ASC LIMIT 1`
        )
        .get(runId)
    );
    return row ? this.mapArtifact(row) : null;
  }

  public getFirstVerifierContract(runId: string): VerifierContractRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM verifier_contracts WHERE run_id = ? ORDER BY created_at ASC LIMIT 1').get(runId));
    return row ? this.mapVerifierContract(row) : null;
  }

  private createSchema(): void {
    applyDatabaseMigrations(this.db, 'beale_workbench', [
      {
        version: 1,
        name: 'workspace_schema_baseline',
        up: (database) => {
          database.exec(SCHEMA_SQL);
          database.exec(RUN_FIXTURE_SETUP_SCHEMA_SQL);
          database.exec(PROJECT_GRAPH_SCHEMA_SQL);
          database.exec(PROJECT_GRAPH_STATUS_SCHEMA_SQL);
          database.exec(PROJECT_SEMANTIC_SCHEMA_SQL);
          database.exec(PROJECT_SEARCH_PERFORMANCE_INDEXES_SQL);
          database.prepare("DELETE FROM workspace_meta WHERE key = 'schema_version'").run();
        }
      },
      {
        version: 2,
        name: 'reconcile_errored_honeycrisp_run_status',
        up: (database) => {
          const migratedAt = nowIso();
          const summary = 'Honeycrisp capture reported an agent error.';
          const erroredLatestSessionIds = `
            SELECT candidate.id
            FROM model_sessions AS candidate
            WHERE candidate.provider = 'honeycrisp'
              AND candidate.transport = 'host_process'
              AND candidate.status = 'completed'
              AND CASE
                WHEN json_valid(candidate.metadata_json)
                THEN json_extract(candidate.metadata_json, '$.honeycrispAgentStatus')
                ELSE NULL
              END = 'error'
              AND candidate.id = (
                SELECT latest.id
                FROM model_sessions AS latest
                WHERE latest.run_id = candidate.run_id
                ORDER BY latest.created_at DESC, latest.rowid DESC
                LIMIT 1
              )`;
          const erroredRunIds = `
            SELECT model_sessions.run_id
            FROM model_sessions
            WHERE model_sessions.id IN (${erroredLatestSessionIds})`;

          database
            .prepare(
              `UPDATE attempts
               SET status = 'failed', short_state = ?, ended_at = COALESCE(ended_at, ?)
               WHERE run_id IN (${erroredRunIds})
                 AND status = 'completed'
                 AND id = (
                   SELECT latest.id
                   FROM attempts AS latest
                   WHERE latest.run_id = attempts.run_id
                   ORDER BY latest.started_at DESC, latest.rowid DESC
                   LIMIT 1
                 )`
            )
            .run(summary, migratedAt);
          database
            .prepare(
              `UPDATE runs
               SET status = 'failed', summary = ?, ended_at = COALESCE(ended_at, ?)
               WHERE id IN (${erroredRunIds})
                 AND status = 'completed'`
            )
            .run(summary, migratedAt);
          database
            .prepare(
              `UPDATE model_sessions
               SET status = 'failed', updated_at = ?
               WHERE id IN (${erroredLatestSessionIds})`
            )
            .run(migratedAt);
        }
      },
      {
        version: 3,
        name: 'global_workspace_ownership',
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY,
              workspace_path TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
          `);
          if (!tableHasColumn(database, 'scope_versions', 'workspace_id')) {
            database.exec('ALTER TABLE scope_versions ADD COLUMN workspace_id TEXT;');
          }
          const legacyWorkspace = rowOrUndefined(database.prepare("SELECT value FROM workspace_meta WHERE key = 'workspace_id'").get());
          const legacyWorkspaceId = legacyWorkspace ? text(legacyWorkspace, 'value') : '';
          if (legacyWorkspaceId) {
            const now = nowIso();
            database
              .prepare('INSERT OR IGNORE INTO workspaces (id, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?)')
              .run(legacyWorkspaceId, `legacy:${legacyWorkspaceId}`, now, now);
            database.prepare('UPDATE scope_versions SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ?').run(legacyWorkspaceId, '');
            const legacyMeta = rows(database.prepare("SELECT key, value, updated_at FROM workspace_meta WHERE key NOT LIKE 'workspace_%:%'").all());
            for (const row of legacyMeta) {
              const key = text(row, 'key');
              database
                .prepare('INSERT OR REPLACE INTO workspace_meta (key, value, updated_at) VALUES (?, ?, ?)')
                .run(`${legacyWorkspaceId}:${key}`, text(row, 'value'), text(row, 'updated_at'));
              database.prepare('DELETE FROM workspace_meta WHERE key = ?').run(key);
            }
          }
          database.exec('CREATE INDEX IF NOT EXISTS idx_scope_versions_workspace_status ON scope_versions(workspace_id, status, version);');
        }
      },
      {
        version: 4,
        name: 'honeycrisp_owned_research_memory',
        up: (database) => {
          if (tableHasColumn(database, 'verifier_contracts', 'hypothesis_id')) {
            database.exec(`
              CREATE TABLE verifier_runs_migration_backup AS SELECT * FROM verifier_runs;
              DROP TABLE verifier_runs;
              ALTER TABLE verifier_contracts RENAME TO verifier_contracts_legacy;
              CREATE TABLE verifier_contracts (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                memory_node_id TEXT,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                target_states_json TEXT NOT NULL,
                setup_steps_markdown TEXT NOT NULL,
                trigger_steps_markdown TEXT NOT NULL,
                expected_observations_json TEXT NOT NULL,
                invariants_json TEXT NOT NULL,
                artifacts_to_collect_json TEXT NOT NULL,
                pass_criteria_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
              );
              INSERT INTO verifier_contracts (
                id, run_id, memory_node_id, mode, status, target_states_json,
                setup_steps_markdown, trigger_steps_markdown, expected_observations_json,
                invariants_json, artifacts_to_collect_json, pass_criteria_json, created_at, updated_at
              )
              SELECT
                id, run_id, NULL, mode, status, target_states_json,
                setup_steps_markdown, trigger_steps_markdown, expected_observations_json,
                invariants_json, artifacts_to_collect_json, pass_criteria_json, created_at, updated_at
              FROM verifier_contracts_legacy;
              DROP TABLE verifier_contracts_legacy;
              CREATE TABLE verifier_runs (
                id TEXT PRIMARY KEY,
                contract_id TEXT NOT NULL REFERENCES verifier_contracts(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                attempt_id TEXT REFERENCES attempts(id),
                vm_context_id TEXT REFERENCES vm_contexts(id),
                status TEXT NOT NULL,
                blocked_issue TEXT NOT NULL,
                behavior_preserved TEXT NOT NULL,
                diagnostics_clean TEXT NOT NULL,
                regression_tests TEXT NOT NULL,
                result_json TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT
              );
              INSERT INTO verifier_runs SELECT * FROM verifier_runs_migration_backup;
              DROP TABLE verifier_runs_migration_backup;
              CREATE INDEX IF NOT EXISTS idx_verifier_runs_status ON verifier_runs(status);
            `);
          }
          if (tableHasColumn(database, 'exports', 'finding_id')) {
            database.exec(`
              ALTER TABLE exports RENAME TO exports_legacy;
              CREATE TABLE exports (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                memory_node_id TEXT,
                kind TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                redaction_policy_json TEXT NOT NULL,
                included_artifacts_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending_review',
                review_decision TEXT,
                review_note TEXT,
                created_at TEXT NOT NULL,
                reviewed_at TEXT
              );
              INSERT INTO exports (
                id, run_id, memory_node_id, kind, relative_path, redaction_policy_json,
                included_artifacts_json, status, review_decision, review_note, created_at, reviewed_at
              )
              SELECT
                id, run_id, NULL, kind, relative_path, redaction_policy_json,
                included_artifacts_json, status, review_decision, review_note, created_at, reviewed_at
              FROM exports_legacy;
              DROP TABLE exports_legacy;
            `);
          }
          for (const table of ['weakness_mappings', 'evidence', 'findings', 'hypotheses', 'cwe_entries', 'cwe_catalogs']) {
            if (tableExists(database, table)) database.exec(`DROP TABLE ${table};`);
          }
          database.exec(`
            DELETE FROM project_search_documents
            WHERE entity_type IN ('hypothesis', 'finding', 'evidence', 'weakness');
            DELETE FROM project_graph_edges
            WHERE source_node_id IN (
              SELECT id FROM project_graph_nodes WHERE entity_type IN ('hypothesis', 'finding', 'evidence', 'weakness', 'research_component')
            )
               OR target_node_id IN (
              SELECT id FROM project_graph_nodes WHERE entity_type IN ('hypothesis', 'finding', 'evidence', 'weakness', 'research_component')
            )
               OR target_entity_type IN ('hypothesis', 'finding', 'evidence', 'weakness', 'research_component');
            DELETE FROM project_graph_nodes
            WHERE entity_type IN ('hypothesis', 'finding', 'evidence', 'weakness', 'research_component');
            CREATE INDEX IF NOT EXISTS idx_verifier_contracts_memory_node ON verifier_contracts(memory_node_id);
            CREATE INDEX IF NOT EXISTS idx_exports_memory_node ON exports(memory_node_id);
          `);
        }
      },
      {
        version: 5,
        name: 'operational_trace_taxonomy',
        up: (database) => {
          database.exec(`
            CREATE TEMP TABLE legacy_trace_taxonomy_ids AS
            SELECT id, type
            FROM trace_events
            WHERE type IN ('hypothesis_event', 'finding_event');

            UPDATE project_search_fts
            SET
              title = CASE
                WHEN title LIKE 'Hypothesis created:%' THEN 'Research note recorded:' || substr(title, length('Hypothesis created:') + 1)
                WHEN title LIKE 'Simulated finding recorded%' THEN 'Fixture research outcome recorded; real target execution is still required.'
                ELSE title
              END,
              body = replace(replace(body, 'hypothesis_event', 'research_event'), 'finding_event', 'research_event')
            WHERE document_id IN (
              SELECT id
              FROM project_search_documents
              WHERE entity_type = 'trace_event'
                AND entity_id IN (SELECT id FROM legacy_trace_taxonomy_ids)
            );

            UPDATE project_search_documents
            SET
              title = CASE
                WHEN title LIKE 'Hypothesis created:%' THEN 'Research note recorded:' || substr(title, length('Hypothesis created:') + 1)
                WHEN title LIKE 'Simulated finding recorded%' THEN 'Fixture research outcome recorded; real target execution is still required.'
                ELSE title
              END,
              body = replace(replace(body, 'hypothesis_event', 'research_event'), 'finding_event', 'research_event'),
              metadata_json = CASE
                WHEN json_valid(metadata_json) THEN json_set(metadata_json, '$.type', 'research_event')
                ELSE metadata_json
              END
            WHERE entity_type = 'trace_event'
              AND entity_id IN (SELECT id FROM legacy_trace_taxonomy_ids);

            UPDATE project_graph_nodes
            SET
              node_kind = 'trace:research_event',
              label = CASE
                WHEN label LIKE 'Hypothesis created:%' THEN 'Research note recorded:' || substr(label, length('Hypothesis created:') + 1)
                WHEN label LIKE 'Simulated finding recorded%' THEN 'Fixture research outcome recorded; real target execution is still required.'
                ELSE label
              END,
              metadata_json = CASE
                WHEN json_valid(metadata_json) THEN json_set(metadata_json, '$.type', 'research_event')
                ELSE metadata_json
              END
            WHERE entity_type = 'trace_event'
              AND entity_id IN (SELECT id FROM legacy_trace_taxonomy_ids);

            UPDATE trace_events
            SET
              type = 'research_event',
              summary = CASE
                WHEN summary LIKE 'Hypothesis created:%' THEN 'Research note recorded:' || substr(summary, length('Hypothesis created:') + 1)
                WHEN summary LIKE 'Simulated finding recorded%' THEN 'Fixture research outcome recorded; real target execution is still required.'
                ELSE summary
              END
            WHERE id IN (SELECT id FROM legacy_trace_taxonomy_ids);

            UPDATE runs
            SET budget_json = json_set(
              budget_json,
              '$.fixtureScenario',
              CASE json_extract(budget_json, '$.fixtureScenario')
                WHEN 'adaptive_portfolio' THEN 'multi_branch_trace'
                WHEN 'source_logic_bug' THEN 'source_review'
                WHEN 'memory_corruption' THEN 'crash_artifact'
                WHEN 'policy_block' THEN 'scope_block'
                WHEN 'verified_finding' THEN 'verifier_pass'
              END
            )
            WHERE json_valid(budget_json)
              AND json_extract(budget_json, '$.fixtureScenario') IN (
                'adaptive_portfolio',
                'source_logic_bug',
                'memory_corruption',
                'policy_block',
                'verified_finding'
              );

            UPDATE runs
            SET attempt_strategy = 'iterative_research'
            WHERE attempt_strategy = 'adaptive_portfolio';

            UPDATE trace_events
            SET payload_json = json_set(payload_json, '$.attemptStrategy', 'iterative_research')
            WHERE json_valid(payload_json)
              AND json_extract(payload_json, '$.attemptStrategy') = 'adaptive_portfolio';

            UPDATE project_search_fts
            SET body = replace(body, 'adaptive_portfolio', 'iterative_research')
            WHERE body LIKE '%adaptive_portfolio%';

            UPDATE project_search_documents
            SET
              body = replace(body, 'adaptive_portfolio', 'iterative_research'),
              metadata_json = replace(metadata_json, 'adaptive_portfolio', 'iterative_research')
            WHERE body LIKE '%adaptive_portfolio%'
               OR metadata_json LIKE '%adaptive_portfolio%';

            UPDATE project_graph_nodes
            SET metadata_json = replace(metadata_json, 'adaptive_portfolio', 'iterative_research')
            WHERE metadata_json LIKE '%adaptive_portfolio%';

            UPDATE exports
            SET kind = 'artifact_bundle'
            WHERE kind = 'evidence_bundle';

            UPDATE artifacts
            SET
              kind = 'artifact_bundle_export',
              metadata_json = CASE
                WHEN json_valid(metadata_json) THEN json_set(metadata_json, '$.exportKind', 'artifact_bundle')
                ELSE metadata_json
              END
            WHERE kind = 'evidence_bundle_export';

            UPDATE trace_events
            SET summary = 'Artifact bundle export created.'
            WHERE summary = 'Evidence bundle export created.';

            UPDATE project_search_fts
            SET
              title = replace(replace(title, 'Evidence bundle', 'Artifact bundle'), 'evidence_bundle', 'artifact_bundle'),
              body = replace(replace(body, 'Evidence bundle', 'Artifact bundle'), 'evidence_bundle', 'artifact_bundle')
            WHERE document_id IN (
              SELECT id
              FROM project_search_documents
              WHERE
                (entity_type = 'artifact' AND entity_id IN (SELECT id FROM artifacts WHERE kind = 'artifact_bundle_export'))
                OR (entity_type = 'trace_event' AND entity_id IN (SELECT id FROM trace_events WHERE summary = 'Artifact bundle export created.'))
            );

            UPDATE project_search_documents
            SET
              title = replace(replace(title, 'Evidence bundle', 'Artifact bundle'), 'evidence_bundle', 'artifact_bundle'),
              body = replace(replace(body, 'Evidence bundle', 'Artifact bundle'), 'evidence_bundle', 'artifact_bundle'),
              metadata_json = replace(metadata_json, 'evidence_bundle', 'artifact_bundle')
            WHERE
              (entity_type = 'artifact' AND entity_id IN (SELECT id FROM artifacts WHERE kind = 'artifact_bundle_export'))
              OR (entity_type = 'trace_event' AND entity_id IN (SELECT id FROM trace_events WHERE summary = 'Artifact bundle export created.'));

            UPDATE project_graph_nodes
            SET
              node_kind = replace(node_kind, 'evidence_bundle', 'artifact_bundle'),
              label = replace(label, 'Evidence bundle', 'Artifact bundle'),
              metadata_json = replace(metadata_json, 'evidence_bundle', 'artifact_bundle')
            WHERE
              (entity_type = 'artifact' AND entity_id IN (SELECT id FROM artifacts WHERE kind = 'artifact_bundle_export'))
              OR (entity_type = 'trace_event' AND entity_id IN (SELECT id FROM trace_events WHERE summary = 'Artifact bundle export created.'));

            DROP TABLE legacy_trace_taxonomy_ids;
          `);
        }
      },
      {
        version: 6,
        name: 'reversible_memory_dreaming',
        up: (database) => {
          database.exec(MEMORY_DREAMING_SCHEMA_SQL);
        }
      },
      {
        version: 7,
        name: 'semantic_memory_dreaming',
        up: (database) => {
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'model')) {
            database.exec("ALTER TABLE memory_dreaming_runs ADD COLUMN model TEXT NOT NULL DEFAULT 'unknown';");
          }
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'reasoning_effort')) {
            database.exec("ALTER TABLE memory_dreaming_runs ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'unknown';");
          }
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'input_node_count')) {
            database.exec('ALTER TABLE memory_dreaming_runs ADD COLUMN input_node_count INTEGER NOT NULL DEFAULT 0;');
          }
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'input_session_count')) {
            database.exec('ALTER TABLE memory_dreaming_runs ADD COLUMN input_session_count INTEGER NOT NULL DEFAULT 0;');
          }
          database.exec(`
            ALTER TABLE memory_dreaming_changes RENAME TO memory_dreaming_changes_pre_semantic;
            CREATE TABLE memory_dreaming_changes (
              id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL REFERENCES memory_dreaming_runs(id) ON DELETE CASCADE,
              workspace_id TEXT NOT NULL,
              action TEXT NOT NULL CHECK (action IN ('prune', 'merge_duplicates', 'revise')),
              title TEXT NOT NULL,
              node_type TEXT NOT NULL,
              hidden_node_ids_json TEXT NOT NULL,
              survivor_node_id TEXT,
              reason TEXT NOT NULL,
              before_json TEXT NOT NULL,
              after_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              restored_at TEXT
            );
            INSERT INTO memory_dreaming_changes (
              id, run_id, workspace_id, action, title, node_type, hidden_node_ids_json,
              survivor_node_id, reason, before_json, after_json, created_at, restored_at
            )
            SELECT
              id, run_id, workspace_id,
              CASE action WHEN 'hide_stale' THEN 'prune' ELSE action END,
              title, node_type, hidden_node_ids_json, survivor_node_id, reason,
              before_json, after_json, created_at, restored_at
            FROM memory_dreaming_changes_pre_semantic;
            DROP TABLE memory_dreaming_changes_pre_semantic;
            CREATE INDEX idx_memory_dreaming_changes_workspace_created
            ON memory_dreaming_changes(workspace_id, created_at DESC);
            CREATE INDEX idx_memory_dreaming_changes_run
            ON memory_dreaming_changes(run_id);
          `);
        }
      },
      {
        version: 8,
        name: 'structured_session_final_disposition',
        up: (database) => {
          if (!tableHasColumn(database, 'runs', 'final_disposition_json')) {
            database.exec('ALTER TABLE runs ADD COLUMN final_disposition_json TEXT;');
          }
          if (!tableHasColumn(database, 'runs', 'blocker_dependencies_json')) {
            database.exec("ALTER TABLE runs ADD COLUMN blocker_dependencies_json TEXT NOT NULL DEFAULT '[]';");
          }
          if (!tableHasColumn(database, 'runs', 'external_state_required')) {
            database.exec('ALTER TABLE runs ADD COLUMN external_state_required INTEGER NOT NULL DEFAULT 0;');
          }
          const terminalRows = rows(
            database
              .prepare("SELECT id, status, summary, created_at, ended_at FROM runs WHERE status IN ('blocked', 'completed', 'failed', 'stopped') AND final_disposition_json IS NULL")
              .all()
          );
          const update = database.prepare(
            'UPDATE runs SET final_disposition_json = ?, blocker_dependencies_json = ?, external_state_required = ? WHERE id = ?'
          );
          for (const row of terminalRows) {
            const disposition = fallbackSessionFinalDisposition(
              text(row, 'status') as RunStatus,
              text(row, 'summary'),
              'migration',
              nullableText(row, 'ended_at') ?? text(row, 'created_at')
            );
            update.run(toJson(dispositionMetadata(disposition)), '[]', 0, text(row, 'id'));
          }
        }
      },
      {
        version: 9,
        name: 'remove_ham_mode_state',
        up: (database) => {
          database.prepare("DELETE FROM workspace_meta WHERE key = 'ham_mode_state_json' OR key LIKE '%:ham_mode_state_json'").run();
        }
      },
      {
        version: 10,
        name: 'session_shell_safety_modes',
        up: (database) => {
          if (!tableHasColumn(database, 'runs', 'shell_safety_mode')) {
            database.exec("ALTER TABLE runs ADD COLUMN shell_safety_mode TEXT NOT NULL DEFAULT 'auto_review' CHECK (shell_safety_mode IN ('manual_approval', 'auto_review', 'danger'));");
          }
        }
      },
      {
        version: 11,
        name: 'memory_dreaming_reclassification',
        up: (database) => {
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'reclassified_node_count')) {
            database.exec('ALTER TABLE memory_dreaming_runs ADD COLUMN reclassified_node_count INTEGER NOT NULL DEFAULT 0;');
          }
          database.exec(`
            ALTER TABLE memory_dreaming_changes RENAME TO memory_dreaming_changes_pre_reclassification;
            CREATE TABLE memory_dreaming_changes (
              id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL REFERENCES memory_dreaming_runs(id) ON DELETE CASCADE,
              workspace_id TEXT NOT NULL,
              action TEXT NOT NULL CHECK (action IN ('prune', 'merge_duplicates', 'revise', 'reclassify')),
              title TEXT NOT NULL,
              node_type TEXT NOT NULL,
              hidden_node_ids_json TEXT NOT NULL,
              survivor_node_id TEXT,
              reason TEXT NOT NULL,
              before_json TEXT NOT NULL,
              after_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              restored_at TEXT
            );
            INSERT INTO memory_dreaming_changes (
              id, run_id, workspace_id, action, title, node_type, hidden_node_ids_json,
              survivor_node_id, reason, before_json, after_json, created_at, restored_at
            )
            SELECT
              id, run_id, workspace_id, action, title, node_type, hidden_node_ids_json,
              survivor_node_id, reason, before_json, after_json, created_at, restored_at
            FROM memory_dreaming_changes_pre_reclassification;
            DROP TABLE memory_dreaming_changes_pre_reclassification;
            CREATE INDEX idx_memory_dreaming_changes_workspace_created
            ON memory_dreaming_changes(workspace_id, created_at DESC);
            CREATE INDEX idx_memory_dreaming_changes_run
            ON memory_dreaming_changes(run_id);
          `);
        }
      },
      {
        version: 12,
        name: 'memory_dreaming_failed_runs',
        up: (database) => {
          if (tableHasColumn(database, 'memory_dreaming_runs', 'error_message')) return;
          database.exec(`
            ALTER TABLE memory_dreaming_changes RENAME TO memory_dreaming_changes_pre_failures;
            ALTER TABLE memory_dreaming_runs RENAME TO memory_dreaming_runs_pre_failures;
            CREATE TABLE memory_dreaming_runs (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('completed', 'restored', 'failed')),
              stale_hidden_count INTEGER NOT NULL DEFAULT 0,
              duplicate_hidden_count INTEGER NOT NULL DEFAULT 0,
              duplicate_group_count INTEGER NOT NULL DEFAULT 0,
              reclassified_node_count INTEGER NOT NULL DEFAULT 0,
              edited_node_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              completed_at TEXT NOT NULL,
              restored_at TEXT,
              model TEXT NOT NULL DEFAULT 'unknown',
              reasoning_effort TEXT NOT NULL DEFAULT 'unknown',
              input_node_count INTEGER NOT NULL DEFAULT 0,
              input_session_count INTEGER NOT NULL DEFAULT 0,
              error_message TEXT
            );
            CREATE TABLE memory_dreaming_changes (
              id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL REFERENCES memory_dreaming_runs(id) ON DELETE CASCADE,
              workspace_id TEXT NOT NULL,
              action TEXT NOT NULL CHECK (action IN ('prune', 'merge_duplicates', 'revise', 'reclassify')),
              title TEXT NOT NULL,
              node_type TEXT NOT NULL,
              hidden_node_ids_json TEXT NOT NULL,
              survivor_node_id TEXT,
              reason TEXT NOT NULL,
              before_json TEXT NOT NULL,
              after_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              restored_at TEXT
            );
            INSERT INTO memory_dreaming_runs (
              id, workspace_id, status, stale_hidden_count, duplicate_hidden_count,
              duplicate_group_count, reclassified_node_count, edited_node_count,
              created_at, completed_at, restored_at, model, reasoning_effort,
              input_node_count, input_session_count, error_message
            )
            SELECT
              id, workspace_id, status, stale_hidden_count, duplicate_hidden_count,
              duplicate_group_count, reclassified_node_count, edited_node_count,
              created_at, completed_at, restored_at, model, reasoning_effort,
              input_node_count, input_session_count, NULL
            FROM memory_dreaming_runs_pre_failures;
            INSERT INTO memory_dreaming_changes (
              id, run_id, workspace_id, action, title, node_type, hidden_node_ids_json,
              survivor_node_id, reason, before_json, after_json, created_at, restored_at
            )
            SELECT
              id, run_id, workspace_id, action, title, node_type, hidden_node_ids_json,
              survivor_node_id, reason, before_json, after_json, created_at, restored_at
            FROM memory_dreaming_changes_pre_failures;
            DROP TABLE memory_dreaming_changes_pre_failures;
            DROP TABLE memory_dreaming_runs_pre_failures;
            CREATE INDEX idx_memory_dreaming_runs_workspace_created
            ON memory_dreaming_runs(workspace_id, created_at DESC);
            CREATE INDEX idx_memory_dreaming_changes_workspace_created
            ON memory_dreaming_changes(workspace_id, created_at DESC);
            CREATE INDEX idx_memory_dreaming_changes_run
            ON memory_dreaming_changes(run_id);
          `);
        }
      },
      {
        version: 13,
        name: 'versioned_research_profile_snapshots',
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS research_profile_snapshots (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              profile_id TEXT NOT NULL,
              profile_version TEXT NOT NULL,
              profile_hash TEXT NOT NULL,
              source TEXT NOT NULL CHECK (source IN ('bundled-default', 'workspace-default', 'explicit')),
              source_path TEXT,
              profile_json TEXT NOT NULL,
              active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
              created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_research_profile_snapshots_resolution_identity
            ON research_profile_snapshots(workspace_id, profile_hash, source, COALESCE(source_path, ''));
            CREATE UNIQUE INDEX IF NOT EXISTS idx_research_profile_snapshots_workspace_active
            ON research_profile_snapshots(workspace_id) WHERE active = 1;
            CREATE TRIGGER IF NOT EXISTS prevent_research_profile_snapshot_content_update
            BEFORE UPDATE OF workspace_id, profile_id, profile_version, profile_hash, source, source_path, profile_json, created_at
            ON research_profile_snapshots
            BEGIN
              SELECT RAISE(ABORT, 'research profile snapshots are immutable');
            END;
          `);
          if (!tableHasColumn(database, 'runs', 'research_profile_snapshot_id')) {
            database.exec('ALTER TABLE runs ADD COLUMN research_profile_snapshot_id TEXT REFERENCES research_profile_snapshots(id);');
          }
        }
      },
      {
        version: 14,
        name: 'durable_research_subject_binding',
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS workspace_research_subjects (
              workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
              subject_id TEXT NOT NULL,
              display_name TEXT NOT NULL,
              source TEXT NOT NULL CHECK (source IN ('explicit', 'legacy_adopted')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_research_subjects_subject
            ON workspace_research_subjects(subject_id, workspace_id);
          `);
          const insert = database.prepare(
            `INSERT OR IGNORE INTO workspace_research_subjects (
               workspace_id, subject_id, display_name, source, created_at, updated_at
             ) VALUES (?, ?, ?, 'legacy_adopted', ?, ?)`
          );
          const migratedAt = nowIso();
          for (const workspace of rows(database.prepare('SELECT id FROM workspaces ORDER BY id').all())) {
            const workspaceId = text(workspace, 'id');
            const scope = rowOrUndefined(
              database
                .prepare(
                  `SELECT workspace_name, scope_owner
                   FROM scope_versions
                   WHERE workspace_id = ?
                   ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, version DESC
                   LIMIT 1`
                )
                .get(workspaceId)
            );
            const workspaceName = scope ? text(scope, 'workspace_name').trim() : '';
            const scopeOwner = scope ? text(scope, 'scope_owner').trim() : '';
            const displayName = scopeOwner || workspaceName || 'Untitled subject';
            const subjectId = scopeOwner ? memorySubjectId(scopeOwner) : `subject_workspace:${workspaceId}`;
            insert.run(workspaceId, subjectId, displayName, migratedAt, migratedAt);
          }
        }
      },
      {
        version: 15,
        name: 'memory_dreaming_run_profile_provenance',
        up: (database) => {
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'research_profile_hash')) {
            database.exec('ALTER TABLE memory_dreaming_runs ADD COLUMN research_profile_hash TEXT;');
          }
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'research_profile_id')) {
            database.exec('ALTER TABLE memory_dreaming_runs ADD COLUMN research_profile_id TEXT;');
          }
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'research_profile_version')) {
            database.exec('ALTER TABLE memory_dreaming_runs ADD COLUMN research_profile_version TEXT;');
          }
          if (!tableHasColumn(database, 'memory_dreaming_runs', 'memory_catalog_hash')) {
            database.exec('ALTER TABLE memory_dreaming_runs ADD COLUMN memory_catalog_hash TEXT;');
          }
          database.exec(MEMORY_DREAMING_RUN_PROVENANCE_TRIGGER_SQL);
        }
      },
      {
        version: 16,
        name: 'remove_app_network_profiles',
        up: (database) => {
          if (tableHasColumn(database, 'scope_versions', 'network_policy_json')) {
            database.exec('ALTER TABLE scope_versions DROP COLUMN network_policy_json;');
          }
          if (tableHasColumn(database, 'runs', 'network_profile')) {
            database.exec('ALTER TABLE runs DROP COLUMN network_profile;');
          }
          if (tableHasColumn(database, 'vm_contexts', 'network_profile')) {
            database.exec('ALTER TABLE vm_contexts DROP COLUMN network_profile;');
          }
        }
      },
      {
        version: 17,
        name: 'session_activity_intervals',
        up: (database) => {
          database.exec(`
              CREATE TABLE IF NOT EXISTS session_activity_intervals (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL,
                ended_at TEXT
              );
              CREATE INDEX IF NOT EXISTS idx_session_activity_intervals_run_started
              ON session_activity_intervals(run_id, started_at);
              CREATE UNIQUE INDEX IF NOT EXISTS idx_session_activity_intervals_one_open
              ON session_activity_intervals(run_id) WHERE ended_at IS NULL;
              INSERT INTO session_activity_intervals (id, run_id, started_at, ended_at)
              SELECT
                'activity_legacy_' || r.id,
                r.id,
                r.started_at,
                CASE
                  WHEN r.status = 'active' THEN NULL
                  ELSE COALESCE(
                    r.ended_at,
                    (SELECT MAX(t.created_at) FROM trace_events t WHERE t.run_id = r.id),
                    r.started_at
                  )
                END
              FROM runs r
              WHERE r.started_at IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM session_activity_intervals interval WHERE interval.run_id = r.id
                );
          `);
        }
      },
      {
        version: 18,
        name: 'persist_session_next_step_suggestions',
        up: (database) => {
          if (!tableHasColumn(database, 'runs', 'next_step_suggestions_json')) {
            database.exec('ALTER TABLE runs ADD COLUMN next_step_suggestions_json TEXT;');
          }
        }
      },
      {
        version: 19,
        name: 'session_run_activity_ownership',
        up: (database) => {
          if (!tableHasColumn(database, 'session_activity_intervals', 'attempt_id')) {
            database.exec('ALTER TABLE session_activity_intervals ADD COLUMN attempt_id TEXT REFERENCES attempts(id) ON DELETE CASCADE;');
          }
          database.exec(`
            UPDATE session_activity_intervals AS interval
            SET attempt_id = (
              SELECT attempt.id
              FROM attempts attempt
              WHERE attempt.run_id = interval.run_id
                AND attempt.started_at <= interval.started_at
              ORDER BY attempt.started_at DESC, attempt.id DESC
              LIMIT 1
            )
            WHERE interval.attempt_id IS NULL;
            CREATE INDEX IF NOT EXISTS idx_session_activity_intervals_attempt_started
            ON session_activity_intervals(attempt_id, started_at);
          `);
        }
      },
      {
        version: 20,
        name: 'durable_breakout_rooms',
        up: (database) => {
          database.exec(BREAKOUT_ROOMS_SCHEMA_SQL);
        }
      },
      {
        version: 21,
        name: 'run_detail_revisions',
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS run_detail_revisions (
              run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
              revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
            );
            INSERT OR IGNORE INTO run_detail_revisions (run_id, revision)
            SELECT id, 1 FROM runs;

            CREATE TRIGGER IF NOT EXISTS run_detail_revision_runs_insert
            AFTER INSERT ON runs BEGIN
              INSERT INTO run_detail_revisions (run_id, revision) VALUES (NEW.id, 1)
              ON CONFLICT(run_id) DO UPDATE SET revision = revision + 1;
            END;
            CREATE TRIGGER IF NOT EXISTS run_detail_revision_runs_update
            AFTER UPDATE ON runs BEGIN
              INSERT INTO run_detail_revisions (run_id, revision) VALUES (NEW.id, 1)
              ON CONFLICT(run_id) DO UPDATE SET revision = revision + 1;
            END;
          `);
          for (const table of [
            'attempts',
            'trace_events',
            'transcript_messages',
            'breakout_rooms',
            'breakout_room_members',
            'breakout_room_messages',
            'verifier_contracts',
            'verifier_runs',
            'model_sessions',
            'context_compactions',
            'approvals',
            'exports'
          ]) {
            database.exec(`
              CREATE TRIGGER IF NOT EXISTS run_detail_revision_${table}_insert
              AFTER INSERT ON ${table} BEGIN
                UPDATE run_detail_revisions SET revision = revision + 1 WHERE run_id = NEW.run_id;
              END;
              CREATE TRIGGER IF NOT EXISTS run_detail_revision_${table}_update
              AFTER UPDATE ON ${table} BEGIN
                UPDATE run_detail_revisions SET revision = revision + 1 WHERE run_id = NEW.run_id;
              END;
              CREATE TRIGGER IF NOT EXISTS run_detail_revision_${table}_delete
              AFTER DELETE ON ${table} BEGIN
                UPDATE run_detail_revisions SET revision = revision + 1 WHERE run_id = OLD.run_id;
              END;
            `);
          }
          for (const table of ['artifacts', 'vm_contexts']) {
            const linkedRunIds = table === 'artifacts'
              ? 'SELECT DISTINCT run_id FROM trace_events WHERE artifact_id = NEW.id'
              : `SELECT run_id FROM attempts WHERE vm_context_id = NEW.id
                 UNION SELECT run_id FROM trace_events WHERE vm_context_id = NEW.id`;
            database.exec(`
              CREATE TRIGGER IF NOT EXISTS run_detail_revision_${table}_update
              AFTER UPDATE ON ${table} BEGIN
                UPDATE run_detail_revisions SET revision = revision + 1 WHERE run_id IN (${linkedRunIds});
              END;
            `);
          }
        }
      },
      {
        version: 22,
        name: 'structured_breakout_room_protocol',
        up: (database) => {
          if (!tableHasColumn(database, 'breakout_rooms', 'phase')) {
            database.exec("ALTER TABLE breakout_rooms ADD COLUMN phase TEXT NOT NULL DEFAULT 'independent' CHECK (phase IN ('independent', 'challenge', 'response', 'synthesis', 'completed')); ");
          }
          if (!tableHasColumn(database, 'breakout_rooms', 'challenge_round')) {
            database.exec("ALTER TABLE breakout_rooms ADD COLUMN challenge_round INTEGER NOT NULL DEFAULT 0 CHECK (challenge_round >= 0);");
          }
          database.exec("UPDATE breakout_rooms SET phase = 'completed' WHERE status = 'completed';");
        }
      }
    ]);
  }

  private ensureWorkspaceIdentity(): void {
    const workspacePath = resolve(this.workspaceIdentity.workspacePath);
    const existingByPath = rowOrUndefined(this.db.prepare('SELECT id FROM workspaces WHERE workspace_path = ?').get(workspacePath));
    if (existingByPath) {
      this.workspaceId = text(existingByPath, 'id');
      return;
    }

    const requestedWorkspaceId = this.workspaceIdentity.workspaceId?.trim();
    const legacy = requestedWorkspaceId
      ? rowOrUndefined(this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(requestedWorkspaceId))
      : rowOrUndefined(this.db.prepare("SELECT id FROM workspaces WHERE workspace_path LIKE 'legacy:%' ORDER BY created_at LIMIT 1").get());
    const workspaceId = requestedWorkspaceId || (legacy ? text(legacy, 'id') : workspaceIdForPath(workspacePath));
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO workspaces (id, workspace_path, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET workspace_path = excluded.workspace_path, updated_at = excluded.updated_at`
      )
      .run(workspaceId, workspacePath, now, now);
    this.workspaceId = workspaceId;
  }

  private ensureWorkspaceMeta(): void {
    const createdAt = nowIso();
    this.db.prepare('INSERT OR IGNORE INTO workspace_meta (key, value, updated_at) VALUES (?, ?, ?)').run(this.metaKey('created_at'), createdAt, createdAt);
  }

  private ensureDefaultScope(): void {
    const row = rowOrUndefined(this.db.prepare('SELECT id FROM scope_versions WHERE workspace_id = ? AND status = ? LIMIT 1').get(this.workspaceId, 'active'));
    if (row) return;
    this.saveScope({
      workspaceName: 'Untitled Workspace',
      scopeOwner: '',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      expiresAt: null,
      assets: []
    });
  }

  private ensureProjectSearchIndexSeeded(): void {
    const table = rowOrUndefined(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_search_documents'").get());
    if (!table) return;
    const row = rowOrUndefined(
      this.db
        .prepare('SELECT COUNT(*) AS count FROM project_search_documents WHERE scope_version_id IN (SELECT id FROM scope_versions WHERE workspace_id = ?)')
        .get(this.workspaceId)
    );
    if ((row ? numberValue(row, 'count') : 0) > 0) return;
    this.rebuildProjectSearchIndex({ includeInventory: true });
  }

  private ensureProjectStructureIndexSeeded(): void {
    const table = rowOrUndefined(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_structure_entities'").get());
    if (!table) return;
    const sourceRow = rowOrUndefined(
      this.db
        .prepare("SELECT COUNT(*) AS count FROM project_inventory_items WHERE resource_kind IN ('source', 'text') AND scope_version_id IN (SELECT id FROM scope_versions WHERE workspace_id = ?)")
        .get(this.workspaceId)
    );
    if (!sourceRow || numberValue(sourceRow, 'count') === 0) return;
    const structureRow = rowOrUndefined(
      this.db
        .prepare('SELECT COUNT(*) AS count FROM project_structure_entities WHERE scope_version_id IN (SELECT id FROM scope_versions WHERE workspace_id = ?)')
        .get(this.workspaceId)
    );
    if (structureRow && numberValue(structureRow, 'count') > 0) return;
    if (this.getMetaValue('project_structure_index_seeded_v12') === 'true') return;
    for (const row of rows(this.db.prepare('SELECT id FROM scope_versions WHERE workspace_id = ? ORDER BY version ASC').all(this.workspaceId))) {
      this.refreshProjectInventory(text(row, 'id'));
    }
    this.setMetaValue('project_structure_index_seeded_v12', 'true');
  }

  private getMetaValue(key: string): string | null {
    const row = rowOrUndefined(this.db.prepare('SELECT value FROM workspace_meta WHERE key = ?').get(this.metaKey(key)));
    return row ? text(row, 'value') : null;
  }

  private setMetaValue(key: string, value: string, updatedAt = nowIso()): void {
    this.db
      .prepare(
        `INSERT INTO workspace_meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(this.metaKey(key), value, updatedAt);
  }

  private deleteMetaValue(key: string): void {
    this.db.prepare('DELETE FROM workspace_meta WHERE key = ?').run(this.metaKey(key));
  }

  private metaKey(key: string): string {
    if (!this.workspaceId) throw new Error('Workspace identity is not initialized.');
    return `${this.workspaceId}:${key}`;
  }

  private getProjectSemanticJobState(scopeVersionId: string): ProjectSemanticJobState | null {
    const value = this.getMetaValue(projectSemanticJobMetaKey(scopeVersionId));
    if (!value) return null;
    const parsed = parseJson(value);
    const status = parsed.status;
    if (status !== 'queued' && status !== 'indexing' && status !== 'error' && status !== 'canceled') return null;
    return {
      status,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'background_rebuild',
      queuedAt: typeof parsed.queuedAt === 'string' ? parsed.queuedAt : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
      finishedAt: typeof parsed.finishedAt === 'string' ? parsed.finishedAt : null,
      error: typeof parsed.error === 'string' ? parsed.error : null,
      processed: typeof parsed.processed === 'number' && Number.isFinite(parsed.processed) ? parsed.processed : null,
      total: typeof parsed.total === 'number' && Number.isFinite(parsed.total) ? parsed.total : null
    };
  }

  private setProjectSemanticJobState(scopeVersionId: string, state: ProjectSemanticJobState): void {
    this.setMetaValue(projectSemanticJobMetaKey(scopeVersionId), JSON.stringify(state), nowIso());
  }

  private updateProjectSemanticIndexProgress(scopeVersionId: string, processed: number, total: number): void {
    const existing = this.getProjectSemanticJobState(scopeVersionId);
    if (!existing || existing.status !== 'indexing') return;
    this.setProjectSemanticJobState(scopeVersionId, {
      ...existing,
      processed: Math.max(0, Math.floor(processed)),
      total: Math.max(0, Math.floor(total))
    });
  }

  private clearProjectSemanticJobState(scopeVersionId: string): void {
    this.deleteMetaValue(projectSemanticJobMetaKey(scopeVersionId));
  }

  private getProjectSemanticDirtyState(scopeVersionId: string): ProjectSemanticDirtyState | null {
    const value = this.getMetaValue(projectSemanticDirtyMetaKey(scopeVersionId));
    if (!value) return null;
    const parsed = parseJson(value);
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason : 'search_document_changed';
    const markedAt = typeof parsed.markedAt === 'string' ? parsed.markedAt : '';
    return markedAt ? { reason, markedAt } : null;
  }

  private markProjectSemanticIndexDirty(scopeVersionId: string, reason: string): void {
    if (!this.getProjectSemanticIndexEnabled(scopeVersionId)) return;
    const markedAt = nowIso();
    this.setMetaValue(projectSemanticDirtyMetaKey(scopeVersionId), JSON.stringify({ reason, markedAt }), markedAt);
  }

  private clearProjectSemanticDirtyState(scopeVersionId: string, indexedAt?: string): void {
    if (!indexedAt) {
      this.deleteMetaValue(projectSemanticDirtyMetaKey(scopeVersionId));
      return;
    }
    const dirty = this.getProjectSemanticDirtyState(scopeVersionId);
    if (!dirty) return;
    const dirtyTime = Date.parse(dirty.markedAt);
    const indexedTime = Date.parse(indexedAt);
    if (!Number.isFinite(dirtyTime) || !Number.isFinite(indexedTime) || dirtyTime <= indexedTime) {
      this.deleteMetaValue(projectSemanticDirtyMetaKey(scopeVersionId));
    }
  }

  private insertScopeAsset(scopeVersionId: string, asset: ScopeAssetInput, createdAt: string): void {
    this.db
      .prepare(
        `INSERT INTO scope_assets (
          id, scope_version_id, direction, kind, value, attributes_json, sensitivity, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(createId('scope_asset'), scopeVersionId, asset.direction, asset.kind, asset.value, toJson(asset.attributes), asset.sensitivity, createdAt);
  }

  private ensureProjectStructureCoverageIndex(scopeVersionId: string): void {
    const inventory = this.getProjectInventorySummary(scopeVersionId);
    const indexed = this.getMetaValue(`project_source_coverage:${scopeVersionId}:indexed_at`) !== null;
    if (!indexed || (inventory.itemCount > 0 && this.projectInventoryLooksStale(scopeVersionId))) {
      this.refreshProjectStructureCoverageIndex(scopeVersionId);
    }
  }

  private refreshProjectStructureCoverageIndex(scopeVersionId: string): void {
    const scope = this.getScopeVersion(scopeVersionId);
    const indexedAt = nowIso();
    const state: ProjectInventoryScanState = { indexedAt, scannedFiles: 0, skippedCount: 0, truncated: false };
    const localAssets = scope.assets.filter((asset) => asset.direction === 'in_scope' && isAbsolute(asset.value) && !looksLikeProjectUrl(asset.value));

    this.transaction(() => {
      this.db.prepare('DELETE FROM project_inventory_items WHERE scope_version_id = ?').run(scopeVersionId);
      this.db.prepare('DELETE FROM project_structure_relations WHERE scope_version_id = ?').run(scopeVersionId);
      this.db.prepare('DELETE FROM project_structure_entities WHERE scope_version_id = ?').run(scopeVersionId);
      this.deleteProjectSearchDocuments("scope_version_id = ? AND entity_type IN ('inventory_item', 'structure_entity')", [scopeVersionId]);

      for (const asset of localAssets) {
        this.scanProjectInventoryPath(normalizedProjectPath(asset.value), asset, state);
      }
      this.resolveProjectStructureRelationTargets(scopeVersionId);
    });

    this.setMetaValue(
      `project_source_coverage:${scopeVersionId}:indexed_at`,
      JSON.stringify({ indexedAt, rootCount: localAssets.length, skippedCount: state.skippedCount, truncated: state.truncated }),
      indexedAt
    );
  }

  private projectInventoryLooksStale(scopeVersionId: string): boolean {
    const itemRows = rows(
      this.db
        .prepare(
          `SELECT path, item_kind, size_bytes, mtime_ms
           FROM project_inventory_items
           WHERE scope_version_id = ?
             AND item_kind IN ('directory', 'file')
           ORDER BY indexed_at DESC
           LIMIT ?`
        )
        .all(scopeVersionId, PROJECT_INVENTORY_FRESHNESS_MAX_ITEMS)
    );
    if (itemRows.length === 0) return true;

    for (const row of itemRows) {
      const path = text(row, 'path');
      const itemKind = text(row, 'item_kind');
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        return true;
      }
      if (stat.isSymbolicLink()) return true;
      if (itemKind === 'file') {
        if (!stat.isFile()) return true;
        if (numberValue(row, 'size_bytes') !== stat.size) return true;
      } else if (itemKind === 'directory' && !stat.isDirectory()) {
        return true;
      }
      if (numberValue(row, 'mtime_ms') !== Math.round(stat.mtimeMs)) return true;
    }

    return false;
  }

  private projectSemanticIndexLooksStale(scopeVersionId: string, indexedAt: string | null): boolean {
    if (!indexedAt) return true;
    const providerMismatch = rowOrUndefined(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM project_semantic_chunks
           WHERE scope_version_id = ?
             AND (vector_provider <> ? OR vector_model <> ?)`
        )
        .get(scopeVersionId, PROJECT_SEMANTIC_VECTOR_PROVIDER, PROJECT_SEMANTIC_VECTOR_MODEL)
    );
    if (providerMismatch && numberValue(providerMismatch, 'count') > 0) return true;
    const row = rowOrUndefined(this.db.prepare('SELECT MAX(updated_at) AS document_updated_at FROM project_search_documents WHERE scope_version_id = ?').get(scopeVersionId));
    const documentUpdatedAt = row ? nullableText(row, 'document_updated_at') : null;
    return Boolean(documentUpdatedAt && Date.parse(documentUpdatedAt) > Date.parse(indexedAt));
  }

  private getProjectSemanticLastRefreshState(scopeVersionId: string): ProjectSemanticRefreshState | null {
    const value = this.getMetaValue(projectSemanticRefreshMetaKey(scopeVersionId));
    if (!value) return null;
    const parsed = parseJson(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      indexedAt: typeof parsed.indexedAt === 'string' && parsed.indexedAt.trim() ? parsed.indexedAt : null,
      durationMs: typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs) ? parsed.durationMs : null,
      sourceDocumentCount: typeof parsed.sourceDocumentCount === 'number' && Number.isFinite(parsed.sourceDocumentCount) ? Math.max(0, Math.floor(parsed.sourceDocumentCount)) : 0,
      chunkCount: typeof parsed.chunkCount === 'number' && Number.isFinite(parsed.chunkCount) ? Math.max(0, Math.floor(parsed.chunkCount)) : 0,
      indexSizeBytes: typeof parsed.indexSizeBytes === 'number' && Number.isFinite(parsed.indexSizeBytes) ? Math.max(0, Math.floor(parsed.indexSizeBytes)) : 0
    };
  }

  private resolveProjectStructureRelationTargets(scopeVersionId: string): void {
    const unresolved = rows(
      this.db
        .prepare(
          `SELECT r.*, s.path AS source_path
           FROM project_structure_relations r
           JOIN project_structure_entities s ON s.id = r.source_entity_id
           WHERE r.scope_version_id = ?
             AND r.target_entity_id IS NULL
           ORDER BY r.indexed_at ASC`
        )
        .all(scopeVersionId)
    );

    for (const relation of unresolved) {
      const targetKind = text(relation, 'target_kind');
      const targetName = text(relation, 'target_name');
      const entityKinds = projectStructureTargetEntityKinds(targetKind);
      if (entityKinds.length === 0 || !targetName.trim()) continue;
      const placeholders = entityKinds.map(() => '?').join(', ');
      const candidates = rows(
        this.db
          .prepare(
            `SELECT *
             FROM project_structure_entities
             WHERE scope_version_id = ?
               AND LOWER(name) = LOWER(?)
               AND entity_kind IN (${placeholders})
             ORDER BY
               CASE WHEN path = ? THEN 0 ELSE 1 END,
               CASE entity_kind
                 WHEN 'function' THEN 0
                 WHEN 'method' THEN 0
                 WHEN 'class' THEN 1
                 WHEN 'type' THEN 1
                 WHEN 'export' THEN 2
                 WHEN 'route' THEN 3
                 ELSE 4
               END,
               line_start ASC
             LIMIT 1`
          )
          .all(scopeVersionId, targetName, ...entityKinds, text(relation, 'source_path'))
      );
      const target = candidates[0];
      if (!target) continue;
      const metadata = {
        ...parseJson(relation.metadata_json),
        targetResolution: text(target, 'path') === text(relation, 'source_path') ? 'same_file_name_match' : 'scope_name_match',
        targetPath: text(target, 'path'),
        targetLineStart: numberValue(target, 'line_start'),
        targetLineEnd: numberValue(target, 'line_end')
      };
      this.db
        .prepare('UPDATE project_structure_relations SET target_entity_id = ?, metadata_json = ? WHERE id = ?')
        .run(text(target, 'id'), toJson(metadata), text(relation, 'id'));
    }
  }

  private rebuildProjectGraph(scopeVersionId: string, indexedAt: string): void {
    const scope = this.getScopeVersion(scopeVersionId);
    const scopeNodeId = this.upsertProjectGraphNode({
      scopeVersionId,
      entityType: 'scope_version',
      entityId: scopeVersionId,
      nodeKind: 'authorized_scope',
      label: scope.workspaceName,
      sourcePath: null,
      metadata: {
        version: scope.version,
        scopeOwner: scope.scopeOwner,
        status: scope.status
      },
      indexedAt
    });

    for (const asset of scope.assets) {
      const assetNodeId = this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'scope_asset',
        entityId: asset.id,
        nodeKind: `scope_asset:${asset.kind}`,
        label: asset.value,
        sourcePath: isAbsolute(asset.value) ? asset.value : null,
        metadata: {
          direction: asset.direction,
          kind: asset.kind,
          sensitivity: asset.sensitivity,
          attributes: asset.attributes
        },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: assetNodeId,
        edgeKind: 'belongs_to_scope',
        targetNodeId: scopeNodeId,
        targetEntityType: 'scope_version',
        targetEntityId: scopeVersionId,
        targetLabel: scope.workspaceName,
        metadata: { source: 'scope_asset' },
        indexedAt
      });
    }

    const inventoryRows = rows(this.db.prepare('SELECT * FROM project_inventory_items WHERE scope_version_id = ?').all(scopeVersionId));
    for (const row of inventoryRows) {
      const inventoryId = text(row, 'id');
      const path = text(row, 'path');
      const itemKind = text(row, 'item_kind');
      const resourceKind = text(row, 'resource_kind');
      const inventoryNodeId = this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'inventory_item',
        entityId: inventoryId,
        nodeKind: `${itemKind}:${resourceKind}`,
        label: basename(path) || path,
        sourcePath: path,
        metadata: {
          assetId: text(row, 'asset_id'),
          itemKind,
          resourceKind,
          language: text(row, 'language'),
          sizeBytes: nullableNumber(row, 'size_bytes'),
          sha256: nullableText(row, 'sha256'),
          sensitivity: text(row, 'sensitivity')
        },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: inventoryNodeId,
        edgeKind: 'belongs_to_scope',
        targetNodeId: scopeNodeId,
        targetEntityType: 'scope_version',
        targetEntityId: scopeVersionId,
        targetLabel: scope.workspaceName,
        metadata: { source: 'inventory' },
        indexedAt
      });
    }

    const structureRows = rows(this.db.prepare('SELECT * FROM project_structure_entities WHERE scope_version_id = ?').all(scopeVersionId));
    for (const row of structureRows) {
      const structureId = text(row, 'id');
      const inventoryItemId = text(row, 'inventory_item_id');
      const entityKind = text(row, 'entity_kind');
      const name = text(row, 'name');
      const path = text(row, 'path');
      const structureMetadata = parseJson(row.metadata_json);
      const structureNodeId = this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'structure_entity',
        entityId: structureId,
        nodeKind: entityKind,
        label: name,
        sourcePath: path,
        metadata: {
          inventoryItemId,
          assetId: text(row, 'asset_id'),
          signature: text(row, 'signature'),
          language: text(row, 'language'),
          lineStart: numberValue(row, 'line_start'),
          lineEnd: numberValue(row, 'line_end'),
          parentId: nullableText(row, 'parent_id')
        },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: projectGraphNodeId(scopeVersionId, 'inventory_item', inventoryItemId),
        edgeKind: 'defines',
        targetNodeId: structureNodeId,
        targetEntityType: 'structure_entity',
        targetEntityId: structureId,
        targetLabel: name,
        metadata: { source: 'structure_entity', path },
        indexedAt
      });
      const binaryGraphEdgeKind = stringFromUnknown(structureMetadata.relationKind) ?? '';
      if (structureMetadata.binaryDerived === true && BINARY_GRAPH_EDGE_KINDS.has(binaryGraphEdgeKind)) {
        this.insertProjectGraphEdge({
          scopeVersionId,
          sourceNodeId: projectGraphNodeId(scopeVersionId, 'inventory_item', inventoryItemId),
          edgeKind: binaryGraphEdgeKind,
          targetNodeId: structureNodeId,
          targetEntityType: 'structure_entity',
          targetEntityId: structureId,
          targetLabel: name,
          metadata: {
            source: 'binary_structure',
            path,
            entityKind,
            binaryStringKind: structureMetadata.binaryStringKind ?? null,
            binarySymbolRole: structureMetadata.binarySymbolRole ?? null
          },
          indexedAt
        });
      }
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: structureNodeId,
        edgeKind: 'belongs_to_scope',
        targetNodeId: scopeNodeId,
        targetEntityType: 'scope_version',
        targetEntityId: scopeVersionId,
        targetLabel: scope.workspaceName,
        metadata: { source: 'structure_entity' },
        indexedAt
      });
    }

    const relationRows = rows(this.db.prepare('SELECT * FROM project_structure_relations WHERE scope_version_id = ?').all(scopeVersionId));
    for (const row of relationRows) {
      const sourceEntityId = text(row, 'source_entity_id');
      const targetEntityId = nullableText(row, 'target_entity_id');
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: projectGraphNodeId(scopeVersionId, 'structure_entity', sourceEntityId),
        edgeKind: text(row, 'relation_kind'),
        targetNodeId: targetEntityId ? projectGraphNodeId(scopeVersionId, 'structure_entity', targetEntityId) : null,
        targetEntityType: targetEntityId ? 'structure_entity' : text(row, 'target_kind'),
        targetEntityId,
        targetLabel: text(row, 'target_name'),
        metadata: {
          ...parseJson(row.metadata_json),
          source: 'structure_relation',
          structureRelationId: text(row, 'id'),
          targetKind: text(row, 'target_kind')
        },
        indexedAt
      });
    }

    const lineageRunSql = this.scopeVersionLineagePredicate('scope_version_id');
    const joinedLineageRunSql = this.scopeVersionLineagePredicate('r.scope_version_id');
    const runRows = rows(this.db.prepare(`SELECT * FROM runs WHERE ${lineageRunSql}`).all(scopeVersionId));
    for (const row of runRows) {
      const run = this.mapRun(row);
      const runNodeId = this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'run',
        entityId: run.id,
        nodeKind: 'run',
        label: run.title,
        sourcePath: run.targetPath,
        metadata: {
          status: run.status,
          mode: run.mode,
          model: run.model,
          targetAssetId: run.targetAssetId,
          sandboxProfile: run.sandboxProfile
        },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: runNodeId,
        edgeKind: 'belongs_to_scope',
        targetNodeId: scopeNodeId,
        targetEntityType: 'scope_version',
        targetEntityId: scopeVersionId,
        targetLabel: scope.workspaceName,
        metadata: { source: 'run' },
        indexedAt
      });
    }

    const traceRows = rows(this.db.prepare(`SELECT * FROM trace_events WHERE run_id IN (SELECT id FROM runs WHERE ${lineageRunSql})`).all(scopeVersionId));
    for (const row of traceRows) {
      const event = this.mapTraceEvent(row);
      const traceNodeId = this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'trace_event',
        entityId: event.id,
        nodeKind: `trace:${event.type}`,
        label: event.summary,
        sourcePath: null,
        metadata: {
          runId: event.runId,
          sequence: event.sequence,
          type: event.type,
          source: event.source,
          modelVisible: event.modelVisible,
          artifactId: event.artifactId,
          toolCallId: event.toolCallId
        },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: traceNodeId,
        edgeKind: 'belongs_to_run',
        targetNodeId: projectGraphNodeId(scopeVersionId, 'run', event.runId),
        targetEntityType: 'run',
        targetEntityId: event.runId,
        targetLabel: event.runId,
        metadata: { source: 'trace_event' },
        indexedAt
      });
    }

    const transcriptRows = rows(this.db.prepare(`SELECT * FROM transcript_messages WHERE run_id IN (SELECT id FROM runs WHERE ${lineageRunSql})`).all(scopeVersionId));
    for (const row of transcriptRows) {
      const message = this.mapTranscriptMessage(row);
      const transcriptNodeId = this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'transcript',
        entityId: message.id,
        nodeKind: `transcript:${message.role}`,
        label: message.contentMarkdown.slice(0, 160) || message.source,
        sourcePath: null,
        metadata: {
          runId: message.runId,
          attemptId: message.attemptId,
          traceEventId: message.traceEventId,
          role: message.role,
          source: message.source
        },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: transcriptNodeId,
        edgeKind: 'belongs_to_run',
        targetNodeId: projectGraphNodeId(scopeVersionId, 'run', message.runId),
        targetEntityType: 'run',
        targetEntityId: message.runId,
        targetLabel: message.runId,
        metadata: { source: 'transcript' },
        indexedAt
      });
      if (message.traceEventId) {
        this.insertProjectGraphEdge({
          scopeVersionId,
          sourceNodeId: transcriptNodeId,
          edgeKind: 'derived_from_trace',
          targetNodeId: projectGraphNodeId(scopeVersionId, 'trace_event', message.traceEventId),
          targetEntityType: 'trace_event',
          targetEntityId: message.traceEventId,
          targetLabel: message.traceEventId,
          metadata: { source: 'transcript' },
          indexedAt
        });
      }
    }

    const artifactRows = rows(
      this.db
        .prepare(
          `SELECT DISTINCT a.*
           FROM artifacts a
           JOIN trace_events t ON t.artifact_id = a.id
           JOIN runs r ON r.id = t.run_id
           WHERE ${joinedLineageRunSql}`
        )
        .all(scopeVersionId)
    );
    const workspaceRoot = dirname(dirname(this.databasePath));
    for (const row of artifactRows) {
      const artifact = this.mapArtifact(row);
      this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'artifact',
        entityId: artifact.id,
        nodeKind: `artifact:${artifact.kind}`,
        label: artifact.id,
        sourcePath: join(workspaceRoot, artifact.relativePath),
        metadata: {
          kind: artifact.kind,
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
          sensitivity: artifact.sensitivity,
          modelVisible: artifact.modelVisible,
          source: artifact.source,
          provenanceTraceEventId: artifact.provenanceTraceEventId
        },
        indexedAt
      });
      if (artifact.provenanceTraceEventId) {
        this.insertProjectGraphEdge({
          scopeVersionId,
          sourceNodeId: projectGraphNodeId(scopeVersionId, 'artifact', artifact.id),
          edgeKind: 'produced_by_trace',
          targetNodeId: this.projectGraphNodeIdIfExists(scopeVersionId, 'trace_event', artifact.provenanceTraceEventId),
          targetEntityType: 'trace_event',
          targetEntityId: artifact.provenanceTraceEventId,
          targetLabel: artifact.provenanceTraceEventId,
          metadata: { source: 'artifact_provenance' },
          indexedAt
        });
      }
    }

    for (const row of traceRows) {
      const event = this.mapTraceEvent(row);
      if (!event.artifactId) continue;
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: projectGraphNodeId(scopeVersionId, 'trace_event', event.id),
        edgeKind: 'produced_artifact',
        targetNodeId: this.projectGraphNodeIdIfExists(scopeVersionId, 'artifact', event.artifactId),
        targetEntityType: 'artifact',
        targetEntityId: event.artifactId,
        targetLabel: event.artifactId,
        metadata: { source: 'trace_event' },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: this.projectGraphNodeIdIfExists(scopeVersionId, 'artifact', event.artifactId) ?? projectGraphNodeId(scopeVersionId, 'artifact', event.artifactId),
        edgeKind: 'produced_by_trace',
        targetNodeId: projectGraphNodeId(scopeVersionId, 'trace_event', event.id),
        targetEntityType: 'trace_event',
        targetEntityId: event.id,
        targetLabel: event.id,
        metadata: { source: 'artifact_provenance', runId: event.runId },
        indexedAt
      });
    }

    const contractRows = rows(this.db.prepare(`SELECT * FROM verifier_contracts WHERE run_id IN (SELECT id FROM runs WHERE ${lineageRunSql})`).all(scopeVersionId));
    for (const row of contractRows) {
      const contract = this.mapVerifierContract(row);
      const nodeId = this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'verifier_contract',
        entityId: contract.id,
        nodeKind: `verifier_contract:${contract.mode}`,
        label: `${contract.mode} verifier contract`,
        sourcePath: null,
        metadata: {
          runId: contract.runId,
          status: contract.status,
          memoryNodeId: contract.memoryNodeId
        },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: nodeId,
        edgeKind: 'belongs_to_run',
        targetNodeId: projectGraphNodeId(scopeVersionId, 'run', contract.runId),
        targetEntityType: 'run',
        targetEntityId: contract.runId,
        targetLabel: contract.runId,
        metadata: { source: 'verifier_contract' },
        indexedAt
      });
    }

    const verifierRunRows = rows(this.db.prepare(`SELECT * FROM verifier_runs WHERE run_id IN (SELECT id FROM runs WHERE ${lineageRunSql})`).all(scopeVersionId));
    for (const row of verifierRunRows) {
      const verifierRun = this.mapVerifierRun(row);
      const nodeId = this.upsertProjectGraphNode({
        scopeVersionId,
        entityType: 'verifier_run',
        entityId: verifierRun.id,
        nodeKind: `verifier_run:${verifierRun.status}`,
        label: `${verifierRun.status} verifier run`,
        sourcePath: null,
        metadata: {
          runId: verifierRun.runId,
          contractId: verifierRun.contractId,
          status: verifierRun.status,
          vmContextId: verifierRun.vmContextId,
          artifactId: stringFromUnknown(verifierRun.result.artifactId)
        },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: nodeId,
        edgeKind: 'belongs_to_run',
        targetNodeId: projectGraphNodeId(scopeVersionId, 'run', verifierRun.runId),
        targetEntityType: 'run',
        targetEntityId: verifierRun.runId,
        targetLabel: verifierRun.runId,
        metadata: { source: 'verifier_run' },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: nodeId,
        edgeKind: 'runs_verifier_contract',
        targetNodeId: this.projectGraphNodeIdIfExists(scopeVersionId, 'verifier_contract', verifierRun.contractId),
        targetEntityType: 'verifier_contract',
        targetEntityId: verifierRun.contractId,
        targetLabel: verifierRun.contractId,
        metadata: { source: 'verifier_run' },
        indexedAt
      });
      this.insertProjectGraphEdge({
        scopeVersionId,
        sourceNodeId: this.projectGraphNodeIdIfExists(scopeVersionId, 'verifier_contract', verifierRun.contractId) ?? projectGraphNodeId(scopeVersionId, 'verifier_contract', verifierRun.contractId),
        edgeKind: 'has_verifier_run',
        targetNodeId: nodeId,
        targetEntityType: 'verifier_run',
        targetEntityId: verifierRun.id,
        targetLabel: `${verifierRun.status} verifier run`,
        metadata: { source: 'verifier_run', status: verifierRun.status },
        indexedAt
      });
      const verifierArtifactId = stringFromUnknown(verifierRun.result.artifactId);
      if (verifierArtifactId) {
        this.insertProjectGraphEdge({
          scopeVersionId,
          sourceNodeId: nodeId,
          edgeKind: 'produced_artifact',
          targetNodeId: this.projectGraphNodeIdIfExists(scopeVersionId, 'artifact', verifierArtifactId),
          targetEntityType: 'artifact',
          targetEntityId: verifierArtifactId,
          targetLabel: verifierArtifactId,
          metadata: { source: 'verifier_run' },
          indexedAt
        });
      }
    }

    this.resolveProjectGraphEdgeTargets(scopeVersionId);
  }

  private scanProjectInventoryPath(path: string, asset: ScopeAsset, state: ProjectInventoryScanState): void {
    if (state.scannedFiles >= PROJECT_INVENTORY_MAX_FILES) {
      state.truncated = true;
      return;
    }

    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      state.skippedCount += 1;
      return;
    }
    if (stat.isSymbolicLink()) {
      state.skippedCount += 1;
      return;
    }

    if (stat.isDirectory()) {
      this.insertProjectInventoryItem({
        scopeVersionId: asset.scopeVersionId,
        asset,
        itemKind: 'directory',
        resourceKind: 'directory',
        absolutePath: path,
        language: '',
        sizeBytes: null,
        mtimeMs: Math.round(stat.mtimeMs),
        sha256: null,
        metadata: {
          relativePath: safeRelativePath(asset.value, path),
          assetKind: asset.kind
        },
        indexedAt: state.indexedAt
      });

      let entries: string[];
      try {
        entries = readdirSync(path);
      } catch {
        state.skippedCount += 1;
        return;
      }
      for (const entry of entries) {
        if (shouldSkipProjectIndexEntry(entry)) continue;
        this.scanProjectInventoryPath(join(path, entry), asset, state);
        if (state.truncated) return;
      }
      return;
    }

    if (!stat.isFile()) {
      state.skippedCount += 1;
      return;
    }

    state.scannedFiles += 1;
    const resourceKind = classifyProjectResourceKind(path, false);
    const sizeBytes = stat.size;
    const preview = readProjectSearchPreview(path, resourceKind, sizeBytes);
    const manifestMetadata = resourceKind === 'manifest' ? parseProjectManifestMetadata(path, preview) : {};
    this.insertProjectInventoryItem({
      scopeVersionId: asset.scopeVersionId,
      asset,
      itemKind: 'file',
      resourceKind,
      absolutePath: path,
      language: languageForProjectPath(path),
      sizeBytes,
      mtimeMs: Math.round(stat.mtimeMs),
      sha256: hashProjectFileIfCheap(path, sizeBytes),
      metadata: {
        relativePath: safeRelativePath(asset.value, path),
        extension: extname(path).toLowerCase(),
        assetKind: asset.kind,
        previewIndexed: preview.length > 0,
        binaryStringsIndexed: resourceKind === 'binary' && preview.length > 0,
        hashIndexed: sizeBytes <= PROJECT_INVENTORY_HASH_MAX_BYTES,
        manifest: manifestMetadata
      },
      indexedAt: state.indexedAt
    });
  }

  private insertProjectInventoryItem(input: ProjectInventoryInsertInput): void {
    const value = input.absolutePath;
    const id = projectInventoryItemId(input.scopeVersionId, input.asset.id, input.itemKind, value);
    const metadata = {
      ...input.metadata,
      assetId: input.asset.id,
      assetKind: input.asset.kind,
      assetValue: input.asset.value,
      itemKind: input.itemKind,
      resourceKind: input.resourceKind
    };
    this.db
      .prepare(
        `INSERT INTO project_inventory_items (
          id, scope_version_id, asset_id, item_kind, resource_kind, path, value,
          language, size_bytes, mtime_ms, sha256, sensitivity, metadata_json, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_version_id, asset_id, item_kind, value)
        DO UPDATE SET
          resource_kind = excluded.resource_kind,
          path = excluded.path,
          language = excluded.language,
          size_bytes = excluded.size_bytes,
          mtime_ms = excluded.mtime_ms,
          sha256 = excluded.sha256,
          sensitivity = excluded.sensitivity,
          metadata_json = excluded.metadata_json,
          indexed_at = excluded.indexed_at`
      )
      .run(
        id,
        input.scopeVersionId,
        input.asset.id,
        input.itemKind,
        input.resourceKind,
        input.absolutePath,
        value,
        input.language,
        input.sizeBytes,
        input.mtimeMs,
        input.sha256,
        input.asset.sensitivity,
        toJson(metadata),
        input.indexedAt
      );

    const title = `${input.resourceKind} ${basename(input.absolutePath)}`;
    const body = [
      input.absolutePath,
      safeRelativePath(input.asset.value, input.absolutePath),
      input.itemKind,
      input.resourceKind,
      input.language,
      input.sha256,
      JSON.stringify(metadata),
      readProjectSearchPreview(input.absolutePath, input.resourceKind, input.sizeBytes ?? 0)
    ]
      .filter(Boolean)
      .join('\n');
    this.upsertProjectSearchDocument({
      scopeVersionId: input.scopeVersionId,
      entityType: 'inventory_item',
      entityId: id,
      title,
      body,
      sourcePath: input.absolutePath,
      metadata,
      createdAt: input.indexedAt,
      updatedAt: input.indexedAt
    });

    if (input.itemKind === 'file' && (input.resourceKind === 'source' || input.resourceKind === 'text' || input.resourceKind === 'manifest') && input.sizeBytes !== null) {
      this.indexProjectStructureForFile(input, id);
    } else if (input.itemKind === 'file' && input.resourceKind === 'binary' && input.sizeBytes !== null) {
      this.indexProjectBinaryStructureForFile(input, id);
    }
  }

  private indexProjectBinaryStructureForFile(input: ProjectInventoryInsertInput, inventoryItemId: string): void {
    const preview = readProjectBinaryStringsPreview(input.absolutePath, input.sizeBytes ?? 0);
    if (!preview.trim()) return;
    const indexedAt = input.indexedAt;
    const seen = new Set<string>();
    let lineStart = 1;
    for (const value of preview.split(/\r?\n/)) {
      if (seen.size >= PROJECT_STRUCTURE_BINARY_MAX_ENTITIES_PER_FILE) break;
      const candidate = binaryStructureCandidate(value, lineStart);
      lineStart += 1;
      if (!candidate) continue;
      const key = `${candidate.entityKind}:${candidate.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entityId = this.insertProjectStructureEntity({
        scopeVersionId: input.scopeVersionId,
        inventoryItemId,
        assetId: input.asset.id,
        entityKind: candidate.entityKind,
        name: candidate.name,
        signature: candidate.signature,
        path: input.absolutePath,
        language: input.language || 'binary',
        lineStart: candidate.lineStart,
        lineEnd: candidate.lineEnd ?? candidate.lineStart,
        metadata: {
          ...candidate.metadata,
          relativePath: safeRelativePath(input.asset.value, input.absolutePath),
          assetKind: input.asset.kind,
          resourceKind: input.resourceKind,
          binaryDerived: true
        },
        indexedAt
      });
      for (const relation of candidate.relations ?? []) {
        this.insertProjectStructureRelation({
          scopeVersionId: input.scopeVersionId,
          sourceEntityId: entityId,
          relationKind: relation.relationKind,
          targetKind: relation.targetKind,
          targetName: relation.targetName,
          targetEntityId: null,
          metadata: relation.metadata ?? {},
          indexedAt
        });
      }
    }
  }

  private indexProjectStructureForFile(input: ProjectInventoryInsertInput, inventoryItemId: string): void {
    const text = readProjectStructureText(input.absolutePath, input.resourceKind, input.sizeBytes ?? 0);
    if (!text) return;
    const candidates = extractProjectStructureCandidates(input.absolutePath, input.language, text.text, text.truncated);
    const inserted: Array<{ candidate: ProjectStructureCandidate; entityId: string }> = [];
    const ownerForCandidate = (candidate: ProjectStructureCandidate): ProjectStructureCandidate | null => {
      if (projectStructureEntityOwnsRange(candidate.entityKind)) return null;
      return (
        candidates
          .filter((owner) => owner !== candidate && projectStructureEntityOwnsRange(owner.entityKind) && owner.lineStart < candidate.lineStart && (owner.lineEnd ?? owner.lineStart) >= candidate.lineStart)
          .sort((left, right) => right.lineStart - left.lineStart || (left.lineEnd ?? left.lineStart) - (right.lineEnd ?? right.lineStart))[0] ?? null
      );
    };

    for (const candidate of candidates) {
      const owner = ownerForCandidate(candidate);
      const parentId = owner ? projectStructureEntityId(input.scopeVersionId, input.absolutePath, owner.entityKind, owner.name, owner.lineStart) : null;
      const entityId = this.insertProjectStructureEntity({
        scopeVersionId: input.scopeVersionId,
        inventoryItemId,
        assetId: input.asset.id,
        entityKind: candidate.entityKind,
        name: candidate.name,
        signature: candidate.signature,
        path: input.absolutePath,
        language: input.language,
        lineStart: candidate.lineStart,
        lineEnd: candidate.lineEnd ?? candidate.lineStart,
        parentId,
        metadata: {
          ...candidate.metadata,
          relativePath: safeRelativePath(input.asset.value, input.absolutePath),
          assetKind: input.asset.kind,
          resourceKind: input.resourceKind,
          ownerKind: owner?.entityKind ?? null,
          ownerName: owner?.name ?? null,
          ownerLineStart: owner?.lineStart ?? null,
          ownerLineEnd: owner?.lineEnd ?? null
        },
        indexedAt: input.indexedAt
      });
      inserted.push({ candidate, entityId });
    }

    for (const { candidate, entityId } of inserted) {
      for (const relation of candidate.relations ?? []) {
        const targetEntityId =
          relation.targetEntityId ??
          inserted.find((candidateRecord) => projectStructureCandidateMatchesRelationTarget(candidateRecord.candidate, relation))?.entityId ??
          null;
        this.insertProjectStructureRelation({
          scopeVersionId: input.scopeVersionId,
          sourceEntityId: entityId,
          relationKind: relation.relationKind,
          targetKind: relation.targetKind,
          targetName: relation.targetName,
          targetEntityId,
          metadata: relation.metadata ?? {},
          indexedAt: input.indexedAt
        });
      }
    }
  }

  private insertProjectStructureEntity(input: ProjectStructureEntityInput): string {
    const id = projectStructureEntityId(input.scopeVersionId, input.path, input.entityKind, input.name, input.lineStart);
    this.db
      .prepare(
        `INSERT INTO project_structure_entities (
          id, scope_version_id, inventory_item_id, asset_id, entity_kind, name, signature,
          path, language, line_start, line_end, parent_id, metadata_json, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_version_id, path, entity_kind, name, line_start)
        DO UPDATE SET
          inventory_item_id = excluded.inventory_item_id,
          asset_id = excluded.asset_id,
          signature = excluded.signature,
          language = excluded.language,
          line_end = excluded.line_end,
          parent_id = excluded.parent_id,
          metadata_json = excluded.metadata_json,
          indexed_at = excluded.indexed_at`
      )
      .run(
        id,
        input.scopeVersionId,
        input.inventoryItemId,
        input.assetId,
        input.entityKind,
        input.name,
        input.signature,
        input.path,
        input.language,
        input.lineStart,
        input.lineEnd,
        input.parentId ?? null,
        toJson(input.metadata),
        input.indexedAt
      );

    this.upsertProjectSearchDocument({
      scopeVersionId: input.scopeVersionId,
      entityType: 'structure_entity',
      entityId: id,
      title: `${input.entityKind} ${input.name}`,
      body: [
        input.entityKind,
        input.name,
        input.signature,
        input.path,
        input.language,
        `line ${input.lineStart}`,
        JSON.stringify(input.metadata)
      ].join('\n'),
      sourcePath: input.path,
      metadata: {
        ...input.metadata,
        structureEntityId: id,
        inventoryItemId: input.inventoryItemId,
        assetId: input.assetId,
        entityKind: input.entityKind,
        name: input.name,
        signature: input.signature,
        language: input.language,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
        parentId: input.parentId ?? null
      },
      createdAt: input.indexedAt,
      updatedAt: input.indexedAt
    });
    return id;
  }

  private insertProjectStructureRelation(input: ProjectStructureRelationInput): void {
    const id = projectStructureRelationId(input.scopeVersionId, input.sourceEntityId, input.relationKind, input.targetKind, input.targetName);
    this.db
      .prepare(
        `INSERT INTO project_structure_relations (
          id, scope_version_id, source_entity_id, relation_kind, target_kind,
          target_name, target_entity_id, metadata_json, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_version_id, source_entity_id, relation_kind, target_kind, target_name)
        DO UPDATE SET
          target_entity_id = excluded.target_entity_id,
          metadata_json = excluded.metadata_json,
          indexed_at = excluded.indexed_at`
      )
      .run(
        id,
        input.scopeVersionId,
        input.sourceEntityId,
        input.relationKind,
        input.targetKind,
        input.targetName,
        input.targetEntityId ?? null,
        toJson(input.metadata),
        input.indexedAt
      );
  }

  private upsertProjectGraphNode(input: {
    scopeVersionId: string;
    entityType: string;
    entityId: string;
    nodeKind: string;
    label: string;
    sourcePath: string | null;
    metadata: Record<string, unknown>;
    indexedAt: string;
  }): string {
    const id = projectGraphNodeId(input.scopeVersionId, input.entityType, input.entityId);
    this.db
      .prepare(
        `INSERT INTO project_graph_nodes (
          id, scope_version_id, node_kind, entity_type, entity_id,
          label, source_path, metadata_json, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_version_id, entity_type, entity_id)
        DO UPDATE SET
          node_kind = excluded.node_kind,
          label = excluded.label,
          source_path = excluded.source_path,
          metadata_json = excluded.metadata_json,
          indexed_at = excluded.indexed_at`
      )
      .run(
        id,
        input.scopeVersionId,
        input.nodeKind,
        input.entityType,
        input.entityId,
        input.label,
        input.sourcePath,
        toJson(input.metadata),
        input.indexedAt
      );
    return id;
  }

  private insertProjectGraphEdge(input: {
    scopeVersionId: string;
    sourceNodeId: string;
    edgeKind: string;
    targetNodeId: string | null;
    targetEntityType: string;
    targetEntityId: string | null;
    targetLabel: string;
    metadata: Record<string, unknown>;
    indexedAt: string;
  }): void {
    const id = projectGraphEdgeId(input.scopeVersionId, input.sourceNodeId, input.edgeKind, input.targetEntityType, input.targetEntityId, input.targetLabel);
    this.db
      .prepare(
        `INSERT INTO project_graph_edges (
          id, scope_version_id, source_node_id, edge_kind, target_node_id,
          target_entity_type, target_entity_id, target_label, metadata_json, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_version_id, source_node_id, edge_kind, target_entity_type, target_entity_id, target_label)
        DO UPDATE SET
          target_node_id = excluded.target_node_id,
          metadata_json = excluded.metadata_json,
          indexed_at = excluded.indexed_at`
      )
      .run(
        id,
        input.scopeVersionId,
        input.sourceNodeId,
        input.edgeKind,
        input.targetNodeId,
        input.targetEntityType,
        input.targetEntityId,
        input.targetLabel,
        toJson(input.metadata),
        input.indexedAt
      );
  }

  private resolveProjectGraphEdgeTargets(scopeVersionId: string): void {
    const unresolved = rows(
      this.db
        .prepare(
          `SELECT id, target_entity_type, target_entity_id
           FROM project_graph_edges
           WHERE scope_version_id = ?
             AND target_node_id IS NULL
             AND target_entity_id IS NOT NULL`
        )
        .all(scopeVersionId)
    );
    for (const edge of unresolved) {
      const targetNodeId = this.projectGraphNodeIdIfExists(scopeVersionId, text(edge, 'target_entity_type'), text(edge, 'target_entity_id'));
      if (targetNodeId) {
        this.db.prepare('UPDATE project_graph_edges SET target_node_id = ? WHERE id = ?').run(targetNodeId, text(edge, 'id'));
      }
    }
  }

  private insertProjectSemanticChunk(input: ProjectSemanticChunkInput): void {
    const id = projectSemanticChunkId(input.scopeVersionId, input.sourceDocumentId, input.chunkIndex, input.contentHash);
    this.db
      .prepare(
        `INSERT INTO project_semantic_chunks (
          id, scope_version_id, run_id, source_document_id, namespace, entity_type,
          entity_id, title, content, content_hash, source_path, chunk_index,
          token_count, vector_provider, vector_model, vector_json, metadata_json, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_version_id, source_document_id, chunk_index, content_hash)
        DO UPDATE SET
          run_id = excluded.run_id,
          namespace = excluded.namespace,
          entity_type = excluded.entity_type,
          entity_id = excluded.entity_id,
          title = excluded.title,
          content = excluded.content,
          source_path = excluded.source_path,
          token_count = excluded.token_count,
          vector_provider = excluded.vector_provider,
          vector_model = excluded.vector_model,
          vector_json = excluded.vector_json,
          metadata_json = excluded.metadata_json,
          indexed_at = excluded.indexed_at`
      )
      .run(
        id,
        input.scopeVersionId,
        input.runId ?? null,
        input.sourceDocumentId,
        input.namespace,
        input.entityType,
        input.entityId,
        input.title,
        input.content,
        input.contentHash,
        input.sourcePath ?? null,
        input.chunkIndex,
        input.tokenCount,
        input.vectorProvider,
        input.vectorModel,
        toJson(input.vector),
        toJson(input.metadata),
        input.indexedAt
      );
  }

  private deleteProjectSearchDocuments(whereSql: string, params: SqlPrimitive[]): void {
    const docRows = rows(this.db.prepare(`SELECT id, scope_version_id FROM project_search_documents WHERE ${whereSql}`).all(...params));
    const affectedScopeVersionIds = new Set<string>();
    for (const row of docRows) {
      this.db.prepare('DELETE FROM project_search_fts WHERE document_id = ?').run(text(row, 'id'));
      affectedScopeVersionIds.add(text(row, 'scope_version_id'));
    }
    this.db.prepare(`DELETE FROM project_search_documents WHERE ${whereSql}`).run(...params);
    for (const scopeVersionId of affectedScopeVersionIds) {
      this.markProjectSemanticIndexDirty(scopeVersionId, 'search_document_changed');
    }
  }

  private upsertProjectSearchDocument(input: ProjectSearchDocumentInput): void {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    const id = projectSearchDocumentId(input.scopeVersionId, input.entityType, input.entityId);
    const body = input.body.trim();
    const title = input.title.trim() || `${input.entityType} ${input.entityId}`;
    const sourcePath = input.sourcePath && input.sourcePath.length > 0 ? input.sourcePath : null;
    const metadataJson = toJson(input.metadata);
    const existing = rowOrUndefined(this.db.prepare('SELECT title, body, source_path, metadata_json FROM project_search_documents WHERE id = ?').get(id));
    const meaningfulChange =
      !existing ||
      text(existing, 'title') !== title ||
      text(existing, 'body') !== body ||
      (nullableText(existing, 'source_path') ?? null) !== sourcePath ||
      text(existing, 'metadata_json') !== metadataJson;
    this.db
      .prepare(
        `INSERT INTO project_search_documents (
          id, scope_version_id, run_id, entity_type, entity_id, title, body,
          source_path, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          run_id = excluded.run_id,
          title = excluded.title,
          body = excluded.body,
          source_path = excluded.source_path,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.scopeVersionId,
        input.runId ?? null,
        input.entityType,
        input.entityId,
        title,
        body,
        sourcePath,
        metadataJson,
        createdAt,
        updatedAt
      );
    this.db.prepare('DELETE FROM project_search_fts WHERE document_id = ?').run(id);
    this.db
      .prepare(
        `INSERT INTO project_search_fts (
          document_id, scope_version_id, run_id, entity_type, entity_id, title, body
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.scopeVersionId, input.runId ?? null, input.entityType, input.entityId, title, body);
    if (meaningfulChange) {
      this.markProjectSemanticIndexDirty(input.scopeVersionId, 'search_document_changed');
    }
  }

  private indexRunSearchDocument(run: RunRecord): void {
    this.upsertProjectSearchDocument({
      scopeVersionId: run.scopeVersionId,
      runId: run.id,
      entityType: 'run',
      entityId: run.id,
      title: run.title || 'Untitled research session',
      body: [run.promptMarkdown, run.mode, run.status, run.summary, run.model, run.reasoningEffort, run.sandboxProfile, run.targetPath, JSON.stringify(run.finalDisposition)].join('\n'),
      sourcePath: run.targetPath,
      metadata: {
        status: run.status,
        mode: run.mode,
        model: run.model,
        reasoningEffort: run.reasoningEffort,
        sandboxProfile: run.sandboxProfile,
        targetAssetId: run.targetAssetId,
        targetPath: run.targetPath,
        finalDisposition: run.finalDisposition
      },
      createdAt: run.createdAt,
      updatedAt: run.endedAt ?? run.startedAt ?? run.createdAt
    });
  }

  private indexTranscriptSearchDocument(message: TranscriptMessageRecord): void {
    const run = this.getRun(message.runId);
    if (!run) return;
    this.upsertProjectSearchDocument({
      scopeVersionId: run.scopeVersionId,
      runId: message.runId,
      entityType: 'transcript',
      entityId: message.id,
      title: `${message.role} transcript from ${message.source}`,
      body: message.contentMarkdown,
      metadata: {
        role: message.role,
        source: message.source,
        traceEventId: message.traceEventId,
        metadata: message.metadata
      },
      createdAt: message.createdAt,
      updatedAt: message.createdAt
    });
  }

  private indexTraceSearchDocument(event: TraceEventRecord): void {
    if (!event.modelVisible) return;
    const run = this.getRun(event.runId);
    if (!run) return;
    this.upsertProjectSearchDocument({
      scopeVersionId: run.scopeVersionId,
      runId: event.runId,
      entityType: 'trace_event',
      entityId: event.id,
      title: event.summary,
      body: [event.type, event.source, event.summary, JSON.stringify(redactSearchPayload(event.payload))].join('\n'),
      metadata: {
        type: event.type,
        source: event.source,
        sequence: event.sequence,
        artifactId: event.artifactId,
        toolCallId: event.toolCallId
      },
      createdAt: event.createdAt,
      updatedAt: event.createdAt
    });
  }

  private indexArtifactSearchDocument(artifact: ArtifactRecord): void {
    if (!artifact.modelVisible) return;
    const runRow = rowOrUndefined(
      this.db
        .prepare(
          `SELECT run_id FROM trace_events
           WHERE artifact_id = ?
           ORDER BY created_at ASC
           LIMIT 1`
        )
        .get(artifact.id)
    );
    const run = runRow ? this.getRun(text(runRow, 'run_id')) : null;
    if (!run) return;
    const workspaceRoot = dirname(dirname(this.databasePath));
    const artifactPath = join(workspaceRoot, artifact.relativePath);
    let contentPreview = '';
    if (artifact.sizeBytes <= PROJECT_INVENTORY_PREVIEW_MAX_BYTES) {
      try {
        const buffer = readFileSync(artifactPath);
        if (projectBufferLooksTextual(buffer)) contentPreview = buffer.toString('utf8').slice(0, PROJECT_INVENTORY_PREVIEW_MAX_BYTES);
      } catch {
        contentPreview = '';
      }
    }
    this.upsertProjectSearchDocument({
      scopeVersionId: run.scopeVersionId,
      runId: run.id,
      entityType: 'artifact',
      entityId: artifact.id,
      title: `${artifact.kind} artifact ${artifact.id}`,
      body: [artifact.id, artifact.kind, artifact.sha256, artifact.relativePath, JSON.stringify(artifact.metadata), contentPreview].join('\n'),
      sourcePath: artifactPath,
      metadata: {
        kind: artifact.kind,
        sha256: artifact.sha256,
        relativePath: artifact.relativePath,
        sizeBytes: artifact.sizeBytes,
        mimeType: artifact.mimeType,
        source: artifact.source,
        metadata: artifact.metadata
      },
      createdAt: artifact.createdAt,
      updatedAt: artifact.createdAt
    });
  }

  private indexVerifierContractSearchDocument(contract: VerifierContractRecord): void {
    const run = this.getRun(contract.runId);
    if (!run) return;
    this.upsertProjectSearchDocument({
      scopeVersionId: run.scopeVersionId,
      runId: contract.runId,
      entityType: 'verifier_contract',
      entityId: contract.id,
      title: `${contract.mode} verifier contract`,
      body: [
        contract.status,
        contract.setupStepsMarkdown,
        contract.triggerStepsMarkdown,
        JSON.stringify(contract.expectedObservations),
        JSON.stringify(contract.invariants),
        JSON.stringify(contract.artifactsToCollect),
        JSON.stringify(contract.passCriteria)
      ].join('\n'),
      metadata: {
        status: contract.status,
        mode: contract.mode,
        memoryNodeId: contract.memoryNodeId
      },
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt
    });
  }

  private indexVerifierRunSearchDocument(verifierRun: VerifierRunRecord): void {
    const run = this.getRun(verifierRun.runId);
    if (!run) return;
    this.upsertProjectSearchDocument({
      scopeVersionId: run.scopeVersionId,
      runId: verifierRun.runId,
      entityType: 'verifier_run',
      entityId: verifierRun.id,
      title: `${verifierRun.status} verifier run`,
      body: [
        verifierRun.status,
        verifierRun.blockedIssue,
        verifierRun.behaviorPreserved,
        verifierRun.diagnosticsClean,
        verifierRun.regressionTests,
        JSON.stringify(verifierRun.result)
      ].join('\n'),
      metadata: {
        contractId: verifierRun.contractId,
        status: verifierRun.status,
        vmContextId: verifierRun.vmContextId,
        result: verifierRun.result
      },
      createdAt: verifierRun.startedAt,
      updatedAt: verifierRun.endedAt ?? verifierRun.startedAt
    });
  }

  private mapProjectSearchResult(row: SqlRow, query: string): ProjectSearchResult {
    return {
      documentId: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      runId: nullableText(row, 'run_id'),
      entityType: text(row, 'entity_type'),
      entityId: text(row, 'entity_id'),
      title: text(row, 'title'),
      sourcePath: nullableText(row, 'source_path'),
      snippet: projectSearchPreview(text(row, 'title'), text(row, 'body'), query),
      metadata: parseJson(row.metadata_json),
      rank: numberValue(row, 'rank'),
      updatedAt: text(row, 'updated_at')
    };
  }

  private mapProjectSearchDocument(row: SqlRow): ProjectSearchDocumentRecord {
    return {
      id: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      runId: nullableText(row, 'run_id'),
      entityType: text(row, 'entity_type'),
      entityId: text(row, 'entity_id'),
      title: text(row, 'title'),
      body: text(row, 'body'),
      sourcePath: nullableText(row, 'source_path'),
      metadata: parseJson(row.metadata_json),
      updatedAt: text(row, 'updated_at')
    };
  }

  private mapProjectSemanticSearchResult(row: SqlRow, query: string, score: ProjectSemanticRankScore): ProjectSemanticSearchResult {
    return {
      chunkId: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      runId: nullableText(row, 'run_id'),
      sourceDocumentId: text(row, 'source_document_id'),
      namespace: text(row, 'namespace'),
      entityType: text(row, 'entity_type'),
      entityId: text(row, 'entity_id'),
      title: text(row, 'title'),
      sourcePath: nullableText(row, 'source_path'),
      snippet: semanticSearchPreview(text(row, 'content'), query),
      score: score.score,
      vectorScore: score.vectorScore,
      lexicalScore: score.lexicalScore,
      titleScore: score.titleScore,
      namespaceScore: score.namespaceScore,
      entityScore: score.entityScore,
      matchedTerms: score.matchedTerms,
      rankReason: score.rankReason,
      metadata: {
        ...parseJson(row.metadata_json),
        semanticRanking: {
          score: score.score,
          baseScore: score.baseScore,
          rerankScore: score.rerankScore,
          vectorScore: score.vectorScore,
          lexicalScore: score.lexicalScore,
          titleScore: score.titleScore,
          namespaceScore: score.namespaceScore,
          entityScore: score.entityScore,
          pathScore: score.pathScore,
          proximityScore: score.proximityScore,
          provenanceScore: score.provenanceScore,
          securityScore: score.securityScore,
          scopeScore: score.scopeScore,
          structureScore: score.structureScore,
          researchMemoryScore: score.researchMemoryScore,
          duplicateRiskPenalty: score.duplicateRiskPenalty,
          matchedTerms: score.matchedTerms,
          reason: score.rankReason
        }
      },
      indexedAt: text(row, 'indexed_at')
    };
  }

  private mapProjectStructureEntity(row: SqlRow): ProjectStructureEntityRecord {
    return {
      id: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      inventoryItemId: text(row, 'inventory_item_id'),
      assetId: text(row, 'asset_id'),
      entityKind: text(row, 'entity_kind'),
      name: text(row, 'name'),
      signature: text(row, 'signature'),
      path: text(row, 'path'),
      language: text(row, 'language'),
      lineStart: numberValue(row, 'line_start'),
      lineEnd: numberValue(row, 'line_end'),
      parentId: nullableText(row, 'parent_id'),
      metadata: parseJson(row.metadata_json),
      indexedAt: text(row, 'indexed_at')
    };
  }

  private mapProjectStructureRelation(row: SqlRow): ProjectStructureRelationRecord {
    return {
      id: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      sourceEntityId: text(row, 'source_entity_id'),
      relationKind: text(row, 'relation_kind'),
      targetKind: text(row, 'target_kind'),
      targetName: text(row, 'target_name'),
      targetEntityId: nullableText(row, 'target_entity_id'),
      metadata: parseJson(row.metadata_json),
      indexedAt: text(row, 'indexed_at')
    };
  }

  private getProjectGraphNode(scopeVersionId: string, entityType: string, entityId: string): ProjectGraphNodeRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM project_graph_nodes WHERE scope_version_id = ? AND entity_type = ? AND entity_id = ?').get(scopeVersionId, entityType, entityId));
    return row ? this.mapProjectGraphNode(row) : null;
  }

  private projectGraphNodeIdIfExists(scopeVersionId: string, entityType: string, entityId: string): string | null {
    return this.getProjectGraphNode(scopeVersionId, entityType, entityId)?.id ?? null;
  }

  private getProjectGraphNodeById(scopeVersionId: string, nodeId: string): ProjectGraphNodeRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM project_graph_nodes WHERE scope_version_id = ? AND id = ?').get(scopeVersionId, nodeId));
    return row ? this.mapProjectGraphNode(row) : null;
  }

  private getProjectGraphNodesById(scopeVersionId: string, nodeIds: string[]): ProjectGraphNodeRecord[] {
    const uniqueNodeIds = [...new Set(nodeIds)].filter(Boolean);
    if (uniqueNodeIds.length === 0) return [];
    const placeholders = uniqueNodeIds.map(() => '?').join(', ');
    return rows(
      this.db
        .prepare(
          `SELECT *
           FROM project_graph_nodes
           WHERE scope_version_id = ?
             AND id IN (${placeholders})
           ORDER BY
             CASE entity_type
               WHEN 'scope_version' THEN 0
               WHEN 'scope_asset' THEN 1
               WHEN 'run' THEN 2
               WHEN 'verifier_run' THEN 3
               WHEN 'verifier_contract' THEN 4
               WHEN 'artifact' THEN 5
               WHEN 'structure_entity' THEN 6
               WHEN 'inventory_item' THEN 7
               ELSE 20
             END,
             label ASC`
        )
        .all(scopeVersionId, ...uniqueNodeIds)
    ).map((row) => this.mapProjectGraphNode(row));
  }

  private mapProjectGraphNode(row: SqlRow): ProjectGraphNodeRecord {
    return {
      id: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      nodeKind: text(row, 'node_kind'),
      entityType: text(row, 'entity_type'),
      entityId: text(row, 'entity_id'),
      label: text(row, 'label'),
      sourcePath: nullableText(row, 'source_path'),
      metadata: parseJson(row.metadata_json),
      indexedAt: text(row, 'indexed_at')
    };
  }

  private mapProjectGraphProjectionNode(row: SqlRow): ProjectGraphNodeRecord {
    return {
      id: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      nodeKind: text(row, 'node_kind'),
      entityType: text(row, 'entity_type'),
      entityId: text(row, 'entity_id'),
      label: text(row, 'label'),
      sourcePath: nullableText(row, 'source_path'),
      metadata: {},
      indexedAt: text(row, 'indexed_at')
    };
  }

  private mapProjectGraphEdge(row: SqlRow): ProjectGraphEdgeRecord {
    return {
      id: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      sourceNodeId: text(row, 'source_node_id'),
      edgeKind: text(row, 'edge_kind'),
      targetNodeId: nullableText(row, 'target_node_id'),
      targetEntityType: text(row, 'target_entity_type'),
      targetEntityId: nullableText(row, 'target_entity_id'),
      targetLabel: text(row, 'target_label'),
      metadata: parseJson(row.metadata_json),
      indexedAt: text(row, 'indexed_at')
    };
  }

  private mapProjectGraphProjectionEdge(row: SqlRow): ProjectGraphEdgeRecord {
    return {
      id: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      sourceNodeId: text(row, 'source_node_id'),
      edgeKind: text(row, 'edge_kind'),
      targetNodeId: nullableText(row, 'target_node_id'),
      targetEntityType: text(row, 'target_entity_type'),
      targetEntityId: nullableText(row, 'target_entity_id'),
      targetLabel: text(row, 'target_label'),
      metadata: {},
      indexedAt: text(row, 'indexed_at')
    };
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = work();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  private getTraceEvent(traceEventId: string): TraceEventRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM trace_events WHERE id = ?').get(traceEventId));
    return row ? this.mapTraceEvent(row) : null;
  }

  private getTranscriptMessage(messageId: string): TranscriptMessageRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM transcript_messages WHERE id = ?').get(messageId));
    return row ? this.mapTranscriptMessage(row) : null;
  }

  private getNotification(notificationId: string): NotificationRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId));
    return row ? this.mapNotification(row) : null;
  }

  private getNotificationByTraceEvent(traceEventId: string): NotificationRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM notifications WHERE trace_event_id = ?').get(traceEventId));
    return row ? this.mapNotification(row) : null;
  }

  private getAttempt(attemptId: string): AttemptRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId));
    return row ? this.mapAttempt(row) : null;
  }

  private getVmContext(vmContextId: string): VmContextRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM vm_contexts WHERE id = ?').get(vmContextId));
    return row ? this.mapVmContext(row) : null;
  }

  private getArtifact(artifactId: string): ArtifactRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId));
    return row ? this.mapArtifact(row) : null;
  }

  private getVerifierContract(contractId: string): VerifierContractRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM verifier_contracts WHERE id = ?').get(contractId));
    return row ? this.mapVerifierContract(row) : null;
  }

  private getVerifierRun(verifierRunId: string): VerifierRunRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM verifier_runs WHERE id = ?').get(verifierRunId));
    return row ? this.mapVerifierRun(row) : null;
  }

  private getApproval(approvalId: string): ApprovalRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId));
    return row ? this.mapApproval(row) : null;
  }

  private getModelSession(modelSessionId: string): ModelSessionRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM model_sessions WHERE id = ?').get(modelSessionId));
    return row ? this.mapModelSession(row) : null;
  }

  private getContextCompaction(compactionId: string): ContextCompactionRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM context_compactions WHERE id = ?').get(compactionId));
    return row ? this.mapContextCompaction(row) : null;
  }

  private getLatestContextCompaction(runId: string): ContextCompactionRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM context_compactions WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(runId));
    return row ? this.mapContextCompaction(row) : null;
  }

  private getExportRecord(exportId: string): ExportRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM exports WHERE id = ?').get(exportId));
    return row ? this.mapExport(row) : null;
  }

  private mapResearchProfileSnapshot(row: SqlRow): ResearchProfileSnapshot {
    return {
      id: text(row, 'id'),
      workspaceId: text(row, 'workspace_id'),
      profileId: text(row, 'profile_id'),
      profileVersion: text(row, 'profile_version'),
      profileHash: text(row, 'profile_hash'),
      source: text(row, 'source') as ResearchProfileSnapshot['source'],
      sourcePath: nullableText(row, 'source_path'),
      profile: decodeResearchProfileJson(text(row, 'profile_json')),
      active: booleanValue(row, 'active'),
      createdAt: text(row, 'created_at')
    };
  }

  private mapResearchSubject(row: SqlRow): ResearchSubject {
    return {
      id: text(row, 'subject_id'),
      name: text(row, 'display_name'),
      source: text(row, 'source') as ResearchSubject['source'],
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at')
    };
  }

  private mapScope(row: SqlRow): WorkspaceScopeVersion {
    const id = text(row, 'id');
    const assetRows = rows(this.db.prepare('SELECT * FROM scope_assets WHERE scope_version_id = ? ORDER BY created_at ASC').all(id));
    return {
      id,
      version: numberValue(row, 'version'),
      status: text(row, 'status') as WorkspaceScopeVersion['status'],
      workspaceName: text(row, 'workspace_name'),
      scopeOwner: text(row, 'scope_owner'),
      descriptionMarkdown: text(row, 'description_markdown'),
      rulesMarkdown: text(row, 'rules_markdown'),
      activeFrom: text(row, 'active_from'),
      expiresAt: nullableText(row, 'expires_at'),
      createdAt: text(row, 'created_at'),
      createdBy: text(row, 'created_by'),
      assets: assetRows.map((assetRow) => ({
        id: text(assetRow, 'id'),
        scopeVersionId: text(assetRow, 'scope_version_id'),
        direction: text(assetRow, 'direction') as ScopeAsset['direction'],
        kind: text(assetRow, 'kind') as ScopeAsset['kind'],
        value: text(assetRow, 'value'),
        attributes: parseJson(assetRow.attributes_json),
        sensitivity: text(assetRow, 'sensitivity'),
        createdAt: text(assetRow, 'created_at')
      }))
    };
  }

  private mapRun(row: SqlRow): RunRecord {
    return {
      id: text(row, 'id'),
      scopeVersionId: text(row, 'scope_version_id'),
      researchProfileSnapshotId: nullableText(row, 'research_profile_snapshot_id'),
      shellSafetyMode: normalizeShellSafetyMode(text(row, 'shell_safety_mode')),
      mode: text(row, 'mode'),
      status: text(row, 'status') as RunStatus,
      title: text(row, 'title'),
      promptMarkdown: text(row, 'prompt_markdown'),
      model: text(row, 'model'),
      reasoningEffort: text(row, 'reasoning_effort'),
      attemptStrategy: text(row, 'attempt_strategy'),
      sandboxProfile: text(row, 'sandbox_profile'),
      targetAssetId: nullableText(row, 'target_asset_id'),
      targetPath: nullableText(row, 'target_path'),
      budget: parseJson(row.budget_json),
      summary: text(row, 'summary'),
      finalDisposition: mapSessionFinalDisposition(row),
      createdAt: text(row, 'created_at'),
      startedAt: nullableText(row, 'started_at'),
      endedAt: nullableText(row, 'ended_at')
    };
  }

  private mapAttempt(row: SqlRow): AttemptRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      parentAttemptId: nullableText(row, 'parent_attempt_id'),
      status: text(row, 'status') as AttemptStatus,
      shortState: text(row, 'short_state'),
      seed: text(row, 'seed'),
      strategyRole: text(row, 'strategy_role'),
      vmContextId: nullableText(row, 'vm_context_id'),
      cost: parseJson(row.cost_json),
      tokenUsage: parseJson(row.token_usage_json),
      startedAt: text(row, 'started_at'),
      endedAt: nullableText(row, 'ended_at')
    };
  }

  private getBreakoutRoom(roomId: string): BreakoutRoomRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM breakout_rooms WHERE id = ?').get(roomId));
    return row ? this.mapBreakoutRoom(row) : null;
  }

  private getBreakoutRoomMember(memberId: string): BreakoutRoomMemberRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM breakout_room_members WHERE id = ?').get(memberId));
    return row ? this.mapBreakoutRoomMember(row) : null;
  }

  private getBreakoutRoomMessage(messageId: string): BreakoutRoomMessageRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM breakout_room_messages WHERE id = ?').get(messageId));
    return row ? this.mapBreakoutRoomMessage(row) : null;
  }

  private mapSessionActivityInterval(row: SqlRow): SessionActivityInterval {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      startedAt: text(row, 'started_at'),
      endedAt: nullableText(row, 'ended_at')
    };
  }

  private mapTraceEvent(row: SqlRow): TraceEventRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      sequence: numberValue(row, 'sequence'),
      type: text(row, 'type') as TraceEventType,
      source: text(row, 'source') as TraceSource,
      summary: text(row, 'summary'),
      payload: parseJson(row.payload_json),
      sensitivity: text(row, 'sensitivity'),
      modelVisible: booleanValue(row, 'model_visible'),
      createdAt: text(row, 'created_at'),
      vmContextId: nullableText(row, 'vm_context_id'),
      artifactId: nullableText(row, 'artifact_id'),
      toolCallId: nullableText(row, 'tool_call_id'),
      approvalId: nullableText(row, 'approval_id')
    };
  }

  private mapTranscriptMessage(row: SqlRow): TranscriptMessageRecord {
    const metadata = parseJson(row.metadata_json);
    const role = text(row, 'role') as TranscriptRole;
    const source = text(row, 'source');
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      traceEventId: nullableText(row, 'trace_event_id'),
      role,
      phase: transcriptMessagePhase(metadata),
      contentMarkdown: text(row, 'content_markdown'),
      source,
      metadata,
      createdAt: text(row, 'created_at')
    };
  }

  private mapBreakoutRoom(row: SqlRow): BreakoutRoomRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      name: text(row, 'name'),
      title: text(row, 'title'),
      purpose: text(row, 'purpose'),
      kind: text(row, 'kind') as BreakoutRoomKind,
      status: text(row, 'status') as BreakoutRoomStatus,
      phase: text(row, 'phase') as BreakoutRoomPhase,
      challengeRound: numberValue(row, 'challenge_round'),
      outcomeMarkdown: nullableText(row, 'outcome_markdown'),
      createdAt: text(row, 'created_at'),
      closedAt: nullableText(row, 'closed_at')
    };
  }

  private mapBreakoutRoomMember(row: SqlRow): BreakoutRoomMemberRecord {
    return {
      id: text(row, 'id'),
      roomId: text(row, 'room_id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      agentId: text(row, 'agent_id'),
      agentPath: text(row, 'agent_path'),
      provider: text(row, 'provider'),
      model: text(row, 'model'),
      reasoningEffort: nullableText(row, 'reasoning_effort'),
      role: text(row, 'role'),
      status: text(row, 'status') as BreakoutRoomMemberStatus,
      startedAt: nullableText(row, 'started_at'),
      endedAt: nullableText(row, 'ended_at'),
      error: nullableText(row, 'error')
    };
  }

  private mapBreakoutRoomMessage(row: SqlRow): BreakoutRoomMessageRecord {
    const evidenceRefs = parseStringArray(row.evidence_refs_json);
    return {
      id: text(row, 'id'),
      roomId: text(row, 'room_id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      memberId: nullableText(row, 'member_id'),
      senderAgentPath: text(row, 'sender_agent_path'),
      recipientAgentPath: nullableText(row, 'recipient_agent_path'),
      kind: text(row, 'kind') as BreakoutRoomMessageKind,
      contentMarkdown: text(row, 'content_markdown'),
      evidenceRefs,
      metadata: parseJson(row.metadata_json),
      createdAt: text(row, 'created_at')
    };
  }

  private mapNotification(row: SqlRow): NotificationRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      traceEventId: nullableText(row, 'trace_event_id'),
      kind: text(row, 'kind') as NotificationRecord['kind'],
      title: text(row, 'title'),
      bodyMarkdown: text(row, 'body_markdown'),
      status: text(row, 'status') as NotificationStatus,
      createdAt: text(row, 'created_at'),
      openedAt: nullableText(row, 'opened_at'),
      dismissedAt: nullableText(row, 'dismissed_at')
    };
  }

  private mapArtifact(row: SqlRow): ArtifactRecord {
    return {
      id: text(row, 'id'),
      sha256: text(row, 'sha256'),
      relativePath: text(row, 'relative_path'),
      kind: text(row, 'kind'),
      sizeBytes: numberValue(row, 'size_bytes'),
      mimeType: text(row, 'mime_type'),
      sensitivity: text(row, 'sensitivity'),
      modelVisible: booleanValue(row, 'model_visible'),
      provenanceTraceEventId: nullableText(row, 'provenance_trace_event_id'),
      source: text(row, 'source'),
      metadata: parseJson(row.metadata_json),
      createdAt: text(row, 'created_at')
    };
  }

  private mapVerifierContract(row: SqlRow): VerifierContractRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      memoryNodeId: nullableText(row, 'memory_node_id'),
      mode: text(row, 'mode'),
      status: text(row, 'status'),
      targetStates: parseJson(row.target_states_json),
      setupStepsMarkdown: text(row, 'setup_steps_markdown'),
      triggerStepsMarkdown: text(row, 'trigger_steps_markdown'),
      expectedObservations: parseJson(row.expected_observations_json),
      invariants: parseJson(row.invariants_json),
      artifactsToCollect: parseJson(row.artifacts_to_collect_json),
      passCriteria: parseJson(row.pass_criteria_json),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at')
    };
  }

  private mapVerifierRun(row: SqlRow): VerifierRunRecord {
    return {
      id: text(row, 'id'),
      contractId: text(row, 'contract_id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      vmContextId: nullableText(row, 'vm_context_id'),
      status: text(row, 'status'),
      blockedIssue: text(row, 'blocked_issue'),
      behaviorPreserved: text(row, 'behavior_preserved'),
      diagnosticsClean: text(row, 'diagnostics_clean'),
      regressionTests: text(row, 'regression_tests'),
      result: parseJson(row.result_json),
      startedAt: text(row, 'started_at'),
      endedAt: nullableText(row, 'ended_at')
    };
  }

  private mapVmContext(row: SqlRow): VmContextRecord {
    return {
      id: text(row, 'id'),
      backend: text(row, 'backend'),
      imageId: text(row, 'image_id'),
      snapshotId: text(row, 'snapshot_id'),
      state: text(row, 'state'),
      scopeVersionId: text(row, 'scope_version_id'),
      createdAt: text(row, 'created_at'),
      destroyedAt: nullableText(row, 'destroyed_at'),
      metadata: parseJson(row.metadata_json)
    };
  }

  private mapApproval(row: SqlRow): ApprovalRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      requestKind: text(row, 'request_kind'),
      requestedAction: parseJson(row.requested_action_json),
      decision: text(row, 'decision'),
      reason: text(row, 'reason'),
      scopeAmendmentId: nullableText(row, 'scope_amendment_id'),
      createdAt: text(row, 'created_at'),
      decidedAt: nullableText(row, 'decided_at')
    };
  }

  private mapExport(row: SqlRow): ExportRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      memoryNodeId: nullableText(row, 'memory_node_id'),
      kind: text(row, 'kind'),
      relativePath: text(row, 'relative_path'),
      status: text(row, 'status') as ExportRecord['status'],
      reviewDecision: nullableText(row, 'review_decision') as ExportReviewDecision | null,
      reviewNote: nullableText(row, 'review_note'),
      redactionPolicy: parseJson(row.redaction_policy_json),
      includedArtifacts: parseJson(row.included_artifacts_json),
      createdAt: text(row, 'created_at'),
      reviewedAt: nullableText(row, 'reviewed_at')
    };
  }

  private mapModelSession(row: SqlRow): ModelSessionRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      provider: text(row, 'provider'),
      transport: text(row, 'transport') as OpenAiTransport,
      previousResponseId: nullableText(row, 'previous_response_id'),
      status: text(row, 'status'),
      metadata: parseJson(row.metadata_json),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at')
    };
  }

  private mapContextCompaction(row: SqlRow): ContextCompactionRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      attemptId: nullableText(row, 'attempt_id'),
      previousCompactionId: nullableText(row, 'previous_compaction_id'),
      traceEventId: nullableText(row, 'trace_event_id'),
      reason: text(row, 'reason'),
      previousReplayMode: text(row, 'previous_replay_mode'),
      newReplayMode: text(row, 'new_replay_mode'),
      traceRangeSummarized: parseJson(row.trace_range_summarized_json),
      traceRangeKept: parseJson(row.trace_range_kept_json),
      traceHighWaterMark: numberValue(row, 'trace_high_water_mark'),
      tokenPressure: parseJson(row.token_pressure_json),
      serializedSizeBytes: numberValue(row, 'serialized_size_bytes'),
      redactionPolicyVersion: text(row, 'redaction_policy_version'),
      summarySource: text(row, 'summary_source'),
      representedState: parseJson(row.represented_state_json),
      compactedInput: parseJson(row.compacted_input_json),
      createdAt: text(row, 'created_at')
    };
  }

  private runEngineFromBudget(budget: Record<string, unknown>): RunEngineKind {
    if (budget.runEngine === 'honeycrisp') return 'honeycrisp';
    return 'fixture';
  }
}

export function checkpointDatabaseFile(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA wal_checkpoint(FULL);');
  } finally {
    database.close();
  }
}

const NOTIFICATIONS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  trace_event_id TEXT REFERENCES trace_events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unread', 'opened', 'dismissed')),
  created_at TEXT NOT NULL,
  opened_at TEXT,
  dismissed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_trace_event ON notifications(trace_event_id) WHERE trace_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_status_created ON notifications(status, created_at);
`;

const CONTEXT_COMPACTIONS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS context_compactions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  previous_compaction_id TEXT REFERENCES context_compactions(id),
  trace_event_id TEXT REFERENCES trace_events(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  previous_replay_mode TEXT NOT NULL,
  new_replay_mode TEXT NOT NULL,
  trace_range_summarized_json TEXT NOT NULL,
  trace_range_kept_json TEXT NOT NULL,
  trace_high_water_mark INTEGER NOT NULL,
  token_pressure_json TEXT NOT NULL,
  serialized_size_bytes INTEGER NOT NULL,
  redaction_policy_version TEXT NOT NULL,
  summary_source TEXT NOT NULL,
  represented_state_json TEXT NOT NULL,
  compacted_input_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_compactions_run_created ON context_compactions(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_context_compactions_previous ON context_compactions(previous_compaction_id);
`;

const RUN_FIXTURE_SETUP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS run_fixture_setups (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  fixture_path TEXT NOT NULL,
  framework TEXT NOT NULL,
  framework_version TEXT NOT NULL,
  dependency_setup TEXT NOT NULL,
  build_setup TEXT NOT NULL,
  known_good_build_flags_json TEXT NOT NULL,
  known_bad_build_flags_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, fixture_path)
);

CREATE INDEX IF NOT EXISTS idx_run_fixture_setups_run_updated ON run_fixture_setups(run_id, updated_at);
`;

const TRANSCRIPT_MESSAGES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS transcript_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  trace_event_id TEXT REFERENCES trace_events(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content_markdown TEXT NOT NULL,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcript_messages_run_created ON transcript_messages(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transcript_messages_trace ON transcript_messages(trace_event_id);
`;

const BREAKOUT_ROOMS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS breakout_rooms (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('exploration', 'validation', 'proving', 'synthesis', 'general')),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'interrupted', 'errored')),
  phase TEXT NOT NULL DEFAULT 'independent' CHECK (phase IN ('independent', 'challenge', 'response', 'synthesis', 'completed')),
  challenge_round INTEGER NOT NULL DEFAULT 0 CHECK (challenge_round >= 0),
  outcome_markdown TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  UNIQUE(run_id, name)
);

CREATE TABLE IF NOT EXISTS breakout_room_members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES breakout_rooms(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  agent_id TEXT NOT NULL,
  agent_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'interrupted', 'errored')),
  started_at TEXT,
  ended_at TEXT,
  error TEXT,
  UNIQUE(run_id, attempt_id, agent_id)
);

CREATE TABLE IF NOT EXISTS breakout_room_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES breakout_rooms(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  member_id TEXT REFERENCES breakout_room_members(id) ON DELETE SET NULL,
  sender_agent_path TEXT NOT NULL,
  recipient_agent_path TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'commentary', 'challenge', 'evidence', 'response', 'outcome', 'system')),
  content_markdown TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_breakout_rooms_run_created ON breakout_rooms(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_breakout_room_members_room ON breakout_room_members(room_id, started_at);
CREATE INDEX IF NOT EXISTS idx_breakout_room_messages_room_created ON breakout_room_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_breakout_room_messages_run_created ON breakout_room_messages(run_id, created_at);
`;

const PROJECT_UNDERSTANDING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_inventory_items (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES scope_assets(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  path TEXT NOT NULL,
  value TEXT NOT NULL,
  language TEXT NOT NULL,
  size_bytes INTEGER,
  mtime_ms INTEGER,
  sha256 TEXT,
  sensitivity TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE(scope_version_id, asset_id, item_kind, value)
);

CREATE TABLE IF NOT EXISTS project_search_documents (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_path TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS project_search_fts USING fts5(
  document_id UNINDEXED,
  scope_version_id UNINDEXED,
  run_id UNINDEXED,
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  title,
  body
);

CREATE INDEX IF NOT EXISTS idx_project_inventory_scope_kind ON project_inventory_items(scope_version_id, resource_kind);
CREATE INDEX IF NOT EXISTS idx_project_inventory_scope_path ON project_inventory_items(scope_version_id, path);
CREATE INDEX IF NOT EXISTS idx_project_inventory_asset ON project_inventory_items(asset_id);
CREATE INDEX IF NOT EXISTS idx_project_search_scope_entity ON project_search_documents(scope_version_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_project_search_run_entity ON project_search_documents(run_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_project_search_updated ON project_search_documents(updated_at);
`;

const PROJECT_STRUCTURE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_structure_entities (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  inventory_item_id TEXT NOT NULL REFERENCES project_inventory_items(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES scope_assets(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  signature TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  parent_id TEXT REFERENCES project_structure_entities(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE(scope_version_id, path, entity_kind, name, line_start)
);

CREATE TABLE IF NOT EXISTS project_structure_relations (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  source_entity_id TEXT NOT NULL REFERENCES project_structure_entities(id) ON DELETE CASCADE,
  relation_kind TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_entity_id TEXT REFERENCES project_structure_entities(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE(scope_version_id, source_entity_id, relation_kind, target_kind, target_name)
);

CREATE INDEX IF NOT EXISTS idx_project_structure_scope_kind ON project_structure_entities(scope_version_id, entity_kind);
CREATE INDEX IF NOT EXISTS idx_project_structure_scope_path ON project_structure_entities(scope_version_id, path);
CREATE INDEX IF NOT EXISTS idx_project_structure_name ON project_structure_entities(scope_version_id, name);
CREATE INDEX IF NOT EXISTS idx_project_structure_rel_source ON project_structure_relations(source_entity_id, relation_kind);
CREATE INDEX IF NOT EXISTS idx_project_structure_rel_target ON project_structure_relations(scope_version_id, target_kind, target_name);
`;

const PROJECT_GRAPH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_graph_nodes (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  node_kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  source_path TEXT,
  metadata_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE(scope_version_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS project_graph_edges (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES project_graph_nodes(id) ON DELETE CASCADE,
  edge_kind TEXT NOT NULL,
  target_node_id TEXT REFERENCES project_graph_nodes(id) ON DELETE SET NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT,
  target_label TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE(scope_version_id, source_node_id, edge_kind, target_entity_type, target_entity_id, target_label)
);

CREATE INDEX IF NOT EXISTS idx_project_graph_nodes_scope_kind ON project_graph_nodes(scope_version_id, node_kind);
CREATE INDEX IF NOT EXISTS idx_project_graph_nodes_entity ON project_graph_nodes(scope_version_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_project_graph_nodes_path ON project_graph_nodes(scope_version_id, source_path);
CREATE INDEX IF NOT EXISTS idx_project_graph_edges_source ON project_graph_edges(source_node_id, edge_kind);
CREATE INDEX IF NOT EXISTS idx_project_graph_edges_target ON project_graph_edges(scope_version_id, target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_project_graph_edges_kind ON project_graph_edges(scope_version_id, edge_kind);
`;

const PROJECT_GRAPH_STATUS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_graph_status (
  scope_version_id TEXT PRIMARY KEY REFERENCES scope_versions(id) ON DELETE CASCADE,
  build_count INTEGER NOT NULL DEFAULT 0,
  last_rebuild_reason TEXT,
  stale_reasons_json TEXT NOT NULL DEFAULT '[]',
  node_family_counts_json TEXT NOT NULL DEFAULT '{}',
  edge_family_counts_json TEXT NOT NULL DEFAULT '{}',
  expected_node_count INTEGER NOT NULL DEFAULT 0,
  actual_node_count INTEGER NOT NULL DEFAULT 0,
  actual_edge_count INTEGER NOT NULL DEFAULT 0,
  last_rebuild_duration_ms INTEGER,
  indexed_at TEXT,
  updated_at TEXT NOT NULL
);
`;

const PROJECT_SEMANTIC_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_semantic_chunks (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  source_document_id TEXT NOT NULL REFERENCES project_search_documents(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_path TEXT,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  vector_provider TEXT NOT NULL,
  vector_model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE(scope_version_id, source_document_id, chunk_index, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_project_semantic_scope_namespace ON project_semantic_chunks(scope_version_id, namespace);
CREATE INDEX IF NOT EXISTS idx_project_semantic_source_document ON project_semantic_chunks(source_document_id);
CREATE INDEX IF NOT EXISTS idx_project_semantic_entity ON project_semantic_chunks(scope_version_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_project_semantic_updated ON project_semantic_chunks(indexed_at);
`;

const PROJECT_SEARCH_PERFORMANCE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_project_semantic_scope_document ON project_semantic_chunks(scope_version_id, source_document_id);
CREATE INDEX IF NOT EXISTS idx_project_graph_edges_scope_source_kind ON project_graph_edges(scope_version_id, source_node_id, edge_kind);
CREATE INDEX IF NOT EXISTS idx_project_graph_edges_scope_target_node_kind ON project_graph_edges(scope_version_id, target_node_id, edge_kind);
CREATE INDEX IF NOT EXISTS idx_project_graph_edges_variant_node ON project_graph_edges(scope_version_id, edge_kind, target_node_id);
CREATE INDEX IF NOT EXISTS idx_project_graph_edges_variant_label ON project_graph_edges(scope_version_id, edge_kind, target_entity_type, target_label);
`;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_research_subjects (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('explicit', 'legacy_adopted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_research_subjects_subject
ON workspace_research_subjects(subject_id, workspace_id);

CREATE TABLE IF NOT EXISTS research_profile_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('bundled-default', 'workspace-default', 'explicit')),
  source_path TEXT,
  profile_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_profile_snapshots_resolution_identity
ON research_profile_snapshots(workspace_id, profile_hash, source, COALESCE(source_path, ''));

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_profile_snapshots_workspace_active
ON research_profile_snapshots(workspace_id) WHERE active = 1;

CREATE TRIGGER IF NOT EXISTS prevent_research_profile_snapshot_content_update
BEFORE UPDATE OF workspace_id, profile_id, profile_version, profile_hash, source, source_path, profile_json, created_at
ON research_profile_snapshots
BEGIN
  SELECT RAISE(ABORT, 'research profile snapshots are immutable');
END;

CREATE TABLE IF NOT EXISTS scope_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  version INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  workspace_name TEXT NOT NULL,
  scope_owner TEXT NOT NULL,
  description_markdown TEXT NOT NULL,
  rules_markdown TEXT NOT NULL,
  active_from TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scope_versions_workspace_status ON scope_versions(workspace_id, status, version);

CREATE TABLE IF NOT EXISTS scope_assets (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in_scope', 'out_of_scope')),
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  attributes_json TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id),
  research_profile_snapshot_id TEXT REFERENCES research_profile_snapshots(id),
  shell_safety_mode TEXT NOT NULL DEFAULT 'auto_review' CHECK (shell_safety_mode IN ('manual_approval', 'auto_review', 'danger')),
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt_markdown TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  attempt_strategy TEXT NOT NULL,
  sandbox_profile TEXT NOT NULL,
  target_asset_id TEXT REFERENCES scope_assets(id),
  target_path TEXT,
  budget_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  next_step_suggestions_json TEXT,
  final_disposition_json TEXT,
  blocker_dependencies_json TEXT NOT NULL DEFAULT '[]',
  external_state_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS session_activity_intervals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_activity_intervals_run_started
ON session_activity_intervals(run_id, started_at);

CREATE INDEX IF NOT EXISTS idx_session_activity_intervals_attempt_started
ON session_activity_intervals(attempt_id, started_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_activity_intervals_one_open
ON session_activity_intervals(run_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS vm_contexts (
  id TEXT PRIMARY KEY,
  backend TEXT NOT NULL,
  image_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  state TEXT NOT NULL,
  scope_version_id TEXT NOT NULL REFERENCES scope_versions(id),
  created_at TEXT NOT NULL,
  destroyed_at TEXT,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  parent_attempt_id TEXT REFERENCES attempts(id),
  status TEXT NOT NULL,
  short_state TEXT NOT NULL,
  seed TEXT NOT NULL,
  strategy_role TEXT NOT NULL,
  vm_context_id TEXT REFERENCES vm_contexts(id),
  cost_json TEXT NOT NULL,
  token_usage_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS model_sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  transport TEXT NOT NULL,
  previous_response_id TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id),
  request_kind TEXT NOT NULL,
  requested_action_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  scope_amendment_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  result_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  policy_decision_id TEXT REFERENCES approvals(id),
  vm_context_id TEXT REFERENCES vm_contexts(id),
  trace_event_id TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  model_visible INTEGER NOT NULL CHECK (model_visible IN (0, 1)),
  provenance_trace_event_id TEXT,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  model_visible INTEGER NOT NULL CHECK (model_visible IN (0, 1)),
  created_at TEXT NOT NULL,
  vm_context_id TEXT REFERENCES vm_contexts(id),
  artifact_id TEXT REFERENCES artifacts(id),
  tool_call_id TEXT REFERENCES tool_calls(id),
  approval_id TEXT REFERENCES approvals(id),
  UNIQUE (run_id, sequence)
);

${CONTEXT_COMPACTIONS_SCHEMA_SQL}

${NOTIFICATIONS_SCHEMA_SQL}

${TRANSCRIPT_MESSAGES_SCHEMA_SQL}

${BREAKOUT_ROOMS_SCHEMA_SQL}

${PROJECT_UNDERSTANDING_SCHEMA_SQL}

${PROJECT_STRUCTURE_SCHEMA_SQL}

CREATE TABLE IF NOT EXISTS verifier_contracts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  memory_node_id TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  target_states_json TEXT NOT NULL,
  setup_steps_markdown TEXT NOT NULL,
  trigger_steps_markdown TEXT NOT NULL,
  expected_observations_json TEXT NOT NULL,
  invariants_json TEXT NOT NULL,
  artifacts_to_collect_json TEXT NOT NULL,
  pass_criteria_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verifier_runs (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES verifier_contracts(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id),
  vm_context_id TEXT REFERENCES vm_contexts(id),
  status TEXT NOT NULL,
  blocked_issue TEXT NOT NULL,
  behavior_preserved TEXT NOT NULL,
  diagnostics_clean TEXT NOT NULL,
  regression_tests TEXT NOT NULL,
  result_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  memory_node_id TEXT,
  kind TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  redaction_policy_json TEXT NOT NULL,
  included_artifacts_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_decision TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(entity_type, entity_id UNINDEXED, text);

CREATE INDEX IF NOT EXISTS idx_scope_assets_kind_value ON scope_assets(kind, value);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_attempts_run_status ON attempts(run_id, status);
CREATE INDEX IF NOT EXISTS idx_model_sessions_run ON model_sessions(run_id);
CREATE INDEX IF NOT EXISTS idx_trace_run_sequence ON trace_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_trace_artifact ON trace_events(artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_sha256 ON artifacts(sha256);
CREATE INDEX IF NOT EXISTS idx_verifier_contracts_memory_node ON verifier_contracts(memory_node_id);
CREATE INDEX IF NOT EXISTS idx_verifier_runs_status ON verifier_runs(status);
CREATE INDEX IF NOT EXISTS idx_exports_memory_node ON exports(memory_node_id);
`;
