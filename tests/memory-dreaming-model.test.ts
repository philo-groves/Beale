import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResearchProfile, StartRunInput } from '../src/shared/types';
import { startRunForTest, WorkspaceService } from '../src/main/workspaceService';
import { resolvedTestResearchProfile, testResearchProfile } from './researchProfileFixture';

const createdDirectories: string[] = [];

afterEach(() => {
  delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('model-reasoned memory Dreaming', () => {
  it('reviews workspace memories with past session transcripts before applying a host-validated semantic plan', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'dreaming-test-token';
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const databasePath = join(root, 'memory.sqlite');
    const requestBodies: Record<string, unknown>[] = [];
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: databasePath,
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile(memoryDreamingResearchProfile()),
      openAiFetch: async (_url, init) => {
        requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (requestBodies.length === 1) {
          return new Response(
            sse(
              event('error', {
                type: 'error',
                status: 400,
                error: {
                  message: 'Your input exceeds the context window of this model.',
                  code: 'context_length_exceeded'
                }
              })
            ),
            { status: 200, headers: { 'content-type': 'text/event-stream' } }
          );
        }
        if (requestBodies.length === 2) {
          return new Response(
            sse(
              event('error', {
                type: 'error',
                status: 500,
                error: {
                  message: 'The model is temporarily unavailable.',
                  code: 'server_error'
                }
              })
            ),
            { status: 200, headers: { 'content-type': 'text/event-stream' } }
          );
        }
        return new Response(
          sse(
            event('response.output_text.done', {
              type: 'response.output_text.done',
              text: JSON.stringify({
                prune: [
                  {
                    nodeId: 'obsolete_route',
                    reason: 'obsolete_route is superseded by the completed evidence in session_fixture.'
                  }
                ],
                merge: [
                  {
                    survivorNodeId: 'parser_primitive',
                    duplicateNodeIds: ['length_conversion'],
                    summary: 'A signed length conversion reaches parser allocation arithmetic.',
                    body: 'Preserve both supporting paths and the remaining verification limitation.',
                    attributes: {},
                    reason: 'parser_primitive and length_conversion describe the same primitive from session_fixture.'
                  }
                ],
                revise: [
                  {
                    nodeId: 'boundary_note',
                    summary: 'The boundary is reachable only through the local fixture.',
                    body: null,
                    attributes: {},
                    reason: 'session_fixture narrows boundary_note reachability.'
                  }
                ],
                reclassify: [
                  {
                    nodeId: 'quarantine_behavior',
                    type: 'invariant',
                    attributes: {},
                    reason: 'quarantine_behavior describes a durable platform rule, not an established flaw.'
                  }
                ]
              })
            }) + event('response.completed', { type: 'response.completed', response: { id: 'resp_dreaming' } })
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        );
      }
    });

    try {
      const opened = service.createWorkspace(workspace);
      const memorySettings = service.getMemorySettings();
      service.setMemoryTypeDescriptions({
        ...memorySettings.typeDescriptions,
        invariant: 'CUSTOM TAXONOMY: a durable platform or security rule, not an individual flaw.'
      });
      const session = startRunForTest(service, runInput());
      const sessionId = session.runs[0]?.run.id ?? '';
      const database = new DatabaseSync(opened.workspace.databasePath);
      database.exec(`
        CREATE TABLE IF NOT EXISTS memory_nodes (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_name TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, title_norm TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL, attributes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS memory_node_sessions (node_id TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY(node_id, session_id));
        CREATE TABLE IF NOT EXISTS memory_node_workspaces (node_id TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, PRIMARY KEY(node_id, workspace_id));
        CREATE TABLE IF NOT EXISTS memory_node_assets (node_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(node_id, asset_id));
        CREATE TABLE IF NOT EXISTS memory_node_tags (node_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(node_id, tag));
        CREATE TABLE IF NOT EXISTS memory_edges (from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(from_id, to_id, relation));
        CREATE TABLE IF NOT EXISTS memory_evidence_refs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL, path_base TEXT, path TEXT, locator_json TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
      `);
      const insertNode = database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const subjectId = `subject_workspace:${opened.workspace.workspaceId}`;
      insertNode.run(
        'parser_primitive',
        subjectId,
        'Security',
        'primitive',
        'Parser allocation mismatch',
        'parser allocation mismatch',
        'A parser allocation mismatch exists.',
        '',
        'confirmed',
        0.9,
        JSON.stringify({
          rootCause: 'Signed width conversion changes the allocation size.',
          rootCauseKey: 'signed-width-allocation-mismatch',
          impact: 'Bearer model-input-secret-1234567890 reaches allocation control.',
          reachability: 'A remote length field reaches the parser.',
          historicalPrecedent: true,
          omittedInternalDetail: 'This intentionally remains outside the bounded projection.'
        }),
        '2026-07-20T10:00:00.000Z',
        '2026-07-20T10:00:00.000Z',
        1
      );
      insertNode.run('length_conversion', subjectId, 'Security', 'primitive', 'Signed length reaches allocation', 'signed length reaches allocation', 'A signed length reaches allocation.', '', 'suspected', 0.7, '{}', '2026-07-21T10:00:00.000Z', '2026-07-21T10:00:00.000Z', 1);
      insertNode.run('obsolete_route', subjectId, 'Security', 'trajectory', 'Try the legacy decoder', 'try the legacy decoder', 'A once-promising route.', '', 'suspected', 0.5, '{}', '2026-07-19T10:00:00.000Z', '2026-07-19T10:00:00.000Z', 1);
      insertNode.run('boundary_note', subjectId, 'Security', 'invariant', 'Boundary reachability', 'boundary reachability', 'The boundary may be remotely reachable.', '', 'suspected', 0.6, '{}', '2026-07-22T10:00:00.000Z', '2026-07-22T10:00:00.000Z', 1);
      insertNode.run('quarantine_behavior', subjectId, 'Security', 'primitive', 'Mounted images synthesize quarantine state', 'mounted images synthesize quarantine state', 'The platform derives quarantine from mounted image state.', '', 'confirmed', 0.9, '{}', '2026-07-22T11:00:00.000Z', '2026-07-22T11:00:00.000Z', 1);
      const associateWorkspace = database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)');
      for (const nodeId of ['parser_primitive', 'length_conversion', 'obsolete_route', 'boundary_note', 'quarantine_behavior']) {
        associateWorkspace.run(nodeId, opened.workspace.workspaceId, 'Security');
      }
      database.prepare('INSERT INTO memory_edges VALUES (?, ?, ?, ?, ?, ?)').run(
        'parser_primitive',
        'boundary_note',
        'constrained_by',
        'Boundary relationship retained for structural review.',
        '2026-07-22T12:00:00.000Z',
        '2026-07-22T12:00:00.000Z'
      );
      const insertEdge = database.prepare('INSERT INTO memory_edges VALUES (?, ?, ?, ?, ?, ?)');
      for (let index = 0; index < 80; index += 1) {
        insertEdge.run(
          'parser_primitive',
          'boundary_note',
          `bounded_relation_${index}`,
          `Bounded relationship ${index}: ${'structural detail '.repeat(80)}`,
          '2026-07-22T12:00:00.000Z',
          '2026-07-22T12:00:00.000Z'
        );
      }
      database.close();

      const dreamed = await service.runMemoryDreaming();
      const reclassifiedNodeId = `invariant_${createHash('sha256')
        .update(`${subjectId}:invariant:mounted images synthesize quarantine state`)
        .digest('hex')
        .slice(0, 20)}`;
      expect(requestBodies).toHaveLength(3);
      expect(JSON.stringify(requestBodies[0])).toContain('Perform a deliberate synthesis pass');
      expect(JSON.stringify(requestBodies[0])).toContain('supported structural metadata backfilled');
      expect(JSON.stringify(requestBodies[0])).toContain('Never invent structural metadata');
      expect(JSON.stringify(requestBodies[2])).toContain('Parser allocation mismatch');
      expect(JSON.stringify(requestBodies[2])).toContain('Signed length reaches allocation');
      expect(JSON.stringify(requestBodies[2])).toContain('CUSTOM TAXONOMY');
      expect(JSON.stringify(requestBodies[2])).toContain(sessionId);
      expect(JSON.stringify(requestBodies[2])).toContain('Exercise the Dreaming session fixture');
      expect(JSON.stringify(requestBodies[2])).toContain('signed-width-allocation-mismatch');
      expect(JSON.stringify(requestBodies[2])).toContain('historicalPrecedent');
      expect(JSON.stringify(requestBodies[2])).toContain('A remote length field reaches the parser.');
      expect(JSON.stringify(requestBodies[2])).toContain('constrained_by');
      expect(JSON.stringify(requestBodies[2])).toContain('Boundary relationship retained for structural review.');
      expect(JSON.stringify(requestBodies[2])).toContain('...redacted');
      expect(JSON.stringify(requestBodies[2])).not.toContain('model-input-secret');
      expect(JSON.stringify(requestBodies[2])).toContain('omittedInternalDetail');
      const requestInput = requestBodies[2].input as Array<{ content: Array<{ text: string }> }>;
      const projectedInput = JSON.parse(requestInput[0]!.content[0]!.text) as {
        memoryStore: {
          relationshipTruncated: boolean;
          relationships: Array<{ fromType: string; toType: string }>;
        };
      };
      expect(projectedInput.memoryStore.relationshipTruncated).toBe(true);
      expect(JSON.stringify(projectedInput.memoryStore.relationships).length).toBeLessThanOrEqual(12_500);
      expect(projectedInput.memoryStore.relationships.every((edge) => edge.fromType && edge.toType)).toBe(true);
      expect(JSON.stringify(requestBodies[1]).length).toBeLessThan(JSON.stringify(requestBodies[0]).length);
      expect(requestBodies.every((body) => body.model === 'gpt-5.6-sol')).toBe(true);
      expect(dreamed.honeycrispMemory.dreaming.lastRun).toMatchObject({
        prunedNodeCount: 1,
        duplicateHiddenCount: 1,
        duplicateGroupCount: 1,
        reclassifiedNodeCount: 1,
        editedNodeCount: 3
      });
      expect(dreamed.honeycrispMemory.dreaming.changes.map((change) => change.action).sort()).toEqual([
        'merge_duplicates',
        'prune',
        'reclassify',
        'revise'
      ]);
      expect(dreamed.honeycrispMemory.nodes.map((node) => node.id).sort()).toEqual(['boundary_note', reclassifiedNodeId, 'parser_primitive'].sort());
      expect(dreamed.honeycrispMemory.nodes.find((node) => node.id === 'boundary_note')?.summary).toBe(
        'The boundary is reachable only through the local fixture.'
      );
      expect(dreamed.honeycrispMemory.nodes.find((node) => node.id === reclassifiedNodeId)?.type).toBe('invariant');
    } finally {
      service.close();
    }
  });

  it('requests one complete corrected plan after host validation rejects the first plan', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'dreaming-test-token';
    const root = temporaryDirectory();
    const requestBodies: Record<string, unknown>[] = [];
    const invalidPlan = {
      prune: [],
      merge: [],
      revise: [],
      reclassify: [{
        nodeId: 'misclassified_invariant',
        type: 'primitive',
        attributes: {},
        reason: 'misclassified_invariant is an independently established flaw.'
      }]
    };
    const correctedPlan = {
      ...invalidPlan,
      reclassify: [{
        ...invalidPlan.reclassify[0],
        attributes: {
          rootCause: 'A signed length is truncated before allocation sizing.',
          rootCauseKey: 'signed-length-allocation-truncation'
        }
      }]
    };
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile(memoryDreamingResearchProfile()),
      openAiFetch: async (_url, init) => {
        requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return dreamingPlanResponse(requestBodies.length === 1 ? invalidPlan : correctedPlan);
      }
    });

    try {
      const opened = initializeDreamingMemory(service, join(root, 'workspace'));
      const dreamed = await service.runMemoryDreaming();

      expect(requestBodies).toHaveLength(2);
      const firstInput = requestBodies[0]!.input as Array<{ content: Array<{ text: string }> }>;
      const correctedInput = requestBodies[1]!.input as Array<{ content: Array<{ text: string }> }>;
      expect(correctedInput).toHaveLength(2);
      expect(correctedInput[0]!.content[0]!.text).toBe(firstInput[0]!.content[0]!.text);
      expect(correctedInput[1]!.content[0]!.text).toContain('complete replacement Dreaming plan');
      expect(correctedInput[1]!.content[0]!.text).toContain('misclassified_invariant');
      expect(correctedInput[1]!.content[0]!.text).toContain('requires non-empty attributes: rootCause');
      expect(dreamed.honeycrispMemory.dreaming.lastRun).toMatchObject({
        status: 'completed',
        reclassifiedNodeCount: 1,
        errorMessage: null
      });

      const database = new DatabaseSync(opened.workspace.databasePath);
      expect(database.prepare("SELECT status, COUNT(*) AS count FROM memory_dreaming_runs GROUP BY status").all()).toEqual([
        { status: 'completed', count: 1 }
      ]);
      expect(database.prepare('SELECT COUNT(*) AS count FROM memory_dreaming_changes').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT type, attributes_json FROM memory_nodes').get()).toEqual({
        type: 'primitive',
        attributes_json: JSON.stringify(correctedPlan.reclassify[0]!.attributes)
      });
      database.close();
    } finally {
      service.close();
    }
  });

  it('persists one failed run and applies nothing when the corrected plan is also invalid', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'dreaming-test-token';
    const root = temporaryDirectory();
    const requestBodies: Record<string, unknown>[] = [];
    const resolvedProfile = resolvedTestResearchProfile(memoryDreamingResearchProfile());
    const invalidPlan = {
      prune: [],
      merge: [],
      revise: [],
      reclassify: [{
        nodeId: 'misclassified_invariant',
        type: 'primitive',
        attributes: {},
        reason: 'misclassified_invariant is an independently established flaw.'
      }]
    };
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedProfile,
      openAiFetch: async (_url, init) => {
        requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return dreamingPlanResponse(invalidPlan);
      }
    });

    try {
      const opened = initializeDreamingMemory(service, join(root, 'workspace'));
      await expect(service.runMemoryDreaming()).rejects.toThrow('requires non-empty attributes: rootCause');

      expect(requestBodies).toHaveLength(2);
      expect(service.getSnapshot()?.honeycrispMemory.dreaming.lastRun).toMatchObject({
        status: 'failed',
        reclassifiedNodeCount: 0,
        editedNodeCount: 0,
        errorMessage: expect.stringContaining('requires non-empty attributes: rootCause')
      });
      const database = new DatabaseSync(opened.workspace.databasePath);
      expect(database.prepare("SELECT status, COUNT(*) AS count FROM memory_dreaming_runs GROUP BY status").all()).toEqual([
        { status: 'failed', count: 1 }
      ]);
      const failedProvenance = database
        .prepare(
          `SELECT research_profile_hash, research_profile_id, research_profile_version, memory_catalog_hash
           FROM memory_dreaming_runs`
        )
        .get() as Record<string, unknown>;
      expect(failedProvenance).toMatchObject({
        research_profile_hash: resolvedProfile.hash,
        research_profile_id: resolvedProfile.profile.id,
        research_profile_version: resolvedProfile.profile.version,
        memory_catalog_hash: expect.stringMatching(/^[a-f0-9]{64}$/u)
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM memory_dreaming_changes').get()).toEqual({ count: 0 });
      expect(database.prepare('SELECT id, type, attributes_json, revision FROM memory_nodes').get()).toEqual({
        id: 'misclassified_invariant',
        type: 'invariant',
        attributes_json: '{}',
        revision: 1
      });
      database.close();
    } finally {
      service.close();
    }
  });

  it('persists a sanitized failed run when the model fails before a plan is applied', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'dreaming-test-token';
    const root = temporaryDirectory();
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile(memoryDreamingResearchProfile()),
      openAiFetch: async () => new Response(
        sse(event('error', {
          type: 'error',
          status: 400,
          error: {
            message: 'Provider rejected Bearer fake-provider-secret-1234567890.',
            code: 'invalid_request'
          }
        })),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    });

    try {
      const opened = service.createWorkspace(join(root, 'workspace'));
      const database = new DatabaseSync(opened.workspace.databasePath);
      database.exec(`
        CREATE TABLE IF NOT EXISTS memory_nodes (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_name TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, title_norm TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL, attributes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS memory_node_sessions (node_id TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY(node_id, session_id));
        CREATE TABLE IF NOT EXISTS memory_node_workspaces (node_id TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, PRIMARY KEY(node_id, workspace_id));
        CREATE TABLE IF NOT EXISTS memory_node_assets (node_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(node_id, asset_id));
        CREATE TABLE IF NOT EXISTS memory_node_tags (node_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(node_id, tag));
        CREATE TABLE IF NOT EXISTS memory_edges (from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(from_id, to_id, relation));
        CREATE TABLE IF NOT EXISTS memory_evidence_refs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL, path_base TEXT, path TEXT, locator_json TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
      `);
      database.close();
      await expect(service.runMemoryDreaming()).rejects.toThrow('Provider rejected');
      const failed = service.getSnapshot()?.honeycrispMemory.dreaming.lastRun;
      expect(failed).toMatchObject({
        status: 'failed',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        editedNodeCount: 0,
        errorMessage: expect.stringContaining('...redacted')
      });
      expect(failed?.errorMessage).not.toContain('fake-provider-secret');
    } finally {
      service.close();
    }
  });

  it('refreshes the workspace profile and refuses curation when the refreshed profile disables memory', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'dreaming-test-token';
    const root = temporaryDirectory();
    let activeProfile = memoryDreamingResearchProfile();
    let requestCount = 0;
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile(activeProfile),
      openAiFetch: async () => {
        requestCount += 1;
        return dreamingPlanResponse({ prune: [], merge: [], revise: [], reclassify: [] });
      }
    });

    try {
      const opened = service.createWorkspace(join(root, 'workspace'));
      activeProfile = {
        ...activeProfile,
        version: '2.0.0',
        name: 'Memory-disabled research',
        capabilities: {
          ...activeProfile.capabilities,
          memoryEnabled: false
        }
      };

      await expect(service.runMemoryDreaming()).rejects.toThrow(
        'Memory Dreaming is disabled by the active research profile.'
      );

      expect(requestCount).toBe(0);
      expect(service.getSnapshot()?.researchProfile).toMatchObject({
        profileVersion: '2.0.0',
        profile: { name: 'Memory-disabled research', capabilities: { memoryEnabled: false } }
      });
      const database = new DatabaseSync(opened.workspace.databasePath);
      expect(database.prepare('SELECT COUNT(*) AS count FROM memory_dreaming_runs').get()).toEqual({ count: 0 });
      database.close();
    } finally {
      service.close();
    }
  });
});

