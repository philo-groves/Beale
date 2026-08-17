import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { CSSProperties } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  DEFAULT_RESEARCH_REASONING_EFFORT
} from '../../../shared/modelDefaults';
import { ArrowLeft, KeyRound, Plus, RefreshCw, Settings, X } from 'lucide-react';
import type {
  OpenAiAccountStatus,
  OpenAiAuthReadiness,
  OpenAiOAuthStartResult,
  ProviderSettings,
  ProviderAuthenticationMethod,
  ProviderModelDefaults,
  ResearchProfile,
  ResearchProfileSessionHeatPalette,
  ResolvedResearchProfile,
  ResearchProfileSnapshot,
  ResearchModelProviderId,
  ResearchModelEffortLevel,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  ResearchProviderId,
  ResearchProviderOAuthStartResult,
  ResearchProviderReadiness,
  ResearchProviderStatus,
  ShellSafetyMode
} from '@shared/types';
import { ProviderIcon } from '../../app/ProviderIcon';
import type { FloatingTextPickerOption } from '../../app/FloatingTextPicker';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { researchModelNameLabel, stateClass } from '../../lib/formatting';
import {
  filterEnabledProviderModelCatalogs,
  isOptionalProviderModelEnabled,
  OPTIONAL_PROVIDER_MODELS
} from '../../../shared/optionalProviderModels';
import type { ChatView } from '../../view-models/chatView';
import { normalizeShellSafetyMode } from '../../../shared/shellSafety';
import { permissionModeOptions } from '../../view-models/permissionSettings';
import {
  EMPTY_SESSION_HEAT_PREFERENCES,
  SESSION_HEAT_COLOR_LEVELS,
  SESSION_HEAT_LEVELS,
  normalizeHexColor,
  sessionHeatPaletteForProfile,
  type SessionHeat,
  type SessionHeatColorLevel,
  type SessionHeatPreferences,
  type SessionHeatTheme
} from '../../view-models/sessionHeat';

export type SettingsSection = 'general' | 'providers' | 'profile';

const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'providers', 'profile'];

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
        <span>Back to Agent</span>
      </button>
      <div className="sidebar-section settings-sidebar-section">
        <div className="workspace-list-title">Settings</div>
        <MainSideScrollRegion
          className="sidebar-list-scroll-region"
          listClassName="sidebar-list-scroll"
          updateKey={activeSection}
        >
          <nav className="settings-sections sidebar-list-scroll-content" aria-label="Settings sections">
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
        </MainSideScrollRegion>
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
  dangerModeEnabled,
  defaultShellSafetyMode,
  researchProfiles,
  researchProfilesLoading,
  openAiStatus,
  openAiOAuthResult,
  researchProviderOAuthResults,
  researchProviderStatuses,
  researchProviderModelCatalog,
  providerSettings,
  providerStatusesLoaded,
  sessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES,
  busy,
  onChangeChatView,
  onChangeDangerModeEnabled,
  onChangeDefaultShellSafetyMode,
  onRefreshOpenAi,
  onStartOpenAiOAuth,
  onStartResearchProviderOAuth,
  onForgetProviderSubscription = async () => undefined,
  onRemoveProvider = async () => undefined,
  onConfigureProviderApiKey = async () => undefined,
  onRemoveProviderApiKey = async () => undefined,
  onSetDefaultProviderId,
  onSetProviderModelDefaults,
  onSetProviderOptionalModelEnabled = async () => undefined,
  onSetProviderCyberPolicyRiskAcknowledged = async () => undefined,
  onSetProviderPreferredAuthenticationMethod = async () => undefined,
  onSetSessionHeatPreference = () => undefined,
  onSetSessionHeatPalettePreference = () => undefined
}: {
  section: SettingsSection;
  researchProfile: ResearchProfileSnapshot | null;
  researchProfiles: ResolvedResearchProfile[];
  researchProfilesLoading: boolean;
  chatView: ChatView;
  dangerModeEnabled: boolean;
  defaultShellSafetyMode: ShellSafetyMode;
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  researchProviderOAuthResults: Partial<Record<ResearchProviderId, ResearchProviderOAuthStartResult>>;
  researchProviderStatuses: ResearchProviderStatus[];
  researchProviderModelCatalog: ResearchProviderModelCatalog[];
  providerSettings: ProviderSettings | null;
  providerStatusesLoaded: boolean;
  sessionHeatPreferences?: SessionHeatPreferences;
  busy: boolean;
  onChangeChatView: (chatView: ChatView) => void;
  onChangeDangerModeEnabled: (enabled: boolean) => void;
  onChangeDefaultShellSafetyMode: (mode: ShellSafetyMode) => void;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
  onStartResearchProviderOAuth: (providerId: ResearchProviderId) => Promise<void>;
  onForgetProviderSubscription?: (providerId: ResearchModelProviderId) => Promise<void>;
  onRemoveProvider?: (providerId: ResearchModelProviderId) => Promise<void>;
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
  onSetSessionHeatPalettePreference?: (
    profileId: string,
    theme: SessionHeatTheme,
    level: SessionHeatColorLevel,
    color: string | null
  ) => void;
}): JSX.Element {
  const activeSection = activeSettingsSection(section);

  return (
    <div className="settings-workspace">
      <section className="settings-view settings-main-view" aria-label={`${settingsSectionLabel(activeSection)} settings`}>
        {activeSection === 'general' ? (
          <GeneralSettingsView
            chatView={chatView}
            dangerModeEnabled={dangerModeEnabled}
            defaultShellSafetyMode={defaultShellSafetyMode}
            onChangeChatView={onChangeChatView}
            onChangeDangerModeEnabled={onChangeDangerModeEnabled}
            onChangeDefaultShellSafetyMode={onChangeDefaultShellSafetyMode}
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
            onRemoveProvider={onRemoveProvider}
            onConfigureProviderApiKey={onConfigureProviderApiKey}
            onRemoveProviderApiKey={onRemoveProviderApiKey}
            onSetDefaultProviderId={onSetDefaultProviderId}
            onSetProviderModelDefaults={onSetProviderModelDefaults}
            onSetProviderOptionalModelEnabled={onSetProviderOptionalModelEnabled}
            onSetProviderCyberPolicyRiskAcknowledged={onSetProviderCyberPolicyRiskAcknowledged}
            onSetProviderPreferredAuthenticationMethod={onSetProviderPreferredAuthenticationMethod}
          />
        ) : (
          <ProfileSettingsView
            researchProfile={researchProfile}
            researchProfiles={researchProfiles}
            loading={researchProfilesLoading}
            sessionHeatPreferences={sessionHeatPreferences}
            onSetSessionHeatPreference={onSetSessionHeatPreference}
            onSetSessionHeatPalettePreference={onSetSessionHeatPalettePreference}
          />
        )}
      </section>
    </div>
  );
}

