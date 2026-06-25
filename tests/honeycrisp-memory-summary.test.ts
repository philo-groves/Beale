import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { getHoneycrispMemorySummary } from '../src/main/honeycrispMemorySummary';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Honeycrisp memory summary', () => {
  it('reports missing memory before Honeycrisp initializes a workspace', () => {
    const workspace = tempWorkspace();

    const summary = getHoneycrispMemorySummary(workspace);

    expect(summary.status).toBe('missing');
    expect(summary.databasePath).toBe(join(workspace, '.honeycrisp', 'memory', 'memory.sqlite'));
    expect(summary.eventCount).toBe(0);
    expect(summary.recordCount).toBe(0);
    expect(summary.directories.map((directory) => directory.name)).toEqual([
      'events',
      'episodes',
      'claims',
      'procedures',
      'hypotheses',
      'prospective',
      'artifacts',
      'scratch'
    ]);
    expect(summary.directories.every((directory) => !directory.exists)).toBe(true);
  });

  it('summarizes Honeycrisp events, records, statuses, claim edges, artifacts, and storage directories', () => {
    const workspace = tempWorkspace();
    const memoryRoot = join(workspace, '.honeycrisp', 'memory');
    const artifactRoot = join(memoryRoot, 'artifacts');
    for (const directory of ['events', 'episodes', 'claims', 'procedures', 'hypotheses', 'prospective', 'scratch']) {
      mkdirSync(join(memoryRoot, directory), { recursive: true });
    }
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(memoryRoot, 'episodes', 'episode.md'), 'summary\n');
    writeFileSync(
      join(artifactRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        artifacts: [{ id: 'artifact_one' }, { id: 'artifact_two' }]
      })
    );

    const db = new DatabaseSync(join(memoryRoot, 'memory.sqlite'));
    db.exec(`
      CREATE TABLE memory_events (
        sequence INTEGER PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        goal_id TEXT,
        loop_id TEXT,
        sub_goal_id TEXT,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        schema_version INTEGER NOT NULL
      );
      CREATE TABLE memory_event_artifacts (
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        uri TEXT,
        summary TEXT,
        content_hash TEXT,
        artifact_ref_json TEXT NOT NULL
      );
      CREATE TABLE memory_records (
        record_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        goal_id TEXT,
        sub_goal_id TEXT,
        confidence REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        source_event_ids_json TEXT NOT NULL,
        evidence_ref_ids_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        entities_json TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE memory_claim_graph_edges (
        edge_id TEXT PRIMARY KEY,
        source_record_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        target_record_id TEXT,
        evidence_ref_id TEXT,
        summary TEXT,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO memory_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      1,
      'evt_one',
      '2026-06-25T10:00:00.000Z',
      'goal.created',
      'goal_one',
      null,
      null,
      '{}',
      'hash-one',
      '[]',
      1
    );
    db.prepare("INSERT INTO memory_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      2,
      'evt_two',
      '2026-06-25T10:05:00.000Z',
      'model.hypothesis',
      'goal_one',
      'loop_one',
      null,
      '{}',
      'hash-two',
      '[]',
      1
    );
    db.prepare("INSERT INTO memory_event_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(2, 'evt_two', 'artifact_one', 'report', 'file:///artifact', 'report', 'sha256:one', '{}');
    const insertRecord = db.prepare("INSERT INTO memory_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insertRecord.run('mem_episode', 'episodic', 'active', 'Episode', 'goal_one', null, 1, '2026-06-25T10:00:00.000Z', '2026-06-25T10:01:00.000Z', null, null, '[]', '[]', '[]', '[]', '{}');
    insertRecord.run('mem_claim', 'semantic_claim', 'candidate', 'Claim', 'goal_one', null, 0.5, '2026-06-25T10:00:00.000Z', '2026-06-25T10:02:00.000Z', null, null, '[]', '[]', '[]', '[]', '{}');
    insertRecord.run('mem_hypothesis', 'hypothesis', 'active', 'Hypothesis', 'goal_one', null, 0.4, '2026-06-25T10:00:00.000Z', '2026-06-25T10:03:00.000Z', null, null, '[]', '[]', '[]', '[]', '{}');
    db.prepare("INSERT INTO memory_claim_graph_edges VALUES (?, ?, ?, ?, ?, ?, ?)").run('edge_one', 'mem_claim', 'supports', 'mem_hypothesis', null, 'supports hypothesis', '2026-06-25T10:03:00.000Z');
    db.close();

    const summary = getHoneycrispMemorySummary(workspace);

    expect(summary.status).toBe('ready');
    expect(summary.eventCount).toBe(2);
    expect(summary.recordCount).toBe(3);
    expect(summary.claimGraphEdgeCount).toBe(1);
    expect(summary.artifactRefCount).toBe(1);
    expect(summary.storageArtifactCount).toBe(2);
    expect(summary.latestEventAt).toBe('2026-06-25T10:05:00.000Z');
    expect(summary.latestRecordUpdatedAt).toBe('2026-06-25T10:03:00.000Z');
    expect(summary.eventKindCounts).toMatchObject({ 'goal.created': 1, 'model.hypothesis': 1 });
    expect(summary.recordKindCounts).toMatchObject({ episodic: 1, semantic_claim: 1, hypothesis: 1 });
    expect(summary.recordStatusCounts).toMatchObject({ active: 2, candidate: 1 });
    expect(summary.directories.find((directory) => directory.name === 'episodes')).toMatchObject({ exists: true, entryCount: 1 });
  });
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-memory-'));
  createdDirs.push(dir);
  return dir;
}
