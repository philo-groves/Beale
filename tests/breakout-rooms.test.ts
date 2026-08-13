import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('breakout room persistence', () => {
  it('restores room membership and transcripts while preserving lifecycle state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-breakout-rooms-'));
    directories.push(directory);
    const databasePath = join(directory, 'memory.sqlite');
    const artifactRoot = join(directory, 'artifacts');
    let database = new WorkspaceDatabase(databasePath, artifactRoot, { workspacePath: directory });
    database.initialize();
    try {
    const context = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Collaborative review',
      promptMarkdown: 'Review the authorized target independently.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'single_path',
      sandboxProfile: 'host',
      budget: { runEngine: 'honeycrisp' }
    });
    const roomId = 'room_parser_review';
    const memberId = 'member_claude';

    database.upsertBreakoutRoom({
      id: roomId,
      runId: context.run.id,
      attemptId: context.attempt.id,
      name: 'parser_review',
      title: 'Parser review',
      purpose: 'Independently challenge parser boundary assumptions.',
      kind: 'validation'
    });
    database.upsertBreakoutRoomMember({
      id: memberId,
      roomId,
      runId: context.run.id,
      attemptId: context.attempt.id,
      agentId: 'agent_claude',
      agentPath: '/root/parser_review',
      provider: 'anthropic',
      model: 'claude-opus-5',
      reasoningEffort: 'high',
      role: 'challenger',
      status: 'active',
      startedAt: '2026-08-12T12:00:00.000Z'
    });
    database.createBreakoutRoomMessage({
      id: 'message_independent_memo',
      roomId,
      runId: context.run.id,
      attemptId: context.attempt.id,
      memberId,
      senderAgentPath: '/root/parser_review',
      kind: 'response',
      contentMarkdown: 'The boundary needs an additional malformed-input check.',
      evidenceRefs: ['artifact:parser-fixture'],
      createdAt: '2026-08-12T12:01:00.000Z'
    });

    database.upsertBreakoutRoom({
      id: roomId,
      runId: context.run.id,
      attemptId: context.attempt.id,
      name: 'parser_review',
      title: 'Parser review',
      status: 'active'
    });
    expect(database.listBreakoutRoomSummaries(context.run.id)).toEqual([
      expect.objectContaining({ id: roomId, memberCount: 1, providers: ['anthropic'], status: 'active' })
    ]);
    expect(database.findBreakoutRoomMember(context.run.id, context.attempt.id, '/root/parser_review')).toEqual(
      expect.objectContaining({ id: memberId, provider: 'anthropic', status: 'active' })
    );

    database.close();
    database = new WorkspaceDatabase(databasePath, artifactRoot, { workspacePath: directory });
    database.initialize();
    const restored = database.getRunDetail(context.run.id);
    expect(restored.breakoutRooms).toEqual([
      expect.objectContaining({
        id: roomId,
        purpose: 'Independently challenge parser boundary assumptions.',
        kind: 'validation'
      })
    ]);
    expect(restored.breakoutRoomMembers).toEqual([
      expect.objectContaining({ id: memberId, provider: 'anthropic', role: 'challenger' })
    ]);
    expect(restored.breakoutRoomMessages).toEqual([
      expect.objectContaining({
        id: 'message_independent_memo',
        contentMarkdown: 'The boundary needs an additional malformed-input check.',
        evidenceRefs: ['artifact:parser-fixture']
      })
    ]);

    database.interruptActiveBreakoutRooms(context.run.id, context.attempt.id);
    expect((database.getRunDetail(context.run.id).breakoutRooms ?? []).at(0)).toEqual(
      expect.objectContaining({ status: 'interrupted' })
    );
    expect(database.findBreakoutRoomMember(context.run.id, context.attempt.id, '/root/parser_review')).toEqual(
      expect.objectContaining({ status: 'interrupted' })
    );
    } finally {
      database.close();
    }
  });
});
