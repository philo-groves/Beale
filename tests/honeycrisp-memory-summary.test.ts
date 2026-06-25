import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { getHoneycrispMemorySummary } from '../src/main/honeycrispMemorySummary';

const createdDirs: string[] = [];

afterEach(() => {
  delete process.env.BEALE_HONEYCRISP_ARGS_JSON;
  delete process.env.BEALE_HONEYCRISP_COMMAND;
  delete process.env.BEALE_HONEYCRISP_CWD;
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
      CREATE TABLE proof_obligations (
        obligation_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        goal_id TEXT,
        sub_goal_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        obligation_json TEXT NOT NULL
      );
      CREATE TABLE proof_attempts (
        attempt_id TEXT PRIMARY KEY,
        obligation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        verifier TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        attempt_json TEXT NOT NULL
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
    insertRecord.run('mem_episode', 'episodic', 'active', 'Episode', 'goal_one', null, 1, '2026-06-25T10:00:00.000Z', '2026-06-25T10:01:00.000Z', null, null, '[]', '[]', '[]', '[]', JSON.stringify({ id: 'mem_episode', kind: 'episodic', status: 'active', summary: 'Episode', updatedAt: '2026-06-25T10:01:00.000Z' }));
    insertRecord.run('mem_claim', 'semantic_claim', 'candidate', 'Claim', 'goal_one', null, 0.5, '2026-06-25T10:00:00.000Z', '2026-06-25T10:02:00.000Z', null, null, '[]', '[]', '[]', '[]', JSON.stringify({ id: 'mem_claim', kind: 'semantic_claim', status: 'candidate', summary: 'Claim', claim: 'Claim', updatedAt: '2026-06-25T10:02:00.000Z' }));
    insertRecord.run('mem_hypothesis', 'hypothesis', 'active', 'Hypothesis', 'goal_one', null, 0.4, '2026-06-25T10:00:00.000Z', '2026-06-25T10:03:00.000Z', null, null, '[]', '[]', '[]', '[]', JSON.stringify({ id: 'mem_hypothesis', kind: 'hypothesis', status: 'active', summary: 'Hypothesis', hypothesis: 'Hypothesis', updatedAt: '2026-06-25T10:03:00.000Z' }));
    insertRecord.run('mem_evidence', 'evidence', 'confirmed', 'Evidence', 'goal_one', null, 1, '2026-06-25T10:00:00.000Z', '2026-06-25T10:04:00.000Z', null, null, '[]', '[]', '[]', '[]', JSON.stringify({ id: 'mem_evidence', kind: 'evidence', status: 'confirmed', summary: 'Evidence', updatedAt: '2026-06-25T10:04:00.000Z' }));
    insertRecord.run('mem_finding', 'finding', 'confirmed', 'Finding', 'goal_one', null, 0.9, '2026-06-25T10:00:00.000Z', '2026-06-25T10:05:00.000Z', null, null, '[]', '[]', '[]', '[]', JSON.stringify({ id: 'mem_finding', kind: 'finding', status: 'supported', summary: 'Finding', finding: 'Parser finding', domainLabels: ['security'], updatedAt: '2026-06-25T10:05:00.000Z' }));
    insertRecord.run('mem_procedure', 'procedure', 'candidate', 'Procedure', 'goal_one', null, 0.6, '2026-06-25T10:00:00.000Z', '2026-06-25T10:06:00.000Z', null, null, '[]', '[]', '[]', '[]', JSON.stringify({ id: 'mem_procedure', kind: 'procedure', status: 'candidate', summary: 'Procedure', procedure: 'Inspect parser first.', updatedAt: '2026-06-25T10:06:00.000Z' }));
    insertRecord.run('mem_prospective', 'prospective_check', 'active', 'Prospective', 'goal_one', null, 0.7, '2026-06-25T10:00:00.000Z', '2026-06-25T10:07:00.000Z', null, null, '[]', '[]', '[]', '[]', JSON.stringify({ id: 'mem_prospective', kind: 'prospective_check', status: 'active', summary: 'Prospective', check: 'Re-check parser proof.', updatedAt: '2026-06-25T10:07:00.000Z' }));
    db.prepare("INSERT INTO memory_claim_graph_edges VALUES (?, ?, ?, ?, ?, ?, ?)").run('edge_one', 'mem_claim', 'supports', 'mem_hypothesis', null, 'supports hypothesis', '2026-06-25T10:03:00.000Z');
    db.prepare("INSERT INTO proof_obligations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      'proof_obl_one',
      'open',
      'memory_record',
      'mem_finding',
      'goal_one',
      null,
      '2026-06-25T10:08:00.000Z',
      '2026-06-25T10:08:00.000Z',
      JSON.stringify({ id: 'proof_obl_one', status: 'open', subject: { kind: 'memory_record', id: 'mem_finding' }, question: 'Can the finding be reproduced?', findingRecordIds: ['mem_finding'], hypothesisRecordIds: ['mem_hypothesis'], evidenceRefIds: ['mem_evidence'], updatedAt: '2026-06-25T10:08:00.000Z' })
    );
    db.prepare("INSERT INTO proof_attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      'proof_attempt_one',
      'proof_obl_one',
      'completed',
      'pass',
      'fixture',
      '2026-06-25T10:09:00.000Z',
      '2026-06-25T10:09:00.000Z',
      JSON.stringify({ id: 'proof_attempt_one', obligationId: 'proof_obl_one', status: 'completed', result: 'pass', method: { kind: 'empirical_reproduction', name: 'Fixture' }, summary: 'Proof passed.', updatedAt: '2026-06-25T10:09:00.000Z' })
    );
    db.close();

    const summary = getHoneycrispMemorySummary(workspace);

    expect(summary.status).toBe('ready');
    expect(summary.eventCount).toBe(2);
    expect(summary.recordCount).toBe(7);
    expect(summary.claimGraphEdgeCount).toBe(1);
    expect(summary.artifactRefCount).toBe(1);
    expect(summary.storageArtifactCount).toBe(2);
    expect(summary.latestEventAt).toBe('2026-06-25T10:05:00.000Z');
    expect(summary.latestRecordUpdatedAt).toBe('2026-06-25T10:07:00.000Z');
    expect(summary.eventKindCounts).toMatchObject({ 'goal.created': 1, 'model.hypothesis': 1 });
    expect(summary.recordKindCounts).toMatchObject({ episodic: 1, semantic_claim: 1, hypothesis: 1, evidence: 1, finding: 1, procedure: 1, prospective_check: 1 });
    expect(summary.recordStatusCounts).toMatchObject({ active: 3, candidate: 2, confirmed: 2 });
    expect(summary.records.evidence[0]).toMatchObject({ id: 'mem_evidence', title: 'Evidence' });
    expect(summary.records.hypotheses[0]).toMatchObject({ id: 'mem_hypothesis', title: 'Hypothesis' });
    expect(summary.records.findings[0]).toMatchObject({ id: 'mem_finding', title: 'Parser finding', domainLabels: ['security'] });
    expect(summary.records.procedures[0]).toMatchObject({ id: 'mem_procedure', title: 'Inspect parser first.' });
    expect(summary.records.prospectiveChecks[0]).toMatchObject({ id: 'mem_prospective', title: 'Re-check parser proof.' });
    expect(summary.proof).toMatchObject({ obligationCount: 1, attemptCount: 1, resultCounts: { pass: 1 } });
    expect(summary.directories.find((directory) => directory.name === 'episodes')).toMatchObject({ exists: true, entryCount: 1 });
  });

  it('prefers Honeycrisp CLI agent-state output when available', () => {
    const workspace = tempWorkspace();
    const memoryRoot = join(workspace, '.honeycrisp', 'memory');
    mkdirSync(memoryRoot, { recursive: true });
    const fakeCli = join(workspace, 'fake-honeycrisp-cli.mjs');
    writeFileSync(
      fakeCli,
      `const command = process.argv.slice(2).join(' ');
if (!command.includes('memory agent-state')) process.exit(2);
console.log(JSON.stringify({
  memory: {
    evidence: [{ id: 'mem_cli_evidence', kind: 'evidence', status: 'confirmed', summary: 'CLI evidence' }],
    episodes: [],
    semanticClaims: [],
    hypotheses: [{ id: 'mem_cli_hypothesis', kind: 'hypothesis', status: 'active', summary: 'CLI hypothesis', hypothesis: 'CLI hypothesis' }],
    findings: [{ id: 'mem_cli_finding', kind: 'finding', status: 'supported', summary: 'CLI finding', finding: 'CLI finding' }],
    beliefs: [],
    procedures: [],
    prospectiveChecks: [],
    working: []
  },
  proof: {
    obligations: [{ id: 'proof_obl_cli', status: 'open', subject: { kind: 'memory_record', id: 'mem_cli_finding' }, question: 'CLI proof?' }],
    attempts: [{ id: 'proof_attempt_cli', obligationId: 'proof_obl_cli', status: 'completed', result: 'pass', method: { kind: 'empirical_reproduction', name: 'CLI fixture' }, summary: 'CLI proof passed' }]
  }
}));\n`,
      'utf8'
    );
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeCli]);

    const db = new DatabaseSync(join(memoryRoot, 'memory.sqlite'));
    db.exec(`
      CREATE TABLE memory_events (sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, timestamp TEXT NOT NULL, kind TEXT NOT NULL, goal_id TEXT, loop_id TEXT, sub_goal_id TEXT, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, artifact_refs_json TEXT NOT NULL DEFAULT '[]', schema_version INTEGER NOT NULL);
      CREATE TABLE memory_records (record_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, goal_id TEXT, sub_goal_id TEXT, confidence REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, valid_from TEXT, valid_until TEXT, source_event_ids_json TEXT NOT NULL, evidence_ref_ids_json TEXT NOT NULL, tags_json TEXT NOT NULL, entities_json TEXT NOT NULL, record_json TEXT NOT NULL);
      CREATE TABLE proof_obligations (obligation_id TEXT PRIMARY KEY, status TEXT NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, goal_id TEXT, sub_goal_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, obligation_json TEXT NOT NULL);
      CREATE TABLE proof_attempts (attempt_id TEXT PRIMARY KEY, obligation_id TEXT NOT NULL, status TEXT NOT NULL, result TEXT, verifier TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, attempt_json TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO memory_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(1, 'evt_one', '2026-06-25T10:00:00.000Z', 'goal.created', 'goal_one', null, null, '{}', 'hash-one', '[]', 1);
    db.prepare("INSERT INTO memory_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run('mem_sqlite', 'evidence', 'confirmed', 'SQLite evidence', null, null, 1, '2026-06-25T10:00:00.000Z', '2026-06-25T10:00:00.000Z', null, null, '[]', '[]', '[]', '[]', '{}');
    db.close();

    const summary = getHoneycrispMemorySummary(workspace);

    expect(summary.source).toBe('honeycrisp_cli');
    expect(summary.records.findings[0]).toMatchObject({ id: 'mem_cli_finding', title: 'CLI finding' });
    expect(summary.proof.resultCounts).toMatchObject({ pass: 1 });
  });
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-honeycrisp-memory-'));
  createdDirs.push(dir);
  return dir;
}
