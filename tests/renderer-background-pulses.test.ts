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
    const appShellStyles = styles.match(/\.app-shell\s*\{([^}]*)\}/)?.[1] ?? '';
    const appShellWashStyles = styles.match(/\.app-shell::before\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(styles).toContain('animation: app-background-pulse 12s linear infinite both;');
    expect(styles).toContain('.app-shell.session-active .app-background-pulses');
    expect(styles).toContain('.app-shell.session-active .app-background-pulse');
    expect(styles).not.toContain('--app-pulse-duration');
    expect(styles).not.toMatch(/\.app-shell\.momentum-[^\s,{]+[^{]*\.app-background-pulse/);
    expect(appShellStyles).toContain('background: var(--session-heat-glass)');
    expect(appShellStyles).toContain('backdrop-filter: blur(44px) saturate(1.08)');
    expect(appShellStyles).not.toContain('gradient');
    expect(appShellWashStyles).toContain('background: var(--session-heat-wash)');
    expect(appShellWashStyles).toContain('backdrop-filter: blur(64px) saturate(1.14)');
    expect(appShellWashStyles).not.toContain('82px');
    expect(appShellWashStyles).not.toContain('box-shadow');
    expect(appShellWashStyles).not.toContain('gradient');
  });
});
