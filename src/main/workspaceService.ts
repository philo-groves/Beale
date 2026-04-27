import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { priorityFactorLabels, scorePriority, type PriorityFactors } from './discoveryScoring';
import { FakeRunEngine } from './fakeRunEngine';
import { WorkspaceDatabase } from './database';
import { OpenAiResponsesAdapter } from './openaiAdapter';
import { OpenAiAuthService } from './openaiAuth';
import { OpenAiRunEngine } from './openaiRunEngine';
import { ExecutorManager } from './executorManager';
import { ExecutorRunEngine } from './executorRunEngine';
import { BenchmarkRunner } from './benchmarkRunner';
import { ProgramRegistry } from './programRegistry';
import { redactForModelText, redactJsonForModel } from './redaction';
import { isRealVerifierPass, runVerifierContract } from './verifierRunner';
import type {
  AttemptRecord,
  BenchmarkRunInput,
  FakeScenario,
  FindingRecord,
  HackerOneProgramLookupResult,
  HypothesisRecord,
  PriorityFactorInput,
  ProgramDirectorySelection,
  ProgramOnboardingInput,
  ProgramRegistryState,
  ProgramScopeDraft,
  ProgramScopeVersion,
  RunDetail,
  ScopeAssetInput,
  StartRunInput,
  SteeringAction,
  VerifierContractRecord,
  VmContextRecord,
  WorkspaceExportResult,
  HostEnvironment,
  WorkspacePolicyReview,
  WorkspaceRecoveryReport,
  WorkspaceSnapshot,
  WorkspaceSummary
} from '@shared/types';

const FAKE_EXECUTOR_LABEL = 'Simulated engine and fake VM executor. No target code execution.';
type DisclosureExportKind = 'evidence_bundle' | 'finding_bundle' | 'redacted_trace' | 'report_draft';

const HACKERONE_PROGRAM_QUERY = `
  query BealeProgram($handle: String!) {
    team(handle: $handle) {
      handle
      name
      url
      policy
      submission_state
      structured_scopes(first: 100) {
        total_count
        nodes {
          asset_type
          asset_identifier
          instruction
          eligible_for_bounty
          eligible_for_submission
          max_severity
          url
        }
      }
    }
  }
`;

interface HackerOneGraphqlResponse {
  data?: {
    team?: HackerOneTeam | null;
  };
  errors?: Array<{ message: string }>;
}

interface HackerOneTeam {
  handle: string;
  name: string;
  url: string;
  policy: string | null;
  submission_state: string | null;
  structured_scopes?: {
    total_count?: number | null;
    nodes?: HackerOneScopeNode[];
  } | null;
}

interface HackerOneScopeNode {
  asset_type: string | null;
  asset_identifier: string | null;
  instruction: string | null;
  eligible_for_bounty: boolean | null;
  eligible_for_submission: boolean | null;
  max_severity: string | null;
  url: string | null;
}

export function getHostEnvironment(): HostEnvironment {
  const platform = hostPlatform(process.platform);
  const kernelRelease = platform === 'linux' ? release().toLowerCase() : '';
  const procVersion = platform === 'linux' ? safeReadText('/proc/version').toLowerCase() : '';
  const explicitWslName = process.env.WSL_DISTRO_NAME?.trim() || null;
  const isWsl =
    platform === 'linux' &&
    Boolean(
      explicitWslName ||
        process.env.WSL_INTEROP ||
        kernelRelease.includes('microsoft') ||
        kernelRelease.includes('wsl') ||
        procVersion.includes('microsoft') ||
        procVersion.includes('wsl')
    );
  return {
    platform,
    isWsl,
    remoteName: isWsl ? explicitWslName ?? linuxDistributionName() ?? 'WSL' : null
  };
}

export interface WorkspaceServiceOptions {
  benchmarkDockerCommand?: string;
  programRegistryDirectory?: string;
  hackerOneFetch?: typeof fetch;
}

export class WorkspaceService {
  private db: WorkspaceDatabase | null = null;
  private engine: FakeRunEngine | null = null;
  private openAiEngine: OpenAiRunEngine | null = null;
  private executorManager: ExecutorManager | null = null;
  private executorRunEngine: ExecutorRunEngine | null = null;
  private benchmarkRunner: BenchmarkRunner | null = null;
  private readonly openAiAuth = new OpenAiAuthService();
  private programRegistry: ProgramRegistry | null = null;
  private workspacePath: string | null = null;
  private openedAt: string | null = null;
  private lastRecovery: WorkspaceRecoveryReport | null = null;

  public constructor(
    private readonly onChange: () => void = () => undefined,
    private readonly options: WorkspaceServiceOptions = {}
  ) {}

  public openWorkspace(path: string): WorkspaceSnapshot {
    return this.open(path, false);
  }

  public createWorkspace(path: string): WorkspaceSnapshot {
    return this.open(path, true);
  }

  public getProgramRegistryState(): ProgramRegistryState {
    return this.getProgramRegistry().getState();
  }

  public inspectProgramDirectory(path: string): ProgramDirectorySelection {
    return this.getProgramRegistry().inspectDirectory(path);
  }

