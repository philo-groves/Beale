# Subagent Orchestration

Status: implemented initial vertical slice, 2026-07-20.

## Decision

Honeycrisp exposes model-facing subagent sessions patterned after the current Codex multi-agent contract. Beale remains the host workbench and renders orchestration activity; it does not plan child work itself.

The initial surface is:

- `spawn_agent`
- `send_message`
- `followup_task`
- `interrupt_agent`
- `list_agents`
- `wait_agent`

This is a collaboration surface, separate from research tools. Calls coordinate model sessions and do not become evidence merely because an agent produced text.

## Session Tree

Each research session starts at `/root`. A child receives a stable opaque id plus a canonical task path such as `/root/parser_review`.

The initial limits are six concurrently running children and one child level. These defaults allow useful parallel work while avoiding uncontrolled fan-out. The runtime, rather than the prompt, enforces both limits.

Children inherit the active authorized workspace, repository references, storage, memory tier context, tool registry, governance policy, network posture, and host cancellation signal. Spawning a child cannot broaden scope or permissions.

## Context Inheritance

`spawn_agent.fork_turns` accepts:

- `all`, the default, for the parent's available conversation.
- A positive integer string for the last N user turns and their following messages.
- `none` for a fresh child that receives only its task and common system context.

The unresolved assistant turn containing `spawn_agent` is removed before inheritance. This prevents a child from seeing an incomplete tool call as conversation history.

Full-history children use the parent's model and reasoning effort. Partial-history and fresh children may select another model available from the active provider and a supported reasoning effort. This keeps inherited model-specific state coherent while allowing inexpensive or specialized bounded work when the child starts from a controlled context.

## Communication And Lifecycle

`send_message` queues a message for delivery at the target's next model boundary without starting an idle turn.

`followup_task` behaves similarly for a running child. For a completed or interrupted child, it starts another turn in the same child session with the child's existing conversation. It cannot target the root session.

`interrupt_agent` aborts an active child turn but preserves the child session for inspection or later follow-up. It cannot interrupt the root or the caller itself.

`list_agents` returns the current tree with paths, status, model, effort, inheritance mode, result, and error state. `wait_agent` waits for mailbox or lifecycle activity; completion and failure notices are also injected into the parent's conversation.

## Capture And Beale Presentation

Honeycrisp flow captures store child identity, parent, path, status, model, reasoning effort, inheritance mode, timestamps, output, error, turn count, tool count, and model-call metadata under `agent.raw.subagents`.

Beale records child lifecycle events, research-tool activity, and agent-aware model turns in the session trace. Child thoughts are keyed by agent path so concurrent response ids cannot overwrite root or sibling state. Root and child turns receive distinct list groups, and child token use contributes to total session use without replacing the root agent's latest context reading.

The session sidebar defaults to Memory and provides a Subagents tab derived from persisted trace metadata. Each child row shows its canonical name, latest message preview, status, and compact time since activity. Selecting a child filters the existing trace list to that exact agent path; Back to Main restores the complete session trace. This presentation adds no separate subagent persistence model, so replayed and future headless sessions use the same Honeycrisp-owned session data.

## Deferred Work

The initial slice does not include custom named agent definitions, role-specific instruction files, deeper child nesting, or Beale controls for manually creating children. Those can be added after real research sessions show a need; the runtime contract does not require them.

## Source Alignment

The behavior is based on the current public [Codex subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents.md) and the multi-agent V2 handlers in [openai/codex](https://github.com/openai/codex), adapted to Honeycrisp's Pi runtime and Beale host boundary.
