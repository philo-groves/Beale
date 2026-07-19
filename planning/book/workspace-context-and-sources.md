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
  registry.sqlite
  repositories/
    <repository-slug>/
      default/
      <ref-label>-<ref-hash>/
```

`BEALE_REPOSITORY_STORE_DIR` can override the repository store. When Beale is configured with a custom registry directory, its repository store defaults to a `repositories/` child of that directory.

Checkouts are separated by requested ref so one workspace selecting a tag or branch does not change the checkout used by another ref. The default checkout is reused across workspaces.

## Workspace-Local References

The workspace database remains authoritative for whether a global checkout belongs in that workspace's context. Materialization adds an in-scope source asset containing:

- The absolute checkout path.
- The canonical repository URL.
- The resolved Git metadata.
- `sourceStorage: user_global`.
- A source-reference schema version.

Global storage does not imply global model visibility. A checkout is exposed to a run only when the active workspace scope references its path. Research memory, findings, traces, artifacts, and indexes remain workspace-local and are never retrieved across workspaces by default.

Existing repositories inside older workspaces continue to work. Beale does not move or rewrite those checkouts automatically.

## Guidance Boundary

Beale no longer writes or selects the `beale-skeptical-triage` Honeycrisp skill. User-selected Honeycrisp skills and explicit runtime arguments remain available. Evidence and finding state still live in Beale's data model, but the research agent decides how to investigate, challenge, and promote a candidate based on the objective and available evidence.

## Compatibility Note

Internal database and renderer types still use historical `Program*` names. They are implementation compatibility names, not the intended product concept. Renaming that persistence and UI surface is a separate migration so this context change does not risk existing workspaces.
