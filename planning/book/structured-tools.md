# Structured Tools

Status: accepted initial direction, 2026-04-26.

## Decision

Beale's first model-facing structured research tool set should be minimal:

- `search`
- `code_browser`
- `resource_lookup`
- `python`
- `debugger`
- `artifact`
- `evidence`
- `hypothesis`
- `finding`
- `verifier`

Beale also exposes one setup tool:

- `source`

Shell remains available as an escape hatch, but the harness should guide the model toward structured tools when they produce better traces, safer execution, or clearer evidence.

Workspace setup is separate from the research evidence tool set. Cloning in-scope repositories, importing local target material, and copying material into a VM should use narrow Beale-managed workspace/import operations where possible.

## Rationale

Tool bloat causes inefficiency. It increases prompt/tool-selection overhead, makes traces harder to review, and can push the model into shallow tool hopping instead of focused investigation.

The v1 tool set should cover Beale's first-release scope without exposing every possible analysis tool directly to the model.

The model should be highly autonomous inside recorded scope. Beale should enforce hard trust boundaries mechanically and quietly, rather than repeatedly warning the model away from normal in-scope research work. Friction belongs at live-target networking, credential boundaries, workspace database exposure, verified-finding promotion, and the New Research Session warning when the selected sandbox is host execution.

The operating rule:

- `source` materializes scoped repositories into the workspace.
- `search` finds where to look.
- `code_browser` explains what is there.
- `resource_lookup` retrieves Beale run-state resources by id or query.
- `python` creates and mutates inputs.
- `debugger` observes runtime truth.
- `artifact` preserves evidence.
- `evidence` links observations into reusable evidence records.
- `hypothesis` records candidate vulnerability theories.
- `finding` records promoted vulnerability findings.
- `verifier` decides whether evidence is strong enough.

## Tool: `source`

Purpose:

- Materialize in-scope source repositories before source-backed analysis.

Capabilities:

- Validate that the requested repository URL or label is present in active program scope.
- Clone the repository into a Beale-managed workspace directory using a shallow host-side git operation.
- Add the local checkout as scoped source material for `search`, `code_browser`, host execution, VM import, and verifier setup.

The tool is host-safe setup, not target execution. It must not use host secrets. Build, test, mutation, sanitizer, debugger, and PoC execution run in the active session sandbox: host by default, VM when selected.

## Tool: `search`

Purpose:

- Fast orientation across source, binary-derived text, notes, and artifacts.

Backends may include:

- `ripgrep` for source and text artifacts.
- Strings extraction for binaries.
- Program inventory metadata for scoped paths, manifests, binaries, language guesses, file hashes, and scope assets.
- SQLite full-text search for workspace state, including runs, transcripts, model-visible traces, artifacts, evidence, hypotheses, findings, verifier contracts, and verifier runs.
- Structured dependency/package metadata extracted from common manifest files.
- Bounded binary-derived strings indexed from scoped binaries.
- Structural index records for best-effort definitions, imports, exports, call sites, route declarations, route middleware/handler links, permission markers, sink markers, mobile manifest records, web/API endpoint records, binary-derived URLs/symbols, source line ranges, and simple relationships.
- JS/TS AST-backed structural records for method definitions and call-site edges from the TypeScript compiler API.
- Parser-light Java and Go structural records for class/type/function/method ranges, imports, and owner-aware call-site edges.
- Framework-specific structural records for route/controller/model relationships, request parsing, response serialization, and model read/write edges where parser-light extraction can identify them.
- Binary graph records for imported symbols, exported symbols, notable strings, referenced URLs, and referenced permissions where bounded binary-string extraction can identify them.
- SQLite graph nodes and edges derived from scope assets, inventory items, structural entities, and structural relations.
- Per-program local semantic chunks for concept searches across indexed project metadata and Beale research memory, with identifier-aware tokenization and hybrid local reranking.
- Later indexed metadata from deeper references, call graphs, components, CVEs, CWEs, and notes as the structural and graph layers mature.

Expected outputs:

