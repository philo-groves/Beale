import { describe, expect, it } from 'vitest';
import type { ProgramOnboardingDefaults } from '@shared/types';
import {
  applyProgramTemplate,
  onboardingFormFromDefaults,
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
