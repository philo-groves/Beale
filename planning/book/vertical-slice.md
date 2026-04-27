# First Vertical Slice

Status: draft implementation target, 2026-04-27.

## Decision

The first development slice should build a real Electron workbench with fake agent and fake executor backends.

This slice should prove the product loop and persistence model before integrating OpenAI, VMs, debuggers, or benchmarks.

## Goal

A user should be able to:

1. Open Beale.
2. Create or open a workspace.
3. Define program scope.
4. Start a research run from a markdown prompt.
5. Watch a fake but realistic research run populate the tracker.
6. Open run detail.
7. Inspect trace events, hypotheses, artifacts, and verifier placeholders.
8. Steer the run.
9. Close and reopen the app with state preserved.

## Why This Slice First

This validates the hardest product shape early:

- The app is workspace-centered, not chat-centered.
- Program scope is visible before runs.
- Runs and attempts are first-class.
- Trace is the backbone.
- Model claims and observations are visually distinct.
- Hypotheses, findings, artifacts, and verifiers are linked.
- Local SQLite persistence works.

It avoids blocking on:

- OAuth.
- WebSocket transport.
- Real model behavior.
- VM backend availability.
- Debugger wrappers.
- Benchmark integration.

## Included

### Workspace

- Create workspace directory.
- Open existing workspace directory.
- Initialize `.beale/`.
- Initialize SQLite schema.
- Show workspace in sidebar.

### Program Scope

- Edit program name and description.
- Add in-scope domains, repositories, executables, local paths, and credential references.
- Add explicit out-of-scope assets.
- Choose default network profile.
- Save a scope version.

### Start Run

- Markdown prompt textarea.
- Mode selector with `open_discovery` default.
- Attempt strategy selector with `adaptive_portfolio` default.
- Model display defaulting to `gpt-5.5`.
- Reasoning display defaulting to `xhigh`.
- Network and sandbox profile display.
- Budget placeholders.

### Fake Run Engine

- Create a run and one or more attempts.
- Emit deterministic trace events over time.
- Simulate model messages.
- Simulate tool calls for `search`, `code_browser`, `debugger`, `artifact`, and `verifier`.
- Simulate a policy blocker.
- Simulate a verifier result.
- Simulate artifact metadata.

### Tracker

Show multiple runs with short state sentences:

- Mapping parser entry points and import handlers.
- Building a PoC for hypothesis H-14.
- Blocked: out-of-scope network request.
- Verified finding F-2; collecting disclosure artifacts.
- Paused after duplicate hypothesis merge.

Each row should show:

- Status.
- Attempt count.
- Top hypothesis or finding.
- Evidence or verifier state.
- Cost/time placeholder.
- Policy blocker when present.

### Run Detail

Panels:

- Trace.
- Hypotheses.
- Artifacts.
- Verifiers.
- Findings.
- VM state.
- Policy events.

Trace should visually separate:

- User events.
- Model claims.
- Tool-backed observations.
- Artifact events.
- Verifier results.
- Policy decisions.

### Steering

Minimum controls:

- Pause.
- Resume.
- Stop.
- Fork with instruction.
- Rerun verifier.
- Promote artifact to evidence.
- Mark artifact sensitive.
- Dismiss hypothesis.
- Mark out of scope.

Steering should immediately create trace events and update state.

## Excluded

- Real OpenAI calls.
- Real OAuth.
- Real VM execution.
- Real target imports beyond metadata.
- Real shell execution.
- Real debugger sessions.
- Real network access.
- Real benchmark runs.
- Real credential injection.
- Real disclosure submission.

Excluded systems should appear as disabled, fake, or placeholder, not silently missing.

## Fake Scenario Fixtures

The fake run engine should include a few scenario fixtures:

### Source Logic Bug

- Search finds authorization-sensitive paths.
- Code browser identifies a missing ownership check.
- Hypothesis is created.
- Verifier placeholder returns `inconclusive`.

### Memory Corruption

- Search finds parser entry points.
- Code browser finds length parsing.
- Debugger event reports a simulated crash.
- Artifact metadata records `crash-input-003.bin`.
- Finding remains `needs_evidence`.

### Policy Block

- Model requests network access outside scope.
- Policy engine blocks it.
- Tracker shows amber blocker.
- User can deny or record a scope amendment placeholder.

### Verified Finding

- Hypothesis is reproduced.
- Verifier returns `pass`.
- Artifact evidence bundle exists.
- Finding state is `verified`.

## Acceptance Criteria

- Workspace state persists after restart.
- Scope edits persist as a versioned record.
- A run can be started from a markdown prompt.
- Fake trace events persist and replay in order.
- The tracker updates from persisted run state.
- Run detail can load from persisted state.
- Hypotheses link to trace events.
- Artifacts link to provenance events.
- Verifier results link to contracts.
- Steering creates trace events.
- Model claims are visually distinct from tool-backed observations.
- No UI path requires a chat transcript.

## Technical Acceptance Criteria

- Renderer uses typed host APIs.
- Renderer does not open SQLite directly.
- Host service owns database writes.
- Database migrations run on workspace open.
- Trace append order is deterministic.
- Fake executor is clearly labeled in trace and UI.
- No host shell execution exists in this slice.

## Development Order

1. App shell and routing.
2. Workspace open/create.
3. SQLite initialization and migrations.
4. Program scope editor.
5. Run and attempt persistence.
6. Fake run engine.
7. Tracker.
8. Run detail trace timeline.
9. Hypothesis/artifact/verifier panels.
10. Steering events.
11. Restart/reload verification.

## Done Means

The first slice is done when Beale feels like a real vulnerability research workbench using simulated research activity.

It should be obvious where OpenAI, VM execution, structured tools, and benchmark mode will plug in next.

