# SQLite Schema

Status: draft schema direction, 2026-04-27.

## Decision

Beale should start with a simple normalized SQLite schema that preserves the core research graph:

```text
workspace scope
  -> runs
  -> attempts
  -> trace events
  -> observations
  -> evidence
  -> hypotheses
  -> findings
  -> weakness mappings
  -> verifier contracts and results
  -> artifacts
```

The first schema should be explicit and queryable. It should avoid opaque document-only storage for core state, while still allowing JSON columns for versioned metadata that is not yet stable.

## Database Rules

- One SQLite database per workspace.
- No global cross-workspace database.
- Enable foreign keys.
- Use WAL mode for normal app operation.
- Store timestamps as UTC ISO-8601 text or integer epoch milliseconds consistently.
- Use stable text IDs for user-visible entities.
- Keep large binary payloads out of SQLite.
- Store artifact metadata in SQLite and artifact bytes in the content-addressed artifact store.
- Treat trace as append-oriented.
- Apply migrations with explicit schema versions.

## ID Strategy

Use stable text IDs for entities that appear in the UI or reports:

- `run_...`
- `attempt_...`
- `trace_...`
- `artifact_...`
- `hyp_...`
- `finding_...`
- `weakness_...`
- `verifier_...`
- `approval_...`
- `vm_...`

The exact generator can be ULID, UUIDv7, or another sortable unique ID. The important properties are stable references, low collision risk, and good ordering behavior.

## Core Tables

### `workspace_meta`

Purpose:

- Store workspace-local metadata and schema version.

Fields:

- `key`
- `value`
- `updated_at`

Required keys:

- `schema_version`
- `workspace_id`
- `created_at`

### `program_scope_versions`

Purpose:

- Store versioned authorization and scope state.

Fields:

- `id`
- `version`
- `status`
- `program_name`
- `organization_name`
- `description_markdown`
- `network_policy_json`
- `rules_markdown`
- `active_from`
- `expires_at`
- `created_at`
- `created_by`

Every run should reference the active scope version used at run start.

### `scope_assets`

Purpose:

- Store in-scope and out-of-scope assets.

Fields:

- `id`
- `scope_version_id`
- `direction`: `in_scope` or `out_of_scope`
- `kind`: `domain`, `host`, `ip_range`, `repo`, `binary`, `path`, `account`, `credential_ref`, `service`, `documentation`, `other`
- `value`
- `attributes_json`
- `sensitivity`
- `created_at`

### `project_inventory_items`

Purpose:

- Store the scoped program inventory used for cheap project orientation and index freshness.

Fields:

- `id`
- `scope_version_id`
- `asset_id`
- `item_kind`: `directory`, `file`, or later resource kinds
- `resource_kind`: `directory`, `source`, `manifest`, `binary`, `text`, `archive`, `unknown`
- `path`
- `value`
- `language`
- `size_bytes`
- `mtime_ms`
- `sha256`
- `sensitivity`
- `metadata_json`
- `indexed_at`

### `project_search_documents`

Purpose:

- Store normalized lexical and metadata documents for scoped project search.

Fields:

- `id`
- `scope_version_id`
- `run_id`
- `entity_type`
- `entity_id`
- `title`
- `body`
- `source_path`
- `metadata_json`
- `created_at`
- `updated_at`

Indexed entity types include scope assets, inventory items, runs, transcripts, model-visible traces, artifacts, evidence, hypotheses, findings, verifier contracts, and verifier runs.

### `project_search_fts`

Purpose:

- SQLite FTS index backing lexical and metadata search.

Fields:

- `document_id`
- `scope_version_id`
- `run_id`
- `entity_type`
- `entity_id`
- `title`
- `body`

### `project_structure_entities`

Purpose:

- Store best-effort structural source entities for code navigation and relationship-aware search.

Fields:

- `id`
- `scope_version_id`
- `inventory_item_id`
- `asset_id`
- `entity_kind`: `function`, `method`, `class`, `type`, `route`, `import`, or later structural kinds
- `name`
- `signature`
- `path`
- `language`
- `line_start`
- `line_end`
- `parent_id`
- `metadata_json`
- `indexed_at`

### `project_structure_relations`

Purpose:

- Store lightweight structural edges discovered during indexing.

Fields:

