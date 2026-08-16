import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type {
  ApprovalRecord,
  ArtifactRecord,
  AttemptRecord,
  BreakoutRoomMemberRecord,
  BreakoutRoomMessageRecord,
  BreakoutRoomRecord,
  ModelSessionRecord,
  NotificationRecord,
  RunDetail,
  RunDetailUpdate,
  RunDetailUpdateCursor,
  RunDetailVersion,
  RunRecord,
  RunRow,
  SessionTranscriptSearchInput,
  SessionTranscriptSearchResponse,
  TraceEventRecord,
  TranscriptMessageRecord
} from '@shared/types';
import { createId, type CreatedRunContext, type WorkspaceDatabase } from './database';
import {
  appendHoneycrispSessionEvent,
  appendHoneycrispSessionEventAsync,
  beginHoneycrispSessionAttempt,
  createHoneycrispSession,
  getHoneycrispSession,
  getHoneycrispSessionAsync,
  getHoneycrispSessionUpdateAsync,
  honeycrispOwnsSessions,
  listHoneycrispSessionSummaries,
  listHoneycrispSessions,
  transitionHoneycrispSession,
  type HoneycrispSessionEvent,
  type HoneycrispSessionRecord,
  type HoneycrispSessionSummary,
  type HoneycrispSessionStorage
} from './honeycrispCliClient';

const BOUNDARIES = new WeakSet<WorkspaceDatabase>();
const BOUNDARY_CONTEXTS = new WeakMap<WorkspaceDatabase, {
  database: WorkspaceDatabase;
  ownedRunIds: ReadonlySet<string>;
  storage: HoneycrispSessionStorage;
  traceWrites: HoneycrispTraceWriteQueue;
}>();

const TRACE_WRITE_BATCH_DELAY_MS = 40;
const TRACE_WRITE_BATCH_SIZE = 256;
const TRACE_WRITE_MAX_PENDING = 4_096;
const TRACE_WRITE_RETRY_MAX_MS = 2_000;

