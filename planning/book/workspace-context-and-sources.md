# Workspace Context and Source References

Status: implemented initial direction, 2026-07-19.

## Decision

A Beale workspace represents one authorized research context. It is not inherently a bug bounty program, product, organization, or repository.

The model-facing context should provide recorded facts and boundaries while leaving research planning, triage, and falsification strategy to the model. Beale should not inject a mandatory domain runbook when the selected model can manage those decisions itself.

## Authorization Context

Each Honeycrisp run receives:

- Structured recorded-scope metadata supplied by Beale, including the scope version, label, network profile, and optional expiry.
- A concise statement that authorization was recorded by the operator for model context.
- A neutral scope label and optional owner or subject.
- The scope description.
- Rules and constraints.
- The active network profile.
- The recorded expiry or review date, or a factual indication that no expiry was recorded.
- The bounded list of in-scope and out-of-scope assets.
- Only materialized source paths referenced by the active scope.
- Memory identity containing the current session id, stable workspace id and label, and optional normalized scope owner or subject.
- Registered peer memory database references only for workspaces whose normalized owner or subject exactly matches the active workspace.

Credential reference values are not copied into model-facing workspace notes. They remain host-held references.

The workspace directory is still passed to Honeycrisp as its persistence root. It is not automatically listed as a source path or known repository.

Honeycrisp treats structured recorded-scope metadata as sufficient scope for ordinary in-scope research. Prompt wording does not need to repeat a labeled `Scope:` section, and the controller should ask for clarification only when the workspace has no recorded scope or a material boundary is genuinely ambiguous.

## Source Storage

Repository checkout storage is user-global by default:

```text
~/.beale/
  workspace-registry.sqlite
  repositories/
    <repository-slug>/
      default/
      <ref-label>-<ref-hash>/
```

`BEALE_REPOSITORY_STORE_DIR` can override the repository store. When Beale is configured with a custom registry directory, its repository store defaults to a `repositories/` child of that directory.

Checkouts are separated by requested ref so one workspace selecting a tag or branch does not change the checkout used by another ref. The default checkout is reused across workspaces.

## Workspace-Local References

The Honeycrisp-owned workspace database remains authoritative for whether a global checkout belongs in that workspace's context. Materialization adds an in-scope source asset containing:

- The absolute checkout path.
- The canonical repository URL.
- The resolved Git metadata.
- `sourceStorage: user_global`.
- A source-reference schema version.

Global storage does not imply global model visibility. A checkout is exposed to a run only when the active workspace scope references its path. Findings, traces, artifacts, indexes, and session/workspace-tier memories remain workspace-local. Subject-tier graph nodes may be retrieved from explicitly listed same-subject peer databases; this does not expose peer operational tables or artifact contents.

## Memory Tiers

Honeycrisp keeps the existing `memory.search`, `memory.get`, `memory.save`, `memory.correct`, and `memory.link` tool set. Nodes are categorized by origin session, workspace, and optional owner or subject. The selected tier controls reuse:

- Session memory is transient to the current Beale run id.
- Workspace memory is the default and remains available to later sessions in that workspace.
- Subject memory is intended for reusable system-boundary, invariant, mitigation, procedure, and interaction knowledge that can benefit other authorized workspaces for the same subject.

Subject identity comes from the operator-recorded scope owner or subject. Beale compares normalized exact values and passes concrete peer database paths; Honeycrisp does not discover or scan unrelated workspaces.

Repository materialization does not search for or reuse managed checkouts inside workspace directories. Source already present on disk must be added as an explicit path reference; repositories cloned by Beale use the user-global store.

When a user-authored run prompt explicitly contains a supported GitHub or GitLab repository URL, Beale materializes it before Honeycrisp starts, provided the workspace has a recorded scope and the selected run network profile is not offline. The canonical URL and user-global checkout are then recorded as in-scope workspace assets. A checkout already referenced by the workspace is reused without another clone.

## Guidance Boundary

Beale no longer writes or selects the `beale-skeptical-triage` Honeycrisp skill. User-selected Honeycrisp skills and explicit runtime arguments remain available. Durable evidence pointers, hypotheses, and findings live in Honeycrisp's small knowledge graph; operational workbench rows share the same SQLite file without becoming a second memory model. The research agent decides how to investigate, challenge, and promote a candidate based on the objective and available evidence.

## Pre-Alpha Schema

The renderer, IPC API, global registry, and SQLite schema use workspace and authorized-scope vocabulary. The global registry uses `workspace-registry.sqlite`, leaving the incompatible pre-workspace `registry.sqlite` untouched. Beale does not provide aliases or migrations for earlier `Program*` APIs, registry tables, scope columns, or Honeycrisp memory compatibility exports.
