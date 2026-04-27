import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ApprovalRecord,
  ArtifactRecord,
  AttemptRecord,
  AttemptStatus,
  BenchmarkHarnessIdentity,
  BenchmarkResultStatus,
  BenchmarkRunRecord,
  BenchmarkSuiteKind,
  BenchmarkTaskMode,
  BenchmarkTaskResultRecord,
  ExportRecord,
  ExportReviewDecision,
  FindingRecord,
  HypothesisRecord,
  ModelSessionRecord,
  OpenAiTransport,
  ProgramScopeDraft,
  ProgramScopeVersion,
  RunDetail,
  RunEngineKind,
  RunRecord,
  RunRow,
  RunStatus,
  ScopeAsset,
  ScopeAssetInput,
  TraceEventRecord,
  TraceEventType,
  TraceSource,
  VerifierContractRecord,
  VerifierRunRecord,
  VmContextRecord,
  WorkspaceExportResult,
  WorkspaceRecoveryReport
} from '@shared/types';

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

export interface CreateHypothesisInput {
  runId: string;
  parentHypothesisId?: string | null;
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
}

export interface CreateFindingInput {
  runId: string;
  hypothesisId?: string | null;
  state: string;
  title: string;
  summaryMarkdown: string;
  affectedAssets?: Record<string, unknown>;
  affectedVersions?: Record<string, unknown>;
  impactMarkdown: string;
  priorityScore: number;
  verifiedByVerifierRunId?: string | null;
}

