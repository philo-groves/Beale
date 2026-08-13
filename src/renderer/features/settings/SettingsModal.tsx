import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  DEFAULT_RESEARCH_REASONING_EFFORT,
  smallModelForProvider
} from '../../../shared/modelDefaults';
import { ArrowLeft, BrainCircuit, KeyRound, Plus, RefreshCw, Settings } from 'lucide-react';
import type {
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  ProviderSettings,
  ProviderAuthenticationMethod,
  ProviderModelDefaults,
  ResearchProfileSnapshot,
  ResearchProfileId,
  ResearchModelProviderId,
  ResearchModelEffortLevel,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  ResearchProviderId,
  ResearchProviderOAuthStartResult,
  ResearchProviderStatus
} from '@shared/types';
import { ProviderIcon } from '../../app/ProviderIcon';
import type { FloatingTextPickerOption } from '../../app/FloatingTextPicker';
import { researchModelNameLabel, stateClass } from '../../lib/formatting';
import {
  filterEnabledProviderModelCatalogs,
  isOptionalProviderModelEnabled,
  OPTIONAL_PROVIDER_MODELS
} from '../../../shared/optionalProviderModels';
import type { ChatView } from '../../view-models/chatView';
import {
  SESSION_HEAT_LEVELS,
  type SessionHeat,
  type SessionHeatPreferenceOverrides
} from '../../view-models/sessionHeat';

export type SettingsSection = 'general' | 'providers' | 'memory';

const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'providers', 'memory'];

export function SettingsSidebar({
  collapsed,
  section,
  error,
  onBack,
  onChangeSection,
  onResizePointerDown
}: {
  collapsed: boolean;
  section: SettingsSection;
  error: string | null;
  onBack: () => void;
  onChangeSection: (section: SettingsSection) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): JSX.Element {
  const activeSection = activeSettingsSection(section);

  return (
    <aside className="sidebar settings-sidebar" aria-hidden={collapsed} inert={collapsed}>
      <button type="button" className="sidebar-new-research settings-back-button" onClick={onBack}>
        <ArrowLeft size={15} />
        <span>Back to App</span>
      </button>
      <div className="sidebar-section settings-sidebar-section">
        <div className="workspace-list-title">Settings</div>
        <nav className="settings-sections" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((item) => (
            <div className={`workspace-item-row no-menu ${activeSection === item ? 'active' : ''}`.trim()} key={item}>
              <button
                type="button"
                className={`workspace-item ${activeSection === item ? 'active' : ''}`.trim()}
                aria-current={activeSection === item ? 'page' : undefined}
                onClick={() => onChangeSection(item)}
              >
                <Settings size={15} aria-hidden="true" />
                <span>{settingsSectionLabel(item)}</span>
              </button>
            </div>
          ))}
        </nav>
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      <div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" onPointerDown={onResizePointerDown} />
    </aside>
  );
}

export function SettingsView({
  section,
  researchProfile,
  chatView,
  activeResearchProfileId,
  openAiStatus,
  openAiOAuthResult,
  researchProviderOAuthResults,
  researchProviderStatuses,
  researchProviderModelCatalog,
  providerSettings,
  providerStatusesLoaded,
  sessionHeatPreferences = {},
  busy,
  onChangeChatView,
  onSetResearchProfile,
  onRefreshOpenAi,
  onStartOpenAiOAuth,
  onStartResearchProviderOAuth,
  onForgetProviderSubscription = async () => undefined,
  onConfigureProviderApiKey = async () => undefined,
  onRemoveProviderApiKey = async () => undefined,
  onSetDefaultProviderId,
  onSetProviderModelDefaults,
  onSetProviderOptionalModelEnabled = async () => undefined,
  onSetProviderCyberPolicyRiskAcknowledged = async () => undefined,
  onSetProviderPreferredAuthenticationMethod = async () => undefined,
  onSetSessionHeatPreference = () => undefined
}: {
  section: SettingsSection;
  researchProfile: ResearchProfileSnapshot | null;
  chatView: ChatView;
  activeResearchProfileId: ResearchProfileId;
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  researchProviderOAuthResults: Partial<Record<ResearchProviderId, ResearchProviderOAuthStartResult>>;
  researchProviderStatuses: ResearchProviderStatus[];
  researchProviderModelCatalog: ResearchProviderModelCatalog[];
  providerSettings: ProviderSettings | null;
  providerStatusesLoaded: boolean;
  sessionHeatPreferences?: SessionHeatPreferenceOverrides;
  busy: boolean;
  onChangeChatView: (chatView: ChatView) => void;
  onSetResearchProfile: (profileId: ResearchProfileId) => Promise<void>;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
  onStartResearchProviderOAuth: (providerId: ResearchProviderId) => Promise<void>;
  onForgetProviderSubscription?: (providerId: ResearchModelProviderId) => Promise<void>;
  onConfigureProviderApiKey?: (providerId: ResearchModelProviderId, apiKey: string) => Promise<void>;
  onRemoveProviderApiKey?: (providerId: ResearchModelProviderId) => Promise<void>;
  onSetDefaultProviderId: (providerId: ResearchModelProviderId | null) => Promise<void>;
  onSetProviderModelDefaults: (providerId: ResearchModelProviderId, defaults: ProviderModelDefaults) => Promise<void>;
  onSetProviderOptionalModelEnabled?: (
    providerId: ResearchModelProviderId,
    modelId: string,
    enabled: boolean
  ) => Promise<void>;
  onSetProviderCyberPolicyRiskAcknowledged?: (
    providerId: ResearchModelProviderId,
    acknowledged: boolean
  ) => Promise<void>;
  onSetProviderPreferredAuthenticationMethod?: (
    providerId: ResearchModelProviderId,
    method: ProviderAuthenticationMethod
  ) => Promise<void>;
  onSetSessionHeatPreference?: (profileId: string, memoryTypeId: string, status: string, heat: SessionHeat | null) => void;
}): JSX.Element {
  const activeSection = activeSettingsSection(section);

  return (
    <div className="settings-workspace">
      <section className="settings-view settings-main-view" aria-label={`${settingsSectionLabel(activeSection)} settings`}>
        {activeSection === 'general' ? (
          <GeneralSettingsView
            activeResearchProfileId={activeResearchProfileId}
            busy={busy}
            chatView={chatView}
            onChangeChatView={onChangeChatView}
            onSetResearchProfile={onSetResearchProfile}
          />
        ) : activeSection === 'providers' ? (
          <ProvidersSettingsView
            busy={busy}
            openAiOAuthResult={openAiOAuthResult}
            openAiStatus={openAiStatus}
            researchProviderOAuthResults={researchProviderOAuthResults}
            researchProviderStatuses={researchProviderStatuses}
            researchProviderModelCatalog={researchProviderModelCatalog}
            providerSettings={providerSettings}
            providerStatusesLoaded={providerStatusesLoaded}
            onRefreshOpenAi={onRefreshOpenAi}
            onStartOpenAiOAuth={onStartOpenAiOAuth}
            onStartResearchProviderOAuth={onStartResearchProviderOAuth}
            onForgetProviderSubscription={onForgetProviderSubscription}
            onConfigureProviderApiKey={onConfigureProviderApiKey}
            onRemoveProviderApiKey={onRemoveProviderApiKey}
            onSetDefaultProviderId={onSetDefaultProviderId}
            onSetProviderModelDefaults={onSetProviderModelDefaults}
            onSetProviderOptionalModelEnabled={onSetProviderOptionalModelEnabled}
            onSetProviderCyberPolicyRiskAcknowledged={onSetProviderCyberPolicyRiskAcknowledged}
            onSetProviderPreferredAuthenticationMethod={onSetProviderPreferredAuthenticationMethod}
          />
        ) : (
          <MemorySettingsView
            researchProfile={researchProfile}
            sessionHeatPreferences={sessionHeatPreferences}
            onSetSessionHeatPreference={onSetSessionHeatPreference}
          />
        )}
      </section>
    </div>
  );
}

