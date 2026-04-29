# Open-Ended Discovery Scoring

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should score open-ended discoveries as evidence-backed triage priority, not as benchmark truth.

There is no ground truth for unknown vulnerabilities during open-ended research. Scoring should quantify the quality and priority of a finding using:

- Attacker reachability.
- User or system impact.
- Evidence confidence.
- Exploit practicality.
- Scope confidence.

Finding state remains separate from score.

## Finding State vs Priority Score

Finding state answers: what is the current validation status?

Suggested states:

- `hypothesis`
- `needs-evidence`
- `reproduced`
- `verified`
- `patched`
- `dismissed`
- `out-of-scope`

Priority score answers: how important is this finding to investigate or report?

A high-impact claim with weak evidence should not outrank a modest but verifier-backed bug.

## Attacker Reachability

How realistically can an attacker trigger the vulnerable path?

Suggested scale:

- `0`: not reachable or only local developer/internal-only with no security boundary.
- `1`: requires privileged local access or unusual setup.
- `2`: requires authenticated low-privilege access or user interaction.
- `3`: reachable by normal remote/authenticated users.
- `4`: remotely reachable pre-authentication or from a broad untrusted input boundary.

## Impact

What can the attacker achieve?

Suggested scale:

- `0`: no meaningful security impact.
- `1`: low-impact crash, noise, or info leak with limited consequence.
- `2`: denial of service, limited data exposure, or low-integrity violation.
- `3`: sensitive data exposure, authorization bypass, significant integrity break, or reliable service compromise.
- `4`: code execution, sandbox escape, privilege escalation, credential compromise, cross-tenant impact, or broad compromise.

## Evidence Confidence

How well has Beale demonstrated the finding?

Suggested scale:

- `0`: hypothesis only.
- `1`: plausible code path or static evidence.
- `2`: controlled local reproduction or strong dynamic evidence.
- `3`: reliable PoC with verifier-backed reproduction.
- `4`: verifier-backed reproduction plus affected-version, patch, or regression validation.

Evidence confidence should gate the score. Without evidence, a finding remains a hypothesis.

## Exploit Practicality

How hard is it to weaponize or trigger consistently?

Suggested scale:

- `0`: not exploitable in practice.
- `1`: fragile, narrow, or environment-specific.
- `2`: moderate constraints.
- `3`: reliable under realistic conditions.
- `4`: reliable and easy to trigger.

## Scope Confidence

Is the target/context actually in scope and correctly modeled?

Suggested scale:

- `0`: unknown or out of scope.
- `1`: likely in scope but incomplete context.
- `2`: in-scope asset confirmed.
- `3`: in-scope plus affected version or configuration confirmed.
- `4`: in-scope plus realistic deployment or user context confirmed.

## Priority Formula

Initial formula:

```text
priority = evidence_confidence * (attacker_reachability + impact + exploit_practicality + scope_confidence)
```

This makes evidence confidence a multiplier. A finding with no evidence cannot score high, even if the alleged impact is severe.
Each input is clamped to `0-4`, so the host-derived priority range is `P0` through `P64`.
Model-provided priority scores are not trusted; models provide the factor labels, and Beale computes and stores the score.

Example:

```text
pre-auth RCE claim, no PoC:
  reachability = 4
  impact = 4
  exploit_practicality = 3
  scope_confidence = 3
  evidence_confidence = 1
  priority = 14

authenticated logic bug with verifier-backed PoC:
  reachability = 2
  impact = 3
  exploit_practicality = 3
  scope_confidence = 3
  evidence_confidence = 3
  priority = 33
```

The second finding should be prioritized higher because it is better proven.

## Benchmark and Regression Metrics

For open-ended discovery regression tracking, aggregate metrics should include:

- Verified findings.
- High-priority verified findings.
- Median evidence confidence.
- False positive rate after human or verifier review.
- Time to verified finding.
- Cost to verified finding.
- Coverage of attack-surface or hypothesis areas.
- Duplicate finding rate.
- Dismissed and out-of-scope rate.

These metrics monitor workbench behavior without pretending there is complete ground truth.

## Planning Consequence

The GUI should make both validation state and priority score visible.

The model can propose severity, but Beale should tie scoring inputs to evidence, scope, artifacts, verifier results, and human review.
