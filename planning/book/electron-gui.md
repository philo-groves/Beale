# Electron GUI

Status: accepted initial direction, 2026-04-26.

## Decision

Beale's Electron GUI should be a vulnerability research workbench, not a chat-first agent UI.

The primary experience is:

1. Select or create a vulnerability research program workspace.
2. Define program description, authorization, and scope.
3. Submit a markdown research prompt to start a run.
4. Track multiple concurrent research runs.
5. Inspect traces, tools, hypotheses, artifacts, and verifier results.
6. Steer active or inactive runs immediately from run detail views.

## Top-Level Navigation

The app should have a side navigation view for known vulnerability research programs.

Each program maps to a workspace directory with its own local `.beale/` database.

The side navigation should support:

- Switching between known programs.
- Opening a workspace directory.
- Creating a new program workspace.
- Showing basic status for each workspace where practical.

Cross-workspace search should not be a default feature because each workspace database is intentionally isolated.

## Program Scope View

Each workspace needs a program scope view.

Purpose:

- Define and edit the vulnerability research program description and scope.

Fields should include:

- Program or organization name.
- Scope description.
- In-scope domains and hosts.
- In-scope repositories.
- In-scope executables and binaries.
- In-scope local paths.
- In-scope accounts or credential references.
- Explicit out-of-scope assets.
- Network policy.
- Notes about program rules.
- Expiration or review date where applicable.

This view should be reusable for initial setup and later editing.

The agent's autonomy depends on this scope. Scope state should be visible before starting runs.

## Primary Tracker View

The primary work view should be a tracker for research activity.

It should support several research runs occurring at the same time.

Each run row/card should show one short-sentence state description, such as:

- "Mapping parser entry points and import handlers."
- "Building a PoC for hypothesis H-14."
- "Waiting on verifier for candidate patch P-3."
- "Blocked: out-of-scope network request."
- "Verified finding F-2; collecting disclosure artifacts."

The tracker should summarize:

- Active runs.
- Paused or inactive runs.
- Recently completed runs.
- Run status.
- Current attempt count.
- Top hypothesis or finding.
- Evidence/verifier status.
- Cost/time where useful.
- Policy or approval blockers.

The tracker should be the main operational surface, not a chat transcript.

## Start Run Interface

Starting a run should use a markdown textarea prompt.

The prompt is the research request or task brief. It is not a continuous chat as the primary UI.

The start-run interface should show:

- Active program scope.
- Selected task mode if applicable.
- Model and reasoning settings.
- Attempt strategy.
- Network profile.
- Sandbox profile.
- Expected budget if available.

After submission, the run appears in the tracker.

## Run Detail View

Clicking a run should open a detailed run view.

The run detail view should include:

- Trace timeline.
- Model messages or reasoning summaries where available.
- Tool calls and tool results.
- VM events.
- Artifact list.
- Hypotheses.
- Findings.
- Verifier contracts and results.
- Network and policy events.
- Cost and timing metrics.

The detail view should make model claims visually distinct from tool-backed observations.

Active and inactive runs should both be steerable.

## Steering

Users should be able to steer a run immediately.

Steering should apply to active or inactive runs.

Steers should be immediate, trace-recorded, and reversible where practical.

### Run Control

Minimum v1:

- Pause run.
- Resume run.
- Stop run without deleting trace or artifacts.
- Fork run with additional instruction.
- Restart from a clean or selected VM snapshot.
- Change max time, cost, or attempt budget.

Use "kill" only for emergency VM or process termination. Normal termination should be "stop run."

### Hypothesis and Finding Control

Minimum v1:

- Promote a hypothesis.
- Dismiss a hypothesis.
- Merge duplicate hypotheses.
- Mark a path out of scope.
- Manually adjust priority factors when needed.
- Request reproduction for a hypothesis.
- Request patch validation for a reproduced issue or candidate fix.

### Verifier and Artifact Control

Minimum v1:

- Rerun a verifier.
- Edit a verifier contract.
- Approve or reject a verifier contract.
- Promote an artifact to evidence.
- Mark an artifact sensitive.
- Export an evidence bundle.

### Policy Control

Minimum v1:

- Approve or deny network profile changes.
- Approve or deny credential injection.
- Approve or deny host actions.
- Preserve or destroy a VM.
- Approve or deny scope changes.

Approvals should be scoped to the specific request. Beale should avoid broad "approve everything" controls.

### Disclosure and Export Control

Minimum v1:

- Generate report draft.
- Export finding bundle.
- Export redacted trace.
- Mark disclosure ready.
- Mark needs more evidence.

Direct program submission is not a first-release requirement. Draft and export flows are safer.

Steers should be recorded in the trace as user events.

Trace fields should include:

- User action.
- Target entity.
- Timestamp.
- Reason or note if provided.
- Resulting state change.
- Whether the agent was interrupted immediately.

## Embedded Views in Tracker and Run Detail

The following concepts should appear as panels or drill-downs rather than separate first-class app modes unless they grow large enough:

- Trace timeline.
- Artifact browser.
- Hypothesis board.
- Verifier dashboard.
- Benchmark comparison.
- Threat model or program scope editor.

The primary organizing unit is the research program and its runs.

## Chat Is Not Primary

Beale should not default to a chat-first interface.

Conversational steering can exist, but it should be subordinate to:

- Program scope.
- Run tracker.
- Trace.
- Hypotheses.
- Evidence.
- Artifacts.
- Verifier results.

## Terminal Compatibility

Beale should be terminal-compatible but not terminal-centered.

The product should abandon terminal-first assumptions and focus on structured research UI.

Terminal/PTY use is acceptable as:

- A fallback inside guest VMs.
- A way to run uncommon tools.
- A way to inspect exact command output.
- An audit artifact when structured output is not available.
- A debugging aid for Beale itself.

Terminal/PTY use should not be:

- The primary UI.
- The primary evidence model.
- The primary debugger interface.
- The primary verifier interface.
- A substitute for artifacts, trace events, hypotheses, findings, or verifier contracts.

Rule:

Every meaningful operation should become structured state, even if it originated from a terminal command.

Structured UI should own:

- Runs.
- Attempts.
- Program scope.
- VM state.
- Tool calls.
- Trace events.
- Hypotheses.
- Findings.
- Artifacts.
- Verifiers.
- Evidence.
- Network and policy state.

## Planning Consequence

The GUI should be designed around research operations and evidence state, not message history.
