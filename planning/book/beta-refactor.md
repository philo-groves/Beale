# Beta Refactor Plan

Status: beta-hardening direction, first renderer extraction slice started 2026-04-30.

## Decision

Before closed beta, Beale should spend a dedicated refactor pass on project structure, renderer decomposition, and testable boundaries.

The goal is not a rewrite. The current vertical slice has been useful because it kept product alignment tight while the run engine, tracing, findings, hypotheses, VM controls, onboarding, and beta UI were still moving quickly. That phase has done its job. The next phase should preserve current behavior while making the codebase easier to reason about, safer to change, and less dependent on one large renderer file.

## Why Now

The first vertical slice has crossed from prototype alignment into product hardening.

Current pressure points:

- `src/renderer/App.tsx` has become a broad coordination surface rather than an app shell.
- Trace rendering, session state, hypotheses, findings, modals, settings, footer telemetry, and onboarding now change independently.
- Long-running sessions create enough UI state that regressions are easy to introduce accidentally.
- Closed beta will need fast bug fixes without re-reading the whole renderer.
- Upcoming work needs clearer ownership for chat, evidence, notes, trace modals, exports, settings, and program management.

Refactoring now reduces beta risk because most core behaviors already exist and can be preserved through narrow moves.

## Goals

- Keep all current user-visible behavior unless a specific beta bug is being fixed.
- Reduce `App.tsx` into a composition shell and small amount of top-level orchestration.
- Split renderer code by product surface rather than by generic component type alone.
- Make trace, hypothesis, finding, evidence, settings, onboarding, and session controls independently testable where practical.
- Keep host-owned security decisions in the main process and renderer-owned state in the renderer.
- Make IPC contracts easier to audit by keeping renderer calls behind typed client helpers.
- Keep CSS behavior stable while preparing for later stylesheet decomposition.
- Add changelog entries for beta-relevant refactors and compatibility notes.

## Non-Goals

- Do not redesign the app frame, navigation, or research workflow as part of the refactor.
- Do not change the SQLite schema unless a specific product bug requires it.
- Do not rewrite the run engine, OpenAI adapter, or executor stack during the renderer refactor.
- Do not introduce remote persistence, cloud sync, or cross-workspace global search.
- Do not add a broad state-management framework unless extracted code shows a concrete need.
- Do not use refactoring as an excuse to weaken the trusted host boundary or VM/security invariants.

## Target Renderer Shape

`src/renderer/App.tsx` should become the composition root:

- Subscribe to workspace snapshots and active run detail.
- Own top-level modal selection and app-level layout state.
- Pass typed view models and callbacks into feature components.
- Avoid containing large renderers, parsers, trace formatters, or canvas implementations directly.

Suggested renderer structure:

```text
src/renderer/
  App.tsx
  app/
    AppShell.tsx
    TopBar.tsx
    StatusBar.tsx
    WindowControls.tsx
  features/
    programs/
    sessions/
    traces/
    hypotheses/
    findings/
    evidence/
    settings/
    onboarding/
    notifications/
    momentum/
  hooks/
    useWorkspaceSnapshot.ts
    useRunDetail.ts
    useTraceWindow.ts
    useModalState.ts
  view-models/
    sessionHeader.ts
    traceDisplay.ts
    hypothesisDisplay.ts
    findingDisplay.ts
    environmentDisplay.ts
  lib/
    dates.ts
    formatting.ts
    markdown.tsx
    syntaxHighlight.tsx
```

This is a direction, not a required one-shot file move. The first refactor pass should extract coherent seams that already exist in the current code.

## First Extraction Order

Prefer low-risk extractions first:

1. App shell components: top bar, window controls, side navigation shell, footer/status bar.
2. Momentum and context meter: snake canvas, strawberry goal, context label, tooltip formatting.
3. Modal infrastructure: reusable modal shell, trace detail modal, prompt modal, settings modal, notification modal.
4. Pure display helpers: date formatting, duration formatting, label normalization, priority/CWE pill formatting.
5. Trace view model: turn grouping, event labels, trace content selection, error counts, source/category display.
6. Hypothesis/finding/evidence lists: cards, pills, scroll fades, empty states, click behavior.
7. New research session form: prompt generation/refinement state, model/effort selection, session settings.
8. Workspace/program sidebar: program ordering, session summaries, context menus, empty states.

