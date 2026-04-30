# Beale

Beale is an authorized vulnerability research workbench.

It is being built for open-ended security research on targets where the user has explicit permission: local codebases, authorized bounty programs, internal assessments, and controlled benchmark targets.

Beale is not production-ready yet. The repository is public-facing enough to inspect and run, but several beta-facing controls and workflows are still incomplete.

## Current Status

Working vertical slice:

- Electron desktop workbench.
- Multi-program local workspace registry.
- Local SQLite-backed research session state.
- OpenAI-backed research session execution.
- Trace timeline with model, tool, system, hypothesis, finding, evidence, and compaction events.
- Session transcripts persisted separately from trace metadata.
- Hypothesis and finding side panels.
- Steering for active sessions.
- OpenAI provider onboarding/status UI.
- Firecracker setup tooling and live test path on WSL/Linux.
- Opt-in local profiling that writes structured JSONL reports.

Known incomplete surfaces:

- The baked-in File/Edit/View/Window menu buttons are placeholders.
- Sidebar Search and Schedules are not complete product flows.
- Export, disclosure draft, and redacted trace review are incomplete.
- Full pause/resume/stop/fork/restart run controls are incomplete.
- Full verifier contract, artifact review, and evidence bundle controls are incomplete.
- Hyper-V and Tart VM backends are not implemented yet.
- Settings coverage is still narrow.

See [planning/book/beta-readiness.md](planning/book/beta-readiness.md) for the current beta-readiness checklist.

## Safety Boundary

Use Beale only for authorized research.

Beale is designed around these invariants:

- Program authorization and scope should be recorded before live-target testing.
- Model claims are hypotheses until backed by tool, artifact, or verifier evidence.
- OpenAI credentials stay on the host.
- Workspace databases are local.
- Guest VM exports are candidate artifacts until accepted by the host.
- Live-target testing must remain inside the recorded program scope and network profile.

Host execution is currently supported for product practicality, but VM-backed execution remains the safer default direction for target code, generated PoCs, fuzzing, debugging, and closed-source executables.

## Repository Layout

- `src/main/`: Electron main process, workspace service, persistence, OpenAI adapter, executor integration.
- `src/preload/`: Electron preload bridge.
- `src/renderer/`: React renderer, workbench UI, trace views, settings, modals, profiling UI.
- `tests/`: unit, integration, renderer view-model, benchmark, and live-test harness tests.
- `scripts/`: Firecracker setup and VM controller scripts.
- `resources/`: app icon and packaged resources.
- `planning/book/`: product, architecture, security, UX, and beta planning docs.
- `planning/research/`: research notes and source synthesis.

## Requirements

- Node.js compatible with the checked-in dependencies.
- npm.
- Linux/WSL, Windows, or macOS for the Electron shell.
- Optional: Firecracker on Linux/WSL for the VM-backed live executor path.
- Optional: OpenAI API-capable credentials for live model runs.

The current development machine path is WSL Ubuntu, so Linux/WSL setup is the most exercised path.

## Install

```bash
npm install
```

## Run The App

```bash
npm run dev
```

For a production-style local build:

```bash
npm run build
npm run preview
```

## Checks

```bash
npm run typecheck
npm test
```

Plan-conformance checks:

```bash
npm run test:plan
```

## Firecracker Setup

Initialize local Firecracker config and assets:

```bash
npm run firecracker:init
npm run firecracker:doctor
```

Install paths are intentionally split so privileged operations are explicit:

```bash
npm run firecracker:install-binary
npm run firecracker:install-ci-images
npm run firecracker:install-privileged-helper
```

The privileged helper install may require `sudo`. Review the script output before running privileged commands.

Live Firecracker tests are opt-in:

```bash
npm run test:firecracker:live
```

## OpenAI Credentials

Live OpenAI runs require OpenAI credentials with Responses API access.

The app supports provider status in Settings > Providers. Local development can also use environment/configured credentials used by the main process. Live OpenAI tests are opt-in:

```bash
npm run test:openai:live
```

OpenAI credentials should stay on the host. They should not be mounted into guest VMs.

## Profiling

Local profiling is opt-in from Settings > General.

When enabled, Beale writes structured JSONL reports to a temp directory such as:

```text
/tmp/beale-profiling/
```

Profiling is intended for local development and beta hardening, not remote telemetry.

## Planning Docs

Start with:

- [Product Scope](planning/book/product-scope.md)
- [First Release Mode](planning/book/first-release-mode.md)
- [Roadmap](planning/book/roadmap.md)
- [Beta Readiness and Incomplete Surfaces](planning/book/beta-readiness.md)
- [Book Summary](planning/book/SUMMARY.md)

## Contributing

Beale is planning-first. Before changing a subsystem, read the relevant planning docs under `planning/book/`.

Keep changes aligned with the security model:

- Beale is the trusted host harness.
- Workspace data remains local.
- Findings require evidence.
- Authorization and scope are product state, not comments.
- Target execution should remain explicit and traceable.

Do not add silent no-op controls. If a feature is not ready, hide it, disable it with a clear reason, or document it as a preview.

## License

No license has been selected yet.

