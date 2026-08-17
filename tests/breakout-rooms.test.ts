import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { resolvedBreakoutRoomStatus } from '../src/main/breakoutRoomStatus';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function addRoomMember(
  database: WorkspaceDatabase,
  input: { roomId: string; runId: string; attemptId: string; suffix: string; provider?: string }
): void {
  database.upsertBreakoutRoomMember({
    id: `member_${input.suffix}`,
    roomId: input.roomId,
    runId: input.runId,
    attemptId: input.attemptId,
    agentId: `agent_${input.suffix}`,
    agentPath: `/root/${input.suffix}`,
    provider: input.provider ?? 'openai-codex',
    model: input.provider === 'anthropic' ? 'claude-opus-5' : 'gpt-5.6-sol',
    reasoningEffort: 'high',
    role: 'researcher',
    status: 'active',
    startedAt: '2026-08-12T12:00:00.000Z'
  });
}

describe('breakout room persistence', () => {
  it('ends a room when interrupted work is the only remaining non-completed member state', () => {
    const room = { phase: 'response', status: 'active' } as const;

    expect(resolvedBreakoutRoomStatus(room, [
      { status: 'completed' },
      { status: 'interrupted' }
    ], 'active')).toBe('interrupted');
    expect(resolvedBreakoutRoomStatus(room, [
      { status: 'active' },
      { status: 'completed' }
    ], 'paused')).toBe('interrupted');
  });

  it('loads room records and summaries newest-first by creation time', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-breakout-order-'));
    directories.push(directory);
    const databasePath = join(directory, 'memory.sqlite');
    const artifactRoot = join(directory, 'artifacts');
    let database = new WorkspaceDatabase(databasePath, artifactRoot, { workspacePath: directory });
    database.initialize();
    try {
      const context = database.createRun({
        scopeVersionId: database.getActiveScope().id,
        title: 'Ordered collaboration',
        promptMarkdown: 'Review the authorized target in multiple breakout rooms.',
        shellSafetyMode: 'auto_review',
        mode: 'open_discovery',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        attemptStrategy: 'single_path',
        sandboxProfile: 'host',
        budget: { runEngine: 'honeycrisp' }
      });
      database.upsertBreakoutRoom({
        id: 'room_older',
        runId: context.run.id,
        attemptId: context.attempt.id,
        name: 'older_review',
        title: 'Older review',
        createdAt: '2026-08-12T12:00:00.000Z'
      });
      database.upsertBreakoutRoom({
        id: 'room_newer',
        runId: context.run.id,
        attemptId: context.attempt.id,
        name: 'newer_review',
        title: 'Newer review',
        createdAt: '2026-08-12T13:00:00.000Z'
      });
      for (const room of ['older', 'newer']) {
        addRoomMember(database, {
          roomId: `room_${room}`,
          runId: context.run.id,
          attemptId: context.attempt.id,
          suffix: `${room}_one`
        });
        addRoomMember(database, {
          roomId: `room_${room}`,
          runId: context.run.id,
          attemptId: context.attempt.id,
          suffix: `${room}_two`
        });
      }
      database.upsertBreakoutRoom({
        id: 'room_single',
        runId: context.run.id,
        attemptId: context.attempt.id,
        name: 'single_review',
        title: 'Single review',
        createdAt: '2026-08-12T14:00:00.000Z'
      });
      addRoomMember(database, {
        roomId: 'room_single',
        runId: context.run.id,
        attemptId: context.attempt.id,
        suffix: 'single_worker'
      });

      expect(database.listBreakoutRoomSummaries(context.run.id).map((room) => room.id)).toEqual(['room_newer', 'room_older']);
      expect((database.getRunDetail(context.run.id).breakoutRooms ?? []).map((room) => room.id)).toEqual(['room_newer', 'room_older']);
      expect((database.getRunDetailUpdate(context.run.id, { afterTraceSequence: -1, afterTranscriptCount: 0 }).breakoutRooms ?? []).map((room) => room.id))
        .toEqual(['room_newer', 'room_older']);

      database.close();
      database = new WorkspaceDatabase(databasePath, artifactRoot, { workspacePath: directory });
      database.initialize();
      expect((database.getRunDetail(context.run.id).breakoutRooms ?? []).map((room) => room.id)).toEqual(['room_newer', 'room_older']);
    } finally {
      database.close();
    }
  });

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
      kind: 'validation',
      phase: 'response',
      challengeRound: 1
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
    addRoomMember(database, {
      roomId,
      runId: context.run.id,
      attemptId: context.attempt.id,
      suffix: 'openai_reviewer'
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
      metadata: { packetKind: 'independent_memo', confidence: 'high', uncertainty: 'Caller coverage remains open.', nextExperiment: 'Enumerate callers.' },
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
      expect.objectContaining({ id: roomId, memberCount: 2, providers: ['anthropic', 'openai-codex'], status: 'active' })
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
        kind: 'validation',
        phase: 'response',
        challengeRound: 1
      })
    ]);
    expect(restored.breakoutRoomMembers).toEqual([
      expect.objectContaining({ id: memberId, provider: 'anthropic', role: 'challenger' }),
      expect.objectContaining({ id: 'member_openai_reviewer', provider: 'openai-codex', role: 'researcher' })
    ]);
    expect(restored.breakoutRoomMessages).toEqual([
      expect.objectContaining({
        id: 'message_independent_memo',
        contentMarkdown: 'The boundary needs an additional malformed-input check.',
        evidenceRefs: ['artifact:parser-fixture'],
        metadata: expect.objectContaining({ packetKind: 'independent_memo', confidence: 'high', uncertainty: 'Caller coverage remains open.' })
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
