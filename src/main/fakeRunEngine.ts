import type { CreatedRunContext, WorkspaceDatabase } from './database';
import { defaultHypothesisFactors, priorityFactorLabels, scorePriority, verifiedFindingFactors } from './discoveryScoring';
import type { FakeScenario, StartRunInput } from '@shared/types';
import { generateSessionTitle } from '../shared/sessionTitle';

type ScenarioStep = (context: CreatedRunContext) => void;

interface ScheduledRun {
  context: CreatedRunContext;
  scenario: FakeScenario;
  nextIndex: number;
  timer: NodeJS.Timeout | null;
}

const STEP_DELAY_MS = 850;

export class FakeRunEngine {
  private readonly scheduledRuns = new Map<string, ScheduledRun>();

  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly onChange: () => void = () => undefined
  ) {}

  public startRun(input: StartRunInput, mode: 'scheduled' | 'complete' = 'scheduled'): CreatedRunContext {
    const scope = this.db.getActiveScope();
    const context = attachDatabase(this.db.createRun({
      scopeVersionId: scope.id,
      title: generateSessionTitle(input.promptMarkdown),
      promptMarkdown: input.promptMarkdown,
      mode: input.mode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attemptStrategy: input.attemptStrategy,
      networkProfile: input.networkProfile,
      sandboxProfile: input.sandboxProfile,
      targetAssetId: input.targetAssetId,
      targetPath: input.targetPath,
      budget: { ...input.budget, fakeScenario: input.fakeScenario, runEngine: 'fake' }
    }), this.db);

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'user_note',
      source: 'user',
      summary: 'Run started from markdown prompt.',
      payload: {
        promptMarkdown: input.promptMarkdown,
        mode: input.mode,
        attemptStrategy: input.attemptStrategy
      }
    });
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'vm_event',
      source: 'executor',
      summary: 'Fake executor allocated a simulated disposable VM context.',
      payload: {
        executor: 'fake',
        targetExecution: false,
        boundary: 'No target code, build scripts, PoCs, tests, fuzzing, or debugger sessions executed.'
      },
      vmContextId: context.vmContext.id
    });
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: 'Simulated model planned an open-ended discovery pass.',
      payload: {
        claimStatus: 'hypothesis_seed',
        model: input.model,
        reasoningEffort: input.reasoningEffort
      }
    });

    if (mode === 'complete') {
      this.emitRemaining(context, input.fakeScenario);
      this.onChange();
    } else {
      this.schedule(context, input.fakeScenario);
    }

    return context;
  }

  public pause(runId: string): void {
    const scheduled = this.scheduledRuns.get(runId);
    if (scheduled?.timer) {
      clearTimeout(scheduled.timer);
      scheduled.timer = null;
    }
  }

  public resume(runId: string): void {
    const scheduled = this.scheduledRuns.get(runId);
    if (scheduled) {
      this.scheduleNext(scheduled);
    }
  }

  public stop(runId: string): void {
    this.pause(runId);
    this.scheduledRuns.delete(runId);
  }

  public dispose(): void {
    for (const scheduled of this.scheduledRuns.values()) {
      if (scheduled.timer) {
        clearTimeout(scheduled.timer);
      }
    }
    this.scheduledRuns.clear();
  }

  public emitRemaining(context: CreatedRunContext, scenario: FakeScenario): void {
    for (const step of getSteps(scenario)) {
      step(context);
    }
  }

  private schedule(context: CreatedRunContext, scenario: FakeScenario): void {
    const scheduled: ScheduledRun = {
      context,
      scenario,
      nextIndex: 0,
      timer: null
    };
    this.scheduledRuns.set(context.run.id, scheduled);
    this.scheduleNext(scheduled);
  }

  private scheduleNext(scheduled: ScheduledRun): void {
    const steps = getSteps(scheduled.scenario);
    const run = this.db.getRun(scheduled.context.run.id);
    if (!run || run.status !== 'active') {
      return;
    }
    if (scheduled.nextIndex >= steps.length) {
      this.scheduledRuns.delete(scheduled.context.run.id);
      return;
    }

    scheduled.timer = setTimeout(() => {
      const latestRun = this.db.getRun(scheduled.context.run.id);
      if (!latestRun || latestRun.status !== 'active') {
        scheduled.timer = null;
        return;
      }
      const step = steps[scheduled.nextIndex];
      scheduled.nextIndex += 1;
      step(scheduled.context);
      this.onChange();
      this.scheduleNext(scheduled);
    }, STEP_DELAY_MS);
  }
}

