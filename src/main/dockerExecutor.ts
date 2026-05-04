import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { CreatedRunContext } from './database';
import type { SandboxSetupResult } from '@shared/types';
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
const DEFAULT_DOCKER_IMAGE = 'python:3.12-slim';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_SETUP_TIMEOUT_MS = 10 * 60_000;
const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|OPENAI/i;
const MAX_SETUP_OUTPUT_BYTES = 32_000;

interface DockerContextState {
  vmContextId: string;
  imageRef: string;
  imports: GuestImportSpec[];
  preserved: boolean;
}

export class DockerExecutorProvider implements ExecutorProvider {
  private readonly dockerCommand = process.env.BEALE_DOCKER_COMMAND?.trim() || 'docker';
  private readonly stateRoot = resolve(process.env.BEALE_DOCKER_STATE_DIR ?? join(tmpdir(), 'beale-docker-sandboxes'));
  private readonly timeoutMs = positiveIntegerFromEnv('BEALE_DOCKER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  private readonly statusTimeoutMs = positiveIntegerFromEnv('BEALE_DOCKER_STATUS_TIMEOUT_MS', 1500);
  private readonly statusCacheMs = positiveIntegerFromEnv('BEALE_DOCKER_STATUS_CACHE_MS', 10_000);
  private statusCache: { expiresAt: number; status: ExecutorCapabilities } | null = null;

  public getStatus(): ExecutorCapabilities {
    const now = Date.now();
    if (this.statusCache && this.statusCache.expiresAt > now) return this.statusCache.status;
    const status = this.readStatus();
    this.statusCache = { expiresAt: now + this.statusCacheMs, status };
    return status;
  }

  public async setup(): Promise<SandboxSetupResult> {
    const image = dockerImage('beale-default-toolchain');
    const dockerVersion = runDocker(this.dockerCommand, ['--version'], this.statusTimeoutMs);
    if (dockerVersion.status !== 0) {
      throw new Error('Docker CLI is not available. Install Docker and make the docker command available.');
    }
    const dockerInfo = runDocker(this.dockerCommand, ['info'], this.statusTimeoutMs);
    if (dockerInfo.status !== 0) {
      throw new Error(`Docker daemon is not available: ${safeOutput(dockerInfo.stderr || dockerInfo.error)}`);
    }

    const pull = await runDockerAsync(this.dockerCommand, ['pull', image], positiveIntegerFromEnv('BEALE_DOCKER_SETUP_TIMEOUT_MS', DEFAULT_SETUP_TIMEOUT_MS));
    if (pull.status !== 0) {
      throw new Error(`Docker image pull failed: ${safeOutput(pull.stderr || pull.stdout || pull.error)}`);
    }
    this.statusCache = null;
    return {
      backendKind: 'docker',
      ok: true,
      label: 'Docker sandbox image ready',
      detail: `Pulled ${image}.`,
      command: `${this.dockerCommand} pull ${image}`
    };
  }

  public createContext(request: GuestContextRequest): Record<string, unknown> {
    const dir = contextDir(this.stateRoot, request.context.vmContext.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(workspaceDir(dir), { recursive: true });
    mkdirSync(tmpDir(dir), { recursive: true });
    writeState(dir, {
      vmContextId: request.context.vmContext.id,
      imageRef: dockerImage(request.imageRef),
      imports: [],
      preserved: false
    });
    return { providerContextId: request.context.vmContext.id, state: 'clean', backend: 'docker', image: dockerImage(request.imageRef) };
  }

  public restoreSnapshot(context: CreatedRunContext, snapshotRef: string): Record<string, unknown> {
    return this.resetContext(context, snapshotRef);
  }

  public cloneContext(context: CreatedRunContext, snapshotRef: string): Record<string, unknown> {
    return this.resetContext(context, snapshotRef);
  }

  public importWorkspaceMaterial(context: CreatedRunContext, spec: GuestImportSpec): Record<string, unknown> {
    const dir = contextDir(this.stateRoot, context.vmContext.id);
    const state = readState(dir, context);
    if (spec.mode === 'copy') {
      const targetPath = dockerGuestPathToHostPath(dir, spec.guestPath);
      if (!targetPath) throw new Error(`Docker sandbox copy import path is outside exportable roots: ${spec.guestPath}`);
      mkdirSync(dirname(targetPath), { recursive: true });
      cpSync(spec.hostPath, targetPath, { recursive: true, force: true });
      writeState(dir, state);
      return { copied: true, guestPath: spec.guestPath, mode: spec.mode };
    }
    state.imports = [...state.imports, spec];
    writeState(dir, state);
    return { queued: true, guestPath: spec.guestPath, mode: spec.mode };
  }

  public execute(context: CreatedRunContext, request: GuestExecuteRequest): GuestExecuteResult {
    const dir = contextDir(this.stateRoot, context.vmContext.id);
    const state = readState(dir, context);
    mkdirSync(workspaceDir(dir), { recursive: true });
    mkdirSync(tmpDir(dir), { recursive: true });
    const started = Date.now();
    const result = spawnSync(this.dockerCommand, dockerRunArgs(state, request, workspaceDir(dir), tmpDir(dir)), {
      encoding: 'utf8',
      timeout: request.timeoutMs || this.timeoutMs,
      windowsHide: true,
      env: minimalDockerEnv()
    });
    const timedOut = result.error?.name === 'TimeoutError';
    const status = timedOut ? 'timeout' : result.status === 0 ? 'success' : 'failure';
    const ended = Date.now();
    return {
      status,
      exitCode: typeof result.status === 'number' ? result.status : null,
      signal: result.signal,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      stdoutSummary: (result.stdout ?? '').slice(0, 4000),
      stderrSummary: (result.stderr || result.error?.message || '').slice(0, 4000),
      structured: {
        backend: 'docker',
        image: state.imageRef,
        networkProfile: request.networkProfile,
        isolation: 'container',
        warning: 'Docker is less isolated than a virtual machine.'
      },
      candidateArtifacts: [],
      contaminated: true,
      error: status === 'success' ? null : (result.stderr || result.error?.message || '').slice(0, 1000)
    };
  }

  public exportArtifact(context: CreatedRunContext, request: GuestExportRequest): GuestExportResult {
    const dir = contextDir(this.stateRoot, context.vmContext.id);
    const hostPath = dockerGuestPathToHostPath(dir, request.guestPath);
    if (!hostPath || !existsSync(hostPath)) {
      throw new Error(`Docker sandbox artifact does not exist: ${request.guestPath}`);
    }
    return {
      guestPath: request.guestPath,
      kind: request.kind,
      mimeType: request.mimeType,
      sensitivity: request.sensitivity,
      modelVisible: request.modelVisible,
      contentBase64: readFileSync(hostPath).toString('base64')
    };
  }

  public revert(context: CreatedRunContext, snapshotRef: string): Record<string, unknown> {
    return this.resetContext(context, snapshotRef);
  }

  public preserve(context: CreatedRunContext, reason: string): Record<string, unknown> {
    const dir = contextDir(this.stateRoot, context.vmContext.id);
    const state = readState(dir, context);
    state.preserved = true;
    writeState(dir, state);
    return { preserved: true, reason };
  }

  public destroy(context: CreatedRunContext): Record<string, unknown> {
    rmSync(contextDir(this.stateRoot, context.vmContext.id), { recursive: true, force: true });
    return { destroyed: true };
  }

  private readStatus(): ExecutorCapabilities {
    const dockerVersion = runDocker(this.dockerCommand, ['--version'], this.statusTimeoutMs);
    const dockerConfigured = dockerVersion.status === 0;
    const dockerInfo = dockerConfigured ? runDocker(this.dockerCommand, ['info'], this.statusTimeoutMs) : dockerVersion;
    const image = dockerImage('beale-default-toolchain');
    const imageInspect = dockerInfo.status === 0 ? runDocker(this.dockerCommand, ['image', 'inspect', image], this.statusTimeoutMs) : dockerInfo;
    const available = dockerConfigured && dockerInfo.status === 0 && imageInspect.status === 0;
    const reason = available
      ? null
      : !dockerConfigured
        ? 'Docker CLI is not available. Install Docker and make the docker command available.'
        : dockerInfo.status !== 0
          ? `Docker daemon is not available: ${safeOutput(dockerInfo.stderr || dockerInfo.error)}`
          : `Docker sandbox image is not available locally: ${image}. Pull it or set BEALE_DOCKER_IMAGE.`;
    return {
      protocolVersion: PROTOCOL_VERSION,
      provider: 'docker',
      configured: dockerConfigured,
      available,
      label: available ? 'Docker sandbox' : 'Docker sandbox unavailable',
      reason,
      targetExecution: available,
      supportedNetworkProfiles: ['offline', 'elevated'],
      metadata: {
        dockerCommand: this.dockerCommand,
        image,
        stateRoot: this.stateRoot,
        isolation: 'container',
        lessSecureThanVirtualMachine: true
      },
      supports: {
        snapshots: true,
        clone: true,
        import: true,
        export: true,
        shell: true,
        python: true,
        debugger: false
      },
      backends: [
        {
          kind: 'docker',
          label: 'Docker container sandbox',
          platform: 'any',
          configured: dockerConfigured,
          available,
          recommended: false,
          reason
        }
      ]
    };
  }

  private resetContext(context: CreatedRunContext, snapshotRef: string): Record<string, unknown> {
    const dir = contextDir(this.stateRoot, context.vmContext.id);
    const state = readState(dir, context);
    rmSync(workspaceDir(dir), { recursive: true, force: true });
    rmSync(tmpDir(dir), { recursive: true, force: true });
    mkdirSync(workspaceDir(dir), { recursive: true });
    mkdirSync(tmpDir(dir), { recursive: true });
    state.imports = [];
    writeState(dir, state);
    return { reset: true, snapshotRef };
  }
}

function dockerRunArgs(state: DockerContextState, request: GuestExecuteRequest, workspacePath: string, tmpPath: string): string[] {
  const args = [
    'run',
    '--rm',
    '--pull',
    'never',
    '--network',
    request.networkProfile === 'offline' ? 'none' : 'bridge',
    '-v',
    `${workspacePath}:/workspace`,
    '-v',
    `${tmpPath}:/tmp`
  ];
  for (const spec of state.imports) {
    args.push('-v', `${spec.hostPath}:${spec.guestPath}:${spec.mode === 'read_only' ? 'ro' : 'rw'}`);
  }
  for (const [key, value] of Object.entries(request.env ?? {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !SECRET_ENV_PATTERN.test(key)) {
      args.push('-e', `${key}=${value}`);
    }
  }
  args.push('-w', request.cwd || '/workspace', state.imageRef, ...request.command);
  return args;
}

function dockerGuestPathToHostPath(contextPath: string, guestPath: string): string | null {
  const normalized = guestPath.replace(/\/+/g, '/');
  if (normalized === '/tmp') return tmpDir(contextPath);
  if (normalized.startsWith('/tmp/')) return pathInside(tmpDir(contextPath), normalized.slice('/tmp/'.length));
  if (normalized === '/workspace') return workspaceDir(contextPath);
  if (normalized.startsWith('/workspace/')) return pathInside(workspaceDir(contextPath), normalized.slice('/workspace/'.length));
  return null;
}

function contextDir(stateRoot: string, vmContextId: string): string {
  return join(stateRoot, safeName(vmContextId));
}

function workspaceDir(contextPath: string): string {
  return join(contextPath, 'workspace');
}

function tmpDir(contextPath: string): string {
  return join(contextPath, 'tmp');
}

function pathInside(root: string, childPath: string): string | null {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, childPath);
  const rel = relative(resolvedRoot, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) ? candidate : null;
}

function readState(dir: string, context: CreatedRunContext): DockerContextState {
  const path = join(dir, 'state.json');
  if (!existsSync(path)) {
    return {
      vmContextId: context.vmContext.id,
      imageRef: dockerImage(context.vmContext.imageId),
      imports: [],
      preserved: false
    };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as DockerContextState;
}

function writeState(dir: string, state: DockerContextState): void {
  mkdirSync(dirname(join(dir, 'state.json')), { recursive: true });
  writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function dockerImage(imageRef: string): string {
  const configured = process.env.BEALE_DOCKER_IMAGE?.trim();
  if (configured) return configured;
  return imageRef && imageRef !== 'beale-default-toolchain' ? imageRef : DEFAULT_DOCKER_IMAGE;
}

function runDocker(command: string, args: string[], timeoutMs: number): { status: number | null; stderr: string; error: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env: minimalDockerEnv()
  });
  return { status: result.status, stderr: result.stderr ?? '', error: result.error?.message ?? '' };
}

function runDockerAsync(command: string, args: string[], timeoutMs: number): Promise<{ status: number | null; stdout: string; stderr: string; error: string }> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: minimalDockerEnv()
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(null, '', '', `Timed out after ${timeoutMs} ms.`);
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk.toString('utf8'));
    });
    child.on('error', (error) => finish(null, stdout, stderr, error.message));
    child.on('close', (status) => finish(status, stdout, stderr, ''));

    function finish(status: number | null, out: string, err: string, error: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ status, stdout: out, stderr: err, error });
    }
  });
}

function boundedAppend(current: string, next: string): string {
  const combined = `${current}${next}`;
  return combined.length > MAX_SETUP_OUTPUT_BYTES ? combined.slice(-MAX_SETUP_OUTPUT_BYTES) : combined;
}

function minimalDockerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'USERNAME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'DOCKER_HOST', 'DOCKER_CONTEXT']) {
    const value = process.env[key];
    if (value && !SECRET_ENV_PATTERN.test(key)) env[key] = value;
  }
  return env;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function safeOutput(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-...redacted').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ...redacted').slice(0, 500);
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
