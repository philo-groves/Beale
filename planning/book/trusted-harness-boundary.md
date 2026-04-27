# Trusted Harness Boundary

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should keep the trusted harness on the host and run target code only inside disposable guest VMs.

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
| Build/test/debug/fuzz execution | no | yes |
| Temporary execution state | no | yes |
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

If Beale runs its model client, credentials, database, artifact authority, or verifier decisions inside the same environment as target code, target execution can potentially read secrets, tamper with traces, modify findings, or influence future runs.

## Fast Workflow Without Collapsing the Boundary

Performance should come from efficient VM operations, not from weakening isolation.

Required workflow aids:

- Prebuilt toolchain snapshots.
- Clone/revert per attempt.
- Clean target snapshots when setup is expensive.
- Host-side artifact cache.
- Incremental target import.
- Explicit artifact export.
- Fast rerun, fork, and revert controls in the GUI.
- Clear display of VM state: clean, working, contaminated, preserved, destroyed.

## Data Flow

Typical execution flow:

1. Beale host loads the workspace database.
2. Beale restores or clones a VM from a clean snapshot.
3. Beale imports scoped target material into the guest.
4. The model requests a tool call.
5. Beale checks authorization, tool policy, and sandbox policy.
6. Beale executes the command or structured tool inside the VM.
7. The guest returns stdout, stderr, exit status, and artifact references through a controlled channel.
8. Beale stores trace events and artifact metadata in the host database.
9. Beale exports selected artifacts into the host artifact store.
10. Beale reverts or destroys the guest VM.

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

## Planning Consequence

The executor API should be command/artifact oriented:

- Host asks the guest to run a scoped operation.
- Guest returns observations and candidate artifacts.
- Host records, validates, indexes, and decides what becomes evidence.

This boundary should shape tool design, trace design, verifier design, and GUI state.
