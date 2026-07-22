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
- **Traceability** — full append-only audit trail of sessions, tool calls, observations, and findings
- **Operator-controlled isolation** — Beale/Honeycrisp run with the user's host privileges; launch them inside your own VM or container when isolation is required
- **Human in the loop** — steering, review, hypothesis validation, and patch checking remain researcher-driven

---

## Key Concepts

- **Workspaces**: Local authorized research contexts with explicit ownership in Honeycrisp's global SQLite database, Beale artifacts, and references to relevant source material
- **Runs / Sessions**: Research sessions with adaptive planning, steering, and planned forking
- **Trace & Memory**: Timeline of model and tool activity beside a searchable, tiered catalog of durable research knowledge
- **Tools**: Honeycrisp tools, skills, MCP servers, and Beale-owned disclosure/export affordances
- **Harness**: Trusted Electron main process manages credentials, policy, persistence, and coordination

---

## Architecture (High-Level)

- **Trusted Host** (Electron main): Credentials, authorized-scope policy, artifact acceptance, and workspace-scoped access to the Honeycrisp-owned global database
- **Renderer UI**: React + TypeScript interface for visualization and interaction
- **Execution Posture**: Honeycrisp runs as a host process. Beale does not create or manage a VM/container sandbox.
- **Agent Integration**: Honeycrisp launches as the research engine; Beale and headless Honeycrisp use the same global database and Beale displays workspace-scoped traces, durable knowledge, context, and artifacts

---

## Current State

- Electron + Vite + TypeScript foundation
- User-global registry of local Beale workspaces
- Unified Honeycrisp-owned SQLite persistence at `~/.honeycrisp/memory.sqlite`
- Honeycrisp-backed research session execution
- Trace UI with model, tool, system, user-steering, memory-producing, and compaction events
- Session transcripts persisted separately from trace metadata
- List-only Honeycrisp memory catalog with search, tier/type filters, inline details, references, and textual relationships
- Steering for active sessions
- OpenAI provider onboarding/status UI
- Opt-in local profiling that writes structured JSONL reports
- Planning documents and architecture notes in the `planning/` directory
- No public releases yet

### Honeycrisp Boundary

Honeycrisp's `~/.honeycrisp/memory.sqlite` is the single database for both headless and Beale-driven research across workspaces. Operational session data and the durable knowledge graph share that database but retain explicit workspace ownership. Durable knowledge is a small graph of concise typed nodes, relationships, asset links, tags, and relative evidence references; transcripts, task narration, and bulk outputs are not memory. Nodes are tiered as session, workspace, or owner/subject knowledge, and only subject-tier knowledge crosses matching workspaces. Beale keeps the researcher interface, authorized-scope setup, visualization, and disclosure/export workflows without maintaining a parallel source of truth.

Beale is pre-alpha and uses append-only component-scoped migrations. The global-database migration adopts the existing workspace database without deleting the source.

The sidebar Skills and MCP Servers views call Honeycrisp's `tools list --json` for the active workspace. Their configuration controls call Honeycrisp's `tools config` commands, so persisted skill directories, selected skill ids, MCP config paths, allowlists, and timeouts live in Honeycrisp's `.honeycrisp/tools.json`. Beale can still forward one-off Honeycrisp CLI runtime flags through `BEALE_HONEYCRISP_RUNTIME_ARGS_JSON` for local debugging.

See `CHANGELOG.md`, `AGENTS.md`, and the `planning/` folder for more details on direction and recent changes.

### Known Incomplete Surfaces

- The baked-in File/Edit/View/Window menu buttons are placeholders.
- Sidebar Search and Schedules are not complete product flows.
- Export, disclosure draft, and redacted trace review are incomplete.
- Full pause/resume/stop/fork/restart run controls are incomplete.
- Full verifier contract, artifact review, and evidence bundle controls are incomplete.
- Settings coverage is still narrow.

See `planning/book/beta-readiness.md` for the current beta-readiness checklist.

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

---

## OpenAI Notes

Live model runs require OpenAI credentials with Responses API access.

OpenAI credentials stay in the host process and are not exposed to the renderer.

---

## Planning Docs

Good starting points:

- `planning/book/product-scope.md`
- `planning/book/first-release-mode.md`
- `planning/book/roadmap.md`
- `planning/book/beta-readiness.md`
- `planning/book/SUMMARY.md`

---

## Disclaimer & Safety

This tool is intended **only** for authorized vulnerability research and testing. Always respect scope, legal boundaries, and responsible disclosure practices.

The project includes strong policy and isolation intentions, but as it is pre-alpha, those safeguards are incomplete.

---

## Contributing

Contributions are welcome, but because the project is so early, it's best to start with a discussion (open an issue) before submitting large changes.

Before changing a subsystem, read the relevant planning docs under `planning/book/`.

---

## License

MIT. See `LICENSE`.

---

*Built with curiosity and care for the vulnerability research craft.*
