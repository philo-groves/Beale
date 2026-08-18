import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyDatabaseMigrations } from './databaseMigrations';
import type {
  DeveloperSettings,
  DebuggingSettings,
  ProviderSettings,
  ProviderModelDefaults,
  ProviderAuthenticationMethod,
  ResearchModelProviderId,
  MemorySettings,
  MemoryTypeDescriptions,
  ShellOptions,
  WorkspaceDirectorySelection,
  WorkspaceOnboardingDefaults,
  WorkspaceRegistryEntry,
  WorkspaceRegistryState,
  ResearchSessionSummary,
  BreakoutRoomSummary,
  SessionFinalDisposition,
  RunEngineKind,
  RunStatus,
  WorkspaceSnapshot
} from '@shared/types';
import type { HoneycrispSessionSummary } from './honeycrispCliClient';
import type { ResearchProfileId } from '@shared/types';
import { DEFAULT_MEMORY_TYPE_DESCRIPTIONS, isResearchProfileId, MEMORY_NODE_TYPES } from '../shared/types';
import { isOptionalProviderModel, isOptionalProviderModelEnabled } from '../shared/optionalProviderModels';

interface SqlRow {
  [key: string]: unknown;
}

const DEFAULT_SHELL_OPTIONS: ShellOptions = {
  defaultConcurrency: 4,
  utilities: { sudo: 0 }
};
const MAX_SHELL_UTILITY_CONCURRENCY = 64;
const SHELL_UTILITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const MAX_MEMORY_TYPE_DESCRIPTION_CHARACTERS = 4_000;
const MAX_MEMORY_TYPE_DESCRIPTIONS_JSON_CHARACTERS = 64_000;
const DEFAULT_RESEARCH_PROFILE_ID: ResearchProfileId = 'security-research';

function defaultWorkspaceRegistryDirectory(): string {
  return process.env.BEALE_WORKSPACE_REGISTRY_DIR?.trim() || join(homedir(), '.beale');
}

export class WorkspaceRegistry {
  private readonly db: DatabaseSync;
  public readonly registryPath: string;
  private readonly shellOptionsPath: string;
  private readonly shellLeaseDirectory: string;

