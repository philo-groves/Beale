# Network Policy

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should support VM networking because real authorized vulnerability research often requires networked debugging and target interaction.

Networking must be authorized, observable, and revocable. Scope enforcement belongs at the session policy layer for the normal Firecracker path.

Benchmark mode is stricter than authorized project mode.

## Network Profiles

Beale should support three VM network profiles:

- `offline`
- `scoped`
- `elevated`

## Offline Profile

`offline` means no external network access.

Allowed:

- Loopback inside the VM or benchmark execution environment.
- Local target services started inside the same VM or benchmark execution environment.

Blocked:

- Internet access.
- LAN access.
- Host service access except explicit Beale guest bridge.
- Broadcast, mDNS, and neighbor discovery where controllable.

Default use:

- New workspaces before scope is configured.
- Benchmark mode.
- High-risk binary execution.
- Malware-adjacent analysis.
- Any task that does not need networking.

## Scoped Profile

`scoped` allows only configured program assets.

Allowed destinations can include:

- In-scope domains.
- In-scope hosts.
- In-scope IP ranges.
- In-scope ports and protocols.
- Program-provided services.

Out-of-scope destinations should be blocked unless approval records a scoped exception or scope amendment.

`scoped` remains available when a controller-level allowlist is needed, but it is no longer the normal Firecracker transport for authorized project mode.

## Elevated Profile

`elevated` allows broader VM connectivity than the current allowlist, but it is not a substitute for authorization scope.

Elevated access is the normal Firecracker VM transport for authorized research sessions. Scope enforcement belongs at the session/tool policy layer, where Beale can reason over program metadata, tool intent, and recorded approvals before a command is sent to the VM.

Requirements:

- Attempt ID recorded.
- VM ID or snapshot context recorded.
- Network policy profile recorded in the trace.
- Destination pattern recorded as specifically as possible when Beale can infer one.

Elevated access should not be time-limited by default. Long-running research operations should not be interrupted by an arbitrary timer.

If an elevated request is meant to reach a live target that is not already in scope, the session-level policy should require an explicit scope amendment or scoped exception before the action runs. The approval records the authorization change; the VM profile only controls connectivity.

## Benchmark Mode

Benchmark mode should be strict:

- `offline` by default.
- Allow loopback inside the benchmark execution environment.
- Allow benchmark-declared endpoints only when a task explicitly requires networking.
- No arbitrary live internet.
- DNS disabled, pinned, or scoped to benchmark-declared endpoints.
- Fail closed on undeclared destinations.
- Record all allow/block decisions in the trace.

Rationale:

- Benchmarks should be reproducible.
- Broad live internet can leak task data.
- Broad live internet can introduce contamination.
- Network access can create benchmark-cheating paths.

## Authorized Project Mode

Authorized project mode should follow program scope:

- Host network is allowed for safe setup and research such as cloning in-scope repositories and reading public advisories.
- Default host-backed sessions use the host network under session/tool policy.
- Firecracker VM sessions normally use `elevated` online NAT for authorized research sessions.
- Scope enforcement happens at the session/tool policy layer instead of the Firecracker NAT layer.
- `offline` remains available for high-risk local analysis and benchmark paths.
- `scoped` remains available when controller-level allowlist enforcement is explicitly desired.
- Out-of-scope network requests are blocked by session policy unless approval records a scoped exception or scope amendment.
- The GUI should show the active network profile and allowed destinations.
- Each run records whether the active network profile was `offline`, `scoped`, or `elevated`, and whether execution happened on host or VM.

## Live-Target Testing

Beale should not ban live-target testing. Some vulnerability research programs explicitly authorize it.

Beale should prevent accidental live-target testing by making scope and execution context explicit.

Policy:

- Local VM reproduction is preferred by default.
- Build from source and test against local VM services when practical.
- Generated PoCs run against local VM targets unless program scope explicitly permits live target execution.
- Live-target interaction must be represented in the recorded program scope.
- Approved test accounts and credentials must be recorded as scoped assets.
- VM network must be online before reaching live assets.
- Live-target interaction under `elevated` is valid only when the target is already in scope or the approval flow records a scope amendment.
- Commands that appear to target out-of-scope live assets should be blocked until scope is corrected.
- Benchmark mode must not perform arbitrary live-target testing.
- The GUI should clearly show when a run can reach live assets.

Rule:

Live-target testing is allowed only when the program scope explicitly includes the target and the active network profile permits it.

## Host-Controlled Network Broker

VM traffic should flow through a Beale-controlled broker or proxy where feasible.

The broker should:

- Enforce domain/IP/port/protocol allowlists.
- Mediate DNS or use a controlled resolver.
- Record connection metadata.
- Block local network ranges unless explicitly in scope.
- Block cloud metadata endpoints such as `169.254.169.254`.
- Block host services unless explicitly exposed through the Beale guest bridge.
- Fail closed when policy cannot be enforced.

Payload capture should be explicit. Connection metadata is usually enough for audit and is less likely to store sensitive data.

## DNS and Rebinding

Domain allowlists need DNS rebinding protection.

Acceptable approaches:

- Resolve and pin allowed domains for the run.
- Continuously validate resolved IPs against policy.
- Use a controlled DNS resolver attached to the network broker.

The exact implementation can vary by platform backend, but the policy should not rely on naive string matching of hostnames.

## Audit Fields

Network trace events should record:

- Attempt ID.
- VM ID.
- Network profile.
- Destination hostname, if available.
- Resolved IP.
- Port and protocol.
- Allow/block decision.
- Policy rule that matched.
- Timestamp.
- User approval ID for elevated access.

## Planning Consequence

Network policy is part of authorization and traceability. The model can request networked actions, but Beale enforces program scope through host-controlled policy.