The most complex trace and session detail extraction should happen after helpers and small components are already out of `App.tsx`.

## Host Boundary Rules

Refactoring must preserve these boundaries:

- The renderer displays state and sends typed user intents.
- The main process owns authoritative state changes.
- SQLite access stays host-owned.
- OpenAI credentials stay host-owned.
- VM setup, executor selection, target import, and tool execution stay host-owned.
- Renderer components should not infer security decisions from UI state alone.

If a refactor reveals a renderer helper making policy decisions, move that logic toward the host service or make it a display-only interpretation of host state.

## View Model Rules

Use view models to make dense UI readable without hiding behavior.

Good view-model candidates:

- Session header display fields.
- Trace turn groups.
- Trace modal typed content.
- Hypothesis and finding card summaries.
- Evidence sidebar rows.
- Environment and VM labels.
- Footer momentum/context display.

View models should be pure functions where possible. They should not subscribe to IPC, mutate state, or call host APIs.

## CSS Strategy

Do not split the stylesheet first.

The first beta refactor should keep visual behavior stable and extract React/TypeScript structure first. After component boundaries settle, CSS can be split by feature or layered by:

- tokens and globals,
- app shell,
- shared controls,
- feature views,
- modal/detail views,
- animation systems.

During the first pass, new class names should be feature-scoped and avoid generic names that will collide later.

## Testing Strategy

Each refactor slice should run the project typecheck.

Add or preserve focused tests for:

- trace label and detail rendering decisions,
- hypothesis/finding duplicate and promotion display,
- program/session ordering,
- context meter formatting,
- prompt generation/refinement state transitions,
- host/guest environment display,
- IPC payload shaping where renderer helpers construct typed requests.

For pure view-model extraction, prefer direct unit tests over renderer integration tests. Use renderer integration only where behavior depends on React state, scrolling, modal focus, or event subscription cleanup.

## Change Management

Refactors should be small enough to review by behavior area.

Rules:

- One product surface per change when practical.
- Avoid mixing schema changes with renderer extraction.
- Avoid mixing visual redesign with file movement.
- Keep old and new code paths from coexisting longer than necessary.
- Delete dead helpers after extraction instead of leaving compatibility layers.
- Update `CHANGELOG.md` for beta-relevant refactors, behavior changes, compatibility notes, or project structure changes.

## Beta Exit Criteria

The beta refactor is successful when:

- `App.tsx` is primarily a composition root.
- Trace, session header, hypothesis/finding lists, settings, onboarding, and footer telemetry live in separate modules.
- Active sessions continue while switching programs or sessions.
- Long trace lists remain responsive.
- Steering extends the selected session rather than creating accidental sessions.
- Program persistence, VM status, OAuth/provider state, and settings survive app restart.
- Findings and hypotheses remain distinct records in UI and trace modals.
- Typecheck and focused tests pass after each slice.
- No security boundary moves from host to renderer.

## First Practical Slice

The first implementation slice should extract the footer/status system:

- environment host/VM pills,
- momentum snake canvas,
- strawberry/context meter,
- footer actions,
- related formatting helpers.

This surface is visible, self-contained, and currently changing often. It is a good proving ground for the refactor pattern before extracting the trace system.

Implementation note, 2026-04-30:

