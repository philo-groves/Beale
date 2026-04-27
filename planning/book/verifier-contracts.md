# Verifier Contracts

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should generalize CyberGym-style pre/post-patch checks as structured differential verifier contracts over named target states.

CyberGym's pattern is a useful special case:

```text
known_vulnerable: trigger condition expected
known_fixed: trigger condition not expected
```

Real-world work needs a broader model because arbitrary repos may have no patch, no known fixed version, multiple configurations, or only a suspected candidate fix.

## Target States

A verifier can run against one or more named target states:

- `baseline`: current checkout, build, binary, or service state.
- `candidate_patch`: user or agent-produced patch.
- `known_vulnerable`: historical version, old release, pre-fix commit, or vulnerable binary.
- `known_fixed`: patched version, new release, post-fix commit, or fixed binary.
- `latest`: current upstream or latest available binary.
- `configured_variant`: same target under different config, feature flag, platform, dependency, or runtime condition.

Target states should be explicit, reproducible, and artifact-backed where possible.

## Verifier Shapes

### Single-State Reproduction

Use when no patch or alternate version exists.

Goal:

- Show the issue triggers on one scoped target state.

Evidence can include:

- Crash.
- Sanitizer finding.
- Authorization bypass.
- Incorrect state transition.
- Data exposure.
- Unexpected privilege or capability.

This proves reproduction, not fix correctness.

### Patch Validation

Use when a candidate patch exists.

Goal:

- PoC triggers on baseline.
- PoC does not trigger on candidate patch.
- Regression or invariant checks still pass.

This is the closest real-world equivalent to pre/post verification.

### Historical Differential

Use when a known fix commit, release, or CVE patch exists.

Goal:

- PoC triggers on pre-fix state.
- PoC does not trigger on post-fix state.
- Optionally verify latest state.

This supports variant analysis and benchmark-like tasks.

### Version or Config Differential

Use when vulnerability depends on configuration, feature flags, platform, dependency versions, or deployment shape.

Goal:

- Trigger under affected condition.
- Avoid trigger under unaffected condition.

This is important for logic bugs and real deployment behavior.

### Patch Candidate Search

Use when Beale proposes a fix.

Goal:

- Baseline triggers.
- Candidate does not trigger.
- Existing tests or invariants pass.
- Optional targeted negative tests pass.

Passing this contract means the candidate passed the verifier. It does not prove the bug is fully fixed in all possible contexts.

## Task Mode Defaults

Every task mode must have at least one verifier contract. Discovery contracts can begin as hypothesis checks, but promotion to finding requires tool-backed observations, and promotion to verified finding requires a verifier result.

### Open-Ended Discovery

Open-ended discovery verifier contracts can start narrow and become stronger as evidence improves.

Minimum contract:

- Target state: `baseline`.
- Goal: confirm or falsify one hypothesis.
- Expected observation: one concrete observable security failure.
- Required artifact: evidence bundle.
- Required result: `pass`, `fail`, or `inconclusive`.

Example expected observations:

- Low-privilege account accesses a resource it should not.
- Crafted input crashes with sanitizer or debugger context.
- Invalid state transition occurs.
- Scoped test marker or protected data becomes observable.

Discovery verifiers prove the issue exists on the current target state. They do not require a patch.

### Targeted Reproduction

Targeted reproduction verifier contracts should be stricter because the task starts from a specific report, crash, suspicious behavior, or suspected bug.

Minimum contract:

- Target state: `baseline` or `known_vulnerable`.
- Setup steps: exact environment, version, and configuration.
- Trigger steps: PoC or manual reproduction steps.
- Expected observation: report-specific failure signal.
- Artifacts: PoC, logs, debugger trace, screenshots where relevant.
- Pass criteria: bug reproduced reliably.

Optional target states:

- `latest`: check whether the latest version is still affected.
- `known_fixed`: check a known fix when available.

Targeted reproduction answers: can Beale reproduce the described issue?

### Patch Validation

Patch validation verifier contracts should always be differential.

Minimum contract:

- Target states: `baseline` and `candidate_patch`.
- Trigger steps: PoC or regression check.
- Expected baseline observation: vulnerable behavior occurs.
- Expected patched observation: vulnerable behavior no longer occurs.
- Invariants: relevant tests or smoke checks still pass.
- Artifacts: patch, verifier output, before/after logs.

Patch validation answers: did the patch block the reproduced issue without obviously breaking expected behavior?

### Variant Analysis

Variant analysis verifier contracts should usually be historical, version-based, or config-based differentials.

Minimum contract:

- Seed state: `known_vulnerable`, `known_fixed`, patch, diff, or report.
- Target state: `baseline` or `latest`.
- Expected observation: analogous bug class exists or does not exist in the target.
- Evidence: code path similarity plus dynamic confirmation where possible.
- Artifacts: seed reference, candidate path, PoC/check, verifier output.

Variant analysis answers: does this known bug class or patch pattern recur somewhere else?

Variant analysis may create multiple child hypotheses. Each child hypothesis should get its own reproduction verifier.

### Benchmark Mode