  public constructor(registryDirectory = defaultWorkspaceRegistryDirectory()) {
    mkdirSync(registryDirectory, { recursive: true });
    this.registryPath = join(registryDirectory, 'workspace-registry.sqlite');
    this.shellOptionsPath = join(registryDirectory, 'shell-options.json');
    this.shellLeaseDirectory = join(registryDirectory, 'shell-leases');
    this.db = new DatabaseSync(this.registryPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initialize();
    this.writeShellOptionsFile(this.getShellOptions());
  }

  public close(): void {
    this.db.close();
  }

  public getState(): WorkspaceRegistryState {
    return {
      registryPath: this.registryPath,
      workspaces: this.listWorkspaces(),
      researchSessions: this.listResearchSessions()
    };
  }

  public markResearchSessionViewed(sessionId: string, viewedAt = nowIso()): void {
    this.db.prepare('UPDATE research_sessions SET result_viewed_at = ? WHERE id = ?').run(viewedAt, sessionId);
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

  public getProviderSettings(): ProviderSettings {
    const cyberPolicyRiskAcknowledgements: Partial<Record<ResearchModelProviderId, true>> = {};
    const enabledOptionalModels = normalizeEnabledOptionalModelsRecord(this.getMeta('provider_optional_models_json'));
    const disabledOptionalModels = normalizeEnabledOptionalModelsRecord(this.getMeta('provider_disabled_optional_models_json'));
    const preferredAuthenticationMethods = normalizePreferredAuthenticationMethodsRecord(
      this.getMeta('provider_preferred_authentication_methods_json')
    );
    if (this.getMeta('openai_trusted_access_cyber_risk_acknowledged') === '1') {
      cyberPolicyRiskAcknowledgements['openai-codex'] = true;
    }
    if (this.getMeta('anthropic_cvp_risk_acknowledged') === '1') {
      cyberPolicyRiskAcknowledgements.anthropic = true;
    }
    if (this.getMeta('xai_policy_use_risk_acknowledged') === '1') {
      cyberPolicyRiskAcknowledgements.xai = true;
    }
    if (this.getMeta('zai_policy_use_risk_acknowledged') === '1') {
      cyberPolicyRiskAcknowledgements.zai = true;
    }
    return {
      defaultProviderId: normalizeDefaultProviderId(this.getMeta('default_provider_id')),
      modelDefaults: normalizeProviderModelDefaultsRecord(this.getMeta('provider_model_defaults_json')),
      ...(Object.keys(enabledOptionalModels).length > 0 ? { enabledOptionalModels } : {}),
      ...(Object.keys(disabledOptionalModels).length > 0 ? { disabledOptionalModels } : {}),
      ...(Object.keys(preferredAuthenticationMethods).length > 0 ? { preferredAuthenticationMethods } : {}),
      ...(Object.keys(cyberPolicyRiskAcknowledgements).length > 0 ? { cyberPolicyRiskAcknowledgements } : {})
    };
  }

  public setDefaultProviderId(providerId: ResearchModelProviderId | null): ProviderSettings {
    if (providerId === null) {
      this.deleteMeta('default_provider_id');
    } else {
      if (!isResearchModelProviderId(providerId)) throw new Error('Invalid default provider.');
      this.setMeta('default_provider_id', providerId);
    }
    return this.getProviderSettings();
  }

  public setProviderModelDefaults(providerId: ResearchModelProviderId, defaults: ProviderModelDefaults): ProviderSettings {
    if (!isResearchModelProviderId(providerId)) throw new Error('Invalid provider model defaults provider.');
    const settings = this.getProviderSettings();
    settings.modelDefaults[providerId] = normalizeProviderModelDefaults(defaults);
    this.setMeta('provider_model_defaults_json', JSON.stringify(settings.modelDefaults));
    return settings;
  }

  public setProviderOptionalModelEnabled(
    providerId: ResearchModelProviderId,
    modelId: string,
    enabled: boolean
  ): ProviderSettings {
    if (!isResearchModelProviderId(providerId) || !isOptionalProviderModel(providerId, modelId)) {
      throw new Error('Invalid optional provider model.');
    }
    const settings = this.getProviderSettings();
    const current = new Set(settings.enabledOptionalModels?.[providerId] ?? []);
    const disabledCurrent = new Set(settings.disabledOptionalModels?.[providerId] ?? []);
    const enabledByDefault = isOptionalProviderModelEnabled(null, providerId, modelId);
    if (enabled) {
      disabledCurrent.delete(modelId);
      if (enabledByDefault) current.delete(modelId);
      else current.add(modelId);
    } else {
      current.delete(modelId);
      if (enabledByDefault) disabledCurrent.add(modelId);
      else disabledCurrent.delete(modelId);
    }
    const enabledOptionalModels = { ...settings.enabledOptionalModels };
    const disabledOptionalModels = { ...settings.disabledOptionalModels };
    if (current.size > 0) enabledOptionalModels[providerId] = [...current];
    else delete enabledOptionalModels[providerId];
    if (disabledCurrent.size > 0) disabledOptionalModels[providerId] = [...disabledCurrent];
    else delete disabledOptionalModels[providerId];
    this.setMeta('provider_optional_models_json', JSON.stringify(enabledOptionalModels));
    this.setMeta('provider_disabled_optional_models_json', JSON.stringify(disabledOptionalModels));
    if (!enabled) {
      const defaults = settings.modelDefaults[providerId];
      if (defaults && (defaults.largeModel === modelId || defaults.smallModel === modelId)) {
        delete settings.modelDefaults[providerId];
        this.setMeta('provider_model_defaults_json', JSON.stringify(settings.modelDefaults));
      }
    }
    return this.getProviderSettings();
  }

  public setProviderCyberPolicyRiskAcknowledged(
    providerId: ResearchModelProviderId,
    acknowledged: boolean
  ): ProviderSettings {
    if (!isResearchModelProviderId(providerId)) throw new Error('Invalid cyber policy acknowledgement provider.');
    const metaKey = providerCyberPolicyAcknowledgementMetaKey(providerId);
    if (acknowledged) this.setMeta(metaKey, '1');
    else this.deleteMeta(metaKey);
    return this.getProviderSettings();
  }

  public setProviderPreferredAuthenticationMethod(
    providerId: ResearchModelProviderId,
    method: ProviderAuthenticationMethod
  ): ProviderSettings {
    if (!isResearchModelProviderId(providerId)) throw new Error('Invalid authentication preference provider.');
    if (method !== 'subscription' && method !== 'api_key') throw new Error('Invalid authentication preference.');
    const preferences = {
      ...this.getProviderSettings().preferredAuthenticationMethods,
      [providerId]: method
    };
    this.setMeta('provider_preferred_authentication_methods_json', JSON.stringify(preferences));
    return this.getProviderSettings();
  }

  public getMemorySettings(): MemorySettings {
    const stored = this.getMeta('memory_type_descriptions_json');
    if (!stored) return defaultMemorySettings();
    try {
      return { typeDescriptions: normalizeMemoryTypeDescriptions(JSON.parse(stored) as unknown) };
    } catch {
      return defaultMemorySettings();
    }
  }

  public setMemoryTypeDescriptions(descriptions: MemoryTypeDescriptions): MemorySettings {
    const normalized = normalizeMemoryTypeDescriptions(descriptions);
    this.setMeta('memory_type_descriptions_json', JSON.stringify(normalized));
    return { typeDescriptions: { ...normalized } };
  }

  public getShellOptions(): ShellOptions {
    const stored = this.getMeta('shell_options_json');
    if (!stored) return copyShellOptions(DEFAULT_SHELL_OPTIONS);
    try {
      return normalizeShellOptions(JSON.parse(stored) as unknown);
    } catch {
      return copyShellOptions(DEFAULT_SHELL_OPTIONS);
    }
  }

  public setShellOptions(options: ShellOptions): ShellOptions {
    const normalized = normalizeShellOptions(options);
    this.setMeta('shell_options_json', JSON.stringify(normalized));
    this.writeShellOptionsFile(normalized);
    return copyShellOptions(normalized);
  }

  public getShellOptionsPath(): string {
    this.writeShellOptionsFile(this.getShellOptions());
    return this.shellOptionsPath;
  }

  public inspectDirectory(path: string): WorkspaceDirectorySelection {
    const workspacePath = resolve(path);
    const knownWorkspace = this.getWorkspaceByDirectory(workspacePath);
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

  public getDebuggingSettings(): DebuggingSettings {
    return { tracesEnabled: this.getMeta('traces_enabled') === '1' };
  }

  public setTracesEnabled(enabled: boolean): DebuggingSettings {
    this.setMeta('traces_enabled', enabled ? '1' : '0');
    return this.getDebuggingSettings();
  }

  public getWorkspaceByDirectory(path: string): WorkspaceRegistryEntry | null {
    const directory = resolve(path);
    return this.listWorkspaces().find((workspace) => (
      normalizeWorkspaceDirectories(workspace.workspacePath, workspace.workspaceDirectories).includes(directory)
    )) ?? null;
  }

  public setWorkspaceDirectories(registryWorkspaceId: string, directories: readonly string[]): WorkspaceRegistryEntry {
    const workspace = this.getWorkspace(registryWorkspaceId);
    if (!workspace) throw new Error(`Workspace registry entry not found: ${registryWorkspaceId}`);
    const normalized = normalizeWorkspaceDirectories(workspace.workspacePath, directories);
    for (const directory of normalized) {
      const owner = this.getWorkspaceByDirectory(directory);
      if (owner && owner.id !== registryWorkspaceId) {
        throw new Error(`Directory already belongs to workspace ${owner.workspaceName}: ${directory}`);
      }
    }
    this.db.prepare(`
      UPDATE workspaces
      SET workspace_directories_json = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(normalized), nowIso(), registryWorkspaceId);
    const updated = this.getWorkspace(registryWorkspaceId);
    if (!updated) throw new Error(`Workspace registry update failed: ${registryWorkspaceId}`);
    return updated;
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

  public syncWorkspace(
    snapshot: WorkspaceSnapshot,
    options: { rememberLast?: boolean; researchProfileId?: ResearchProfileId } = {}
  ): void {
    const researchProfileId = options.researchProfileId
      ?? (isResearchProfileId(snapshot.researchProfile.profileId)
        ? snapshot.researchProfile.profileId : DEFAULT_RESEARCH_PROFILE_ID);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const workspace = this.upsertWorkspaceFromSnapshot(snapshot, researchProfileId);
      if (options.rememberLast ?? true) {
        this.rememberLastKnownWorkspace(workspace);
      }
      for (const row of snapshot.runs) {
        if (isUntrackedResourceSession(row)) continue;
        this.upsertResearchSession(
          researchProfileId,
          workspace.id,
          snapshot.workspace.workspacePath,
          snapshot.workspace.workspaceId,
          row,
          sessionUpdatedAt(row)
        );
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  public reconcileHoneycrispSessions(
    researchProfileId: ResearchProfileId,
    workspaceId: string,
    sessions: readonly HoneycrispSessionSummary[]
  ): void {
    const selectBreakoutRooms = this.db.prepare(`
      SELECT breakout_rooms_json FROM research_sessions
      WHERE research_profile_id = ? AND workspace_id = ? AND run_id = ? AND run_engine = 'honeycrisp'
    `);
    const update = this.db.prepare(`
      UPDATE research_sessions SET
        title = ?,
        result_viewed_at = CASE
          WHEN status NOT IN ('blocked', 'completed', 'failed', 'stopped')
            AND ? IN ('blocked', 'completed', 'failed', 'stopped') THEN NULL
          ELSE result_viewed_at
        END,
        status = ?,
        summary = ?,
        model = ?,
        reasoning_effort = ?,
        started_at = ?,
        ended_at = ?,
        updated_at = ?,
        breakout_rooms_json = ?
      WHERE research_profile_id = ?
        AND workspace_id = ?
        AND run_id = ?
        AND run_engine = 'honeycrisp'
    `);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const session of sessions) {
        const current = rowOrUndefined(selectBreakoutRooms.get(researchProfileId, workspaceId, session.id));
        const breakoutRooms = breakoutRoomSummariesForRunStatus(
          current ? parseBreakoutRoomSummaries(current.breakout_rooms_json) : [],
          session.status
        );
        update.run(
          session.title,
          session.status,
          session.status,
          session.summary,
          session.model,
          session.reasoningEffort,
          session.startedAt,
          session.endedAt,
          session.updatedAt,
          JSON.stringify(breakoutRooms),
          researchProfileId,
          workspaceId,
          session.id
        );
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  public markHoneycrispSessionsInterrupted(
    researchProfileId: ResearchProfileId,
    workspaceId: string,
    runIds: readonly string[],
    updatedAt = nowIso()
  ): void {
    const selectBreakoutRooms = this.db.prepare(`
      SELECT breakout_rooms_json FROM research_sessions
      WHERE research_profile_id = ? AND workspace_id = ? AND run_id = ? AND run_engine = 'honeycrisp'
    `);
    const update = this.db.prepare(`
      UPDATE research_sessions SET
        status = 'paused',
        summary = 'Paused because no active Beale runtime owns this session.',
        ended_at = NULL,
        updated_at = ?,
        breakout_rooms_json = ?
      WHERE research_profile_id = ?
        AND workspace_id = ?
        AND run_id = ?
        AND run_engine = 'honeycrisp'
        AND status = 'active'
    `);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const runId of runIds) {
        const current = rowOrUndefined(selectBreakoutRooms.get(researchProfileId, workspaceId, runId));
        const breakoutRooms = breakoutRoomSummariesForRunStatus(
          current ? parseBreakoutRoomSummaries(current.breakout_rooms_json) : [],
          'paused'
        );
        update.run(updatedAt, JSON.stringify(breakoutRooms), researchProfileId, workspaceId, runId);
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
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
        final_disposition_json TEXT,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        sandbox_profile TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        updated_at TEXT NOT NULL,
        breakout_rooms_json TEXT NOT NULL DEFAULT '[]',
        result_viewed_at TEXT,
        UNIQUE(workspace_path, run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at ON workspaces(updated_at);
      CREATE INDEX IF NOT EXISTS idx_research_sessions_registry_workspace_id ON research_sessions(registry_workspace_id);
      CREATE INDEX IF NOT EXISTS idx_research_sessions_updated_at ON research_sessions(updated_at);
      DELETE FROM registry_meta WHERE key = 'schema_version';
    `)
    }, {
      version: 2,
      name: 'structured_session_final_disposition',
      up: (database) => {
        const columns = database.prepare('PRAGMA table_info(research_sessions)').all() as Array<{ name?: unknown }>;
        if (!columns.some((column) => column.name === 'final_disposition_json')) {
          database.exec('ALTER TABLE research_sessions ADD COLUMN final_disposition_json TEXT;');
        }
      }
    }, {
      version: 3,
      name: 'research_profile_isolation',
      up: (database) => {
        const columns = database.prepare('PRAGMA table_info(research_sessions)').all() as Array<{ name?: unknown }>;
        if (!columns.some((column) => column.name === 'research_profile_id')) {
          database.exec("ALTER TABLE research_sessions ADD COLUMN research_profile_id TEXT NOT NULL DEFAULT 'security-research';");
        }
        database.exec(`
          DELETE FROM research_sessions;
          CREATE INDEX IF NOT EXISTS idx_research_sessions_profile_updated
            ON research_sessions(research_profile_id, updated_at);
        `);
      }
    }, {
      version: 4,
      name: 'remove_app_network_profiles',
      up: (database) => {
        const workspaceColumns = database.prepare('PRAGMA table_info(workspaces)').all() as Array<{ name?: unknown }>;
        if (workspaceColumns.some((column) => column.name === 'network_profile')) {
          database.exec('ALTER TABLE workspaces DROP COLUMN network_profile;');
        }
        const sessionColumns = database.prepare('PRAGMA table_info(research_sessions)').all() as Array<{ name?: unknown }>;
        if (sessionColumns.some((column) => column.name === 'network_profile')) {
          database.exec('ALTER TABLE research_sessions DROP COLUMN network_profile;');
        }
      }
    }, {
      version: 5,
      name: 'breakout_room_session_summaries',
      up: (database) => {
        const sessionColumns = database.prepare('PRAGMA table_info(research_sessions)').all() as Array<{ name?: unknown }>;
        if (!sessionColumns.some((column) => column.name === 'breakout_rooms_json')) {
          database.exec("ALTER TABLE research_sessions ADD COLUMN breakout_rooms_json TEXT NOT NULL DEFAULT '[]';");
        }
      }
    }, {
      version: 6,
      name: 'workspace_local_research_profiles',
      up: (database) => {
        const workspaceColumns = database.prepare('PRAGMA table_info(workspaces)').all() as Array<{ name?: unknown }>;
        if (!workspaceColumns.some((column) => column.name === 'research_profile_id')) {
          database.exec("ALTER TABLE workspaces ADD COLUMN research_profile_id TEXT NOT NULL DEFAULT 'security-research';");
        }
        database.exec(`
          UPDATE workspaces
          SET research_profile_id = COALESCE(
            (SELECT value FROM registry_meta WHERE key = 'active_research_profile_id'),
            research_profile_id
          );
          DELETE FROM registry_meta WHERE key = 'active_research_profile_id';
        `);
      }
    }, {
      version: 7,
      name: 'session_result_view_state',
      up: (database) => {
        const sessionColumns = database.prepare('PRAGMA table_info(research_sessions)').all() as Array<{ name?: unknown }>;
        if (!sessionColumns.some((column) => column.name === 'result_viewed_at')) {
          database.exec('ALTER TABLE research_sessions ADD COLUMN result_viewed_at TEXT;');
        }
        database.exec(`
          UPDATE research_sessions
          SET result_viewed_at = updated_at
          WHERE result_viewed_at IS NULL
            AND status IN ('blocked', 'completed', 'failed', 'stopped');
        `);
      }
    }, {
      version: 8,
      name: 'interrupt_terminal_session_breakout_rooms',
      up: (database) => {
        const sessions = rows(database.prepare(
          "SELECT id, status, breakout_rooms_json FROM research_sessions WHERE status <> 'active'"
        ).all());
        const update = database.prepare('UPDATE research_sessions SET breakout_rooms_json = ? WHERE id = ?');
        for (const session of sessions) {
          const current = parseBreakoutRoomSummaries(session.breakout_rooms_json);
          const reconciled = breakoutRoomSummariesForRunStatus(current, text(session, 'status') as RunStatus);
          if (JSON.stringify(current) !== JSON.stringify(reconciled)) {
            update.run(JSON.stringify(reconciled), text(session, 'id'));
          }
        }
      }
    }, {
      version: 9,
      name: 'multi_directory_workspaces',
      up: (database) => {
        const workspaceColumns = database.prepare('PRAGMA table_info(workspaces)').all() as Array<{ name?: unknown }>;
        if (!workspaceColumns.some((column) => column.name === 'workspace_directories_json')) {
          database.exec("ALTER TABLE workspaces ADD COLUMN workspace_directories_json TEXT NOT NULL DEFAULT '[]';");
        }
        database.exec(`
          UPDATE workspaces
          SET workspace_directories_json = json_array(workspace_path)
          WHERE workspace_directories_json = '[]';
        `);
      }
    }]);
  }

