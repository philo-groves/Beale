import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsSidebar, SettingsView, type SettingsSection } from '../src/renderer/features/settings/SettingsModal';

describe('renderer settings layout', () => {
  it('replaces workspace navigation with a Back to App action and settings sections', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      collapsed: false,
      section: 'memory',
      error: null,
      onBack: () => undefined,
      onChangeSection: () => undefined,
      onResizePointerDown: () => undefined
    }));

    expect(html).toContain('class="sidebar settings-sidebar"');
    expect(html).toContain('Back to App');
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('class="active">Memory</button>');
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

  it.each<SettingsSection>(['general', 'providers', 'memory', 'shell', 'developer'])(
    'omits the redundant %s section heading from the main content',
    (section) => {
      expect(renderSettingsView(section)).not.toContain('<h3>');
    }
  );
});

function renderSettingsView(section: SettingsSection): string {
  return renderToStaticMarkup(createElement(SettingsView, {
    section,
    developerSettings: null,
    researchProfile: null,
    shellOptions: null,
    chatView: 'commentary',
    activeResearchProfileId: 'security-research',
    openAiStatus: null,
    openAiOAuthResult: null,
    researchProviderOAuthResults: {},
    researchProviderStatuses: [],
    researchProviderModelCatalog: [],
    providerSettings: { defaultProviderId: null, modelDefaults: {} },
    providerStatusesLoaded: true,
    busy: false,
    onSetDeveloperModeEnabled: async () => undefined,
    onChangeChatView: () => undefined,
    onSetResearchProfile: async () => undefined,
    onSaveShellOptions: async () => undefined,
    onRefreshOpenAi: async () => undefined,
    onStartOpenAiOAuth: async () => undefined,
    onStartResearchProviderOAuth: async () => undefined,
    onSetDefaultProviderId: async () => undefined,
    onSetProviderModelDefaults: async () => undefined
  }));
}