function activeSettingsSection(section: SettingsSection): SettingsSection {
  return SETTINGS_SECTIONS.includes(section) ? section : 'general';
}

const SESSION_HEAT_THEME_LABELS: Record<SessionHeatTheme, string> = {
  light: 'Light Heat',
  dark: 'Dark Heat'
};

const SESSION_HEAT_LEVEL_DESCRIPTIONS: Record<SessionHeatColorLevel, string> = {
  low: 'A subtle signal for sessions with light activity.',
  medium: 'A moderate signal for sessions with sustained activity.',
  high: 'A strong signal for sessions with heavy activity.',
  critical: 'The strongest signal for sessions with exceptional activity.'
};

export function ProfileSettingsView({
  researchProfile,
  researchProfiles,
  loading = false,
  sessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES,
  onSetSessionHeatPreference = () => undefined,
  onSetSessionHeatPalettePreference = () => undefined
}: {
  researchProfile: ResearchProfileSnapshot | null;
  researchProfiles: readonly ResolvedResearchProfile[];
  loading?: boolean;
  sessionHeatPreferences?: SessionHeatPreferences;
  onSetSessionHeatPreference?: (profileId: string, memoryTypeId: string, status: string, heat: SessionHeat | null) => void;
  onSetSessionHeatPalettePreference?: (
    profileId: string,
    theme: SessionHeatTheme,
    level: SessionHeatColorLevel,
    color: string | null
  ) => void;
}): JSX.Element {
  const profiles = profileSettingsCatalog(researchProfiles, researchProfile);
  const initialProfile = profiles.find((profile) => profile.profile.id === researchProfile?.profileId) ?? profiles[0] ?? null;
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(initialProfile?.profile.id ?? null);
  const [selectedMemoryTypeId, setSelectedMemoryTypeId] = useState<string | null>(null);
  const [profileDetailDrafts, setProfileDetailDrafts] = useState<Record<string, { name: string; description: string }>>({});
  const profileCatalogKey = profiles.map((profile) => `${profile.profile.id}:${profile.hash}`).join('|');
  const selectedProfile = profiles.find((profile) => profile.profile.id === selectedProfileId) ?? initialProfile;
  const memoryTypes = sortedProfileMemoryTypes(selectedProfile);
  const selectedMemoryType = selectedMemoryTypeId
    ? memoryTypes.find((memoryType) => memoryType.id === selectedMemoryTypeId) ?? null
    : null;
  const memoryTypeKey = memoryTypes.map((memoryType) => memoryType.id).join('|');
  const statusesById = new Map(selectedProfile?.profile.memory.statuses.map((status) => [status.id, status]) ?? []);

  useEffect(() => {
    if (profiles.some((profile) => profile.profile.id === selectedProfileId)) return;
    const nextProfile = profiles.find((profile) => profile.profile.id === researchProfile?.profileId) ?? profiles[0] ?? null;
    setSelectedProfileId(nextProfile?.profile.id ?? null);
    setSelectedMemoryTypeId(null);
  }, [profileCatalogKey, researchProfile?.profileId, selectedProfileId]);

  useEffect(() => {
    if (selectedMemoryTypeId === null || memoryTypes.some((memoryType) => memoryType.id === selectedMemoryTypeId)) return;
    setSelectedMemoryTypeId(null);
  }, [memoryTypeKey, selectedMemoryTypeId, selectedProfile?.profile.id]);

  if (profiles.length === 0 || !selectedProfile) {
    return (
      <div className="settings-page profile-settings-page" aria-busy={loading}>
        <section className="profile-settings-empty" role="status">
          {loading ? <span className="provider-settings-loading-indicator" aria-hidden="true" /> : null}
          <span>{loading ? 'Loading profiles...' : 'No research profiles are available.'}</span>
        </section>
      </div>
    );
  }

  const selectProfile = (profileId: string): void => {
    setSelectedProfileId(profileId);
    setSelectedMemoryTypeId(null);
  };
  const profileName = profileSettingsName(selectedProfile.profile.id, selectedProfile.profile.name);
  const profileDetailDraft = profileDetailDrafts[selectedProfile.profile.id] ?? {
    name: selectedProfile.profile.name,
    description: selectedProfile.profile.description
  };
  const updateProfileDetailDraft = (update: Partial<typeof profileDetailDraft>): void => {
    setProfileDetailDrafts((current) => ({
      ...current,
      [selectedProfile.profile.id]: {
        ...profileDetailDraft,
        ...update
      }
    }));
  };
  const overviewTabId = `profile-overview-tab-${selectedProfile.profile.id}`;

  return (
    <div className="settings-page profile-settings-page">
      <div className="profile-settings-tab-stack">
        <div className="profile-settings-tab-row research-side-view-tabs research-side-view-tabs-scrollable" role="tablist" aria-label="Research profiles">
          {profiles.map((profile) => {
            const selected = profile.profile.id === selectedProfile.profile.id;
            return (
              <div
                className={`research-side-view-tab provider-settings-tab profile-settings-tab ${selected ? 'active' : ''}`.trim()}
                key={profile.profile.id}
              >
                <button
                  className="research-side-view-tab-activate"
                  type="button"
                  role="tab"
                  id={`profile-settings-tab-${profile.profile.id}`}
                  aria-selected={selected}
                  aria-controls="profile-settings-profile-panel"
                  onClick={() => selectProfile(profile.profile.id)}
                >
                  <span>{profileSettingsName(profile.profile.id, profile.profile.name)}</span>
                </button>
              </div>
            );
          })}
          {loading ? <span className="profile-settings-loading" role="status">Loading profiles...</span> : null}
        </div>
      </div>
      <div
        className="profile-settings-profile-view"
        id="profile-settings-profile-panel"
        role="tabpanel"
        aria-labelledby={`profile-settings-tab-${selectedProfile.profile.id}`}
      >
        <div className="profile-settings-tab-row profile-settings-view-tab-row research-side-view-tabs research-side-view-tabs-scrollable" role="tablist" aria-label={`${profileName} profile views`}>
          <div className={`research-side-view-tab provider-settings-tab profile-settings-tab ${selectedMemoryType ? '' : 'active'}`.trim()}>
            <button
              className="research-side-view-tab-activate"
              type="button"
              role="tab"
              id={overviewTabId}
              aria-selected={!selectedMemoryType}
              aria-controls="profile-settings-view-panel"
              onClick={() => setSelectedMemoryTypeId(null)}
            >
              <span>Overview</span>
            </button>
          </div>
          {memoryTypes.map((memoryType) => {
            const selected = memoryType.id === selectedMemoryType?.id;
            return (
              <div
                className={`research-side-view-tab provider-settings-tab profile-settings-tab ${selected ? 'active' : ''}`.trim()}
                key={memoryType.id}
              >
                <button
                  className="research-side-view-tab-activate"
                  type="button"
                  role="tab"
                  id={`profile-memory-tab-${selectedProfile.profile.id}-${memoryType.id}`}
                  aria-selected={selected}
                  aria-controls="profile-settings-view-panel"
                  onClick={() => setSelectedMemoryTypeId(memoryType.id)}
                >
                  <span>{memoryType.name}</span>
                </button>
              </div>
            );
          })}
        </div>
        {selectedMemoryType ? (
          <article
            className="profile-memory-type-view"
            id="profile-settings-view-panel"
            role="tabpanel"
            aria-labelledby={`profile-memory-tab-${selectedProfile.profile.id}-${selectedMemoryType.id}`}
            aria-label={`${selectedMemoryType.name} memory definition`}
          >
            <header className="profile-memory-type-header">
              <div>
                <span>Memory type</span>
                <h4>{selectedMemoryType.name} <small>{'\u00b7'} {selectedMemoryType.id}</small></h4>
              </div>
              <small>
                {selectedMemoryType.lifecycle === 'retired' || !selectedMemoryType.creatable ? 'Read-only' : 'Creatable'}
                {' \u00b7 '}
                {selectedMemoryType.allowedStatuses.join(', ')}
              </small>
            </header>
            <p className="profile-memory-type-description">{selectedMemoryType.description}</p>
            <section className="profile-memory-session-heat" aria-label={`${selectedMemoryType.name} session heat settings`}>
              <h4>Session Heat</h4>
              <div>
                {selectedMemoryType.allowedStatuses
                  .filter((statusId) => statusesById.get(statusId)?.polarity !== 'negative')
                  .map((statusId) => {
                    const defaultHeat = selectedMemoryType.sessionHeat?.[statusId] ?? 'none';
                    const override = sessionHeatPreferences.heatOverrides[selectedProfile.profile.id]?.[selectedMemoryType.id]?.[statusId];
                    return (
                      <label key={statusId}>
                        <span>{statusesById.get(statusId)?.name ?? statusId}</span>
                        <select
                          aria-label={`${selectedMemoryType.name} ${statusId} session heat`}
                          value={override ?? ''}
                          onChange={(event) => onSetSessionHeatPreference(
                            selectedProfile.profile.id,
                            selectedMemoryType.id,
                            statusId,
                            event.target.value ? event.target.value as SessionHeat : null
                          )}
                        >
                          <option value="">Profile default {'\u00b7'} {sessionHeatLabel(defaultHeat)}</option>
                          {SESSION_HEAT_LEVELS.map((heat) => (
                            <option value={heat} key={heat}>{sessionHeatLabel(heat)}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
              </div>
            </section>
          </article>
        ) : (
          <article
            className="profile-overview-view"
            id="profile-settings-view-panel"
            role="tabpanel"
            aria-labelledby={overviewTabId}
          >
            <section className="settings-form profile-basic-details-form">
              <header className="settings-form-heading">
                <h2 id="profile-basic-details-heading">Basic Details</h2>
                <p>Set the name and description presented for this research profile.</p>
              </header>
              <div className="settings-form-squircle profile-basic-details-squircle" aria-labelledby="profile-basic-details-heading">
                <div className="settings-form-control-list">
                  <label className="settings-form-control-row">
                    <span className="settings-form-control-copy">
                      <strong>Profile Name</strong>
                      <small>Choose the name used to identify this research profile.</small>
                    </span>
                    <input
                      className="profile-basic-details-name-input"
                      type="text"
                      aria-label="Profile Name"
                      value={profileDetailDraft.name}
                      onChange={(event) => updateProfileDetailDraft({ name: event.currentTarget.value })}
                    />
                  </label>
                  <label className="settings-form-control-row profile-basic-details-description-row">
                    <span className="settings-form-control-copy">
                      <strong>Profile Description</strong>
                      <small>Describe the profile's research purpose and intended use.</small>
                    </span>
                    <textarea
                      aria-label="Profile Description"
                      value={profileDetailDraft.description}
                      onChange={(event) => updateProfileDetailDraft({ description: event.currentTarget.value })}
                    />
                  </label>
                </div>
              </div>
            </section>
            <SessionHeatPaletteSettings
              profile={selectedProfile.profile}
              sessionHeatPreferences={sessionHeatPreferences}
              onSetColor={onSetSessionHeatPalettePreference}
            />
          </article>
        )}
      </div>
    </div>
  );
}

function SessionHeatPaletteSettings({
  profile,
  sessionHeatPreferences,
  onSetColor
}: {
  profile: ResearchProfile;
  sessionHeatPreferences: SessionHeatPreferences;
  onSetColor: (profileId: string, theme: SessionHeatTheme, level: SessionHeatColorLevel, color: string | null) => void;
}): JSX.Element {
  const [theme, setTheme] = useState<SessionHeatTheme>('dark');
  const palette: ResearchProfileSessionHeatPalette = sessionHeatPaletteForProfile(profile, sessionHeatPreferences, theme);

  useEffect(() => {
    setTheme('dark');
  }, [profile.id]);

  return (
    <section className="settings-form profile-heat-form" aria-label={`${profile.name} session heat colors`}>
      <header className="settings-form-heading profile-heat-form-heading">
        <div className="profile-heat-form-title">
          <h2 id="profile-heat-heading">Heat</h2>
          <div className="profile-heat-form-controls">
            <div className="profile-heat-theme-toggle" role="group" aria-label="Heat variant">
              {(['light', 'dark'] as const).map((candidate) => (
                <button
                  className={candidate === theme ? 'active' : ''}
                  type="button"
                  aria-pressed={candidate === theme}
                  onClick={() => setTheme(candidate)}
                  key={candidate}
                >
                  {candidate === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
            <button
              className="profile-heat-reset"
              type="button"
              aria-label={`Reset ${SESSION_HEAT_THEME_LABELS[theme]} colors`}
              title={`Reset ${SESSION_HEAT_THEME_LABELS[theme]} colors`}
              onClick={() => SESSION_HEAT_COLOR_LEVELS.forEach((level) => onSetColor(profile.id, theme, level, null))}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p>Customize the colors used to show session activity intensity.</p>
      </header>
      <div className="settings-form-squircle profile-heat-form-squircle" aria-labelledby="profile-heat-heading">
        <div className="settings-form-control-list profile-session-heat-color-list">
          {SESSION_HEAT_COLOR_LEVELS.map((level) => (
            <SessionHeatColorControl
              key={`${theme}-${level}`}
              profileId={profile.id}
              theme={theme}
              level={level}
              color={palette[level]}
              onSetColor={onSetColor}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function SessionHeatColorControl({
  profileId,
  theme,
  level,
  color,
  onSetColor
}: {
  profileId: string;
  theme: SessionHeatTheme;
  level: SessionHeatColorLevel;
  color: string;
  onSetColor: (profileId: string, theme: SessionHeatTheme, level: SessionHeatColorLevel, color: string | null) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(color);

  useEffect(() => {
    setDraft(color);
  }, [color]);

  const commitColor = (value: string): void => {
    const normalized = normalizeHexColor(value);
    if (!normalized) return;
    onSetColor(profileId, theme, level, normalized);
  };

  const colorLabel = `${SESSION_HEAT_THEME_LABELS[theme]} ${sessionHeatLabel(level)} session heat color`;

  return (
    <div className="settings-form-control-row profile-session-heat-color-row" role="group" aria-label={colorLabel}>
      <span className="settings-form-control-copy">
        <strong>{sessionHeatLabel(level)}</strong>
        <small>{SESSION_HEAT_LEVEL_DESCRIPTIONS[level]}</small>
      </span>
      <span className="profile-session-heat-color-controls">
        <label
          className="profile-session-heat-color-picker"
          data-heat-level={level}
          style={{ '--profile-session-heat-color': color } as CSSProperties}
        >
          <input
            type="color"
            aria-label={colorLabel}
            value={color}
            onChange={(event) => {
              setDraft(event.target.value);
              onSetColor(profileId, theme, level, event.target.value);
            }}
          />
        </label>
        <input
          className="profile-session-heat-color-hex"
          type="text"
          aria-label={`${colorLabel} hex`}
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraft(nextDraft);
            commitColor(nextDraft);
          }}
          onBlur={() => setDraft(normalizeHexColor(draft) ?? color)}
        />
      </span>
    </div>
  );
}

function profileSettingsCatalog(
  researchProfiles: readonly ResolvedResearchProfile[],
  activeProfile: ResearchProfileSnapshot | null
): ResolvedResearchProfile[] {
  const catalog = [...researchProfiles];
  if (!activeProfile) return catalog;
  const resolvedActiveProfile: ResolvedResearchProfile = {
    profile: activeProfile.profile,
    hash: activeProfile.profileHash,
    source: activeProfile.source,
    ...(activeProfile.sourcePath ? { path: activeProfile.sourcePath } : {})
  };
  const activeIndex = catalog.findIndex((profile) => profile.profile.id === activeProfile.profileId);
  if (activeIndex >= 0) catalog[activeIndex] = resolvedActiveProfile;
  else catalog.unshift(resolvedActiveProfile);
  return catalog;
}

function sortedProfileMemoryTypes(profile: ResolvedResearchProfile | null) {
  return profile
    ? [...profile.profile.memory.types].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    : [];
}

function profileSettingsName(profileId: string, name: string): string {
  return profileId === 'security-research' ? 'Cybersecurity' : name;
}

function sessionHeatLabel(heat: SessionHeat): string {
  return heat.charAt(0).toUpperCase() + heat.slice(1);
}

export function GeneralSettingsView({
  chatView,
  dangerModeEnabled,
  defaultShellSafetyMode,
  onChangeChatView,
  onChangeDangerModeEnabled,
  onChangeDefaultShellSafetyMode
}: {
  chatView: ChatView;
  dangerModeEnabled: boolean;
  defaultShellSafetyMode: ShellSafetyMode;
  onChangeChatView: (chatView: ChatView) => void;
  onChangeDangerModeEnabled: (enabled: boolean) => void;
  onChangeDefaultShellSafetyMode: (mode: ShellSafetyMode) => void;
}): JSX.Element {
  const permissionOptions = permissionModeOptions({ dangerModeEnabled, defaultShellSafetyMode });
  return (
    <div className="settings-page general-settings-page">
      <section className="settings-form chat-view-form">
        <header className="settings-form-heading">
          <h2 id="chat-view-settings-heading">Session View</h2>
          <p>Choose how Beale presents agent activity in research sessions.</p>
        </header>
        <fieldset className="settings-form-squircle chat-view-settings" aria-labelledby="chat-view-settings-heading">
          <div className="settings-form-radio-list chat-view-options">
            <label className={`chat-view-option ${chatView === 'commentary' ? 'selected' : ''}`}>
              <span className="settings-form-radio-copy">
                <strong>Commentary</strong>
                <small>Follow concise research updates and agent responses.</small>
              </span>
              <input
                type="radio"
                name="chat-view"
                value="commentary"
                checked={chatView === 'commentary'}
                onChange={() => onChangeChatView('commentary')}
              />
            </label>
            <label className={`chat-view-option ${chatView === 'traces' ? 'selected' : ''}`}>
              <span className="settings-form-radio-copy">
                <strong>Traces</strong>
                <small>Inspect the detailed agent event timeline and tool activity.</small>
              </span>
              <input
                type="radio"
                name="chat-view"
                value="traces"
                checked={chatView === 'traces'}
                onChange={() => onChangeChatView('traces')}
              />
            </label>
          </div>
        </fieldset>
      </section>
      <section className="settings-form permissions-settings-form">
        <header className="settings-form-heading">
          <h2 id="permissions-settings-heading">Permissions</h2>
          <p>Set the default permission behavior for new research sessions.</p>
        </header>
        <fieldset className="settings-form-squircle permissions-settings" aria-labelledby="permissions-settings-heading">
          <div className="settings-form-control-list">
            <label className="settings-form-control-row">
              <span className="settings-form-control-copy">
                <strong>Enable Danger Mode</strong>
                <small>Allow sessions to run shell commands without approval or automatic review.</small>
              </span>
              <input
                aria-label="Enable Danger Mode"
                type="checkbox"
                checked={dangerModeEnabled}
                onChange={(event) => onChangeDangerModeEnabled(event.currentTarget.checked)}
              />
            </label>
            <label className="settings-form-control-row">
              <span className="settings-form-control-copy">
                <strong>Default Permissions</strong>
                <small>Choose the permission mode applied when a research session starts.</small>
              </span>
              <select
                aria-label="Default Permissions"
                value={defaultShellSafetyMode}
                onChange={(event) => onChangeDefaultShellSafetyMode(normalizeShellSafetyMode(event.currentTarget.value))}
              >
                {permissionOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
      </section>
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
  if (providerId === 'xai') return 'xAI';
  return 'Z.ai';
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

export function ProviderRemoveControl({
  providerName,
  disabled,
  removing = false,
  onRemove
}: {
  providerName: string;
  disabled: boolean;
  removing?: boolean;
  onRemove: () => void;
}): JSX.Element {
  if (removing) {
    return <span className="provider-removing-status" role="status" aria-live="polite">Removing provider...</span>;
  }
  return (
    <button
      className="provider-remove-button"
      type="button"
      aria-label={`Remove ${providerName} provider`}
      title={`Remove ${providerName} provider`}
      disabled={disabled}
      onClick={onRemove}
    ><X size={11} aria-hidden="true" /></button>
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
  policyRiskAcknowledged,
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
  policyRiskAcknowledged: boolean;
  preferredMethod: ProviderAuthenticationMethod;
  onAuthenticate: () => void;
  onForgetSubscription: () => void;
  onConfigureApiKey: (providerId: ResearchModelProviderId) => void;
  onRemoveApiKey: () => void;
  onMarkPreferred: (method: ProviderAuthenticationMethod) => void;
}): JSX.Element {
  const subscriptionConfigured = subscriptionState === 'configured';
  const showPreferenceControls = subscriptionConfigured && apiKeyConfigured;
  const providerName = providerCompanyName(providerId);
  return (
    <section className="settings-form provider-settings-form provider-authentication-section" aria-label="Authentication">
      <header className="settings-form-heading">
        <div className="provider-authentication-form-title">
          <h2>Authentication</h2>
          {!policyRiskAcknowledged ? (
            <small className="provider-authentication-warning" role="status">Acknowledge the risks first</small>
          ) : null}
        </div>
        <p>Choose how Beale authenticates with this provider.</p>
      </header>
      <div className="settings-form-squircle provider-settings-form-squircle">
        <div className="provider-authentication-options">
          <div className="provider-authentication-option">
            <div className="provider-authentication-copy">
              <div className="provider-authentication-option-heading">
                <strong>Subscription</strong>
                <ProviderAuthenticationStatus state={subscriptionState} preferred={showPreferenceControls && preferredMethod === 'subscription'} />
              </div>
              <small>Use your {providerName} subscription account.</small>
              {result ? <ProviderOAuthResult result={result} /> : null}
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
                  disabled={busy || subscriptionDisabled || !policyRiskAcknowledged}
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
          </div>
          <div className="provider-authentication-option">
            <div className="provider-authentication-copy">
              <div className="provider-authentication-option-heading">
                <strong>API Key</strong>
                <ProviderAuthenticationStatus state={apiKeyConfigured ? 'configured' : 'not-configured'} preferred={showPreferenceControls && preferredMethod === 'api_key'} />
              </div>
              <small>Use an API key encrypted by the operating system and retained by Beale's host process.</small>
            </div>
            <div className="provider-authentication-actions">
              {apiKeyConfigured ? (
                <button className="secondary-button provider-authentication-action" type="button" disabled={busy} onClick={onRemoveApiKey}>
                  Forget
                </button>
              ) : (
                <button className="secondary-button provider-authentication-action" type="button" disabled={busy || !policyRiskAcknowledged} onClick={() => onConfigureApiKey(providerId)}>
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

export function nextConfiguredProviderIdAfterRemoval(
  configuredProviderIds: readonly ResearchModelProviderId[],
  removedProviderId: ResearchModelProviderId,
  defaultProviderId: ResearchModelProviderId | null
): ResearchModelProviderId | null {
  const remainingProviderIds = configuredProviderIds.filter((providerId) => providerId !== removedProviderId);
  return remainingProviderIds.includes(defaultProviderId as ResearchModelProviderId)
    ? defaultProviderId
    : remainingProviderIds[0] ?? null;
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
    ?? models.find((model) => model.id === catalog?.defaultSmallModel)?.id
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
  onRemoveProvider = async () => undefined,
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
  onRemoveProvider?: (providerId: ResearchModelProviderId) => Promise<void>;
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
  const [removingProviderId, setRemovingProviderId] = useState<ResearchModelProviderId | null>(null);
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
  const removeProvider = async (providerId: ProviderSettingsId): Promise<void> => {
    setRemovingProviderId(providerId);
    const nextProviderId = nextConfiguredProviderIdAfterRemoval(
      configuredProviders.map((provider) => provider.id),
      providerId,
      providerSettings?.defaultProviderId ?? null
    );
    try {
      await onRemoveProvider(providerId);
      setAuthenticationProviderId((current) => current === providerId ? null : current);
      setActiveProviderId((current) => current === providerId ? nextProviderId : current);
      setApiKeyDialogProviderId((current) => current === providerId ? null : current);
    } finally {
      setRemovingProviderId((current) => current === providerId ? null : current);
    }
  };
  const showProvider = (providerId: ProviderSettingsId): void => {
    setAuthenticationProviderId(providerId);
    setActiveProviderId(providerId);
  };
  const refresh = (): void => {
    void onRefreshOpenAi();
  };

  if (!providerSelectionReady) {
    return (
      <div className="settings-page provider-settings-page" aria-busy="true">
        <section className="provider-settings-loading" role="status" aria-live="polite">
          <span className="provider-settings-loading-indicator" aria-hidden="true" />
          <span>Loading providers…</span>
        </section>
      </div>
    );
  }

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
        onSetDefaultProviderId={(providerId) => void onSetDefaultProviderId(providerId)}
      />
      {activeProvider?.id === 'openai-codex' ? (
        <OpenAiProviderCard
          busy={busy}
          removing={removingProviderId === 'openai-codex'}
          openAiOAuthResult={openAiOAuthResult}
          openAiStatus={openAiStatus}
          onRefresh={refresh}
          onAuthenticate={() => authenticateProvider('openai-codex')}
          onForgetSubscription={() => void onForgetProviderSubscription('openai-codex')}
          onRemoveProvider={() => void removeProvider('openai-codex')}
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
          removing={removingProviderId === activeProvider.id}
          provider={researchProviderStatuses.find((provider) => provider.id === activeProvider.id)!}
          result={researchProviderOAuthResults[activeProvider.id] ?? null}
          onRefresh={refresh}
          onAuthenticate={() => authenticateProvider(activeProvider.id)}
          onForgetSubscription={() => void onForgetProviderSubscription(activeProvider.id)}
          onRemoveProvider={() => void removeProvider(activeProvider.id)}
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

function ProviderSettingsProviderPanel({
  providerId,
  providerName,
  readiness,
  healthState,
  removing,
  busy,
  onRefresh,
  onRemoveProvider,
  modelCatalog,
  fullModelCatalog,
  modelDefaults,
  onSetModelDefaults,
  enabledOptionalModelIds,
  disabledOptionalModelIds,
  onSetOptionalModelEnabled,
  policyRiskAcknowledged,
  onSetPolicyRiskAcknowledged,
  policyBusy,
  policyLocked,
  authentication
}: {
  providerId: ResearchModelProviderId;
  providerName: string;
  readiness: OpenAiAuthReadiness | ResearchProviderReadiness;
  healthState: ProviderHealthState;
  removing: boolean;
  busy: boolean;
  onRefresh: () => void;
  onRemoveProvider: () => void;
  modelCatalog: ResearchProviderModelCatalog | null;
  fullModelCatalog: ResearchProviderModelCatalog | null;
  modelDefaults: ProviderModelDefaults | null;
  onSetModelDefaults: (defaults: ProviderModelDefaults) => void;
  enabledOptionalModelIds: readonly string[];
  disabledOptionalModelIds: readonly string[];
  onSetOptionalModelEnabled: (modelId: string, enabled: boolean) => void;
  policyRiskAcknowledged: boolean;
  onSetPolicyRiskAcknowledged: (acknowledged: boolean) => void;
  policyBusy: boolean;
  policyLocked: boolean;
  authentication: JSX.Element;
}): JSX.Element {
  return (
    <div
      className={`provider-card provider-settings-provider-panel readiness-${stateClass(readiness)}`}
      role="tabpanel"
      aria-label={`${providerName} provider settings`}
    >
      <section className="settings-form provider-settings-form provider-acknowledgment-form">
        <header className="settings-form-heading provider-settings-form-heading">
          <div className="provider-settings-form-title">
            <ProviderIcon className="provider-settings-heading-icon" provider={providerId} size={18} aria-hidden="true" />
            <h2>{providerName}</h2>
            <button
              className="provider-settings-heading-refresh"
              type="button"
              aria-label={`Refresh ${providerName}`}
              title={`Refresh ${providerName}`}
              disabled={busy}
              onClick={onRefresh}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <ProviderHealthIndicator state={healthState} />
            </button>
            {healthState !== 'healthy' || removing ? (
              <ProviderRemoveControl
                providerName={providerName}
                disabled={busy && healthState !== 'authenticating'}
                removing={removing}
                onRemove={onRemoveProvider}
              />
            ) : null}
          </div>
          <p>
            {policyRiskAcknowledged
              ? `You have accepted the ${providerName} provider acknowledgment.`
              : `Please accept the ${providerName} provider acknowledgment before configuring authentication.`}
          </p>
        </header>
        <div className="settings-form-squircle provider-settings-form-squircle">
          <ProviderCyberPolicyAcknowledgement
            providerId={providerId}
            acknowledged={policyRiskAcknowledged}
            busy={policyBusy}
            locked={policyLocked}
            onChange={onSetPolicyRiskAcknowledged}
          />
        </div>
      </section>
      {authentication}
      <section className="settings-form provider-settings-form provider-default-models-form">
        <header className="settings-form-heading">
          <h2>Default Models</h2>
          <p>Choose the models and reasoning level used by default for this provider.</p>
        </header>
        <div className="settings-form-squircle provider-settings-form-squircle">
          <ProviderModelDefaultsControls
            busy={busy}
            catalog={modelCatalog}
            defaults={modelDefaults}
            onChange={onSetModelDefaults}
          />
        </div>
      </section>
      <section className="settings-form provider-settings-form provider-optional-models-form">
        <header className="settings-form-heading">
          <h2>Optional Models</h2>
          <p>Enable additional provider models when they are available to your account.</p>
        </header>
        <div className="settings-form-squircle provider-settings-form-squircle">
          <ProviderOptionalModelsControls
            busy={policyBusy}
            catalog={fullModelCatalog}
            enabledModelIds={enabledOptionalModelIds}
            disabledModelIds={disabledOptionalModelIds}
            providerId={providerId}
            onChange={onSetOptionalModelEnabled}
          />
        </div>
      </section>
    </div>
  );
}

function OpenAiProviderCard({
  busy,
  removing,
  openAiOAuthResult,
  openAiStatus,
  onRefresh,
  onAuthenticate,
  onForgetSubscription,
  onRemoveProvider,
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
  removing: boolean;
  busy: boolean;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  openAiStatus: OpenAiAccountStatus | null;
  onRefresh: () => void;
  onAuthenticate: () => void;
  onForgetSubscription: () => void;
  onRemoveProvider: () => void;
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
  const healthState: ProviderHealthState = openAiStatus?.loginInProgress ? 'authenticating' : openAiStatus?.configured && (readiness === 'oauth_ready' || readiness === 'development_fallback') ? 'healthy' : 'unhealthy';
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
    <ProviderSettingsProviderPanel
      providerId="openai-codex"
      providerName="OpenAI"
      readiness={readiness}
      healthState={healthState}
      removing={removing}
      busy={busy}
      onRefresh={onRefresh}
      onRemoveProvider={onRemoveProvider}
      modelCatalog={modelCatalog}
      fullModelCatalog={fullModelCatalog}
      modelDefaults={modelDefaults}
      onSetModelDefaults={onSetModelDefaults}
      enabledOptionalModelIds={enabledOptionalModelIds}
      disabledOptionalModelIds={disabledOptionalModelIds}
      onSetOptionalModelEnabled={onSetOptionalModelEnabled}
      policyRiskAcknowledged={policyRiskAcknowledged}
      onSetPolicyRiskAcknowledged={onSetPolicyRiskAcknowledged}
      policyBusy={busy}
      policyLocked={policyRiskAcknowledged && Boolean(openAiStatus?.subscriptionConfigured || openAiStatus?.apiKeyConfigured)}
      authentication={(
        <ProviderAuthenticationSection
          providerId="openai-codex"
          subscriptionState={subscriptionState}
          apiKeyConfigured={openAiStatus?.apiKeyConfigured ?? false}
          busy={busy}
          subscriptionDisabled={false}
          policyRiskAcknowledged={policyRiskAcknowledged}
          result={openAiOAuthResult}
          preferredMethod={preferredAuthenticationMethod}
          onAuthenticate={onAuthenticate}
          onForgetSubscription={onForgetSubscription}
          onConfigureApiKey={onConfigureApiKey}
          onRemoveApiKey={onRemoveApiKey}
          onMarkPreferred={onSetPreferredAuthenticationMethod}
        />
      )}
    />
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
}): JSX.Element {
  const availableModelIds = new Set((catalog?.models ?? []).map((model) => model.id));
  const optionalModels = OPTIONAL_PROVIDER_MODELS.filter((model) => model.providerId === providerId);
  return (
    <div className="provider-optional-models" aria-label="Optional Models">
      {optionalModels.length === 0 ? (
        <p className="provider-optional-models-empty">No optional models are available for this provider.</p>
      ) : null}
      {optionalModels.map((model) => {
        const available = availableModelIds.has(model.modelId);
        return (
          <label key={model.modelId}>
            <span className="provider-optional-model-copy">
              <strong>{model.name}</strong>
              <small>{model.accessNote}{available ? '' : ' Not available in the installed Honeycrisp model catalog.'}</small>
            </span>
            <input
              type="checkbox"
              checked={isOptionalProviderModelEnabled({
                enabledOptionalModels: { [providerId]: [...enabledModelIds] },
                disabledOptionalModels: { [providerId]: [...disabledModelIds] }
              }, providerId, model.modelId)}
              disabled={busy || !available}
              onChange={(event) => onChange(model.modelId, event.target.checked)}
            />
          </label>
        );
      })}
    </div>
  );
}

function ResearchProviderCard({
  provider,
  result,
  removing,
  busy,
  onRefresh,
  onAuthenticate,
  onForgetSubscription,
  onRemoveProvider,
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
  removing: boolean;
  result: ResearchProviderOAuthStartResult | null;
  busy: boolean;
  onRefresh: () => void;
  onAuthenticate: () => void;
  onForgetSubscription: () => void;
  onRemoveProvider: () => void;
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
  const healthState: ProviderHealthState = provider.loginInProgress ? 'authenticating' : provider.configured && provider.readiness === 'ready' ? 'healthy' : 'unhealthy';
  const subscriptionState: ProviderAuthenticationState = provider.loginInProgress
    ? 'authenticating'
    : provider.subscriptionConfigured
      ? 'configured'
      : provider.readiness === 'unavailable'
        ? 'unavailable'
        : 'not-configured';
  return (
    <ProviderSettingsProviderPanel
      providerId={provider.id}
      providerName={providerName}
      readiness={provider.readiness}
      healthState={healthState}
      removing={removing}
      busy={busy}
      onRefresh={onRefresh}
      onRemoveProvider={onRemoveProvider}
      modelCatalog={modelCatalog}
      fullModelCatalog={fullModelCatalog}
      modelDefaults={modelDefaults}
      onSetModelDefaults={onSetModelDefaults}
      enabledOptionalModelIds={enabledOptionalModelIds}
      disabledOptionalModelIds={disabledOptionalModelIds}
      onSetOptionalModelEnabled={onSetOptionalModelEnabled}
      policyRiskAcknowledged={policyRiskAcknowledged}
      onSetPolicyRiskAcknowledged={onSetPolicyRiskAcknowledged}
      policyBusy={busy || provider.loginInProgress}
      policyLocked={policyRiskAcknowledged && (provider.subscriptionConfigured || provider.apiKeyConfigured)}
      authentication={(
        <ProviderAuthenticationSection
          providerId={provider.id}
          subscriptionState={subscriptionState}
          apiKeyConfigured={provider.apiKeyConfigured}
          busy={busy}
          subscriptionDisabled={provider.loginInProgress}
          policyRiskAcknowledged={policyRiskAcknowledged}
          result={result}
          preferredMethod={preferredAuthenticationMethod}
          onAuthenticate={onAuthenticate}
          onForgetSubscription={onForgetSubscription}
          onConfigureApiKey={onConfigureApiKey}
          onRemoveApiKey={onRemoveApiKey}
          onMarkPreferred={onSetPreferredAuthenticationMethod}
        />
      )}
    />
  );
}

function ProviderCyberPolicyAcknowledgement({
  providerId,
  acknowledged,
  busy,
  locked,
  onChange
}: {
  providerId: ResearchModelProviderId;
  acknowledged: boolean;
  busy: boolean;
  locked: boolean;
  onChange: (acknowledged: boolean) => void;
}): JSX.Element {
  const detail = providerId === 'openai-codex'
    ? 'Cybersecurity use is intended for OpenAI Trusted Access for Cyber members. Program membership does not waive OpenAI policy requirements: requests may still be blocked or treated as usage violations.'
    : providerId === 'anthropic'
      ? 'Subscription sign-in is experimental and only intended for Anthropic Cyber Verification Program members. CVP membership does not waive Anthropic\'s Usage Policy: requests may still be blocked or treated as usage violations. Beale delegates Claude sessions to the official Claude Agent SDK and Claude Code CLI; it does not copy or replay subscription tokens.'
      : providerId === 'xai'
        ? 'Cybersecurity use remains subject to xAI policy requirements. Requests may be blocked or treated as usage violations.'
        : 'Cybersecurity use remains subject to Z.ai policy and Coding Plan terms. Requests may be blocked or treated as usage violations. Subscription sessions are delegated to the official ZCode agent; Beale does not copy or replay subscription credentials.';
  const label = providerId === 'openai-codex'
    ? 'I confirm this account has OpenAI Trusted Access for Cyber membership and I accept the policy-use risk.'
    : providerId === 'anthropic'
      ? 'I confirm this account is enrolled in Anthropic\'s Cyber Verification Program and I accept the usage-policy risk.'
      : providerId === 'xai'
        ? 'I accept the policy-use risk for cybersecurity research with xAI.'
        : 'I accept the policy-use risk for cybersecurity research with Z.ai.';
  return (
    <div className="provider-policy-warning">
      <p className="provider-detail provider-billing-note">{detail}</p>
      <label
        className={`provider-risk-acknowledgement ${locked ? 'is-locked' : ''}`.trim()}
        title={locked ? 'Acknowledgment is recorded until this provider is removed.' : undefined}
      >
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={busy || locked}
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
  const smallModel = models.find((model) => model.id === defaults?.smallModel) ?? null;
  const effortLevels = largeModel?.effortLevels ?? [];
  const smallEffortLevels = smallModel?.effortLevels ?? [];
  const smallReasoningEffort = preferredProviderReasoningEffort(smallEffortLevels);
  const disabled = busy || !defaults || models.length === 0;
  return (
    <div className="provider-model-defaults" aria-label="Provider model defaults">
      <div className="provider-model-defaults-controls">
        <div className="provider-model-default-row" role="group" aria-label="Large model defaults">
          <span className="provider-model-default-copy">
            <strong>Large Model</strong>
            <small>Primary model for complex research work.</small>
          </span>
          <div className="provider-model-default-row-controls">
            <select
              aria-label="Large model"
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
            <select
              className="provider-model-reasoning-select"
              aria-label="Large model reasoning"
              value={defaults?.reasoningEffort ?? ''}
              disabled={disabled || effortLevels.length === 0}
              onChange={(event) => defaults && onChange({ ...defaults, reasoningEffort: event.target.value as ResearchModelEffortLevel })}
            >
              {effortLevels.map((effort) => <option value={effort} key={effort}>{reasoningEffortLabel(effort)}</option>)}
            </select>
          </div>
        </div>
        <div className="provider-model-default-row" role="group" aria-label="Small model default">
          <span className="provider-model-default-copy">
            <strong>Small Model</strong>
            <small>Lighter model for supporting research tasks.</small>
          </span>
          <div className="provider-model-default-row-controls">
            <select
              aria-label="Small model"
              value={defaults?.smallModel ?? ''}
              disabled={disabled}
              onChange={(event) => defaults && onChange({ ...defaults, smallModel: event.target.value })}
            >
              {models.map((model) => <option value={model.id} key={model.id}>{providerModelOptionLabel(catalog?.providerId, model)}</option>)}
            </select>
            <select
              className="provider-model-reasoning-select"
              aria-label="Small model reasoning"
              title="Small-model reasoning is not configurable yet"
              value={smallReasoningEffort}
              disabled
            >
              {smallEffortLevels.map((effort) => <option value={effort} key={effort}>{reasoningEffortLabel(effort)}</option>)}
            </select>
          </div>
        </div>
      </div>
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
    case 'profile':
      return 'Profiles';
    default:
      return 'General';
  }
}
