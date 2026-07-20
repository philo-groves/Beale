# Workspace Context and Source References

Status: implemented initial direction, 2026-07-19.

## Decision

A Beale workspace represents one authorized research context. It is not inherently a bug bounty program, product, organization, or repository.

The model-facing context should provide recorded facts and boundaries while leaving research planning, triage, and falsification strategy to the model. Beale should not inject a mandatory domain runbook when the selected model can manage those decisions itself.

## Authorization Context

Each Honeycrisp run receives:

- An explicit statement that authorization was recorded by the operator.
- A neutral scope label and optional owner or subject.
- The scope description.
- Rules and constraints.
- The active network profile.
- The recorded expiry or review date, including an explicit warning when no date was recorded.
- The bounded list of in-scope and out-of-scope assets.
- Only materialized source paths referenced by the active scope.

Credential reference values are not copied into model-facing workspace notes. They remain host-held references.

The workspace directory is still passed to Honeycrisp as its persistence root. It is not automatically listed as a source path or known repository.

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

Global storage does not imply global model visibility. A checkout is exposed to a run only when the active workspace scope references its path. Research memory, findings, traces, artifacts, and indexes remain workspace-local and are never retrieved across workspaces by default.

Repository materialization does not search for or reuse managed checkouts inside workspace directories. Source already present on disk must be added as an explicit path reference; repositories cloned by Beale use the user-global store.

## Guidance Boundary

Beale no longer writes or selects the `beale-skeptical-triage` Honeycrisp skill. User-selected Honeycrisp skills and explicit runtime arguments remain available. Durable evidence pointers, hypotheses, and findings live in Honeycrisp's small knowledge graph; operational workbench rows share the same SQLite file without becoming a second memory model. The research agent decides how to investigate, challenge, and promote a candidate based on the objective and available evidence.

## Pre-Alpha Schema

The renderer, IPC API, global registry, and SQLite schema use workspace and authorized-scope vocabulary. The global registry uses `workspace-registry.sqlite`, leaving the incompatible pre-workspace `registry.sqlite` untouched. Beale does not provide aliases or migrations for earlier `Program*` APIs, registry tables, scope columns, or Honeycrisp memory compatibility exports.
