import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
}

const GIT_TIMEOUT_MS = 180_000;
const GITHUB_REPOSITORY_RE = /\b(?:https?:\/\/)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?(?:[/?#][^\s<>)\]]*)?/gi;

export function sourceRepositoryCandidates(scope: ProgramScopeVersion): SourceRepositoryCandidate[] {
  const candidates = new Map<string, SourceRepositoryCandidate>();
  for (const asset of scope.assets) {
    if (asset.direction !== 'in_scope') continue;
    const text = [asset.value, stringAttribute(asset.attributes?.instruction), stringAttribute(asset.attributes?.repositoryUrl)].filter(Boolean).join('\n');
    for (const url of extractGitHubRepositoryUrls(text)) {
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
  const requestedUrl = normalizeGitHubRepositoryUrl(requested);
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

  if (existsSync(join(localPath, '.git'))) {
    return {
      repositoryUrl: candidate.url,
      localPath,
      cloned: false,
      ref: cleanRef || null,
      head: gitHead(localPath)
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
      runGit(['-c', 'protocol.ext.allow=never', '-c', 'core.hooksPath=/dev/null', '-C', tempPath, 'checkout', '--detach', cleanRef]);
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
    head: gitHead(localPath)
  };
}

export function extractGitHubRepositoryUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(GITHUB_REPOSITORY_RE)) {
    const normalized = normalizeGitHubRepositoryUrl(match[0]);
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

export function normalizeGitHubRepositoryUrl(value: string): string | null {
  const trimmed = value.trim().replace(/[),.;]+$/, '');
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return null;
  const [owner, rawRepo] = parsed.pathname.split('/').filter(Boolean);
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!safeGitHubPathSegment(owner) || !safeGitHubPathSegment(repo)) return null;
  return `https://github.com/${owner}/${repo}`;
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
  return left.toLowerCase().replace(/\.git$/i, '') === right.toLowerCase().replace(/\.git$/i, '');
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

function safeGitHubPathSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

function stringAttribute(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
