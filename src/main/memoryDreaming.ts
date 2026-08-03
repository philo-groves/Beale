import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  MemoryDreamingAction,
  MemoryDreamingChangeSummary,
  MemoryDreamingRunSummary,
  MemoryDreamingSummary
} from '@shared/types';

type SqlValue = string | number | null;
type SqlRow = Record<string, SqlValue>;

interface MemoryRecordsSnapshot {
  nodes: SqlRow[];
  sessions: SqlRow[];
  workspaces: SqlRow[];
  assets: SqlRow[];
  tags: SqlRow[];
  evidence: SqlRow[];
  edges: SqlRow[];
}

interface DreamingCandidate {
  id: string;
  type: string;
  title: string;
  titleNorm: string;
  summary: string;
  body: string;
  status: string;
  confidence: number;
  revision: number;
  updatedAt: string;
  evidenceCount: number;
}

export interface MemoryDreamingPlan {
  prune: Array<{
    nodeId: string;
    reason: string;
  }>;
  merge: Array<{
    survivorNodeId: string;
    duplicateNodeIds: string[];
    summary: string | null;
    body: string | null;
    reason: string;
  }>;
  revise: Array<{
    nodeId: string;
    summary: string | null;
    body: string | null;
    reason: string;
  }>;
}

export interface MemoryDreamingRunContext {
  model: string;
  reasoningEffort: string;
  inputNodeCount: number;
  inputSessionCount: number;
}

interface ValidatedMemoryDreamingPlan {
  prune: Array<{ node: DreamingCandidate; reason: string }>;
  merge: Array<{
    survivor: DreamingCandidate;
    duplicates: DreamingCandidate[];
    summary: string | null;
    body: string | null;
    reason: string;
  }>;
  revise: Array<{
    node: DreamingCandidate;
    summary: string | null;
    body: string | null;
    reason: string;
  }>;
}

interface DreamingChangeRow {
  id: string;
  runId: string;
  action: MemoryDreamingAction;
  title: string;
  nodeType: string;
  hiddenNodeIds: string[];
  survivorNodeId: string | null;
  reason: string;
  before: MemoryRecordsSnapshot;
  after: MemoryRecordsSnapshot;
  createdAt: string;
  restoredAt: string | null;
}

const NODE_COLUMNS = [
  'id',
  'subject_id',
  'subject_name',
  'type',
  'title',
  'title_norm',
  'summary',
  'body',
  'status',
  'confidence',
  'attributes_json',
  'created_at',
  'updated_at',
  'revision'
] as const;

const EVIDENCE_COLUMNS = ['id', 'node_id', 'kind', 'path_base', 'path', 'locator_json', 'summary', 'created_at'] as const;
const EDGE_COLUMNS = ['from_id', 'to_id', 'relation', 'note', 'created_at', 'updated_at'] as const;

export const MEMORY_DREAMING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_dreaming_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'restored')),
  stale_hidden_count INTEGER NOT NULL DEFAULT 0,
  duplicate_hidden_count INTEGER NOT NULL DEFAULT 0,
  duplicate_group_count INTEGER NOT NULL DEFAULT 0,
  edited_node_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  restored_at TEXT,
  model TEXT NOT NULL DEFAULT 'unknown',
  reasoning_effort TEXT NOT NULL DEFAULT 'unknown',
  input_node_count INTEGER NOT NULL DEFAULT 0,
  input_session_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS memory_dreaming_changes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES memory_dreaming_runs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('prune', 'merge_duplicates', 'revise')),
  title TEXT NOT NULL,
  node_type TEXT NOT NULL,
  hidden_node_ids_json TEXT NOT NULL,
  survivor_node_id TEXT,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  restored_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_dreaming_runs_workspace_created
