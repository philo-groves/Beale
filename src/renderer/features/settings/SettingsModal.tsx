import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { DEFAULT_RESEARCH_MODEL } from '../../../shared/modelDefaults';
import { Bug, KeyRound, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import type {
  DeveloperSettings,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  ResearchProviderId,
  ResearchProviderOAuthStartResult,
  ResearchProviderStatus,
  ShellOptions
} from '@shared/types';
import { Modal } from '../../app/Modal';
import { StatusPill } from '../../app/StatusPill';
import { stateClass } from '../../lib/formatting';

export type SettingsSection = 'general' | 'providers' | 'shell' | 'developer';

export function SettingsModal({
  section,
  developerSettings,
  shellOptions,
  workspaceName,
  openAiStatus,
  openAiOAuthResult,
  researchProviderOAuthResults,
  researchProviderStatuses,
  busy,
  onChangeSection,
  onClose,
  onSetDeveloperModeEnabled,
  onSaveShellOptions,
  onRefreshOpenAi,
  onStartOpenAiOAuth,
  onStartResearchProviderOAuth
}: {
  section: SettingsSection;
  developerSettings: DeveloperSettings | null;
  shellOptions: ShellOptions | null;
  workspaceName: string | null;
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  researchProviderOAuthResults: Partial<Record<ResearchProviderId, ResearchProviderOAuthStartResult>>;
  researchProviderStatuses: ResearchProviderStatus[];
  busy: boolean;
  onChangeSection: (section: SettingsSection) => void;
  onClose: () => void;
  onSetDeveloperModeEnabled: (enabled: boolean) => Promise<void>;
  onSaveShellOptions: (options: ShellOptions) => Promise<void>;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
  onStartResearchProviderOAuth: (providerId: ResearchProviderId) => Promise<void>;
}): JSX.Element {
  const sections: SettingsSection[] = ['general', 'providers', 'shell', 'developer'];
  const activeSection = sections.includes(section) ? section : 'general';

  return (
    <Modal
      title="Settings"
      wide
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="settings-layout">
        <nav className="settings-sections" aria-label="Settings sections">
          {sections.map((item) => (
            <button type="button" className={activeSection === item ? 'active' : ''} key={item} onClick={() => onChangeSection(item)}>
              {settingsSectionLabel(item)}
            </button>
          ))}
        </nav>
        <section className="settings-view">
          {activeSection === 'general' ? (
            <GeneralSettingsView workspaceName={workspaceName} />
          ) : activeSection === 'providers' ? (
            <ProvidersSettingsView
              busy={busy}
              openAiOAuthResult={openAiOAuthResult}
              openAiStatus={openAiStatus}
              researchProviderOAuthResults={researchProviderOAuthResults}
              researchProviderStatuses={researchProviderStatuses}
              onRefreshOpenAi={onRefreshOpenAi}
              onStartOpenAiOAuth={onStartOpenAiOAuth}
              onStartResearchProviderOAuth={onStartResearchProviderOAuth}
            />
          ) : activeSection === 'shell' ? (
            <ShellOptionsView busy={busy} options={shellOptions} onSave={onSaveShellOptions} />
          ) : (
            <DeveloperSettingsView busy={busy} developerSettings={developerSettings} onSetDeveloperModeEnabled={onSetDeveloperModeEnabled} />
          )}
        </section>
      </div>
    </Modal>
  );
}

function ShellOptionsView({
  options,
  busy,
  onSave
}: {
  options: ShellOptions | null;
  busy: boolean;
  onSave: (options: ShellOptions) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<ShellOptions>(options ?? { defaultConcurrency: 4, utilities: { sudo: 0 } });
  const [newUtility, setNewUtility] = useState('');
  useEffect(() => {
    if (options) setDraft({ defaultConcurrency: options.defaultConcurrency, utilities: { ...options.utilities } });
  }, [options]);
  const utilities = useMemo(
    () => Object.entries(draft.utilities).sort(([left], [right]) => (left === 'sudo' ? -1 : right === 'sudo' ? 1 : left.localeCompare(right))),
    [draft.utilities]
  );
  const addUtility = (): void => {
    const utility = newUtility.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(utility) || utility in draft.utilities) return;
    setDraft((current) => ({ ...current, utilities: { ...current.utilities, [utility]: current.defaultConcurrency } }));
    setNewUtility('');
  };
  const setConcurrency = (utility: string, concurrency: number): void => {
    setDraft((current) => ({ ...current, utilities: { ...current.utilities, [utility]: boundedConcurrency(concurrency) } }));
  };
  const removeUtility = (utility: string): void => {
    setDraft((current) => {
      const utilities = { ...current.utilities };
      delete utilities[utility];
      return { ...current, utilities };
    });
  };

  return (
    <div className="settings-page shell-options-page">
      <div className="settings-page-header">
        <h3>Shell Options</h3>
        <button type="button" className="primary-button" disabled={busy || !options} onClick={() => void onSave(draft)}>
          Save Changes
        </button>
      </div>
      <section className="provider-card shell-options-card">
        <div className="provider-heading">
          <div className="status-icon"><Terminal size={18} /></div>
          <div>
            <h4>Utility Concurrency</h4>
            <p>Limits apply harness-wide to each executable. A limit of 0 disables that utility before Honeycrisp starts it.</p>
          </div>
        </div>
        <label className="shell-option-default">
          <span>Default per utility</span>
          <input
            type="number"
            min={0}
            max={64}
            step={1}
            value={draft.defaultConcurrency}
            disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, defaultConcurrency: boundedConcurrency(event.target.valueAsNumber) }))}
          />
        </label>
        <div className="shell-utility-list">
          {utilities.map(([utility, concurrency]) => (
            <div className="shell-utility-row" key={utility}>
              <code>{utility}</code>
              <input
                aria-label={`${utility} concurrency`}
                type="number"
                min={0}
                max={64}
                step={1}
                value={concurrency}
                disabled={busy}
                onChange={(event) => setConcurrency(utility, event.target.valueAsNumber)}
              />
              <button type="button" title={`Remove ${utility} override`} disabled={busy} onClick={() => removeUtility(utility)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="shell-utility-add">
          <input
            value={newUtility}
            disabled={busy}
            placeholder="Utility name"
            aria-label="Utility name"
            onChange={(event) => setNewUtility(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addUtility();
              }
            }}
          />
          <button type="button" disabled={busy || !newUtility.trim()} onClick={addUtility}>
            <Plus size={14} /> Add Override
          </button>
        </div>
        <p className="provider-detail">Commands run with the current user's host privileges. Utility limits are process-broker controls, not operating-system isolation.</p>
      </section>
    </div>
  );
}

function boundedConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(64, Math.trunc(value)));
}

