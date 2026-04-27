import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import { nowIso } from './database';
import type { ExecutorNetworkProfile, ExecutorStatus, ScopeAsset } from '@shared/types';
import type { ExecutorProvider, GuestExecuteRequest, GuestExecuteResult, GuestExportRequest, GuestImportSpec } from './executorTypes';
import { VmctlExecutorProvider } from './vmctlExecutor';

const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|OPENAI/i;
const LOCAL_IMPORT_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['path', 'repo', 'binary', 'documentation', 'other']);

export class ExecutorManager {
  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly provider: ExecutorProvider = new VmctlExecutorProvider()
  ) {}

  public getStatus(): ExecutorStatus {
    const status = this.provider.getStatus();
    return {
      provider: status.provider,
      configured: status.configured,
      available: status.available,
      label: status.label,
      reason: status.reason,
      targetExecution: status.targetExecution,
      supportedNetworkProfiles: status.supportedNetworkProfiles,
      supports: status.supports
    };
  }

  public createContext(context: CreatedRunContext, imageRef = 'beale-default-toolchain', snapshotRef = 'clean'): void {
    const status = this.requireAvailable();
    const networkProfile = normalizeNetworkProfile(context.run.networkProfile);
    if (!status.supportedNetworkProfiles.includes(networkProfile)) {
      throw new Error(`Executor backend cannot enforce requested network profile: ${networkProfile}`);
    }

    const result = this.provider.createContext({ context, imageRef, snapshotRef, networkProfile });
    this.db.updateVmContext(context.vmContext.id, {
      backend: status.provider,
      imageId: imageRef,
      snapshotId: snapshotRef,
      state: 'clean',
      metadata: {
        executor: status.provider,
        providerResult: result,
        targetExecution: true,
        hostDatabaseMounted: false,
        openAiCredentialsMounted: false,
        broadHostMount: false,
        artifactAuthority: 'host'
      }
    });
    this.recordVmEvent(context, 'VM executor created disposable guest context.', {
      provider: status.provider,
      imageRef,
      snapshotRef,
      networkProfile,
      targetExecution: true,
      hostDatabaseMounted: false,
      openAiCredentialsMounted: false
    });
  }

  public restoreSnapshot(context: CreatedRunContext, snapshotRef: string): void {
    const result = this.provider.restoreSnapshot(context, snapshotRef);
    this.db.updateVmContext(context.vmContext.id, { snapshotId: snapshotRef, state: 'clean', metadata: { restoredSnapshot: snapshotRef, providerResult: result } });
    this.recordVmEvent(context, 'VM snapshot restored.', { snapshotRef, providerResult: result });
  }

  public cloneContext(context: CreatedRunContext, snapshotRef: string): void {
    const status = this.requireAvailable();
    if (!status.supports.clone) {
      this.recordPolicyBlock(context, 'Executor backend does not support clean snapshot clone.', { snapshotRef, provider: status.provider });
      throw new Error('Executor backend does not support clean snapshot clone.');
    }
    const result = this.provider.cloneContext(context, snapshotRef);
    this.db.updateVmContext(context.vmContext.id, { snapshotId: snapshotRef, state: 'clean', metadata: { clonedFromSnapshot: snapshotRef, providerResult: result } });
    this.recordVmEvent(context, 'VM context cloned from clean snapshot.', { snapshotRef, providerResult: result });
  }

  public importWorkspaceMaterial(context: CreatedRunContext, spec: GuestImportSpec): void {
    this.validateImport(context, spec);
    const result = this.provider.importWorkspaceMaterial(context, spec);
    this.db.updateVmContext(context.vmContext.id, { state: 'working', metadata: { lastImportGuestPath: spec.guestPath } });
    this.recordVmEvent(context, 'Scoped target material imported into guest.', {
      hostPath: spec.hostPath,
      guestPath: spec.guestPath,
      mode: spec.mode,
      providerResult: result,
      hostDatabaseMounted: false,
      openAiCredentialsMounted: false
    });
  }

  public executeGuestOperation(context: CreatedRunContext, request: GuestExecuteRequest): GuestExecuteResult {
    const status = this.requireAvailable();
    const networkProfile = normalizeNetworkProfile(request.networkProfile);
    if (!status.supportedNetworkProfiles.includes(networkProfile)) {
      this.recordPolicyBlock(context, `Executor backend cannot enforce requested network profile: ${networkProfile}`, { networkProfile });
      throw new Error(`Executor backend cannot enforce requested network profile: ${networkProfile}`);
    }
    if (!status.supports.shell && request.operationKind === 'shell') {
      throw new Error('Executor backend does not support guest shell execution.');
    }
    if (!status.supports.python && request.operationKind === 'python') {
      throw new Error('Executor backend does not support guest Python execution.');
    }

    const sanitizedRequest: GuestExecuteRequest = {
      ...request,
      env: sanitizeEnv(request.env ?? {}),
      networkProfile
    };
    const toolName = request.operationKind === 'python' ? 'python' : 'guest_shell';
    const toolCallId = this.db.createToolCall({
      runId: context.run.id,
      attemptId: context.attempt.id,
      toolName,
      toolVersion: `${status.provider}-executor-alpha`,
      input: {
        operationKind: request.operationKind,
        command: request.command,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        networkProfile
      },
      status: 'running',
      resultSummary: 'Guest operation scheduled through VM executor.',
      vmContextId: context.vmContext.id
    });
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_call',
      source: 'system',
      summary: `Guest ${request.operationKind} operation sent to VM executor.`,
      payload: {
        operationKind: request.operationKind,
        command: request.command,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        networkProfile,
        hostExecution: false
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });
    this.recordNetworkEnforcement(context, toolCallId, networkProfile, status);

    const result = this.provider.execute(context, sanitizedRequest);
    if (result.contaminated) {
      this.db.updateVmContext(context.vmContext.id, { state: 'contaminated', metadata: { contaminationReason: 'guest_operation', lastOperationKind: request.operationKind } });
    }
    const resultEvent = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_result',
      source: 'executor',
      summary: `Guest ${request.operationKind} operation finished with ${result.status}.`,
      payload: {
        observationBacked: true,
        status: result.status,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        stdoutSummary: result.stdoutSummary,
        stderrSummary: result.stderrSummary,
        structured: result.structured,
        candidateArtifactCount: result.candidateArtifacts.length,
        contaminated: result.contaminated,
        networkProfile
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });
    this.db.linkToolCallTrace(toolCallId, resultEvent.id);
    return result;
  }

  public exportArtifact(context: CreatedRunContext, request: GuestExportRequest): string {
    const result = this.provider.exportArtifact(context, request);
    const content = Buffer.from(result.contentBase64, 'base64');
    const artifact = this.db.createArtifact({
      kind: request.kind,
      mimeType: request.mimeType,
      sensitivity: request.sensitivity,
      modelVisible: request.modelVisible,
      source: 'vm_export',
      metadata: {
        guestPath: request.guestPath,
        provider: this.provider.getStatus().provider,
        candidateAcceptedAt: nowIso()
      },
      content
    });
    const event = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'artifact_created',
      source: 'executor',
      summary: `Guest artifact exported and accepted: ${request.guestPath}.`,
      payload: {
        observationBacked: true,
        guestPath: request.guestPath,
        artifactId: artifact.id,
        sha256: artifact.sha256,
        hostControlledExport: true
      },
      artifactId: artifact.id,
      vmContextId: context.vmContext.id
    });
    this.db.setArtifactProvenance(artifact.id, event.id);
    return artifact.id;
  }

  public revertContext(context: CreatedRunContext, snapshotRef: string): void {
    const result = this.provider.revert(context, snapshotRef);
    this.db.updateVmContext(context.vmContext.id, { state: 'clean', snapshotId: snapshotRef, metadata: { revertedTo: snapshotRef, providerResult: result } });
    this.recordVmEvent(context, 'VM context reverted to clean snapshot.', { snapshotRef, providerResult: result });
  }

  public preserveContext(context: CreatedRunContext, reason: string): void {
    const result = this.provider.preserve(context, reason);
    this.db.updateVmContext(context.vmContext.id, { state: 'preserved', metadata: { preserveReason: reason, providerResult: result } });
    this.recordVmEvent(context, 'VM context preserved by explicit request.', { reason, providerResult: result });
  }

  public destroyContext(context: CreatedRunContext): void {
    const result = this.provider.destroy(context);
    this.db.updateVmContext(context.vmContext.id, { state: 'destroyed', metadata: { destroyedByExecutor: true, providerResult: result } });
    this.recordVmEvent(context, 'VM context destroyed.', { providerResult: result });
  }

  private requireAvailable(): ExecutorStatus {
    const status = this.getStatus();
    if (!status.available) {
      throw new Error(status.reason ?? 'Executor backend is unavailable.');
    }
    return status;
  }

  private validateImport(context: CreatedRunContext, spec: GuestImportSpec): void {
    if (!isAbsolute(spec.hostPath)) {
      this.recordPolicyBlock(context, 'Import path must be absolute.', { hostPath: spec.hostPath });
      throw new Error('Import path must be absolute.');
    }
    const resolved = resolve(spec.hostPath);
    if (!existsSync(resolved)) {
      this.recordPolicyBlock(context, 'Import path does not exist.', { hostPath: resolved });
      throw new Error(`Import path does not exist: ${resolved}`);
    }
    if (pathContainsSegment(resolved, '.beale')) {
      this.recordPolicyBlock(context, 'Workspace metadata cannot be imported into the guest.', { hostPath: resolved });
      throw new Error('Workspace metadata cannot be imported into the guest.');
    }
    if (!this.isPathInScope(resolved)) {
      this.recordPolicyBlock(context, 'Import path is outside the active program scope.', { hostPath: resolved });
      throw new Error(`Import path is outside the active program scope: ${resolved}`);
    }
    const stat = statSync(resolved);
    if (!stat.isFile() && !stat.isDirectory()) {
      this.recordPolicyBlock(context, 'Import path must be a file or directory.', { hostPath: resolved });
      throw new Error('Import path must be a file or directory.');
    }
  }

  private isPathInScope(resolvedPath: string): boolean {
    const scope = this.db.getActiveScope();
    return scope.assets
      .filter(isScopedLocalImportAsset)
      .some((asset) => isWithinPath(resolvedPath, resolve(asset.value)));
  }

  private recordNetworkEnforcement(context: CreatedRunContext, toolCallId: string, networkProfile: ExecutorNetworkProfile, status: ExecutorStatus): void {
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'network_event',
      source: 'policy',
      summary: `VM network profile enforced: ${networkProfile}.`,
      payload: {
        networkProfile,
        destinationHostname: null,
        resolvedIp: null,
        port: null,
        protocol: null,
        decision: networkDecision(networkProfile),
        policyRule: `${networkProfile}_executor_profile`,
        enforcement: 'vm_controller',
        backend: status.provider,
        hostExecution: false
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });
  }

  private recordVmEvent(context: CreatedRunContext, summary: string, payload: Record<string, unknown>): void {
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'vm_event',
      source: 'executor',
      summary,
      payload,
      vmContextId: context.vmContext.id
    });
  }

  private recordPolicyBlock(context: CreatedRunContext, reason: string, payload: Record<string, unknown>): void {
    const approval = this.db.createApproval({
      runId: context.run.id,
      attemptId: context.attempt.id,
      requestKind: 'executor_policy',
      requestedAction: payload,
      decision: 'blocked',
      reason
    });
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'approval_event',
      source: 'policy',
      summary: reason,
      payload,
      approvalId: approval.id,
      vmContextId: context.vmContext.id
    });
  }
}

export function normalizeNetworkProfile(profile: string): 'offline' | 'scoped' | 'elevated' {
  if (profile === 'offline') return 'offline';
  if (profile === 'elevated') return 'elevated';
  return 'scoped';
}

function isScopedLocalImportAsset(asset: ScopeAsset): boolean {
  return asset.direction === 'in_scope' && LOCAL_IMPORT_ASSET_KINDS.has(asset.kind) && isAbsolute(asset.value) && existsSync(asset.value) && !looksLikeUrl(asset.value);
}

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!SECRET_ENV_PATTERN.test(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function isWithinPath(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function pathContainsSegment(path: string, segment: string): boolean {
  return path.split(/[\\/]+/).includes(segment);
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function networkDecision(profile: ExecutorNetworkProfile): string {
  if (profile === 'offline') return 'block_external_network';
  if (profile === 'elevated') return 'allow_elevated_network';
  return 'allow_scoped_network';
}
