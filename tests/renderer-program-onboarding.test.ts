import { describe, expect, it } from 'vitest';
import type { ProgramOnboardingDefaults } from '@shared/types';
import {
  applyProgramTemplate,
  onboardingFormFromDefaults,
  onboardingFormFromHackerOneLookup,
  onboardingInputFromForm
} from '../src/renderer/view-models/programOnboarding';

describe('renderer program onboarding view model', () => {
  it('converts host defaults into an editable onboarding form', () => {
    const form = onboardingFormFromDefaults(defaults());

    expect(form.templateKind).toBe('manual');
    expect(form.workspacePath).toBe('/bounty/example');
    expect(form.expiresAt).toBe('2026-05-30');
  });

  it('treats an empty authorization expiry as never when submitting', () => {
    const input = onboardingInputFromForm({
      ...onboardingFormFromDefaults(defaults()),
      expiresAt: ''
    });

    expect(input.expiresAt).toBeNull();
  });

  it('applies global Apple and MSRC template defaults', () => {
    const base = onboardingFormFromDefaults(defaults());
    const apple = applyProgramTemplate(base, 'apple');
    const msrc = applyProgramTemplate(base, 'msrc');

    expect(apple.programName).toBe('Apple Security Bounty');
    expect(apple.rulesMarkdown).toContain('Target Flags');
    expect(msrc.programName).toBe('Microsoft Security Response Center');
    expect(msrc.rulesMarkdown).toContain('Researcher Portal');
  });

  it('applies a HackerOne lookup without changing the workspace directory', () => {
    const form = onboardingFormFromHackerOneLookup(onboardingFormFromDefaults(defaults()), {
      handle: 'example',
      sourceUrl: 'https://hackerone.com/example',
      programName: 'Example Bounty',
      organizationName: 'Example Inc.',
      descriptionMarkdown: 'Authorized research under Example.',
      rulesMarkdown: 'Verify current HackerOne scope.',
      networkProfile: 'scoped',
      expiresAt: null,
      assets: [
        {
          direction: 'in_scope',
          kind: 'domain',
          value: 'example.test',
          sensitivity: 'normal',
          attributes: { source: 'hackerone', hackerOneHandle: 'example', hackerOneSourceUrl: 'https://hackerone.com/example' }
        }
      ],
      importedScopeCount: 1
    });

    expect(form.templateKind).toBe('hackerone');
    expect(form.workspacePath).toBe('/bounty/example');
    expect(form.programName).toBe('Example Bounty');
    expect(form.expiresAt).toBe('');
    expect(form.assets).toHaveLength(1);
    expect(form.assets[0]?.attributes).toMatchObject({ hackerOneHandle: 'example', hackerOneSourceUrl: 'https://hackerone.com/example' });
  });
});

function defaults(): ProgramOnboardingDefaults {
  return {
    workspacePath: '/bounty/example',
    programName: 'Example',
    organizationName: '',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    networkProfile: 'scoped',
    expiresAt: '2026-05-30T00:00:00.000Z',
    assets: []
  };
}
