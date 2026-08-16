import type { WorkspaceDatabase } from '../src/main/database';
import type { WorkspaceSnapshot } from '../src/shared/types';
import type { WorkspaceService } from '../src/main/workspaceService';
import { FixtureRunEngine, type FixtureStartRunInput } from './fixtureRunEngine';

const engines = new WeakMap<WorkspaceService, { db: WorkspaceDatabase; engine: FixtureRunEngine }>();

export function startRunForTest(
  service: WorkspaceService,
  input: FixtureStartRunInput,
  mode: 'scheduled' | 'complete' = 'complete'
): WorkspaceSnapshot {
  const db = (service as unknown as { db: WorkspaceDatabase | null }).db;
  if (!db) throw new Error('No Beale workspace is open');
  const snapshot = service.getSnapshot();
  if (!snapshot) throw new Error('No Beale workspace snapshot is available');
  const existing = engines.get(service);
  if (existing && existing.db !== db) existing.engine.dispose();
  const engine = existing?.db === db ? existing.engine : new FixtureRunEngine(db);
  engines.set(service, { db, engine });
  engine.startRun(input, mode, snapshot.researchProfile.id);
  const updated = service.getSnapshot();
  if (!updated) throw new Error('No Beale workspace snapshot is available');
  return updated;
}
