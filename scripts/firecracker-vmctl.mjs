#!/usr/bin/env node
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const PROTOCOL_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 120_000;

main().catch((error) => {
  respond(false, undefined, error instanceof Error ? error.message : String(error));
});

async function main() {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  if (request.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported vmctl protocol version: ${request.protocolVersion}`);
  }

  const config = loadConfig(process.argv.slice(2));
  const payload = request.payload ?? {};
  switch (request.action) {
    case 'list_capabilities':
      respond(true, await capabilities(config));
      return;
    case 'create_context':
      respond(true, await createContext(config, payload));
      return;
    case 'restore_snapshot':
    case 'clone_context':
    case 'revert':
      respond(true, await resetContextRootfs(config, payload));
      return;
    case 'import_workspace_material':
      respond(true, queueImport(config, payload));
      return;
    case 'execute':
      respond(true, await executeGuestOperation(config, payload));
      return;
    case 'export_artifact':
      respond(true, await exportArtifact(config, payload));
      return;
    case 'preserve':
      respond(true, preserveContext(config, payload));
      return;
    case 'destroy':
      respond(true, destroyContext(config, payload));
      return;
    default:
      respond(false, undefined, `unsupported action: ${request.action}`);
  }
}

function loadConfig(args) {
  const configPath = optionValue(args, '--config') ?? join(process.cwd(), '.beale', 'firecracker', 'config.json');
  const root = dirname(resolve(configPath));
  const parsed = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  return {
    configPath: resolve(configPath),
    firecrackerBin: resolvePath(parsed.firecrackerBin, join(root, 'bin', 'firecracker')),
    kernelImage: resolvePath(parsed.kernelImage, join(root, 'images', 'vmlinux')),
    rootfsImage: resolvePath(parsed.rootfsImage, join(root, 'images', 'rootfs.ext4')),
    sshKey: resolvePath(parsed.sshKey, join(root, 'id_rsa')),
    stateDir: resolvePath(parsed.stateDir, join(root, 'state')),
    runtimeDir: resolvePath(parsed.runtimeDir, join(root, 'run')),
    privilegedHelper: parsed.privilegedHelper ? resolve(parsed.privilegedHelper) : '',
    bootArgs: parsed.bootArgs ?? 'console=ttyS0 reboot=k panic=1 pci=off',
    machine: {
      vcpuCount: Number(parsed.machine?.vcpuCount ?? 1),
      memSizeMib: Number(parsed.machine?.memSizeMib ?? 512),
      smt: Boolean(parsed.machine?.smt ?? false)
    },
    network: {
      hostIp: parsed.network?.hostIp ?? '172.16.0.1',
      guestIp: parsed.network?.guestIp ?? '172.16.0.2',
      guestMac: parsed.network?.guestMac ?? '06:00:AC:10:00:02',
      prefixLength: Number(parsed.network?.prefixLength ?? 30),
      tapPrefix: parsed.network?.tapPrefix ?? 'bealefc'
    },
    useSudo: Boolean(parsed.useSudo ?? false),
    skipKvmCheck: Boolean(parsed.skipKvmCheck ?? false),
    skipTapCheck: Boolean(parsed.skipTapCheck ?? false),
    enableScopedNetwork: Boolean(parsed.enableScopedNetwork ?? false),
    assumePython: parsed.assumePython !== false,
    sshTimeoutMs: Number(parsed.sshTimeoutMs ?? 30_000),
    commandTimeoutMs: Number(parsed.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS)
  };
}

async function capabilities(config) {
  const checks = await readinessChecks(config);
  const available = checks.every((check) => check.ok);
  return {
    protocolVersion: PROTOCOL_VERSION,
    provider: 'vmctl',
    configured: existsSync(config.configPath),
    available,
    label: available ? 'Firecracker VM executor' : 'Firecracker VM executor unavailable',
    reason: available ? null : checks.filter((check) => !check.ok).map((check) => check.message).join(' '),
    targetExecution: available,
    supportedNetworkProfiles: config.enableScopedNetwork ? ['offline', 'scoped'] : ['offline'],
    supports: {
      snapshots: true,
      clone: true,
      import: true,
      export: true,
      shell: true,
      python: config.assumePython,
      debugger: false
    },
    firecracker: {
      configPath: config.configPath,
      firecrackerBin: config.firecrackerBin,
      kernelImage: config.kernelImage,
      rootfsImage: config.rootfsImage,
      stateDir: config.stateDir,
      runtimeDir: config.runtimeDir,
      privilegedHelper: config.privilegedHelper || null,
      kvm: checks.find((check) => check.name === 'kvm')?.ok ?? false
    }
  };
}

async function readinessChecks(config) {
  return [
    await fileCheck('config', config.configPath, constants.R_OK),
    await fileCheck('firecracker', config.firecrackerBin, constants.X_OK),
    await fileCheck('kernel', config.kernelImage, constants.R_OK),
    await fileCheck('rootfs', config.rootfsImage, constants.R_OK),
    await fileCheck('ssh_key', config.sshKey, constants.R_OK),
    await commandCheck('curl'),
    await commandCheck('ssh'),
    await commandCheck('scp'),
    await commandCheck('ip'),
    privilegedHelperCheck(config),
    await kvmCheck(config),
    tapCheck(config)
  ];
}

async function createContext(config, payload) {
  await requireReady(config);
  const dir = contextDir(config, payload);
  mkdirSync(dir, { recursive: true });
  resetRootfs(config, dir);
  const state = {
    vmContextId: payload.vmContextId,
    runId: payload.runId,
    attemptId: payload.attemptId,
    snapshotRef: payload.snapshotRef ?? 'clean',
    networkProfile: payload.networkProfile ?? 'offline',
    imports: [],
    running: false,
    preserved: false
  };
  writeState(dir, state);
  return { providerContextId: payload.vmContextId, state: 'clean', backend: 'firecracker' };
}

async function resetContextRootfs(config, payload) {
  await requireReady(config);
  const dir = contextDir(config, payload);
  mkdirSync(dir, { recursive: true });
  stopContext(config, dir);
  resetRootfs(config, dir);
  const state = readState(dir, payload);
  state.snapshotRef = payload.snapshotRef ?? state.snapshotRef ?? 'clean';
  state.imports = [];
  state.running = false;
  writeState(dir, state);
  return { reset: true, snapshotRef: state.snapshotRef };
}

function queueImport(config, payload) {
  const dir = contextDir(config, payload);
  const state = readState(dir, payload);
  const spec = payload.import;
  if (!spec?.hostPath || !spec?.guestPath) {
    throw new Error('import_workspace_material requires import.hostPath and import.guestPath');
  }
  if (!existsSync(spec.hostPath)) {
    throw new Error(`Import source does not exist: ${spec.hostPath}`);
  }
  state.imports = [...(state.imports ?? []), spec];
  writeState(dir, state);
  return { queued: true, guestPath: spec.guestPath, mode: spec.mode ?? 'read_only' };
}

async function executeGuestOperation(config, payload) {
  await requireReady(config);
  const dir = contextDir(config, payload);
  const operation = payload.operation;
  if (!operation || !Array.isArray(operation.command) || operation.command.length === 0) {
    throw new Error('execute requires a non-empty operation.command array');
  }
  validateNetworkProfile(config, operation.networkProfile);
  await ensureStarted(config, dir, payload);
  await materializeImports(config, dir, payload);

  const started = Date.now();
  const script = guestOperationScript(operation);
  const localScript = join(dir, 'operation.sh');
  const remoteScript = `/tmp/beale-operation-${Date.now()}.sh`;
  writeFileSync(localScript, script, { mode: 0o700 });
  scpToGuest(config, localScript, remoteScript);
  const result = ssh(config, ['sh', remoteScript], Number(operation.timeoutMs ?? config.commandTimeoutMs));
  const ended = Date.now();
  const status = result.status === 0 ? 'success' : result.timedOut ? 'timeout' : 'failure';
  const state = readState(dir, payload);
  state.contaminated = true;
  writeState(dir, state);
  return {
    status,
    exitCode: result.status,
    signal: result.signal,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    durationMs: ended - started,
    stdoutSummary: result.stdout.slice(0, 4000),
    stderrSummary: result.stderr.slice(0, 4000),
    structured: { backend: 'firecracker', networkProfile: operation.networkProfile ?? payload.networkProfile ?? 'offline' },
    candidateArtifacts: [],
    contaminated: true,
    error: status === 'success' ? null : result.stderr.slice(0, 1000)
  };
}

async function exportArtifact(config, payload) {
  await requireReady(config);
  const dir = contextDir(config, payload);
  await ensureStarted(config, dir, payload);
  const request = payload.export;
  if (!request?.guestPath) {
    throw new Error('export_artifact requires export.guestPath');
  }
  const localPath = join(dir, 'exports', `${safeName(request.kind ?? 'artifact')}-${Date.now()}`);
  mkdirSync(dirname(localPath), { recursive: true });
  scpFromGuest(config, request.guestPath, localPath);
  return {
    guestPath: request.guestPath,
    kind: request.kind ?? 'artifact',
    mimeType: request.mimeType ?? 'application/octet-stream',
    sensitivity: request.sensitivity ?? 'internal',
    modelVisible: Boolean(request.modelVisible),
    contentBase64: readFileSync(localPath).toString('base64')
  };
}

function preserveContext(config, payload) {
  const dir = contextDir(config, payload);
  const state = readState(dir, payload);
  state.preserved = true;
  state.preserveReason = payload.reason ?? 'manual follow-up';
  writeState(dir, state);
  return { preserved: true, reason: state.preserveReason };
}

function destroyContext(config, payload) {
  const dir = contextDir(config, payload);
  stopContext(config, dir);
  rmSync(dir, { recursive: true, force: true });
  return { destroyed: true };
}

async function ensureStarted(config, dir, payload) {
  const state = readState(dir, payload);
  if (state.running && config.privilegedHelper && state.pidFile && existsSync(state.pidFile)) {
    return;
  }
  if (state.running && state.pid && isProcessAlive(state.pid)) {
    return;
  }
  setupTap(config, dir);
  const apiSocket = join(dir, 'firecracker.socket');
  const pidFile = join(dir, 'firecracker.pid');
  const logPath = join(dir, 'firecracker.log');
  rmSync(apiSocket, { force: true });

  if (config.privilegedHelper) {
    privileged(config, ['start-firecracker', apiSocket, pidFile]);
    state.pidFile = pidFile;
  } else {
    const args = [config.firecrackerBin, '--api-sock', apiSocket];
    const child = config.useSudo
      ? spawn('sudo', ['-n', ...args], { detached: true, stdio: 'ignore' })
      : spawn(config.firecrackerBin, ['--api-sock', apiSocket], { detached: true, stdio: 'ignore' });
    child.unref();
    state.pid = child.pid;
  }
  state.running = true;
  writeState(dir, state);

  await waitForPath(apiSocket, 5000);
  apiPut(config, apiSocket, '/logger', { log_path: logPath, level: 'Info', show_level: true, show_log_origin: true });
  apiPut(config, apiSocket, '/machine-config', {
    vcpu_count: config.machine.vcpuCount,
    mem_size_mib: config.machine.memSizeMib,
    smt: config.machine.smt
  });
  apiPut(config, apiSocket, '/boot-source', { kernel_image_path: config.kernelImage, boot_args: config.bootArgs });
  apiPut(config, apiSocket, '/drives/rootfs', {
    drive_id: 'rootfs',
    path_on_host: join(dir, 'rootfs.ext4'),
    is_root_device: true,
    is_read_only: false
  });
  apiPut(config, apiSocket, '/network-interfaces/eth0', {
    iface_id: 'eth0',
    guest_mac: config.network.guestMac,
    host_dev_name: tapName(config, payload.vmContextId)
  });
  apiPut(config, apiSocket, '/actions', { action_type: 'InstanceStart' });
  await waitForSsh(config);
}

async function materializeImports(config, dir, payload) {
  const state = readState(dir, payload);
  if (state.importsMaterialized) return;
  for (const spec of state.imports ?? []) {
    ssh(config, ['mkdir', '-p', dirname(spec.guestPath)], config.commandTimeoutMs);
    scpToGuest(config, spec.hostPath, spec.guestPath);
  }
  state.importsMaterialized = true;
  writeState(dir, state);
}

function setupTap(config, dir) {
  const state = readState(dir, {});
  const name = tapName(config, state.vmContextId);
  if (config.privilegedHelper) {
    privileged(config, ['tap-delete', name], { allowFailure: true });
    privileged(config, ['tap-create', name, `${config.network.hostIp}/${config.network.prefixLength}`]);
    return;
  }
  runHost(config, 'ip', ['link', 'del', name], { allowFailure: true });
  runHost(config, 'ip', ['tuntap', 'add', 'dev', name, 'mode', 'tap']);
  runHost(config, 'ip', ['addr', 'add', `${config.network.hostIp}/${config.network.prefixLength}`, 'dev', name]);
  runHost(config, 'ip', ['link', 'set', 'dev', name, 'up']);
}

function stopContext(config, dir) {
  if (!existsSync(dir)) return;
  const state = readState(dir, {});
  if (config.privilegedHelper && state.pidFile) {
    privileged(config, ['stop-firecracker', state.pidFile], { allowFailure: true });
  } else if (state.pid && isProcessAlive(state.pid)) {
    if (config.useSudo) {
      run('sudo', ['-n', 'kill', String(state.pid)], { allowFailure: true });
    } else {
      try {
        process.kill(state.pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }
  }
  if (state.vmContextId) {
    if (config.privilegedHelper) {
      privileged(config, ['tap-delete', tapName(config, state.vmContextId)], { allowFailure: true });
    } else {
      runHost(config, 'ip', ['link', 'del', tapName(config, state.vmContextId)], { allowFailure: true });
    }
  }
  state.running = false;
  writeState(dir, state);
}

function apiPut(config, socket, path, body) {
  if (config.privilegedHelper) {
    privileged(config, ['api-put', socket, path, JSON.stringify(body)]);
    return;
  }
  runHost(config, 'curl', ['-fsS', '-X', 'PUT', '--unix-socket', socket, '--data', JSON.stringify(body), `http://localhost${path}`]);
}

function ssh(config, command, timeoutMs, options = {}) {
  return run('ssh', sshBaseArgs(config).concat(command.map(String)), { ...options, timeoutMs });
}

function scpToGuest(config, source, destination) {
  run('scp', scpBaseArgs(config).concat(['-r', source, `root@${config.network.guestIp}:${destination}`]), { timeoutMs: config.commandTimeoutMs });
}

function scpFromGuest(config, source, destination) {
  run('scp', scpBaseArgs(config).concat([`root@${config.network.guestIp}:${source}`, destination]), { timeoutMs: config.commandTimeoutMs });
}

function sshBaseArgs(config) {
  return [
    '-i',
    config.sshKey,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'ConnectTimeout=2',
    `root@${config.network.guestIp}`
  ];
}

function scpBaseArgs(config) {
  return [
    '-i',
    config.sshKey,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'ConnectTimeout=2'
  ];
}

async function waitForSsh(config) {
  const deadline = Date.now() + config.sshTimeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    const result = ssh(config, ['true'], 3000, { allowFailure: true });
    if (result.status === 0) return;
    lastError = result.stderr || result.error || `status ${result.status}`;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Firecracker guest SSH at ${config.network.guestIp}: ${lastError.slice(0, 500)}`);
}

async function waitForPath(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function runHost(config, command, args, options = {}) {
  return config.useSudo ? run('sudo', ['-n', command, ...args], options) : run(command, args, options);
}

function privileged(config, args, options = {}) {
  return run('sudo', ['-n', config.privilegedHelper, ...args], options);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    windowsHide: true
  });
  const timedOut = result.error?.name === 'TimeoutError';
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    const stderr = result.stderr || result.error?.message || '';
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr.slice(0, 800)}`);
  }
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? '',
    timedOut
  };
}

