# First Release Mode

Status: accepted initial direction, 2026-04-26.

## Decision

Beale's first release should optimize for open-ended discovery.

Targeted reproduction and patch validation remain essential, but they are supporting workflows inside the larger discovery loop. They are how Beale turns hypotheses into evidence and validated fixes, not the primary product frame.

## Rationale

The product is an authorized vulnerability research workbench. Most real vulnerability research programs start from broad, open-ended investigation:

- Map the target's architecture, exposed interfaces, privileges, trust boundaries, and data flows.
- Identify high-risk components and security-sensitive code paths.
- Generate and prune vulnerability hypotheses.
- Build targeted experiments to confirm or falsify promising hypotheses.
- Reproduce confirmed issues with concrete evidence.
- Validate fixes and regressions after disclosure or remediation.

If v1 optimizes only for known-bug reproduction, Beale risks becoming a benchmark harness or triage assistant rather than a research workbench.

## First-Release Product Shape

The first release should make open-ended research credible by giving users:

- A target setup flow that records authorization, scope, environment, and network policy.
- A threat model and attack-surface workspace.
- A hypothesis board with states, evidence links, and affected components.
- Structured tools for code search, code nav, execution, debugging, and artifact capture.
- A trace timeline that separates model claims from real tool observations.
- A verifier workflow for promoting hypotheses into reproduced findings.
- Patch validation as a follow-on workflow after reproduction.

## Supporting Modes

Open-ended discovery needs two supporting modes from the start:

- Targeted reproduction: turn a promising hypothesis, suspicious code path, bug report, crash, or partial lead into a concrete reproducer.
- Patch validation: check whether a candidate fix blocks the reproduced issue and preserves expected behavior.

These modes should share the same trace, tool, sandbox, artifact, and finding model as discovery mode.

## Cost

Prioritizing open-ended discovery increases the first-release scope:

- Verification is harder because there is no fixed ground truth for unknown issues.
- Stopping criteria are ambiguous.
- False positives become a product risk, not just an evaluation artifact.
- The GUI must support maps, hypotheses, evidence review, and steering, not only task logs.
- The harness needs coverage-oriented behavior so it does not stop after the first plausible issue.
- Safety and authorization boundaries need to be first-class from day one.

## Risk Control

The first release should constrain open-ended discovery without abandoning it:

- Require explicit authorization and scope before target work starts.
- Start with local or user-provided targets, not arbitrary live scanning.
- Treat unverified findings as hypotheses until tool-backed evidence exists.
- Promote findings only through verifier-backed reproduction.
- Use benchmark tasks only as regression tests for the same discovery primitives.
- Include reproduction and patch validation because they provide objective quality gates.

## Planning Consequence

The core design question becomes:

How do we help a researcher move from broad authorized exploration to evidence-backed findings without losing auditability, safety, or verification discipline?
