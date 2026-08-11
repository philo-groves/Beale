import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { getHoneycrispMemorySummary } from '../src/main/honeycrispMemorySummary';
import { serializeResearchProfile } from '../src/shared/researchProfile';
import type { HoneycrispMemoryNodeSummary, ResearchProfile, ResearchProfileSnapshot } from '../src/shared/types';
import { testResearchProfile } from './researchProfileFixture';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Honeycrisp memory summary', () => {
  it('reports missing knowledge before the workspace database is initialized', () => {
    const workspace = tempWorkspace();
    const databasePath = join(workspace, 'memory.sqlite');
    const summary = getHoneycrispMemorySummary({
      databasePath,
      artifactDirectoryPath: join(workspace, 'artifacts'),
      workspaceId: 'workspace_zsh',
      subjectId: 'subject_apple'
    });

    expect(summary.status).toBe('missing');
    expect(summary.databasePath).toBe(databasePath);
    expect(summary.nodeCount).toBe(0);
    expect(summary.edgeCount).toBe(0);
    expect(summary.dreaming).toMatchObject({ available: false, hiddenNodeCount: 0, restorableChangeCount: 0 });
    expect(summary.directories).toEqual([
      expect.objectContaining({ name: 'artifacts', exists: false })
    ]);
  });

  it('reads durable nodes, relationships, evidence references, and artifacts directly from the shared database', () => {
    const workspace = tempWorkspace();
    const memoryRoot = workspace;
    const artifactRoot = join(workspace, 'artifacts');
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(artifactRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, artifacts: [{ id: 'artifact_one' }] }));

    const db = new DatabaseSync(join(memoryRoot, 'memory.sqlite'));
    db.exec(`
      CREATE TABLE memory_nodes (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_name TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, title_norm TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL, attributes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE memory_node_sessions (node_id TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY(node_id, session_id));
      CREATE TABLE memory_node_workspaces (node_id TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, PRIMARY KEY(node_id, workspace_id));
      CREATE TABLE memory_node_assets (node_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(node_id, asset_id));
      CREATE TABLE memory_node_tags (node_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(node_id, tag));
      CREATE TABLE memory_edges (from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(from_id, to_id, relation));
      CREATE TABLE memory_evidence_refs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL, path_base TEXT, path TEXT, locator_json TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE honeycrisp_runbooks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, subject_id TEXT, subject_name TEXT, session_id TEXT, title TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL, artifact_id TEXT NOT NULL, relative_path TEXT NOT NULL, content_hash TEXT NOT NULL, size_bytes INTEGER NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    const insertNode = db.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertNode.run('hypothesis_one', 'subject_apple', 'Apple', 'hypothesis', 'Parser state confusion', 'parser state confusion', 'State may cross requests.', '', 'suspected', 0.6, '{}', '2026-06-25T10:00:00.000Z', '2026-06-25T10:01:00.000Z', 1);
    insertNode.run('trajectory_one', 'subject_apple', 'Apple', 'trajectory', 'Parser state investigation route', 'parser state investigation route', 'State-reuse analysis route.', 'Details', 'confirmed', 0.95, '{"outcome":"cross-request influence"}', '2026-06-25T10:02:00.000Z', '2026-06-25T10:03:00.000Z', 2);
    insertNode.run('other_session', 'subject_apple', 'Apple', 'hypothesis', 'Other session hypothesis', 'other session hypothesis', 'Linked to another session.', '', 'suspected', 0.4, '{}', '2026-06-25T10:04:00.000Z', '2026-06-25T10:04:00.000Z', 1);
    insertNode.run('other_workspace', 'subject_apple', 'Apple', 'primitive', 'Other workspace primitive', 'other workspace primitive', 'Linked to another workspace.', '', 'confirmed', 0.9, '{}', '2026-06-25T10:05:00.000Z', '2026-06-25T10:05:00.000Z', 1);
    insertNode.run('other_subject', 'subject_google', 'Google', 'trajectory', 'Other subject trajectory', 'other subject trajectory', 'Must remain subject-scoped.', '', 'confirmed', 0.9, '{}', '2026-06-25T10:06:00.000Z', '2026-06-25T10:06:00.000Z', 1);
    db.prepare('INSERT INTO memory_node_sessions VALUES (?, ?)').run('hypothesis_one', 'run_one');
    db.prepare('INSERT INTO memory_node_sessions VALUES (?, ?)').run('other_session', 'run_two');
    const insertWorkspace = db.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)');
    insertWorkspace.run('hypothesis_one', 'workspace_zsh', 'Zsh');
    insertWorkspace.run('trajectory_one', 'workspace_zsh', 'Zsh');
    insertWorkspace.run('other_session', 'workspace_zsh', 'Zsh');
    insertWorkspace.run('other_workspace', 'workspace_mdns', 'mDNSResponder');
    insertWorkspace.run('other_subject', 'workspace_chrome', 'Chrome');
    db.prepare('INSERT INTO memory_node_assets VALUES (?, ?)').run('trajectory_one', 'asset_api');
    db.prepare('INSERT INTO memory_node_tags VALUES (?, ?)').run('trajectory_one', 'parser');
    db.prepare('INSERT INTO memory_edges VALUES (?, ?, ?, ?, ?, ?)').run('hypothesis_one', 'trajectory_one', 'informed', 'Reusable route', '2026-06-25T10:03:00.000Z', '2026-06-25T10:03:00.000Z');
    db.prepare('INSERT INTO memory_edges VALUES (?, ?, ?, ?, ?, ?)').run('trajectory_one', 'other_workspace', 'related', 'Must remain hidden', '2026-06-25T10:05:00.000Z', '2026-06-25T10:05:00.000Z');
    db.prepare('INSERT INTO memory_evidence_refs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('evidence_one', 'trajectory_one', 'code', 'repository', 'src/parser.ts', '{"line":42}', 'State write', '2026-06-25T10:02:30.000Z');
    db.prepare('INSERT INTO memory_evidence_refs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('evidence_hidden', 'other_workspace', 'code', 'repository', 'src/other.ts', '{}', 'Must remain hidden', '2026-06-25T10:05:30.000Z');
    db.prepare('INSERT INTO honeycrisp_runbooks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('runbook_one', 'workspace_zsh', 'Zsh', 'subject_apple', 'Apple', 'run_one', 'Parser reproduction', 'Repeat the parser-state proof.', 'active', 'runbook_one', 'runbooks/workspace_zsh/runbook_one.ipynb', 'sha256:abc', 420, 2, '2026-06-25T10:04:00.000Z', '2026-06-25T10:05:00.000Z');
    db.prepare('INSERT INTO honeycrisp_runbooks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('runbook_other', 'workspace_mdns', 'mDNSResponder', 'subject_apple', 'Apple', 'run_two', 'Other workspace', 'Must remain scoped.', 'active', 'runbook_other', 'runbooks/workspace_mdns/runbook_other.ipynb', 'sha256:def', 420, 1, '2026-06-25T10:04:00.000Z', '2026-06-25T10:06:00.000Z');
    db.close();

    const summary = getHoneycrispMemorySummary({
      databasePath: join(memoryRoot, 'memory.sqlite'),
      artifactDirectoryPath: artifactRoot,
      sessionId: 'run_one',
      workspaceId: 'workspace_zsh',
      subjectId: 'subject_apple'
    });

    expect(summary).toMatchObject({
      status: 'ready',
      source: 'honeycrisp_sqlite',
      nodeCount: 4,
      edgeCount: 2,
      evidenceRefCount: 2,
      storageArtifactCount: 1,
      runbookCount: 1,
      latestNodeUpdatedAt: '2026-06-25T10:05:00.000Z',
      nodeTypeCounts: { hypothesis: 2, primitive: 1, trajectory: 1 },
      nodeStatusCounts: { confirmed: 2, suspected: 2 },
      dreaming: { available: false, scope: 'workspace', hiddenNodeCount: 0, restorableChangeCount: 0 }
    });
    expect(summary.nodes.find((node) => node.id === 'trajectory_one')).toMatchObject({
      id: 'trajectory_one',
      sessionIds: [],
      workspaces: [{ id: 'workspace_zsh', name: 'Zsh' }],
      subjectName: 'Apple',
      type: 'trajectory',
      assetIds: ['asset_api'],
      tags: ['parser'],
      revision: 2,
      provenance: { state: 'legacy_unrecorded', catalogHash: null, activeCatalog: false },
      evidenceRefs: [expect.objectContaining({ pathBase: 'repository', path: 'src/parser.ts' })]
    });
    expect(summary.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromId: 'hypothesis_one', toId: 'trajectory_one', relation: 'informed' })
    ]));
    expect(summary.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['other_session', 'other_workspace']));
    expect(summary.nodes.map((node) => node.id)).not.toContain('other_subject');
    expect(summary.runbooks).toEqual([
      expect.objectContaining({ id: 'runbook_one', title: 'Parser reproduction', status: 'active', revision: 2 })
    ]);

    const workspaceSummary = getHoneycrispMemorySummary({
      databasePath: join(memoryRoot, 'memory.sqlite'),
      artifactDirectoryPath: artifactRoot,
      workspaceId: 'workspace_zsh',
      subjectId: 'subject_apple'
    });
    expect(workspaceSummary.nodes).toHaveLength(4);
    expect(workspaceSummary.nodeCount).toBe(4);
    expect(workspaceSummary.edgeCount).toBe(2);
    expect(workspaceSummary.evidenceRefCount).toBe(2);
  });

  it('preserves compatible catalog provenance across presentation additions while isolating foreign and legacy rows', () => {
    const workspace = tempWorkspace();
    const databasePath = join(workspace, 'memory.sqlite');
    const activeProfile: ResearchProfile = {
      ...testResearchProfile(),
      id: 'general-research',
      name: 'General Research'
    };
    const historicalProfile: ResearchProfile = {
      ...activeProfile,
      version: '2.0.0',
      memory: {
        ...activeProfile.memory,
        types: [
          ...activeProfile.memory.types.map((type) => ({
            ...type,
            name: 'Recorded Result',
            pluralName: 'Recorded Results',
            description: 'A historically named durable result.',
            order: 90,
            allowedStatuses: [...type.allowedStatuses, 'archived'],
            attributes: {
              ...(type.attributes ?? {}),
              optionalScore: { type: 'number' as const, description: 'An additive unused attribute.' }
            },
            requirements: [
              ...(type.requirements ?? []),
              { statuses: ['archived'], requireEvidence: true }
            ]
          })),
          {
            id: 'source-note',
            name: 'Source Note',
            pluralName: 'Source Notes',
            description: 'An unrelated additive memory type.',
            lifecycle: 'active',
            creatable: true,
            order: 100,
            defaultStatus: 'draft',
            allowedStatuses: ['draft']
          }
        ],
        statuses: [
          ...activeProfile.memory.statuses.map((status) => ({
            ...status,
            name: `Historical ${status.name}`,
            description: `Historical presentation for ${status.id}.`,
            order: status.order + 90
          })),
          {
            id: 'archived',
            name: 'Archived',
            description: 'An unrelated additive status.',
            order: 200,
            terminal: true,
            polarity: 'neutral'
          }
        ],
        evidenceKinds: [
          ...activeProfile.memory.evidenceKinds.map((kind) => ({
            ...kind,
            name: 'Historical Artifact',
            description: 'Historical presentation for artifact evidence.'
          })),
          {
            id: 'citation',
            name: 'Citation',
            description: 'An unrelated additive evidence kind.',
            allowsPath: false
          }
        ],
        evidencePathBases: [
          ...(activeProfile.memory.evidencePathBases ?? []).map((base) => ({
            ...base,
            name: 'Historical Workspace',
            description: 'Historical presentation for workspace paths.'
          })),
          {
            id: 'repository',
            name: 'Repository',
            description: 'An unrelated additive path base.',
            pathFormat: 'relative'
          }
        ],
        relations: [
          ...(activeProfile.memory.relations ?? []).map((relation) => ({
            ...relation,
            name: 'Historically Supports',
            description: 'Historical presentation for the relation.'
          })),
          {
            id: 'references',
            name: 'References',
            description: 'An unrelated additive relation.'
          }
        ]
      }
    };
    const incompatibleProfile: ResearchProfile = {
      ...activeProfile,
      version: '3.0.0',
      memory: {
        ...activeProfile.memory,
        statuses: activeProfile.memory.statuses.map((status) => status.id === 'draft'
          ? { ...status, terminal: true, polarity: 'negative' as const }
          : status)
      }
    };
    const activeSnapshot = profileSnapshot(activeProfile, 'workspace_zsh');
    const historicalSnapshot = profileSnapshot(historicalProfile, 'workspace_zsh');
    const incompatibleSnapshot = profileSnapshot(incompatibleProfile, 'workspace_zsh');
    const activeCatalogJson = stableJson(activeProfile.memory);
    const historicalCatalogJson = stableJson(historicalProfile.memory);
    const incompatibleCatalogJson = stableJson(incompatibleProfile.memory);
    const activeCatalogHash = memoryCatalogHash(activeCatalogJson);
    const historicalCatalogHash = memoryCatalogHash(historicalCatalogJson);
    const incompatibleCatalogHash = memoryCatalogHash(incompatibleCatalogJson);
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE memory_nodes (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_name TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, title_norm TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL, attributes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL, catalog_hash TEXT);
      CREATE TABLE memory_node_sessions (node_id TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY(node_id, session_id));
      CREATE TABLE memory_node_workspaces (node_id TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, PRIMARY KEY(node_id, workspace_id));
      CREATE TABLE memory_node_assets (node_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(node_id, asset_id));
      CREATE TABLE memory_node_tags (node_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(node_id, tag));
      CREATE TABLE memory_edges (from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(from_id, to_id, relation));
      CREATE TABLE memory_evidence_refs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL, path_base TEXT, path TEXT, locator_json TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE memory_catalog_snapshots (catalog_hash TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, catalog_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE memory_node_catalog_validations (node_id TEXT NOT NULL, node_revision INTEGER NOT NULL, catalog_hash TEXT NOT NULL, node_content_hash TEXT NOT NULL, validation_kind TEXT NOT NULL, research_profile_hash TEXT, research_profile_id TEXT, research_profile_version TEXT, validated_at TEXT NOT NULL, PRIMARY KEY(node_id, node_revision, catalog_hash));
    `);
    db.prepare('INSERT INTO memory_catalog_snapshots VALUES (?, 1, ?, ?)')
      .run(activeCatalogHash, activeCatalogJson, '2026-08-10T10:00:00.000Z');
    db.prepare('INSERT INTO memory_catalog_snapshots VALUES (?, 1, ?, ?)')
      .run(historicalCatalogHash, historicalCatalogJson, '2026-08-10T10:00:00.000Z');
    db.prepare('INSERT INTO memory_catalog_snapshots VALUES (?, 1, ?, ?)')
      .run(incompatibleCatalogHash, incompatibleCatalogJson, '2026-08-10T10:00:00.000Z');
    const activeValidated = insertCatalogNode(db, 'active_validated', activeCatalogHash, '2026-08-10T10:04:00.000Z');
    insertCatalogNode(db, 'active_unvalidated', activeCatalogHash, '2026-08-10T10:03:00.000Z');
    insertCatalogNode(db, 'legacy_node', null, '2026-08-10T10:02:00.000Z');
    const historicalValidated = insertCatalogNode(db, 'historical_validated', historicalCatalogHash, '2026-08-10T10:01:00.000Z');
    const incompatibleValidated = insertCatalogNode(db, 'incompatible_validated', incompatibleCatalogHash, '2026-08-10T10:00:00.000Z');
    insertCatalogValidation(db, activeValidated, activeCatalogHash, activeSnapshot);
    insertCatalogValidation(db, historicalValidated, historicalCatalogHash, historicalSnapshot);
    insertCatalogValidation(db, incompatibleValidated, incompatibleCatalogHash, incompatibleSnapshot);
    db.close();

    const active = getHoneycrispMemorySummary({
      databasePath,
      artifactDirectoryPath: join(workspace, 'artifacts'),
      workspaceId: 'workspace_zsh',
      subjectId: 'subject_apple',
      researchProfile: activeSnapshot
    });

    expect(active.activeCatalogHash).toBe(activeCatalogHash);
    expect(active.nodes.map((node) => node.id)).toEqual([
      'active_validated',
      'active_unvalidated',
      'historical_validated'
    ]);
    expect(active.nodes.find((node) => node.id === 'active_validated')?.provenance).toMatchObject({
      state: 'active_validated',
      catalogHash: activeCatalogHash,
      activeCatalog: true,
      validation: {
        kind: 'full',
        researchProfile: {
          hash: activeSnapshot.profileHash,
          id: activeSnapshot.profileId,
          version: activeSnapshot.profileVersion
        }
      }
    });
    expect(active.nodes.find((node) => node.id === 'active_unvalidated')?.provenance).toEqual({
      state: 'catalog_unvalidated',
      catalogHash: activeCatalogHash,
      activeCatalog: true,
      validation: null
    });
    expect(active.nodes.find((node) => node.id === 'historical_validated')?.provenance).toMatchObject({
      state: 'active_validated',
      catalogHash: historicalCatalogHash,
      activeCatalog: true
    });
    expect(active.nodeProvenanceCounts).toEqual({
      active_validated: 2,
      catalog_unvalidated: 1
    });

    const historical = getHoneycrispMemorySummary({
      databasePath,
      artifactDirectoryPath: join(workspace, 'artifacts'),
      workspaceId: 'workspace_zsh',
      subjectId: 'subject_apple',
      researchProfile: historicalSnapshot
    });
    expect(historical.nodes.map((node) => node.id)).toEqual([
      'active_validated',
      'active_unvalidated',
      'historical_validated'
    ]);
    expect(historical.nodes.find((node) => node.id === 'historical_validated')?.provenance?.state)
      .toBe('active_validated');

    const catalogAudit = getHoneycrispMemorySummary({
      databasePath,
      artifactDirectoryPath: join(workspace, 'artifacts'),
      workspaceId: 'workspace_zsh',
      subjectId: 'subject_apple',
      researchProfile: activeSnapshot,
      includeForeignCatalogs: true
    });
    expect(catalogAudit.nodes.find((node) => node.id === 'historical_validated')?.provenance).toMatchObject({
      state: 'active_validated',
      catalogHash: historicalCatalogHash,
      activeCatalog: true
    });
    expect(catalogAudit.nodes.find((node) => node.id === 'incompatible_validated')?.provenance).toMatchObject({
      state: 'foreign_validated',
      catalogHash: incompatibleCatalogHash,
      activeCatalog: false
    });
    expect(catalogAudit.nodes.find((node) => node.id === 'legacy_node')?.provenance?.state).toBe('legacy_unrecorded');
  });

  it('fails closed when a pinned profile snapshot hash is invalid', () => {
    const workspace = tempWorkspace();
    const profile = testResearchProfile();
    const summary = getHoneycrispMemorySummary({
      databasePath: join(workspace, 'memory.sqlite'),
      artifactDirectoryPath: join(workspace, 'artifacts'),
      workspaceId: 'workspace_zsh',
      subjectId: 'subject_apple',
      researchProfile: {
        ...profileSnapshot(profile, 'workspace_zsh'),
        profileHash: '0'.repeat(64)
      }
    });

    expect(summary.status).toBe('error');
    expect(summary.nodes).toEqual([]);
    expect(summary.lastError).toMatch(/profile snapshot hash mismatch/i);
  });
});

