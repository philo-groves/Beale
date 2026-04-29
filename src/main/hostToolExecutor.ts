import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import type { GuestExecuteRequest, GuestExecuteResult } from './executorTypes';
import type { ScopeAsset } from '@shared/types';

interface HostExecutionOutcome {
  result: GuestExecuteResult;
  artifactId: string | null;
  artifactPath: string | null;
  cwd: string;
  targetPath: string | null;
}

const LOCAL_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['path', 'repo', 'binary', 'documentation', 'other']);
const MAX_HOST_OUTPUT_CHARS = 16_000;
const MAX_HOST_ARTIFACT_BYTES = 512 * 1024;

export function isHostResearchSandbox(profile: string): boolean {
  return profile === 'host_research_only' || profile === 'host';
}

export function executeHostOperation(
  db: WorkspaceDatabase,
  context: CreatedRunContext,
  request: GuestExecuteRequest,
  artifactPath: string | null,
  artifactKind: string
): HostExecutionOutcome {
  const hostTarget = firstScopedLocalTarget(db, context);
  const cwd = hostTarget ? cwdForTarget(hostTarget) : workspaceRoot(db);
  const env = hostToolEnv(request.env ?? {}, hostTarget);
  const startedAt = new Date();
  const result = spawnSync(request.command[0], request.command.slice(1), {
    cwd,
    env,
    encoding: 'utf8',
    timeout: request.timeoutMs,
    windowsHide: true
  });
  const endedAt = new Date();
  const timedOut = result.error?.name === 'TimeoutError';
  const exitCode = typeof result.status === 'number' ? result.status : null;
  const status = timedOut ? 'timeout' : exitCode === 0 ? 'success' : 'failure';
  const stdoutSummary = boundedText(result.stdout ?? '');
  const stderrSummary = boundedText(result.stderr || result.error?.message || '');
  const resolvedArtifactPath = artifactPath ? resolveHostArtifactPath(db, cwd, hostTarget, artifactPath) : null;
  const artifact = resolvedArtifactPath ? collectHostArtifact(db, context, resolvedArtifactPath, artifactKind) : null;

  return {
    result: {
      status,
      exitCode,
      signal: result.signal ?? null,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      stdoutSummary,
      stderrSummary,
      structured: {
        hostExecution: true,
        commandHash: createHash('sha256').update(JSON.stringify(request.command)).digest('hex'),
        cwd,
        targetPath: hostTarget,
        artifactPath: resolvedArtifactPath,
        artifactCollected: Boolean(artifact)
      },
      candidateArtifacts: artifact
        ? [
            {
              guestPath: resolvedArtifactPath ?? '',
              kind: artifact.kind,
              mimeType: artifact.mimeType,
              sensitivity: artifact.sensitivity,
              modelVisible: artifact.modelVisible,
              summary: `Host artifact collected from ${resolvedArtifactPath}.`
            }
          ]
        : [],
      contaminated: true,
      error: result.error?.message ?? null
    },
    artifactId: artifact?.id ?? null,
    artifactPath: resolvedArtifactPath,
    cwd,
    targetPath: hostTarget
  };
}

export function mapSandboxPathToHost(db: WorkspaceDatabase, value: string, context?: CreatedRunContext): string {
  const hostTarget = firstScopedLocalTarget(db, context);
  const cwd = hostTarget ? cwdForTarget(hostTarget) : workspaceRoot(db);
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed === '/workspace/target') return hostTarget ?? cwd;
  if (trimmed.startsWith('/workspace/target/') && hostTarget) {
    return join(hostTarget, trimmed.slice('/workspace/target/'.length));
  }
  if (trimmed.startsWith('/workspace/')) {
    return join(cwd, trimmed.slice('/workspace/'.length));
  }
  if (isAbsolute(trimmed)) return trimmed;
  return resolve(cwd, trimmed);
}

function collectHostArtifact(db: WorkspaceDatabase, context: CreatedRunContext, path: string, kind: string): ReturnType<WorkspaceDatabase['createArtifact']> | null {
  const hostTarget = firstScopedLocalTarget(db, context);
  if (!isCollectableHostArtifact(db, path, hostTarget)) return null;
  const stat = safeStat(path);
  if (!stat?.isFile() || stat.size > MAX_HOST_ARTIFACT_BYTES) return null;
  return db.createArtifact({
    kind,
    mimeType: 'application/octet-stream',
    sensitivity: 'internal',
    modelVisible: true,
    source: 'host_tool_output',
    metadata: {
      runId: context.run.id,
      attemptId: context.attempt.id,
      hostExecution: true,
      sourcePath: path
    },
    content: readFileSync(path)
  });
}

function resolveHostArtifactPath(db: WorkspaceDatabase, cwd: string, hostTarget: string | null, path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (trimmed === '/workspace/target') return hostTarget ?? cwd;
  if (trimmed.startsWith('/workspace/target/') && hostTarget) {
    return join(hostTarget, trimmed.slice('/workspace/target/'.length));
  }
  if (trimmed.startsWith('/workspace/')) {
    return join(cwd, trimmed.slice('/workspace/'.length));
  }
  if (isAbsolute(trimmed)) return resolve(trimmed);
  return resolve(cwd, trimmed);
}