- Ranked matches.
- File or artifact references.
- Line/range references where available.
- Beale resource references for metadata matches.
- Dedupe between direct file/artifact matches and metadata matches for the same object.
- Semantic match scores, matched terms, rank reasons, score breakdowns, and source chunk metadata when semantic indexing is enabled.
- Graph status, counts, and capped graph neighborhoods for structural reads so graph-backed retrieval can be enabled without changing the model-facing tool surface.
- Graph-proximity search matches with seed entity, edge kind, graph distance, and rank reason when metadata or semantic hits have useful adjacent nodes.
- Graph-backed variant matches for entities that share relationship targets such as sinks, permission checks, middleware, binary imports/exports, referenced URLs/permissions, hypotheses, or findings.
- Binary graph neighborhoods for scoped binaries, including `imports_symbol`, `exports_symbol`, `contains_string`, `references_url`, and `references_permission` edge families.
- Research-memory graph links for components, CWE mappings, duplicate hypotheses/findings, evidence support, verifier outcomes, and artifact-producing traces.
- Graph operational diagnostics including stale reasons, rebuild reason, build count, expected node count, node/edge family counts, and extraction family counts.
- Code-to-research-memory graph variants when source-backed hits match component anchors from prior hypotheses or findings.
- Retrieval scores and ranking signals that show when graph seed or proximity influenced final search ordering.
- Internal search ranking uses a normalized retrieval candidate envelope across lexical, artifact, metadata, semantic, graph, and graph-variant sources before formatting model-facing matches.
- Two-phase retrieval that gathers broad normalized candidates first, then expands only top seeds through containing structure entities, binary inventory anchors, graph neighborhoods, and graph-backed variants.
- Blended retrieval scores with explicit `retrievalSignals` for text relevance, identifier/path matches, structural fit, semantic similarity, graph proximity, research-memory linkage, security relevance, scope confidence, and recency.
- Match context small enough for model use.

`search` should avoid dumping large files. It should point the model to precise next reads.

## Tool: `code_browser`

Purpose:

- Read and navigate source or decompiled/disassembled text in structured chunks.

Capabilities:

- Read file ranges.
- Continue through large files with explicit `line_start` / `line_end` chunks instead of abandoning the file.
- Summarize files or functions.
- Find definitions.
- Find references.
- Show call sites.
- Show nearby context.
- Present symbol summaries where available.
- Use structural index records for stable symbol ranges, nearby contained entities, outgoing relationships, and incoming references when available.

`code_browser` should be the preferred way to inspect source instead of broad shell commands like `cat`.
When a large file returns a truncated chunk, the model should continue with the returned next line rather than treating the file as unavailable.

## Tool: `resource_lookup`

Purpose:

- Retrieve current-run Beale resources by id or query without searching target source code for Beale-internal ids.

Capabilities:

- Look up artifacts, evidence, findings, hypotheses, verifier runs, verifier contracts, and trace events.
- Return current-run metadata, relationships, and read hints.
- Direct the model to use `code_browser` with a Beale artifact id when artifact content should be inspected.

`resource_lookup` is not cross-workspace or cross-program search. It exists to keep the model from confusing Beale state identifiers, such as `verifier_run_*` or `artifact_*`, with target repository symbols.

## Tool: `python`

Purpose:

- Lightweight analysis, parsing, mutation, input generation, and corpus work.

Capabilities:

- Run small scripts in the active session sandbox.
- Generate PoC inputs.
- Mutate structured formats.
- Parse logs and traces.
- Minimize or transform crash inputs.
- Perform local calculations and quick experiments.

Execution is on the host in default sessions and inside the guest VM when `local_disposable_vm` is selected.

Python outputs should be captured as trace events, with generated files preserved through the `artifact` tool when relevant.

## Tool: `debugger`

Purpose:

- Runtime truth for source and binary research.

Capabilities:

- Launch under debugger.
- Attach where policy allows.
- Set breakpoints.
- Continue, step, and interrupt.
- Inspect stack, registers, threads, locals, and memory.
- Capture crash context.
- Use watchpoints or conditional breakpoints where supported.
- Rerun with mutated inputs.

Debugger observations are evidence candidates. They must be stored as tool-backed trace events, not only summarized in model prose.

The debugger tool should abstract over backend-specific tools where possible, but v1 can start with a narrow implementation for the active sandbox.

