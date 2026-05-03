import type {
  HackerOneProgramLookupResult,
  ProgramOnboardingDefaults,
  ProgramOnboardingInput,
  ScopeAssetInput
} from '@shared/types';

export interface ProgramOnboardingFormState {
  templateKind: ProgramTemplateKind;
  workspacePath: string;
  programName: string;
  organizationName: string;
  descriptionMarkdown: string;
  rulesMarkdown: string;
  networkProfile: string;
  expiresAt: string;
  assets: ScopeAssetInput[];
}

export type ProgramTemplateKind = 'manual' | 'hackerone' | 'apple' | 'msrc';

export interface OnboardingRepository {
  assetIndex: number;
  url: string;
  label: string;
  source: string;
  indexNow: boolean;
}

export const ONBOARDING_INDEX_NOW_ATTRIBUTE = 'bealeOnboardingIndexNow';

const SOURCE_REPOSITORY_RE = /\b(?:https?:\/\/)?(?:github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.git)?(?:[/?#][^\s<>)\]]*)?/gi;

const APPLE_PROGRAM_DESCRIPTION =
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
  '## Evidence and reporting requirements',
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

const MSRC_PROGRAM_DESCRIPTION =
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
  '## Evidence and reporting requirements',
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

export function onboardingFormFromDefaults(defaults: ProgramOnboardingDefaults): ProgramOnboardingFormState {
  return {
    templateKind: 'manual',
    workspacePath: defaults.workspacePath,
    programName: defaults.programName,
    organizationName: defaults.organizationName,
    descriptionMarkdown: defaults.descriptionMarkdown,
    rulesMarkdown: defaults.rulesMarkdown,
    networkProfile: defaults.networkProfile,
    expiresAt: defaults.expiresAt ? defaults.expiresAt.slice(0, 10) : '',
    assets: defaults.assets
  };
}

export function onboardingInputFromForm(form: ProgramOnboardingFormState): ProgramOnboardingInput {
  return {
    workspacePath: form.workspacePath,
    programName: form.programName,
    organizationName: form.organizationName,
    descriptionMarkdown: form.descriptionMarkdown,
    rulesMarkdown: form.rulesMarkdown,
    networkProfile: form.networkProfile,
    expiresAt: optionalDateOrNever(form.expiresAt),
    assets: form.assets.map((asset) => {
      const isRepository = asset.direction === 'in_scope' && extractOnboardingRepositoryUrls([asset.value, stringAttribute(asset.attributes?.repositoryUrl), stringAttribute(asset.attributes?.instruction)].join('\n')).length > 0;
      if (!isRepository || asset.attributes?.[ONBOARDING_INDEX_NOW_ATTRIBUTE] !== undefined) return asset;
      return {
        ...asset,
        attributes: {
          ...(asset.attributes ?? {}),
          [ONBOARDING_INDEX_NOW_ATTRIBUTE]: true
        }
      };
    })
  };
}

export function onboardingRepositories(form: ProgramOnboardingFormState): OnboardingRepository[] {
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
        url,
        label: stringAttribute(asset.attributes?.displayName) || asset.value || repositoryName(url),
        source: stringAttribute(asset.attributes?.source) || 'manual',
        indexNow: asset.attributes?.[ONBOARDING_INDEX_NOW_ATTRIBUTE] !== false
      });
    }
  });
  return repositories;
}

export function hasIndexNowRepository(form: ProgramOnboardingFormState): boolean {
  return onboardingRepositories(form).some((repository) => repository.indexNow);
}

export function setRepositoryIndexNow(form: ProgramOnboardingFormState, assetIndex: number, indexNow: boolean): ProgramOnboardingFormState {
  return updateAssetAttributes(form, assetIndex, { [ONBOARDING_INDEX_NOW_ATTRIBUTE]: indexNow });
}

export function addRepositoryToOnboardingForm(form: ProgramOnboardingFormState, repositoryUrl: string): ProgramOnboardingFormState {
  const normalizedUrl = normalizeOnboardingRepositoryUrl(repositoryUrl);
  if (!normalizedUrl) {
    throw new Error('Enter a GitHub or GitLab repository URL.');
  }
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
          repositoryUrl: normalizedUrl,
          [ONBOARDING_INDEX_NOW_ATTRIBUTE]: true
        }
      }
    ]
  };
}

export function removeRepositoryFromOnboardingForm(form: ProgramOnboardingFormState, assetIndex: number): ProgramOnboardingFormState {
  return {
    ...form,
    assets: form.assets.filter((_asset, index) => index !== assetIndex)
  };
}

export function onboardingFormFromHackerOneLookup(
  form: ProgramOnboardingFormState,
  lookup: HackerOneProgramLookupResult
): ProgramOnboardingFormState {
  return {
    ...form,
    templateKind: 'hackerone',
    programName: lookup.programName,
    organizationName: lookup.organizationName,
    descriptionMarkdown: lookup.descriptionMarkdown,
    rulesMarkdown: lookup.rulesMarkdown,
    networkProfile: lookup.networkProfile,
    expiresAt: lookup.expiresAt ? lookup.expiresAt.slice(0, 10) : '',
    assets: lookup.assets
  };
}

export function templateLabel(templateKind: ProgramTemplateKind): string {
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

export function applyProgramTemplate(form: ProgramOnboardingFormState, templateKind: ProgramTemplateKind): ProgramOnboardingFormState {
  if (templateKind === 'manual' || templateKind === 'hackerone') {
    return { ...form, templateKind };
  }
  if (templateKind === 'apple') {
    return {
      ...form,
      templateKind,
      programName: 'Apple Security Bounty',
      organizationName: 'Apple',
      descriptionMarkdown: APPLE_PROGRAM_DESCRIPTION,
      rulesMarkdown: APPLE_SCOPE_AND_RULES,
      networkProfile: 'elevated',
      expiresAt: '',
      assets: []
    };
  }
  return {
    ...form,
    templateKind,
    programName: 'Microsoft Security Response Center',
    organizationName: 'Microsoft',
    descriptionMarkdown: MSRC_PROGRAM_DESCRIPTION,
    rulesMarkdown: MSRC_SCOPE_AND_RULES,
    networkProfile: 'elevated',
    expiresAt: '',
    assets: []
  };
}

function updateAssetAttributes(form: ProgramOnboardingFormState, assetIndex: number, attributes: Record<string, unknown>): ProgramOnboardingFormState {
  return {
    ...form,
    assets: form.assets.map((asset, index) =>
      index === assetIndex
        ? {
            ...asset,
            attributes: {
              ...(asset.attributes ?? {}),
              ...attributes
            }
          }
        : asset
    )
  };
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

function optionalDateOrNever(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
