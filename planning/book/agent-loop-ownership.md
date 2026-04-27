# Agent Loop Ownership

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should use a hybrid ownership model:

- Beale owns the outer vulnerability-research loop.
- OpenAI owns the inner model mechanics where those mechanics improve model performance and API alignment.

This means Beale is not a passive UI wrapped around a provider agent. It is the authoritative research workbench, with OpenAI model APIs used as the strongest available reasoning and tool-calling substrate.

## Beale-Owned Outer Loop

Beale owns everything that defines trustworthy authorized vulnerability research:

- Target authorization and scope.
- Target model: source, binary, mixed artifacts, services, corpora, symbols, builds.
- Run lifecycle.
- Attempt creation, forking, promotion, cancellation, and comparison.
- Sandbox/container lifecycle.
- Tool capability policy and human approval.
- Hypothesis board and hypothesis state transitions.
- Evidence model.
- Finding state machine.
- Artifact storage.
- Verifier contracts and verifier execution.
- Patch validation workflow.
- Regression and benchmark metrics.
- Audit log and responsible-disclosure record.
- GUI state and user steering.

These objects must exist independently of any single provider SDK.

## OpenAI-Owned Inner Mechanics

OpenAI should own or strongly influence mechanics that help GPT-5.5 perform well:

- Responses API protocol.
- WebSocket event streaming for active runs.
- Native tool-call item handling.
- Reasoning controls such as `reasoning.effort`.
- Preambles where useful for live run UX.
- `previous_response_id` or assistant-item replay patterns.
- `phase` preservation.
- Conversation/state compaction patterns.
- Hosted tools where they fit Beale's security model.
- Agents SDK patterns for tracing, handoffs, and tool orchestration when they do not obscure Beale's own state.

Beale should track these mechanics carefully because mishandling them can reduce model performance even when the high-level prompt is good.

## Ownership Boundary

| Area | Owner |
| --- | --- |
| OAuth and account session | OpenAI-integrated, Beale UI-managed |
| Model reasoning | OpenAI |
| Tool-call protocol | OpenAI mechanics, Beale policy |
| Tool execution | Beale |
| Target authorization | Beale |
| Sandbox lifecycle | Beale |
| Network and filesystem policy | Beale |
| Hypotheses | Beale |
| Findings | Beale |
| Evidence and artifacts | Beale |
| Verifiers | Beale |
| Trace schema | Beale, informed by OpenAI events |
| Context compaction | Beale policy using OpenAI guidance |
| Handoffs and specialists | Beale workflow using OpenAI patterns where useful |
| Benchmark/regression runner | Beale |

## Rationale

Open-ended vulnerability research needs product-level state that a generic coding agent loop does not own:

- What is authorized.
- What has actually been observed.
- Which hypotheses are active or disproven.
- Which evidence is verifier-backed.
- Which actions touched a sandbox, target, network, or filesystem.
- Which finding state can be trusted by a human researcher.

At the same time, GPT-5.5 is expected to perform best when used through OpenAI's current reasoning, state, and tool-call patterns. Beale should not rebuild those mechanics casually.

## Design Rule

If a decision affects security boundaries, evidence validity, finding semantics, sandbox state, authorization, or user-visible research workflow, Beale owns it.

If a decision affects how GPT-5.5 best reasons, streams, calls tools, preserves model state, or compacts context, Beale should follow OpenAI-native mechanics unless they conflict with the workbench model.

## Planning Consequence

The harness architecture should be designed as a Beale run engine with an OpenAI model adapter, not as an OpenAI agent wrapped by Beale UI.
