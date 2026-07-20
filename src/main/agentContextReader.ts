import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentContextEventRecord, AgentContextState } from '@shared/types';

const DATABASE_RELATIVE_PATH = join('.honeycrisp', 'memory', 'memory.sqlite');
type SqlRow = Record<string, unknown>;

export function readHoneycrispAgentContext(workspacePath: string, runId: string): AgentContextState {
  const databasePath = join(workspacePath, DATABASE_RELATIVE_PATH);
  const base = emptyState(runId, databasePath);
  if (!existsSync(databasePath)) return base;

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    if (!tableExists(database, 'trace_events')) return { ...base, status: 'empty' };
    const row = database.prepare(
      `SELECT sequence, created_at, payload_json
       FROM trace_events
       WHERE run_id = ? AND json_extract(payload_json, '$.honeycrispKind') = 'context.compiled'
       ORDER BY sequence DESC LIMIT 1`
    ).get(runId) as SqlRow | undefined;
    if (!row) return { ...base, status: 'empty' };
    return { ...base, status: 'ready', event: contextEventFromTrace(row) };
  } catch (error) {
    return { ...base, status: 'error', lastError: error instanceof Error ? error.message : String(error) };
  } finally {
    database?.close();
  }
}

function emptyState(runId: string, databasePath: string): AgentContextState {
  return { runId, source: 'honeycrisp_sqlite', status: 'missing', databasePath, readAt: new Date().toISOString(), event: null, lastError: null };
}

function contextEventFromTrace(row: SqlRow): AgentContextEventRecord {
  const wrapper = parseObject(requiredString(row.payload_json));
  const payload = isRecord(wrapper.payload) ? wrapper.payload : {};
  const timestamp = optionalString(wrapper.honeycrispTimestamp) ?? requiredString(row.created_at);
  const serializedPayload = JSON.stringify(payload);
  return {
    sequence: typeof wrapper.honeycrispSequence === 'number' ? wrapper.honeycrispSequence : requiredNumber(row.sequence),
    eventId: optionalString(wrapper.honeycrispEventId) ?? `context_${requiredNumber(row.sequence)}`,
    timestamp,
    kind: 'context.compiled',
    goalId: optionalString(payload.goalId),
    loopId: optionalString(payload.loopId),
    subGoalId: optionalString(payload.subGoalId),
    payloadHash: optionalString(payload.payloadHash) ?? createHash('sha256').update(serializedPayload).digest('hex'),
    schemaVersion: typeof payload.schemaVersion === 'number' ? payload.schemaVersion : 1,
    payload
  };
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected SQLite text value.');
  return value;
}

function optionalString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected SQLite numeric value.');
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
