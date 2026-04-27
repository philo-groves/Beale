# OpenAI Integration

Status: accepted initial direction, 2026-04-26.

## Decision

Beale's first-release OpenAI integration should be built for members of OpenAI's Trusted Access for Cyber program.

Default integration:

- Authentication: OAuth with a ChatGPT/Codex account. API-key-only operation is not the first-release target.
- Primary API surface: Responses API.
- Primary transport: Responses API WebSocket transport where available, for efficient long-running agent interaction.
- Default model: `gpt-5.5`.
- Default reasoning effort: `xhigh`.
- Orchestration: Beale-owned run, trace, sandbox, tool, hypothesis, and verifier model.

Beale should still remain adapter-shaped internally, but the first implementation should not dilute itself into provider-neutral lowest-common-denominator design. The OpenAI/Codex user path is the product path for v1.

## Audience Assumption

The first-release audience is expected to already be using Codex or related OpenAI cyber-access workflows.

That changes the auth and setup assumptions:

- OAuth is required.
- The onboarding flow should be OAuth-first and account-state aware, not generic API-key setup.
- The app should detect and explain account/auth state cleanly.
- Plan/model access limitations should be surfaced as product state, not low-level API errors.

OpenAI's Codex CLI docs describe `codex login` as supporting ChatGPT OAuth by default, with browser-based OAuth and credential status checks.

Source: https://developers.openai.com/codex/cli/reference#codex-login

## API Surface

Use the Responses API as the base protocol.

OpenAI's GPT-5.5 guidance says to use the Responses API for reasoning, tool-calling, and multi-turn use cases. Beale is all three: long-running reasoning, heavy structured tool use, and multi-turn state.

Source: https://developers.openai.com/api/docs/guides/latest-model#api-and-model-parameters

## Transport

Prefer the Responses API WebSocket transport for active agent runs.

Rationale:

- Long-running research sessions need low-overhead event streaming.
- Tool-heavy traces benefit from persistent bidirectional interaction.
- Electron can maintain a live run timeline without polling.
- WebSocket transport should reduce avoidable latency and request overhead compared with repeated HTTP/SSE turns.

The implementation should still keep a fallback path for environments where WebSocket support is unavailable or blocked, but that fallback is not the primary optimization target.

OpenAI/Codex config docs expose provider capability for `supports_websockets` on the Responses API transport.

Source: https://developers.openai.com/codex/config-reference#configtoml

## Model Defaults

Default:

- `model`: `gpt-5.5`
- `reasoning.effort`: `xhigh`

This is intentionally expensive and latency-tolerant because v1 is optimizing for difficult open-ended vulnerability research, not chat responsiveness.

OpenAI's GPT-5.5 docs describe `xhigh` as intended for the hardest asynchronous agentic tasks or evals that test model intelligence. That maps directly to Beale's first-release focus.

Source: https://developers.openai.com/api/docs/guides/latest-model#api-and-model-parameters

## Agents SDK vs Beale-Owned Orchestration

Beale should use OpenAI's agent-oriented primitives where they help, but Beale's own run model stays authoritative.

Use OpenAI/Agents SDK patterns for:

- Tool orchestration patterns.
- Tracing concepts.
- Handoffs if they fit multi-role research workflows.
- State handling guidance.
- Provider compatibility and future API alignment.

Keep Beale-owned:

- Target authorization and scope.
- Sandbox lifecycle.
- Tool capability policy.
- Hypothesis model.
- Evidence model.
- Finding state machine.
- Verifier contracts.
- Artifact storage.
- Run comparison and regression metrics.

The workbench cannot let a provider SDK hide the security boundary, trace schema, or verifier semantics.

OpenAI's GPT-5.5 guidance recommends current Agents SDK patterns for orchestration, tracing, handoffs, and state management, while also emphasizing Responses API state details such as `previous_response_id`, assistant-item replay, `phase`, preambles, and compaction.

Source: https://developers.openai.com/api/docs/guides/latest-model#using-reasoning-models

## Codex SDK and App-Server Surfaces

Codex app-server and related Codex-specific surfaces should be treated as reference and compatibility surfaces, not the first-release core.

Reasons:

- Beale is an Electron workbench with a domain-specific research model, not a wrapper around the Codex desktop app.
- Codex app-server is useful for understanding auth, session, and desktop-app integration patterns.
- The harness still needs its own structured security tools, artifact model, sandbox policy, and verifier state.

If a Codex SDK/app-server surface provides stable access to authentication, trace, or tool execution primitives later, Beale can adopt it behind the OpenAI adapter.

## Planning Consequence

The first implementation should be:

1. OpenAI-first.
2. OAuth-first.
3. Responses API first.
4. WebSocket-first for active runs.
5. `gpt-5.5` + `xhigh` by default.
6. Beale-owned orchestration around OpenAI model/tool APIs.

Other providers and non-OpenAI account modes can be supported later only if they do not weaken the v1 workbench design.
