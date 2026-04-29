# Research Momentum

Status: proposed design direction, 2026-04-29.

## Decision

Beale should track research momentum as derived session state, not as model emotion.

The product should not ask the agent how excited, confident, or enthusiastic it feels. Those signals would invite overstatement, false positives, and UI hype. Instead, Beale should derive a small momentum state from observable research activity: trace events, tool progress, hypothesis changes, evidence creation, verifier work, repeated errors, and user steering.

Research momentum answers a different question than session heat:

- Session heat: how severe does the active evidence-backed research state look?
- Research momentum: what kind of work is happening right now, and is the session moving forward?

Momentum should make the agent feel alive because the session is active, not because the model claims to be excited.

## Goals

Research momentum should:

- Help researchers understand whether the agent is exploring, building evidence, verifying, stuck, or idle.
- Surface loops and stalls earlier.
- Make live sessions feel responsive without adding decorative personality.
- Distinguish high activity from high severity.
- Provide a neutral basis for subtle UI motion and status text.
- Remain explainable from persisted trace and state.

Research momentum should not:

- Become a confidence score.
- Replace hypothesis priority, evidence confidence, or verifier state.
- Reward dramatic model prose.
- Promote claims into findings.
- Drive severity background colors.
- Encourage the agent to continue a weak lead because it appears "excited."

## Momentum States

The v1 state model should stay compact.

Suggested states:

| State | Meaning |
| --- | --- |
| `idle` | No active session work is happening. |
| `exploring` | The agent is searching, reading code, mapping target surface, or gathering context. |
| `building` | The agent is forming or refining hypotheses, creating artifacts, or preparing experiments. |
| `verifying` | The agent is running PoCs, debugger steps, reproduction attempts, verifier contracts, or evidence checks. |
| `hot` | The session is actively converging on a promising evidence-backed lead. |
| `stuck` | The session has repeated errors, tool failures, unavailable sources, looping searches, or no meaningful progress. |
| `waiting` | The session is blocked on user input, authorization, credential setup, long-running command output, or external state. |

These states are intentionally operational. They describe workflow phase and progress, not subjective excitement.

## Derived Inputs

Momentum should be derived from recent and current state, with a short time window so it responds quickly.

Suggested inputs:

- Recent trace event categories.
- Current run status.
- Active tool call type.
- Host or guest activity.
- Hypothesis create/update/merge/dismiss events.
- Evidence and artifact creation.
- Finding creation or state changes.
- Verifier contract creation and verifier run status.
- User steering events.
- Repeated error or recovery events.
- Time since last model, tool, or evidence-producing event.
- Repeated low-yield actions such as identical searches or repeated source-unavailable failures.

Momentum should prefer typed records over text parsing. Trace summaries can support fallbacks, but the long-term shape should use structured event type, source, payload, linked hypothesis/finding IDs, tool names, verifier state, and artifact metadata.

## Derivation Rules

The derivation should be deterministic and explainable.

Initial practical mapping:

- `idle`: no active run, completed run, paused run, or no recent activity.
- `exploring`: recent code navigation, search, source import, repository inspection, or target mapping events.
- `building`: recent hypothesis creation/update, artifact preparation, test setup, exploit sketching, or experiment construction.
- `verifying`: recent debugger, execution, PoC, verifier, reproduction, sanitizer, or evidence-validation events.
- `hot`: recent verifying/building activity plus at least one active hypothesis or finding with dynamic evidence, reproduced state, verifier activity, or high priority gated by evidence.
- `stuck`: repeated errors, recovery events, source-unavailable loops, tool retries, failed verifier setup, or no new evidence/hypotheses after sustained activity.
- `waiting`: explicit blocked state, pending user approval, missing credentials, authorization gaps, unavailable VM/provider setup, or long-running command without new output.

When states compete, Beale should prefer the state most useful to the researcher:

1. `waiting`
2. `stuck`
3. `hot`
4. `verifying`
5. `building`
6. `exploring`
7. `idle`

The precedence intentionally puts blockers above apparent progress. A session should not look alive if it is actually stuck behind a missing credential, repeated source failure, or unavailable execution path.

## Relationship To Session Heat

Research momentum and session heat should be independent derived states.

Examples:

- High heat, idle momentum: a serious reproduced finding exists, but the run is no longer active.
- No heat, exploring momentum: the agent is mapping code but has not found a meaningful lead.
- Medium heat, verifying momentum: a plausible bug has static evidence and is being tested.
- Low heat, stuck momentum: the agent has an interesting but weak hypothesis and is looping on unavailable source.
- High heat, waiting momentum: a strong lead exists, but reproduction is blocked by missing setup or user authorization.

Session heat should continue to come from severity and evidence. Momentum should come from activity, progress, and blockers.

## UI Behavior

