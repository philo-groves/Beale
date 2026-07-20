# Honeycrisp Host Integration

Status: branch direction for `harness/honeycrisp`, 2026-06-25.

## Decision

Beale should integrate Honeycrisp as a host-side research agent dependency.

Honeycrisp should not contain Beale-specific references. Beale owns the Electron workbench, process lifecycle, user safety controls, workspace selection, and renderer UX. Honeycrisp owns the general research runtime, durable knowledge contract, tools, storage, model loop, and workspace database path. Beale stores its operational tables in that same database.

Honeycrisp passes the research request and compiled workspace context directly to Pi's native agent loop. The selected model owns planning, decomposition, tool use, and completion. Neither Honeycrisp nor Beale creates a parallel goal tree, generated subgoals, controller-selected action plan, completion gate layer, or outer loop budget. Future subagents should be exposed as model-facing capabilities rather than reintroducing controller-owned decomposition.

## Product Shape

The Honeycrisp harness branch should keep Beale's reusable research workbench surfaces:

- Authorized workspace onboarding and scope.
- Session heat and research momentum.
- Trace timeline, evidence, hypotheses, findings, transcripts, and notifications.
- Workspace understanding and relationship graph views.
- Provider and sandbox configuration views.

The branch should remove Beale's verification-era emphasis on benchmark operation:

- No special CyberGym sidebar entry.
- No benchmark settings section in the main settings modal.
- No CyberGym benchmark workspace as a primary renderer route.
- No benchmark-specific run starter flow.

Benchmark and calibration code can remain in lower-level services until a dedicated pruning pass decides whether to keep it as internal test infrastructure.

## Run Creation

Honeycrisp does not need Beale's chat-like prompt generation flow.

Starting a run should be a direct host instruction form: the user supplies the research objective while Beale supplies the recorded authorization boundary, scope facts, and relevant source references. Beale should pass that context to the configured host agent and then render events, artifacts, and session state as they stream back.

Recorded authorization is passed as structured workspace context rather than inferred from prose or required prompt headings. Honeycrisp may proceed within that boundary without repeatedly asking the user to restate authorization. Hard limits remain host-enforced through the active scope and selected network profile.

Beale should not impose a mandatory triage or research-method skill. The default model owns investigation and skeptical review. Explicit user-selected Honeycrisp skills remain supported.

## Host Protocol Target

The Beale-to-Honeycrisp boundary should prefer a small structured protocol that can be exercised outside the renderer:

- Start, stop, pause, resume, and steer a run.
- Stream JSONL or equivalent structured events.
- Surface model messages, tool calls, tool results, durable knowledge updates, storage artifact references, findings, and notifications.
- Expose host configuration and readiness errors before starting a run.
- Preserve artifact paths and durable memory ids without assuming Beale owns Honeycrisp storage internals.
- Import schema-v2 captures as a research request plus one agent session; do not reconstruct goal/subgoal state in Beale.

The first branch slice uses the existing Honeycrisp CLI as that protocol boundary. Beale starts a host process, passes the run prompt plus authorization context and explicitly referenced source roots, streams stdout/stderr into Beale trace events, and imports the final Honeycrisp flow capture as a Beale artifact and assistant transcript. Source checkouts may live in the user-global Beale repository store; their inclusion in a run remains workspace-local.

Before launching Honeycrisp, Beale resolves explicit GitHub or GitLab repository URLs in the user-authored prompt through its user-global source store and records the resulting checkout as a workspace-local reference. Offline runs require the source to have already been attached to the workspace.

When launching the CLI from Electron, Beale must resolve a plain Node runtime instead of using Electron's own executable as `process.execPath`. Packaged or nonstandard deployments can override this with `BEALE_HONEYCRISP_NODE_COMMAND`.

## MCP and Built-In Views

Some Beale UX features may become Honeycrisp-facing tools instead of renderer-only concepts.

Session heat is a good candidate for a built-in MCP-style capability: the host can summarize run pressure, evidence density, blockers, and change over time, while Beale renders the result as a compact operational signal.

## Near-Term Checklist

- [x] Create the `harness/honeycrisp` branch.
- [x] Remove the visible benchmark sidebar and settings focus.
- [x] Remove the obsolete renderer benchmark workspace files and styles.
- [x] Remove prompt generation from the new research modal.
- [x] Define the first host-process protocol shape for run lifecycle and capture import.
- [x] Map Honeycrisp event records into Beale trace rows, final transcript output, notifications, and capture artifacts.
- [ ] Decide which benchmark services stay as private test infrastructure.
- [x] Prototype a Honeycrisp process adapter behind Beale's existing run engine boundary.
- [x] Launch the default Honeycrisp CLI through a plain Node runtime from Electron.
- [x] Add bidirectional host control: process-tree pause/resume plus JSONL steering delivered to the active Honeycrisp Pi agent loop.
- [x] Continue inactive sessions in place: steering starts a new Honeycrisp attempt under the existing Beale run and supplies the bounded prior session transcript as model context.
- [x] Reframe Beale's no-session workspace overview around durable knowledge, artifact storage, retrieval index state, and workspace tracking.
- [x] Unify Beale and Honeycrisp persistence in the Honeycrisp-owned workspace database and replace event-derived memory views with the durable knowledge graph.
- [ ] Replace capture-after-exit import with live JSONL event streaming when Honeycrisp exposes it.
- [ ] Promote high-confidence Honeycrisp hypotheses/evidence into Beale hypothesis and evidence tables instead of trace-only rows.
