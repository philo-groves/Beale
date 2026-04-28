#!/usr/bin/env node
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PROTOCOL_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 120_000;
const GUEST_WORKSPACE_ROOT = '/workspace';
const GUEST_METADATA_ROOT = `${GUEST_WORKSPACE_ROOT}/.beale`;
const MAX_IMPORT_FILES = 10_000;
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const MAX_IMPORT_DEPTH = 64;

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
    supportedNetworkProfiles: config.enableScopedNetwork ? ['offline', 'scoped', 'elevated'] : ['offline', 'elevated'],
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
    await networkNatCheck(),
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
  const networkProfile = normalizeNetworkProfile(payload.networkProfile);
  const networkPolicy = await validateNetworkPolicy(config, networkProfile, payload.networkPolicy);
  const state = {
    vmContextId: payload.vmContextId,
    runId: payload.runId,
    attemptId: payload.attemptId,
    snapshotRef: payload.snapshotRef ?? 'clean',
    networkProfile,
    networkPolicy,
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
  if (payload.networkProfile || payload.networkPolicy) {
    const networkProfile = normalizeNetworkProfile(payload.networkProfile ?? state.networkProfile);
    state.networkProfile = networkProfile;
    state.networkPolicy = await validateNetworkPolicy(config, networkProfile, payload.networkPolicy ?? state.networkPolicy);
    clearNetworkConfigurationState(state);
  }
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
  const validated = validateImportSpec(spec);
  state.imports = [...(state.imports ?? []), validated.spec];
  writeState(dir, state);
  return { queued: true, guestPath: validated.spec.guestPath, mode: validated.spec.mode, importSummary: validated.summary };
}

