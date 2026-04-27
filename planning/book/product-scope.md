# Product Scope

Status: accepted initial direction, 2026-04-26.

## Primary Product

Beale is an authorized vulnerability research workbench.

The product should optimize for real defensive workflows:

- Understanding a target's architecture, trust boundaries, and threat model.
- Forming and testing vulnerability hypotheses.
- Producing concrete evidence: traces, PoCs, crashes, sanitizer output, exploit preconditions, affected versions, and impact.
- Validating patches and regressions.
- Supporting human steering, review, and responsible disclosure workflows.

## Benchmark Runner Role

The benchmark runner is not the product center.

It exists to validate the workbench:

- Detect regressions in harness behavior, tool design, prompts, model adapters, and verifier contracts.
- Measure improvements under controlled conditions.
- Compare model and harness configurations without redefining Beale as an eval leaderboard product.
- Provide calibration tasks before broader authorized research runs.

Benchmark functionality must reuse the same workbench primitives used in real research. If benchmark mode requires a special harness that does not represent user-facing behavior, it is no longer serving its purpose.

## Product Boundary

Beale should prefer workbench features over benchmark-only features when priorities conflict.

Examples:

- A trace UI that helps a researcher audit evidence is more important than a leaderboard view.
- Verification contracts should produce useful finding states, not only pass/fail scores.
- Sandboxing should protect local users and target owners first; benchmark isolation is a specific use of the same safety model.
- Metrics should include validity, evidence quality, patch safety, cost, and time, not only pass@k.

## Non-Goals

- Public benchmark leaderboard as a first-order goal.
- Autonomous scanning of targets without explicit authorization.
- Optimizing for CTF-only workflows at the expense of real codebase research.
- Accepting model-written claims as findings without tool-backed evidence.

## Planning Consequence

All later architecture decisions should be tested against this question:

Does this make Beale a better authorized vulnerability research workbench, or only a better benchmark harness?

The first release should optimize for open-ended discovery. Targeted reproduction and patch validation are still required, but they serve as evidence and remediation workflows inside the larger discovery process.
