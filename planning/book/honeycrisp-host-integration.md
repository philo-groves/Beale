# Honeycrisp Host Integration

Status: branch direction for `harness/honeycrisp`, 2026-06-25.

## Decision

Beale should integrate Honeycrisp as a host-side research agent dependency.

Honeycrisp should not contain Beale-specific references. Beale owns the Electron workbench, process lifecycle, user safety controls, workspace selection, and renderer UX. Honeycrisp owns the general research runtime, memory, tools, storage, and model loop.

## Product Shape

The Honeycrisp harness branch should keep Beale's reusable research workbench surfaces:

- Program onboarding and workspace scope.
- Session heat and research momentum.
- Trace timeline, evidence, hypotheses, findings, transcripts, and notifications.
- Program understanding and relationship graph views.
- Provider and sandbox configuration views.

The branch should remove Beale's verification-era emphasis on benchmark operation:

- No special CyberGym sidebar entry.
- No benchmark settings section in the main settings modal.
- No CyberGym benchmark workspace as a primary renderer route.
- No benchmark-specific run starter flow.

Benchmark and calibration code can remain in lower-level services until a dedicated pruning pass decides whether to keep it as internal test infrastructure.

## Run Creation

Honeycrisp does not need Beale's chat-like prompt generation flow.

Starting a run should be a direct host instruction form: the user supplies the research objective, scope constraints, and evidence requirements. Beale should pass that request to the configured host agent and then render events, artifacts, and session state as they stream back.

## Host Protocol Target

The Beale-to-Honeycrisp boundary should prefer a small structured protocol that can be exercised outside the renderer:

- Start, stop, pause, resume, and steer a run.
- Stream JSONL or equivalent structured events.
- Surface model messages, tool calls, tool results, memory updates, storage artifact references, findings, and notifications.
- Expose host configuration and readiness errors before starting a run.
- Preserve artifact paths and durable memory ids without assuming Beale owns Honeycrisp storage internals.

## MCP and Built-In Views

Some Beale UX features may become Honeycrisp-facing tools instead of renderer-only concepts.

Session heat is a good candidate for a built-in MCP-style capability: the host can summarize run pressure, evidence density, blockers, and change over time, while Beale renders the result as a compact operational signal.

## Near-Term Checklist

- [x] Create the `harness/honeycrisp` branch.
- [x] Remove the visible benchmark sidebar and settings focus.
- [x] Remove the obsolete renderer benchmark workspace files and styles.
- [x] Remove prompt generation from the new research modal.
- [ ] Define the host protocol shape for run lifecycle and event streaming.
- [ ] Map Honeycrisp event records into Beale trace, evidence, and notification views.
- [ ] Decide which benchmark services stay as private test infrastructure.
- [ ] Prototype a Honeycrisp process adapter behind Beale's existing run engine boundary.
