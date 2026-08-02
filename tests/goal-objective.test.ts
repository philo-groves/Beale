import { describe, expect, it } from 'vitest';
import { deriveGoalObjective, normalizeGoalObjective, resolveGoalObjective } from '../src/shared/goalObjective';

describe('research goal objective normalization', () => {
  it('keeps an explicitly selected direction separate from the expanded prompt', () => {
    const selectedDirection = 'Research active-mode ZFTP data-socket handling for authentication-bypass and connection-hijacking vulnerabilities.';
    const expandedPrompt = `# Active-mode ZFTP review\n\n## Objective\n${'Inspect source and runtime evidence in depth. '.repeat(20)}`;

    expect(resolveGoalObjective(selectedDirection, expandedPrompt)).toBe(selectedDirection);
  });

  it('derives a manual objective from an explicit user-authored Objective section', () => {
    const prompt = [
      '# Detailed parser research',
      '',
      '## Objective',
      'Determine whether an attacker-controlled length reaches the allocation sink. Then validate the shipping build.',
      '',
      '## Constraints',
      'Stay offline.'
    ].join('\n');

    expect(deriveGoalObjective(prompt)).toBe(
      'Determine whether an attacker-controlled length reaches the allocation sink.'
    );
  });

  it('falls back to the first user-authored content sentence and skips a markdown title', () => {
    expect(deriveGoalObjective([
      '# Archive importer',
      '',
      'Trace archive entry names through normalization into filesystem writes. Require a deterministic verifier.'
    ].join('\n'))).toBe(
      'Trace archive entry names through normalization into filesystem writes.'
    );
  });

  it('bounds objectives without generating replacement text', () => {
    const userText = `Inspect ${'nested parser state '.repeat(30)}`.trim();
    const normalized = normalizeGoalObjective(userText);

    expect(normalized?.length).toBeLessThanOrEqual(320);
    expect(userText.startsWith(normalized ?? '')).toBe(true);
  });

  it('preserves security-relevant identifier and glob syntax exactly', () => {
    const objective = 'Trace zftp_open, *.tar handling, and char **argv into the vulnerable sink.';

    expect(normalizeGoalObjective(objective)).toBe(objective);
  });

  it('joins a hard-wrapped explicit objective before selecting its first sentence', () => {
    const prompt = [
      '## Objective',
      'Determine whether active-mode sockets',
      'accept an attacker connection before the intended server connects. Then inspect cleanup.',
      '',
      '## Constraints',
      'Use the local fixture.'
    ].join('\n');

    expect(deriveGoalObjective(prompt)).toBe(
      'Determine whether active-mode sockets accept an attacker connection before the intended server connects.'
    );
  });
});