function activeSettingsSection(section: SettingsSection): SettingsSection {
  return SETTINGS_SECTIONS.includes(section) ? section : 'general';
}

export function MemorySettingsView({
  researchProfile,
  sessionHeatPreferences = {},
  onSetSessionHeatPreference = () => undefined
}: {
  researchProfile: ResearchProfileSnapshot | null;
  sessionHeatPreferences?: SessionHeatPreferenceOverrides;
  onSetSessionHeatPreference?: (profileId: string, memoryTypeId: string, status: string, heat: SessionHeat | null) => void;
}): JSX.Element {
  const memoryTypes = researchProfile
    ? [...researchProfile.profile.memory.types].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    : [];
  const source = researchProfile?.sourcePath
    ?? (researchProfile?.source === 'bundled-default' ? `Bundled ${researchProfile.profile.name} profile` : '.honeycrisp/profile.json');
  const statusesById = new Map(researchProfile?.profile.memory.statuses.map((status) => [status.id, status]) ?? []);

  return (
    <div className="settings-page memory-settings-page">
      <p className="settings-page-intro">The active research profile defines the memory taxonomy and its session heat defaults. Adjustments here are visual preferences for this profile.</p>
      <section className="provider-card memory-type-descriptions-card">
        <div className="provider-heading">
          <div className="status-icon"><BrainCircuit size={18} /></div>
          <div>
            <h4>{researchProfile ? `${researchProfile.profile.name} Memory Catalog` : 'Memory Catalog'}</h4>
            <p>{researchProfile ? `Resolved from ${source}. The selected research profile owns this versioned catalog.` : 'Open a workspace to inspect its resolved memory catalog.'}</p>
          </div>
        </div>
        <div className="memory-type-description-list">
          {memoryTypes.map((memoryType) => (
            <article className="memory-type-description" key={memoryType.id} aria-label={`${memoryType.name} memory definition`}>
              <span>{memoryType.name} · {memoryType.id}</span>
              <p>{memoryType.description}</p>
              <small>
                {memoryType.lifecycle === 'retired' || !memoryType.creatable ? 'Read-only' : 'Creatable'}
                {' · '}
                {memoryType.allowedStatuses.join(', ')}
              </small>
              <div className="memory-session-heat-settings" aria-label={`${memoryType.name} session heat settings`}>
                {memoryType.allowedStatuses
                  .filter((statusId) => statusesById.get(statusId)?.polarity !== 'negative')
                  .map((statusId) => {
                    const defaultHeat = memoryType.sessionHeat?.[statusId] ?? 'none';
                    const override = researchProfile
                      ? sessionHeatPreferences[researchProfile.profile.id]?.[memoryType.id]?.[statusId]
                      : undefined;
                    return (
                      <label key={statusId}>
                        <span>{statusesById.get(statusId)?.name ?? statusId}</span>
                        <select
                          aria-label={`${memoryType.name} ${statusId} session heat`}
                          value={override ?? ''}
                          onChange={(event) => {
                            if (!researchProfile) return;
                            onSetSessionHeatPreference(
                              researchProfile.profile.id,
                              memoryType.id,
                              statusId,
                              event.target.value ? event.target.value as SessionHeat : null
                            );
                          }}
                        >
                          <option value="">Profile default · {sessionHeatLabel(defaultHeat)}</option>
                          {SESSION_HEAT_LEVELS.map((heat) => (
                            <option value={heat} key={heat}>{sessionHeatLabel(heat)}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function sessionHeatLabel(heat: SessionHeat): string {
  return heat.charAt(0).toUpperCase() + heat.slice(1);
}

export function GeneralSettingsView({
  activeResearchProfileId,
  busy,
  chatView,
  onChangeChatView,
  onSetResearchProfile
}: {
  activeResearchProfileId: ResearchProfileId;
  busy: boolean;
  chatView: ChatView;
  onChangeChatView: (chatView: ChatView) => void;
  onSetResearchProfile: (profileId: ResearchProfileId) => Promise<void>;
}): JSX.Element {
  return (
    <div className="settings-page general-settings-page">
      <fieldset className="provider-card chat-view-settings">
        <legend>Chat View</legend>
        <p>Choose how Beale presents agent activity in research sessions.</p>
        <div className="chat-view-options">
          <label className={`chat-view-option ${chatView === 'commentary' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="chat-view"
              value="commentary"
              checked={chatView === 'commentary'}
              onChange={() => onChangeChatView('commentary')}
            />
            <span>
              <strong>Commentary</strong>
              <small>Follow concise research updates and agent responses.</small>
            </span>
          </label>
          <label className={`chat-view-option ${chatView === 'traces' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="chat-view"
              value="traces"
              checked={chatView === 'traces'}
              onChange={() => onChangeChatView('traces')}
            />
            <span>
              <strong>Traces</strong>
              <small>Inspect the detailed agent event timeline and tool activity.</small>
            </span>
          </label>
        </div>
      </fieldset>
      <fieldset className="provider-card chat-view-settings research-profile-settings">
        <legend>Research Profile</legend>
        <p>Choose the research domain. Each profile uses its own memory and session database.</p>
        <div className="chat-view-options">
          <label className={`chat-view-option ${activeResearchProfileId === 'security-research' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="research-profile"
              value="security-research"
              checked={activeResearchProfileId === 'security-research'}
              disabled={busy}
              onChange={() => void onSetResearchProfile('security-research')}
            />
            <span>
              <strong>Cybersecurity</strong>
              <small>Vulnerability discovery, verification, exploit chains, and security evidence.</small>
            </span>
          </label>
          <label className={`chat-view-option ${activeResearchProfileId === 'mathematics' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="research-profile"
              value="mathematics"
              checked={activeResearchProfileId === 'mathematics'}
              disabled={busy}
              onChange={() => void onSetResearchProfile('mathematics')}
            />
            <span>
              <strong>Mathematics</strong>
              <small>Conjectures, proofs, counterexamples, formalization, computation, and literature synthesis.</small>
            </span>
          </label>
        </div>
      </fieldset>
    </div>
  );
}

type ProviderSettingsId = ResearchModelProviderId;

interface ProviderSettingsOption {
  id: ProviderSettingsId;
  name: string;
  configured: boolean;
  authenticationRunning: boolean;
}

function providerCompanyName(providerId: ResearchModelProviderId): string {
  if (providerId === 'openai-codex') return 'OpenAI';
  if (providerId === 'anthropic') return 'Anthropic';
  return 'xAI';
}

type ProviderHealthState = 'healthy' | 'unhealthy' | 'authenticating';
type ProviderAuthenticationState = 'configured' | 'not-configured' | 'authenticating' | 'needs-attention' | 'unavailable';

function ProviderHealthIndicator({ state }: { state: ProviderHealthState }): JSX.Element {
  const label = state === 'healthy'
    ? 'Healthy'
    : state === 'authenticating'
      ? 'Authentication in progress'
      : 'Unhealthy';
  return (
    <span
      className={`provider-health-indicator state-${state}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

function ProviderAuthenticationStatus({ state, preferred = false }: { state: ProviderAuthenticationState; preferred?: boolean }): JSX.Element {
  const label = state === 'configured'
    ? 'Configured'
    : state === 'authenticating'
      ? 'Authenticating'
      : state === 'needs-attention'
        ? 'Needs attention'
        : state === 'unavailable'
          ? 'Unavailable'
          : 'Missing';
  return (
    <span className="provider-authentication-statuses">
      {preferred ? (
        <span className="provider-authentication-status state-preferred">
          <span aria-hidden="true" />
          Preferred
        </span>
      ) : null}
      <span className={`provider-authentication-status state-${state}`}>
        <span aria-hidden="true" />
        {label}
      </span>
    </span>
  );
}

function ProviderAuthenticationSection({
  providerId,
  subscriptionState,
  apiKeyConfigured,
  busy,
  subscriptionDisabled,
  result,
  preferredMethod,
  onAuthenticate,
  onForgetSubscription,
  onConfigureApiKey,
  onRemoveApiKey,
  onMarkPreferred
}: {
  providerId: ResearchModelProviderId;
  subscriptionState: ProviderAuthenticationState;
  apiKeyConfigured: boolean;
  busy: boolean;
  subscriptionDisabled: boolean;
  result: OpenAiOAuthStartResult | ResearchProviderOAuthStartResult | null;
  preferredMethod: ProviderAuthenticationMethod;
  onAuthenticate: () => void;
  onForgetSubscription: () => void;
  onConfigureApiKey: (providerId: ResearchModelProviderId) => void;
  onRemoveApiKey: () => void;
  onMarkPreferred: (method: ProviderAuthenticationMethod) => void;
}): JSX.Element {
  const subscriptionConfigured = subscriptionState === 'configured';
  const showPreferenceControls = subscriptionConfigured && apiKeyConfigured;
  return (
    <section className="provider-authentication-section" aria-label="Authentication">
      <h3>Authentication</h3>
      <div className="provider-authentication-options">
        <div className="provider-authentication-option">
          <div className="provider-authentication-option-heading">
            <strong>Subscription</strong>
            <ProviderAuthenticationStatus state={subscriptionState} preferred={showPreferenceControls && preferredMethod === 'subscription'} />
          </div>
          <div className="provider-authentication-actions">
            {subscriptionState === 'configured' ? (
              <button className="secondary-button provider-authentication-action" type="button" disabled={busy} onClick={onForgetSubscription}>
                Forget
              </button>
            ) : (
              <button
                className="secondary-button provider-authentication-action"
                type="button"
                disabled={busy || subscriptionDisabled}
                onClick={onAuthenticate}
              >
                Sign in
              </button>
            )}
            {showPreferenceControls && preferredMethod !== 'subscription' ? (
              <button className="secondary-button provider-authentication-action" type="button" disabled={busy} onClick={() => onMarkPreferred('subscription')}>
                Prefer
              </button>
            ) : null}
          </div>
          {result ? <ProviderOAuthResult result={result} /> : null}
        </div>
        <div className="provider-authentication-option">
          <div className="provider-authentication-option-heading">
            <strong>API Key</strong>
            <ProviderAuthenticationStatus state={apiKeyConfigured ? 'configured' : 'not-configured'} preferred={showPreferenceControls && preferredMethod === 'api_key'} />
          </div>
          <div className="provider-authentication-actions">
            {apiKeyConfigured ? (
              <button className="secondary-button provider-authentication-action" type="button" disabled={busy} onClick={onRemoveApiKey}>
                Remove
              </button>
            ) : (
              <button className="secondary-button provider-authentication-action" type="button" disabled={busy} onClick={() => onConfigureApiKey(providerId)}>
                Configure
              </button>
            )}
            {showPreferenceControls && preferredMethod !== 'api_key' ? (
              <button className="secondary-button provider-authentication-action" type="button" disabled={busy} onClick={() => onMarkPreferred('api_key')}>
                Prefer
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProviderApiKeyDialog({
  providerId,
  busy,
  onCancel,
  onConfirm
}: {
  providerId: ResearchModelProviderId;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (apiKey: string) => Promise<void>;
}): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !submitting) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel, submitting]);
  const submit = async (): Promise<void> => {
    const normalized = apiKey.trim();
    if (!normalized || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(normalized);
      setApiKey('');
    } catch {
      // The parent surfaces the host error; keep the dialog open for correction.
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="modal-backdrop provider-api-key-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel();
    }}>
      <form className="modal-panel provider-api-key-dialog" role="dialog" aria-modal="true" aria-label={`Configure ${providerCompanyName(providerId)} API key`} onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <header className="modal-header">
          <h2>Configure {providerCompanyName(providerId)} API key</h2>
        </header>
        <div className="modal-body">
          <label className="provider-api-key-field">
            <span>API key</span>
            <input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              type="password"
              value={apiKey}
              disabled={busy || submitting}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <p>The key is encrypted by the operating system and remains available only to Beale's host process.</p>
        </div>
        <footer className="modal-footer">
          <button className="secondary-button" type="button" disabled={busy || submitting} onClick={onCancel}>Cancel</button>
          <button className="primary-button" type="submit" disabled={busy || submitting || !apiKey.trim()}>Confirm</button>
        </footer>
      </form>
    </div>
  );
}

export function providerSettingsOptions(
  openAiStatus: OpenAiAccountStatus | null,
  researchProviderStatuses: readonly ResearchProviderStatus[]
): ProviderSettingsOption[] {
  return [
    {
      id: 'openai-codex',
      name: providerCompanyName('openai-codex'),
      configured: openAiStatus?.configured ?? false,
      authenticationRunning: openAiStatus?.loginInProgress ?? false
    },
    ...researchProviderStatuses.map((provider) => ({
      id: provider.id,
      name: providerCompanyName(provider.id),
      configured: provider.configured,
      authenticationRunning: provider.loginInProgress
    }))
  ];
}

export function defaultProviderPickerOptions(
  configuredProviders: readonly ProviderSettingsOption[]
): FloatingTextPickerOption[] {
  if (configuredProviders.length === 0) return [{ value: '', label: 'None' }];
  return configuredProviders.map((provider) => ({ value: provider.id, label: provider.name }));
}

export function resolvedDefaultProviderId(
  configuredProviders: readonly ProviderSettingsOption[],
  defaultProviderId: ResearchModelProviderId | null
): ResearchModelProviderId | null {
  return configuredProviders.some((provider) => provider.id === defaultProviderId)
    ? defaultProviderId
    : configuredProviders[0]?.id ?? null;
}

export function resolvedProviderModelDefaults(
  providerId: ResearchModelProviderId,
  catalog: ResearchProviderModelCatalog | null,
  configuredLargeModel: string | null,
  configuredReasoningEffort: string | null,
  stored: ProviderModelDefaults | undefined
): ProviderModelDefaults | null {
  const models = catalog?.models ?? [];
  if (models.length === 0) return null;
  const largeModel = models.find((model) => model.id === stored?.largeModel)?.id
    ?? models.find((model) => model.id === configuredLargeModel)?.id
    ?? models[0]!.id;
  const smallModel = models.find((model) => model.id === stored?.smallModel)?.id
    ?? models.find((model) => model.id === smallModelForProvider(providerId))?.id
    ?? models[0]!.id;
  const largeModelEntry = models.find((model) => model.id === largeModel)!;
  const desiredEffort = stored?.reasoningEffort ?? normalizeReasoningEffort(configuredReasoningEffort) ?? DEFAULT_RESEARCH_REASONING_EFFORT;
  const reasoningEffort = largeModelEntry.effortLevels.includes(desiredEffort)
    ? desiredEffort
    : preferredProviderReasoningEffort(largeModelEntry.effortLevels);
  return { largeModel, smallModel, reasoningEffort };
}

export function ProvidersSettingsView({
  openAiStatus,
  openAiOAuthResult,
  researchProviderOAuthResults,
  researchProviderStatuses,
  researchProviderModelCatalog,
  providerSettings,
  providerStatusesLoaded,
  busy,
  onRefreshOpenAi,
  onStartOpenAiOAuth,
  onStartResearchProviderOAuth,
  onForgetProviderSubscription = async () => undefined,
  onConfigureProviderApiKey = async () => undefined,
  onRemoveProviderApiKey = async () => undefined,
  onSetDefaultProviderId,
  onSetProviderModelDefaults,
  onSetProviderOptionalModelEnabled = async () => undefined,
  onSetProviderCyberPolicyRiskAcknowledged = async () => undefined,
  onSetProviderPreferredAuthenticationMethod = async () => undefined
}: {
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  researchProviderOAuthResults: Partial<Record<ResearchProviderId, ResearchProviderOAuthStartResult>>;
  researchProviderStatuses: ResearchProviderStatus[];
  researchProviderModelCatalog: ResearchProviderModelCatalog[];
  providerSettings: ProviderSettings | null;
  providerStatusesLoaded: boolean;
  busy: boolean;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
  onStartResearchProviderOAuth: (providerId: ResearchProviderId) => Promise<void>;
  onForgetProviderSubscription?: (providerId: ResearchModelProviderId) => Promise<void>;
  onConfigureProviderApiKey?: (providerId: ResearchModelProviderId, apiKey: string) => Promise<void>;
  onRemoveProviderApiKey?: (providerId: ResearchModelProviderId) => Promise<void>;
  onSetDefaultProviderId: (providerId: ResearchModelProviderId | null) => Promise<void>;
  onSetProviderModelDefaults: (providerId: ResearchModelProviderId, defaults: ProviderModelDefaults) => Promise<void>;
  onSetProviderOptionalModelEnabled?: (
    providerId: ResearchModelProviderId,
    modelId: string,
    enabled: boolean
  ) => Promise<void>;
  onSetProviderCyberPolicyRiskAcknowledged?: (
    providerId: ResearchModelProviderId,
    acknowledged: boolean
  ) => Promise<void>;
  onSetProviderPreferredAuthenticationMethod?: (
    providerId: ResearchModelProviderId,
    method: ProviderAuthenticationMethod
  ) => Promise<void>;
}): JSX.Element {
  const providers = providerSettingsOptions(openAiStatus, researchProviderStatuses);
  const configuredProviders = providers.filter((provider) => provider.configured);
  const availableProviders = providers.filter((provider) => !provider.configured);
  const configuredProviderKey = configuredProviders.map((provider) => provider.id).join('|');
  const providerSelectionReady = providerStatusesLoaded && providerSettings !== null;
  const preferredProviderId = providerSelectionReady
    ? resolvedDefaultProviderId(configuredProviders, providerSettings.defaultProviderId)
    : null;
  const providerSelectionInitialized = useRef(providerSelectionReady);
  const previouslyConfiguredProviderIds = useRef(new Set(
    providerSelectionReady ? configuredProviders.map((provider) => provider.id) : []));
  const initialAuthenticationProviderId = (() => {
    const runningProvider = researchProviderStatuses.find((provider) => provider.loginInProgress);
    if (runningProvider) return runningProvider.id;
    if (!openAiStatus?.configured && openAiOAuthResult) return 'openai-codex';
    return null;
  })();
  const [activeProviderId, setActiveProviderId] = useState<ProviderSettingsId | null>(
    initialAuthenticationProviderId ?? preferredProviderId
  );
  const [authenticationProviderId, setAuthenticationProviderId] = useState<ProviderSettingsId | null>(initialAuthenticationProviderId);
  const [apiKeyDialogProviderId, setApiKeyDialogProviderId] = useState<ResearchModelProviderId | null>(null);
  const defaultProviderUpdateRef = useRef<ResearchModelProviderId | null | undefined>(undefined);

  useEffect(() => {
    if (!providerStatusesLoaded || !providerSettings) return;
    const nextDefaultProviderId = resolvedDefaultProviderId(configuredProviders, providerSettings.defaultProviderId);
    if (nextDefaultProviderId === providerSettings.defaultProviderId || defaultProviderUpdateRef.current === nextDefaultProviderId) return;
    defaultProviderUpdateRef.current = nextDefaultProviderId;
    void onSetDefaultProviderId(nextDefaultProviderId).finally(() => {
      defaultProviderUpdateRef.current = undefined;
    });
  }, [configuredProviderKey, onSetDefaultProviderId, providerSettings, providerStatusesLoaded]);

  useEffect(() => {
    if (!providerSelectionReady) return;
    const configuredProviderIds = new Set(configuredProviders.map((provider) => provider.id));
    if (!providerSelectionInitialized.current) {
      providerSelectionInitialized.current = true;
      previouslyConfiguredProviderIds.current = configuredProviderIds;
      setActiveProviderId((current) => current ?? preferredProviderId);
      return;
    }
    const newlyConfiguredProvider = configuredProviders.find((provider) => !previouslyConfiguredProviderIds.current.has(provider.id));
    previouslyConfiguredProviderIds.current = configuredProviderIds;
    setActiveProviderId((current) => newlyConfiguredProvider?.id
      ?? (current && configuredProviderIds.has(current) ? current : preferredProviderId));
    if (newlyConfiguredProvider) {
      setAuthenticationProviderId((current) => current === newlyConfiguredProvider.id ? null : current);
    }
  }, [configuredProviderKey, preferredProviderId, providerSelectionReady]);

  const runningResearchProviderId = researchProviderStatuses.find((provider) => provider.loginInProgress)?.id ?? null;
  useEffect(() => {
    if (!runningResearchProviderId) return;
    setAuthenticationProviderId(runningResearchProviderId);
    setActiveProviderId(runningResearchProviderId);
  }, [runningResearchProviderId]);

  const authenticationProvider = availableProviders.find((provider) => provider.id === authenticationProviderId) ?? null;
  const viewProviders = authenticationProvider
    ? [...configuredProviders, authenticationProvider]
    : configuredProviders;
  const addableProviders = availableProviders.filter((provider) => provider.id !== authenticationProvider?.id);
  const activeProvider = viewProviders.find((provider) => provider.id === activeProviderId) ?? null;
  const activeModelCatalog = researchProviderModelCatalog.find((catalog) => catalog.providerId === activeProvider?.id) ?? null;
  const activeEnabledModelCatalog = activeModelCatalog
    ? filterEnabledProviderModelCatalogs([activeModelCatalog], providerSettings)[0] ?? null
    : null;
  const activeProviderStatus = activeProvider?.id && activeProvider.id !== 'openai-codex'
    ? researchProviderStatuses.find((provider) => provider.id === activeProvider.id) ?? null
    : null;
  const activeModelDefaults = activeProvider
    ? resolvedProviderModelDefaults(
        activeProvider.id,
        activeEnabledModelCatalog,
        activeProvider.id === 'openai-codex' ? openAiStatus?.defaultModel ?? null : activeProviderStatus?.defaultModel ?? null,
        activeProvider.id === 'openai-codex' ? openAiStatus?.defaultReasoningEffort ?? null : null,
        providerSettings?.modelDefaults[activeProvider.id]
      )
    : null;
  const authenticateProvider = (providerId: ProviderSettingsId): void => {
    setAuthenticationProviderId(providerId);
    setActiveProviderId(providerId);
    if (providerId === 'openai-codex') {
      void onStartOpenAiOAuth();
    } else {
      void onStartResearchProviderOAuth(providerId);
    }
  };
  const showProvider = (providerId: ProviderSettingsId): void => {
    setAuthenticationProviderId(providerId);
    setActiveProviderId(providerId);
  };
  const refresh = (): void => {
    void onRefreshOpenAi();
  };

  return (
    <div className="settings-page provider-settings-page">
      <ProviderSettingsTabs
        activeProviderId={activeProviderId}
        availableProviders={addableProviders}
        busy={busy}
        viewProviders={viewProviders}
        configuredProviders={configuredProviders}
        defaultProviderId={providerSettings?.defaultProviderId ?? null}
        onActivate={setActiveProviderId}
        onAuthenticate={showProvider}
        onRefreshProvider={refresh}
        onSetDefaultProviderId={(providerId) => void onSetDefaultProviderId(providerId)}
      />
      {activeProvider?.id === 'openai-codex' ? (
        <OpenAiProviderCard
          busy={busy}
          openAiOAuthResult={openAiOAuthResult}
          openAiStatus={openAiStatus}
          onAuthenticate={() => authenticateProvider('openai-codex')}
          onForgetSubscription={() => void onForgetProviderSubscription('openai-codex')}
          onConfigureApiKey={setApiKeyDialogProviderId}
          onRemoveApiKey={() => void onRemoveProviderApiKey('openai-codex')}
          modelCatalog={activeEnabledModelCatalog}
          fullModelCatalog={activeModelCatalog}
          modelDefaults={activeModelDefaults}
          onSetModelDefaults={(defaults) => void onSetProviderModelDefaults('openai-codex', defaults)}
          enabledOptionalModelIds={providerSettings?.enabledOptionalModels?.['openai-codex'] ?? []}
          disabledOptionalModelIds={providerSettings?.disabledOptionalModels?.['openai-codex'] ?? []}
          onSetOptionalModelEnabled={(modelId, enabled) =>
            void onSetProviderOptionalModelEnabled('openai-codex', modelId, enabled)}
          policyRiskAcknowledged={providerSettings?.cyberPolicyRiskAcknowledgements?.['openai-codex'] === true}
          onSetPolicyRiskAcknowledged={(acknowledged) =>
            void onSetProviderCyberPolicyRiskAcknowledged('openai-codex', acknowledged)}
          preferredAuthenticationMethod={providerSettings?.preferredAuthenticationMethods?.['openai-codex'] ?? 'subscription'}
          onSetPreferredAuthenticationMethod={(method) =>
            void onSetProviderPreferredAuthenticationMethod('openai-codex', method)}
        />
      ) : activeProvider ? (
        <ResearchProviderCard
          busy={busy}
          provider={researchProviderStatuses.find((provider) => provider.id === activeProvider.id)!}
          result={researchProviderOAuthResults[activeProvider.id] ?? null}
          onAuthenticate={() => authenticateProvider(activeProvider.id)}
          onForgetSubscription={() => void onForgetProviderSubscription(activeProvider.id)}
          onConfigureApiKey={setApiKeyDialogProviderId}
          onRemoveApiKey={() => void onRemoveProviderApiKey(activeProvider.id)}
          modelCatalog={activeEnabledModelCatalog}
          fullModelCatalog={activeModelCatalog}
          modelDefaults={activeModelDefaults}
          onSetModelDefaults={(defaults) => void onSetProviderModelDefaults(activeProvider.id, defaults)}
          enabledOptionalModelIds={providerSettings?.enabledOptionalModels?.[activeProvider.id] ?? []}
          disabledOptionalModelIds={providerSettings?.disabledOptionalModels?.[activeProvider.id] ?? []}
          onSetOptionalModelEnabled={(modelId, enabled) =>
            void onSetProviderOptionalModelEnabled(activeProvider.id, modelId, enabled)}
          policyRiskAcknowledged={providerSettings?.cyberPolicyRiskAcknowledgements?.[activeProvider.id] === true}
          onSetPolicyRiskAcknowledged={(acknowledged) =>
            void onSetProviderCyberPolicyRiskAcknowledged(activeProvider.id, acknowledged)}
          preferredAuthenticationMethod={providerSettings?.preferredAuthenticationMethods?.[activeProvider.id] ?? 'subscription'}
          onSetPreferredAuthenticationMethod={(method) =>
            void onSetProviderPreferredAuthenticationMethod(activeProvider.id, method)}
        />
      ) : (
        <section className="provider-card provider-settings-empty">
          <KeyRound size={20} aria-hidden="true" />
          <div>
            <h4>No providers configured</h4>
            <p>Use the plus button above to configure a research provider.</p>
          </div>
        </section>
      )}
      {apiKeyDialogProviderId ? (
        <ProviderApiKeyDialog
          providerId={apiKeyDialogProviderId}
          busy={busy}
          onCancel={() => setApiKeyDialogProviderId(null)}
          onConfirm={async (apiKey) => {
            await onConfigureProviderApiKey(apiKeyDialogProviderId, apiKey);
            setApiKeyDialogProviderId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ProviderSettingsTabs({
  activeProviderId,
  availableProviders,
  busy,
  viewProviders,
  configuredProviders,
  defaultProviderId,
  onActivate,
  onAuthenticate,
  onRefreshProvider,
  onSetDefaultProviderId
}: {
  activeProviderId: ProviderSettingsId | null;
  availableProviders: readonly ProviderSettingsOption[];
  busy: boolean;
  viewProviders: readonly ProviderSettingsOption[];
  configuredProviders: readonly ProviderSettingsOption[];
  defaultProviderId: ResearchModelProviderId | null;
  onActivate: (providerId: ProviderSettingsId) => void;
  onAuthenticate: (providerId: ProviderSettingsId) => void;
  onRefreshProvider: (providerId: ProviderSettingsId) => void;
  onSetDefaultProviderId: (providerId: ResearchModelProviderId | null) => void;
}): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (availableProviders.length === 0) setPickerOpen(false);
  }, [availableProviders.length]);

  return (
    <header className="research-side-view-header provider-settings-tab-header">
      <div className="research-side-view-tabs" role="tablist" aria-label="Provider views">
        {viewProviders.map((provider) => (
          <div
            className={`research-side-view-tab provider-settings-tab ${activeProviderId === provider.id ? 'active' : ''} ${provider.authenticationRunning ? 'authenticating' : ''}`.trim()}
            key={provider.id}
          >
            <button
              type="button"
              className="research-side-view-tab-activate"
              role="tab"
              aria-selected={activeProviderId === provider.id}
              aria-busy={provider.authenticationRunning}
              onClick={() => onActivate(provider.id)}
            >
              <ProviderIcon
                className="provider-settings-tab-icon"
                provider={provider.id}
                size={15}
                aria-hidden="true"
              />
              <span>{provider.name}</span>
            </button>
            <button
              type="button"
              className="research-side-view-tab-close provider-settings-tab-refresh"
              aria-label={`Refresh ${provider.name}`}
              title={`Refresh ${provider.name}`}
              disabled={busy}
              onClick={() => onRefreshProvider(provider.id)}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {availableProviders.length > 0 ? (
        <div className={`research-side-view-picker ${pickerOpen ? 'open' : ''}`} ref={pickerRef}>
          <button
            type="button"
            className="research-side-view-picker-trigger"
            aria-label="Add provider"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            title="Add provider"
            onClick={() => setPickerOpen((current) => !current)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          {pickerOpen ? (
            <div className="research-side-view-picker-menu provider-settings-picker-menu" role="menu">
              {availableProviders.map((provider) => (
                <button
                  type="button"
                  role="menuitem"
                  key={provider.id}
                  disabled={busy || provider.authenticationRunning}
                  onClick={() => {
                    onAuthenticate(provider.id);
                    setPickerOpen(false);
                  }}
                >
                  <ProviderIcon
                    className="provider-settings-picker-icon"
                    provider={provider.id}
                    size={15}
                    aria-hidden="true"
                  />
                  <span>{provider.name}{provider.authenticationRunning ? ' — authenticating' : ''}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="research-side-view-trailing provider-settings-default-control">
        <span>Lead</span>
        <select
          value={configuredProviders.some((provider) => provider.id === defaultProviderId) ? defaultProviderId ?? '' : ''}
          disabled={busy}
          title="Lead"
          aria-label="Lead"
          onChange={(event) => onSetDefaultProviderId(event.target.value ? event.target.value as ResearchModelProviderId : null)}
        >
          {defaultProviderPickerOptions(configuredProviders).map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </header>
  );
}

function OpenAiProviderCard({
  busy,
  openAiOAuthResult,
  openAiStatus,
  onAuthenticate,
  onForgetSubscription,
  onConfigureApiKey,
  onRemoveApiKey,
  modelCatalog,
  fullModelCatalog,
  modelDefaults,
  onSetModelDefaults,
  enabledOptionalModelIds,
  disabledOptionalModelIds,
  onSetOptionalModelEnabled,
  policyRiskAcknowledged,
  onSetPolicyRiskAcknowledged,
  preferredAuthenticationMethod,
  onSetPreferredAuthenticationMethod
}: {
  busy: boolean;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  openAiStatus: OpenAiAccountStatus | null;
  onAuthenticate: () => void;
  onForgetSubscription: () => void;
  onConfigureApiKey: (providerId: ResearchModelProviderId) => void;
  onRemoveApiKey: () => void;
  modelCatalog: ResearchProviderModelCatalog | null;
  fullModelCatalog: ResearchProviderModelCatalog | null;
  modelDefaults: ProviderModelDefaults | null;
  onSetModelDefaults: (defaults: ProviderModelDefaults) => void;
  enabledOptionalModelIds: readonly string[];
  disabledOptionalModelIds: readonly string[];
  onSetOptionalModelEnabled: (modelId: string, enabled: boolean) => void;
  policyRiskAcknowledged: boolean;
  onSetPolicyRiskAcknowledged: (acknowledged: boolean) => void;
  preferredAuthenticationMethod: ProviderAuthenticationMethod;
  onSetPreferredAuthenticationMethod: (method: ProviderAuthenticationMethod) => void;
}): JSX.Element {
  const readiness = openAiStatus?.readiness ?? 'not_configured';
  const subscriptionState: ProviderAuthenticationState = openAiStatus?.loginInProgress
    ? 'authenticating'
    : openAiStatus?.subscriptionConfigured
      ? 'configured'
      : readiness === 'oauth_command_failed'
        ? 'needs-attention'
        : openAiStatus?.codexCliAvailable === false
          ? 'unavailable'
          : 'not-configured';
  return (
    <section className={`provider-card readiness-${stateClass(readiness)}`} role="tabpanel" aria-label="OpenAI provider settings">
      <div className="provider-heading provider-settings-provider-heading">
        <ProviderIcon className="provider-settings-heading-icon" provider="openai-codex" size={18} aria-hidden="true" />
        <div className="provider-settings-heading-title">
          <h4>OpenAI</h4>
          <ProviderHealthIndicator state={openAiStatus?.loginInProgress ? 'authenticating' : openAiStatus?.configured && (readiness === 'oauth_ready' || readiness === 'development_fallback') ? 'healthy' : 'unhealthy'} />
        </div>
        <ProviderModelDefaultsControls
          busy={busy}
          catalog={modelCatalog}
          defaults={modelDefaults}
          onChange={onSetModelDefaults}
        />
      </div>
      <ProviderCyberPolicyAcknowledgement
        providerId="openai-codex"
        acknowledged={policyRiskAcknowledged}
        busy={busy}
        onChange={onSetPolicyRiskAcknowledged}
      />
      <ProviderOptionalModelsControls
        busy={busy}
        catalog={fullModelCatalog}
        enabledModelIds={enabledOptionalModelIds}
        disabledModelIds={disabledOptionalModelIds}
        providerId="openai-codex"
        onChange={onSetOptionalModelEnabled}
      />
      <ProviderAuthenticationSection
        providerId="openai-codex"
        subscriptionState={subscriptionState}
        apiKeyConfigured={openAiStatus?.apiKeyConfigured ?? false}
        busy={busy}
        subscriptionDisabled={false}
        result={openAiOAuthResult}
        preferredMethod={preferredAuthenticationMethod}
        onAuthenticate={onAuthenticate}
        onForgetSubscription={onForgetSubscription}
        onConfigureApiKey={onConfigureApiKey}
        onRemoveApiKey={onRemoveApiKey}
        onMarkPreferred={onSetPreferredAuthenticationMethod}
      />
    </section>
  );
}

function ProviderOptionalModelsControls({
  busy,
  catalog,
  enabledModelIds,
  disabledModelIds,
  providerId,
  onChange
}: {
  busy: boolean;
  catalog: ResearchProviderModelCatalog | null;
  enabledModelIds: readonly string[];
  disabledModelIds: readonly string[];
  providerId: ResearchModelProviderId;
  onChange: (modelId: string, enabled: boolean) => void;
}): JSX.Element | null {
  const availableModelIds = new Set((catalog?.models ?? []).map((model) => model.id));
  const optionalModels = OPTIONAL_PROVIDER_MODELS.filter((model) => model.providerId === providerId);
  if (optionalModels.length === 0) return null;
  return (
    <div className="provider-optional-models" aria-label="Optional models">
      <h3>Optional models</h3>
      {optionalModels.map((model) => {
        const available = availableModelIds.has(model.modelId);
        return (
          <label key={model.modelId}>
            <input
              type="checkbox"
              checked={isOptionalProviderModelEnabled({
                enabledOptionalModels: { [providerId]: [...enabledModelIds] },
                disabledOptionalModels: { [providerId]: [...disabledModelIds] }
              }, providerId, model.modelId)}
              disabled={busy || !available}
              onChange={(event) => onChange(model.modelId, event.target.checked)}
            />
            <span className="provider-optional-model-copy">
              <strong>{model.name}</strong>
              <small>{model.accessNote}{available ? '' : ' Not available in the installed Honeycrisp model catalog.'}</small>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function ResearchProviderCard({
  provider,
  result,
  busy,
  onAuthenticate,
  onForgetSubscription,
  onConfigureApiKey,
  onRemoveApiKey,
  modelCatalog,
  fullModelCatalog,
  modelDefaults,
  onSetModelDefaults,
  enabledOptionalModelIds,
  disabledOptionalModelIds,
  onSetOptionalModelEnabled,
  policyRiskAcknowledged,
  onSetPolicyRiskAcknowledged,
  preferredAuthenticationMethod,
  onSetPreferredAuthenticationMethod
}: {
  provider: ResearchProviderStatus;
  result: ResearchProviderOAuthStartResult | null;
  busy: boolean;
  onAuthenticate: () => void;
  onForgetSubscription: () => void;
  onConfigureApiKey: (providerId: ResearchModelProviderId) => void;
  onRemoveApiKey: () => void;
  modelCatalog: ResearchProviderModelCatalog | null;
  fullModelCatalog: ResearchProviderModelCatalog | null;
  modelDefaults: ProviderModelDefaults | null;
  onSetModelDefaults: (defaults: ProviderModelDefaults) => void;
  enabledOptionalModelIds: readonly string[];
  disabledOptionalModelIds: readonly string[];
  onSetOptionalModelEnabled: (modelId: string, enabled: boolean) => void;
  policyRiskAcknowledged: boolean;
  onSetPolicyRiskAcknowledged: (acknowledged: boolean) => void;
  preferredAuthenticationMethod: ProviderAuthenticationMethod;
  onSetPreferredAuthenticationMethod: (method: ProviderAuthenticationMethod) => void;
}): JSX.Element {
  const providerName = providerCompanyName(provider.id);
  const subscriptionState: ProviderAuthenticationState = provider.loginInProgress
    ? 'authenticating'
    : provider.subscriptionConfigured
      ? 'configured'
      : provider.readiness === 'unavailable'
        ? 'unavailable'
        : 'not-configured';
  return (
    <section className={`provider-card readiness-${stateClass(provider.readiness)}`} role="tabpanel" aria-label={`${providerName} provider settings`}>
      <div className="provider-heading provider-settings-provider-heading">
        <ProviderIcon className="provider-settings-heading-icon" provider={provider.id} size={18} aria-hidden="true" />
        <div className="provider-settings-heading-title">
          <h4>{providerName}</h4>
          <ProviderHealthIndicator state={provider.loginInProgress ? 'authenticating' : provider.configured && provider.readiness === 'ready' ? 'healthy' : 'unhealthy'} />
        </div>
        <ProviderModelDefaultsControls
          busy={busy}
          catalog={modelCatalog}
          defaults={modelDefaults}
          onChange={onSetModelDefaults}
        />
      </div>

      <ProviderCyberPolicyAcknowledgement
        providerId={provider.id}
        acknowledged={policyRiskAcknowledged}
        busy={busy || provider.loginInProgress}
        onChange={onSetPolicyRiskAcknowledged}
      />

      <ProviderOptionalModelsControls
        busy={busy || provider.loginInProgress}
        catalog={fullModelCatalog}
        enabledModelIds={enabledOptionalModelIds}
        disabledModelIds={disabledOptionalModelIds}
        providerId={provider.id}
        onChange={onSetOptionalModelEnabled}
      />

      <ProviderAuthenticationSection
        providerId={provider.id}
        subscriptionState={subscriptionState}
        apiKeyConfigured={provider.apiKeyConfigured}
        busy={busy}
        subscriptionDisabled={provider.loginInProgress || (provider.id === 'anthropic' && !policyRiskAcknowledged)}
        result={result}
        preferredMethod={preferredAuthenticationMethod}
        onAuthenticate={onAuthenticate}
        onForgetSubscription={onForgetSubscription}
        onConfigureApiKey={onConfigureApiKey}
        onRemoveApiKey={onRemoveApiKey}
        onMarkPreferred={onSetPreferredAuthenticationMethod}
      />
    </section>
  );
}

function ProviderCyberPolicyAcknowledgement({
  providerId,
  acknowledged,
  busy,
  onChange
}: {
  providerId: ResearchModelProviderId;
  acknowledged: boolean;
  busy: boolean;
  onChange: (acknowledged: boolean) => void;
}): JSX.Element {
  const detail = providerId === 'openai-codex'
    ? 'Cybersecurity use is intended for OpenAI Trusted Access for Cyber members. Program membership does not waive OpenAI policy requirements: requests may still be blocked or treated as usage violations.'
    : providerId === 'anthropic'
      ? 'Subscription sign-in is experimental and only intended for Anthropic Cyber Verification Program members. CVP membership does not waive Anthropic\'s Usage Policy: requests may still be blocked or treated as usage violations. Beale delegates Claude sessions to the official Claude Agent SDK and Claude Code CLI; it does not copy or replay subscription tokens.'
      : 'Cybersecurity use remains subject to xAI policy requirements. Requests may be blocked or treated as usage violations.';
  const label = providerId === 'openai-codex'
    ? 'I confirm this account has OpenAI Trusted Access for Cyber membership and I accept the policy-use risk.'
    : providerId === 'anthropic'
      ? 'I confirm this account is enrolled in Anthropic\'s Cyber Verification Program and I accept the usage-policy risk.'
      : 'I accept the policy-use risk for cybersecurity research with xAI.';
  return (
    <div className="provider-policy-warning">
      <h3>Acknowledgment</h3>
      <p className="provider-detail provider-billing-note">{detail}</p>
      <label className="provider-risk-acknowledgement">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={busy}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
    </div>
  );
}

function ProviderModelDefaultsControls({
  busy,
  catalog,
  defaults,
  onChange
}: {
  busy: boolean;
  catalog: ResearchProviderModelCatalog | null;
  defaults: ProviderModelDefaults | null;
  onChange: (defaults: ProviderModelDefaults) => void;
}): JSX.Element {
  const models = catalog?.models ?? [];
  const largeModel = models.find((model) => model.id === defaults?.largeModel) ?? null;
  const effortLevels = largeModel?.effortLevels ?? [];
  const disabled = busy || !defaults || models.length === 0;
  return (
    <div className="provider-model-defaults" aria-label="Provider model defaults">
      <div className="provider-model-defaults-heading" aria-hidden="true">
        <span>Defaults</span>
      </div>
      <span className="provider-model-defaults-divider" aria-hidden="true" />
      <label>
        <span>Large</span>
        <select
          value={defaults?.largeModel ?? ''}
          disabled={disabled}
          onChange={(event) => {
            if (!defaults) return;
            const model = models.find((candidate) => candidate.id === event.target.value);
            if (!model) return;
            const reasoningEffort = model.effortLevels.includes(defaults.reasoningEffort)
              ? defaults.reasoningEffort
              : preferredProviderReasoningEffort(model.effortLevels);
            onChange({ ...defaults, largeModel: model.id, reasoningEffort });
          }}
        >
          {models.map((model) => <option value={model.id} key={model.id}>{providerModelOptionLabel(catalog?.providerId, model)}</option>)}
        </select>
      </label>
      <label>
        <span>Small</span>
        <select
          value={defaults?.smallModel ?? ''}
          disabled={disabled}
          onChange={(event) => defaults && onChange({ ...defaults, smallModel: event.target.value })}
        >
          {models.map((model) => <option value={model.id} key={model.id}>{providerModelOptionLabel(catalog?.providerId, model)}</option>)}
        </select>
      </label>
      <label>
        <span>Reasoning</span>
        <select
          value={defaults?.reasoningEffort ?? ''}
          disabled={disabled || effortLevels.length === 0}
          onChange={(event) => defaults && onChange({ ...defaults, reasoningEffort: event.target.value as ResearchModelEffortLevel })}
        >
          {effortLevels.map((effort) => <option value={effort} key={effort}>{reasoningEffortLabel(effort)}</option>)}
        </select>
      </label>
    </div>
  );
}

function providerModelOptionLabel(providerId: ResearchModelProviderId | undefined, model: ResearchProviderModel): string {
  return providerId ? researchModelNameLabel(providerId, model.name) : model.name;
}

function normalizeReasoningEffort(value: string | null): ResearchModelEffortLevel | null {
  return value === 'off' || value === 'minimal' || value === 'low' || value === 'medium'
    || value === 'high' || value === 'xhigh' || value === 'max'
    ? value
    : null;
}

function preferredProviderReasoningEffort(levels: readonly ResearchModelEffortLevel[]): ResearchModelEffortLevel {
  if (levels.includes('high')) return 'high';
  if (levels.includes('medium')) return 'medium';
  return levels[0] ?? 'off';
}

function reasoningEffortLabel(effort: ResearchModelEffortLevel): string {
  if (effort === 'xhigh') return 'XHigh';
  return `${effort.slice(0, 1).toUpperCase()}${effort.slice(1)}`;
}

function ProviderOAuthResult({ result }: { result: OpenAiOAuthStartResult | ResearchProviderOAuthStartResult }): JSX.Element {
  return (
    <div className="provider-oauth-result">
      <strong>{result.detail}</strong>
      {result.verificationUri ? <code>{result.verificationUri}</code> : null}
      {result.userCode ? (
        <div>
          <span>Code</span>
          <code>{result.userCode}</code>
        </div>
      ) : null}
      {result.instructions && !result.verificationUri ? <pre>{result.instructions}</pre> : null}
    </div>
  );
}

export function settingsSectionLabel(section: SettingsSection): string {
  switch (section) {
    case 'providers':
      return 'Providers';
    case 'memory':
      return 'Memory';
    default:
      return 'General';
  }
}
