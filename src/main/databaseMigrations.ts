import type { DatabaseSync } from 'node:sqlite';

export interface DatabaseMigration {
  version: number;
  name: string;
  up(database: DatabaseSync): void;
}

interface AppliedMigration {
  version: number;
  name: string;
}

export function applyDatabaseMigrations(database: DatabaseSync, component: string, migrations: readonly DatabaseMigration[]): void {
  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  validateMigrations(component, ordered);

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      component TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY(component, version)
    );
  `);

  const applied = database
    .prepare('SELECT version, name FROM schema_migrations WHERE component = ? ORDER BY version')
    .all(component) as unknown as AppliedMigration[];
  if (applied.some((row, index) => row.version !== index + 1)) {
    throw new Error(`Database migration history for ${component} is not contiguous.`);
  }
  const knownByVersion = new Map(ordered.map((migration) => [migration.version, migration]));

  for (const row of applied) {
    const known = knownByVersion.get(row.version);
    if (!known) {
      throw new Error(`Database component ${component} has unknown migration version ${row.version}.`);
    }
    if (known.name !== row.name) {
      throw new Error(`Database component ${component} migration ${row.version} was renamed from ${row.name} to ${known.name}.`);
    }
  }

  const appliedVersions = new Set(applied.map((row) => row.version));
  for (const migration of ordered) {
    if (appliedVersions.has(migration.version)) continue;

    database.exec('BEGIN IMMEDIATE;');
    try {
      migration.up(database);
      database
        .prepare('INSERT INTO schema_migrations (component, version, name, applied_at) VALUES (?, ?, ?, ?)')
        .run(component, migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw new Error(`Failed to apply ${component} database migration ${migration.version} (${migration.name}).`, { cause: error });
    }
  }
}

function validateMigrations(component: string, migrations: readonly DatabaseMigration[]): void {
  const versions = new Set<number>();
  for (const [index, migration] of migrations.entries()) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Database component ${component} has an invalid migration version: ${migration.version}.`);
    }
    if (!migration.name.trim()) {
      throw new Error(`Database component ${component} migration ${migration.version} has no name.`);
    }
    if (versions.has(migration.version)) {
      throw new Error(`Database component ${component} defines migration ${migration.version} more than once.`);
    }
    if (migration.version !== index + 1) {
      throw new Error(`Database component ${component} migration versions must be contiguous starting at 1.`);
    }
    versions.add(migration.version);
  }
}
