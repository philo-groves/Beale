import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import { nowIso } from './database';
import type { ExecutorBackendKind, ExecutorNetworkProfile, ExecutorStatus, ProgramScopeVersion, SandboxSetupResult, ScopeAsset } from '@shared/types';
import type {
  ExecutorCapabilities,
  ExecutorProvider,
  GuestExecuteRequest,
  GuestExecuteResult,
  GuestExportRequest,
  GuestImportSpec,
  GuestNetworkDestination,
  GuestNetworkPolicy
} from './executorTypes';
import { DockerExecutorProvider } from './dockerExecutor';
import { VmctlExecutorProvider } from './vmctlExecutor';

const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|OPENAI/i;
const LOCAL_IMPORT_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['path', 'repo', 'binary', 'documentation', 'other']);
const LIVE_NETWORK_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['domain', 'host', 'ip_range', 'service']);
const GUEST_WORKSPACE_ROOT = '/workspace';
const GUEST_METADATA_ROOT = `${GUEST_WORKSPACE_ROOT}/.beale`;
const MAX_IMPORT_FILES = 10_000;
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const MAX_IMPORT_DEPTH = 64;

interface ImportTreeSummary {
  kind: 'file' | 'directory';
  fileCount: number;
  directoryCount: number;
  sizeBytes: number;
  maxBytes: number;
  maxFiles: number;
}

interface ValidatedGuestImport {
  spec: GuestImportSpec;
  summary: ImportTreeSummary;
  requestedHostPath: string;
}

