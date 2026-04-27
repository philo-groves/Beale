import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { priorityFactorLabels, scorePriority, type PriorityFactors } from './discoveryScoring';
import { FakeRunEngine } from './fakeRunEngine';
import { WorkspaceDatabase } from './database';
import { OpenAiResponsesAdapter } from './openaiAdapter';
import { OpenAiAuthService } from './openaiAuth';
import { OpenAiRunEngine } from './openaiRunEngine';
import { ExecutorManager } from './executorManager';
import { ExecutorRunEngine } from './executorRunEngine';
import type {
  FakeScenario,
  FindingRecord,
  HypothesisRecord,
  PriorityFactorInput,
  ProgramScopeDraft,
  RunDetail,
  StartRunInput,
  SteeringAction,
  WorkspaceSnapshot,
  WorkspaceSummary
} from '@shared/types';

const FAKE_EXECUTOR_LABEL = 'Simulated engine and fake VM executor. No target code execution.';

export class WorkspaceService {
  private db: WorkspaceDatabase | null = null;
  private engine: FakeRunEngine | null = null;
  private openAiEngine: OpenAiRunEngine | null = null;
  private executorManager: ExecutorManager | null = null;
  private executorRunEngine: ExecutorRunEngine | null = null;
  private readonly openAiAuth = new OpenAiAuthService();
  private workspacePath: string | null = null;
  private openedAt: string | null = null;

  public constructor(private readonly onChange: () => void = () => undefined) {}

  public openWorkspace(path: string): WorkspaceSnapshot {
    return this.open(path, false);
  }

  public createWorkspace(path: string): WorkspaceSnapshot {
    return this.open(path, true);
  }

  public getSnapshot(): WorkspaceSnapshot | null {
    if (!this.db || !this.workspacePath || !this.openedAt) {
      return null;
    }
    return {
      workspace: this.getWorkspaceSummary(),
      openAi: this.openAiAuth.getStatus(),
      executor: this.requireExecutorManager().getStatus(),
      activeScope: this.db.getActiveScope(),
      runs: this.db.listRunRows()
    };
  }

  public saveProgramScope(scope: ProgramScopeDraft): WorkspaceSnapshot {
    const db = this.requireDb();
    db.saveProgramScope(scope);
    this.emitChange();
    return this.requireSnapshot();
  }

  public startRun(input: StartRunInput, mode: 'scheduled' | 'complete' = 'scheduled'): WorkspaceSnapshot {
    if (input.runEngine === 'openai_responses') {
      this.requireOpenAiEngine().startRun(input);
    } else if (input.runEngine === 'executor_alpha') {
      this.requireExecutorRunEngine().startRun(input);
    } else {
      const engine = this.requireEngine();
      engine.startRun(input, mode);
    }
    this.emitChange();
    return this.requireSnapshot();
  }

  public getRunDetail(runId: string): RunDetail {
    return this.requireDb().getRunDetail(runId);
  }