function getSteps(scenario: FakeScenario): ScenarioStep[] {
  switch (scenario) {
    case 'source_logic_bug':
      return sourceLogicBugSteps();
    case 'memory_corruption':
      return memoryCorruptionSteps();
    case 'policy_block':
      return policyBlockSteps();
    case 'verified_finding':
      return verifiedFindingSteps();
    case 'adaptive_portfolio':
    default:
      return adaptivePortfolioSteps();
  }
}

function recordModel(context: CreatedRunContext, summary: string, payload: Record<string, unknown> = {}): void {
  contextDb(context).appendTraceEvent({
    runId: context.run.id,
    attemptId: context.attempt.id,
    type: 'model_message',
    source: 'model',
    summary,
    payload: {
      claimStatus: 'model_claim',
      ...payload
    }
  });
}

function recordAdaptivePortfolioBranches(context: CreatedRunContext): void {
  const db = contextDb(context);
  const branches = [
    { role: 'parser_memory_safety', state: 'Cheap parser and crash-surface orientation completed.' },
    { role: 'authorization_review', state: 'Cheap authorization and tenant-boundary orientation completed.' }
  ];
  for (const branch of branches) {
    const attempt = db.createAttempt({
      runId: context.run.id,
      parentAttemptId: context.attempt.id,
      status: 'completed',
      shortState: branch.state,
      strategyRole: branch.role,
      vmState: 'destroyed',
      vmMetadata: {
        executor: 'simulated',
        targetExecution: false,
        adaptivePortfolioBranch: true
      }
    });
    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: attempt.id,
      type: 'user_note',
      source: 'system',
      summary: `Adaptive portfolio branch recorded: ${branch.role}.`,
      payload: {
        strategy: 'adaptive_portfolio',
        parentAttemptId: context.attempt.id,
        branchRole: branch.role
      },
      vmContextId: attempt.vmContextId
    });
  }
}

function recordTool(
  context: CreatedRunContext,
  toolName: string,
  input: Record<string, unknown>,
  resultSummary: string,
  result: Record<string, unknown>
): string {
  const db = contextDb(context);
  const toolCallId = db.createToolCall({
    runId: context.run.id,
    attemptId: context.attempt.id,
    toolName,
    toolVersion: 'fake-v1',
    input,
    status: 'completed',
    resultSummary,
    result,
    vmContextId: context.vmContext.id
  });
  db.appendTraceEvent({
    runId: context.run.id,
    attemptId: context.attempt.id,
    type: 'tool_call',
    source: 'model',
    summary: `Requested ${toolName}.`,
    payload: input,
    toolCallId,
    vmContextId: context.vmContext.id
  });
  const resultEvent = db.appendTraceEvent({
    runId: context.run.id,
    attemptId: context.attempt.id,
    type: 'tool_result',
    source: 'tool',
    summary: resultSummary,
    payload: {
      toolName,
      observationBacked: true,
      ...result
    },
    toolCallId,
    vmContextId: context.vmContext.id
  });
  db.linkToolCallTrace(toolCallId, resultEvent.id);
  return toolCallId;
}

