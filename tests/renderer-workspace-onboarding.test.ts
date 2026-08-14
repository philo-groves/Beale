import { describe, expect, it } from 'vitest';
import type { WorkspaceOnboardingDefaults } from '@shared/types';
import {
  addRepositoryToOnboardingForm,
  applyGitHubRepositoryCatalog,
  applyWorkspaceTemplate,
  onboardingFormFromDefaults,
  onboardingFormFromHackerOneLookup,
  onboardingInputFromForm,
  onboardingRepositories,
  setOnboardingRepositorySelected,
  workspaceOnboardingFormForProfile
} from '../src/renderer/view-models/workspaceOnboarding';

describe('renderer workspace onboarding view model', () => {
  it('converts host defaults into an editable onboarding form', () => {
    const form = onboardingFormFromDefaults(defaults());

    expect(form.templateKind).toBe('manual');
    expect(form.workspacePath).toBe('/bounty/example');
    expect(form.researchProfileId).toBe('security-research');
    expect(form.expiresAt).toBe('2026-05-30');
  });

  it('treats an empty authorization expiry as never when submitting', () => {
    const input = onboardingInputFromForm({
      ...onboardingFormFromDefaults(defaults()),
      expiresAt: ''
    });

    expect(input.expiresAt).toBeNull();
    expect(input.researchProfileId).toBe('security-research');
    expect(input.scopeOwner).toBe('Example');
  });

  it('keeps repository additions as references when submitting', () => {
    const withRepository = addRepositoryToOnboardingForm(onboardingFormFromDefaults(defaults()), 'github.com/example/project.git');

    expect(onboardingRepositories(withRepository)).toMatchObject([
      {
        url: 'https://github.com/example/project'
      }
    ]);
    expect(onboardingInputFromForm(withRepository).assets?.[0]?.attributes).toMatchObject({
      source: 'manual',
      repositoryUrl: 'https://github.com/example/project'
    });
    expect(onboardingInputFromForm(withRepository).assets?.[0]?.attributes).not.toHaveProperty('bealeOnboardingIndexNow');
  });

  it('applies global Apple and MSRC template defaults', () => {
    const base = onboardingFormFromDefaults(defaults());
    const apple = applyWorkspaceTemplate(base, 'apple');
    const msrc = applyWorkspaceTemplate(base, 'msrc');

    expect(apple.workspaceName).toBe('Apple Security Bounty');
    expect(apple.rulesMarkdown).toContain('Target Flags');
    expect(msrc.workspaceName).toBe('Microsoft Security Response Center');
    expect(msrc.rulesMarkdown).toContain('Researcher Portal');
  });

  it('keeps Apple OSS repositories unchecked until explicitly selected', () => {
    const apple = applyGitHubRepositoryCatalog(
      applyWorkspaceTemplate(onboardingFormFromDefaults(defaults()), 'apple'),
      [
        { name: 'Security', url: 'https://github.com/apple-oss-distributions/Security', archived: false },
        { name: 'xnu', url: 'https://github.com/apple-oss-distributions/xnu', archived: false }
      ]
    );

    expect(onboardingRepositories(apple)).toMatchObject([
      { label: 'Security', selected: false, candidateIndex: 0 },
      { label: 'xnu', selected: false, candidateIndex: 1 }
    ]);
    expect(onboardingInputFromForm(apple).assets).toEqual([]);

    const selected = setOnboardingRepositorySelected(apple, 1, true);
    expect(onboardingInputFromForm(selected).assets).toMatchObject([
      {
        direction: 'in_scope',
        kind: 'repo',
        value: 'https://github.com/apple-oss-distributions/xnu',
        attributes: { source: 'apple-oss', repositoryUrl: 'https://github.com/apple-oss-distributions/xnu' }
      }
    ]);
  });

  it('forces mathematics workspaces back to the manual template', () => {
    const apple = applyWorkspaceTemplate(onboardingFormFromDefaults(defaults()), 'apple');

    expect(workspaceOnboardingFormForProfile(apple, 'mathematics').templateKind).toBe('manual');
    expect(workspaceOnboardingFormForProfile(apple, 'security-research')).toBe(apple);
  });

  it('applies a HackerOne lookup without changing the workspace directory', () => {
    const form = onboardingFormFromHackerOneLookup(onboardingFormFromDefaults(defaults()), {
      handle: 'example',
      sourceUrl: 'https://hackerone.com/example',
      workspaceName: 'Example Bounty',
      scopeOwner: 'Example Inc.',
      descriptionMarkdown: 'Authorized research under Example.',
      rulesMarkdown: 'Verify current HackerOne scope.',
      expiresAt: null,
      assets: [
        {
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://github.com/example/project',
          sensitivity: 'normal',
          attributes: { source: 'hackerone', hackerOneHandle: 'example', hackerOneSourceUrl: 'https://hackerone.com/example' }
        }
      ],
      importedScopeCount: 1
    });

    expect(form.templateKind).toBe('hackerone');
    expect(form.workspacePath).toBe('/bounty/example');
    expect(form.workspaceName).toBe('Example Bounty');
    expect(form.expiresAt).toBe('');
    expect(form.assets).toHaveLength(1);
    expect(form.assets[0]?.attributes).toMatchObject({ hackerOneHandle: 'example', hackerOneSourceUrl: 'https://hackerone.com/example' });
    expect(onboardingRepositories(form)).toMatchObject([{ url: 'https://github.com/example/project' }]);
    expect(onboardingInputFromForm(form).assets?.[0]?.attributes).not.toHaveProperty('bealeOnboardingIndexNow');
  });
});

function defaults(): WorkspaceOnboardingDefaults {
  return {
    workspacePath: '/bounty/example',
    workspaceName: 'Example',
    scopeOwner: '',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    expiresAt: '2026-05-30T00:00:00.000Z',
    assets: []
  };
}