  public steerRun(action: SteeringAction): WorkspaceSnapshot {
    const db = this.requireDb();
    const engine = this.requireEngine();
    const run = db.getRun(action.runId);
    if (!run) {
      throw new Error(`Run not found: ${action.runId}`);
    }
    const attempt = db.getFirstAttempt(action.runId);

    switch (action.type) {
      case 'pause': {
        engine.pause(action.runId);
        this.openAiEngine?.pause(action.runId);
        if (attempt) db.updateAttemptState(attempt.id, 'paused', 'Paused by user steering.');
        db.updateRunStatus(action.runId, 'paused', 'Paused by user steering.');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'user_note',
          source: 'user',
          summary: 'Run paused by user.',
          payload: { note: action.note ?? '' }
        });
        break;
      }
      case 'resume': {
        if (attempt) db.updateAttemptState(attempt.id, 'active', 'Resumed by user steering.');
        db.updateRunStatus(action.runId, 'active', 'Resumed by user steering.');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'user_note',
          source: 'user',
          summary: 'Run resumed by user.',
          payload: { note: action.note ?? '' }
        });
        if (run.budget.runEngine === 'openai_responses') {
          this.requireOpenAiEngine().resumeRun(action.runId);
        } else {
          engine.resume(action.runId);
        }
        break;
      }
      case 'stop': {
        engine.stop(action.runId);
        this.openAiEngine?.stop(action.runId);
        if (attempt) db.updateAttemptState(attempt.id, 'stopped', 'Stopped by user steering.');
        db.updateRunStatus(action.runId, 'stopped', 'Stopped by user steering.');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'user_note',
          source: 'user',
          summary: 'Run stopped by user.',
          payload: { note: action.note ?? '' }
        });
        break;
      }
      case 'fork': {
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'user_note',
          source: 'user',
          summary: 'Run fork requested with additional instruction.',
          payload: { instruction: action.instruction }
        });
        const scenario = fakeScenarioFromBudget(run.budget);
        const forkInput: StartRunInput = {
          promptMarkdown: `${run.promptMarkdown}\n\n## Fork instruction\n${action.instruction}`,
          mode: run.mode,
          attemptStrategy: run.attemptStrategy,
          model: run.model,
          reasoningEffort: run.reasoningEffort,
          networkProfile: run.networkProfile,
          sandboxProfile: run.sandboxProfile,
          budget: {
            maxMinutes: numberFromBudget(run.budget, 'maxMinutes', 45),
            maxAttempts: numberFromBudget(run.budget, 'maxAttempts', 2),
            maxCostUsd: numberFromBudget(run.budget, 'maxCostUsd', 0)
          },
          runEngine: run.budget.runEngine === 'openai_responses' ? 'openai_responses' : run.budget.runEngine === 'executor_alpha' ? 'executor_alpha' : 'fake',
          fakeScenario: scenario
        };
        if (forkInput.runEngine === 'openai_responses') {
          this.requireOpenAiEngine().startRun(forkInput);
        } else if (forkInput.runEngine === 'executor_alpha') {
          this.requireExecutorRunEngine().startRun(forkInput);
        } else {
          engine.startRun(forkInput, 'scheduled');
        }
        break;
      }
      case 'rerun_verifier': {
        const verifierRun = db.createVerifierRun({
          contractId: action.verifierContractId,
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          vmContextId: attempt?.vmContextId ?? null,
          status: 'inconclusive',
          blockedIssue: 'inconclusive',
          behaviorPreserved: 'not_applicable',
          diagnosticsClean: 'inconclusive',
          regressionTests: 'not_run',
          result: { manualRerun: true, note: action.note ?? '' }
        });
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'verifier_result',
          source: 'verifier',
          summary: 'Verifier rerun placeholder recorded as inconclusive.',
          payload: { verifierRunId: verifierRun.id, contractId: action.verifierContractId, status: 'inconclusive' },
          vmContextId: attempt?.vmContextId ?? null
        });
        break;
      }
      case 'promote_artifact': {
        const evidenceId = db.createEvidenceFromArtifact(action.runId, action.artifactId, 'User promoted artifact to evidence.');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'artifact_created',
          source: 'user',
          summary: 'Artifact promoted to evidence by user.',
          payload: { artifactId: action.artifactId, evidenceId, note: action.note ?? '' },
          artifactId: action.artifactId
        });
        break;
      }
      case 'promote_hypothesis': {
        const detail = db.getRunDetail(action.runId);
        const hypothesis = requireHypothesis(detail, action.hypothesisId);
        const passingVerifier = latestVerifierForHypothesis(detail, hypothesis.id, 'pass');
        const finding = db.createFinding({
          runId: action.runId,
          hypothesisId: hypothesis.id,
          state: passingVerifier ? 'verified' : 'needs_evidence',
          title: hypothesis.title,
          summaryMarkdown: `${hypothesis.descriptionMarkdown}\n\nPromoted by user for finding triage.`,
          affectedAssets: { component: hypothesis.component, scopeConfidence: hypothesis.scopeConfidence },
          affectedVersions: { status: 'unknown' },
          impactMarkdown: hypothesis.impact,
          priorityScore: hypothesis.priorityScore,
          verifiedByVerifierRunId: passingVerifier?.id ?? null
        });
        db.updateHypothesisReview(hypothesis.id, { state: passingVerifier ? 'verified' : 'promoted' });
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'finding_event',
          source: 'user',
          summary: passingVerifier ? 'Hypothesis promoted to verifier-backed finding.' : 'Hypothesis promoted to finding needing evidence.',
          payload: {
            hypothesisId: hypothesis.id,
            findingId: finding.id,
            findingState: finding.state,
            verifierRunId: passingVerifier?.id ?? null,
            note: action.note ?? ''
          },
          vmContextId: attempt?.vmContextId ?? null
        });
        break;
      }
      case 'merge_hypotheses': {
        const detail = db.getRunDetail(action.runId);
        requireHypothesis(detail, action.sourceHypothesisId);
        requireHypothesis(detail, action.targetHypothesisId);
        db.updateHypothesisReview(action.sourceHypothesisId, { state: 'duplicate' });
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'hypothesis_event',
          source: 'user',
          summary: 'Duplicate hypothesis merged by user.',
          payload: {
            sourceHypothesisId: action.sourceHypothesisId,
            targetHypothesisId: action.targetHypothesisId,
            reversible: true,
            note: action.note ?? ''
          }
        });
        break;
      }
      case 'adjust_priority': {
        const factors = priorityFactorsFromInput(action.factors);
        const labels = priorityFactorLabels(factors);
        const priorityScore = scorePriority(factors);
        db.updateHypothesisReview(action.hypothesisId, {
          priorityScore,
          attackerReachability: labels.attackerReachability,
          impact: labels.impact,
          evidenceConfidence: labels.evidenceConfidence,
          exploitPracticality: labels.exploitPracticality,
          scopeConfidence: labels.scopeConfidence
        });
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'hypothesis_event',
          source: 'user',
          summary: 'Hypothesis priority factors adjusted by user.',
          payload: {
            hypothesisId: action.hypothesisId,
            priorityScore,
            factors: action.factors,
            note: action.note ?? ''
          }
        });
        break;
      }
      case 'request_reproduction': {
        const detail = db.getRunDetail(action.runId);
        const hypothesis = requireHypothesis(detail, action.hypothesisId);
        const contract = createReproductionContract(db, action.runId, hypothesis, attempt?.vmContextId ?? null, action.note ?? '');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'verifier_result',
          source: 'user',
          summary: 'Reproduction verifier contract requested for hypothesis.',
          payload: {
            contractId: contract.id,
            hypothesisId: hypothesis.id,
            mode: contract.mode,
            status: contract.status,
            note: action.note ?? ''
          },
          vmContextId: attempt?.vmContextId ?? null
        });
        break;
      }
      case 'request_patch_validation': {
        const detail = db.getRunDetail(action.runId);
        const hypothesis = action.hypothesisId ? requireHypothesis(detail, action.hypothesisId) : null;
        const finding = action.findingId ? requireFinding(detail, action.findingId) : null;
        const contract = createPatchValidationContract(db, action.runId, hypothesis, finding, attempt?.vmContextId ?? null, action.note ?? '');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'verifier_result',
          source: 'user',
          summary: 'Patch validation verifier contract requested.',
          payload: {
            contractId: contract.id,
            hypothesisId: hypothesis?.id ?? null,
            findingId: finding?.id ?? null,
            mode: contract.mode,
            status: contract.status,
            note: action.note ?? ''
          },
          vmContextId: attempt?.vmContextId ?? null
        });
        break;
      }
      case 'mark_finding_false_positive': {
        requireFinding(db.getRunDetail(action.runId), action.findingId);
        db.updateFindingState(action.findingId, 'false_positive');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'finding_event',
          source: 'user',
          summary: 'Finding marked false positive by user.',
          payload: { findingId: action.findingId, note: action.note ?? '' }
        });
        break;
      }
      case 'mark_finding_out_of_scope': {
        requireFinding(db.getRunDetail(action.runId), action.findingId);
        db.updateFindingState(action.findingId, 'out_of_scope');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'finding_event',
          source: 'user',
          summary: 'Finding marked out of scope by user.',
          payload: { findingId: action.findingId, note: action.note ?? '' }
        });
        break;
      }
      case 'export_evidence_bundle': {
        this.exportEvidenceBundle(action.runId, action.findingId ?? null, action.note ?? '', attempt?.id ?? null, attempt?.vmContextId ?? null);
        break;
      }
      case 'mark_artifact_sensitive': {
        db.markArtifactSensitive(action.artifactId);
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'artifact_created',
          source: 'user',
          summary: 'Artifact marked sensitive and hidden from model context.',
          payload: { artifactId: action.artifactId, note: action.note ?? '' },
          artifactId: action.artifactId,
          modelVisible: false
        });
        break;
      }
      case 'dismiss_hypothesis': {
        db.updateHypothesisState(action.hypothesisId, 'dismissed');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'hypothesis_event',
          source: 'user',
          summary: 'Hypothesis dismissed by user.',
          payload: { hypothesisId: action.hypothesisId, note: action.note ?? '' }
        });
        break;
      }
      case 'mark_hypothesis_out_of_scope': {
        db.updateHypothesisState(action.hypothesisId, 'out_of_scope');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'hypothesis_event',
          source: 'user',
          summary: 'Hypothesis marked out of scope by user.',
          payload: { hypothesisId: action.hypothesisId, note: action.note ?? '' }
        });
        break;
      }
      default: {
        const exhaustive: never = action;
        throw new Error(`Unsupported steering action: ${JSON.stringify(exhaustive)}`);
      }
    }

    this.emitChange();
    return this.requireSnapshot();
  }

  public close(): void {
    this.engine?.dispose();
    this.openAiEngine?.dispose();
    this.db?.close();
    this.db = null;
    this.engine = null;
    this.openAiEngine = null;
    this.executorManager = null;
    this.executorRunEngine = null;
    this.workspacePath = null;
    this.openedAt = null;
  }

  private open(path: string, create: boolean): WorkspaceSnapshot {
    const workspacePath = resolve(path);
    if (create) {
      mkdirSync(workspacePath, { recursive: true });
    } else {
      const stat = statSync(workspacePath);
      if (!stat.isDirectory()) {
        throw new Error(`Workspace path is not a directory: ${workspacePath}`);
      }
    }

    const bealeDir = join(workspacePath, '.beale');
    const artifactRoot = join(bealeDir, 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    mkdirSync(join(bealeDir, 'exports'), { recursive: true });
    mkdirSync(join(bealeDir, 'logs'), { recursive: true });

    this.close();
    this.workspacePath = workspacePath;
    this.openedAt = new Date().toISOString();
    this.db = new WorkspaceDatabase(join(bealeDir, 'beale.sqlite'), artifactRoot);
    this.db.initialize();
    this.engine = new FakeRunEngine(this.db, this.onChange);
    this.executorManager = new ExecutorManager(this.db);
    this.openAiEngine = new OpenAiRunEngine(this.db, this.openAiAuth, new OpenAiResponsesAdapter(this.openAiAuth), this.executorManager, this.onChange);
    this.executorRunEngine = new ExecutorRunEngine(this.db, this.executorManager, this.onChange);
    this.emitChange();
    return this.requireSnapshot();
  }

  private requireDb(): WorkspaceDatabase {
    if (!this.db) {
      throw new Error('No Beale workspace is open');
    }
    return this.db;
  }

  private requireEngine(): FakeRunEngine {
    if (!this.engine) {
      throw new Error('No fake run engine is available');
    }
    return this.engine;
  }

  private requireOpenAiEngine(): OpenAiRunEngine {
    if (!this.openAiEngine) {
      throw new Error('No OpenAI run engine is available');
    }
    return this.openAiEngine;
  }

  private requireExecutorManager(): ExecutorManager {
    if (!this.executorManager) {
      throw new Error('No VM executor manager is available');
    }
    return this.executorManager;
  }

  private requireExecutorRunEngine(): ExecutorRunEngine {
    if (!this.executorRunEngine) {
      throw new Error('No VM executor run engine is available');
    }
    return this.executorRunEngine;
  }

  private requireSnapshot(): WorkspaceSnapshot {
    const snapshot = this.getSnapshot();
    if (!snapshot) {
      throw new Error('No Beale workspace is open');
    }
    return snapshot;
  }

  private getWorkspaceSummary(): WorkspaceSummary {
    const db = this.requireDb();
    if (!this.workspacePath || !this.openedAt) {
      throw new Error('No Beale workspace is open');
    }
    return {
      workspaceId: db.getWorkspaceId(),
      workspacePath: this.workspacePath,
      databasePath: db.getDatabasePath(),
      artifactRoot: db.getArtifactRoot(),
      openedAt: this.openedAt,
      fakeExecutorLabel: FAKE_EXECUTOR_LABEL
    };
  }

  private emitChange(): void {
    this.onChange();
  }

  private exportEvidenceBundle(runId: string, findingId: string | null, note: string, attemptId: string | null, vmContextId: string | null): void {
    const db = this.requireDb();
    if (!this.workspacePath) throw new Error('No Beale workspace is open');
    const detail = db.getRunDetail(runId);
    const finding = findingId ? requireFinding(detail, findingId) : detail.findings[0] ?? null;
    const markdown = buildEvidenceBundleMarkdown(detail, finding, note);
    const exportDir = join(this.workspacePath, '.beale', 'exports');
    mkdirSync(exportDir, { recursive: true });
    const fileName = `${sanitizeFileSegment(detail.run.title)}-${finding ? sanitizeFileSegment(finding.id) : 'run'}-evidence.md`;
    const relativePath = join('.beale', 'exports', fileName).replace(/\\/g, '/');
    writeFileSync(join(this.workspacePath, relativePath), markdown);
    const artifact = db.createArtifact({
      kind: 'evidence_bundle_export',
      mimeType: 'text/markdown',
      sensitivity: 'internal',
      modelVisible: false,
      source: 'report',
      metadata: {
        name: fileName,
        findingId: finding?.id ?? null,
        exportRelativePath: relativePath,
        disclosureDraft: true
      },
      content: markdown
    });
    const exportId = db.createExportRecord({
      runId,
      findingId: finding?.id ?? null,
      kind: 'evidence_bundle',
      relativePath,
      redactionPolicy: { modelVisible: false, redactionApplied: false, userReviewRequired: true },
      includedArtifacts: { artifactIds: detail.artifacts.map((item) => item.id), bundleArtifactId: artifact.id }
    });
    const event = db.appendTraceEvent({
      runId,
      attemptId,
      type: 'artifact_created',
      source: 'system',
      summary: 'Evidence bundle export created.',
      payload: {
        artifactId: artifact.id,
        exportId,
        relativePath,
        findingId: finding?.id ?? null,
        note
      },
      artifactId: artifact.id,
      vmContextId,
      modelVisible: false
    });
    db.setArtifactProvenance(artifact.id, event.id);
  }
}