function GeneralSettingsView({ workspaceName }: { workspaceName: string | null }): JSX.Element {
  return (
    <div className="settings-page general-settings-page">
      <div className="settings-page-header">
        <h3>General</h3>
      </div>
      <section className="provider-card readiness-enabled">
        <div className="provider-heading">
          <div>
            <h4>{workspaceName || 'Current Workspace'}</h4>
            <p>Honeycrisp runs with the current user's host privileges. Launch Beale and Honeycrisp inside your own VM or container when you want operating-system isolation.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function DeveloperSettingsView({
  developerSettings,
  busy,
  onSetDeveloperModeEnabled
}: {
  developerSettings: DeveloperSettings | null;
  busy: boolean;
  onSetDeveloperModeEnabled: (enabled: boolean) => Promise<void>;
}): JSX.Element {
  const enabled = developerSettings?.developerModeEnabled ?? false;
  return (
    <div className="settings-page developer-settings-page">
      <div className="settings-page-header">
        <h3>Developer</h3>
      </div>
      <section className={`provider-card readiness-${enabled ? 'enabled' : 'disabled'}`}>
        <div className="provider-heading">
          <div className="status-icon">
            <Bug size={18} />
          </div>
          <div>
            <h4>Developer Mode</h4>
            <p>Enables Beale diagnostics. Debug profiling starts automatically while this mode is on.</p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => void onSetDeveloperModeEnabled(event.target.checked)}
            />
            <span>Enabled Developer Mode</span>
          </label>
        </div>
      </section>
    </div>
  );
}

