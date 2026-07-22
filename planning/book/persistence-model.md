# Persistence Model

Status: revised global-database direction, 2026-07-21.

## Decision

Beale and Honeycrisp use one user-global embedded SQLite database at `~/.honeycrisp/memory.sqlite`. Honeycrisp owns the database contract so headless and desktop operation are compatible without synchronization, peer-database discovery, or import steps between active workspaces.

Every workspace, scope, run, and durable-memory record retains explicit workspace ownership. Beale database connections carry a current workspace identity and scope operational queries to it. Durable memory applies its session, workspace, and subject visibility rules inside the shared database.

Repository checkout storage is separate from SQLite: source code may be stored once in a user-global Beale repository store and referenced by multiple workspace records. The reference is workspace-scoped, and a global checkout is not globally visible to agents.

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

One database reduces path coordination and makes the same record set available to headless Honeycrisp and Beale. Cross-scope isolation remains mandatory: operational queries are workspace-scoped, session memory is session-scoped, workspace memory is workspace-scoped, and only subject-tier memory crosses workspaces with the same normalized owner or subject.

## Storage Layout

Local storage layout:

```text
~/.honeycrisp/
  memory.sqlite
  artifacts/

<workspace>/
.beale/
  artifacts/
    sha256/
      ab/
        <sha256>
  exports/
  logs/
```

The legacy workspace-local `.honeycrisp/memory/memory.sqlite` is retained only as an untouched migration source after its records are adopted globally.

## Authoritative State

`~/.honeycrisp/memory.sqlite` is the source of truth for structured state. Operational tables include:

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

Durable knowledge is a separate logical layer in the same database. It contains concise typed nodes, normalized asset and tag links, directed relationships, revisions, and evidence references. Each node records its origin session, workspace, and optional scope owner or subject, plus a visibility tier:

- `session`: visible only to the originating research session.
- `workspace`: reusable across sessions in the originating workspace.
- `subject`: reusable across workspaces with the same normalized owner or subject.

Subject visibility reads only durable graph tables. Run events, transcripts, bulk outputs, operational findings, and artifact contents remain partitioned by their originating workspace and must not be promoted automatically into durable knowledge.

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
- Tier-aware durable-memory search over the current session/workspace and matching subject records.

Semantic and operational search must remain workspace-scoped unless a user explicitly selects a cross-workspace view. Subject-tier memory visibility is not unrestricted global semantic search.

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

- A workspace file archive plus a separately designed global-database backup/export.
- A finding disclosure package.
- A benchmark/regression run bundle.
- A redacted report package.

Exports must be user-initiated and should make included data clear before writing the archive.

## Non-Goals

- Remote-hosted project database.
- Cloud sync.
- Unscoped cross-workspace operational search.
- Shared multi-user backend.
- Background upload of traces, artifacts, or findings.

## Planning Consequence

The storage schema assumes one local global database with explicit ownership. Every operational entity belongs to a workspace, and Beale must scope its queries to the current workspace. Cross-workspace durable-memory correlation is allowed only through the explicit subject tier; broader correlation requires an explicit user-selected view.
