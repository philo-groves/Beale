import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MEMORY_DREAMING_SCHEMA_SQL,
  buildMemoryDreamingInstructions,
  getMemoryDreamingModelJobDefaults,
  getMemoryDreamingTypeDescriptions,
  getMemoryDreamingSummary,
  parseMemoryDreamingAttributesPatch,
  recordFailedMemoryDreaming,
  restoreMemoryDreamingChange,
  runMemoryDreaming,
  type MemoryDreamingPlan
} from '../src/main/memoryDreaming';
import type { ResearchProfile, ResearchProfileSnapshot } from '../src/shared/researchProfile';
import { resolvedTestResearchProfile, testResearchProfile } from './researchProfileFixture';

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
    expect(
      database
        .prepare(
          `SELECT research_profile_hash, research_profile_id, research_profile_version, memory_catalog_hash
           FROM memory_dreaming_runs WHERE id = ?`
        )
        .get(run.id)
    ).toEqual({
      research_profile_hash: null,
      research_profile_id: null,
      research_profile_version: null,
      memory_catalog_hash: null
    });
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

  it('uses a resolved custom profile for type aliases, statuses, attributes, requirements, prompts, and model defaults', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    const insertNode = database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertNode.run(
      'legacy_observation',
      'subject_general',
      'General subject',
      'legacy-note',
      'Measured latency shift',
      'measured latency shift',
      'The experiment measured a repeatable latency shift.',
      '',
      'accepted',
      0.9,
      '{}',
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z',
      1
    );
    insertNode.run(
      'source_note',
      'subject_general',
      'General subject',
      'source-note',
      'Benchmark source',
      'benchmark source',
      'The source benchmark records the input measurements.',
      '',
      'accepted',
      0.9,
      '{}',
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z',
      1
    );
    database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run('legacy_observation', workspaceId, 'General');
    database.prepare('INSERT INTO memory_node_assets VALUES (?, ?)').run('legacy_observation', 'asset_benchmark');
    database.prepare('INSERT INTO memory_evidence_refs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'evidence_benchmark',
      'legacy_observation',
      'measurement',
      'workspace',
      'results/benchmark.json',
      '{}',
      'Repeated measurements.',
      '2026-07-20T10:00:00.000Z'
    );
    database.prepare('INSERT INTO memory_edges VALUES (?, ?, ?, ?, ?, ?)').run(
      'source_note',
      'legacy_observation',
      'supports',
      'The benchmark supports the observation.',
      '2026-07-20T10:00:00.000Z',
      '2026-07-20T10:00:00.000Z'
    );
    database.close();

    const profile = customCurationProfile();
    const profileInput = { resolvedProfile: resolvedTestResearchProfile(profile, 'explicit') } as const;
    const context = {
      model: 'host-selected-model',
      reasoningEffort: 'host-selected-effort',
      inputNodeCount: 1,
      inputSessionCount: 1
    };
    const plan = (attributes?: Record<string, string | number | boolean>): MemoryDreamingPlan => ({
      prune: [],
      merge: [],
      revise: [],
      reclassify: [{
        nodeId: 'legacy_observation',
        type: 'observation-alias',
        ...(attributes ? { attributes } : {}),
        reason: 'legacy_observation is a measured observation supported by source_note.'
      }]
    });

    expect(() => runMemoryDreaming(databasePath, workspaceId, plan(), context, profileInput))
      .toThrow('requires non-empty attributes: rating, disposition');
    expect(() => runMemoryDreaming(
      databasePath,
      workspaceId,
      plan({ rating: 5, disposition: 'unsupported' }),
      context,
      profileInput
    )).toThrow('attribute disposition for legacy_observation has an unsupported value');

    const run = runMemoryDreaming(
      databasePath,
      workspaceId,
      plan({ rating: 5, disposition: 'retain' }),
      context,
      profileInput
    );
    expect(run.reclassifiedNodeCount).toBe(1);
    const nextId = `observation_${createHash('sha256')
      .update('subject_general:observation:measured latency shift')
      .digest('hex')
      .slice(0, 20)}`;
    const reclassified = new DatabaseSync(databasePath);
    expect(reclassified.prepare('SELECT id, type, status, attributes_json FROM memory_nodes WHERE id = ?').get(nextId)).toEqual({
      id: nextId,
      type: 'observation',
      status: 'accepted',
      attributes_json: JSON.stringify({ rating: 5, disposition: 'retain' })
    });
    reclassified.close();

    expect(parseMemoryDreamingAttributesPatch({ rating: 4, reviewed: true }, 'node', profileInput)).toEqual({
      rating: 4,
      reviewed: true
    });
    expect(getMemoryDreamingModelJobDefaults(profileInput)).toEqual({
      provider: 'openai',
      model: 'curation-default',
      effort: 'medium'
    });
    expect(getMemoryDreamingTypeDescriptions({}, profileInput)).toMatchObject({
      observation: expect.stringContaining('Measured Observation'),
      'retired-note': expect.stringContaining('Retired Note')
    });
    const instructions = buildMemoryDreamingInstructions({}, profileInput);
    expect(instructions).toContain('General Research');
    expect(instructions).toContain('observation-alias');
    expect(instructions).toContain(profileInput.resolvedProfile.hash);
    expect(instructions).not.toContain('authorized vulnerability research');
    expect(instructions).not.toContain('Every primitive');
  });

  it('grandfathers unknown and retired stored rows for unrelated corrections but rejects new catalog identities', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    const insertNode = database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [id, type] of [['unknown_row', 'removed-experimental-type'], ['retired_row', 'retired-note']] as const) {
      insertNode.run(
        id,
        'subject_general',
        'General subject',
        type,
        id,
        id,
        'Original summary.',
        'Original body.',
        'legacy-status',
        0.5,
        '{}',
        '2026-07-20T10:00:00.000Z',
        '2026-07-20T10:00:00.000Z',
        1
      );
      database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run(id, workspaceId, 'General');
    }
    database.close();

    const profile = customCurationProfile();
    const resolvedProfile = resolvedTestResearchProfile(profile, 'explicit');
    const profileInput = { resolvedProfile } as const;
    const context = { model: 'host', reasoningEffort: 'high', inputNodeCount: 2, inputSessionCount: 0 };
    const emptyPlan = (): MemoryDreamingPlan => ({ prune: [], merge: [], revise: [], reclassify: [] });

    const structuralUnknown = emptyPlan();
    structuralUnknown.revise.push({
      nodeId: 'unknown_row',
      summary: null,
      body: null,
      attributes: { reviewed: true },
      reason: 'unknown_row was reviewed.'
    });
    expect(() => runMemoryDreaming(databasePath, workspaceId, structuralUnknown, context, profileInput))
      .toThrow('cannot revise structural attributes for unknown memory type removed-experimental-type');

    const retiredTarget = emptyPlan();
    retiredTarget.reclassify.push({
      nodeId: 'unknown_row',
      type: 'retired-alias',
      reason: 'Attempt to use retired identity.'
    });
    expect(() => runMemoryDreaming(databasePath, workspaceId, retiredTarget, context, profileInput))
      .toThrow('proposed retired memory type for unknown_row: retired-note');

    const incompatibleStatus = emptyPlan();
    incompatibleStatus.reclassify.push({
      nodeId: 'unknown_row',
      type: 'observation',
      attributes: { rating: 2, disposition: 'retain' },
      reason: 'Attempt to use an unsupported legacy status.'
    });
    expect(() => runMemoryDreaming(databasePath, workspaceId, incompatibleStatus, context, profileInput))
      .toThrow('does not allow status legacy-status');

    expect(() => runMemoryDreaming(
      databasePath,
      workspaceId,
      emptyPlan(),
      context,
      { resolvedProfile: { ...resolvedProfile, hash: '0'.repeat(64) } }
    )).toThrow('profile hash does not match its profile payload');

    const correction = emptyPlan();
    correction.revise.push(
      {
        nodeId: 'unknown_row',
        summary: 'Corrected unknown-row summary.',
        body: null,
        reason: 'unknown_row summary was clarified without changing catalog fields.'
      },
      {
        nodeId: 'retired_row',
        summary: null,
        body: 'Corrected retired-row body.',
        reason: 'retired_row body was clarified without changing catalog fields.'
      }
    );
    expect(runMemoryDreaming(databasePath, workspaceId, correction, context, profileInput)).toMatchObject({
      status: 'completed',
      editedNodeCount: 2
    });
    const corrected = new DatabaseSync(databasePath);
    expect(corrected.prepare('SELECT type, status, summary FROM memory_nodes WHERE id = ?').get('unknown_row')).toEqual({
      type: 'removed-experimental-type',
      status: 'legacy-status',
      summary: 'Corrected unknown-row summary.'
    });
    expect(corrected.prepare('SELECT type, status, body FROM memory_nodes WHERE id = ?').get('retired_row')).toEqual({
      type: 'retired-note',
      status: 'legacy-status',
      body: 'Corrected retired-row body.'
    });
    corrected.close();
  });

  it('curates compatible prior-catalog memory while preserving exact provenance until structural adoption', () => {
    const sourceProfile = customCurationProfile();
    const activeProfile = compatiblePresentationProfile(sourceProfile);
    const sourceProfileInput = pinnedProfileInput(sourceProfile);
    const activeProfileInput = pinnedProfileInput(activeProfile);
    const sourceCatalog = testMemoryCatalog(sourceProfile);
    const activeCatalog = testMemoryCatalog(activeProfile);
    const nodeId = testPrimaryNodeId('subject_general', 'observation', 'compatible observation');
    const databasePath = createProvenanceMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    database
      .prepare('INSERT INTO memory_catalog_snapshots VALUES (?, 1, ?, ?)')
      .run(sourceCatalog.hash, sourceCatalog.json, '2026-07-20T10:00:00.000Z');
    insertTestMemoryNode(database, {
      id: nodeId,
      type: 'observation',
      title: 'Compatible observation',
      status: 'queued',
      attributes: {},
      catalogHash: sourceCatalog.hash
    });
    database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run(nodeId, workspaceId, 'General');
    insertTestCatalogValidation(database, nodeId, sourceCatalog.hash, sourceProfileInput.profileSnapshot);
    database.close();

    const proseRun = runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [],
      revise: [{
        nodeId,
        summary: 'Clarified under the renamed presentation catalog.',
        body: null,
        reason: 'compatible observation receives a prose-only clarification.'
      }],
      reclassify: []
    }, dreamingContext(1), activeProfileInput);

    let verified = new DatabaseSync(databasePath);
    expect(
      verified
        .prepare(
          `SELECT research_profile_hash, research_profile_id, research_profile_version, memory_catalog_hash
           FROM memory_dreaming_runs WHERE id = ?`
        )
        .get(proseRun.id)
    ).toEqual({
      research_profile_hash: activeProfileInput.profileSnapshot.profileHash,
      research_profile_id: activeProfile.id,
      research_profile_version: activeProfile.version,
      memory_catalog_hash: activeCatalog.hash
    });
    expect(verified.prepare('SELECT catalog_hash, revision FROM memory_nodes WHERE id = ?').get(nodeId)).toEqual({
      catalog_hash: sourceCatalog.hash,
      revision: 2
    });
    expect(
      verified.prepare(
        `SELECT node_revision, catalog_hash, validation_kind, research_profile_hash
         FROM memory_node_catalog_validations WHERE node_id = ? ORDER BY node_revision`
      ).all(nodeId)
    ).toEqual([
      {
        node_revision: 1,
        catalog_hash: sourceCatalog.hash,
        validation_kind: 'full',
        research_profile_hash: sourceProfileInput.profileSnapshot.profileHash
      },
      {
        node_revision: 2,
        catalog_hash: sourceCatalog.hash,
        validation_kind: 'inherited',
        research_profile_hash: activeProfileInput.profileSnapshot.profileHash
      }
    ]);
    const proseChange = getMemoryDreamingSummary(verified, workspaceId).changes
      .find((change) => change.reason.includes('prose-only'))!;
    verified.close();

    runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [],
      revise: [{
        nodeId,
        summary: null,
        body: null,
        attributes: { rating: 4 },
        reason: 'compatible observation adopts the active catalog through structural metadata.'
      }],
      reclassify: []
    }, dreamingContext(1), activeProfileInput);

    verified = new DatabaseSync(databasePath);
    expect(verified.prepare('SELECT revision, catalog_hash, attributes_json FROM memory_nodes WHERE id = ?').get(nodeId)).toEqual({
      revision: 3,
      catalog_hash: activeCatalog.hash,
      attributes_json: JSON.stringify({ rating: 4 })
    });
    expect(
      verified.prepare(
        `SELECT catalog_hash, validation_kind, research_profile_hash
         FROM memory_node_catalog_validations WHERE node_id = ? AND node_revision = 3`
      ).get(nodeId)
    ).toEqual({
      catalog_hash: activeCatalog.hash,
      validation_kind: 'scoped',
      research_profile_hash: activeProfileInput.profileSnapshot.profileHash
    });
    const structuralChange = getMemoryDreamingSummary(verified, workspaceId).changes
      .find((change) => change.reason.includes('structural metadata'))!;
    verified.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, structuralChange.id);
    verified = new DatabaseSync(databasePath);
    expect(verified.prepare('SELECT revision, catalog_hash FROM memory_nodes WHERE id = ?').get(nodeId)).toEqual({
      revision: 2,
      catalog_hash: sourceCatalog.hash
    });
    expect(
      verified.prepare(
        `SELECT node_revision, catalog_hash, validation_kind
         FROM memory_node_catalog_validations WHERE node_id = ? ORDER BY node_revision`
      ).all(nodeId)
    ).toEqual([
      { node_revision: 1, catalog_hash: sourceCatalog.hash, validation_kind: 'full' },
      { node_revision: 2, catalog_hash: sourceCatalog.hash, validation_kind: 'inherited' }
    ]);
    verified.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, proseChange.id);
    verified = new DatabaseSync(databasePath);
    expect(verified.prepare('SELECT revision, catalog_hash, attributes_json FROM memory_nodes WHERE id = ?').get(nodeId)).toEqual({
      revision: 1,
      catalog_hash: sourceCatalog.hash,
      attributes_json: '{}'
    });
    expect(
      verified.prepare(
        `SELECT node_revision, catalog_hash, validation_kind
         FROM memory_node_catalog_validations WHERE node_id = ?`
      ).all(nodeId)
    ).toEqual([{ node_revision: 1, catalog_hash: sourceCatalog.hash, validation_kind: 'full' }]);
    verified.close();
  });

  it('isolates catalog-less legacy rows from non-default profile lineages', () => {
    const profile = customCurationProfile();
    const profileInput = pinnedProfileInput(profile);
    const databasePath = createProvenanceMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    insertTestMemoryNode(database, {
      id: 'legacy_general_observation',
      type: 'observation',
      title: 'Legacy general observation',
      status: 'queued',
      attributes: {}
    });
    database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)')
      .run('legacy_general_observation', workspaceId, 'General');
    database.close();

    expect(() => runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [],
      revise: [{
        nodeId: 'legacy_general_observation',
        summary: 'This row must not enter a custom catalog implicitly.',
        body: null,
        reason: 'Attempted custom-profile correction.'
      }],
      reclassify: []
    }, dreamingContext(1), profileInput)).toThrow(
      'Dreaming proposed an unknown or non-workspace memory node: legacy_general_observation'
    );

    expect(runMemoryDreaming(
      databasePath,
      workspaceId,
      { prune: [], merge: [], revise: [], reclassify: [] },
      dreamingContext(0),
      profileInput
    )).toMatchObject({ status: 'completed', editedNodeCount: 0 });

    const verified = new DatabaseSync(databasePath);
    expect(verified.prepare('SELECT revision, catalog_hash FROM memory_nodes WHERE id = ?').get('legacy_general_observation'))
      .toEqual({ revision: 1, catalog_hash: null });
    verified.close();
  });

  it('rejects in-place foreign-catalog edits but permits pruning and explicit validated adoption', () => {
    const profile = customCurationProfile();
    const profileInput = pinnedProfileInput(profile);
    const activeCatalog = testMemoryCatalog(profile);
    const foreignJson = stableTestJson({ foreign: 'catalog' });
    const foreignHash = createHash('sha256')
      .update('honeycrisp:memory-catalog:v1\0')
      .update(foreignJson)
      .digest('hex');
    const databasePath = createProvenanceMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    database
      .prepare('INSERT INTO memory_catalog_snapshots VALUES (?, 1, ?, ?)')
      .run(activeCatalog.hash, activeCatalog.json, '2026-07-20T10:00:00.000Z');
    database
      .prepare('INSERT INTO memory_catalog_snapshots VALUES (?, 1, ?, ?)')
      .run(foreignHash, foreignJson, '2026-07-20T10:00:00.000Z');
    insertTestMemoryNode(database, {
      id: 'foreign_observation',
      type: 'observation',
      title: 'Foreign observation',
      status: 'queued',
      attributes: {},
      catalogHash: foreignHash
    });
    insertTestMemoryNode(database, {
      id: 'foreign_prune',
      type: 'observation',
      title: 'Foreign prune candidate',
      status: 'queued',
      attributes: {},
      catalogHash: foreignHash
    });
    insertTestMemoryNode(database, {
      id: 'active_peer',
      type: 'observation',
      title: 'Active peer',
      status: 'queued',
      attributes: {},
      catalogHash: activeCatalog.hash
    });
    for (const id of ['foreign_observation', 'foreign_prune', 'active_peer']) {
      database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run(id, workspaceId, 'General');
    }
    database.close();

    expect(() => runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [],
      revise: [{
        nodeId: 'foreign_observation',
        summary: 'Attempted in-place edit.',
        body: null,
        reason: 'foreign_observation should not be revised in place.'
      }],
      reclassify: []
    }, dreamingContext(1), profileInput)).toThrow('cannot revise foreign-catalog memory foreign_observation');

    expect(() => runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [{
        survivorNodeId: 'active_peer',
        duplicateNodeIds: ['foreign_observation'],
        summary: null,
        body: null,
        reason: 'The foreign row must not merge silently.'
      }],
      revise: [],
      reclassify: []
    }, dreamingContext(2), profileInput)).toThrow('cannot merge foreign-catalog memory foreign_observation');

    runMemoryDreaming(databasePath, workspaceId, {
      prune: [{ nodeId: 'foreign_prune', reason: 'foreign_prune is no longer useful.' }],
      merge: [],
      revise: [],
      reclassify: [{
        nodeId: 'foreign_observation',
        type: 'observation',
        reason: 'foreign_observation is explicitly adopted into the pinned catalog.'
      }]
    }, dreamingContext(2), profileInput);

    const adoptedId = testPrimaryNodeId('subject_general', 'observation', 'foreign observation');
    let verified = new DatabaseSync(databasePath);
    expect(verified.prepare('SELECT id, catalog_hash, revision FROM memory_nodes WHERE id = ?').get(adoptedId)).toEqual({
      id: adoptedId,
      catalog_hash: activeCatalog.hash,
      revision: 2
    });
    expect(
      verified.prepare(
        `SELECT validation_kind, research_profile_hash, research_profile_id, research_profile_version
         FROM memory_node_catalog_validations WHERE node_id = ? AND node_revision = 2`
      ).get(adoptedId)
    ).toEqual({
      validation_kind: 'full',
      research_profile_hash: profileInput.profileSnapshot.profileHash,
      research_profile_id: profile.id,
      research_profile_version: profile.version
    });
    expect(verified.prepare('SELECT catalog_hash, revision FROM memory_nodes WHERE id = ?').get('foreign_prune')).toEqual({
      catalog_hash: foreignHash,
      revision: 2
    });
    expect(verified.prepare('SELECT COUNT(*) AS count FROM memory_node_catalog_validations WHERE node_id = ?').get('foreign_prune'))
      .toEqual({ count: 0 });
    const adoptionChange = getMemoryDreamingSummary(verified, workspaceId).changes
      .find((change) => change.action === 'reclassify')!;
    verified.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, adoptionChange.id);
    verified = new DatabaseSync(databasePath);
    expect(verified.prepare('SELECT id, catalog_hash, revision FROM memory_nodes WHERE id = ?').get('foreign_observation')).toEqual({
      id: 'foreign_observation',
      catalog_hash: foreignHash,
      revision: 1
    });
    expect(verified.prepare('SELECT 1 FROM memory_nodes WHERE id = ?').get(adoptedId)).toBeUndefined();
    expect(verified.prepare('SELECT COUNT(*) AS count FROM memory_node_catalog_validations WHERE node_id IN (?, ?)').get('foreign_observation', adoptedId))
      .toEqual({ count: 0 });
    verified.close();
  });

  it('fully validates active-catalog merges and restores both nodes with their prior validations', () => {
    const profile = customCurationProfile();
    const profileInput = pinnedProfileInput(profile);
    const catalog = testMemoryCatalog(profile);
    const activeSurvivorId = testPrimaryNodeId('subject_general', 'observation', 'repeated observation');
    const activeDuplicateId = testPrimaryNodeId('subject_general', 'observation', 'repeated observation copy');
    const databasePath = createProvenanceMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    database
      .prepare('INSERT INTO memory_catalog_snapshots VALUES (?, 1, ?, ?)')
      .run(catalog.hash, catalog.json, '2026-07-20T10:00:00.000Z');
    for (const [id, title] of [[activeSurvivorId, 'Repeated observation'], [activeDuplicateId, 'Repeated observation copy']] as const) {
      insertTestMemoryNode(database, {
        id,
        type: 'observation',
        title,
        status: 'queued',
        attributes: {},
        catalogHash: catalog.hash
      });
      database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run(id, workspaceId, 'General');
      insertTestCatalogValidation(database, id, catalog.hash, profileInput.profileSnapshot);
    }
    database.close();

    runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [{
        survivorNodeId: activeSurvivorId,
        duplicateNodeIds: [activeDuplicateId],
        summary: 'One repeatable observation.',
        body: null,
        reason: 'active_survivor and active_duplicate record the same repeatable result.'
      }],
      revise: [],
      reclassify: []
    }, dreamingContext(2), profileInput);

    let verified = new DatabaseSync(databasePath);
    expect(
      verified.prepare(
        `SELECT node_id, node_revision, validation_kind
         FROM memory_node_catalog_validations
         WHERE node_id IN (?, ?) AND node_revision = 2
         ORDER BY node_id`
      ).all(activeSurvivorId, activeDuplicateId)
    ).toEqual([
      { node_id: activeDuplicateId, node_revision: 2, validation_kind: 'inherited' },
      { node_id: activeSurvivorId, node_revision: 2, validation_kind: 'full' }
    ].sort((left, right) => left.node_id.localeCompare(right.node_id)));
    const mergeChange = getMemoryDreamingSummary(verified, workspaceId).changes
      .find((change) => change.action === 'merge_duplicates')!;
    verified.close();

    restoreMemoryDreamingChange(databasePath, workspaceId, mergeChange.id);
    verified = new DatabaseSync(databasePath);
    expect(
      verified.prepare(
        `SELECT n.id, n.revision, v.validation_kind
         FROM memory_nodes n
         JOIN memory_node_workspaces w ON w.node_id = n.id AND w.workspace_id = ?
         JOIN memory_node_catalog_validations v ON v.node_id = n.id AND v.node_revision = n.revision
         WHERE n.id IN (?, ?)
         ORDER BY n.id`
      ).all(workspaceId, activeSurvivorId, activeDuplicateId)
    ).toEqual([
      { id: activeDuplicateId, revision: 1, validation_kind: 'full' },
      { id: activeSurvivorId, revision: 1, validation_kind: 'full' }
    ].sort((left, right) => left.id.localeCompare(right.id)));
    verified.close();
  });

  it('uses profile status polarity instead of hard-coded security status names when merging', () => {
    const databasePath = createMemoryDatabase();
    const database = new DatabaseSync(databasePath);
    const insertNode = database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [id, status] of [['withdrawn_observation', 'withdrawn'], ['accepted_observation', 'accepted']] as const) {
      insertNode.run(
        id,
        'subject_general',
        'General subject',
        'observation',
        'Same measurement',
        'same measurement',
        'A repeated measurement.',
        '',
        status,
        0.7,
        JSON.stringify({ rating: 3, disposition: 'retain' }),
        '2026-07-20T10:00:00.000Z',
        '2026-07-20T10:00:00.000Z',
        1
      );
      database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run(id, workspaceId, 'General');
    }
    database.close();

    expect(() => runMemoryDreaming(databasePath, workspaceId, {
      prune: [],
      merge: [{
        survivorNodeId: 'accepted_observation',
        duplicateNodeIds: ['withdrawn_observation'],
        summary: null,
        body: null,
        reason: 'The rows share a title but have contradictory profile statuses.'
      }],
      revise: [],
      reclassify: []
    }, {
      model: 'host',
      reasoningEffort: 'high',
      inputNodeCount: 2,
      inputSessionCount: 0
    }, {
      resolvedProfile: resolvedTestResearchProfile(customCurationProfile(), 'explicit')
    })).toThrow('cannot merge negative and non-negative memory conclusions');
  });
});