ON memory_dreaming_runs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_dreaming_changes_workspace_created
ON memory_dreaming_changes(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_dreaming_changes_run
ON memory_dreaming_changes(run_id);
`;

export function emptyMemoryDreamingSummary(): MemoryDreamingSummary {
  return {
    available: false,
    scope: 'workspace',
    hiddenNodeCount: 0,
    restorableChangeCount: 0,
    lastRun: null,
    changes: []
  };
}

export function getMemoryDreamingSummary(database: DatabaseSync, workspaceId: string): MemoryDreamingSummary {
  if (!tableExists(database, 'memory_nodes')
    || !tableExists(database, 'memory_node_sessions')
    || !tableExists(database, 'memory_node_workspaces')
    || !tableExists(database, 'memory_dreaming_runs')
    || !tableExists(database, 'memory_dreaming_changes')) {
    return emptyMemoryDreamingSummary();
  }

  const runRow = asOptionalRow(
    database
      .prepare('SELECT * FROM memory_dreaming_runs WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(workspaceId)
  );
  const changeRows = asRows(
    database
      .prepare(
        `SELECT *
         FROM memory_dreaming_changes
         WHERE workspace_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(workspaceId)
  );
  const changes = changeRows.map(mapDreamingChangeRow);
  const summaries = changes.map((change) => dreamingChangeSummary(database, change));
  const hiddenNodeIds = new Set(changes
    .filter((change) => change.restoredAt === null)
    .flatMap((change) => change.hiddenNodeIds));
  const hiddenNodeCount = [...hiddenNodeIds].filter((nodeId) => !isNodeAssociatedWithWorkspace(database, nodeId, workspaceId)).length;
  return {
    available: true,
    scope: 'workspace',
    hiddenNodeCount,
    restorableChangeCount: summaries.filter((change) => change.canRestore).length,
    lastRun: runRow ? mapDreamingRunSummary(runRow) : null,
    changes: summaries
  };
}

export function runMemoryDreaming(
  databasePath: string,
  workspaceId: string,
  requestedPlan: MemoryDreamingPlan,
  context: MemoryDreamingRunContext
): MemoryDreamingRunSummary {
  const database = openDreamingDatabase(databasePath);
  try {
    if (!tableExists(database, 'memory_nodes')
      || !tableExists(database, 'memory_node_sessions')
      || !tableExists(database, 'memory_node_workspaces')) {
      throw new Error('Honeycrisp memory is not initialized for this workspace.');
    }
    const candidates = readDreamingCandidates(database, workspaceId);
    const plan = validateMemoryDreamingPlan(requestedPlan, candidates);
    const runId = `dream_${randomUUID()}`;
    const now = new Date().toISOString();
    let prunedNodeCount = 0;
    let duplicateHiddenCount = 0;
    let duplicateGroupCount = 0;
    let editedNodeCount = 0;

    database.exec('BEGIN IMMEDIATE;');
    try {
      database
        .prepare(
          `INSERT INTO memory_dreaming_runs (
             id, workspace_id, status, stale_hidden_count, duplicate_hidden_count,
             duplicate_group_count, edited_node_count, created_at, completed_at, restored_at,
             model, reasoning_effort, input_node_count, input_session_count
           ) VALUES (?, ?, 'completed', 0, 0, 0, 0, ?, ?, NULL, ?, ?, ?, ?)`
        )
        .run(
          runId,
          workspaceId,
          now,
          now,
          context.model,
          context.reasoningEffort,
          context.inputNodeCount,
          context.inputSessionCount
        );

      for (const decision of plan.prune) {
        const changeId = `dream_change_${randomUUID()}`;
        const before = snapshotMemoryRecords(database, [decision.node.id]);
        hideMemoryNode(database, decision.node.id, workspaceId, runId, now);
        const after = snapshotMemoryRecords(database, [decision.node.id]);
        insertDreamingChange(database, {
          id: changeId,
          runId,
          workspaceId,
          action: 'prune',
          title: decision.node.title,
          nodeType: decision.node.type,
          hiddenNodeIds: [decision.node.id],
          survivorNodeId: null,
          reason: decision.reason,
          before,
          after,
          createdAt: now
        });
        prunedNodeCount += 1;
      }

      for (const decision of plan.merge) {
        const affectedNodeIds = [decision.survivor.id, ...decision.duplicates.map((candidate) => candidate.id)];
        const changeId = `dream_change_${randomUUID()}`;
        const before = snapshotMemoryRecords(database, affectedNodeIds);
        mergeDuplicateMemories(
          database,
          decision.survivor,
          decision.duplicates,
          workspaceId,
          runId,
          changeId,
          now,
          decision.summary,
          decision.body
        );
        const after = snapshotMemoryRecords(database, affectedNodeIds);
        insertDreamingChange(database, {
          id: changeId,
          runId,
          workspaceId,
          action: 'merge_duplicates',
          title: decision.survivor.title,
          nodeType: decision.survivor.type,
          hiddenNodeIds: decision.duplicates.map((candidate) => candidate.id),
          survivorNodeId: decision.survivor.id,
          reason: decision.reason,
          before,
          after,
          createdAt: now
        });
        duplicateHiddenCount += decision.duplicates.length;
        duplicateGroupCount += 1;
        editedNodeCount += 1;
      }

      for (const decision of plan.revise) {
        const changeId = `dream_change_${randomUUID()}`;
        const before = snapshotMemoryRecords(database, [decision.node.id]);
        reviseMemoryNode(database, decision.node, decision.summary, decision.body, now);
        const after = snapshotMemoryRecords(database, [decision.node.id]);
        insertDreamingChange(database, {
          id: changeId,
          runId,
          workspaceId,
          action: 'revise',
          title: decision.node.title,
          nodeType: decision.node.type,
          hiddenNodeIds: [],
          survivorNodeId: decision.node.id,
          reason: decision.reason,
          before,
          after,
          createdAt: now
        });
        editedNodeCount += 1;
      }

      database
        .prepare(
          `UPDATE memory_dreaming_runs
           SET stale_hidden_count = ?,
               duplicate_hidden_count = ?,
               duplicate_group_count = ?,
               edited_node_count = ?,
               completed_at = ?
           WHERE id = ?`
        )
        .run(prunedNodeCount, duplicateHiddenCount, duplicateGroupCount, editedNodeCount, now, runId);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }

    return {
      id: runId,
      status: 'completed',
      model: context.model,
      reasoningEffort: context.reasoningEffort,
      inputNodeCount: context.inputNodeCount,
      inputSessionCount: context.inputSessionCount,
      prunedNodeCount,
      duplicateHiddenCount,
      duplicateGroupCount,
      editedNodeCount,
      createdAt: now,
      completedAt: now,
      restoredAt: null
    };
  } finally {
    database.close();
  }
}