  private writeShellOptionsFile(options: ShellOptions): void {
    mkdirSync(this.shellLeaseDirectory, { recursive: true });
    const temporaryPath = `${this.shellOptionsPath}.${randomUUID()}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ schemaVersion: 1, ...options, leaseDirectory: this.shellLeaseDirectory }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    renameSync(temporaryPath, this.shellOptionsPath);
  }

  private listWorkspaces(): WorkspaceRegistryEntry[] {
    return rows(this.db.prepare('SELECT * FROM workspaces ORDER BY created_at DESC, id DESC').all()).map((row) => this.mapWorkspace(row));
  }

  private listResearchSessions(limit = 200): ResearchSessionSummary[] {
    return rows(this.db.prepare('SELECT * FROM research_sessions ORDER BY updated_at DESC LIMIT ?')
      .all(limit)).map((row) => this.mapResearchSession(row));
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

  private upsertWorkspaceFromSnapshot(snapshot: WorkspaceSnapshot, researchProfileId: ResearchProfileId): WorkspaceRegistryEntry {
    const now = nowIso();
    const scope = snapshot.activeScope;
    const workspacePath = resolve(snapshot.workspace.workspacePath);
    const existing = this.getWorkspaceByPath(workspacePath);
    if (existing) {
      this.db
        .prepare(
          `UPDATE workspaces SET
            workspace_id = ?,
            workspace_directories_json = ?,
            workspace_name = ?,
            research_profile_id = ?,
            scope_owner = ?,
            description_markdown = ?,
            rules_markdown = ?,
            expires_at = ?,
            updated_at = ?,
            last_opened_at = ?
           WHERE id = ?`
        )
        .run(
          snapshot.workspace.workspaceId,
          JSON.stringify(normalizeWorkspaceDirectories(workspacePath, snapshot.workspace.workspaceDirectories)),
          scope.workspaceName,
          researchProfileId,
          scope.scopeOwner,
          scope.descriptionMarkdown,
          scope.rulesMarkdown,
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
          id, workspace_path, workspace_directories_json, workspace_id, workspace_name, research_profile_id, scope_owner,
          description_markdown, rules_markdown, expires_at, created_at, updated_at, last_opened_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspacePath,
        JSON.stringify(normalizeWorkspaceDirectories(workspacePath, snapshot.workspace.workspaceDirectories)),
        snapshot.workspace.workspaceId,
        scope.workspaceName,
        researchProfileId,
        scope.scopeOwner,
        scope.descriptionMarkdown,
        scope.rulesMarkdown,
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
    researchProfileId: ResearchProfileId,
    registryWorkspaceId: string,
    workspacePath: string,
    workspaceId: string,
    row: WorkspaceSnapshot['runs'][number],
    updatedAt: string
  ): void {
    const run = row.run;
    const existing = rowOrUndefined(this.db.prepare(
      'SELECT id, status, result_viewed_at FROM research_sessions WHERE research_profile_id = ? AND workspace_path = ? AND run_id = ?'
    ).get(researchProfileId, resolve(workspacePath), run.id));
    const resultViewedAt = existing && !sessionBecameFinal(text(existing, 'status') as RunStatus, run.status)
      ? nullableText(existing, 'result_viewed_at')
      : null;
    const values = [
      researchProfileId,
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
      run.finalDisposition ? JSON.stringify(run.finalDisposition) : null,
      run.model,
      run.reasoningEffort,
      run.sandboxProfile,
      run.createdAt,
      run.startedAt,
      run.endedAt,
      updatedAt,
      JSON.stringify(breakoutRoomSummariesForRunStatus(row.breakoutRooms ?? [], run.status)),
      resultViewedAt
    ];

    if (existing) {
      this.db
        .prepare(
          `UPDATE research_sessions SET
            research_profile_id = ?,
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
            final_disposition_json = ?,
            model = ?,
            reasoning_effort = ?,
            sandbox_profile = ?,
            created_at = ?,
            started_at = ?,
            ended_at = ?,
            updated_at = ?,
            breakout_rooms_json = ?,
            result_viewed_at = ?
           WHERE id = ?`
        )
        .run(...values, text(existing, 'id'));
      return;
    }

    this.db
      .prepare(
        `INSERT INTO research_sessions (
          id, research_profile_id, registry_workspace_id, workspace_path, workspace_id, run_id, title, status, run_engine,
          mode, prompt_markdown, summary, final_disposition_json, model, reasoning_effort,
          sandbox_profile, created_at, started_at, ended_at, updated_at, breakout_rooms_json, result_viewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`session_${randomUUID()}`, ...values);
  }

