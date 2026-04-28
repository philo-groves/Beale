# Context Compaction

Status: proposed, 2026-04-28.

## Decision

Beale needs a first-class context compaction policy for long-running OpenAI research sessions.

Compaction is not just a transport fallback. It is part of the Beale run engine. It decides what research state remains model-visible when the raw conversation, tool-call replay, or trace history approaches the model context limit.

The policy should be Beale-owned and OpenAI-aligned:

- Beale owns the authoritative research state, evidence graph, trace, artifacts, hypotheses, findings, sandbox state, and authorization state.
- OpenAI mechanics should be used where they preserve model performance, including `previous_response_id`, assistant-item replay, phase/state patterns, and compacted replay.
- If OpenAI state is unavailable or manual replay grows too large, Beale must compact before the model hits the context window.

## Problem

Open-ended vulnerability research can run for hours or days. A valid session may inspect many files, issue hundreds of tool calls, run VM commands, create artifacts, steer multiple hypotheses, and revisit earlier evidence.

Naively replaying all model messages, function calls, and function outputs eventually fails:

- Context window overflow.
- Higher latency and cost.
- More distraction from stale branches.
- Increased risk that the model treats old observations as current state after VM resets or forks.
- Poor recovery when `previous_response_id` is unavailable and the adapter falls back to manual response replay.

This is already observable in long sessions: manual replay can grow until a request fails with a context-window error.

## Design Goals

The compaction system should:

- Preserve enough state for the agent to continue useful research without repeating large amounts of work.
- Keep tool, artifact, verifier, and trace-backed observations distinct from model claims.
- Preserve active hypotheses, findings, open questions, and unresolved blockers.
- Preserve current VM/import/sandbox state and make resets or forks visible.
- Keep original prompt, program scope, network profile, and safety-relevant rules visible.
- Drop or summarize stale branches that no longer affect the next action.
- Prefer compact structured state over raw transcript replay.
- Record compaction decisions in the trace.
- Retry once with compacted state after context-window failure.

The system should not:

- Treat model prose as evidence.
- Hide authorization boundaries.
- Remove links to raw artifacts or verifier outputs.
- Rewrite history in the database.
- Depend only on model-generated summaries.

## Compaction Triggers

Beale should compact proactively and reactively.

Proactive triggers:

- The latest completed response reports high input-token usage.
- Manual replay input exceeds a configured serialized size limit.
- Manual replay has accumulated more than a configured number of turns.
- A session has more than a configured number of model-visible trace events.
- A VM reset, fork, or major phase transition makes old execution context potentially stale.

Reactive triggers:

- The model API returns a context-window error.
- Provider state for `previous_response_id` is unavailable.
- The provider rejects or cannot use `previous_response_id`.
- Resume state is missing pending input and must be reconstructed from Beale state.

Reactive compaction should retry once. If the compacted retry also exceeds the context window, Beale should pause the run with a clear trace event and user-visible error rather than repeatedly failing.

Scheduled compaction should prefer clean boundaries between model turns and tool calls. Beale should avoid changing model-visible state while a tool call is being executed unless it must recover from context pressure. If a context-window error or near-limit condition would otherwise lock the run, compaction should be forced from the current Beale state even if an active VM context exists.

## Compacted State Contents

The compacted replay message should be structured and redacted. It should include:

1. Run identity:
   - Run id.
   - Mode.
   - Current status.
   - Current phase, if tracked.
   - Latest trace sequence included.

2. Authorization state:
   - Program name and organization.
   - Network profile.
   - Sandbox profile.
   - In-scope assets.
   - Out-of-scope assets.
   - Important program rules.

3. Original task:
   - Original prompt.
   - User steering since the last compaction.

4. Current working state:
   - Current research objective.
   - Current branch or hypothesis being pursued.
   - Next concrete action.
   - Known blockers.

5. Observations:
   - Recent model-visible trace events.
   - Important older observations selected by relevance.
   - Tool-backed observations labeled as tool-backed.
   - Artifact references labeled by artifact id/path/summary.
   - Verifier outputs labeled by status and contract.

6. Research graph:
   - Active hypotheses.
   - Dismissed hypotheses only when they prevent repeated work.
   - Findings and their evidence/verifier state.
   - Open questions and gaps in evidence chains.

7. Sandbox state:
   - Active VM context if any.
   - Snapshot/import state.
   - Whether target material has been imported.
   - Current network policy.
   - Whether prior observations came from a destroyed or reset context.

8. Compression metadata:
   - Compaction reason.
   - Trace range summarized.
   - Trace range kept verbatim.
   - Summarizer source.
   - Redaction policy version.

## Source of Truth

The database remains authoritative. The compacted replay is a model-visible projection, not the record.

Source priority:

1. Verifier output.
2. Tool-backed trace observations.
3. Artifact metadata and accepted artifacts.
4. Host-enforced scope and policy state.
5. User steering.
6. Model summaries and hypotheses.

When these disagree, compacted state should preserve the conflict rather than smoothing it away.

## Summary Generation

MVP compaction should start with deterministic summaries built from Beale state:

- Trace event summaries.
- Tool result summaries.
- Artifact metadata.
- Hypothesis and finding records.
- Verifier run records.
- VM context records.
- Policy events.

