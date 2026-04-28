# Executor Interface

Status: draft implementation direction, 2026-04-27.

## Decision

Beale should define a sandbox-aware executor interface owned by the trusted host harness.

The executor is not an agent. It is a controlled execution substrate. It receives scoped target material, runs commands or structured tool backends, returns observations and candidate artifacts, and records whether execution happened on the host or in a disposable VM.

## Design Goals

- Make host execution explicit and traceable when it is selected.
- Support Hyper-V, Tart, Firecracker, and comparable local VM backends.
- Support snapshot, clone, revert, preserve, and destroy.
- Support explicit import and export channels.
- Support offline, scoped, and elevated network profiles.
- Support structured tools and guest shell fallback.
- Produce traceable lifecycle events.
- Fail closed on policy ambiguity.

## Non-Goals

- Hosted sandbox support in v1.
- Hidden host execution without a New Research Session warning.
- Letting guest code write authoritative artifacts directly.
- Exposing host control sockets to the guest.
- Passing OpenAI credentials into the guest.
- Treating Docker as the normal research sandbox boundary.

## Core Concepts

`ExecutorProvider`:

- Represents a backend implementation.
- Examples: fake, Hyper-V, Tart, Firecracker.

`ExecutionContext`:

- Represents one guest VM or equivalent isolated execution context.
- Bound to one workspace, scope version, run, and attempt.

`GuestOperation`:

- A command or structured tool backend invocation inside the guest.

`GuestArtifact`:

- A file produced inside the guest and proposed for export.

`HostArtifact`:

- A content-addressed artifact accepted into the host artifact store.

## Execution Context States

Valid states:

- `clean`: restored from a trusted snapshot and not yet used.
- `working`: active execution in progress.
- `contaminated`: target code or generated PoC has run.
- `preserved`: user explicitly kept the context for follow-up.
- `destroyed`: context can no longer execute.

Rules:

- A contaminated context must not become a clean base.
- Preserving a contaminated context requires explicit user action.
- Destroying a context should be the default after high-risk binary execution.

## Provider Interface

Conceptual operations:

```text
list_capabilities()
ensure_image(image_ref)
create_context(request)
restore_snapshot(context_id, snapshot_ref)
destroy_context(context_id)
get_context_state(context_id)
```

Provider capabilities should include:

- Supported guest OSes.
- Snapshot support.
- Network policy support.
- File import/export support.
- Interactive process support.
- Debugger support.
- Resource limit support.

## Context Interface

Conceptual operations:

```text
import_artifact(context_id, host_artifact_id, guest_path, mode)
import_workspace_material(context_id, import_spec)
execute(context_id, operation)
start_interactive(context_id, operation)
send_interactive_input(session_id, input)
read_interactive_state(session_id)
export_artifact(context_id, guest_path, export_spec)
snapshot(context_id, label)
revert(context_id, snapshot_ref)
mark_contaminated(context_id, reason)
preserve(context_id, reason)
destroy(context_id)
```

All operations should return structured status and trace metadata.

## Execute Request

Every execution request should include:

- Run ID.
- Attempt ID.
- Scope version ID.
- VM context ID.
- Tool name or operation kind.
- Working directory.
- Arguments.
- Environment allowlist.
- Timeout.
- Resource limits where supported.
- Network profile.
- Expected output policy.
- Artifact collection policy.
- Sensitivity policy.

The host policy engine should validate the request before it reaches the executor backend.

## Execute Result

Every execution result should include:

- Status: `success`, `failure`, `timeout`, `policy_blocked`, `executor_error`.
- Exit code or signal where applicable.
- Start and end timestamps.
- Duration.
- stdout summary.
- stderr summary.
- Structured result payload where applicable.
- Candidate artifact references.
- Contamination state change.
- Network events where available.
- Error details safe for model visibility.

Raw large output should be exported as artifacts, not stored directly in trace rows.

## Import Rules

Allowed imports:

- Scoped source snapshots.
- Scoped binaries.
- Scoped corpora.
- User-approved credentials for authorized testing.
- Tooling bundles prepared by Beale.
- Verifier contracts and PoC artifacts.

Rules:

- Imports are explicit trace events.
- Imports should be read-only where practical.
- Host `.beale/beale.sqlite` is never imported.
- Host credential stores are never imported.
- Broad host directory mounts are prohibited.

## Export Rules

Allowed exports:

- Logs.
- Crash inputs.
- Debugger traces.
- Screenshots.
- PoCs.
- Patches and diffs.
- Verifier output.
- Reproduction bundles.

Rules:

- Guest exports are candidate artifacts until accepted by the host.
- The host computes content hashes.
- The host assigns sensitivity and model visibility.
- The host stores accepted artifacts in the workspace artifact store.
- Exports should be reviewed or policy-checked when they may contain secrets.

## Network Policy

Executor backends should support:

- `offline`
- `scoped`
- `elevated`

If a backend cannot enforce a requested network profile, Beale should fail closed or require explicit degraded-mode approval.

VM network traffic should flow through a Beale-controlled broker or proxy where feasible.

## Interactive Sessions

Interactive programs should use structured wrappers when they are part of the core workflow.

Initial interactive support:

- Debugger sessions.
- Long-running process supervision for verifier or target service setup.
- Raw PTY fallback only when structured operations are not available.

Interactive sessions must still produce structured trace events.

## Fake Executor

The first implementation should include a fake executor.

Purpose:

- Develop the GUI.
- Develop persistence.
- Develop run and trace behavior.
- Simulate tool results.
- Exercise policy and verifier UI.

Rules:

- Fake executor output must be clearly labeled.
- Fake observations must not be promoted as real evidence outside synthetic demo workspaces.
- Fake executor should use deterministic fixtures for repeatable UI and regression tests.

## Real Backend Order

Recommended order:

1. Host execution for default research sessions.
2. Fake executor.
3. One local VM backend on the primary development platform.
4. Guest command execution and artifact export.
5. Snapshot lifecycle.
6. Network profiles.
7. Debugger wrapper.
8. Additional platform backends.

## Security Invariants

- No hidden target execution on host.
- No OpenAI credentials in guests.
- No raw workspace database in guests.
- No broad host filesystem mounts.
- No guest direct writes to authoritative artifact storage.
- No contaminated context reused as clean.
- No out-of-scope live-target network access without scope amendment.
