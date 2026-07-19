import type { JSX } from 'react';
import { DEFAULT_RESEARCH_MODEL } from '../../../shared/modelDefaults';
import { Bug, KeyRound, RefreshCw, Terminal } from 'lucide-react';
import type {
  DeveloperSettings,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult
} from '@shared/types';
import { Modal } from '../../app/Modal';
import { StatusPill } from '../../app/StatusPill';
import { stateClass } from '../../lib/formatting';

export type SettingsSection = 'general' | 'providers' | 'developer';

export function SettingsModal({
  section,
  developerSettings,
  programName,
  openAiStatus,
  openAiOAuthResult,
  busy,
  onChangeSection,
  onClose,
  onSetDeveloperModeEnabled,
  onRefreshOpenAi,
  onStartOpenAiOAuth
}: {
  section: SettingsSection;
  developerSettings: DeveloperSettings | null;
  programName: string | null;
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  busy: boolean;
  onChangeSection: (section: SettingsSection) => void;
  onClose: () => void;
  onSetDeveloperModeEnabled: (enabled: boolean) => Promise<void>;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
}): JSX.Element {
  const sections: SettingsSection[] = ['general', 'providers', 'developer'];
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
            <GeneralSettingsView programName={programName} />
          ) : activeSection === 'providers' ? (
            <ProvidersSettingsView busy={busy} openAiOAuthResult={openAiOAuthResult} openAiStatus={openAiStatus} onRefreshOpenAi={onRefreshOpenAi} onStartOpenAiOAuth={onStartOpenAiOAuth} />
          ) : (
            <DeveloperSettingsView busy={busy} developerSettings={developerSettings} onSetDeveloperModeEnabled={onSetDeveloperModeEnabled} />
          )}
        </section>
      </div>
    </Modal>
  );
}

function GeneralSettingsView({ programName }: { programName: string | null }): JSX.Element {
  return (
    <div className="settings-page general-settings-page">
      <div className="settings-page-header">
        <h3>General</h3>
      </div>
      <section className="provider-card readiness-enabled">
        <div className="provider-heading">
          <div>
            <h4>{programName || 'Current Program'}</h4>
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
  busy,
  onRefreshOpenAi,
  onStartOpenAiOAuth
}: {
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  busy: boolean;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
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
        <button type="button" title="Refresh OpenAI provider status" disabled={busy} onClick={refresh}>
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
            <h4>OpenAI</h4>
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
    </div>
  );
}

function settingsSectionLabel(section: SettingsSection): string {
  switch (section) {
    case 'providers':
      return 'Providers';
    case 'developer':
      return 'Developer';
    default:
      return 'General';
  }
}
