import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import { ExecutorManager, normalizeNetworkProfile } from './executorManager';
import type { GuestExecuteRequest, GuestExecuteResult } from './executorTypes';
import { executeHostOperation, isHostResearchSandbox } from './hostToolExecutor';
import { redactForModelText } from './redaction';
import type { ScopeAsset, VerifierContractRecord, VerifierRunRecord } from '@shared/types';

interface VerifierExecutionSpec {
  operationKind: 'shell' | 'python';
  command: string[];
  expectedExitCode: number;
  expectedStdoutIncludes: string | null;
  expectedStderrIncludes: string | null;
  artifactPath: string | null;
  timeoutMs: number;
}

export interface VerifierExecutionOutcome {
  verifierRun: VerifierRunRecord;
  traceEventId: string;
  artifactId: string | null;
}

const LOCAL_IMPORT_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['path', 'repo', 'binary', 'documentation', 'other']);

export function runVerifierContract(
  db: WorkspaceDatabase,
  executor: ExecutorManager | null,
  runId: string,
  contract: VerifierContractRecord,
  attemptId: string | null,
  vmContextId: string | null,
  note: string
): VerifierExecutionOutcome {
  const contractIssues = verifierContractIssues(contract);
  const spec = verifierExecutionSpec(contract);
  const issues = [...contractIssues];
  if (!spec) issues.push('missing executable verifier command');

  if (issues.length > 0 || !spec) {
    return recordVerifierFailure(db, runId, contract, attemptId, vmContextId, 'Verifier rerun failed before execution.', {
      issues,
      note: redactForModelText(note)
    });
  }

  const context = verifierContext(db, runId, attemptId, vmContextId);
  if (isHostResearchSandbox(context.run.sandboxProfile)) {
    return runHostVerifierContract(db, runId, contract, context, spec, note);
  }

  if (!executor) {
    return recordVerifierFailure(db, runId, contract, attemptId, vmContextId, 'Verifier execution failed before VM start.', {
      issues: ['Sandbox executor is not available'],
      note: redactForModelText(note)
    });
  }

  const status = executor.getStatus();
  if (!status.available) {
    return recordVerifierFailure(db, runId, contract, attemptId, vmContextId, 'Verifier execution failed before VM start.', {
      issues: [status.reason ?? 'Sandbox executor is not available'],
      note: redactForModelText(note)
    });
  }

  const imageRef = context.vmContext.imageId || 'beale-default-toolchain';
  const snapshotRef = context.vmContext.snapshotId || 'clean';
  let contextCreated = false;
  let exportedArtifactId: string | null = null;

  try {
    executor.createContext(context, imageRef, snapshotRef);
    contextCreated = true;
    executor.cloneContext(context, snapshotRef);

    const importSpec = firstScopedImport(db);
    if (importSpec) {
      executor.importWorkspaceMaterial(context, {
        hostPath: importSpec.hostPath,
        guestPath: '/workspace/target',
        mode: 'read_only'
      });
    }

    const result = executor.executeGuestOperation(context, verifierRequest(context, spec));
    if (spec.artifactPath) {
      if (!status.supports.export) {
        throw new Error('Executor backend does not support guest artifact export.');
      }
      exportedArtifactId = executor.exportArtifact(context, {
        guestPath: spec.artifactPath,
        kind: 'verifier_output',
        mimeType: 'application/octet-stream',
        sensitivity: 'internal',
        modelVisible: true
      });
    }

    const verdict = verifierVerdict(result, spec);
    const verifierRun = db.createVerifierRun({
      contractId: contract.id,
      runId,
      attemptId: context.attempt.id,
      vmContextId: context.vmContext.id,
      status: verdict.status,
      blockedIssue: verifierBlockedIssue(verdict.status),
      behaviorPreserved: contract.mode === 'patch_validation' ? (verdict.status === 'pass' ? 'yes' : 'inconclusive') : 'not_applicable',
      diagnosticsClean: verdict.status === 'pass' ? 'yes' : verdict.status === 'fail' ? 'fail' : 'inconclusive',
      regressionTests: contract.mode === 'patch_validation' && verdict.status === 'pass' ? 'pass' : 'not_run',
      result: {
        realExecution: true,
        vmExecution: true,
        observationBacked: true,
        executorProvider: status.provider,
        execution: {
          substrate: 'disposable_guest_vm',
          operationKind: spec.operationKind,
          expectedExitCode: spec.expectedExitCode,
          expectedStdoutIncludes: spec.expectedStdoutIncludes,
          expectedStderrIncludes: spec.expectedStderrIncludes
        },
        exitCode: result.exitCode,
        status: result.status,
        stdoutSummary: result.stdoutSummary,
        stderrSummary: result.stderrSummary,
        checks: verdict.checks,
        artifactId: exportedArtifactId,
        importedHostPath: importSpec?.hostPath ?? null,
        note: redactForModelText(note)
      }
    });

    if (exportedArtifactId) {
      db.createEvidenceFromArtifact(runId, exportedArtifactId, 'Verifier output artifact from VM execution.', contract.hypothesisId, contract.findingId);
    }
    if (verdict.status === 'pass' && contract.findingId) {
      db.verifyFindingWithVerifierRun(contract.findingId, verifierRun.id);
    }

    const event = db.appendTraceEvent({
      runId,
      attemptId: context.attempt.id,
      type: 'verifier_result',
      source: 'verifier',
      summary: `Verifier contract executed in disposable sandbox with ${verdict.status}.`,
      payload: {
        verifierRunId: verifierRun.id,
        contractId: contract.id,
        status: verdict.status,
        realExecution: true,
        vmExecution: true,
        observationBacked: true,
        artifactId: exportedArtifactId,
        checks: verdict.checks
      },
      artifactId: exportedArtifactId,
      vmContextId: context.vmContext.id
    });
    return { verifierRun, traceEventId: event.id, artifactId: exportedArtifactId };
  } catch (error) {
    return recordVerifierFailure(db, runId, contract, attemptId, vmContextId, 'Verifier execution failed in disposable sandbox.', {
      issues: [errorMessage(error)],
      note: redactForModelText(note),
      realExecution: false,
      vmExecution: true
    });
  } finally {
    if (contextCreated) {
      try {
        executor.destroyContext(context);
      } catch (destroyError) {
        db.updateVmContext(context.vmContext.id, {
          state: 'recovery_pending',
          metadata: {
            recoveryRequired: true,
            destroyFailed: true,
            destroyError: errorMessage(destroyError)
          }
        });
        db.appendTraceEvent({
          runId,
          attemptId: context.attempt.id,
          type: 'vm_event',
          source: 'executor',
          summary: 'Verifier failed to destroy guest after execution.',
          payload: { error: errorMessage(destroyError) },
          vmContextId: context.vmContext.id
        });
      }
    }
  }
}