function customCurationProfile(): ResearchProfile {
  const base = testResearchProfile('2.0.0', 'General Research');
  return {
    ...base,
    id: 'general-research',
    description: 'General evidence-driven research.',
    agent: {
      role: 'Research the bounded subject.',
      posture: ['Test competing explanations.'],
      style: ['Write concise technical prose.'],
      memoryInstructions: ['Preserve durable observations.'],
      runbookInstructions: ['Record reusable procedures.']
    },
    memory: {
      ...base.memory,
      types: [
        {
          id: 'observation',
          name: 'Measured Observation',
          pluralName: 'Measured Observations',
          description: 'A repeatable measured observation.',
          lifecycle: 'active',
          creatable: true,
          aliases: ['observation-alias'],
          order: 10,
          defaultStatus: 'queued',
          allowedStatuses: ['queued', 'accepted', 'withdrawn'],
          attributes: {
            rating: { type: 'number', description: 'Observation quality rating.' },
            disposition: {
              type: 'string',
              description: 'Curation disposition.',
              enum: ['retain', 'revisit']
            }
          },
          requirements: [{
            statuses: ['accepted'],
            requiredAttributes: ['rating', 'disposition'],
            requireEvidence: true,
            requireAssetLinks: true,
            requiredNeighborTypes: ['source-note']
          }]
        },
        {
          id: 'source-note',
          name: 'Source Note',
          pluralName: 'Source Notes',
          description: 'A source record supporting an observation.',
          lifecycle: 'active',
          creatable: true,
          order: 20,
          defaultStatus: 'queued',
          allowedStatuses: ['queued', 'accepted', 'withdrawn']
        },
        {
          id: 'retired-note',
          name: 'Retired Note',
          pluralName: 'Retired Notes',
          description: 'A historical memory type retained for reading.',
          lifecycle: 'retired',
          creatable: false,
          replacedBy: 'observation',
          aliases: ['retired-alias'],
          order: 30,
          defaultStatus: 'queued',
          allowedStatuses: ['queued', 'accepted', 'withdrawn']
        }
      ],
      statuses: [
        { id: 'queued', name: 'Queued', description: 'Not yet assessed.', order: 10, polarity: 'neutral' },
        { id: 'accepted', name: 'Accepted', description: 'Supported by evidence.', order: 20, polarity: 'positive' },
        { id: 'withdrawn', name: 'Withdrawn', description: 'Invalidated.', order: 30, terminal: true, polarity: 'negative' }
      ],
      evidenceKinds: [{ id: 'measurement', name: 'Measurement', description: 'A measured result.', allowsPath: true }]
    },
    modelJobs: {
      memoryCuration: { provider: 'openai', model: 'curation-default', effort: 'medium' }
    }
  };
}