export class ExecutorManager {
  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly provider: ExecutorProvider = new VmctlExecutorProvider(),
    private readonly backendPreference: () => ExecutorBackendKind | null = () => null,
    private readonly dockerProvider: DockerExecutorProvider = new DockerExecutorProvider()
  ) {}

  public getStatus(): ExecutorStatus {
    const activeProvider = this.activeProvider();
    const status = activeProvider.getStatus();
    const inactiveStatuses = this.inactiveProviders(status.provider).map((provider) => provider.getStatus());
    return {
      provider: status.provider,
      configured: status.configured,
      available: status.available,
      label: status.label,
      reason: status.reason,
      targetExecution: status.targetExecution,
      supportedNetworkProfiles: status.supportedNetworkProfiles,
      metadata: status.metadata,
      supports: status.supports,
      backends: mergeBackendStatuses([status, ...inactiveStatuses])
    };
  }

  public resolveNetworkProfile(requestedNetworkProfile: string): ExecutorNetworkProfile {
    const status = this.requireAvailable();
    return this.resolveSupportedNetworkProfile(status, normalizeNetworkProfile(requestedNetworkProfile));
  }

  public async setupSandboxBackend(backendKind: ExecutorBackendKind): Promise<SandboxSetupResult> {
    if (backendKind === 'docker') return this.dockerProvider.setup();
    throw new Error(`Automated setup is not available for sandbox backend: ${backendKind}`);
  }

  public createContext(context: CreatedRunContext, imageRef = 'beale-default-toolchain', snapshotRef = 'clean', requestedNetworkProfile = context.run.networkProfile): void {
    const status = this.requireAvailable();
    const requestedProfile = normalizeNetworkProfile(requestedNetworkProfile);
    const networkProfile = this.resolveSupportedNetworkProfile(status, requestedProfile);
    if (!status.supportedNetworkProfiles.includes(networkProfile)) {
      throw new Error(`Executor backend cannot enforce requested network profile: ${networkProfile}`);
    }
    const networkPolicy = this.networkPolicyFor(context, networkProfile);

    const provider = this.activeProvider();
    const result = provider.createContext({ context, imageRef, snapshotRef, networkProfile, networkPolicy });
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
        artifactAuthority: 'host',
        networkPolicy: {
          profile: networkPolicy.profile,
          requestedProfile,
          allowedDestinationCount: networkPolicy.allowedDestinations.length,
          liveTargetAllowed: networkPolicy.liveTargetAllowed,
          failClosed: networkPolicy.failClosed
        }
      }
    });
    this.recordVmEvent(context, 'Sandbox executor created disposable context.', {
      provider: status.provider,
      imageRef,
      snapshotRef,
      networkProfile,
      requestedNetworkProfile: requestedProfile,
      allowedDestinations: networkPolicy.allowedDestinations,
      liveTargetAllowed: networkPolicy.liveTargetAllowed,
      userApprovalRequired: networkPolicy.userApprovalRequired,
      targetExecution: true,
      hostDatabaseMounted: false,
      openAiCredentialsMounted: false
    });
  }

  public restoreSnapshot(context: CreatedRunContext, snapshotRef: string): void {
    const provider = this.activeProvider();
    const result = provider.restoreSnapshot(context, snapshotRef);
    this.db.updateVmContext(context.vmContext.id, { snapshotId: snapshotRef, state: 'clean', metadata: { restoredSnapshot: snapshotRef, providerResult: result } });
    this.recordVmEvent(context, 'Sandbox snapshot restored.', { snapshotRef, providerResult: result });
  }

  public cloneContext(context: CreatedRunContext, snapshotRef: string, requestedNetworkProfile = context.run.networkProfile): void {
    const status = this.requireAvailable();
    if (!status.supports.clone || !status.supports.snapshots) {
      this.recordPolicyBlock(context, 'Executor backend does not support clean snapshot clone.', { snapshotRef, provider: status.provider });
      throw new Error('Executor backend does not support clean snapshot clone.');
    }
    const networkProfile = this.resolveSupportedNetworkProfile(status, normalizeNetworkProfile(requestedNetworkProfile));
    const currentState = this.currentVmState(context);
    if (currentState !== 'clean') {
      this.recordPolicyBlock(context, 'Clean snapshot clone requires a clean sandbox context.', {
        snapshotRef,
        provider: status.provider,
        currentState
      });
      throw new Error(`Clean snapshot clone requires a clean sandbox context; current state is ${currentState}.`);
    }
    const providerContext = { ...context, vmContext: { ...context.vmContext, networkProfile } };
    const provider = this.activeProvider();
    const result = provider.cloneContext(providerContext, snapshotRef);
    this.db.updateVmContext(context.vmContext.id, { snapshotId: snapshotRef, state: 'clean', metadata: { clonedFromSnapshot: snapshotRef, providerResult: result } });
    this.recordVmEvent(context, 'Sandbox context cloned from clean snapshot.', { snapshotRef, providerResult: result });
  }

  public importWorkspaceMaterial(context: CreatedRunContext, spec: GuestImportSpec): void {
    const status = this.requireAvailable();
    if (!status.supports.import) {
      this.recordPolicyBlock(context, 'Executor backend does not support scoped target import.', { provider: status.provider, guestPath: spec.guestPath });
      throw new Error('Executor backend does not support scoped target import.');
    }
    const validated = this.validateImport(context, spec);
    const provider = this.activeProvider();
    const result = provider.importWorkspaceMaterial(context, validated.spec);
    this.db.updateVmContext(context.vmContext.id, {
      state: 'working',
      metadata: {
        lastImportGuestPath: validated.spec.guestPath,
        lastImportHostPath: validated.spec.hostPath,
        lastImportSummary: validated.summary
      }
    });
    this.recordVmEvent(context, 'Scoped target material imported into guest.', {
      hostPath: validated.spec.hostPath,
      requestedHostPath: validated.requestedHostPath,
      guestPath: validated.spec.guestPath,
      mode: validated.spec.mode,
      importSummary: validated.summary,
      providerResult: result,
      hostDatabaseMounted: false,
      openAiCredentialsMounted: false
    });
  }

  public executeGuestOperation(context: CreatedRunContext, request: GuestExecuteRequest): GuestExecuteResult {
    const status = this.requireAvailable();
    const requestedProfile = normalizeNetworkProfile(request.networkProfile);
    const networkProfile = this.resolveSupportedNetworkProfile(status, requestedProfile);
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
    const networkPolicy = this.networkPolicyFor(context, networkProfile);

    const sanitizedRequest: GuestExecuteRequest = {
      ...request,
      env: sanitizeEnv(request.env ?? {}),
      networkProfile,
      networkPolicy
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
        requestedNetworkProfile: requestedProfile,
        networkProfile,
        allowedDestinations: networkPolicy.allowedDestinations.map((destination) => destination.value),
        liveTargetAllowed: networkPolicy.liveTargetAllowed
      },
      status: 'running',
      resultSummary: 'Guest operation scheduled through sandbox executor.',
      vmContextId: context.vmContext.id
    });
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_call',
      source: 'system',
      summary: `Guest ${request.operationKind} operation sent to sandbox executor.`,
      payload: {
        operationKind: request.operationKind,
        command: request.command,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        requestedNetworkProfile: requestedProfile,
        networkProfile,
        allowedDestinations: networkPolicy.allowedDestinations,
        liveTargetAllowed: networkPolicy.liveTargetAllowed,
        hostExecution: false
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });
    this.recordNetworkEnforcement(context, toolCallId, networkPolicy, status);

    const provider = this.activeProvider();
    const result = provider.execute(context, sanitizedRequest);
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
        requestedNetworkProfile: requestedProfile,
        networkProfile
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });
    this.db.linkToolCallTrace(toolCallId, resultEvent.id);
    return result;
  }

  public exportArtifact(context: CreatedRunContext, request: GuestExportRequest): string {
    const provider = this.activeProvider();
    const result = provider.exportArtifact(context, request);
    const content = Buffer.from(result.contentBase64, 'base64');
    const artifact = this.db.createArtifact({
      kind: request.kind,
      mimeType: request.mimeType,
      sensitivity: request.sensitivity,
      modelVisible: request.modelVisible,
      source: 'vm_export',
      metadata: {
        guestPath: request.guestPath,
        provider: provider.getStatus().provider,
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
    const provider = this.activeProvider();
    const result = provider.revert(context, snapshotRef);
    this.db.updateVmContext(context.vmContext.id, { state: 'clean', snapshotId: snapshotRef, metadata: { revertedTo: snapshotRef, providerResult: result } });
    this.recordVmEvent(context, 'Sandbox context reverted to clean snapshot.', { snapshotRef, providerResult: result });
  }

  public preserveContext(context: CreatedRunContext, reason: string): void {
    const provider = this.activeProvider();
    const result = provider.preserve(context, reason);
    this.db.updateVmContext(context.vmContext.id, { state: 'preserved', metadata: { preserveReason: reason, providerResult: result } });
    this.recordVmEvent(context, 'Sandbox context preserved by explicit request.', { reason, providerResult: result });
  }

  public destroyContext(context: CreatedRunContext): void {
    const provider = this.activeProvider();
    const result = provider.destroy(context);
    this.db.updateVmContext(context.vmContext.id, { state: 'destroyed', metadata: { destroyedByExecutor: true, providerResult: result } });
    this.recordVmEvent(context, 'Sandbox context destroyed.', { providerResult: result });
  }

  private requireAvailable(): ExecutorStatus {
    const status = this.getStatus();
    if (!status.available) {
      throw new Error(status.reason ?? 'Executor backend is unavailable.');
    }
    return status;
  }

  private activeProvider(): ExecutorProvider {
    return this.preferredBackendKind() === 'docker' ? this.dockerProvider : this.provider;
  }

  private inactiveProviders(activeProviderKind: string): ExecutorProvider[] {
    return activeProviderKind === 'docker' ? [this.provider] : [this.dockerProvider];
  }

  private preferredBackendKind(): ExecutorBackendKind | null {
    const preferred = this.backendPreference();
    if (preferred) return preferred;
    const env = (process.env.BEALE_SANDBOX_BACKEND ?? process.env.BEALE_VM_BACKEND ?? '').trim().toLowerCase();
    return env === 'docker' ? 'docker' : null;
  }

  private validateImport(context: CreatedRunContext, spec: GuestImportSpec): ValidatedGuestImport {
    if (!isAbsolute(spec.hostPath)) {
      this.recordPolicyBlock(context, 'Import path must be absolute.', { hostPath: spec.hostPath });
      throw new Error('Import path must be absolute.');
    }
    const guestPath = normalizeGuestWorkspacePath(spec.guestPath);
    if (!guestPath) {
      this.recordPolicyBlock(context, 'Import guest path must stay inside /workspace and outside .beale.', { guestPath: spec.guestPath });
      throw new Error('Import guest path must stay inside /workspace and outside .beale.');
    }
    const resolved = resolve(spec.hostPath);
    if (!existsSync(resolved)) {
      this.recordPolicyBlock(context, 'Import path does not exist.', { hostPath: resolved });
      throw new Error(`Import path does not exist: ${resolved}`);
    }
    const rootLstat = lstatSync(resolved);
    if (rootLstat.isSymbolicLink()) {
      this.recordPolicyBlock(context, 'Import path cannot be a symbolic link.', { hostPath: resolved });
      throw new Error('Import path cannot be a symbolic link.');
    }
    const realHostPath = realpathSync(resolved);
    if (pathContainsSegment(resolved, '.beale') || pathContainsSegment(realHostPath, '.beale')) {
      this.recordPolicyBlock(context, 'Workspace metadata cannot be imported into the guest.', { hostPath: resolved });
      throw new Error('Workspace metadata cannot be imported into the guest.');
    }
    if (!this.isPathInScope(realHostPath)) {
      this.recordPolicyBlock(context, 'Import path is outside the active program scope.', { hostPath: realHostPath, requestedHostPath: resolved });
      throw new Error(`Import path is outside the active program scope: ${realHostPath}`);
    }
    const stat = statSync(realHostPath);
    if (!stat.isFile() && !stat.isDirectory()) {
      this.recordPolicyBlock(context, 'Import path must be a file or directory.', { hostPath: realHostPath });
      throw new Error('Import path must be a file or directory.');
    }
    let summary: ImportTreeSummary;
    try {
      summary = scanImportTree(realHostPath);
    } catch (error) {
      this.recordPolicyBlock(context, 'Import tree failed safety validation.', {
        hostPath: realHostPath,
        requestedHostPath: resolved,
        reason: errorMessage(error)
      });
      throw error;
    }
    return {
      spec: {
        ...spec,
        hostPath: realHostPath,
        guestPath
      },
      summary,
      requestedHostPath: resolved
    };
  }

  private isPathInScope(resolvedPath: string): boolean {
    const scope = this.db.getActiveScope();
    return scope.assets
      .filter(isScopedLocalImportAsset)
      .some((asset) => {
        const scopePath = safeRealpath(resolve(asset.value));
        return scopePath ? isWithinPath(resolvedPath, scopePath) : false;
      });
  }

  private currentVmState(context: CreatedRunContext): string {
    const vmContext = this.db.getRunDetail(context.run.id).vmContexts.find((candidate) => candidate.id === context.vmContext.id);
    return vmContext?.state ?? context.vmContext.state;
  }

  private networkPolicyFor(context: CreatedRunContext, networkProfile: ExecutorNetworkProfile): GuestNetworkPolicy {
    const scope = this.db.getScopeVersion(context.run.scopeVersionId);
    const allowedDestinations = allowedNetworkDestinations(scope);
    if (networkProfile === 'scoped' && allowedDestinations.length === 0) {
      this.recordPolicyBlock(context, 'Scoped network profile requires at least one in-scope domain, host, IP range, or service.', {
        networkProfile,
        scopeVersionId: scope.id,
        allowedDestinationCount: 0
      });
      throw new Error('Scoped network profile requires at least one in-scope domain, host, IP range, or service.');
    }
    return {
      profile: networkProfile,
      scopeVersionId: scope.id,
      allowedDestinations: networkProfile === 'offline' ? [] : allowedDestinations,
      liveTargetAllowed: networkProfile === 'elevated' || (networkProfile === 'scoped' && allowedDestinations.length > 0),
      userApprovalRequired: networkProfile !== 'offline',
      failClosed: networkProfile !== 'elevated',
      enforcement: 'host_vm_controller'
    };
  }

  private resolveSupportedNetworkProfile(status: ExecutorStatus, requestedNetworkProfile: ExecutorNetworkProfile): ExecutorNetworkProfile {
    if (status.supportedNetworkProfiles.includes(requestedNetworkProfile)) return requestedNetworkProfile;
    if (requestedNetworkProfile === 'elevated' && status.supportedNetworkProfiles.includes('scoped')) return 'scoped';
    return requestedNetworkProfile;
  }

  private recordNetworkEnforcement(context: CreatedRunContext, toolCallId: string, networkPolicy: GuestNetworkPolicy, status: ExecutorStatus): void {
    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'network_event',
      source: 'policy',
      summary: `Sandbox network profile enforced: ${networkPolicy.profile}.`,
      payload: {
        networkProfile: networkPolicy.profile,
        destinationHostname: null,
        resolvedIp: null,
        port: null,
        protocol: null,
        allowedDestinations: networkPolicy.allowedDestinations,
        allowedDestinationCount: networkPolicy.allowedDestinations.length,
        liveTargetAllowed: networkPolicy.liveTargetAllowed,
        userApprovalRequired: networkPolicy.userApprovalRequired,
        failClosed: networkPolicy.failClosed,
        decision: networkDecision(networkPolicy),
        policyRule: `${networkPolicy.profile}_executor_profile`,
        enforcement: networkPolicy.enforcement,
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

function allowedNetworkDestinations(scope: ProgramScopeVersion): GuestNetworkDestination[] {
  return scope.assets
    .filter((asset) => asset.direction === 'in_scope' && LIVE_NETWORK_ASSET_KINDS.has(asset.kind))
    .map(networkDestinationFromAsset)
    .filter((destination): destination is GuestNetworkDestination => Boolean(destination));
}

function networkDestinationFromAsset(asset: ScopeAsset): GuestNetworkDestination | null {
  const value = asset.value.trim();
  if (!value) return null;
  const parsed = parseNetworkAsset(value);
  const attributes = asset.attributes ?? {};
  return {
    kind: asset.kind as GuestNetworkDestination['kind'],
    value: parsed.value,
    protocol: stringAttribute(attributes.protocol) ?? parsed.protocol,
    port: numberAttribute(attributes.port) ?? parsed.port,
    sourceAssetId: asset.id,
    sensitivity: asset.sensitivity
  };
}

function parseNetworkAsset(value: string): { value: string; protocol: string | null; port: number | null } {
  try {
    const parsed = new URL(value);
    return {
      value: parsed.hostname || value,
      protocol: parsed.protocol ? parsed.protocol.replace(/:$/, '') : null,
      port: parsed.port ? Number(parsed.port) : null
    };
  } catch {
    return { value, protocol: null, port: null };
  }
}

function stringAttribute(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberAttribute(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) return null;
  return value;
}

function mergeBackendStatuses(statuses: ExecutorCapabilities[]): ExecutorStatus['backends'] {
  const byKind = new Map<ExecutorBackendKind, ExecutorStatus['backends'][number]>();
  for (const status of statuses) {
    for (const backend of status.backends) {
      byKind.set(backend.kind, backend);
    }
  }
  const preferredOrder: ExecutorBackendKind[] = ['firecracker', 'hyperv', 'tart', 'docker', 'custom_vmctl'];
  return preferredOrder.flatMap((kind) => {
    const backend = byKind.get(kind);
    return backend ? [backend] : [];
  });
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

function normalizeGuestWorkspacePath(path: string): string | null {
  if (!path || path.includes('\0') || !path.startsWith('/')) return null;
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  if (normalized === GUEST_WORKSPACE_ROOT) return null;
  if (!isGuestWorkspacePath(normalized)) return null;
  if (normalized === GUEST_METADATA_ROOT || normalized.startsWith(`${GUEST_METADATA_ROOT}/`)) return null;
  if (normalized.split('/').includes('..')) return null;
  return normalized;
}

function isGuestWorkspacePath(path: string): boolean {
  return path === GUEST_WORKSPACE_ROOT || path.startsWith(`${GUEST_WORKSPACE_ROOT}/`);
}

function scanImportTree(rootPath: string): ImportTreeSummary {
  const root = visitImportTree(rootPath, 0, { fileCount: 0, directoryCount: 0, sizeBytes: 0 });
  const stat = statSync(rootPath);
  return {
    kind: stat.isDirectory() ? 'directory' : 'file',
    fileCount: root.fileCount,
    directoryCount: root.directoryCount,
    sizeBytes: root.sizeBytes,
    maxBytes: MAX_IMPORT_BYTES,
    maxFiles: MAX_IMPORT_FILES
  };
}

function visitImportTree(path: string, depth: number, summary: { fileCount: number; directoryCount: number; sizeBytes: number }): { fileCount: number; directoryCount: number; sizeBytes: number } {
  if (depth > MAX_IMPORT_DEPTH) {
    throw new Error(`Import tree exceeds maximum depth of ${MAX_IMPORT_DEPTH}.`);
  }
  const lstat = lstatSync(path);
  if (lstat.isSymbolicLink()) {
    throw new Error(`Import tree cannot contain symbolic links: ${path}`);
  }
  const real = realpathSync(path);
  if (pathContainsSegment(path, '.beale') || pathContainsSegment(real, '.beale')) {
    throw new Error(`Import tree cannot contain workspace metadata: ${path}`);
  }
  if (lstat.isFile()) {
    summary.fileCount += 1;
    summary.sizeBytes += lstat.size;
    if (summary.fileCount > MAX_IMPORT_FILES) {
      throw new Error(`Import tree exceeds maximum file count of ${MAX_IMPORT_FILES}.`);
    }
    if (summary.sizeBytes > MAX_IMPORT_BYTES) {
      throw new Error(`Import tree exceeds maximum size of ${MAX_IMPORT_BYTES} bytes.`);
    }
    return summary;
  }
  if (!lstat.isDirectory()) {
    throw new Error(`Import tree can only contain files and directories: ${path}`);
  }
  summary.directoryCount += 1;
  for (const entry of readdirSync(path)) {
    visitImportTree(resolve(path, entry), depth + 1, summary);
  }
  return summary;
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function pathContainsSegment(path: string, segment: string): boolean {
  return path.split(/[\\/]+/).includes(segment);
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function networkDecision(policy: GuestNetworkPolicy): string {
  if (policy.profile === 'offline') return 'block_external_network';
  if (policy.profile === 'elevated') return 'allow_elevated_network';
  return 'allow_scoped_network';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}
