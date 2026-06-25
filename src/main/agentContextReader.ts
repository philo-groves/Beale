import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentContextEventRecord, AgentContextState } from '@shared/types';

const MEMORY_DATABASE_RELATIVE_PATH = join('.honeycrisp', 'memory', 'memory.sqlite');

type SqlRow = Record<string, unknown>;

export function readHoneycrispAgentContext(workspacePath: string, runId: string): AgentContextState {
  const databasePath = join(workspacePath, MEMORY_DATABASE_RELATIVE_PATH);
  const base = emptyAgentContextState(runId, databasePath);

  if (!existsSync(databasePath)) {
    return base;
  }

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    if (!tableExists(database, 'memory_events')) {
      return {
        ...base,
        status: 'empty'
      };
    }

    const row = database
      .prepare(
        `SELECT sequence, event_id, timestamp, kind, goal_id, loop_id, sub_goal_id,
                payload_json, payload_hash, schema_version
         FROM memory_events
         WHERE kind = 'context.compiled'
         ORDER BY sequence DESC
         LIMIT 1`
      )
      .get() as SqlRow | undefined;

    if (!row) {
      return {
        ...base,
        status: 'empty'
      };
    }

    return {
      ...base,
      status: 'ready',
      event: contextEventFromRow(row)
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      lastError: error instanceof Error ? error.message : String(error)
    };
  } finally {
    database?.close();
  }
}

function emptyAgentContextState(runId: string, databasePath: string): AgentContextState {
  return {
    runId,
    source: 'honeycrisp_sqlite',
    status: 'missing',
    databasePath,
    readAt: new Date().toISOString(),
    event: null,
    lastError: null
  };
}

function contextEventFromRow(row: SqlRow): AgentContextEventRecord {
  return {
    sequence: numberValue(row, 'sequence'),
    eventId: stringValue(row, 'event_id'),
    timestamp: stringValue(row, 'timestamp'),
    kind: 'context.compiled',
    goalId: nullableString(row, 'goal_id'),
    loopId: nullableString(row, 'loop_id'),
    subGoalId: nullableString(row, 'sub_goal_id'),
    payloadHash: stringValue(row, 'payload_hash'),
    schemaVersion: numberValue(row, 'schema_version'),
    payload: parsePayload(stringValue(row, 'payload_json'))
  };
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  const parsed = JSON.parse(payloadJson) as unknown;
  return isRecord(parsed) ? parsed : { value: parsed };
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function numberValue(row: SqlRow, key: string): number {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
}

function stringValue(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

function nullableString(row: SqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
