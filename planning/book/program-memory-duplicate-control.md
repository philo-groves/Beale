# Program Memory and Duplicate Control

Status: proposed design direction, 2026-04-29.

## Decision

Beale should treat hypotheses and findings as program-wide research memory, not only session-local records.

When the agent proposes a new hypothesis or finding, Beale should check prior work for the same research program before creating another record. Duplicate control should happen in two places:

- Before a model-proposed claim becomes a hypothesis.
- Before a reproduced or verified claim becomes a finding.

The goal is not to suppress useful follow-up research. The goal is to prevent the agent from rediscovering the same confirmed issue as if it were new, while preserving valid variants, chains, and new evidence.

Core rule:

```text
Same program + same underlying weakness + same affected surface = duplicate.
Same weakness class on a meaningfully different surface, attacker path, or impact = variant or related lead.
New evidence for an existing issue should strengthen the existing record rather than create a duplicate.
```

## Rationale

Open-ended research sessions naturally revisit promising areas. This is useful when the agent is deepening evidence, testing exploit chains, or looking for variants. It is wasteful when the agent creates a new hypothesis or finding for a bug that was already confirmed earlier in the same program.

Without program-wide duplicate control, Beale risks:

- Inflating the finding list with repeated records.
- Making session heat look more severe than the underlying research state.
- Spending model and VM time reproducing already-known behavior.
- Losing useful evidence because it is attached to the wrong duplicate.
- Confusing the researcher during disclosure export.
- Training the prompt generator to chase already-exhausted surfaces.

The product should remember what has already been tried, dismissed, reproduced, verified, and disclosed for a program.

## Non-Goals

Duplicate control is not:

- A replacement for evidence or verifier gates.
- A reason to mark a finding verified.
- A global cross-customer vulnerability database.
- A cloud sync feature.
- A plagiarism or bug-bounty duplicate decision.
- A semantic embedding requirement for v1.
- A reason to hide historical work from the researcher.

Beale should only compare records inside the same configured research program unless the user explicitly links programs later.

## Claim Identity

Beale needs a stable way to compare vulnerability claims.

A claim identity should be based on the underlying security behavior, not on the exact text the model used. Titles are weak signals because the same issue can be described many ways.

Useful identity fields:

- Program ID.
- Affected asset, host, package, repository, app, endpoint, path, class, function, or component.
- CWE mapping.
- Plain-English bug class.
- Security mechanism involved, such as authorization, authentication, trust boundary, parser, deserializer, command execution, storage, logging, or transport.
- Attacker position and required privileges.
- Impact shape, such as account takeover, cross-tenant access, sensitive data exposure, command execution, policy bypass, or denial of service.
- Evidence signature when available, such as verifier ID, artifact hash, PoC behavior, vulnerable call path, stack trace, or reproducer summary.
- Scope state at the time of observation.

Weak signals:

- Similar title alone.
- Same CWE alone.
- Same severity alone.
- Same source file alone.
- Same broad subsystem alone.

Beale should build an internal claim fingerprint from normalized deterministic fields first. Optional model adjudication can help with ambiguous cases, but the default path should not require model review or OpenAI credentials.

## Duplicate Classes

Duplicate review should produce one of a small set of outcomes.

| Outcome | Meaning | Default behavior |
| --- | --- | --- |
| `new_claim` | No meaningful match found. | Create the hypothesis or finding. |
| `duplicate` | Same underlying weakness on the same affected surface. | Do not create a new record; link new evidence to the existing record. |
| `variant` | Same weakness pattern, different affected surface or exploit path. | Create a related hypothesis or finding with a relationship to the original. |
| `chain_candidate` | The claim may combine with prior findings into a larger exploit chain. | Create or update a lead linked to the prior records. |
| `ambiguous` | Deterministic signals conflict or are incomplete. | Ask for stricter model or user adjudication before finding creation; allow low-cost hypothesis only when useful. |

For v1, `duplicate` can be represented as a state plus trace relationship. `variant` and `chain_candidate` can initially be trace/payload relationships if a first-class relationship table is deferred.

## Pre-Hypothesis Gate

Before creating a hypothesis from the structured `hypothesis` tool, Beale should compare the proposed claim against prior hypotheses and findings for the same program.

The gate should consider:

