import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentPluginRegistryState, HostEnvironment } from '@shared/types';
import {
  ComputerUseSettingsView,
  SettingsSidebar,
  settingsSectionLabel
} from '../src/renderer/features/settings/SettingsModal';

describe('renderer Computer Use settings', () => {
  it('adds Computer Use to Agent Settings navigation', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      collapsed: false,
      section: 'computer-use',
      error: null,
      onBack: () => undefined,
      onChangeSection: () => undefined,
      onResizePointerDown: () => undefined
    }));

    expect(settingsSectionLabel('computer-use')).toBe('Computer Use');
    expect(html).toContain('<span>Computer Use</span>');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('lucide-monitor');
  });

  it('renders the persisted Terminator plugin toggle on Windows', () => {
    const disabledHtml = renderComputerUse('win32', pluginState(false));
    const enabledHtml = renderComputerUse('win32', pluginState(true));

    expect(disabledHtml).toContain('<h2 id="computer-use-settings-heading">Terminator</h2>');
    expect(disabledHtml).toContain('<strong>Enable Terminator</strong>');
    expect(disabledHtml).toContain('aria-label="Enable Terminator" type="checkbox"');
    expect(disabledHtml).not.toContain('aria-label="Enable Terminator" type="checkbox" checked=""');
    expect(enabledHtml).toContain('aria-label="Enable Terminator" type="checkbox" checked=""');
  });

  it.each<HostEnvironment['platform']>(['linux', 'darwin', 'other'])(
    'shows an availability message instead of a toggle on %s',
    (platform) => {
      const html = renderComputerUse(platform, null);

      expect(html).toContain('Computer use is not available on this operating system.');
      expect(html).not.toContain('aria-label="Enable Terminator"');
    }
  );

  it('uses the shared centered loading state while Windows configuration loads', () => {
    const html = renderComputerUse('win32', null, true);

    expect(html).toContain('class="centered-loading-state"');
    expect(html).toContain('class="centered-loading-state-spinner"');
    expect(html).toContain('Loading computer use…');
  });
});

function renderComputerUse(
  platform: HostEnvironment['platform'],
  state: AgentPluginRegistryState | null,
  loading = false
): string {
  return renderToStaticMarkup(createElement(ComputerUseSettingsView, {
    platform,
    pluginState: state,
    loading,
    busy: false,
    error: null,
    onSetEnabled: () => undefined
  }));
}

function pluginState(enabled: boolean): AgentPluginRegistryState {
  return {
    registryPath: 'C:\\registry',
    pluginStorePath: 'C:\\plugins',
    specVersion: '1',
    plugins: [{
      id: 'beale-terminator-builtin',
      name: 'beale-terminator',
      version: '1.0.0',
      description: 'Windows computer use.',
      enabled,
      status: 'ready',
      source: { kind: 'builtin', path: 'C:\\plugins\\beale-terminator' },
      installedAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
      skills: [],
      mcpServers: [],
      warnings: [],
      errors: []
    }]
  };
}
