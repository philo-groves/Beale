# Sandbox Model

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should use local virtual machines as the default sandbox provider.

Platform backends:

- Windows: Hyper-V.
- macOS: Tart.
- Linux: Firecracker or a comparable local microVM/VM backend.

Docker and devcontainers are not the default sandbox boundary for v1.

## Rationale

Beale's first-release priorities include binary reverse engineering, debugger-driven workflows, memory corruption, closed-source executables, crash reproduction, and open-ended discovery. These workflows justify a stronger isolation boundary than containers provide.

The sandbox must handle untrusted code and untrusted program behavior while keeping the trusted Beale host process separate from target execution.

## Security Posture

VM isolation is the default security boundary.

Design requirements:

- Disposable VM per attempt or per tightly scoped task.
- Snapshot and revert instead of long-lived mutable guests.
- No provider/model credentials inside guests.
- No Docker socket or equivalent host-control socket exposed to guests.
- No broad host filesystem mounts.
- Explicit file import/export through Beale-controlled artifact channels.
- Network disabled by default.
- Network allowlists scoped to the authorized target and task.
- Resource limits for CPU, memory, disk, runtime, and process count where supported.
- Guest images are versioned and reproducible.
- Sandbox lifecycle events are written to the trace.

VMs reduce escape risk, but they are not treated as perfect. Backend configuration and host integration must be audited as part of the security model.

## Snapshot Flow

VM snapshotting is a first-class sandbox workflow.

Beale should distinguish between image templates, clean snapshots, working snapshots, and captured evidence.

Proposed lifecycle:

1. Build or import a versioned base image.
2. Apply Beale toolchain provisioning in a controlled step.
3. Create a clean snapshot before target material is introduced.
4. Clone or restore from the clean snapshot for each attempt.
5. Import scoped target artifacts through Beale-controlled channels.
6. Run build/debug/fuzz/repro commands inside the guest.
7. Export selected artifacts, traces, crashes, logs, PoCs, and patches back to the host.
8. Revert or destroy the working VM after the attempt.

For malware-adjacent or high-risk executable analysis, the default should be destroy-after-run rather than preserving mutable VM state.

## Snapshot Types

| Snapshot | Purpose |
| --- | --- |
| Base image | Operating system and minimal boot configuration. |
| Toolchain snapshot | Beale-managed analysis tools, debuggers, compilers, sanitizers, fuzzers, and helper services. |
| Clean target snapshot | Optional prepared state after target install but before execution. Useful when setup is expensive. |
| Working snapshot | Per-attempt mutable state. Destroyed or reverted after use. |
| Evidence capture | Exported artifacts, not a VM state used for future execution. |

Snapshots should be identified by backend, image version, toolchain version, target setup hash, and policy profile.

## Snapshot Safety Rules

- Never resume a contaminated working snapshot as a clean base.
- Never let guest state become authoritative storage.
- Never mount the workspace database inside the guest.
- Export artifacts only through explicit Beale-controlled channels.
- Record every snapshot restore, clone, export, revert, and destroy event in the trace.
- Mark snapshots that have executed untrusted binaries as contaminated.
- Require explicit user action to preserve a contaminated VM for manual follow-up.
- Prefer immutable base/toolchain images and copy-on-write working disks.

## Malware-Adjacent Analysis

Beale is not primarily a malware-analysis platform, but closed-source vulnerability research may include potentially dangerous executables.

For high-risk binaries:

- Use network-off execution by default.
- Disable shared clipboard, shared folders, and guest integration features where possible.
- Use one-way artifact import where backend support allows.
- Export only selected evidence artifacts.
- Destroy the working VM after execution unless the user explicitly preserves it.
- Make the risk state visible in the GUI.

## Platform Backends

The executor interface should hide platform differences from the run engine while preserving backend-specific security controls.

### Windows: Hyper-V

Hyper-V is the default Windows backend.

Planning requirements:

- Isolated VM images for research tasks.
- Snapshot/revert support.
- Controlled artifact transfer.
- Debugger support inside guest.
- Clear handling of Windows-only targets and Linux guests where needed.

### macOS: Tart

Tart is the default macOS backend.

Planning requirements:

- Local VM image management.
- Snapshot/revert or clone-per-attempt workflow.
- Controlled artifact transfer.
- Support for Linux and macOS guest workflows where licensing and tooling allow.
- Debugger and reverse-engineering tools installed in the guest image, not on the host by default.

### Linux: Firecracker or Similar

Firecracker, or a comparable local microVM/VM backend, is the default Linux direction.

Planning requirements:

- Fast disposable guests.
- Strong host/guest boundary.
- Minimal guest images for repeatable research runs.
- Controlled artifact transfer.
- Support for debugger, sanitizer, fuzzer, and binary-analysis toolchains.

## Docker and Devcontainers

Docker is not the primary sandbox provider.

Possible later roles:

- Build tool inside a VM guest.
- Compatibility mode for trusted source projects.
- Importing project devcontainer definitions into a Beale-controlled VM image.

Project-authored devcontainers are untrusted configuration and must not become an automatic host-level execution path.

## Hosted Sandboxes

Hosted sandboxes are a non-goal.

This follows the local-only persistence decision: sensitive source, binaries, crashes, traces, hypotheses, and potential zero-days should stay on the researcher's machine by default.

## Harness Boundary

The trusted Beale host owns:

- OAuth credentials.
- Model sessions.
- Workspace database.
- Artifact store.
- Authorization policy.
- Tool policy.
- Trace and audit logs.
- Verifier promotion decisions.

The guest VM owns:

- Target execution.
- Build/test/debug/fuzz commands.
- Runtime instrumentation.
- Temporary working files.

The guest communicates with Beale only through narrow, typed channels.

## Planning Consequence

The executor abstraction should be VM-first:

```text
Executor
  WindowsHyperVExecutor
  TartExecutor
  LinuxFirecrackerExecutor
```

The exact class names are placeholders. The important point is that local VM execution is the default architecture, not a future hardening option.
