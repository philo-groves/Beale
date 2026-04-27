import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ProgramDirectorySelection,
  ProgramOnboardingDefaults,
  ProgramRegistryEntry,
  ProgramRegistryState,
  ResearchSessionSummary,
  RunEngineKind,
  RunStatus,
  WorkspaceSnapshot
} from '@shared/types';

interface SqlRow {
  [key: string]: unknown;
}

export class ProgramRegistry {
  private readonly db: DatabaseSync;
  public readonly registryPath: string;

  public constructor(registryDirectory = join(homedir(), '.beale')) {
    mkdirSync(registryDirectory, { recursive: true });
    this.registryPath = join(registryDirectory, 'registry.sqlite');
    this.db = new DatabaseSync(this.registryPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initialize();
  }

  public close(): void {
    this.db.close();
  }

  public getState(): ProgramRegistryState {
    return {
      registryPath: this.registryPath,
      programs: this.listPrograms(),
      researchSessions: this.listResearchSessions()
    };
  }

  public inspectDirectory(path: string): ProgramDirectorySelection {
    const workspacePath = resolve(path);
    const knownProgram = this.getProgramByPath(workspacePath);
    return {
      canceled: false,
      path: workspacePath,
      knownProgram,
      requiresOnboarding: !knownProgram,
      defaults: knownProgram ? null : defaultsForProgramDirectory(workspacePath)
    };
  }

  public getProgram(programId: string): ProgramRegistryEntry | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM programs WHERE id = ?').get(programId));
    return row ? this.mapProgram(row) : null;
  }

