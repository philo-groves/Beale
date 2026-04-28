# Roadmap

Status: draft implementation plan, 2026-04-27.

## Decision

Beale should be built as a sequence of vertical slices.

The first goal is not to prove every security tool, VM backend, or model integration. The first goal is to make the workbench shape real: workspace, scope, run tracker, trace, artifacts, hypotheses, verifier state, and persistence.

After that skeleton exists, replace fake subsystems with real OpenAI, VM, tool, and benchmark implementations one boundary at a time.

## Milestone 0: Planning Lock

Purpose:

- Stabilize the first implementation target.
- Keep the first release aligned to authorized open-ended vulnerability research.

Exit criteria:

- Product scope documented.
- Authorization and sandbox boundaries documented.
- Persistence and trace model documented.
- GUI direction documented.
- Initial implementation architecture documented.
- First vertical slice accepted.

## Milestone 1: Workbench Skeleton

Purpose:

- Build the Electron product shell and local state model without waiting for model or VM integration.

Includes:

- Open or create a workspace directory.
- Initialize `.beale/beale.sqlite`.
- Edit and persist program scope.
- Start a run from a markdown prompt.
- Persist runs, attempts, trace events, artifacts, hypotheses, findings, and verifier placeholders.
- Render the primary run tracker.
- Render run detail with trace, hypotheses, artifacts, and verifier panels.
- Use a fake run engine that emits deterministic, realistic trace events.

Exit criteria:

- A user can create a workspace, define scope, start a fake research run, steer it, close the app, reopen it, and see the same state.
- The UI is clearly a research workbench, not a chat transcript.
- No target code execution exists yet.

## Milestone 2: OpenAI Run Engine

Purpose:

- Add the real model loop while keeping execution fake or tightly simulated.

Includes:

- OAuth-first account flow.
- OpenAI Responses API adapter.
- WebSocket transport where available.
- `gpt-5.5` with `xhigh` default.
- Beale-owned run engine and trace schema.
- Tool-call protocol mapping.
- Context packing and replay policy.
- Model-visible redaction.

Exit criteria:

- A run can stream model output and tool requests into the trace.
- Tool calls are policy-checked before execution.
- Model claims remain distinct from observations.
- OpenAI credentials stay on the host.

## Milestone 3: VM Executor Alpha

Purpose:

- Replace fake execution with a real VM-first executor on one platform.

Includes:

- Executor interface implementation for the first supported local VM backend.
- Snapshot restore, clone, revert, preserve, and destroy.
- Scoped target import.
- Explicit artifact export.
- Offline and scoped network profiles.
- Guest command execution.
- Guest `python` and shell support.

Exit criteria:

- Target code can be imported and executed inside a disposable VM.
- The host SQLite database and OAuth credentials are never mounted in the guest.
- VM lifecycle events appear in trace.
- Artifact export is host-controlled and content-addressed.

## Milestone 4: Structured Research Tools

Purpose:

- Make the first model-facing tool set useful enough for real research.

Includes:

- `search`.
- `code_browser`.
- `python`.
- `debugger`.
- `artifact`.
- `verifier`.
- Guest shell fallback.
- Tool-specific trace and artifact policies.
- Debugger wrapper for one guest image.

Exit criteria:

- The model can inspect source or binary-derived text, generate inputs, run a target, debug a crash, preserve artifacts, and call a verifier.
- Raw noisy outputs are artifact-backed and summarized.
- Evidence references trace events or artifacts, not model prose.

## Milestone 5: Open-Ended Discovery Alpha

Purpose:

- Turn the tool loop into a usable vulnerability research workflow.

Includes:

- Adaptive portfolio attempt strategy.
- Hypothesis board.
- Finding priority scoring.
- Reproduction verifier contracts.
- Patch validation verifier contracts.
- User steering: pause, resume, fork, stop, rerun verifier, promote artifact, mark sensitive.
- Disclosure draft and evidence bundle export.

Exit criteria:

- A researcher can start broad discovery, inspect hypotheses, steer a promising path, reproduce a finding, and export evidence.
- Verifier-backed findings are visually distinct from hypotheses.
- False-positive and out-of-scope states are first-class.

## Milestone 6: Benchmark and Calibration

Purpose:

- Validate workbench behavior and detect regressions.

Includes:

- Smoke calibration suite.
- Tool competency suite.
- Safety and policy suite.
- Small CyberGym-compatible subset.
- Dockerized benchmark agent harness.
- Host-side model/auth proxy.
- Host-side grader isolation.
- Harness identity metadata.

Exit criteria:

- Beale can compare same-model, different-harness runs on a stable sample.
- Benchmark mode cannot read grader files or ground truth.
- Benchmark mode does not change the normal VM workbench architecture.

## Milestone 7: Beta Hardening

Purpose:

- Make v1 dependable enough for trusted users.

Includes:

- Cross-platform VM backend expansion.
- Crash and recovery handling.
- Redaction review.
- Export review.
- Scope and network policy review.
- Workspace backup/export.
- Migration tests.
- Usability pass on dense research views.

Exit criteria:

- The app can survive interrupted runs, app restarts, VM failures, verifier failures, and partial exports without corrupting authoritative state.

## Sequencing Rules

- Prefer one complete workflow over many incomplete tools.
- Keep target execution location explicit from the first real executor; host execution is default but must be warning-backed and traceable.
- Keep fake systems explicitly labeled in UI and trace.
- Add new model-facing tools only after the initial six tools are deep enough.
- Do not let benchmark needs override workbench needs.
- Do not add remote persistence or cloud sync in v1.

## First Release Definition

The first release is credible when Beale can support authorized open-ended discovery on local targets with:

- Program scope.
- Local persistence.
- OpenAI run engine.
- VM execution.
- Minimal structured tools.
- Trace-backed evidence.
- Verifier-backed findings.
- Human steering.
- Exportable evidence bundles.