function recordArtifact(
  context: CreatedRunContext,
  name: string,
  content: string,
  metadata: Record<string, unknown>,
  source = 'vm_export'
): string {
  const db = contextDb(context);
  const artifact = db.createArtifact({
    kind: metadata.kind ? String(metadata.kind) : 'evidence',
    mimeType: 'text/plain',
    sensitivity: 'internal',
    modelVisible: true,
    source,
    metadata: { name, fake: true, ...metadata },
    content
  });
  const event = db.appendTraceEvent({
    runId: context.run.id,
    attemptId: context.attempt.id,
    type: 'artifact_created',
    source: 'tool',
    summary: `Artifact recorded: ${name}.`,
    payload: {
      name,
      sha256: artifact.sha256,
      source,
      observationBacked: true
    },
    artifactId: artifact.id,
    vmContextId: context.vmContext.id
  });
  db.setArtifactProvenance(artifact.id, event.id);
  return artifact.id;
}

function recordHypothesis(context: CreatedRunContext, title: string, component: string, bugClass: string, description: string): string {
  const db = contextDb(context);
  const factors = defaultHypothesisFactors(hypothesisKind(bugClass));
  const labels = priorityFactorLabels(factors);
  const hypothesis = db.createHypothesis({
    runId: context.run.id,
    state: 'needs_evidence',
    title,
    descriptionMarkdown: description,
    component,
    bugClass,
    priorityScore: scorePriority(factors),
    attackerReachability: labels.attackerReachability,
    impact: labels.impact,
    evidenceConfidence: labels.evidenceConfidence,
    exploitPracticality: labels.exploitPracticality,
    scopeConfidence: labels.scopeConfidence
  });
  const event = db.appendTraceEvent({
    runId: context.run.id,
    attemptId: context.attempt.id,
    type: 'hypothesis_event',
    source: 'system',
    summary: `Hypothesis created: ${title}.`,
    payload: {
      hypothesisId: hypothesis.id,
      title,
      impact: hypothesis.impact,
      observationSource: 'tool_results'
    }
  });
  db.setHypothesisTrace(hypothesis.id, event.id);
  return hypothesis.id;
}

function recordVerifier(
  context: CreatedRunContext,
  hypothesisId: string | null,
  status: string,
  summary: string,
  result: Record<string, unknown>
): string {
  const db = contextDb(context);
  const contract = db.createVerifierContract({
    runId: context.run.id,
    hypothesisId,
    mode: 'reproduction',
    status: 'approved',
    targetStates: { vmContextId: context.vmContext.id },
    setupStepsMarkdown: 'Use simulated target state from the fake executor.',
    triggerStepsMarkdown: 'Replay the deterministic fake trigger.',
    expectedObservations: result,
    invariants: { noHostExecution: true },
    artifactsToCollect: { trace: true, artifacts: true },
    passCriteria: { status }
  });
  recordTool(
    context,
    'verifier',
    { contractId: contract.id, mode: contract.mode },
    summary,
    { contractId: contract.id, status, ...result }
  );
  const verifierRun = db.createVerifierRun({
    contractId: contract.id,
    runId: context.run.id,
    attemptId: context.attempt.id,
    vmContextId: context.vmContext.id,
    status,
    blockedIssue: status === 'pass' ? 'yes' : status === 'fail' ? 'no' : 'inconclusive',
    behaviorPreserved: 'not_applicable',
    diagnosticsClean: status === 'pass' ? 'yes' : 'inconclusive',
    regressionTests: 'not_run',
    result: { realExecution: false, vmExecution: false, simulated: true, ...result }
  });
  db.appendTraceEvent({
    runId: context.run.id,
    attemptId: context.attempt.id,
    type: 'verifier_result',
    source: 'verifier',
    summary,
    payload: {
      verifierRunId: verifierRun.id,
      contractId: contract.id,
      status,
      observationBacked: true,
      ...result
    },
    vmContextId: context.vmContext.id
  });
  return verifierRun.id;
}

