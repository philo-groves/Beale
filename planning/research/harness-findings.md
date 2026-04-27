# Harness Findings for Beale

This is a synthesis of the initial source pass. It is not yet the Beale architecture plan.

## 1. Harnesses Can Move Capability by Double-Digit Points

CyberGym's live leaderboard lists `GPT-5.4` at 66.3 percent with `Codex CLI` and 79.0 percent with `OpenAI Agent` on Level 1 one-trial runs. Same model, different harness, 12.7 percentage points.

Project Naptime makes the same point from a different angle: changing the evaluation setup to allow reasoning, tool use, verification, and sampling produced up to 20x better CyberSecEval2 results than the original single-shot methodology.

Beale implication: every run must store the full harness identity, not just model name. Prompt version, tool manifest, sandbox image, retry policy, context policy, verifier version, token budget, reasoning effort, and attempts are all part of the experimental condition.

## 2. The Core Loop Should Match Vulnerability Research

The recurring successful loop is:

1. Form a hypothesis.
2. Inspect semantically relevant code.
3. Build or mutate a reproducer.
4. Execute under instrumentation.
5. Interpret runtime feedback.
6. Refine or abandon the hypothesis.
7. Submit evidence only after verifier success.

Naptime, Big Sleep, CyberGym, EnIGMA, BountyBench, and EVMbench all reward this kind of iterative workflow. Beale should make it the default interaction model rather than a chat transcript with shell access bolted on.

## 3. Specialized Tools Beat a Raw Terminal Alone

Useful tool classes from the sources:

- Code browser: entity lookup, references, call sites, semantic navigation.
- Execution: shell, test runner, language-specific harnesses, package manager, build system.
- Dynamic analysis: debugger, breakpoint inspection, expression evaluation, crash/sanitizer capture.
- Scripting: Python or equivalent for input generation, parsing, mutation, and lightweight analysis.
- Network/interactive tools: controlled client/server connections and long-running process interaction.
- Verification/reporting: structured submit, abort, finding, PoC, patch, and evidence tools.

Beale should expose these as structured tools with typed inputs and outputs. The GUI should render them as trace events and artifacts, not just terminal text.

## 4. Verification Is the Product Boundary

A finding should not be "accepted" because the model explained it convincingly. The strongest benchmarks use objective or near-objective checks:

- Pre-patch succeeds and post-patch fails.
- Patch preserves invariants and blocks the exploit.
- Blockchain state replay proves a smart-contract exploit result.
- Runtime health checks and integration tests detect regressions.
- Grader runs in a separate container the agent cannot access.

Beale should make verification a first-class service. Findings should have states like `hypothesis`, `reproduced`, `validated`, `patched`, `regression-risk`, and `dismissed`.

## 5. Multiple Independent Attempts Are Not Optional

Project Naptime argues that vulnerability research explores multiple hypotheses and that doing so inside one trajectory is inefficient. AISI and OpenAI evaluations also report pass@k-style metrics over multiple attempts or rollouts.

Beale should support a portfolio executor:

- Launch independent attempts with varied seeds/prompts/tool constraints.
- Deduplicate converged hypotheses.
- Promote promising attempts to deeper analysis.
- Preserve failed attempts for harness tuning.
- Report pass@1, pass@k, cost, wall time, and verifier success.

## 6. Information Regimes Must Be Explicit

Performance changes dramatically depending on what the agent is given. BountyBench, CVE-Bench, Big Sleep, CyberGym, and EVMbench all vary the task brief: no information, CWE/weakness hint, title, full report, patch/diff, target description, or known vulnerable code.

Beale should define modes such as:

- `open-discovery`: latest codebase, no known vulnerability.
- `variant-analysis`: seed patch, commit, bug report, or diff.
- `targeted-reproduction`: vulnerability description plus unpatched code.
- `patch-validation`: patch plus exploit/regression verification.
- `triage`: candidate finding plus request for evidence and impact.

Each mode should have a separate prompt, verifier contract, scoring policy, and UI workflow.

## 7. Detect Mode Needs Coverage Incentives

EVMbench observed that agents often perform better when the objective is explicit and concrete. Detect/audit tasks are weaker partly because agents may stop after one issue instead of exhaustively auditing.

Beale should avoid rewarding "first bug found" behavior in audit mode. It should ask for coverage by component, entry point, trust boundary, and vulnerability class. The GUI can show audit coverage maps and unanswered hypotheses to make early stopping visible.

## 8. The Sandbox Should Be a Tool, Not the Harness Host

OpenAI's sandbox-agent guidance recommends keeping the trusted harness, credentials, policy, audit, and tool orchestration in the host while the sandbox receives only the scoped workspace and execution capabilities.

Beale implication:

- Electron GUI and host service own credentials, run state, policies, and audit logs.
- Each attempt gets a disposable sandbox/container.
- The sandbox never receives model/provider credentials.
- The grader is separate from both the model and the execution sandbox.
- Network access is explicit per task and disabled by default for benchmark work.

## 9. Agent Security Is Part of Harness Design

Agentic vulnerability research tools handle untrusted code, build scripts, logs, webpages, and model-visible text. That creates prompt-injection and tool-abuse risk.

Required baseline:

- Strict workspace scoping.
- Network deny by default with per-task allowlists.
- Secret isolation.
- Tool capability manifests.
- Human approval gates for risky external actions.
- Immutable trace logs.
- Clear distinction between model claims and real tool observations.

## 10. Tracing Is a Research Instrument

The major institutions rely on transcript review, trace analysis, and task debugging. EnIGMA's "soliloquizing" warning is especially relevant: a model may invent observations unless tool outputs are authoritative.

Beale should have a structured trace schema with:

- Message and reasoning summaries where available.
- Tool calls, stdout/stderr, exit codes, timeouts, artifacts.
- Environment snapshots and diffs.
- Hypothesis IDs and evidence links.
- Verifier runs and results.
- User steering and approval events.

The GUI should be a trace workbench, not just a terminal replacement.

## 11. The Harness Needs Calibration Sweeps

AISI recommends quick sweeps over representative tasks to tune temperature, attempts, token limits, prompts, and tools before full evaluation. The GPT-5.3-Codex launch notes also indicate that harness adaptation and context rendering bugs can affect performance.

Beale should include a harness optimizer:

- Run a small calibration suite.
- Compare prompt/tool/context variants.
- Detect diminishing returns for token/attempt budgets.
- Surface environment flakes separately from agent failures.
- Version the winning harness configuration.

## 12. Electron GUI Implications

The GUI should support high-control research operations:

- Run queue with attempts, budgets, sandboxes, and model/provider selection.
- Live trace timeline with tool output folding and artifact previews.
- Hypothesis board grouped by component, sink/source, and evidence state.
- PoC and patch artifact browser.
- Verifier dashboard for pre/post-patch, regression, sanitizer, and latest-version checks.
- Threat model editor tied into prompts and finding triage.
- Benchmark comparison view by model, harness, task mode, and cost.
- Human steering controls for pausing, forking, promoting, or terminating attempts.

## Provisional Design Bias

Use an agent framework only if it gives Beale enough control over tools, state, trace schema, sandbox boundaries, and benchmark reproducibility. If the framework hides too much, build the orchestration around a lower-level agentic API and keep Beale's own run model authoritative.