function ProvidersSettingsView({
  openAiStatus,
  openAiOAuthResult,
  researchProviderOAuthResults,
  researchProviderStatuses,
  busy,
  onRefreshOpenAi,
  onStartOpenAiOAuth,
  onStartResearchProviderOAuth
}: {
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  researchProviderOAuthResults: Partial<Record<ResearchProviderId, ResearchProviderOAuthStartResult>>;
  researchProviderStatuses: ResearchProviderStatus[];
  busy: boolean;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
  onStartResearchProviderOAuth: (providerId: ResearchProviderId) => Promise<void>;
}): JSX.Element {
  const readiness = openAiStatus?.readiness ?? 'not_configured';
  const authenticateLabel = readiness === 'oauth_ready' ? 'Re-authenticate' : 'Authenticate';
  const authenticate = (): void => {
    void onStartOpenAiOAuth();
  };
  const refresh = (): void => {
    void onRefreshOpenAi();
  };

  return (
    <div className="settings-page provider-settings-page">
      <div className="settings-page-header">
        <h3>Providers</h3>
        <button type="button" title="Refresh provider status" disabled={busy} onClick={refresh}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <section className={`provider-card readiness-${stateClass(readiness)}`}>
        <div className="provider-heading">
          <div className="status-icon">
            <KeyRound size={18} />
          </div>
          <div>
            <h4>OpenAI (Codex)</h4>
            <p>{openAiStatus?.label ?? 'Checking provider status'}</p>
          </div>
          <StatusPill status={readiness} />
        </div>

        <div className="provider-grid">
          <div>
            <span>Source</span>
            <strong>{openAiStatus?.source ?? 'unknown'}</strong>
          </div>
          <div>
            <span>Transport</span>
            <strong>{openAiStatus?.preferredTransport ?? 'sse_http'}</strong>
          </div>
          <div>
            <span>Model</span>
            <strong>{openAiStatus?.defaultModel ?? DEFAULT_RESEARCH_MODEL}</strong>
          </div>
          <div>
            <span>Boundary</span>
            <strong>{openAiStatus?.credentialsHostOnly ? 'host only' : 'review'}</strong>
          </div>
        </div>

        <p className="provider-detail">{openAiStatus?.statusDetail ?? 'OpenAI status has not loaded yet.'}</p>
        {openAiStatus?.credentialHint ? <p className="provider-detail muted">{openAiStatus.credentialHint}</p> : null}

        {openAiOAuthResult ? (
          <div className="provider-oauth-result">
            <strong>{openAiOAuthResult.detail}</strong>
            {openAiOAuthResult.verificationUri ? <code>{openAiOAuthResult.verificationUri}</code> : null}
            {openAiOAuthResult.userCode ? (
              <div>
                <span>Code</span>
                <code>{openAiOAuthResult.userCode}</code>
              </div>
            ) : null}
            {openAiOAuthResult.instructions && !openAiOAuthResult.verificationUri ? <pre>{openAiOAuthResult.instructions}</pre> : null}
          </div>
        ) : null}

        <div className="provider-actions">
          <button className="primary-button" type="button" disabled={busy || openAiStatus?.codexCliAvailable === false} onClick={authenticate}>
            <KeyRound size={15} />
            {authenticateLabel}
          </button>
          {openAiStatus?.setupCommand ? (
            <div className="command-row">
              <Terminal size={15} />
              <code>{openAiStatus.setupCommand}</code>
            </div>
          ) : null}
        </div>
      </section>
      {researchProviderStatuses.map((provider) => (
        <ResearchProviderCard
          key={provider.id}
          provider={provider}
          result={researchProviderOAuthResults[provider.id] ?? null}
          busy={busy}
          onAuthenticate={() => void onStartResearchProviderOAuth(provider.id)}
        />
      ))}
    </div>
  );
}

function ResearchProviderCard({
  provider,
  result,
  busy,
  onAuthenticate
}: {
  provider: ResearchProviderStatus;
  result: ResearchProviderOAuthStartResult | null;
  busy: boolean;
  onAuthenticate: () => void;
}): JSX.Element {
  const authenticateLabel = provider.loginInProgress
    ? 'Authentication Running'
    : provider.configured
      ? 'Re-authenticate'
      : 'Authenticate';
  const authLabel = provider.credentialType === 'api_key'
    ? 'API key'
    : provider.credentialType === 'oauth'
      ? 'OAuth'
      : provider.configured
        ? 'Host environment'
        : 'Not configured';

  return (
    <section className={`provider-card readiness-${stateClass(provider.readiness)}`}>
      <div className="provider-heading">
        <div className="status-icon">
          <KeyRound size={18} />
        </div>
        <div>
          <h4>{provider.name}</h4>
          <p>{provider.configured ? `${authLabel} ready` : provider.loginInProgress ? 'Waiting for provider sign-in' : 'Provider authentication required'}</p>
        </div>
        <StatusPill status={provider.readiness} />
      </div>

      <div className="provider-grid">
        <div>
          <span>Source</span>
          <strong>{provider.source ?? 'not configured'}</strong>
        </div>
        <div>
          <span>Authentication</span>
          <strong>{authLabel}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{provider.defaultModel ?? 'unavailable'}</strong>
        </div>
        <div>
          <span>Boundary</span>
          <strong>{provider.credentialsHostOnly ? 'host only' : 'review'}</strong>
        </div>
      </div>

      <p className="provider-detail">{provider.statusDetail}</p>
      <p className="provider-detail muted">
        API-key authentication is also available through <code>{provider.apiKeyEnvironmentVariable}</code> in Beale's host environment.
      </p>
      {provider.id === 'anthropic' ? (
        <p className="provider-detail provider-billing-note">Claude Pro/Max use from third-party harnesses is billed as API usage rather than drawing from plan limits.</p>
      ) : null}

      {result ? <ProviderOAuthResult result={result} /> : null}

      <div className="provider-actions">
        <button className="primary-button" type="button" disabled={busy || provider.loginInProgress || provider.readiness === 'unavailable'} onClick={onAuthenticate}>
          <KeyRound size={15} />
          {authenticateLabel}
        </button>
        <div className="command-row">
          <Terminal size={15} />
          <code>honeycrisp auth login {provider.id}</code>
        </div>
      </div>
    </section>
  );
}

function ProviderOAuthResult({ result }: { result: ResearchProviderOAuthStartResult }): JSX.Element {
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

function settingsSectionLabel(section: SettingsSection): string {
  switch (section) {
    case 'providers':
      return 'Providers';
    case 'developer':
      return 'Developer';
    case 'shell':
      return 'Shell Options';
    default:
      return 'General';
  }
}