  public getProgramByPath(path: string): ProgramRegistryEntry | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM programs WHERE workspace_path = ?').get(resolve(path)));
    return row ? this.mapProgram(row) : null;
  }

  public getLastKnownProgram(): ProgramRegistryEntry | null {
    const metaProgramId = this.getMeta('last_program_id');
    if (metaProgramId) {
      const program = this.getProgram(metaProgramId);
      if (program) return program;
    }

    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT *
           FROM programs
           WHERE last_opened_at IS NOT NULL
           ORDER BY last_opened_at DESC, updated_at DESC
           LIMIT 1`
        )
        .get()
    );
    return row ? this.mapProgram(row) : null;
  }

  public syncWorkspace(snapshot: WorkspaceSnapshot): void {
    const program = this.upsertProgramFromSnapshot(snapshot);
    this.rememberLastKnownProgram(program);
    const now = nowIso();
    for (const row of snapshot.runs) {
      this.upsertResearchSession(program.id, snapshot.workspace.workspacePath, snapshot.workspace.workspaceId, row, now);
    }
  }

  private initialize(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS registry_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS programs (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL UNIQUE,
        workspace_id TEXT,
        program_name TEXT NOT NULL,
        organization_name TEXT NOT NULL,
        description_markdown TEXT NOT NULL,
        rules_markdown TEXT NOT NULL,
        network_profile TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );

      CREATE TABLE IF NOT EXISTS research_sessions (
        id TEXT PRIMARY KEY,
        program_id TEXT REFERENCES programs(id) ON DELETE SET NULL,
        workspace_path TEXT NOT NULL,
        workspace_id TEXT,
        run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        run_engine TEXT NOT NULL,
        mode TEXT NOT NULL,
        summary TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        network_profile TEXT NOT NULL,
        sandbox_profile TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_path, run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_programs_updated_at ON programs(updated_at);
      CREATE INDEX IF NOT EXISTS idx_research_sessions_program_id ON research_sessions(program_id);
      CREATE INDEX IF NOT EXISTS idx_research_sessions_updated_at ON research_sessions(updated_at);
    `);
    this.db
      .prepare('INSERT OR IGNORE INTO registry_meta (key, value, updated_at) VALUES (?, ?, ?)')
      .run('schema_version', '1', nowIso());
  }

  private listPrograms(): ProgramRegistryEntry[] {
    return rows(this.db.prepare('SELECT * FROM programs ORDER BY created_at DESC, id DESC').all()).map((row) => this.mapProgram(row));
  }

  private listResearchSessions(limit = 200): ResearchSessionSummary[] {
    return rows(this.db.prepare('SELECT * FROM research_sessions ORDER BY updated_at DESC LIMIT ?').all(limit)).map((row) => this.mapResearchSession(row));
  }

  private getMeta(key: string): string | null {
    const row = rowOrUndefined(this.db.prepare('SELECT value FROM registry_meta WHERE key = ?').get(key));
    return row ? text(row, 'value') : null;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO registry_meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, nowIso());
  }

  private rememberLastKnownProgram(program: ProgramRegistryEntry): void {
    this.setMeta('last_program_id', program.id);
    this.setMeta('last_workspace_path', program.workspacePath);
  }

  private upsertProgramFromSnapshot(snapshot: WorkspaceSnapshot): ProgramRegistryEntry {
    const now = nowIso();
    const scope = snapshot.activeScope;
    const workspacePath = resolve(snapshot.workspace.workspacePath);
    const existing = this.getProgramByPath(workspacePath);
    if (existing) {
      this.db
        .prepare(
          `UPDATE programs SET
            workspace_id = ?,
            program_name = ?,
            organization_name = ?,
            description_markdown = ?,
            rules_markdown = ?,
            network_profile = ?,
            expires_at = ?,
            updated_at = ?,
            last_opened_at = ?
           WHERE id = ?`
        )
        .run(
          snapshot.workspace.workspaceId,
          scope.programName,
          scope.organizationName,
          scope.descriptionMarkdown,
          scope.rulesMarkdown,
          scope.networkProfile,
          scope.expiresAt,
          now,
          now,
          existing.id
        );
      const updated = this.getProgram(existing.id);
      if (!updated) throw new Error(`Program registry update failed: ${existing.id}`);
      return updated;
    }

    const id = `program_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO programs (
          id, workspace_path, workspace_id, program_name, organization_name, description_markdown,
          rules_markdown, network_profile, expires_at, created_at, updated_at, last_opened_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspacePath,
        snapshot.workspace.workspaceId,
        scope.programName,
        scope.organizationName,
        scope.descriptionMarkdown,
        scope.rulesMarkdown,
        scope.networkProfile,
        scope.expiresAt,
        now,
        now,
        now
      );
    const inserted = this.getProgram(id);
    if (!inserted) throw new Error(`Program registry insert failed: ${id}`);
    return inserted;
  }

  private upsertResearchSession(
    programId: string,
    workspacePath: string,
    workspaceId: string,
    row: WorkspaceSnapshot['runs'][number],
    updatedAt: string
  ): void {
    const run = row.run;
    const existing = rowOrUndefined(this.db.prepare('SELECT id FROM research_sessions WHERE workspace_path = ? AND run_id = ?').get(resolve(workspacePath), run.id));
    const values = [
      programId,
      resolve(workspacePath),
      workspaceId,
      run.id,
      run.title,
      run.status,
      row.engine,
      run.mode,
      run.summary,
      run.model,
      run.reasoningEffort,
      run.networkProfile,
      run.sandboxProfile,
      run.createdAt,
      run.startedAt,
      run.endedAt,
      updatedAt
    ];

    if (existing) {
      this.db
        .prepare(
          `UPDATE research_sessions SET
            program_id = ?,
            workspace_path = ?,
            workspace_id = ?,
            run_id = ?,
            title = ?,
            status = ?,
            run_engine = ?,
            mode = ?,
            summary = ?,
            model = ?,
            reasoning_effort = ?,
            network_profile = ?,
            sandbox_profile = ?,
            created_at = ?,
            started_at = ?,
            ended_at = ?,
            updated_at = ?
           WHERE id = ?`
        )
        .run(...values, text(existing, 'id'));
      return;
    }

    this.db
      .prepare(
        `INSERT INTO research_sessions (
          id, program_id, workspace_path, workspace_id, run_id, title, status, run_engine,
          mode, summary, model, reasoning_effort, network_profile, sandbox_profile,
          created_at, started_at, ended_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`session_${randomUUID()}`, ...values);
  }

  private mapProgram(row: SqlRow): ProgramRegistryEntry {
    const workspacePath = text(row, 'workspace_path');
    const runSummary = rowOrUndefined(this.db.prepare('SELECT COUNT(*) AS run_count, MAX(created_at) AS last_run_at FROM research_sessions WHERE workspace_path = ?').get(workspacePath));
    return {
      id: text(row, 'id'),
      workspacePath,
      workspaceId: nullableText(row, 'workspace_id'),
      programName: text(row, 'program_name'),
      organizationName: text(row, 'organization_name'),
      descriptionMarkdown: text(row, 'description_markdown'),
      rulesMarkdown: text(row, 'rules_markdown'),
      networkProfile: text(row, 'network_profile'),
      expiresAt: nullableText(row, 'expires_at'),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at'),
      lastOpenedAt: nullableText(row, 'last_opened_at'),
      runCount: runSummary ? numberValue(runSummary, 'run_count') : 0,
      lastRunAt: runSummary ? nullableText(runSummary, 'last_run_at') : null
    };
  }

  private mapResearchSession(row: SqlRow): ResearchSessionSummary {
    return {
      id: text(row, 'id'),
      programId: nullableText(row, 'program_id'),
      workspacePath: text(row, 'workspace_path'),
      workspaceId: nullableText(row, 'workspace_id'),
      runId: text(row, 'run_id'),
      title: text(row, 'title'),
      status: text(row, 'status') as RunStatus,
      runEngine: text(row, 'run_engine') as RunEngineKind,
      mode: text(row, 'mode'),
      summary: text(row, 'summary'),
      model: text(row, 'model'),
      reasoningEffort: text(row, 'reasoning_effort'),
      networkProfile: text(row, 'network_profile'),
      sandboxProfile: text(row, 'sandbox_profile'),
      createdAt: text(row, 'created_at'),
      startedAt: nullableText(row, 'started_at'),
      endedAt: nullableText(row, 'ended_at'),
      updatedAt: text(row, 'updated_at')
    };
  }
}

export function defaultsForProgramDirectory(workspacePath: string): ProgramOnboardingDefaults {
  return {
    workspacePath: resolve(workspacePath),
    programName: titleFromDirectoryName(basename(resolve(workspacePath))),
    organizationName: '',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    networkProfile: 'offline',
    expiresAt: null,
    assets: []
  };
}

function rows(value: unknown[]): SqlRow[] {
  return value as SqlRow[];
}

function rowOrUndefined(value: unknown): SqlRow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as SqlRow;
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
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function titleFromDirectoryName(value: string): string {
  const normalized = value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'Untitled Program';
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nowIso(): string {
  return new Date().toISOString();
}
