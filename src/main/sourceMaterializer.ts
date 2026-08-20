import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ScopeAsset, WorkspaceScopeVersion } from '@shared/types';
import {
  inspectHoneycrispSources,
  materializeHoneycrispSource,
  materializeHoneycrispSourceSync
} from './honeycrispCliClient';

export interface SourceRepositoryCandidate {
  url: string;
  label: string;
  sourceAssetId: string;
  sourceAssetKind: ScopeAsset['kind'];
  sensitivity: string;
  clonedDirectory: string | null;
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

export function defaultSourceRepositoryStoreDirectory(registryDirectory?: string): string {
  const explicit = process.env.HONEYCRISP_REPOSITORY_STORE_DIR?.trim() || process.env.BEALE_REPOSITORY_STORE_DIR?.trim();
  return resolve(explicit || join(registryDirectory ?? join(homedir(), '.honeycrisp'), 'repositories'));
}

export function sourceRepositoryCandidates(scope: WorkspaceScopeVersion): SourceRepositoryCandidate[] {
  return (inspectHoneycrispSources({ scope }).candidates ?? []) as SourceRepositoryCandidate[];
}

export function selectSourceRepository(scope: WorkspaceScopeVersion, requested: string): SourceRepositorySelection {
  const selection = inspectHoneycrispSources({ scope, requested }).selection;
  if (!selection) throw new Error('Honeycrisp did not return a source selection.');
  return selection as SourceRepositorySelection;
}

export function extractSourceRepositoryUrls(text: string): string[] {
  return inspectHoneycrispSources({ text }).urls ?? [];
}

export function normalizeSourceRepositoryUrl(value: string): string | null {
  return inspectHoneycrispSources({ value }).normalizedUrl ?? null;
}

export const normalizeGitHubRepositoryUrl = normalizeSourceRepositoryUrl;

export function materializeGitRepository(
  candidate: SourceRepositoryCandidate,
  ref: string,
  options: { repositoryStoreDirectory?: string } = {}
): MaterializedSourceRepository {
  return materializeHoneycrispSourceSync(candidate, ref, options.repositoryStoreDirectory);
}

export async function materializeGitRepositoryAsync(
  candidate: SourceRepositoryCandidate,
  ref: string,
  options: { signal?: AbortSignal; repositoryStoreDirectory?: string } = {}
): Promise<MaterializedSourceRepository> {
  return materializeHoneycrispSource(candidate, ref, options.repositoryStoreDirectory, options.signal);
}