export interface CreateVerifierContractInput {
  runId: string;
  hypothesisId?: string | null;
  findingId?: string | null;
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

export interface StartRunRecordInput {
  scopeVersionId: string;
  title: string;
  promptMarkdown: string;
  mode: string;
  model: string;
  reasoningEffort: string;
  attemptStrategy: string;
  networkProfile: string;
  sandboxProfile: string;
  budget: Record<string, unknown>;
  vmBackend?: string;
  vmImageId?: string;
  vmSnapshotId?: string;
  vmState?: string;
  vmMetadata?: Record<string, unknown>;
}

export interface CreateExportInput {
  runId: string;
  findingId?: string | null;
  kind: string;
  relativePath: string;
  redactionPolicy?: Record<string, unknown>;
  includedArtifacts?: Record<string, unknown>;
  status?: ExportRecord['status'];
}

export interface CreateBenchmarkRunInput {
  suiteKind: BenchmarkSuiteKind;
  suiteId: string;
  identity: BenchmarkHarnessIdentity;
  metadata?: Record<string, unknown>;
}

export interface FinishBenchmarkRunInput {
  status: 'completed' | 'failed';
  identity: BenchmarkHarnessIdentity;
}

export interface CreateBenchmarkTaskResultInput {
  benchmarkRunId: string;
  taskId: string;
  suiteKind: BenchmarkSuiteKind;
  mode: BenchmarkTaskMode;
  status: BenchmarkResultStatus;
  score: number;
  runId?: string | null;
  isolationPassed: boolean;
  metrics?: Record<string, unknown>;
  graderReport?: Record<string, unknown>;
  agentOutput?: Record<string, unknown>;
}

export interface CreatedRunContext {
  run: RunRecord;
  attempt: AttemptRecord;
  vmContext: VmContextRecord;
}

const SCHEMA_VERSION = 4;

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

function parseStringArray(value: SqlPrimitive | undefined): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function verifierRunIsRealPass(run: VerifierRunRecord): boolean {
  return run.status === 'pass' && run.result.realExecution === true && run.result.vmExecution === true;
}

function text(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

function nullableText(row: SqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

function booleanValue(row: SqlRow, key: string): boolean {
  return numberValue(row, key) === 1;
}

function rowOrUndefined(value: unknown): SqlRow | undefined {
  return value ? (value as SqlRow) : undefined;
}

function rows(value: unknown[]): SqlRow[] {
  return value as SqlRow[];
}

function jsonFromScopeDraft(draft: ProgramScopeDraft): Record<string, unknown> {
  const inScope = draft.assets.filter((asset) => asset.direction === 'in_scope').map((asset) => asset.value);
  const outOfScope = draft.assets.filter((asset) => asset.direction === 'out_of_scope').map((asset) => asset.value);
  return {
    defaultProfile: draft.networkProfile,
    vmNetworkDefault: draft.networkProfile === 'offline' ? 'disabled' : 'scoped',
    inScope,
    outOfScope
  };
}

export class WorkspaceDatabase {
  private readonly db: DatabaseSync;

  public constructor(
    private readonly databasePath: string,
    private readonly artifactRoot: string
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  public initialize(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.applyMigrations();
    this.ensureWorkspaceMeta();
    this.ensureDefaultScope();
  }

  public checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(FULL);');
  }

  public close(): void {
    this.db.close();
  }

  public getWorkspaceId(): string {
    return this.getMetaValue('workspace_id') ?? '';
  }

  public getDatabasePath(): string {
    return this.databasePath;
  }

  public getArtifactRoot(): string {
    return this.artifactRoot;
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
    const interruptedRunRows = rows(this.db.prepare("SELECT id FROM runs WHERE status IN ('queued', 'active')").all());
    const interruptedAttemptRows = rows(this.db.prepare("SELECT id, run_id, vm_context_id FROM attempts WHERE status IN ('queued', 'active')").all());
    const interruptedModelRows = rows(this.db.prepare("SELECT id, metadata_json, status FROM model_sessions WHERE status IN ('active', 'running')").all());
    const interruptedToolRows = rows(this.db.prepare("SELECT id, result_json FROM tool_calls WHERE status = 'running'").all());
    const interruptedVerifierRows = rows(this.db.prepare("SELECT id, result_json, status FROM verifier_runs WHERE status IN ('queued', 'running')").all());
    const interruptedVmRows = rows(
      this.db
        .prepare(
          `SELECT DISTINCT v.* FROM vm_contexts v
           JOIN attempts a ON a.vm_context_id = v.id
           JOIN runs r ON r.id = a.run_id
           WHERE v.destroyed_at IS NULL
             AND v.state NOT IN ('destroyed', 'preserved', 'recovery_pending')
             AND (r.status IN ('queued', 'active') OR a.status IN ('queued', 'active'))`
        )
        .all()
    );
    const interruptedBenchmarkRows = rows(this.db.prepare("SELECT id, metadata_json FROM benchmark_runs WHERE status = 'running'").all());

    const report: WorkspaceRecoveryReport = {
      recoveredAt,
      reason,
      interruptedRuns: interruptedRunRows.length,
      interruptedAttempts: interruptedAttemptRows.length,
      interruptedModelSessions: interruptedModelRows.length,
      interruptedToolCalls: interruptedToolRows.length,
      interruptedVerifierRuns: interruptedVerifierRows.length,
      interruptedVmContexts: interruptedVmRows.length,
      interruptedBenchmarkRuns: interruptedBenchmarkRows.length,
      notes: []
    };

    const total =
      report.interruptedRuns +
      report.interruptedAttempts +
      report.interruptedModelSessions +
      report.interruptedToolCalls +
      report.interruptedVerifierRuns +
      report.interruptedVmContexts +
      report.interruptedBenchmarkRuns;
    if (total === 0) {
      report.notes.push('No interrupted authoritative state found.');
      this.setMetaValue('last_recovery_json', JSON.stringify(report), recoveredAt);
      return report;
    }

    report.notes.push('Interrupted active work was paused or marked for review on workspace open.');
    if (report.interruptedVmContexts > 0) {
      report.notes.push('VM contexts that were not known destroyed were marked recovery_pending for user review.');
    }
    if (report.interruptedBenchmarkRuns > 0) {
      report.notes.push('Running benchmark records were marked failed because Docker agent state cannot be resumed safely.');
    }

    this.transaction(() => {
      for (const row of interruptedRunRows) {
        this.db
          .prepare('UPDATE runs SET status = ?, summary = ? WHERE id = ?')
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
      for (const row of interruptedBenchmarkRows) {
        const metadata = {
          ...parseJson(row.metadata_json),
          interruptedByRecovery: true,
          recoveredAt,
          reason
        };
        this.db
          .prepare('UPDATE benchmark_runs SET status = ?, metadata_json = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?')
          .run('failed', toJson(metadata), recoveredAt, text(row, 'id'));
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

  public getActiveScope(): ProgramScopeVersion {
    const row = rowOrUndefined(
      this.db
        .prepare('SELECT * FROM program_scope_versions WHERE status = ? ORDER BY version DESC LIMIT 1')
        .get('active')
    );
    if (!row) {
      throw new Error('Workspace has no active scope version');
    }
    return this.mapScope(row);
  }

  public saveProgramScope(draft: ProgramScopeDraft): ProgramScopeVersion {
    const cleanedAssets = draft.assets
      .map((asset) => ({
        ...asset,
        value: asset.value.trim(),
        sensitivity: asset.sensitivity.trim() || 'internal'
      }))
      .filter((asset) => asset.value.length > 0);
    const createdAt = nowIso();
    const id = createId('scope');
    const versionRow = rowOrUndefined(this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM program_scope_versions').get());
    const nextVersion = numberValue(versionRow ?? { version: 0 }, 'version') + 1;

    this.transaction(() => {
      this.db.prepare('UPDATE program_scope_versions SET status = ? WHERE status = ?').run('archived', 'active');
      this.db
        .prepare(
          `INSERT INTO program_scope_versions (
            id, version, status, program_name, organization_name, description_markdown,
            network_policy_json, rules_markdown, active_from, expires_at, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          nextVersion,
          'active',
          draft.programName.trim() || 'Untitled Program',
          draft.organizationName.trim(),
          draft.descriptionMarkdown.trim(),
          toJson(jsonFromScopeDraft({ ...draft, assets: cleanedAssets })),
          draft.rulesMarkdown.trim(),
          createdAt,
          draft.expiresAt || null,
          createdAt,
          'local_user'
        );

      for (const asset of cleanedAssets) {
        this.insertScopeAsset(id, asset, createdAt);
      }
    });

    return this.getActiveScope();
  }

  public createRun(input: StartRunRecordInput): CreatedRunContext {
    const runId = createId('run');
    const attemptId = createId('attempt');
    const vmContextId = createId('vm');
    const createdAt = nowIso();

    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO vm_contexts (
            id, backend, image_id, snapshot_id, state, network_profile, scope_version_id,
            created_at, destroyed_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          vmContextId,
          input.vmBackend ?? 'fake_vm',
          input.vmImageId ?? 'fake-beale-toolchain',
          input.vmSnapshotId ?? 'clean-snapshot-simulated',
          input.vmState ?? 'working',
          input.networkProfile,
          input.scopeVersionId,
          createdAt,
          null,
          toJson(input.vmMetadata ?? { executor: 'simulated', targetExecution: false })
        );

      this.db
        .prepare(
          `INSERT INTO runs (
            id, scope_version_id, mode, status, title, prompt_markdown, model, reasoning_effort,
            attempt_strategy, network_profile, sandbox_profile, budget_json, summary,
            created_at, started_at, ended_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          runId,
          input.scopeVersionId,
          input.mode,
          'active',
          input.title,
          input.promptMarkdown,
          input.model,
          input.reasoningEffort,
          input.attemptStrategy,
          input.networkProfile,
          input.sandboxProfile,
          toJson(input.budget),
          'Starting simulated research run.',
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
          'Initializing simulated research plan.',
          randomUUID(),
          'initial_portfolio',
          vmContextId,
          toJson({ simulatedUsd: 0, label: 'simulated $0.00' }),
          toJson({ promptTokens: 0, completionTokens: 0, simulated: true }),
          createdAt,
          null
        );
    });

    const run = this.getRun(runId);
    const attempt = this.getAttempt(attemptId);
    const vmContext = this.getVmContext(vmContextId);
    if (!run || !attempt || !vmContext) {
      throw new Error('Failed to create run context');
    }
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
            id, backend, image_id, snapshot_id, state, network_profile, scope_version_id,
            created_at, destroyed_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          vmContextId,
          input.vmBackend ?? 'fake_vm',
          input.vmImageId ?? 'fake-beale-toolchain',
          input.vmSnapshotId ?? 'clean-snapshot-simulated',
          vmState,
          run.networkProfile,
          run.scopeVersionId,
          createdAt,
          vmState === 'destroyed' ? createdAt : null,
          toJson(input.vmMetadata ?? { executor: 'simulated', targetExecution: false })
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
          toJson(input.cost ?? { simulatedUsd: 0, label: 'simulated $0.00' }),
          toJson(input.tokenUsage ?? { promptTokens: 0, completionTokens: 0, simulated: true }),
          createdAt,
          input.status === 'completed' || input.status === 'failed' || input.status === 'stopped' ? createdAt : null
        );
    });
    const attempt = this.getAttempt(attemptId);
    if (!attempt) throw new Error('Failed to create attempt');
    return attempt;
  }

  public updateModelSessionByRun(runId: string, patch: { previousResponseId?: string | null; status?: string; metadata?: Record<string, unknown> }): void {
    const existing = rowOrUndefined(this.db.prepare('SELECT * FROM model_sessions WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId));
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
    return event;
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

  public updateRunStatus(runId: string, status: RunStatus, summary: string): void {
    const endedAt = status === 'completed' || status === 'failed' || status === 'stopped' ? nowIso() : null;
    this.db.prepare('UPDATE runs SET status = ?, summary = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?').run(status, summary, endedAt, runId);
  }

  public updateAttemptState(attemptId: string, status: AttemptStatus, shortState: string): void {
    const endedAt = status === 'completed' || status === 'failed' || status === 'stopped' ? nowIso() : null;
    this.db
      .prepare('UPDATE attempts SET status = ?, short_state = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?')
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

  public createHypothesis(input: CreateHypothesisInput): HypothesisRecord {
    const id = createId('hyp');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO hypotheses (
          id, run_id, parent_hypothesis_id, state, title, description_markdown, component,
          bug_class, priority_score, attacker_reachability, impact, evidence_confidence,
          exploit_practicality, scope_confidence, created_trace_event_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.parentHypothesisId ?? null,
        input.state,
        input.title,
        input.descriptionMarkdown,
        input.component,
        input.bugClass,
        input.priorityScore,
        input.attackerReachability,
        input.impact,
        input.evidenceConfidence,
        input.exploitPracticality,
        input.scopeConfidence,
        null,
        createdAt,
        createdAt
      );
    const hypothesis = this.getHypothesis(id);
    if (!hypothesis) throw new Error('Failed to create hypothesis');
    return hypothesis;
  }

  public setHypothesisTrace(hypothesisId: string, traceEventId: string): void {
    this.db.prepare('UPDATE hypotheses SET created_trace_event_id = ?, updated_at = ? WHERE id = ?').run(traceEventId, nowIso(), hypothesisId);
  }

  public updateHypothesisState(hypothesisId: string, state: string): void {
    this.db.prepare('UPDATE hypotheses SET state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), hypothesisId);
  }

  public updateHypothesisReview(
    hypothesisId: string,
    patch: {
      state?: string;
      priorityScore?: number;
      attackerReachability?: string;
      impact?: string;
      evidenceConfidence?: string;
      exploitPracticality?: string;
      scopeConfidence?: string;
    }
  ): void {
    const existing = this.getHypothesis(hypothesisId);
    if (!existing) throw new Error(`Hypothesis not found: ${hypothesisId}`);
    this.db
      .prepare(
        `UPDATE hypotheses
         SET state = ?,
             priority_score = ?,
             attacker_reachability = ?,
             impact = ?,
             evidence_confidence = ?,
             exploit_practicality = ?,
             scope_confidence = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.state ?? existing.state,
        patch.priorityScore ?? existing.priorityScore,
        patch.attackerReachability ?? existing.attackerReachability,
        patch.impact ?? existing.impact,
        patch.evidenceConfidence ?? existing.evidenceConfidence,
        patch.exploitPracticality ?? existing.exploitPracticality,
        patch.scopeConfidence ?? existing.scopeConfidence,
        nowIso(),
        hypothesisId
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
    return artifact;
  }

  public setArtifactProvenance(artifactId: string, traceEventId: string): void {
    this.db.prepare('UPDATE artifacts SET provenance_trace_event_id = ? WHERE id = ?').run(traceEventId, artifactId);
  }

  public markArtifactSensitive(artifactId: string): void {
    this.db.prepare('UPDATE artifacts SET sensitivity = ?, model_visible = ? WHERE id = ?').run('sensitive', 0, artifactId);
  }

  public createEvidenceFromArtifact(runId: string, artifactId: string, summary: string, hypothesisId?: string | null, findingId?: string | null): string {
    const id = createId('evidence');
    this.db
      .prepare(
        `INSERT INTO evidence (
          id, run_id, hypothesis_id, finding_id, kind, summary, observation_trace_event_id,
          artifact_id, verifier_run_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, runId, hypothesisId ?? null, findingId ?? null, 'artifact', summary, null, artifactId, null, nowIso());
    return id;
  }

  public createVerifierContract(input: CreateVerifierContractInput): VerifierContractRecord {
    const id = createId('verifier');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO verifier_contracts (
          id, run_id, hypothesis_id, finding_id, mode, status, target_states_json,
          setup_steps_markdown, trigger_steps_markdown, expected_observations_json,
          invariants_json, artifacts_to_collect_json, pass_criteria_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.hypothesisId ?? null,
        input.findingId ?? null,
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
    return contract;
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
    return verifierRun;
  }

  public createFinding(input: CreateFindingInput): FindingRecord {
    if (input.state === 'verified') {
      this.assertVerifierRunCanVerify(input.verifiedByVerifierRunId ?? null, input.runId);
    }
    const id = createId('finding');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO findings (
          id, run_id, hypothesis_id, state, title, summary_markdown, affected_assets_json,
          affected_versions_json, impact_markdown, priority_score, verified_by_verifier_run_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.hypothesisId ?? null,
        input.state,
        input.title,
        input.summaryMarkdown,
        toJson(input.affectedAssets),
        toJson(input.affectedVersions),
        input.impactMarkdown,
        input.priorityScore,
        input.verifiedByVerifierRunId ?? null,
        createdAt,
        createdAt
      );
    const finding = this.getFinding(id);
    if (!finding) throw new Error('Failed to create finding');
    return finding;
  }

  public updateFindingState(findingId: string, state: string): void {
    if (state === 'verified') {
      throw new Error('Use verifyFindingWithVerifierRun to mark a finding verified.');
    }
    this.db.prepare('UPDATE findings SET state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), findingId);
  }

  public verifyFindingWithVerifierRun(findingId: string, verifierRunId: string): FindingRecord {
    const finding = this.getFinding(findingId);
    if (!finding) throw new Error(`Finding not found: ${findingId}`);
    this.assertVerifierRunCanVerify(verifierRunId, finding.runId);
    this.db
      .prepare('UPDATE findings SET state = ?, verified_by_verifier_run_id = ?, updated_at = ? WHERE id = ?')
      .run('verified', verifierRunId, nowIso(), findingId);
    const updated = this.getFinding(findingId);
    if (!updated) throw new Error(`Finding not found after verification update: ${findingId}`);
    return updated;
  }

  public createExportRecord(input: CreateExportInput): string {
    const id = createId('export');
    this.db
      .prepare(
        `INSERT INTO exports (
          id, run_id, finding_id, kind, relative_path, redaction_policy_json,
          included_artifacts_json, status, review_decision, review_note, created_at, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.runId,
        input.findingId ?? null,
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

  public createBenchmarkRun(input: CreateBenchmarkRunInput): BenchmarkRunRecord {
    const id = createId('bench_run');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO benchmark_runs (
          id, suite_kind, suite_id, status, model, reasoning_effort, harness_name,
          harness_version, prompt_version, toolset_version, verifier_version,
          sandbox_backend, sandbox_image_version, network_profile, attempt_strategy,
          attempt_count, task_subset_id, task_ids_json, benchmark_version, cost_json,
          tokens_json, wall_time_ms, pass_count, total_count, metadata_json,
          created_at, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.suiteKind,
        input.suiteId,
        'running',
        input.identity.model,
        input.identity.reasoningEffort,
        input.identity.harnessName,
        input.identity.harnessVersion,
        input.identity.promptVersion,
        input.identity.toolsetVersion,
        input.identity.verifierVersion,
        input.identity.sandboxBackend,
        input.identity.sandboxImageVersion,
        input.identity.networkProfile,
        input.identity.attemptStrategy,
        input.identity.attemptCount,
        input.identity.taskSubsetId,
        toJson(input.identity.taskIds),
        input.identity.benchmarkVersion,
        toJson(input.identity.cost),
        toJson(input.identity.tokens),
        input.identity.wallTimeMs,
        input.identity.passCount,
        input.identity.totalCount,
        toJson(input.metadata),
        createdAt,
        createdAt,
        null
      );
    const run = this.getBenchmarkRun(id);
    if (!run) throw new Error('Failed to create benchmark run');
    return run;
  }

  public finishBenchmarkRun(benchmarkRunId: string, input: FinishBenchmarkRunInput): BenchmarkRunRecord {
    const endedAt = nowIso();
    this.db
      .prepare(
        `UPDATE benchmark_runs
         SET status = ?,
             cost_json = ?,
             tokens_json = ?,
             wall_time_ms = ?,
             pass_count = ?,
             total_count = ?,
             ended_at = ?
         WHERE id = ?`
      )
      .run(
        input.status,
        toJson(input.identity.cost),
        toJson(input.identity.tokens),
        input.identity.wallTimeMs,
        input.identity.passCount,
        input.identity.totalCount,
        endedAt,
        benchmarkRunId
      );
    const run = this.getBenchmarkRun(benchmarkRunId);
    if (!run) throw new Error(`Benchmark run not found: ${benchmarkRunId}`);
    return run;
  }

  public createBenchmarkTaskResult(input: CreateBenchmarkTaskResultInput): BenchmarkTaskResultRecord {
    const id = createId('bench_result');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO benchmark_task_results (
          id, benchmark_run_id, task_id, suite_kind, mode, status, score, run_id,
          isolation_passed, metrics_json, grader_report_json, agent_output_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.benchmarkRunId,
        input.taskId,
        input.suiteKind,
        input.mode,
        input.status,
        input.score,
        input.runId ?? null,
        input.isolationPassed ? 1 : 0,
        toJson(input.metrics),
        toJson(input.graderReport),
        toJson(input.agentOutput),
        createdAt
      );
    const result = this.getBenchmarkTaskResult(id);
    if (!result) throw new Error('Failed to create benchmark task result');
    return result;
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
        input.decision,
        input.reason,
        input.scopeAmendmentId ?? null,
        createdAt,
        createdAt
      );
    const approval = this.getApproval(id);
    if (!approval) throw new Error('Failed to create approval');
    return approval;
  }

  public listRunRows(): RunRow[] {
    const runRows = rows(this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all());
    return runRows.map((runRow) => {
      const run = this.mapRun(runRow);
      const attemptCount = numberValue(
        rowOrUndefined(this.db.prepare('SELECT COUNT(*) AS count FROM attempts WHERE run_id = ?').get(run.id)) ?? { count: 0 },
        'count'
      );
      const latestAttempt = rowOrUndefined(
        this.db.prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at DESC LIMIT 1').get(run.id)
      );
      const topHypothesis = rowOrUndefined(
        this.db
          .prepare("SELECT title, state FROM hypotheses WHERE run_id = ? AND state NOT IN ('dismissed', 'out_of_scope') ORDER BY priority_score DESC, created_at DESC LIMIT 1")
          .get(run.id)
      );
      const topFinding = rowOrUndefined(
        this.db.prepare("SELECT title, state FROM findings WHERE run_id = ? AND state NOT IN ('dismissed', 'out_of_scope') ORDER BY priority_score DESC, created_at DESC LIMIT 1").get(run.id)
      );
      const verifier = rowOrUndefined(
        this.db.prepare('SELECT status FROM verifier_runs WHERE run_id = ? ORDER BY started_at DESC LIMIT 1').get(run.id)
      );
      const policy = rowOrUndefined(
        this.db.prepare("SELECT reason FROM approvals WHERE run_id = ? AND decision = 'blocked' ORDER BY created_at DESC LIMIT 1").get(run.id)
      );
      const artifactCount = numberValue(
        rowOrUndefined(this.db.prepare('SELECT COUNT(*) AS count FROM artifacts a JOIN trace_events t ON t.artifact_id = a.id WHERE t.run_id = ?').get(run.id)) ?? { count: 0 },
        'count'
      );

      return {
        run,
        attemptCount,
        engine: this.runEngineFromBudget(run.budget),
        latestAttemptState: latestAttempt ? text(latestAttempt, 'short_state') : run.summary,
        topHypothesis: topHypothesis ? `${text(topHypothesis, 'title')} (${text(topHypothesis, 'state')})` : null,
        topFinding: topFinding ? `${text(topFinding, 'title')} (${text(topFinding, 'state')})` : null,
        verifierState: verifier ? text(verifier, 'status') : null,
        policyBlocker: policy ? text(policy, 'reason') : null,
        artifactCount,
        costLabel: 'simulated $0.00'
      };
    });
  }

  public listBenchmarkRuns(limit = 12): BenchmarkRunRecord[] {
    return rows(this.db.prepare('SELECT * FROM benchmark_runs ORDER BY created_at DESC LIMIT ?').all(limit)).map((row) => this.mapBenchmarkRun(row));
  }

  public listBenchmarkTaskResults(benchmarkRunId: string): BenchmarkTaskResultRecord[] {
    return rows(
      this.db
        .prepare('SELECT * FROM benchmark_task_results WHERE benchmark_run_id = ? ORDER BY created_at ASC')
        .all(benchmarkRunId)
    ).map((row) => this.mapBenchmarkTaskResult(row));
  }

  public getRunDetail(runId: string): RunDetail {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return {
      run,
      attempts: rows(this.db.prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at ASC').all(runId)).map((row) => this.mapAttempt(row)),
      traceEvents: rows(this.db.prepare('SELECT * FROM trace_events WHERE run_id = ? ORDER BY sequence ASC').all(runId)).map((row) => this.mapTraceEvent(row)),
      hypotheses: rows(this.db.prepare('SELECT * FROM hypotheses WHERE run_id = ? ORDER BY priority_score DESC, created_at ASC').all(runId)).map((row) => this.mapHypothesis(row)),
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
      findings: rows(this.db.prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapFinding(row)),
      verifierContracts: rows(this.db.prepare('SELECT * FROM verifier_contracts WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapVerifierContract(row)),
      verifierRuns: rows(this.db.prepare('SELECT * FROM verifier_runs WHERE run_id = ? ORDER BY started_at ASC').all(runId)).map((row) => this.mapVerifierRun(row)),
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
      policyEvents: rows(this.db.prepare('SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapApproval(row)),
      exports: rows(this.db.prepare('SELECT * FROM exports WHERE run_id = ? ORDER BY created_at ASC').all(runId)).map((row) => this.mapExport(row))
    };
  }

  public getRun(runId: string): RunRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId));
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

  public getFirstHypothesis(runId: string): HypothesisRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM hypotheses WHERE run_id = ? ORDER BY created_at ASC LIMIT 1').get(runId));
    return row ? this.mapHypothesis(row) : null;
  }

  public getFirstVerifierContract(runId: string): VerifierContractRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM verifier_contracts WHERE run_id = ? ORDER BY created_at ASC LIMIT 1').get(runId));
    return row ? this.mapVerifierContract(row) : null;
  }

  private assertVerifierRunCanVerify(verifierRunId: string | null, runId: string): void {
    if (!verifierRunId) {
      throw new Error('Verified findings require a passing real verifier run.');
    }
    const verifierRun = this.getVerifierRun(verifierRunId);
    if (!verifierRun || verifierRun.runId !== runId || !verifierRunIsRealPass(verifierRun)) {
      throw new Error('Verified findings require a passing real verifier run.');
    }
  }

  private applyMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const current = rowOrUndefined(this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get());
    const currentVersion = numberValue(current ?? { version: 0 }, 'version');
    if (currentVersion >= SCHEMA_VERSION) {
      return;
    }

    this.transaction(() => {
      if (currentVersion < 3) {
        this.db.exec(SCHEMA_SQL);
        this.insertMigration(3, 'initial_workbench_schema');
      }
      if (currentVersion < 4) {
        this.applyExportReviewMigration();
        this.insertMigration(4, 'export_review_hardening');
      }
    });
  }

  private insertMigration(version: number, name: string): void {
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, name, nowIso());
  }

  private applyExportReviewMigration(): void {
    this.addColumnIfMissing('exports', 'status', "status TEXT NOT NULL DEFAULT 'pending_review'");
    this.addColumnIfMissing('exports', 'review_decision', 'review_decision TEXT');
    this.addColumnIfMissing('exports', 'review_note', 'review_note TEXT');
    this.addColumnIfMissing('exports', 'reviewed_at', 'reviewed_at TEXT');
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = new Set(rows(this.db.prepare(`PRAGMA table_info(${table})`).all()).map((row) => text(row, 'name')));
    if (!columns.has(column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
    }
  }

  private ensureWorkspaceMeta(): void {
    const createdAt = nowIso();
    const workspaceId = `workspace_${randomUUID()}`;
    this.db
      .prepare('INSERT OR IGNORE INTO workspace_meta (key, value, updated_at) VALUES (?, ?, ?)')
      .run('schema_version', String(SCHEMA_VERSION), createdAt);
    this.db
      .prepare('INSERT OR IGNORE INTO workspace_meta (key, value, updated_at) VALUES (?, ?, ?)')
      .run('workspace_id', workspaceId, createdAt);
    this.db.prepare('INSERT OR IGNORE INTO workspace_meta (key, value, updated_at) VALUES (?, ?, ?)').run('created_at', createdAt, createdAt);
    this.db.prepare('UPDATE workspace_meta SET value = ?, updated_at = ? WHERE key = ?').run(String(SCHEMA_VERSION), createdAt, 'schema_version');
  }

  private ensureDefaultScope(): void {
    const row = rowOrUndefined(this.db.prepare('SELECT id FROM program_scope_versions WHERE status = ? LIMIT 1').get('active'));
    if (row) return;
    this.saveProgramScope({
      programName: 'Untitled Program',
      organizationName: '',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      networkProfile: 'offline',
      expiresAt: null,
      assets: []
    });
  }

  private getMetaValue(key: string): string | null {
    const row = rowOrUndefined(this.db.prepare('SELECT value FROM workspace_meta WHERE key = ?').get(key));
    return row ? text(row, 'value') : null;
  }

  private setMetaValue(key: string, value: string, updatedAt = nowIso()): void {
    this.db
      .prepare(
        `INSERT INTO workspace_meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, updatedAt);
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

  private getAttempt(attemptId: string): AttemptRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId));
    return row ? this.mapAttempt(row) : null;
  }

  private getVmContext(vmContextId: string): VmContextRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM vm_contexts WHERE id = ?').get(vmContextId));
    return row ? this.mapVmContext(row) : null;
  }

  private getHypothesis(hypothesisId: string): HypothesisRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM hypotheses WHERE id = ?').get(hypothesisId));
    return row ? this.mapHypothesis(row) : null;
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

  private getFinding(findingId: string): FindingRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM findings WHERE id = ?').get(findingId));
    return row ? this.mapFinding(row) : null;
  }

  private getApproval(approvalId: string): ApprovalRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId));
    return row ? this.mapApproval(row) : null;
  }

  private getModelSession(modelSessionId: string): ModelSessionRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM model_sessions WHERE id = ?').get(modelSessionId));
    return row ? this.mapModelSession(row) : null;
  }

  private getBenchmarkRun(benchmarkRunId: string): BenchmarkRunRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM benchmark_runs WHERE id = ?').get(benchmarkRunId));
    return row ? this.mapBenchmarkRun(row) : null;
  }

  private getBenchmarkTaskResult(resultId: string): BenchmarkTaskResultRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM benchmark_task_results WHERE id = ?').get(resultId));
    return row ? this.mapBenchmarkTaskResult(row) : null;
  }

  private getExportRecord(exportId: string): ExportRecord | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM exports WHERE id = ?').get(exportId));
    return row ? this.mapExport(row) : null;
  }

  private mapScope(row: SqlRow): ProgramScopeVersion {
    const id = text(row, 'id');
    const assetRows = rows(this.db.prepare('SELECT * FROM scope_assets WHERE scope_version_id = ? ORDER BY created_at ASC').all(id));
    return {
      id,
      version: numberValue(row, 'version'),
      status: text(row, 'status') as ProgramScopeVersion['status'],
      programName: text(row, 'program_name'),
      organizationName: text(row, 'organization_name'),
      descriptionMarkdown: text(row, 'description_markdown'),
      rulesMarkdown: text(row, 'rules_markdown'),
      networkProfile: text(row, 'network_policy_json') ? String(parseJson(row.network_policy_json).defaultProfile ?? 'offline') : 'offline',
      networkPolicy: parseJson(row.network_policy_json),
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
      mode: text(row, 'mode'),
      status: text(row, 'status') as RunStatus,
      title: text(row, 'title'),
      promptMarkdown: text(row, 'prompt_markdown'),
      model: text(row, 'model'),
      reasoningEffort: text(row, 'reasoning_effort'),
      attemptStrategy: text(row, 'attempt_strategy'),
      networkProfile: text(row, 'network_profile'),
      sandboxProfile: text(row, 'sandbox_profile'),
      budget: parseJson(row.budget_json),
      summary: text(row, 'summary'),
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

  private mapHypothesis(row: SqlRow): HypothesisRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      parentHypothesisId: nullableText(row, 'parent_hypothesis_id'),
      state: text(row, 'state'),
      title: text(row, 'title'),
      descriptionMarkdown: text(row, 'description_markdown'),
      component: text(row, 'component'),
      bugClass: text(row, 'bug_class'),
      priorityScore: numberValue(row, 'priority_score'),
      attackerReachability: text(row, 'attacker_reachability'),
      impact: text(row, 'impact'),
      evidenceConfidence: text(row, 'evidence_confidence'),
      exploitPracticality: text(row, 'exploit_practicality'),
      scopeConfidence: text(row, 'scope_confidence'),
      createdTraceEventId: nullableText(row, 'created_trace_event_id'),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at')
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

  private mapFinding(row: SqlRow): FindingRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      hypothesisId: nullableText(row, 'hypothesis_id'),
      state: text(row, 'state'),
      title: text(row, 'title'),
      summaryMarkdown: text(row, 'summary_markdown'),
      affectedAssets: parseJson(row.affected_assets_json),
      affectedVersions: parseJson(row.affected_versions_json),
      impactMarkdown: text(row, 'impact_markdown'),
      priorityScore: numberValue(row, 'priority_score'),
      verifiedByVerifierRunId: nullableText(row, 'verified_by_verifier_run_id'),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at')
    };
  }

  private mapVerifierContract(row: SqlRow): VerifierContractRecord {
    return {
      id: text(row, 'id'),
      runId: text(row, 'run_id'),
      hypothesisId: nullableText(row, 'hypothesis_id'),
      findingId: nullableText(row, 'finding_id'),
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
      networkProfile: text(row, 'network_profile'),
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
      findingId: nullableText(row, 'finding_id'),
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

  private mapBenchmarkRun(row: SqlRow): BenchmarkRunRecord {
    const passCount = numberValue(row, 'pass_count');
    const totalCount = numberValue(row, 'total_count');
    const identity: BenchmarkHarnessIdentity = {
      model: text(row, 'model'),
      reasoningEffort: text(row, 'reasoning_effort'),
      harnessName: text(row, 'harness_name'),
      harnessVersion: text(row, 'harness_version'),
      promptVersion: text(row, 'prompt_version'),
      toolsetVersion: text(row, 'toolset_version'),
      verifierVersion: text(row, 'verifier_version'),
      sandboxBackend: text(row, 'sandbox_backend'),
      sandboxImageVersion: text(row, 'sandbox_image_version'),
      networkProfile: text(row, 'network_profile'),
      attemptStrategy: text(row, 'attempt_strategy'),
      attemptCount: numberValue(row, 'attempt_count'),
      taskSubsetId: text(row, 'task_subset_id'),
      taskIds: parseStringArray(row.task_ids_json),
      benchmarkVersion: text(row, 'benchmark_version'),
      date: text(row, 'started_at'),
      cost: parseJson(row.cost_json),
      tokens: parseJson(row.tokens_json),
      wallTimeMs: numberValue(row, 'wall_time_ms'),
      passCount,
      totalCount,
      passRate: totalCount > 0 ? passCount / totalCount : 0,
      smallSampleWarning: totalCount > 0 && totalCount < 25 ? `Small sample: ${passCount}/${totalCount}` : null
    };
    return {
      id: text(row, 'id'),
      suiteKind: text(row, 'suite_kind') as BenchmarkSuiteKind,
      suiteId: text(row, 'suite_id'),
      status: text(row, 'status') as BenchmarkRunRecord['status'],
      identity,
      metadata: parseJson(row.metadata_json),
      createdAt: text(row, 'created_at'),
      startedAt: text(row, 'started_at'),
      endedAt: nullableText(row, 'ended_at')
    };
  }

  private mapBenchmarkTaskResult(row: SqlRow): BenchmarkTaskResultRecord {
    return {
      id: text(row, 'id'),
      benchmarkRunId: text(row, 'benchmark_run_id'),
      taskId: text(row, 'task_id'),
      suiteKind: text(row, 'suite_kind') as BenchmarkSuiteKind,
      mode: text(row, 'mode') as BenchmarkTaskMode,
      status: text(row, 'status') as BenchmarkResultStatus,
      score: numberValue(row, 'score'),
      runId: nullableText(row, 'run_id'),
      isolationPassed: booleanValue(row, 'isolation_passed'),
      metrics: parseJson(row.metrics_json),
      graderReport: parseJson(row.grader_report_json),
      agentOutput: parseJson(row.agent_output_json),
      createdAt: text(row, 'created_at')
    };
  }

  private runEngineFromBudget(budget: Record<string, unknown>): RunEngineKind {
    if (budget.runEngine === 'executor_alpha') return 'executor_alpha';
    return budget.runEngine === 'openai_responses' ? 'openai_responses' : 'fake';
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspace_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_scope_versions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  program_name TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  description_markdown TEXT NOT NULL,
  network_policy_json TEXT NOT NULL,
  rules_markdown TEXT NOT NULL,
  active_from TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_assets (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES program_scope_versions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in_scope', 'out_of_scope')),
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  attributes_json TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  scope_version_id TEXT NOT NULL REFERENCES program_scope_versions(id),
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt_markdown TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  attempt_strategy TEXT NOT NULL,
  network_profile TEXT NOT NULL,
  sandbox_profile TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS vm_contexts (
  id TEXT PRIMARY KEY,
  backend TEXT NOT NULL,
  image_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  state TEXT NOT NULL,
  network_profile TEXT NOT NULL,
  scope_version_id TEXT NOT NULL REFERENCES program_scope_versions(id),
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

CREATE TABLE IF NOT EXISTS hypotheses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  parent_hypothesis_id TEXT REFERENCES hypotheses(id),
  state TEXT NOT NULL,
  title TEXT NOT NULL,
  description_markdown TEXT NOT NULL,
  component TEXT NOT NULL,
  bug_class TEXT NOT NULL,
  priority_score REAL NOT NULL,
  attacker_reachability TEXT NOT NULL,
  impact TEXT NOT NULL,
  evidence_confidence TEXT NOT NULL,
  exploit_practicality TEXT NOT NULL,
  scope_confidence TEXT NOT NULL,
  created_trace_event_id TEXT REFERENCES trace_events(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  hypothesis_id TEXT REFERENCES hypotheses(id),
  state TEXT NOT NULL,
  title TEXT NOT NULL,
  summary_markdown TEXT NOT NULL,
  affected_assets_json TEXT NOT NULL,
  affected_versions_json TEXT NOT NULL,
  impact_markdown TEXT NOT NULL,
  priority_score REAL NOT NULL,
  verified_by_verifier_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  hypothesis_id TEXT REFERENCES hypotheses(id),
  finding_id TEXT REFERENCES findings(id),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  observation_trace_event_id TEXT REFERENCES trace_events(id),
  artifact_id TEXT REFERENCES artifacts(id),
  verifier_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verifier_contracts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  hypothesis_id TEXT REFERENCES hypotheses(id),
  finding_id TEXT REFERENCES findings(id),
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
  finding_id TEXT REFERENCES findings(id),
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

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY,
  suite_kind TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  harness_name TEXT NOT NULL,
  harness_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  toolset_version TEXT NOT NULL,
  verifier_version TEXT NOT NULL,
  sandbox_backend TEXT NOT NULL,
  sandbox_image_version TEXT NOT NULL,
  network_profile TEXT NOT NULL,
  attempt_strategy TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  task_subset_id TEXT NOT NULL,
  task_ids_json TEXT NOT NULL,
  benchmark_version TEXT NOT NULL,
  cost_json TEXT NOT NULL,
  tokens_json TEXT NOT NULL,
  wall_time_ms INTEGER NOT NULL,
  pass_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS benchmark_task_results (
  id TEXT PRIMARY KEY,
  benchmark_run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  suite_kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  run_id TEXT REFERENCES runs(id),
  isolation_passed INTEGER NOT NULL CHECK (isolation_passed IN (0, 1)),
  metrics_json TEXT NOT NULL,
  grader_report_json TEXT NOT NULL,
  agent_output_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(entity_type, entity_id UNINDEXED, text);

CREATE INDEX IF NOT EXISTS idx_scope_assets_kind_value ON scope_assets(kind, value);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_attempts_run_status ON attempts(run_id, status);
CREATE INDEX IF NOT EXISTS idx_model_sessions_run ON model_sessions(run_id);
CREATE INDEX IF NOT EXISTS idx_trace_run_sequence ON trace_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_trace_artifact ON trace_events(artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_sha256 ON artifacts(sha256);
CREATE INDEX IF NOT EXISTS idx_hypotheses_run_state ON hypotheses(run_id, state);
CREATE INDEX IF NOT EXISTS idx_findings_run_state ON findings(run_id, state);
CREATE INDEX IF NOT EXISTS idx_verifier_runs_status ON verifier_runs(status);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_suite_model ON benchmark_runs(suite_kind, model, reasoning_effort, task_subset_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_task_results_run ON benchmark_task_results(benchmark_run_id);
`;