class HoneycrispTraceWriteQueue {
  private readonly pending = new Map<string, TraceEventRecord[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly retryDelay = new Map<string, number>();

  public constructor(private readonly storage: HoneycrispSessionStorage) {}

  public enqueue(runId: string, record: TraceEventRecord): void {
    const queued = this.pending.get(runId) ?? [];
    queued.push(record);
    if (queued.length > TRACE_WRITE_MAX_PENDING) {
      queued.splice(0, queued.length - TRACE_WRITE_MAX_PENDING);
    }
    this.pending.set(runId, queued);
    if (queued.length >= TRACE_WRITE_BATCH_SIZE) {
      this.schedule(runId, 0);
    } else if (!this.timers.has(runId) && !this.inFlight.has(runId)) {
      this.schedule(runId, TRACE_WRITE_BATCH_DELAY_MS);
    }
  }

  public async flush(runId?: string): Promise<void> {
    const runIds = runId
      ? [runId]
      : [...new Set([...this.pending.keys(), ...this.inFlight.keys()])];
    await Promise.all(runIds.map(async (candidate) => {
      this.clearTimer(candidate);
      this.start(candidate);
      while (this.inFlight.has(candidate)) {
        await this.inFlight.get(candidate);
        this.clearTimer(candidate);
        this.start(candidate);
      }
    }));
  }

  private schedule(runId: string, delayMs: number): void {
    this.clearTimer(runId);
    const timer = setTimeout(() => {
      this.timers.delete(runId);
      this.start(runId);
    }, delayMs);
    timer.unref?.();
    this.timers.set(runId, timer);
  }

  private start(runId: string): void {
    if (this.inFlight.has(runId)) return;
    const queued = this.pending.get(runId);
    if (!queued?.length) return;
    const records = queued.splice(0, TRACE_WRITE_BATCH_SIZE);
    if (queued.length === 0) this.pending.delete(runId);
    const eventId = createId('trace_batch');
    const write = appendHoneycrispSessionEventAsync(runId, {
      id: eventId,
      kind: 'beale.trace_batch',
      timestamp: records[0]?.createdAt ?? new Date().toISOString(),
      summary: `Beale persisted ${records.length} trace event${records.length === 1 ? '' : 's'}.`,
      payload: { records }
    }, this.storage).then(() => {
      this.retryDelay.delete(runId);
    }).catch(() => {
      const current = this.pending.get(runId) ?? [];
      this.pending.set(runId, [...records, ...current].slice(-TRACE_WRITE_MAX_PENDING));
      const delay = Math.min((this.retryDelay.get(runId) ?? TRACE_WRITE_BATCH_DELAY_MS) * 2, TRACE_WRITE_RETRY_MAX_MS);
      this.retryDelay.set(runId, delay);
      this.schedule(runId, delay);
    }).finally(() => {
      this.inFlight.delete(runId);
      if ((this.pending.get(runId)?.length ?? 0) > 0 && !this.timers.has(runId)) {
        this.schedule(runId, this.retryDelay.get(runId) ?? 0);
      }
    });
    this.inFlight.set(runId, write);
  }

  private clearTimer(runId: string): void {
    const timer = this.timers.get(runId);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(runId);
  }
}

export function createHoneycrispSessionBoundary(
  database: WorkspaceDatabase,
  ownershipEnabled = usesHoneycrispSessionOwnership()
): WorkspaceDatabase {
  if (!ownershipEnabled) return database;
  const storage: HoneycrispSessionStorage = {
    databasePath: database.getDatabasePath(),
    artifactDirectoryPath: join(dirname(database.getDatabasePath()), 'artifacts')
  };
  const workspaceId = database.getWorkspaceId();
  const sessionSummaries = listHoneycrispSessionSummaries(workspaceId, storage);
  let prefetchedSessionSummaries: HoneycrispSessionSummary[] | null = sessionSummaries;
  const ownedRunIds = new Set(sessionSummaries.map((session) => session.id));
  const nextTraceSequence = new Map(sessionSummaries.map((session) => [session.id, session.revision]));
  const traceWrites = new HoneycrispTraceWriteQueue(storage);
  let boundary!: WorkspaceDatabase;

  const getSession = (runId: string): HoneycrispSessionRecord | null => {
    if (!ownedRunIds.has(runId)) return null;
    return getHoneycrispSession(runId, storage);
  };
  const appendRecordEvent = (runId: string, kind: string, record: Record<string, unknown>): void => {
    appendHoneycrispSessionEvent(runId, {
      // The session log is append-only and deduplicates by event ID. Record IDs
      // identify the entity being revised, so reusing them here would discard
      // every update after the entity's creation.
      id: createId('event'),
      kind,
      timestamp: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
      summary: typeof record.summary === 'string' ? record.summary : kind,
      payload: { record }
    }, storage);
  };

  const overrides: Partial<Record<keyof WorkspaceDatabase, unknown>> = {
    createRun: ((input: Parameters<WorkspaceDatabase['createRun']>[0]): CreatedRunContext => {
      const engine = typeof input.budget.runEngine === 'string' ? input.budget.runEngine : null;
      if (engine !== 'honeycrisp') return database.createRun(input);
      const createdAt = new Date().toISOString();
      const runId = createId('run');
      const attemptId = createId('attempt');
      const run: RunRecord = {
        id: runId,
        scopeVersionId: input.scopeVersionId,
        researchProfileSnapshotId: input.researchProfileSnapshotId?.trim() || null,
        shellSafetyMode: input.shellSafetyMode,
        mode: input.mode,
        status: 'active',
        title: input.title,
        promptMarkdown: input.promptMarkdown,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        attemptStrategy: input.attemptStrategy,
        sandboxProfile: input.sandboxProfile,
        targetAssetId: input.targetAssetId ?? null,
        targetPath: input.targetPath ?? null,
        budget: input.budget,
        summary: 'Starting Honeycrisp-owned research session.',
        finalDisposition: null,
        createdAt,
        startedAt: createdAt,
        endedAt: null
      };
      const attempt: AttemptRecord = {
        id: attemptId,
        runId,
        parentAttemptId: null,
        status: 'active',
        shortState: 'Initializing Honeycrisp research plan.',
        seed: randomUUID(),
        strategyRole: 'initial_portfolio',
        cost: { label: '$0.00' },
        tokenUsage: { promptTokens: 0, completionTokens: 0, source: 'not_reported' },
        startedAt: createdAt,
        endedAt: null
      };
      createHoneycrispSession({
        id: runId,
        workspaceId,
        attemptId,
        title: run.title,
        prompt: run.promptMarkdown,
        provider: typeof input.budget.modelProvider === 'string' ? input.budget.modelProvider : null,
        model: run.model,
        reasoningEffort: run.reasoningEffort,
        workflowId: typeof input.budget.researchWorkflowId === 'string' ? input.budget.researchWorkflowId : null,
        profile: run.researchProfileSnapshotId
          ? { snapshotId: run.researchProfileSnapshotId }
          : null,
        metadata: { bealeRun: run },
        attemptMetadata: { bealeAttempt: attempt },
        createdAt
      }, storage);
      ownedRunIds.add(runId);
      prefetchedSessionSummaries = null;
      nextTraceSequence.set(runId, 1);
      return { run, attempt };
    }) as WorkspaceDatabase['createRun'],

    createAttempt: ((input: Parameters<WorkspaceDatabase['createAttempt']>[0]): AttemptRecord => {
      if (!ownedRunIds.has(input.runId)) return database.createAttempt(input);
      const startedAt = new Date().toISOString();
      const attempt: AttemptRecord = {
        id: createId('attempt'),
        runId: input.runId,
        parentAttemptId: input.parentAttemptId ?? null,
        status: input.status ?? 'active',
        shortState: input.shortState,
        seed: randomUUID(),
        strategyRole: input.strategyRole,
        cost: { label: '$0.00' },
        tokenUsage: { promptTokens: 0, completionTokens: 0, source: 'not_reported' },
        startedAt,
        endedAt: null
      };
      beginHoneycrispSessionAttempt(input.runId, {
        attemptId: attempt.id,
        parentAttemptId: attempt.parentAttemptId,
        summary: attempt.shortState,
        startedAt,
        metadata: { bealeAttempt: attempt }
      }, storage);
      return attempt;
    }) as WorkspaceDatabase['createAttempt'],

    getRun: ((runId: string): RunRecord | null => {
      const session = getSession(runId);
      return session ? sessionRun(session) : database.getRun(runId);
    }) as WorkspaceDatabase['getRun'],

    getRunDetail: ((runId: string): RunDetail => {
      const session = getSession(runId);
      return session ? sessionDetail(session, database) : database.getRunDetail(runId);
    }) as WorkspaceDatabase['getRunDetail'],

    getRunDetailVersion: ((runId: string): RunDetailVersion => {
      const session = getSession(runId);
      return session
        ? { runId, version: `honeycrisp:${session.revision}`, generatedAt: new Date().toISOString(), databaseMs: 0 }
        : database.getRunDetailVersion(runId);
    }) as WorkspaceDatabase['getRunDetailVersion'],

    getRunDetailUpdate: ((runId: string, _cursor: RunDetailUpdateCursor): RunDetailUpdate => {
      const session = getSession(runId);
      if (!session) return database.getRunDetailUpdate(runId, _cursor);
      const detail = sessionDetail(session, database);
      return {
        ...detail,
        version: { runId, version: `honeycrisp:${session.revision}`, generatedAt: new Date().toISOString(), databaseMs: 0 }
      };
    }) as WorkspaceDatabase['getRunDetailUpdate'],

    listRunRows: (() => {
      if (ownedRunIds.size === 0) return database.listRunRows();
      const sessions = prefetchedSessionSummaries ?? listHoneycrispSessionSummaries(workspaceId, storage);
      prefetchedSessionSummaries = null;
      for (const session of sessions) ownedRunIds.add(session.id);
      const honeycrispRows: RunRow[] = sessions.map((session) => {
        const recovery = sessionRecovery(session);
        return {
          run: sessionRun(session),
          engine: 'honeycrisp',
          sessionRuns: [{
            id: `session_run_${session.id}`,
            runId: session.id,
            attemptId: session.attempts.at(-1)?.id ?? null,
            status: sessionStatus(session.status),
            activityIntervals: [{
              id: `activity_${session.id}`,
              runId: session.id,
              attemptId: session.attempts.at(-1)?.id ?? null,
              startedAt: session.startedAt,
              endedAt: session.status === 'paused' && recovery ? recovery.recoveredAt : session.endedAt
            }],
            terminationCause: session.status === 'paused' && recovery ? 'workspace_recovery' : null
          }]
        };
      });
      return [...honeycrispRows, ...database.listRunRows().filter((row) => !ownedRunIds.has(row.run.id))];
    }) as WorkspaceDatabase['listRunRows'],

    appendTraceEvent: ((input: Parameters<WorkspaceDatabase['appendTraceEvent']>[0]): TraceEventRecord => {
      if (!ownedRunIds.has(input.runId)) return database.appendTraceEvent(input);
      const record: TraceEventRecord = {
        id: createId('trace'),
        runId: input.runId,
        attemptId: input.attemptId ?? null,
        sequence: (nextTraceSequence.get(input.runId) ?? 0) + 1,
        type: input.type,
        source: input.source,
        summary: input.summary,
        payload: input.payload ?? {},
        sensitivity: input.sensitivity ?? 'internal',
        modelVisible: input.modelVisible ?? true,
        createdAt: new Date().toISOString(),
        artifactId: input.artifactId ?? null,
        toolCallId: input.toolCallId ?? null,
        approvalId: input.approvalId ?? null
      };
      nextTraceSequence.set(input.runId, record.sequence);
      traceWrites.enqueue(input.runId, record);
      return record;
    }) as WorkspaceDatabase['appendTraceEvent'],

    createTranscriptMessage: ((input: Parameters<WorkspaceDatabase['createTranscriptMessage']>[0]): TranscriptMessageRecord => {
      if (!ownedRunIds.has(input.runId)) return database.createTranscriptMessage(input);
      const record: TranscriptMessageRecord = {
        id: createId('transcript'),
        runId: input.runId,
        attemptId: input.attemptId ?? null,
        traceEventId: input.traceEventId ?? null,
        role: input.role,
        phase: input.phase ?? null,
        contentMarkdown: input.contentMarkdown,
        source: input.source,
        metadata: input.metadata ?? {},
        createdAt: new Date().toISOString()
      };
      appendRecordEvent(input.runId, 'beale.transcript', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['createTranscriptMessage'],

    updateRunStatus: ((runId: string, status: Parameters<WorkspaceDatabase['updateRunStatus']>[1], summary: string, disposition?: Parameters<WorkspaceDatabase['updateRunStatus']>[3]) => {
      if (!ownedRunIds.has(runId)) return database.updateRunStatus(runId, status, summary, disposition);
      const session = transitionHoneycrispSession(runId, {
        status: sessionStatus(status),
        summary,
        ...(disposition ? { disposition } : {})
      }, storage);
      return sessionRun(session);
    }) as WorkspaceDatabase['updateRunStatus'],

    updateAttemptState: ((attemptId: string, status: Parameters<WorkspaceDatabase['updateAttemptState']>[1], shortState: string): void => {
      const runId = ownedRunIdForAttempt(ownedRunIds, storage, attemptId);
      if (!runId) return database.updateAttemptState(attemptId, status, shortState);
      transitionHoneycrispSession(runId, { status: sessionStatus(status), summary: shortState, attemptId }, storage);
    }) as WorkspaceDatabase['updateAttemptState'],

    beginSessionRunActivity: ((runId: string, attemptId: string): void => {
      if (!ownedRunIds.has(runId)) database.beginSessionRunActivity(runId, attemptId);
    }) as WorkspaceDatabase['beginSessionRunActivity'],

    updateRunTitle: ((runId: string, title: string): RunRecord => {
      if (!ownedRunIds.has(runId)) return database.updateRunTitle(runId, title);
      appendHoneycrispSessionEvent(runId, {
        id: createId('title'),
        kind: 'session.title',
        timestamp: new Date().toISOString(),
        summary: 'Session title updated.',
        payload: { status: 'generated', title }
      }, storage);
      return sessionRun(getHoneycrispSession(runId, storage));
    }) as WorkspaceDatabase['updateRunTitle'],

    updateRunShellSafetyMode: ((runId: string, shellSafetyMode: Parameters<WorkspaceDatabase['updateRunShellSafetyMode']>[1]): RunRecord => {
      if (!ownedRunIds.has(runId)) return database.updateRunShellSafetyMode(runId, shellSafetyMode);
      const current = getHoneycrispSession(runId, storage);
      const session = transitionHoneycrispSession(runId, {
        status: current.status,
        summary: current.summary,
        metadata: { shellSafetyMode }
      }, storage);
      return sessionRun(session);
    }) as WorkspaceDatabase['updateRunShellSafetyMode'],

    updateRunModelSelection: ((runId: string, selection: Parameters<WorkspaceDatabase['updateRunModelSelection']>[1]): RunRecord => {
      if (!ownedRunIds.has(runId)) return database.updateRunModelSelection(runId, selection);
      const session = getHoneycrispSession(runId, storage);
      const run = sessionRun(session);
      const updated = { ...run, model: selection.model, reasoningEffort: selection.reasoningEffort };
      const next = transitionHoneycrispSession(runId, {
        status: session.status,
        summary: session.summary,
        metadata: { bealeRun: updated }
      }, storage);
      return sessionRun(next);
    }) as WorkspaceDatabase['updateRunModelSelection'],

    updateRunBudget: ((runId: string, budgetPatch: Parameters<WorkspaceDatabase['updateRunBudget']>[1]): RunRecord => {
      if (!ownedRunIds.has(runId)) return database.updateRunBudget(runId, budgetPatch);
      const session = getHoneycrispSession(runId, storage);
      const run = sessionRun(session);
      const updated = { ...run, budget: { ...run.budget, ...budgetPatch } };
      const next = transitionHoneycrispSession(runId, {
        status: session.status,
        summary: session.summary,
        metadata: { bealeRun: updated }
      }, storage);
      return sessionRun(next);
    }) as WorkspaceDatabase['updateRunBudget'],

    getRunResearchProfileSnapshot: ((runId: string) => {
      const session = getSession(runId);
      if (!session) return database.getRunResearchProfileSnapshot(runId);
      const run = sessionRun(session);
      return run.researchProfileSnapshotId
        ? database.getResearchProfileSnapshot(run.researchProfileSnapshotId)
        : null;
    }) as WorkspaceDatabase['getRunResearchProfileSnapshot'],

    createModelSession: ((input: Parameters<WorkspaceDatabase['createModelSession']>[0]): ModelSessionRecord => {
      if (!ownedRunIds.has(input.runId)) return database.createModelSession(input);
      const now = new Date().toISOString();
      const record: ModelSessionRecord = {
        id: createId('model_session'),
        runId: input.runId,
        provider: input.provider,
        transport: input.transport,
        previousResponseId: input.previousResponseId ?? null,
        status: input.status,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now
      };
      appendRecordEvent(input.runId, 'beale.model_session', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['createModelSession'],

    updateModelSessionByRun: ((runId: string, patch: Parameters<WorkspaceDatabase['updateModelSessionByRun']>[1]): void => {
      if (!ownedRunIds.has(runId)) return database.updateModelSessionByRun(runId, patch);
      appendRecordEvent(runId, 'beale.model_session_update', { id: createId('model_session_update'), runId, patch, createdAt: new Date().toISOString() });
    }) as WorkspaceDatabase['updateModelSessionByRun'],

    upsertBreakoutRoom: ((input: Parameters<WorkspaceDatabase['upsertBreakoutRoom']>[0]): BreakoutRoomRecord => {
      if (!ownedRunIds.has(input.runId)) return database.upsertBreakoutRoom(input);
      const record: BreakoutRoomRecord = {
        id: input.id,
        runId: input.runId,
        attemptId: input.attemptId ?? null,
        name: input.name,
        title: input.title,
        purpose: input.purpose ?? '',
        kind: input.kind ?? 'general',
        status: input.status ?? 'active',
        phase: input.phase ?? (input.status === 'completed' ? 'completed' : 'independent'),
        challengeRound: input.challengeRound ?? 0,
        outcomeMarkdown: input.outcomeMarkdown ?? null,
        createdAt: input.createdAt ?? new Date().toISOString(),
        closedAt: input.closedAt ?? null
      };
      appendRecordEvent(input.runId, 'beale.breakout_room', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['upsertBreakoutRoom'],

    upsertBreakoutRoomMember: ((input: Parameters<WorkspaceDatabase['upsertBreakoutRoomMember']>[0]): BreakoutRoomMemberRecord => {
      if (!ownedRunIds.has(input.runId)) return database.upsertBreakoutRoomMember(input);
      const record: BreakoutRoomMemberRecord = {
        id: input.id,
        roomId: input.roomId,
        runId: input.runId,
        attemptId: input.attemptId ?? null,
        agentId: input.agentId,
        agentPath: input.agentPath,
        provider: input.provider,
        model: input.model,
        reasoningEffort: input.reasoningEffort ?? null,
        role: input.role ?? '',
        status: input.status,
        startedAt: input.startedAt ?? null,
        endedAt: input.endedAt ?? null,
        error: input.error ?? null
      };
      appendRecordEvent(input.runId, 'beale.breakout_member', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['upsertBreakoutRoomMember'],

    createBreakoutRoomMessage: ((input: Parameters<WorkspaceDatabase['createBreakoutRoomMessage']>[0]): BreakoutRoomMessageRecord => {
      if (!ownedRunIds.has(input.runId)) return database.createBreakoutRoomMessage(input);
      const record: BreakoutRoomMessageRecord = {
        id: input.id,
        roomId: input.roomId,
        runId: input.runId,
        attemptId: input.attemptId ?? null,
        memberId: input.memberId ?? null,
        senderAgentPath: input.senderAgentPath,
        recipientAgentPath: input.recipientAgentPath ?? null,
        kind: input.kind,
        contentMarkdown: input.contentMarkdown,
        evidenceRefs: input.evidenceRefs ?? [],
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? new Date().toISOString()
      };
      appendRecordEvent(input.runId, 'beale.breakout_message', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['createBreakoutRoomMessage'],

    findBreakoutRoomMember: ((runId: string, attemptId: string | null, agentPath: string): BreakoutRoomMemberRecord | null => {
      if (!ownedRunIds.has(runId)) return database.findBreakoutRoomMember(runId, attemptId, agentPath);
      return sessionDetail(getHoneycrispSession(runId, storage), database).breakoutRoomMembers
        ?.filter((member) => member.attemptId === attemptId && member.agentPath === agentPath)
        .at(-1) ?? null;
    }) as WorkspaceDatabase['findBreakoutRoomMember'],

    refreshBreakoutRoomStatus: ((roomId: string): BreakoutRoomRecord | null => {
      for (const runId of ownedRunIds) {
        const room = sessionDetail(getHoneycrispSession(runId, storage), database).breakoutRooms?.find((candidate) => candidate.id === roomId);
        if (room) return room;
      }
      return database.refreshBreakoutRoomStatus(roomId);
    }) as WorkspaceDatabase['refreshBreakoutRoomStatus'],

    createNotification: ((input: Parameters<WorkspaceDatabase['createNotification']>[0]): NotificationRecord => {
      if (!ownedRunIds.has(input.runId)) return database.createNotification(input);
      const record: NotificationRecord = {
        id: createId('notification'),
        runId: input.runId,
        traceEventId: input.traceEventId ?? null,
        kind: input.kind,
        title: input.title,
        bodyMarkdown: input.bodyMarkdown,
        status: 'unread',
        createdAt: new Date().toISOString(),
        openedAt: null,
        dismissedAt: null
      };
      appendRecordEvent(input.runId, 'beale.notification', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['createNotification'],

    createApproval: ((input: Parameters<WorkspaceDatabase['createApproval']>[0]): ApprovalRecord => {
      if (!ownedRunIds.has(input.runId)) return database.createApproval(input);
      const now = new Date().toISOString();
      const record: ApprovalRecord = {
        id: createId('approval'),
        runId: input.runId,
        attemptId: input.attemptId ?? null,
        requestKind: input.requestKind,
        requestedAction: input.requestedAction,
        decision: input.pending ? 'pending' : input.decision,
        reason: input.reason,
        scopeAmendmentId: input.scopeAmendmentId ?? null,
        createdAt: now,
        decidedAt: input.pending ? null : now
      };
      appendRecordEvent(input.runId, 'beale.approval', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['createApproval'],

    updateApprovalDecision: ((approvalId: string, runId: string, decision: string, reason: string): ApprovalRecord => {
      if (!ownedRunIds.has(runId)) return database.updateApprovalDecision(approvalId, runId, decision, reason);
      const existing = sessionDetail(getHoneycrispSession(runId, storage), database).policyEvents.find((approval) => approval.id === approvalId);
      if (!existing) throw new Error(`Approval not found for run ${runId}: ${approvalId}`);
      const record = { ...existing, decision, reason, decidedAt: new Date().toISOString() };
      appendRecordEvent(runId, 'beale.approval', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['updateApprovalDecision'],

    createArtifact: ((input: Parameters<WorkspaceDatabase['createArtifact']>[0]): ArtifactRecord => {
      const metadata = input.metadata ?? {};
      const runId = stringValue(metadata.runId);
      if (!runId || !ownedRunIds.has(runId)) return database.createArtifact(input);
      const buffer = typeof input.content === 'string' ? Buffer.from(input.content) : input.content;
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const record: ArtifactRecord = {
        id: createId('artifact'),
        sha256,
        relativePath: join('.honeycrisp', 'artifacts', sha256.slice(0, 2), sha256),
        kind: input.kind,
        sizeBytes: buffer.byteLength,
        mimeType: input.mimeType,
        sensitivity: input.sensitivity,
        modelVisible: input.modelVisible,
        provenanceTraceEventId: null,
        source: input.source,
        metadata,
        createdAt: new Date().toISOString()
      };
      appendRecordEvent(runId, 'beale.artifact', record as unknown as Record<string, unknown>);
      return record;
    }) as WorkspaceDatabase['createArtifact'],

    getFirstAttempt: ((runId: string): AttemptRecord | null => {
      if (!ownedRunIds.has(runId)) return database.getFirstAttempt(runId);
      return sessionDetail(getHoneycrispSession(runId, storage), database).attempts[0] ?? null;
    }) as WorkspaceDatabase['getFirstAttempt'],

    getFirstArtifact: ((runId: string): ArtifactRecord | null => {
      if (!ownedRunIds.has(runId)) return database.getFirstArtifact(runId);
      return sessionDetail(getHoneycrispSession(runId, storage), database).artifacts[0] ?? null;
    }) as WorkspaceDatabase['getFirstArtifact'],

    listPendingShellApprovals: (() => {
      const canonical = [...ownedRunIds].flatMap((runId) => sessionDetail(getHoneycrispSession(runId, storage), database).policyEvents)
        .filter((approval) => approval.requestKind === 'shell_command' && approval.decision === 'pending');
      return [...canonical, ...database.listPendingShellApprovals()];
    }) as WorkspaceDatabase['listPendingShellApprovals'],

    listNotifications: ((status: Parameters<WorkspaceDatabase['listNotifications']>[0] = 'unread') => {
      const canonical = [...ownedRunIds].flatMap((runId) => sessionNotifications(getHoneycrispSession(runId, storage)))
        .filter((notification) => notification.status === status);
      return [...canonical, ...database.listNotifications(status)];
    }) as WorkspaceDatabase['listNotifications'],

    searchTranscriptMessages: ((input: SessionTranscriptSearchInput, context: Parameters<WorkspaceDatabase['searchTranscriptMessages']>[1]): SessionTranscriptSearchResponse => {
      if (ownedRunIds.size === 0) return database.searchTranscriptMessages(input, context);
      return mergeTranscriptSearch(
        input,
        [{ databaseWorkspaceId: workspaceId, ...context }],
        database.searchTranscriptMessages(input, context),
        storage,
        database
      );
    }) as WorkspaceDatabase['searchTranscriptMessages'],

    searchTranscriptMessagesAcrossWorkspaces: ((input: SessionTranscriptSearchInput, contexts: Parameters<WorkspaceDatabase['searchTranscriptMessagesAcrossWorkspaces']>[1]): SessionTranscriptSearchResponse => {
      return mergeTranscriptSearch(
        input,
        contexts,
        database.searchTranscriptMessagesAcrossWorkspaces(input, contexts),
        storage,
        database
      );
    }) as WorkspaceDatabase['searchTranscriptMessagesAcrossWorkspaces'],

    interruptActiveBreakoutRooms: ((runId: string, attemptId?: string | null, endedAt?: string): void => {
      if (!ownedRunIds.has(runId)) database.interruptActiveBreakoutRooms(runId, attemptId, endedAt);
    }) as WorkspaceDatabase['interruptActiveBreakoutRooms']
  };

  boundary = new Proxy(database, {
    get(target, property, receiver) {
      const override = overrides[property as keyof WorkspaceDatabase];
      if (override !== undefined) return override;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
  BOUNDARIES.add(boundary);
  BOUNDARY_CONTEXTS.set(boundary, { database, ownedRunIds, storage, traceWrites });
  return boundary;
}

export function isHoneycrispSessionBoundary(database: WorkspaceDatabase): boolean {
  return BOUNDARIES.has(database);
}

export function listHoneycrispPendingApprovalsForRuns(
  database: WorkspaceDatabase,
  runIds: readonly string[]
): ApprovalRecord[] {
  const context = BOUNDARY_CONTEXTS.get(database);
  if (!context) return database.listPendingShellApprovals();
  const canonical = runIds
    .filter((runId) => context.ownedRunIds.has(runId))
    .flatMap((runId) => sessionDetail(getHoneycrispSession(runId, context.storage), context.database).policyEvents)
    .filter((approval) => approval.requestKind === 'shell_command' && approval.decision === 'pending');
  return [...canonical, ...context.database.listPendingShellApprovals()];
}

export function listHoneycrispNotificationsForRuns(
  database: WorkspaceDatabase,
  runIds: readonly string[],
  status: Parameters<WorkspaceDatabase['listNotifications']>[0] = 'unread'
): NotificationRecord[] {
  const context = BOUNDARY_CONTEXTS.get(database);
  if (!context) return database.listNotifications(status);
  const canonical = runIds
    .filter((runId) => context.ownedRunIds.has(runId))
    .flatMap((runId) => sessionNotifications(getHoneycrispSession(runId, context.storage)))
    .filter((notification) => notification.status === status);
  return [...canonical, ...context.database.listNotifications(status)];
}

export function markHoneycrispSessionInterrupted(
  database: WorkspaceDatabase,
  runId: string,
  attemptId: string,
  reason = 'app_shutdown'
): boolean {
  const context = BOUNDARY_CONTEXTS.get(database);
  if (!context?.ownedRunIds.has(runId)) return false;
  const recoveredAt = new Date().toISOString();
  transitionHoneycrispSession(runId, {
    status: 'paused',
    summary: 'Paused after Beale closed the active Honeycrisp process.',
    attemptId,
    at: recoveredAt,
    metadata: {
      interruptedByRecovery: true,
      recoveryReason: reason,
      recoveredAt,
      previousStatus: 'active',
      recoveredAttemptIds: [attemptId]
    }
  }, context.storage);
  return true;
}

export async function flushHoneycrispSessionWrites(database: WorkspaceDatabase, runId?: string): Promise<void> {
  await BOUNDARY_CONTEXTS.get(database)?.traceWrites.flush(runId);
}

export async function getHoneycrispRunDetailForClient(
  database: WorkspaceDatabase,
  runId: string,
  signal?: AbortSignal
): Promise<RunDetail | null> {
  const context = BOUNDARY_CONTEXTS.get(database);
  if (!context?.ownedRunIds.has(runId)) return null;
  const session = await getHoneycrispSessionAsync(runId, context.storage, signal);
  return sessionDetail(session, context.database);
}

export async function getHoneycrispRunDetailVersionForClient(
  database: WorkspaceDatabase,
  runId: string,
  signal?: AbortSignal
): Promise<RunDetailVersion | null> {
  const context = BOUNDARY_CONTEXTS.get(database);
  if (!context?.ownedRunIds.has(runId)) return null;
  const session = await getHoneycrispSessionAsync(runId, context.storage, signal);
  return {
    runId,
    version: `honeycrisp:${session.revision}`,
    generatedAt: new Date().toISOString(),
    databaseMs: 0
  };
}

export async function getHoneycrispRunDetailUpdateForClient(
  database: WorkspaceDatabase,
  runId: string,
  _cursor: RunDetailUpdateCursor,
  signal?: AbortSignal
): Promise<RunDetailUpdate | null> {
  const context = BOUNDARY_CONTEXTS.get(database);
  if (!context?.ownedRunIds.has(runId)) return null;
  const update = await getHoneycrispSessionUpdateAsync(
    runId,
    _cursor.afterTraceEventId ?? null,
    context.storage,
    signal
  );
  if (update.session.status !== 'active') {
    const session = await getHoneycrispSessionAsync(runId, context.storage, signal);
    return runDetailUpdateFromSession(session, context.database, _cursor);
  }
  const session: HoneycrispSessionRecord = {
    ...update.session,
    finalResponse: update.finalResponse,
    attempts: update.session.attempts.map((attempt) => ({ ...attempt, capture: null })),
    events: update.events
  };
  const detail = sessionDetail(session, context.database, update.eventOffset);
  return runDetailUpdateFromDetail(detail, update.session.revision);
}

function runDetailUpdateFromSession(
  session: HoneycrispSessionRecord,
  database: WorkspaceDatabase,
  cursor: RunDetailUpdateCursor
): RunDetailUpdate {
  const detail = sessionDetail(session, database);
  const afterTraceSequence = Number.isFinite(cursor.afterTraceSequence)
    ? Math.max(-1, cursor.afterTraceSequence)
    : -1;
  const afterTranscriptCount = Number.isFinite(cursor.afterTranscriptCount)
    ? Math.max(0, Math.floor(cursor.afterTranscriptCount))
    : 0;
  return runDetailUpdateFromDetail({
    ...detail,
    traceEvents: detail.traceEvents.filter((event) => event.sequence > afterTraceSequence),
    transcriptMessages: detail.transcriptMessages.slice(afterTranscriptCount)
  }, session.revision);
}

function runDetailUpdateFromDetail(detail: RunDetail, revision: number): RunDetailUpdate {
  return {
    ...detail,
    version: {
      runId: detail.run.id,
      version: `honeycrisp:${revision}`,
      generatedAt: new Date().toISOString(),
      databaseMs: 0
    }
  };
}

export function usesHoneycrispSessionOwnership(): boolean {
  const configured = process.env.BEALE_HONEYCRISP_SESSION_OWNERSHIP?.trim();
  if (configured === 'legacy') return false;
  if (configured === 'honeycrisp') return honeycrispOwnsSessions();
  return honeycrispOwnsSessions();
}

function sessionRun(session: HoneycrispSessionRecord | HoneycrispSessionSummary): RunRecord {
  const stored = recordValue(session.metadata.bealeRun);
  return {
    id: session.id,
    scopeVersionId: stringValue(stored?.scopeVersionId) ?? '',
    researchProfileSnapshotId: stringValue(stored?.researchProfileSnapshotId),
    shellSafetyMode: session.metadata.shellSafetyMode === 'manual_approval' || session.metadata.shellSafetyMode === 'danger'
      ? session.metadata.shellSafetyMode
      : stored?.shellSafetyMode === 'manual_approval' || stored?.shellSafetyMode === 'danger'
        ? stored.shellSafetyMode
        : 'auto_review',
    mode: stringValue(stored?.mode) ?? 'open_discovery',
    status: sessionStatus(session.status),
    title: session.title,
    promptMarkdown: session.prompt,
    model: session.model,
    reasoningEffort: session.reasoningEffort,
    attemptStrategy: stringValue(stored?.attemptStrategy) ?? 'iterative_research',
    sandboxProfile: stringValue(stored?.sandboxProfile) ?? 'host',
    targetAssetId: stringValue(stored?.targetAssetId),
    targetPath: stringValue(stored?.targetPath),
    budget: recordValue(stored?.budget) ?? {},
    summary: session.summary,
    finalDisposition: session.finalDisposition as RunRecord['finalDisposition'],
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt
  };
}

function isRootFinalResponse(message: TranscriptMessageRecord): boolean {
  if (message.role !== 'assistant' || message.phase !== 'final_answer') return false;
  const agentPath = stringValue(message.metadata.agentPath);
  return !agentPath || agentPath === '/root';
}

function sessionDetail(
  session: HoneycrispSessionRecord,
  database: WorkspaceDatabase,
  eventSequenceOffset = 0
): RunDetail {
  const run = sessionRun(session);
  const events = session.events;
  const traceEvents = events.flatMap((event, index) => traceFromSessionEvent(
    session.id,
    event,
    eventSequenceOffset + index + 1
  ));
  const transcripts = latestRecords(events.flatMap((event) => event.kind === 'beale.transcript'
    ? recordArrayValue<TranscriptMessageRecord>(event.payload)
    : []));
  const recovery = sessionRecovery(session);
  if (recovery && !transcripts.some((message) => message.metadata.interruptedByRecovery === true)) {
    transcripts.push({
      id: `transcript_recovery_${session.id}_${recovery.recoveredAt}`,
      runId: session.id,
      attemptId: recovery.attemptId,
      traceEventId: null,
      role: 'assistant',
      phase: 'final_answer',
      contentMarkdown: 'Unexpected error',
      source: 'honeycrisp',
      metadata: {
        finalResultKind: 'error',
        agentStatus: 'interrupted',
        agentPath: '/root',
        interruptedByRecovery: true,
        recoveredAt: recovery.recoveredAt,
        reason: recovery.reason
      },
      createdAt: recovery.recoveredAt
    });
  }
  if (
    session.status !== 'active' &&
    session.finalResponse &&
    !transcripts.some(isRootFinalResponse)
  ) {
    transcripts.push({
      id: `transcript_final_${session.id}_${session.revision}`,
      runId: session.id,
      attemptId: session.attempts.at(-1)?.id ?? null,
      traceEventId: null,
      role: 'assistant',
      phase: 'final_answer',
      contentMarkdown: session.finalResponse,
      source: 'honeycrisp',
      metadata: { agentPath: '/root' },
      createdAt: session.endedAt ?? session.updatedAt
    });
  }
  const modelSessions = materializedModelSessions(events).map((modelSession) => ({
    ...modelSession,
    status: session.status
  }));
  const captureArtifacts: ArtifactRecord[] = session.attempts.flatMap((attempt) => {
    if (!attempt.capture) return [];
    const serialized = JSON.stringify(attempt.capture.raw);
    const sha256 = createHash('sha256').update(serialized).digest('hex');
    const capturedAt = stringValue(attempt.capture.capturedAt) ?? session.updatedAt;
    return [{
      id: `capture_${session.id}_${attempt.id}`,
      sha256,
      relativePath: join('.beale', 'honeycrisp-runs', `${session.id}.${attempt.id}.capture.json`),
      kind: 'honeycrisp_flow_capture',
      sizeBytes: Buffer.byteLength(serialized),
      mimeType: 'application/json',
      sensitivity: 'internal',
      modelVisible: false,
      provenanceTraceEventId: null,
      source: 'honeycrisp',
      metadata: { capturedAt, attemptId: attempt.id },
      createdAt: capturedAt
    }];
  });
  return {
    run,
    researchProfile: run.researchProfileSnapshotId
      ? database.getResearchProfileSnapshot(run.researchProfileSnapshotId)
      : null,
    attempts: session.attempts.map((attempt) => {
      const stored = recordValue(attempt.metadata.bealeAttempt);
      return {
        id: attempt.id,
        runId: session.id,
        parentAttemptId: attempt.parentAttemptId,
        status: sessionStatus(attempt.status),
        shortState: attempt.summary,
        seed: stringValue(stored?.seed) ?? attempt.id,
        strategyRole: stringValue(stored?.strategyRole) ?? 'session_continuation',
        cost: recordValue(stored?.cost) ?? { label: '$0.00' },
        tokenUsage: recordValue(stored?.tokenUsage) ?? {},
        startedAt: attempt.startedAt,
        endedAt: attempt.endedAt
      };
    }),
    traceEvents,
    transcriptMessages: transcripts,
    breakoutRooms: latestRecords(events.flatMap((event) => event.kind === 'beale.breakout_room' ? recordArrayValue<BreakoutRoomRecord>(event.payload) : [])),
    breakoutRoomMembers: latestRecords(events.flatMap((event) => event.kind === 'beale.breakout_member' ? recordArrayValue<BreakoutRoomMemberRecord>(event.payload) : [])),
    breakoutRoomMessages: latestRecords(events.flatMap((event) => event.kind === 'beale.breakout_message' ? recordArrayValue<BreakoutRoomMessageRecord>(event.payload) : [])),
    artifacts: [...captureArtifacts, ...latestRecords(events.flatMap((event) => event.kind === 'beale.artifact' ? recordArrayValue<ArtifactRecord>(event.payload) : []))],
    verifierContracts: [],
    verifierRuns: [],
    modelSessions,
    contextCompactions: [],
    policyEvents: reconciledApprovalRecords(events, traceEvents),
    exports: []
  };
}

function traceFromSessionEvent(runId: string, event: HoneycrispSessionEvent, sequence: number): TraceEventRecord[] {
  if (event.kind === 'beale.trace_batch') {
    const records = recordValue(event.payload)?.records;
    if (!Array.isArray(records)) return [];
    const count = records.length;
    return records.flatMap((candidate, index) => {
      const stored = recordValue(candidate);
      return stored ? [storedTraceEvent(stored, event.id, sequence + ((index + 1) / (count + 1)))] : [];
    });
  }
  const stored = event.kind === 'beale.trace' ? recordValue(recordValue(event.payload)?.record) : null;
  if (stored) return [storedTraceEvent(stored, event.id)];
  const eventPayload = recordValue(event.payload);
  return [{
    id: event.id,
    runId,
    attemptId: stringValue(eventPayload?.attemptId),
    sequence,
    type: 'research_event',
    source: event.kind === 'session.recovery' ? 'system' : 'executor',
    summary: event.summary,
    payload: {
      honeycrispEventId: event.id,
      honeycrispKind: event.kind,
      honeycrispTimestamp: event.timestamp,
      payload: event.payload,
      ...(event.kind === 'session.recovery' && eventPayload ? eventPayload : {}),
      ...(event.agentId ? { agentId: event.agentId } : {}),
      ...(event.agentPath ? { agentPath: event.agentPath } : {}),
      ...(event.parentAgentId ? { parentAgentId: event.parentAgentId } : {})
    },
    sensitivity: 'internal',
    modelVisible: event.kind !== 'session.recovery',
    createdAt: event.timestamp,
    artifactId: null,
    toolCallId: null,
    approvalId: null
  }];
}

function storedTraceEvent(
  stored: Record<string, unknown>,
  sessionEventId: string,
  fallbackSequence?: number
): TraceEventRecord {
  const trace = stored as unknown as TraceEventRecord;
  return {
    ...trace,
    sequence: fallbackSequence ?? (typeof trace.sequence === 'number' ? trace.sequence : 0),
    payload: {
      ...(recordValue(trace.payload) ?? {}),
      honeycrispSessionEventId: sessionEventId
    }
  };
}

function sessionRecovery(session: HoneycrispSessionRecord | HoneycrispSessionSummary): { recoveredAt: string; reason: string; attemptId: string | null } | null {
  if (session.metadata.interruptedByRecovery !== true) return null;
  const recoveredAt = stringValue(session.metadata.recoveredAt);
  if (!recoveredAt) return null;
  const attemptIds = Array.isArray(session.metadata.recoveredAttemptIds)
    ? session.metadata.recoveredAttemptIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  return {
    recoveredAt,
    reason: stringValue(session.metadata.recoveryReason) ?? 'workspace_open',
    attemptId: attemptIds.at(-1) ?? null
  };
}

function ownedRunIdForAttempt(ownedRunIds: ReadonlySet<string>, storage: HoneycrispSessionStorage, attemptId: string): string | null {
  for (const runId of ownedRunIds) {
    if (getHoneycrispSession(runId, storage).attempts.some((attempt) => attempt.id === attemptId)) return runId;
  }
  return null;
}

function recordArrayValue<T>(payload: unknown): T[] {
  const record = recordValue(payload);
  return record?.record && isRecord(record.record) ? [record.record as unknown as T] : [];
}

function latestRecords<T extends { id: string }>(records: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const record of records) latest.set(record.id, record);
  return [...latest.values()];
}

function materializedModelSessions(events: readonly HoneycrispSessionEvent[]): ModelSessionRecord[] {
  const sessions = new Map<string, ModelSessionRecord>();
  let latestSessionId: string | null = null;
  for (const event of events) {
    if (event.kind === 'beale.model_session') {
      for (const session of recordArrayValue<ModelSessionRecord>(event.payload)) {
        sessions.set(session.id, session);
        latestSessionId = session.id;
      }
      continue;
    }
    if (event.kind !== 'beale.model_session_update' || !latestSessionId) continue;
    const update = recordArrayValue<{
      id: string;
      patch?: Record<string, unknown>;
      createdAt?: string;
    }>(event.payload)[0];
    const current = sessions.get(latestSessionId);
    const patch = recordValue(update?.patch);
    if (!current || !patch) continue;
    const metadata = recordValue(patch.metadata);
    sessions.set(latestSessionId, {
      ...current,
      ...(Object.prototype.hasOwnProperty.call(patch, 'previousResponseId')
        ? { previousResponseId: stringValue(patch.previousResponseId) }
        : {}),
      ...(stringValue(patch.status) ? { status: stringValue(patch.status)! } : {}),
      ...(metadata ? { metadata: { ...current.metadata, ...metadata } } : {}),
      updatedAt: stringValue(update?.createdAt) ?? event.timestamp
    });
  }
  return [...sessions.values()];
}

function reconciledApprovalRecords(
  events: readonly HoneycrispSessionEvent[],
  traceEvents: readonly TraceEventRecord[]
): ApprovalRecord[] {
  const approvals = latestRecords(events.flatMap((event) =>
    event.kind === 'beale.approval' ? recordArrayValue<ApprovalRecord>(event.payload) : []
  ));
  const resolutions = new Map<string, { decision: 'approved' | 'denied'; reason: string; decidedAt: string }>();
  for (const trace of traceEvents) {
    if (trace.type !== 'approval_event') continue;
    const approvalRequestId = stringValue(trace.payload.approvalRequestId);
    const decision = stringValue(trace.payload.decision);
    if (!approvalRequestId || (decision !== 'approved' && decision !== 'denied')) continue;
    resolutions.set(approvalRequestId, {
      decision,
      reason: stringValue(trace.payload.reason) ?? trace.summary,
      decidedAt: trace.createdAt
    });
  }
  return approvals.map((approval) => {
    if (approval.decision !== 'pending' || approval.decidedAt !== null) return approval;
    const approvalRequestId = stringValue(approval.requestedAction.approvalRequestId);
    const resolution = approvalRequestId ? resolutions.get(approvalRequestId) : undefined;
    return resolution ? { ...approval, ...resolution } : approval;
  });
}

function sessionNotifications(session: HoneycrispSessionRecord): NotificationRecord[] {
  return latestRecords(session.events.flatMap((event) => event.kind === 'beale.notification'
    ? recordArrayValue<NotificationRecord>(event.payload)
    : []));
}

function mergeTranscriptSearch(
  input: SessionTranscriptSearchInput,
  contexts: readonly {
    databaseWorkspaceId: string;
    registryWorkspaceId: string;
    workspacePath: string;
    workspaceName: string;
  }[],
  legacy: SessionTranscriptSearchResponse,
  storage: HoneycrispSessionStorage,
  database: WorkspaceDatabase
): SessionTranscriptSearchResponse {
  const query = input.query.trim().toLowerCase();
  if (!query) return legacy;
  const limit = Math.max(1, Math.floor(input.limit ?? 24));
  const canonicalResults = contexts.flatMap((context) => listHoneycrispSessions(context.databaseWorkspaceId, storage, 500)
    .flatMap((session) => sessionDetail(session, database).transcriptMessages
      .filter((message) => message.contentMarkdown.toLowerCase().includes(query))
      .map((message) => ({
        registryWorkspaceId: context.registryWorkspaceId,
        workspacePath: context.workspacePath,
        runId: session.id,
        transcriptMessageId: message.id,
        traceEventId: message.traceEventId,
        role: message.role,
        source: message.source,
        sessionTitle: session.title,
        workspaceName: context.workspaceName,
        contentPreview: message.contentMarkdown.slice(0, 500),
        createdAt: message.createdAt
      }))));
  const canonicalCounts = new Map<string, number>();
  for (const result of canonicalResults) {
    canonicalCounts.set(result.registryWorkspaceId, (canonicalCounts.get(result.registryWorkspaceId) ?? 0) + 1);
  }
  const canonicalWorkspaces = contexts.flatMap((context) => {
    const totalTranscriptMatches = canonicalCounts.get(context.registryWorkspaceId) ?? 0;
    return totalTranscriptMatches > 0
      ? [{
          registryWorkspaceId: context.registryWorkspaceId,
          workspacePath: context.workspacePath,
          workspaceName: context.workspaceName,
          totalTranscriptMatches
        }]
      : [];
  });
  const workspaceTotals = new Map<string, SessionTranscriptSearchResponse['workspaces'][number]>();
  for (const workspace of [...legacy.workspaces, ...canonicalWorkspaces]) {
    const existing = workspaceTotals.get(workspace.registryWorkspaceId);
    workspaceTotals.set(workspace.registryWorkspaceId, {
      ...workspace,
      totalTranscriptMatches: workspace.totalTranscriptMatches + (existing?.totalTranscriptMatches ?? 0)
    });
  }
  const results = [...canonicalResults, ...legacy.results]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
  const workspaces = [...workspaceTotals.values()];
  return {
    results,
    totalTranscriptMatches: workspaces.reduce((total, workspace) => total + workspace.totalTranscriptMatches, 0),
    workspaceCount: workspaces.length,
    workspaces
  };
}

function sessionStatus(status: string): RunRecord['status'] {
  return status === 'paused' || status === 'blocked' || status === 'completed' || status === 'failed' || status === 'stopped'
    ? status
    : 'active';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
