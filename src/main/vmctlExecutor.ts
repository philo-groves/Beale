import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CreatedRunContext } from './database';
import type {
  ExecutorCapabilities,
  ExecutorProvider,
  GuestContextRequest,
  GuestExecuteRequest,
  GuestExecuteResult,
  GuestExportRequest,
  GuestExportResult,
  GuestImportSpec
} from './executorTypes';

const PROTOCOL_VERSION = 1;
const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|OPENAI/i;

interface VmctlController {
  command: string;
  args: string[];
  backend: string;
  autoDiscovered: boolean;
  configPath: string | null;
}

interface VmctlResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export class VmctlExecutorProvider implements ExecutorProvider {
  private readonly controller = resolveVmctlController();
  private readonly command = this.controller.command;
  private readonly args = this.controller.args;
  private readonly timeoutMs = positiveIntegerFromEnv('BEALE_VMCTL_TIMEOUT_MS', 15_000);

  public getStatus(): ExecutorCapabilities {
    if (!this.command) {
      return unavailableCapabilities(
        'No local VM controller is configured. Set BEALE_VMCTL_COMMAND to a VM controller that implements the Beale vmctl JSON protocol.',
        this.controller
      );
    }
    try {
      const result = this.request<Partial<ExecutorCapabilities>>('list_capabilities', {});
      return {
        ...defaultCapabilities(true, this.controller),
        ...result,
        protocolVersion: PROTOCOL_VERSION,
        provider: 'vmctl',
        configured: true,
        available: result.available ?? true,
        targetExecution: true,
        label: result.label ?? 'Configured local VM controller',
        reason: result.reason ?? null,
        metadata: {
          ...(result as Record<string, unknown>),
          controller: controllerMetadata(this.controller)
        }
      };
    } catch (error) {
      return unavailableCapabilities(errorMessage(error), this.controller);
    }
  }

  public createContext(request: GuestContextRequest): Record<string, unknown> {
    return this.request('create_context', contextPayload(request.context, {
      imageRef: request.imageRef,
      snapshotRef: request.snapshotRef,
      networkProfile: request.networkProfile,
      networkPolicy: request.networkPolicy
    }));
  }

  public restoreSnapshot(context: CreatedRunContext, snapshotRef: string): Record<string, unknown> {
    return this.request('restore_snapshot', contextPayload(context, { snapshotRef }));
  }

  public cloneContext(context: CreatedRunContext, snapshotRef: string): Record<string, unknown> {
    return this.request('clone_context', contextPayload(context, { snapshotRef }));
  }

  public importWorkspaceMaterial(context: CreatedRunContext, spec: GuestImportSpec): Record<string, unknown> {
    return this.request('import_workspace_material', contextPayload(context, { import: spec }));
  }

  public execute(context: CreatedRunContext, request: GuestExecuteRequest): GuestExecuteResult {
    return this.request('execute', contextPayload(context, { operation: request }));
  }

  public exportArtifact(context: CreatedRunContext, request: GuestExportRequest): GuestExportResult {
    return this.request('export_artifact', contextPayload(context, { export: request }));
  }

  public revert(context: CreatedRunContext, snapshotRef: string): Record<string, unknown> {
    return this.request('revert', contextPayload(context, { snapshotRef }));
  }

  public preserve(context: CreatedRunContext, reason: string): Record<string, unknown> {
    return this.request('preserve', contextPayload(context, { reason }));
  }

  public destroy(context: CreatedRunContext): Record<string, unknown> {
    return this.request('destroy', contextPayload(context, {}));
  }

  private request<T>(action: string, payload: Record<string, unknown>): T {
    if (!this.command) {
      throw new Error('No Beale vmctl command is configured.');
    }
    const result = spawnSync(this.command, this.args, {
      input: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, action, payload }),
      encoding: 'utf8',
      env: minimalControllerEnv(),
      timeout: this.timeoutMs,
      windowsHide: true
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`vmctl ${action} failed with status ${result.status}: ${safeOutput(result.stderr)}`);
    }

    let parsed: VmctlResponse<T>;
    try {
      parsed = JSON.parse(result.stdout) as VmctlResponse<T>;
    } catch {
      throw new Error(`vmctl ${action} returned non-JSON output: ${safeOutput(result.stdout)}`);
    }
    if (!parsed.ok) {
      throw new Error(parsed.error ?? `vmctl ${action} failed`);
    }
    if (parsed.result === undefined) {
      throw new Error(`vmctl ${action} returned no result`);
    }
    return parsed.result;
  }
}