  private mapWorkspace(row: SqlRow): WorkspaceRegistryEntry {
    const workspacePath = text(row, 'workspace_path');
    const runSummary = rowOrUndefined(this.db.prepare(
      'SELECT COUNT(*) AS run_count, MAX(created_at) AS last_run_at FROM research_sessions WHERE workspace_path = ?'
    ).get(workspacePath));
    return {
      id: text(row, 'id'),
      workspacePath,
      workspaceDirectories: normalizeWorkspaceDirectories(workspacePath, parseStringArray(row.workspace_directories_json)),
      workspaceId: text(row, 'workspace_id'),
      workspaceName: text(row, 'workspace_name'),
      scopeOwner: text(row, 'scope_owner'),
      researchProfileId: isResearchProfileId(row.research_profile_id) ? row.research_profile_id : DEFAULT_RESEARCH_PROFILE_ID,
      descriptionMarkdown: text(row, 'description_markdown'),
      rulesMarkdown: text(row, 'rules_markdown'),
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
      finalDisposition: parseSessionFinalDisposition(row.final_disposition_json),
      model: text(row, 'model'),
      reasoningEffort: text(row, 'reasoning_effort'),
      sandboxProfile: text(row, 'sandbox_profile'),
      createdAt: text(row, 'created_at'),
      startedAt: nullableText(row, 'started_at'),
      endedAt: nullableText(row, 'ended_at'),
      updatedAt: text(row, 'updated_at'),
      resultViewedAt: nullableText(row, 'result_viewed_at'),
      breakoutRooms: breakoutRoomSummariesForRunStatus(
        parseBreakoutRoomSummaries(row.breakout_rooms_json),
        text(row, 'status') as RunStatus
      )
    };
  }
}

