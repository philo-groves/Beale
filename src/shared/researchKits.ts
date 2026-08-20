import type { ResearchProfileId } from './researchProfile';

export const RESEARCH_KIT_IDS = ['general', 'hackerone', 'apple-security-bounty', 'msrc'] as const;

export type ResearchKitId = typeof RESEARCH_KIT_IDS[number];

export interface ResearchKitDefinition {
  id: ResearchKitId;
  label: string;
  description: string;
  supportedResearchProfileIds: readonly ResearchProfileId[];
  scopeLookup?: 'hackerone';
  onboardingDefaults?: {
    workspaceName: string;
    researchSubjectName: string;
    descriptionMarkdown: string;
    rules: readonly string[];
  };
  repositoryCatalog?: {
    provider: 'github-organization';
    organization: string;
    resourceSource: string;
  };
}

const APPLE_RULES = [
  'Verify current Apple Security Bounty scope, categories, guidelines, Target Flags, and submission requirements before testing or submitting.',
  'Provide a complete and actionable report with observed behavior, expected behavior, the security or privacy mechanism bypassed, and attacker impact.',
  'Include a reliable exploit or proof of concept, plus concise numbered reproduction steps.',
  'For zero-click, one-click, or multi-exploit issues, submit the full chain as one report with everything needed to execute it and a nondestructive payload when needed.',
  'Include crash logs, sysdiagnose output, or video demonstrations when applicable.',
  'Use Target Flags when they apply to the category or reward level. For kernel or user-level privilege escalation, include a Commpage Target Flag PoC and crash log. For TCC database modification, use the `tccutil flag check` and `tccutil flag reset` workflow to confirm impact.',
  'Do not publicly disclose before Apple releases an update with a security advisory or otherwise completes investigation.',
  'Do not submit reports about third-party hardware, software, or services to Apple.',
  'Do not rely on theoretical, unvalidated, incomplete, or AI-discovered claims without reproducible validation.',
  'Do not brute force Target Flags.'
] as const;

const MSRC_RULES = [
  'Verify current Microsoft bounty scope, rules of engagement, coordinated vulnerability disclosure requirements, safe harbor, bounty guidelines, and individual program rules before testing or submitting.',
  'Submit privately through the MSRC Researcher Portal under Coordinated Vulnerability Disclosure.',
  'Provide clear reproduction steps, proof-of-concept code when safe, detailed technical analysis, affected assets, expected and observed behavior, security impact, prerequisites, and remediation-relevant details.',
  'Prioritize new, unique vulnerabilities with meaningful real-world customer security impact.',
  'Include enough detail for Microsoft to validate, triage, reproduce, and fix the issue quickly.',
  'Follow Microsoft Security Testing Rules of Engagement and the rules on the applicable individual bounty program page.',
  'Do not access, modify, exfiltrate, disclose, or share customer data.',
  'Do not disrupt Microsoft services, compromise uptime, degrade availability, or harm other customers or infrastructure.',
  'If unauthorized or sensitive data is encountered, stop immediately, notify MSRC with details, delete the data, and acknowledge this in the report.',
  'Do not publicly disclose before Microsoft has had time to remediate under CVD.'
] as const;

export const RESEARCH_KITS: readonly ResearchKitDefinition[] = [{
  id: 'general',
  label: 'General',
  description: 'Build the workspace scope, resources, and rules manually.',
  supportedResearchProfileIds: ['security-research', 'mathematics']
}, {
  id: 'hackerone',
  label: 'HackerOne',
  description: 'Import a public HackerOne program scope and normalize its resources and rules.',
  supportedResearchProfileIds: ['security-research'],
  scopeLookup: 'hackerone'
}, {
  id: 'apple-security-bounty',
  label: 'Apple Security Bounty',
  description: 'Start with Apple Security Bounty guidance and optional Apple OSS repositories.',
  supportedResearchProfileIds: ['security-research'],
  onboardingDefaults: {
    workspaceName: 'Apple Security Bounty',
    researchSubjectName: 'Apple',
    descriptionMarkdown: 'Authorized research under the Apple Security Bounty program for eligible Apple product, platform, service, and security mechanism vulnerabilities described by Apple Security Research.',
    rules: APPLE_RULES
  },
  repositoryCatalog: {
    provider: 'github-organization',
    organization: 'apple-oss-distributions',
    resourceSource: 'apple-oss'
  }
}, {
  id: 'msrc',
  label: 'MSRC',
  description: 'Start with Microsoft Security Response Center bounty guidance and rules.',
  supportedResearchProfileIds: ['security-research'],
  onboardingDefaults: {
    workspaceName: 'Microsoft Security Response Center',
    researchSubjectName: 'Microsoft',
    descriptionMarkdown: 'Authorized research under Microsoft Security Response Center bounty programs for eligible Microsoft cloud, endpoint, on-premises, developer, AI, identity, and service vulnerabilities described by MSRC.',
    rules: MSRC_RULES
  }
}] as const;

export function isResearchKitId(value: unknown): value is ResearchKitId {
  return typeof value === 'string' && RESEARCH_KIT_IDS.includes(value as ResearchKitId);
}

export function researchKitDefinition(id: ResearchKitId): ResearchKitDefinition {
  return RESEARCH_KITS.find((kit) => kit.id === id) ?? RESEARCH_KITS[0];
}

export function researchKitLabel(id: ResearchKitId): string {
  return researchKitDefinition(id).label;
}

export function researchKitsForProfile(profileId: ResearchProfileId): readonly ResearchKitDefinition[] {
  return RESEARCH_KITS.filter((kit) => kit.supportedResearchProfileIds.includes(profileId));
}

export function researchKitSupportsProfile(id: ResearchKitId, profileId: ResearchProfileId): boolean {
  return researchKitDefinition(id).supportedResearchProfileIds.includes(profileId);
}
