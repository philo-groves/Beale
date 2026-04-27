# Experiment Design

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should use a layered calibration suite for harness tuning:

- Smoke suite.
- Tool competency suite.
- Vulnerability workflow suite.
- Safety and policy suite.
- Small external benchmark compatibility suite.

The calibration suite exists to tune the workbench harness and detect regressions. It should stay small enough to run frequently.

## Purpose

The calibration suite should answer:

- Did a prompt, tool, context, or orchestration change improve behavior?
- Did it make runs faster, cheaper, or more reliable?
- Did it break debugger use, verifier use, artifact capture, tracing, or scope policy?
- Did it create safety or policy regressions?
- Is Beale still compatible with external benchmark signals?

## Smoke Suite

Purpose:

- Prove the harness works end to end.

Example tasks:

- Source search finds a known bug path.
- Agent creates a hypothesis.
- Agent runs a simple verifier.
- Artifact capture works.
- VM snapshot restore works.
- Network policy blocks or permits an expected destination.
- Debugger captures a deliberate crash.

Suggested size:

- 5 to 10 tasks.

Run frequency:

- Every meaningful harness change.

## Tool Competency Suite

Purpose:

- Verify that the model can use Beale's core tools effectively.

Example tasks:

- `search`: find relevant source, sink, symbol, string, or artifact.
- `code_browser`: navigate definitions, references, and call paths.
- `python`: generate or mutate a PoC input.
- `debugger`: set breakpoint, inspect crash, identify crashing function.
- `artifact`: preserve PoC, crash, log, or debugger transcript.
- `verifier`: declare and run a simple contract.

Suggested size:

- 10 to 20 tasks.

Run frequency:

- When prompts, tool schemas, tool outputs, or tool wrappers change.

## Vulnerability Workflow Suite

Purpose:

- Exercise realistic end-to-end research workflows.

Initial coverage:

- Source logic bug.
- Source memory corruption.
- Binary crash reproduction.
- Debugger-driven root cause.
- Variant analysis from patch or diff.
- Patch validation.

Suggested size:

- 12 to 25 tasks.

Run frequency:

- Before releases and after major harness changes.

## Safety and Policy Suite

Purpose:

- Check that workbench boundaries hold.

Example tasks:

- Target tries to read host secrets.
- Target output injects instructions to read tokens or disable policy.
- Out-of-scope network request.
- Live-target action without scope.
- Attempt to run target binary on host.
- Attempt to access `.beale/beale.sqlite`.
- Credential injection redaction.
- Contaminated VM snapshot is not reused as clean.

Suggested size:

- 10 to 20 tasks.

Run frequency:

- Always before release.
- Often during sandbox, network, tool, or secret-policy work.

## External Benchmark Compatibility Suite

Purpose:

- Keep Beale aligned with external signal and avoid overfitting to local fixtures.

Initial sources:

- Small CyberGym subset.
- Other benchmark subsets later if licensing, setup, and relevance fit.

Suggested size:

- 10 to 30 tasks initially.

Run frequency:

- Less often than local suites because cost and time are higher.

## Task Metadata

Each calibration task should define:

- `task_id`
- Mode: discovery, reproduction, patch validation, variant analysis, benchmark, or safety.
- Target assets.
- Program scope policy.
- Expected tool competencies.
- Verifier contract.
- Maximum attempts.
- Maximum wall time.
- Maximum cost or token budget.
- Expected result.
- Scoring rubric.
- Known failure modes.
- Required artifacts.

## Tuning Dimensions

Calibration should vary only a few dimensions at a time:

- Prompt version.
- Tool schema.
- Tool output shape.
- Context packing strategy.
- Reasoning effort.
- Attempt count.
- Compaction strategy.
- Search and code browser behavior.
- Verifier strictness.

## Metrics

Collect:

- Pass, fail, or inconclusive result.
- Verified finding count.
- Time to first useful hypothesis.
- Time to verifier result.
- Tool-call count.
- Failed tool-call count.
- Token and cost usage.
- Artifact completeness.
- Policy violations blocked.
- False positives.
- Trace quality: whether claims are evidence-linked.

## Mandatory Metrics

Beale should optimize for verified, evidence-backed, in-scope discoveries per unit cost and time, not single-attempt pass rate.

`pass@1` is not a primary product metric. It may be recorded for compatibility when an external benchmark expects it, but it should not drive workbench design.

### Outcome Metrics

- `verified_findings_count`
- `high_priority_verified_findings_count`
- `reproduced_findings_count`
- `dismissed_hypotheses_count`
- `out_of_scope_findings_count`
- `duplicate_findings_count`
- `patches_validated_count`
- `patch_validation_failures_count`

### Evidence Metrics

- `verifier_success_rate`
- `verifier_inconclusive_rate`
- `evidence_confidence_median`
- `findings_with_artifacts_ratio`
- `findings_with_repro_ratio`
- `findings_with_verifier_result_ratio`
- `claims_without_evidence_count`

### Quality and Risk Metrics

- `false_positive_rate` after human or verifier review.
- `severity_distribution`
- `priority_score_distribution`
- `patch_regression_rate`
- `policy_violation_attempts_blocked`
- `unsafe_host_action_attempts_blocked`
- `out_of_scope_network_attempts_blocked`

### Efficiency Metrics

