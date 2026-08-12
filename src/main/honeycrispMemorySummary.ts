import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  emptyMemoryDreamingSummary,
  getMemoryDreamingSummary,
  memoryCatalogHashFromJson,
  memoryCatalogJsonIsCompatibleWithNode,
  memoryCatalogPreservesLegacyNodeIds
} from './memoryDreaming';
import { serializeResearchProfile } from '../shared/researchProfile';
import type {
  HoneycrispMemoryDirectorySummary,
  HoneycrispMemoryEdgeSummary,
  HoneycrispMemoryEvidenceRefSummary,
  HoneycrispMemoryNodeCatalogValidationSummary,
  HoneycrispMemoryNodeProvenanceSummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispRunbookSummary,
  HoneycrispReportSummary,
  HoneycrispMemorySummary,
  ResearchProfileSnapshot
} from '@shared/types';

const ARTIFACT_MANIFEST_FILENAME = 'manifest.json';
const MEMORY_CATALOG_HASH_DOMAIN = 'honeycrisp:memory-catalog:v1\0';
const RESEARCH_PROFILE_HASH_DOMAIN = 'honeycrisp:research-profile:v1\0';
const MEMORY_NODE_VALIDATION_HASH_DOMAIN = 'honeycrisp:memory-node-validation:v1\0';

type SqlRow = Record<string, unknown>;

interface ActiveMemoryCatalog {
  hash: string;
  json: string;
  memory: ResearchProfileSnapshot['profile']['memory'];
  preservesLegacyNodeIds: boolean;
}

export interface HoneycrispMemorySummaryOptions {
  databasePath: string;
  artifactDirectoryPath: string;
  sessionId?: string;
  workspaceId: string;
  subjectId: string | null;
  /** The active or historical run-pinned profile whose memory catalog defines visibility. */
  researchProfile?: ResearchProfileSnapshot | null;
  /** Reserved for an explicit historical catalog audit; normal summaries never include foreign catalogs. */
  includeForeignCatalogs?: boolean;
}

export function getHoneycrispMemorySummary(options: HoneycrispMemorySummaryOptions): HoneycrispMemorySummary {
  const { databasePath, artifactDirectoryPath, sessionId, workspaceId, subjectId } = options;
  const contextSubjectId = subjectId ?? fallbackMemorySubjectId(workspaceId);
  const storageRoot = dirname(databasePath);
  let activeCatalog: ActiveMemoryCatalog | null = null;
  try {
    activeCatalog = activeMemoryCatalog(options.researchProfile ?? null);
  } catch (error) {
    return {
      ...emptySummary(databasePath, storageRoot, artifactDirectoryPath, workspaceId, contextSubjectId, null),
      status: 'error',
      lastError: error instanceof Error ? error.message : String(error)
    };
  }
  const base = emptySummary(
    databasePath,
    storageRoot,
    artifactDirectoryPath,
    workspaceId,
    contextSubjectId,
    activeCatalog?.hash ?? null
  );
  if (!existsSync(databasePath)) return base;

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const hasNodes = tableExists(database, 'memory_nodes');
    const nodes = hasNodes
      ? readNodes(
          database,
          { sessionId, workspaceId, subjectId: contextSubjectId },
          activeCatalog,
          options.includeForeignCatalogs === true
        )
      : [];
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const edges = tableExists(database, 'memory_edges') ? readEdges(database, visibleNodeIds) : [];
    const evidenceRefCount = nodes.reduce((count, node) => count + node.evidenceRefs.length, 0);
    const runbooks = tableExists(database, 'honeycrisp_runbooks') ? readRunbooks(database, workspaceId) : [];
    const reports = tableExists(database, 'honeycrisp_reports') ? readReports(database, workspaceId) : [];
    return {
      ...base,
      source: 'honeycrisp_sqlite',
      status: nodes.length > 0 ? 'ready' : 'empty',
      databaseSizeBytes: fileSize(databasePath),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      evidenceRefCount,
      storageArtifactCount: storageArtifactCount(artifactDirectoryPath),
      runbookCount: runbooks.length,
      reportCount: reports.length,
      latestNodeUpdatedAt: nodes[0]?.updatedAt ?? null,
      nodeTypeCounts: groupedNodeCounts(nodes, (node) => node.type),
      nodeStatusCounts: groupedNodeCounts(nodes, (node) => node.status),
      nodeProvenanceCounts: groupedNodeCounts(nodes, (node) => node.provenance?.state ?? 'legacy_unrecorded'),
      nodes,
      edges,
      runbooks,
      reports,
      dreaming: getMemoryDreamingSummary(database, workspaceId)
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      databaseSizeBytes: fileSize(databasePath),
      lastError: error instanceof Error ? error.message : String(error)
    };
  } finally {
    database?.close();
  }
}

