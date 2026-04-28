import { describe, expect, it } from 'vitest';
import { displaySessionTitle, generateSessionTitle, SESSION_TITLE_FALLBACK, SESSION_TITLE_MAX_WORDS } from '../src/shared/sessionTitle';

describe('session title generation', () => {
  it('generates a strict six-word maximum title from a research prompt', () => {
    const title = generateSessionTitle('Please perform deep vulnerability analysis on the Zuul open source library by Netflix.');

    expect(title.split(/\s+/).length).toBeLessThanOrEqual(SESSION_TITLE_MAX_WORDS);
    expect(title).toBe('Zuul Open Source Library Netflix');
  });

  it('uses No Title Yet for legacy long titles', () => {
    expect(displaySessionTitle("Let's perform deep vulnerability analysis on the Zuul open source library by Netflix")).toBe(SESSION_TITLE_FALLBACK);
  });

  it('prefers meaningful generated prompt headings over boilerplate sections', () => {
    const prompt = `## Next research session: Netflix Help Center first-party support/chat surface

### Target focus
Focus on the underexplored in-scope **Primary Target** \`help.netflix.com\`, especially first-party support flows, locale/account-help pages, contact-us/chat entry points, and first-party API calls.`;

    expect(generateSessionTitle(prompt)).toBe('Netflix Help Center Support Chat');
    expect(displaySessionTitle('Target Focus Focus Underexplored In-Scope Primary', prompt)).toBe('Netflix Help Center Support Chat');
  });
});