export function startRunForTest(service: WorkspaceService, input: StartRunInput): WorkspaceSnapshot {
  return service.startRun(input, 'complete');
}

function priorityFactorsFromInput(input: PriorityFactorInput): PriorityFactors {
  return {
    attackerReachability: input.attackerReachability,
    impact: input.impact,
    evidenceConfidence: input.evidenceConfidence,
    exploitPracticality: input.exploitPracticality,
    scopeConfidence: input.scopeConfidence
  };
}

function createReproductionContract(db: WorkspaceDatabase, runId: string, hypothesis: HypothesisRecord, vmContextId: string | null, note: string) {
  return db.createVerifierContract({
    runId,
    hypothesisId: hypothesis.id,
    mode: 'reproduction',
    status: 'draft_requested',
    targetStates: {
      baseline: { vmContextId, label: 'current scoped target state' }
    },
    setupStepsMarkdown: 'Prepare the scoped target inside the disposable VM. Do not mount host credentials or .beale/beale.sqlite.',
    triggerStepsMarkdown: note || `Develop and run the smallest trigger that can confirm or falsify: ${hypothesis.title}.`,
    expectedObservations: {
      hypothesisId: hypothesis.id,
      expectedSecurityFailure: hypothesis.descriptionMarkdown,
      requiredEvidence: 'tool trace, artifact, or verifier output'
    },
    invariants: {
      hostDatabaseMounted: false,
      openAiCredentialsMounted: false,
      scopeMustAllowTarget: true
    },
    artifactsToCollect: {
      poc: true,
      logs: true,
      debuggerContext: hypothesis.bugClass.includes('memory') || hypothesis.bugClass.includes('crash'),
      evidenceBundle: true
    },
    passCriteria: {
      reproducedReliably: true,
      expectedObservationTraceBacked: true,
      artifactBacked: true
    }
  });
}