function finishRun(context: CreatedRunContext, status: 'completed' | 'blocked', summary: string, attemptState: string): void {
  const db = contextDb(context);
  db.updateAttemptState(context.attempt.id, status === 'completed' ? 'completed' : 'blocked', attemptState);
  db.updateRunStatus(context.run.id, status, summary);
  if (status === 'completed') {
    db.updateVmState(context.vmContext.id, 'destroyed');
    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'vm_event',
      source: 'executor',
      summary: 'Fake VM context destroyed after simulated run completion.',
      payload: { executor: 'fake', targetExecution: false },
      vmContextId: context.vmContext.id
    });
  }
}

function sourceLogicBugSteps(): ScenarioStep[] {
  return [
    (context) => {
      contextDb(context).updateAttemptState(context.attempt.id, 'active', 'Mapping authorization-sensitive routes and import handlers.');
      recordTool(context, 'search', { query: 'ownership checks import handler authz' }, 'Search found authorization-sensitive import handlers.', {
        paths: ['src/imports/importProject.ts', 'src/authz/ownership.ts'],
        observation: 'Import handler and ownership helper names are present in scoped source metadata.'
      });
    },
    (context) => {
      recordTool(context, 'code_browser', { path: 'src/imports/importProject.ts', symbol: 'handleImport' }, 'Code browser identified a missing ownership guard before import commit.', {
        component: 'import handler',
        observation: 'The simulated handler writes project data before the ownership guard.'
      });
    },
    (context) => {
      recordModel(context, 'Model proposed an authorization hypothesis from tool-backed handler observations.', {
        hypothesisBoundary: 'not yet verified'
      });
      const hypothesisId = recordHypothesis(
        context,
        'Missing ownership check before import commit',
        'import handler',
        'authorization',
        'Tool-backed source observations suggest importProject commits scoped project data before enforcing ownership.'
      );
      recordVerifier(context, hypothesisId, 'inconclusive', 'Verifier placeholder returned inconclusive for the import ownership hypothesis.', {
        reason: 'Fake executor has no real target execution in this slice.'
      });
    },
    (context) => {
      finishRun(context, 'completed', 'Simulated source logic run finished with an inconclusive verifier.', 'Paused after verifier returned inconclusive.');
    }
  ];
}

function memoryCorruptionSteps(): ScenarioStep[] {
  return [
    (context) => {
      contextDb(context).updateAttemptState(context.attempt.id, 'active', 'Mapping parser entry points and import handlers.');
      recordTool(context, 'search', { query: 'parser entry length field' }, 'Search found parser entry points and length-field handlers.', {
        paths: ['src/parser/packet_reader.c', 'src/parser/chunk_decoder.c'],
        observation: 'Parser metadata contains length-prefixed chunk handling.'
      });
    },
    (context) => {
      recordTool(context, 'code_browser', { path: 'src/parser/chunk_decoder.c', symbol: 'decode_chunk' }, 'Code browser found simulated unchecked length arithmetic.', {
        component: 'chunk decoder',
        observation: 'Length field is multiplied before a bounds check in the fake fixture.'
      });
      recordTool(context, 'debugger', { command: 'run crash-input-003.bin' }, 'Debugger reported a simulated crash at decode_chunk+0x44.', {
        signal: 'SIGSEGV',
        instruction: 'mov (%rax),%rcx',
        observation: 'Crash is tool-backed but simulated.'
      });
    },
    (context) => {
      const artifactId = recordArtifact(
        context,
        'crash-input-003.bin',
        'FAKE-CRASH-INPUT-003\nlength=4294967295\n',
        { kind: 'crash_input', filename: 'crash-input-003.bin' }
      );
      const hypothesisId = recordHypothesis(
        context,
        'Unchecked chunk length can crash decoder',
        'chunk decoder',
        'memory_corruption',
        'Simulated debugger output and crash input metadata suggest unchecked chunk length arithmetic reaches a crashing memory access.'
      );
      contextDb(context).createFinding({
        runId: context.run.id,
        hypothesisId,
        state: 'needs_evidence',
        title: 'Chunk length crash needs reproduction evidence',
        summaryMarkdown: 'The fake debugger produced a crash and crash-input artifact, but no real reproduction has run.',
        affectedAssets: { component: 'chunk decoder' },
        affectedVersions: { fixture: 'fake' },
        impactMarkdown: 'Potential denial of service or memory safety issue pending real VM execution.',
        priorityScore: scorePriority(defaultHypothesisFactors('memory_corruption'))
      });
      contextDb(context).createEvidenceFromArtifact(context.run.id, artifactId, 'Simulated crash input from fake debugger.', hypothesisId);
    },
    (context) => {
      finishRun(context, 'completed', 'Simulated memory corruption run finished with a needs-evidence finding.', 'Finding remains needs_evidence after simulated crash artifact collection.');
    }
  ];
}

