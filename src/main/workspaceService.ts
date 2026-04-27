import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FakeRunEngine } from './fakeRunEngine';
import { WorkspaceDatabase } from './database';
import { OpenAiResponsesAdapter } from './openaiAdapter';
import { OpenAiAuthService } from './openaiAuth';
import { OpenAiRunEngine } from './openaiRunEngine';
import { ExecutorManager } from './executorManager';
import { ExecutorRunEngine } from './executorRunEngine';
import type {
  FakeScenario,
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
          result: { rerun: true, note: action.note ?? '', fake: true }
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
    this.openAiEngine = new OpenAiRunEngine(this.db, this.openAiAuth, new OpenAiResponsesAdapter(this.openAiAuth), this.onChange);
    this.executorManager = new ExecutorManager(this.db);
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
}

export function startRunForTest(service: WorkspaceService, input: StartRunInput): WorkspaceSnapshot {
  return service.startRun(input, 'complete');
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