function createPatchValidationContract(
  db: WorkspaceDatabase,
  runId: string,
  hypothesis: HypothesisRecord | null,
  finding: FindingRecord | null,
  vmContextId: string | null,
  note: string
) {
  return db.createVerifierContract({
    runId,
    hypothesisId: hypothesis?.id ?? finding?.hypothesisId ?? null,
    findingId: finding?.id ?? null,
    mode: 'patch_validation',
    status: 'draft_requested',
    targetStates: {
      baseline: { vmContextId, expected: 'vulnerable behavior reproduces' },
      candidate_patch: { vmContextId: null, expected: 'vulnerable behavior is blocked' }
    },
    setupStepsMarkdown: 'Prepare baseline and candidate patch states in disposable VM contexts.',
    triggerStepsMarkdown: note || 'Replay the reproduced PoC or regression check against baseline and candidate patch states.',
    expectedObservations: {
      baseline: 'issue reproduces',
      candidatePatch: 'issue no longer reproduces',
      behaviorPreserved: 'relevant smoke or regression behavior still passes'
    },
    invariants: {
      hostDatabaseMounted: false,
      openAiCredentialsMounted: false,
      relevantBehaviorPreserved: true
    },
    artifactsToCollect: {
      patch: true,
      beforeAfterLogs: true,
      verifierOutput: true
    },
    passCriteria: {
      blockedIssue: 'yes',
      behaviorPreserved: 'yes',
      regressionTests: ['pass', 'not_run_with_justification']
    }
  });
}

