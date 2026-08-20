import type {
  GitHubRepositorySummary,
  HackerOneScopeLookupResult,
  ResearchKitId,
  ResearchProfileId,
  WorkspaceOnboardingDefaults,
  WorkspaceOnboardingInput,
  ScopeAssetInput
} from '@shared/types';
import { researchKitDefinition, researchKitSupportsProfile } from '../../shared/researchKits';

export interface WorkspaceOnboardingFormState {
  researchKitId: ResearchKitId;
  workspacePath: string;
  workspaceDirectories: string[];
  researchProfileId: ResearchProfileId;
  workspaceName: string;
  researchSubjectName: string;
  descriptionMarkdown: string;
  rules: string[];
  assets: ScopeAssetInput[];
  repositoryCandidates: OnboardingRepositoryCandidate[];
  repositoryCatalogLoading: boolean;
  repositoryCatalogError: string | null;
}

export function workspaceOnboardingFormForProfile(
  form: WorkspaceOnboardingFormState,
  profileId: ResearchProfileId
): WorkspaceOnboardingFormState {
  return !researchKitSupportsProfile(form.researchKitId, profileId)
    ? {
        ...form,
        researchKitId: 'general',
        repositoryCandidates: [],
        repositoryCatalogLoading: false,
        repositoryCatalogError: null
      }
    : form;
}

export interface OnboardingRepository {
  assetIndex: number | null;
  candidateIndex: number | null;
  url: string;
  label: string;
  source: string;
  selected: boolean;
  archived: boolean;
}

export interface OnboardingRepositoryCandidate {
  url: string;
  label: string;
  source: string;
  selected: boolean;
  archived: boolean;
}

