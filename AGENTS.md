# Beale Development Rules

## Project Scope

Beale is an authorized vulnerability research workbench.

The implementation, tests, root README, and changelog define the current product state.

Do not use legacy branding in new docs or code. Use `Beale`.

## Communication Style

- Keep responses concise and technical.
- Avoid fluff.
- No emojis in commits, issues, docs, comments, or code.
- Prefer direct implementation notes over broad speculation.

## Documentation Rules

- Keep documentation aligned with implemented behavior and tested boundaries.
- Do not add speculative planning, roadmap, or architecture documents unless explicitly requested.
- Keep terminology consistent:
  - Product name: `Beale`
  - Workspace metadata directory: `.beale/`
  - Global database: `~/.honeycrisp/memory.sqlite` (Honeycrisp-owned and shared with Beale; records retain workspace ownership)
  - Workspace registry: user-global metadata for known Beale workspaces
  - Authorized scope: the recorded authorization boundary within a workspace
  - First release focus: authorized open-ended vulnerability discovery
  - Execution posture: Beale and Honeycrisp run with the current user's host privileges; users should launch them inside their own VM/container when OS isolation is required

## CHANGELOG.md Management

- Maintain a root `CHANGELOG.md` for product, architecture, persistence, security model, and notable UX changes.
- Use an `Unreleased` section for ongoing work. Do not invent release versions or dates unless explicitly asked.
- Group entries under concise headings such as `Added`, `Changed`, `Fixed`, `Removed`, `Security`, and `Documentation`.
- Add entries for user-visible behavior, beta-relevant fixes, schema or migration changes, model/tool contract changes, sandbox or networking changes, major refactors, and project structure changes.
- Do not add entries for trivial formatting, typo-only edits, test-only updates with no behavior change, or purely internal cleanup that does not affect future development.
- Keep entries short and factual. Mention migrations, compatibility notes, or manual setup steps when relevant.
- When creating `CHANGELOG.md` for the first time, start it with `# Changelog`, an `## Unreleased` section, and the headings needed by the current change only.

## Security Model

Preserve these invariants in docs and implementation:

- Beale is the trusted host harness.
- Target code, build scripts, generated PoCs, tests, fuzzing, debugging, and closed-source executables run with the user's chosen host privileges. Beale must not pretend to provide isolation it does not manage.
- OpenAI OAuth credentials stay on the host.
- The global database and credential material must not be exposed through model-visible tool results.
- Generated files and verifier outputs are candidate artifacts until accepted into durable Honeycrisp/Beale storage.
- Findings require tool, artifact, or verifier-backed evidence.
- User-provided vulnerability claims seed hypotheses; they are not target observations by themselves.
- Live-target testing is allowed only when the recorded authorized scope and active network profile permit it.

## Implementation Rules

- Inspect the current source, shared contracts, and relevant tests before changing a subsystem.
- Preserve the Honeycrisp-owned research engine and global database as the canonical runtime and persistence boundaries.
- Keep product behavior, shared types, IPC contracts, and tests synchronized.
- Do not introduce remote persistence, cloud sync, or cross-workspace global search unless explicitly requested.
- Do not add model-facing tools without updating their typed contracts and boundary tests.

## Code Quality

- Use TypeScript when implementation begins.
- Avoid `any` unless there is no reasonable alternative.
- Prefer typed boundaries between renderer, host service, model adapter, persistence, and executor layers.
- Use structured parsers/APIs instead of ad hoc string parsing when practical.
- Keep host-safe setup as narrow workspace/import operations, not general host shell execution.
- Keep target execution posture explicit. Recommend an externally launched VM/container for risky target code, but do not add Beale-managed permission gates or sandbox locks.

## Commands

- Run `npm run typecheck` after code changes.
- Run `npm test` after behavior, boundary, persistence, or test changes.
- Live provider tests remain opt-in and require user-provided credentials.
