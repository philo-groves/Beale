import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { getHoneycrispMemorySummary } from '../src/main/honeycrispMemorySummary';

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
      CREATE TABLE memory_nodes (id TEXT PRIMARY KEY, tier TEXT NOT NULL, scope_key TEXT NOT NULL, session_id TEXT, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, subject_id TEXT, subject_name TEXT, type TEXT NOT NULL, title TEXT NOT NULL, title_norm TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL, attributes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE memory_node_assets (node_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(node_id, asset_id));
      CREATE TABLE memory_node_tags (node_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(node_id, tag));
      CREATE TABLE memory_edges (from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(from_id, to_id, relation));
      CREATE TABLE memory_evidence_refs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL, path_base TEXT, path TEXT, locator_json TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE honeycrisp_runbooks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, subject_id TEXT, subject_name TEXT, session_id TEXT, title TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL, artifact_id TEXT NOT NULL, relative_path TEXT NOT NULL, content_hash TEXT NOT NULL, size_bytes INTEGER NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    const insertNode = db.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertNode.run('hypothesis_one', 'session', 'run_one', 'run_one', 'workspace_zsh', 'Zsh', 'subject_apple', 'Apple', 'hypothesis', 'Parser state confusion', 'parser state confusion', 'State may cross requests.', '', 'suspected', 0.6, '{}', '2026-06-25T10:00:00.000Z', '2026-06-25T10:01:00.000Z', 1);
    insertNode.run('trajectory_one', 'subject', 'subject_apple', null, 'workspace_zsh', 'Zsh', 'subject_apple', 'Apple', 'trajectory', 'Parser state investigation route', 'parser state investigation route', 'State-reuse analysis route.', 'Details', 'confirmed', 0.95, '{"outcome":"cross-request influence"}', '2026-06-25T10:02:00.000Z', '2026-06-25T10:03:00.000Z', 2);
    insertNode.run('other_session', 'session', 'run_two', 'run_two', 'workspace_zsh', 'Zsh', 'subject_apple', 'Apple', 'hypothesis', 'Other session hypothesis', 'other session hypothesis', 'Must remain session-scoped.', '', 'suspected', 0.4, '{}', '2026-06-25T10:04:00.000Z', '2026-06-25T10:04:00.000Z', 1);
    insertNode.run('other_workspace', 'workspace', 'workspace_mdns', null, 'workspace_mdns', 'mDNSResponder', 'subject_apple', 'Apple', 'primitive', 'Other workspace primitive', 'other workspace primitive', 'Must remain workspace-scoped.', '', 'confirmed', 0.9, '{}', '2026-06-25T10:05:00.000Z', '2026-06-25T10:05:00.000Z', 1);
    insertNode.run('other_subject', 'subject', 'subject_google', null, 'workspace_chrome', 'Chrome', 'subject_google', 'Google', 'trajectory', 'Other subject trajectory', 'other subject trajectory', 'Must remain subject-scoped.', '', 'confirmed', 0.9, '{}', '2026-06-25T10:06:00.000Z', '2026-06-25T10:06:00.000Z', 1);
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
      nodeCount: 2,
      edgeCount: 1,
      evidenceRefCount: 1,
      storageArtifactCount: 1,
      runbookCount: 1,
      latestNodeUpdatedAt: '2026-06-25T10:03:00.000Z',
      nodeTypeCounts: { hypothesis: 1, trajectory: 1 },
      nodeStatusCounts: { confirmed: 1, suspected: 1 },
      nodeTierCounts: { session: 1, subject: 1 },
      dreaming: { available: false, scope: 'workspace', hiddenNodeCount: 0, restorableChangeCount: 0 }
    });
    expect(summary.nodes[0]).toMatchObject({
      id: 'trajectory_one',
      tier: 'subject',
      workspaceName: 'Zsh',
      subjectName: 'Apple',
      type: 'trajectory',
      assetIds: ['asset_api'],
      tags: ['parser'],
      revision: 2,
      evidenceRefs: [expect.objectContaining({ pathBase: 'repository', path: 'src/parser.ts' })]
    });
    expect(summary.edges[0]).toMatchObject({ fromId: 'hypothesis_one', toId: 'trajectory_one', relation: 'informed' });
    expect(summary.nodes.map((node) => node.id)).not.toEqual(expect.arrayContaining(['other_session', 'other_workspace', 'other_subject']));
    expect(summary.runbooks).toEqual([
      expect.objectContaining({ id: 'runbook_one', title: 'Parser reproduction', status: 'active', revision: 2 })
    ]);

    const workspaceSummary = getHoneycrispMemorySummary({
      databasePath: join(memoryRoot, 'memory.sqlite'),
      artifactDirectoryPath: artifactRoot,
      workspaceId: 'workspace_zsh',
      subjectId: 'subject_apple'
    });
    expect(workspaceSummary.nodes.map((node) => node.id)).toEqual(['trajectory_one']);
    expect(workspaceSummary.nodeCount).toBe(1);
    expect(workspaceSummary.edgeCount).toBe(0);
    expect(workspaceSummary.evidenceRefCount).toBe(1);
  });
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-memory-'));
  createdDirs.push(dir);
  return dir;
}
