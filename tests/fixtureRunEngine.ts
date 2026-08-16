import type { CreatedRunContext, WorkspaceDatabase } from '../src/main/database';
import type { StartRunInput } from '../src/shared/types';
import { generateSessionTitle } from '../src/shared/sessionTitle';
import { resolveGoalObjective } from '../src/shared/goalObjective';

type ScenarioStep = (context: CreatedRunContext) => void;

export type FixtureScenario = 'multi_branch_trace' | 'source_review' | 'crash_artifact' | 'scope_block' | 'verifier_pass';
export type FixtureStartRunInput = Omit<StartRunInput, 'runEngine'> & {
  runEngine: 'fixture' | 'honeycrisp';
  fixtureScenario?: FixtureScenario;
};

interface ScheduledRun {
  context: CreatedRunContext;
  scenario: FixtureScenario;
  nextIndex: number;
  timer: NodeJS.Timeout | null;
}

const STEP_DELAY_MS = 850;

export class FixtureRunEngine {
  private readonly scheduledRuns = new Map<string, ScheduledRun>();

  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly onChange: () => void = () => undefined
  ) {}

  public startRun(
    input: FixtureStartRunInput,
    mode: 'scheduled' | 'complete' = 'scheduled',
    researchProfileSnapshotId?: string | null
  ): CreatedRunContext {
    const scope = this.db.getActiveScope();
    const scenario = input.fixtureScenario ?? 'multi_branch_trace';
    const goalObjective = input.goalEnabled
      ? resolveGoalObjective(input.goalObjective, input.promptMarkdown)
      : null;
    const context = attachDatabase(this.db.createRun({
      scopeVersionId: scope.id,
      researchProfileSnapshotId,
      title: generateSessionTitle(input.promptMarkdown),
      promptMarkdown: input.promptMarkdown,
      shellSafetyMode: input.shellSafetyMode,
      mode: input.mode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attemptStrategy: input.attemptStrategy,
      sandboxProfile: input.sandboxProfile,
      targetAssetId: input.targetAssetId,
      targetPath: input.targetPath,
      budget: {
        ...input.budget,
        fixtureScenario: scenario,
        runEngine: 'fixture',
        goalEnabled: input.goalEnabled,
        goalObjective
      }
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
      type: 'research_event',
      source: 'executor',
      summary: 'Fixture executor allocated a simulated execution context.',
      payload: {
        executor: 'fixture',
        targetExecution: false,
        boundary: 'No target code, build scripts, PoCs, tests, fuzzing, or debugger sessions executed.'
      }
    });
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: 'Simulated model planned an open-ended discovery pass.',
      payload: {
        fixtureOnly: true,
        model: input.model,
        reasoningEffort: input.reasoningEffort
      }
    });

    if (mode === 'complete') {
      this.emitRemaining(context, scenario);
      this.onChange();
    } else {
      this.schedule(context, scenario);
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

  public hasRun(runId: string): boolean {
    return this.scheduledRuns.has(runId);
  }

  public dispose(): void {
    for (const scheduled of this.scheduledRuns.values()) {
      if (scheduled.timer) {
        clearTimeout(scheduled.timer);
      }
    }
    this.scheduledRuns.clear();
  }

  public emitRemaining(context: CreatedRunContext, scenario: FixtureScenario): void {
    for (const step of getSteps(scenario)) {
      step(context);
    }
  }

  private schedule(context: CreatedRunContext, scenario: FixtureScenario): void {
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
    let run;
    try {
      run = this.db.getRun(scheduled.context.run.id);
    } catch {
      this.scheduledRuns.delete(scheduled.context.run.id);
      return;
    }
    if (!run || run.status !== 'active') {
      return;
    }
    if (scheduled.nextIndex >= steps.length) {
      this.scheduledRuns.delete(scheduled.context.run.id);
      return;
    }

    scheduled.timer = setTimeout(() => {
      let latestRun;
      try {
        latestRun = this.db.getRun(scheduled.context.run.id);
      } catch {
        this.scheduledRuns.delete(scheduled.context.run.id);
        return;
      }
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
    scheduled.timer.unref();
  }
}

function getSteps(scenario: FixtureScenario): ScenarioStep[] {
  switch (scenario) {
    case 'source_review':
      return sourceReviewSteps();
    case 'crash_artifact':
      return crashArtifactSteps();
    case 'scope_block':
      return scopeBlockSteps();
    case 'verifier_pass':
      return verifierPassSteps();
    case 'multi_branch_trace':
    default:
      return multiBranchTraceSteps();
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
      fixtureOnly: true,
      ...payload
    }
  });
}