export function isRealVerifierPass(run: VerifierRunRecord | null | undefined): boolean {
  return run?.status === 'pass' && run.result.realExecution === true && (run.result.vmExecution === true || run.result.hostExecution === true);
}

function runHostVerifierContract(
  db: WorkspaceDatabase,
  runId: string,
  contract: VerifierContractRecord,
  context: CreatedRunContext,
  spec: VerifierExecutionSpec,
  note: string
): VerifierExecutionOutcome {
  try {
    const execution = executeHostOperation(db, context, verifierRequest(context, spec), spec.artifactPath, 'verifier_output');
    const verdict = verifierVerdict(execution.result, spec);
    const verifierRun = db.createVerifierRun({
      contractId: contract.id,
      runId,
      attemptId: context.attempt.id,
      vmContextId: context.vmContext.id,
      status: verdict.status,
      blockedIssue: verifierBlockedIssue(verdict.status),
      behaviorPreserved: contract.mode === 'patch_validation' ? (verdict.status === 'pass' ? 'yes' : 'inconclusive') : 'not_applicable',
      diagnosticsClean: verdict.status === 'pass' ? 'yes' : verdict.status === 'fail' ? 'fail' : 'inconclusive',
      regressionTests: contract.mode === 'patch_validation' && verdict.status === 'pass' ? 'pass' : 'not_run',
      result: {
        realExecution: true,
        vmExecution: false,
        hostExecution: true,
        observationBacked: true,
        execution: {
          substrate: 'host',
          operationKind: spec.operationKind,
          expectedExitCode: spec.expectedExitCode,
          expectedStdoutIncludes: spec.expectedStdoutIncludes,
          expectedStderrIncludes: spec.expectedStderrIncludes
        },
        exitCode: execution.result.exitCode,
        status: execution.result.status,
        stdoutSummary: execution.result.stdoutSummary,
        stderrSummary: execution.result.stderrSummary,
        checks: verdict.checks,
        artifactId: execution.artifactId,
        hostCwd: execution.cwd,
        hostTargetPath: execution.targetPath,
        hostArtifactPath: execution.artifactPath,
        note: redactForModelText(note)
      }
    });

    if (execution.artifactId) {
      db.createEvidenceFromArtifact(runId, execution.artifactId, 'Verifier output artifact from host execution.', contract.hypothesisId, contract.findingId);
    }
    if (verdict.status === 'pass' && contract.findingId) {
      db.verifyFindingWithVerifierRun(contract.findingId, verifierRun.id);
    }

    const event = db.appendTraceEvent({
      runId,
      attemptId: context.attempt.id,
      type: 'verifier_result',
      source: 'verifier',
      summary: `Verifier contract executed on host with ${verdict.status}.`,
      payload: {
        verifierRunId: verifierRun.id,
        contractId: contract.id,
        status: verdict.status,
        realExecution: true,
        vmExecution: false,
        hostExecution: true,
        observationBacked: true,
        artifactId: execution.artifactId,
        checks: verdict.checks
      },
      artifactId: execution.artifactId,
      vmContextId: context.vmContext.id
    });
    return { verifierRun, traceEventId: event.id, artifactId: execution.artifactId };
  } catch (error) {
    return recordVerifierFailure(db, runId, contract, context.attempt.id, context.vmContext.id, 'Verifier execution failed on host.', {
      issues: [errorMessage(error)],
      note: redactForModelText(note),
      realExecution: false,
      vmExecution: false,
      hostExecution: true
    });
  }
}

