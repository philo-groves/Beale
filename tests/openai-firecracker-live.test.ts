import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/main/database';
import { ExecutorManager } from '../src/main/executorManager';
import { OpenAiResponsesAdapter } from '../src/main/openaiAdapter';
import { OpenAiAuthService } from '../src/main/openaiAuth';
import { OpenAiRunEngine } from '../src/main/openaiRunEngine';
import type { StartRunInput } from '../src/shared/types';

const runLive = process.env.BEALE_LIVE_OPENAI_FIRECRACKER_TEST === '1';
const maybeIt = runLive ? it : it.skip;
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('OpenAI + Firecracker live integration', () => {
  maybeIt(
    'uses live OpenAI tool calls to verify the local vulnerable target inside Firecracker',
    async () => {
      const auth = new OpenAiAuthService();
      const credential = auth.getCredential();
      if (!credential) {
        throw new Error('Set BEALE_OPENAI_AUTH_COMMAND, BEALE_OPENAI_ACCESS_TOKEN, or OPENAI_API_KEY to run the live OpenAI + Firecracker test.');
      }

      const targetDir = resolve('tests/fixtures/vulnerable-target');
      const targetFile = join(targetDir, 'tenant_export.py');
      if (!existsSync(targetFile)) {
        throw new Error(`Missing vulnerable target fixture: ${targetFile}`);
      }

      const workspace = mkdtempSync(join(tmpdir(), 'beale-openai-firecracker-live-'));
      createdDirs.push(workspace);
      const artifactRoot = join(workspace, '.beale', 'artifacts');
      mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });

      const db = new WorkspaceDatabase(join(workspace, '.beale', 'beale.sqlite'), artifactRoot);
      db.initialize();
      db.saveProgramScope({
        programName: 'OpenAI Firecracker Vulnerable Fixture',
        organizationName: 'Local',
        descriptionMarkdown: 'Local intentionally vulnerable target for live OpenAI + Firecracker integration.',
        rulesMarkdown: 'Only inspect the scoped fixture and execute verifier commands inside the selected sandbox.',
        networkProfile: 'offline',
        expiresAt: null,
        assets: [{ direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} }]
      });

      const engine = new OpenAiRunEngine(db, auth, new OpenAiResponsesAdapter(auth), new ExecutorManager(db));
      try {
        const handle = engine.startRun(liveInput(targetFile));
        await handle.completion;

        const detail = db.getRunDetail(handle.context.run.id);
        const verifierPass = detail.verifierRuns.find((run) => run.status === 'pass' && run.result.realExecution === true && run.result.vmExecution === true);
        expect(verifierPass).toBeTruthy();
        expect(detail.traceEvents.some((event) => event.summary === 'OpenAI adapter prepared host-only model session.')).toBe(true);
        expect(detail.traceEvents.some((event) => event.summary.includes('OpenAI completed function call arguments for verifier'))).toBe(true);
        expect(detail.traceEvents.some((event) => event.summary === 'Verifier contract executed in disposable sandbox with pass.')).toBe(true);
        expect(detail.artifacts.some((artifact) => artifact.kind === 'verifier_output')).toBe(true);
        expect(detail.vmContexts.some((context) => context.backend === 'vmctl' && context.state === 'destroyed')).toBe(true);
      } finally {
        engine.dispose();
        db.close();
      }
    },
    180_000
  );
});

function liveInput(targetFile: string): StartRunInput {
  return {
    runEngine: 'openai_responses',
    promptMarkdown: [
      '# Live OpenAI + Firecracker verifier smoke',
      '',
      'You are testing Beale plumbing against a local intentionally vulnerable fixture.',
      'Do not make network requests. Do not claim a verified finding from prose.',
      '',
      'Call Beale tools only. Use this sequence:',
      '',
      '1. Call `search` with query `BEALE_VULN_TENANT_B_SECRET` and target empty string.',
      `2. Call \`code_browser\` with path \`${targetFile}\` and symbol \`export_tenant\`.`,
      '3. Call `verifier` with exactly these string arguments:',
      '   - hypothesis: `tenant export authorization bypass`',
      '   - expectation: `alice can export tenant-b secret from the local fixture`',
      '   - artifact_id: empty string',
      '   - trace_event_id: empty string',
      '   - verifier_script: `python3 /workspace/target/tenant_export.py alice tenant-b | tee /tmp/beale-tenant-export-verifier.json`',
      '   - artifact_path: `/tmp/beale-tenant-export-verifier.json`',
      '   - expected_stdout: `BEALE_VULN_TENANT_B_SECRET`',
      '',
      'After the verifier tool returns, provide a one-sentence summary.'
    ].join('\n'),
    mode: 'open_discovery',
    attemptStrategy: 'single_path',
    model: process.env.BEALE_OPENAI_LIVE_MODEL ?? 'gpt-5.5',
    reasoningEffort: process.env.BEALE_OPENAI_LIVE_REASONING ?? 'low',
    networkProfile: 'offline',
    sandboxProfile: 'local_disposable_vm',
    budget: {
      maxMinutes: 10,
      maxAttempts: 1,
      maxCostUsd: 0
    },
    fakeScenario: 'adaptive_portfolio'
  };
}
