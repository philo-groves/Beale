import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase, type CreatedRunContext } from '../src/main/database';
import { ExecutorManager } from '../src/main/executorManager';
import { BealeToolRouter } from '../src/main/openaiTools';
import { WorkspaceService } from '../src/main/workspaceService';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(process.env.BEALE_FIRECRACKER_LIVE_TEST !== '1')('Firecracker live executor', () => {
  it('runs executor_alpha through the real Firecracker vmctl controller', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beale-firecracker-live-'));
    createdDirs.push(workspace);
    const targetDir = join(workspace, 'target');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'target.txt'), 'real firecracker service target\n');

    const service = new WorkspaceService();
    try {
      service.createWorkspace(workspace);
      service.saveProgramScope({
        programName: 'Firecracker Live Program',
        organizationName: 'Local',
        descriptionMarkdown: 'Firecracker executor live smoke.',
        rulesMarkdown: 'Offline microVM execution only.',
        networkProfile: 'offline',
        expiresAt: null,
        assets: [{ direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} }]
      });

      const snapshot = service.startRun({
        runEngine: 'executor_alpha',
        promptMarkdown: '# Firecracker executor alpha\nRun through the real Firecracker controller.',
        mode: 'open_discovery',
        attemptStrategy: 'single_path',
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        networkProfile: 'offline',
        sandboxProfile: 'local_disposable_vm',
        budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0 },
        fakeScenario: 'adaptive_portfolio'
      });
      const detail = service.getRunDetail(snapshot.runs[0].run.id);

      expect(detail.run.status).toBe('completed');
      expect(detail.vmContexts[0].backend).toBe('vmctl');
      expect(detail.vmContexts[0].state).toBe('destroyed');
      expect(detail.traceEvents.some((event) => event.summary === 'Guest shell operation finished with success.')).toBe(true);
      expect(detail.traceEvents.some((event) => event.summary === 'Guest python operation finished with success.')).toBe(true);
      expect(detail.artifacts.some((artifact) => artifact.kind === 'executor_smoke')).toBe(true);
    } finally {
      service.close();
    }
  }, 60_000);

  it('runs structured python and debugger tools through the real Firecracker vmctl controller', () => {
    const { db, context } = openStructuredToolLiveDb();
    const router = new BealeToolRouter(db, new ExecutorManager(db));
    try {
      const python = callTool(router, context, 'python', {
        task: 'live structured tool smoke',
        script: 'from pathlib import Path; Path("/tmp/beale-m4-output.txt").write_text("BEALE_M4_OK\\n"); print("BEALE_M4_OK")',
        artifact_path: '/tmp/beale-m4-output.txt'
      });
      expect(python.status).toBe('success');
      expect(python.artifact_id).toBeTruthy();

      const debuggerResult = callTool(router, context, 'debugger', {
        operation: 'gdb_probe',
        target: '/bin/true',
        input_path: ''
      });
      expect(debuggerResult.status).toBe('success');
      expect(debuggerResult.payload.hostExecution).toBe(false);

      const detail = db.getRunDetail(context.run.id);
      expect(detail.traceEvents.some((event) => event.summary === 'Guest python operation finished with success.')).toBe(true);
      expect(detail.traceEvents.some((event) => event.summary === 'Debugger wrapper operation finished with success.')).toBe(true);
      expect(detail.vmContexts[0].backend).toBe('vmctl');
      expect(detail.vmContexts[0].state).toBe('destroyed');
    } finally {
      db.close();
    }
  }, 90_000);
});

interface ToolOutput {
  status: string;
  artifact_id?: string;
  payload: Record<string, unknown>;
}

function callTool(router: BealeToolRouter, context: CreatedRunContext, name: string, args: Record<string, unknown>): ToolOutput {
  return JSON.parse(
    router.execute(context, {
      callId: `call_${name}`,
      name,
      argumentsJson: JSON.stringify(args)
    }).output
  ) as ToolOutput;
}

function openStructuredToolLiveDb(): { db: WorkspaceDatabase; context: CreatedRunContext } {
  const workspace = mkdtempSync(join(tmpdir(), 'beale-firecracker-structured-live-'));
  createdDirs.push(workspace);
  const targetDir = join(workspace, 'target');
  const artifactRoot = join(workspace, '.beale', 'artifacts');
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
  writeFileSync(join(targetDir, 'target.txt'), 'real structured tool target\n');

  const db = new WorkspaceDatabase(join(workspace, '.beale', 'beale.sqlite'), artifactRoot);
  db.initialize();
  db.saveProgramScope({
    programName: 'Firecracker Structured Tool Program',
    organizationName: 'Local',
    descriptionMarkdown: 'Firecracker structured tool live smoke.',
    rulesMarkdown: 'Offline microVM execution only.',
    networkProfile: 'offline',
    expiresAt: null,
    assets: [{ direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} }]
  });
  const context = db.createRun({
    scopeVersionId: db.getActiveScope().id,
    title: 'Firecracker structured tool smoke',
    promptMarkdown: '# Firecracker structured tool smoke',
    mode: 'open_discovery',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    attemptStrategy: 'single_path',
    networkProfile: 'offline',
    sandboxProfile: 'local_disposable_vm',
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'openai_responses' }
  });
  return { db, context };
}
