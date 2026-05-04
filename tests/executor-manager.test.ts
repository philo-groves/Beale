import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase, type CreatedRunContext } from '../src/main/database';
import { ExecutorManager } from '../src/main/executorManager';
import { WorkspaceService } from '../src/main/workspaceService';
import type { ScopeAssetInput } from '../src/shared/types';

const createdDirs: string[] = [];
const originalCwd = process.cwd();
const ENV_KEYS = [
  'BEALE_VMCTL_COMMAND',
  'BEALE_VMCTL_ARGS_JSON',
  'BEALE_VMCTL_TIMEOUT_MS',
  'BEALE_VMCTL_AUTODISCOVERY',
  'BEALE_FIRECRACKER_CONFIG',
  'BEALE_NODE_COMMAND',
  'BEALE_VM_BACKEND',
  'BEALE_SANDBOX_BACKEND',
  'BEALE_DOCKER_COMMAND',
  'BEALE_DOCKER_IMAGE',
  'BEALE_DOCKER_STATE_DIR',
  'BEALE_DOCKER_TIMEOUT_MS',
  'BEALE_DOCKER_STATUS_TIMEOUT_MS',
  'BEALE_DOCKER_STATUS_CACHE_MS',
  'OPENAI_API_KEY',
  'BEALE_OPENAI_ACCESS_TOKEN'
];

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Sandbox executor alpha', () => {
  it('drives lifecycle, scoped import, guest execution, host-controlled export, and destroy through vmctl', () => {
    process.env.OPENAI_API_KEY = 'sk-host-secret-should-not-reach-vmctl';
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'oauth-host-secret-should-not-reach-vmctl';
    const { db, dir, targetFile, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(db);
    const manager = new ExecutorManager(db);

    const status = manager.getStatus();
    expect(status.available).toBe(true);
    expect(status.targetExecution).toBe(true);
    expect(status.supportedNetworkProfiles).toEqual(['offline', 'scoped']);
    expect(status.backends.map((backend) => backend.kind)).toEqual(['firecracker', 'hyperv', 'tart', 'docker', 'custom_vmctl']);
    expect(status.backends.find((backend) => backend.kind === 'firecracker')?.configured).toBe(true);

    manager.createContext(context, 'fixture-image', 'clean-fixture');
    manager.restoreSnapshot(context, 'clean-fixture');
    manager.cloneContext(context, 'clean-fixture');
    manager.importWorkspaceMaterial(context, { hostPath: targetFile, guestPath: '/workspace/target.txt', mode: 'read_only' });
    manager.executeGuestOperation(context, {
      operationKind: 'shell',
      command: ['sh', '-lc', './target'],
      cwd: '/workspace',
      env: {
        SAFE_FLAG: '1',
        OPENAI_API_KEY: 'request-secret',
        TARGET_TOKEN: 'request-token'
      },
      timeoutMs: 5000,
      networkProfile: 'offline',
      expectedOutput: 'summary'
    });
    const artifactId = manager.exportArtifact(context, {
      guestPath: '/tmp/beale-output.txt',
      kind: 'log',
      mimeType: 'text/plain',
      sensitivity: 'internal',
      modelVisible: true
    });
    manager.revertContext(context, 'clean-fixture');
    manager.preserveContext(context, 'manual follow-up');
    manager.destroyContext(context);

    const detail = db.getRunDetail(context.run.id);
    expect(detail.vmContexts[0].backend).toBe('vmctl');
    expect(detail.vmContexts[0].state).toBe('destroyed');
    expect(detail.vmContexts[0].metadata.hostDatabaseMounted).toBe(false);
    expect(detail.vmContexts[0].metadata.openAiCredentialsMounted).toBe(false);
    expect(detail.traceEvents.some((event) => event.summary === 'Sandbox executor created disposable context.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Sandbox context cloned from clean snapshot.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Scoped target material imported into guest.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Guest shell operation finished with success.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.type === 'network_event' && event.payload.decision === 'block_external_network')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Guest artifact exported and accepted: /tmp/beale-output.txt.')).toBe(true);
    expect(detail.artifacts.find((artifact) => artifact.id === artifactId)?.sha256).toBeTruthy();

    const vmctlLog = readFileSync(logPath, 'utf8');
    expectActionOrder(readVmctlActions(logPath), [
      'create_context',
      'restore_snapshot',
      'clone_context',
      'import_workspace_material',
      'execute',
      'export_artifact',
      'revert',
      'preserve',
      'destroy'
    ]);
    expect(vmctlLog).not.toContain('.beale/beale.sqlite');
    expect(vmctlLog).not.toContain('sk-host-secret');
    expect(vmctlLog).not.toContain('oauth-host-secret');
    expect(vmctlLog).not.toContain('request-secret');
    expect(vmctlLog).not.toContain('request-token');
    expect(vmctlLog).toContain('"SAFE_FLAG"');
    db.close();
    expect(dir).toContain('beale-executor-test-');
  });

  it('blocks workspace metadata imports before reaching the sandbox controller', () => {
    const { db, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(db, [{ direction: 'in_scope', kind: 'path', value: db.getDatabasePath(), sensitivity: 'internal', attributes: {} }]);
    const manager = new ExecutorManager(db);
    manager.createContext(context, 'fixture-image', 'clean-fixture');

    expect(() =>
      manager.importWorkspaceMaterial(context, { hostPath: db.getDatabasePath(), guestPath: '/workspace/beale.sqlite', mode: 'read_only' })
    ).toThrow(/Workspace metadata/);
    const detail = db.getRunDetail(context.run.id);
    expect(detail.policyEvents.some((event) => event.reason === 'Workspace metadata cannot be imported into the guest.')).toBe(true);
    expect(readFileSync(logPath, 'utf8')).not.toContain('import_workspace_material');
    db.close();
  });

  it('passes scoped live-target allowlists to vmctl and records network policy', () => {
    const { db, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(
      db,
      [
        { direction: 'in_scope', kind: 'domain', value: 'live.example.test', sensitivity: 'public', attributes: { protocol: 'tcp', port: 443 } }
      ],
      'scoped'
    );
    const manager = new ExecutorManager(db);

    manager.createContext(context, 'fixture-image', 'clean-fixture');
    manager.executeGuestOperation(context, {
      operationKind: 'shell',
      command: ['sh', '-lc', 'curl -fsS https://live.example.test/health'],
      cwd: '/workspace',
      env: {},
      timeoutMs: 5000,
      networkProfile: 'scoped',
      expectedOutput: 'summary'
    });

    const detail = db.getRunDetail(context.run.id);
    const networkEvent = detail.traceEvents.find((event) => event.type === 'network_event' && event.payload.decision === 'allow_scoped_network');
    expect(networkEvent?.payload.liveTargetAllowed).toBe(true);
    expect(networkEvent?.payload.allowedDestinationCount).toBe(1);
    const vmctlLog = readFileSync(logPath, 'utf8');
    expect(vmctlLog).toContain('live.example.test');
    expect(vmctlLog).toContain('"networkPolicy"');
    db.close();
  });

  it('falls back from elevated to scoped when the VM backend only supports scoped allowlists', () => {
    const { db, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(
      db,
      [
        { direction: 'in_scope', kind: 'domain', value: 'live.example.test', sensitivity: 'public', attributes: { protocol: 'tcp', port: 443 } }
      ],
      'elevated'
    );
    const manager = new ExecutorManager(db);

    manager.createContext(context, 'fixture-image', 'clean-fixture');
    manager.executeGuestOperation(context, {
      operationKind: 'shell',
      command: ['sh', '-lc', 'curl -fsS https://live.example.test/health'],
      cwd: '/workspace',
      env: {},
      timeoutMs: 5000,
      networkProfile: 'elevated',
      expectedOutput: 'summary'
    });

    const detail = db.getRunDetail(context.run.id);
    const createEvent = detail.traceEvents.find((event) => event.summary === 'Sandbox executor created disposable context.');
    const networkEvent = detail.traceEvents.find((event) => event.type === 'network_event' && event.payload.decision === 'allow_scoped_network');
    expect(createEvent?.payload.requestedNetworkProfile).toBe('elevated');
    expect(createEvent?.payload.networkProfile).toBe('scoped');
    expect(networkEvent?.payload.liveTargetAllowed).toBe(true);
    expect(readFileSync(logPath, 'utf8')).toContain('"networkProfile":"scoped"');
    db.close();
  });

  it('passes elevated network operations to online sandbox backends without requiring a scoped allowlist', () => {
    const { db, logPath } = openExecutorDb();
    configureVmctlFixture(logPath, '', ['offline', 'scoped', 'elevated']);
    const context = createExecutorRun(db, undefined, 'elevated');
    const manager = new ExecutorManager(db);

    manager.createContext(context, 'fixture-image', 'clean-fixture');
    manager.executeGuestOperation(context, {
      operationKind: 'shell',
      command: ['sh', '-lc', 'curl -fsS https://example.com/'],
      cwd: '/workspace',
      env: {},
      timeoutMs: 5000,
      networkProfile: 'elevated',
      expectedOutput: 'summary'
    });

    const detail = db.getRunDetail(context.run.id);
    const networkEvent = detail.traceEvents.find((event) => event.type === 'network_event' && event.payload.decision === 'allow_elevated_network');
    expect(networkEvent?.payload.liveTargetAllowed).toBe(true);
    expect(networkEvent?.payload.allowedDestinationCount).toBe(0);
    expect(networkEvent?.payload.failClosed).toBe(false);
    expect(readFileSync(logPath, 'utf8')).toContain('"networkProfile":"elevated"');
    db.close();
  });

  it('fails closed when scoped networking has no live-target scope', () => {
    const { db, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(db, undefined, 'scoped');
    const manager = new ExecutorManager(db);

    expect(() => manager.createContext(context, 'fixture-image', 'clean-fixture')).toThrow(/Scoped network profile requires/);
    const detail = db.getRunDetail(context.run.id);
    expect(detail.policyEvents.some((event) => event.reason === 'Scoped network profile requires at least one in-scope domain, host, IP range, or service.')).toBe(true);
    expect(existsSync(logPath) ? readFileSync(logPath, 'utf8') : '').not.toContain('create_context');
    db.close();
  });

  it('blocks guest import destinations outside /workspace before reaching the sandbox controller', () => {
    const { db, targetFile, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(db);
    const manager = new ExecutorManager(db);
    manager.createContext(context, 'fixture-image', 'clean-fixture');

    expect(() => manager.importWorkspaceMaterial(context, { hostPath: targetFile, guestPath: '/etc/target.txt', mode: 'read_only' })).toThrow(/\/workspace/);

    const detail = db.getRunDetail(context.run.id);
    expect(detail.policyEvents.some((event) => event.reason === 'Import guest path must stay inside /workspace and outside .beale.')).toBe(true);
    expect(readFileSync(logPath, 'utf8')).not.toContain('import_workspace_material');
    db.close();
  });

  it.skipIf(process.platform === 'win32')('blocks symlinks inside scoped import trees before reaching the sandbox controller', () => {
    const { db, dir, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(db);
    const manager = new ExecutorManager(db);
    const outsideSecret = join(dir, 'outside-secret.txt');
    writeFileSync(outsideSecret, 'host secret outside active scope\n');
    symlinkSync(outsideSecret, join(dir, 'target', 'leak.txt'));
    manager.createContext(context, 'fixture-image', 'clean-fixture');

    expect(() => manager.importWorkspaceMaterial(context, { hostPath: join(dir, 'target'), guestPath: '/workspace/target', mode: 'read_only' })).toThrow(/symbolic link/);

    const detail = db.getRunDetail(context.run.id);
    expect(detail.policyEvents.some((event) => event.reason === 'Import tree failed safety validation.')).toBe(true);
    expect(readFileSync(logPath, 'utf8')).not.toContain('import_workspace_material');
    db.close();
  });

  it('allows scoped local binary assets to be imported into the guest', () => {
    const { db, targetFile, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(db, [{ direction: 'in_scope', kind: 'binary', value: targetFile, sensitivity: 'internal', attributes: {} }]);
    const manager = new ExecutorManager(db);

    manager.createContext(context, 'fixture-image', 'clean-fixture');
    manager.importWorkspaceMaterial(context, { hostPath: targetFile, guestPath: '/workspace/target-bin', mode: 'read_only' });

    const detail = db.getRunDetail(context.run.id);
    expect(detail.traceEvents.some((event) => event.summary === 'Scoped target material imported into guest.')).toBe(true);
    expect(readVmctlActions(logPath)).toContain('import_workspace_material');
    db.close();
  });

  it('blocks clean clone once the sandbox context is contaminated', () => {
    const { db, logPath } = openExecutorDb();
    configureVmctlFixture(logPath);
    const context = createExecutorRun(db);
    const manager = new ExecutorManager(db);

    manager.createContext(context, 'fixture-image', 'clean-fixture');
    manager.cloneContext(context, 'clean-fixture');
    manager.executeGuestOperation(context, {
      operationKind: 'shell',
      command: ['sh', '-lc', 'echo contaminated'],
      cwd: '/workspace',
      env: {},
      timeoutMs: 5000,
      networkProfile: 'offline',
      expectedOutput: 'summary'
    });

    expect(() => manager.cloneContext(context, 'clean-fixture')).toThrow(/clean sandbox context/);
    const detail = db.getRunDetail(context.run.id);
    expect(detail.policyEvents.some((event) => event.reason === 'Clean snapshot clone requires a clean sandbox context.')).toBe(true);
    expect(readVmctlActions(logPath).filter((action) => action === 'clone_context')).toHaveLength(1);
    db.close();
  });

  it('fails closed when no sandbox controller is configured', () => {
    const { db } = openExecutorDb();
    const manager = new ExecutorManager(db);
    const status = manager.getStatus();

    expect(status.available).toBe(false);
    expect(status.targetExecution).toBe(false);
    expect(status.reason).toContain('BEALE_VMCTL_COMMAND');
    expect(status.backends.find((backend) => backend.kind === 'hyperv')?.available).toBe(false);
    db.close();
  });

  it('autodiscovers a local Firecracker vmctl config when no controller env vars are set', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'beale-vmctl-autodiscovery-'));
    createdDirs.push(appRoot);
    mkdirSync(join(appRoot, 'scripts'), { recursive: true });
    mkdirSync(join(appRoot, '.beale', 'firecracker'), { recursive: true });
    writeFileSync(join(appRoot, '.beale', 'firecracker', 'config.json'), '{}\n');
    writeFileSync(
      join(appRoot, 'scripts', 'firecracker-vmctl.mjs'),
      [
        "import { readFileSync } from 'node:fs';",
        "const request = JSON.parse(readFileSync(0, 'utf8'));",
        "if (request.action !== 'list_capabilities') throw new Error(`unexpected ${request.action}`);",
        'console.log(JSON.stringify({ ok: true, result: { available: true, label: "Autodiscovered Firecracker", supportedNetworkProfiles: ["offline", "scoped"], supports: { snapshots: true, clone: true, import: true, export: true, shell: true, python: true, debugger: false } } }));'
      ].join('\n')
    );
    process.env.BEALE_VMCTL_AUTODISCOVERY = '1';
    process.chdir(appRoot);
    const { db } = openExecutorDb();
    const manager = new ExecutorManager(db);

    const status = manager.getStatus();

    expect(status.available).toBe(true);
    expect(status.label).toBe('Autodiscovered Firecracker');
    expect(status.backends.find((backend) => backend.kind === 'firecracker')?.available).toBe(true);
    expect((status.metadata?.controller as Record<string, unknown>).autoDiscovered).toBe(true);
    expect((status.metadata?.controller as Record<string, unknown>).configPath).toBe(join(appRoot, '.beale', 'firecracker', 'config.json'));
    db.close();
  });

  it('runs the executor_alpha product path through workspace service when vmctl is configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beale-executor-service-'));
    createdDirs.push(dir);
    const targetDir = join(dir, 'target');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'target.txt'), 'service target material\n');
    const logPath = join(dir, 'vmctl.log');
    configureVmctlFixture(logPath);

    const service = new WorkspaceService();
    service.createWorkspace(dir);
    service.saveProgramScope({
      programName: 'Executor Service Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Executor alpha service path.',
      rulesMarkdown: 'Offline guest execution only.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [{ direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} }]
    });

    const snapshot = service.startRun({ ...runInput(), runEngine: 'executor_alpha' });
    const detail = service.getRunDetail(snapshot.runs[0].run.id);

    expect(detail.run.status).toBe('completed');
    expect(detail.vmContexts[0].backend).toBe('vmctl');
    expect(detail.vmContexts[0].state).toBe('destroyed');
    expect(detail.traceEvents.some((event) => event.summary === 'Sandbox executor alpha run started from markdown prompt.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Sandbox context cloned from clean snapshot.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Guest shell operation finished with success.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Guest python operation finished with success.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Sandbox context reverted to clean snapshot.')).toBe(true);
    expect(detail.traceEvents.filter((event) => event.type === 'network_event')).toHaveLength(2);
    expect(detail.artifacts.some((artifact) => artifact.kind === 'executor_smoke')).toBe(true);
    expect(readVmctlActions(logPath).filter((action) => action === 'execute')).toHaveLength(2);
    service.close();
  });

  it('marks sandbox contexts for recovery review when run failure cleanup also fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beale-executor-service-failure-'));
    createdDirs.push(dir);
    const targetDir = join(dir, 'target');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'target.txt'), 'service target material\n');
    const logPath = join(dir, 'vmctl.log');
    configureVmctlFixture(logPath, 'execute,destroy');

    const service = new WorkspaceService();
    service.createWorkspace(dir);
    service.saveProgramScope({
      programName: 'Executor Failure Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Executor alpha failure path.',
      rulesMarkdown: 'Offline guest execution only.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [{ direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} }]
    });

    const snapshot = service.startRun({ ...runInput(), runEngine: 'executor_alpha' });
    const detail = service.getRunDetail(snapshot.runs[0].run.id);

    expect(detail.run.status).toBe('failed');
    expect(detail.vmContexts[0].state).toBe('recovery_pending');
    expect(detail.vmContexts[0].metadata.recoveryRequired).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Sandbox executor alpha failed to destroy context after run failure.')).toBe(true);
    expect(readVmctlActions(logPath)).toContain('destroy');
    service.close();
  });
});

