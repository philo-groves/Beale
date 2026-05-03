import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { ProgramScopeVersion, ScopeAsset } from '@shared/types';

export interface SourceRepositoryCandidate {
  url: string;
  label: string;
  sourceAssetId: string;
  sourceAssetKind: ScopeAsset['kind'];
  sensitivity: string;
}

export interface SourceRepositorySelection {
  candidate: SourceRepositoryCandidate | null;
  candidates: SourceRepositoryCandidate[];
  reason: 'matched' | 'ambiguous' | 'not_found';
}

export interface MaterializedSourceRepository {
  repositoryUrl: string;
  localPath: string;
  cloned: boolean;
  ref: string | null;
  head: string | null;
  headRefName: string | null;
  headDescribe: string | null;
  requestedRefHead: string | null;
  requestedRefMatchesHead: boolean | null;
}

const GIT_TIMEOUT_MS = 180_000;
const SOURCE_REPOSITORY_RE = /\b(?:https?:\/\/)?(?:github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.git)?(?:[/?#][^\s<>)\]]*)?/gi;
const SSH_SOURCE_REPOSITORY_RE = /\bgit@(?:github\.com|gitlab\.com):[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.git)?\b/gi;
const SOURCE_REPOSITORY_HOSTS = new Set(['github.com', 'gitlab.com']);

export function sourceRepositoryCandidates(scope: ProgramScopeVersion): SourceRepositoryCandidate[] {
  const candidates = new Map<string, SourceRepositoryCandidate>();
  for (const asset of scope.assets) {
    if (asset.direction !== 'in_scope') continue;
    const text = [asset.value, stringAttribute(asset.attributes?.instruction), stringAttribute(asset.attributes?.repositoryUrl)].filter(Boolean).join('\n');
    for (const url of extractSourceRepositoryUrls(text)) {
      if (candidates.has(url)) continue;
      candidates.set(url, {
        url,
        label: asset.value,
        sourceAssetId: asset.id,
        sourceAssetKind: asset.kind,
        sensitivity: asset.sensitivity
      });
    }
  }
  return [...candidates.values()].sort((left, right) => left.url.localeCompare(right.url));
}

export function selectSourceRepository(scope: ProgramScopeVersion, requested: string): SourceRepositorySelection {
  const candidates = sourceRepositoryCandidates(scope);
  const requestedUrl = normalizeSourceRepositoryUrl(requested);
  if (requestedUrl) {
    return {
      candidate: candidates.find((candidate) => sameRepositoryUrl(candidate.url, requestedUrl)) ?? null,
      candidates,
      reason: candidates.some((candidate) => sameRepositoryUrl(candidate.url, requestedUrl)) ? 'matched' : 'not_found'
    };
  }

  const query = requested.trim().toLowerCase();
  if (!query) {
    return { candidate: candidates.length === 1 ? candidates[0] : null, candidates, reason: candidates.length === 1 ? 'matched' : 'ambiguous' };
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, score: sourceCandidateScore(candidate, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.url.localeCompare(right.candidate.url));
  if (ranked.length === 0) return { candidate: null, candidates, reason: 'not_found' };
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return { candidate: null, candidates: ranked.map((entry) => entry.candidate), reason: 'ambiguous' };
  return { candidate: ranked[0].candidate, candidates, reason: 'matched' };
}

export function materializeGitRepository(candidate: SourceRepositoryCandidate, databasePath: string, ref: string): MaterializedSourceRepository {
  const workspaceRoot = workspaceRootFromDatabasePath(databasePath);
  const managedRoot = join(workspaceRoot, 'targets', 'repositories');
  const slug = repositorySlug(candidate.url);
  const localPath = join(managedRoot, slug);
  const cleanRef = ref.trim();
  mkdirSync(managedRoot, { recursive: true });

  const existingCheckout = findExistingWorkspaceCheckout(candidate, workspaceRoot);
  if (existingCheckout) {
    materializeRequestedRef(existingCheckout, cleanRef);
    return {
      repositoryUrl: candidate.url,
      localPath: existingCheckout,
      cloned: false,
      ref: cleanRef || null,
      ...gitCheckoutMetadata(existingCheckout, cleanRef)
    };
  }

  if (existsSync(join(localPath, '.git'))) {
    materializeRequestedRef(localPath, cleanRef);
    return {
      repositoryUrl: candidate.url,
      localPath,
      cloned: false,
      ref: cleanRef || null,
      ...gitCheckoutMetadata(localPath, cleanRef)
    };
  }
  if (existsSync(localPath)) {
    const stat = statSync(localPath);
    throw new Error(`Managed source path already exists and is not a git checkout: ${stat.isDirectory() ? localPath : dirname(localPath)}`);
  }

  const tempPath = join(managedRoot, `.${slug}.tmp-${process.pid}-${Date.now()}`);
  rmSync(tempPath, { recursive: true, force: true });
  try {
    runGit(['-c', 'protocol.ext.allow=never', '-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--filter=blob:none', '--', candidate.url, tempPath]);
    if (cleanRef) {
      materializeRequestedRef(tempPath, cleanRef);
    }
    renameSync(tempPath, localPath);
  } catch (error) {
    rmSync(tempPath, { recursive: true, force: true });
    throw error;
  }

  return {
    repositoryUrl: candidate.url,
    localPath,
    cloned: true,
    ref: cleanRef || null,
    ...gitCheckoutMetadata(localPath, cleanRef)
  };
}

export async function materializeGitRepositoryAsync(candidate: SourceRepositoryCandidate, databasePath: string, ref: string): Promise<MaterializedSourceRepository> {
  const workspaceRoot = workspaceRootFromDatabasePath(databasePath);
  const managedRoot = join(workspaceRoot, 'targets', 'repositories');
  const slug = repositorySlug(candidate.url);
  const localPath = join(managedRoot, slug);
  const cleanRef = ref.trim();
  mkdirSync(managedRoot, { recursive: true });

  const existingCheckout = findExistingWorkspaceCheckout(candidate, workspaceRoot);
  if (existingCheckout) {
    await materializeRequestedRefAsync(existingCheckout, cleanRef);
    return {
      repositoryUrl: candidate.url,
      localPath: existingCheckout,
      cloned: false,
      ref: cleanRef || null,
      ...gitCheckoutMetadata(existingCheckout, cleanRef)
    };
  }

  if (existsSync(join(localPath, '.git'))) {
    await materializeRequestedRefAsync(localPath, cleanRef);
    return {
      repositoryUrl: candidate.url,
      localPath,
      cloned: false,
      ref: cleanRef || null,
      ...gitCheckoutMetadata(localPath, cleanRef)
    };
  }
  if (existsSync(localPath)) {
    const stat = statSync(localPath);
    throw new Error(`Managed source path already exists and is not a git checkout: ${stat.isDirectory() ? localPath : dirname(localPath)}`);
  }

  const tempPath = join(managedRoot, `.${slug}.tmp-${process.pid}-${Date.now()}`);
  rmSync(tempPath, { recursive: true, force: true });
  try {
    await runGitAsync(['-c', 'protocol.ext.allow=never', '-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--filter=blob:none', '--', candidate.url, tempPath]);
    if (cleanRef) {
      await materializeRequestedRefAsync(tempPath, cleanRef);
    }
    renameSync(tempPath, localPath);
  } catch (error) {
    rmSync(tempPath, { recursive: true, force: true });
    throw error;
  }

  return {
    repositoryUrl: candidate.url,
    localPath,
    cloned: true,
    ref: cleanRef || null,
    ...gitCheckoutMetadata(localPath, cleanRef)
  };
}

export function extractSourceRepositoryUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const pattern of [SOURCE_REPOSITORY_RE, SSH_SOURCE_REPOSITORY_RE]) {
    for (const match of text.matchAll(pattern)) {
      const normalized = normalizeSourceRepositoryUrl(match[0]);
      if (normalized) urls.add(normalized);
    }
  }
  return [...urls];
}

export function normalizeSourceRepositoryUrl(value: string): string | null {
  const trimmed = value.trim().replace(/[),.;]+$/, '');
  if (!trimmed) return null;
  const ssh = trimmed.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^?#]+)$/i);
  const withProtocol = ssh ? `https://${ssh[1]}/${ssh[2]}` : /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !SOURCE_REPOSITORY_HOSTS.has(host)) return null;
  const allSegments = parsed.pathname.split('/').filter(Boolean);
  const stopIndex = allSegments.indexOf('-');
  const pathSegments = (stopIndex >= 0 ? allSegments.slice(0, stopIndex) : allSegments).slice(0, host === 'github.com' ? 2 : undefined);
  if (pathSegments.length < 2) return null;
  pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/\.git$/i, '');
  if (pathSegments.some((segment) => !safeRepositoryPathSegment(segment))) return null;
  return `https://${host}/${pathSegments.join('/')}`;
}