- `id`
- `scope_version_id`
- `source_entity_id`
- `relation_kind`: examples include `imports` and `routes_to`
- `target_kind`
- `target_name`
- `target_entity_id`
- `metadata_json`
- `indexed_at`

### `runs`

Purpose:

- Store top-level research run state.

Fields:

- `id`
- `scope_version_id`
- `mode`: `open_discovery`, `targeted_reproduction`, `patch_validation`, `variant_analysis`, `benchmark`, `safety`
- `status`: `queued`, `active`, `paused`, `blocked`, `completed`, `failed`, `stopped`
- `title`
- `prompt_markdown`
- `model`
- `reasoning_effort`
- `attempt_strategy`
- `network_profile`
- `sandbox_profile`
- `target_asset_id`
- `target_path`
- `budget_json`
- `summary`
- `created_at`
- `started_at`
- `ended_at`

`target_asset_id` and `target_path` store the session's selected research target. They should be set when the run is created, then used by host/guest execution and artifact policy instead of repeatedly inferring the target from prompt text.

### `attempts`

Purpose:

- Store individual trajectories within a run.

Fields:

- `id`
- `run_id`
- `parent_attempt_id`
- `status`
- `short_state`
- `seed`
- `strategy_role`
- `vm_context_id`
- `cost_json`
- `token_usage_json`
- `started_at`
- `ended_at`

Attempts are the unit for forks, promotion, pause, and comparison.

### `trace_events`

Purpose:

- Store append-oriented run history.

Fields:

- `id`
- `run_id`
- `attempt_id`
- `sequence`
- `type`
- `source`: `user`, `model`, `tool`, `executor`, `verifier`, `policy`, `system`
- `summary`
- `payload_json`
- `sensitivity`
- `model_visible`
- `created_at`
- `vm_context_id`
- `artifact_id`
- `tool_call_id`
- `approval_id`

Important event types:

- `user_scope`
- `user_note`
- `model_message`
- `tool_call`
- `tool_result`
- `artifact_created`
- `vm_event`
- `approval_event`
- `hypothesis_event`
- `verifier_result`
- `finding_event`
- `network_event`

### `tool_calls`

Purpose:

- Store structured tool request and result metadata.

Fields:

- `id`
- `run_id`
- `attempt_id`
- `tool_name`
- `tool_version`
- `input_json`
- `status`
- `result_summary`
- `result_json`
- `started_at`
- `ended_at`
- `policy_decision_id`
- `vm_context_id`
- `trace_event_id`

Large stdout, stderr, debugger transcripts, and generated files should become artifacts.

### `vm_contexts`

Purpose:

- Store executor context and sandbox lifecycle state.

Fields:

- `id`
- `backend`
- `image_id`
- `snapshot_id`
- `state`: `clean`, `working`, `contaminated`, `preserved`, `destroyed`
- `network_profile`
- `scope_version_id`
- `created_at`
- `destroyed_at`
- `metadata_json`

### `artifacts`

Purpose:

- Store artifact metadata.

Fields:

- `id`
- `sha256`
- `relative_path`
- `kind`
- `size_bytes`
- `mime_type`
- `sensitivity`
- `model_visible`
- `provenance_trace_event_id`
- `source`: `user_import`, `vm_export`, `verifier`, `report`, `benchmark`
- `metadata_json`
- `created_at`

The file path should point into `.beale/artifacts/sha256/...`.

### `hypotheses`

Purpose:

- Store candidate vulnerability theories.

Fields:

- `id`
- `run_id`
- `parent_hypothesis_id`
- `state`: `hypothesis`, `needs_evidence`, `reproduced`, `dismissed`, `out_of_scope`, `duplicate`
- `title`
- `description_markdown`
- `component`
- `bug_class`
- `priority_score`
- `attacker_reachability`
- `impact`
- `evidence_confidence`
- `exploit_practicality`
- `scope_confidence`
- `created_trace_event_id`
- `created_at`
- `updated_at`

Primary and alternate CWE mappings live in `weakness_mappings`.

### `cwe_catalogs`

Purpose:

- Record the source metadata for the local CWE catalog used by Beale.

Fields:

- `id`
- `source_url`
- `catalog_version`
- `view_id`
- `imported_at`
- `metadata_json`

### `cwe_entries`

Purpose:

- Cache CWE entries used for hypothesis and finding classification.

Fields:

