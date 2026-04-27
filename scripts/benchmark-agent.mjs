#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const taskPath = process.env.BEALE_TASK_INPUT ?? '/bench/input/task.json';
const outputDir = process.env.BEALE_OUTPUT_DIR ?? '/bench/output';
const forceFail = process.env.BEALE_BENCHMARK_FORCE_FAIL === '1';
const task = JSON.parse(readFileSync(taskPath, 'utf8'));
const requiredArtifacts = Array.isArray(task.requiredArtifacts) ? task.requiredArtifacts.filter((item) => typeof item === 'string') : [];
const producedArtifacts = forceFail ? requiredArtifacts.slice(0, Math.max(0, requiredArtifacts.length - 1)) : requiredArtifacts;
const artifactsDir = join(outputDir, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

for (const artifact of producedArtifacts) {
  writeFileSync(join(artifactsDir, `${safeName(artifact)}.txt`), `Benchmark artifact ${artifact} for ${task.taskId}\n`);
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
      summary: forceFail ? 'Docker benchmark agent intentionally omitted required evidence.' : 'Docker benchmark agent produced required evidence.'
    },
    null,
    2
  )
);

function safeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}