export function normalizeGitHubRepositoryUrl(value: string): string | null {
  return normalizeSourceRepositoryUrl(value);
}

export function findScopedExistingSourceCheckout(scope: ProgramScopeVersion, databasePath: string, pathHint: string): { candidate: SourceRepositoryCandidate; localPath: string; head: string | null } | null {
  const workspaceRoot = workspaceRootFromDatabasePath(databasePath);
  const resolvedPath = resolve(pathHint);
  if (!isWithinPath(resolvedPath, workspaceRoot)) return null;
  const gitRoot = findGitRootAtOrAbove(resolvedPath, workspaceRoot);
  if (!gitRoot) return null;
  const remoteUrls = gitRemoteUrls(gitRoot);
  const candidate = sourceRepositoryCandidates(scope).find((item) => remoteUrls.some((remoteUrl) => sameRepositoryUrl(item.url, remoteUrl))) ?? null;
  return candidate ? { candidate, localPath: gitRoot, head: gitHead(gitRoot) } : null;
}

function sourceCandidateScore(candidate: SourceRepositoryCandidate, query: string): number {
  const repoName = candidate.url.split('/').at(-1)?.toLowerCase() ?? '';
  const label = candidate.label.toLowerCase();
  const url = candidate.url.toLowerCase();
  if (repoName === query) return 100;
  if (label === query) return 90;
  if (url === query) return 80;
  if (repoName.includes(query)) return 70;
  if (label.includes(query)) return 60;
  if (url.includes(query)) return 50;
  return 0;
}