- Footer/status rendering moved out of `src/renderer/App.tsx` into `src/renderer/app/StatusBar.tsx`.
- Top bar and window control rendering moved into `src/renderer/app/TopBar.tsx`.
- App background pulse rendering moved into `src/renderer/app/AppBackgroundPulses.tsx`.
- Program/sidebar rendering moved into `src/renderer/features/programs/ProgramSidebar.tsx`.
- Momentum snake/context rendering moved into `src/renderer/features/momentum/`.
- Shared modal rendering moved into `src/renderer/app/Modal.tsx`.
- Notification stack/detail rendering moved into `src/renderer/features/notifications/Notifications.tsx`.
- Original research prompt modal rendering moved into `src/renderer/features/sessions/ResearchPromptModal.tsx`.
- Workbench session header rendering moved into `src/renderer/features/sessions/SessionHeader.tsx`.
- Session header timing/status helpers moved into `src/renderer/view-models/sessionHeader.ts`.
- Trace turn helpers moved into `src/renderer/view-models/traceDisplay.ts`.
- Trace timeline grouping and turn status helpers moved into `src/renderer/view-models/traceDisplay.ts`.
- Transcript-to-trace display event synthesis moved into `src/renderer/view-models/traceDisplay.ts`.
- Trace label, detail text, provenance lookup, and path compaction helpers moved into `src/renderer/view-models/traceContent.ts`.
- Trace row rendering moved into `src/renderer/features/traces/TraceEventRow.tsx`.
- Trace detail modal rendering moved into `src/renderer/features/traces/TraceDetailModal.tsx`.
- Trace filter modal rendering moved into `src/renderer/features/traces/TraceFilterModal.tsx`.
- Trace turn group rendering moved into `src/renderer/features/traces/TraceTurnGroup.tsx`.
- Trace prose/code markup rendering moved into `src/renderer/features/traces/traceMarkup.tsx`.
- Trace category filter metadata and icon/label helpers moved into `src/renderer/features/traces/traceVisuals.tsx`.
- Virtualized trace view and steering footer rendering moved into `src/renderer/features/traces/TraceView.tsx`.
- Settings modal rendering, OpenAI provider status, and local VM enablement controls moved into `src/renderer/features/settings/SettingsModal.tsx`.
- Shared status pill rendering moved into `src/renderer/app/StatusPill.tsx`.
- Program information/session history modals moved into `src/renderer/features/programs/ProgramModals.tsx`.
- Program onboarding modal rendering moved into `src/renderer/features/programs/ProgramOnboardingModal.tsx`.
- Program onboarding template defaults and form conversion moved into `src/renderer/view-models/programOnboarding.ts`.
- New research session modal rendering moved into `src/renderer/features/sessions/StartRunForm.tsx`.
- Shared run-setting defaults, unbounded budget constants, and request-id helpers moved into `src/renderer/view-models/runSettings.ts`.
- Unreachable legacy run tracker, run detail, inspector, hardening, and benchmark panels were removed from `src/renderer/App.tsx` instead of moved.
- Research momentum derivation moved into `src/renderer/view-models/researchMomentum.ts`.
- Host/guest activity derivation moved into `src/renderer/view-models/environmentDisplay.ts`.
- Hypotheses/findings side panel rendering moved into `src/renderer/features/research/ResearchSidePanel.tsx`.
- Evidence sidebar rendering moved into `src/renderer/features/research/EvidenceSidebar.tsx`.
- CWE pill rendering moved into `src/renderer/features/research/CwePill.tsx`.
- Shared side-column scroll/fade behavior moved into `src/renderer/app/MainSideScrollRegion.tsx`.
- Research item provenance helpers moved into `src/renderer/view-models/researchItems.ts`.
- Session heat helpers moved into `src/renderer/view-models/sessionHeat.ts`.
- Shared label, date, duration, priority, percent, state class, and truncation helpers moved into `src/renderer/lib/formatting.ts`.
- Host and VM footer display helpers moved into `src/renderer/view-models/environmentDisplay.ts`.
- Run detail selection, incremental update merge, cursor, and instrumentation summary helpers moved into `src/renderer/view-models/runDetailUpdates.ts`.
- Inset scrollbar activation moved into `src/renderer/hooks/useInsetScrollbarActivation.ts`.
- Resizable sidebar state and width clamping moved into `src/renderer/hooks/useResizableSidebar.ts`.
- Main session workspace grid composition moved into `src/renderer/features/sessions/MainSessionWorkspace.tsx`.
- App shell class, selected run detail/status, VM preference, and window platform derivation moved into `src/renderer/view-models/appShell.ts`.
- Direct renderer view-model and helper tests now cover context meter formatting, host/VM footer label behavior, host/guest activity, app shell class/platform/preference derivation, fixed program/session ownership, sidebar age formatting, sidebar width clamping, program onboarding templates, run-setting defaults, research momentum states, run detail update merging, notification preview text, shared renderer formatting, session header display, trace turn detection, trace timeline grouping/status labels, transcript-to-trace synthesis, trace content labels/details, trace visual labels, research item provenance, evidence sidebar ordering, and session heat scoring.