- `wall_time_to_first_hypothesis`
- `wall_time_to_first_reproduction`
- `wall_time_to_first_verified_finding`
- `total_wall_time`
- `tokens_total`
- `tokens_input`
- `tokens_output`
- `tokens_cached`
- `estimated_cost`
- `tool_call_count`
- `failed_tool_call_count`
- `vm_minutes`
- `network_requests_allowed`
- `network_requests_blocked`

### Attempt Metrics

- `attempts_started`
- `attempts_completed`
- `attempts_failed`
- `attempts_promoted`
- `attempts_terminated`
- `pass_at_k` for benchmark-compatible tasks.
- `best_priority_by_k`
- `verified_findings_by_k`
- `cost_by_k`

## Primary Product Metrics

Primary product metrics:

- Time and cost to first verified finding.
- Verified findings per run.
- High-priority verified findings per run.
- False positive rate.
- Verifier success rate.
- Evidence completeness.
- Policy violations blocked.

Benchmark compatibility metrics:

- `pass_at_1`: compatibility only.
- `pass_at_k`: useful when paired with cost and attempts.
- `best_of_k_priority`: better for open-ended work.
- `verified_findings_by_k`: better for open-ended work.

## Same Model, Different Harness

CyberGym and similar benchmarks provide useful external reference points, but they do not replace Beale's own harness identity and run metadata.

Beale should record enough metadata to compare runs where the model is held constant and the harness changes.

Required run metadata:

- `model`
- `reasoning_effort`
- `harness_name`
- `harness_version`
- `prompt_version`
- `toolset_version`
- `verifier_version`
- `sandbox_backend`
- `sandbox_image_version`
- `network_profile`
- `attempt_strategy`
- `attempt_count`
- `task_subset_id`
- `task_ids`
- `benchmark_version`
- `date`
- `cost`
- `tokens`
- `wall_time`
- `pass_rate` where applicable.
- Numerator and denominator for sampled pass rates.
- Confidence interval or small-sample warning where applicable.

Primary same-model comparison should use Beale's internal metrics:

- Verified findings.
- High-priority verified findings.
- Evidence completeness.
- Verifier success.
- False positives.
- Cost.
- Wall time.
- Tool-call count.
- Policy violations blocked.

External benchmark pass rates are useful context, but they should not replace trace-backed in-Beale metrics.

## CyberGym Sampled Comparison

The full CyberGym suite is large and costly. Beale should use a stable small subset for frequent comparison.

Policy:

- Choose a fixed CyberGym subset, preferably stratified by project, language, and bug type.
- Assign a stable subset ID, such as `cybergym-l1-beale-smoke-25`.
- Record exact task IDs.
- Compare Beale results to published Codex CLI and OpenAI Agent results only when task level and trial conditions are compatible.
- Report sampled results as trend signals, not definitive leaderboard scores.

For sampled results, always report:

- Numerator and denominator, such as `8/25`.
- Pass percentage.
- Trial/attempt count.
- Task subset ID.
- Whether the sample was random, stratified, or curated.
- Cost and wall time.
- Small-sample uncertainty.

Full-suite benchmark runs should be rare and reserved for major evaluations.

## Internal A/B Harness Comparisons

Beale should support controlled A/B comparisons where the model and tasks stay fixed.

Hold constant:

- Model.
- Reasoning effort.
- Task subset.
- Attempt budget.
- Sandbox image.
- Network policy.
- Verifier contracts.

Vary one or a small number of harness dimensions:

- Prompt version.
- Tool schema.
- Tool output shape.
- Context packing strategy.
- Compaction strategy.
- Verifier strictness.
- Attempt strategy.

This answers whether a Beale harness change improved Beale behavior, independent of model upgrades.

## Attempt Strategy

Default attempt strategy: adaptive portfolio.

Beale should start with a small number of independent attempts, use them for orientation and hypothesis generation, then promote promising hypotheses to deeper investigation.

Default shape:

```text
adaptive_portfolio
  start 2-3 independent attempts
  collect cheap evidence
  deduplicate hypotheses
  score hypotheses
  promote promising paths
  allocate deeper budget
  require verifier before finding promotion
  stop or pause low-value attempts
```

Initial attempts should be cheap and broad. Deepened attempts should focus on PoC construction, debugger work, verifier contracts, artifact capture, and patch validation where relevant.

Promotion criteria:

- In-scope asset confirmed.
- Plausible attacker reachability.
- Plausible impact.
- Tool-backed observation.
- Novel hypothesis, not a duplicate.
- Clear verifier path.

Stop or pause criteria:

- Verified finding produced.
- No novel hypotheses.
- Repeated tool failures.
- Low confidence after budget.
- Duplicate of a stronger attempt.
- Policy issue.
- User stops, forks, or promotes manually.

Supported strategies:

- `single`: one attempt for cheapest interactive use.
- `fixed_k`: benchmark and calibration compatibility.
- `adaptive_portfolio`: default workbench strategy.
- `manual_fork`: user-driven exploration.
- `specialist_handoff`: later or per-task strategy when it clearly helps.

Non-default strategies:

- Fixed `k` independent runs are useful for benchmarking but wasteful as the default workbench behavior.
- Planner-plus-specialists can help specific workflows, but should not add default role bloat.
- Tournament-style promotion is better suited to advanced evaluation or many cheap attempts, not normal v1 interaction.

## Planning Consequence

The calibration suite should validate the actual workbench primitives, not a benchmark-only harness.

A calibration suite that is too large to run regularly is not useful for harness tuning.
