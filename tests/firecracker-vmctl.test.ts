import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Firecracker vmctl controller', () => {
  it('reports available capabilities when configured assets are present', () => {
    const { configPath } = fixtureConfig();
    const response = vmctl(configPath, 'list_capabilities', {});

    expect(response.ok).toBe(true);
    expect(response.result.available).toBe(true);
    expect(response.result.label).toBe('Firecracker VM executor');
    expect(response.result.supportedNetworkProfiles).toEqual(['offline']);
    expect(response.result.supports).toMatchObject({ clone: true, import: true, export: true, shell: true, python: true });
  });

  it('fails closed when required Firecracker assets are missing', () => {
    const { configPath, rootfsPath } = fixtureConfig();
    rmSync(rootfsPath);
    const response = vmctl(configPath, 'list_capabilities', {});

    expect(response.ok).toBe(true);
    expect(response.result.available).toBe(false);
    expect(response.result.reason).toContain('rootfs missing or inaccessible');
  });

  it('creates and resets context rootfs copies without booting a guest', () => {
    const { configPath, stateDir } = fixtureConfig();
    const basePayload = {
      vmContextId: 'vm_firecracker_test',
      runId: 'run_firecracker_test',
      attemptId: 'attempt_firecracker_test',
      scopeVersionId: 'scope_firecracker_test',
      snapshotRef: 'clean',
      networkProfile: 'offline'
    };

    expect(vmctl(configPath, 'create_context', basePayload).result.state).toBe('clean');
    const contextRootfs = join(stateDir, 'vm_firecracker_test', 'rootfs.ext4');
    expect(existsSync(contextRootfs)).toBe(true);

    writeFileSync(contextRootfs, 'mutated rootfs');
    expect(vmctl(configPath, 'clone_context', basePayload).result.reset).toBe(true);
    expect(readFileSync(contextRootfs, 'utf8')).toBe('base rootfs');
  });

  it('retries guest SSH readiness before executing an operation', () => {
    const { configPath, fakeBinDir, sshLogPath } = fixtureConfig({ fakeRuntimeCommands: true });
    const payload = {
      vmContextId: 'vm_firecracker_retry_test',
      runId: 'run_firecracker_retry_test',
      attemptId: 'attempt_firecracker_retry_test',
      scopeVersionId: 'scope_firecracker_retry_test',
      snapshotRef: 'clean',
      networkProfile: 'offline'
    };
    const env = { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH ?? ''}` };

    expect(vmctl(configPath, 'create_context', payload, env).result.state).toBe('clean');
    const response = vmctl(
      configPath,
      'execute',
      {
        ...payload,
        operation: {
          command: ['true'],
          cwd: '/',
          env: {},
          timeoutMs: 1000,
          networkProfile: 'offline'
        }
      },
      env
    );

    try {
      expect(response.result.status).toBe('success');
      const sshCalls = readFileSync(sshLogPath, 'utf8').trim().split('\n');
      expect(sshCalls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vmctl(configPath, 'destroy', payload, env);
    }
  });

  it('returns non-zero guest exits as execution results instead of protocol errors', () => {
    const { configPath, fakeBinDir } = fixtureConfig({ fakeRuntimeCommands: true, fakeGuestExitCode: 7 });
    const payload = {
      vmContextId: 'vm_firecracker_guest_failure_test',
      runId: 'run_firecracker_guest_failure_test',
      attemptId: 'attempt_firecracker_guest_failure_test',
      scopeVersionId: 'scope_firecracker_guest_failure_test',
      snapshotRef: 'clean',
      networkProfile: 'offline'
    };
    const env = { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH ?? ''}` };

    expect(vmctl(configPath, 'create_context', payload, env).result.state).toBe('clean');
    const response = vmctl(
      configPath,
      'execute',
      {
        ...payload,
        operation: {
          command: ['sh', '-lc', 'exit 7'],
          cwd: '/',
          env: {},
          timeoutMs: 1000,
          networkProfile: 'offline'
        }
      },
      env
    );

    try {
      expect(response.ok).toBe(true);
      expect(response.result.status).toBe('failure');
      expect(response.result.exitCode).toBe(7);
    } finally {
      vmctl(configPath, 'destroy', payload, env);
    }
  });
});