function contextPayload(context: CreatedRunContext, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    workspaceId: context.run.scopeVersionId,
    runId: context.run.id,
    attemptId: context.attempt.id,
    scopeVersionId: context.run.scopeVersionId,
    vmContextId: context.vmContext.id,
    networkProfile: context.vmContext.networkProfile,
    ...extra
  };
}

function unavailableCapabilities(reason: string, controller: VmctlController): ExecutorCapabilities {
  return {
    ...defaultCapabilities(false, controller),
    protocolVersion: PROTOCOL_VERSION,
    provider: 'vmctl',
    configured: Boolean(controller.command),
    available: false,
    label: 'Local VM executor unavailable',
    reason,
    targetExecution: false,
    metadata: {
      controller: controllerMetadata(controller)
    }
  };
}

function defaultCapabilities(available: boolean, controller: VmctlController): ExecutorCapabilities {
  return {
    protocolVersion: PROTOCOL_VERSION,
    provider: 'vmctl',
    configured: true,
    available,
    label: available ? 'Local VM executor' : 'Local VM executor unavailable',
    reason: null,
    targetExecution: available,
    supportedNetworkProfiles: ['offline', 'scoped', 'elevated'],
    supports: {
      snapshots: true,
      clone: true,
      import: true,
      export: true,
      shell: true,
      python: true,
      debugger: false
    },
    backends: backendStatuses(available, controller)
  };
}

function backendStatuses(vmctlAvailable: boolean, controller: VmctlController): ExecutorCapabilities['backends'] {
  const configuredBackend = controller.backend;
  const hasVmctl = Boolean(controller.command);
  return [
    {
      kind: 'firecracker',
      label: 'Firecracker microVM',
      platform: 'linux',
      configured: configuredBackend === 'firecracker' || hasVmctl,
      available: process.platform === 'linux' && hasVmctl && vmctlAvailable,
      recommended: process.platform === 'linux',
      reason:
        process.platform === 'linux'
          ? hasVmctl
            ? vmctlAvailable
              ? null
              : 'Configured vmctl command is not currently available.'
            : 'Set BEALE_VMCTL_COMMAND to the Firecracker vmctl controller.'
          : 'Firecracker is supported on Linux hosts.'
    },
    {
      kind: 'hyperv',
      label: 'Hyper-V local VM',
      platform: 'win32',
      configured: configuredBackend === 'hyperv',
      available: process.platform === 'win32' && configuredBackend === 'hyperv' && hasVmctl && vmctlAvailable,
      recommended: process.platform === 'win32',
      reason:
        process.platform === 'win32'
          ? configuredBackend === 'hyperv'
            ? hasVmctl
              ? vmctlAvailable
                ? null
                : 'Configured Hyper-V vmctl command is not currently available.'
              : 'Set BEALE_VMCTL_COMMAND to a Hyper-V vmctl controller.'
            : 'Set BEALE_VM_BACKEND=hyperv and configure a Hyper-V vmctl controller.'
          : 'Hyper-V backend is for Windows hosts.'
    },
    {
      kind: 'tart',
      label: 'Tart local VM',
      platform: 'darwin',
      configured: configuredBackend === 'tart',
      available: process.platform === 'darwin' && configuredBackend === 'tart' && hasVmctl && vmctlAvailable,
      recommended: process.platform === 'darwin',
      reason:
        process.platform === 'darwin'
          ? configuredBackend === 'tart'
            ? hasVmctl
              ? vmctlAvailable
                ? null
                : 'Configured Tart vmctl command is not currently available.'
              : 'Set BEALE_VMCTL_COMMAND to a Tart vmctl controller.'
            : 'Set BEALE_VM_BACKEND=tart and configure a Tart vmctl controller.'
          : 'Tart backend is for macOS hosts.'
    },
    {
      kind: 'custom_vmctl',
      label: 'Custom vmctl controller',
      platform: 'any',
      configured: hasVmctl && configuredBackend !== 'firecracker' && configuredBackend !== 'hyperv' && configuredBackend !== 'tart',
      available: hasVmctl && vmctlAvailable,
      recommended: false,
      reason: hasVmctl ? (vmctlAvailable ? null : 'Configured vmctl command is not currently available.') : 'Set BEALE_VMCTL_COMMAND to a compatible controller.'
    }
  ];
}