export function restoreMemoryDreamingChange(databasePath: string, workspaceId: string, changeId: string): void {
  const database = openDreamingDatabase(databasePath);
  try {
    const row = asOptionalRow(
      database
        .prepare('SELECT * FROM memory_dreaming_changes WHERE id = ? AND workspace_id = ?')
        .get(changeId, workspaceId)
    );
    if (!row) throw new Error(`Dreaming change not found: ${changeId}`);
    const change = mapDreamingChangeRow(row);
    if (change.restoredAt) return;
    const nodeIds = change.before.nodes.map((node) => stringField(node, 'id'));
    const current = snapshotMemoryRecords(database, nodeIds);
    if (!snapshotsEqual(current, change.after)) {
      throw new Error('This memory changed after Dreaming and cannot be restored automatically.');
    }

    const restoredAt = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE;');
    try {
      applyMemorySnapshot(database, change.before, nodeIds);
      database
        .prepare('UPDATE memory_dreaming_changes SET restored_at = ? WHERE id = ?')
        .run(restoredAt, changeId);
      const remaining = asRow(
        database
          .prepare('SELECT COUNT(*) AS count FROM memory_dreaming_changes WHERE run_id = ? AND restored_at IS NULL')
          .get(change.runId)
      );
      if (numberField(remaining, 'count') === 0) {
        database
          .prepare("UPDATE memory_dreaming_runs SET status = 'restored', restored_at = ? WHERE id = ?")
          .run(restoredAt, change.runId);
      }
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  } finally {
    database.close();
  }
}

function openDreamingDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');
  return database;
}

function readDreamingCandidates(database: DatabaseSync, workspaceId: string): DreamingCandidate[] {
  return asRows(
    database
      .prepare(
        `SELECT n.id, n.type, n.title, n.title_norm, n.summary, n.body, n.status,
                n.confidence, n.revision, n.updated_at,
                (SELECT COUNT(*) FROM memory_evidence_refs e WHERE e.node_id = n.id) AS evidence_count
         FROM memory_nodes n
         WHERE EXISTS (
           SELECT 1 FROM memory_node_workspaces workspace_membership
           WHERE workspace_membership.node_id = n.id AND workspace_membership.workspace_id = ?
         )
         ORDER BY n.updated_at DESC, n.id`
      )
      .all(workspaceId)
  ).map((row) => ({
    id: stringField(row, 'id'),
    type: stringField(row, 'type'),
    title: stringField(row, 'title'),
    titleNorm: stringField(row, 'title_norm'),
    summary: stringField(row, 'summary'),
    body: stringField(row, 'body'),
    status: stringField(row, 'status'),
    confidence: numberField(row, 'confidence'),
    revision: numberField(row, 'revision'),
    updatedAt: stringField(row, 'updated_at'),
    evidenceCount: numberField(row, 'evidence_count')
  }));
}