- Active, reproduced, verified, disclosure-ready, duplicate, dismissed, and false-positive records.
- Current session records.
- Prior session records.
- Program scope and affected asset.
- CWE and bug class.
- Component and attack surface.
- Description and impact.

If a high-confidence duplicate is found, Beale should not create a new hypothesis. Instead, the tool should return a model-visible result that names the prior record and suggests useful next actions:

```text
This appears to duplicate finding finding_123. Do not create a new hypothesis.
Useful next steps: add new evidence to the existing finding, test a variant on a different asset, or investigate whether this chains with another record.
```

The trace should record the blocked duplicate attempt as a `hypothesis_event` or dedicated duplicate-review event, with the proposed title, matched record ID, outcome, and rationale.

This gives the agent immediate feedback before it spends another branch reproducing old work.

## Pre-Finding Sanity Gate

Before creating a finding or auto-promoting a reproduced hypothesis into a finding, Beale should run a stricter duplicate check against existing findings for the same program.

The finding gate should be stricter than the hypothesis gate because findings affect disclosure, exports, heat, and researcher trust.

If the proposed finding duplicates an existing finding:

- Do not create a second finding.
- Attach new evidence, artifacts, or verifier runs to the existing finding when appropriate.
- Update the existing finding's summary or impact only if the new information is materially better.
- Record a trace event explaining the merge.
- Return the existing finding ID to the model.

If the proposed finding is a variant:

- Create a new finding only when the affected surface, exploit path, or impact is meaningfully distinct.
- Link it to the prior finding as a variant.
- Preserve separate evidence chains.

If the proposed finding is ambiguous:

- Prefer blocking automatic finding creation.
- Keep or create a hypothesis if continued investigation is useful.
- Ask the agent to gather discriminating evidence, such as exact endpoint, account boundary, vulnerable call path, or verifier output.

## Evidence Handling

New evidence should not be discarded just because a claim is duplicate.

Duplicate handling should preserve:

- Tool outputs.
- Artifacts.
- Verifier runs.
- Reproduction steps.
- Affected asset refinements.
- Scope observations.
- Impact refinements.

When evidence strengthens an existing finding, Beale should link it to the existing finding and add trace provenance. The researcher should be able to see that the agent revisited the issue and contributed something useful, even though no new finding was created.

## Data Model

The first implementation can avoid a large schema migration by deriving duplicate candidates from existing program, run, hypothesis, finding, evidence, artifact, CWE, and trace records.

Suggested later tables:

- `claim_fingerprints`
- `claim_relationships`
- `duplicate_reviews`

`claim_fingerprints` should store normalized comparison data:

- `id`
- `program_id`
- `entity_kind`: `hypothesis` or `finding`
- `entity_id`
- `asset_key`
- `component_key`
- `mechanism_key`
- `cwe_ids_json`
- `bug_class_key`
- `attacker_position_key`
- `impact_key`
- `evidence_signature_json`
- `fingerprint_hash`
- `created_at`
- `updated_at`

`claim_relationships` should link related records:

- `id`
- `program_id`
- `source_entity_kind`
- `source_entity_id`
- `target_entity_kind`
- `target_entity_id`
- `relationship`: `duplicate`, `variant`, `chain_candidate`, `supersedes`, `evidence_for`
- `rationale_markdown`
- `source`: `system`, `model`, or `user`
- `created_at`

`duplicate_reviews` should preserve review decisions:

- `id`
- `program_id`
- `run_id`
- `attempt_id`
- `proposed_entity_kind`
- `proposed_claim_json`
- `matched_entity_kind`
- `matched_entity_id`
- `outcome`
- `confidence`
- `rationale_markdown`
- `created_trace_event_id`
- `created_at`

For v1, the same shape can live in trace event payloads until a dedicated table is justified.

## Matching Strategy

Duplicate matching should be conservative.

Suggested deterministic stages:

1. Normalize obvious identifiers: domains, URLs, paths, package names, repo-relative file paths, class names, function names, endpoints, and mobile bundle IDs.
2. Normalize weakness class: CWE IDs, bug class, security mechanism, and attacker position.
3. Normalize impact: data exposed, boundary crossed, privilege gained, code executed, or policy bypassed.
4. Compare against prior program records with weighted scoring.
5. Require strong surface and mechanism agreement for automatic duplicate blocking.
6. Treat uncertain matches as `ambiguous`, `variant`, or `chain_candidate`, not as duplicates.