function recordFixtureBranches(context: CreatedRunContext): void {
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
      strategyRole: branch.role
    });
    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: attempt.id,
      type: 'user_note',
      source: 'system',
      summary: `Fixture branch recorded: ${branch.role}.`,
      payload: {
        fixtureScenario: 'multi_branch_trace',
        parentAttemptId: context.attempt.id,
        branchRole: branch.role
      }
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
    toolVersion: 'fixture-v1',
    input,
    status: 'completed',
    resultSummary,
    result,
  });
  db.appendTraceEvent({
    runId: context.run.id,
    attemptId: context.attempt.id,
    type: 'tool_call',
    source: 'model',
    summary: `Requested ${toolName}.`,
    payload: input,
    toolCallId,
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
    kind: metadata.kind ? String(metadata.kind) : 'artifact',
    mimeType: 'text/plain',
    sensitivity: 'internal',
    modelVisible: true,
    source,
    metadata: { name, fixture: true, ...metadata },
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
  });
  db.setArtifactProvenance(artifact.id, event.id);
  return artifact.id;
}

function recordResearchNote(context: CreatedRunContext, title: string, component: string, researchArea: string, description: string): string {
  const db = contextDb(context);
  const event = db.appendTraceEvent({
    runId: context.run.id,
    attemptId: context.attempt.id,
    type: 'research_event',
    source: 'system',
    summary: `Fixture research note recorded: ${title}.`,
    payload: {
      title,
      component,
      researchArea,
      description,
      fixtureOnly: true,
      observationSource: 'tool_results'
    }
  });
  return event.id;
}

function recordVerifier(
  context: CreatedRunContext,
  _memoryNodeId: string | null,
  status: string,
  summary: string,
  result: Record<string, unknown>
): string {
  const db = contextDb(context);
  const contract = db.createVerifierContract({
    runId: context.run.id,
    memoryNodeId: null,
    mode: 'reproduction',
    status: 'approved',
    targetStates: {},
    setupStepsMarkdown: 'Use simulated target state from the fixture executor.',
    triggerStepsMarkdown: 'Replay the deterministic fixture trigger.',
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
    status,
    blockedIssue: status === 'pass' ? 'confirmed' : status === 'fail' ? 'not_observed' : 'inconclusive',
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
  });
  return verifierRun.id;
}

function finishRun(context: CreatedRunContext, status: 'completed' | 'blocked', summary: string, attemptState: string): void {
  const db = contextDb(context);
  db.updateAttemptState(context.attempt.id, status === 'completed' ? 'completed' : 'blocked', attemptState);
  db.updateRunStatus(context.run.id, status, summary, {
    outcome: status === 'blocked' ? 'blocked' : 'inconclusive',
    summary,
    blockerDependencies: status === 'blocked'
      ? [{ kind: 'authorization', description: 'The requested fixture action is outside the recorded authorization boundary.', requiredState: 'A separately recorded authorized scope would be required before testing that target.', external: true }]
      : [],
    externalStateRequired: status === 'blocked',
    source: 'fixture'
  });
  if (status === 'completed') {
    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'research_event',
      source: 'executor',
      summary: 'Fixture execution context closed after simulated run completion.',
      payload: { executor: 'fixture', targetExecution: false }
    });
  }
}

function sourceReviewSteps(): ScenarioStep[] {
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
      recordModel(context, 'Model recorded an authorization research direction from tool-backed handler observations.', {
        verificationState: 'not_yet_verified'
      });
      const researchEventId = recordResearchNote(
        context,
        'Missing ownership check before import commit',
        'import handler',
        'authorization',
        'Tool-backed source observations suggest importProject commits scoped project data before enforcing ownership.'
      );
      recordVerifier(context, researchEventId, 'inconclusive', 'Verifier placeholder returned inconclusive for the import ownership issue.', {
        reason: 'Fixture executor has no real target execution in this slice.'
      });
    },
    (context) => {
      finishRun(context, 'completed', 'Simulated source logic run finished with an inconclusive verifier.', 'Paused after verifier returned inconclusive.');
    }
  ];
}

function crashArtifactSteps(): ScenarioStep[] {
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
        observation: 'Length field is multiplied before a bounds check in the fixture.'
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
      const researchEventId = recordResearchNote(
        context,
        'Unchecked chunk length can crash decoder',
        'chunk decoder',
        'memory_safety',
        'Simulated debugger output and crash input metadata suggest unchecked chunk length arithmetic reaches a crashing memory access.'
      );
      contextDb(context).appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'artifact_created',
        source: 'system',
        summary: 'Simulated crash input retained as an operational artifact.',
        payload: { researchTraceEventId: researchEventId, artifactId, fixtureOnly: true },
        artifactId
      });
    },
    (context) => {
      finishRun(context, 'completed', 'Simulated crash-artifact run finished without real target verification.', 'Crash artifact retained; real target verification remains pending.');
    }
  ];
}