function validateMemoryDreamingPlan(plan: MemoryDreamingPlan, candidates: DreamingCandidate[]): ValidatedMemoryDreamingPlan {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const consumed = new Set<string>();
  const requireCandidate = (nodeId: string): DreamingCandidate => {
    const candidate = byId.get(nodeId);
    if (!candidate) throw new Error(`Dreaming proposed an unknown or non-workspace memory node: ${nodeId}`);
    return candidate;
  };
  const consume = (candidate: DreamingCandidate): void => {
    if (consumed.has(candidate.id)) {
      throw new Error(`Dreaming proposed more than one change for memory node: ${candidate.id}`);
    }
    consumed.add(candidate.id);
  };
  const reason = (value: string): string => {
    const normalized = value.trim().slice(0, 2_000);
    if (!normalized) throw new Error('Every Dreaming decision must include a reason.');
    return normalized;
  };

  const prune = plan.prune.map((decision) => {
    const node = requireCandidate(decision.nodeId);
    consume(node);
    return { node, reason: reason(decision.reason) };
  });
  const merge = plan.merge.map((decision) => {
    const survivor = requireCandidate(decision.survivorNodeId);
    const duplicateIds = [...new Set(decision.duplicateNodeIds)];
    if (duplicateIds.length === 0 || duplicateIds.includes(survivor.id)) {
      throw new Error(`Dreaming merge for ${survivor.id} must name at least one distinct duplicate.`);
    }
    const duplicates = duplicateIds.map(requireCandidate);
    if (duplicates.some((candidate) => candidate.type !== survivor.type)) {
      throw new Error(`Dreaming cannot merge different memory types into ${survivor.id}.`);
    }
    if (!compatibleDuplicateStatuses([survivor, ...duplicates])) {
      throw new Error(`Dreaming cannot merge rejected and non-rejected memories into ${survivor.id}.`);
    }
    consume(survivor);
    duplicates.forEach(consume);
    return {
      survivor,
      duplicates,
      summary: boundedOptionalText(decision.summary, 12_000),
      body: boundedOptionalText(decision.body, 60_000),
      reason: reason(decision.reason)
    };
  });
  const revise = plan.revise.map((decision) => {
    const node = requireCandidate(decision.nodeId);
    const summary = boundedOptionalText(decision.summary, 12_000);
    const body = boundedOptionalText(decision.body, 60_000);
    if (summary === null && body === null) {
      throw new Error(`Dreaming revision for ${node.id} did not include a summary or body.`);
    }
    consume(node);
    return { node, summary, body, reason: reason(decision.reason) };
  });
  return { prune, merge, revise };
}

