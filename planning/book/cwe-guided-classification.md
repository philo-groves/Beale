# CWE-Guided Classification

Status: accepted design direction, 2026-04-28.

## Decision

Beale should use CWE as a first-class classification layer for hypotheses and findings.

CWE should help the agent and researcher focus on security-sensitive weaknesses instead of merely interesting software behavior. It should shape prioritization, filtering, export, and steering, but it should not replace evidence, verifier results, scope checks, or human review.

The core rule:

- CWE classification guides research.
- Evidence and verifier-backed observations decide finding state.

## Rationale

Open-ended vulnerability research produces many suspicious leads. Some are meaningful security bugs; others are reliability issues, implementation quirks, dead code, unreachable paths, or clever but non-reportable observations.

CWE gives Beale a shared vocabulary for security weakness classes. It helps the model ask better follow-up questions:

- Is this behavior crossing an authorization boundary?
- Is this input reaching a command, parser, template, path, or deserializer?
- Does this state transition map to a recognized weakness pattern?
- Is there a realistic attacker capability and security impact?
- Is this finding reportable under the active program scope?

This keeps Beale aligned toward vulnerabilities that matter to security teams and bug bounty reviewers.

## Non-Goals

CWE is not:

- Proof that a vulnerability exists.
- A replacement for evidence records.
- A replacement for verifier contracts.
- A severity score.
- A CVE assignment.
- A reason to promote a model claim into a finding.
- A mandatory label when the correct mapping is uncertain.

Beale should allow `unknown` or `needs_classification` rather than forcing a bad CWE mapping.

## Source of Truth

Beale should use the official MITRE CWE catalog as the source of truth:

- CWE home: https://cwe.mitre.org/
- CWE data downloads: https://cwe.mitre.org/data/index.html
- CWE View-1003, Weaknesses for Simplified Mapping of Published Vulnerabilities: https://cwe.mitre.org/data/slices/1003.html

The local Beale catalog should be bundled or cached so normal research sessions do not depend on live network access.

The first implementation can ship a bundled View-1003 seed containing common security-research CWE entries, with the schema designed for a full MITRE catalog import later.

Catalog metadata should record:

- Source URL.
- CWE catalog version.
- Import timestamp.
- View or slice used for mapping.
- Entry mapping status where available.

Beale should prefer View-1003 for vulnerability-style mapping because it is designed for simplified mapping of published vulnerabilities.

## Data Model

`bug_class` should remain Beale's plain-English product taxonomy. CWE should be stored separately as structured weakness mapping data.

Suggested tables:

- `cwe_catalogs`
- `cwe_entries`
- `weakness_mappings`

`cwe_entries` should store local catalog records:

- `cwe_id`
- `name`
- `abstraction`
- `status`
- `description`
- `parent_ids_json`
- `view_ids_json`
- `mapping_status`
- `catalog_version`

`weakness_mappings` should link CWE entries to Beale research objects:

- `id`
- `entity_kind`: `hypothesis` or `finding`
- `entity_id`
- `cwe_id`
- `cwe_name`
- `mapping_role`: `primary` or `alternate`
- `mapping_status`: `allowed`, `discouraged`, `prohibited`, `unknown`
- `confidence`: `low`, `medium`, `high`
- `rationale_markdown`
- `source`: `model`, `user`, `import`, or `system`
- `created_at`
- `updated_at`

There may be many candidate mappings for a hypothesis. A promoted or disclosure-ready finding should have one primary mapping unless classification is explicitly unresolved.

## Agent Behavior

The model should propose CWE mappings when it creates or updates hypotheses and findings.

Instructions should emphasize:

- Prefer the most specific appropriate CWE.
- Avoid category-only CWE IDs when a more precise child weakness is known.
- Do not invent CWE IDs.
- Use `unknown` or `needs_classification` when uncertain.
- Revise CWE mappings as evidence changes.
- Keep alternate CWE candidates when ambiguity is useful for review.
- Preserve dismissed hypothesis mappings for coverage and future avoidance.

Initial deterministic hints can help the model orient:

| Bug family | Candidate CWE IDs |
| --- | --- |
| Missing authorization | CWE-862 |
| Incorrect authorization | CWE-863 |
| IDOR / user-controlled key authorization | CWE-639 |
| OS command injection | CWE-78 |
| Command injection family | CWE-77 |
| SQL injection | CWE-89 |
| Code injection | CWE-94 |
| Path traversal | CWE-22 |
| SSRF | CWE-918 |
| Sensitive information exposure | CWE-200 |
| Permissive CORS | CWE-942 |
| Unsafe deserialization | CWE-502 |

