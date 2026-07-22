import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  HoneycrispMemoryDirectorySummary,
  HoneycrispMemoryEdgeSummary,
  HoneycrispMemoryEvidenceRefSummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispMemorySummary
} from '@shared/types';

const ARTIFACT_MANIFEST_FILENAME = 'manifest.json';

type SqlRow = Record<string, unknown>;

export interface HoneycrispMemorySummaryOptions {
  databasePath: string;
  artifactDirectoryPath: string;
  workspaceId: string;
  subjectId: string | null;
}

export function getHoneycrispMemorySummary(options: HoneycrispMemorySummaryOptions): HoneycrispMemorySummary {
  const { databasePath, artifactDirectoryPath, workspaceId, subjectId } = options;
  const storageRoot = dirname(databasePath);
  const base = emptySummary(databasePath, storageRoot, artifactDirectoryPath, workspaceId, subjectId);
  if (!existsSync(databasePath)) return base;

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const hasNodes = tableExists(database, 'memory_nodes');
    const nodes = hasNodes ? readNodes(database) : [];
    const edges = tableExists(database, 'memory_edges') ? readEdges(database) : [];
    const evidenceRefCount = tableExists(database, 'memory_evidence_refs') ? countRows(database, 'memory_evidence_refs') : 0;
    return {
      ...base,
      source: 'honeycrisp_sqlite',
      status: nodes.length > 0 ? 'ready' : 'empty',
      databaseSizeBytes: fileSize(databasePath),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      evidenceRefCount,
      storageArtifactCount: storageArtifactCount(artifactDirectoryPath),
      latestNodeUpdatedAt: hasNodes ? latestText(database, 'memory_nodes', 'updated_at') : null,
      nodeTypeCounts: hasNodes ? groupedCounts(database, 'memory_nodes', 'type') : {},
      nodeStatusCounts: hasNodes ? groupedCounts(database, 'memory_nodes', 'status') : {},
      nodeTierCounts: hasNodes ? groupedCounts(database, 'memory_nodes', 'tier') : {},
      nodes,
      edges
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
  contextSubjectId: string | null
): HoneycrispMemorySummary {
  return {
    status: 'missing',
    source: 'none',
    contextWorkspaceId,
    contextSubjectId,
    databasePath,
    storageRoot,
    artifactDirectoryPath,
    databaseSizeBytes: 0,
    nodeCount: 0,
    edgeCount: 0,
    evidenceRefCount: 0,
    storageArtifactCount: 0,
    latestNodeUpdatedAt: null,
    nodeTypeCounts: {},
    nodeStatusCounts: {},
    nodeTierCounts: {},
    nodes: [],
    edges: [],
    directories: [artifactDirectorySummary(artifactDirectoryPath)],
    lastError: null
  };
}

function readNodes(database: DatabaseSync): HoneycrispMemoryNodeSummary[] {
  const rows = database.prepare('SELECT * FROM memory_nodes ORDER BY updated_at DESC, id ASC').all() as SqlRow[];
  const assets = groupedStrings(database, 'SELECT node_id, asset_id AS value FROM memory_node_assets ORDER BY asset_id');
  const tags = groupedStrings(database, 'SELECT node_id, tag AS value FROM memory_node_tags ORDER BY tag');
  const evidence = readEvidence(database);
  return rows.map((row) => {
    const id = requiredString(row.id);
    return {
      id,
      tier: requiredMemoryTier(row.tier),
      sessionId: optionalString(row.session_id),
      workspaceId: requiredString(row.workspace_id),
      workspaceName: requiredString(row.workspace_name),
      subjectId: optionalString(row.subject_id),
      subjectName: optionalString(row.subject_name),
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
  });
}

function readEvidence(database: DatabaseSync): Map<string, HoneycrispMemoryEvidenceRefSummary[]> {
  if (!tableExists(database, 'memory_evidence_refs')) return new Map();
  const grouped = new Map<string, HoneycrispMemoryEvidenceRefSummary[]>();
  const rows = database.prepare('SELECT * FROM memory_evidence_refs ORDER BY created_at, id').all() as SqlRow[];
  for (const row of rows) {
    const nodeId = requiredString(row.node_id);
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

function readEdges(database: DatabaseSync): HoneycrispMemoryEdgeSummary[] {
  const rows = database.prepare('SELECT * FROM memory_edges ORDER BY updated_at DESC, from_id, to_id').all() as SqlRow[];
  return rows.map((row) => ({
    fromId: requiredString(row.from_id),
    toId: requiredString(row.to_id),
    relation: requiredString(row.relation),
    note: requiredString(row.note),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at)
  }));
}

function groupedStrings(database: DatabaseSync, sql: string): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of database.prepare(sql).all() as SqlRow[]) {
    const nodeId = requiredString(row.node_id);
    grouped.set(nodeId, [...(grouped.get(nodeId) ?? []), requiredString(row.value)]);
  }
  return grouped;
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

function countRows(database: DatabaseSync, table: string): number {
  return requiredNumber((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as SqlRow | undefined)?.count);
}

function latestText(database: DatabaseSync, table: string, column: string): string | null {
  const row = database.prepare(`SELECT ${column} AS value FROM ${table} ORDER BY ${column} DESC LIMIT 1`).get() as SqlRow | undefined;
  return optionalString(row?.value);
}

function groupedCounts(database: DatabaseSync, table: string, column: string): Record<string, number> {
  return (database.prepare(`SELECT ${column} AS name, COUNT(*) AS count FROM ${table} GROUP BY ${column}`).all() as SqlRow[]).reduce<Record<string, number>>((counts, row) => {
    counts[requiredString(row.name)] = requiredNumber(row.count);
    return counts;
  }, {});
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
function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected SQLite numeric value.');
  return value;
}

function requiredMemoryTier(value: unknown): HoneycrispMemoryNodeSummary['tier'] {
  if (value === 'session' || value === 'workspace' || value === 'subject') return value;
  throw new Error('Expected a Honeycrisp memory tier.');
}