async function requireReady(config) {
  const checks = await readinessChecks(config);
  const failures = checks.filter((check) => !check.ok);
  if (failures.length > 0) {
    throw new Error(failures.map((check) => check.message).join(' '));
  }
}

function validateNetworkProfile(config, profile) {
  const normalized = profile === 'scoped' ? 'scoped' : 'offline';
  if (normalized === 'scoped' && !config.enableScopedNetwork) {
    throw new Error('Firecracker scoped networking is not enabled in this controller config.');
  }
}

function tapCheck(config) {
  if (config.skipTapCheck || typeof process.getuid !== 'function' || process.getuid() === 0) {
    return { name: 'tap', ok: true, message: 'tap: ok' };
  }
  if (config.privilegedHelper) {
    const result = spawnSync('sudo', ['-n', config.privilegedHelper, 'doctor'], { encoding: 'utf8' });
    return result.status === 0
      ? { name: 'tap', ok: true, message: 'tap: privileged helper available' }
      : { name: 'tap', ok: false, message: `privileged helper is not available through passwordless sudo: ${(result.stderr || result.stdout).trim()}` };
  }
  if (config.useSudo) {
    const result = spawnSync('sudo', ['-n', 'true'], { encoding: 'utf8' });
    return result.status === 0
      ? { name: 'tap', ok: true, message: 'tap: sudo available' }
      : { name: 'tap', ok: false, message: 'TAP setup requires passwordless sudo when useSudo is enabled.' };
  }
  return { name: 'tap', ok: false, message: 'TAP setup requires root, CAP_NET_ADMIN, or useSudo with passwordless sudo.' };
}