Model-assisted summaries can be added later when deterministic compaction is not enough for a long branch. They should be created as part of the compaction event, labeled in metadata as model-assisted compaction summaries, and stored as model claims unless backed by tool or verifier evidence. A model-generated compaction summary must never be the only record of a target observation.

## Replay Modes

Beale should support these model input modes:

| Mode | Use |
| --- | --- |
| `previous_response` | Preferred when provider state is available. Send only new tool outputs or steering inputs with `previous_response_id`. |
| `assistant_item_replay` | Replay a bounded set of assistant/tool items when needed by provider mechanics. |
| `manual_response_replay` | Compatibility fallback. Must be bounded by compaction policy. |
| `compacted_replay` | Reconstruct model-visible state from Beale's database after state loss, context pressure, or phase transition. |

Manual replay should not be allowed to grow without bound. Once it crosses policy thresholds, Beale should replace it with compacted replay plus a small recent tail.

## Trace Requirements

Every compaction should append a trace event.

The trace event should record:

- Reason.
- Previous replay mode.
- New replay mode.
- Estimated or reported input token pressure when available.
- Trace sequence range summarized.
- Trace sequence range preserved verbatim.
- Number of hypotheses, findings, artifacts, verifier runs, and VM contexts represented.
- Whether the compaction followed an API failure.
- Whether a retry was attempted.

Compaction trace events should be model-visible unless they contain sensitive details after redaction.

## Compaction Checkpoints

Each compaction should create an immutable checkpoint record.

Checkpoint records should link together like a chain:

- `compaction_id`.
- `previous_compaction_id`.
- Run id and attempt id.
- Reason.
- Previous replay mode.
- New replay mode.
- Trace range summarized.
- Trace range kept verbatim.
- Current trace high-water mark.
- Token pressure or serialized-size pressure when available.
- Redaction policy version.
- Summary generation source.
- References to represented hypotheses, findings, artifacts, verifier runs, policy events, and VM contexts.

The chain enables context time travel: a researcher can inspect what the model was shown at a specific point in the session and why Beale compacted then.

New compacted replays should not recursively depend on prior summaries as their only input. Beale should regenerate compacted state from the authoritative database, using selected prior checkpoints only for continuity, historical framing, and explaining what the model had previously seen. This avoids accumulated summary drift while preserving an audit trail of model-visible context over time.

## Error Handling

On context-window error:

1. Append a model/session failure trace event with the provider error.
2. Build compacted replay from current Beale state.
3. Set replay mode to `compacted_replay`.
4. Clear unbounded manual replay.
5. Retry once.
6. If retry succeeds, append a recovery trace event.
7. If retry fails with context pressure again, pause the run and show a user-visible message.

On `previous_response_id` loss:

1. Prefer compacted replay rather than full manual replay.
2. Include the latest known response id and loss reason in compaction metadata.
3. Continue from Beale state, not from provider state assumptions.

## Security and Redaction

Compaction must preserve Beale's security model:

- OpenAI OAuth credentials stay on the host.
- Workspace databases are never mounted into the guest.
- Target-controlled text is untrusted context.
- Secrets are redacted before becoming model-visible.
- Live-target networking state remains explicit.
- User-provided vulnerability claims remain hypotheses unless backed by tool, artifact, or verifier evidence.

Compaction should use the same redaction policy as model-visible tool summaries and disclosure exports, with an explicit policy version recorded in metadata.

## Product UX

The UI should treat compaction as normal long-run maintenance, not a scary error.

Useful UI surfaces:

- Trace event: "Context compacted for long-running session."
- Inspector details showing what range was summarized.
- Notification only when compaction fails or needs user steering.

The user should not need to understand provider state mechanics during normal successful compaction. Beale should not add replay mode or compaction count to the session status header for v1. The trace event and inspector details are enough unless compaction fails.

## MVP Implementation Shape

The first implementation should:

- Keep the existing compacted replay builder but expand it into a policy module.
- Add proactive checks before each OpenAI request.
- Add context-window error detection and one compacted retry.
- Bound `manualConversationInput`.
- Store compaction metadata in the model session.
- Append compaction trace events.
- Use deterministic compaction only.

Suggested default thresholds for initial tuning:

- Compact manual replay after 32 tool turns.
- Assume a conservative 225k input-token context budget when the API or model registry does not provide a model-specific limit.
- Compact when reported input tokens reach the known or configured model context budget.
- Compact when serialized manual replay input exceeds a conservative byte limit.
- Keep the most recent 20 to 40 model-visible events verbatim after compaction.
- Keep all active hypotheses, findings, verifier states, and artifact references.

These defaults should be easy to change because real long-run behavior will guide tuning.

The 225k default is intentionally below the common OpenAI 272k effective threshold before extra usage affects limits. This leaves room for the next model turn or tool-output message to approach the effective limit without immediately failing, even though some models may technically accept much larger contexts. Beale should optimize for reliable long-running research rather than trying to fill the largest possible context window.

## Open Questions

No open compaction policy questions remain for the MVP design.

## Acceptance Criteria

The compaction system is acceptable when:

- A long manual replay session can continue past hundreds of tool turns without context-window failure.
- A context-window error triggers one compacted retry before the run is marked failed.
- The compacted replay preserves active hypotheses, findings, verifier state, and artifact references.
- Trace and inspector views show that compaction happened.
- No target observation exists only in a model-generated compaction summary.
- Tests cover proactive compaction, reactive context-window recovery, and bounded manual replay.