function emptySummary(
  databasePath: string,
  storageRoot: string,
  artifactDirectoryPath: string,
  contextWorkspaceId: string,
  contextSubjectId: string,
  activeCatalogHash: string | null
): HoneycrispMemorySummary {
  return {
    status: 'missing',
    source: 'none',
    contextWorkspaceId,
    contextSubjectId,
    activeCatalogHash,
    databasePath,
    storageRoot,
    artifactDirectoryPath,
    databaseSizeBytes: 0,
    nodeCount: 0,
    edgeCount: 0,
    evidenceRefCount: 0,
    storageArtifactCount: 0,
    runbookCount: 0,
    reportCount: 0,
    latestNodeUpdatedAt: null,
    nodeTypeCounts: {},
    nodeStatusCounts: {},
    nodeProvenanceCounts: {},
    nodes: [],
    edges: [],
    runbooks: [],
    reports: [],
    dreaming: emptyMemoryDreamingSummary(),
    directories: [artifactDirectorySummary(artifactDirectoryPath)],
    lastError: null
  };
}

function readRunbooks(database: DatabaseSync, workspaceId: string): HoneycrispRunbookSummary[] {
  return (database
    .prepare('SELECT * FROM honeycrisp_runbooks WHERE workspace_id = ? ORDER BY updated_at ASC, id')
    .all(workspaceId) as SqlRow[]).map((row) => ({
    id: requiredString(row.id),
    workspaceId: requiredString(row.workspace_id),
    workspaceName: requiredString(row.workspace_name),
    subjectId: optionalString(row.subject_id),
    subjectName: optionalString(row.subject_name),
    sessionId: optionalString(row.session_id),
    title: requiredString(row.title),
    purpose: requiredString(row.purpose),
    status: requiredRunbookStatus(row.status),
    artifactId: requiredString(row.artifact_id),
    revision: requiredNumber(row.revision),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at)
  }));
}

function readNodes(
  database: DatabaseSync,
  context: { sessionId?: string; workspaceId: string; subjectId: string },
  activeCatalog: ActiveMemoryCatalog | null,
  includeForeignCatalogs: boolean
): HoneycrispMemoryNodeSummary[] {
  const membershipSchema = tableExists(database, 'memory_node_sessions') && tableExists(database, 'memory_node_workspaces');
  const catalogColumn = tableHasColumn(database, 'memory_nodes', 'catalog_hash');
  const visibility = memoryVisibility(
    context,
    membershipSchema
  );
  const rows = database.prepare(`SELECT * FROM memory_nodes WHERE ${visibility.sql} ORDER BY updated_at DESC, id ASC`).all(...visibility.params) as SqlRow[];
  const visibleNodeIds = new Set(rows.map((row) => requiredString(row.id)));
  const sessions = membershipSchema
    ? groupedStrings(database, 'SELECT node_id, session_id AS value FROM memory_node_sessions ORDER BY session_id', visibleNodeIds)
    : new Map<string, string[]>();
  const workspaces = membershipSchema
    ? groupedWorkspaceMemberships(database, visibleNodeIds)
    : new Map<string, Array<{ id: string; name: string }>>();
  const assets = groupedStrings(database, 'SELECT node_id, asset_id AS value FROM memory_node_assets ORDER BY asset_id', visibleNodeIds);
  const tags = groupedStrings(database, 'SELECT node_id, tag AS value FROM memory_node_tags ORDER BY tag', visibleNodeIds);
  const evidence = readEvidence(database, visibleNodeIds);
  const nodes = rows.map((row) => {
    const id = requiredString(row.id);
    const node: Omit<HoneycrispMemoryNodeSummary, 'provenance'> = {
      id,
      sessionIds: membershipSchema
        ? sessions.get(id) ?? []
        : optionalString(row.session_id) ? [requiredString(row.session_id)] : [],
      workspaces: membershipSchema
        ? workspaces.get(id) ?? []
        : [{ id: requiredString(row.workspace_id), name: requiredString(row.workspace_name) }],
      subjectId: optionalString(row.subject_id) ?? fallbackMemorySubjectId(requiredString(row.workspace_id ?? context.workspaceId)),
      subjectName: optionalString(row.subject_name) ?? requiredString(row.workspace_name ?? 'Workspace'),
      type: requiredString(row.type),
      title: requiredString(row.title),
      summary: requiredString(row.summary),
      body: requiredString(row.body),
      status: requiredString(row.status),
      confidence: requiredNumber(row.confidence),
      assetIds: assets.get(id) ?? [],
      tags: tags.get(id) ?? [],
      attributes: parseJsonObject(row.attributes_json),
      evidenceRefs: evidence.get(id) ?? [],
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
      revision: requiredNumber(row.revision)
    };
    return {
      ...node,
      provenance: readMemoryNodeProvenance(
        database,
        node,
        catalogColumn ? nullableSqlText(row.catalog_hash) : null,
        activeCatalog
      )
    };
  });
  if (!catalogColumn || includeForeignCatalogs) return nodes;
  return nodes.filter((node) => node.provenance.catalogHash === null
    ? activeCatalog?.preservesLegacyNodeIds === true
    : node.provenance.activeCatalog);
}