Benchmark mode should not invent a separate verifier model.

It should wrap the relevant task mode and add grader isolation.

Examples:

- CyberGym wraps targeted reproduction with `known_vulnerable` and `known_fixed`.
- Patch benchmarks wrap patch validation.
- Open-ended benchmarks wrap discovery plus external human or grader review.

Benchmark grading is separate from the verifier contract, but should reference verifier outputs and artifacts where possible.

## Contract Schema

Verifier contracts should be declared artifacts, not hidden prompt instructions.

Conceptual schema:

```text
verifier_contract
  id
  target_states[]
  setup_steps
  trigger_steps
  expected_observations[]
  invariants[]
  artifacts_to_collect[]
  pass_criteria
```

The model may propose verifier contracts, but Beale should store them as structured definitions that users can inspect, edit, rerun, and cite.

## Expected Observations

Expected observations may include:

- Process exits with signal.
- Sanitizer reports a vulnerability class.
- Debugger reaches a crash site.
- HTTP response or state transition proves an authorization bypass.
- File or database state changes incorrectly.
- Secret or test marker becomes observable.
- Log or event appears.
- PoC output matches expected result.
- Verifier script returns success.

Expected observations must map to trace events, artifacts, or verifier outputs.

## Invariants

Invariants can include:

- Unit tests pass.
- Integration smoke tests pass.
- Service starts and responds.
- Unaffected behavior still works.
- Exploit no longer triggers.
- Sanitizer is clean for targeted run.
- Regression corpus does not introduce new crashes.

Invariants prevent "fixes" that only hide the PoC while breaking expected behavior.

## Patch Validation Invariants

Patch validation should separate security invariants from behavior-preservation invariants.

The exploit failing is necessary, but not sufficient. A patch can appear to fix a bug by breaking the feature, rejecting all input, crashing earlier, disabling a parser, or hiding the signal.

### Mandatory for Every Patch Validation

Exploit or PoC fails:

- Crash no longer occurs.
- Unauthorized access no longer succeeds.
- Secret or test marker no longer leaks.
- Invalid state transition no longer happens.
- Dangerous write or execution path is no longer reachable.

Expected behavior still works:

- Valid file still parses.
- Authorized user can still access their object.
- Legitimate protocol flow still completes.
- Normal command still produces expected output.
- Service still accepts valid requests.

Build or runtime health:

- Build succeeds.
- CLI exits correctly for smoke command.
- Service starts.
- Health endpoint responds.
- No immediate crash loop.
- Logs do not show fatal startup errors.

### Mandatory When Applicable

Existing tests pass:

- Unit tests.
- Relevant package or module tests.
- Targeted regression tests.
- Existing security tests.

Sanitizer or runtime diagnostics are clean:

- ASan no longer reports the targeted invalid read/write/use-after-free.
- UBSan no longer reports the targeted undefined behavior.
- Valgrind or similar no longer reports the targeted issue.
- Debugger no longer captures the fault.

This should be scoped to the targeted run. Global sanitizer cleanliness is usually too expensive for v1.

Regression corpus passes:

- Seed corpus still parses.
- Known-good samples still succeed.
- Minimized crash input no longer crashes.
- Related malformed inputs do not expose a new crash.
- Protocol replay corpus still works.

Negative or abuse cases are rejected safely:

- Invalid input returns a controlled error.
- Unauthorized request returns a deny response.
- Oversized input is bounded.
- Bad state transition is rejected.
- The process does not crash while rejecting.

### Optional or Advanced

Performance and resource bounds:

- PoC no longer causes an infinite loop.
- Valid input does not become extremely slow.
- Memory use stays bounded for tested cases.
- Timeout does not regress significantly.

Compatibility and deployment invariants:

- Default config works.
- Relevant feature flag modes work.
- Supported platform or build profile still works.
- Dependency version constraints still work.

## Patch Validation Result Fields

Patch verifier output should be more specific than pass/fail:

```text
blocked_issue: yes | no | inconclusive
behavior_preserved: yes | no | inconclusive
diagnostics_clean: yes | no | not_applicable | inconclusive
regression_tests: pass | fail | not_run
overall: pass | fail | inconclusive
```

Rule:

A patch is validated only when the reproduced issue no longer triggers and at least one relevant behavior-preservation invariant passes. Strong validation adds tests, runtime health, sanitizer diagnostics, regression corpus, and safe rejection checks as applicable.

## Promotion Rule

A verifier result can promote a hypothesis or finding only when:

- The verifier contract is stored.
- The target states are identified.
- The expected observations are trace-backed.
- Artifacts are captured.
- The pass/fail/inconclusive result is recorded.

Model confidence alone is not a verifier result.

Cross-mode flow:

```text
discovery -> hypothesis verifier -> finding
reproduction -> reproduction verifier -> reproduced finding
patch validation -> differential verifier -> patched or failed patch
variant analysis -> child reproduction verifiers -> findings
benchmark -> mode verifier + isolated grader
```

## Planning Consequence

Beale should treat verification as a structured, rerunnable contract system.

Pre/post-patch is one verifier shape, not the root abstraction.