export function verifierContractIssues(contract: VerifierContractRecord): string[] {
  const issues: string[] = [];
  if (!contract.setupStepsMarkdown.trim()) issues.push('missing setup steps');
  if (!contract.triggerStepsMarkdown.trim()) issues.push('missing trigger steps');
  if (Object.keys(contract.expectedObservations).length === 0) issues.push('missing expected observations');
  if (Object.keys(contract.passCriteria).length === 0) issues.push('missing pass criteria');
  return issues;
}

function recordVerifierFailure(
  db: WorkspaceDatabase,
  runId: string,
  contract: VerifierContractRecord,
  attemptId: string | null,
  vmContextId: string | null,
  summary: string,
  payload: Record<string, unknown>
): VerifierExecutionOutcome {
  const verifierRun = db.createVerifierRun({
    contractId: contract.id,
    runId,
    attemptId,
    vmContextId,
    status: 'error',
    blockedIssue: 'error',
    behaviorPreserved: 'not_applicable',
    diagnosticsClean: 'fail',
    regressionTests: 'not_run',
    result: {
      realExecution: false,
      vmExecution: false,
      userReviewRequired: true,
      ...payload
    }
  });
  const event = db.appendTraceEvent({
    runId,
    attemptId,
    type: 'verifier_result',
    source: 'verifier',
    summary,
    payload: {
      verifierRunId: verifierRun.id,
      contractId: contract.id,
      status: verifierRun.status,
      userReviewRequired: true,
      ...payload
    },
    vmContextId,
    modelVisible: false
  });
  return { verifierRun, traceEventId: event.id, artifactId: null };
}

function verifierContext(db: WorkspaceDatabase, runId: string, attemptId: string | null, vmContextId: string | null): CreatedRunContext {
  const run = db.getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const detail = db.getRunDetail(runId);
  const attempt = attemptId ? detail.attempts.find((item) => item.id === attemptId) : db.getFirstAttempt(runId);
  if (!attempt) throw new Error(`Run has no attempt for verifier execution: ${runId}`);
  const vmContext = detail.vmContexts.find((item) => item.id === (vmContextId ?? attempt.vmContextId)) ?? detail.vmContexts[0];
  if (!vmContext) throw new Error(`Run has no sandbox context for verifier execution: ${runId}`);
  return { run, attempt, vmContext };
}