function readReports(database: DatabaseSync, workspaceId: string): HoneycrispReportSummary[] {
  return (database
    .prepare('SELECT * FROM honeycrisp_reports WHERE workspace_id = ? ORDER BY updated_at ASC, id')
    .all(workspaceId) as SqlRow[]).map((row) => ({
    id: requiredString(row.id),
    workspaceId: requiredString(row.workspace_id),
    workspaceName: requiredString(row.workspace_name),
    subjectId: optionalString(row.subject_id),
    subjectName: optionalString(row.subject_name),
    sessionId: optionalString(row.session_id),
    title: requiredString(row.title),
    summary: requiredString(row.summary),
    status: requiredReportStatus(row.status),
    artifactId: requiredString(row.artifact_id),
    revision: requiredNumber(row.revision),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at)
  }));
}

function groupedWorkspaceMemberships(
  database: DatabaseSync,
  visibleNodeIds: ReadonlySet<string>
): Map<string, Array<{ id: string; name: string }>> {
  const grouped = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of database.prepare('SELECT node_id, workspace_id, workspace_name FROM memory_node_workspaces ORDER BY workspace_name, workspace_id').all() as SqlRow[]) {
    const nodeId = requiredString(row.node_id);
    if (!visibleNodeIds.has(nodeId)) continue;
    grouped.set(nodeId, [...(grouped.get(nodeId) ?? []), {
      id: requiredString(row.workspace_id),
      name: requiredString(row.workspace_name)
    }]);
  }
  return grouped;
}

function readEvidence(database: DatabaseSync, visibleNodeIds: ReadonlySet<string>): Map<string, HoneycrispMemoryEvidenceRefSummary[]> {
  if (!tableExists(database, 'memory_evidence_refs')) return new Map();
  const grouped = new Map<string, HoneycrispMemoryEvidenceRefSummary[]>();
  const rows = database.prepare('SELECT * FROM memory_evidence_refs ORDER BY created_at, id').all() as SqlRow[];
  for (const row of rows) {
    const nodeId = requiredString(row.node_id);
    if (!visibleNodeIds.has(nodeId)) continue;
    const values = grouped.get(nodeId) ?? [];
    values.push({
      id: requiredString(row.id),
      kind: requiredString(row.kind),
      pathBase: optionalString(row.path_base),
      path: optionalString(row.path),
      locator: parseJsonObject(row.locator_json),
      summary: requiredString(row.summary),
      createdAt: requiredString(row.created_at)
    });
    grouped.set(nodeId, values);
  }
  return grouped;
}

function activeMemoryCatalog(snapshot: ResearchProfileSnapshot | null): ActiveMemoryCatalog | null {
  if (!snapshot) return null;
  if (snapshot.profileId !== snapshot.profile.id || snapshot.profileVersion !== snapshot.profile.version) {
    throw new Error('Research profile snapshot identity does not match its normalized profile.');
  }
  const profileHash = createHash('sha256')
    .update(RESEARCH_PROFILE_HASH_DOMAIN)
    .update(serializeResearchProfile(snapshot.profile))
    .digest('hex');
  if (profileHash !== snapshot.profileHash) {
    throw new Error(`Research profile snapshot hash mismatch: expected ${snapshot.profileHash}, computed ${profileHash}.`);
  }
  const json = stableJson(snapshot.profile.memory);
  return {
    hash: createHash('sha256').update(MEMORY_CATALOG_HASH_DOMAIN).update(json).digest('hex'),
    json,
    memory: snapshot.profile.memory,
    preservesLegacyNodeIds: memoryCatalogPreservesLegacyNodeIds(snapshot.profile.memory)
  };
}

