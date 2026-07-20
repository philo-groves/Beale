# Persistence Model

Status: accepted initial direction, 2026-04-26.

## Decision

Beale and Honeycrisp should use one local embedded SQLite database for authoritative workspace state. Honeycrisp owns the database contract so headless and desktop operation are compatible without synchronization or import steps.

Each Beale workspace directory gets its own research database. Beale should not use one global database for all research contexts.

Repository checkout storage is the exception: source code may be stored once in a user-global Beale repository store and referenced from multiple workspace databases. The reference is workspace-local, and a global checkout is not globally visible to agents.

Remote persistence, remote sync, and hosted storage are not first-release goals and should not be planned as an expected future path.

## Rationale

Authorized vulnerability research data is sensitive:

- Private source code.
- Closed-source binaries.
- Debug symbols.
- Crash inputs and corpora.
- Potential zero-days.
- Exploitability notes.
- Private scope and authorization details.
- Disclosure drafts.
- Tool traces that may contain secrets or proprietary data.

Keeping persistence local reduces unnecessary exposure and makes the security model easier to reason about.

Per-workspace databases also reduce accidental cross-scope lookup. A researcher working on multiple authorized contexts on the same machine should not accidentally retrieve hypotheses, traces, artifacts, or findings from another workspace.

## Storage Layout

Proposed local workspace layout:

```text
.honeycrisp/
  memory/
    memory.sqlite
    artifacts/
.beale/
  artifacts/
    sha256/
      ab/
        <sha256>
  exports/
  logs/
```

The exact directory names can change during implementation, but the isolation principle should not.

## Authoritative State

`.honeycrisp/memory/memory.sqlite` is the source of truth for structured state. Operational tables include:

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

Durable knowledge is a separate logical layer in the same database. It contains concise typed nodes, normalized asset and tag links, directed relationships, revisions, and evidence references. Run events, transcripts, goals, and bulk outputs are operational data and must not be promoted automatically into durable knowledge.

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
- Per-workspace local semantic search over scoped data, with per-workspace disable controls.

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

The storage schema should assume local-first isolation. Every entity belongs to one workspace database, and cross-workspace research correlation must be explicit import/export work rather than an accidental default.