function sessionBecameFinal(previous: RunStatus, current: RunStatus): boolean {
  return !isFinalRunStatus(previous) && isFinalRunStatus(current);
}

function isFinalRunStatus(status: RunStatus): boolean {
  return status === 'blocked' || status === 'completed' || status === 'failed' || status === 'stopped';
}

function breakoutRoomSummariesForRunStatus(
  rooms: readonly BreakoutRoomSummary[],
  status: RunStatus
): BreakoutRoomSummary[] {
  if (status === 'active' || status === 'queued') return [...rooms];
  return rooms.map((room) => room.status === 'active' ? { ...room, status: 'interrupted' } : room);
}

export function isUntrackedResourceSession(row: WorkspaceSnapshot['runs'][number]): boolean {
  const context = row.run.budget.resourceContext;
  return Boolean(
    context
    && typeof context === 'object'
    && !Array.isArray(context)
    && (context as Record<string, unknown>).kind === 'report'
  );
}

function parseBreakoutRoomSummaries(value: unknown): BreakoutRoomSummary[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is BreakoutRoomSummary => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const room = entry as Partial<BreakoutRoomSummary>;
      return typeof room.id === 'string'
        && typeof room.runId === 'string'
        && typeof room.title === 'string'
        && typeof room.status === 'string'
        && typeof room.memberCount === 'number'
        && room.memberCount >= 2
        && Array.isArray(room.providers);
    });
  } catch {
    return [];
  }
}

