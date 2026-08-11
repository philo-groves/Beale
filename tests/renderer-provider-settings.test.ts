import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OpenAiAccountStatus, ResearchProviderModel, ResearchProviderModelCatalog, ResearchProviderStatus } from '../src/shared/types';
import {
  ProvidersSettingsView,
  defaultProviderPickerOptions,
  providerSettingsOptions,
  resolvedDefaultProviderId,
  resolvedProviderModelDefaults
} from '../src/renderer/features/settings/SettingsModal';

describe('renderer provider settings', () => {
  it('separates configured provider tabs from providers available through the add menu', () => {
    const options = providerSettingsOptions(configuredOpenAiStatus(), researchProviderStatuses());

    expect(options.map(({ id, configured }) => ({ id, configured }))).toEqual([
      { id: 'openai-codex', configured: true },
      { id: 'anthropic', configured: true },
      { id: 'xai', configured: false }
    ]);
  });

  it('renders configured providers as tabs and only the active provider detail', () => {
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: configuredOpenAiStatus(),
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: researchProviderStatuses(),
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: { defaultProviderId: 'anthropic', modelDefaults: {} },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    expect(html).toContain('role="tablist" aria-label="Provider views"');
    expect(html.match(/role="tab"/gu)).toHaveLength(2);
    expect(html).toContain('<span>OpenAI (Codex)</span>');
    expect(html).toContain('<span>Anthropic (Claude)</span>');
    expect(html).toContain('aria-label="Add provider"');
    expect(html).toContain('aria-label="Refresh OpenAI (Codex)"');
    expect(html).toContain('aria-label="Refresh Anthropic (Claude)"');
    expect(html).not.toContain('>Refresh</button>');
    expect(html.match(/role="tabpanel"/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="OpenAI (Codex) provider settings"');
    expect(html).not.toContain('aria-label="Anthropic (Claude) provider settings"');
    expect(html).toContain('aria-label="Default provider"');
    expect(html).toContain('>Default: Anthropic (Claude)</span>');
  });

  it('renders an in-progress authentication as its own active provider tab and panel', () => {
    const statuses = researchProviderStatuses().map((provider) => provider.id === 'xai'
      ? { ...provider, loginInProgress: true }
      : provider);
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: configuredOpenAiStatus(),
      openAiOAuthResult: null,
      researchProviderOAuthResults: {
        xai: {
          providerId: 'xai',
          started: true,
          command: 'provider login xai',
          detail: 'Complete authentication in the browser.',
          verificationUri: 'https://example.com/device',
          userCode: 'CODE-123',
          instructions: null
        }
      },
      researchProviderStatuses: statuses,
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: { defaultProviderId: 'openai-codex', modelDefaults: {} },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    expect(html.match(/role="tab"/gu)).toHaveLength(3);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="xAI (Grok/X) authentication"');
    expect(html).toContain('Complete authentication in the browser.');
  });

  it('offers only authenticated providers as default choices and None when there are none', () => {
    const configured = providerSettingsOptions(configuredOpenAiStatus(), researchProviderStatuses())
      .filter((provider) => provider.configured);

    expect(defaultProviderPickerOptions(configured)).toEqual([
      { value: 'openai-codex', label: 'OpenAI (Codex)' },
      { value: 'anthropic', label: 'Anthropic (Claude)' }
    ]);
    expect(defaultProviderPickerOptions([])).toEqual([{ value: '', label: 'None' }]);
    expect(resolvedDefaultProviderId(configured, null)).toBe('openai-codex');
    expect(resolvedDefaultProviderId(configured, 'anthropic')).toBe('anthropic');
    expect(resolvedDefaultProviderId([], 'anthropic')).toBeNull();
  });

  it('resolves stored provider model defaults against the available catalog', () => {
    const catalog = modelCatalogs().find((entry) => entry.providerId === 'anthropic') ?? null;

    expect(resolvedProviderModelDefaults('anthropic', catalog, 'claude-sonnet-4-6', null, undefined)).toEqual({
      largeModel: 'claude-sonnet-4-6',
      smallModel: 'claude-haiku-4-5',
      reasoningEffort: 'high'
    });
    expect(resolvedProviderModelDefaults('anthropic', catalog, 'claude-sonnet-4-6', null, {
      largeModel: 'claude-haiku-4-5',
      smallModel: 'claude-sonnet-4-6',
      reasoningEffort: 'medium'
    })).toEqual({
      largeModel: 'claude-haiku-4-5',
      smallModel: 'claude-sonnet-4-6',
      reasoningEffort: 'medium'
    });
  });

  it('omits configured-provider descriptions except for the Claude billing warning', () => {
    const statuses = researchProviderStatuses().map((provider) => ({
      ...provider,
      configured: provider.id === 'anthropic',
      readiness: provider.id === 'anthropic' ? 'ready' as const : 'not_configured' as const
    }));
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: { ...configuredOpenAiStatus(), configured: false, readiness: 'not_configured', source: 'not_configured' },
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: statuses,
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: { defaultProviderId: 'anthropic', modelDefaults: {} },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    expect(html).toContain('Claude Pro/Max use from third-party harnesses is billed as API usage rather than drawing from plan limits.');
    expect(html).not.toContain('Anthropic is ready.');
    expect(html).not.toContain('API-key authentication is also available');
    expect(html).not.toContain('OAuth ready');
    expect(html).toContain('Default large model');
    expect(html).toContain('Default small model');
    expect(html).toContain('Default reasoning level');
  });

  it('shows an add-provider empty state when no provider is configured', () => {
    const statuses = researchProviderStatuses().map((provider) => ({ ...provider, configured: false, readiness: 'not_configured' as const }));
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: { ...configuredOpenAiStatus(), configured: false, readiness: 'not_configured', source: 'not_configured' },
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: statuses,
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: { defaultProviderId: null, modelDefaults: {} },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    expect(html).toContain('No providers configured');
    expect(html).toContain('aria-label="Add provider"');
    expect(html).not.toContain('role="tabpanel"');
    expect(html).toContain('aria-label="Default provider"');
    expect(html).toContain('>Default: None</span>');
  });
});

function modelCatalogs(): ResearchProviderModelCatalog[] {
  const model = (id: string, name: string): ResearchProviderModel => ({
    id,
    name,
    reasoning: true,
    effortLevels: ['low', 'medium', 'high'],
    contextWindow: 200_000,
    maxTokens: 32_000
  });
  return [
    { providerId: 'openai-codex', providerName: 'OpenAI (Codex)', models: [model('gpt-5.6-sol', 'GPT-5.6 Sol'), model('gpt-5.6-luna', 'GPT-5.6 Luna')] },
    { providerId: 'anthropic', providerName: 'Anthropic (Claude)', models: [model('claude-sonnet-4-6', 'Claude Sonnet 4.6'), model('claude-haiku-4-5', 'Claude Haiku 4.5')] },
    { providerId: 'xai', providerName: 'xAI (Grok/X)', models: [model('grok-4', 'Grok 4'), model('grok-4.3', 'Grok 4.3')] }
  ];
}

function configuredOpenAiStatus(): OpenAiAccountStatus {
  return {
    configured: true,
    source: 'codex_oauth_file',
    label: 'Authenticated with Codex OAuth',
    credentialHint: 'Host credential',
    credentialsHostOnly: true,
    defaultModel: 'gpt-5.6-sol',
    defaultReasoningEffort: 'high',
    supportsWebSocket: true,
    preferredTransport: 'websocket',
    readiness: 'oauth_ready',
    statusDetail: 'OpenAI is ready.',
    userAction: null,
    setupCommand: null,
    oauthCommandConfigured: false,
    codexCliAvailable: true,
    onboardingSteps: []
  };
}

function researchProviderStatuses(): ResearchProviderStatus[] {
  return [
    {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      configured: true,
      readiness: 'ready',
      authMethods: ['api_key', 'oauth'],
      credentialType: 'oauth',
      source: 'oauth',
      defaultModel: 'claude-sonnet-4-6',
      credentialsHostOnly: true,
      loginInProgress: false,
      statusDetail: 'Anthropic is ready.',
      apiKeyEnvironmentVariable: 'ANTHROPIC_API_KEY'
    },
    {
      id: 'xai',
      name: 'xAI (Grok/X)',
      configured: false,
      readiness: 'not_configured',
      authMethods: ['api_key', 'oauth'],
      credentialType: null,
      source: null,
      defaultModel: 'grok-4',
      credentialsHostOnly: true,
      loginInProgress: false,
      statusDetail: 'xAI is not configured.',
      apiKeyEnvironmentVariable: 'XAI_API_KEY'
    }
  ];
}
