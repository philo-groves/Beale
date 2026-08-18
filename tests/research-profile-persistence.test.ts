import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase, type StartRunRecordInput } from '../src/main/database';
import { WorkspaceService, type WorkspaceServiceOptions } from '../src/main/workspaceService';
import {
  decodeResearchProfile,
  migrateResearchProfile,
  serializeResearchProfile,
  type ResearchProfile,
  type ResolvedResearchProfile
} from '../src/shared/researchProfile';
import { resolvedTestResearchProfile } from './researchProfileFixture';

const directories: string[] = [];

afterEach(() => {
  delete process.env.BEALE_GIT_COMMAND;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('research profile persistence', () => {
  it('rejects collaboration recipes that target an unknown workflow', () => {
    const profile = structuredClone(researchProfile('1.0.0', 'Security'));
    profile.collaboration.recipes = [{
      id: 'invalid-recipe', name: 'Invalid recipe', workflowIds: ['typoed-workflow'], roomKind: 'validation',
      roles: [
        { id: 'reviewer', name: 'Reviewer', description: 'Review the claim.' },
        { id: 'challenger', name: 'Challenger', description: 'Challenge the claim.' }
      ],
      synthesisInstructions: ['Preserve dissent.']
    }];
    expect(() => decodeResearchProfile(profile)).toThrow(/references unknown workflow typoed-workflow/);
  });

  it('migrates unversioned local profile drafts into the current schema', () => {
    const profile = researchProfile('1.0.0', 'Local Draft') as unknown as Record<string, unknown>;
    delete profile.schemaVersion;
    delete profile.modelJobs;
    delete profile.collaboration;
    const capabilities = profile.capabilities as Record<string, unknown>;
    delete capabilities.selectedSkillIds;
    delete capabilities.disabledSkillIds;
    delete capabilities.allowedMcpServerIds;

    const migrated = migrateResearchProfile(profile);

    expect(profile.schemaVersion).toBeUndefined();
    expect(profile.modelJobs).toBeUndefined();
    expect(capabilities.selectedSkillIds).toBeUndefined();
    expect(migrated).toMatchObject({
      originalSchemaVersion: 0,
      schemaVersion: 1,
      appliedMigrations: ['research-profile:v0-to-v1'],
      profile: {
        schemaVersion: 1,
        name: 'Local Draft',
        modelJobs: {},
        collaboration: { protocolInstructions: [], recipes: [] },
        capabilities: {
          selectedSkillIds: [],
          disabledSkillIds: [],
          allowedMcpServerIds: []
        }
      }
    });
    expect(decodeResearchProfile(profile)).toEqual(migrated.profile);
    expect(serializeResearchProfile(migrated.profile)).toContain('"schemaVersion":1');
  });

  it('rejects future profile schemas until a migration exists', () => {
    expect(() => migrateResearchProfile({ ...researchProfile('1.0.0', 'Future Profile'), schemaVersion: 99 })).toThrow(
      /Unsupported research profile schemaVersion: 99/
    );
  });

  it('stores immutable snapshots and reuses only the same resolution provenance', () => {
    const fixture = createDatabaseFixture();
    const profile = researchProfile('1.0.0', 'Security');
    const first = fixture.database.activateResearchProfileSnapshot(resolveProfile(profile, 'bundled-default'));
    const reused = fixture.database.activateResearchProfileSnapshot(resolveProfile(profile, 'bundled-default'));
    const explicit = fixture.database.activateResearchProfileSnapshot(
      resolveProfile(profile, 'explicit', join(fixture.workspacePath, 'profile.json'))
    );
    const explicitReused = fixture.database.activateResearchProfileSnapshot(
      resolveProfile(profile, 'explicit', join(fixture.workspacePath, 'profile.json'))
    );

    expect(reused.id).toBe(first.id);
    expect(explicit.id).not.toBe(first.id);
    expect(explicitReused.id).toBe(explicit.id);
    expect(reused).toMatchObject({
      profileId: 'security-research',
      profileVersion: '1.0.0',
      profileHash: first.profileHash,
      source: 'bundled-default',
      sourcePath: null,
      active: true
    });
    expect(fixture.database.getResearchProfileSnapshot(first.id)?.active).toBe(false);
    expect(explicitReused).toMatchObject({
      source: 'explicit',
      sourcePath: join(fixture.workspacePath, 'profile.json'),
      active: true
    });
    expect(reused.profile.memory.types.find((type) => type.id === 'legacy-finding')).toMatchObject({
      lifecycle: 'retired',
      creatable: false,
      replacedBy: 'finding'
    });
    expect(reused.profile.capabilities).toMatchObject({
      disabledSkillIds: [],
      allowedMcpServerIds: [],
      memoryEnabled: true,
      runbooksEnabled: true,
      collaborationEnabled: true
    });

    first.profile.name = 'Mutated caller copy';
    expect(fixture.database.getResearchProfileSnapshot(first.id)?.profile.name).toBe('Security');

    const raw = new DatabaseSync(fixture.databasePath);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM research_profile_snapshots').get()).toEqual({ count: 2 });
    expect(() => raw.prepare("UPDATE research_profile_snapshots SET profile_json = '{}' WHERE id = ?").run(first.id)).toThrow(
      /research profile snapshots are immutable/
    );
    raw.close();
    fixture.database.close();
  });

  it('switches the single active snapshot without changing historical snapshot content', () => {
    const fixture = createDatabaseFixture();
    const first = fixture.database.activateResearchProfileSnapshot(
      resolveProfile(researchProfile('1.0.0', 'Security'), 'bundled-default')
    );
    const second = fixture.database.activateResearchProfileSnapshot(
      resolveProfile(researchProfile('2.0.0', 'General Research'), 'workspace-default', join(fixture.workspacePath, '.honeycrisp', 'profile.json'))
    );

    expect(second.id).not.toBe(first.id);
    expect(fixture.database.getActiveResearchProfileSnapshot()?.id).toBe(second.id);
    expect(fixture.database.getResearchProfileSnapshot(first.id)).toMatchObject({ active: false, profileVersion: '1.0.0' });
    expect(fixture.database.getResearchProfileSnapshot(second.id)).toMatchObject({ active: true, profileVersion: '2.0.0' });

    const reactivated = fixture.database.activateResearchProfileSnapshot(
      resolveProfile(researchProfile('1.0.0', 'Security'), 'bundled-default')
    );
    expect(reactivated.id).toBe(first.id);
    expect(fixture.database.getResearchProfileSnapshot(second.id)?.active).toBe(false);

    const raw = new DatabaseSync(fixture.databasePath);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM research_profile_snapshots WHERE active = 1').get()).toEqual({ count: 1 });
    raw.close();
    fixture.database.close();
  });

  it('migrates existing runs with null provenance and maps new run snapshot provenance', () => {
    const fixture = createDatabaseFixture();
    const legacyRun = fixture.database.createRun(runInput(fixture.database));
    fixture.database.close();

    const legacy = new DatabaseSync(fixture.databasePath);
    legacy.exec('ALTER TABLE runs DROP COLUMN research_profile_snapshot_id;');
    legacy.exec('DROP TABLE research_profile_snapshots;');
    legacy.prepare("DELETE FROM schema_migrations WHERE component = 'beale_workbench' AND version >= 13").run();
    legacy.close();

    const migrated = new WorkspaceDatabase(fixture.databasePath, fixture.artifactRoot, { workspacePath: fixture.workspacePath });
    migrated.initialize();
    expect(migrated.getRun(legacyRun.run.id)?.researchProfileSnapshotId).toBeNull();
    expect(migrated.getRunResearchProfileSnapshot(legacyRun.run.id)).toBeNull();

    const profileSnapshot = migrated.activateResearchProfileSnapshot(
      resolveProfile(researchProfile('1.0.0', 'Security'), 'bundled-default')
    );
    const profiledRun = migrated.createRun(runInput(migrated, profileSnapshot.id));
    expect(profiledRun.run.researchProfileSnapshotId).toBe(profileSnapshot.id);
    expect(migrated.getRun(profiledRun.run.id)?.researchProfileSnapshotId).toBe(profileSnapshot.id);
    expect(migrated.getRunResearchProfileSnapshot(profiledRun.run.id)).toMatchObject({
      id: profileSnapshot.id,
      profileHash: profileSnapshot.profileHash
    });
    expect(migrated.getRunDetail(profiledRun.run.id).researchProfile).toMatchObject({
      id: profileSnapshot.id,
      profileHash: profileSnapshot.profileHash
    });

    const raw = new DatabaseSync(fixture.databasePath);
    expect(
      raw.prepare("SELECT version, name FROM schema_migrations WHERE component = 'beale_workbench' AND version = 13").get()
    ).toEqual({ version: 13, name: 'versioned_research_profile_snapshots' });
    expect(
      raw.prepare("SELECT version, name FROM schema_migrations WHERE component = 'beale_workbench' AND version = 14").get()
    ).toEqual({ version: 14, name: 'durable_research_subject_binding' });
    raw.close();
    migrated.close();
  });

  it('scopes hash reuse and run provenance to the owning workspace', () => {
    const root = tempDirectory();
    const databasePath = join(root, 'global', 'memory.sqlite');
    const firstWorkspace = join(root, 'first');
    const secondWorkspace = join(root, 'second');
    mkdirSync(firstWorkspace, { recursive: true });
    mkdirSync(secondWorkspace, { recursive: true });
    const first = new WorkspaceDatabase(databasePath, join(firstWorkspace, '.beale', 'artifacts'), { workspacePath: firstWorkspace });
    const second = new WorkspaceDatabase(databasePath, join(secondWorkspace, '.beale', 'artifacts'), { workspacePath: secondWorkspace });
    first.initialize();
    second.initialize();
    expect(first.setResearchSubject({ name: 'Shared Subject' }).id).toBe(
      second.setResearchSubject({ name: 'Shared Subject' }).id
    );
    const resolved = resolveProfile(researchProfile('1.0.0', 'Security'), 'bundled-default');
    const firstSnapshot = first.activateResearchProfileSnapshot(resolved);
    const secondSnapshot = second.activateResearchProfileSnapshot(resolved);

    expect(secondSnapshot.id).not.toBe(firstSnapshot.id);
    expect(second.getResearchProfileSnapshot(firstSnapshot.id)).toBeNull();
    expect(() => second.createRun(runInput(second, firstSnapshot.id))).toThrow(/snapshot not found for workspace/);

    second.close();
    first.close();
  });

  it('keeps the research subject identity stable when authorization ownership changes', () => {
    const fixture = createDatabaseFixture();
    const adopted = fixture.database.getResearchSubject();
    expect(adopted).toMatchObject({
      id: `subject_workspace:${fixture.database.getWorkspaceId()}`,
      name: 'Untitled Workspace',
      source: 'legacy_adopted'
    });

    const explicit = fixture.database.setResearchSubject({ name: 'Parser Runtime' });
    expect(explicit).toMatchObject({
      id: `subject_${createHash('sha256').update('parser runtime').digest('hex').slice(0, 20)}`,
      name: 'Parser Runtime',
      source: 'explicit'
    });
    expect(fixture.database.setResearchSubject({ name: 'Parser Runtime Engine' })).toMatchObject({
      id: explicit.id,
      name: 'Parser Runtime Engine'
    });
    fixture.database.saveScope({
      workspaceName: 'Parser Research',
      scopeOwner: 'New Authorization Owner',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      expiresAt: null,
      assets: []
    });
    expect(fixture.database.getResearchSubject()).toMatchObject({ id: explicit.id, name: 'Parser Runtime Engine' });

    fixture.database.close();
    const reopened = new WorkspaceDatabase(fixture.databasePath, fixture.artifactRoot, { workspacePath: fixture.workspacePath });
    reopened.initialize();
    expect(reopened.getResearchSubject()).toMatchObject({ id: explicit.id, name: 'Parser Runtime Engine', source: 'explicit' });
    reopened.close();
  });

  it('keeps the workspace-placeholder subject id when durable memory already uses it', () => {
    const fixture = createDatabaseFixture();
    const placeholder = fixture.database.getResearchSubject();
    seedPlaceholderMemory(fixture.databasePath, fixture.database.getWorkspaceId(), placeholder.id);

    expect(fixture.database.setResearchSubject({ name: 'Parser Runtime' })).toMatchObject({
      id: placeholder.id,
      name: 'Parser Runtime',
      source: 'explicit'
    });

    const raw = new DatabaseSync(fixture.databasePath, { readOnly: true });
    expect(raw.prepare('SELECT subject_id FROM memory_nodes WHERE id = ?').get('claude_first_memory')).toEqual({
      subject_id: placeholder.id
    });
    raw.close();
    fixture.database.close();
  });

  it('keeps Claude-first placeholder memory visible after scoped Beale onboarding', () => {
    const root = tempDirectory();
    const workspacePath = join(root, 'workspace');
    const databasePath = join(root, 'global', 'memory.sqlite');
    mkdirSync(workspacePath, { recursive: true });
    const options: WorkspaceServiceOptions = {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: databasePath,
      honeycrispArtifactDirectory: join(root, 'global', 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile()
    };
    const { workspaceId, placeholderId } = seedClaudeFirstWorkspace(databasePath, workspacePath);

    const service = new WorkspaceService(() => undefined, options);
    const onboarded = service.createScopedWorkspace({
      workspacePath,
      workspaceName: 'Parser Research',
      researchSubjectName: 'Parser Runtime',
      scopeOwner: 'Authorization Owner',
      descriptionMarkdown: 'Authorized local parser research.',
      rulesMarkdown: 'Stay within the recorded workspace.',
      expiresAt: null,
      assets: []
    });

    expect(onboarded.researchSubject).toMatchObject({
      id: placeholderId,
      name: 'Parser Runtime',
      source: 'explicit'
    });
    expect(onboarded.honeycrispMemory.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claude_first_memory',
          subjectId: placeholderId,
          workspaces: expect.arrayContaining([expect.objectContaining({ id: workspaceId })])
        })
      ])
    );
    service.close();
  });

  it('persists ordered workspace directories while preserving a primary single-directory root', () => {
    const root = tempDirectory();
    const primary = join(root, 'primary');
    const secondary = join(root, 'secondary');
    mkdirSync(primary, { recursive: true });
    mkdirSync(secondary, { recursive: true });
    const options: WorkspaceServiceOptions = {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'global', 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'global', 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile()
    };
    const service = new WorkspaceService(() => undefined, options);
    const created = service.createScopedWorkspace({
      workspacePath: primary,
      workspaceDirectories: [primary, secondary],
      workspaceName: 'Multi Root',
      researchSubjectName: 'Multi Root',
      scopeOwner: 'Multi Root',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      expiresAt: null,
      assets: []
    });
    expect(created.workspace.workspacePath).toBe(resolve(primary));
    expect(created.workspace.workspaceDirectories).toEqual([resolve(primary), resolve(secondary)]);
    const registryWorkspaceId = service.getWorkspaceRegistryState().workspaces[0]?.id;
    expect(registryWorkspaceId).toBeTruthy();
    service.close();

    const reopened = new WorkspaceService(() => undefined, options);
    const snapshot = reopened.openRegisteredWorkspace(registryWorkspaceId as string);
    expect(snapshot.workspace.workspaceDirectories).toEqual([resolve(primary), resolve(secondary)]);
    expect(reopened.updateWorkspaceDirectories([secondary, primary]).workspace.workspaceDirectories).toEqual([
      resolve(secondary),
      resolve(primary)
    ]);
    reopened.close();

    const promotedReopened = new WorkspaceService(() => undefined, options);
    expect(promotedReopened.openRegisteredWorkspace(registryWorkspaceId as string).workspace.workspaceDirectories).toEqual([
      resolve(secondary),
      resolve(primary)
    ]);
    expect(promotedReopened.updateWorkspaceDirectories([primary]).workspace.workspaceDirectories).toEqual([resolve(primary)]);
    expect(() => promotedReopened.updateWorkspaceDirectories([])).toThrow('At least one workspace directory is required.');
    promotedReopened.close();
  }, 10_000);

  it('clones an in-scope repository resource and records its managed checkout once', async () => {
    const root = tempDirectory();
    const workspacePath = join(root, 'workspace');
    const repositoryStoreDirectory = join(root, 'repositories');
    mkdirSync(workspacePath, { recursive: true });
    const fakeGit = join(root, 'fake-git-clone-resource.mjs');
    writeFileSync(fakeGit, [
      '#!/usr/bin/env node',
      "import { mkdirSync } from 'node:fs';",
      'const args = process.argv.slice(2);',
      "if (args.includes('clone')) { mkdirSync(`${args.at(-1)}/.git`, { recursive: true }); process.exit(0); }",
      "if (args.includes('rev-parse')) { process.stdout.write('0123456789abcdef0123456789abcdef01234567\\n'); process.exit(0); }",
      "if (args.includes('describe')) { process.stdout.write('test-head\\n'); process.exit(0); }",
      'process.exit(0);'
    ].join('\n'));
    chmodSync(fakeGit, 0o700);
    process.env.BEALE_GIT_COMMAND = fakeGit;
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'global', 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'global', 'artifacts'),
      repositoryStoreDirectory,
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    try {
      const created = service.createScopedWorkspace({
        workspacePath,
        workspaceName: 'Repository Resources',
        researchSubjectName: 'Repository Resources',
        scopeOwner: 'Repository Resources',
        descriptionMarkdown: '',
        rulesMarkdown: '',
        expiresAt: null,
        assets: [{
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://gitlab.com/gitlab-org/gitlab',
          sensitivity: 'public',
          attributes: { repositoryUrl: 'https://gitlab.com/gitlab-org/gitlab' }
        }, {
          direction: 'out_of_scope',
          kind: 'repo',
          value: 'https://gitlab.com/gitlab-org/gitaly',
          sensitivity: 'public',
          attributes: { repositoryUrl: 'https://gitlab.com/gitlab-org/gitaly' }
        }]
      });
      const sourceAssetId = created.activeScope.assets.find((asset) => asset.direction === 'in_scope')?.id;
      const excludedAssetId = created.activeScope.assets.find((asset) => asset.direction === 'out_of_scope')?.id;
      expect(sourceAssetId).toBeTruthy();
      expect(() => service.cloneWorkspaceRepository(excludedAssetId as string)).toThrow('Only in-scope repository resources can be cloned.');

      const cloned = await service.cloneWorkspaceRepository(sourceAssetId as string);
      const checkoutAssets = cloned.activeScope.assets.filter((asset) => asset.attributes?.source === 'beale_workspace_resource');
      expect(checkoutAssets).toHaveLength(1);
      expect(checkoutAssets[0]?.attributes).toMatchObject({
        repositoryUrl: 'https://gitlab.com/gitlab-org/gitlab',
        sourceAssetId
      });
      expect(existsSync(join(checkoutAssets[0]?.value ?? '', '.git'))).toBe(true);

      const currentSourceAssetId = cloned.activeScope.assets.find((asset) => asset.value === 'https://gitlab.com/gitlab-org/gitlab')?.id;
      const clonedAgain = await service.cloneWorkspaceRepository(currentSourceAssetId as string);
      expect(clonedAgain.activeScope.assets.filter((asset) => asset.attributes?.source === 'beale_workspace_resource')).toHaveLength(1);
    } finally {
      service.close();
    }
  });

  it('adopts the legacy scope-owner subject id during migration 14', () => {
    const fixture = createDatabaseFixture();
    fixture.database.saveScope({
      workspaceName: 'Legacy Research',
      scopeOwner: 'Acme Corporation',
      descriptionMarkdown: '',
      rulesMarkdown: '',
      expiresAt: null,
      assets: []
    });
    fixture.database.close();

    const legacy = new DatabaseSync(fixture.databasePath);
    legacy.exec('DROP TABLE workspace_research_subjects;');
    legacy.prepare("DELETE FROM schema_migrations WHERE component = 'beale_workbench' AND version >= 14").run();
    legacy.close();

    const migrated = new WorkspaceDatabase(fixture.databasePath, fixture.artifactRoot, { workspacePath: fixture.workspacePath });
    migrated.initialize();
    const expectedId = `subject_${createHash('sha256').update('acme corporation').digest('hex').slice(0, 20)}`;
    expect(migrated.getResearchSubject()).toMatchObject({
      id: expectedId,
      name: 'Acme Corporation',
      source: 'legacy_adopted'
    });
    migrated.close();
  });
});

