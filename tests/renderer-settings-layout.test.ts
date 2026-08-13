import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsSidebar, SettingsView, type SettingsSection } from '../src/renderer/features/settings/SettingsModal';

describe('renderer settings layout', () => {
  it('keeps the shared workspace and settings row active background visible', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const activeRowStyles = styles.match(/\.workspace-item-row\.active \.workspace-item,\s*\.workspace-item\.active\s*\{([^}]*)\}/u)?.[1] ?? '';
    const activeHoverStyles = styles.match(/\.workspace-item-row\.active \.workspace-item:hover:not\(:disabled\),\s*\.workspace-item\.active:hover:not\(:disabled\)\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(activeRowStyles).toContain('background: var(--panel)');
    expect(activeHoverStyles).toContain('background: var(--panel)');
  });

  it('stacks settings navigation rows without vertical gaps', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const settingsSectionsStyles = styles.match(/\.settings-sections\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(settingsSectionsStyles).toContain('gap: 0');
  });

  it('replaces workspace navigation with a Back to Agent action and settings sections', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      collapsed: false,
      section: 'memory',
      error: null,
      onBack: () => undefined,
      onChangeSection: () => undefined,
      onResizePointerDown: () => undefined
    }));

    expect(html).toContain('class="sidebar settings-sidebar"');
    expect(html).toContain('Back to Agent');
    expect(html).toContain('<div class="workspace-list-title">Settings</div>');
    expect(html).not.toContain('<div class="meta-label">Settings</div>');
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('class="workspace-item-row no-menu active"');
    expect(html).toContain('class="workspace-item active" aria-current="page">');
    expect(html.match(/class="lucide lucide-settings"/gu)).toHaveLength(3);
    expect(html).toContain('<span>Memory</span></button>');
    expect(html).not.toContain('Shell Options');
    expect(html).not.toContain('Developer');
    expect(html).not.toContain('New Research');
    expect(html).not.toContain('Research Workspaces');
  });

  it('renders the active settings section as workbench content instead of a bottom sheet', () => {
    const html = renderSettingsView('general');

    expect(html).toContain('class="settings-workspace"');
    expect(html).toContain('aria-label="General settings"');
    expect(html).not.toContain('<h3>');
    expect(html).toContain('<legend>Chat View</legend>');
    expect(html).not.toContain('bottom-sheet');
    expect(html).not.toContain('role="dialog"');
  });

  it.each<SettingsSection>(['general', 'providers', 'memory'])(
    'omits the redundant %s section heading from the main content',
    (section) => {
      expect(renderSettingsView(section)).not.toContain('<h3>');
    }
  );
});

function renderSettingsView(section: SettingsSection): string {
  return renderToStaticMarkup(createElement(SettingsView, {
    section,
    researchProfile: null,
    chatView: 'commentary',
    openAiStatus: null,
    openAiOAuthResult: null,
    researchProviderOAuthResults: {},
    researchProviderStatuses: [],
    researchProviderModelCatalog: [],
    providerSettings: { defaultProviderId: null, modelDefaults: {} },
    providerStatusesLoaded: true,
    busy: false,
    onChangeChatView: () => undefined,
    onRefreshOpenAi: async () => undefined,
    onStartOpenAiOAuth: async () => undefined,
    onStartResearchProviderOAuth: async () => undefined,
    onSetDefaultProviderId: async () => undefined,
    onSetProviderModelDefaults: async () => undefined
  }));
}
