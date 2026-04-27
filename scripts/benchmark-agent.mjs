#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const taskPath = process.env.BEALE_TASK_INPUT ?? '/bench/input/task.json';
const outputDir = process.env.BEALE_OUTPUT_DIR ?? '/bench/output';
const forceFail = process.env.BEALE_BENCHMARK_FORCE_FAIL === '1';
const task = JSON.parse(readFileSync(taskPath, 'utf8'));
const proxyResult = await callModelProxy(task);
const requiredArtifacts = Array.isArray(task.requiredArtifacts) ? task.requiredArtifacts.filter((item) => typeof item === 'string') : [];
const producedArtifacts = forceFail ? requiredArtifacts.slice(0, Math.max(0, requiredArtifacts.length - 1)) : requiredArtifacts;
const artifactsDir = join(outputDir, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

for (const artifact of producedArtifacts) {
  writeFileSync(join(artifactsDir, `${safeName(artifact)}.txt`), `Benchmark artifact ${artifact} for ${task.taskId}\n`);
}

const fixtureProbe = task.fixture?.kind === 'cybergym_pre_post' ? runFixtureProbe(task.fixture) : null;
if (fixtureProbe && producedArtifacts.includes('poc')) {
  writeFileSync(join(artifactsDir, 'poc.txt'), `${fixtureProbe.pocInput}\n`);
}
if (fixtureProbe && producedArtifacts.includes('verifier_result')) {
  writeFileSync(join(artifactsDir, 'verifier_result.json'), JSON.stringify(fixtureProbe, null, 2));
}

writeFileSync(
  join(outputDir, 'result.json'),
  JSON.stringify(
    {
      taskId: task.taskId,
      producedArtifacts,
      verifierStatus: forceFail ? 'inconclusive' : task.verifierContract?.requiredResult ?? 'pass',
      toolCompetenciesUsed: Array.isArray(task.expectedToolCompetencies) ? task.expectedToolCompetencies : [],
      policyViolationsBlocked: task.mode === 'safety' || String(task.taskId).startsWith('safety-') ? 1 : 0,
      claimsWithoutEvidence: forceFail ? 1 : 0,
      summary: forceFail ? 'Docker benchmark agent intentionally omitted required evidence.' : 'Docker benchmark agent produced required evidence.',
      modelProxy: proxyResult,
      fixtureProbe
    },
    null,
    2
  )
);

async function callModelProxy(task) {
  const endpoint = process.env.BEALE_MODEL_PROXY_URL;
  if (!endpoint) return { called: false, forwarded: false, reason: 'no proxy endpoint configured' };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.BEALE_MODEL ?? 'gpt-5.5',
        reasoningEffort: process.env.BEALE_REASONING_EFFORT ?? 'xhigh',
        instructions: 'Classify this benchmark task and return a concise execution note.',
        input: {
          taskId: task.taskId,
          title: task.title,
          mode: task.mode,
          expectedToolCompetencies: task.expectedToolCompetencies,
          requiredArtifacts: task.requiredArtifacts,
          fixtureKind: task.fixture?.kind ?? null
        },
        metadata: { taskId: task.taskId, benchmarkAgent: 'docker' }
      })
    });
    const body = await response.json().catch(() => ({}));
    return {
      called: true,
      status: response.status,
      forwarded: body.forwarded === true,
      credentialExposedToAgent: body.credentialExposedToAgent === true,
      outputTextLength: typeof body.output_text === 'string' ? body.output_text.length : 0
    };
  } catch (error) {
    return {
      called: true,
      forwarded: false,
      credentialExposedToAgent: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function runFixtureProbe(fixture) {
  const pocInput = String(fixture.pocInput ?? '');
  try {
    const result = Function('input', fixture.vulnerableSource)(pocInput);
    return { kind: fixture.kind, pocInput, vulnerableObservation: 'parsed', vulnerableResult: String(result) };
  } catch (error) {
    return { kind: fixture.kind, pocInput, vulnerableObservation: 'crash', vulnerableError: error instanceof Error ? error.message : String(error) };
  }
}

function safeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}
