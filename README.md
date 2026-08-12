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
- **Runs / Sessions**: Research sessions with steering and agent forking
- **Trace, Memory & Runbooks**: Timeline of model and tool activity beside durable research knowledge and revisioned executable procedures
- **Tools**: Honeycrisp tools, skills, MCP servers, and Beale-owned disclosure/export affordances
- **Harness**: Trusted Electron main process manages credentials, policy, persistence, and coordination

---

## Architecture (High-Level)

- **Trusted Host** (Electron main): Credentials, authorized-scope policy, artifact acceptance, and workspace-scoped access to the active Honeycrisp profile database
- **Renderer UI**: React + TypeScript interface for visualization and interaction
- **Execution Posture**: Honeycrisp runs as a host process. Beale does not create or manage a VM/container sandbox.
- **Agent Integration**: Honeycrisp launches as the research engine; Beale displays workspace-scoped traces, durable knowledge, context, and artifacts from the active research-profile database

---

## Current State

- Electron + Vite + TypeScript foundation
- User-global registry of local Beale workspaces
- Profile-isolated Honeycrisp-owned SQLite persistence under `~/.honeycrisp/profiles/<profile-id>/memory.sqlite`
- Honeycrisp-backed research session execution
- User-selectable Cybersecurity and Mathematics research profiles with isolated sessions, memory, workflows, prompts, and catalogs
- Durable research-subject identity that is independent of the recorded authorization owner
- Workspace housekeeping with separate Dejunk and Dream maintenance: Dejunk organizes recognizable loose research material under `research/` and reclaims large rebuildable or extracted resources outside protected Beale metadata and detected repositories
- Same-session provider failure recovery with capped retry backoff and transcript-aware safety-guardrail steering
- Trace UI with model, tool, system, user-steering, memory-producing, and compaction events
- Session transcripts persisted separately from trace metadata
- List-only Honeycrisp memory catalog with search, session/workspace/subject scope and type filters, inline details, references, and textual relationships
- Workspace-scoped Jupyter-format runbooks with revisioned procedure cells, bounded recorded outputs, and dedicated Honeycrisp tools and Beale sidebar visibility
- Steering for active sessions
- Codex, Anthropic (Claude), and xAI (Grok/X) provider onboarding/status UI
- Opt-in local profiling that writes structured JSONL reports
- No public releases yet

### Honeycrisp Boundary

Beale selects one Honeycrisp profile database at a time: `~/.honeycrisp/profiles/security-research/memory.sqlite` or `~/.honeycrisp/profiles/mathematics/memory.sqlite`. Operational sessions, runbook metadata, and durable knowledge remain isolated when the profile changes, while each database still retains explicit workspace ownership. Every terminal session records a structured final disposition with typed blocker dependencies and an explicit indication of whether external state is required before meaningful progress can continue. Durable knowledge is a small graph of concise typed nodes, relationships, tags, and evidence references; transcripts, task narration, and bulk outputs are not memory. Runbooks are workspace-scoped `.ipynb` artifacts for reusable procedures and proof sequences; they do not execute outside Honeycrisp's normal shell boundary.

Beale is pre-alpha and uses append-only component-scoped migrations. Profile isolation starts with clean profile databases; the former unscoped database is not adopted.

The sidebar Skills and MCP Servers views call Honeycrisp's `tools list --json` for the active workspace. Their configuration controls call Honeycrisp's `tools config` commands, so persisted skill directories, selected skill ids, MCP config paths, allowlists, and timeouts live in Honeycrisp's `.honeycrisp/tools.json`. Beale can still forward one-off Honeycrisp CLI runtime flags through `BEALE_HONEYCRISP_RUNTIME_ARGS_JSON` for local debugging.

### Research Profiles

Beale uses Honeycrisp's bundled Cybersecurity profile by default. Agent Settings > General can switch between the bundled Cybersecurity and Mathematics profiles when no research run is active. The user-global registry stores the selection; each profile owns a separate database, and switching back restores that profile's sessions and memory.

The Mathematics profile supplies problem, definition, conjecture, lemma, theorem, counterexample, construction, technique, proof-attempt, obstruction, formalization, computation, reference, and trajectory memory types. Its workflows cover open exploration, proof development, verification, and literature synthesis.

Before each new run, Beale asks Honeycrisp to resolve and normalize the selected bundled profile, verifies its content hash, and stores the exact snapshot in that profile's database. The run references that snapshot, and continuations, capture import, historical rendering, and memory interpretation reuse it.

A profile describes requested defaults; it does not grant authority. Beale remains the trusted host for provider credentials, enabled tool families, side effects, skills, MCP servers, shell policy, and recorded authorization. Workspace profile defaults are constrained by those host-owned settings. In particular, Beale always supplies its own Auto-Review model map and reasoning effort; a profile's `modelJobs.shellReview` route cannot influence shell authorization.

Beale's default profile delegation ceiling permits only the `shell` family and the `none`, `read`, `write`, and `process` effects. A trusted host operator can let a general profile select additional built-in families with `BEALE_HONEYCRISP_PROFILE_TOOL_FAMILY_CEILING_JSON` (for example `["repository-search","file-read"]`) or narrow those effects with `BEALE_HONEYCRISP_PROFILE_SIDE_EFFECT_CEILING_JSON`. These JSON arrays are host configuration, not profile fields. Beale-launched Honeycrisp sessions are granted the shell network side effect uniformly; network isolation and destination control must be enforced outside the application with operator-managed VM, container, firewall, proxy, or host controls.

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
npx electron out/main/index.js
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

Each research session has a shell safety mode in the steering composer. Auto-Review is the default and asks the active provider's assigned small model to review every normalized shell command before execution. Manual Approval waits for the researcher to approve or deny every command, while Danger Mode skips per-command review. Manual Approval denies commands with non-empty stdin, oversized command tuples, or executable fields that require redaction instead of presenting an incomplete or altered command for approval. All three modes retain Honeycrisp's hard shell guards; none provides process isolation or reduces the privileges of commands that are allowed to run.

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
