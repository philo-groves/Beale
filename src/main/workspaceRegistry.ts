import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyDatabaseMigrations } from './databaseMigrations';
import type {
  DeveloperSettings,
  WorkspaceDirectorySelection,
  WorkspaceOnboardingDefaults,
  WorkspaceRegistryEntry,
  WorkspaceRegistryState,
  ResearchSessionSummary,
  RunEngineKind,
  RunStatus,
  VmPreference,
  WorkspaceSnapshot
} from '@shared/types';

interface SqlRow {
  [key: string]: unknown;
}

const DEFAULT_VM_PREFERENCE: VmPreference = {
  enabled: false,
  backendKind: null,
  updatedAt: null
};

function defaultWorkspaceRegistryDirectory(): string {
  return process.env.BEALE_WORKSPACE_REGISTRY_DIR?.trim() || join(homedir(), '.beale');
}

export class WorkspaceRegistry {
  private readonly db: DatabaseSync;
  public readonly registryPath: string;

  public constructor(registryDirectory = defaultWorkspaceRegistryDirectory()) {
    mkdirSync(registryDirectory, { recursive: true });
    this.registryPath = join(registryDirectory, 'workspace-registry.sqlite');
    this.db = new DatabaseSync(this.registryPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initialize();
  }

  public close(): void {
    this.db.close();
  }

  public getState(): WorkspaceRegistryState {
    return {
      registryPath: this.registryPath,
      vmPreference: this.getVmPreference(),
      workspaces: this.listWorkspaces(),
      researchSessions: this.listResearchSessions()
    };
  }

  public getVmPreference(): VmPreference {
    return DEFAULT_VM_PREFERENCE;
  }

  public getProfilingEnabled(): boolean {
    return this.getMeta('profiling_enabled') === '1';
  }

  public setProfilingEnabled(enabled: boolean): void {
    this.setMeta('profiling_enabled', enabled ? '1' : '0');
  }

  public getDeveloperSettings(): DeveloperSettings {
    return {
      developerModeEnabled: this.getDeveloperModeEnabled()
    };
  }

  public getDeveloperModeEnabled(): boolean {
    return this.getMeta('developer_mode_enabled') === '1';
  }

  public setDeveloperModeEnabled(enabled: boolean): DeveloperSettings {
    this.setMeta('developer_mode_enabled', enabled ? '1' : '0');
    return this.getDeveloperSettings();
  }

  public inspectDirectory(path: string): WorkspaceDirectorySelection {
    const workspacePath = resolve(path);
    const knownWorkspace = this.getWorkspaceByPath(workspacePath);
    return {
      canceled: false,
      path: workspacePath,
      knownWorkspace,
      requiresOnboarding: !knownWorkspace,
      defaults: knownWorkspace ? null : defaultsForWorkspaceDirectory(workspacePath)
    };
  }

  public getWorkspace(registryWorkspaceId: string): WorkspaceRegistryEntry | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(registryWorkspaceId));
    return row ? this.mapWorkspace(row) : null;
  }

  public getWorkspaceByPath(path: string): WorkspaceRegistryEntry | null {
    const row = rowOrUndefined(this.db.prepare('SELECT * FROM workspaces WHERE workspace_path = ?').get(resolve(path)));
    return row ? this.mapWorkspace(row) : null;
  }

  public getLastKnownWorkspace(): WorkspaceRegistryEntry | null {
    const metaWorkspaceId = this.getMeta('last_registry_workspace_id');
    if (metaWorkspaceId) {
      const workspace = this.getWorkspace(metaWorkspaceId);
      if (workspace) return workspace;
    }

    const row = rowOrUndefined(
      this.db
        .prepare(
          `SELECT *
           FROM workspaces
           WHERE last_opened_at IS NOT NULL
           ORDER BY last_opened_at DESC, updated_at DESC
           LIMIT 1`
        )
        .get()
    );
    return row ? this.mapWorkspace(row) : null;
  }

  public removeRegisteredWorkspace(registryWorkspaceId: string): WorkspaceRegistryEntry | null {
    const workspace = this.getWorkspace(registryWorkspaceId);
    if (!workspace) return null;

    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(registryWorkspaceId);
    if (this.getMeta('last_registry_workspace_id') === registryWorkspaceId) {
      this.deleteMeta('last_registry_workspace_id');
    }
    if (this.getMeta('last_workspace_path') === workspace.workspacePath) {
      this.deleteMeta('last_workspace_path');
    }
    return workspace;
  }

  public syncWorkspace(snapshot: WorkspaceSnapshot, options: { rememberLast?: boolean } = {}): void {
    const workspace = this.upsertWorkspaceFromSnapshot(snapshot);
    if (options.rememberLast ?? true) {
      this.rememberLastKnownWorkspace(workspace);
    }
    for (const row of snapshot.runs) {
      this.upsertResearchSession(workspace.id, snapshot.workspace.workspacePath, snapshot.workspace.workspaceId, row, sessionUpdatedAt(row));
    }
  }

  private initialize(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    applyDatabaseMigrations(this.db, 'beale_registry', [{
      version: 1,
      name: 'registry_schema_baseline',
      up: (database) => database.exec(`
      CREATE TABLE IF NOT EXISTS registry_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        workspace_name TEXT NOT NULL,
        scope_owner TEXT NOT NULL,
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
        registry_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        workspace_path TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        run_engine TEXT NOT NULL,
        mode TEXT NOT NULL,
        prompt_markdown TEXT NOT NULL DEFAULT '',
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

      CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at ON workspaces(updated_at);
      CREATE INDEX IF NOT EXISTS idx_research_sessions_registry_workspace_id ON research_sessions(registry_workspace_id);
      CREATE INDEX IF NOT EXISTS idx_research_sessions_updated_at ON research_sessions(updated_at);
      DELETE FROM registry_meta WHERE key = 'schema_version';
    `)
    }]);
  }

  private listWorkspaces(): WorkspaceRegistryEntry[] {
    return rows(this.db.prepare('SELECT * FROM workspaces ORDER BY created_at DESC, id DESC').all()).map((row) => this.mapWorkspace(row));
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

  private deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM registry_meta WHERE key = ?').run(key);
  }

  private rememberLastKnownWorkspace(workspace: WorkspaceRegistryEntry): void {
    this.setMeta('last_registry_workspace_id', workspace.id);
    this.setMeta('last_workspace_path', workspace.workspacePath);
  }

  private upsertWorkspaceFromSnapshot(snapshot: WorkspaceSnapshot): WorkspaceRegistryEntry {
    const now = nowIso();
    const scope = snapshot.activeScope;
    const workspacePath = resolve(snapshot.workspace.workspacePath);
    const existing = this.getWorkspaceByPath(workspacePath);
    if (existing) {
      this.db
        .prepare(
          `UPDATE workspaces SET
            workspace_id = ?,
            workspace_name = ?,
            scope_owner = ?,
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
          scope.workspaceName,
          scope.scopeOwner,
          scope.descriptionMarkdown,
          scope.rulesMarkdown,
          scope.networkProfile,
          scope.expiresAt,
          now,
          now,
          existing.id
        );
      const updated = this.getWorkspace(existing.id);
      if (!updated) throw new Error(`Workspace registry update failed: ${existing.id}`);
      return updated;
    }

    const id = `workspace_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO workspaces (
          id, workspace_path, workspace_id, workspace_name, scope_owner, description_markdown,
          rules_markdown, network_profile, expires_at, created_at, updated_at, last_opened_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspacePath,
        snapshot.workspace.workspaceId,
        scope.workspaceName,
        scope.scopeOwner,
        scope.descriptionMarkdown,
        scope.rulesMarkdown,
        scope.networkProfile,
        scope.expiresAt,
        now,
        now,
        now
      );
    const inserted = this.getWorkspace(id);
    if (!inserted) throw new Error(`Workspace registry insert failed: ${id}`);
    return inserted;
  }

  private upsertResearchSession(
    registryWorkspaceId: string,
    workspacePath: string,
    workspaceId: string,
    row: WorkspaceSnapshot['runs'][number],
    updatedAt: string
  ): void {
    const run = row.run;
    const existing = rowOrUndefined(this.db.prepare('SELECT id FROM research_sessions WHERE workspace_path = ? AND run_id = ?').get(resolve(workspacePath), run.id));
    const values = [
      registryWorkspaceId,
      resolve(workspacePath),
      workspaceId,
      run.id,
      run.title,
      run.status,
      row.engine,
      run.mode,
      run.promptMarkdown,
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
            registry_workspace_id = ?,
            workspace_path = ?,
            workspace_id = ?,
            run_id = ?,
            title = ?,
            status = ?,
            run_engine = ?,
            mode = ?,
            prompt_markdown = ?,
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
          id, registry_workspace_id, workspace_path, workspace_id, run_id, title, status, run_engine,
          mode, prompt_markdown, summary, model, reasoning_effort, network_profile, sandbox_profile,
          created_at, started_at, ended_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`session_${randomUUID()}`, ...values);
  }

  private mapWorkspace(row: SqlRow): WorkspaceRegistryEntry {
    const workspacePath = text(row, 'workspace_path');
    const runSummary = rowOrUndefined(this.db.prepare('SELECT COUNT(*) AS run_count, MAX(created_at) AS last_run_at FROM research_sessions WHERE workspace_path = ?').get(workspacePath));
    return {
      id: text(row, 'id'),
      workspacePath,
      workspaceId: text(row, 'workspace_id'),
      workspaceName: text(row, 'workspace_name'),
      scopeOwner: text(row, 'scope_owner'),
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
      registryWorkspaceId: text(row, 'registry_workspace_id'),
      workspacePath: text(row, 'workspace_path'),
      workspaceId: text(row, 'workspace_id'),
      runId: text(row, 'run_id'),
      title: text(row, 'title'),
      status: text(row, 'status') as RunStatus,
      runEngine: text(row, 'run_engine') as RunEngineKind,
      mode: text(row, 'mode'),
      promptMarkdown: text(row, 'prompt_markdown'),
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

export function defaultsForWorkspaceDirectory(workspacePath: string): WorkspaceOnboardingDefaults {
  return {
    workspacePath: resolve(workspacePath),
    workspaceName: titleFromDirectoryName(basename(resolve(workspacePath))),
    scopeOwner: '',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    networkProfile: 'elevated',
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


function sessionUpdatedAt(row: WorkspaceSnapshot['runs'][number]): string {
  return row.run.endedAt ?? row.run.startedAt ?? row.run.createdAt;
}

function titleFromDirectoryName(value: string): string {
  const normalized = value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'Untitled Workspace';
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nowIso(): string {
  return new Date().toISOString();
}
