import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsSidebar, SettingsView } from '../src/renderer/features/settings/SettingsModal';

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
    const html = renderToStaticMarkup(createElement(SettingsView, {
      section: 'general',
      developerSettings: null,
      researchProfile: null,
      shellOptions: null,
      chatView: 'commentary',
      workspaceName: 'Security',
      openAiStatus: null,
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: [],
      busy: false,
      onSetDeveloperModeEnabled: async () => undefined,
      onChangeChatView: () => undefined,
      onSaveShellOptions: async () => undefined,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined
    }));

    expect(html).toContain('class="settings-workspace"');
    expect(html).toContain('aria-label="General settings"');
    expect(html).toContain('<h3>General</h3>');
    expect(html).not.toContain('bottom-sheet');
    expect(html).not.toContain('role="dialog"');
  });
});