function parseSessionFinalDisposition(value: unknown): SessionFinalDisposition | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const disposition = parsed as Partial<SessionFinalDisposition>;
    if (typeof disposition.outcome !== 'string' || typeof disposition.summary !== 'string') return null;
    if (!Array.isArray(disposition.blockerDependencies) || typeof disposition.externalStateRequired !== 'boolean') return null;
    if (typeof disposition.source !== 'string' || typeof disposition.recordedAt !== 'string') return null;
    return disposition as SessionFinalDisposition;
  } catch {
    return null;
  }
}

export function defaultsForWorkspaceDirectory(workspacePath: string): WorkspaceOnboardingDefaults {
  const resolvedWorkspacePath = resolve(workspacePath);
  return {
    workspacePath: resolvedWorkspacePath,
    workspaceDirectories: [resolvedWorkspacePath],
    workspaceName: titleFromDirectoryName(basename(resolvedWorkspacePath)),
    scopeOwner: '',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    expiresAt: null,
    assets: []
  };
}

function rows(value: unknown[]): SqlRow[] {
  return value as SqlRow[];
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeWorkspaceDirectories(primaryPath: string, directories: readonly string[] | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const directory of [...(directories ?? []), primaryPath]) {
    if (!directory.trim()) continue;
    const resolvedDirectory = resolve(directory);
    const key = process.platform === 'win32' ? resolvedDirectory.toLowerCase() : resolvedDirectory;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(resolvedDirectory);
  }
  return normalized;
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

function normalizeShellOptions(value: unknown): ShellOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Shell Options must be an object.');
  }
  const input = value as Record<string, unknown>;
  const defaultConcurrency = normalizeShellConcurrency(input.defaultConcurrency, 'default concurrency');
  if (!input.utilities || typeof input.utilities !== 'object' || Array.isArray(input.utilities)) {
    throw new Error('Shell Options utilities must be an object.');
  }
  const utilities: Record<string, number> = {};
  for (const [rawUtility, rawConcurrency] of Object.entries(input.utilities as Record<string, unknown>)) {
    const utility = rawUtility.trim();
    if (!SHELL_UTILITY_PATTERN.test(utility)) {
      throw new Error(`Invalid shell utility name: ${rawUtility}`);
    }
    utilities[utility] = normalizeShellConcurrency(rawConcurrency, utility);
  }
  return { defaultConcurrency, utilities };
}

