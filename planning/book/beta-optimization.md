# Beta Optimization Plan

Status: proposed beta-hardening direction, 2026-04-29.

## Decision

Before closed beta, Beale should run a dedicated optimization pass alongside the beta refactor.

The optimization pass should be planned now, while the current vertical slice still exposes most renderer, host, trace, and session behavior in one place. File extraction will improve maintainability, but it will not automatically fix lag. Performance needs its own design rules so refactoring creates useful update boundaries instead of distributing the same bottlenecks across more files.

## Why This Is Separate From Refactoring

The beta refactor plan is about code structure, ownership, and reviewability.

The beta optimization plan is about responsiveness under real research load:

- active model streams,
- fast trace bursts,
- long transcript and trace histories,
- markdown and syntax-highlighted outputs,
- concurrent sessions,
- session switching,
- background animations,
- momentum/context updates,
- settings, modals, and steering inputs staying usable while work is active.

The two efforts should inform each other, but they have different success criteria. A clean module boundary is not successful if every trace event still rerenders the whole app.

## Goals

- Keep app inputs responsive while sessions stream traces, transcript updates, and tool results.
- Prevent active run updates from rerendering unrelated surfaces such as settings, inactive sidebars, and closed modals.
- Make trace rendering scale with visible content, not total session history.
- Avoid repeated markdown parsing, syntax highlighting, turn grouping, and label derivation for old events.
- Make animations graceful under load and optional when the renderer is busy.
- Keep optimization local and understandable before adding broad architectural machinery.
- Preserve all security, persistence, and model/tool contract boundaries.

## Non-Goals

- Do not add remote telemetry for beta performance measurement.
- Do not introduce a broad state-management framework without measured need.
- Do not hide data loss, trace loss, or dropped events behind performance shortcuts.
- Do not weaken trace provenance or transcript persistence to reduce rendering cost.
- Do not move host-owned policy or persistence logic into the renderer for convenience.
- Do not optimize by removing useful trace, hypothesis, finding, or evidence detail from the data model.

## Performance Principles

- Measure before broad changes.
- Prefer fewer invalidated components over faster rerenders of the whole tree.
- Keep hot derived data memoized by stable version keys.
- Keep expensive formatting close to the feature that owns it, but pure and testable.
- Bound visible work without truncating authoritative data.
- Degrade animation before degrading inputs.
- Preserve user trust: if content is delayed, the UI should make that clear instead of feeling frozen.

## Measurement First

Beale should add lightweight local instrumentation before deep optimization work.

Useful measurements:

- Time from trace event receipt to visible trace update.
- Time spent deriving trace turn groups.
- Time spent rendering trace rows.
- Time spent rendering markdown and syntax-highlighted code.
- React render count for app shell, sidebar, trace list, hypotheses, findings, evidence, footer, and modals during active runs.
- Input latency while trace events are arriving.
- Main process snapshot size and serialization time.
- IPC update frequency during streaming responses.
- Animation frame budget pressure while background pulses and the momentum mascot are active.

Instrumentation should be local-only and developer-visible. It should not become product telemetry for the first release.

## Renderer Hot Paths

The known renderer hot paths are:

- active run detail updates,
- trace grouping and windowing,
- trace item label/content derivation,
- markdown rendering for thoughts and agent responses,
- syntax highlighting for Python and JSON,
- hypothesis/finding/evidence list derivation,
- sidebar program and session ordering,
- context meter and momentum animation,
- background pulse animation,
- modal detail rendering for large payloads.

Each extracted feature should know whether it is in a hot path. Hot-path components should use stable inputs, memoized view models, and minimal prop churn.

## State Isolation

Active session state should not invalidate the whole UI.

Recommended boundaries:

- App shell state: sidebar open, inspector open, modal kind, window controls.
- Workspace list state: programs, selected program, session summaries.
- Active run state: current run detail, streaming updates, trace window.
- Footer telemetry state: environment labels, momentum, context meter.
- Modal state: selected trace, selected prompt, selected settings section.
- Settings/provider state: loaded on demand and updated independently.

Refactoring should avoid passing the full `RunDetail` object through every component when a smaller view model or selector is enough.

## Trace Rendering Strategy

Trace rendering should scale with what the user can see.

Rules:

- Keep authoritative trace events persisted and queryable.
- Render a sliding visible window, with reliable scroll-up access to older windows.
- Derive turn groups once per trace version instead of on every paint.
- Cache stable trace labels, category icons, summaries, markdown fragments, and syntax-highlighted snippets.
- Avoid re-highlighting code blocks that have not changed.
- Keep trace insert animations short and queue-aware.
- Prefer modal detail rendering for large payloads rather than expanding every row.
- Keep inspector/evidence sidebars independent from trace scroll updates.

