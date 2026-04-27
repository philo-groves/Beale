# Beale Research Workspace

This directory tracks research and planning for Beale: an Electron GUI application with a rebuilt vulnerability-research agent harness.

Status: planning book and first implementation direction, created 2026-04-26.

## Files

- `book/SUMMARY.md`: chaptered planning table of contents.
- `book/`: product direction, harness architecture, data model, GUI, roadmap, and first vertical slice docs.
- `research/source-index.md`: primary sources, what they contribute, and why they matter for Beale.
- `research/harness-findings.md`: synthesized harness design implications from the sources.
- `research/open-questions.md`: resolved planning decisions and follow-up research items.

## Initial Thesis

The harness is a first-class capability lever. Current cyber-agent results show that model choice is only one variable; tool interfaces, verifier design, sandbox topology, attempt strategy, context handling, and trace observability can change measured performance by large margins.

The next development step should implement the first vertical slice: workspace creation, program scope, run tracker, persisted trace, and fake agent/executor events.

## Product Direction

Beale is an authorized vulnerability research workbench. Benchmark runner functionality exists only to validate workbench behavior and monitor regressions or improvements.