function readMemoryNodeProvenance(
  database: DatabaseSync,
  node: Omit<HoneycrispMemoryNodeSummary, 'provenance'>,
  catalogHash: string | null,
  activeCatalog: ActiveMemoryCatalog | null
): HoneycrispMemoryNodeProvenanceSummary {
  if (catalogHash === null) {
    return {
      state: 'legacy_unrecorded',
      catalogHash: null,
      activeCatalog: false,
      validation: null
    };
  }
  const isExactActiveCatalog = catalogHash === activeCatalog?.hash;
  const snapshot = tableExists(database, 'memory_catalog_snapshots')
    ? database
        .prepare('SELECT schema_version, catalog_json FROM memory_catalog_snapshots WHERE catalog_hash = ?')
        .get(catalogHash) as { schema_version?: unknown; catalog_json?: unknown } | undefined
    : undefined;
  const snapshotJson = typeof snapshot?.catalog_json === 'string' ? snapshot.catalog_json : undefined;
  const snapshotIsValid = snapshot?.schema_version === 1
    && snapshotJson !== undefined
    && memoryCatalogHashFromJson(snapshotJson) === catalogHash;
  const isActiveCatalog = isExactActiveCatalog
    || (snapshotIsValid
      && snapshotJson !== undefined
      && activeCatalog !== null
      && memoryCatalogJsonIsCompatibleWithNode(
        {
          type: node.type,
          status: node.status,
          attributes: node.attributes,
          evidence: node.evidenceRefs.map((evidence) => ({ kind: evidence.kind, pathBase: evidence.pathBase }))
        },
        snapshotJson,
        activeCatalog.memory
      ));
  const row = snapshotIsValid && tableExists(database, 'memory_node_catalog_validations')
    ? database
        .prepare(
          `SELECT node_revision, catalog_hash, node_content_hash, validation_kind,
                  research_profile_hash, research_profile_id, research_profile_version, validated_at
           FROM memory_node_catalog_validations
           WHERE node_id = ? AND node_revision = ? AND catalog_hash = ?`
        )
        .get(node.id, node.revision, catalogHash) as SqlRow | undefined
    : undefined;
  if (
    !row
    || row.node_content_hash !== memoryNodeValidationHash(node)
    || !isMemoryNodeValidationKind(row.validation_kind)
  ) {
    return {
      state: 'catalog_unvalidated',
      catalogHash,
      activeCatalog: isActiveCatalog,
      validation: null
    };
  }
  const profileHash = nullableSqlText(row.research_profile_hash);
  const profileId = nullableSqlText(row.research_profile_id);
  const profileVersion = nullableSqlText(row.research_profile_version);
  const validation: HoneycrispMemoryNodeCatalogValidationSummary = {
    nodeRevision: requiredNumber(row.node_revision),
    catalogHash: requiredString(row.catalog_hash),
    contentHash: requiredString(row.node_content_hash),
    kind: row.validation_kind,
    validatedAt: requiredString(row.validated_at),
    ...(profileHash !== null && profileId !== null && profileVersion !== null
      ? { researchProfile: { hash: profileHash, id: profileId, version: profileVersion } }
      : {})
  };
  return isActiveCatalog
    ? {
        state: 'active_validated',
        catalogHash,
        activeCatalog: true,
        validation
      }
    : {
        state: 'foreign_validated',
        catalogHash,
        activeCatalog: false,
        validation
      };
}

function memoryNodeValidationHash(node: Omit<HoneycrispMemoryNodeSummary, 'provenance'>): string {
  const evidence = node.evidenceRefs.map((item) => ({
    id: item.id,
    kind: item.kind,
    ...(item.pathBase === null ? {} : { pathBase: item.pathBase }),
    ...(item.path === null ? {} : { path: item.path }),
    locator: item.locator,
    summary: item.summary,
    createdAt: item.createdAt
  }));
  return createHash('sha256')
    .update(MEMORY_NODE_VALIDATION_HASH_DOMAIN)
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
      evidence: evidence.sort((left, right) => left.id.localeCompare(right.id)),
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      revision: node.revision
    }))
    .digest('hex');
}