function sameRepositoryUrl(left: string, right: string): boolean {
  const normalizedLeft = normalizeSourceRepositoryUrl(left);
  const normalizedRight = normalizeSourceRepositoryUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft.toLowerCase() === normalizedRight.toLowerCase());
}

function repositorySlug(url: string): string {
  const parsed = new URL(url);
  return [parsed.hostname, ...parsed.pathname.split('/').filter(Boolean)]
    .join('_')
    .replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .slice(0, 120);
}

function workspaceRootFromDatabasePath(databasePath: string): string {
  return dirname(dirname(databasePath));
}

function gitHead(localPath: string): string | null {
  try {
    const result = runGit(['-C', localPath, 'rev-parse', 'HEAD']);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function gitCheckoutMetadata(localPath: string, requestedRef: string): Omit<MaterializedSourceRepository, 'repositoryUrl' | 'localPath' | 'cloned' | 'ref'> {
  const head = gitHead(localPath);
  const headRefName = gitOutput(localPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const headDescribe = gitOutput(localPath, ['describe', '--tags', '--always', '--dirty']);
  const requestedRefHead = requestedRef ? gitOutput(localPath, ['rev-parse', `${requestedRef}^{commit}`]) : null;
  return {
    head,
    headRefName: headRefName === 'HEAD' ? null : headRefName,
    headDescribe,
    requestedRefHead,
    requestedRefMatchesHead: requestedRefHead && head ? requestedRefHead === head : requestedRef ? false : null
  };
}

function materializeRequestedRef(localPath: string, requestedRef: string): void {
  if (!requestedRef) return;
  const metadata = gitCheckoutMetadata(localPath, requestedRef);
  if (metadata.requestedRefMatchesHead === true) return;
  try {
    runGit(['-C', localPath, 'fetch', '--depth', '1', 'origin', requestedRef]);
  } catch {
    runGit(['-C', localPath, 'fetch', '--tags', '--depth', '1', 'origin']);
  }
  const requestedCommit = gitOutput(localPath, ['rev-parse', `${requestedRef}^{commit}`]);
  runGit(['-C', localPath, 'checkout', '--detach', requestedCommit ?? requestedRef]);
}

async function materializeRequestedRefAsync(localPath: string, requestedRef: string): Promise<void> {
  if (!requestedRef) return;
  const metadata = gitCheckoutMetadata(localPath, requestedRef);
  if (metadata.requestedRefMatchesHead === true) return;
  try {
    await runGitAsync(['-C', localPath, 'fetch', '--depth', '1', 'origin', requestedRef]);
  } catch {
    await runGitAsync(['-C', localPath, 'fetch', '--tags', '--depth', '1', 'origin']);
  }
  const requestedCommit = gitOutput(localPath, ['rev-parse', `${requestedRef}^{commit}`]);
  await runGitAsync(['-C', localPath, 'checkout', '--detach', requestedCommit ?? requestedRef]);
}

function gitOutput(localPath: string, args: string[]): string | null {
  try {
    const result = runGit(['-C', localPath, ...args]);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function findExistingWorkspaceCheckout(candidate: SourceRepositoryCandidate, workspaceRoot: string): string | null {
  for (const path of existingCheckoutSearchPaths(candidate, workspaceRoot)) {
    if (!existsSync(join(path, '.git'))) continue;
    if (gitRemoteUrls(path).some((remoteUrl) => sameRepositoryUrl(candidate.url, remoteUrl))) {
      return path;
    }
  }
  return null;
}

function existingCheckoutSearchPaths(candidate: SourceRepositoryCandidate, workspaceRoot: string): string[] {
  const paths = new Set<string>([workspaceRoot]);
  const repoName = candidate.url.split('/').at(-1);
  if (repoName) paths.add(join(workspaceRoot, repoName));
  try {
    for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.beale' || entry.name === 'targets') continue;
      paths.add(join(workspaceRoot, entry.name));
    }
  } catch {
    // Fall through to explicit candidates.
  }
  return [...paths].map((path) => resolve(path)).filter((path) => isWithinPath(path, workspaceRoot));
}

function findGitRootAtOrAbove(pathHint: string, workspaceRoot: string): string | null {
  let current = safeStat(pathHint)?.isDirectory() ? resolve(pathHint) : dirname(resolve(pathHint));
  const root = resolve(workspaceRoot);
  while (isWithinPath(current, root)) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function gitRemoteUrls(localPath: string): string[] {
  try {
    const result = runGit(['-C', localPath, 'config', '--get-regexp', '^remote\\..*\\.url$']);
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/).slice(1).join(' '))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function isWithinPath(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel));
}

function runGit(args: string[]): { stdout: string; stderr: string } {
  const command = process.env.BEALE_GIT_COMMAND?.trim() || 'git';
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: gitEnv(),
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit ${result.status}: ${String(result.stderr || result.stdout).slice(0, 800)}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runGitAsync(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const command = process.env.BEALE_GIT_COMMAND?.trim() || 'git';
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: gitEnv(),
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`git ${args.join(' ')} timed out after ${GIT_TIMEOUT_MS}ms`));
    }, GIT_TIMEOUT_MS);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`git ${args.join(' ')} failed with exit ${code}: ${String(stderr || stdout).slice(0, 800)}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function boundedAppend(current: string, chunk: string): string {
  return (current + chunk).slice(-16_000);
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    WINDIR: process.env.WINDIR ?? '',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null'
  };
}

function safeRepositoryPathSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

function stringAttribute(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