Debugger access should be wrapper-first rather than raw PTY-first. The model should call structured operations such as setting breakpoints, continuing execution, reading registers, inspecting stack frames, reading memory, and capturing crash context.

Raw debugger transcripts may still be preserved as artifacts for audit, but they should not be the primary state model.

## Tool: `artifact`

Purpose:

- Preserve evidence and generated research outputs.

Artifact types:

- PoC scripts.
- Inputs and corpora.
- Crash files.
- Logs.
- Debugger transcripts.
- Screenshots.
- Patches and diffs.
- Binary metadata.
- Reproduction bundles.

Artifacts are collected from the active sandbox through Beale-controlled channels, stored in the workspace artifact store, and referenced by content hash and metadata in SQLite.

The model should not treat stdout as durable evidence when an artifact is more appropriate.

## Tool: `evidence`

Purpose:

- Link artifacts, trace observations, and verifier runs to hypotheses or findings.

Capabilities:

- Create reusable evidence records from artifact ids.
- Create evidence records from non-model trace events.
- Create evidence records from verifier runs.
- Attach evidence to a hypothesis, finding, or both.

Evidence records must not be backed only by model prose. A model message can explain why evidence matters, but the evidence record itself should point to a tool, artifact, or verifier observation.

## Tool: `hypothesis`

Purpose:

- Create or update candidate vulnerability theories during model-led research.

Capabilities:

- Store title, description, affected component, bug class, state, CWE mappings, and scoring factors.
- Keep hypotheses visible to compaction, UI triage, and later verifier work.
- Preserve the distinction between a model-proposed theory and an observed target behavior.

Hypotheses are not findings. User-provided claims and model reasoning can seed hypotheses, but Beale should not treat them as observations until tool, artifact, or verifier evidence exists.

The model should include a primary CWE when the weakness class is clear, alternate CWE candidates when ambiguity is useful, and `needs_classification` when uncertain. CWE guides triage but does not make a hypothesis evidence-backed.

## Tool: `finding`

Purpose:

- Create or update vulnerability findings after a hypothesis has enough evidence to be worth triage.

Capabilities:

- Store summary, affected assets, affected versions, impact, state, CWE mappings, and priority.
- Link findings to hypotheses and evidence.
- Promote a finding to `verified` only when a passing real verifier run is supplied.
- Promote a finding to `reportable` only when the behavior is verified and reachability/exploitability are certain enough for disclosure review.

Finding records may be model-proposed, reproduced, verified, reportable, or disclosure-ready. The verified and reportable states remain gated by the verifier service.

Findings approaching disclosure should have a primary CWE mapping unless classification is explicitly unresolved. The mapping should be specific, evidence-consistent, and included in exports as classification rather than proof.

## Tool: `verifier`

Purpose:

- Convert hypotheses into validated findings or failed hypotheses.

Capabilities:

- Run a declared reproduction contract.
- Compare expected and actual behavior.
- Validate crash or sanitizer signals.
- Validate that a PoC triggers the target condition.
- Validate patch behavior when a candidate fix exists.
- Produce structured pass/fail/inconclusive results with logs and artifact links.

`verifier` is the promotion gate. A finding should not become verified solely because the model explains it convincingly.

## Non-Model-Facing in v1

These capabilities may exist internally, as profiles, or as later additions, but they should not be exposed as separate first-release model tools.

| Capability | v1 treatment | Reason |
| --- | --- | --- |
| AST index | Internal backend for `code_browser` | Useful, but not a separate model-facing tool unless needed. |
| Sanitizer runner | Verifier or execution profile | Important for memory corruption, but best expressed as validation config. |
| Coverage | Later or verifier profile | Useful for audit completeness, but not essential for the first credible loop. |
| Fuzzer | Later or advanced profile | Powerful but expensive and workflow-heavy. Needs strong artifact and snapshot support first. |
| Static analyzer | Later advisory tool | Noisy early and can distract from evidence-backed research. |

## Shell

Shell remains available because vulnerability research needs flexibility.

Rules:

