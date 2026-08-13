import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { readdir as readdirAsync, rename as renameAsync, rm as rmAsync, stat as statAsync } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { WorkspaceScopeVersion, ScopeAsset } from '@shared/types';

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
const TEMPORARY_CHECKOUT_REMOVE_RETRIES = 8;
const TEMPORARY_CHECKOUT_REMOVE_RETRY_DELAY_MS = 250;
const CHECKOUT_PUBLISH_RETRIES = 8;
const CHECKOUT_PUBLISH_RETRY_DELAY_MS = 250;
const STALE_TEMPORARY_CHECKOUT_AGE_MS = GIT_TIMEOUT_MS + 60_000;
const SOURCE_REPOSITORY_RE = /\b(?:https?:\/\/)?(?:github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.git)?(?:[/?#][^\s<>)\]]*)?/gi;
const SSH_SOURCE_REPOSITORY_RE = /\bgit@(?:github\.com|gitlab\.com):[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.git)?\b/gi;
const SOURCE_REPOSITORY_HOSTS = new Set(['github.com', 'gitlab.com']);

export function defaultSourceRepositoryStoreDirectory(registryDirectory?: string): string {
  const explicit = process.env.BEALE_REPOSITORY_STORE_DIR?.trim();
  if (explicit) return resolve(explicit);
  const bealeHome = registryDirectory ?? process.env.BEALE_WORKSPACE_REGISTRY_DIR?.trim() ?? join(homedir(), '.beale');
  return resolve(bealeHome, 'repositories');
}

export function sourceRepositoryCandidates(scope: WorkspaceScopeVersion): SourceRepositoryCandidate[] {
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

export function selectSourceRepository(scope: WorkspaceScopeVersion, requested: string): SourceRepositorySelection {
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

export function materializeGitRepository(
  candidate: SourceRepositoryCandidate,
  ref: string,
  options: { repositoryStoreDirectory?: string } = {}
): MaterializedSourceRepository {
  const managedRoot = resolve(options.repositoryStoreDirectory ?? defaultSourceRepositoryStoreDirectory());
  const slug = repositorySlug(candidate.url);
  const cleanRef = ref.trim();
  const localPath = join(managedRoot, slug, repositoryCheckoutKey(cleanRef));
  mkdirSync(dirname(localPath), { recursive: true });
  removeStaleTemporaryCheckouts(localPath, cleanRef);

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

  const tempPath = temporaryCheckoutPath(localPath, cleanRef);
  const initialCleanupError = removeTemporaryCheckout(tempPath);
  if (initialCleanupError) throw initialCleanupError;
  let cloned = true;
  try {
    runGit(gitCloneArgs(candidate.url, tempPath));
    if (cleanRef) {
      materializeRequestedRef(tempPath, cleanRef);
    }
    cloned = publishTemporaryCheckout(tempPath, localPath);
    if (!cloned) removeTemporaryCheckout(tempPath);
  } catch (error) {
    throw sourceMaterializationError(error, tempPath, removeTemporaryCheckout(tempPath));
  }

  return {
    repositoryUrl: candidate.url,
    localPath,
    cloned,
    ref: cleanRef || null,
    ...gitCheckoutMetadata(localPath, cleanRef)
  };
}

export async function materializeGitRepositoryAsync(
  candidate: SourceRepositoryCandidate,
  ref: string,
  options: { signal?: AbortSignal; repositoryStoreDirectory?: string } = {}
): Promise<MaterializedSourceRepository> {
  const managedRoot = resolve(options.repositoryStoreDirectory ?? defaultSourceRepositoryStoreDirectory());
  const slug = repositorySlug(candidate.url);
  const cleanRef = ref.trim();
  const localPath = join(managedRoot, slug, repositoryCheckoutKey(cleanRef));
  mkdirSync(dirname(localPath), { recursive: true });
  await removeStaleTemporaryCheckoutsAsync(localPath, cleanRef);

  if (existsSync(join(localPath, '.git'))) {
    await materializeRequestedRefAsync(localPath, cleanRef, options);
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

  const tempPath = temporaryCheckoutPath(localPath, cleanRef);
  const initialCleanupError = await removeTemporaryCheckoutAsync(tempPath);
  if (initialCleanupError) throw initialCleanupError;
  let cloned = true;
  try {
    await runGitAsync(gitCloneArgs(candidate.url, tempPath), options.signal);
    if (cleanRef) {
      await materializeRequestedRefAsync(tempPath, cleanRef, options);
    }
    cloned = await publishTemporaryCheckoutAsync(tempPath, localPath);
    if (!cloned) await removeTemporaryCheckoutAsync(tempPath);
  } catch (error) {
    throw sourceMaterializationError(error, tempPath, await removeTemporaryCheckoutAsync(tempPath));
  }

  return {
    repositoryUrl: candidate.url,
    localPath,
    cloned,
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

function repositoryCheckoutKey(ref: string): string {
  if (!ref) return 'default';
  const label = ref.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'ref';
  const digest = createHash('sha256').update(ref).digest('hex').slice(0, 12);
  return `${label}-${digest}`;
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

async function materializeRequestedRefAsync(localPath: string, requestedRef: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  if (!requestedRef) return;
  const metadata = gitCheckoutMetadata(localPath, requestedRef);
  if (metadata.requestedRefMatchesHead === true) return;
  try {
    await runGitAsync(['-C', localPath, 'fetch', '--depth', '1', 'origin', requestedRef], options.signal);
  } catch {
    await runGitAsync(['-C', localPath, 'fetch', '--tags', '--depth', '1', 'origin'], options.signal);
  }
  const requestedCommit = gitOutput(localPath, ['rev-parse', `${requestedRef}^{commit}`]);
  await runGitAsync(['-C', localPath, 'checkout', '--detach', requestedCommit ?? requestedRef], options.signal);
}

function gitOutput(localPath: string, args: string[]): string | null {
  try {
    const result = runGit(['-C', localPath, ...args]);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function runGit(args: string[]): { stdout: string; stderr: string } {
  const effectiveArgs = gitPlatformArgs(args);
  const invocation = gitInvocation(effectiveArgs);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    env: gitEnv(),
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${effectiveArgs.join(' ')} failed with exit ${result.status}: ${gitErrorOutput(result.stderr || result.stdout)}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runGitAsync(args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  const effectiveArgs = gitPlatformArgs(args);
  const invocation = gitInvocation(effectiveArgs);
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error('git operation aborted'));
      return;
    }
    const child = spawn(invocation.command, invocation.args, {
      env: gitEnv(),
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let terminationError: Error | null = null;
    const timer = setTimeout(() => {
      terminationError = new Error(`git ${effectiveArgs.join(' ')} timed out after ${GIT_TIMEOUT_MS}ms`);
      child.kill('SIGTERM');
    }, GIT_TIMEOUT_MS);
    const abort = (): void => {
      terminationError = new Error('git operation aborted');
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', abort, { once: true });
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
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (terminationError) {
        reject(terminationError);
        return;
      }
      if (code !== 0) {
        reject(new Error(`git ${effectiveArgs.join(' ')} failed with exit ${code}: ${gitErrorOutput(stderr || stdout)}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function temporaryCheckoutPath(localPath: string, ref: string): string {
  return join(
    dirname(localPath),
    `.${repositoryCheckoutKey(ref)}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`
  );
}

function temporaryCheckoutPrefix(ref: string): string {
  return `.${repositoryCheckoutKey(ref)}.tmp-`;
}

function removeStaleTemporaryCheckouts(localPath: string, ref: string): void {
  const parent = dirname(localPath);
  const prefix = temporaryCheckoutPrefix(ref);
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const candidate = join(parent, entry.name);
    try {
      if (Date.now() - statSync(candidate).mtimeMs < STALE_TEMPORARY_CHECKOUT_AGE_MS) continue;
      removeTemporaryCheckout(candidate);
    } catch {
      // A stale checkout that remains locked must not block a fresh, uniquely named clone.
    }
  }
}

async function removeStaleTemporaryCheckoutsAsync(localPath: string, ref: string): Promise<void> {
  const parent = dirname(localPath);
  const prefix = temporaryCheckoutPrefix(ref);
  const entries = await readdirAsync(parent, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const candidate = join(parent, entry.name);
    try {
      if (Date.now() - (await statAsync(candidate)).mtimeMs < STALE_TEMPORARY_CHECKOUT_AGE_MS) continue;
      await removeTemporaryCheckoutAsync(candidate);
    } catch {
      // A stale checkout that remains locked must not block a fresh, uniquely named clone.
    }
  }
}

function gitCloneArgs(repositoryUrl: string, destinationPath: string): string[] {
  return [
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'core.hooksPath=/dev/null',
    'clone',
    '--depth',
    '1',
    '--filter=blob:none',
    '--',
    repositoryUrl,
    destinationPath
  ];
}

function gitPlatformArgs(args: string[]): string[] {
  return process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : args;
}

function publishTemporaryCheckout(tempPath: string, localPath: string): boolean {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tempPath, localPath);
      return true;
    } catch (error) {
      if (existsSync(join(localPath, '.git'))) return false;
      if (!retryableRepositoryFsError(error) || attempt >= CHECKOUT_PUBLISH_RETRIES) throw error;
      waitSynchronously(CHECKOUT_PUBLISH_RETRY_DELAY_MS);
    }
  }
}

async function publishTemporaryCheckoutAsync(tempPath: string, localPath: string): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameAsync(tempPath, localPath);
      return true;
    } catch (error) {
      if (existsSync(join(localPath, '.git'))) return false;
      if (!retryableRepositoryFsError(error) || attempt >= CHECKOUT_PUBLISH_RETRIES) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, CHECKOUT_PUBLISH_RETRY_DELAY_MS));
    }
  }
}

function removeTemporaryCheckout(path: string): Error | null {
  try {
    rmSync(path, {
      recursive: true,
      force: true,
      maxRetries: TEMPORARY_CHECKOUT_REMOVE_RETRIES,
      retryDelay: TEMPORARY_CHECKOUT_REMOVE_RETRY_DELAY_MS
    });
    return null;
  } catch (error) {
    return asError(error);
  }
}

async function removeTemporaryCheckoutAsync(path: string): Promise<Error | null> {
  try {
    await rmAsync(path, {
      recursive: true,
      force: true,
      maxRetries: TEMPORARY_CHECKOUT_REMOVE_RETRIES,
      retryDelay: TEMPORARY_CHECKOUT_REMOVE_RETRY_DELAY_MS
    });
    return null;
  } catch (error) {
    return asError(error);
  }
}

function sourceMaterializationError(error: unknown, tempPath: string, cleanupError: Error | null): Error {
  const original = asError(error);
  if (!cleanupError) return original;
  return new Error(
    `${original.message} Temporary checkout cleanup also failed at ${tempPath}: ${cleanupError.message}`,
    { cause: original }
  );
}

function gitErrorOutput(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized.slice(-1_600);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function retryableRepositoryFsError(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const code = (value as { code?: unknown }).code;
  return code === 'EACCES' || code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EPERM';
}

function waitSynchronously(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function gitInvocation(args: string[]): { command: string; args: string[] } {
  const command = process.env.BEALE_GIT_COMMAND?.trim() || 'git';
  if (process.platform === 'win32' && /\.(?:[cm]?js)$/i.test(command)) {
    return { command: process.execPath, args: [command, ...args] };
  }
  return { command, args };
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