async function executeGuestOperation(config, payload) {
  await requireReady(config);
  const dir = contextDir(config, payload);
  const operation = payload.operation;
  if (!operation || !Array.isArray(operation.command) || operation.command.length === 0) {
    throw new Error('execute requires a non-empty operation.command array');
  }
  const networkProfile = normalizeNetworkProfile(operation.networkProfile ?? payload.networkProfile);
  const networkPolicy = await validateNetworkPolicy(config, networkProfile, operation.networkPolicy ?? payload.networkPolicy);
  const state = readState(dir, payload);
  state.networkProfile = networkProfile;
  state.networkPolicy = networkPolicy;
  clearNetworkConfigurationState(state);
  writeState(dir, state);
  await ensureStarted(config, dir, payload);
  await materializeImports(config, dir, payload);

  const started = Date.now();
  const script = guestOperationScript(operation);
  const localScript = join(dir, 'operation.sh');
  const remoteScript = `/tmp/beale-operation-${Date.now()}.sh`;
  writeFileSync(localScript, script, { mode: 0o700 });
  scpToGuest(config, localScript, remoteScript);
  const result = ssh(config, ['sh', remoteScript], Number(operation.timeoutMs ?? config.commandTimeoutMs), { allowFailure: true });
  if (!result.timedOut && (result.error || result.status === 255)) {
    throw new Error(`Guest SSH operation failed: ${(result.stderr || result.error || `status ${result.status}`).slice(0, 800)}`);
  }
  const ended = Date.now();
  const status = result.status === 0 ? 'success' : result.timedOut ? 'timeout' : 'failure';
  const updatedState = readState(dir, payload);
  updatedState.contaminated = true;
  writeState(dir, updatedState);
  return {
    status,
    exitCode: result.status,
    signal: result.signal,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    durationMs: ended - started,
    stdoutSummary: result.stdout.slice(0, 4000),
    stderrSummary: result.stderr.slice(0, 4000),
    structured: {
      backend: 'firecracker',
      networkProfile,
      allowedDestinations: networkPolicy.allowedDestinations,
      resolvedDestinations: networkPolicy.resolvedDestinations
    },
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
    await ensureNetworkConfigured(config, dir, payload);
    return;
  }
  if (state.running && state.pid && isProcessAlive(state.pid)) {
    await ensureNetworkConfigured(config, dir, payload);
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
  await ensureNetworkConfigured(config, dir, payload);
}

async function materializeImports(config, dir, payload) {
  const state = readState(dir, payload);
  if (state.importsMaterialized) return;
  for (const spec of state.imports ?? []) {
    ssh(config, ['mkdir', '-p', dirname(spec.guestPath)], config.commandTimeoutMs);
    scpToGuest(config, spec.hostPath, spec.guestPath);
    if (spec.mode !== 'copy') {
      ssh(config, ['chmod', '-R', 'a-w', spec.guestPath], config.commandTimeoutMs);
    }
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

async function ensureNetworkConfigured(config, dir, payload) {
  const state = readState(dir, payload);
  if (state.networkProfile === 'offline') {
    cleanupAllNetwork(config, state, { allowFailure: true });
    state.networkConfiguredProfile = 'offline';
    writeState(dir, state);
    return;
  }
  if (state.networkProfile === 'elevated') {
    if (state.onlineNetworkConfigured === true && state.networkConfiguredProfile === 'elevated') {
      return;
    }
    setupOnlineNetwork(config, state);
    configureGuestDefaultRoute(config);
    state.onlineNetworkConfigured = true;
    state.networkConfiguredProfile = 'elevated';
    writeState(dir, state);
    return;
  }
  const policy = state.networkPolicy;
  if (!policy?.resolvedDestinations?.length) {
    throw new Error('Scoped network policy is missing resolved destinations.');
  }
  const fingerprint = JSON.stringify(policy.resolvedDestinations);
  if (state.scopedNetworkConfigured === true && state.scopedNetworkFingerprint === fingerprint) {
    return;
  }
  setupScopedNetwork(config, state);
  configureScopedGuestNetwork(config, policy);
  state.scopedNetworkConfigured = true;
  state.scopedNetworkFingerprint = fingerprint;
  state.networkConfiguredProfile = 'scoped';
  writeState(dir, state);
}

function clearNetworkConfigurationState(state) {
  state.scopedNetworkConfigured = false;
  state.scopedNetworkFingerprint = null;
  state.onlineNetworkConfigured = false;
  state.networkConfiguredProfile = null;
}

function cleanupAllNetwork(config, state, options = {}) {
  cleanupOnlineNetwork(config, state, options);
  cleanupScopedNetwork(config, state, options);
}

function setupScopedNetwork(config, state) {
  const name = tapName(config, state.vmContextId);
  const allowSpec = networkAllowSpec(state.networkPolicy.resolvedDestinations);
  if (config.privilegedHelper) {
    cleanupAllNetwork(config, state, { allowFailure: true });
    privileged(config, ['scoped-network-setup', name, config.network.guestIp, allowSpec]);
    return;
  }
  cleanupAllNetwork(config, state, { allowFailure: true });
  runHost(config, 'sysctl', ['-w', 'net.ipv4.ip_forward=1']);
  const chain = firewallChainName(config, state.vmContextId);
  runHost(config, 'iptables', ['-N', chain]);
  runHost(config, 'iptables', ['-A', 'FORWARD', '-i', name, '-j', chain]);
  runHost(config, 'iptables', ['-A', 'FORWARD', '-o', name, '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT']);
  runHost(config, 'iptables', ['-t', 'nat', '-A', 'POSTROUTING', '-s', `${config.network.guestIp}/32`, '-j', 'MASQUERADE']);
  for (const destination of state.networkPolicy.resolvedDestinations) {
    addFirewallAllowRule(config, chain, destination);
  }
  runHost(config, 'iptables', ['-A', chain, '-j', 'REJECT']);
}

function setupOnlineNetwork(config, state) {
  const name = tapName(config, state.vmContextId);
  if (config.privilegedHelper) {
    const result = privileged(config, ['online-network-setup', name, config.network.guestIp], { allowFailure: true });
    if (result.status === 0) return;
    cleanupAllNetwork(config, state, { allowFailure: true });
    privileged(config, ['scoped-network-setup', name, config.network.guestIp, onlineAllowSpec()]);
    return;
  }
  cleanupAllNetwork(config, state, { allowFailure: true });
  runHost(config, 'sysctl', ['-w', 'net.ipv4.ip_forward=1']);
  runHost(config, 'iptables', ['-A', 'FORWARD', '-i', name, '-j', 'ACCEPT']);
  runHost(config, 'iptables', ['-A', 'FORWARD', '-o', name, '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT']);
  runHost(config, 'iptables', ['-t', 'nat', '-A', 'POSTROUTING', '-s', `${config.network.guestIp}/32`, '-j', 'MASQUERADE']);
}

function cleanupOnlineNetwork(config, state, options = {}) {
  if (!state.vmContextId) return;
  const name = tapName(config, state.vmContextId);
  if (config.privilegedHelper) {
    privileged(config, ['online-network-cleanup', name, config.network.guestIp], { ...options, allowFailure: true });
    return;
  }
  runHost(config, 'iptables', ['-D', 'FORWARD', '-i', name, '-j', 'ACCEPT'], options);
  runHost(config, 'iptables', ['-D', 'FORWARD', '-o', name, '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'], options);
  runHost(config, 'iptables', ['-t', 'nat', '-D', 'POSTROUTING', '-s', `${config.network.guestIp}/32`, '-j', 'MASQUERADE'], options);
}

function cleanupScopedNetwork(config, state, options = {}) {
  if (!state.vmContextId) return;
  const name = tapName(config, state.vmContextId);
  if (config.privilegedHelper) {
    privileged(config, ['scoped-network-cleanup', name, config.network.guestIp], options);
    return;
  }
  const chain = firewallChainName(config, state.vmContextId);
  runHost(config, 'iptables', ['-D', 'FORWARD', '-i', name, '-j', chain], options);
  runHost(config, 'iptables', ['-D', 'FORWARD', '-o', name, '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'], options);
  runHost(config, 'iptables', ['-t', 'nat', '-D', 'POSTROUTING', '-s', `${config.network.guestIp}/32`, '-j', 'MASQUERADE'], options);
  runHost(config, 'iptables', ['-F', chain], options);
  runHost(config, 'iptables', ['-X', chain], options);
}

function addFirewallAllowRule(config, chain, destination) {
  const base = ['-A', chain, '-d', destination.ip];
  if (destination.protocol && destination.port) {
    runHost(config, 'iptables', [...base, '-p', destination.protocol, '--dport', String(destination.port), '-j', 'ACCEPT']);
  } else if (destination.protocol) {
    runHost(config, 'iptables', [...base, '-p', destination.protocol, '-j', 'ACCEPT']);
  } else {
    runHost(config, 'iptables', [...base, '-j', 'ACCEPT']);
  }
}

function onlineAllowSpec() {
  return '0.0.0.0/0,any,any';
}

function configureScopedGuestNetwork(config, policy) {
  const hostEntries = policy.resolvedDestinations
    .filter((destination) => destination.hostname)
    .map((destination) => `${destination.ip} ${destination.hostname}`)
    .join('\n');
  const commands = [guestDefaultRouteCommand(config)];
  if (hostEntries) {
    commands.push(`printf '%s\\n' ${shellQuote(hostEntries)} >> /etc/hosts`);
  }
  ssh(config, ['sh', '-lc', commands.join(' && ')], config.commandTimeoutMs);
}

function configureGuestDefaultRoute(config) {
  ssh(config, ['sh', '-lc', guestDefaultRouteCommand(config)], config.commandTimeoutMs);
}

function guestDefaultRouteCommand(config) {
  return `ip route replace default via ${shellQuote(config.network.hostIp)} dev eth0`;
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
    cleanupAllNetwork(config, state, { allowFailure: true });
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

function normalizeNetworkProfile(profile) {
  if (profile === 'scoped') return 'scoped';
  if (profile === 'elevated' || profile === 'online') return 'elevated';
  return 'offline';
}

async function validateNetworkPolicy(config, profile, policy) {
  if (profile === 'offline') {
    return {
      profile: 'offline',
      allowedDestinations: [],
      resolvedDestinations: [],
      liveTargetAllowed: false,
      failClosed: true
    };
  }
  if (profile === 'elevated') {
    const allowedDestinations = Array.isArray(policy?.allowedDestinations)
      ? policy.allowedDestinations.map(normalizeNetworkDestination).filter(Boolean)
      : [];
    return {
      profile: 'elevated',
      scopeVersionId: typeof policy?.scopeVersionId === 'string' ? policy.scopeVersionId : null,
      allowedDestinations,
      resolvedDestinations: [],
      liveTargetAllowed: policy?.liveTargetAllowed !== false,
      userApprovalRequired: policy?.userApprovalRequired !== false,
      failClosed: false,
      enforcement: 'firecracker_unrestricted_nat'
    };
  }
  if (profile === 'scoped' && !config.enableScopedNetwork) {
    throw new Error('Firecracker scoped networking is not enabled in this controller config.');
  }
  if (!policy || !Array.isArray(policy.allowedDestinations) || policy.allowedDestinations.length === 0) {
    throw new Error('Scoped networking requires a non-empty networkPolicy.allowedDestinations allowlist.');
  }
  const allowedDestinations = policy.allowedDestinations.map(normalizeNetworkDestination).filter(Boolean);
  if (allowedDestinations.length === 0) {
    throw new Error('Scoped networking requires at least one valid allowed destination.');
  }
  const resolvedDestinations = await resolveAllowedDestinations(allowedDestinations);
  if (resolvedDestinations.length === 0) {
    throw new Error('Scoped networking could not resolve any allowed IPv4 destination.');
  }
  return {
    profile,
    scopeVersionId: typeof policy.scopeVersionId === 'string' ? policy.scopeVersionId : null,
    allowedDestinations,
    resolvedDestinations,
    liveTargetAllowed: true,
    userApprovalRequired: policy.userApprovalRequired !== false,
    failClosed: true,
    enforcement: 'firecracker_iptables'
  };
}

function normalizeNetworkDestination(destination) {
  if (!destination || typeof destination.value !== 'string') return null;
  const value = destination.value.trim();
  if (!value || value.includes('\0')) return null;
  const kind = ['domain', 'host', 'ip_range', 'service'].includes(destination.kind) ? destination.kind : 'host';
  const protocol = typeof destination.protocol === 'string' && ['tcp', 'udp'].includes(destination.protocol.toLowerCase()) ? destination.protocol.toLowerCase() : null;
  const port = Number.isInteger(destination.port) && destination.port > 0 && destination.port <= 65535 ? destination.port : null;
  return { kind, value, protocol, port };
}

async function resolveAllowedDestinations(destinations) {
  const resolved = [];
  for (const destination of destinations) {
    const host = destinationHost(destination.value);
    if (isIpv4Cidr(host) || isIP(host) === 4) {
      resolved.push({ ...destination, ip: host, hostname: isIP(host) === 4 ? null : host });
      continue;
    }
    const answers = await lookup(host, { all: true, verbatim: true });
    const ipv4 = answers.filter((answer) => answer.family === 4).map((answer) => answer.address);
    for (const address of [...new Set(ipv4)]) {
      resolved.push({ ...destination, value: host, ip: address, hostname: host });
    }
  }
  return resolved;
}

function destinationHost(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname;
  } catch {
    return value;
  }
}

function isIpv4Cidr(value) {
  const [address, prefix, extra] = String(value).split('/');
  if (extra !== undefined || prefix === undefined) return false;
  const prefixNumber = Number(prefix);
  return isIP(address) === 4 && Number.isInteger(prefixNumber) && prefixNumber >= 0 && prefixNumber <= 32;
}

function validateImportSpec(spec) {
  if (!isAbsolute(spec.hostPath)) {
    throw new Error('Import source path must be absolute.');
  }
  const guestPath = normalizeGuestWorkspacePath(spec.guestPath);
  if (!guestPath) {
    throw new Error('Import guest path must stay inside /workspace and outside .beale.');
  }
  if (!existsSync(spec.hostPath)) {
    throw new Error(`Import source does not exist: ${spec.hostPath}`);
  }
  const hostPath = resolve(spec.hostPath);
  const rootLstat = lstatSync(hostPath);
  if (rootLstat.isSymbolicLink()) {
    throw new Error(`Import source cannot be a symbolic link: ${hostPath}`);
  }
  const hostRealPath = realpathSync(hostPath);
  if (pathContainsSegment(hostPath, '.beale') || pathContainsSegment(hostRealPath, '.beale')) {
    throw new Error('Workspace metadata cannot be imported into the guest.');
  }
  const stat = statSync(hostRealPath);
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error('Import source must be a file or directory.');
  }
  const summary = scanImportTree(hostRealPath);
  return {
    spec: {
      hostPath: hostRealPath,
      guestPath,
      mode: spec.mode === 'copy' ? 'copy' : 'read_only'
    },
    summary
  };
}

function normalizeGuestWorkspacePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || !path.startsWith('/')) return null;
  const normalized = posix.normalize(path);
  if (normalized === GUEST_WORKSPACE_ROOT) return null;
  if (normalized !== GUEST_WORKSPACE_ROOT && !normalized.startsWith(`${GUEST_WORKSPACE_ROOT}/`)) return null;
  if (normalized === GUEST_METADATA_ROOT || normalized.startsWith(`${GUEST_METADATA_ROOT}/`)) return null;
  if (normalized.split('/').includes('..')) return null;
  return normalized;
}