  public async lookupHackerOneProgram(identifier: string): Promise<HackerOneProgramLookupResult> {
    requireOpenAiAuthenticationForHackerOneImport(this.openAiAuth);
    const handle = normalizeHackerOneIdentifier(identifier);
    if (!handle) {
      throw new Error('HackerOne program identifier is required.');
    }

    const response = await (this.options.hackerOneFetch ?? fetch)('https://hackerone.com/graphql', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'Beale/0.1 local program onboarding'
      },
      body: JSON.stringify({
        query: HACKERONE_PROGRAM_QUERY,
        variables: { handle }
      })
    });
    if (!response.ok) {
      throw new Error(`HackerOne lookup failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as HackerOneGraphqlResponse;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join('; '));
    }
    const team = payload.data?.team;
    if (!team) {
      throw new Error(`HackerOne program not found: ${handle}`);
    }

    const scopeNodes = team.structured_scopes?.nodes ?? [];
    const assets = scopeNodes.map(hackerOneScopeToAsset).filter((asset): asset is NonNullable<ReturnType<typeof hackerOneScopeToAsset>> => Boolean(asset));
    const sourceUrl = team.url || `https://hackerone.com/${team.handle}`;
    return {
      handle: team.handle,
      sourceUrl,
      programName: team.name,
      organizationName: team.name,
      descriptionMarkdown: [`HackerOne program: ${team.name}`, sourceUrl, team.submission_state ? `Submission state: ${team.submission_state}` : ''].filter(Boolean).join('\n'),
      rulesMarkdown: buildHackerOneRulesMarkdown(team.policy, sourceUrl, scopeNodes.length, team.structured_scopes?.total_count ?? scopeNodes.length),
      networkProfile: assets.some((asset) => asset.direction === 'in_scope') ? 'scoped' : 'offline',
      expiresAt: null,
      assets,
      importedScopeCount: assets.length
    };
  }

  public createProgram(input: ProgramOnboardingInput): WorkspaceSnapshot {
    this.getProgramRegistry();
    if (hasHackerOneImportedAssets(input.assets)) {
      requireOpenAiAuthenticationForHackerOneImport(this.openAiAuth);
    }
    const workspacePath = resolve(input.workspacePath);
    const programName = input.programName.trim();
    if (!programName) {
      throw new Error('Program name is required.');
    }

    this.open(workspacePath, true, false);
    this.requireDb().saveProgramScope({
      programName,
      organizationName: input.organizationName.trim(),
      descriptionMarkdown: input.descriptionMarkdown.trim(),
      rulesMarkdown: input.rulesMarkdown.trim(),
      networkProfile: input.networkProfile.trim() || 'offline',
      expiresAt: optionalDateOrNever(input.expiresAt),
      assets: input.assets ?? []
    });
    this.emitChange();
    return this.requireSnapshot();
  }

  public openProgram(programId: string): WorkspaceSnapshot {
    const program = this.getProgramRegistry().getProgram(programId);
    if (!program) {
      throw new Error(`Program not found: ${programId}`);
    }
    return this.open(program.workspacePath, false);
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
      recovery: this.lastRecovery ?? emptyRecoveryReport(this.openedAt),
      policyReview: buildPolicyReview(this.db.getActiveScope()),
      runs: this.db.listRunRows(),
      benchmark: this.requireBenchmarkRunner().getOverview()
    };
  }

  public refreshOpenAiStatus(): WorkspaceSnapshot {
    this.openAiAuth.clearCachedCredential();
    this.emitChange();
    return this.requireSnapshot();
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

  public async runBenchmarkSuite(input: BenchmarkRunInput): Promise<WorkspaceSnapshot> {
    await this.requireBenchmarkRunner().runSuite(input);
    this.emitChange();
    return this.requireSnapshot();
  }

  public exportWorkspaceBackup(note = ''): WorkspaceSnapshot {
    const result = this.createWorkspaceBackup(note);
    this.requireDb().recordWorkspaceBackup(result);
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
      case 'restart_from_snapshot': {
        const detail = db.getRunDetail(action.runId);
        const vmContext = selectVmContext(detail, attempt, undefined);
        const snapshotRef = action.snapshotRef?.trim() || vmContext.snapshotId || 'clean';
        const previousState = vmContext.state;
        if (shouldUseRealVmProvider(vmContext)) {
          const executor = this.requireExecutorManager();
          if (executor.getStatus().available && attempt) {
            executor.revertContext({ run, attempt, vmContext }, snapshotRef);
          } else {
            db.updateVmContext(vmContext.id, {
              snapshotId: snapshotRef,
              state: 'clean',
              metadata: { restartedFromSnapshot: snapshotRef, previousState, providerUnavailable: true }
            });
          }
        } else {
          db.updateVmContext(vmContext.id, {
            snapshotId: snapshotRef,
            state: 'clean',
            metadata: { restartedFromSnapshot: snapshotRef, previousState, simulatedRestart: true }
          });
        }
        if (attempt && (run.status === 'paused' || run.status === 'blocked')) {
          db.updateAttemptState(attempt.id, 'active', `Restarted from VM snapshot ${snapshotRef}.`);
          db.updateRunStatus(action.runId, 'active', `Restarted from VM snapshot ${snapshotRef}.`);
        }
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'vm_event',
          source: 'user',
          summary: 'Run restarted from VM snapshot by user.',
          payload: {
            vmContextId: vmContext.id,
            snapshotRef,
            previousState,
            note: redactForModelText(action.note ?? '')
          },
          vmContextId: vmContext.id,
          modelVisible: false
        });
        break;
      }
      case 'update_run_budget': {
        const previousBudget = run.budget;
        const updated = db.updateRunBudget(action.runId, action.budgetPatch);
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'user_note',
          source: 'user',
          summary: 'Run budget updated by user.',
          payload: {
            previousBudget,
            nextBudget: updated.budget,
            note: redactForModelText(action.note ?? '')
          },
          modelVisible: false
        });
        break;
      }
      case 'rerun_verifier': {
        const contract = requireVerifierContract(db.getRunDetail(action.runId), action.verifierContractId);
        runVerifierContract(db, this.requireExecutorManager(), action.runId, contract, attempt?.id ?? null, attempt?.vmContextId ?? null, action.note ?? '');
        break;
      }
      case 'edit_verifier_contract': {
        const contract = requireVerifierContract(db.getRunDetail(action.runId), action.verifierContractId);
        const updated = db.updateVerifierContract(contract.id, { ...action.patch, status: 'edited' });
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'verifier_result',
          source: 'user',
          summary: 'Verifier contract edited by user.',
          payload: {
            contractId: updated.id,
            status: updated.status,
            editedFields: Object.keys(action.patch),
            note: redactForModelText(action.note ?? '')
          },
          vmContextId: attempt?.vmContextId ?? null,
          modelVisible: false
        });
        break;
      }
      case 'review_verifier_contract': {
        const contract = requireVerifierContract(db.getRunDetail(action.runId), action.verifierContractId);
        const updated = db.updateVerifierContract(contract.id, { status: action.decision });
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'verifier_result',
          source: 'user',
          summary: `Verifier contract ${action.decision} by user.`,
          payload: {
            contractId: updated.id,
            decision: action.decision,
            note: redactForModelText(action.note ?? '')
          },
          vmContextId: attempt?.vmContextId ?? null,
          modelVisible: false
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
      case 'mark_disclosure_ready': {
        requireFinding(db.getRunDetail(action.runId), action.findingId);
        db.updateFindingState(action.findingId, 'disclosure_ready');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'finding_event',
          source: 'user',
          summary: 'Finding marked disclosure ready by user.',
          payload: { findingId: action.findingId, note: redactForModelText(action.note ?? '') },
          vmContextId: attempt?.vmContextId ?? null,
          modelVisible: false
        });
        break;
      }
      case 'mark_needs_more_evidence': {
        requireFinding(db.getRunDetail(action.runId), action.findingId);
        db.updateFindingState(action.findingId, 'needs_evidence');
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'finding_event',
          source: 'user',
          summary: 'Finding marked as needing more evidence by user.',
          payload: { findingId: action.findingId, note: redactForModelText(action.note ?? '') },
          vmContextId: attempt?.vmContextId ?? null,
          modelVisible: false
        });
        break;
      }
      case 'export_evidence_bundle': {
        this.exportEvidenceBundle(action.runId, action.findingId ?? null, action.note ?? '', attempt?.id ?? null, attempt?.vmContextId ?? null);
        break;
      }
      case 'export_finding_bundle': {
        this.exportDisclosureArtifact('finding_bundle', action.runId, action.findingId ?? null, action.note ?? '', attempt?.id ?? null, attempt?.vmContextId ?? null);
        break;
      }
      case 'export_redacted_trace': {
        this.exportDisclosureArtifact('redacted_trace', action.runId, action.findingId ?? null, action.note ?? '', attempt?.id ?? null, attempt?.vmContextId ?? null);
        break;
      }
      case 'generate_report_draft': {
        this.exportDisclosureArtifact('report_draft', action.runId, action.findingId ?? null, action.note ?? '', attempt?.id ?? null, attempt?.vmContextId ?? null);
        break;
      }
      case 'review_export': {
        requireExport(db.getRunDetail(action.runId), action.exportId);
        const exportRecord = db.updateExportReview(action.exportId, action.decision, redactForModelText(action.note ?? ''));
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'artifact_created',
          source: 'user',
          summary: `Export review recorded: ${action.decision}.`,
          payload: {
            exportId: exportRecord.id,
            relativePath: exportRecord.relativePath,
            decision: action.decision,
            note: redactForModelText(action.note ?? ''),
            userReviewRequired: action.decision !== 'approved'
          },
          vmContextId: attempt?.vmContextId ?? null,
          modelVisible: false
        });
        break;
      }
      case 'preserve_vm': {
        const detail = db.getRunDetail(action.runId);
        const vmContext = selectVmContext(detail, attempt, action.vmContextId);
        const reason = redactForModelText(action.reason ?? 'User requested VM preservation for review.');
        if (vmContext.state !== 'destroyed' && shouldUseRealVmProvider(vmContext) && this.requireExecutorManager().getStatus().available && attempt) {
          this.requireExecutorManager().preserveContext({ run, attempt, vmContext }, reason);
        } else {
          db.updateVmContext(vmContext.id, {
            state: vmContext.state === 'destroyed' ? 'destroyed' : 'preserved',
            metadata: {
              preserveReason: reason,
              preservedByUser: vmContext.state !== 'destroyed',
              previousState: vmContext.state,
              providerSkipped: !shouldUseRealVmProvider(vmContext)
            }
          });
          db.appendTraceEvent({
            runId: action.runId,
            attemptId: attempt?.id ?? null,
            type: 'vm_event',
            source: 'user',
            summary: vmContext.state === 'destroyed' ? 'VM preserve request recorded for already-destroyed context.' : 'VM context preserved by explicit request.',
            payload: { vmContextId: vmContext.id, reason, previousState: vmContext.state },
            vmContextId: vmContext.id,
            modelVisible: false
          });
        }
        break;
      }
      case 'destroy_vm': {
        const detail = db.getRunDetail(action.runId);
        const vmContext = selectVmContext(detail, attempt, action.vmContextId);
        const reason = redactForModelText(action.reason ?? 'User requested VM destruction.');
        if (vmContext.state !== 'destroyed' && shouldUseRealVmProvider(vmContext) && this.requireExecutorManager().getStatus().available && attempt) {
          this.requireExecutorManager().destroyContext({ run, attempt, vmContext });
        } else {
          db.updateVmContext(vmContext.id, {
            state: 'destroyed',
            metadata: {
              destroyReason: reason,
              destroyedByUser: true,
              previousState: vmContext.state,
              providerSkipped: !shouldUseRealVmProvider(vmContext)
            }
          });
          db.appendTraceEvent({
            runId: action.runId,
            attemptId: attempt?.id ?? null,
            type: 'vm_event',
            source: 'user',
            summary: 'VM context destroyed.',
            payload: { vmContextId: vmContext.id, reason, previousState: vmContext.state },
            vmContextId: vmContext.id,
            modelVisible: false
          });
        }
        break;
      }
      case 'review_policy_request': {
        const approval = db.createApproval({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          requestKind: action.requestKind,
          requestedAction: redactObject(action.requestedAction),
          decision: action.decision,
          reason: redactForModelText(action.note ?? `${action.decision} ${action.requestKind}`)
        });
        db.appendTraceEvent({
          runId: action.runId,
          attemptId: attempt?.id ?? null,
          type: 'approval_event',
          source: 'policy',
          summary: `Policy request ${action.decision}: ${action.requestKind}.`,
          payload: {
            approvalId: approval.id,
            requestKind: action.requestKind,
            decision: action.decision,
            requestedAction: redactObject(action.requestedAction),
            note: redactForModelText(action.note ?? ''),
            scopedApproval: true
          },
          approvalId: approval.id,
          vmContextId: attempt?.vmContextId ?? null,
          modelVisible: false
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
    this.benchmarkRunner = null;
    this.workspacePath = null;
    this.openedAt = null;
    this.lastRecovery = null;
  }

  public dispose(): void {
    this.close();
    this.programRegistry?.close();
    this.programRegistry = null;
  }

  private open(path: string, create: boolean, emitChange = true): WorkspaceSnapshot {
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
    this.lastRecovery = this.db.recoverInterruptedState('workspace_open');
    this.engine = new FakeRunEngine(this.db, () => this.emitChange());
    this.executorManager = new ExecutorManager(this.db);
    this.openAiEngine = new OpenAiRunEngine(this.db, this.openAiAuth, new OpenAiResponsesAdapter(this.openAiAuth), this.executorManager, () => this.emitChange());
    this.executorRunEngine = new ExecutorRunEngine(this.db, this.executorManager, () => this.emitChange());
    this.benchmarkRunner = new BenchmarkRunner(this.db, workspacePath, this.options.benchmarkDockerCommand);
    if (emitChange) this.emitChange();
    return this.requireSnapshot();
  }

  private getProgramRegistry(): ProgramRegistry {
    if (!this.programRegistry) {
      this.programRegistry = new ProgramRegistry(this.options.programRegistryDirectory);
    }
    return this.programRegistry;
  }

  private syncProgramRegistry(): void {
    if (!this.programRegistry) return;
    const snapshot = this.getSnapshot();
    if (snapshot) {
      this.programRegistry.syncWorkspace(snapshot);
    }
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

  private requireBenchmarkRunner(): BenchmarkRunner {
    if (!this.benchmarkRunner) {
      throw new Error('No benchmark runner is available');
    }
    return this.benchmarkRunner;
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
      fakeExecutorLabel: FAKE_EXECUTOR_LABEL,
      lastWorkspaceBackup: db.getLastWorkspaceBackup(),
      hostEnvironment: getHostEnvironment()
    };
  }

  private emitChange(): void {
    this.syncProgramRegistry();
    this.onChange();
  }

  private exportEvidenceBundle(runId: string, findingId: string | null, note: string, attemptId: string | null, vmContextId: string | null): void {
    this.exportDisclosureArtifact('evidence_bundle', runId, findingId, note, attemptId, vmContextId);
  }

  private exportDisclosureArtifact(kind: DisclosureExportKind, runId: string, findingId: string | null, note: string, attemptId: string | null, vmContextId: string | null): void {
    const db = this.requireDb();
    if (!this.workspacePath) throw new Error('No Beale workspace is open');
    const detail = db.getRunDetail(runId);
    const finding = findingId ? requireFinding(detail, findingId) : detail.findings[0] ?? null;
    const markdown = buildDisclosureMarkdown(kind, detail, finding, note);
    const exportDir = join(this.workspacePath, '.beale', 'exports');
    mkdirSync(exportDir, { recursive: true });
    const fileName = `${sanitizeFileSegment(detail.run.title)}-${finding ? sanitizeFileSegment(finding.id) : 'run'}-${exportKindFileSuffix(kind)}.md`;
    const relativePath = join('.beale', 'exports', fileName).replace(/\\/g, '/');
    writeFileAtomic(join(this.workspacePath, relativePath), markdown);
    const artifact = db.createArtifact({
      kind: `${kind}_export`,
      mimeType: 'text/markdown',
      sensitivity: 'internal',
      modelVisible: false,
      source: 'report',
      metadata: {
        name: fileName,
        findingId: finding?.id ?? null,
        exportKind: kind,
        exportRelativePath: relativePath,
        disclosureDraft: kind !== 'redacted_trace',
        redactionReview: {
          redactionApplied: true,
          userReviewRequired: true,
          modelVisible: false,
          obviousSecretPatternsRedacted: true
        }
      },
      content: markdown
    });
    const exportId = db.createExportRecord({
      runId,
      findingId: finding?.id ?? null,
      kind,
      relativePath,
      redactionPolicy: { modelVisible: false, redactionApplied: true, userReviewRequired: true, obviousSecretPatternsRedacted: true },
      includedArtifacts: { artifactIds: detail.artifacts.map((item) => item.id), bundleArtifactId: artifact.id, exportKind: kind }
    });
    const event = db.appendTraceEvent({
      runId,
      attemptId,
      type: 'artifact_created',
      source: 'system',
      summary: exportKindSummary(kind),
      payload: {
        artifactId: artifact.id,
        exportId,
        relativePath,
        findingId: finding?.id ?? null,
        note: redactForModelText(note)
      },
      artifactId: artifact.id,
      vmContextId,
      modelVisible: false
    });
    db.setArtifactProvenance(artifact.id, event.id);
  }

  private createWorkspaceBackup(note: string): WorkspaceExportResult {
    const db = this.requireDb();
    if (!this.workspacePath) throw new Error('No Beale workspace is open');
    db.checkpoint();
    const createdAt = new Date().toISOString();
    const exportDir = join(this.workspacePath, '.beale', 'exports');
    mkdirSync(exportDir, { recursive: true });
    const fileName = `${sanitizeFileSegment(this.getWorkspaceSummary().workspaceId)}-workspace-backup-${fileTimestamp(createdAt)}.tar.gz`;
    const relativePath = join('.beale', 'exports', fileName).replace(/\\/g, '/');
    const absolutePath = join(this.workspacePath, relativePath);
    const tempArchivePath = `${absolutePath}.tmp`;
    const stageRoot = mkdtempSync(join(tmpdir(), 'beale-workspace-backup-'));
    const stageWorkspace = join(stageRoot, 'workspace');
    try {
      cpSync(this.workspacePath, stageWorkspace, {
        recursive: true,
        filter: (source) => shouldIncludeInWorkspaceBackup(this.workspacePath ?? '', source)
      });
      const manifest = {
        kind: 'workspace_backup',
        product: 'Beale',
        workspaceId: db.getWorkspaceId(),
        createdAt,
        note: redactForModelText(note),
        includesSensitiveData: true,
        redactionApplied: false,
        userReviewRequired: true,
        databasePath: '.beale/beale.sqlite',
        excludedTransientPaths: ['.beale/firecracker/state', '.beale/firecracker/run', '.beale/exports/*-workspace-backup-*.tar.gz']
      };
      writeFileSync(join(stageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      writeTarGzArchive(stageRoot, tempArchivePath);
      renameSync(tempArchivePath, absolutePath);
      return {
        kind: 'workspace_backup',
        relativePath,
        absolutePath,
        createdAt,
        includesSensitiveData: true,
        redactionApplied: false,
        userReviewRequired: true,
        manifest
      };
    } finally {
      rmSync(tempArchivePath, { force: true });
      rmSync(stageRoot, { recursive: true, force: true });
    }
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

function requireVerifierContract(detail: RunDetail, verifierContractId: string): VerifierContractRecord {
  const contract = detail.verifierContracts.find((item) => item.id === verifierContractId);
  if (!contract) throw new Error(`Verifier contract not found: ${verifierContractId}`);
  return contract;
}

function requireExport(detail: RunDetail, exportId: string) {
  const exportRecord = detail.exports.find((item) => item.id === exportId);
  if (!exportRecord) throw new Error(`Export not found: ${exportId}`);
  return exportRecord;
}

function selectVmContext(detail: RunDetail, attempt: AttemptRecord | null, vmContextId: string | undefined): VmContextRecord {
  const selectedId = vmContextId ?? attempt?.vmContextId ?? null;
  const selected = selectedId ? detail.vmContexts.find((item) => item.id === selectedId) : null;
  const vmContext = selected ?? detail.vmContexts[0] ?? null;
  if (!vmContext) throw new Error(`No VM context found for run: ${detail.run.id}`);
  return vmContext;
}

function shouldUseRealVmProvider(vmContext: VmContextRecord): boolean {
  return vmContext.backend === 'vmctl' || vmContext.metadata.executor === 'vmctl' || vmContext.metadata.targetExecution === true;
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactJsonForModel(value);
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted) ? (redacted as Record<string, unknown>) : {};
}

function latestVerifierForHypothesis(detail: RunDetail, hypothesisId: string, status: string) {
  const contractIds = new Set(detail.verifierContracts.filter((contract) => contract.hypothesisId === hypothesisId).map((contract) => contract.id));
  return [...detail.verifierRuns]
    .reverse()
    .find((run) => contractIds.has(run.contractId) && run.status === status && (status !== 'pass' || isRealVerifierPass(run))) ?? null;
}

function buildDisclosureMarkdown(kind: DisclosureExportKind, detail: RunDetail, finding: FindingRecord | null, note: string): string {
  switch (kind) {
    case 'evidence_bundle':
      return buildEvidenceBundleMarkdown(detail, finding, note);
    case 'finding_bundle':
      return buildFindingBundleMarkdown(detail, finding, note);
    case 'redacted_trace':
      return buildRedactedTraceMarkdown(detail, finding, note);
    case 'report_draft':
      return buildReportDraftMarkdown(detail, finding, note);
  }
}

function exportKindFileSuffix(kind: DisclosureExportKind): string {
  switch (kind) {
    case 'evidence_bundle':
      return 'evidence';
    case 'finding_bundle':
      return 'finding-bundle';
    case 'redacted_trace':
      return 'redacted-trace';
    case 'report_draft':
      return 'report-draft';
  }
}

function exportKindSummary(kind: DisclosureExportKind): string {
  switch (kind) {
    case 'evidence_bundle':
      return 'Evidence bundle export created.';
    case 'finding_bundle':
      return 'Finding bundle export created.';
    case 'redacted_trace':
      return 'Redacted trace export created.';
    case 'report_draft':
      return 'Report draft export created.';
  }
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
    .map((event) => `- #${event.sequence} ${event.source}/${event.type}: ${redactForModelText(event.summary)}${event.artifactId ? ` artifact=${event.artifactId}` : ''}`)
    .join('\n');

  return [
    `# Evidence Bundle: ${redactForModelText(detail.run.title)}`,
    '',
    '## Disclosure Draft',
    finding ? `Finding: ${redactForModelText(finding.title)}` : 'Finding: run-level evidence bundle',
    finding ? `State: ${finding.state}` : `Run status: ${detail.run.status}`,
    finding ? `Priority: ${finding.priorityScore.toFixed(2)}` : '',
    verified,
    note ? `Reviewer note: ${redactForModelText(note)}` : '',
    '',
    '## Summary',
    redactForModelText(finding?.summaryMarkdown ?? detail.run.summary),
    '',
    '## Impact',
    redactForModelText(finding?.impactMarkdown ?? 'Impact not promoted to a finding yet.'),
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
    '## Redaction Review',
    'Obvious secret patterns were redacted before writing this export.',
    'The bundle may still contain sensitive vulnerability details and requires user review before disclosure.',
    '',
    '## Review Notes',
    'Generated by Beale as a candidate evidence bundle. User review is required before disclosure.'
  ].join('\n');
}

function buildFindingBundleMarkdown(detail: RunDetail, finding: FindingRecord | null, note: string): string {
  const selectedFinding = finding ?? detail.findings[0] ?? null;
  const hypothesis = selectedFinding?.hypothesisId ? detail.hypotheses.find((item) => item.id === selectedFinding.hypothesisId) ?? null : null;
  const contracts = detail.verifierContracts.filter((contract) => contract.findingId === selectedFinding?.id || contract.hypothesisId === selectedFinding?.hypothesisId);
  const verifierRuns = detail.verifierRuns.filter((run) => contracts.some((contract) => contract.id === run.contractId));
  return [
    `# Finding Bundle: ${redactForModelText(selectedFinding?.title ?? detail.run.title)}`,
    '',
    '## Review State',
    selectedFinding ? `Finding state: ${selectedFinding.state}` : 'Finding state: no finding selected',
    selectedFinding ? `Priority: ${selectedFinding.priorityScore.toFixed(2)}` : '',
    selectedFinding?.verifiedByVerifierRunId ? `Verified by: ${selectedFinding.verifiedByVerifierRunId}` : 'Verified by: none',
    note ? `Reviewer note: ${redactForModelText(note)}` : '',
    '',
    '## Finding Summary',
    redactForModelText(selectedFinding?.summaryMarkdown ?? detail.run.summary),
    '',
    '## Impact',
    redactForModelText(selectedFinding?.impactMarkdown ?? 'Impact not promoted to a finding yet.'),
    '',
    '## Scope and Assets',
    codeBlockJson(redactJsonForModel(selectedFinding?.affectedAssets ?? { runNetworkProfile: detail.run.networkProfile })),
    '',
    '## Hypothesis',
    hypothesis ? `${redactForModelText(hypothesis.title)}\n\n${redactForModelText(hypothesis.descriptionMarkdown)}` : 'No linked hypothesis.',
    '',
    '## Verifier Contracts',
    contracts.map((contract) => `- ${contract.id}: ${contract.mode}, status=${contract.status}`).join('\n') || 'No verifier contracts linked.',
    '',
    '## Verifier Runs',
    verifierRuns.map((run) => `- ${run.id}: ${run.status}, real=${String(run.result.realExecution === true)}, vm=${String(run.result.vmExecution === true)}`).join('\n') || 'No verifier runs linked.',
    '',
    '## Evidence Artifacts',
    detail.artifacts.map((artifact) => `- ${artifact.id}: ${artifact.kind}, sha256=${artifact.sha256}, path=${artifact.relativePath}`).join('\n') || 'No artifacts recorded.',
    '',
    '## Redaction Review',
    'Obvious secret patterns were redacted before writing this export. User review is required before disclosure.'
  ].join('\n');
}

function buildReportDraftMarkdown(detail: RunDetail, finding: FindingRecord | null, note: string): string {
  const selectedFinding = finding ?? detail.findings[0] ?? null;
  return [
    `# Report Draft: ${redactForModelText(selectedFinding?.title ?? detail.run.title)}`,
    '',
    '## Summary',
    redactForModelText(selectedFinding?.summaryMarkdown ?? detail.run.summary),
    '',
    '## Affected Assets',
    codeBlockJson(redactJsonForModel(selectedFinding?.affectedAssets ?? { networkProfile: detail.run.networkProfile })),
    '',
    '## Impact',
    redactForModelText(selectedFinding?.impactMarkdown ?? 'Impact requires more evidence before disclosure.'),
    '',
    '## Reproduction Evidence',
    selectedFinding?.verifiedByVerifierRunId ? `Verifier run ${selectedFinding.verifiedByVerifierRunId} is the authoritative verification record.` : 'No passing real verifier run is linked yet.',
    '',
    '## Supporting Artifacts',
    detail.artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.relativePath} (${artifact.sha256})`).join('\n') || 'No supporting artifacts recorded.',
    '',
    '## Reviewer Notes',
    note ? redactForModelText(note) : 'No reviewer note provided.',
    '',
    '## Disclosure Review',
    'This is a draft generated by Beale. Review scope, redactions, reproduction steps, and evidence before disclosure.'
  ].join('\n');
}

function buildRedactedTraceMarkdown(detail: RunDetail, finding: FindingRecord | null, note: string): string {
  const events = detail.traceEvents.map((event) => ({
    sequence: event.sequence,
    type: event.type,
    source: event.source,
    summary: redactForModelText(event.summary),
    payload: redactJsonForModel(event.payload),
    artifactId: event.artifactId,
    vmContextId: event.vmContextId,
    modelVisible: event.modelVisible,
    createdAt: event.createdAt
  }));
  return [
    `# Redacted Trace: ${redactForModelText(detail.run.title)}`,
    '',
    '## Scope',
    finding ? `Finding: ${redactForModelText(finding.title)} (${finding.id})` : 'Run-level trace export.',
    note ? `Reviewer note: ${redactForModelText(note)}` : '',
    '',
    '## Redaction Policy',
    'Obvious secret patterns and structured secret fields were redacted. User review is required before disclosure.',
    '',
    '## Events',
    codeBlockJson(events)
  ].join('\n');
}

function codeBlockJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

function emptyRecoveryReport(openedAt: string | null): WorkspaceRecoveryReport {
  return {
    recoveredAt: openedAt ?? new Date().toISOString(),
    reason: 'workspace_open',
    interruptedRuns: 0,
    interruptedAttempts: 0,
    interruptedModelSessions: 0,
    interruptedToolCalls: 0,
    interruptedVerifierRuns: 0,
    interruptedVmContexts: 0,
    interruptedBenchmarkRuns: 0,
    notes: ['No interrupted authoritative state found.']
  };
}

function buildPolicyReview(scope: ProgramScopeVersion): WorkspacePolicyReview {
  const inScope = scope.assets.filter((asset) => asset.direction === 'in_scope');
  const outOfScope = scope.assets.filter((asset) => asset.direction === 'out_of_scope');
  const localImportAssetCount = inScope.filter((asset) => ['path', 'repo', 'binary', 'documentation', 'other'].includes(asset.kind)).length;
  const credentialReferenceCount = inScope.filter((asset) => asset.kind === 'credential_ref' || asset.kind === 'account').length;
  const allowedDestinations = inScope
    .filter((asset) => ['domain', 'host', 'ip_range', 'service'].includes(asset.kind))
    .map((asset) => asset.value);
  const warnings: string[] = [];
  if (inScope.length === 0) warnings.push('No in-scope assets are recorded.');
  if (scope.networkProfile !== 'offline' && allowedDestinations.length === 0) {
    warnings.push('Network profile is not offline, but no scoped network destinations are recorded.');
  }
  if (credentialReferenceCount > 0) warnings.push('Credential references require explicit host-side approval before injection.');
  if (outOfScope.length === 0) warnings.push('No explicit out-of-scope assets are recorded.');
  return {
    networkProfile: scope.networkProfile,
    inScopeAssetCount: inScope.length,
    outOfScopeAssetCount: outOfScope.length,
    localImportAssetCount,
    credentialReferenceCount,
    allowedDestinations,
    warnings,
    liveTargetAllowed: scope.networkProfile !== 'offline' && allowedDestinations.length > 0,
    liveTargetTestingRequiresApproval: scope.networkProfile !== 'offline',
    credentialInjectionRequiresApproval: credentialReferenceCount > 0
  };
}

function writeFileAtomic(path: string, content: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, content, { flag: 'wx' });
  if (process.env.BEALE_TEST_FAIL_ATOMIC_EXPORT === 'before_rename') {
    rmSync(tempPath, { force: true });
    throw new Error('Injected atomic export failure before rename.');
  }
  renameSync(tempPath, path);
}

function writeTarGzArchive(sourceRoot: string, destinationPath: string): void {
  const chunks: Buffer[] = [];
  for (const absolutePath of listArchiveEntries(sourceRoot)) {
    const rel = `./${relative(sourceRoot, absolutePath).replace(/\\/g, '/')}`;
    const stat = lstatSync(absolutePath);
    if (stat.isDirectory()) {
      chunks.push(tarHeader(rel.endsWith('/') ? rel : `${rel}/`, 0, stat.mode, stat.mtime, '5'));
    } else if (stat.isSymbolicLink()) {
      chunks.push(tarHeader(rel, 0, stat.mode, stat.mtime, '2', readlinkSync(absolutePath)));
    } else if (stat.isFile()) {
      const content = readFileSync(absolutePath);
      chunks.push(tarHeader(rel, content.byteLength, stat.mode, stat.mtime, '0'));
      chunks.push(content);
      chunks.push(Buffer.alloc(tarPadding(content.byteLength)));
    }
  }
  chunks.push(Buffer.alloc(1024));
  writeFileSync(destinationPath, gzipSync(Buffer.concat(chunks)), { flag: 'wx' });
}

function listArchiveEntries(root: string): string[] {
  const entries: string[] = [];
  function visit(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const absolutePath = join(dir, name);
      entries.push(absolutePath);
      if (lstatSync(absolutePath).isDirectory()) visit(absolutePath);
    }
  }
  visit(root);
  return entries;
}

function tarHeader(name: string, size: number, mode: number, mtime: Date, typeflag: '0' | '2' | '5', linkname = ''): Buffer {
  const header = Buffer.alloc(512, 0);
  const splitName = splitTarName(name);
  writeAscii(header, splitName.name, 0, 100);
  writeOctal(header, mode & 0o7777, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, Math.floor(mtime.getTime() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  writeAscii(header, typeflag, 156, 1);
  writeAscii(header, linkname, 157, 100);
  writeAscii(header, 'ustar', 257, 6);
  writeAscii(header, '00', 263, 2);
  writeAscii(header, 'beale', 265, 32);
  writeAscii(header, 'beale', 297, 32);
  writeAscii(header, splitName.prefix, 345, 155);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const encoded = checksum.toString(8).padStart(6, '0');
  writeAscii(header, encoded, 148, 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitTarName(path: string): { name: string; prefix: string } {
  const normalized = path.replace(/\\/g, '/');
  if (Buffer.byteLength(normalized) <= 100) return { name: normalized, prefix: '' };
  for (let index = normalized.lastIndexOf('/'); index > 0; index = normalized.lastIndexOf('/', index - 1)) {
    const prefix = normalized.slice(0, index);
    const name = normalized.slice(index + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`Path is too long for ustar workspace backup: ${normalized}`);
}

function writeAscii(buffer: Buffer, value: string, offset: number, length: number): void {
  buffer.write(value.slice(0, length), offset, length, 'utf8');
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  const encoded = value.toString(8).padStart(length - 1, '0').slice(0, length - 1);
  writeAscii(buffer, encoded, offset, length - 1);
}

function tarPadding(size: number): number {
  const remainder = size % 512;
  return remainder === 0 ? 0 : 512 - remainder;
}

function shouldIncludeInWorkspaceBackup(workspacePath: string, source: string): boolean {
  if (!workspacePath) return false;
  if (!existsSync(source)) return false;
  const rel = relative(workspacePath, source).replace(/\\/g, '/');
  if (!rel) return true;
  if (rel === '.beale/firecracker/state' || rel.startsWith('.beale/firecracker/state/')) return false;
  if (rel === '.beale/firecracker/run' || rel.startsWith('.beale/firecracker/run/')) return false;
  if (/^\.beale\/exports\/.+-workspace-backup-\d{8}t\d{6}z\.tar\.gz(?:\.tmp)?$/i.test(rel)) return false;
  return true;
}

function hostPlatform(value: NodeJS.Platform): HostEnvironment['platform'] {
  if (value === 'linux' || value === 'win32' || value === 'darwin') return value;
  return 'other';
}

function linuxDistributionName(): string | null {
  const osRelease = safeReadText('/etc/os-release');
  const nameMatch = /^NAME=(.+)$/m.exec(osRelease);
  if (!nameMatch) return null;
  return nameMatch[1]?.replace(/^"|"$/g, '').trim() || null;
}

function safeReadText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function optionalDateOrNever(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function requireOpenAiAuthenticationForHackerOneImport(auth: OpenAiAuthService): void {
  if (auth.getStatus().configured) return;
  throw new Error('Authenticate with OpenAI first before looking up or importing HackerOne program information.');
}

function hasHackerOneImportedAssets(assets: ScopeAssetInput[] | undefined): boolean {
  return (assets ?? []).some((asset) => asset.attributes?.source === 'hackerone');
}

function normalizeHackerOneIdentifier(identifier: string): string {
  return identifier
    .trim()
    .replace(/^https?:\/\/(?:www\.)?hackerone\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/, 1)[0]
    .trim();
}

function hackerOneScopeToAsset(scope: HackerOneScopeNode): ScopeAssetInput | null {
  const value = scope.asset_identifier?.trim();
  if (!value) return null;
  const assetType = scope.asset_type?.trim() ?? 'OTHER';
  return {
    direction: scope.eligible_for_submission === false ? 'out_of_scope' : 'in_scope',
    kind: hackerOneAssetKind(assetType, value),
    value,
    sensitivity: 'public',
    attributes: {
      source: 'hackerone',
      assetType,
      instruction: scope.instruction ?? '',
      eligibleForBounty: scope.eligible_for_bounty,
      eligibleForSubmission: scope.eligible_for_submission,
      maxSeverity: scope.max_severity,
      url: scope.url
    }
  };
}

function hackerOneAssetKind(assetType: string, value: string): ScopeAssetInput['kind'] {
  const normalized = assetType.toUpperCase();
  if (normalized.includes('SOURCE')) return 'repo';
  if (normalized.includes('EXECUTABLE') || normalized.includes('BINARY')) return 'binary';
  if (normalized.includes('IP') || /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/.test(value)) return 'ip_range';
  if (normalized.includes('URL') || normalized.includes('DOMAIN') || value.includes('*') || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return 'domain';
  return 'other';
}

function buildHackerOneRulesMarkdown(policy: string | null, sourceUrl: string, importedCount: number, totalCount: number): string {
  const header = [
    `Imported from HackerOne: ${sourceUrl}`,
    `${importedCount} structured scope asset${importedCount === 1 ? '' : 's'} imported${totalCount > importedCount ? ` from the first ${importedCount} of ${totalCount} public scope entries` : ''}.`,
    'Verify current HackerOne scope before testing.'
  ].join('\n');
  return policy?.trim() ? `${header}\n\n${policy.trim()}` : header;
}

function fileTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').toLowerCase();
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
