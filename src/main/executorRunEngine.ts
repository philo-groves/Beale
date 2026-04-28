import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import { ExecutorManager, normalizeNetworkProfile } from './executorManager';
import type { ProgramScopeVersion, ScopeAsset, ScopeAssetKind, StartRunInput } from '@shared/types';
import { generateSessionTitle } from '../shared/sessionTitle';

const LOCAL_IMPORT_KIND_PRIORITY: ScopeAssetKind[] = ['path', 'repo', 'binary', 'documentation', 'other'];

export class ExecutorRunEngine {
  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly executor: ExecutorManager,
    private readonly onChange: () => void = () => undefined
  ) {}

  public startRun(input: StartRunInput): CreatedRunContext {
    const scope = this.db.getActiveScope();
    const status = this.executor.getStatus();
    const imageRef = process.env.BEALE_VM_IMAGE_REF?.trim() || 'beale-default-toolchain';
    const snapshotRef = process.env.BEALE_VM_SNAPSHOT_REF?.trim() || 'clean';
    const context = this.db.createRun({
      scopeVersionId: scope.id,
      title: generateSessionTitle(input.promptMarkdown),
      promptMarkdown: input.promptMarkdown,
      mode: input.mode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attemptStrategy: input.attemptStrategy,
      networkProfile: normalizeNetworkProfile(input.networkProfile),
      sandboxProfile: input.sandboxProfile,
      budget: { ...input.budget, runEngine: 'executor_alpha' },
      vmBackend: 'vmctl',
      vmImageId: imageRef,
      vmSnapshotId: snapshotRef,
      vmState: 'clean',
      vmMetadata: {
        executor: 'vmctl',
        targetExecution: true,
        hostDatabaseMounted: false,
        openAiCredentialsMounted: false,
        broadHostMount: false,
        artifactAuthority: 'host'
      }
    });

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'user_note',
      source: 'user',
      summary: 'VM executor alpha run started from markdown prompt.',
      payload: {
        runEngine: 'executor_alpha',
        prompt: input.promptMarkdown
      },
      vmContextId: context.vmContext.id
    });

    if (!status.available) {
      this.blockRun(context, 'VM executor alpha run blocked because no local VM controller is available.', {
        reason: status.reason,
        configured: status.configured
      });
      return context;
    }

    const target = selectScopedImport(scope);
    if (!target) {
      this.blockRun(context, 'VM executor alpha run blocked because no in-scope local path exists for import.', {
        scopeVersionId: scope.id
      });
      return context;
    }

    let contextCreated = false;
    try {
      this.executor.createContext(context, imageRef, snapshotRef);
      contextCreated = true;
      this.executor.restoreSnapshot(context, snapshotRef);
      this.executor.cloneContext(context, snapshotRef);
      this.executor.importWorkspaceMaterial(context, {
        hostPath: target.value,
        guestPath: '/workspace/target',
        mode: 'read_only'
      });
      this.executor.executeGuestOperation(context, {
        operationKind: 'shell',
        command: ['sh', '-lc', 'test -e "$BEALE_TARGET_PATH" && echo BEALE_SHELL_OK'],
        cwd: '/workspace',
        env: { BEALE_TARGET_PATH: '/workspace/target' },
        timeoutMs: Math.max(1000, input.budget.maxMinutes * 60_000),
        networkProfile: normalizeNetworkProfile(input.networkProfile),
        expectedOutput: 'summary'
      });
      this.executor.executeGuestOperation(context, {
        operationKind: 'python',
        command: [
          'python3',
          '-c',
          [
            'from pathlib import Path',
            'Path("/tmp/beale-executor-smoke.txt").write_text("BEALE_EXECUTOR_OK\\n")',
            'print("BEALE_EXECUTOR_OK")'
          ].join('; ')
        ],
        cwd: '/workspace',
        env: { BEALE_TARGET_PATH: '/workspace/target' },
        timeoutMs: Math.max(1000, input.budget.maxMinutes * 60_000),
        networkProfile: normalizeNetworkProfile(input.networkProfile),
        expectedOutput: 'artifact'
      });
      this.executor.exportArtifact(context, {
        guestPath: '/tmp/beale-executor-smoke.txt',
        kind: 'executor_smoke',
        mimeType: 'text/plain',
        sensitivity: 'internal',
        modelVisible: true
      });
      this.executor.revertContext(context, snapshotRef);
      this.executor.destroyContext(context);
      this.db.updateAttemptState(context.attempt.id, 'completed', 'VM executor alpha smoke completed.');
      this.db.updateRunStatus(context.run.id, 'completed', 'VM executor alpha smoke completed.');
    } catch (error) {
      if (contextCreated) {
        try {
          this.executor.destroyContext(context);
        } catch (destroyError) {
          this.db.updateVmContext(context.vmContext.id, {
            state: 'recovery_pending',
            metadata: {
              recoveryRequired: true,
              destroyFailed: true,
              destroyError: errorMessage(destroyError)
            }
          });
          this.db.appendTraceEvent({
            runId: context.run.id,
            attemptId: context.attempt.id,
            type: 'vm_event',
            source: 'executor',
            summary: 'VM executor alpha failed to destroy guest after run failure.',
            payload: { error: errorMessage(destroyError) },
            vmContextId: context.vmContext.id
          });
        }
      }
      this.db.updateAttemptState(context.attempt.id, 'failed', 'VM executor alpha run failed.');
      this.db.updateRunStatus(context.run.id, 'failed', 'VM executor alpha run failed.');
      this.db.appendTraceEvent({
        runId: context.run.id,
        attemptId: context.attempt.id,
        type: 'vm_event',
        source: 'executor',
        summary: 'VM executor alpha run failed.',
        payload: { error: errorMessage(error) },
        vmContextId: context.vmContext.id
      });
    } finally {
      this.onChange();
    }

    return context;
  }

  private blockRun(context: CreatedRunContext, reason: string, payload: Record<string, unknown>): void {
    this.db.updateAttemptState(context.attempt.id, 'blocked', reason);
    this.db.updateRunStatus(context.run.id, 'blocked', reason);
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'approval_event',
      source: 'policy',
      summary: reason,
      payload,
      vmContextId: context.vmContext.id
    });
    this.onChange();
  }
}

function selectScopedImport(scope: ProgramScopeVersion): ScopeAsset | null {
  for (const kind of LOCAL_IMPORT_KIND_PRIORITY) {
    const asset = scope.assets.find((candidate) => candidate.direction === 'in_scope' && candidate.kind === kind && isLocalExistingPath(candidate.value));
    if (asset) return asset;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}

function isLocalExistingPath(value: string): boolean {
  return isAbsolute(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && existsSync(value);
}
