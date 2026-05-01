# Changelog

## Unreleased

### Added

- Added opt-in developer performance instrumentation for renderer render counts, trace derivation timing, syntax/markdown timing, IPC payload sizing, and input latency probes.
- Added dev-only renderer DevTools shortcuts and launch opt-ins for debugging performance instrumentation.
- Added a cheap run-detail version IPC path and main-process timing logs for active-session performance diagnosis.
- Added an incremental run-detail update IPC path that transfers only new trace/transcript rows plus small current collections when a run is already loaded.
- Added opt-in production-capable profiling that writes renderer reports, main IPC timings, and OpenAI stream timings to local JSONL files from Settings > General.
- Added a profiling overview modal and Debug header button while profiling is enabled.
- Added main-process profiling timings for `getProgramRegistry`, `getSnapshot`, and `openProgram`, plus renderer payload sizing for program-registry updates.
- Added internal main-process snapshot profiling timings for workspace summary, OpenAI status, executor status, run rows, notifications, and benchmark overview.
- Added active trace-stream profiling for snapshot broadcasts, incremental run-detail merge/apply latency, snapshot event apply latency, and trace reveal queue batches.
- Added a sampled pointer-move next-frame latency probe to measure hover responsiveness during active trace streams.
- Added sidebar collapse/expand profiling for toggle request latency, React state commit, next-frame latency, and transition-end timing.
- Added renderer footer view-model tests for context metering and host/VM display formatting.
- Added renderer program display tests for fixed program/session ownership and sidebar age formatting.
- Added renderer notification preview tests for extracted notification display helpers.
- Added renderer formatting tests for shared label, date, duration, priority, and truncation helpers.
- Added renderer session header tests for status, configuration, timing, and trace turn display helpers.
- Added renderer research item and session heat tests for hypothesis/finding provenance, scroll keys, and severity display helpers.
- Added evidence sidebar sorting and scroll-key coverage to renderer research item tests.
- Added renderer trace display tests for trace timeline grouping, filtering, rendered group packing, and turn status labels.
- Added renderer trace content tests for trace labels, structured detail text, reasoning text cleanup, provenance lookup, and path compaction.
- Added renderer trace visual tests for trace category filter metadata and trace type labels.
- Added renderer trace display tests for transcript-to-trace synthesis, linked trace replacement, and transcript duplicate suppression.
- Added main profiling service tests for structured JSONL output.

### Changed