function compatiblePresentationProfile(source: ResearchProfile): ResearchProfile {
  return {
    ...source,
    version: '2.1.0',
    name: 'Renamed General Research',
    description: 'Presentation-only changes plus unrelated catalog additions.',
    memory: {
      ...source.memory,
      types: [
        ...source.memory.types.map((type) => ({
          ...type,
          name: `Renamed ${type.name}`,
          pluralName: `Renamed ${type.pluralName}`,
          description: `Renamed presentation for ${type.id}.`,
          order: type.order + 100,
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
          id: 'appendix',
          name: 'Appendix',
          pluralName: 'Appendices',
          description: 'An unrelated additive memory type.',
          lifecycle: 'active',
          creatable: true,
          order: 500,
          defaultStatus: 'archived',
          allowedStatuses: ['archived']
        }
      ],
      statuses: [
        ...source.memory.statuses.map((status) => ({
          ...status,
          name: `Renamed ${status.name}`,
          description: `Renamed presentation for ${status.id}.`,
          order: status.order + 100
        })),
        {
          id: 'archived',
          name: 'Archived',
          description: 'An unrelated additive status.',
          order: 500,
          terminal: true,
          polarity: 'neutral'
        }
      ],
      evidenceKinds: [
        ...source.memory.evidenceKinds.map((kind) => ({
          ...kind,
          name: `Renamed ${kind.name}`,
          description: `Renamed presentation for ${kind.id}.`
        })),
        {
          id: 'citation',
          name: 'Citation',
          description: 'An unrelated additive evidence kind.',
          allowsPath: true
        }
      ],
      evidencePathBases: [
        ...(source.memory.evidencePathBases ?? []).map((base) => ({
          ...base,
          name: `Renamed ${base.name}`,
          description: `Renamed presentation for ${base.id}.`
        })),
        {
          id: 'repository',
          name: 'Repository',
          description: 'An unrelated additive evidence path base.',
          pathFormat: 'relative'
        }
      ],
      relations: [
        ...(source.memory.relations ?? []).map((relation) => ({
          ...relation,
          name: `Renamed ${relation.name}`,
          description: `Renamed presentation for ${relation.id}.`
        })),
        {
          id: 'references',
          name: 'References',
          description: 'An unrelated additive relation.'
        }
      ]
    }
  };
}

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

function createProvenanceMemoryDatabase(): string {
  const databasePath = createMemoryDatabase();
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE memory_catalog_snapshots (
      catalog_hash TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      catalog_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    ALTER TABLE memory_nodes ADD COLUMN catalog_hash TEXT REFERENCES memory_catalog_snapshots(catalog_hash);
    CREATE TABLE memory_node_catalog_validations (
      node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE ON UPDATE CASCADE,
      node_revision INTEGER NOT NULL CHECK (node_revision > 0),
      catalog_hash TEXT NOT NULL REFERENCES memory_catalog_snapshots(catalog_hash),
      node_content_hash TEXT NOT NULL,
      validation_kind TEXT NOT NULL CHECK (validation_kind IN ('full', 'scoped', 'inherited')),
      research_profile_hash TEXT,
      research_profile_id TEXT,
      research_profile_version TEXT,
      validated_at TEXT NOT NULL,
      CHECK (
        (research_profile_hash IS NULL AND research_profile_id IS NULL AND research_profile_version IS NULL)
        OR
        (research_profile_hash IS NOT NULL AND research_profile_id IS NOT NULL AND research_profile_version IS NOT NULL)
      ),
      PRIMARY KEY(node_id, node_revision, catalog_hash)
    );
    CREATE UNIQUE INDEX memory_nodes_catalog_identity_idx
      ON memory_nodes(subject_id, catalog_hash, type, title_norm)
      WHERE catalog_hash IS NOT NULL;
  `);
  database.close();
  return databasePath;
}

function insertTestMemoryNode(
  database: DatabaseSync,
  input: {
    id: string;
    type: string;
    title: string;
    status: string;
    attributes: Record<string, unknown>;
    catalogHash?: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO memory_nodes(
         id, subject_id, subject_name, type, title, title_norm, summary, body, status,
         confidence, attributes_json, created_at, updated_at, revision, catalog_hash
       ) VALUES (?, 'subject_general', 'General subject', ?, ?, ?, 'Original summary.', 'Original body.', ?,
                 0.7, ?, '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', 1, ?)`
    )
    .run(
      input.id,
      input.type,
      input.title,
      input.title.trim().replace(/\s+/gu, ' ').toLowerCase(),
      input.status,
      JSON.stringify(input.attributes),
      input.catalogHash ?? null
    );
}

function insertTestCatalogValidation(
  database: DatabaseSync,
  nodeId: string,
  catalogHash: string,
  snapshot: ResearchProfileSnapshot
): void {
  database
    .prepare(
      `INSERT INTO memory_node_catalog_validations(
         node_id, node_revision, catalog_hash, node_content_hash, validation_kind,
         research_profile_hash, research_profile_id, research_profile_version, validated_at
       ) VALUES (?, 1, ?, ?, 'full', ?, ?, ?, '2026-07-20T10:00:00.000Z')`
    )
    .run(
      nodeId,
      catalogHash,
      testMemoryNodeValidationHash(database, nodeId),
      snapshot.profileHash,
      snapshot.profileId,
      snapshot.profileVersion
    );
}

function testMemoryNodeValidationHash(database: DatabaseSync, nodeId: string): string {
  const node = database.prepare('SELECT * FROM memory_nodes WHERE id = ?').get(nodeId) as Record<string, unknown>;
  const sessionIds = (database
    .prepare('SELECT session_id FROM memory_node_sessions WHERE node_id = ? ORDER BY session_id')
    .all(nodeId) as Array<{ session_id: string }>).map((row) => row.session_id);
  const workspaces = (database
    .prepare('SELECT workspace_id, workspace_name FROM memory_node_workspaces WHERE node_id = ? ORDER BY workspace_id')
    .all(nodeId) as Array<{ workspace_id: string; workspace_name: string }>).map((row) => ({
      id: row.workspace_id,
      name: row.workspace_name
    }));
  const assetIds = (database
    .prepare('SELECT asset_id FROM memory_node_assets WHERE node_id = ? ORDER BY asset_id')
    .all(nodeId) as Array<{ asset_id: string }>).map((row) => row.asset_id);
  const tags = (database
    .prepare('SELECT tag FROM memory_node_tags WHERE node_id = ? ORDER BY tag')
    .all(nodeId) as Array<{ tag: string }>).map((row) => row.tag);
  const evidence = (database
    .prepare('SELECT * FROM memory_evidence_refs WHERE node_id = ? ORDER BY id')
    .all(nodeId) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      ...(row.path_base === null ? {} : { pathBase: String(row.path_base) }),
      ...(row.path === null ? {} : { path: String(row.path) }),
      locator: JSON.parse(String(row.locator_json)) as Record<string, unknown>,
      summary: String(row.summary),
      createdAt: String(row.created_at)
    }));
  return createHash('sha256')
    .update('honeycrisp:memory-node-validation:v1\0')
    .update(stableTestJson({
      id: String(node.id),
      sessionIds: sessionIds.sort(),
      workspaces: workspaces.sort((left, right) => left.id.localeCompare(right.id)),
      subjectId: String(node.subject_id),
      subjectName: String(node.subject_name),
      type: String(node.type),
      title: String(node.title),
      summary: String(node.summary),
      body: String(node.body),
      status: String(node.status),
      confidence: Number(node.confidence),
      assetIds: assetIds.sort(),
      tags: tags.sort(),
      attributes: JSON.parse(String(node.attributes_json)) as Record<string, unknown>,
      evidence: evidence.sort((left, right) => left.id.localeCompare(right.id)),
      createdAt: String(node.created_at),
      updatedAt: String(node.updated_at),
      revision: Number(node.revision)
    }))
    .digest('hex');
}

