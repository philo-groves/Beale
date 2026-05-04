# Sandbox Model

Status: revised product default, 2026-04-28.

## Decision

Beale should be VM-free by default for normal research sessions, with local virtual machines available and recommended for risky execution. The local disposable VM is preferred but not required.

Platform backends:

- Windows: Hyper-V.
- macOS: Tart.
- Linux: Firecracker or a comparable local microVM/VM backend.

Docker containers are supported as a lower-assurance sandbox option for convenience. They must be labeled as less secure than virtual machines in settings. Benchmark mode remains a separate Dockerized harness.

## Rationale

Beale's first-release priorities include binary reverse engineering, debugger-driven workflows, memory corruption, closed-source executables, crash reproduction, and open-ended discovery. These workflows justify keeping VM support first-class, but the VM cost can also impair practical source research and raise setup friction.

The default product path prioritizes usability: commands and executables run on the host unless the session is explicitly configured for a sandbox backend. The New Research Session flow must show an orange warning that host execution is dangerous and that a disposable sandbox is recommended, with virtual machines preferred for high-risk target execution.

## Security Posture

Host execution is the default convenience boundary. VM isolation is the recommended safety boundary. Docker container isolation is a degraded convenience boundary and should not be presented as equivalent to a virtual machine.

Design requirements:

- A visible host-execution warning before starting a default session.
- A session sandbox profile recorded in the run and trace.
- Host execution tools avoid mounting or exposing OpenAI credentials and `.beale/` state through model-visible outputs where possible.
- Disposable VM per attempt or per tightly scoped task when the user selects VM execution.
- Docker container sandbox when explicitly selected, with visible lower-security warning and without mounting the Docker socket into the sandbox.
- Snapshot and revert instead of long-lived mutable guests.
- No provider/model credentials inside guests.
- No Docker socket or equivalent host-control socket exposed to guests.
- No broad host filesystem mounts.
- Explicit file import/export through Beale-controlled artifact channels.
- Network policy remains session-level and scope-aware.
- Resource limits for CPU, memory, disk, runtime, and process count where supported.
- Guest images are versioned and reproducible.
- Sandbox lifecycle events are written to the trace.

VMs reduce escape risk, but they are not treated as perfect. Docker containers reduce accidental host impact but share more host kernel/control surface than a VM. Host execution is more dangerous and should be treated as a documented convenience mode, not as a security boundary.

## Snapshot Flow

VM snapshotting is a first-class workflow when the session uses VM isolation.

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

- Prefer a disposable VM instead of host execution.
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

Firecracker, or a comparable local microVM/VM backend, is the recommended Linux VM direction.

Planning requirements:

- Fast disposable guests.
- Strong host/guest boundary.
- Minimal guest images for repeatable research runs.
- Controlled artifact transfer.
- Support for debugger, sanitizer, fuzzer, and binary-analysis toolchains.

## Docker and Devcontainers

Docker is a supported degraded sandbox provider, not the primary safety boundary.

Roles:

- Convenience sandbox for lower-risk trusted-source workflows.
- Build tool inside a VM guest.
- Compatibility mode for trusted source projects.
- Importing project devcontainer definitions into a Beale-controlled VM image.

Docker settings must show an orange warning that Docker is less secure than a virtual machine. Project-authored devcontainers are untrusted configuration and must not become an automatic host-level execution path.

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

In sandbox-backed sessions, the guest VM or container owns:

- Target execution.
- Build/test/debug/fuzz commands.
- Runtime instrumentation.
- Temporary working files.

The guest communicates with Beale only through narrow, typed channels.

## Planning Consequence

The executor abstraction should be sandbox-aware:

```text
Executor
  HostResearchExecutor
  WindowsHyperVExecutor
  TartExecutor
  LinuxFirecrackerExecutor
  DockerContainerExecutor
```

The exact class names are placeholders. The important point is that local VM execution remains the recommended safety option, while host and Docker execution are explicit degraded product paths and must be clearly traceable.
