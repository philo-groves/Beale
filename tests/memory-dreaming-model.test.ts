import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { StartRunInput } from '../src/shared/types';
import { startRunForTest, WorkspaceService } from '../src/main/workspaceService';

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
                    reason: 'parser_primitive and length_conversion describe the same primitive from session_fixture.'
                  }
                ],
                revise: [
                  {
                    nodeId: 'boundary_note',
                    summary: 'The boundary is reachable only through the local fixture.',
                    body: null,
                    reason: 'session_fixture narrows boundary_note reachability.'
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
      insertNode.run('parser_primitive', subjectId, 'Security', 'primitive', 'Parser allocation mismatch', 'parser allocation mismatch', 'A parser allocation mismatch exists.', '', 'confirmed', 0.9, '{}', '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', 1);
      insertNode.run('length_conversion', subjectId, 'Security', 'primitive', 'Signed length reaches allocation', 'signed length reaches allocation', 'A signed length reaches allocation.', '', 'suspected', 0.7, '{}', '2026-07-21T10:00:00.000Z', '2026-07-21T10:00:00.000Z', 1);
      insertNode.run('obsolete_route', subjectId, 'Security', 'trajectory', 'Try the legacy decoder', 'try the legacy decoder', 'A once-promising route.', '', 'suspected', 0.5, '{}', '2026-07-19T10:00:00.000Z', '2026-07-19T10:00:00.000Z', 1);
      insertNode.run('boundary_note', subjectId, 'Security', 'invariant', 'Boundary reachability', 'boundary reachability', 'The boundary may be remotely reachable.', '', 'suspected', 0.6, '{}', '2026-07-22T10:00:00.000Z', '2026-07-22T10:00:00.000Z', 1);
      const associateWorkspace = database.prepare('INSERT INTO memory_node_workspaces VALUES (?, ?, ?)');
      for (const nodeId of ['parser_primitive', 'length_conversion', 'obsolete_route', 'boundary_note']) {
        associateWorkspace.run(nodeId, opened.workspace.workspaceId, 'Security');
      }
      database.close();

      const dreamed = await service.runMemoryDreaming();
      expect(requestBodies).toHaveLength(3);
      expect(JSON.stringify(requestBodies[0])).toContain('Perform a deliberate synthesis pass');
      expect(JSON.stringify(requestBodies[2])).toContain('Parser allocation mismatch');
      expect(JSON.stringify(requestBodies[2])).toContain('Signed length reaches allocation');
      expect(JSON.stringify(requestBodies[2])).toContain(sessionId);
      expect(JSON.stringify(requestBodies[2])).toContain('Exercise the Dreaming session fixture');
      expect(JSON.stringify(requestBodies[1]).length).toBeLessThan(JSON.stringify(requestBodies[0]).length);
      expect(dreamed.honeycrispMemory.dreaming.lastRun).toMatchObject({
        prunedNodeCount: 1,
        duplicateHiddenCount: 1,
        duplicateGroupCount: 1,
        editedNodeCount: 2
      });
      expect(dreamed.honeycrispMemory.dreaming.changes.map((change) => change.action).sort()).toEqual([
        'merge_duplicates',
        'prune',
        'revise'
      ]);
      expect(dreamed.honeycrispMemory.nodes.map((node) => node.id).sort()).toEqual(['boundary_note', 'parser_primitive']);
      expect(dreamed.honeycrispMemory.nodes.find((node) => node.id === 'boundary_note')?.summary).toBe(
        'The boundary is reachable only through the local fixture.'
      );
    } finally {
      service.close();
    }
  });
});

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
    networkProfile: 'offline',
    sandboxProfile: 'host',
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0 },
    fixtureScenario: 'source_review'
  };
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
