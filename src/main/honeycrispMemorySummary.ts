import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  HoneycrispMemoryDirectorySummary,
  HoneycrispMemoryRecordGroups,
  HoneycrispMemoryRecordSummary,
  HoneycrispMemorySummary,
  HoneycrispProofAttemptSummary,
  HoneycrispProofObligationSummary,
  HoneycrispProofSummary
} from '@shared/types';
import { resolveHoneycrispInvocation } from './honeycrispRunEngine';

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
    const agentState = readHoneycrispAgentState(workspacePath, database);
    return {
      ...base,
      source: agentState.source,
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
      records: agentState.records,
      proof: agentState.proof,
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
    source: 'none',
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
    records: emptyRecordGroups(),
    proof: emptyProofSummary(),
    directories: memoryDirectorySummaries(storageRoot, artifactDirectoryPath),
    lastError: null
  };
}

function readHoneycrispAgentState(
  workspacePath: string,
  database: DatabaseSync
): Pick<HoneycrispMemorySummary, 'source' | 'records' | 'proof'> {
  const cliState = readHoneycrispAgentStateFromCli(workspacePath, database);
  if (cliState) return cliState;
  return {
    source: 'honeycrisp_sqlite',
    records: readRecordGroupsFromSqlite(database),
    proof: readProofSummaryFromSqlite(database)
  };
}

function readHoneycrispAgentStateFromCli(
  workspacePath: string,
  database: DatabaseSync
): Pick<HoneycrispMemorySummary, 'source' | 'records' | 'proof'> | null {
  if (!tableExists(database, 'memory_records') || !tableExists(database, 'proof_obligations') || !tableExists(database, 'proof_attempts')) {
    return null;
  }
  const invocation = resolveHoneycrispInvocation();
  const usesNodeCli = invocation.prefixArgs.some((arg) => /(?:^|[\\/])cli\.js$/.test(arg));
  if (!usesNodeCli && invocation.configuredBy !== 'env_command') {
    return null;
  }
  const result = spawnSync(invocation.command, [...invocation.prefixArgs, 'memory', 'agent-state', '--workspace-root', workspacePath, '--json'], {
    cwd: invocation.cwd,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!isRecord(parsed)) return null;
    const memory = isRecord(parsed.memory) ? parsed.memory : {};
    const proof = isRecord(parsed.proof) ? parsed.proof : {};
    return {
      source: 'honeycrisp_cli',
      records: normalizeRecordGroups(memory),
      proof: normalizeProofSummary(proof)
    };
  } catch {
    return null;
  }
}

function readRecordGroupsFromSqlite(database: DatabaseSync): HoneycrispMemoryRecordGroups {
  if (!tableExists(database, 'memory_records')) return emptyRecordGroups();
  const rows = database.prepare('SELECT record_json FROM memory_records ORDER BY updated_at DESC, record_id ASC').all() as SqlRow[];
  return normalizeRecordGroups({
    evidence: recordsByKind(rows, 'evidence'),
    episodes: recordsByKind(rows, 'episodic'),
    semanticClaims: recordsByKind(rows, 'semantic_claim'),
    hypotheses: recordsByKind(rows, 'hypothesis'),
    findings: recordsByKind(rows, 'finding'),
    beliefs: recordsByKind(rows, 'belief'),
    procedures: recordsByKind(rows, 'procedure'),
    prospectiveChecks: recordsByKind(rows, 'prospective_check'),
    working: recordsByKind(rows, 'working')
  });
}

function recordsByKind(rows: SqlRow[], kind: string): Record<string, unknown>[] {
  return rows
    .map((row) => parseJsonRecord(row.record_json))
    .filter((record) => record.kind === kind);
}

function readProofSummaryFromSqlite(database: DatabaseSync): HoneycrispProofSummary {
  const obligations = tableExists(database, 'proof_obligations')
    ? (database.prepare('SELECT obligation_json FROM proof_obligations ORDER BY updated_at DESC, obligation_id ASC').all() as SqlRow[])
        .map((row) => parseJsonRecord(row.obligation_json))
    : [];
  const attempts = tableExists(database, 'proof_attempts')
    ? (database.prepare('SELECT attempt_json FROM proof_attempts ORDER BY updated_at DESC, attempt_id ASC').all() as SqlRow[])
        .map((row) => parseJsonRecord(row.attempt_json))
    : [];
  return normalizeProofSummary({ obligations, attempts });
}

function normalizeRecordGroups(memory: Record<string, unknown>): HoneycrispMemoryRecordGroups {
  return {
    evidence: normalizeRecordArray(memory.evidence),
    episodes: normalizeRecordArray(memory.episodes),
    semanticClaims: normalizeRecordArray(memory.semanticClaims),
    hypotheses: normalizeRecordArray(memory.hypotheses),
    findings: normalizeRecordArray(memory.findings),
    beliefs: normalizeRecordArray(memory.beliefs),
    procedures: normalizeRecordArray(memory.procedures),
    prospectiveChecks: normalizeRecordArray(memory.prospectiveChecks),
    working: normalizeRecordArray(memory.working)
  };
}

