# Trusted Harness Boundary

Status: revised sandbox default, 2026-04-28.

## Decision

Beale should keep the trusted harness on the host. Normal research sessions are VM-free by default and run commands/executables on the host after an orange warning in the New Research Session flow. Disposable guest VMs remain the recommended isolation boundary and can be selected for sessions that need stronger protection.

The VM is a tool the harness controls. The VM is not where the harness lives.

## Boundary

| Component | Trusted Host | Guest VM |
| --- | --- | --- |
| Electron GUI | yes | no |
| OpenAI OAuth credentials | yes | never |
| Model/WebSocket session | yes | never |
| Workspace SQLite database | yes | never |
| Artifact store authority | yes | no direct write |
| Authorization policy | yes | no |
| Tool policy and approvals | yes | no |
| Trace/audit log authority | yes | no direct write |
| Target source or binary | scoped copy/reference | yes |
| Build/test/debug/fuzz execution | default | VM sessions |
| Temporary execution state | default | VM sessions |
| Verifier promotion decision | yes | no |

## Rationale

Target code is untrusted. That includes:

- Build scripts.
- Test scripts.
- Project tooling.
- Closed-source binaries.
- Crash reproducers.
- Fuzz targets.
- Debugger automation.
- Generated PoCs.

If Beale runs target code on the host, target execution can potentially read host files, affect local state, or interfere with future runs. Beale accepts this as the default usability tradeoff only when the session-start warning is shown and the selected sandbox is recorded.

## Fast Workflow Without Collapsing the Boundary

VM performance work still matters, but usability requires a host-default path for researchers who will not accept VM setup or load.

Required workflow aids:

- Orange host-execution warning when creating a default session.
- Clear session metadata showing host vs VM execution.
- Prebuilt toolchain snapshots.
- Clone/revert per attempt.
- Clean target snapshots when setup is expensive.
- Host-side artifact cache.
- Incremental target import.
- Explicit artifact export.
- Fast rerun, fork, and revert controls in the GUI.
- Clear display of VM state: clean, working, contaminated, preserved, destroyed.

## Data Flow

Typical host-default execution flow:

1. Beale host loads the workspace database.
2. The user starts a session after the host-execution warning.
3. Beale resolves scoped target material on the host.
4. The model requests a tool call.
5. Beale checks authorization, tool policy, and sandbox policy.
6. Beale executes the command or structured tool on the host.
7. The host runner returns stdout, stderr, exit status, and artifact references through a controlled channel.
8. Beale stores trace events and artifact metadata in the host database.
9. Beale stores selected artifacts in the host artifact store.

VM-backed sessions insert the VM clone/import/execute/export/revert lifecycle between steps 2 and 9.

## Prohibited Defaults

Beale should not:

- Run the model client inside the guest.
- Store OAuth/API credentials inside the guest.
- Mount `.beale/beale.sqlite` inside the guest.
- Mount the full host workspace read-write inside the guest.
- Expose host-control sockets to the guest.
- Let the guest directly write authoritative artifacts.
- Let guest logs become trusted evidence without host-recorded provenance.
- Reuse contaminated guest state as a clean base.
- Hide host execution behind a default session without the warning.

## Planning Consequence

The executor API should be command/artifact oriented:

- Host runner or guest VM runs a scoped operation.
- The selected sandbox returns observations and candidate artifacts.
- Host records, validates, indexes, and decides what becomes evidence.

This boundary should shape tool design, trace design, verifier design, and GUI state.