function memoryDreamingResearchProfile(): ResearchProfile {
  const base = testResearchProfile();
  const statuses = [
    { id: 'draft', name: 'Draft', description: 'Not yet assessed.', order: 10, polarity: 'neutral' as const },
    { id: 'confirmed', name: 'Confirmed', description: 'Supported by required evidence.', order: 20, polarity: 'positive' as const },
    { id: 'rejected', name: 'Rejected', description: 'Disproved.', order: 30, terminal: true, polarity: 'negative' as const }
  ];
  return {
    ...base,
    memory: {
      ...base.memory,
      statuses,
      types: [
        {
          id: 'invariant',
          name: 'Invariant',
          pluralName: 'Invariants',
          description: 'CUSTOM TAXONOMY: a durable platform or security rule, not an individual flaw.',
          lifecycle: 'active',
          creatable: true,
          order: 10,
          defaultStatus: 'draft',
          allowedStatuses: ['draft', 'confirmed', 'rejected']
        },
        {
          id: 'primitive',
          name: 'Primitive',
          pluralName: 'Primitives',
          description: 'A proven root-cause flaw.',
          lifecycle: 'active',
          creatable: true,
          order: 20,
          defaultStatus: 'draft',
          allowedStatuses: ['draft', 'confirmed', 'rejected'],
          attributes: {
            rootCause: { type: 'string', description: 'The proven root cause.' },
            rootCauseKey: {
              type: 'string',
              description: 'A stable root-cause identity.',
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$'
            }
          },
          requirements: [{ requiredAttributes: ['rootCause', 'rootCauseKey'] }]
        },
        {
          id: 'trajectory',
          name: 'Trajectory',
          pluralName: 'Trajectories',
          description: 'A reusable sequence of research choices and results.',
          lifecycle: 'active',
          creatable: true,
          order: 30,
          defaultStatus: 'draft',
          allowedStatuses: ['draft', 'confirmed', 'rejected']
        }
      ]
    }
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'beale-memory-dreaming-model-'));
  createdDirectories.push(directory);
  return directory;
}

