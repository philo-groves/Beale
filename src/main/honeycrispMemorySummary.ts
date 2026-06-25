import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HoneycrispMemoryDirectorySummary, HoneycrispMemorySummary } from '@shared/types';

const MEMORY_DATABASE_RELATIVE_PATH = join('.honeycrisp', 'memory', 'memory.sqlite');
const MEMORY_STORAGE_RELATIVE_PATH = join('.honeycrisp', 'memory');
const MEMORY_ARTIFACT_RELATIVE_PATH = join('.honeycrisp', 'memory', 'artifacts');
const ARTIFACT_MANIFEST_FILENAME = 'manifest.json';

const MEMORY_DIRECTORIES: Array<{
  name: HoneycrispMemoryDirectorySummary['name'];
  purpose: string;
}> = [
  {
    name: 'events',
    purpose: 'Append-only event logs, raw transcripts, and event-adjacent file payloads.'
  },
  {
    name: 'episodes',
    purpose: 'Loop and session summaries linked to accepted event ids.'
  },
  {
    name: 'claims',
    purpose: 'Semantic claim graph data, citations, support links, and contradiction material.'
  },
  {
    name: 'procedures',
    purpose: 'Reusable runbooks, scripts, tool recipes, and known recovery patterns.'
  },
  {
    name: 'hypotheses',
    purpose: 'Active and retired research hypotheses with evidence for and against.'
  },
  {
    name: 'prospective',
    purpose: 'Scheduled follow-ups, monitoring commitments, and future checks.'
  },
  {
    name: 'artifacts',
    purpose: 'Reports, generated files, extracted data, raw tool outputs, and experiment outputs.'
  },
  {
    name: 'scratch',
    purpose: 'Miscellaneous persistent workspace files that are not yet structured elsewhere.'
  }
];

type SqlRow = Record<string, unknown>;

export function getHoneycrispMemorySummary(workspacePath: string): HoneycrispMemorySummary {
  const databasePath = join(workspacePath, MEMORY_DATABASE_RELATIVE_PATH);
  const storageRoot = join(workspacePath, MEMORY_STORAGE_RELATIVE_PATH);
  const artifactDirectoryPath = join(workspacePath, MEMORY_ARTIFACT_RELATIVE_PATH);
  const base = emptyHoneycrispMemorySummary(databasePath, storageRoot, artifactDirectoryPath);

  if (!existsSync(databasePath)) {
    return {
      ...base,
      directories: memoryDirectorySummaries(storageRoot, artifactDirectoryPath)
    };
  }

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const hasEvents = tableExists(database, 'memory_events');
    const hasRecords = tableExists(database, 'memory_records');
    const hasClaimEdges = tableExists(database, 'memory_claim_graph_edges');
    const hasEventArtifacts = tableExists(database, 'memory_event_artifacts');
    const eventCount = hasEvents ? countRows(database, 'memory_events') : 0;
    const recordCount = hasRecords ? countRows(database, 'memory_records') : 0;
    return {
      ...base,
      status: eventCount + recordCount > 0 ? 'ready' : 'empty',
      databaseSizeBytes: fileSize(databasePath),
      eventCount,
      recordCount,
      claimGraphEdgeCount: hasClaimEdges ? countRows(database, 'memory_claim_graph_edges') : 0,
      artifactRefCount: hasEventArtifacts ? countRows(database, 'memory_event_artifacts') : 0,
      storageArtifactCount: storageArtifactCount(artifactDirectoryPath),
      latestEventAt: hasEvents ? latestText(database, 'memory_events', 'timestamp') : null,
      latestRecordUpdatedAt: hasRecords ? latestText(database, 'memory_records', 'updated_at') : null,
      eventKindCounts: hasEvents ? groupedCounts(database, 'memory_events', 'kind') : {},
      recordKindCounts: hasRecords ? groupedCounts(database, 'memory_records', 'kind') : {},
      recordStatusCounts: hasRecords ? groupedCounts(database, 'memory_records', 'status') : {},
      directories: memoryDirectorySummaries(storageRoot, artifactDirectoryPath)
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      databaseSizeBytes: fileSize(databasePath),
      directories: memoryDirectorySummaries(storageRoot, artifactDirectoryPath),
      lastError: error instanceof Error ? error.message : String(error)
    };
  } finally {
    database?.close();
  }
}

function emptyHoneycrispMemorySummary(databasePath: string, storageRoot: string, artifactDirectoryPath: string): HoneycrispMemorySummary {
  return {
    status: 'missing',
    databasePath,
    storageRoot,
    artifactDirectoryPath,
    databaseSizeBytes: 0,
    eventCount: 0,
    recordCount: 0,
    claimGraphEdgeCount: 0,
    artifactRefCount: 0,
    storageArtifactCount: 0,
    latestEventAt: null,
    latestRecordUpdatedAt: null,
    eventKindCounts: {},
    recordKindCounts: {},
    recordStatusCounts: {},
    directories: memoryDirectorySummaries(storageRoot, artifactDirectoryPath),
    lastError: null
  };
}

function memoryDirectorySummaries(storageRoot: string, artifactDirectoryPath: string): HoneycrispMemoryDirectorySummary[] {
  return MEMORY_DIRECTORIES.map((directory) => {
    const path = directory.name === 'artifacts' ? artifactDirectoryPath : join(storageRoot, directory.name);
    return {
      name: directory.name,
      path,
      purpose: directory.purpose,
      exists: existsSync(path),
      entryCount: directoryEntryCount(path)
    };
  });
}

function directoryEntryCount(path: string): number {
  try {
    return statSync(path).isDirectory() ? readdirSync(path).length : 0;
  } catch {
    return 0;
  }
}

function storageArtifactCount(artifactDirectoryPath: string): number {
  const manifestPath = join(artifactDirectoryPath, ARTIFACT_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { artifacts?: unknown };
    return Array.isArray(parsed.artifacts) ? parsed.artifacts.length : 0;
  } catch {
    return 0;
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function countRows(database: DatabaseSync, table: string): number {
  return numberValue(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), 'count');
}

function latestText(database: DatabaseSync, table: string, column: string): string | null {
  const row = database.prepare(`SELECT ${column} AS value FROM ${table} ORDER BY ${column} DESC LIMIT 1`).get() as SqlRow | undefined;
  return typeof row?.value === 'string' ? row.value : null;
}

function groupedCounts(database: DatabaseSync, table: string, column: string): Record<string, number> {
  const rows = database.prepare(`SELECT ${column} AS name, COUNT(*) AS count FROM ${table} GROUP BY ${column}`).all() as SqlRow[];
  return rows.reduce<Record<string, number>>((counts, row) => {
    if (typeof row.name !== 'string') return counts;
    counts[row.name] = numberValue(row, 'count');
    return counts;
  }, {});
}

function numberValue(row: unknown, key: string): number {
  const value = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[key] : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
