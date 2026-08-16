/**
 * Frozen SQL retained only so historical Beale schema migrations remain
 * replayable. Honeycrisp owns current Dreaming schema initialization.
 */
export const MEMORY_DREAMING_RUN_PROVENANCE_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS beale_memory_dreaming_run_provenance_complete_insert
BEFORE INSERT ON memory_dreaming_runs
WHEN NOT (((NEW.research_profile_hash IS NULL AND NEW.research_profile_id IS NULL AND NEW.research_profile_version IS NULL AND NEW.memory_catalog_hash IS NULL)) OR ((NEW.research_profile_hash IS NOT NULL AND NEW.research_profile_id IS NOT NULL AND NEW.research_profile_version IS NOT NULL AND NEW.memory_catalog_hash IS NOT NULL)))
BEGIN
  SELECT RAISE(ABORT, 'memory Dreaming run provenance must be complete');
END;
CREATE TRIGGER IF NOT EXISTS beale_memory_dreaming_run_provenance_immutable
BEFORE UPDATE OF research_profile_hash, research_profile_id, research_profile_version, memory_catalog_hash ON memory_dreaming_runs
WHEN NOT (NEW.research_profile_hash IS OLD.research_profile_hash AND NEW.research_profile_id IS OLD.research_profile_id AND NEW.research_profile_version IS OLD.research_profile_version AND NEW.memory_catalog_hash IS OLD.memory_catalog_hash)
BEGIN
  SELECT RAISE(ABORT, 'memory Dreaming run provenance is immutable');
END;
`;

export const MEMORY_DREAMING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_dreaming_runs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'restored', 'failed')),
  stale_hidden_count INTEGER NOT NULL DEFAULT 0, duplicate_hidden_count INTEGER NOT NULL DEFAULT 0,
  duplicate_group_count INTEGER NOT NULL DEFAULT 0, reclassified_node_count INTEGER NOT NULL DEFAULT 0,
  edited_node_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, completed_at TEXT NOT NULL,
  restored_at TEXT, model TEXT NOT NULL DEFAULT 'unknown', reasoning_effort TEXT NOT NULL DEFAULT 'unknown',
  input_node_count INTEGER NOT NULL DEFAULT 0, input_session_count INTEGER NOT NULL DEFAULT 0, error_message TEXT,
  research_profile_hash TEXT, research_profile_id TEXT, research_profile_version TEXT, memory_catalog_hash TEXT,
  CHECK (((research_profile_hash IS NULL AND research_profile_id IS NULL AND research_profile_version IS NULL AND memory_catalog_hash IS NULL)) OR ((research_profile_hash IS NOT NULL AND research_profile_id IS NOT NULL AND research_profile_version IS NOT NULL AND memory_catalog_hash IS NOT NULL)))
);
CREATE TABLE IF NOT EXISTS memory_dreaming_changes (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES memory_dreaming_runs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('prune', 'merge_duplicates', 'revise', 'reclassify')),
  title TEXT NOT NULL, node_type TEXT NOT NULL, hidden_node_ids_json TEXT NOT NULL, survivor_node_id TEXT,
  reason TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL, restored_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_dreaming_runs_workspace_created ON memory_dreaming_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_dreaming_changes_workspace_created ON memory_dreaming_changes(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_dreaming_changes_run ON memory_dreaming_changes(run_id);
${MEMORY_DREAMING_RUN_PROVENANCE_TRIGGER_SQL}
`;
