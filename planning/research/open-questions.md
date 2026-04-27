# Beale Planning Decisions

These questions were resolved during the initial Beale planning pass. The follow-up research section tracks items that still need deeper source review before implementation.

## Product Scope

Answered:

- Beale is primarily an authorized vulnerability research workbench. Benchmark runner functionality exists only to validate workbench behavior and monitor regressions or improvements. See `planning/book/product-scope.md`.
- Authorization is program-scoped: each organization/research program defines allowed domains, repositories, executables, and other assets. The agent works within that scope without approval. Approval is only for potentially dangerous host-machine actions or out-of-scope actions; target execution, builds, tests, mutation analysis, PoCs, and debugging happen in the VM. See `planning/book/authorization-model.md`.
- Beale's first release should optimize for open-ended discovery. Targeted reproduction and patch validation are supporting workflows inside the discovery loop. See `planning/book/first-release-mode.md`.
- Initial domain priorities are source code analysis, binary reverse engineering, debugger usage, logic bugs, and memory corruption. Web applications and package ecosystems are secondary. Smart contracts and crypto-specific security are not priorities. See `planning/book/vulnerability-domains.md`.

## Harness Architecture

Answered:

- Primary OpenAI integration is OpenAI-first, OAuth-first, Responses API first, WebSocket-first for active runs, with `gpt-5.5` and `xhigh` reasoning as defaults. Beale owns the research orchestration while using OpenAI agent patterns where they help. See `planning/book/openai-integration.md`.
- Agent loop ownership is hybrid: Beale owns the outer vulnerability-research loop, while OpenAI owns the inner model mechanics where they improve model performance and API alignment. See `planning/book/agent-loop-ownership.md`.
- Persistence is local-only embedded SQLite, with one database per workspace directory to prevent accidental cross-program lookup. Remote persistence and sync are non-goals. See `planning/book/persistence-model.md`.
- Default sandboxing is local VM-based: Hyper-V on Windows, Tart on macOS, and Firecracker or comparable local VM technology on Linux. Docker/devcontainers are not the primary sandbox boundary. See `planning/book/sandbox-model.md`.
- The trusted harness stays on the host, while target code runs only inside disposable guest VMs. Speed comes from snapshots, artifact channels, and GUI workflow, not from weakening the boundary. See `planning/book/trusted-harness-boundary.md`.

## Tooling

Answered:

- The first model-facing structured tool set is minimal: `search`, `code_browser`, `python`, `debugger`, `artifact`, and `verifier`. AST indexes, sanitizers, coverage, fuzzers, and static analyzers are internal profiles or later additions, not separate v1 tools. See `planning/book/structured-tools.md`.
- Interactive programs should use dedicated structured wrappers when they are part of Beale's planned core workflow. Start with debuggers and any other first-release planned interactive tools; keep raw PTY/shell as fallback. See `planning/book/structured-tools.md`.
- Beale prevents observation confusion through trace and evidence provenance: model output can propose hypotheses; tool, artifact, and verifier events establish target observations; user-supplied scope events establish authorization and scope facts. See `planning/book/trace-evidence-provenance.md`.
- Tool outputs use four storage classes: structured trace, model summary, raw artifact, and derived artifact. Small structured outputs go in trace, large/noisy outputs are summarized and artifact-backed, and evidence-relevant outputs become artifacts. See `planning/book/structured-tools.md`.

## Verification

Answered:

- Benchmark mode uses a separate isolation topology: the Beale agent harness runs in a Docker container, while the grader runs on the host with one-way communication from agent outputs to grader inputs. This is benchmark-only and does not affect normal VM-based user workflows. See `planning/book/benchmark-isolation.md`.
- Open-ended discoveries are scored as evidence-backed triage priority using attacker reachability, impact, evidence confidence, exploit practicality, and scope confidence. Finding state remains separate from score. See `planning/book/open-ended-discovery-scoring.md`.
- CyberGym-style pre/post checks generalize to structured differential verifier contracts over named target states. Supported verifier shapes include single-state reproduction, patch validation, historical differential, version/config differential, and patch candidate validation. See `planning/book/verifier-contracts.md`.
- Every task mode must have at least one verifier contract. Discovery contracts can begin as hypothesis checks, but promotion to finding requires tool-backed observations, and promotion to verified finding requires a verifier result. See `planning/book/verifier-contracts.md`.
- Patch validation invariants include exploit/PoC failure, expected behavior preservation, build/runtime health, applicable tests, scoped sanitizer diagnostics, regression corpus, safe negative-case rejection, and optional performance/resource and deployment compatibility checks. See `planning/book/verifier-contracts.md`.

