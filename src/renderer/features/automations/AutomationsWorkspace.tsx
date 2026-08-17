import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import type {
  AutomationSummary,
  AutomationUpdateInput,
  OpenAiAccountStatus,
  ProviderModelDefaults,
  ProviderSettings,
  ResearchModelProviderId,
  ResearchProviderModelCatalog,
  ResearchProviderStatus,
  WorkspaceRegistryEntry
} from '@shared/types';
import { repeatScheduleLabel } from '../../../shared/repeatSchedule';
import { ResearchSettingsForm } from '../sessions/StartRunForm';

export function AutomationsWorkspace({
  automations,
  workspaces,
  selectedWorkspaceId,
  selectedAutomation,
  openAiStatus,
  defaultProviderId,
  providerModelDefaults,
  providerPolicyRiskAcknowledgements,
  researchProviderStatuses,
  providerModelCatalog,
  loading,
  error,
  onScopeChange,
  onSelectAutomation,
  onSaveAutomation
}: {
  automations: readonly AutomationSummary[];
  workspaces: readonly WorkspaceRegistryEntry[];
  selectedWorkspaceId: string | null;
  selectedAutomation: AutomationSummary | null;
  openAiStatus: OpenAiAccountStatus | null;
  defaultProviderId: ResearchModelProviderId | null | undefined;
  providerModelDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> | undefined;
  providerPolicyRiskAcknowledgements?: ProviderSettings['cyberPolicyRiskAcknowledgements'];
  researchProviderStatuses: ResearchProviderStatus[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  loading: boolean;
  error: string | null;
  onScopeChange: (workspaceId: string | null) => void;
  onSelectAutomation: (automation: AutomationSummary | null) => void;
  onSaveAutomation: (input: AutomationUpdateInput) => Promise<AutomationSummary>;
}): JSX.Element {
  const scoped = useMemo(
    () => selectedWorkspaceId ? automations.filter((automation) => automation.workspaceId === selectedWorkspaceId) : [...automations],
    [automations, selectedWorkspaceId]
  );
  const active = scoped.filter((automation) => automation.enabled);
  const inactive = scoped.filter((automation) => !automation.enabled);
  const scopeTabs = [
    { id: null, key: 'all', label: 'All Automations' },
    ...workspaces
      .filter((workspace) => workspace.workspaceId.length > 0)
      .map((workspace) => ({ id: workspace.workspaceId, key: workspace.id, label: workspace.workspaceName }))
  ];

  return (
    <section className="automations-workspace" aria-label="Automations">
      <div className="automations-workspace-tabs research-side-view-tabs research-side-view-tabs-scrollable" role="tablist" aria-label="Automation workspace scope">
        {scopeTabs.map((scope) => {
          const selected = selectedWorkspaceId === scope.id;
          return (
            <div className={`research-side-view-tab provider-settings-tab automations-workspace-tab ${selected ? 'active' : ''}`.trim()} key={scope.key}>
              <button
                type="button"
                className="research-side-view-tab-activate"
                role="tab"
                aria-selected={selected}
                aria-controls="automations-workspace-panel"
                onClick={() => onScopeChange(scope.id)}
              >
                <span>{scope.label}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className={`automations-workspace-content ${selectedAutomation ? 'has-editor' : ''}`} id="automations-workspace-panel" role="tabpanel">
        <div className="automations-workspace-catalog">
          {loading ? (
            <AutomationEmptyState label="Loading automations" loading />
          ) : error ? (
            <AutomationEmptyState label="Automations could not be loaded" detail={error} error />
          ) : scoped.length === 0 ? (
            <AutomationEmptyState label="No automations yet" detail="Repeat schedules added from New Research will appear here." />
          ) : (
            <div className="automations-workspace-list">
              {active.length > 0 ? (
                <AutomationSection
                  automations={active}
                  label="Active"
                  selectedAutomation={selectedAutomation}
                  onSelect={onSelectAutomation}
                />
              ) : null}
              {inactive.length > 0 ? (
                <AutomationSection
                  automations={inactive}
                  label="Inactive"
                  selectedAutomation={selectedAutomation}
                  onSelect={onSelectAutomation}
                />
              ) : null}
            </div>
          )}
        </div>
        {selectedAutomation ? (
          <AutomationEditor
            automation={selectedAutomation}
            openAiStatus={openAiStatus}
            defaultProviderId={defaultProviderId}
            providerModelDefaults={providerModelDefaults}
            providerPolicyRiskAcknowledgements={providerPolicyRiskAcknowledgements}
            researchProviderStatuses={researchProviderStatuses}
            providerModelCatalog={providerModelCatalog}
            onClose={() => onSelectAutomation(null)}
            onSave={onSaveAutomation}
          />
        ) : null}
      </div>
    </section>
  );
}

function AutomationSection({ automations, label, selectedAutomation, onSelect }: {
  automations: readonly AutomationSummary[];
  label: 'Active' | 'Inactive';
  selectedAutomation: AutomationSummary | null;
  onSelect: (automation: AutomationSummary) => void;
}): JSX.Element {
  return (
    <section className="automation-section" aria-label={`${automations.length} ${label} automations`}>
      <h2>{automations.length} {label}</h2>
      <div className="automation-section-items">
        {automations.map((automation) => {
          const selected = selectedAutomation?.runId === automation.runId
            && selectedAutomation.workspaceId === automation.workspaceId;
          return (
            <button
              type="button"
              className={`automation-row ${selected ? 'selected' : ''}`.trim()}
              aria-pressed={selected}
              onClick={() => onSelect(automation)}
              key={`${automation.workspaceId}:${automation.runId}`}
            >
              <span className="automation-row-copy">
                <strong>{automation.title}</strong>
                {automation.promptPreview ? <span>{automation.promptPreview}</span> : null}
                <small>{automation.workspaceName}</small>
              </span>
              <span className="automation-row-schedule">{repeatScheduleLabel(automation.schedule)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AutomationEditor({
  automation,
  openAiStatus,
  defaultProviderId,
  providerModelDefaults,
  providerPolicyRiskAcknowledgements,
  researchProviderStatuses,
  providerModelCatalog,
  onClose,
  onSave
}: {
  automation: AutomationSummary;
  openAiStatus: OpenAiAccountStatus | null;
  defaultProviderId: ResearchModelProviderId | null | undefined;
  providerModelDefaults: Partial<Record<ResearchModelProviderId, ProviderModelDefaults>> | undefined;
  providerPolicyRiskAcknowledgements?: ProviderSettings['cyberPolicyRiskAcknowledgements'];
  researchProviderStatuses: ResearchProviderStatus[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  onClose: () => void;
  onSave: (input: AutomationUpdateInput) => Promise<AutomationSummary>;
}): JSX.Element {
  const [title, setTitle] = useState(automation.title);
  const [enabled, setEnabled] = useState(automation.enabled);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(automation.title);
    setEnabled(automation.enabled);
    setSaveError(null);
  }, [automation]);

  const saveSettings = async (settings: AutomationSummary['settings']): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        runId: automation.runId,
        workspaceId: automation.workspaceId,
        title,
        enabled,
        settings
      });
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="automation-editor" aria-label={`Edit ${automation.title}`}>
      <header className="automation-editor-header">
        <div>
          <span>Automation</span>
          <h2>Edit automation</h2>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <label className="automation-editor-field">
        <span>Name</span>
        <input value={title} required disabled={saving} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="automation-editor-enabled">
        <input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => setEnabled(event.target.checked)} />
        <span>Active</span>
      </label>
      <ResearchSettingsForm
        key={`${automation.workspaceId}:${automation.runId}:${automation.updatedAt}`}
        researchProfile={automation.researchProfile}
        formIdentity={`${automation.workspaceId}:${automation.runId}`}
        openAiStatus={openAiStatus}
        defaultProviderId={defaultProviderId}
        providerModelDefaults={providerModelDefaults}
        providerPolicyRiskAcknowledgements={providerPolicyRiskAcknowledgements}
        researchProviderStatuses={researchProviderStatuses}
        providerModelCatalog={providerModelCatalog}
        initialInput={automation.settings}
        showSuggestions={false}
        showAddContext={false}
        disableNoRepeat
        presentation="embedded"
        title="Automation research settings"
        submitLabel="Save changes"
        busy={saving || !title.trim()}
        onSubmit={saveSettings}
      />
      {saveError ? <p className="automation-editor-error" role="alert">{saveError}</p> : null}
    </section>
  );
}

function AutomationEmptyState({ label, detail, loading = false, error = false }: {
  label: string;
  detail?: string;
  loading?: boolean;
  error?: boolean;
}): JSX.Element {
  return (
    <div className={`automations-workspace-empty ${error ? 'is-error' : ''}`.trim()} role={error ? 'alert' : 'status'}>
      {loading ? <LoaderCircle className="runbook-view-spinner" size={20} aria-hidden="true" /> : error ? <CircleAlert size={20} aria-hidden="true" /> : null}
      <strong>{label}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}