Momentum should appear as subtle workbench state, not as a mascot mood.

Possible UI treatments:

- A concise session status phrase near the session header or inspector.
- A small activity chip or tooltip that explains the derived state.
- A footer momentum line that behaves like a taut string: flat for idle/waiting, barely vibrating for exploring, stronger string motion for building, rapid vibration for verifying, overdriven motion for hot leads, and jagged motion for stuck sessions.
- Subtle animation on host/guest tags during active host or guest work.
- A trace rail treatment for verifying or hot momentum.
- A quiet "stuck" signal in the trace or inspector when repeated failures are detected.

Suggested labels:

- `Exploring`
- `Building`
- `Verifying`
- `Hot Lead`
- `Stuck`
- `Waiting`
- `Idle`

The UI should make the explanation available:

```text
Momentum: Verifying
Reason: debugger output and verifier run events in the last 90 seconds.
```

This prevents the UI from feeling arbitrary and gives researchers a path to audit why Beale thinks a session is moving or stuck.

## Trace And Persistence

Momentum does not need to be persisted as authoritative state for v1.

Preferred v1 shape:

- Persist the trace, hypotheses, findings, evidence, artifacts, verifier runs, and run status.
- Derive current momentum in the renderer or host service selector.
- Record trace events for the underlying facts, not for every derived momentum transition.

Momentum transition trace events should be optional and reserved for important state changes, such as:

- Session detected as stuck after repeated failures.
- Session resumed progress after a stuck period.
- Session became waiting due to missing credentials, scope approval, VM setup, or user input.

If Beale later adds analytics or time-travel review for momentum, it can store sampled derived states in a separate non-authoritative table. That table should never become evidence.

## Stuck Detection

Stuck detection is the most important practical use of momentum.

Useful stuck signals:

- Repeated tool failures with the same error class.
- Repeated search queries with no new files or observations.
- Repeated source-unavailable or clone/import failures.
- No new hypothesis, evidence, artifact, or meaningful trace observation after sustained activity.
- Verifier or execution setup repeatedly failing before target code is tested.
- Context compaction or provider-state recovery repeatedly interrupting the same turn.
- The model repeatedly explains why it cannot proceed without trying the available recovery path.

Stuck state should be actionable. The UI should help the researcher steer, configure, retry setup, relax or tighten scope, switch execution mode, or ask the agent to summarize blockers.

## Hot Lead Detection

`hot` should be used sparingly.

Hot lead should require both activity and evidence-backed promise. Suggested qualifying signals:

- Reproduction or verifier work is active for a high-priority hypothesis.
- A hypothesis has dynamic evidence or an artifact-backed observation.
- A finding was created or promoted recently and is not dismissed, duplicate, false-positive, or out of scope.
- The agent is chaining existing evidence toward a concrete exploit path.

Hot should not trigger from model prose alone. A model message saying "this looks critical" is not enough.

## Accessibility And Motion

Momentum motion should be calmer than severity heat.

Allowed:

- Short slide-in trace events.
- A thin footer line whose string-like waveform and speed reflect the current momentum state.
- Host or guest activity shimmer while commands are actually running.
- Low-amplitude edge or rail motion while verifying.
- A single settle transition when a state changes.

Avoid:

- Fast flashing.
- Full-window animation.
- Mascot-style emotional reactions.
- Motion based only on model prose.

Beale should honor `prefers-reduced-motion`. Momentum labels and tooltips should remain available when motion is disabled.

## Implementation Shape

The renderer or host service should derive:

```text
idle | exploring | building | verifying | hot | stuck | waiting
```

Suggested selector inputs:

- `RunDetail.run.status`
- Recent `TraceEventRecord` values.
- Active transcript/tool stream state.
- Hypothesis and finding records.
- Evidence and artifact records.
- Verifier run records.
- VM or host execution state.
- Provider/auth/setup status when it blocks the run.

Suggested output shape:

```ts
interface ResearchMomentum {
  state: 'idle' | 'exploring' | 'building' | 'verifying' | 'hot' | 'stuck' | 'waiting';
  reason: string;
  since: string | null;
  supportingTraceEventIds: string[];
}
```

The reason should be short and deterministic. It should not quote long model prose.

## Product Principle

Beale should show momentum, not excitement.

Excitement is subjective and can make false positives feel more credible than they are. Momentum is operational: it tells the researcher whether the work is moving, what kind of work is happening, and where intervention may be needed.

The UI should feel alive because the research process is observable, not because the model is theatrical.

## Planning Consequence

Future UI work should route liveliness through two separate derived systems:

- Session heat for evidence-backed severity.
- Research momentum for activity, progress, and blockers.

Both systems should remain grounded in trace, evidence, hypotheses, findings, verifier state, execution state, and user steering.