const SOURCE_REPOSITORY_RE = /\b(?:https?:\/\/)?(?:github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.git)?(?:[/?#][^\s<>)\]]*)?/gi;

export function onboardingFormFromDefaults(defaults: WorkspaceOnboardingDefaults): WorkspaceOnboardingFormState {
  const workspaceDirectories = uniqueWorkspaceDirectories(defaults.workspaceDirectories ?? [defaults.workspacePath]);
  return {
    researchKitId: 'general',
    researchProfileId: 'security-research',
    workspacePath: workspaceDirectories[0] ?? '',
    workspaceDirectories,
    workspaceName: defaults.workspaceName,
    researchSubjectName: defaults.researchSubjectName ?? (defaults.scopeOwner || defaults.workspaceName),
    descriptionMarkdown: defaults.descriptionMarkdown,
    rules: [...defaults.rules],
    assets: defaults.assets,
    repositoryCandidates: [],
    repositoryCatalogLoading: false,
    repositoryCatalogError: null
  };
}

export function onboardingInputFromForm(form: WorkspaceOnboardingFormState): WorkspaceOnboardingInput {
  return {
    workspacePath: form.workspacePath,
    workspaceDirectories: [...form.workspaceDirectories],
    workspaceName: form.workspaceName,
    researchProfileId: form.researchProfileId,
    researchKitId: form.researchKitId,
    researchSubjectName: form.researchSubjectName,
    scopeOwner: form.researchSubjectName.trim() || form.workspaceName.trim(),
    descriptionMarkdown: form.descriptionMarkdown,
    rules: [...form.rules],
    expiresAt: null,
    assets: selectedOnboardingAssets(form)
  };
}

export function emptyWorkspaceOnboardingForm(): WorkspaceOnboardingFormState {
  return onboardingFormFromDefaults({
    workspacePath: '',
    workspaceDirectories: [],
    workspaceName: '',
    scopeOwner: '',
    descriptionMarkdown: '',
    rules: [],
    expiresAt: null,
    assets: []
  });
}

export function addDirectoryToOnboardingForm(
  form: WorkspaceOnboardingFormState,
  path: string,
  defaults: WorkspaceOnboardingDefaults | null = null
): WorkspaceOnboardingFormState {
  const workspaceDirectories = uniqueWorkspaceDirectories([...form.workspaceDirectories, path]);
  const firstDirectory = form.workspaceDirectories.length === 0;
  return {
    ...form,
    workspacePath: workspaceDirectories[0] ?? '',
    workspaceDirectories,
    workspaceName: firstDirectory && !form.workspaceName.trim() ? defaults?.workspaceName ?? form.workspaceName : form.workspaceName,
    researchSubjectName: firstDirectory && !form.researchSubjectName.trim()
      ? defaults?.researchSubjectName ?? defaults?.scopeOwner ?? defaults?.workspaceName ?? form.researchSubjectName
      : form.researchSubjectName,
    descriptionMarkdown: firstDirectory && !form.descriptionMarkdown.trim()
      ? defaults?.descriptionMarkdown ?? form.descriptionMarkdown
      : form.descriptionMarkdown,
    rules: firstDirectory && form.rules.length === 0 ? [...(defaults?.rules ?? form.rules)] : form.rules
  };
}

export function removeDirectoryFromOnboardingForm(form: WorkspaceOnboardingFormState, path: string): WorkspaceOnboardingFormState {
  if (form.workspaceDirectories.length <= 1) return form;
  const key = workspaceDirectoryKey(path);
  const workspaceDirectories = form.workspaceDirectories.filter((directory) => workspaceDirectoryKey(directory) !== key);
  return { ...form, workspacePath: workspaceDirectories[0] ?? '', workspaceDirectories };
}

function uniqueWorkspaceDirectories(directories: readonly string[]): string[] {
  const seen = new Set<string>();
  return directories.filter((directory) => {
    if (!directory.trim()) return false;
    const key = workspaceDirectoryKey(directory);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workspaceDirectoryKey(directory: string): string {
  return directory.replace(/[\\/]+$/u, '').toLowerCase();
}

export function onboardingRepositories(form: WorkspaceOnboardingFormState): OnboardingRepository[] {
  const repositories: OnboardingRepository[] = [];
  const seenUrls = new Set<string>();
  form.assets.forEach((asset, assetIndex) => {
    if (asset.direction !== 'in_scope') return;
    const urls = extractOnboardingRepositoryUrls([asset.value, stringAttribute(asset.attributes?.repositoryUrl), stringAttribute(asset.attributes?.instruction)].join('\n'));
    for (const url of urls) {
      const key = url.toLowerCase();
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      repositories.push({
        assetIndex,
        candidateIndex: null,
        url,
        label: stringAttribute(asset.attributes?.displayName) || asset.value || repositoryName(url),
        source: stringAttribute(asset.attributes?.source) || 'manual',
        selected: true,
        archived: asset.attributes?.archived === true
      });
    }
  });
  form.repositoryCandidates.forEach((candidate, candidateIndex) => {
    const key = candidate.url.toLowerCase();
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    repositories.push({
      assetIndex: null,
      candidateIndex,
      ...candidate
    });
  });
  return repositories;
}

export function addRepositoryToOnboardingForm(form: WorkspaceOnboardingFormState, repositoryUrl: string): WorkspaceOnboardingFormState {
  const normalizedUrl = normalizeOnboardingRepositoryUrl(repositoryUrl);
  if (!normalizedUrl) {
    throw new Error('Enter a GitHub or GitLab repository URL.');
  }
  const existingCandidateIndex = form.repositoryCandidates.findIndex((candidate) => candidate.url.toLowerCase() === normalizedUrl.toLowerCase());
  if (existingCandidateIndex >= 0) return setOnboardingRepositorySelected(form, existingCandidateIndex, true);
  const existing = onboardingRepositories(form).some((repository) => repository.url.toLowerCase() === normalizedUrl.toLowerCase());
  if (existing) return form;
  return {
    ...form,
    assets: [
      ...form.assets,
      {
        direction: 'in_scope',
        kind: 'repo',
        value: normalizedUrl,
        sensitivity: 'public',
        attributes: {
          source: 'manual',
          repositoryUrl: normalizedUrl
        }
      }
    ]
  };
}

export function removeRepositoryFromOnboardingForm(form: WorkspaceOnboardingFormState, assetIndex: number): WorkspaceOnboardingFormState {
  return {
    ...form,
    assets: form.assets.filter((_asset, index) => index !== assetIndex)
  };
}

export function setOnboardingRepositorySelected(
  form: WorkspaceOnboardingFormState,
  candidateIndex: number,
  selected: boolean
): WorkspaceOnboardingFormState {
  return {
    ...form,
    repositoryCandidates: form.repositoryCandidates.map((candidate, index) => (
      index === candidateIndex ? { ...candidate, selected } : candidate
    ))
  };
}

export function applyGitHubRepositoryCatalog(
  form: WorkspaceOnboardingFormState,
  repositories: GitHubRepositorySummary[]
): WorkspaceOnboardingFormState {
  const source = researchKitDefinition(form.researchKitId).repositoryCatalog?.resourceSource ?? 'manual';
  return {
    ...form,
    repositoryCandidates: repositories.map((repository) => ({
      url: repository.url,
      label: repository.name,
      source,
      selected: false,
      archived: repository.archived
    })),
    repositoryCatalogLoading: false,
    repositoryCatalogError: null
  };
}

export function onboardingFormFromHackerOneLookup(
  form: WorkspaceOnboardingFormState,
  lookup: HackerOneScopeLookupResult
): WorkspaceOnboardingFormState {
  return {
    ...form,
    researchKitId: 'hackerone',
    workspaceName: lookup.workspaceName,
    researchSubjectName: lookup.researchSubjectName ?? lookup.workspaceName,
    descriptionMarkdown: lookup.descriptionMarkdown,
    rules: [...lookup.rules],
    assets: lookup.assets,
    repositoryCandidates: [],
    repositoryCatalogLoading: false,
    repositoryCatalogError: null
  };
}

export function applyResearchKit(form: WorkspaceOnboardingFormState, researchKitId: ResearchKitId): WorkspaceOnboardingFormState {
  const kit = researchKitDefinition(researchKitId);
  if (!researchKitSupportsProfile(researchKitId, form.researchProfileId)) return form;
  if (!kit.onboardingDefaults) {
    return {
      ...form,
      researchKitId,
      repositoryCandidates: [],
      repositoryCatalogLoading: false,
      repositoryCatalogError: null
    };
  }
  return {
    ...form,
    researchKitId,
    workspaceName: kit.onboardingDefaults.workspaceName,
    researchSubjectName: kit.onboardingDefaults.researchSubjectName,
    descriptionMarkdown: kit.onboardingDefaults.descriptionMarkdown,
    rules: [...kit.onboardingDefaults.rules],
    assets: [],
    repositoryCandidates: [],
    repositoryCatalogLoading: Boolean(kit.repositoryCatalog),
    repositoryCatalogError: null
  };
}

function selectedOnboardingAssets(form: WorkspaceOnboardingFormState): ScopeAssetInput[] {
  const assets = [...form.assets];
  const existingUrls = new Set(onboardingRepositories({ ...form, repositoryCandidates: [] }).map((repository) => repository.url.toLowerCase()));
  for (const candidate of form.repositoryCandidates) {
    if (!candidate.selected || existingUrls.has(candidate.url.toLowerCase())) continue;
    existingUrls.add(candidate.url.toLowerCase());
    assets.push({
      direction: 'in_scope',
      kind: 'repo',
      value: candidate.url,
      sensitivity: 'public',
      attributes: {
        source: candidate.source,
        researchKitId: form.researchKitId,
        researchKitSourceUrl: researchKitDefinition(form.researchKitId).repositoryCatalog
          ? `https://github.com/${researchKitDefinition(form.researchKitId).repositoryCatalog?.organization}`
          : undefined,
        repositoryUrl: candidate.url,
        displayName: candidate.label,
        archived: candidate.archived
      }
    });
  }
  return assets;
}

function extractOnboardingRepositoryUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(SOURCE_REPOSITORY_RE)) {
    const normalized = normalizeOnboardingRepositoryUrl(match[0]);
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

function normalizeOnboardingRepositoryUrl(value: string): string | null {
  const trimmed = value.trim().replace(/[),.;]+$/, '');
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || (host !== 'github.com' && host !== 'gitlab.com')) return null;
  const pathSegments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .slice(0, host === 'github.com' ? 2 : undefined);
  if (pathSegments.length < 2) return null;
  pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/\.git$/i, '');
  if (pathSegments.some((segment) => !/^[A-Za-z0-9_.-]+$/.test(segment))) return null;
  return `https://${host}/${pathSegments.join('/')}`;
}

function repositoryName(url: string): string {
  return url.split('/').filter(Boolean).at(-1) ?? url;
}

function stringAttribute(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