function profileSnapshot(profile: ResearchProfile, workspaceId: string): ResearchProfileSnapshot {
  const profileHash = createHash('sha256')
    .update('honeycrisp:research-profile:v1\0')
    .update(serializeResearchProfile(profile))
    .digest('hex');
  return {
    id: `profile_${profile.version}`,
    workspaceId,
    profileId: profile.id,
    profileVersion: profile.version,
    profileHash,
    source: 'bundled-default',
    sourcePath: null,
    profile,
    active: true,
    createdAt: '2026-08-10T10:00:00.000Z'
  };
}

function insertCatalogNode(
  database: DatabaseSync,
  id: string,
  catalogHash: string | null,
  updatedAt: string
): Omit<HoneycrispMemoryNodeSummary, 'provenance'> {
  const node: Omit<HoneycrispMemoryNodeSummary, 'provenance'> = {
    id,
    sessionIds: [],
    workspaces: [{ id: 'workspace_zsh', name: 'Zsh' }],
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    type: 'finding',
    title: id.replaceAll('_', ' '),
    summary: `Summary for ${id}.`,
    body: '',
    status: 'draft',
    confidence: 0.5,
    assetIds: [],
    tags: [],
    attributes: {},
    evidenceRefs: [],
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt,
    revision: 1
  };
  database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    node.id,
    node.subjectId,
    node.subjectName,
    node.type,
    node.title,
    node.title.toLowerCase(),
    node.summary,
    node.body,
    node.status,
    node.confidence,
    JSON.stringify(node.attributes),
    node.createdAt,
    node.updatedAt,
    node.revision,
    catalogHash
  );
  database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)')
    .run(node.id, 'workspace_zsh', 'Zsh');
  return node;
}

