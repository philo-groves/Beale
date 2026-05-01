# Project Understanding and Indexing

Beale needs better project understanding than ad hoc `search` and `code_browser` calls. Recent agentic-search and repository-level retrieval work points toward a layered design: cheap exact retrieval first, structural understanding where possible, optional semantic search when the machine and privacy posture can support it, and an agentic query planner that iterates over results instead of trusting a single retrieval pass.

The goal is not to make Beale "know the whole project" in one opaque index. The goal is to give the research agent and the researcher reliable ways to answer questions such as:

- Which components exist in this target?
- Where does data enter, transform, cross trust boundaries, and reach sinks?
- What source, binary, web, artifact, trace, hypothesis, and finding records relate to this claim?
- What has already been explored, reproduced, dismissed, or verified?
- What should the agent read next without flooding context?

## Research Snapshot

Recent work and product systems converge on several lessons.

Agentic search is moving beyond one-shot retrieval. Search-o1 adds retrieval inside the reasoning loop and uses a document-analysis step before injecting retrieved material into reasoning. Mind2Web 2 evaluates long-horizon web search systems that browse, synthesize, and attribute sources over realistic tasks. "From Web Search towards Agentic Deep Research" frames search as a dynamic loop of planning, exploration, synthesis, and learning rather than a static ranked-results page.

Repository-level coding research shows the same pattern. SWE-Search applies tree search and iterative refinement to repository-level software tasks. Repository-level retrieval surveys and CodeRAG-style systems emphasize query construction, multi-path retrieval, reranking, and alignment between the retriever and the downstream model. GraphCodeAgent and CodexGraph show that graph structure can retrieve context that pure text or vector search misses.

Production developer tools also use hybrid context. GitHub reported a code/documentation embedding model for Copilot in VS Code that improves retrieval quality, throughput, and index size. Cursor indexes codebases for semantic search and uses hash/similarity machinery to avoid unnecessary reindexing. Sourcegraph Cody documents keyword search, Sourcegraph search, and code graph context, and its agentic context fetching uses reflection plus tools before final answer generation.

Security-specific evidence reinforces the need for cross-file and cross-resource context. Practical vulnerability detection benchmarks report that real bugs often require interprocedural analysis rather than isolated function review. Web vulnerability reproduction work shows current agents struggle with multi-component environments, authentication barriers, and incomplete setup guidance. Binary work continues to use embeddings and graphs for similarity search, especially when source is unavailable.

## Design Decision

Beale should build a scoped, local, multi-index project understanding service.

This should be an internal service used by existing tools first, not a new model-facing surface by default. The `search`, `code_browser`, and `resource_lookup` tools should become smarter as indexes become available. A future model-facing `project_map` or `context_lookup` tool can be considered only if the existing tool semantics become too overloaded.

The index should be program-scoped, local-first, and disposable with the program metadata. It should live under `.beale/`, never be mounted into a guest VM, and never cross workspace or program boundaries unless the user explicitly enables linked-program search later.

## Implementation Status

The first implementation covers Layer 0 and Layer 1:

