# Electron GUI

Status: accepted revised direction, 2026-07-19.

## Decision

Beale's Electron GUI is an authorized vulnerability research workbench, not a chat-first agent UI.

The primary experience is:

1. Select or create a research workspace.
2. Record its description, authorization boundary, scope owner or subject, and relevant source references.
3. Submit a bounded markdown research prompt to start a session.
4. Follow the live trace and steer the active Honeycrisp session.
5. Review durable Honeycrisp memory as concise typed records.
6. Continue research in the same session or start another session in the workspace.

## Top-Level Navigation

The left navigation owns known research workspaces and their sessions. Source repositories live in user-global storage and workspaces hold references to the relevant checkouts.

The navigation should support:

- Switching between known workspaces.
- Opening or creating a workspace.
- Starting research.
- Opening prior sessions.
- Showing basic status where practical.

Search defaults to the current workspace. Broader local search must be explicit about its scope.

## Authorized Scope View

Each workspace needs a reusable view for its research context, authorization boundary, and scope.

Fields should include:

- Workspace name.
- Scope owner or subject, when useful.
- Scope description.
- In-scope domains, hosts, repositories, executables, binaries, local paths, and credential references.
- Explicit out-of-scope assets.
- Network policy.
- Rules, constraints, and review dates where applicable.

The recorded scope is context for autonomous research. It should prevent accidental boundary crossing without repeatedly asking the user to reauthorize ordinary access to recorded in-scope resources.

## Start Research Interface

Starting research uses a markdown prompt. The prompt is a request or task brief, not the start of a chat-first product flow.

The interface should show the active authorized scope and relevant model, network, and runtime settings without imposing a model-facing goal hierarchy.

## Session Detail

The primary session detail surface combines:

- A trace of model, tool, system, and user-steering events.
- Immediate steering that extends the current Honeycrisp session.
- Run controls such as pause, resume, and stop.
- A permanent memory catalog backed by Honeycrisp's workspace database.

Model claims remain visually distinct from tool results and referenced files or outputs.

## Memory Catalog

The permanent research-side surface is a list-only memory catalog inspired by the proven Cybermem viewer structure.

It should:

- Read Honeycrisp typed memory nodes directly rather than rebuilding hypotheses, findings, and evidence into a parallel Beale model.
- Search titles, summaries, bodies, types, statuses, scope metadata, assets, tags, and references.
- Filter by stored origin session, workspace, or subject identity and by node type. The node's reuse tier remains separate metadata shown on the record.
- Show status, confidence, tier, revision, update time, and relationship/reference counts at a glance.
- Expand one record inline to show its summary, body, scope metadata, assets, tags, references, and textual relationships.
- Use `References` for supporting file, command, URL, artifact, and human-note records in the UI.

The catalog must not include a graph visualization. Relationships are rendered as readable list entries.

Beale should not provide a separate right-side Evidence navigation pane, a footer toggle for it, or collapsed sideways Trails/Evidence controls. Memory remains visible alongside the trace during the normal session view.

## Steering

Steering applies to the current session and is recorded in the trace. The UI should let the model manage its own research flow rather than impose Beale-owned goals, subgoals, or triage queues.

Controls that materially expand scope, change network policy, expose credentials, or perform destructive actions still require explicit, narrowly scoped user intent.

## Chat Is Not Primary

Conversational steering is subordinate to:

- Authorized scope.
- Session trace.
- Durable memory.
- Tools and referenced outputs.
- Artifacts and export workflows.

## Terminal Compatibility

Beale is terminal-compatible but not terminal-centered. Terminal output is useful for tool execution and exact command inspection, but meaningful durable knowledge should become concise Honeycrisp memory records with references to raw outputs where needed.

## Planning Consequence

The GUI should expose the agent's work and durable context without duplicating the agent's memory or research-management logic in Beale.
