# Beale

**Not a coding agent; a decoding agent.**

An Electron-based desktop workbench for authorized vulnerability research.

![Screenshot](https://i.imgur.com/Ipo1YP1.png)

---

## Status

**Very early stage / pre-alpha.**

This project is still under heavy development. There is a lot left to do before it's ready for real use. I wouldn't recommend trying to use the agent yet — it's more of a workbench-in-progress than a polished tool.

If you're curious about the direction or want to follow along, you're welcome to explore the repo. Feedback and ideas are appreciated, but expect things to be incomplete, unstable, and subject to frequent change.

---

## What is Beale?

Beale is a specialized research environment designed to help security researchers explore, hypothesize about, and verify vulnerabilities in **authorized targets only**.

It combines:
- A structured, auditable workbench for mapping architecture, trust boundaries, and attack surfaces
- Honeycrisp-driven reasoning and discovery loops
- Strong emphasis on reproducible observations, provenance, and responsible disclosure
- Honeycrisp-backed execution, memory, trace, context, and artifact visibility

The guiding philosophy is **human-steered, verifiable research** rather than fully autonomous scanning or benchmark chasing.

### Core Principles
- **Authorization first** — everything stays within the operator-recorded authorized scope
- **References over unsupported claims** — durable conclusions should point to observable tool results, files, commands, or artifacts
- **Traceability** — full append-only audit trail of sessions, tool calls, observations, artifacts, and verifier outcomes
- **Operator-controlled isolation** — Beale/Honeycrisp run with the user's host privileges; launch them inside your own VM or container when isolation is required
- **Human in the loop** — steering, review, Honeycrisp memory validation, and patch checking remain researcher-driven

---

## Key Concepts

- **Workspaces**: Local authorized research contexts with explicit ownership in Honeycrisp's global SQLite database, Beale artifacts, and references to relevant source material
- **Research Kits**: Immutable workspace-creation configurations that acquire initial resources, scope, and rules for specialized research programs
- **Runs / Sessions**: Research sessions with steering and agent forking
- **Trace, Memory & Runbooks**: Timeline of model and tool activity beside durable research knowledge and revisioned executable procedures
- **Tools**: Honeycrisp tools, skills, MCP servers, and Beale-owned disclosure/export affordances
- **Harness**: Trusted Electron main process manages credentials, policy, persistence, and coordination

---

## Architecture (High-Level)

- **Trusted Host** (Electron main): Credentials, authorized-scope policy, artifact acceptance, and typed access to Honeycrisp's versioned client protocol
- **Renderer UI**: React + TypeScript interface for visualization and interaction
- **Execution Posture**: Honeycrisp runs as a host process. Beale does not create or manage a VM/container sandbox.
- **Agent Integration**: Honeycrisp launches as the research engine; Beale displays workspace-scoped traces, durable knowledge, context, and artifacts from the active research-profile database

---

## Current State

- Electron + Vite + TypeScript foundation
- User-global registry of local Beale workspaces
- Honeycrisp-owned global SQLite persistence under `~/.honeycrisp/memory.sqlite`, with workspace and research-profile ownership retained on records
- Honeycrisp-backed research session execution
- Workspace-local Cybersecurity and Mathematics research profiles with profile-specific sessions, memory, workflows, prompts, collaboration recipes, and catalogs
- Durable research-subject identity that is independent of the recorded authorization owner
- Atomic multi-provider collaboration rooms with independent evidence memos, targeted peer challenges, structured responses, and lead-owned synthesis
- Honeycrisp-owned workspace housekeeping with separate Dejunk and Dream maintenance: Dejunk organizes recognizable loose research material under `research/` and reclaims large rebuildable or extracted resources outside protected Beale metadata and detected repositories
- Same-session provider failure recovery with capped retry backoff and transcript-aware safety-guardrail steering
- Trace UI with model, tool, system, user-steering, memory-producing, and compaction events
- Host integration for the separately maintained Beale-iOS ScreenCaptureKit companion over a loopback-only USB tunnel; selecting a research session prepares an authenticated channel for a physically connected iPhone, while the operator opens the companion and approves capture on the device. Live pixels fit into the lower-right space below the compact summary and can expand to fill the detailed sidenav while navigating other iPhone apps
- A read-only remote research catalog for Beale-iOS binds only to the Mac's Tailscale IPv4 address on TCP port `59728`; Tailscale connectivity and ACLs are the authorization boundary. Workspace listings omit paths, rules, descriptions, database metadata, and session content, while workspace-scoped memory exploration retains research prose but omits global database, artifact-storage, evidence-path, and locator metadata
- Session transcripts persisted separately from trace metadata
- List-only Honeycrisp memory catalog with search, session/workspace/subject scope and type filters, inline details, references, and textual relationships
- Workspace-scoped Jupyter-format runbooks with whole-run and per-cell controls, durable status and duration tracking, bounded outputs, healthy-runbook guidance, and dedicated Honeycrisp tools and Beale sidebar visibility
- First-class workspace Reports with a dedicated sidenav catalog, revision/state visibility, on-demand report-focused agent chats, and inline section change requests routed through normal session commentary and tool traces; opening a report stays idle until the user sends a request, with report artifact details supplied as agent context
- Steering for active sessions
- Codex, Anthropic (Claude), and xAI (Grok/X) provider onboarding/status UI
- Opt-in local profiling that writes structured JSONL reports
- No public releases yet

### Honeycrisp Boundary

Beale uses Honeycrisp's user-global `~/.honeycrisp/memory.sqlite` database. Operational sessions, runbook metadata, and durable knowledge retain explicit workspace, subject, and research-profile ownership, so profile selection remains workspace-local without clearing or hiding other workspaces. Session timelines and capture bodies are normalized into individually verified Honeycrisp rows; routine event appends do not rewrite the prior timeline, and legacy aggregate documents migrate transactionally. Structural database corruption and session hash failures remain non-retryable and instruct the operator to stop writers and preserve the original database before restore or repair. Every terminal session records a structured final disposition with typed blocker dependencies and an explicit indication of whether external state is required before meaningful progress can continue. Durable knowledge is a small graph of concise typed nodes, relationships, tags, and evidence references; transcripts, task narration, and bulk outputs are not memory. Runbooks are workspace-scoped `.ipynb` artifacts for reusable procedures and proof sequences. Their whole-run and per-cell controls execute only in the owning live Honeycrisp session, through the normal shell-safety boundary; each cell retains its latest status, duration, exit code, and bounded output.

For active runs, Honeycrisp hosts a versioned WebSocket session endpoint bound to loopback. Beale authenticates with a per-process bearer token kept in the child environment, then exchanges client-neutral session event and control envelopes. CLI calls and WebSocket controls carry validated request IDs, and both transports use the same structured error detail. Honeycrisp owns this protocol; Beale keeps one shared DTO/decoder adapter and maps it into desktop state. There is no Beale-specific stdio event or control protocol.

Honeycrisp protocol v1 is the client boundary for feature migrations. Beale validates versioned CLI success/error envelopes through one host adapter, while the WebSocket session protocol shares the same version. Session persistence and queries, knowledge and artifact operations, auxiliary model jobs and provider semantics, Agent Plugins, source materialization, and Dejunk maintenance are Honeycrisp-owned operations. Beale renders results, supplies host credentials and its built-in introspection endpoint, and enforces UI/host authorization without duplicating harness implementations or dual-writing state. The architecture ratchet now leaves only the broader legacy workbench database as recorded migration debt.

Beale is pre-alpha and uses append-only component-scoped migrations.

The sidebar Skills and MCP Servers views call Honeycrisp's `tools list --json` for the active workspace. Their configuration controls call Honeycrisp's `tools config` commands, so persisted skill directories, selected skill ids, MCP config paths, allowlists, and timeouts live in Honeycrisp's `.honeycrisp/tools.json`. Beale can still forward one-off Honeycrisp CLI runtime flags through `BEALE_HONEYCRISP_RUNTIME_ARGS_JSON` for local debugging. Run-process command wrappers do not intercept the feature protocol; a custom protocol CLI must be configured explicitly with `BEALE_HONEYCRISP_PROTOCOL_COMMAND` and implement protocol v1.

### Research Profiles

Beale uses Honeycrisp's bundled Cybersecurity profile by default. Each workspace selects Cybersecurity or Mathematics during creation, stores that selection in the workspace registry, and can use the shared global database without changing another workspace's active profile or clearing workspace lists.

The Mathematics profile supplies problem, definition, conjecture, lemma, theorem, counterexample, construction, technique, proof-attempt, obstruction, formalization, computation, reference, and trajectory memory types. Its workflows cover open exploration, proof development, verification, and literature synthesis. Its collaboration recipes use mathematical construction, counterexample, proof, assumption-audit, formal-checking, independent-derivation, and provenance-review roles; the Cybersecurity profile separately uses surface, dataflow, exploitability, mitigation, reproduction, and evidence-review roles.

Before each new run, Beale asks Honeycrisp to resolve and normalize the selected bundled profile, verifies its content hash, and stores the exact snapshot in that profile's database. The run references that snapshot, and continuations, capture import, historical rendering, and memory interpretation reuse it.

### Research Kits

Each workspace also selects a Research Kit during creation. General leaves resource and authorization entry manual; HackerOne imports and normalizes a public program scope; Apple Security Bounty supplies program guidance and an optional Apple OSS repository catalog; and MSRC supplies program guidance and rules. Kit definitions declare their compatible Research Profiles and acquisition capabilities in one shared catalog. The selection is persisted with the workspace and shown read-only in Workspace Overview because changing it after creation could invalidate the recorded scope, resources, and rules.

A profile describes requested defaults; it does not grant authority. Beale remains the trusted host for provider credentials, enabled tool families, side effects, skills, MCP servers, shell policy, and recorded authorization. Workspace profile defaults are constrained by those host-owned settings. In particular, Beale always supplies its own Auto-Review model map and reasoning effort; a profile's `modelJobs.shellReview` route cannot influence shell authorization.

Auto-Review receives only compact host facts about recorded authorization, operator-managed execution posture, and trusted runbook execution identity when present. It classifies proofing separately and denies proof commands that do not originate from a recorded runbook cell. If it denies an otherwise reviewable non-policy command, the affected session replaces its steering composer with a correlated Approve Once question; the researcher can approve only that exact command or keep it blocked. A malformed reviewer response receives one bounded schema-repair retry. Policy failures and unavailable or malformed reviews remain fail-closed, while Beale retains only the sanitized failure category, phase, and attempt count.

Beale includes an optional built-in `beale-terminator` Agent Plugin for Windows computer use. It is installed but disabled by default in Plugins and uses the exactly pinned MIT-licensed Terminator 0.24.32 UI Automation SDK. The plugin exposes only observe, find, click, type, key, scroll, wait, and screenshot operations; it does not expose Terminator's shell, browser-script, application-launch, filesystem, registry, process-control, or general workflow APIs. Read-only observations run directly, while every UI mutation pauses for a correlated Approve Once decision in Beale. Mutation targets require a fresh, 30-second, single-use observation ID and are re-resolved and fingerprinted after approval. Terminal, credential, authentication, password-manager, Windows security, permission, CAPTCHA, age-verification, ChatGPT, Codex, and Beale surfaces are denied. Computer use still runs with the current user's desktop privileges and is not isolation.

Beale's default profile delegation ceiling permits the `shell`, `repository-search`, and `file-read` families and the `none`, `read`, `write`, and `process` effects. Repository search and file reads use the current user's host filesystem permissions and may read paths outside the Beale workspace; configured repositories remain context hints rather than access fences. A trusted host operator can replace the allowed built-in families with `BEALE_HONEYCRISP_PROFILE_TOOL_FAMILY_CEILING_JSON` or narrow those effects with `BEALE_HONEYCRISP_PROFILE_SIDE_EFFECT_CEILING_JSON`. These JSON arrays are host configuration, not profile fields. Beale-launched Honeycrisp sessions are granted the shell network side effect uniformly; network isolation and destination control must be enforced outside the application with operator-managed VM, container, firewall, proxy, or host controls.

See `CHANGELOG.md` and `AGENTS.md` for current product changes and development rules.

### Known Incomplete Surfaces

- Scheduled research is not a product flow.
- Export, disclosure draft, and redacted trace review are incomplete.
- Full pause/resume/stop/fork/restart run controls are incomplete.
- Full verifier contract, artifact review, and artifact bundle controls are incomplete.
- Settings coverage is still narrow.

---

## Running Locally

Install dependencies:

```bash
npm install
```

Run from source (recommended, tested):

```bash
npm run build
npm start
```

Start the Electron app in development mode:

```bash
npm run dev
```

Build and preview a production-style local bundle:

```bash
npm run build
npm run preview
```

Run local checks:

```bash
npm run typecheck
npm test
```

Live OpenAI tests are opt-in because they require local credentials.

---

## Execution Notes

Beale does not create a managed execution sandbox. Honeycrisp runs with the current user's host privileges and persists durable artifacts through its storage/memory layout. If a research target needs OS isolation, launch Beale and Honeycrisp inside the VM, container, or lab environment you want to use.

Each research session has a shell safety mode in the steering composer. Auto-Review is the default and asks the active provider's assigned small model to review every normalized shell command before execution. Manual Approval waits for the researcher to approve or deny every command, while Danger Mode skips per-command review. `shell.run` accepts complete platform shell commands or direct executable-plus-argv calls, including executable paths, and inherits host HOME-family environment variables. Manual Approval denies commands with non-empty stdin, oversized command tuples, or executable fields that require redaction instead of presenting an incomplete or altered command for approval. All three modes retain Honeycrisp's remaining hard shell guards; none provides process isolation or reduces the privileges of commands that are allowed to run.

---

## Model Provider Notes

Codex remains the default. Honeycrisp's Pi runtime also supports Anthropic and xAI through subscription OAuth in Settings > Providers or through `ANTHROPIC_API_KEY` and `XAI_API_KEY` in Beale's host environment. With the bundled security profile, Beale preloads four model-generated goals for each of Discovery, Chaining, and Reporting from bounded prior workspace research, using independent concurrent requests with per-section retry. Custom profiles can replace those workflows, instructions, labels, and suggestion counts. New Research presents the configured workflows in a sliding bottom sheet and expands a selected or custom goal into a full editable prompt. The sheet reads the installed Pi catalog and presents provider-specific model and reasoning-effort dropdowns, so run availability stays aligned with the Honeycrisp runtime rather than a duplicated Beale list.

Provider credentials stay in the trusted host runtime and are not copied into model-visible context, traces, or the global database.

---

## Disclaimer & Safety

This tool is intended **only** for authorized vulnerability research and testing. Always respect scope, legal boundaries, and responsible disclosure practices.

The project includes strong policy and isolation intentions, but as it is pre-alpha, those safeguards are incomplete.

---

## Contributing

Contributions are welcome, but because the project is so early, it's best to start with a discussion (open an issue) before submitting large changes.

Before changing a subsystem, inspect its current source, shared contracts, and relevant tests.

---

## License

MIT. See `LICENSE`.

---

*Built with curiosity and care for the vulnerability research craft.*