function boundedOptionalText(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function compatibleDuplicateStatuses(group: DreamingCandidate[]): boolean {
  const statuses = new Set(group.map((candidate) => candidate.status));
  return !statuses.has('rejected') || statuses.size === 1;
}

function mergeDuplicateMemories(
  database: DatabaseSync,
  survivor: DreamingCandidate,
  duplicates: DreamingCandidate[],
  workspaceId: string,
  runId: string,
  changeId: string,
  now: string,
  proposedSummary: string | null,
  proposedBody: string | null
): void {
  const richerSummary = proposedSummary ?? richerSuperset(survivor.summary, duplicates.map((candidate) => candidate.summary));
  const richerBody = proposedBody ?? richerSuperset(survivor.body, duplicates.map((candidate) => candidate.body));
  const survivorEvidence = new Set(
    asRows(
      database
        .prepare(
          `SELECT kind, path_base, path, locator_json, summary
           FROM memory_evidence_refs
           WHERE node_id = ?`
        )
        .all(survivor.id)
    ).map(evidenceSignature)
  );

  for (const duplicate of duplicates) {
    database
      .prepare('INSERT OR IGNORE INTO memory_node_sessions (node_id, session_id) SELECT ?, session_id FROM memory_node_sessions WHERE node_id = ?')
      .run(survivor.id, duplicate.id);
    database
      .prepare('INSERT OR IGNORE INTO memory_node_workspaces (node_id, workspace_id, workspace_name) SELECT ?, workspace_id, workspace_name FROM memory_node_workspaces WHERE node_id = ?')
      .run(survivor.id, duplicate.id);
    database
      .prepare('INSERT OR IGNORE INTO memory_node_assets (node_id, asset_id) SELECT ?, asset_id FROM memory_node_assets WHERE node_id = ?')
      .run(survivor.id, duplicate.id);
    database
      .prepare('INSERT OR IGNORE INTO memory_node_tags (node_id, tag) SELECT ?, tag FROM memory_node_tags WHERE node_id = ?')
      .run(survivor.id, duplicate.id);

    const evidenceRows = asRows(database.prepare('SELECT * FROM memory_evidence_refs WHERE node_id = ? ORDER BY id').all(duplicate.id));
    for (const evidence of evidenceRows) {
      const signature = evidenceSignature(evidence);
      if (survivorEvidence.has(signature)) continue;
      survivorEvidence.add(signature);
      const clonedId = `dream_evidence_${createHash('sha256').update(`${changeId}\u0000${stringField(evidence, 'id')}`).digest('hex').slice(0, 24)}`;
      database
        .prepare(
          `INSERT OR IGNORE INTO memory_evidence_refs (
             id, node_id, kind, path_base, path, locator_json, summary, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          clonedId,
          survivor.id,
          stringField(evidence, 'kind'),
          nullableField(evidence, 'path_base'),
          nullableField(evidence, 'path'),
          stringField(evidence, 'locator_json'),
          stringField(evidence, 'summary'),
          stringField(evidence, 'created_at')
        );
    }

    const edges = asRows(
      database
        .prepare('SELECT * FROM memory_edges WHERE from_id = ? OR to_id = ? ORDER BY from_id, to_id, relation')
        .all(duplicate.id, duplicate.id)
    );
    for (const edge of edges) {
      const fromId = stringField(edge, 'from_id') === duplicate.id ? survivor.id : stringField(edge, 'from_id');
      const toId = stringField(edge, 'to_id') === duplicate.id ? survivor.id : stringField(edge, 'to_id');
      if (fromId === toId) continue;
      database
        .prepare(
          `INSERT OR IGNORE INTO memory_edges (
             from_id, to_id, relation, note, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          fromId,
          toId,
          stringField(edge, 'relation'),
          stringField(edge, 'note'),
          stringField(edge, 'created_at'),
          now
        );
    }
    hideMemoryNode(database, duplicate.id, workspaceId, runId, now);
  }

  database
    .prepare(
      `UPDATE memory_nodes
       SET summary = ?, body = ?, revision = revision + 1, updated_at = ?
       WHERE id = ?`
    )
    .run(richerSummary, richerBody, now, survivor.id);
}

function reviseMemoryNode(
  database: DatabaseSync,
  node: DreamingCandidate,
  proposedSummary: string | null,
  proposedBody: string | null,
  now: string
): void {
  database
    .prepare(
      `UPDATE memory_nodes
       SET summary = ?, body = ?, revision = revision + 1, updated_at = ?
       WHERE id = ?`
    )
    .run(proposedSummary ?? node.summary, proposedBody ?? node.body, now, node.id);
}

function richerSuperset(primary: string, alternatives: string[]): string {
  let selected = primary;
  let normalized = normalizeText(primary);
  for (const alternative of alternatives) {
    const candidate = alternative.trim();
    const candidateNormalized = normalizeText(candidate);
    if (!candidateNormalized) continue;
    if (!normalized || (candidateNormalized.includes(normalized) && candidateNormalized.length > normalized.length)) {
      selected = candidate;
      normalized = candidateNormalized;
    }
  }
  return selected;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hideMemoryNode(database: DatabaseSync, nodeId: string, workspaceId: string, runId: string, now: string): void {
  void runId;
  database.prepare('DELETE FROM memory_node_workspaces WHERE node_id = ? AND workspace_id = ?').run(nodeId, workspaceId);
  database.prepare('UPDATE memory_nodes SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now, nodeId);
}

function insertDreamingChange(
  database: DatabaseSync,
  input: {
    id: string;
    runId: string;
    workspaceId: string;
    action: MemoryDreamingAction;
    title: string;
    nodeType: string;
    hiddenNodeIds: string[];
    survivorNodeId: string | null;
    reason: string;
    before: MemoryRecordsSnapshot;
    after: MemoryRecordsSnapshot;
    createdAt: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO memory_dreaming_changes (
         id, run_id, workspace_id, action, title, node_type, hidden_node_ids_json,
         survivor_node_id, reason, before_json, after_json, created_at, restored_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      input.id,
      input.runId,
      input.workspaceId,
      input.action,
      input.title,
      input.nodeType,
      JSON.stringify(input.hiddenNodeIds),
      input.survivorNodeId,
      input.reason,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.createdAt
    );
}

function snapshotMemoryRecords(database: DatabaseSync, nodeIds: string[]): MemoryRecordsSnapshot {
  const uniqueIds = [...new Set(nodeIds)].sort();
  if (uniqueIds.length === 0) return { nodes: [], sessions: [], workspaces: [], assets: [], tags: [], evidence: [], edges: [] };
  const placeholders = uniqueIds.map(() => '?').join(', ');
  return {
    nodes: asRows(
      database
        .prepare(`SELECT ${NODE_COLUMNS.join(', ')} FROM memory_nodes WHERE id IN (${placeholders}) ORDER BY id`)
        .all(...uniqueIds)
    ),
    sessions: asRows(
      database
        .prepare(`SELECT node_id, session_id FROM memory_node_sessions WHERE node_id IN (${placeholders}) ORDER BY node_id, session_id`)
        .all(...uniqueIds)
    ),
    workspaces: asRows(
      database
        .prepare(`SELECT node_id, workspace_id, workspace_name FROM memory_node_workspaces WHERE node_id IN (${placeholders}) ORDER BY node_id, workspace_id`)
        .all(...uniqueIds)
    ),
    assets: asRows(
      database
        .prepare(`SELECT node_id, asset_id FROM memory_node_assets WHERE node_id IN (${placeholders}) ORDER BY node_id, asset_id`)
        .all(...uniqueIds)
    ),
    tags: asRows(
      database
        .prepare(`SELECT node_id, tag FROM memory_node_tags WHERE node_id IN (${placeholders}) ORDER BY node_id, tag`)
        .all(...uniqueIds)
    ),
    evidence: asRows(
      database
        .prepare(`SELECT ${EVIDENCE_COLUMNS.join(', ')} FROM memory_evidence_refs WHERE node_id IN (${placeholders}) ORDER BY id`)
        .all(...uniqueIds)
    ),
    edges: asRows(
      database
        .prepare(
          `SELECT ${EDGE_COLUMNS.join(', ')}
           FROM memory_edges
           WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})
           ORDER BY from_id, to_id, relation`
        )
        .all(...uniqueIds, ...uniqueIds)
    )
  };
}

function applyMemorySnapshot(database: DatabaseSync, snapshot: MemoryRecordsSnapshot, nodeIds: string[]): void {
  const uniqueIds = [...new Set(nodeIds)].sort();
  const placeholders = uniqueIds.map(() => '?').join(', ');
  database.prepare(`DELETE FROM memory_node_sessions WHERE node_id IN (${placeholders})`).run(...uniqueIds);
  database.prepare(`DELETE FROM memory_node_workspaces WHERE node_id IN (${placeholders})`).run(...uniqueIds);
  database.prepare(`DELETE FROM memory_node_assets WHERE node_id IN (${placeholders})`).run(...uniqueIds);
  database.prepare(`DELETE FROM memory_node_tags WHERE node_id IN (${placeholders})`).run(...uniqueIds);
  database.prepare(`DELETE FROM memory_evidence_refs WHERE node_id IN (${placeholders})`).run(...uniqueIds);
  database
    .prepare(`DELETE FROM memory_edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`)
    .run(...uniqueIds, ...uniqueIds);

  const nodeInsert = database.prepare(
    `INSERT INTO memory_nodes (${NODE_COLUMNS.join(', ')})
     VALUES (${NODE_COLUMNS.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET
       ${NODE_COLUMNS.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`).join(', ')}`
  );
  for (const row of snapshot.nodes) nodeInsert.run(...NODE_COLUMNS.map((column) => row[column] ?? null));
  insertSnapshotRows(database, 'memory_node_sessions', ['node_id', 'session_id'], snapshot.sessions);
  insertSnapshotRows(database, 'memory_node_workspaces', ['node_id', 'workspace_id', 'workspace_name'], snapshot.workspaces);
  insertSnapshotRows(database, 'memory_node_assets', ['node_id', 'asset_id'], snapshot.assets);
  insertSnapshotRows(database, 'memory_node_tags', ['node_id', 'tag'], snapshot.tags);
  insertSnapshotRows(database, 'memory_evidence_refs', [...EVIDENCE_COLUMNS], snapshot.evidence);
  insertSnapshotRows(database, 'memory_edges', [...EDGE_COLUMNS], snapshot.edges);
}

function insertSnapshotRows(database: DatabaseSync, table: string, columns: string[], rows: SqlRow[]): void {
  if (rows.length === 0) return;
  const statement = database.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  );
  for (const row of rows) statement.run(...columns.map((column) => row[column] ?? null));
}

function dreamingChangeSummary(database: DatabaseSync, change: DreamingChangeRow): MemoryDreamingChangeSummary {
  const nodeIds = change.before.nodes.map((node) => stringField(node, 'id'));
  const canRestore = change.restoredAt === null && snapshotsEqual(snapshotMemoryRecords(database, nodeIds), change.after);
  return {
    id: change.id,
    runId: change.runId,
    action: change.action,
    title: change.title,
    nodeType: change.nodeType,
    hiddenNodeIds: change.hiddenNodeIds,
    survivorNodeId: change.survivorNodeId,
    reason: change.reason,
    createdAt: change.createdAt,
    restoredAt: change.restoredAt,
    canRestore
  };
}

function mapDreamingChangeRow(row: SqlRow): DreamingChangeRow {
  return {
    id: stringField(row, 'id'),
    runId: stringField(row, 'run_id'),
    action: stringField(row, 'action') as MemoryDreamingAction,
    title: stringField(row, 'title'),
    nodeType: stringField(row, 'node_type'),
    hiddenNodeIds: parseStringArray(stringField(row, 'hidden_node_ids_json')),
    survivorNodeId: nullableField(row, 'survivor_node_id'),
    reason: stringField(row, 'reason'),
    before: parseSnapshot(stringField(row, 'before_json')),
    after: parseSnapshot(stringField(row, 'after_json')),
    createdAt: stringField(row, 'created_at'),
    restoredAt: nullableField(row, 'restored_at')
  };
}

function mapDreamingRunSummary(row: SqlRow): MemoryDreamingRunSummary {
  return {
    id: stringField(row, 'id'),
    status: stringField(row, 'status') as MemoryDreamingRunSummary['status'],
    model: stringField(row, 'model'),
    reasoningEffort: stringField(row, 'reasoning_effort'),
    inputNodeCount: numberField(row, 'input_node_count'),
    inputSessionCount: numberField(row, 'input_session_count'),
    prunedNodeCount: numberField(row, 'stale_hidden_count'),
    duplicateHiddenCount: numberField(row, 'duplicate_hidden_count'),
    duplicateGroupCount: numberField(row, 'duplicate_group_count'),
    editedNodeCount: numberField(row, 'edited_node_count'),
    createdAt: stringField(row, 'created_at'),
    completedAt: stringField(row, 'completed_at'),
    restoredAt: nullableField(row, 'restored_at')
  };
}

function parseSnapshot(value: string): MemoryRecordsSnapshot {
  const parsed = JSON.parse(value) as Partial<MemoryRecordsSnapshot>;
  return {
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
    assets: Array.isArray(parsed.assets) ? parsed.assets : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    edges: Array.isArray(parsed.edges) ? parsed.edges : []
  };
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function snapshotsEqual(left: MemoryRecordsSnapshot, right: MemoryRecordsSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evidenceSignature(row: SqlRow): string {
  return [
    stringField(row, 'kind'),
    nullableField(row, 'path_base') ?? '',
    nullableField(row, 'path') ?? '',
    stringField(row, 'locator_json'),
    stringField(row, 'summary')
  ].join('\u0000');
}

function isNodeAssociatedWithWorkspace(database: DatabaseSync, nodeId: string, workspaceId: string): boolean {
  return Boolean(database.prepare('SELECT 1 FROM memory_node_workspaces WHERE node_id = ? AND workspace_id = ?').get(nodeId, workspaceId));
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function asRows(value: unknown): SqlRow[] {
  return Array.isArray(value) ? value as SqlRow[] : [];
}

function asRow(value: unknown): SqlRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SqlRow : {};
}

function asOptionalRow(value: unknown): SqlRow | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SqlRow : null;
}

function stringField(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function nullableField(row: SqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function numberField(row: SqlRow, key: string): number {
  const value = row[key];
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) || 0 : 0;
}
