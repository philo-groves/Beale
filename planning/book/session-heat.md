# Session Heat

Status: accepted design direction, 2026-04-28.

## Decision

Beale should use ambient session heat to make an active research session feel alive while preserving the product's black and gray workbench style.

Session heat is a window-level visual treatment derived from the most severe meaningful finding in the active session. It should communicate research tension and triage urgency without turning the UI into a generic AI-gradient surface or an alarm dashboard.

The default UI remains neutral black and gray. Heat appears only when the active session contains a qualifying hypothesis or finding with enough evidence to justify visual emphasis.

## Goals

Session heat should:

- Make Beale feel responsive to the research state.
- Give the researcher an at-a-glance sense of session severity.
- Reinforce the evidence-backed finding model.
- Make critical sessions visually memorable.
- Stay calm enough for long-running audit work.

Session heat should not:

- Replace explicit severity labels, finding states, or priority scores.
- Treat model prose as a verified target observation.
- Tint every component individually.
- Add motion that distracts from traces, hypotheses, artifacts, or verifier output.
- Use generic blue or purple AI ambience as the core product identity.

## Severity Tones

The ambient tones should preserve Beale's current dark default and add restrained tinting by severity.

Suggested tone semantics:

- No qualifying finding: neutral black and gray.
- Low: faint yellow tint.
- Medium: restrained orange tint.
- High: restrained red tint.
- Critical: dark blood-red atmosphere.

Critical should be the most iconic treatment. It should feel serious, deep, and unmistakable, not bright or decorative.

Suggested critical direction:

- A red-black wash behind the main session surface.
- A darker red inner edge or vignette.
- A subtle hot red accent only at the edge or trace rail.
- No broad neon glow.

## Visual Surfaces

Session heat should be applied at the session or window level, not by recoloring every widget.

Primary surfaces:

- Main content background.
- Session-area inner edge or vignette.
- Trace rail or active-turn accent.
- Optional host-to-guest activity link when the current execution relates to the finding.

Surfaces that should usually remain neutral:

- Text.
- Input fields.
- Buttons.
- Modals.
- Inspector content.
- Code and tool output blocks.

The researcher should still be able to read traces and compare evidence without color contamination.

## Severity Source

Session heat should be derived from the highest qualifying severity in the active session.

The preferred source order is:

1. Verified finding severity.
2. Reproduced or promoted finding severity.
3. Evidence-backed hypothesis severity.
4. Open hypothesis severity, capped below high unless evidence exists.

Dismissed, duplicate, false-positive, and out-of-scope findings should not contribute to session heat.

User-provided vulnerability claims may seed hypotheses, but they should not drive high or critical ambience by themselves. Tool, artifact, verifier, or accepted human-review evidence should be required before the window becomes high or critical.

## Evidence Gating

Ambient severity must follow Beale's evidence model.

Suggested gating:

| Evidence state | Maximum heat |
| --- | --- |
| Model claim only | none or low |
| Plausible static evidence | medium |
| Controlled reproduction or strong dynamic evidence | high |
| Verifier-backed reproduction | critical allowed |

This keeps the UI from rewarding dramatic but unsupported model claims.

The exact mapping can be adjusted as the scoring model evolves, but the principle should remain: stronger ambience requires stronger evidence.

## Priority Score Relationship

Session heat is not the same as priority score.

Priority score answers which finding should be investigated or reported first. Session heat answers how severe the active session currently feels at a glance.

The heat source may use priority factors such as impact, reachability, exploit practicality, scope confidence, and evidence confidence, but it should resolve to a simple severity band for display.

For v1, a practical mapping is:

- Use explicit severity when a finding has one.
- Otherwise derive severity from impact and reachability.
- Gate the result by evidence confidence.
- Ignore dismissed, duplicate, false-positive, and out-of-scope states.

## Motion

Motion should be minimal.

Allowed:

- Slow opacity or edge-intensity changes during active work.
- A subtle trace rail or edge pulse when the session is actively verifying or reproducing a high-severity issue.
- A quiet settle/fade when the session completes.

Avoid:

- Fast flashing.
- Repeated bouncing.
- Large gradient movement.
- Full-window color cycling.
- Motion that triggers while the session is idle.

Critical heat may include a very slow pulse while the run is active. The pulse should stop or settle when the run completes, pauses, or fails.

Beale should honor `prefers-reduced-motion` and provide a way to disable ambient motion independently of severity tinting.

## Accessibility

Color must never be the only signal.

The UI should still show:

- Finding severity labels.
- Finding state.
- Priority score or factors where relevant.
- Evidence confidence.
- Verifier state.
- Trace links to supporting observations.

Session heat should have enough contrast discipline that text remains readable in all severity states. The ambient layer should sit behind content and avoid tinting code, trace payloads, and modals directly.

## Implementation Shape

The renderer should derive a `sessionHeat` value for the active run:

```text
none | low | medium | high | critical
```

This value should be applied as a class or data attribute at the session surface level, for example:

```text
workspace-page session-heat-low
workspace-page session-heat-medium
workspace-page session-heat-high
workspace-page session-heat-critical
```

CSS should own the visual treatment through pseudo-elements or contained overlays so layout does not move.

The host service or renderer selector should derive session heat from persisted session state, not from ad hoc trace text parsing.

Suggested derived-state inputs:

- Run ID.
- Finding records and states.
- Hypothesis records and states.
- Severity or impact fields.
- Evidence confidence.
- Verifier results.
- Scope confidence or out-of-scope state.

Trace events should record finding and hypothesis state changes. The heat itself does not need a trace event unless the underlying finding state changes.

## Product Principle

Beale should feel alive because the research state is alive.

The ambience should come from evidence, severity, verification, and session activity. It should not be decorative personality layered on top of a static workbench.

## Planning Consequence

The GUI design should treat severity ambience as part of the finding and evidence system.

Future UI work should route session heat through typed run, hypothesis, finding, and verifier state rather than adding one-off visual effects.