function configureVmctlFixture(logPath: string, failActions = '', supportedNetworkProfiles = ['offline', 'scoped']): void {
  process.env.BEALE_VMCTL_COMMAND = process.execPath;
  process.env.BEALE_VMCTL_ARGS_JSON = JSON.stringify([join(process.cwd(), 'tests/fixtures/vmctl-fixture.mjs'), logPath, failActions, JSON.stringify(supportedNetworkProfiles)]);
}

function readVmctlActions(logPath: string): string[] {
  const content = readFileSync(logPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line).input.action as string);
}

function expectActionOrder(actions: string[], ordered: string[]): void {
  let cursor = -1;
  for (const action of ordered) {
    const next = actions.findIndex((candidate, index) => index > cursor && candidate === action);
    expect(next, `expected ${action} after index ${cursor} in ${actions.join(', ')}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function openExecutorDb(): { db: WorkspaceDatabase; dir: string; targetFile: string; logPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beale-executor-test-'));
  createdDirs.push(dir);
  const artifactRoot = join(dir, '.beale', 'artifacts');
  mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
  const targetDir = join(dir, 'target');
  mkdirSync(targetDir, { recursive: true });
  const targetFile = join(targetDir, 'target.txt');
  writeFileSync(targetFile, 'fixture target material\n');
  const logPath = join(dir, 'vmctl.log');

  const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
  db.initialize();
  db.saveProgramScope({
    programName: 'Executor Program',
    organizationName: 'Example Org',
    descriptionMarkdown: 'Scoped executor test.',
    rulesMarkdown: 'Offline guest execution only.',
    networkProfile: 'offline',
    expiresAt: null,
    assets: [{ direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} }]
  });
  return { db, dir, targetFile, logPath };
}

function createExecutorRun(db: WorkspaceDatabase, assets?: ScopeAssetInput[], networkProfile = 'offline'): CreatedRunContext {
  if (assets) {
    db.saveProgramScope({
      programName: 'Executor Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Scoped executor test.',
      rulesMarkdown: networkProfile === 'offline' ? 'Offline guest execution only.' : 'Scoped guest networking only.',
      networkProfile,
      expiresAt: null,
      assets
    });
  }
  return db.createRun({
    scopeVersionId: db.getActiveScope().id,
    title: 'Executor smoke',
    promptMarkdown: '# Executor smoke',
    mode: 'open_discovery',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    attemptStrategy: 'single_path',
    networkProfile,
    sandboxProfile: 'local_disposable_vm',
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'executor_alpha' },
    vmBackend: 'vmctl',
    vmImageId: 'fixture-image',
    vmSnapshotId: 'clean-fixture',
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
}

function runInput() {
  return {
    runEngine: 'executor_alpha' as const,
    promptMarkdown: '# Executor alpha\nImport a scoped local path and run the VM smoke operation.',
    mode: 'open_discovery',
    attemptStrategy: 'single_path',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    networkProfile: 'offline',
    sandboxProfile: 'local_disposable_vm',
    budget: {
      maxMinutes: 5,
      maxAttempts: 1,
      maxCostUsd: 0
    },
    fakeScenario: 'adaptive_portfolio' as const
  };
}