- Changed research prompt generation and refinement to use medium reasoning effort while preserving the selected session effort for actual run execution.
- Changed active run-detail polling to check a cheap version first and use incremental updates instead of full detail refreshes when possible.
- Changed production profiling so background JSONL flushes no longer update React state unless the Debug/Settings UI is observing reports.
- Changed research session selection to avoid full snapshot and global program-registry refreshes when only the selected session changes.
- Changed workspace switching to keep a small cache of recently opened program runtimes, reducing repeated cross-program session switch cold-open cost.
- Changed streamed research prompt generation to throttle textarea renders while preserving live text updates.
- Changed OpenAI stream consumption to yield back to the Electron main loop between event batches, reducing active-session IPC stalls.
- Changed OpenAI host Python tool execution to use a non-blocking child process path and report per-tool execution timings.
- Changed run-row snapshot construction to use grouped SQLite aggregate queries instead of per-run lookups.
- Changed vmctl capability status checks to use a short cache instead of spawning the controller on every snapshot render.
- Changed OpenAI provider status checks to use a short cache with explicit invalidation on provider refresh.
- Changed active runtime trace updates so they no longer broadcast full workspace snapshots or global program registry payloads on every trace append.
- Changed main-session separators to use rounded surface contrast instead of grey divider lines, with the trace footer acting as the darker compact auto-growing steering input surface, inset status/control row matching the hypotheses/findings surface, solid-black rounded input row, circular arrow send button, and subtly raised hypotheses/findings column background.
- Changed the steering input to autofocus when a selected research session becomes active.
- Added initial memo boundaries for static app shell and footer surfaces to reduce unrelated rerenders.
- Extracted the top bar/window controls and footer/status system from `App.tsx` into dedicated renderer app, momentum, and environment view-model modules.
- Extracted app background pulses and program sidebar rendering from `App.tsx` into app/program feature modules.
- Extracted shared modal infrastructure, notification modals, and the research prompt modal from `App.tsx`.
- Extracted shared renderer formatting helpers from `App.tsx` into `src/renderer/lib/formatting.ts`.
- Extracted the workbench session header and trace turn helpers from `App.tsx` into session feature and view-model modules.
- Extracted trace timeline grouping and turn status helpers from `App.tsx` into the trace display view-model.
- Extracted trace label, detail text, provenance lookup, and path compaction helpers from `App.tsx` into the trace content view-model.
- Extracted trace row rendering, trace prose/code markup rendering, and trace category visual helpers from `App.tsx` into trace feature modules.
- Extracted trace detail modal rendering and typed trace inspection panels from `App.tsx` into the trace feature module.
- Extracted trace filter modal and trace turn group rendering from `App.tsx` into trace feature modules.
- Extracted transcript-to-trace display event synthesis from `App.tsx` into the trace display view-model.
- Extracted the virtualized trace view and steering footer from `App.tsx` into the trace feature module.
- Extracted the settings modal, provider status view, and local VM enablement view from `App.tsx` into the settings feature module.
- Extracted program information, session history, and onboarding modals plus onboarding template helpers from `App.tsx`.
- Extracted the new research session modal and shared run-setting helpers from `App.tsx`.
- Extracted the hypotheses/findings side panel, CWE pill, shared side scroll region, research item provenance helpers, and session heat helpers from `App.tsx`.
- Extracted the evidence sidebar from `App.tsx` and made it consume already-built active trace events.
- Extracted research momentum and host/guest activity derivation from `App.tsx` into renderer view-model modules.
- Extracted run detail selection, incremental update merge, cursor, and instrumentation summary helpers from `App.tsx`.
- Extracted inset scrollbar activation and resizable sidebar state from `App.tsx` into renderer hooks.
- Extracted the main session workspace grid from `App.tsx` into the session feature module.
- Extracted app shell class, selected run detail/status, VM preference, and window platform derivation from `App.tsx`.
- Extracted active run-detail polling, version checks, and incremental update application from `App.tsx` into a renderer hook.
- Extracted trace selection state and selected trace finding/hypothesis context from `App.tsx`.
- Extracted program menu, program information modal, and session history modal state from `App.tsx`.
- Extracted app modal rendering from `App.tsx` into an app-level modal layer component.
- Extracted workspace bootstrap, live snapshot subscriptions, and selected-run preservation from `App.tsx` into a renderer hook.
- Extracted program action handlers and HackerOne onboarding lookup application from `App.tsx`.
- Removed unreachable legacy run tracker, detail, inspector, hardening, and benchmark panel code from `App.tsx`.

### Fixed

- Made `window.bealeDevPerformance.report()` return a structured report object instead of only logging grouped console tables.
- Moved the sidebar render probe into the sidebar component so profiling reports real sidebar renders instead of app-shell renders.
- Retried retryable OpenAI transport failures after `response.created` when no model output or tool call content has been committed for that turn.
- Reduced trace-list flicker during manual scrolling by sliding the rendered event window in anchored chunks instead of recalculating it from estimated row heights on every scroll event.
- Reduced active trace-list churn by memoizing stable trace rows and cached syntax/prose markup.
- Tightened the context mascot forced-lick endpoint so it no longer overshoots the strawberry at full context.
- Displayed research prompt generation failures in the New Research Session modal and preserved OpenAI stream error reasons.
- Reduced trace and side-panel paint scope with CSS containment to make hover feedback less sensitive to active trace updates.
- Fixed sidebar transition profiling so unrelated later CSS transitions do not pollute collapse/expand timing.

### Documentation

- Added a beta-readiness chapter for non-functional buttons, placeholder surfaces, and incomplete beta-facing controls.
- Expanded the root README for human readers with current status, setup, safety boundaries, known incomplete surfaces, and planning links.
- Added MIT licensing metadata and a root `LICENSE`.
- Added a beta optimization planning chapter for renderer responsiveness, trace performance, animation budget, and performance-aware refactor sequencing.
