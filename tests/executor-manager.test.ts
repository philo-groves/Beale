import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase, type CreatedRunContext } from '../src/main/database';
import { ExecutorManager } from '../src/main/executorManager';
import { WorkspaceService } from '../src/main/workspaceService';
import type { ScopeAssetInput } from '../src/shared/types';

const createdDirs: string[] = [];
const ENV_KEYS = ['BEALE_VMCTL_COMMAND', 'BEALE_VMCTL_ARGS_JSON', 'BEALE_VMCTL_TIMEOUT_MS', 'BEALE_VM_BACKEND', 'OPENAI_API_KEY', 'BEALE_OPENAI_ACCESS_TOKEN'];

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('VM executor alpha', () => {
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
    expect(status.backends.map((backend) => backend.kind)).toEqual(['firecracker', 'hyperv', 'tart', 'custom_vmctl']);
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
    expect(detail.traceEvents.some((event) => event.summary === 'VM executor created disposable guest context.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'VM context cloned from clean snapshot.')).toBe(true);
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

  it('blocks workspace metadata imports before reaching the VM controller', () => {
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

  it('blocks guest import destinations outside /workspace before reaching the VM controller', () => {
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

  it.skipIf(process.platform === 'win32')('blocks symlinks inside scoped import trees before reaching the VM controller', () => {
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

  it('blocks clean clone once the VM context is contaminated', () => {
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

    expect(() => manager.cloneContext(context, 'clean-fixture')).toThrow(/clean VM context/);
    const detail = db.getRunDetail(context.run.id);
    expect(detail.policyEvents.some((event) => event.reason === 'Clean snapshot clone requires a clean VM context.')).toBe(true);
    expect(readVmctlActions(logPath).filter((action) => action === 'clone_context')).toHaveLength(1);
    db.close();
  });

  it('fails closed when no local VM controller is configured', () => {
    const { db } = openExecutorDb();
    const manager = new ExecutorManager(db);
    const status = manager.getStatus();

    expect(status.available).toBe(false);
    expect(status.targetExecution).toBe(false);
    expect(status.reason).toContain('BEALE_VMCTL_COMMAND');
    expect(status.backends.find((backend) => backend.kind === 'hyperv')?.available).toBe(false);
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
    expect(detail.traceEvents.some((event) => event.summary === 'VM executor alpha run started from markdown prompt.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'VM context cloned from clean snapshot.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Guest shell operation finished with success.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Guest python operation finished with success.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'VM context reverted to clean snapshot.')).toBe(true);
    expect(detail.traceEvents.filter((event) => event.type === 'network_event')).toHaveLength(2);
    expect(detail.artifacts.some((artifact) => artifact.kind === 'executor_smoke')).toBe(true);
    expect(readVmctlActions(logPath).filter((action) => action === 'execute')).toHaveLength(2);
    service.close();
  });

  it('marks VM contexts for recovery review when run failure cleanup also fails', () => {
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
    expect(detail.traceEvents.some((event) => event.summary === 'VM executor alpha failed to destroy guest after run failure.')).toBe(true);
    expect(readVmctlActions(logPath)).toContain('destroy');
    service.close();
  });
});

function configureVmctlFixture(logPath: string, failActions = ''): void {
  process.env.BEALE_VMCTL_COMMAND = process.execPath;
  process.env.BEALE_VMCTL_ARGS_JSON = JSON.stringify([join(process.cwd(), 'tests/fixtures/vmctl-fixture.mjs'), logPath, failActions]);
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

function createExecutorRun(db: WorkspaceDatabase, assets?: ScopeAssetInput[]): CreatedRunContext {
  if (assets) {
    db.saveProgramScope({
      programName: 'Executor Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Scoped executor test.',
      rulesMarkdown: 'Offline guest execution only.',
      networkProfile: 'offline',
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
    networkProfile: 'offline',
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
