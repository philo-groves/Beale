import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '../src/main/databaseMigrations';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('database migrations', () => {
  it('records immutable component versions and rolls failed migrations back', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-migrations-'));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, 'memory.sqlite'));

    applyDatabaseMigrations(database, 'fixture', [{
      version: 1,
      name: 'baseline',
      up: (target) => target.exec("CREATE TABLE durable_rows (id TEXT PRIMARY KEY); INSERT INTO durable_rows VALUES ('preserved');")
    }]);

    expect(() => applyDatabaseMigrations(database, 'fixture', [
      { version: 1, name: 'baseline', up: () => undefined },
      {
        version: 2,
        name: 'broken_change',
        up: (target) => {
          target.exec("INSERT INTO durable_rows VALUES ('rolled_back');");
          throw new Error('fixture failure');
        }
      }
    ])).toThrow(/broken_change/);
    expect(database.prepare('SELECT id FROM durable_rows ORDER BY id').all()).toEqual([{ id: 'preserved' }]);
    expect(database.prepare("SELECT version, name FROM schema_migrations WHERE component = 'fixture'").all()).toEqual([{ version: 1, name: 'baseline' }]);
    expect(() => applyDatabaseMigrations(database, 'fixture', [{ version: 1, name: 'renamed', up: () => undefined }])).toThrow(/renamed/);
    expect(() => applyDatabaseMigrations(database, 'gap', [{ version: 2, name: 'missing_baseline', up: () => undefined }])).toThrow(/contiguous/);

    database.close();
  });
});