These hints are not exhaustive and should not override the official catalog.

## Tool Contract

The `hypothesis` and `finding` tools should accept CWE mapping fields in addition to existing title, description, bug class, state, evidence, and scoring fields.

Suggested fields:

- `primary_cwe_id`
- `primary_cwe_name`
- `alternate_cwe_ids_json`
- `cwe_mapping_confidence`
- `cwe_mapping_rationale`

For hypotheses, CWE can be speculative.

For findings, CWE should become stricter as the finding approaches disclosure:

- `model_proposed`: optional primary or alternate CWE.
- `needs_evidence`: optional primary or alternate CWE.
- `reproduced`: primary CWE preferred.
- `disclosure_ready`: primary CWE required unless explicitly waived.
- `verified`: still requires verifier-backed evidence; CWE alone is not enough.

## Research Flow

CWE should improve research flow in three places.

First, during orientation, Beale can steer the agent toward known security weakness patterns that are relevant to the target's attack surface.

Second, during hypothesis triage, CWE helps distinguish security-sensitive ideas from ordinary implementation oddities.

Third, during report preparation, CWE gives the researcher and recipient a familiar classification with a short rationale.

The agent should not chase CWE coverage mechanically. Coverage is useful only when it maps to reachable, in-scope, security-relevant surfaces.

## UI Behavior

Hypotheses and findings should show CWE mappings as compact pills.

Suggested UI behavior:

- Show the primary CWE beside the hypothesis or finding title.
- Use a tooltip for CWE name, confidence, mapping status, and rationale.
- Show alternate CWE candidates in the Inspector.
- Make CWE values clickable/copyable where references are shown.
- Allow filters for CWE, bug class, `needs CWE`, and mapping confidence.
- Preserve muted CWE labels for dismissed hypotheses so researchers can understand explored areas.

The Hypotheses and Findings panels should use CWE as a skimming aid, not as visual noise. If the mapping is unknown, the UI should show that quietly rather than forcing a placeholder into every row.

## Prompt Generation

The New Research Session prompt generator should use CWE history to avoid shallow repetition.

It should consider:

- Program description.
- Program scope and rules.
- Existing hypotheses.
- Existing findings.
- Dismissed or exhausted CWE areas.
- CWE families with weak or no coverage on high-value surfaces.

When prior research is thin, the generator should prefer broadly useful security-sensitive areas for the selected program type. When prior research is rich, it should look for underexplored weakness classes or opportunities to chain existing findings.

## Export and Disclosure

Finding exports should include CWE mapping data:

- Primary CWE ID.
- CWE name.
- Mapping confidence.
- Mapping rationale.
- Alternate CWE candidates when relevant.

The exported report should make clear that CWE is classification, not proof. Evidence records, artifacts, reproduction steps, and verifier results remain the substance of the report.

## Compaction and Trace

Context compaction should preserve active CWE mappings for hypotheses and findings.

Trace events should be emitted when:

- A primary CWE is assigned.
- A primary CWE changes.
- A mapping is marked uncertain, discouraged, or prohibited.
- A finding becomes disclosure-ready with a primary CWE.

The trace should summarize mapping changes without flooding the transcript with catalog text.

## Implementation Plan

1. Add a pinned local CWE catalog seed and catalog metadata.
2. Add `cwe_entries` and `weakness_mappings` persistence.
3. Extend shared types for hypothesis and finding CWE mappings.
4. Extend `hypothesis` and `finding` tool schemas.
5. Update model instructions to prefer specific, evidence-consistent CWE mappings.
6. Add UI pills, Inspector details, and filters.
7. Include CWE mappings in finding exports.
8. Add tests for mapping persistence, tool validation, UI rendering, export output, and verifier-state gating.
9. Add a full MITRE catalog import path when Beale needs broader offline CWE coverage.

## Security and Trust Invariants

CWE-guided classification must preserve Beale's existing security model:

- User-provided vulnerability claims seed hypotheses; they are not target observations by themselves.
- Findings require tool, artifact, or verifier-backed evidence.
- `verified` requires a passing real verifier.
- Program scope and active network policy remain authoritative.
- CWE labels must not cause out-of-scope testing.
- The workspace database remains host-owned and is never mounted into the guest.

## Planning Consequence

Beale should treat CWE as an evidence-adjacent research index.

It should help the agent pursue reportable security weaknesses, help the researcher skim and filter work, and help exported findings speak the language of security triage. It should never become a shortcut around the evidence graph or verifier gate.
