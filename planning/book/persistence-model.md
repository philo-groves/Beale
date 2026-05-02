# Persistence Model

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should use local embedded SQLite databases for authoritative persistent state.

Each Beale workspace directory gets its own database. Beale should not use one global database for all targets or programs.

Remote persistence, remote sync, and hosted storage are not first-release goals and should not be planned as an expected future path.

## Rationale

Authorized vulnerability research data is sensitive:

- Private source code.
- Closed-source binaries.
- Debug symbols.
- Crash inputs and corpora.
- Potential zero-days.
- Exploitability notes.
- Private program scope and authorization details.
- Disclosure drafts.
- Tool traces that may contain secrets or proprietary data.

Keeping persistence local reduces unnecessary exposure and makes the security model easier to reason about.

Per-workspace databases also reduce accidental cross-program lookup. A researcher working on multiple authorized programs on the same machine should not accidentally retrieve hypotheses, traces, artifacts, or findings from another program.

## Storage Layout

Proposed local workspace layout:

```text
.beale/
  beale.sqlite
  artifacts/
    sha256/
      ab/
        <sha256>
  exports/
  logs/
```

The exact directory names can change during implementation, but the isolation principle should not.

## Authoritative State

SQLite is the source of truth for structured state:

- Targets.
- Runs.
- Attempts.
- Hypotheses.
- Findings.
- Evidence.
- PoCs.
- Patches.
- Verifiers.
- Trace events.
- Tool calls.
- Artifact metadata.
- Search indexes.

Large binary payloads should not be stored directly in normal relational tables. They should live as files in the workspace artifact store and be referenced by content hash and metadata from SQLite.

## Human-Readable Projections

Markdown is still useful, but it is not authoritative run storage.

Use Markdown for:

- Research notes.
- Generated reports.
- Disclosure drafts.
- Exported finding summaries.
- Human-edited planning documents.

If Markdown is edited outside Beale, Beale should treat it as a document artifact unless a specific import flow is implemented.

## Search

Required:

- Structured search over entity fields, states, timestamps, paths, symbols, CVEs, CWEs, components, tool names, artifact hashes, and run IDs.
- SQLite full-text search over notes, summaries, hypotheses, findings, reports, and selected tool-output summaries.
- Per-program local semantic search over scoped workspace data, with per-program disable controls.

Semantic search must stay workspace-local and should never query across independent Beale workspaces.

## Trace Model

The trace should be append-oriented and stored in SQLite.

Trace events should capture:

- User actions.
- Model messages and output items.
- Tool calls and results.
- Tool stdout/stderr summaries and artifact references.
- Sandbox lifecycle events.
- Authorization and approval events.
- Hypothesis and finding state transitions.
- Verifier runs and results.

Raw large outputs should be artifact-backed rather than forced into trace rows.

## Backup and Export

Beale should support explicit local export/import later, but export is not the same as sync.

Useful exports:

- A complete workspace archive for backup.
- A finding disclosure package.
- A benchmark/regression run bundle.
- A redacted report package.

Exports must be user-initiated and should make included data clear before writing the archive.

## Non-Goals

- Remote-hosted project database.
- Cloud sync.
- Cross-workspace global search.
- Shared multi-user backend.
- Background upload of traces, artifacts, or findings.

## Planning Consequence

The storage schema should assume local-first isolation. Every entity belongs to one workspace database, and cross-program research correlation must be explicit import/export work rather than an accidental default.
