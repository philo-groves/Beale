# Changelog

## Unreleased

### Added

- Added opt-in developer performance instrumentation for renderer render counts, trace derivation timing, syntax/markdown timing, IPC payload sizing, and input latency probes.
- Added dev-only renderer DevTools shortcuts and launch opt-ins for debugging performance instrumentation.
- Added a cheap run-detail version IPC path and main-process timing logs for active-session performance diagnosis.
- Added an incremental run-detail update IPC path that transfers only new trace/transcript rows plus small current collections when a run is already loaded.
- Added renderer footer view-model tests for context metering and host/VM display formatting.

### Changed

- Changed research prompt generation and refinement to use medium reasoning effort while preserving the selected session effort for actual run execution.
- Changed active run-detail polling to check a cheap version first and use incremental updates instead of full detail refreshes when possible.
- Added initial memo boundaries for static app shell and footer surfaces to reduce unrelated rerenders.
- Extracted the top bar/window controls and footer/status system from `App.tsx` into dedicated renderer app, momentum, and environment view-model modules.

### Fixed

- Made `window.bealeDevPerformance.report()` return a structured report object instead of only logging grouped console tables.
- Reduced trace-list flicker during manual scrolling by sliding the rendered event window in anchored chunks instead of recalculating it from estimated row heights on every scroll event.

### Documentation

- Added a beta optimization planning chapter for renderer responsiveness, trace performance, animation budget, and performance-aware refactor sequencing.