The goal is not fewer traces. The goal is less repeated work per trace.

## Transcript and Markdown Strategy

Agent thoughts and outputs can be long and line-rich.

Rules:

- Store transcripts as authoritative data.
- Render only visible transcript-derived trace rows.
- Parse markdown for visible rows only.
- Cache parsed output by message id or trace event id.
- Keep code formatting lightweight for inline backtick spans.
- Run heavier syntax highlighting only for code blocks and modal payloads that are visible.

If parsing becomes expensive, Beale should add a small renderer-side cache before introducing worker threads.

## Animation Budget

Animations make the app feel alive, but they must yield to input responsiveness.

Animated systems:

- momentum snake,
- strawberry/context meter,
- background pulses,
- trace insertion slides,
- scroll fades,
- environment activity sheen,
- severity background transitions.

Rules:

- Respect reduced motion.
- Pause or simplify nonessential animation when the renderer is under sustained load.
- Avoid animation state updates that trigger React renders every frame.
- Prefer canvas or CSS animations that do not mutate React state per frame.
- Keep background animation subtle and independent from trace rendering.

The momentum mascot may update every animation frame inside canvas. It should not cause React state updates every frame.

## IPC and Snapshot Pressure

Lag can come from the main-to-renderer boundary even when React is healthy.

Areas to watch:

- large `RunDetail` snapshots,
- frequent trace-event bursts,
- transcript streaming updates,
- repeated full-program snapshots,
- settings/provider refreshes during active runs.

Potential fixes:

- send incremental run-detail updates for hot streams,
- keep full snapshots for startup, session switch, and recovery,
- debounce noncritical workspace summary refreshes,
- avoid sending unchanged large payloads repeatedly,
- keep trace payload detail available on demand when possible.

Any incremental update path must preserve authoritative SQLite state and recovery behavior.

## Database and Query Shape

Renderer lag can be caused by slow host queries or over-large result sets.

Beta optimization should review:

- active run detail query cost,
- trace ordering indexes,
- transcript query shape,
- hypothesis/finding/evidence joins,
- program-wide duplicate checks,
- startup recovery queries,
- session summary queries for the sidebar.

The first optimization pass should prefer query shape and indexes over schema redesign. Schema changes should be isolated and migration-tested.

## Optimization-Aware Refactor Order

The beta refactor should extract performance-sensitive boundaries in this order:

1. Footer telemetry and momentum canvas, because it updates frequently and should be React-light.
2. Trace view model and trace list, because it is the largest active-session cost.
3. Transcript/markdown rendering helpers, because thoughts and outputs are growing in importance.
4. Hypothesis/finding/evidence lists, because they derive from active run state but should not rerender on every trace row.
5. Sidebar session summaries, because concurrent sessions will make program-wide state more active.
6. Modal detail renderers, because large trace payloads should be isolated from the main view.

This order overlaps with the beta refactor plan but uses responsiveness as the reason for each extraction.

## Testing Strategy

Optimization work should have focused checks that prevent regressions.

Useful tests:

- trace window selection preserves access to older events,
- new trace events append without losing active scroll-to-bottom behavior,
- trace labels and derived content remain stable after memoization,
- markdown and syntax highlighting output remains equivalent for representative events,
- session switching does not pause active sessions,
- steering targets the selected run and does not create a new run,
- context meter formatting remains stable at low, medium, high, and compacted sizes,
- hypothesis/finding/evidence cards do not require full trace recomputation.

Manual beta checks:

- type into steering while traces stream quickly,
- open and close settings while a session is active,
- switch to an old session while a new session continues,
- open a large trace modal,
- scroll trace history upward and return to live bottom,
- run with background animation and reduced motion.

## Beta Exit Criteria

The optimization pass is successful when:

- Inputs remain usable during active trace streaming.
- Session switching does not pause or starve active sessions.
- Long trace histories do not make the active trace list progressively slower.
- Old trace rows are not repeatedly markdown-parsed or syntax-highlighted.
- Background and mascot animations do not cause measurable app-shell rerender loops.
- The sidebar remains responsive with multiple programs and sessions.
- Modals open over large traces without blocking active session updates.
- Full reload and restart recovery still reconstruct authoritative state correctly.
- Typecheck and focused tests pass after each optimization slice.

## Implemented First Pass

The first optimization pass added local, opt-in measurement and reduced the hottest polling cost.

Implemented:

