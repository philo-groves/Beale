import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OpenAiAccountStatus, ResearchProviderModel, ResearchProviderModelCatalog, ResearchProviderStatus } from '../src/shared/types';
import {
  ProvidersSettingsView,
  ProviderRemoveControl,
  ProviderApiKeyDialog,
  defaultProviderPickerOptions,
  providerSettingsOptions,
  resolvedDefaultProviderId,
  nextConfiguredProviderIdAfterRemoval,
  resolvedProviderModelDefaults
} from '../src/renderer/features/settings/SettingsModal';

describe('renderer provider settings', () => {
  it('replaces the provider removal control with progress text while removing', () => {
    const html = renderToStaticMarkup(createElement(ProviderRemoveControl, {
      providerName: 'OpenAI',
      disabled: false,
      removing: true,
      onRemove: () => undefined
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain('Removing provider...');
    expect(html).not.toContain('<button');
  });

  it('marks the preferred authentication source and offers the alternate action', () => {
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: { ...configuredOpenAiStatus(), apiKeyConfigured: true },
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: researchProviderStatuses(),
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: {
        defaultProviderId: 'openai-codex',
        modelDefaults: {},
        preferredAuthenticationMethods: { 'openai-codex': 'subscription' }
      },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined,
      onSetProviderPreferredAuthenticationMethod: async () => undefined
    }));

    expect(html).toContain('state-preferred');
    expect(html).toContain('Preferred');
    expect(html.indexOf('Preferred')).toBeLessThan(html.indexOf('Configured'));
    expect(html.match(/>Prefer<\/button>/gu)).toHaveLength(1);
  });

  it('uses the shared white theme accent for all checkbox and radio controls', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const checkboxStyles = styles.match(/input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    const accentValues = [...styles.matchAll(/accent-color:\s*([^;]+);/gu)].map((match) => match[1]?.trim());

    expect(checkboxStyles).toContain('accent-color: var(--text)');
    expect(new Set(accentValues)).toEqual(new Set(['var(--text)']));
  });

  it('opens the provider picker toward the right of its trigger', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const pickerStyles = styles.match(/\.provider-settings-picker-menu\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(pickerStyles).toContain('left: 0;');
    expect(pickerStyles).toContain('right: auto;');
  });

  it('gives inactive provider tabs a contrasting surface', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const inactiveTabStyles = styles.match(/\.provider-settings-tab:not\(\.active\)\s*\{([^}]*)\}/)?.[1] ?? '';
    const providerContentStyles = styles.match(/\.provider-settings-page > \.provider-card\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(inactiveTabStyles).toContain('background: var(--panel-strong)');
    expect(providerContentStyles).toContain('border: 0');
    expect(providerContentStyles).toContain('border-radius: 0');
    expect(providerContentStyles).toContain('background: transparent');
    expect(providerContentStyles).toContain('padding: 0');
  });

  it('uses compact New Research styling for provider defaults', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const defaultsStyles = styles.match(/^\.provider-model-defaults\s*\{([^}]*)\}/m)?.[1] ?? '';
    const defaultsHeadingStyles = styles.match(/\.provider-model-defaults-heading\s*\{([^}]*)\}/)?.[1] ?? '';
    const defaultsDividerStyles = styles.match(/\.provider-model-defaults-divider\s*\{([^}]*)\}/)?.[1] ?? '';
    const labelStyles = styles.match(/\.provider-model-defaults label\s*\{([^}]*)\}/)?.[1] ?? '';
    const selectStyles = styles.match(/\.provider-model-defaults select\s*\{([^}]*)\}/)?.[1] ?? '';
    const providerControlStyles = styles.match(/\.provider-settings-default-control\s*\{([^}]*)\}/)?.[1] ?? '';
    const providerSelectStyles = styles.match(/\.provider-settings-default-control select\s*\{([^}]*)\}/)?.[1] ?? '';
    const healthyStyles = styles.match(/\.provider-health-indicator\.state-healthy\s*\{([^}]*)\}/)?.[1] ?? '';
    const unhealthyStyles = styles.match(/\.provider-health-indicator\.state-unhealthy\s*\{([^}]*)\}/)?.[1] ?? '';
    const authenticatingStyles = styles.match(/\.provider-health-indicator\.state-authenticating\s*\{([^}]*)\}/)?.[1] ?? '';
    const acknowledgementHeadingStyles = styles.match(/\.provider-policy-warning > h3\s*\{([^}]*)\}/)?.[1] ?? '';
    const removeProviderStyles = styles.match(/\.provider-remove-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const acknowledgementStyles = styles.match(/\.provider-risk-acknowledgement\s*\{([^}]*)\}/)?.[1] ?? '';
    const acknowledgementInputStyles = styles.match(/\.provider-risk-acknowledgement input\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionalModelsStyles = styles.match(/\.provider-optional-models\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionalHeadingStyles = styles.match(/\.provider-optional-models > h3\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionalLabelStyles = styles.match(/\.provider-optional-models label\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionalInputStyles = styles.match(/\.provider-optional-models input\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionalCopyStyles = styles.match(/\.provider-optional-model-copy\s*\{([^}]*)\}/)?.[1] ?? '';
    const authenticationStyles = styles.match(/\.provider-authentication-section\s*\{([^}]*)\}/)?.[1] ?? '';
    const authenticationHeadingStyles = styles.match(/\.provider-authentication-section > h3\s*\{([^}]*)\}/)?.[1] ?? '';
    const authenticationOptionsStyles = styles.match(/\.provider-authentication-options\s*\{([^}]*)\}/)?.[1] ?? '';
    const authenticationLabelStyles = styles.match(/\.provider-authentication-option-heading strong\s*\{([^}]*)\}/)?.[1] ?? '';
    const authenticationStatusStyles = styles.match(/\.provider-authentication-status\s*\{([^}]*)\}/)?.[1] ?? '';
    const authenticationActionStyles = styles.match(/\.provider-authentication-action,([\s\S]*?)\{([^}]*)\}/)?.[2] ?? '';
    const oauthResultStyles = styles.match(/\.provider-oauth-result\s*\{([^}]*)\}/)?.[1] ?? '';
    const apiKeyDescriptionStyles = styles.match(/\.provider-api-key-dialog \.modal-body > p\s*\{([^}]*)\}/)?.[1] ?? '';
    const apiKeyFieldStyles = styles.match(/\.provider-api-key-field\s*\{([^}]*)\}/)?.[1] ?? '';
    const apiKeyDialogButtonStyles = styles.match(/\.provider-api-key-dialog button,([\s\S]*?)\{([^}]*)\}/)?.[2] ?? '';

    expect(defaultsStyles).toContain('justify-content: flex-end');
    expect(defaultsHeadingStyles).toContain('display: inline-flex');
    expect(defaultsHeadingStyles).toContain('color: var(--text)');
    expect(defaultsHeadingStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(defaultsDividerStyles).toContain('border-left: 1px solid var(--panel-border)');
    expect(labelStyles).toContain('display: inline-flex');
    expect(labelStyles).toContain('gap: 5px');
    expect(labelStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(labelStyles).toContain('font-weight: 400');
    expect(selectStyles).toContain('max-width: 120px');
    expect(selectStyles).toContain('border: 0');
    expect(selectStyles).toContain('background-color: #141414');
    expect(selectStyles).toContain('font-weight: 400');
    expect(providerControlStyles).toContain('display: inline-flex');
    expect(providerControlStyles).toContain('gap: 5px');
    expect(providerControlStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(providerControlStyles).toContain('font-weight: 400');
    expect(providerSelectStyles).toContain('max-width: 120px');
    expect(providerSelectStyles).toContain('border: 0');
    expect(providerSelectStyles).toContain('background-color: #141414');
    expect(providerSelectStyles).toContain('font-weight: 400');
    expect(healthyStyles).toContain('background: var(--green)');
    expect(removeProviderStyles).toContain('width: 18px');
    expect(removeProviderStyles).toContain('min-height: 18px');
    expect(removeProviderStyles).toContain('max-height: 18px');
    expect(removeProviderStyles).toContain('border-radius: 50%');
    expect(removeProviderStyles).toContain('background: #383838');
    expect(removeProviderStyles).toContain('color: #b8b8b8');
    expect(unhealthyStyles).toContain('background: var(--red)');
    expect(authenticatingStyles).toContain('border: 1.5px solid rgba(255, 255, 255, 0.28)');
    expect(authenticatingStyles).toContain('animation: provider-health-spin 800ms linear infinite');
    expect(acknowledgementHeadingStyles).toBe(authenticationHeadingStyles);
    expect(acknowledgementStyles).toContain('width: fit-content');
    expect(acknowledgementStyles).toContain('display: inline-flex');
    expect(acknowledgementStyles).toContain('justify-content: flex-start');
    expect(acknowledgementStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(acknowledgementInputStyles).toContain('width: 14px');
    expect(acknowledgementInputStyles).toContain('flex: 0 0 14px');
    expect(optionalModelsStyles).toContain('background: transparent');
    expect(optionalHeadingStyles).toContain('font-size: 1rem');
    expect(optionalHeadingStyles).toContain('font-weight: 400');
    expect(optionalHeadingStyles).toContain('border-bottom: 1px solid var(--panel-border)');
    expect(optionalLabelStyles).toContain('display: inline-flex');
    expect(optionalLabelStyles).toContain('background: transparent');
    expect(optionalLabelStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(optionalInputStyles).toContain('width: 14px');
    expect(optionalInputStyles).toContain('flex: 0 0 14px');
    expect(optionalCopyStyles).toContain('display: inline-flex');
    expect(optionalCopyStyles).toContain('white-space: nowrap');
    expect(authenticationStyles).toContain('display: grid');
    expect(authenticationHeadingStyles).toContain('border-bottom: 1px solid var(--panel-border)');
    expect(authenticationHeadingStyles).toContain('font-size: 1rem');
    expect(authenticationHeadingStyles).toContain('font-weight: 400');
    expect(authenticationOptionsStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(authenticationLabelStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(authenticationStatusStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(authenticationActionStyles).toContain('border: 0');
    expect(oauthResultStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(apiKeyDescriptionStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(apiKeyFieldStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(apiKeyDialogButtonStyles).toContain('border: 0');
  });

  it('separates configured provider tabs from providers available through the add menu', () => {
    const options = providerSettingsOptions(configuredOpenAiStatus(), researchProviderStatuses());

    expect(options.map(({ id, configured }) => ({ id, configured }))).toEqual([
      { id: 'openai-codex', configured: true },
      { id: 'anthropic', configured: true },
      { id: 'xai', configured: false }
    ]);
  });

  it('renders configured providers as tabs and defaults the detail to the saved default provider', () => {
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
    expect(html.match(/class="provider-settings-tab-icon"/gu)).toHaveLength(2);
    expect(html).toContain('<span>OpenAI</span>');
    expect(html).toContain('<span>Anthropic</span>');
    expect(html).toContain('aria-label="Add provider"');
    expect(html).toContain('aria-label="Refresh OpenAI"');
    expect(html).toContain('aria-label="Refresh Anthropic"');
    expect(html).not.toContain('>Refresh</button>');
    expect(html.match(/role="tabpanel"/gu)).toHaveLength(1);
    expect(html).not.toContain('aria-label="OpenAI provider settings"');
    expect(html).toContain('aria-label="Anthropic provider settings"');
    expect(html.match(/class="provider-settings-heading-icon"/gu)).toHaveLength(1);
    expect(html).not.toContain('class="status-icon"');
    expect(html).not.toContain('class="status-pill');
    expect(html).toContain('class="provider-health-indicator state-healthy"');
    expect(html).toContain('aria-label="Healthy"');
    expect(html.indexOf('aria-label="Provider model defaults"')).toBeLessThan(html.indexOf('class="provider-policy-warning"'));
    expect(html).not.toContain('class="provider-grid"');
    expect(html).not.toContain('<span>Source</span>');
    expect(html).not.toContain('<span>Transport</span>');
    expect(html).not.toContain('<span>Boundary</span>');
    expect(html).toContain('aria-label="Lead"');
    expect(html).toContain('<span>Lead</span>');
    expect(html).not.toContain('Default: Anthropic');
    expect(html).not.toContain('(Codex)');
    expect(html).not.toContain('(Claude)');
    expect(html).toContain('aria-label="Authentication"');
    expect(html).toContain('<h3>Acknowledgment</h3>');
    expect(html).toContain('<h3>Authentication</h3>');
    expect(html).toContain('<strong>Subscription</strong>');
    expect(html).toContain('<strong>API Key</strong>');
    expect(html).toContain('provider-authentication-status state-configured');
    expect(html).toContain('provider-authentication-status state-not-configured');
    expect(html).toContain('>Missing</span>');
    expect(html).toContain('>Forget</button>');
    expect(html).toContain('>Configure</button>');
    expect(html).not.toContain('>Remove</button>');
    expect(html).not.toContain('>Sign in</button>');
    expect(html).not.toContain('Re-authenticate');
    expect(html).not.toContain('Host credential');
    expect(html).not.toContain('OPENAI_API_KEY');
    expect(html).not.toContain('codex login --device-auth');
  });

  it('requires the provider acknowledgement before subscription or API-key setup', () => {
    const render = (acknowledged: boolean): string => renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: {
        ...configuredOpenAiStatus(),
        subscriptionConfigured: false,
        apiKeyConfigured: false
      },
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: researchProviderStatuses(),
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: {
        defaultProviderId: 'openai-codex',
        modelDefaults: {},
        ...(acknowledged ? { cyberPolicyRiskAcknowledgements: { 'openai-codex': true as const } } : {})
      },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    const pendingHtml = render(false);
    expect(pendingHtml).toMatch(/<button class="secondary-button provider-authentication-action" type="button" disabled="">Sign in<\/button>/u);
    expect(pendingHtml).toMatch(/<button class="secondary-button provider-authentication-action" type="button" disabled="">Configure<\/button>/u);
    expect(pendingHtml.match(/Acknowledge the risks first/gu)).toHaveLength(2);

    const confirmedHtml = render(true);
    expect(confirmedHtml).toContain('<button class="secondary-button provider-authentication-action" type="button">Sign in</button>');
    expect(confirmedHtml).toContain('<button class="secondary-button provider-authentication-action" type="button">Configure</button>');
    expect(confirmedHtml).not.toContain('Acknowledge the risks first');
  });

  it('renders API key confirmation as a password dialog without a stored value', () => {
    const html = renderToStaticMarkup(createElement(ProviderApiKeyDialog, {
      providerId: 'anthropic',
      busy: false,
      onCancel: () => undefined,
      onConfirm: async () => undefined
    }));

    expect(html).toContain('aria-label="Configure Anthropic API key"');
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('type="password"');
    expect(html).toContain('value=""');
    expect(html).toContain('>Cancel</button>');
    expect(html).toContain('>Confirm</button>');
  });

  it('shows subscription and API-key authentication statuses independently without key material', () => {
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: { ...configuredOpenAiStatus(), apiKeyConfigured: true },
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: researchProviderStatuses(),
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

    expect(html.match(/provider-authentication-status state-configured/gu)).toHaveLength(2);
    expect(html.match(/>Configured<\/span>/gu)).toHaveLength(2);
    expect(html).toContain('>Remove</button>');
    expect(html).not.toContain('>Configure</button>');
    expect(html).not.toContain('Host credential');
    expect(html).not.toContain('OPENAI_API_KEY');
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
    expect(html).toContain('aria-label="xAI provider settings"');
    expect(html.match(/class="provider-settings-heading-icon"/gu)).toHaveLength(1);
    expect(html).toContain('class="provider-health-indicator state-authenticating"');
    expect(html).toContain('aria-label="Authentication in progress"');
    expect(html).toContain('class="provider-remove-button"');
    expect(html).toContain('aria-label="Remove xAI provider"');
    expect(html).toContain('aria-label="Provider model defaults"');
    expect(html).toContain('Complete authentication in the browser.');
  });

  it('marks an unavailable configured provider as unhealthy', () => {
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: { ...configuredOpenAiStatus(), readiness: 'oauth_command_failed' },
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: researchProviderStatuses(),
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

    expect(html).toContain('class="provider-health-indicator state-unhealthy"');
    expect(html).toContain('aria-label="Unhealthy"');
    expect(html).toContain('class="provider-remove-button"');
    expect(html).toContain('aria-label="Remove OpenAI provider"');
  });

  it('offers only authenticated providers as default choices and None when there are none', () => {
    const configured = providerSettingsOptions(configuredOpenAiStatus(), researchProviderStatuses())
      .filter((provider) => provider.configured);

    expect(defaultProviderPickerOptions(configured)).toEqual([
      { value: 'openai-codex', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' }
    ]);
    expect(defaultProviderPickerOptions([])).toEqual([{ value: '', label: 'None' }]);
    expect(resolvedDefaultProviderId(configured, null)).toBe('openai-codex');
    expect(resolvedDefaultProviderId(configured, 'anthropic')).toBe('anthropic');
    expect(resolvedDefaultProviderId([], 'anthropic')).toBeNull();
    expect(nextConfiguredProviderIdAfterRemoval(
      ['openai-codex', 'anthropic'],
      'anthropic',
      'anthropic'
    )).toBe('openai-codex');
    expect(nextConfiguredProviderIdAfterRemoval(['anthropic'], 'anthropic', 'anthropic')).toBeNull();

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

  it('shows the Claude CVP and usage-policy acknowledgement without generic provider copy', () => {
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
      providerSettings: {
        defaultProviderId: 'anthropic',
        modelDefaults: {},
        cyberPolicyRiskAcknowledgements: { anthropic: true }
      },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    expect(html).toContain('only intended for Anthropic Cyber Verification Program members');
    expect(html).toContain('requests may still be blocked or treated as usage violations');
    expect(html).toContain('official Claude Agent SDK and Claude Code CLI');
    expect(html).toContain('I confirm this account is enrolled');
    expect(html).toMatch(/type="checkbox" checked=""/u);
    expect(html).not.toContain('Anthropic is ready.');
    expect(html).not.toContain('API-key authentication is also available');
    expect(html).not.toContain('OAuth ready');
    expect(html).toContain('<span>Defaults</span>');
    expect(html).toContain('<span>Large</span>');
    expect(html).toContain('<span>Small</span>');
    expect(html).toContain('<span>Reasoning</span>');
    expect(html).not.toContain('Default large');
    expect(html).not.toContain('Default small');
    expect(html).not.toContain('Default reasoning');
    expect(html).not.toMatch(/<option[^>]*>[^<]* — [^<]*<\/option>/u);
  });

  it('offers Fable by default and Mythos as an access-restricted Anthropic opt-in', () => {
    const render = (settings: { mythos?: boolean; fableDisabled?: boolean }): string => {
      const statuses = researchProviderStatuses().map((provider) => ({
        ...provider,
        configured: provider.id === 'anthropic',
        readiness: provider.id === 'anthropic' ? 'ready' as const : 'not_configured' as const
      }));
      return renderToStaticMarkup(createElement(ProvidersSettingsView, {
        openAiStatus: { ...configuredOpenAiStatus(), configured: false, readiness: 'not_configured', source: 'not_configured' },
        openAiOAuthResult: null,
        researchProviderOAuthResults: {},
        researchProviderStatuses: statuses,
        researchProviderModelCatalog: modelCatalogs(),
        providerSettings: {
          defaultProviderId: 'anthropic',
          modelDefaults: {},
          ...(settings.mythos ? { enabledOptionalModels: { anthropic: ['claude-mythos-5'] } } : {}),
          ...(settings.fableDisabled ? { disabledOptionalModels: { anthropic: ['claude-fable-5'] } } : {})
        },
        providerStatusesLoaded: true,
        busy: false,
        onRefreshOpenAi: async () => undefined,
        onStartOpenAiOAuth: async () => undefined,
        onStartResearchProviderOAuth: async () => undefined,
        onSetDefaultProviderId: async () => undefined,
        onSetProviderModelDefaults: async () => undefined,
        onSetProviderOptionalModelEnabled: async () => undefined
      }));
    };

    const defaultHtml = render({});
    expect(defaultHtml).toContain('<strong>Fable 5</strong>');
    expect(defaultHtml).toContain('may decline cybersecurity requests even for Cyber Verification Program members');
    expect(defaultHtml).toMatch(/<label><input type="checkbox" checked=""\/><span class="provider-optional-model-copy"><strong>Fable 5<\/strong>/u);
    expect(defaultHtml).toContain('<strong>Mythos 5</strong>');
    expect(defaultHtml).toContain('primarily available to approved commercial users');
    expect(defaultHtml).toMatch(/<label><input type="checkbox"\/><span class="provider-optional-model-copy"><strong>Mythos 5<\/strong>/u);
    expect(defaultHtml).not.toContain('value="claude-mythos-5"');

    const mythosHtml = render({ mythos: true });
    expect(mythosHtml).toMatch(/<label><input type="checkbox" checked=""\/><span class="provider-optional-model-copy"><strong>Mythos 5<\/strong>/u);
    expect(mythosHtml).toContain('<option value="claude-mythos-5">Mythos 5</option>');

    const fableDisabledHtml = render({ fableDisabled: true });
    expect(fableDisabledHtml).toMatch(/<label><input type="checkbox"\/><span class="provider-optional-model-copy"><strong>Fable 5<\/strong>/u);
    expect(fableDisabledHtml).not.toContain('value="claude-fable-5"');
  });

  it('shows the OpenAI Trusted Access for Cyber and policy-use acknowledgement', () => {
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: configuredOpenAiStatus(),
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: researchProviderStatuses().map((provider) => ({
        ...provider,
        configured: false,
        readiness: 'not_configured' as const
      })),
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: {
        defaultProviderId: 'openai-codex',
        modelDefaults: {},
        cyberPolicyRiskAcknowledgements: { 'openai-codex': true }
      },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    expect(html).toContain('OpenAI Trusted Access for Cyber members');
    expect(html).toContain('I confirm this account has OpenAI Trusted Access for Cyber membership');
    expect(html).toContain('class="provider-risk-acknowledgement is-locked"');
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""[^>]*checked=""/u);
    expect(html).toContain('Acknowledgment is recorded until this provider is removed.');
  });

  it('offers Daybreak Blue by default and Daybreak Red as an access-restricted opt-in', () => {
    const render = (settings: { red?: boolean; blueDisabled?: boolean }): string => renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: configuredOpenAiStatus(),
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: researchProviderStatuses(),
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: {
        defaultProviderId: 'openai-codex',
        modelDefaults: {},
        ...(settings.red ? { enabledOptionalModels: { 'openai-codex': ['gpt-daybreak-red-latest'] } } : {}),
        ...(settings.blueDisabled ? { disabledOptionalModels: { 'openai-codex': ['gpt-daybreak-blue-latest'] } } : {})
      },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined,
      onSetProviderOptionalModelEnabled: async () => undefined
    }));

    const disabledHtml = render({});
    expect(disabledHtml).toContain('aria-label="Optional models"');
    expect(disabledHtml).toContain('<h3>Optional models</h3>');
    expect(disabledHtml).toContain('class="provider-optional-model-copy"');
    expect(disabledHtml).toContain('<strong>Daybreak Blue</strong>');
    expect(disabledHtml).toContain('Expected, but not guaranteed, for Trusted Access for Cyber members.');
    expect(disabledHtml).toMatch(/<label><input type="checkbox"[^>]*checked=""\/><span class="provider-optional-model-copy"><strong>Daybreak Blue<\/strong>/u);
    expect(disabledHtml).toContain('<strong>Daybreak Red</strong>');
    expect(disabledHtml).toContain('primarily available to approved commercial users');
    expect(disabledHtml).toMatch(/<label><input type="checkbox"\/><span class="provider-optional-model-copy"><strong>Daybreak Red<\/strong>/u);
    expect(disabledHtml).not.toContain('gpt-daybreak-red-latest');
    const enabledHtml = render({ red: true });
    expect(enabledHtml).toMatch(/<label><input type="checkbox" checked=""\/><span class="provider-optional-model-copy"><strong>Daybreak Red<\/strong>/u);
    expect(enabledHtml).toContain('gpt-daybreak-red-latest');
    const blueDisabledHtml = render({ blueDisabled: true });
    expect(blueDisabledHtml).toMatch(/<label><input type="checkbox" disabled=""\/><span class="provider-optional-model-copy"><strong>Daybreak Blue<\/strong>/u);
  });

  it('shows the xAI policy-use risk acknowledgement without a program-membership claim', () => {
    const statuses = researchProviderStatuses().map((provider) => ({
      ...provider,
      configured: provider.id === 'xai',
      apiKeyConfigured: provider.id === 'xai',
      readiness: provider.id === 'xai' ? 'ready' as const : 'not_configured' as const
    }));
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: { ...configuredOpenAiStatus(), configured: false, readiness: 'not_configured', source: 'not_configured' },
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: statuses,
      researchProviderModelCatalog: modelCatalogs(),
      providerSettings: {
        defaultProviderId: 'xai',
        modelDefaults: {},
        cyberPolicyRiskAcknowledgements: { xai: true }
      },
      providerStatusesLoaded: true,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    expect(html).toContain('I accept the policy-use risk for cybersecurity research with xAI.');
    expect(html).not.toContain('xAI membership');
    expect(html).toContain('class="provider-risk-acknowledgement is-locked"');
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""[^>]*checked=""/u);
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
    expect(html).toContain('aria-label="Lead"');
    expect(html).toContain('<span>Lead</span>');
    expect(html).toContain('<option value="" selected="">None</option>');
  });

  it('shows provider loading state until statuses and settings are both available', () => {
    const html = renderToStaticMarkup(createElement(ProvidersSettingsView, {
      openAiStatus: null,
      openAiOAuthResult: null,
      researchProviderOAuthResults: {},
      researchProviderStatuses: [],
      researchProviderModelCatalog: [],
      providerSettings: null,
      providerStatusesLoaded: false,
      busy: false,
      onRefreshOpenAi: async () => undefined,
      onStartOpenAiOAuth: async () => undefined,
      onStartResearchProviderOAuth: async () => undefined,
      onSetDefaultProviderId: async () => undefined,
      onSetProviderModelDefaults: async () => undefined
    }));

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading providers…');
    expect(html).not.toContain('No providers configured');
    expect(html).not.toContain('aria-label="Add provider"');
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
    {
      providerId: 'openai-codex',
      providerName: 'OpenAI (Codex)',
      models: [
        model('gpt-5.6-sol', 'GPT-5.6 Sol'),
        model('gpt-5.6-luna', 'GPT-5.6 Luna'),
        model('gpt-daybreak-red-latest', 'Daybreak Red')
      ]
    },
    {
      providerId: 'anthropic',
      providerName: 'Anthropic (Claude)',
      models: [
        model('claude-sonnet-4-6', 'Claude Sonnet 4.6'),
        model('claude-haiku-4-5', 'Claude Haiku 4.5'),
        model('claude-fable-5', 'Claude Fable 5'),
        model('claude-mythos-5', 'Claude Mythos 5')
      ]
    },
    { providerId: 'xai', providerName: 'xAI (Grok/X)', models: [model('grok-4', 'Grok 4'), model('grok-4.3', 'Grok 4.3')] }
  ];
}

function configuredOpenAiStatus(): OpenAiAccountStatus {
  return {
    configured: true,
    subscriptionConfigured: true,
    apiKeyConfigured: false,
    loginInProgress: false,
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
      subscriptionConfigured: true,
      apiKeyConfigured: false,
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
      subscriptionConfigured: false,
      apiKeyConfigured: false,
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
