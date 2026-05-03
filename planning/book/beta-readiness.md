# Beta Readiness and Incomplete Surfaces

Status: accepted beta-stabilization direction, 2026-04-30.

## Decision

Before Beale invites broader beta users, every visible control should be either functional, intentionally disabled with a clear reason, or hidden until the feature exists.

The app can remain early and incomplete, but it should not look accidentally broken. Public repository attention changes the bar: a reader or new tester should be able to distinguish the working vertical slice from planned surfaces at a glance.

## Why This Matters

Beale is becoming visible before the full product loop is complete.

That creates two risks:

- users may assume placeholder controls are broken production features,
- contributors may implement disconnected UI actions without preserving the planned security, persistence, and evidence model.

The fix is not to remove ambition from the app. The fix is to make incomplete surfaces explicit and track them as beta-readiness work.

## Product Rule

Visible controls should follow one of four states:

- Functional: the control performs the intended action and has recovery/error handling.
- Disabled: the control is visible because it teaches the product shape, but it cannot be clicked and explains why.
- Preview: the control opens a lightweight modal or panel explaining the planned feature and current status.
- Hidden: the control should not appear because the feature is too early to represent honestly.

Clickable no-op controls should be treated as bugs.

## Current Visible Gaps

### App Menu Buttons

The baked-in desktop menu buttons are visible:

- File
- Edit
- View
- Window

Current risk:

- They look like normal desktop menus but do not open menus.

Beta requirement:

- Implement minimal menus or disable/hide them.
- Minimum useful actions:
  - File: add/open research program, close window.
  - Edit: copy, paste, select all where focused controls support it.
  - View: toggle sidebar, toggle inspector, open trace filters, reload.
  - Window: minimize, maximize or restore, close.

### Sidebar Utility Buttons

The sidebar includes Search. The planned Schedules entry is currently hidden.

Current risk:

- They imply global search and scheduled research sessions exist.

Beta requirement:

- Search should either open a scoped search modal for the current program or be hidden.
- Schedules is hidden until the scheduled-session UI is ready.
- Cross-workspace search is not a first-release default because workspace databases are intentionally isolated.

### Export and Disclosure Controls

The planning docs require evidence bundles, redacted trace export, and disclosure drafts, but the current app does not yet provide the complete export review flow.

Current risk:

- Users may believe trace/finding data is ready for disclosure when it has not passed review.

Beta requirement:

- Add an export review modal before any user-facing export.
- Separate candidate artifacts from accepted evidence.
- Preserve the rule that findings require tool, artifact, or verifier-backed evidence.
- Make direct program submission explicitly out of scope for v1.

### Run Control

The GUI supports starting and steering research sessions, but the full run-control set is incomplete.

Needed controls:

- Pause.
- Resume.
- Stop without deleting trace or artifacts.
- Fork with additional instruction.
- Restart from clean or selected VM state where a VM is enabled.

Beta requirement:

- Active sessions must keep running when the user switches sessions.
- Stopped or failed sessions must preserve authoritative trace and transcript state.
- Emergency process termination should be separate from normal stop semantics.

### Hypothesis, Finding, and Duplicate Control

Hypotheses and findings are visible, but the full researcher control surface is not complete.

Needed controls:

- Promote a hypothesis.
- Dismiss a hypothesis.
- Merge duplicate hypotheses.
- Request reproduction.
- Request patch validation.
- Mark a path out of scope.
- Show program-wide duplicate warnings before a reproduced finding is recorded.

Beta requirement:

- A user-provided claim can seed a hypothesis but cannot become a finding by itself.
- Reproduced findings must remain visually and semantically distinct from hypotheses.

### Verifier and Artifact Control

Verifier contracts and artifacts exist in the model, but researcher-facing controls remain incomplete.

Needed controls:

- Rerun verifier.
- Edit verifier contract.
- Approve or reject verifier contract.
- Promote artifact to evidence.
- Mark artifact sensitive.
- Export evidence bundle.

Beta requirement:

- Artifact export remains host-controlled.
- Guest exports remain candidate artifacts until accepted by the host.
- Sensitive artifact handling must be visible before export.

### Scope, Network, and Policy Approval

The first release depends on recorded authorization and active network profile state.

Needed controls:

- Review active scope before live-target actions.
- Approve or deny network profile changes.
- Approve or deny credential injection.
- Approve or deny host actions.
- Preserve or destroy VM state when applicable.

Beta requirement:

- Live-target testing is allowed only when the recorded program scope and active network profile permit it.
- Broad "approve everything" controls should be avoided.

### Settings Coverage

Settings currently has General and Providers, with VM enablement and profiling moving through the General surface.

Needed controls:

- Clear provider auth state.
- Explain missing OpenAI permissions in product language.
- Show VM availability and enabled/disabled state consistently.
- Open actionable setup help when a VM backend is unavailable.
- Keep profiling opt-in local and developer-oriented.

Beta requirement:

- Empty settings pages should not exist.
- Configure links should always land on a relevant section.

### Notifications

Notifications exist for final session messages and can open detail/steering flows.

Needed controls:

- Notification history or review state if notifications accumulate.
- Clear all reviewed notifications.
- Distinguish agent final responses from system errors and policy blockers.

Beta requirement:

- Notifications should not expire before the user has had a chance to review them.

## README Requirements

The repository README should make the current state clear for humans who arrive from social traffic.

It should explain:

- Beale is an authorized vulnerability research workbench.
- The repo is under active development and not production-ready.
- Current working areas include the Electron workbench, OpenAI run engine, local persistence, trace UI, hypotheses/findings, profiling, and Firecracker setup on WSL/Linux.
- Incomplete areas include desktop menus, search, schedules, complete export/disclosure flows, complete run controls, full verifier/artifact controls, and cross-platform VM backends.
- Use against targets requires explicit authorization.
- OpenAI credentials and workspace databases remain local.
- Live tests require user-provided credentials and are opt-in.

## Beta Exit Criteria For Visible Controls

Before closed beta:

- No visible button should be a silent no-op.
- Placeholder controls should be disabled, hidden, or documented with an in-app preview.
- Top app menus should have minimum useful actions.
- Settings links should always open meaningful settings content.
- Export paths should include review before files leave the workspace.
- Run control should support pause, resume, and stop with trace-preserving semantics.
- Hypothesis/finding controls should support at least dismiss, reproduce, and duplicate review.
- VM and host-execution state should be understandable from the footer and settings.
- README should clearly state the project status and authorized-use boundary.
