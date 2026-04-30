# Beale

**Not a coding agent; a decoding agent.**

An Electron-based desktop workbench for authorized vulnerability research.

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
- **Isolation** — execution happens in controlled environments (with plans for strong VM sandboxing)
- **Human in the loop** — steering, review, hypothesis validation, and patch checking remain researcher-driven

---

## Key Concepts

- **Workspaces**: Local folders containing your target programs with `.beale/` metadata
- **Runs / Sessions**: Research sessions with adaptive planning, steering, and forking
- **Trace & Evidence**: Timeline of model thoughts vs. real observations, hypothesis board, validated findings
- **Tools**: Structured, typed tools for code search, execution, debugging, artifact handling, verifiers, etc.
- **Harness**: Trusted Electron main process manages credentials, policy, persistence, and coordination

---

## Architecture (High-Level)

- **Trusted Host** (Electron main): Credentials, SQLite trace DB, policy enforcement, artifact acceptance
- **Renderer UI**: React-like TypeScript interface for visualization and interaction
- **Execution Sandbox**: Targets and tools run isolated (initially host with warnings; aiming for Firecracker/etc.)
- **Model Integration**: Tool-calling loop with strict verification requirements

---

## Current State

- Electron + Vite + TypeScript foundation
- Basic workspace, run tracking, and trace UI
- Planning documents and architecture notes in the `planning/` directory
- Early tool router and model integration
- No public releases yet

See `CHANGELOG.md`, `AGENTS.md`, and the `planning/` folder for more details on direction and recent changes.

---

## Disclaimer & Safety

This tool is intended **only** for authorized vulnerability research and testing. Always respect scope, legal boundaries, and responsible disclosure practices.

The project includes strong policy and isolation intentions, but as it is pre-alpha, those safeguards are incomplete.

---

## Contributing

Contributions are welcome, but because the project is so early, it's best to start with a discussion (open an issue) before submitting large changes.

---

## License

[To be determined — check LICENSE file if present]

---

*Built with curiosity and care for the vulnerability research craft.*
