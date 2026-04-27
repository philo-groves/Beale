import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScopeAssetKind, StartRunInput } from '@shared/types';
import { startRunForTest, WorkspaceService } from '../src/main/workspaceService';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Beale workbench skeleton', () => {
  it('initializes and reopens a workspace-local SQLite database', () => {
    const dir = tempWorkspace();
    const service = new WorkspaceService();

    const snapshot = service.createWorkspace(dir);
    expect(snapshot.workspace.workspacePath).toBe(dir);
    expect(snapshot.workspace.databasePath).toBe(join(dir, '.beale', 'beale.sqlite'));
    expect(snapshot.activeScope.version).toBe(1);
    expect(snapshot.activeScope.programName).toBe('Untitled Program');
    expect(existsSync(join(dir, '.beale', 'beale.sqlite'))).toBe(true);
    expect(existsSync(join(dir, '.beale', 'artifacts', 'sha256'))).toBe(true);

    const workspaceId = snapshot.workspace.workspaceId;
    service.close();

    const reopened = service.openWorkspace(dir);
    expect(reopened.workspace.workspaceId).toBe(workspaceId);
    expect(reopened.activeScope.version).toBe(1);
    service.close();
  });

  it('persists scope edits as a new active version with typed assets', () => {
    const service = openService();

    const snapshot = service.saveProgramScope({
      programName: 'Example Bug Bounty',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Authorized open-ended vulnerability discovery on scoped assets.',
      rulesMarkdown: 'No out-of-scope network testing.',
      networkProfile: 'scoped_public',
      expiresAt: '2026-12-31',
      assets: [
        asset('in_scope', 'domain', 'api.example.test'),
        asset('in_scope', 'repo', 'https://github.com/example/repo'),
        asset('in_scope', 'path', '/tmp/example-target'),
        asset('out_of_scope', 'other', 'admin.example.test')
      ]
    });

    expect(snapshot.activeScope.version).toBe(2);
    expect(snapshot.activeScope.programName).toBe('Example Bug Bounty');
    expect(snapshot.activeScope.networkProfile).toBe('scoped_public');
    expect(snapshot.activeScope.assets).toHaveLength(4);
    expect(snapshot.activeScope.assets.map((item) => item.value)).toContain('admin.example.test');

    service.close();
    const reopened = service.openWorkspace(snapshot.workspace.workspacePath);
    expect(reopened.activeScope.version).toBe(2);
    expect(reopened.activeScope.assets).toHaveLength(4);
    service.close();
  });

  it('records a deterministic fake run graph that replays from persisted state', () => {
    const service = openService();
    service.saveProgramScope({
      programName: 'Parser Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Scoped parser research.',
      rulesMarkdown: 'Stay inside local fixtures.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [asset('in_scope', 'path', '/targets/parser')]
    });

    const snapshot = startRunForTest(service, runInput('adaptive_portfolio'));
    const runId = snapshot.runs[0].run.id;
    const detail = service.getRunDetail(runId);

    expect(detail.run.status).toBe('completed');
    expect(detail.traceEvents.map((event) => event.sequence)).toEqual(sequence(detail.traceEvents.length));
    expect(detail.traceEvents.some((event) => event.source === 'model' && event.type === 'model_message')).toBe(true);
    expect(detail.traceEvents.some((event) => event.source === 'tool' && event.type === 'tool_result')).toBe(true);
    expect(detail.traceEvents.some((event) => event.source === 'policy' && event.type === 'approval_event')).toBe(true);
    expect(detail.traceEvents.some((event) => event.type === 'verifier_result')).toBe(true);
    expect(detail.hypotheses.length).toBeGreaterThan(0);
    expect(detail.artifacts.length).toBeGreaterThan(0);
    expect(detail.verifierRuns.some((run) => run.status === 'pass')).toBe(true);
    expect(detail.findings.some((finding) => finding.state === 'verified')).toBe(true);
    expect(detail.vmContexts[0].backend).toBe('fake_vm');

    const workspacePath = snapshot.workspace.workspacePath;
    service.close();

    const reopened = new WorkspaceService();
    reopened.openWorkspace(workspacePath);
    const replayed = reopened.getRunDetail(runId);
    expect(replayed.traceEvents.map((event) => event.sequence)).toEqual(sequence(replayed.traceEvents.length));
    expect(replayed.artifacts[0].provenanceTraceEventId).toBeTruthy();
    expect(replayed.hypotheses[0].createdTraceEventId).toBeTruthy();
    reopened.close();
  });

  it('records steering actions as trace events and state changes', () => {
    const service = openService();
    const snapshot = service.startRun(runInput('source_logic_bug'), 'scheduled');
    const runId = snapshot.runs[0].run.id;

    service.steerRun({ type: 'pause', runId });
    let detail = service.getRunDetail(runId);
    expect(detail.run.status).toBe('paused');
    expect(detail.traceEvents.at(-1)?.summary).toBe('Run paused by user.');

    service.steerRun({ type: 'resume', runId });
    service.steerRun({ type: 'stop', runId });
    detail = service.getRunDetail(runId);
    expect(detail.run.status).toBe('stopped');
    expect(detail.traceEvents.at(-1)?.summary).toBe('Run stopped by user.');

    service.close();
  });

  it('updates artifact and hypothesis state through steering controls', () => {
    const service = openService();
    const snapshot = startRunForTest(service, runInput('verified_finding'));
    const runId = snapshot.runs[0].run.id;
    const detail = service.getRunDetail(runId);
    const artifact = detail.artifacts[0];
    const hypothesis = detail.hypotheses[0];

    service.steerRun({ type: 'mark_artifact_sensitive', runId, artifactId: artifact.id });
    service.steerRun({ type: 'dismiss_hypothesis', runId, hypothesisId: hypothesis.id });

    const updated = service.getRunDetail(runId);
    expect(updated.artifacts.find((item) => item.id === artifact.id)?.modelVisible).toBe(false);
    expect(updated.artifacts.find((item) => item.id === artifact.id)?.sensitivity).toBe('sensitive');
    expect(updated.hypotheses.find((item) => item.id === hypothesis.id)?.state).toBe('dismissed');
    expect(updated.traceEvents.some((event) => event.summary === 'Artifact marked sensitive and hidden from model context.')).toBe(true);
    expect(updated.traceEvents.some((event) => event.summary === 'Hypothesis dismissed by user.')).toBe(true);
    service.close();
  });
});

function openService(): WorkspaceService {
  const service = new WorkspaceService();
  service.createWorkspace(tempWorkspace());
  return service;
}

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beale-test-'));
  createdDirs.push(dir);
  return dir;
}

function asset(direction: 'in_scope' | 'out_of_scope', kind: ScopeAssetKind, value: string) {
  return {
    direction,
    kind,
    value,
    sensitivity: 'internal',
    attributes: {}
  };
}

function runInput(fakeScenario: StartRunInput['fakeScenario']): StartRunInput {
  return {
    promptMarkdown: '# Test run\nExercise the fake workbench path.',
    mode: 'open_discovery',
    attemptStrategy: 'adaptive_portfolio',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    networkProfile: 'offline',
    sandboxProfile: 'local_disposable_vm',
    budget: {
      maxMinutes: 30,
      maxAttempts: 2,
      maxCostUsd: 0
    },
    fakeScenario
  };
}

function sequence(length: number): number[] {
  return Array.from({ length }, (_value, index) => index + 1);
}