- Program inventory records scoped local paths, directories, files, manifest files, binary files, hashes for small files, modification times, language guesses, and scope-asset linkage.
- Lexical and metadata search stores a scoped SQLite FTS document index for scope assets, inventory items, runs, transcripts, model-visible traces, artifacts, evidence, hypotheses, findings, verifier contracts, and verifier runs.
- The existing `search` tool still performs bounded scoped source and binary-string search, then augments results with project metadata matches from the FTS index.
- Inventory freshness is checked before metadata search by comparing indexed file and directory size/mtime metadata to the current scoped filesystem.
- Manifest indexing extracts structured dependency/package names for common package manifests such as `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, and `pom.xml`.
- Binary inventory indexing stores bounded strings output for small and medium binaries so metadata search can find symbols and crash markers without rereading every file.
- Source file body indexing remains intentionally bounded to direct `search` and `code_browser` reads; the inventory index stores file metadata and selected manifest/text/binary-string previews, not every source file body.

The second implementation starts Layer 2:

- Structural indexing records best-effort definitions, imports, exports, call sites, route declarations, route middleware/handler links, permission markers, sink markers, source line ranges, and simple relationships for cheap source languages.
- Structural entities are stored in normalized SQLite tables and mirrored into the existing metadata FTS index as `structure_entity` documents.
- This is intentionally parser-light for beta. Tree-sitter, language-server integration, deeper call/reference graphs, binary CFGs, and web route crawls remain future structural work.

## Index Layers

Beale should treat indexing as layered capability. Each layer has different cost, latency, and trust properties.

### Layer 0: Program Inventory

Always on.

Records:

- Scoped workspace directories and repository checkouts.
- File paths, sizes, modification times, hashes, language guesses, ignore status, and source asset linkage.
- Package manifests, lockfiles, build files, route/config files, API schema files, container files, CI files, mobile manifests, and dependency manifests.
- Imported binaries, APKs, archives, firmware images, generated artifacts, and verifier outputs.
- Known web hosts, base URLs, route maps, crawl snapshots, forms, endpoints, content types, authentication notes, and network policy decisions.
- Beale-native resources: traces, transcripts, artifacts, evidence, hypotheses, findings, verifier contracts, verifier runs, duplicate links, and compaction summaries.

Purpose:

- Fast target orientation.
- Detect stale indexes.
- Feed cheap query planning.
- Avoid asking the model to rediscover the project layout from scratch.

Cost:

- Low CPU and disk.
- Should run automatically on program open and file changes.

### Layer 1: Lexical and Metadata Search

Always on.

Backends:

- `ripgrep` or equivalent exact text search over scoped text.
- SQLite FTS for Beale resources, transcript text, artifact metadata, evidence summaries, hypotheses, findings, verifier metadata, route snapshots, and generated summaries.
- Binary-derived text search over strings, symbols, imports, exports, section names, dynamic-link metadata, Android manifest data, and decompiler output when available.

Purpose:

- High-precision lookup.
- Fast fallback on low-power systems.
- Deterministic traceability from query to files/resources.

Cost:

- Low to moderate depending on binary-derived text extraction.
- Suitable for default beta behavior.

### Layer 2: Structural Index

Default for source languages where cheap parsers are available. Best-effort elsewhere.

Backends:

- Tree-sitter or language-server symbol extraction.
- Definitions, references, imports, exports, class/function boundaries, route declarations, handlers, middleware chains, database models, serializers, deserializers, permission checks, and test ownership.
- For binaries: functions, basic blocks, call references, imported APIs, exported symbols, strings-to-function references, crash addresses, and decompiler/disassembly chunk IDs.
- For web targets: hosts, routes, forms, parameters, authentication state, observed requests/responses, JavaScript bundles, source maps, API schemas, and crawler provenance.

Purpose:

- Move from file search to relationship search.
- Let the agent ask for call sites, definitions, uses, route handlers, trust-boundary edges, and evidence-linked paths.
- Prevent the "file is too large, skip it" failure mode by exposing chunkable entities and ranges.

Cost:

- Moderate CPU and disk.
- Parser quality varies by language and build system.
- Should run incrementally and expose index freshness.

### Layer 3: Semantic Index

Feature-toggleable in beta. Recommended when system resources are adequate.

Backends:

- Embeddings over code chunks, doc chunks, generated summaries, binary-derived text, decompiler chunks, web snapshots, trace summaries, hypotheses, findings, and evidence.
- Separate embedding namespaces for code, natural language documentation, Beale research memory, binary-derived text, and web captures.
- Hybrid retrieval with lexical candidates plus vector candidates.
- Reranking before model-visible context is returned.

Purpose:

- Find conceptually relevant code when terms differ.
- Recover renamed or polyglot implementations.
- Surface prior research by meaning, not only exact title or CWE.
- Improve generated research prompts by finding underexplored surfaces and related historical evidence.

Cost:

- Higher CPU, memory, disk, and possible API cost depending on embedding provider.
- Potential privacy risk if remote embedding is used.
- Potential false positives and semantic drift.

Policy:

- Off by default for low-power mode.
- Local embedding provider preferred.
- Remote embedding requires explicit provider consent and a clear "indexed material leaves this machine" warning.
- Users can disable semantic indexing per program.

### Layer 4: Relationship Graph

Optional at first, but the likely long-term differentiator.

Graph nodes:

- Files, symbols, functions, classes, modules, endpoints, routes, forms, binaries, functions, strings, imports, packages, dependencies, commits, traces, transcripts, artifacts, evidence, hypotheses, findings, verifier contracts, verifier runs, CWE mappings, duplicate links, and user notes.

Graph edges:

- Defines, references, imports, calls, routes-to, middleware-before, parses, serializes, deserializes, checks-permission, reaches-sink, produced-artifact, supports-hypothesis, contradicts-hypothesis, verifies-finding, duplicates, supersedes, and belongs-to-program.

Purpose:

- Cross-resource reasoning.
- Variant search.
- Duplicate detection.
- Evidence trail navigation.
- "What else is reachable from this source/sink/finding?" workflows.

Cost:

- Moderate to high implementation complexity.
- Needs careful schema discipline to avoid becoming a dumping ground.
- Can begin as SQLite tables before requiring a graph database.

## Agentic Retrieval Loop

The index is not enough. Beale needs a retrieval loop that can decide what to search next.

Suggested flow:

1. Interpret the current research objective, selected session mode, program scope, prior hypotheses, and active evidence trail.
2. Build a query plan with lexical, metadata, structural, semantic, and graph subqueries.
3. Retrieve bounded candidates from each available layer.
4. Rerank candidates using source type, scope confidence, recency, evidence linkage, duplicate risk, and query relevance.
5. Return a compact explanation of why each candidate was selected.
6. Let `code_browser` or equivalent entity readers fetch exact bounded ranges.
7. Record retrieval provenance as trace events so the researcher can audit why context was shown.

This loop should remain deterministic enough to debug. The agent can suggest broader exploration, but Beale should own the scoped query execution, result bounds, and provenance.

## Scope Types

Project understanding must include more than source code.

### Source-Available Programs

Indexes should prioritize:

- Repository inventory.
- Source symbols and references.
- Route and API maps.
- Dependency and build graph.
- Tests and fixtures.
- Commit/PR history where locally available or explicitly authorized.
- Prior Beale research state for the same program.

### Binary and Mobile Programs

Indexes should prioritize:

- Binary metadata and hashes.
- Strings, imports, exports, symbols, sections, entitlements, manifests, permissions, URL schemes, IPC declarations, and package metadata.
- Decompiled or disassembled chunks with stable IDs.
- Function similarity and cross-binary relationships where available.
- Crash artifacts, debugger traces, sanitizer output, and verifier outputs.

Semantic indexing over raw binary-derived text can help, but structural records should remain authoritative because embeddings over decompiler text may blur critical low-level details.

### Web and Live-Target Programs

Indexes should prioritize:

- Allowed hosts and network profiles.
- Crawled route maps and endpoint observations.
- Forms, parameters, request/response schemas, status codes, content types, JavaScript bundle references, source maps, auth states, and cookies redacted to safe metadata.
- Scope decisions and blocked network attempts.
- Screenshots and browser observations when an in-agent browser exists.

The web index must be explicitly scoped and replay-aware. Live web content changes over time, so records need timestamps, request provenance, and scope-policy decisions.

### Beale Research Memory

Indexes should prioritize:

- Hypotheses, findings, evidence, verifier runs, artifacts, transcripts, trace events, duplicate links, compaction summaries, and user steering.
- State transitions and provenance edges.
- Prior dismissed paths and why they were dismissed.
- Prior verified/reportable findings to prevent duplicate creation.

This memory should feed prompt generation, duplicate checks, session search, and future "what should I look at next?" workflows.

## Feature Toggle and Performance Policy

Indexing should have a visible performance profile.

Recommended settings:

- `Project Understanding: Basic`: inventory, lexical search, SQLite FTS, and lightweight metadata. Default.
- `Project Understanding: Structural`: Basic plus source/binary/web structure extraction where available. Recommended default once stable.
- `Project Understanding: Semantic`: Structural plus embeddings and semantic reranking. Opt-in during beta.
- `Project Understanding: Full`: Semantic plus relationship graph expansion and deeper background indexing. Opt-in for powerful machines or long-running programs.

The UI should show:

- Index status per program.
- Last indexed time.
- Indexed resource counts.
- Failed indexers and recovery hints.
- Estimated disk size.
- Whether remote embedding is enabled.
- A pause/rebuild button.

Low-power systems should remain useful with Basic mode. Beale should not require semantic indexing for correct research behavior.

## Security and Privacy

Project indexes are sensitive because they can contain source, binary metadata, internal URLs, traces, possible zero-days, and disclosure drafts.

Rules:

- Store indexes locally under `.beale/`.
- Do not mount indexes into guest VMs.
- Do not sync indexes remotely.
- Do not perform cross-program search unless explicitly enabled later.
- Apply program scope before indexing and before retrieval.
- Treat web pages, source comments, README files, binary strings, and retrieved docs as untrusted prompt-injection surfaces.
- Keep raw credentials out of indexes. Store redacted metadata only.
- Preserve provenance so every model-visible context item can be traced to a file, artifact, web capture, or Beale resource.
- Make remote embedding opt-in and explicit.

## Tooling Implications

Short term:

- Improve `search` to return mixed results from source text, binary-derived text, web snapshots, Beale resources, and eventually index layers.
- Improve `code_browser` to read stable entity ranges, not only files and line numbers.
- Keep `resource_lookup` for exact Beale resource IDs.
- Record index hits and misses as trace events.

Medium term:

- Add an internal `ProjectUnderstandingService` with program-scoped index jobs.
- Add schema tables for inventory, document chunks, symbol records, route records, binary entities, web captures, and resource edges.
- Add a reranker that prefers scoped, recent, evidence-linked, structurally relevant results.
- Feed project-understanding summaries into context compaction.

Long term:

- Add graph-backed variant search.
- Add source-to-binary and web-to-source relationship edges.
- Add researcher-facing "why this context?" inspection.
- Consider a model-facing `project_map` tool only after the internal service has stable semantics.

## Non-Goals

- Global cross-workspace search in the first release.
- Remote codebase indexing by default.
- Treating embeddings as proof.
- Replacing exact source reads, debugger output, verifier runs, or artifacts with semantic summaries.
- Building a general enterprise code-search product.

## Open Questions

- Which local embedding model is accurate enough for security research without excessive memory cost?
- Should semantic indexing be per-program opt-in or per-provider opt-in?
- How much relationship graph can be derived cheaply from Tree-sitter before a language server is needed?
- Which binary analysis backend should produce stable function and chunk IDs first?
- Should web crawl snapshots be indexed automatically during live sessions or only after explicit researcher approval?
- How should index freshness affect agent confidence and trace labels?

## Sources

- Search-o1: Agentic Search-Enhanced Large Reasoning Models: https://arxiv.org/abs/2501.05366
- Mind2Web 2: Evaluating Agentic Search with Agent-as-a-Judge: https://arxiv.org/abs/2506.21506
- From Web Search towards Agentic Deep Research: https://arxiv.org/abs/2506.18959
- SWE-Search: Enhancing Software Agents with Monte Carlo Tree Search and Iterative Refinement: https://arxiv.org/abs/2410.20285
- Retrieval-Augmented Code Generation survey: https://arxiv.org/abs/2510.04905
- Knowledge Graph Based Repository-Level Code Generation: https://arxiv.org/abs/2505.14394
- CodeRAG for repository-level code completion: https://arxiv.org/abs/2509.16112
- GraphCodeAgent: https://arxiv.org/abs/2504.10046
- CodexGraph: https://arxiv.org/abs/2408.03910
- LLM Agents Improve Semantic Code Search: https://arxiv.org/abs/2408.11058
- GitHub Copilot embedding model for VS Code: https://github.blog/news-insights/product-news/copilot-new-embedding-model-vs-code/
- Cursor secure codebase indexing: https://cursor.com/blog/secure-codebase-indexing
- Sourcegraph Cody context and code graph docs: https://sourcegraph.com/docs/cody/core-concepts/context and https://sourcegraph.com/docs/cody/core-concepts/code-graph
- Sourcegraph agentic context fetching: https://sourcegraph.com/docs/cody/capabilities/agentic-context-fetching
- Practical vulnerability detection benchmark: https://arxiv.org/abs/2503.03586
- Web vulnerability reproduction agents: https://arxiv.org/abs/2510.14700
- Binary2vec: https://www.sciencedirect.com/science/article/pii/S2590005625001183