function isMemoryNodeValidationKind(value: unknown): value is HoneycrispMemoryNodeCatalogValidationSummary['kind'] {
  return value === 'full' || value === 'scoped' || value === 'inherited';
}

function readEdges(database: DatabaseSync, visibleNodeIds: ReadonlySet<string>): HoneycrispMemoryEdgeSummary[] {
  const rows = database.prepare('SELECT * FROM memory_edges ORDER BY updated_at DESC, from_id, to_id').all() as SqlRow[];
  return rows.flatMap((row) => {
    const fromId = requiredString(row.from_id);
    const toId = requiredString(row.to_id);
    if (!visibleNodeIds.has(fromId) || !visibleNodeIds.has(toId)) return [];
    return [{
      fromId,
      toId,
      relation: requiredString(row.relation),
      note: requiredString(row.note),
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at)
    }];
  });
}

function groupedStrings(database: DatabaseSync, sql: string, visibleNodeIds: ReadonlySet<string>): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of database.prepare(sql).all() as SqlRow[]) {
    const nodeId = requiredString(row.node_id);
    if (!visibleNodeIds.has(nodeId)) continue;
    grouped.set(nodeId, [...(grouped.get(nodeId) ?? []), requiredString(row.value)]);
  }
  return grouped;
}

function memoryVisibility(
  context: { sessionId?: string; workspaceId: string; subjectId: string },
  membershipSchema: boolean
): { sql: string; params: string[] } {
  let visibility: { sql: string; params: string[] };
  if (membershipSchema) {
    visibility = {
      sql: 'subject_id = ? AND EXISTS (SELECT 1 FROM memory_node_workspaces visible_workspace WHERE visible_workspace.node_id = memory_nodes.id)',
      params: [context.subjectId]
    };
  } else {
    const clauses = ["(tier = 'workspace' AND scope_key = ?)"];
    const params = [context.workspaceId];
    if (context.sessionId) {
      clauses.push("(tier = 'session' AND scope_key = ?)");
      params.push(context.sessionId);
    }
    clauses.push("(tier = 'subject' AND scope_key = ?)");
    params.push(context.subjectId);
    visibility = { sql: `(${clauses.join(' OR ')})`, params };
  }
  return visibility;
}

function groupedNodeCounts(
  nodes: readonly HoneycrispMemoryNodeSummary[],
  select: (node: HoneycrispMemoryNodeSummary) => string
): Record<string, number> {
  return nodes.reduce<Record<string, number>>((counts, node) => {
    const name = select(node);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

function artifactDirectorySummary(path: string): HoneycrispMemoryDirectorySummary {
  return {
    name: 'artifacts',
    path,
    purpose: 'Durable files and raw outputs referenced by concise knowledge nodes.',
    exists: existsSync(path),
    entryCount: directoryEntryCount(path)
  };
}

function directoryEntryCount(path: string): number {
  try { return statSync(path).isDirectory() ? readdirSync(path).length : 0; } catch { return 0; }
}

function storageArtifactCount(artifactDirectoryPath: string): number {
  const manifestPath = join(artifactDirectoryPath, ARTIFACT_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { artifacts?: unknown };
    return Array.isArray(parsed.artifacts) ? parsed.artifacts.length : 0;
  } catch { return 0; }
}

function fileSize(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableHasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return Boolean(
    database
      .prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ? LIMIT 1')
      .get(table, column)
  );
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  const parsed = JSON.parse(value) as unknown;
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected SQLite text value.');
  return value;
}

function optionalString(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function nullableSqlText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}
function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected SQLite numeric value.');
  return value;
}

function fallbackMemorySubjectId(workspaceId: string): string {
  return `subject_workspace:${workspaceId}`;
}

function requiredRunbookStatus(value: unknown): HoneycrispRunbookSummary['status'] {
  if (value === 'draft' || value === 'active' || value === 'completed' || value === 'archived') return value;
  throw new Error('Expected a Honeycrisp runbook status.');
}

function requiredReportStatus(value: unknown): HoneycrispReportSummary['status'] {
  if (value === 'complete' || value === 'stale') return value;
  throw new Error('Expected a Honeycrisp report status.');
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