Examples:

- Same endpoint + same authorization bypass + same victim boundary: duplicate.
- Same endpoint + different authorization boundary or privilege level: ambiguous or variant.
- Same CWE on different in-scope endpoint: variant, not duplicate.
- Same vulnerable helper function reached through a new external surface: variant or chain candidate.
- Same title with different asset and impact: new claim or ambiguous.

## Tool Contract

The `hypothesis` and `finding` tools should return duplicate-review information in their payloads.

Suggested payload fields:

- `duplicateReview.outcome`
- `duplicateReview.confidence`
- `duplicateReview.matchedEntityKind`
- `duplicateReview.matchedEntityId`
- `duplicateReview.relationship`
- `duplicateReview.rationale`
- `duplicateReview.recommendedNextAction`

When creation is blocked, the tool result should use `status: "success"` with a clear duplicate outcome rather than a hard tool error. The model did nothing invalid; Beale is redirecting it to better program-aware behavior.

Hard errors should remain reserved for malformed input, unknown referenced IDs, verifier violations, or policy violations.

## Prompt Behavior

The model should be instructed to use duplicate-review feedback.

Rules:

- Do not create a new hypothesis or finding after Beale reports a high-confidence duplicate.
- Add evidence to the matched record when the new work improves proof.
- Investigate variants only when the affected surface, attacker path, or impact differs.
- Investigate chains when the duplicate record can combine with another finding or hypothesis.
- When Beale reports ambiguity, gather discriminating evidence rather than renaming the same claim.

The prompt generator for new research sessions should also use program memory:

- Avoid already verified or disclosure-ready findings unless the goal is chaining, patch validation, or report preparation.
- Avoid dismissed and duplicate areas unless the user asks to revisit them.
- Prefer underexplored high-value surfaces and weakness classes.
- Prefer variants of strong findings only when the affected surface is meaningfully different.

## Trace And UI

Duplicate review should be visible but not noisy.

Trace events should record:

- Proposed claim title.
- Proposed affected surface.
- Matched record IDs.
- Outcome.
- Confidence.
- Rationale.
- Whether creation was blocked, linked, or allowed.

The UI should show duplicate relationships where they help the researcher:

- Finding detail: "Also observed in session X" or "Merged evidence from session Y."
- Hypothesis detail: "Blocked as duplicate of finding Z."
- Trace modal: duplicate-review decision and matched fields.
- Program history: quiet duplicate/variant relationship markers.

The main hypothesis and finding lists should not become cluttered with every duplicate attempt. They should show durable research records, while trace preserves the decision trail.

## Relationship To Session Heat And Momentum

Duplicate blocked claims should not increase session heat.

New evidence attached to an existing high-severity finding can keep heat high, but it should not look like a new independent vulnerability.

Research momentum can reflect useful duplicate handling:

- Reviewing prior records: `exploring`.
- Adding evidence to an existing finding: `building` or `verifying`.
- Repeatedly proposing blocked duplicates without new evidence: `stuck`.

## Implementation Order

Suggested implementation sequence:

1. Add deterministic duplicate candidate lookup across prior records for the same program.
2. Add pre-hypothesis duplicate review in the structured `hypothesis` tool.
3. Add pre-finding duplicate review in the structured `finding` tool and auto-promotion path.
4. Link duplicate evidence to existing findings instead of creating a second finding.
5. Emit trace events for duplicate decisions.
6. Surface duplicate-review details in trace modals.
7. Add optional relationship tables when trace payloads are no longer enough.
8. Add optional model adjudication for ambiguous duplicate reviews.

The first useful slice should block obvious duplicates and redirect the agent to add evidence, test variants, or investigate chains.

## Open Questions

- Should Beale expose a first-class "related records" UI before relationship tables exist?
- Should duplicate-review thresholds be configurable per program?
- Should imported external reports seed program memory as hypotheses, candidate findings, or evidence?
- Should disclosure exports include duplicate-review history by default, or only when it clarifies evidence provenance?
- How should Beale handle the same vulnerability across multiple separately configured programs owned by the same organization?