function verifierRequest(context: CreatedRunContext, spec: VerifierExecutionSpec): GuestExecuteRequest {
  return {
    operationKind: spec.operationKind,
    command: spec.command,
    cwd: '/workspace',
    env: { BEALE_TARGET_PATH: '/workspace/target' },
    timeoutMs: spec.timeoutMs,
    networkProfile: normalizeNetworkProfile(context.run.networkProfile),
    expectedOutput: spec.artifactPath ? 'artifact' : 'summary'
  };
}

function verifierExecutionSpec(contract: VerifierContractRecord): VerifierExecutionSpec | null {
  const source = verifierSource(contract.passCriteria) ?? verifierSource(contract.expectedObservations);
  if (!source) return null;
  return source;
}

function verifierSource(value: Record<string, unknown>): VerifierExecutionSpec | null {
  const nested = objectValue(value.verifier) ?? objectValue(value.execution);
  if (nested) {
    return verifierSpecFromObject(nested);
  }
  return verifierSpecFromObject(value);
}

function verifierSpecFromObject(value: Record<string, unknown>): VerifierExecutionSpec | null {
  const operationKind = value.operationKind === 'python' ? 'python' : 'shell';
  const commandValue = value.command;
  const script = stringValue(value.script).trim();
  const command = Array.isArray(commandValue) && commandValue.every((item) => typeof item === 'string') ? commandValue : null;
  const normalizedCommand = command ?? (script ? (operationKind === 'python' ? ['python3', '-c', script] : shellCommandForScript(script)) : null);
  if (!normalizedCommand || normalizedCommand.length === 0) return null;

  return {
    operationKind,
    command: normalizedCommand,
    expectedExitCode: integerValue(value.expectedExitCode, 0),
    expectedStdoutIncludes: nonEmptyString(value.expectedStdoutIncludes),
    expectedStderrIncludes: nonEmptyString(value.expectedStderrIncludes),
    artifactPath: nonEmptyString(value.artifactPath),
    timeoutMs: Math.max(1000, integerValue(value.timeoutMs, 30_000))
  };
}

function shellCommandForScript(script: string): string[] {
  return [scriptRequestsBash(script) ? 'bash' : 'sh', '-lc', script];
}

function scriptRequestsBash(script: string): boolean {
  const firstLine = script.split(/\r?\n/, 1)[0] ?? '';
  return /^#!.*\bbash\b/.test(firstLine) || /\bpipefail\b/.test(script);
}

function verifierVerdict(result: GuestExecuteResult, spec: VerifierExecutionSpec): { status: 'pass' | 'fail'; checks: Record<string, unknown> } {
  const exitCodeMatches = result.exitCode === spec.expectedExitCode;
  const stdoutMatches = spec.expectedStdoutIncludes ? result.stdoutSummary.includes(spec.expectedStdoutIncludes) : true;
  const stderrMatches = spec.expectedStderrIncludes ? result.stderrSummary.includes(spec.expectedStderrIncludes) : true;
  const status = exitCodeMatches && stdoutMatches && stderrMatches ? 'pass' : 'fail';
  return {
    status,
    checks: {
      exitCodeMatches,
      stdoutMatches,
      stderrMatches,
      expectedExitCode: spec.expectedExitCode,
      expectedStdoutIncludes: spec.expectedStdoutIncludes,
      expectedStderrIncludes: spec.expectedStderrIncludes
    }
  };
}

function verifierBlockedIssue(status: 'pass' | 'fail'): string {
  return status === 'pass' ? 'confirmed' : 'not_observed';
}

function firstScopedImport(db: WorkspaceDatabase): { hostPath: string } | null {
  const asset = db.getActiveScope().assets.find((candidate) => isScopedLocalAsset(candidate) && existsSync(candidate.value));
  return asset ? { hostPath: resolve(asset.value) } : null;
}

function isScopedLocalAsset(asset: ScopeAsset): boolean {
  return asset.direction === 'in_scope' && LOCAL_IMPORT_ASSET_KINDS.has(asset.kind) && isAbsolute(asset.value) && existsSync(asset.value) && !looksLikeUrl(asset.value);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nonEmptyString(value: unknown): string | null {
  const text = stringValue(value).trim();
  return text.length > 0 ? text : null;
}

function integerValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}
