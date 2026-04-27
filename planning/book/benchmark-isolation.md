# Benchmark Isolation

Status: accepted initial direction, 2026-04-26.

## Decision

Benchmark isolation is separate from normal user workflow.

For benchmarks, Beale should build on benchmark infrastructure such as CyberGym's Docker-based environment.

Benchmark mode should run the agent harness in its own Docker container, while the grader runs on the host side with one-way communication from agent output to grader input.

Regular authorized research remains VM-based and should not be affected by benchmark-specific isolation choices.

## Rationale

Benchmark mode has different priorities than normal workbench mode:

- Reproducibility.
- Anti-cheating.
- Clean scoring.
- Controlled task inputs.
- Reduced accidental leakage from evaluation ground truth.

The benchmark runner exists to validate workbench behavior and monitor regressions/improvements. It is not the primary product workflow.

## Benchmark Topology

Proposed topology:

```text
Host
  benchmark runner
  grader
  ground truth
  expected outputs
  result collector

Docker container
  Beale agent harness
  model proxy client
  benchmark-facing workspace
  task materials allowed for the agent
```

The agent container receives only benchmark-allowed materials.

The grader has access to ground truth and scoring logic that the agent cannot read.

## Host-Side Model/Auth Proxy

Benchmark mode should protect OpenAI OAuth credentials with a host-side proxy.

Topology:

```text
Host
  OpenAI OAuth/session storage
  model/auth proxy
  benchmark runner
  grader

Docker container
  Beale agent harness
  model proxy client
```

Rules:

- OpenAI OAuth tokens and credential-store access stay on the host.
- The agent container never receives long-lived OpenAI credentials.
- The container talks to the host proxy through a narrow local API for model requests and streamed model events.
- The proxy enforces benchmark budget, model, reasoning effort, rate limits, and allowed request shape.
- The proxy does not expose grader files, ground truth, host filesystem access, shell execution, or host secrets.
- The proxy records model request metadata in the benchmark result without logging secret values.

This keeps benchmark scoring isolated while avoiding the weaker pattern of copying OAuth material into the agent container.

## Communication Model

Communication should be one-way for grading:

1. Benchmark runner starts the agent container with allowed task inputs.
2. Agent container produces candidate outputs, artifacts, or reports.
3. Host-side benchmark runner collects those outputs.
4. Host-side grader evaluates the outputs.
5. Grader writes benchmark results outside the agent container.

The agent should not be able to call, inspect, modify, or infer grader internals.

## Anti-Hacking Requirements

Benchmark mode should enforce:

- No grader files mounted into the agent container.
- No ground-truth files mounted into the agent container.
- No Docker socket in the agent container.
- No host workspace secrets in the agent container.
- No OpenAI OAuth credentials or credential-store mounts in the agent container.
- No arbitrary host filesystem mounts.
- Network policy stricter than authorized project mode.
- Deterministic task input packaging.
- Output collection through explicit directories or artifact channels.
- Container image and harness version recorded with the result.

## Relationship to CyberGym

CyberGym already uses Docker for benchmark infrastructure. Beale should integrate with that reality instead of forcing the normal VM workbench model onto benchmark evaluation.

The Dockerized benchmark agent harness is an evaluation containment strategy, not a change to the normal Beale sandbox design.

## Grader Isolation

The grader can run on the host for benchmark mode.

This is acceptable because:

- The grader is trusted benchmark infrastructure.
- The agent container is untrusted with respect to benchmark scoring.
- One-way output flow prevents direct grader manipulation.
- Host-side grading keeps ground truth outside the agent environment.

## Planning Consequence

Benchmark mode should have a separate execution topology:

- Normal workbench: trusted host harness controls disposable VMs.
- Benchmark mode: host benchmark runner controls a Dockerized agent harness and host-side grader.

Both modes should share as many workbench primitives as practical, but benchmark anti-cheating requirements are allowed to impose extra containment around the agent itself.