- `cwe_id`
- `name`
- `abstraction`
- `status`
- `description`
- `parent_ids_json`
- `view_ids_json`
- `mapping_status`: `allowed`, `discouraged`, `prohibited`, `unknown`
- `catalog_version`
- `updated_at`

### `weakness_mappings`

Purpose:

- Link hypotheses and findings to primary or alternate CWE classifications.

Fields:

- `id`
- `entity_kind`: `hypothesis`, `finding`
- `entity_id`
- `cwe_id`
- `cwe_name`
- `mapping_role`: `primary`, `alternate`
- `mapping_status`: `allowed`, `discouraged`, `prohibited`, `unknown`
- `confidence`: `low`, `medium`, `high`
- `rationale_markdown`
- `source`: `model`, `user`, `import`, `system`
- `created_at`
- `updated_at`

CWE mappings guide triage and export. They do not promote findings or replace evidence.

### `evidence`

Purpose:

- Link observations and artifacts into reusable evidence objects.

Fields:

- `id`
- `run_id`
- `hypothesis_id`
- `finding_id`
- `kind`
- `summary`
- `observation_trace_event_id`
- `artifact_id`
- `verifier_run_id`
- `created_at`

Evidence should not point only to model messages.

### `findings`

Purpose:

- Store promoted vulnerability findings.

Fields:

- `id`
- `run_id`
- `hypothesis_id`
- `state`: `needs_evidence`, `reproduced`, `verified`, `reportable`, `patched`, `dismissed`, `out_of_scope`
- `title`
- `summary_markdown`
- `affected_assets_json`
- `affected_versions_json`
- `impact_markdown`
- `priority_score`
- `verified_by_verifier_run_id`
- `created_at`
- `updated_at`

### `verifier_contracts`

Purpose:

- Store rerunnable verifier definitions.

Fields:

- `id`
- `run_id`
- `hypothesis_id`
- `finding_id`
- `mode`
- `status`
- `target_states_json`
- `setup_steps_markdown`
- `trigger_steps_markdown`
- `expected_observations_json`
- `invariants_json`
- `artifacts_to_collect_json`
- `pass_criteria_json`
- `created_at`
- `updated_at`

### `verifier_runs`

Purpose:

- Store verifier execution results.

Fields:

- `id`
- `contract_id`
- `run_id`
- `attempt_id`
- `vm_context_id`
- `status`: `queued`, `running`, `pass`, `fail`, `inconclusive`, `error`
- `blocked_issue`: `yes`, `no`, `inconclusive`, `not_applicable`
- `behavior_preserved`: `yes`, `no`, `inconclusive`, `not_applicable`
- `diagnostics_clean`: `yes`, `no`, `inconclusive`, `not_applicable`
- `regression_tests`: `pass`, `fail`, `not_run`, `inconclusive`
- `result_json`
- `started_at`
- `ended_at`

### `approvals`

Purpose:

- Store user approvals, denials, and policy blocks.

Fields:

- `id`
- `run_id`
- `attempt_id`
- `request_kind`
- `requested_action_json`
- `decision`: `approved`, `denied`, `blocked`
- `reason`
- `scope_amendment_id`
- `created_at`
- `decided_at`

### `exports`

Purpose:

- Store report and bundle export metadata.

Fields:

- `id`
- `run_id`
- `finding_id`
- `kind`
- `relative_path`
- `redaction_policy_json`
- `included_artifacts_json`
- `created_at`

## Search Tables

Required early:

- Indexes over run status, attempt status, trace sequence, artifact hash, hypothesis state, finding state, weakness mapping entity/CWE, verifier status, and scope asset kind/value.
- SQLite FTS over selected summaries, notes, hypotheses, findings, report drafts, and tool-output summaries.

Optional later:

- Workspace-local semantic index.

Semantic search must not cross workspace boundaries.

## Migration Strategy

Use a migration table:

```text
schema_migrations
  version
  name
  applied_at
```

Rules:

- Migrations are append-only.
- Released migrations are immutable.
- Migration tests should create old schemas and upgrade them.
- Failed migrations must leave a recoverable database or a backup copy.

## Schema Details to Finalize

- Exact ID format.
- Exact JSON validation mechanism.
- Whether to split model messages into a separate table or keep them as trace events plus payload.
- Whether to store FTS content directly or via external-content FTS tables.
- How much report drafting state belongs in SQLite versus generated Markdown artifacts.