function policyBlockSteps(): ScenarioStep[] {
  return [
    (context) => {
      contextDb(context).updateAttemptState(context.attempt.id, 'active', 'Checking requested network access against recorded program scope.');
      recordTool(context, 'search', { query: 'external callback endpoint' }, 'Search summarized in-scope callback documentation.', {
        observation: 'Scoped documentation does not authorize the requested external host.'
      });
    },
    (context) => {
      recordModel(context, 'Model requested an out-of-scope network probe for correlation.', {
        requestedDestination: 'https://unscoped.example.net',
        claimStatus: 'policy_request'
      });
      const db = contextDb(context);
      const approval = db.createApproval({
        runId: context.run.id,
        attemptId: context.attempt.id,
        requestKind: 'network_access',
        requestedAction: {
          destination: 'https://unscoped.example.net',
          networkProfile: 'scoped_public'
        },
        decision: 'blocked',
        reason: 'Blocked: out-of-scope network request.'
      });
      db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'approval_event',
        source: 'policy',
        summary: 'Policy engine blocked an out-of-scope network request.',
        payload: {
          decision: 'blocked',
          destination: 'https://unscoped.example.net',
          recordedScopeRequired: true
        },
        approvalId: approval.id,
        vmContextId: context.vmContext.id
      });
      db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'network_event',
        source: 'policy',
        summary: 'No network request was sent.',
        payload: {
          destination: 'https://unscoped.example.net',
          sent: false
        },
        approvalId: approval.id,
        vmContextId: context.vmContext.id
      });
    },
    (context) => {
      finishRun(context, 'blocked', 'Blocked: out-of-scope network request.', 'Blocked: out-of-scope network request.');
    }
  ];
}

function verifiedFindingSteps(): ScenarioStep[] {
  return [
    (context) => {
      contextDb(context).updateAttemptState(context.attempt.id, 'active', 'Building a PoC for hypothesis H-14.');
      recordTool(context, 'search', { query: 'tenant export bypass ownership' }, 'Search found tenant export and ownership-check paths.', {
        paths: ['src/export/exportTenant.ts', 'src/authz/tenantAccess.ts'],
        observation: 'Export code and tenant access helper are both present in scoped metadata.'
      });
    },
    (context) => {
      recordTool(context, 'code_browser', { path: 'src/export/exportTenant.ts', symbol: 'exportTenant' }, 'Code browser found a simulated tenant ID trust boundary issue.', {
        observation: 'The fake fixture accepts tenantId from request parameters before checking caller membership.'
      });
      const hypothesisId = recordHypothesis(
        context,
        'Tenant export accepts attacker-controlled tenant ID',
        'tenant export',
        'authorization',
        'Tool-backed source observations indicate exportTenant uses a request tenantId before membership validation.'
      );
      contextDb(context).updateHypothesisState(hypothesisId, 'reproduced');
      const artifactId = recordArtifact(
        context,
        'evidence-bundle-F-2.txt',
        'FAKE-EVIDENCE-BUNDLE-F-2\ntrace=tool-backed\nverifier=pass\n',
        { kind: 'evidence_bundle', finding: 'F-2' },
        'verifier'
      );
      contextDb(context).createEvidenceFromArtifact(context.run.id, artifactId, 'Verifier evidence bundle for simulated tenant export finding.', hypothesisId);
      const verifierRunId = recordVerifier(context, hypothesisId, 'pass', 'Verifier placeholder passed for reproduced tenant export issue.', {
        reproduced: true,
        artifactId
      });
      contextDb(context).createFinding({
        runId: context.run.id,
        hypothesisId,
        state: 'needs_evidence',
        title: 'Tenant export authorization bypass',
        summaryMarkdown: 'Simulated verifier result reproduced a tenant export authorization bypass, but a real VM verifier is required before verification.',
        affectedAssets: { component: 'tenant export' },
        affectedVersions: { fixture: 'fake' },
        impactMarkdown: 'A scoped authenticated user could export data for another tenant in the fake fixture.',
        priorityScore: scorePriority(verifiedFindingFactors('authorization'))
      });
      contextDb(context).appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'finding_event',
        source: 'system',
        summary: 'Simulated finding recorded; real VM verifier required for verified state.',
        payload: {
          state: 'needs_evidence',
          verifierRunId,
          artifactId
        },
        artifactId,
        vmContextId: context.vmContext.id
      });
    },
    (context) => {
      finishRun(context, 'completed', 'Simulated finding F-2 collected; real verifier still required.', 'Simulated finding F-2 collected; real verifier still required.');
    }
  ];
}