function normalizeRecordArray(value: unknown): HoneycrispMemoryRecordSummary[] {
  return Array.isArray(value) ? value.filter(isRecord).map(normalizeRecordSummary) : [];
}

function normalizeRecordSummary(record: Record<string, unknown>): HoneycrispMemoryRecordSummary {
  const summary = stringValue(record.summary) ?? '';
  return {
    id: stringValue(record.id) ?? '',
    kind: stringValue(record.kind) ?? 'unknown',
    status: stringValue(record.status) ?? 'unknown',
    summary,
    confidence: numberOrNull(record.confidence),
    goalId: stringValue(record.goalId),
    subGoalId: stringValue(record.subGoalId),
    sourceEventIds: stringArray(record.sourceEventIds),
    tags: stringArray(record.tags),
    updatedAt: stringValue(record.updatedAt),
    title: recordTitle(record, summary),
    detail: recordDetail(record, summary),
    domainLabels: stringArray(record.domainLabels),
    domainMetadata: isRecord(record.domainMetadata) ? record.domainMetadata : {},
    raw: record
  };
}

function normalizeProofSummary(value: Record<string, unknown>): HoneycrispProofSummary {
  const obligations = Array.isArray(value.obligations) ? value.obligations.filter(isRecord).map(normalizeProofObligation) : [];
  const attempts = Array.isArray(value.attempts) ? value.attempts.filter(isRecord).map(normalizeProofAttempt) : [];
  return {
    obligationCount: obligations.length,
    attemptCount: attempts.length,
    obligationStatusCounts: countBy(obligations, (obligation) => obligation.status),
    attemptStatusCounts: countBy(attempts, (attempt) => attempt.status),
    resultCounts: countBy(attempts, (attempt) => attempt.result ?? 'none'),
    obligations,
    attempts
  };
}

function normalizeProofObligation(obligation: Record<string, unknown>): HoneycrispProofObligationSummary {
  const subject = isRecord(obligation.subject) ? obligation.subject : {};
  return {
    id: stringValue(obligation.id) ?? '',
    status: stringValue(obligation.status) ?? 'unknown',
    subjectKind: stringValue(subject.kind) ?? 'unknown',
    subjectId: stringValue(subject.id) ?? '',
    question: stringValue(obligation.question) ?? '',
    requiredResult: stringValue(obligation.requiredResult),
    findingRecordIds: stringArray(obligation.findingRecordIds),
    hypothesisRecordIds: stringArray(obligation.hypothesisRecordIds),
    evidenceRefIds: stringArray(obligation.evidenceRefIds),
    updatedAt: stringValue(obligation.updatedAt),
    raw: obligation
  };
}

function normalizeProofAttempt(attempt: Record<string, unknown>): HoneycrispProofAttemptSummary {
  const method = isRecord(attempt.method) ? attempt.method : {};
  return {
    id: stringValue(attempt.id) ?? '',
    obligationId: stringValue(attempt.obligationId) ?? '',
    status: stringValue(attempt.status) ?? 'unknown',
    result: stringValue(attempt.result),
    methodKind: stringValue(method.kind) ?? 'unknown',
    methodName: stringValue(method.name) ?? '',
    summary: stringValue(attempt.summary) ?? '',
    verifier: stringValue(attempt.verifier),
    evidenceRefIds: stringArray(attempt.evidenceRefIds),
    sourceEventIds: stringArray(attempt.sourceEventIds),
    updatedAt: stringValue(attempt.updatedAt),
    raw: attempt
  };
}

function emptyRecordGroups(): HoneycrispMemoryRecordGroups {
  return {
    evidence: [],
    episodes: [],
    semanticClaims: [],
    hypotheses: [],
    findings: [],
    beliefs: [],
    procedures: [],
    prospectiveChecks: [],
    working: []
  };
}

function emptyProofSummary(): HoneycrispProofSummary {
  return {
    obligationCount: 0,
    attemptCount: 0,
    obligationStatusCounts: {},
    attemptStatusCounts: {},
    resultCounts: {},
    obligations: [],
    attempts: []
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

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const name = key(item);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function recordTitle(record: Record<string, unknown>, fallback: string): string {
  return (
    stringValue(record.finding) ??
    stringValue(record.hypothesis) ??
    stringValue(record.claim) ??
    stringValue(record.procedure) ??
    stringValue(record.check) ??
    stringValue(record.belief) ??
    fallback
  );
}

function recordDetail(record: Record<string, unknown>, fallback: string): string {
  return (
    stringValue(record.summary) ??
    stringValue(record.finding) ??
    stringValue(record.hypothesis) ??
    stringValue(record.claim) ??
    stringValue(record.procedure) ??
    stringValue(record.check) ??
    fallback
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