function normalizeDefaultProviderId(value: unknown): ResearchModelProviderId | null {
  return isResearchModelProviderId(value) ? value : null;
}

function isResearchModelProviderId(value: unknown): value is ResearchModelProviderId {
  return value === 'openai-codex' || value === 'anthropic' || value === 'xai' || value === 'zai';
}

function providerCyberPolicyAcknowledgementMetaKey(providerId: ResearchModelProviderId): string {
  if (providerId === 'openai-codex') return 'openai_trusted_access_cyber_risk_acknowledged';
  if (providerId === 'anthropic') return 'anthropic_cvp_risk_acknowledged';
  if (providerId === 'xai') return 'xai_policy_use_risk_acknowledged';
  return 'zai_policy_use_risk_acknowledged';
}

function normalizeProviderModelDefaultsRecord(value: unknown): Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const normalized: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> = {};
    for (const providerId of ['openai-codex', 'anthropic', 'xai', 'zai'] as const) {
      const defaults = (parsed as Record<string, unknown>)[providerId];
      if (defaults === undefined) continue;
      try {
        normalized[providerId] = normalizeProviderModelDefaults(defaults);
      } catch {
        continue;
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function normalizeEnabledOptionalModelsRecord(
  value: unknown
): Partial<Record<ResearchModelProviderId, string[]>> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const normalized: Partial<Record<ResearchModelProviderId, string[]>> = {};
    for (const providerId of ['openai-codex', 'anthropic', 'xai', 'zai'] as const) {
      const modelIds = (parsed as Record<string, unknown>)[providerId];
      if (!Array.isArray(modelIds)) continue;
      const enabled = [...new Set(modelIds.filter((modelId): modelId is string => (
        typeof modelId === 'string' && isOptionalProviderModel(providerId, modelId)
      )))];
      if (enabled.length > 0) normalized[providerId] = enabled;
    }
    return normalized;
  } catch {
    return {};
  }
}

