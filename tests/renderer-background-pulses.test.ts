import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppBackgroundPulses } from '../src/renderer/app/AppBackgroundPulses';

describe('renderer background pulses', () => {
  it('renders a stable set of pulses without per-cycle randomized styles', () => {
    const firstRender = renderToStaticMarkup(createElement(AppBackgroundPulses));
    const secondRender = renderToStaticMarkup(createElement(AppBackgroundPulses));

    expect(firstRender).toBe(secondRender);
    expect(firstRender.match(/class="app-background-pulse"/g)).toHaveLength(18);
    expect(firstRender).not.toContain('style=');
  });

  it('uses fixed infinite timing gated only by active-session visibility', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

    expect(styles).toContain('animation: app-background-pulse 12s linear infinite both;');
    expect(styles).toContain('.app-shell.session-active .app-background-pulses');
    expect(styles).toContain('.app-shell.session-active .app-background-pulse');
    expect(styles).not.toContain('--app-pulse-duration');
    expect(styles).not.toMatch(/\.app-shell\.momentum-[^\s,{]+[^{]*\.app-background-pulse/);
  });
});