function isCollectableHostArtifact(db: WorkspaceDatabase, path: string, hostTarget: string | null): boolean {
  const resolved = resolve(path);
  if (pathContainsSegment(resolved, '.beale')) return false;
  if (isWithinPath(resolved, workspaceRoot(db))) return true;
  const tempRoot = resolve(tmpdir());
  return isWithinPath(resolved, tempRoot) && isCollectableTempArtifactName(basename(resolved), hostTarget);
}

function hostToolEnv(input: Record<string, string>, hostTarget: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(input)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = String(value);
  }
  if (hostTarget) env.BEALE_TARGET_PATH = hostTarget;
  env.BEALE_EXECUTION_SUBSTRATE = 'host';
  return env;
}

function firstScopedLocalTarget(db: WorkspaceDatabase, context?: CreatedRunContext): string | null {
  const targets = scopedAssetsForHostSelection(db, context).filter((candidate) => isScopedLocalAsset(candidate));
  if (targets.length === 0) return null;

  let selected = targets[0];
  let selectedScore = scoreHostTarget(selected, context);
  for (const candidate of targets.slice(1)) {
    const score = scoreHostTarget(candidate, context);
    if (score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }
  return resolve(selected.value);
}

function isScopedLocalAsset(asset: ScopeAsset): boolean {
  return asset.direction === 'in_scope' && LOCAL_ASSET_KINDS.has(asset.kind) && isAbsolute(asset.value) && existsSync(asset.value) && !looksLikeUrl(asset.value);
}

function cwdForTarget(path: string): string {
  const stat = safeStat(path);
  return stat?.isDirectory() ? path : dirname(path);
}

function scopedAssetsForHostSelection(db: WorkspaceDatabase, context?: CreatedRunContext): ScopeAsset[] {
  const assets: ScopeAsset[] = [];
  const seen = new Set<string>();
  for (const asset of safeScopeAssets(() => db.getActiveScope().assets)) {
    assets.push(asset);
    seen.add(asset.id);
  }
  if (context) {
    for (const asset of safeScopeAssets(() => db.getScopeVersion(context.run.scopeVersionId).assets)) {
      if (seen.has(asset.id)) continue;
      assets.push(asset);
      seen.add(asset.id);
    }
  }
  return assets;
}

function safeScopeAssets(read: () => ScopeAsset[]): ScopeAsset[] {
  try {
    return read();
  } catch {
    return [];
  }
}

function scoreHostTarget(asset: ScopeAsset, context?: CreatedRunContext): number {
  if (!context) return 0;
  const haystack = `${context.run.title}\n${context.run.promptMarkdown}`.toLowerCase();
  const normalizedHaystack = normalizeMatchText(haystack);
  let score = 0;
  for (const alias of hostTargetAliases(asset)) {
    const normalizedAlias = normalizeMatchText(alias);
    if (alias.length >= 8 && haystack.includes(alias.toLowerCase())) score = Math.max(score, 1000);
    if (normalizedAlias.length >= 4 && normalizedHaystack.includes(normalizedAlias)) score = Math.max(score, 500 + Math.min(normalizedAlias.length, 200));
  }
  return score;
}

function hostTargetAliases(asset: ScopeAsset): string[] {
  const aliases = new Set<string>();
  const path = resolve(asset.value);
  aliases.add(path);
  aliases.add(basename(path));
  for (const value of Object.values(asset.attributes ?? {})) {
    if (typeof value !== 'string') continue;
    aliases.add(value);
    if (looksLikeUrl(value)) aliases.add(repositoryNameFromUrl(value));
  }
  for (const part of basename(path).split(/[^A-Za-z0-9]+/)) {
    if (part.length >= 4) aliases.add(part);
  }
  return [...aliases].filter(Boolean);
}

function repositoryNameFromUrl(value: string): string {
  const trimmed = value.replace(/\.git$/i, '').replace(/\/+$/g, '');
  return trimmed.split('/').at(-1) ?? trimmed;
}

function isCollectableTempArtifactName(name: string, hostTarget: string | null): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(name)) return false;
  const normalized = name.toLowerCase();
  const prefixes = new Set(['beale']);
  if (hostTarget) {
    const base = basename(hostTarget).toLowerCase();
    prefixes.add(sanitizePrefix(base));
    for (const part of base.split(/[^a-z0-9]+/)) {
      if (part.length >= 4) prefixes.add(sanitizePrefix(part));
    }
  }
  return [...prefixes].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}-`) || normalized.startsWith(`${prefix}_`) || normalized.startsWith(`${prefix}.`));
}

function sanitizePrefix(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function workspaceRoot(db: WorkspaceDatabase): string {
  return dirname(dirname(db.getDatabasePath()));
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function boundedText(value: string): string {
  return value.length > MAX_HOST_OUTPUT_CHARS ? `${value.slice(0, MAX_HOST_OUTPUT_CHARS)}\n[truncated]` : value;
}

function isWithinPath(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function pathContainsSegment(path: string, segment: string): boolean {
  return path.split(/[\\/]+/).includes(segment);
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}
