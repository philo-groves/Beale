import type {
  GitHubRepositorySummary,
  HackerOneScopeLookupResult,
  ResearchProfileId,
  WorkspaceOnboardingDefaults,
  WorkspaceOnboardingInput,
  ScopeAssetInput
} from '@shared/types';

export interface WorkspaceOnboardingFormState {
  templateKind: WorkspaceTemplateKind;
  workspacePath: string;
  researchProfileId: ResearchProfileId;
  workspaceName: string;
  researchSubjectName: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  assets: ScopeAssetInput[];
  repositoryCandidates: OnboardingRepositoryCandidate[];
  repositoryCatalogLoading: boolean;
  repositoryCatalogError: string | null;
}

export type WorkspaceTemplateKind = 'manual' | 'hackerone' | 'apple' | 'msrc';

export function workspaceOnboardingFormForProfile(
  form: WorkspaceOnboardingFormState,
  profileId: ResearchProfileId
): WorkspaceOnboardingFormState {
  return profileId === 'mathematics' && form.templateKind !== 'manual'
    ? {
        ...form,
        templateKind: 'manual',
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

const APPLE_SCOPE_DESCRIPTION =
  'Authorized research under the Apple Security Bounty program for eligible Apple product, platform, service, and security mechanism vulnerabilities described by Apple Security Research.';

const APPLE_SCOPE_AND_RULES = [
  '## Source of truth',
  'Verify current Apple Security Bounty scope, categories, guidelines, Target Flags, and submission requirements before testing or submitting.',
  '',
  '- Categories: https://security.apple.com/bounty/categories/',
  '- Guidelines: https://security.apple.com/bounty/guidelines/',
  '- Target Flags: https://security.apple.com/bounty/target-flags/',
  '',
  '## Authorized scope',
  '- Product research must affect the latest publicly available version, including beta versions, of iOS, iPadOS, macOS, tvOS, visionOS, or watchOS with standard configuration on publicly available Apple hardware or a Security Research Device.',
  '- Services research must relate to a web server or service owned by Apple or an Apple subsidiary.',
  '- Bounty categories include product exploit chains, Apple-designed radio proximity attacks, unauthorized physical device access, app and browser sandbox issues, macOS-only issues, Private Cloud Compute, and eligible Apple services issues such as iCloud data access, remote code execution, unrestricted file system or database access, logic flaws bypassing security controls, client/server code execution, sensitive data exposure, and domain or subdomain takeover.',
  '',
  '## Verification and reporting requirements',
  '- Provide a complete and actionable report with observed behavior, expected behavior, the security or privacy mechanism bypassed, and attacker impact.',
  '- Include a reliable exploit or proof of concept, plus concise numbered reproduction steps.',
  '- For zero-click, one-click, or multi-exploit issues, submit the full chain as one report with everything needed to execute it and a nondestructive payload when needed.',
  '- Include crash logs, sysdiagnose output, or video demonstrations when applicable.',
  '- Use Target Flags when they apply to the category or reward level. For kernel or user-level privilege escalation, include a Commpage Target Flag PoC and crash log. For TCC database modification, use the `tccutil flag check` and `tccutil flag reset` workflow to confirm impact.',
  '',
  '## Boundaries',
  '- Do not publicly disclose before Apple releases an update with a security advisory or otherwise completes investigation.',
  '- Do not submit reports about third-party hardware, software, or services to Apple.',
  '- Do not rely on theoretical, unvalidated, incomplete, or AI-discovered claims without reproducible validation.',
  '- Do not brute force Target Flags.'
].join('\n');

const MSRC_SCOPE_DESCRIPTION =
  'Authorized research under Microsoft Security Response Center bounty programs for eligible Microsoft cloud, endpoint, on-premises, developer, AI, identity, and service vulnerabilities described by MSRC.';

const MSRC_SCOPE_AND_RULES = [
  '## Source of truth',
  'Verify current Microsoft bounty scope, rules of engagement, coordinated vulnerability disclosure requirements, safe harbor, bounty guidelines, and individual program rules before testing or submitting.',
  '',
  '- Bounty overview: https://www.microsoft.com/en-us/msrc/bounty',
  '- Cloud programs: https://www.microsoft.com/en-us/msrc/bounty-programs#cloud',
  '- Endpoint and on-prem programs: https://www.microsoft.com/en-us/msrc/bounty-programs#endpoints',
  '- Researcher Portal: https://msrc.microsoft.com/report/vulnerability',
  '',
  '## Authorized scope',
  '- Cloud bounty programs include Microsoft Identity, Microsoft Azure, Microsoft Copilot, Xbox Live network and services, Azure DevOps Services, Dynamics 365 and Power Platform, Microsoft Defender for Endpoint APIs, Microsoft 365 including Office 365, .NET Core and ASP.NET Core, and selected Microsoft-owned open-source repositories.',
  '- Endpoint and on-prem bounty programs include Microsoft Hyper-V, Windows Insider Preview, Microsoft Applications and On-Premises Servers, Microsoft Edge Chromium channels, and Microsoft 365 Insider.',
  '- Zero Day Quest focuses on high-impact vulnerabilities in Azure, Copilot, Dynamics 365 and Power Platform, Microsoft Identity, and Microsoft 365 bounty programs, subject to the applicable bounty program and event terms.',
  '- Always confirm the specific product, service, build, tenant, account type, and test asset are in scope on the individual bounty program page before live testing.',
  '',
  '## Verification and reporting requirements',
  '- Submit privately through the MSRC Researcher Portal under Coordinated Vulnerability Disclosure.',
  '- Provide clear reproduction steps, proof-of-concept code when safe, detailed technical analysis, affected assets, expected and observed behavior, security impact, prerequisites, and remediation-relevant details.',
  '- Prioritize new, unique vulnerabilities with meaningful real-world customer security impact.',
  '- Include enough detail for Microsoft to validate, triage, reproduce, and fix the issue quickly.',
  '',
  '## Boundaries',
  '- Follow Microsoft Security Testing Rules of Engagement and the rules on the applicable individual bounty program page.',
  '- Do not access, modify, exfiltrate, disclose, or share customer data.',
  '- Do not disrupt Microsoft services, compromise uptime, degrade availability, or harm other customers or infrastructure.',
  '- If unauthorized or sensitive data is encountered, stop immediately, notify MSRC with details, delete the data, and acknowledge this in the report.',
  '- Do not publicly disclose before Microsoft has had time to remediate under CVD.'
].join('\n');

export function onboardingFormFromDefaults(defaults: WorkspaceOnboardingDefaults): WorkspaceOnboardingFormState {
  return {
    templateKind: 'manual',
    researchProfileId: 'security-research',
    workspacePath: defaults.workspacePath,
    workspaceName: defaults.workspaceName,
    researchSubjectName: defaults.researchSubjectName ?? (defaults.scopeOwner || defaults.workspaceName),
    descriptionMarkdown: defaults.descriptionMarkdown,
    rulesMarkdown: defaults.rulesMarkdown,
    assets: defaults.assets,
    repositoryCandidates: [],
    repositoryCatalogLoading: false,
    repositoryCatalogError: null
  };
}

export function onboardingInputFromForm(form: WorkspaceOnboardingFormState): WorkspaceOnboardingInput {
  return {
    workspacePath: form.workspacePath,
    workspaceName: form.workspaceName,
    researchProfileId: form.researchProfileId,
    researchSubjectName: form.researchSubjectName,
    scopeOwner: form.researchSubjectName.trim() || form.workspaceName.trim(),
    descriptionMarkdown: form.descriptionMarkdown,
    rulesMarkdown: form.rulesMarkdown,
    expiresAt: null,
    assets: selectedOnboardingAssets(form)
  };
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
  return {
    ...form,
    repositoryCandidates: repositories.map((repository) => ({
      url: repository.url,
      label: repository.name,
      source: 'apple-oss',
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
    templateKind: 'hackerone',
    workspaceName: lookup.workspaceName,
    researchSubjectName: lookup.researchSubjectName ?? lookup.workspaceName,
    descriptionMarkdown: lookup.descriptionMarkdown,
    rulesMarkdown: lookup.rulesMarkdown,
    assets: lookup.assets,
    repositoryCandidates: [],
    repositoryCatalogLoading: false,
    repositoryCatalogError: null
  };
}

export function templateLabel(templateKind: WorkspaceTemplateKind): string {
  switch (templateKind) {
    case 'manual':
      return 'Manual';
    case 'hackerone':
      return 'HackerOne';
    case 'apple':
      return 'Apple';
    case 'msrc':
      return 'MSRC';
  }
}

export function applyWorkspaceTemplate(form: WorkspaceOnboardingFormState, templateKind: WorkspaceTemplateKind): WorkspaceOnboardingFormState {
  if (templateKind === 'manual' || templateKind === 'hackerone') {
    return {
      ...form,
      templateKind,
      repositoryCandidates: [],
      repositoryCatalogLoading: false,
      repositoryCatalogError: null
    };
  }
  if (templateKind === 'apple') {
    return {
      ...form,
      templateKind,
      workspaceName: 'Apple Security Bounty',
      researchSubjectName: 'Apple',
      descriptionMarkdown: APPLE_SCOPE_DESCRIPTION,
      rulesMarkdown: APPLE_SCOPE_AND_RULES,
      assets: [],
      repositoryCandidates: [],
      repositoryCatalogLoading: true,
      repositoryCatalogError: null
    };
  }
  return {
    ...form,
    templateKind,
    workspaceName: 'Microsoft Security Response Center',
    researchSubjectName: 'Microsoft',
    descriptionMarkdown: MSRC_SCOPE_DESCRIPTION,
    rulesMarkdown: MSRC_SCOPE_AND_RULES,
    assets: [],
    repositoryCandidates: [],
    repositoryCatalogLoading: false,
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