- Prefer structured tools when they cover the task.
- Use shell inside the active sandbox for target setup, uncommon tooling, package commands, and one-off operations.
- Shell runs on the host in default sessions and inside the guest VM when VM isolation is selected.
- Shell output should be summarized and artifact-backed when it becomes evidence.
- Shell is not a replacement for `artifact` or `verifier`.

Host shell is not the setup primitive. Host-side cloning, import, and read-only preparation should flow through Beale-managed workspace operations with scope checks and trace events.

## Interactive Programs

Interactive programs should be modeled as dedicated structured tools when they are part of Beale's planned core workflow.

Initial policy:

- Wrap debuggers.
- Wrap any other first-release planned tool that needs ongoing interactive state.
- Keep raw PTY/shell as a fallback for setup, uncommon tools, and exploratory one-offs.

Reasons:

- Structured wrappers reduce ambiguity in prompts, screens, paging, and partial output.
- They produce cleaner trace events.
- They make evidence and state transitions easier to verify.
- They let Beale attach policy metadata to operations.
- They reduce the chance that model prose is confused with actual observations.

Wrapper tools should still preserve enough raw output as artifacts for audit and debugging.

Beale should not wrap every interactive program in v1. The wrapper approach is for high-value stateful workflows where structured observations materially improve research quality.

## Output Handling

Rule:

Store structured results in the trace, summarize large or noisy output for model context, and preserve anything evidence-relevant as an artifact.

### Storage Classes

`trace_structured`:

- Always stored.
- Small, queryable, event-oriented.
- Contains tool name, inputs, status, timestamps, execution context, and key structured results.

`model_summary`:

- Redacted and size-bounded.
- Used to continue the agent run.
- Links back to trace events and artifacts when available.

`raw_artifact`:

- Content-addressed file in the workspace artifact store.
- Used for evidence, audit, replay, and reports.
- May be sensitive and hidden from the model by default.

`derived_artifact`:

- Normalized or transformed output.
- Examples: minimized PoC, parsed crash summary, decompiled function text, report excerpt.

### Tool-Specific Policy

`search`:

- Trace query, filters, result count, and ranked matches.
- Show concise top results with path, range, and snippet.
- Store raw artifact only when the result set supports a report or needs reproducibility.

`code_browser`:

- Trace requested file, symbol, range, and returned content hash.
- Show exact selected source or decompiled range within bounded size.
- Store artifact when source snapshot, decompiler output, or annotated excerpt becomes evidence.

`python`:

- Trace script hash, arguments, exit code, stdout/stderr summary, and created files.
- Show concise stdout/stderr summary and important structured output.
- Store artifacts for generated PoCs, crash inputs, corpus mutations, large logs, parsed results, or scripts used as evidence.

`debugger`:

- Trace operation, target process, stop reason, frame/thread/register summary, memory references, and crash signal.
- Show structured debugger state.
- Store artifacts for transcripts, crash traces, backtraces, register dumps, memory dumps, screenshots, reproduction sessions, or debugger scripts when evidence-relevant.

`artifact`:

- Trace artifact ID, hash, type, sensitivity, provenance event, and storage metadata.
- Show metadata and safe preview or summary.
- The raw artifact is the durable object.

`verifier`:

- Trace contract ID, target states, verdict, expected observations, and invariant results.
- Show structured verdict and concise failure reasons.
- Store artifacts for logs, before/after outputs, verifier transcripts, and evidence bundles.

`shell`:

- Trace command, cwd, VM/host location, exit code, duration, and stdout/stderr summary.
- Show summary plus limited head/tail when useful.
- Store artifacts for build logs, test logs, crash logs, generated files, or command transcripts that support evidence.

### General Rules

- Small structured outputs go in the trace.
- Large outputs become artifacts with summaries.
- Evidence-relevant outputs become artifacts even if small.
- Secret-bearing outputs are redacted before model visibility.
- Target-controlled text is untrusted and labeled as such.
- Raw artifacts are immutable and content-addressed.
- Summaries must link back to raw artifact IDs when raw data exists.
- Verifier-required evidence should reference raw artifacts or structured verifier outputs, not only model summaries.

## Planning Consequence

The v1 harness should optimize these six tools deeply instead of adding many shallow tools. Each tool needs a clear schema, trace representation, policy metadata, error model, and artifact behavior.