function requireHypothesis(detail: RunDetail, hypothesisId: string): HypothesisRecord {
  const hypothesis = detail.hypotheses.find((item) => item.id === hypothesisId);
  if (!hypothesis) throw new Error(`Hypothesis not found: ${hypothesisId}`);
  return hypothesis;
}

function requireFinding(detail: RunDetail, findingId: string): FindingRecord {
  const finding = detail.findings.find((item) => item.id === findingId);
  if (!finding) throw new Error(`Finding not found: ${findingId}`);
  return finding;
}

function latestVerifierForHypothesis(detail: RunDetail, hypothesisId: string, status: string) {
  const contractIds = new Set(detail.verifierContracts.filter((contract) => contract.hypothesisId === hypothesisId).map((contract) => contract.id));
  return [...detail.verifierRuns].reverse().find((run) => contractIds.has(run.contractId) && run.status === status) ?? null;
}

function buildEvidenceBundleMarkdown(detail: RunDetail, finding: FindingRecord | null, note: string): string {
  const verified = finding?.verifiedByVerifierRunId ? `Verifier run: ${finding.verifiedByVerifierRunId}` : 'Verifier run: none';
  const artifacts = detail.artifacts
    .map((artifact) => `- ${artifact.id}: ${artifact.kind}, sha256=${artifact.sha256}, source=${artifact.source}, path=${artifact.relativePath}`)
    .join('\n');
  const verifierRuns = detail.verifierRuns
    .map((run) => `- ${run.id}: ${run.status}, blocked_issue=${run.blockedIssue}, contract=${run.contractId}`)
    .join('\n');
  const traceRefs = detail.traceEvents
    .filter((event) => ['tool', 'executor', 'verifier'].includes(event.source) || event.artifactId)
    .slice(-25)
    .map((event) => `- #${event.sequence} ${event.source}/${event.type}: ${event.summary}${event.artifactId ? ` artifact=${event.artifactId}` : ''}`)
    .join('\n');

  return [
    `# Evidence Bundle: ${detail.run.title}`,
    '',
    '## Disclosure Draft',
    finding ? `Finding: ${finding.title}` : 'Finding: run-level evidence bundle',
    finding ? `State: ${finding.state}` : `Run status: ${detail.run.status}`,
    finding ? `Priority: ${finding.priorityScore.toFixed(2)}` : '',
    verified,
    note ? `Reviewer note: ${note}` : '',
    '',
    '## Summary',
    finding?.summaryMarkdown ?? detail.run.summary,
    '',
    '## Impact',
    finding?.impactMarkdown ?? 'Impact not promoted to a finding yet.',
    '',
    '## Artifacts',
    artifacts || 'No artifacts recorded.',
    '',
    '## Verifier Runs',
    verifierRuns || 'No verifier runs recorded.',
    '',
    '## Trace References',
    traceRefs || 'No tool, executor, verifier, or artifact trace references recorded.',
    '',
    '## Review Notes',
    'Generated by Beale as a candidate evidence bundle. User review is required before disclosure.'
  ].join('\n');
}

function sanitizeFileSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'run';
}

function numberFromBudget(budget: Record<string, unknown>, key: string, fallback: number): number {
  const value = budget[key];
  return typeof value === 'number' ? value : fallback;
}

function fakeScenarioFromBudget(budget: Record<string, unknown>): FakeScenario {
  const value = budget.fakeScenario;
  if (
    value === 'adaptive_portfolio' ||
    value === 'source_logic_bug' ||
    value === 'memory_corruption' ||
    value === 'policy_block' ||
    value === 'verified_finding'
  ) {
    return value;
  }
  return 'adaptive_portfolio';
}
