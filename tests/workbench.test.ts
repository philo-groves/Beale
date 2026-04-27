import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScopeAssetKind, StartRunInput } from '@shared/types';
import { WorkspaceDatabase } from '../src/main/database';
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
    expect(snapshot.openAi.credentialsHostOnly).toBe(true);
    expect(existsSync(join(dir, '.beale', 'beale.sqlite'))).toBe(true);
    expect(existsSync(join(dir, '.beale', 'artifacts', 'sha256'))).toBe(true);

    const workspaceId = snapshot.workspace.workspaceId;
    service.close();

    const reopened = service.openWorkspace(dir);
    expect(reopened.workspace.workspaceId).toBe(workspaceId);
    expect(reopened.activeScope.version).toBe(1);
    service.close();
  });

  it('upgrades an older migration marker into the current workspace schema', () => {
    const dir = tempWorkspace();
    mkdirSync(join(dir, '.beale', 'artifacts', 'sha256'), { recursive: true });
    const raw = new DatabaseSync(join(dir, '.beale', 'beale.sqlite'));
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (1, 'old_fixture_schema', '2026-01-01T00:00:00.000Z');
    `);
    raw.close();

    const service = new WorkspaceService();
    const snapshot = service.openWorkspace(dir);
    expect(snapshot.activeScope.programName).toBe('Untitled Program');
    expect(snapshot.recovery.interruptedRuns).toBe(0);
    service.close();
  });

  it('migrates schema v3 export records to export review state', () => {
    const dir = tempWorkspace();
    const artifactRoot = join(dir, '.beale', 'artifacts');
    mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
    const raw = new DatabaseSync(join(dir, '.beale', 'beale.sqlite'));
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (3, 'initial_workbench_schema', '2026-01-01T00:00:00.000Z');

      CREATE TABLE workspace_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE program_scope_versions (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        program_name TEXT NOT NULL,
        organization_name TEXT NOT NULL,
        description_markdown TEXT NOT NULL,
        network_policy_json TEXT NOT NULL,
        rules_markdown TEXT NOT NULL,
        active_from TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      );

      CREATE TABLE scope_assets (
        id TEXT PRIMARY KEY,
        scope_version_id TEXT NOT NULL REFERENCES program_scope_versions(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK (direction IN ('in_scope', 'out_of_scope')),
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        attributes_json TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE exports (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        finding_id TEXT,
        kind TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        redaction_policy_json TEXT NOT NULL,
        included_artifacts_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    raw.close();

    const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
    db.initialize();
    db.close();

    const migrated = new DatabaseSync(join(dir, '.beale', 'beale.sqlite'));
    const columns = (migrated.prepare('PRAGMA table_info(exports)').all() as Array<{ name: string }>).map((row) => row.name);
    const migration = migrated.prepare('SELECT version FROM schema_migrations WHERE version = 4').get();
    migrated.close();
    expect(columns).toEqual(expect.arrayContaining(['status', 'review_decision', 'review_note', 'reviewed_at']));
    expect(migration).toBeTruthy();
  });

  it('recovers interrupted active state on workspace reopen', () => {
    const service = openService();
    const snapshot = service.startRun(runInput('source_logic_bug'), 'scheduled');
    const runId = snapshot.runs[0].run.id;
    const workspacePath = snapshot.workspace.workspacePath;
    service.close();

    const reopened = new WorkspaceService();
    const recovered = reopened.openWorkspace(workspacePath);
    const detail = reopened.getRunDetail(runId);

    expect(recovered.recovery.interruptedRuns).toBe(1);
    expect(recovered.runs[0].run.status).toBe('paused');
    expect(detail.attempts[0].status).toBe('paused');
    expect(detail.vmContexts[0].state).toBe('recovery_pending');
    expect(detail.traceEvents.some((event) => event.summary === 'Workspace recovery paused interrupted run after app restart.')).toBe(true);
    reopened.close();
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
    expect(detail.attempts.length).toBeGreaterThan(1);
    expect(detail.attempts.map((attempt) => attempt.strategyRole)).toContain('parser_memory_safety');
    expect(detail.attempts.map((attempt) => attempt.strategyRole)).toContain('authorization_review');
    expect(detail.vmContexts[0].backend).toBe('fake_vm');
    expect(snapshot.runs[0].attemptCount).toBeGreaterThan(1);
    expect(snapshot.runs[0].engine).toBe('fake');

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

  it('supports discovery steering, verifier contracts, priority scoring, finding states, and evidence export', () => {
    const service = openService();
    const snapshot = startRunForTest(service, runInput('source_logic_bug'));
    const runId = snapshot.runs[0].run.id;
    let detail = service.getRunDetail(runId);
    const hypothesis = detail.hypotheses[0];

    service.steerRun({
      type: 'adjust_priority',
      runId,
      hypothesisId: hypothesis.id,
      factors: {
        attackerReachability: 2,
        impact: 3,
        evidenceConfidence: 2,
        exploitPracticality: 2,
        scopeConfidence: 3
      }
    });
    service.steerRun({ type: 'request_reproduction', runId, hypothesisId: hypothesis.id });
    service.steerRun({ type: 'promote_hypothesis', runId, hypothesisId: hypothesis.id });

    detail = service.getRunDetail(runId);
    const promoted = detail.hypotheses.find((item) => item.id === hypothesis.id);
    const finding = detail.findings.find((item) => item.hypothesisId === hypothesis.id);
    expect(promoted?.priorityScore).toBe(20);
    expect(promoted?.state).toBe('promoted');
    expect(finding?.state).toBe('needs_evidence');
    expect(detail.verifierContracts.some((contract) => contract.mode === 'reproduction' && contract.hypothesisId === hypothesis.id)).toBe(true);

    service.steerRun({ type: 'request_patch_validation', runId, findingId: finding?.id });
    service.steerRun({ type: 'mark_finding_false_positive', runId, findingId: finding?.id ?? '' });
    service.steerRun({ type: 'mark_finding_out_of_scope', runId, findingId: finding?.id ?? '' });
    service.steerRun({ type: 'export_evidence_bundle', runId, findingId: finding?.id, note: 'api_key=supersecretvalue12345' });

    detail = service.getRunDetail(runId);
    const exported = detail.artifacts.find((artifact) => artifact.kind === 'evidence_bundle_export');
    const exportRecord = detail.exports.find((item) => item.kind === 'evidence_bundle');
    expect(detail.findings.find((item) => item.id === finding?.id)?.state).toBe('out_of_scope');
    expect(detail.verifierContracts.some((contract) => contract.mode === 'patch_validation' && contract.findingId === finding?.id)).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Finding marked false positive by user.')).toBe(true);
    expect(detail.traceEvents.some((event) => event.summary === 'Evidence bundle export created.')).toBe(true);
    expect(exported?.modelVisible).toBe(false);
    expect(exportRecord?.status).toBe('pending_review');
    const exportedPath = join(snapshot.workspace.workspacePath, String(exported?.metadata.exportRelativePath));
    expect(existsSync(exportedPath)).toBe(true);
    expect(readFileSync(exportedPath, 'utf8')).toContain('api_key=...redacted');
    expect(readFileSync(exportedPath, 'utf8')).not.toContain('supersecretvalue12345');

    service.steerRun({ type: 'review_export', runId, exportId: exportRecord?.id ?? '', decision: 'approved', note: 'token=reviewsecret12345' });
    detail = service.getRunDetail(runId);
    const reviewed = detail.exports.find((item) => item.id === exportRecord?.id);
    expect(reviewed?.status).toBe('approved');
    expect(reviewed?.reviewDecision).toBe('approved');
    expect(reviewed?.reviewNote).toContain('token=...redacted');
    expect(reviewed?.reviewNote).not.toContain('reviewsecret12345');
    expect(detail.traceEvents.some((event) => event.summary === 'Export review recorded: approved.')).toBe(true);
    service.close();
  });

  it('exports a checkpointed workspace backup archive with a review manifest', () => {
    const service = openService();
    service.saveProgramScope({
      programName: 'Backup Program',
      organizationName: 'Example Org',
      descriptionMarkdown: 'Scoped backup test.',
      rulesMarkdown: 'Offline only.',
      networkProfile: 'offline',
      expiresAt: null,
      assets: [asset('in_scope', 'path', '/tmp/backup-target')]
    });

    const snapshot = service.exportWorkspaceBackup('secret=workspacebackupsecret12345');
    const backup = snapshot.workspace.lastWorkspaceBackup;
    expect(backup).toBeTruthy();
    expect(backup?.includesSensitiveData).toBe(true);
    expect(backup?.userReviewRequired).toBe(true);
    expect(String(backup?.manifest.note)).toContain('secret=...redacted');
    expect(String(backup?.manifest.note)).not.toContain('workspacebackupsecret12345');
    expect(existsSync(String(backup?.absolutePath))).toBe(true);

    const listing = execFileSync('tar', ['-tzf', String(backup?.absolutePath)], { encoding: 'utf8' });
    expect(listing).toContain('./manifest.json');
    expect(listing).toContain('./workspace/.beale/beale.sqlite');
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
    runEngine: 'fake',
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
