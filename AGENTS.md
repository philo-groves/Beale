# Beale Development Rules

## Project Scope

Beale is an authorized vulnerability research workbench.

The current project state is planning-first:

- Planning docs live in `planning/`.
- The book index is `planning/book/SUMMARY.md`.
- Research notes live in `planning/research/`.
- Generated planning images currently live in `planning/book/`.

Do not use legacy branding in new docs or code. Use `Beale`.

## Communication Style

- Keep responses concise and technical.
- Avoid fluff.
- No emojis in commits, issues, docs, comments, or code.
- Prefer direct implementation notes over broad speculation.

## Documentation Rules

- When adding a new planning document, link it from `planning/book/SUMMARY.md`.
- Keep the book organized by chapter.
- Use `planning/book/...` paths when referencing docs from project-root-oriented prose.
- Use `../book/...` only when a relative Markdown link is intended from `planning/research/`.
- Keep terminology consistent:
  - Product name: `Beale`
  - Workspace metadata directory: `.beale/`
  - Workspace database: `.beale/beale.sqlite`
  - First release focus: authorized open-ended vulnerability discovery
  - Normal sandbox boundary: local disposable VM
  - Benchmark isolation: Dockerized agent harness with host-side grader and host-side model/auth proxy
- If generated diagrams or UI mockups are added, store them under `planning/book/` and mention any important stale labels in the final response.

## Security Model

Preserve these invariants in docs and implementation:

- Beale is the trusted host harness.
- Target code, build scripts, generated PoCs, tests, fuzzing, debugging, and closed-source executables run in disposable guest VMs.
- OpenAI OAuth credentials stay on the host.
- The workspace database is never mounted into the guest.
- Guest exports are candidate artifacts until accepted by the host.
- Findings require tool, artifact, or verifier-backed evidence.
- User-provided vulnerability claims seed hypotheses; they are not target observations by themselves.
- Live-target testing is allowed only when the recorded program scope and active network profile permit it.

## Implementation Rules

- Read the planning docs before implementing a subsystem.
- Prefer the first vertical slice in `planning/book/vertical-slice.md` before broader feature work.
- Keep the first implementation narrow:
  - Workspace open/create.
  - Program scope.
  - SQLite persistence.
  - Run tracker.
  - Run detail.
  - Fake agent/executor trace events.
- Do not add real target execution before the executor boundary is implemented.
- Do not introduce remote persistence, cloud sync, or cross-workspace global search unless explicitly requested.
- Do not add model-facing tools beyond the planned v1 set without updating the structured-tools docs.

## Code Quality

- Use TypeScript when implementation begins.
- Avoid `any` unless there is no reasonable alternative.
- Prefer typed boundaries between renderer, host service, model adapter, persistence, and executor layers.
- Use structured parsers/APIs instead of ad hoc string parsing when practical.
- Keep host-safe setup as narrow workspace/import operations, not general host shell execution.
- Keep target execution tools VM-only.

## Commands

- This project does not yet define package scripts.
- Do not invent checks before the project has a package manifest.
- Once scripts exist, run the project-specific typecheck/lint command after code changes.
- Documentation-only changes do not require code checks.

## Git Rules

- Do not commit unless explicitly asked.
- If this directory becomes a git repository, stage only files changed in the current task.
- Never use `git add .` or `git add -A`.
- Never use destructive git commands such as `git reset --hard`, `git checkout .`, or `git clean -fd` unless explicitly requested.