function insertCatalogValidation(
  database: DatabaseSync,
  node: Omit<HoneycrispMemoryNodeSummary, 'provenance'>,
  catalogHash: string,
  snapshot: ResearchProfileSnapshot
): void {
  database.prepare('INSERT INTO memory_node_catalog_validations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    node.id,
    node.revision,
    catalogHash,
    memoryNodeValidationHash(node),
    'full',
    snapshot.profileHash,
    snapshot.profileId,
    snapshot.profileVersion,
    node.updatedAt
  );
}

function memoryCatalogHash(json: string): string {
  return createHash('sha256').update('honeycrisp:memory-catalog:v1\0').update(json).digest('hex');
}

function memoryNodeValidationHash(node: Omit<HoneycrispMemoryNodeSummary, 'provenance'>): string {
  return createHash('sha256')
    .update('honeycrisp:memory-node-validation:v1\0')
    .update(stableJson({
      id: node.id,
      sessionIds: [...node.sessionIds].sort(),
      workspaces: [...node.workspaces].sort((left, right) => left.id.localeCompare(right.id)),
      subjectId: node.subjectId,
      subjectName: node.subjectName,
      type: node.type,
      title: node.title,
      summary: node.summary,
      body: node.body,
      status: node.status,
      confidence: node.confidence,
      assetIds: [...node.assetIds].sort(),
      tags: [...node.tags].sort(),
      attributes: node.attributes,
      evidence: [],
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      revision: node.revision
    }))
    .digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(',')}}`;
}

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-memory-'));
  createdDirs.push(dir);
  return dir;
}