function scopeBlockSteps(): ScenarioStep[] {
  return [
    (context) => {
      contextDb(context).updateAttemptState(context.attempt.id, 'active', 'Reviewing the proposed target against the recorded authorization boundary.');
      recordTool(context, 'search', { query: 'external callback endpoint' }, 'Search summarized the recorded authorization boundary.', {
        observation: 'The researcher did not record the proposed external host as authorized.'
      });
    },
    (context) => {
      recordModel(context, 'Agent declined to probe a target outside the recorded authorization boundary.', {
        requestedDestination: 'https://unscoped.example.net',
        claimStatus: 'authorization_boundary'
      });
    },
    (context) => {
      finishRun(context, 'blocked', 'Agent stopped at the recorded authorization boundary.', 'Additional operator authorization is required for the proposed target.');
    }
  ];
}

function verifierPassSteps(): ScenarioStep[] {
  return [
    (context) => {
      contextDb(context).updateAttemptState(context.attempt.id, 'active', 'Building a fixture reproduction for a tenant export issue.');
      recordTool(context, 'search', { query: 'tenant export bypass ownership' }, 'Search found tenant export and ownership-check paths.', {
        paths: ['src/export/exportTenant.ts', 'src/authz/tenantAccess.ts'],
        observation: 'Export code and tenant access helper are both present in scoped metadata.'
      });
    },
    (context) => {
      recordTool(context, 'code_browser', { path: 'src/export/exportTenant.ts', symbol: 'exportTenant' }, 'Code browser found a simulated tenant ID trust boundary issue.', {
        observation: 'The fixture accepts tenantId from request parameters before checking caller membership.'
      });
      const researchEventId = recordResearchNote(
        context,
        'Tenant export accepts attacker-controlled tenant ID',
        'tenant export',
        'authorization',
        'Tool-backed source observations indicate exportTenant uses a request tenantId before membership validation.'
      );
      const artifactId = recordArtifact(
        context,
        'verifier-output.txt',
        'FAKE-VERIFIER-OUTPUT\ntrace=tool-backed\nverifier=pass\n',
        { kind: 'verifier_output' },
        'verifier'
      );
      const verifierRunId = recordVerifier(context, researchEventId, 'pass', 'Verifier placeholder passed for reproduced tenant export issue.', {
        reproduced: true,
        artifactId
      });
      contextDb(context).appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'research_event',
        source: 'system',
        summary: 'Fixture verifier outcome recorded; real target execution is still required.',
        payload: {
          state: 'fixture_only',
          verifierRunId,
          artifactId
        },
        artifactId,
      });
    },
    (context) => {
      finishRun(context, 'completed', 'Fixture verifier passed; real target execution is still required.', 'Fixture verifier passed; real target execution is still required.');
    }
  ];
}

function multiBranchTraceSteps(): ScenarioStep[] {
  return [
    (context) => {
      recordFixtureBranches(context);
      recordModel(context, 'Multi-branch fixture started with independent parser and authorization traces.', {
        fixtureScenario: 'multi_branch_trace',
        branchCount: 2
      });
    },
    ...crashArtifactSteps().slice(0, 2),
    (context) => {
      recordModel(context, 'Fixture split the trace between parser crash reproduction and authorization review.', {
        fixtureScenario: 'multi_branch_trace'
      });
      const artifactId = recordArtifact(
        context,
        'crash-input-003.bin',
        'FAKE-ADAPTIVE-CRASH-INPUT-003\nlength=4294967295\n',
        { kind: 'crash_input', filename: 'crash-input-003.bin' }
      );
      const researchEventId = recordResearchNote(
        context,
        'Unchecked parser length has crash potential',
        'packet parser',
        'memory_safety',
        'The parser path has a simulated crash artifact, but no real target verification yet.'
      );
      contextDb(context).appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'artifact_created',
        source: 'system',
        summary: 'Multi-branch fixture retained the simulated crash artifact.',
        payload: { researchTraceEventId: researchEventId, artifactId, fixtureOnly: true },
        artifactId
      });
    },
    ...scopeBlockSteps().slice(1, 2),
    ...verifierPassSteps().slice(0, 2),
    (context) => {
      contextDb(context).appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'research_event',
        source: 'system',
        summary: 'Fixture branch reconciliation completed.',
        payload: {
          reconciliation: 'overlapping authorization research notes consolidated',
          reversible: true
        }
      });
      finishRun(context, 'completed', 'Fixture trace completed with verifier and artifact outputs.', 'Fixture trace completed with verifier and artifact outputs.');
    }
  ];
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
  throw new Error('Fixture run context is missing a database reference');
}