- Renderer dev instrumentation for render counts, trace derivation timing, markdown/syntax timing, IPC timing, payload size estimates, and input next-frame latency.
- Dev-only renderer DevTools controls so the instrumentation can be enabled from the renderer console.
- Production-capable profiling opt-in from Settings > General that enables the same renderer probes without requiring `npm run dev`.
- Structured local JSONL profiling output in the temp directory, containing renderer reports plus main IPC and OpenAI stream timing records.
- A Debug header button and profiling overview modal while profiling is enabled.
- Main-process opt-in timing logs for `getRunDetail` and `getRunDetailVersion` through `BEALE_MAIN_PERF=1` or `BEALE_DEV_PERFORMANCE=1`.
- A cheap `RunDetailVersion` IPC path that lets active polling check whether a run changed before transferring full run detail.
- An incremental `RunDetailUpdate` IPC path that transfers only new trace/transcript rows plus small current collections when the renderer already has full detail.
- Renderer polling that checks the cheap version first, uses incremental updates when possible, and falls back to full `RunDetail` for initial load or session switch.
- Initial memo boundaries and stable callbacks for background pulses, top bar, footer/status bar, and the momentum/context meter.
- A profiling self-noise reduction so background JSONL flushes keep writing reports but do not update app React state unless Settings or the Debug profiling modal is observing them.
- Corrected sidebar render attribution by moving the `sidebar.programs` probe into the sidebar component instead of measuring it from `App`.
- A lighter research-session selection path that no longer reloads the full snapshot or global program registry when the user only changes the selected session.
- Additional profiling visibility for `getProgramRegistry`, `getSnapshot`, `openProgram`, and program-registry payload size.
- A small recently opened workspace-runtime cache so repeated cross-program session switching can reuse initialized SQLite/runtime state instead of cold-opening each program.
- Grouped run-row summary queries for snapshot construction, replacing per-run lookups for attempt counts, latest attempts, top hypotheses/findings, verifier state, policy blocks, and artifact counts.
- Internal snapshot construction timings for workspace summary, OpenAI status, executor status, VM preference, policy review, run rows, notifications, and benchmark overview.
- A short vmctl capability-status cache so regular snapshot rendering does not spawn the controller for every program switch.
- A short OpenAI provider-status cache so regular snapshot rendering does not re-read credentials and re-check Codex CLI availability on every program switch.
- Active trace-stream profiling for main-process snapshot broadcast work, renderer snapshot apply latency, incremental run-detail merge/apply latency, and trace reveal queue batches.

The first measured sample showed that visible trace rendering was not the primary cost. The larger cost was full run-detail refresh: about 2 MB over IPC and roughly half a second for a completed session with 876 trace events and 35 transcript messages. The cheap-version polling path is the first correction for that specific bottleneck.

The first post-profiling sample with session switching showed the main process run-detail work was cheap, with `getRunDetail` between roughly 3 and 20 ms and `getRunDetailVersion` between roughly 3 and 12 ms. Renderer-side waits were much larger, including hundreds of milliseconds around session switching, so the next work should focus on renderer invalidation, payload handoff, and component boundaries rather than SQLite query cost.

## Remaining Work

Remaining beta optimization work should proceed in this order:

1. Re-measure active sessions while trace events stream, with attention to `broadcastSnapshot.*`, `trace.runDetail.*`, `ipc.snapshot.event.apply.nextFrameLatency`, and `trace.list.revealBatch.nextFrameLatency`.
2. If renderer-side IPC waits stay high while main timings remain low, profile payload handoff and React commit pressure around session switching.
3. If `getRunDetailVersion` is still expensive in main-process timing, collapse its aggregate queries or add targeted indexes for version checks.
4. If `getRunDetailUpdate` still grows too large, split its small collections into separate on-demand slices.
5. Replace active polling with pushed incremental updates where practical, while keeping full snapshots for startup, recovery, and session switch.
6. Split full run detail into stable summary, visible trace window, transcript slices, and modal-on-demand payloads for inactive and large historical sessions.
7. Memoize trace display events, turn grouping, trace labels, and hypothesis/finding/evidence lookups by stable version keys.
8. Cache markdown parsing and syntax highlighting by trace event id or transcript message id.
9. Extract sidebar session summaries so active run updates do not rerender the full program list.
10. Add focused tests for trace window continuity, memoized trace labels, and markdown/syntax output equivalence.

## First Practical Slice

The first implementation slice should add local performance visibility before changing behavior:

- render count probes for major renderer surfaces,
- trace derivation timing,
- visible trace render timing,
- input latency smoke checks during trace bursts,
- optional developer-only logging that can be disabled cleanly.

After that, optimize the trace list and footer telemetry first. Those surfaces update frequently, are visible during every active run, and will reveal whether the refactor is creating useful performance boundaries.
