#!/usr/bin/env node
import { chmodSync, chownSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const DEFAULT_ROOT = join(ROOT, '.beale', 'firecracker');
const DEFAULT_CONFIG = join(DEFAULT_ROOT, 'config.json');
const RELEASE_URL = 'https://github.com/firecracker-microvm/firecracker/releases';
const SYSTEM_FIRECRACKER_BIN = '/usr/local/bin/beale-firecracker';
const PRIVILEGED_HELPER = '/usr/local/libexec/beale-firecracker-helper';
const SUDOERS_FILE = '/etc/sudoers.d/beale-firecracker';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = process.argv.slice(2);
  const configPath = resolve(optionValue(args, '--config') ?? DEFAULT_CONFIG);
  if (args.includes('--init')) {
    initConfig(configPath);
  }
  if (args.includes('--install-binary')) {
    installBinary(configPath);
  }
  if (args.includes('--install-ci-images')) {
    installCiImages(configPath);
  }
  if (args.includes('--install-privileged-helper')) {
    installPrivilegedHelper(configPath);
  }
  if (args.includes('--doctor') || args.length === 0) {
    await doctor(configPath);
  }
}

function initConfig(configPath) {
  const root = dirname(configPath);
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(root, 'images'), { recursive: true });
  mkdirSync(join(root, 'run'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${JSON.stringify(defaultConfig(root), null, 2)}\n`);
  }
  console.log(`Firecracker config ready: ${configPath}`);
  console.log(`Use with: BEALE_VMCTL_COMMAND=${process.execPath}`);
  console.log(`Args JSON: ${JSON.stringify([join(ROOT, 'scripts/firecracker-vmctl.mjs'), '--config', configPath])}`);
}

async function doctor(configPath) {
  const config = loadConfig(configPath);
  const checks = [
    await fileCheck('config', configPath, constants.R_OK),
    await fileCheck('firecracker', config.firecrackerBin, constants.X_OK),
    await fileCheck('kernel', config.kernelImage, constants.R_OK),
    await fileCheck('rootfs', config.rootfsImage, constants.R_OK),
    await fileCheck('ssh_key', config.sshKey, constants.R_OK),
    commandCheck('curl'),
    commandCheck('tar'),
    commandCheck('ssh'),
    commandCheck('scp'),
    commandCheck('ip'),
    commandCheck('setfacl'),
    commandCheck('sudo'),
    await kvmCheck(config),
    tapCheck(config)
  ];

  console.log('Firecracker setup doctor');
  for (const check of checks) {
    console.log(`${check.ok ? 'OK ' : 'ERR'} ${check.message}`);
  }
  const failures = checks.filter((check) => !check.ok);
  if (failures.length > 0) {
    console.log('');
    console.log('Next steps:');
    if (failures.some((check) => check.name === 'config')) {
      console.log(`- Run: npm run firecracker:init`);
    }
    if (failures.some((check) => check.name === 'firecracker')) {
      console.log(`- Run: npm run firecracker:install-binary`);
    }
    if (failures.some((check) => ['kernel', 'rootfs', 'ssh_key'].includes(check.name))) {
      console.log('- Run: npm run firecracker:install-ci-images');
      console.log('- Or provide a Firecracker-compatible kernel, ext4 rootfs, and SSH key in .beale/firecracker/images and update config.json.');
    }
    if (failures.some((check) => check.name === 'kvm')) {
      console.log(`- Grant KVM access for this WSL user, for example: sudo setfacl -m u:${process.env.USER}:rw /dev/kvm`);
      console.log(`- Or add the user to the kvm group and restart WSL: sudo usermod -aG kvm ${process.env.USER}`);
    }
    if (failures.some((check) => check.name === 'tap')) {
      console.log('- The Firecracker alpha controller needs TAP setup privileges for the host-to-guest control bridge.');
      console.log(`- Run: sudo node scripts/firecracker-setup.mjs --install-privileged-helper --config ${configPath}`);
    }
    process.exitCode = 1;
  }
}

function installPrivilegedHelper(configPath) {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error(`Privileged helper installation requires sudo. Run: sudo node scripts/firecracker-setup.mjs --install-privileged-helper --config ${configPath}`);
  }
  const targetUser = process.env.SUDO_USER || process.env.USER;
  if (!targetUser || targetUser === 'root') {
    throw new Error('Could not determine the non-root Beale user. Run this through sudo from your normal user account.');
  }
  const targetUid = Number(process.env.SUDO_UID || 0);
  const targetGid = Number(process.env.SUDO_GID || 0);
  const config = loadConfig(configPath);
  const configStat = existsSync(configPath) ? statSync(configPath) : null;

  mkdirSync(dirname(SYSTEM_FIRECRACKER_BIN), { recursive: true });
  mkdirSync(dirname(PRIVILEGED_HELPER), { recursive: true });
  if (resolve(config.firecrackerBin) !== SYSTEM_FIRECRACKER_BIN) {
    copyFileSync(config.firecrackerBin, SYSTEM_FIRECRACKER_BIN);
  }
  chmodSync(SYSTEM_FIRECRACKER_BIN, 0o755);
  chownSync(SYSTEM_FIRECRACKER_BIN, 0, 0);

  writeFileSync(PRIVILEGED_HELPER, privilegedHelperScript(dirname(configPath), SYSTEM_FIRECRACKER_BIN), { mode: 0o755 });
  chmodSync(PRIVILEGED_HELPER, 0o755);
  chownSync(PRIVILEGED_HELPER, 0, 0);

  const sudoers = `${targetUser} ALL=(root) NOPASSWD: ${PRIVILEGED_HELPER} *\n`;
  const sudoersTmp = `${SUDOERS_FILE}.tmp`;
  writeFileSync(sudoersTmp, sudoers, { mode: 0o440 });
  chmodSync(sudoersTmp, 0o440);
  chownSync(sudoersTmp, 0, 0);
  run('visudo', ['-cf', sudoersTmp]);
  renameSync(sudoersTmp, SUDOERS_FILE);

  const nextConfig = {
    ...config,
    firecrackerBin: SYSTEM_FIRECRACKER_BIN,
    privilegedHelper: PRIVILEGED_HELPER,
    useSudo: false,
    skipKvmCheck: false,
    skipTapCheck: false
  };
  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  if (configStat) {
    chownSync(configPath, configStat.uid, configStat.gid);
  } else if (targetUid > 0 && targetGid > 0) {
    chownSync(configPath, targetUid, targetGid);
  }

  console.log(`Installed root-owned Firecracker binary: ${SYSTEM_FIRECRACKER_BIN}`);
  console.log(`Installed privileged helper: ${PRIVILEGED_HELPER}`);
  console.log(`Installed sudoers rule: ${SUDOERS_FILE}`);
  console.log(`Updated Beale Firecracker config: ${configPath}`);
}

function installBinary(configPath) {
  const config = loadConfig(configPath);
  mkdirSync(dirname(config.firecrackerBin), { recursive: true });
  const arch = normalizedArch();
  const latestUrl = run('curl', ['-fsSLI', '-o', '/dev/null', '-w', '%{url_effective}', `${RELEASE_URL}/latest`]).stdout.trim();
  const latest = basename(latestUrl);
  if (!/^v\d+\.\d+\.\d+/.test(latest)) {
    throw new Error(`Could not determine latest Firecracker release from ${latestUrl}`);
  }
  const tmpDir = join(dirname(config.firecrackerBin), `.download-${Date.now()}`);
  const archive = join(tmpDir, 'firecracker.tgz');
  mkdirSync(tmpDir, { recursive: true });
  try {
    run('curl', ['-fL', `${RELEASE_URL}/download/${latest}/firecracker-${latest}-${arch}.tgz`, '-o', archive]);
    run('tar', ['-xzf', archive, '-C', tmpDir]);
    const releaseDir = join(tmpDir, `release-${latest}-${arch}`);
    const firecrackerSource = join(releaseDir, `firecracker-${latest}-${arch}`);
    const jailerSource = join(releaseDir, `jailer-${latest}-${arch}`);
    if (!existsSync(firecrackerSource)) {
      throw new Error(`Downloaded archive did not contain ${firecrackerSource}`);
    }
    renameSync(firecrackerSource, config.firecrackerBin);
    chmodExecutable(config.firecrackerBin);
    if (existsSync(jailerSource)) {
      const jailerTarget = join(dirname(config.firecrackerBin), 'jailer');
      renameSync(jailerSource, jailerTarget);
      chmodExecutable(jailerTarget);
    }
    console.log(`Installed Firecracker ${latest} to ${config.firecrackerBin}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function installCiImages(configPath) {
  const config = loadConfig(configPath);
  const toolChecks = ['curl', 'unsquashfs', 'ssh-keygen', 'fakeroot', 'mkfs.ext4', 'truncate'].map(commandCheck);
  const missing = toolChecks.filter((check) => !check.ok);
  if (missing.length > 0) {
    throw new Error(missing.map((check) => check.message).join(' '));
  }

  mkdirSync(dirname(config.kernelImage), { recursive: true });
  mkdirSync(dirname(config.rootfsImage), { recursive: true });
  mkdirSync(dirname(config.sshKey), { recursive: true });

  const arch = normalizedArch();
  const latestUrl = run('curl', ['-fsSLI', '-o', '/dev/null', '-w', '%{url_effective}', `${RELEASE_URL}/latest`]).stdout.trim();
  const latest = basename(latestUrl);
  const ciVersion = latest.replace(/\.[0-9]+$/, '');
  const kernelKey = latestS3Key(`firecracker-ci/${ciVersion}/${arch}/vmlinux-`, /^firecracker-ci\/.+\/vmlinux-[0-9]+\.[0-9]+\.[0-9]+$/);
  const ubuntuKey = latestS3Key(`firecracker-ci/${ciVersion}/${arch}/ubuntu-`, /^firecracker-ci\/.+\/ubuntu-[0-9]+\.[0-9]+\.squashfs$/);
  const tmpDir = join(dirname(config.rootfsImage), `.images-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    run('curl', ['-fL', `https://s3.amazonaws.com/spec.ccfc.min/${kernelKey}`, '-o', config.kernelImage]);
    const squashfs = join(tmpDir, 'ubuntu.squashfs');
    run('curl', ['-fL', `https://s3.amazonaws.com/spec.ccfc.min/${ubuntuKey}`, '-o', squashfs]);
    const rootDir = join(tmpDir, 'squashfs-root');
    run('unsquashfs', ['-f', '-d', rootDir, squashfs]);
    if (!existsSync(config.sshKey)) {
      run('ssh-keygen', ['-f', config.sshKey, '-N', '']);
    }
    const sshDir = join(rootDir, 'root', '.ssh');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(join(sshDir, 'authorized_keys'), readFileSync(`${config.sshKey}.pub`));
    run('truncate', ['-s', '1G', config.rootfsImage]);
    run('fakeroot', [
      'sh',
      '-c',
      `chown -R root:root ${shellQuote(rootDir)} && mkfs.ext4 -d ${shellQuote(rootDir)} -F ${shellQuote(config.rootfsImage)}`
    ]);
    console.log(`Installed Firecracker kernel: ${config.kernelImage}`);
    console.log(`Installed Firecracker rootfs: ${config.rootfsImage}`);
    console.log(`Installed Firecracker SSH key: ${config.sshKey}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function latestS3Key(prefix, pattern) {
  const xml = run('curl', ['-fsSL', `http://spec.ccfc.min.s3.amazonaws.com/?prefix=${prefix}&list-type=2`]).stdout;
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)]
    .map((match) => match[1])
    .filter((key) => pattern.test(key))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const key = keys.at(-1);
  if (!key) {
    throw new Error(`No Firecracker CI asset matched prefix ${prefix}`);
  }
  return key;
}

function defaultConfig(root) {
  return {
    firecrackerBin: join(root, 'bin', 'firecracker'),
    kernelImage: join(root, 'images', 'vmlinux'),
    rootfsImage: join(root, 'images', 'rootfs.ext4'),
    sshKey: join(root, 'id_rsa'),
    stateDir: join(root, 'state'),
    runtimeDir: join(root, 'run'),
    privilegedHelper: '',
    useSudo: false,
    skipKvmCheck: false,
    skipTapCheck: false,
    enableScopedNetwork: false,
    bootArgs: 'console=ttyS0 reboot=k panic=1 pci=off',
    machine: {
      vcpuCount: 1,
      memSizeMib: 512,
      smt: false
    },
    network: {
      hostIp: '172.16.0.1',
      guestIp: '172.16.0.2',
      guestMac: '06:00:AC:10:00:02',
      prefixLength: 30,
      tapPrefix: 'bealefc'
    }
  };
}

function loadConfig(configPath) {
  const root = dirname(configPath);
  const parsed = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : defaultConfig(root);
  const merged = {
    ...defaultConfig(root),
    ...parsed,
    machine: { ...defaultConfig(root).machine, ...parsed.machine },
    network: { ...defaultConfig(root).network, ...parsed.network }
  };
  return {
    ...merged,
    firecrackerBin: resolve(merged.firecrackerBin),
    kernelImage: resolve(merged.kernelImage),
    rootfsImage: resolve(merged.rootfsImage),
    sshKey: resolve(merged.sshKey),
    stateDir: resolve(merged.stateDir),
    runtimeDir: resolve(merged.runtimeDir),
    privilegedHelper: merged.privilegedHelper ? resolve(merged.privilegedHelper) : ''
  };
}

async function fileCheck(name, path, mode) {
  try {
    await access(path, mode);
    return { name, ok: true, message: `${name}: ${path}` };
  } catch {
    return { name, ok: false, message: `${name} missing or inaccessible: ${path}` };
  }
}

function commandCheck(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
  return result.status === 0
    ? { name: command, ok: true, message: `${command}: ${result.stdout.trim()}` }
    : { name: command, ok: false, message: `${command} is required but was not found in PATH` };
}

async function kvmCheck(config) {
  if (config.skipKvmCheck || config.useSudo || config.privilegedHelper) {
    return { name: 'kvm', ok: true, message: 'kvm access skipped by config' };
  }
  try {
    await access('/dev/kvm', constants.R_OK | constants.W_OK);
    return { name: 'kvm', ok: true, message: '/dev/kvm is readable and writable' };
  } catch {
    return { name: 'kvm', ok: false, message: '/dev/kvm is present but not readable and writable by this user' };
  }
}

function tapCheck(config) {
  if (config.skipTapCheck || typeof process.getuid !== 'function' || process.getuid() === 0) {
    return { name: 'tap', ok: true, message: 'TAP setup privileges available' };
  }
  if (config.privilegedHelper) {
    const result = spawnSync('sudo', ['-n', config.privilegedHelper, 'doctor'], { encoding: 'utf8' });
    return result.status === 0
      ? { name: 'tap', ok: true, message: 'privileged helper is available for TAP setup' }
      : { name: 'tap', ok: false, message: `privileged helper is not available through passwordless sudo: ${(result.stderr || result.stdout).trim()}` };
  }
  if (config.useSudo) {
    const result = spawnSync('sudo', ['-n', 'true'], { encoding: 'utf8' });
    return result.status === 0
      ? { name: 'tap', ok: true, message: 'passwordless sudo is available for TAP setup' }
      : { name: 'tap', ok: false, message: 'TAP setup requires passwordless sudo when useSudo=true' };
  }
  return { name: 'tap', ok: false, message: 'TAP setup requires root, CAP_NET_ADMIN, or useSudo with passwordless sudo' };
}

function normalizedArch() {
  const arch = process.arch;
  if (arch === 'x64') return 'x86_64';
  if (arch === 'arm64') return 'aarch64';
  throw new Error(`Unsupported Firecracker architecture: ${arch}`);
}

function chmodExecutable(path) {
  chmodSync(path, 0o755);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').slice(0, 800)}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? resolve(args[index + 1]) : null;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function privilegedHelperScript(rootDir, firecrackerBin) {
  return `#!/bin/sh
set -eu

ROOT_DIR=${shellQuote(resolve(rootDir))}
FIRECRACKER_BIN=${shellQuote(firecrackerBin)}
IP_BIN=/usr/sbin/ip
CURL_BIN=/usr/bin/curl

fail() {
  echo "$1" >&2
  exit 1
}

canon() {
  realpath -m "$1"
}

under_root() {
  target="$(canon "$1")"
  case "$target" in
    "$ROOT_DIR"/*) printf '%s\\n' "$target" ;;
    *) fail "path is outside Beale Firecracker root: $1" ;;
  esac
}

tap_name() {
  case "$1" in
    bealefc[A-Za-z0-9_.-]*) printf '%s\\n' "$1" ;;
    *) fail "invalid Beale TAP name: $1" ;;
  esac
}

cidr() {
  case "$1" in
    *[!0-9./]*) fail "invalid CIDR: $1" ;;
    */*) printf '%s\\n' "$1" ;;
    *) fail "invalid CIDR: $1" ;;
  esac
}

api_path() {
  case "$1" in
    /*[!A-Za-z0-9_./-]*) fail "invalid API path: $1" ;;
    /*) printf '%s\\n' "$1" ;;
    *) fail "invalid API path: $1" ;;
  esac
}

pid_value() {
  case "$1" in
    ''|*[!0-9]*) fail "invalid pid: $1" ;;
    *) printf '%s\\n' "$1" ;;
  esac
}

case "$1" in
  doctor)
    [ -x "$FIRECRACKER_BIN" ] || fail "Firecracker binary is not executable"
    [ -r /dev/kvm ] && [ -w /dev/kvm ] || fail "/dev/kvm is not readable and writable by root"
    [ -x "$IP_BIN" ] || fail "ip binary is missing"
    [ -x "$CURL_BIN" ] || fail "curl binary is missing"
    ;;
  tap-delete)
    name="$(tap_name "$2")"
    "$IP_BIN" link del "$name" 2>/dev/null || true
    ;;
  tap-create)
    name="$(tap_name "$2")"
    host_cidr="$(cidr "$3")"
    "$IP_BIN" tuntap add dev "$name" mode tap
    "$IP_BIN" addr add "$host_cidr" dev "$name"
    "$IP_BIN" link set dev "$name" up
    ;;
  start-firecracker)
    socket="$(under_root "$2")"
    pidfile="$(under_root "$3")"
    rm -f "$socket"
    "$FIRECRACKER_BIN" --api-sock "$socket" >/dev/null 2>&1 &
    printf '%s\\n' "$!" > "$pidfile"
    ;;
  api-put)
    socket="$(under_root "$2")"
    path="$(api_path "$3")"
    "$CURL_BIN" -fsS -X PUT --unix-socket "$socket" --data "$4" "http://localhost$path"
    ;;
  stop-firecracker)
    pidfile="$(under_root "$2")"
    if [ -f "$pidfile" ]; then
      pid="$(pid_value "$(cat "$pidfile")")"
      kill "$pid" 2>/dev/null || true
      rm -f "$pidfile"
    fi
    ;;
  *)
    fail "unsupported privileged helper action: $1"
    ;;
esac
`;
}