function fixtureConfig(options: { fakeRuntimeCommands?: boolean; fakeGuestExitCode?: number } = {}): { configPath: string; stateDir: string; rootfsPath: string; fakeBinDir: string; sshLogPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beale-firecracker-vmctl-'));
  createdDirs.push(dir);
  const binDir = join(dir, 'bin');
  const fakeBinDir = join(dir, 'fake-bin');
  const imageDir = join(dir, 'images');
  const stateDir = join(dir, 'state');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });
  mkdirSync(imageDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  const firecrackerBin = join(binDir, 'firecracker');
  const kernelPath = join(imageDir, 'vmlinux');
  const rootfsPath = join(imageDir, 'rootfs.ext4');
  const sshKey = join(dir, 'id_rsa');
  const sshLogPath = join(dir, 'ssh.log');
  writeExecutable(
    firecrackerBin,
    options.fakeRuntimeCommands
      ? `#!/bin/sh
sock=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-sock)
      shift
      sock="$1"
      ;;
  esac
  shift
done
: > "$sock"
trap 'exit 0' TERM INT
while :; do
  sleep 1 &
  wait "$!"
done
`
      : '#!/bin/sh\nexit 0\n'
  );
  if (options.fakeRuntimeCommands) {
    const fakeGuestExitCode = Number.isInteger(options.fakeGuestExitCode) ? options.fakeGuestExitCode : 0;
    writeExecutable(join(fakeBinDir, 'curl'), '#!/bin/sh\nexit 0\n');
    writeExecutable(join(fakeBinDir, 'ip'), '#!/bin/sh\nexit 0\n');
    writeExecutable(join(fakeBinDir, 'scp'), '#!/bin/sh\nexit 0\n');
    writeExecutable(
      join(fakeBinDir, 'ssh'),
      `#!/bin/sh
count_file=${shellQuote(join(dir, 'ssh-count'))}
log_file=${shellQuote(sshLogPath)}
count=0
if [ -f "$count_file" ]; then
  count=$(cat "$count_file")
fi
count=$((count + 1))
printf '%s\\n' "$count" > "$count_file"
printf '%s\\n' "$*" >> "$log_file"
if [ "$count" -eq 1 ]; then
  printf '%s\\n' 'ssh fixture connection timed out' >&2
  exit 255
fi
last_arg=""
for arg do
  last_arg="$arg"
done
if [ "$last_arg" = "true" ]; then
  exit 0
fi
exit ${fakeGuestExitCode}
`
    );
  }
  writeFileSync(kernelPath, 'kernel');
  writeFileSync(rootfsPath, 'base rootfs');
  writeFileSync(sshKey, 'private key fixture');

  const configPath = join(dir, 'config.json');
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        firecrackerBin,
        kernelImage: kernelPath,
        rootfsImage: rootfsPath,
        sshKey,
        stateDir,
        runtimeDir: join(dir, 'run'),
        skipKvmCheck: true,
        skipTapCheck: true,
        enableScopedNetwork: false,
        sshTimeoutMs: 10_000
      },
      null,
      2
    )}\n`
  );
  return { configPath, stateDir, rootfsPath, fakeBinDir, sshLogPath };
}

function vmctl(
  configPath: string,
  action: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): { ok: boolean; result: Record<string, unknown>; error?: string } {
  const output = execFileSync(process.execPath, [join(process.cwd(), 'scripts/firecracker-vmctl.mjs'), '--config', configPath], {
    input: JSON.stringify({ protocolVersion: 1, action, payload }),
    encoding: 'utf8',
    env
  });
  return JSON.parse(output);
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
