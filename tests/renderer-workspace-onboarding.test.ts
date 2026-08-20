import { describe, expect, it } from 'vitest';
import type { WorkspaceOnboardingDefaults } from '@shared/types';
import { researchKitDefinition, researchKitsForProfile } from '../src/shared/researchKits';
import {
  addDirectoryToOnboardingForm,
  addRepositoryToOnboardingForm,
  applyGitHubRepositoryCatalog,
  applyResearchKit,
  emptyWorkspaceOnboardingForm,
  onboardingFormFromDefaults,
  onboardingFormFromHackerOneLookup,
  onboardingInputFromForm,
  onboardingRepositories,
  removeDirectoryFromOnboardingForm,
  setOnboardingRepositorySelected,
  workspaceCreationViewError,
  workspaceCreationViews,
  workspaceOnboardingFormForProfile
} from '../src/renderer/view-models/workspaceOnboarding';

describe('renderer workspace onboarding view model', () => {
  it('defines profile-compatible Research Kits and their acquisition capabilities', () => {
    expect(researchKitsForProfile('security-research').map((kit) => kit.id)).toEqual([
      'general',
      'hackerone',
      'apple-security-bounty',
      'msrc'
    ]);
    expect(researchKitsForProfile('mathematics').map((kit) => kit.id)).toEqual(['general']);
    expect(researchKitDefinition('hackerone').scopeLookup).toBe('hackerone');
    expect(researchKitDefinition('hackerone').refresh?.imports).toEqual(['resources', 'rules', 'guidance']);
    expect(researchKitDefinition('apple-security-bounty').repositoryCatalog).toMatchObject({
      provider: 'github-organization',
      organization: 'apple-oss-distributions',
      resourceSource: 'apple-oss'
    });
    expect(researchKitDefinition('apple-security-bounty').refresh?.fixedSource).toBe('apple-oss-distributions');
    expect(researchKitDefinition('msrc').refresh?.imports).toEqual(['rules', 'guidance']);
    expect(researchKitDefinition('general').refresh).toBeUndefined();
  });

  it('converts host defaults into an editable onboarding form', () => {
    const form = onboardingFormFromDefaults(defaults());

    expect(form.researchKitId).toBe('general');
    expect(form.workspacePath).toBe('/bounty/example');
    expect(form.workspaceDirectories).toEqual(['/bounty/example']);
    expect(form.researchProfileId).toBe('security-research');
    expect(form).not.toHaveProperty('expiresAt');
  });

  it('leaves authorization expiry to workspace engineers', () => {
    const input = onboardingInputFromForm(onboardingFormFromDefaults(defaults()));

    expect(input.expiresAt).toBeNull();
    expect(input.researchProfileId).toBe('security-research');
    expect(input.researchKitId).toBe('general');
    expect(input.scopeOwner).toBe('Example');
    expect(input.workspaceDirectories).toEqual(['/bounty/example']);
  });

  it('opens without a directory and supports ordered directory additions and removals', () => {
    const empty = emptyWorkspaceOnboardingForm();
    expect(empty.workspaceDirectories).toEqual([]);
    expect(empty.workspacePath).toBe('');

    const primary = addDirectoryToOnboardingForm(empty, '/workspaces/parser', {
      ...defaults(),
      workspacePath: '/workspaces/parser',
      workspaceDirectories: ['/workspaces/parser'],
      workspaceName: 'Parser'
    });
    const multiDirectory = addDirectoryToOnboardingForm(primary, '/workspaces/protocol');
    expect(multiDirectory.workspacePath).toBe('/workspaces/parser');
    expect(multiDirectory.workspaceDirectories).toEqual(['/workspaces/parser', '/workspaces/protocol']);
    expect(multiDirectory.workspaceName).toBe('Parser');

    const promoted = removeDirectoryFromOnboardingForm(multiDirectory, '/workspaces/parser');
    expect(promoted.workspacePath).toBe('/workspaces/protocol');
    expect(promoted.workspaceDirectories).toEqual(['/workspaces/protocol']);
    expect(removeDirectoryFromOnboardingForm(promoted, '/workspaces/protocol')).toBe(promoted);
  });

  it('gates the sequential creation views with profile-appropriate requirements', () => {
    const empty = emptyWorkspaceOnboardingForm();
    expect(workspaceCreationViews(empty)).toEqual(['overview', 'resources', 'rules']);
    expect(workspaceCreationViewError(empty, 'overview')).toBe('Select at least one workspace directory.');

    const missingName = addDirectoryToOnboardingForm(empty, '/workspaces/unnamed');
    expect(workspaceCreationViewError(missingName, 'overview')).toBe('Workspace name is required.');
    expect(workspaceCreationViewError({ ...missingName, workspaceName: 'Unnamed' }, 'overview')).toBe('Research subject is required.');

    const general = onboardingFormFromDefaults(defaults());
    expect(workspaceCreationViewError(general, 'overview')).toBeNull();
    expect(workspaceCreationViewError(general, 'resources')).toBe('Add at least one in-scope resource for security research.');
    expect(workspaceCreationViewError(general, 'rules')).toBe('Add at least one workspace rule for security research.');

    const mathematics = workspaceOnboardingFormForProfile({ ...general, researchProfileId: 'mathematics' }, 'mathematics');
    expect(workspaceCreationViewError(mathematics, 'resources')).toBeNull();
    expect(workspaceCreationViewError(mathematics, 'rules')).toBeNull();

    const hackerOne = applyResearchKit(general, 'hackerone');
    expect(workspaceCreationViews(hackerOne)).toEqual(['overview', 'kit', 'resources', 'rules']);
    expect(workspaceCreationViewError(hackerOne, 'kit')).toBe('Import the HackerOne program before continuing.');
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

  it('applies kit guidance and rules without replacing the workspace identity', () => {
    const base = onboardingFormFromDefaults(defaults());
    const apple = applyResearchKit(base, 'apple-security-bounty');
    const msrc = applyResearchKit(base, 'msrc');

    expect(apple.workspaceName).toBe(base.workspaceName);
    expect(apple.researchSubjectName).toBe(base.researchSubjectName);
    expect(apple.rules).toEqual(expect.arrayContaining([expect.stringContaining('Target Flags')]));
    expect(msrc.workspaceName).toBe(base.workspaceName);
    expect(msrc.researchSubjectName).toBe(base.researchSubjectName);
    expect(msrc.rules).toEqual(expect.arrayContaining([expect.stringContaining('Researcher Portal')]));
  });

  it('keeps Apple OSS repositories unchecked until explicitly selected', () => {
    const apple = applyGitHubRepositoryCatalog(
      applyResearchKit(onboardingFormFromDefaults(defaults()), 'apple-security-bounty'),
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
    const apple = applyResearchKit(onboardingFormFromDefaults(defaults()), 'apple-security-bounty');

    expect(workspaceOnboardingFormForProfile(apple, 'mathematics').researchKitId).toBe('general');
    expect(workspaceOnboardingFormForProfile(apple, 'security-research')).toBe(apple);
  });

  it('applies a HackerOne lookup without changing the workspace identity or directory', () => {
    const base = onboardingFormFromDefaults(defaults());
    const form = onboardingFormFromHackerOneLookup(base, {
      handle: 'example',
      sourceUrl: 'https://hackerone.com/example',
      workspaceName: 'Example Bounty',
      scopeOwner: 'Example Inc.',
      descriptionMarkdown: 'Authorized research under Example.',
      rules: ['Verify current HackerOne scope.'],
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

    expect(form.researchKitId).toBe('hackerone');
    expect(form.workspacePath).toBe('/bounty/example');
    expect(form.workspaceName).toBe(base.workspaceName);
    expect(form.researchSubjectName).toBe(base.researchSubjectName);
    expect(form.rules).toEqual(['Verify current HackerOne scope.']);
    expect(form).not.toHaveProperty('expiresAt');
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
    rules: [],
    expiresAt: '2026-05-30T00:00:00.000Z',
    assets: []
  };
}