function runInput(): StartRunInput {
  return {
    runEngine: 'fixture',
    shellSafetyMode: 'auto_review',
    goalEnabled: false,
    goalObjective: null,
    promptMarkdown: `# Exercise the Dreaming session fixture\nRecord the parser boundary and exhausted legacy route.\n${'Detailed session context. '.repeat(5_000)}`,
    mode: 'open_discovery',
    attemptStrategy: 'iterative_research',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    sandboxProfile: 'host',
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0 },
    fixtureScenario: 'source_review'
  };
}

function initializeDreamingMemory(service: WorkspaceService, workspacePath: string) {
  const opened = service.createWorkspace(workspacePath);
  const database = new DatabaseSync(opened.workspace.databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_nodes (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_name TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, title_norm TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL, attributes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_node_sessions (node_id TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY(node_id, session_id));
    CREATE TABLE IF NOT EXISTS memory_node_workspaces (node_id TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_name TEXT NOT NULL, PRIMARY KEY(node_id, workspace_id));
    CREATE TABLE IF NOT EXISTS memory_node_assets (node_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(node_id, asset_id));
    CREATE TABLE IF NOT EXISTS memory_node_tags (node_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(node_id, tag));
    CREATE TABLE IF NOT EXISTS memory_edges (from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(from_id, to_id, relation));
    CREATE TABLE IF NOT EXISTS memory_evidence_refs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL, path_base TEXT, path TEXT, locator_json TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  database.prepare('INSERT INTO memory_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'misclassified_invariant',
    `subject_workspace:${opened.workspace.workspaceId}`,
    'Security',
    'invariant',
    'Signed length allocation truncation',
    'signed length allocation truncation',
    'A signed length is truncated before allocation sizing.',
    'The attached research evidence establishes the mechanism.',
    'confirmed',
    0.9,
    '{}',
    '2026-07-20T10:00:00.000Z',
    '2026-07-20T10:00:00.000Z',
    1
  );
  database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)').run(
    'misclassified_invariant',
    opened.workspace.workspaceId,
    'Security'
  );
  database.close();
  return opened;
}

function dreamingPlanResponse(plan: Record<string, unknown>): Response {
  return new Response(
    sse(
      event('response.output_text.done', {
        type: 'response.output_text.done',
        text: JSON.stringify(plan)
      }) + event('response.completed', { type: 'response.completed', response: { id: 'resp_dreaming' } })
    ),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
}

function event(name: string, data: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sse(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}