function pinnedProfileInput(profile: ResearchProfile): { profileSnapshot: ResearchProfileSnapshot } {
  const resolved = resolvedTestResearchProfile(profile, 'explicit');
  return {
    profileSnapshot: {
      id: 'profile_snapshot_general',
      workspaceId,
      profileId: profile.id,
      profileVersion: profile.version,
      profileHash: resolved.hash,
      source: resolved.source,
      sourcePath: 'C:\\profiles\\general.profile.json',
      profile,
      active: true,
      createdAt: '2026-07-20T10:00:00.000Z'
    }
  };
}

function testMemoryCatalog(profile: ResearchProfile): { hash: string; json: string } {
  const json = stableTestJson(profile.memory);
  return {
    json,
    hash: createHash('sha256')
      .update('honeycrisp:memory-catalog:v1\0')
      .update(json)
      .digest('hex')
  };
}

function testPrimaryNodeId(subjectId: string, type: string, title: string): string {
  const normalizedTitle = title.trim().replace(/\s+/gu, ' ').toLowerCase();
  return `${type}_${createHash('sha256')
    .update(`${subjectId}:${type}:${normalizedTitle}`)
    .digest('hex')
    .slice(0, 20)}`;
}

function dreamingContext(inputNodeCount: number): {
  model: string;
  reasoningEffort: string;
  inputNodeCount: number;
  inputSessionCount: number;
} {
  return {
    model: 'host-selected-model',
    reasoningEffort: 'high',
    inputNodeCount,
    inputSessionCount: 0
  };
}

function stableTestJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableTestJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableTestJson(nested)}`)
    .join(',')}}`;
}
