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

Honeycrisp storage paths and its former directory taxonomy are not model-facing workspace context. The agent receives the memory tier identity and the `memory.*` tools; the unified SQLite database and artifact directory remain runtime implementation details.

Honeycrisp projects the operational workspace context before the first model turn. The projection keeps authorization, repository and source references, project notes, and current session/workspace/subject identity. It removes the workspace persistence root, the peer workspace registry, and all local or peer memory database paths. Relevant subject-tier nodes identify their origin workspace when selected.

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

Some managed checkouts contain a project directory below the ref-specific checkout root. Beale records bounded immediate child content roots when they contain common source or build markers. Honeycrisp includes those roots in model context and file-read hints while retaining the referenced checkout root as the authorization boundary.

## Memory Tiers

Honeycrisp keeps the existing `memory.search`, `memory.get`, `memory.save`, `memory.correct`, and `memory.link` tool set. Nodes are categorized by origin session, workspace, and optional owner or subject. The selected tier controls reuse:

- Session memory is transient to the current Beale run id.
- Workspace memory is the default and remains available to later sessions in that workspace.
- Subject memory is intended for reusable system-boundary, invariant, mitigation, procedure, and interaction knowledge that can benefit other authorized workspaces for the same subject.

Subject identity comes from the operator-recorded scope owner or subject. Beale compares normalized exact values and passes concrete peer database paths; Honeycrisp does not discover or scan unrelated workspaces.

At session start, Honeycrisp selects a small memory view from the same graph used by `memory.search` and the other memory tools. Current-session nodes are prioritized; request-relevant and recent workspace nodes retain continuity; subject nodes are included only when the request matches them or a selected node links to them. The bounded entries preserve stable ids, tier and scope identity, type, status, confidence, concise body content, asset and tag labels, evidence references, relationships, timestamps, and revisions. The model can use the unchanged memory tools for details or updates.

`memory.search` tokenizes natural-language queries and ranks matches across node ids, types, content, assets, tags, and evidence. A known node id remains retrievable when the model includes it alongside descriptive search terms.

When memory tools are present, Honeycrisp gives the agent a compact research-memory policy:

- Search memory early and when research crosses system boundaries. Prefer security-sensitive code near dangerous sinks, established primitives, historical bugs, and relevant successful trajectories.
- Reserve bugs for confirmed historical flaw precedents that predate the current research, with affected assets and precedent evidence. A flaw established during current research is a primitive, or part of a chain when reachability and impact are established. Record user-controlled ingress as sources; dangerous operations as sinks; always-true security rules as invariants; and system- or hardware-level exploitation blockers as mitigations.
- Record reusable sequences of important research actions as trajectories, not routine narration.
- Record an individual flaw as a primitive only after static analysis supports it and code or tool evidence is attached.
- Record a chain only when linked sources, primitives, sinks, and assets establish end-to-end attacker reachability and security impact. Confirming a chain requires a realistic proof-of-vulnerability independently approved by a review subagent. If review is unavailable or inconclusive, the chain remains suspected.

Tool schemas supplied by the agent runtime are the model's capability description. Beale and Honeycrisp do not also inject a prose or JSON tool-policy section, and storage layout is not a model context section. Enforcement remains in Honeycrisp lifecycle hooks. The `context.compiled` trace records selected memory and concise available-tool descriptors so Beale can show the exact context shape without exposing storage plumbing. Full Honeycrisp flow captures remain internal diagnostic artifacts and are not exposed through model-visible Beale artifact lookup.

Repository materialization does not search for or reuse managed checkouts inside workspace directories. Source already present on disk must be added as an explicit path reference; repositories cloned by Beale use the user-global store.

When a user-authored run prompt explicitly contains a supported GitHub or GitLab repository URL, Beale materializes it before Honeycrisp starts, provided the workspace has a recorded scope and the selected run network profile is not offline. The canonical URL and user-global checkout are then recorded as in-scope workspace assets. A checkout already referenced by the workspace is reused without another clone.

## Guidance Boundary

Beale no longer writes or selects the `beale-skeptical-triage` Honeycrisp skill. User-selected Honeycrisp skills and explicit runtime arguments remain available. Concise assets, historical bugs, invariants, mitigations, sources, sinks, hypotheses, primitives, chains, procedures, trajectories, and their evidence references live in Honeycrisp's small knowledge graph; operational workbench rows share the same SQLite file without becoming a second memory model. The research agent decides how to investigate, challenge, and promote a candidate based on the objective and available evidence.

## Pre-Alpha Schema

The renderer, IPC API, global registry, and SQLite schema use workspace and authorized-scope vocabulary. The global registry uses `workspace-registry.sqlite`, leaving the incompatible pre-workspace `registry.sqlite` untouched. Beale does not provide aliases or migrations for earlier `Program*` APIs, registry tables, scope columns, or Honeycrisp memory compatibility exports.