function createDatabaseFixture(): {
  database: WorkspaceDatabase;
  databasePath: string;
  artifactRoot: string;
  workspacePath: string;
} {
  const root = tempDirectory();
  const workspacePath = join(root, 'workspace');
  const databasePath = join(root, 'global', 'memory.sqlite');
  const artifactRoot = join(workspacePath, '.beale', 'artifacts');
  mkdirSync(workspacePath, { recursive: true });
  const database = new WorkspaceDatabase(databasePath, artifactRoot, { workspacePath });
  database.initialize();
  return { database, databasePath, artifactRoot, workspacePath };
}

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'beale-research-profile-'));
  directories.push(directory);
  return directory;
}

function seedPlaceholderMemory(databasePath: string, workspaceId: string, subjectId: string): void {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_nodes (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      title_norm TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      attributes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_node_sessions (
      node_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      PRIMARY KEY(node_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS memory_node_workspaces (
      node_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      workspace_name TEXT NOT NULL,
      PRIMARY KEY(node_id, workspace_id)
    );
    CREATE TABLE IF NOT EXISTS memory_node_assets (
      node_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      PRIMARY KEY(node_id, asset_id)
    );
    CREATE TABLE IF NOT EXISTS memory_node_tags (
      node_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY(node_id, tag)
    );
    CREATE TABLE IF NOT EXISTS memory_edges (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(from_id, to_id, relation)
    );
    CREATE TABLE IF NOT EXISTS memory_evidence_refs (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      path_base TEXT,
      path TEXT,
      locator_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const createdAt = '2026-08-11T12:00:00.000Z';
  database
    .prepare(
      `INSERT INTO memory_nodes (
         id, subject_id, subject_name, type, title, title_norm, summary, body,
         status, confidence, attributes_json, created_at, updated_at, revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'claude_first_memory',
      subjectId,
      'Claude-first workspace',
      'finding',
      'Parser boundary observation',
      'parser boundary observation',
      'A durable observation saved before Beale onboarding.',
      '',
      'draft',
      0.5,
      '{}',
      createdAt,
      createdAt,
      1
    );
  database
    .prepare('INSERT INTO memory_node_workspaces (node_id, workspace_id, workspace_name) VALUES (?, ?, ?)')
    .run('claude_first_memory', workspaceId, 'Claude-first workspace');
  database.close();
}

function seedClaudeFirstWorkspace(
  databasePath: string,
  workspacePath: string
): { workspaceId: string; placeholderId: string } {
  mkdirSync(dirname(databasePath), { recursive: true });
  const resolvedWorkspacePath = resolve(workspacePath);
  const workspaceId = `workspace_${createHash('sha256').update(resolvedWorkspacePath).digest('hex').slice(0, 20)}`;
  const placeholderId = `subject_workspace:${workspaceId}`;
  seedPlaceholderMemory(databasePath, workspaceId, placeholderId);
  return { workspaceId, placeholderId };
}

function resolveProfile(
  profile: ResearchProfile,
  source: ResolvedResearchProfile['source'],
  path?: string
): ResolvedResearchProfile {
  const hash = createHash('sha256')
    .update('honeycrisp:research-profile:v1\0')
    .update(serializeResearchProfile(profile))
    .digest('hex');
  return { profile, hash, source, ...(path ? { path } : {}) };
}

function researchProfile(version: string, name: string): ResearchProfile {
  return {
    schemaVersion: 1,
    id: 'security-research',
    version,
    name,
    description: 'A test research profile.',
    agent: {
      role: 'Research the subject.',
      posture: ['Be precise.'],
      style: ['Be concise.'],
      memoryInstructions: ['Save durable findings.'],
      runbookInstructions: ['Keep procedures reproducible.']
    },
    memory: {
      types: [
        {
          id: 'finding',
          name: 'Finding',
          pluralName: 'Findings',
          description: 'A durable research finding.',
          lifecycle: 'active',
          creatable: true,
          order: 10,
          defaultStatus: 'draft',
          allowedStatuses: ['draft', 'confirmed']
        },
        {
          id: 'legacy-finding',
          name: 'Legacy Finding',
          pluralName: 'Legacy Findings',
          description: 'A retired research finding.',
          lifecycle: 'retired',
          creatable: false,
          replacedBy: 'finding',
          order: 20,
          defaultStatus: 'draft',
          allowedStatuses: ['draft', 'confirmed']
        }
      ],
      statuses: [
        { id: 'draft', name: 'Draft', description: 'Not yet established.', order: 10, polarity: 'neutral' },
        { id: 'confirmed', name: 'Confirmed', description: 'Established by evidence.', order: 20, terminal: true, polarity: 'positive' }
      ],
      evidenceKinds: [{ id: 'artifact', name: 'Artifact', description: 'A durable artifact.', allowsPath: true }],
      evidencePathBases: [{ id: 'workspace', name: 'Workspace', description: 'Relative to the workspace.' }],
      relations: [{ id: 'supports', name: 'Supports', description: 'Supports another finding.' }],
      defaultNodeLimit: 12,
      defaultCharacterBudget: 24_000
    },
    workflows: [
      {
        id: 'discovery',
        name: 'Discovery',
        description: 'Explore a bounded subject.',
        goalSuggestionCount: 4,
        goalSuggestionInstructions: ['Suggest useful goals.'],
        promptInstructions: ['Keep the prompt open-ended.'],
        outputRequirements: ['Support conclusions with evidence.'],
        default: true
      }
    ],
    collaboration: { protocolInstructions: [], recipes: [] },
    capabilities: {
      defaultToolFamilies: ['workspace'],
      disabledToolFamilies: [],
      allowedSideEffects: ['read'],
      selectedSkillIds: [],
      disabledSkillIds: [],
      allowedMcpServerIds: [],
      memoryEnabled: true,
      runbooksEnabled: true,
      collaborationEnabled: true
    },
    workspace: {
      workspaceNoun: 'workspace',
      subjectNoun: 'subject',
      boundaryNoun: 'boundary',
      authorizationMode: 'optional',
      boundaryInstructions: ['Respect the recorded boundary.'],
      materialKinds: ['repository']
    },
    modelJobs: {},
    presentation: {
      newResearchLabel: 'New research',
      memoryLabel: 'Memory',
      runbookLabel: 'Runbooks',
      sessionLabel: 'Session'
    }
  };
}

function runInput(database: WorkspaceDatabase, researchProfileSnapshotId?: string): StartRunRecordInput {
  return {
    scopeVersionId: database.getActiveScope().id,
    ...(researchProfileSnapshotId ? { researchProfileSnapshotId } : {}),
    title: 'Research profile persistence run',
    promptMarkdown: 'Inspect the subject.',
    shellSafetyMode: 'auto_review',
    mode: 'discovery',
    model: 'test-model',
    reasoningEffort: 'high',
    attemptStrategy: 'single_path',
    sandboxProfile: 'host',
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0 }
  };
}
