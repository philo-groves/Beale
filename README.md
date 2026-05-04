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
- Model-assisted (currently OpenAI) reasoning and discovery loops
- Strong emphasis on evidence, verification, provenance, and responsible disclosure
- Sandboxed execution of tools, fuzzing, debugging, and target binaries

The guiding philosophy is **human-steered, verifiable research** rather than fully autonomous scanning or benchmark chasing.

### Core Principles
- **Authorization first** — everything stays within scoped, permitted programs/targets
- **Evidence over claims** — model reasoning must be backed by observable tool results and artifacts
- **Traceability** — full append-only audit trail of sessions, tool calls, observations, and findings
- **Isolation** — execution happens in controlled environments, with VM-backed sandboxes preferred for high-risk target execution
- **Human in the loop** — steering, review, hypothesis validation, and patch checking remain researcher-driven

---

## Key Concepts

- **Workspaces**: Local folders containing your target programs with `.beale/` metadata
- **Runs / Sessions**: Research sessions with adaptive planning, steering, and planned forking
- **Trace & Evidence**: Timeline of model thoughts vs. real observations, hypothesis board, validated findings
- **Tools**: Structured, typed tools for code search, execution, debugging, artifact handling, verifiers, etc.
- **Harness**: Trusted Electron main process manages credentials, policy, persistence, and coordination

---

## Architecture (High-Level)

- **Trusted Host** (Electron main): Credentials, SQLite trace DB, policy enforcement, artifact acceptance
- **Renderer UI**: React + TypeScript interface for visualization and interaction
- **Execution Sandbox**: Targets and tools can run on the host with warnings today; Firecracker is the most exercised VM path, and Docker is available as a lower-assurance sandbox option
- **Model Integration**: Tool-calling loop with strict verification requirements

---

## Current State

- Electron + Vite + TypeScript foundation
- Multi-program local workspace registry
- SQLite-backed research session persistence under `.beale/`
- OpenAI-backed research session execution
- Trace UI with model, tool, system, hypothesis, finding, evidence, and compaction events
- Session transcripts persisted separately from trace metadata
- Hypothesis and finding side panels
- Steering for active sessions
- OpenAI provider onboarding/status UI
- Firecracker setup tooling and live test path on WSL/Linux
- Opt-in local profiling that writes structured JSONL reports
- Planning documents and architecture notes in the `planning/` directory
- No public releases yet

See `CHANGELOG.md`, `AGENTS.md`, and the `planning/` folder for more details on direction and recent changes.

### Known Incomplete Surfaces

- The baked-in File/Edit/View/Window menu buttons are placeholders.
- Sidebar Search and Schedules are not complete product flows.
- Export, disclosure draft, and redacted trace review are incomplete.
- Full pause/resume/stop/fork/restart run controls are incomplete.
- Full verifier contract, artifact review, and evidence bundle controls are incomplete.
- Hyper-V and Tart sandbox backends are not implemented yet.
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

Live OpenAI and Firecracker tests are opt-in because they require local credentials or host setup.

---

## Sandbox Notes

The Linux/WSL Firecracker path is the most exercised VM-backed sandbox today.

```bash
npm run firecracker:init
npm run firecracker:doctor
```

Privileged helper installation is intentionally explicit and may require `sudo`:

```bash
npm run firecracker:install-privileged-helper
```

Host execution is currently supported for product practicality, but VM-backed execution remains the safer direction for target code, generated PoCs, fuzzing, debugging, and closed-source executables.

Docker can be selected as a sandbox backend for convenience, but it is less secure than a virtual machine and should not be treated as equivalent isolation for high-risk target execution.

---

## OpenAI Notes

Live model runs require OpenAI credentials with Responses API access.

OpenAI credentials should stay on the host. They should not be mounted into sandboxes.

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