function adaptivePortfolioSteps(): ScenarioStep[] {
  return [
    (context) => {
      recordAdaptivePortfolioBranches(context);
      recordModel(context, 'Adaptive portfolio started with independent parser and authorization branches.', {
        strategy: 'adaptive_portfolio',
        branchCount: 2
      });
    },
    ...memoryCorruptionSteps().slice(0, 2),
    (context) => {
      recordModel(context, 'Model split the portfolio between parser crash reproduction and authorization review.', {
        strategy: 'adaptive_portfolio'
      });
      const artifactId = recordArtifact(
        context,
        'crash-input-003.bin',
        'FAKE-ADAPTIVE-CRASH-INPUT-003\nlength=4294967295\n',
        { kind: 'crash_input', filename: 'crash-input-003.bin' }
      );
      const hypothesisId = recordHypothesis(
        context,
        'Unchecked parser length has crash potential',
        'packet parser',
        'memory_corruption',
        'The parser path has a simulated crash artifact, but no verifier-backed finding yet.'
      );
      contextDb(context).createEvidenceFromArtifact(context.run.id, artifactId, 'Simulated crash artifact from adaptive portfolio path.', hypothesisId);
    },
    ...policyBlockSteps().slice(1, 2),
    ...verifiedFindingSteps().slice(0, 2),
    (context) => {
      contextDb(context).appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'hypothesis_event',
        source: 'system',
        summary: 'Paused after duplicate hypothesis merge.',
        payload: {
          merge: 'duplicate authorization hypotheses consolidated',
          reversible: true
        }
      });
      finishRun(context, 'completed', 'Verified finding F-2; collecting disclosure artifacts.', 'Verified finding F-2; collecting disclosure artifacts.');
    }
  ];
}

function hypothesisKind(bugClass: string): 'authorization' | 'memory_corruption' | 'policy' | 'generic' {
  const lower = bugClass.toLowerCase();
  if (lower.includes('auth')) return 'authorization';
  if (lower.includes('memory') || lower.includes('crash') || lower.includes('corruption')) return 'memory_corruption';
  if (lower.includes('policy') || lower.includes('scope')) return 'policy';
  return 'generic';
}

function contextDb(context: CreatedRunContext): WorkspaceDatabase {
  return (context as unknown as { __db?: WorkspaceDatabase }).__db ?? contextDatabaseError();
}

function attachDatabase(context: CreatedRunContext, db: WorkspaceDatabase): CreatedRunContext {
  Object.defineProperty(context, '__db', {
    value: db,
    enumerable: false,
    configurable: false
  });
  return context;
}

function contextDatabaseError(): never {
  throw new Error('Fake run context is missing a database reference');
}
