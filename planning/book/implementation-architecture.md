# Implementation Architecture

Status: draft implementation direction, 2026-04-27.

## Decision

Beale should be implemented as an Electron workbench with a trusted host service, a typed UI boundary, local SQLite persistence, an OpenAI model adapter, and a VM-first executor abstraction.

The architecture should keep product state and security decisions in Beale-owned modules. OpenAI APIs supply model reasoning and tool-call mechanics; VMs supply isolated target execution; SQLite supplies authoritative local state.

## Process Boundary

Beale has three normal execution zones:

```text
Renderer UI
  displays workspaces, runs, trace, artifacts, hypotheses, verifiers
  sends typed user intents

Trusted host service
  owns credentials, policy, run engine, SQLite, artifacts, model adapter, executor control
  records trace and decides what becomes evidence

Guest VM
  receives scoped target material
  runs target code, tools, debuggers, tests, and verifier commands
  returns observations and candidate artifacts
```

Benchmark mode adds a separate Dockerized agent harness and host-side grader, but normal authorized research remains VM-based.

## Renderer UI

The renderer is the product surface:

- Program sidebar.
- Program scope editor.
- Start-run markdown interface.
- Multi-run tracker.
- Run detail.
- Trace timeline.
- Hypothesis board.
- Artifact browser.
- Verifier dashboard.
- Policy and approval controls.

The renderer should not directly access:

- OAuth credentials.
- OS credential stores.
- Hypervisor control sockets.
- Raw workspace database files.
- Unredacted secrets.
- Host filesystem outside selected workspace operations.

Renderer-to-host communication should use typed commands and subscriptions rather than direct database or shell access.

## Trusted Host Service

The trusted host service may live in the Electron main process initially. If the implementation benefits from process isolation later, it can become a local companion service without changing the boundary.

Host-owned modules:

- Workspace service.
- Persistence service.
- Artifact service.
- Program scope service.
- Policy engine.
- Run engine.
- Attempt coordinator.
- OpenAI adapter.
- Tool router.
- Executor manager.
- Verifier service.
- Trace service.
- Export service.
- Benchmark runner.

The host service is the only component that can mutate authoritative state.

## Workspace Service

Responsibilities:

- Open and create workspace directories.
- Initialize `.beale/`.
- Create or migrate `beale.sqlite`.
- Resolve workspace-local paths.
- Prevent accidental cross-workspace lookups.
- Provide narrow import operations for scoped files, repos, binaries, archives, and documents.

Host-safe setup should flow through this service rather than a general host shell.

## Persistence Service

Responsibilities:

- Own the SQLite connection.
- Apply migrations.
- Enforce foreign keys.
- Persist append-oriented trace events.
- Persist run, attempt, hypothesis, finding, verifier, artifact, approval, VM, and export state.
- Provide query APIs for the UI and run engine.

The renderer should query through typed host APIs, not by opening SQLite directly.

## Artifact Service

Responsibilities:

- Store artifacts by content hash.
- Attach provenance metadata.
- Track sensitivity and model visibility.
- Generate safe previews and summaries.
- Export evidence bundles and redacted reports.
- Reject direct guest writes to authoritative artifact storage.

Artifacts can originate from user import, VM export, verifier output, model-proposed files that were actually written by tools, or generated report/export flows.

## Policy Engine

Responsibilities:

- Evaluate program scope.
- Enforce host vs VM execution rules.
- Enforce network profiles.
- Enforce credential injection rules.
- Enforce model visibility and redaction.
- Decide when approval is required.
- Fail closed on ambiguous policy requests.

The policy engine should produce traceable decisions, not silent blocks.

## Run Engine

Responsibilities:

- Create runs and attempts.
- Execute the adaptive portfolio strategy.
- Manage run state transitions.
- Coordinate model turns and tool calls.
- Route tool calls through policy and executor layers.
- Record model messages, tool calls, tool results, and state changes.
- Support pause, resume, stop, fork, and rerun verifier.
- Keep model claims separate from observations.

The run engine owns Beale's outer vulnerability research loop.

## OpenAI Adapter

Responsibilities:

- Manage OAuth-backed account state through host-owned credential storage.
- Connect to the Responses API.
- Prefer WebSocket transport for active runs.
- Map OpenAI events into Beale trace events.
- Map Beale tools into model-facing tool definitions.
- Preserve OpenAI-native reasoning and state mechanics where they improve performance.
- Apply Beale context packing and redaction policy.

The adapter should be replaceable internally, but v1 should optimize the OpenAI path instead of designing to the lowest common provider denominator.

## Tool Router

Responsibilities:

- Expose the first model-facing tools:
  - `search`
  - `code_browser`
  - `python`
  - `debugger`
  - `artifact`
  - `verifier`
- Validate tool inputs.
- Attach policy metadata.
- Select host, database, artifact, or VM execution path.
- Normalize outputs into structured trace events, model summaries, and artifacts.

The tool router should make structured tools the normal path and guest shell the fallback.

## Executor Manager

Responsibilities:

- Select executor backend.
- Create execution contexts.
- Restore snapshots.
- Import target material.
- Execute guest commands and structured tool backends.
- Export artifacts.
- Revert, preserve, or destroy guests.
- Record VM lifecycle and contamination state.

Initial implementation should support a fake executor for UI/run-engine development and one real VM backend for alpha.

## Verifier Service

Responsibilities:

- Store verifier contracts.
- Run verifier contracts against named target states.
- Collect verifier artifacts.
- Produce pass, fail, or inconclusive results.
- Promote reproduced or verified findings only when contract requirements are met.

Verifier execution may use the executor manager, but verifier promotion decisions stay on the host.

## Trace Service

Responsibilities:

- Append trace events.
- Assign sequence numbers.
- Attach provenance fields.
- Link events to runs, attempts, VM contexts, tools, artifacts, hypotheses, and findings.
- Provide redacted views for model context and UI display.
- Preserve enough raw data for audit without forcing large output into trace rows.

Trace is both the activity log and the evidence backbone.

## Benchmark Runner

Responsibilities:

- Package benchmark task inputs.
- Start Dockerized benchmark agent harness.
- Keep grader and ground truth host-side.
- Provide host-side model/auth proxy.
- Collect outputs.
- Run host-side grader.
- Record harness identity and sampled comparison metrics.

Benchmark mode should reuse workbench primitives where practical, but it may impose extra containment to prevent benchmark hacking.

## Normal Run Flow

```text
User starts run
  -> renderer sends typed intent
  -> host creates run, attempt, trace event
  -> run engine sends model request through OpenAI adapter
  -> model emits message or tool call
  -> tool router validates request
  -> policy engine approves, blocks, or asks user
  -> executor manager runs VM operation when needed
  -> artifact service stores exported artifacts
  -> verifier service runs contracts when requested
  -> trace service records observations and state changes
  -> renderer updates tracker and run detail
```

## Implementation Rule

If a component affects authorization, secrets, target execution, trace authority, artifact authority, verifier promotion, or workspace persistence, it belongs in the trusted host service.