function scanImportTree(rootPath) {
  const summary = { fileCount: 0, directoryCount: 0, sizeBytes: 0 };
  visitImportTree(rootPath, 0, summary);
  const stat = statSync(rootPath);
  return {
    kind: stat.isDirectory() ? 'directory' : 'file',
    fileCount: summary.fileCount,
    directoryCount: summary.directoryCount,
    sizeBytes: summary.sizeBytes,
    maxBytes: MAX_IMPORT_BYTES,
    maxFiles: MAX_IMPORT_FILES
  };
}

function visitImportTree(path, depth, summary) {
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
    return;
  }
  if (!lstat.isDirectory()) {
    throw new Error(`Import tree can only contain files and directories: ${path}`);
  }
  summary.directoryCount += 1;
  for (const entry of readdirSync(path)) {
    visitImportTree(resolve(path, entry), depth + 1, summary);
  }
}

function pathContainsSegment(path, segment) {
  return path.split(/[\\/]+/).includes(segment);
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
  if (result.status !== 0) {
    return { name: 'privileged_helper', ok: false, message: `privileged helper failed: ${(result.stderr || result.stdout).trim()}` };
  }
  const online = spawnSync('sudo', ['-n', config.privilegedHelper, 'online-network-cleanup', 'bealefcdoctor', config.network.guestIp], { encoding: 'utf8' });
  const scoped = spawnSync('sudo', ['-n', config.privilegedHelper, 'scoped-network-cleanup', 'bealefcdoctor', config.network.guestIp], { encoding: 'utf8' });
  if (online.status !== 0 && scoped.status !== 0) {
    return {
      name: 'privileged_helper',
      ok: false,
      message: `privileged helper lacks Firecracker network support; reinstall it with npm run firecracker:install-privileged-helper. ${(online.stderr || online.stdout || scoped.stderr || scoped.stdout).trim()}`
    };
  }
  if (config.enableScopedNetwork && scoped.status !== 0) {
    return {
      name: 'privileged_helper',
      ok: false,
      message: `privileged helper lacks scoped-network support; reinstall it with npm run firecracker:install-privileged-helper. ${(scoped.stderr || scoped.stdout).trim()}`
    };
  }
  return { name: 'privileged_helper', ok: true, message: 'privileged helper: ok' };
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

function firewallChainName(config, contextId) {
  return `BEALE${tapName(config, contextId)}`.slice(0, 28);
}

function networkAllowSpec(destinations) {
  return destinations
    .map((destination) => [destination.ip, destination.protocol ?? 'any', destination.port ?? 'any'].join(','))
    .join(';');
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

async function networkNatCheck() {
  const iptables = await commandCheck('iptables');
  const sysctl = await commandCheck('sysctl');
  const missing = [iptables, sysctl].filter((check) => !check.ok);
  if (missing.length > 0) {
    return { name: 'network_nat', ok: false, message: missing.map((check) => check.message).join(' ') };
  }
  return { name: 'network_nat', ok: true, message: 'network NAT: firewall tools available' };
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
