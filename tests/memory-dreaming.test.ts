import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MEMORY_DREAMING_SCHEMA_SQL,
  getMemoryDreamingSummary,
  parseMemoryDreamingAttributesPatch,
  recordFailedMemoryDreaming,
  restoreMemoryDreamingChange,
  runMemoryDreaming,
  type MemoryDreamingPlan
} from '../src/main/memoryDreaming';

const createdDirs: string[] = [];
const workspaceId = 'workspace_security';

afterEach(() => {
  for (const directory of createdDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('memory Dreaming', () => {
  it('records a sanitized failed run when curation stops before applying a plan', () => {
    const databasePath = createMemoryDatabase();
    const run = recordFailedMemoryDreaming(databasePath, workspaceId, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      inputNodeCount: 47,
      inputSessionCount: 1
    }, new Error('Provider rejected Bearer test-secret-token-1234567890 and token=another-test-secret-1234567890.'));

    expect(run).toMatchObject({
      status: 'failed',
      inputNodeCount: 47,
      inputSessionCount: 1,
      editedNodeCount: 0
    });
    expect(run.errorMessage).toContain('...redacted');
    expect(run.errorMessage).not.toContain('test-secret-token');
    expect(run.errorMessage).not.toContain('another-test-secret');

    const database = new DatabaseSync(databasePath);
    expect(getMemoryDreamingSummary(database, workspaceId).lastRun).toEqual(run);
    expect(database.prepare('SELECT COUNT(*) AS count FROM memory_dreaming_changes').get()).toEqual({ count: 0 });
    database.close();
  });

  it('hides stale and exact duplicate workspace memories without deleting them, then restores each change', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    const insertNode = database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertNode.run('stale_node', 'subject_openai', 'OpenAI', 'hypothesis', 'Old lead', 'old lead', 'Old lead.', '', 'stale', 0.4, '{}', '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', 1);
    insertNode.run('duplicate_survivor', 'subject_openai', 'OpenAI', 'primitive', 'Parser mismatch', 'parser mismatch', 'Short summary.', 'Short body.', 'confirmed', 0.95, '{}', '2026-07-21T10:00:00.000Z', '2026-07-24T10:00:00.000Z', 3);
    insertNode.run('duplicate_hidden', 'subject_openai', 'OpenAI', 'primitive', 'Parser mismatch', 'parser mismatch', 'Short summary. With more detail.', 'Short body. With reproduction notes.', 'suspected', 0.7, '{}', '2026-07-22T10:00:00.000Z', '2026-07-23T10:00:00.000Z', 2);
    insertNode.run('unique_node', 'subject_openai', 'OpenAI', 'invariant', 'Unique boundary', 'unique boundary', 'Keep this.', '', 'confirmed', 0.9, '{}', '2026-07-24T10:00:00.000Z', '2026-07-24T10:00:00.000Z', 1);
    insertNode.run('other_workspace_duplicate', 'subject_openai', 'OpenAI', 'primitive', 'Parser mismatch', 'parser mismatch', 'Other workspace memory.', '', 'confirmed', 0.99, '{}', '2026-07-24T10:00:00.000Z', '2026-07-24T10:00:00.000Z', 1);
    const associateWorkspace = database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)');
    for (const nodeId of ['stale_node', 'duplicate_survivor', 'duplicate_hidden', 'unique_node']) associateWorkspace.run(nodeId, workspaceId, 'Security');
    associateWorkspace.run('other_workspace_duplicate', 'workspace_other', 'Other Workspace');
    database.prepare('INSERT INTO memory_node_assets VALUES (?, ?)').run('duplicate_hidden', 'asset_parser');
    database.prepare('INSERT INTO memory_node_tags VALUES (?, ?)').run('duplicate_survivor', 'confirmed');
    database.prepare('INSERT INTO memory_node_tags VALUES (?, ?)').run('duplicate_hidden', 'parser');
    database.prepare('INSERT INTO memory_evidence_refs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('evidence_survivor', 'duplicate_survivor', 'code', 'repository', 'src/parser.ts', '{"line":10}', 'Confirmed path', '2026-07-23T10:00:00.000Z');
    database.prepare('INSERT INTO memory_evidence_refs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('evidence_duplicate', 'duplicate_hidden', 'code', 'repository', 'src/parser.ts', '{"line":30}', 'Additional path', '2026-07-23T11:00:00.000Z');
    database.prepare('INSERT INTO memory_edges VALUES (?, ?, ?, ?, ?, ?)').run('duplicate_hidden', 'unique_node', 'supports', 'Original relationship', '2026-07-23T12:00:00.000Z', '2026-07-23T12:00:00.000Z');
    database.close();

    const run = runMemoryDreaming(databasePath, workspaceId, {
      prune: [{ nodeId: 'stale_node', reason: 'stale_node is superseded by later workspace knowledge.' }],
      merge: [{
        survivorNodeId: 'duplicate_survivor',
        duplicateNodeIds: ['duplicate_hidden'],
        summary: 'Short summary. With more detail.',
        body: 'Short body. With reproduction notes.',
        attributes: {
          rootCause: 'A signed length changes the parser allocation width.',
          rootCauseKey: 'signed-length-allocation-width'
        },
        reason: 'duplicate_survivor and duplicate_hidden describe the same parser primitive.'
      }],
      revise: [],
      reclassify: []
    }, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      inputNodeCount: 5,
      inputSessionCount: 2
    });
    expect(run).toMatchObject({
      status: 'completed',
      prunedNodeCount: 1,
      duplicateHiddenCount: 1,
      duplicateGroupCount: 1,
      editedNodeCount: 1
    });

    const dreamed = new DatabaseSync(databasePath);
    expect(dreamed.prepare('SELECT COUNT(*) AS count FROM memory_nodes').get()).toEqual({ count: 5 });
    expect(
      dreamed.prepare('SELECT node_id AS id FROM memory_node_workspaces WHERE workspace_id = ? ORDER BY node_id').all(workspaceId)
    ).toEqual([{ id: 'duplicate_survivor' }, { id: 'unique_node' }]);
    expect(
      dreamed.prepare('SELECT id FROM memory_nodes WHERE id IN (?, ?) AND NOT EXISTS (SELECT 1 FROM memory_node_workspaces w WHERE w.node_id = memory_nodes.id AND w.workspace_id = ?) ORDER BY id').all('duplicate_hidden', 'stale_node', workspaceId)
    ).toEqual([{ id: 'duplicate_hidden' }, { id: 'stale_node' }]);
    expect(dreamed.prepare('SELECT workspace_id FROM memory_node_workspaces WHERE node_id = ?').get('other_workspace_duplicate')).toEqual({
      workspace_id: 'workspace_other'
    });
    expect(dreamed.prepare('SELECT summary, body, attributes_json, revision FROM memory_nodes WHERE id = ?').get('duplicate_survivor')).toEqual({
      summary: 'Short summary. With more detail.',
      body: 'Short body. With reproduction notes.',
      attributes_json: JSON.stringify({
        rootCause: 'A signed length changes the parser allocation width.',
        rootCauseKey: 'signed-length-allocation-width'
      }),
      revision: 4
    });
    expect(dreamed.prepare('SELECT tag FROM memory_node_tags WHERE node_id = ? ORDER BY tag').all('duplicate_survivor')).toEqual([
      { tag: 'confirmed' },
      { tag: 'parser' }
    ]);
    expect(dreamed.prepare('SELECT COUNT(*) AS count FROM memory_evidence_refs WHERE node_id = ?').get('duplicate_survivor')).toEqual({
      count: 2
    });
    expect(dreamed.prepare('SELECT from_id, to_id FROM memory_edges ORDER BY from_id').all()).toEqual([
      { from_id: 'duplicate_hidden', to_id: 'unique_node' },
      { from_id: 'duplicate_survivor', to_id: 'unique_node' }
    ]);

    const summary = getMemoryDreamingSummary(dreamed, workspaceId);
    expect(summary).toMatchObject({
      available: true,
      scope: 'workspace',
      hiddenNodeCount: 2,
      restorableChangeCount: 2
    });
    const duplicateChange = summary.changes.find((change) => change.action === 'merge_duplicates');
    const staleChange = summary.changes.find((change) => change.action === 'prune');
    expect(duplicateChange).toMatchObject({
      survivorNodeId: 'duplicate_survivor',
      hiddenNodeIds: ['duplicate_hidden'],
      canRestore: true
    });
    expect(staleChange).toMatchObject({ hiddenNodeIds: ['stale_node'], canRestore: true });
    dreamed.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, duplicateChange!.id);
    const partlyRestored = new DatabaseSync(databasePath);
    expect(partlyRestored.prepare('SELECT summary, body, attributes_json, revision FROM memory_nodes WHERE id = ?').get('duplicate_survivor')).toEqual({
      summary: 'Short summary.',
      body: 'Short body.',
      attributes_json: '{}',
      revision: 3
    });
    expect(partlyRestored.prepare('SELECT w.workspace_id, n.revision FROM memory_nodes n JOIN memory_node_workspaces w ON w.node_id = n.id WHERE n.id = ?').get('duplicate_hidden')).toEqual({
      workspace_id: workspaceId,
      revision: 2
    });
    expect(partlyRestored.prepare('SELECT tag FROM memory_node_tags WHERE node_id = ?').all('duplicate_survivor')).toEqual([
      { tag: 'confirmed' }
    ]);
    expect(partlyRestored.prepare('SELECT COUNT(*) AS count FROM memory_evidence_refs WHERE node_id = ?').get('duplicate_survivor')).toEqual({
      count: 1
    });
    expect(partlyRestored.prepare('SELECT from_id, to_id FROM memory_edges ORDER BY from_id').all()).toEqual([
      { from_id: 'duplicate_hidden', to_id: 'unique_node' }
    ]);
    partlyRestored.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, staleChange!.id);
    const restored = new DatabaseSync(databasePath);
    expect(restored.prepare('SELECT COUNT(*) AS count FROM memory_node_workspaces WHERE workspace_id = ?').get(workspaceId)).toEqual({
      count: 4
    });
    expect(getMemoryDreamingSummary(restored, workspaceId)).toMatchObject({
      hiddenNodeCount: 0,
      restorableChangeCount: 0,
      lastRun: { status: 'restored' }
    });
    restored.close();
  });

  it('refuses to overwrite memory changed after Dreaming', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    const insertNode = database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertNode.run('duplicate_one', 'subject_security', 'Security', 'primitive', 'Same primitive', 'same primitive', 'First.', '', 'confirmed', 0.9, '{}', '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', 1);
    insertNode.run('duplicate_two', 'subject_security', 'Security', 'primitive', 'Same primitive', 'same primitive', 'Second.', '', 'suspected', 0.7, '{}', '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', 1);
    database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run('duplicate_one', workspaceId, 'Security');
    database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run('duplicate_two', workspaceId, 'Security');
    database.close();

    runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [{
        survivorNodeId: 'duplicate_one',
        duplicateNodeIds: ['duplicate_two'],
        summary: null,
        body: null,
        attributes: {
          rootCause: 'Both nodes capture the same primitive mechanism.',
          rootCauseKey: 'same-primitive-mechanism'
        },
        reason: 'duplicate_one and duplicate_two represent the same primitive.'
      }],
      revise: [],
      reclassify: []
    }, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      inputNodeCount: 2,
      inputSessionCount: 1
    });
    const changed = new DatabaseSync(databasePath);
    const summary = getMemoryDreamingSummary(changed, workspaceId);
    const change = summary.changes.find((candidate) => candidate.action === 'merge_duplicates')!;
    changed.prepare('UPDATE memory_nodes SET body = ?, revision = revision + 1 WHERE id = ?').run('New research.', change.survivorNodeId);
    expect(getMemoryDreamingSummary(changed, workspaceId).changes.find((candidate) => candidate.id === change.id)?.canRestore).toBe(false);
    changed.close();

    expect(() => restoreMemoryDreamingChange(databasePath, workspaceId, change.id)).toThrow(
      'This memory changed after Dreaming and cannot be restored automatically.'
    );
  });

  it('preserves and restores the original revision when the model revises a memory', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'boundary_note',
      'subject_security',
      'Security',
      'invariant',
      'Boundary reachability',
      'boundary reachability',
      'The boundary may be remotely reachable.',
      'Original analysis.',
      'suspected',
      0.6,
      '{}',
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z',
      4
    );
    database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run('boundary_note', workspaceId, 'Security');
    database.close();

    runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [],
      revise: [{
        nodeId: 'boundary_note',
        summary: 'The boundary is reachable only through the local fixture.',
        body: null,
        reason: 'session_fixture narrows boundary_note reachability.'
      }],
      reclassify: []
    }, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      inputNodeCount: 1,
      inputSessionCount: 1
    });
    const revised = new DatabaseSync(databasePath);
    const summary = getMemoryDreamingSummary(revised, workspaceId);
    expect(revised.prepare('SELECT summary, body, revision FROM memory_nodes WHERE id = ?').get('boundary_note')).toEqual({
      summary: 'The boundary is reachable only through the local fixture.',
      body: 'Original analysis.',
      revision: 5
    });
    expect(summary.lastRun).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      inputNodeCount: 1,
      inputSessionCount: 1,
      editedNodeCount: 1
    });
    const change = summary.changes.find((candidate) => candidate.action === 'revise')!;
    revised.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, change.id);
    const restored = new DatabaseSync(databasePath);
    expect(restored.prepare('SELECT summary, body, revision FROM memory_nodes WHERE id = ?').get('boundary_note')).toEqual({
      summary: 'The boundary may be remotely reachable.',
      body: 'Original analysis.',
      revision: 4
    });
    restored.close();
  });

  it('backfills structural attributes on an existing primitive and restores its original attributes', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'legacy_primitive',
      'subject_security',
      'Security',
      'primitive',
      'Legacy parser mismatch',
      'legacy parser mismatch',
      'The parser accepts a length wider than its allocation arithmetic.',
      'Observed in the parser boundary.',
      'suspected',
      0.8,
      JSON.stringify({ legacyDetail: 'preserved' }),
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z',
      2
    );
    database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run('legacy_primitive', workspaceId, 'Security');
    database.close();

    runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [],
      revise: [{
        nodeId: 'legacy_primitive',
        summary: null,
        body: null,
        attributes: {
          rootCause: 'Allocation arithmetic truncates the accepted parser length.',
          rootCauseKey: 'parser-length-allocation-truncation'
        },
        reason: 'legacy_primitive already records this root cause but lacks its structural metadata.'
      }],
      reclassify: []
    }, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      inputNodeCount: 1,
      inputSessionCount: 1
    });

    const revised = new DatabaseSync(databasePath);
    expect(revised.prepare('SELECT attributes_json, revision FROM memory_nodes WHERE id = ?').get('legacy_primitive')).toEqual({
      attributes_json: JSON.stringify({
        legacyDetail: 'preserved',
        rootCause: 'Allocation arithmetic truncates the accepted parser length.',
        rootCauseKey: 'parser-length-allocation-truncation'
      }),
      revision: 3
    });
    const change = getMemoryDreamingSummary(revised, workspaceId).changes.find((candidate) => candidate.action === 'revise')!;
    revised.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, change.id);
    const restored = new DatabaseSync(databasePath);
    expect(restored.prepare('SELECT attributes_json, revision FROM memory_nodes WHERE id = ?').get('legacy_primitive')).toEqual({
      attributes_json: JSON.stringify({ legacyDetail: 'preserved' }),
      revision: 2
    });
    restored.close();
  });

  it('reclassifies an invalid memory type and restores the original classification', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'quarantine_behavior',
      'subject_security',
      'Security',
      'invariant',
      'Mounted images synthesize quarantine state',
      'mounted images synthesize quarantine state',
      'The platform derives effective quarantine state from the mounted image.',
      'This is observed platform behavior, not an individual flaw.',
      'confirmed',
      0.9,
      JSON.stringify({ legacyDetail: 'preserved' }),
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z',
      3
    );
    database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'source_neighbor',
      'subject_security',
      'Security',
      'source',
      'Mounted payload',
      'mounted payload',
      'The mounted payload supplies the observed state.',
      '',
      'confirmed',
      0.9,
      '{}',
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z',
      1
    );
    database.prepare('INSERT INTO memory_node_sessions VALUES (?, ?)').run('quarantine_behavior', 'session_quarantine');
    database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run('quarantine_behavior', workspaceId, 'Security');
    database.prepare('INSERT INTO memory_node_assets VALUES (?, ?)').run('quarantine_behavior', 'asset_payload');
    database.prepare('INSERT INTO memory_node_tags VALUES (?, ?)').run('quarantine_behavior', 'quarantine');
    database.prepare('INSERT INTO memory_evidence_refs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'evidence_quarantine',
      'quarantine_behavior',
      'artifact',
      'artifact',
      'quarantine.txt',
      '{}',
      'Observed quarantine state.',
      '2026-07-20T10:00:00.000Z'
    );
    database.prepare('INSERT INTO memory_edges VALUES (?, ?, ?, ?, ?, ?)').run(
      'source_neighbor',
      'quarantine_behavior',
      'supports',
      'Source relationship.',
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z'
    );
    database.prepare('INSERT INTO memory_edges VALUES (?, ?, ?, ?, ?, ?)').run(
      'quarantine_behavior',
      'source_neighbor',
      'derived_from',
      'Reverse relationship.',
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z'
    );
    database.prepare('INSERT INTO verifier_contracts VALUES (?, ?)').run('contract_quarantine', 'quarantine_behavior');
    database.prepare('INSERT INTO exports VALUES (?, ?)').run('export_quarantine', 'quarantine_behavior');
    database.close();

    const reclassifiedNodeId = `primitive_${createHash('sha256')
      .update('subject_security:primitive:mounted images synthesize quarantine state')
      .digest('hex')
      .slice(0, 20)}`;

    const run = runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [],
      revise: [],
      reclassify: [{
        nodeId: 'quarantine_behavior',
        type: 'primitive',
        attributes: {
          rootCause: 'Mount-derived quarantine state is lost when the executable leaves the image.',
          rootCauseKey: 'mount-derived-quarantine-copy-loss'
        },
        reason: 'quarantine_behavior records an evidence-supported provenance-loss primitive.'
      }]
    }, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      inputNodeCount: 1,
      inputSessionCount: 1
    });
    expect(run).toMatchObject({ reclassifiedNodeCount: 1, editedNodeCount: 1 });

    const reclassified = new DatabaseSync(databasePath);
    expect(reclassified.prepare('SELECT id, type, attributes_json, revision FROM memory_nodes WHERE id = ?').get(reclassifiedNodeId)).toEqual({
      id: reclassifiedNodeId,
      type: 'primitive',
      attributes_json: JSON.stringify({
        legacyDetail: 'preserved',
        rootCause: 'Mount-derived quarantine state is lost when the executable leaves the image.',
        rootCauseKey: 'mount-derived-quarantine-copy-loss'
      }),
      revision: 4
    });
    expect(reclassified.prepare('SELECT 1 FROM memory_nodes WHERE id = ?').get('quarantine_behavior')).toBeUndefined();
    expect(reclassified.prepare('SELECT node_id FROM memory_node_sessions').all()).toEqual([{ node_id: reclassifiedNodeId }]);
    expect(reclassified.prepare('SELECT node_id FROM memory_node_workspaces').all()).toEqual([{ node_id: reclassifiedNodeId }]);
    expect(reclassified.prepare('SELECT node_id FROM memory_node_assets').all()).toEqual([{ node_id: reclassifiedNodeId }]);
    expect(reclassified.prepare('SELECT node_id FROM memory_node_tags').all()).toEqual([{ node_id: reclassifiedNodeId }]);
    expect(reclassified.prepare('SELECT node_id FROM memory_evidence_refs').all()).toEqual([{ node_id: reclassifiedNodeId }]);
    expect(reclassified.prepare('SELECT from_id, to_id FROM memory_edges ORDER BY relation').all()).toEqual([
      { from_id: reclassifiedNodeId, to_id: 'source_neighbor' },
      { from_id: 'source_neighbor', to_id: reclassifiedNodeId }
    ]);
    expect(reclassified.prepare('SELECT memory_node_id FROM verifier_contracts').get()).toEqual({ memory_node_id: reclassifiedNodeId });
    expect(reclassified.prepare('SELECT memory_node_id FROM exports').get()).toEqual({ memory_node_id: reclassifiedNodeId });
    const change = getMemoryDreamingSummary(reclassified, workspaceId).changes.find((candidate) => candidate.action === 'reclassify')!;
    expect(change).toMatchObject({ nodeType: 'primitive', survivorNodeId: reclassifiedNodeId, canRestore: true });
    reclassified.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, change.id);
    const restored = new DatabaseSync(databasePath);
    expect(restored.prepare('SELECT id, type, attributes_json, revision FROM memory_nodes WHERE id = ?').get('quarantine_behavior')).toEqual({
      id: 'quarantine_behavior',
      type: 'invariant',
      attributes_json: JSON.stringify({ legacyDetail: 'preserved' }),
      revision: 3
    });
    expect(restored.prepare('SELECT 1 FROM memory_nodes WHERE id = ?').get(reclassifiedNodeId)).toBeUndefined();
    expect(restored.prepare('SELECT node_id FROM memory_node_sessions').all()).toEqual([{ node_id: 'quarantine_behavior' }]);
    expect(restored.prepare('SELECT node_id FROM memory_node_workspaces').all()).toEqual([{ node_id: 'quarantine_behavior' }]);
    expect(restored.prepare('SELECT node_id FROM memory_node_assets').all()).toEqual([{ node_id: 'quarantine_behavior' }]);
    expect(restored.prepare('SELECT node_id FROM memory_node_tags').all()).toEqual([{ node_id: 'quarantine_behavior' }]);
    expect(restored.prepare('SELECT node_id FROM memory_evidence_refs').all()).toEqual([{ node_id: 'quarantine_behavior' }]);
    expect(restored.prepare('SELECT from_id, to_id FROM memory_edges ORDER BY relation').all()).toEqual([
      { from_id: 'quarantine_behavior', to_id: 'source_neighbor' },
      { from_id: 'source_neighbor', to_id: 'quarantine_behavior' }
    ]);
    expect(restored.prepare('SELECT memory_node_id FROM verifier_contracts').get()).toEqual({ memory_node_id: 'quarantine_behavior' });
    expect(restored.prepare('SELECT memory_node_id FROM exports').get()).toEqual({ memory_node_id: 'quarantine_behavior' });
    restored.close();
  });

  it('rejects reclassifications that would violate target memory invariants', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    const insertNode = database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertCandidate = (id: string, status: string, attributes: Record<string, unknown>): void => {
      insertNode.run(
        id,
        'subject_security',
        'Security',
        'invariant',
        id,
        id,
        'Candidate for reclassification.',
        '',
        status,
        0.8,
        JSON.stringify(attributes),
        '2026-07-20T10:00:00.000Z',
        '2026-07-20T10:00:00.000Z',
        1
      );
      database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run(id, workspaceId, 'Security');
    };
    insertCandidate('confirmed_hypothesis', 'confirmed', {});
    insertCandidate('primitive_without_root', 'suspected', {});
    insertCandidate('primitive_bad_key', 'suspected', { rootCause: 'Width mismatch.', rootCauseKey: 'Width Mismatch' });
    insertCandidate('bug_without_precedent', 'confirmed', {});
    insertCandidate('bug_without_evidence', 'confirmed', { historicalPrecedent: true });
    insertCandidate('chain_without_attributes', 'suspected', {});
    insertCandidate('chain_without_evidence', 'confirmed', { impact: 'Code execution.', reachability: 'Remote input.' });
    insertCandidate('chain_without_neighbors', 'confirmed', { impact: 'Code execution.', reachability: 'Remote input.' });
    database.prepare('INSERT INTO memory_node_assets VALUES (?, ?)').run('bug_without_evidence', 'asset_bug');
    database.prepare('INSERT INTO memory_evidence_refs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'chain_evidence',
      'chain_without_neighbors',
      'artifact',
      'artifact',
      'proof.txt',
      '{}',
      'Confirmed proof.',
      '2026-07-20T10:00:00.000Z'
    );
    database.close();

    const reclassify = (nodeId: string, type: 'hypothesis' | 'primitive' | 'bug' | 'chain'): MemoryDreamingPlan => ({
      prune: [],
      merge: [],
      revise: [],
      reclassify: [{ nodeId, type, reason: `Reclassify ${nodeId}.` }]
    });
    const context = {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      inputNodeCount: 8,
      inputSessionCount: 1
    };

    expect(() => runMemoryDreaming(databasePath, workspaceId, reclassify('confirmed_hypothesis', 'hypothesis'), context))
      .toThrow('cannot reclassify confirmed memory confirmed_hypothesis as a hypothesis');
    expect(() => runMemoryDreaming(databasePath, workspaceId, reclassify('primitive_without_root', 'primitive'), context))
      .toThrow('requires attributes.rootCause');
    expect(() => runMemoryDreaming(databasePath, workspaceId, reclassify('primitive_bad_key', 'primitive'), context))
      .toThrow('lowercase hyphenated attributes.rootCauseKey');
    expect(() => runMemoryDreaming(databasePath, workspaceId, reclassify('bug_without_precedent', 'bug'), context))
      .toThrow('requires confirmed historical precedent');
    expect(() => runMemoryDreaming(databasePath, workspaceId, reclassify('bug_without_evidence', 'bug'), context))
      .toThrow('requires an affected asset and precedent evidence');
    expect(() => runMemoryDreaming(databasePath, workspaceId, reclassify('chain_without_attributes', 'chain'), context))
      .toThrow('requires impact and reachability attributes');
    expect(() => runMemoryDreaming(databasePath, workspaceId, reclassify('chain_without_evidence', 'chain'), context))
      .toThrow('requires evidence');
    expect(() => runMemoryDreaming(databasePath, workspaceId, reclassify('chain_without_neighbors', 'chain'), context))
      .toThrow('requires graph relationships to: source, primitive, sink, asset');

    const verified = new DatabaseSync(databasePath);
    expect(verified.prepare('SELECT COUNT(*) AS count FROM memory_dreaming_runs').get()).toEqual({ count: 0 });
    verified.close();
  });

  it('strictly rejects unsupported or malformed structural attribute patches', () => {
    expect(() => parseMemoryDreamingAttributesPatch({ inventedField: 'value' }, 'node_one'))
      .toThrow('unsupported fields: inventedField');
    expect(() => parseMemoryDreamingAttributesPatch({ rootCause: 42 }, 'node_one'))
      .toThrow('attributes.rootCause for node_one must be a non-empty string');
    expect(() => parseMemoryDreamingAttributesPatch({ historicalPrecedent: 'yes' }, 'node_one'))
      .toThrow('attributes.historicalPrecedent for node_one must be a boolean');
    expect(() => parseMemoryDreamingAttributesPatch({ rootCause: 'x'.repeat(4_001) }, 'node_one'))
      .toThrow('attributes.rootCause for node_one exceeds its size limit');
  });
});

function createMemoryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), 'beale-memory-dreaming-'));
  createdDirs.push(directory);
  const databasePath = join(directory, 'memory.sqlite');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE memory_nodes (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_name TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, title_norm TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL, attributes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE memory_node_sessions (node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE, session_id TEXT NOT NULL, PRIMARY KEY(node_id, session_id));
    CREATE TABLE memory_node_workspaces (node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, PRIMARY KEY(node_id, workspace_id));
    CREATE TABLE memory_node_assets (node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE, asset_id TEXT NOT NULL, PRIMARY KEY(node_id, asset_id));
    CREATE TABLE memory_node_tags (node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(node_id, tag));
    CREATE TABLE memory_edges (from_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE, to_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE, relation TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(from_id, to_id, relation));
    CREATE TABLE memory_evidence_refs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE, kind TEXT NOT NULL, path_base TEXT, path TEXT, locator_json TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE verifier_contracts (id TEXT PRIMARY KEY, memory_node_id TEXT);
    CREATE TABLE exports (id TEXT PRIMARY KEY, memory_node_id TEXT);
    ${MEMORY_DREAMING_SCHEMA_SQL}
  `);
  database.close();
  return databasePath;
}