## Experiment Design

Answered:

- Beale should use a layered calibration suite: smoke, tool competency, vulnerability workflow, safety/policy, and small external benchmark compatibility. The suite should tune workbench behavior and remain small enough to run frequently. See `planning/book/experiment-design.md`.
- Mandatory metrics should cover outcome, evidence, quality/risk, efficiency, and attempts. `pass@1` is benchmark-compatibility only; primary product metrics are verified, evidence-backed, in-scope discoveries per unit cost and time. See `planning/book/experiment-design.md`.
- Same-model/different-harness comparisons require precise harness/run metadata and stable sampled subsets. CyberGym provides useful external reference points, but in-Beale trace-backed metrics are the primary comparison mechanism. See `planning/book/experiment-design.md`.
- Default attempt strategy is `adaptive_portfolio`: start with 2-3 independent cheap attempts, deduplicate and score hypotheses, promote promising paths to deeper verification, and stop or pause low-value attempts. See `planning/book/experiment-design.md`.

## GUI

Answered:

- Essential GUI views are program/workspace side navigation, program scope editor, markdown start-run interface, primary multi-run tracker, and run detail views with trace, tools, artifacts, hypotheses, findings, and verifiers. Chat is not a primary view. See `planning/book/electron-gui.md`.
- Live steering should include run control, hypothesis/finding control, verifier/artifact control, policy control, and disclosure/export control. Steers are immediate, trace-recorded, and reversible where practical. See `planning/book/electron-gui.md`.
- Beale should be terminal-compatible but not terminal-centered. Terminal/PTY use is a fallback and audit surface inside guest VMs; every meaningful operation should become structured research state. See `planning/book/electron-gui.md`.

## Safety and Operations

Answered:

- Human approval is required for potentially dangerous host-machine actions or out-of-scope actions. Routine in-scope work proceeds autonomously, with target execution routed into the VM. See `planning/book/authorization-model.md`.
- Benchmark sandbox networking is strict and offline by default, with only benchmark-declared endpoints allowed. Authorized project VM networking supports `offline`, `scoped`, and approved `elevated` profiles. Elevated access is not time-limited by default. See `planning/book/network-policy.md`.
- Accidental live-target testing is prevented through explicit program scope, scoped network profiles, approved test-account records, visible GUI state, and VM-local reproduction by default. Live-target testing is allowed only when scope and active network policy permit it. See `planning/book/network-policy.md`.
- Secrets are isolated through the host/VM boundary, OS credential storage where practical, host deny paths, scoped credential injection, model-visible redaction, sensitivity labels, and minimal subprocess environments. Encryption is hardening, not the core local security model. See `planning/book/secret-isolation.md`.
- Beale should not add a separate heavyweight audit subsystem in v1. The structured trace should be audit-capable by design and support redacted disclosure or accident-review exports. See `planning/book/trace-evidence-provenance.md`.

## Follow-Up Research

- Read more technical detail on Google CodeMender and Big Sleep once public writeups deepen.
- Pull the latest OpenAI Agents SDK and Responses API examples relevant to tracing, handoffs, and sandbox agents.
- Study AIxCC winning architecture reports for autonomous patching and CRS orchestration patterns.
- Review Anthropic's Claude Mythos system card and red-team blog for safety/harness lessons beyond the Project Glasswing announcement.
- Inspect CyberGym's open-source harness and dataset structure directly before designing Beale's task schema.
- Compare Cybench, BountyBench, CyberGym, EVMbench, and CVE-Bench task schemas to identify a common internal model.
