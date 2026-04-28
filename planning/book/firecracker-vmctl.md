# Firecracker VM Controller

Status: alpha implementation direction, 2026-04-27.

## Decision

Beale's first real local VM backend should be a Firecracker controller on Linux/WSL. It is an opt-in safety backend, not the default research sandbox.

The Beale app continues to talk to a narrow `vmctl` JSON command through `BEALE_VMCTL_COMMAND`. Firecracker-specific host setup stays outside the renderer and outside the model-facing tool surface.

## WSL Requirements

Firecracker requires KVM access from the WSL Ubuntu environment.

Required host state:

- WSL2 Linux kernel exposes `/dev/kvm`.
- The Beale user can read and write `/dev/kvm`, or the controller is run with explicit sudo configuration.
- The controller can create a TAP interface for the Beale host-to-guest control bridge.
- `firecracker` binary is installed in `.beale/firecracker/bin/firecracker` or configured in `.beale/firecracker/config.json`.
- A Firecracker-compatible uncompressed kernel image is configured.
- A writable ext4 rootfs image is configured.
- The rootfs accepts SSH from the host bridge using the configured key.
- For the Firecracker CI rootfs, `network.guestMac` must match `network.guestIp`; the default is `06:00:AC:10:00:02` for `172.16.0.2`.

KVM access should be granted explicitly, for example with ACLs or the `kvm` group. Beale should not silently run target execution on the host when KVM is unavailable.

TAP setup requires root, `CAP_NET_ADMIN`, or explicit passwordless sudo for the narrow Firecracker controller commands. The app should treat missing TAP privileges as an unavailable executor, not as a degraded host-execution mode.

The recommended WSL alpha path is Beale's root-owned privileged helper. It copies the Firecracker binary to `/usr/local/bin/beale-firecracker`, installs `/usr/local/libexec/beale-firecracker-helper`, and writes a narrow sudoers entry for that helper. Do not grant passwordless sudo to a user-writable Firecracker binary or to broad commands such as unrestricted `curl`.

## Commands

Initialize local config:

```bash
npm run firecracker:init
```

Check host readiness:

```bash
npm run firecracker:doctor
```

Download the Firecracker binary into the workspace cache:

```bash
npm run firecracker:install-binary
```

Install Firecracker CI kernel/rootfs images and an SSH key:

```bash
npm run firecracker:install-ci-images
```

Install the privileged helper for KVM/TAP/API operations:

```bash
sudo node scripts/firecracker-setup.mjs --install-privileged-helper --config .beale/firecracker/config.json
```

Start Beale with the controller:

```bash
BEALE_VMCTL_COMMAND="$(command -v node)" \
BEALE_VMCTL_ARGS_JSON='["scripts/firecracker-vmctl.mjs","--config",".beale/firecracker/config.json"]' \
npm run dev
```

## Controller Scope

The alpha controller supports:

- `list_capabilities`
- `create_context`
- `restore_snapshot`
- `clone_context`
- `import_workspace_material`
- `execute`
- `export_artifact`
- `revert`
- `preserve`
- `destroy`

The controller starts from a clean rootfs copy per context, queues scoped imports, boots Firecracker, copies imports into the guest over the Beale host bridge, executes guest shell/Python commands over SSH, exports selected files back to Beale, and destroys or preserves context state.

## Network Posture

When a research session uses Firecracker, its default VM network profile is `elevated`.

The controller uses a host-to-guest bridge for executor control and enables unrestricted guest NAT for the `elevated` profile. The session layer remains responsible for deciding whether a requested action is allowed by the recorded program scope before it asks the VM to run it.

Benchmark execution remains `offline`. Benchmark isolation is handled by the Dockerized benchmark harness, host-side grader, and host-side model/auth proxy rather than by the normal Firecracker online profile.

`offline` still starts only the host-to-guest control bridge. `scoped` networking remains disabled unless `enableScopedNetwork` is explicitly set in the controller config and the host-side network policy is audited. When enabled, Beale passes the run's scoped domain/host/IP/service allowlist to the controller, the controller pins domain and host destinations to resolved IPv4 addresses, and host firewall/NAT rules fail closed to that allowlist. Live-target access still requires recorded program scope and session-level policy approval.

## Non-Goals

- Hyper-V support.
- Tart support.
- A production Firecracker jailer profile.
- A general host shell.
- Docker as the normal sandbox boundary.
- Passing OpenAI credentials or `.beale/beale.sqlite` into the guest.

## Alignment

This keeps Milestone 3 aligned with the book:

- Beale remains the trusted host harness.
- Target execution happens in disposable Firecracker guests.
- Workspace database and OpenAI credentials stay on the host.
- Guest exports are candidate artifacts until accepted by the host.
- VM lifecycle, network profile, tool result, and artifact events remain traceable in SQLite.