function normalizePreferredAuthenticationMethodsRecord(
  value: unknown
): Partial<Record<ResearchModelProviderId, ProviderAuthenticationMethod>> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const normalized: Partial<Record<ResearchModelProviderId, ProviderAuthenticationMethod>> = {};
    for (const providerId of ['openai-codex', 'anthropic', 'xai', 'zai'] as const) {
      const method = (parsed as Record<string, unknown>)[providerId];
      if (method === 'subscription' || method === 'api_key') normalized[providerId] = method;
    }
    return normalized;
  } catch {
    return {};
  }
}

function normalizeProviderModelDefaults(value: unknown): ProviderModelDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provider model defaults must be an object.');
  const input = value as Record<string, unknown>;
  const largeModel = normalizeProviderModelId(input.largeModel, 'large');
  const smallModel = normalizeProviderModelId(input.smallModel, 'small');
  const reasoningEffort = input.reasoningEffort;
  if (!isResearchModelEffortLevel(reasoningEffort)) throw new Error('Invalid provider default reasoning level.');
  return { largeModel, smallModel, reasoningEffort };
}

function normalizeProviderModelId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
    throw new Error(`Provider default ${label} model must be a non-empty model identifier.`);
  }
  return value.trim();
}

function isResearchModelEffortLevel(value: unknown): value is ProviderModelDefaults['reasoningEffort'] {
  return value === 'off' || value === 'minimal' || value === 'low' || value === 'medium'
    || value === 'high' || value === 'xhigh' || value === 'max';
}

function normalizeShellConcurrency(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_SHELL_UTILITY_CONCURRENCY) {
    throw new Error(`Shell utility ${label} concurrency must be an integer from 0 through ${MAX_SHELL_UTILITY_CONCURRENCY}.`);
  }
  return value;
}

function copyShellOptions(options: ShellOptions): ShellOptions {
  return {
    defaultConcurrency: options.defaultConcurrency,
    utilities: { ...options.utilities }
  };
}

function defaultMemorySettings(): MemorySettings {
  return { typeDescriptions: { ...DEFAULT_MEMORY_TYPE_DESCRIPTIONS } };
}

function normalizeMemoryTypeDescriptions(value: unknown): MemoryTypeDescriptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Memory type descriptions must be an object.');
  }
  const input = value as Record<string, unknown>;
  const descriptions = {} as MemoryTypeDescriptions;
  for (const type of MEMORY_NODE_TYPES) {
    const rawDescription = input[type];
    if (typeof rawDescription !== 'string') {
      throw new Error(`Memory type ${type} description must be a string.`);
    }
    const description = rawDescription.trim();
    if (!description) {
      throw new Error(`Memory type ${type} description cannot be empty.`);
    }
    if (description.length > MAX_MEMORY_TYPE_DESCRIPTION_CHARACTERS) {
      throw new Error(`Memory type ${type} description cannot exceed ${MAX_MEMORY_TYPE_DESCRIPTION_CHARACTERS} characters.`);
    }
    descriptions[type] = description;
  }
  const serialized = JSON.stringify(descriptions);
  if (serialized.length > MAX_MEMORY_TYPE_DESCRIPTIONS_JSON_CHARACTERS) {
    throw new Error(
      `Memory type descriptions cannot exceed ${MAX_MEMORY_TYPE_DESCRIPTIONS_JSON_CHARACTERS} serialized JSON characters.`
    );
  }
  return descriptions;
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