function privilegedHelperCheck(config) {
  if (!config.privilegedHelper) {
    return { name: 'privileged_helper', ok: true, message: 'privileged helper not configured' };
  }
  if (!existsSync(config.privilegedHelper)) {
    return { name: 'privileged_helper', ok: false, message: `privileged helper missing: ${config.privilegedHelper}` };
  }
  const result = spawnSync('sudo', ['-n', config.privilegedHelper, 'doctor'], { encoding: 'utf8' });
  return result.status === 0
    ? { name: 'privileged_helper', ok: true, message: 'privileged helper: ok' }
    : { name: 'privileged_helper', ok: false, message: `privileged helper failed: ${(result.stderr || result.stdout).trim()}` };
}

function resetRootfs(config, dir) {
  mkdirSync(dir, { recursive: true });
  try {
    copyFileSync(config.rootfsImage, join(dir, 'rootfs.ext4'), constants.COPYFILE_FICLONE);
  } catch {
    copyFileSync(config.rootfsImage, join(dir, 'rootfs.ext4'));
  }
}

function readState(dir, payload) {
  const path = join(dir, 'state.json');
  if (!existsSync(path)) {
    return { vmContextId: payload.vmContextId, imports: [], running: false };
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeState(dir, state) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function contextDir(config, payload) {
  if (!payload.vmContextId) throw new Error('vmContextId is required');
  return join(config.stateDir, safeName(payload.vmContextId));
}

function guestOperationScript(operation) {
  const exports = Object.entries(operation.env ?? {})
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => `export ${key}=${shellQuote(String(value))}`)
    .join('\n');
  return [
    '#!/bin/sh',
    'set -eu',
    `cd ${shellQuote(operation.cwd || '/')}`,
    exports,
    `exec ${operation.command.map((part) => shellQuote(String(part))).join(' ')}`
  ]
    .filter(Boolean)
    .join('\n');
}

function tapName(config, contextId) {
  return `${config.network.tapPrefix}${safeName(contextId).slice(-8)}`;
}

function safeName(value) {
  return String(value ?? 'context').replace(/[^A-Za-z0-9_.-]/g, '_');
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function fileCheck(name, path, mode) {
  try {
    await access(path, mode);
    return { name, ok: true, message: `${name}: ok` };
  } catch {
    return { name, ok: false, message: `${name} missing or inaccessible: ${path}.` };
  }
}

async function commandCheck(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
  return result.status === 0
    ? { name: command, ok: true, message: `${command}: ok` }
    : { name: command, ok: false, message: `${command} is required but was not found in PATH.` };
}

async function kvmCheck(config) {
  if (config.skipKvmCheck || config.useSudo || config.privilegedHelper) {
    return { name: 'kvm', ok: true, message: 'kvm: skipped by config' };
  }
  try {
    await access('/dev/kvm', constants.R_OK | constants.W_OK);
    return { name: 'kvm', ok: true, message: 'kvm: ok' };
  } catch {
    return { name: 'kvm', ok: false, message: '/dev/kvm is not readable and writable by this user. Grant access with setfacl or the kvm group.' };
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function resolvePath(value, fallback) {
  return resolve(value ?? fallback);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function respond(ok, result, error) {
  console.log(JSON.stringify(ok ? { ok, result } : { ok, error }));
}