function resolveVmctlController(): VmctlController {
  const envCommand = process.env.BEALE_VMCTL_COMMAND?.trim() ?? '';
  if (envCommand) {
    return {
      command: envCommand,
      args: parseJsonStringArray(process.env.BEALE_VMCTL_ARGS_JSON),
      backend: (process.env.BEALE_VM_BACKEND ?? '').trim().toLowerCase(),
      autoDiscovered: false,
      configPath: null
    };
  }

  const discovered = discoverFirecrackerController();
  if (discovered) return discovered;

  return {
    command: '',
    args: [],
    backend: (process.env.BEALE_VM_BACKEND ?? '').trim().toLowerCase(),
    autoDiscovered: false,
    configPath: null
  };
}

function discoverFirecrackerController(): VmctlController | null {
  if (!vmctlAutoDiscoveryEnabled()) return null;

  const configuredPath = process.env.BEALE_FIRECRACKER_CONFIG?.trim();
  const configPath = resolve(configuredPath || join(process.cwd(), '.beale', 'firecracker', 'config.json'));
  const scriptPath = resolve(join(process.cwd(), 'scripts', 'firecracker-vmctl.mjs'));
  if (!existsSync(configPath) || !existsSync(scriptPath)) return null;

  return {
    command: resolveNodeRuntimeCommand(),
    args: [scriptPath, '--config', configPath],
    backend: 'firecracker',
    autoDiscovered: true,
    configPath
  };
}

function resolveNodeRuntimeCommand(): string {
  const candidates = [
    process.env.BEALE_NODE_COMMAND?.trim(),
    process.env.npm_node_execpath?.trim(),
    process.env.NODE?.trim(),
    'node',
    isPlainNodeExecutable(process.execPath) ? process.execPath : ''
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (nodeCommandAvailable(candidate)) return candidate;
  }
  return 'node';
}

function nodeCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    env: minimalControllerEnv(),
    timeout: 3000,
    windowsHide: true
  });
  return result.status === 0 && /^v\d+\.\d+\.\d+/.test(result.stdout.trim());
}

function isPlainNodeExecutable(path: string): boolean {
  const name = path.split(/[\\/]+/).at(-1)?.toLowerCase() ?? '';
  return name === 'node' || name === 'node.exe';
}

function vmctlAutoDiscoveryEnabled(): boolean {
  const configured = process.env.BEALE_VMCTL_AUTODISCOVERY?.trim().toLowerCase();
  if (configured === '0' || configured === 'false' || configured === 'off') return false;
  if (configured === '1' || configured === 'true' || configured === 'on') return true;
  return process.env.NODE_ENV !== 'test';
}

function controllerMetadata(controller: VmctlController): Record<string, unknown> {
  return {
    autoDiscovered: controller.autoDiscovered,
    configPath: controller.configPath,
    command: controller.command || null,
    args: redactControllerArgs(controller.args)
  };
}

function redactControllerArgs(args: string[]): string[] {
  return args.map((arg) => (SECRET_ENV_PATTERN.test(arg) ? '...redacted' : arg));
}

function minimalControllerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'USERNAME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec']) {
    const value = process.env[key];
    if (value && !SECRET_ENV_PATTERN.test(key)) {
      env[key] = value;
    }
  }
  return env;
}

function parseJsonStringArray(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function safeOutput(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-...redacted').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ...redacted').slice(0, 800);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}
