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

  it('keeps the app shell flat while restoring session-gated pulse effects', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const appShellStyles = styles.match(/\.app-shell\s*\{([^}]*)\}/)?.[1] ?? '';
    const appShellWashStyles = styles.match(/\.app-shell::before\s*\{([^}]*)\}/)?.[1] ?? '';
    const appBackgroundPulsesStyles = styles.match(/\.app-background-pulses\s*\{([^}]*)\}/)?.[1] ?? '';
    const appBackgroundPulseStyles = styles.match(/\.app-background-pulse\s*\{([^}]*)\}/)?.[1] ?? '';
    const sidebarStyles = styles.match(/\.sidebar\s*\{([^}]*)\}/)?.[1] ?? '';
    const highHeatStyles = styles.match(/\.app-shell\.session-heat-high,\s*\.workspace-dream-card\[data-dream-heat="high"\],\s*\.workspace-dejunk-card\[data-dejunk-heat="high"\]\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(styles).toContain('animation: app-background-pulse 12s linear infinite both');
    expect(styles).toContain('@keyframes app-background-pulse');
    expect(styles).toContain('.app-shell.session-active .app-background-pulses');
    expect(styles).toContain('.app-shell.session-active .app-background-pulse');
    expect(styles).not.toContain('--app-pulse-duration');
    expect(styles).not.toMatch(/\.app-shell\.momentum-[^\s,{]+[^{]*\.app-background-pulse/);
    expect(appShellStyles).toContain('background: var(--session-heat-window-surface)');
    expect(appShellStyles).not.toContain('--session-heat-glass');
    expect(appShellStyles).not.toContain('backdrop-filter');
    expect(appShellStyles).not.toContain('gradient');
    expect(appShellWashStyles).toBe('');
    expect(appBackgroundPulsesStyles).toContain('visibility: hidden');
    expect(appBackgroundPulsesStyles).toContain('pointer-events: none');
    expect(appBackgroundPulseStyles).toContain('animation-play-state: paused');
    expect(appBackgroundPulseStyles).toContain('var(--text) 28%');
    expect(appBackgroundPulseStyles).toContain('box-shadow:');
    expect(appBackgroundPulseStyles).not.toContain('display: none');
    expect(sidebarStyles).toContain('background: transparent');
    expect(highHeatStyles).toContain(
      '--session-heat-edge: color-mix(in srgb, var(--session-heat-high-color) 54%, var(--panel-border))'
    );
    expect(highHeatStyles).toContain(
      '--session-heat-window-surface: var(--session-heat-edge)'
    );
    expect(appShellWashStyles).not.toContain('backdrop-filter');
    expect(appShellWashStyles).not.toContain('82px');
    expect(appShellWashStyles).not.toContain('box-shadow');
    expect(appShellWashStyles).not.toContain('gradient');
  });
});
