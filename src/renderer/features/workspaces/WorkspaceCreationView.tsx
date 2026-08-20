import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Boxes, LayoutDashboard, ListChecks, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ResearchKitId, ScopeAsset, ScopeAssetInput, ScopeAssetKind, WorkspaceOnboardingProgressUpdate } from '@shared/types';
import { researchKitDefinition, researchKitLabel, researchKitsForProfile } from '../../../shared/researchKits';
import { errorMessage } from '../../lib/errors';
import { renderTraceProseText } from '../traces/traceMarkup';
import {
  addDirectoryToOnboardingForm,
  onboardingRepositories,
  removeDirectoryFromOnboardingForm,
  setOnboardingRepositorySelected,
  workspaceCreationViewError,
  workspaceCreationViews,
  workspaceOnboardingFormForProfile,
  type WorkspaceCreationView as WorkspaceCreationViewId,
  type WorkspaceOnboardingFormState
} from '../../view-models/workspaceOnboarding';
import { WorkspaceDirectoriesField } from './WorkspaceDirectoriesWidget';
import {
  WORKSPACE_ASSET_KINDS,
  WorkspaceAssetIcon,
  workspaceAssetKindLabel,
  WorkspaceResourceDialog
} from './WorkspaceUnderstandingView';

const CREATION_VIEW_ICONS: Record<WorkspaceCreationViewId, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  kit: RefreshCw,
  resources: Boxes,
  rules: ListChecks
};

export function WorkspaceCreationView({
  busy,
  form,
  progress,
  submissionError = null,
  onCancel,
  onChange,
  onLookupHackerOne,
  onResearchKit,
  onSubmit,
  onViewChange
}: {
  busy: boolean;
  form: WorkspaceOnboardingFormState;
  progress: WorkspaceOnboardingProgressUpdate | null;
  submissionError?: string | null;
  onCancel: () => void;
  onChange: (next: WorkspaceOnboardingFormState) => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onResearchKit: (researchKitId: ResearchKitId) => void;
  onSubmit: () => void;
  onViewChange?: (viewName: string) => void;
}): JSX.Element {
  const views = workspaceCreationViews(form);
  const [activeView, setActiveView] = useState<WorkspaceCreationViewId>('overview');
  const [maximumUnlockedIndex, setMaximumUnlockedIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [hackerOneSource, setHackerOneSource] = useState(() => hackerOneIdentifier(form));
  const [importedHackerOneSource, setImportedHackerOneSource] = useState(() => hackerOneIdentifier(form));
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const previousTemplateRef = useRef(`${form.researchProfileId}:${form.researchKitId}`);
  const submitting = busy || Boolean(progress && progress.phase !== 'complete');

  useEffect(() => {
    const templateKey = `${form.researchProfileId}:${form.researchKitId}`;
    if (templateKey === previousTemplateRef.current) return;
    previousTemplateRef.current = templateKey;
    setActiveView('overview');
    setMaximumUnlockedIndex(0);
    setStepError(null);
    setLookupError(null);
    setHackerOneSource(hackerOneIdentifier(form));
    setImportedHackerOneSource(hackerOneIdentifier(form));
  }, [form.researchKitId, form.researchProfileId]);

  useEffect(() => {
    onViewChange?.(creationViewLabel(activeView, form.researchKitId));
  }, [activeView, form.researchKitId, onViewChange]);

  const validate = (view: WorkspaceCreationViewId): string | null => {
    const error = workspaceCreationViewError(form, view);
    if (error) return error;
    if (view === 'kit' && form.researchKitId === 'hackerone') {
      if (!hackerOneSource.trim()) return 'Enter a HackerOne program handle or URL.';
      if (normalizedHackerOneIdentifier(hackerOneSource) !== importedHackerOneSource) {
        return 'Import the current HackerOne program before continuing.';
      }
    }
    return null;
  };

  const advance = (): void => {
    const error = validate(activeView);
    if (error) {
      setStepError(error);
      return;
    }
    const currentIndex = views.indexOf(activeView);
    const next = views[currentIndex + 1];
    if (!next) return;
    setMaximumUnlockedIndex((current) => Math.max(current, currentIndex + 1));
    setActiveView(next);
    setStepError(null);
  };

  const createWorkspace = (): void => {
    for (const view of views) {
      const error = validate(view);
      if (!error) continue;
      setMaximumUnlockedIndex((current) => Math.max(current, views.indexOf(view)));
      setActiveView(view);
      setStepError(error);
      return;
    }
    setStepError(null);
    onSubmit();
  };

  const importHackerOne = async (): Promise<void> => {
    const normalized = normalizedHackerOneIdentifier(hackerOneSource);
    if (!normalized) return;
    setLookupBusy(true);
    setLookupError(null);
    try {
      await onLookupHackerOne(hackerOneSource);
      setImportedHackerOneSource(normalized);
    } catch (caught: unknown) {
      setImportedHackerOneSource('');
      setLookupError(errorMessage(caught));
    } finally {
      setLookupBusy(false);
    }
  };

  return (
    <main className="workspace-dashboard workspace-creation" aria-label="New Workspace">
      <div className="workspace-dashboard-tabs research-side-view-tabs" role="tablist" aria-label="New Workspace views">
        {views.map((view, index) => {
          const selected = activeView === view;
          const ViewIcon = CREATION_VIEW_ICONS[view];
          const locked = index > maximumUnlockedIndex;
          return (
            <div className={`research-side-view-tab provider-settings-tab workspace-dashboard-tab ${selected ? 'active' : ''}`.trim()} key={view}>
              <button
                aria-controls={`workspace-creation-${view}-panel`}
                aria-selected={selected}
                className="research-side-view-tab-activate"
                disabled={locked}
                onClick={() => { setActiveView(view); setStepError(null); }}
                role="tab"
                type="button"
              >
                <ViewIcon aria-hidden="true" className="workspace-dashboard-tab-icon" size={14} />
                <span>{creationViewLabel(view, form.researchKitId)}</span>
              </button>
            </div>
          );
        })}
      </div>

      {activeView === 'overview' ? (
        <WorkspaceCreationOverview
          busy={submitting}
          error={stepError}
          form={form}
          onCancel={onCancel}
          onChange={onChange}
          onNext={advance}
          onResearchKit={onResearchKit}
        />
      ) : null}
      {activeView === 'kit' ? (
        <WorkspaceCreationKit
          busy={submitting || lookupBusy}
          error={stepError ?? lookupError}
          form={form}
          hackerOneSource={hackerOneSource}
          lookupBusy={lookupBusy}
          onCancel={onCancel}
          onChangeHackerOneSource={(value) => { setHackerOneSource(value); setLookupError(null); }}
          onImportHackerOne={() => void importHackerOne()}
          onNext={advance}
          onReloadKit={() => onResearchKit(form.researchKitId)}
        />
      ) : null}
      {activeView === 'resources' ? (
        <WorkspaceCreationResources
          busy={submitting}
          error={stepError}
          form={form}
          onCancel={onCancel}
          onChange={onChange}
          onNext={advance}
        />
      ) : null}
      {activeView === 'rules' ? (
        <WorkspaceCreationRules
          busy={submitting}
          error={stepError ?? submissionError}
          form={form}
          progress={progress}
          onCancel={onCancel}
          onChange={onChange}
          onCreate={createWorkspace}
        />
      ) : null}
    </main>
  );
}

function WorkspaceCreationOverview({
  busy,
  error,
  form,
  onCancel,
  onChange,
  onNext,
  onResearchKit
}: {
  busy: boolean;
  error: string | null;
  form: WorkspaceOnboardingFormState;
  onCancel: () => void;
  onChange: (next: WorkspaceOnboardingFormState) => void;
  onNext: () => void;
  onResearchKit: (researchKitId: ResearchKitId) => void;
}): JSX.Element {
  return (
    <section className="workspace-dashboard-panel workspace-overview" id="workspace-creation-overview-panel" role="tabpanel">
      <div className="workspace-overview-layout settings-form">
        <WorkspaceCreationHeader
          description="Define the workspace context and authorized research boundary."
          error={error}
          onCancel={onCancel}
          onPrimary={onNext}
          primaryLabel="Next"
          title="Overview"
          busy={busy}
        />
        <div className="workspace-overview-form">
          <div className="settings-form-squircle">
            <div className="settings-form-control-list">
              <label className="settings-form-control-row workspace-overview-control-row">
                <span className="settings-form-control-copy"><strong>Research Profile</strong><small>The research profile that defines this workspace.</small></span>
                <select
                  aria-label="Research Profile"
                  className="workspace-overview-input"
                  disabled={busy}
                  onChange={(event) => {
                    const researchProfileId = event.target.value as WorkspaceOnboardingFormState['researchProfileId'];
                    onChange(workspaceOnboardingFormForProfile({ ...form, researchProfileId }, researchProfileId));
                  }}
                  value={form.researchProfileId}
                >
                  <option value="security-research">Security</option>
                  <option value="mathematics">Mathematics</option>
                </select>
              </label>
              <label className="settings-form-control-row workspace-overview-control-row">
                <span className="settings-form-control-copy"><strong>Research Kit</strong><small>Choose the resource, scope, and rule acquisition kit for this workspace.</small></span>
                <select
                  aria-label="Research Kit"
                  className="workspace-overview-input"
                  disabled={busy}
                  onChange={(event) => onResearchKit(event.target.value as ResearchKitId)}
                  value={form.researchKitId}
                >
                  {researchKitsForProfile(form.researchProfileId).map((kit) => <option key={kit.id} value={kit.id}>{kit.label}</option>)}
                </select>
              </label>
              <label className="settings-form-control-row workspace-overview-control-row">
                <span className="settings-form-control-copy"><strong>Research Subject</strong><small>The subject shared across related workspaces.</small></span>
                <input aria-label="Research Subject" className="workspace-overview-input" disabled={busy} maxLength={200} onChange={(event) => onChange({ ...form, researchSubjectName: event.target.value })} required value={form.researchSubjectName} />
              </label>
              <label className="settings-form-control-row workspace-overview-control-row">
                <span className="settings-form-control-copy"><strong>Workspace Name</strong><small>Choose the name shown throughout Beale.</small></span>
                <input aria-label="Workspace Name" autoFocus className="workspace-overview-input" disabled={busy} maxLength={200} onChange={(event) => onChange({ ...form, workspaceName: event.target.value })} required value={form.workspaceName} />
              </label>
              <WorkspaceDirectoriesField
                directories={form.workspaceDirectories}
                disabled={busy}
                onAdd={(selection) => {
                  if (!selection.path) return;
                  if (selection.knownWorkspace) throw new Error(`Directory already belongs to workspace ${selection.knownWorkspace.workspaceName}.`);
                  onChange(addDirectoryToOnboardingForm(form, selection.path, selection.defaults));
                }}
                onRemove={(directory) => onChange(removeDirectoryFromOnboardingForm(form, directory))}
              />
              <WorkspaceCreationGuidanceField
                busy={busy}
                onChange={(descriptionMarkdown) => onChange({ ...form, descriptionMarkdown })}
                value={form.descriptionMarkdown}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceCreationGuidanceField({ busy, onChange, value }: {
  busy: boolean;
  onChange: (value: string) => void;
  value: string;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [height, setHeight] = useState(150);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const showEditor = (): void => {
    if (busy) return;
    const previewHeight = previewRef.current?.getBoundingClientRect().height;
    if (previewHeight && previewHeight >= 150) setHeight(previewHeight);
    setEditing(true);
  };
  const showPreview = (): void => {
    const editorHeight = editorRef.current?.getBoundingClientRect().height;
    if (editorHeight && editorHeight >= 150) setHeight(editorHeight);
    setEditing(false);
  };
  return (
    <div className="settings-form-control-row workspace-overview-control-row workspace-overview-textarea-row">
      <div className="workspace-guidance-field-heading">
        <span className="settings-form-control-copy"><strong>Workspace Guidance</strong><small>AGENTS.md instructions for research in this workspace.</small></span>
        {editing ? <button className="workspace-guidance-show-markdown" onClick={showPreview} type="button">Show Markdown</button> : null}
      </div>
      {editing ? (
        <textarea
          aria-label="Workspace Guidance"
          autoFocus
          className="workspace-guidance-editor"
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          ref={editorRef}
          rows={5}
          style={{ height }}
          value={value}
        />
      ) : (
        <div className="workspace-guidance-preview" ref={previewRef} style={{ height }}>
          <div
            aria-disabled={busy || undefined}
            aria-label="Workspace Guidance"
            className="workspace-guidance-preview-content"
            onClick={showEditor}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              showEditor();
            }}
            role="button"
            tabIndex={busy ? -1 : 0}
            title="Edit Workspace Guidance"
          >
            {value.trim()
              ? renderTraceProseText(value, 'agent_output')
              : <p className="workspace-guidance-preview-empty">Click to add workspace guidance.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceCreationKit({
  busy,
  error,
  form,
  hackerOneSource,
  lookupBusy,
  onCancel,
  onChangeHackerOneSource,
  onImportHackerOne,
  onNext,
  onReloadKit
}: {
  busy: boolean;
  error: string | null;
  form: WorkspaceOnboardingFormState;
  hackerOneSource: string;
  lookupBusy: boolean;
  onCancel: () => void;
  onChangeHackerOneSource: (value: string) => void;
  onImportHackerOne: () => void;
  onNext: () => void;
  onReloadKit: () => void;
}): JSX.Element {
  const kit = researchKitDefinition(form.researchKitId);
  const refresh = kit.refresh;
  if (!refresh) throw new Error(`Research Kit ${form.researchKitId} does not define imports.`);
  const isHackerOne = form.researchKitId === 'hackerone';
  const selectedRepositories = form.repositoryCandidates.filter((candidate) => candidate.selected).length;
  return (
    <section className="workspace-dashboard-panel workspace-research-kit-view" id="workspace-creation-kit-panel" role="tabpanel">
      <div className="settings-form workspace-research-kit-form">
        <WorkspaceCreationHeader busy={busy} description={kit.description} error={error} onCancel={onCancel} onPrimary={onNext} primaryLabel="Next" title={`${kit.label} Research Kit`} />
        <div className="settings-form-squircle">
          <div className="settings-form-control-list">
            <label className="settings-form-control-row workspace-research-kit-source">
              <span className="settings-form-control-copy"><strong>{refresh.sourceLabel}</strong><small>{refresh.sourceDescription}</small></span>
              <input
                aria-label={refresh.sourceLabel}
                disabled={busy || !isHackerOne}
                onChange={(event) => onChangeHackerOneSource(event.target.value)}
                placeholder={refresh.sourceIdentifierPlaceholder}
                value={isHackerOne ? hackerOneSource : (refresh.fixedSource ?? '')}
              />
            </label>
            <div className="settings-form-control-row workspace-research-kit-refresh">
              <span className="settings-form-control-copy">
                <strong>{isHackerOne ? 'Import Program' : 'Kit Imports'}</strong>
                <small>{isHackerOne
                  ? 'Import the current public program resources, rules, and workspace guidance.'
                  : form.repositoryCatalogLoading
                    ? 'Loading the repository catalog…'
                    : form.repositoryCatalogError
                      ? 'The repository catalog could not be loaded.'
                      : `${form.rules.length} rules and ${form.repositoryCandidates.length} repository candidates are ready${selectedRepositories ? `; ${selectedRepositories} selected` : ''}.`}</small>
              </span>
              {isHackerOne ? (
                <button disabled={busy || !hackerOneSource.trim()} onClick={onImportHackerOne} type="button">
                  {lookupBusy ? <Loader2 aria-hidden="true" className="is-spinning" size={14} /> : <RefreshCw aria-hidden="true" size={14} />}
                  {lookupBusy ? 'Importing…' : 'Import'}
                </button>
              ) : form.researchKitId === 'apple-security-bounty' && form.repositoryCatalogError ? (
                <button disabled={busy} onClick={onReloadKit} type="button"><RefreshCw aria-hidden="true" size={14} />Reload Catalog</button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceCreationResources({
  busy,
  error,
  form,
  onCancel,
  onChange,
  onNext
}: {
  busy: boolean;
  error: string | null;
  form: WorkspaceOnboardingFormState;
  onCancel: () => void;
  onChange: (next: WorkspaceOnboardingFormState) => void;
  onNext: () => void;
}): JSX.Element {
  const [activeKind, setActiveKind] = useState<ScopeAssetKind>('repo');
  const [dialog, setDialog] = useState<{ kind: ScopeAssetKind; assetIndex: number | null } | null>(null);
  const assets = form.assets.map((asset, index) => ({ asset, index })).filter(({ asset }) => asset.kind === activeKind);
  const repositories = activeKind === 'repo' ? onboardingRepositories(form).filter((repository) => repository.candidateIndex !== null) : [];
  const initialAsset = dialog?.assetIndex !== null && dialog?.assetIndex !== undefined
    ? scopeAssetForCreation(form.assets[dialog.assetIndex], dialog.assetIndex)
    : null;
  return (
    <section className="workspace-dashboard-panel workspace-surface-area workspace-creation-resources" id="workspace-creation-resources-panel" role="tabpanel">
      <WorkspaceCreationHeader busy={busy} description="Record the authorized targets and source material available to this workspace." error={error} onCancel={onCancel} onPrimary={onNext} primaryLabel="Next" title="Resources" />
      <div className="workspace-resource-tabs-bar">
        <div className="research-side-view-tabs workspace-resource-tabs" role="tablist" aria-label="Workspace resource types">
          {WORKSPACE_ASSET_KINDS.map((kind) => (
            <div className={`research-side-view-tab workspace-resource-tab ${activeKind === kind ? 'active' : ''}`.trim()} key={kind}>
              <button aria-selected={activeKind === kind} className="research-side-view-tab-activate" onClick={() => setActiveKind(kind)} role="tab" type="button">
                <WorkspaceAssetIcon kind={kind} size={14} /><span>{workspaceAssetKindLabel(kind)}</span>
              </button>
              <button aria-label={`Add ${workspaceAssetKindLabel(kind).toLowerCase()}`} className="research-side-view-tab-close workspace-resource-tab-add" disabled={busy} onClick={() => setDialog({ kind, assetIndex: null })} type="button"><Plus aria-hidden="true" size={14} /></button>
            </div>
          ))}
        </div>
      </div>
      <div className="workspace-surface-scroll">
        <div className="workspace-surface-list" role="tabpanel" aria-label={`${workspaceAssetKindLabel(activeKind)} resources`}>
          {form.repositoryCatalogLoading && activeKind === 'repo' ? <div className="workspace-surface-empty"><Loader2 aria-hidden="true" className="is-spinning" size={15} /> Loading repository catalog…</div> : null}
          {repositories.map((repository) => (
            <label className="workspace-surface-item workspace-creation-candidate" key={`candidate-${repository.candidateIndex}`}>
              <input aria-label={`Include ${repository.label}`} checked={repository.selected} disabled={busy} onChange={(event) => onChange(setOnboardingRepositorySelected(form, repository.candidateIndex!, event.target.checked))} type="checkbox" />
              <span className="workspace-surface-item-icon" aria-hidden="true"><WorkspaceAssetIcon kind="repo" /></span>
              <span className="workspace-surface-item-main"><strong>{repository.label}</strong><small title={repository.url}>{repository.url}</small>{repository.archived ? <em>Archived</em> : null}</span>
            </label>
          ))}
          {assets.map(({ asset, index }) => (
            <article className={`workspace-surface-item is-${asset.direction}`} key={`asset-${index}`}>
              <button className="workspace-surface-item-open" disabled={busy} onClick={() => setDialog({ kind: asset.kind, assetIndex: index })} type="button">
                <span className="workspace-surface-item-icon" aria-hidden="true"><WorkspaceAssetIcon kind={asset.kind} /></span>
                <span className="workspace-surface-item-main"><strong>{resourceLabel(asset)}</strong><small title={asset.value}>{asset.value}</small><span className="workspace-surface-item-meta">{asset.direction === 'in_scope' ? 'In scope' : 'Out of scope'}</span></span>
              </button>
            </article>
          ))}
          {!form.repositoryCatalogLoading && repositories.length === 0 && assets.length === 0 ? <div className="workspace-surface-empty">No {workspaceAssetKindLabel(activeKind).toLowerCase()} resources recorded.</div> : null}
        </div>
      </div>
      {dialog ? (
        <WorkspaceResourceDialog
          initialAsset={initialAsset}
          kind={dialog.kind}
          onClose={() => setDialog(null)}
          onRemove={dialog.assetIndex !== null ? async () => onChange({ ...form, assets: form.assets.filter((_asset, index) => index !== dialog.assetIndex) }) : undefined}
          onSubmit={async (asset) => onChange({
            ...form,
            assets: dialog.assetIndex === null
              ? [...form.assets, asset]
              : form.assets.map((existing, index) => index === dialog.assetIndex ? asset : existing)
          })}
        />
      ) : null}
    </section>
  );
}

function WorkspaceCreationRules({
  busy,
  error,
  form,
  progress,
  onCancel,
  onChange,
  onCreate
}: {
  busy: boolean;
  error: string | null;
  form: WorkspaceOnboardingFormState;
  progress: WorkspaceOnboardingProgressUpdate | null;
  onCancel: () => void;
  onChange: (next: WorkspaceOnboardingFormState) => void;
  onCreate: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [ruleError, setRuleError] = useState<string | null>(null);
  const addRule = (): void => {
    const rule = draft.trim();
    if (!rule) return;
    if (rule.length > 2_000) { setRuleError('Workspace rules must be at most 2,000 characters.'); return; }
    if (form.rules.some((existing) => existing.trim() === rule)) { setRuleError('That workspace rule is already listed.'); return; }
    onChange({ ...form, rules: [...form.rules, rule] });
    setDraft('');
    setRuleError(null);
  };
  return (
    <section className="workspace-dashboard-panel workspace-rules" id="workspace-creation-rules-panel" role="tabpanel">
      <div className="workspace-rules-layout settings-form">
        <WorkspaceCreationHeader busy={busy} description="Record the operating constraints applied to every research session." error={error ?? ruleError} onCancel={onCancel} onPrimary={onCreate} primaryLabel={busy ? 'Creating…' : 'Create Workspace'} title="Rules" />
        <div className="settings-form-squircle workspace-rules-surface">
          <form className="workspace-rule-composer" onSubmit={(event) => { event.preventDefault(); addRule(); }}>
            <input aria-label="New workspace rule" disabled={busy} maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder="Add a rule" value={draft} />
            <button disabled={busy || !draft.trim()} type="submit"><Plus aria-hidden="true" size={14} />Add Rule</button>
          </form>
          {form.rules.length > 0 ? (
            <ol aria-label="Workspace rules" className="workspace-rule-list workspace-creation-rule-list">
              {form.rules.map((rule, index) => (
                <li key={`${index}:${rule}`}><span>{rule}</span><button aria-label={`Remove rule ${index + 1}`} disabled={busy} onClick={() => onChange({ ...form, rules: form.rules.filter((_rule, candidateIndex) => candidateIndex !== index) })} type="button"><Trash2 aria-hidden="true" size={14} /></button></li>
              ))}
            </ol>
          ) : <p className="workspace-rules-empty">No workspace rules recorded.</p>}
          {progress ? <p className="workspace-creation-progress" role="status">{progress.phase === 'complete' ? 'Workspace created.' : `Creating workspace · ${progress.repositories.length} repositories queued.`}</p> : null}
        </div>
      </div>
    </section>
  );
}

function WorkspaceCreationHeader({ busy, description, error, onCancel, onPrimary, primaryLabel, title }: {
  busy: boolean;
  description: string;
  error: string | null;
  onCancel: () => void;
  onPrimary: () => void;
  primaryLabel: string;
  title: string;
}): JSX.Element {
  return (
    <header className="settings-form-heading workspace-creation-view-heading">
      <div className="workspace-creation-view-copy"><h2>{title}</h2><p>{description}</p>{error ? <small className="workspace-creation-step-error" role="alert">{error}</small> : null}</div>
      <div className="workspace-creation-view-actions"><button disabled={busy} onClick={onCancel} type="button">Cancel</button><button className="primary-button" disabled={busy} onClick={onPrimary} type="button">{primaryLabel}</button></div>
    </header>
  );
}

function creationViewLabel(view: WorkspaceCreationViewId, researchKitId: ResearchKitId): string {
  if (view === 'kit') return researchKitLabel(researchKitId);
  return view.charAt(0).toUpperCase() + view.slice(1);
}

function hackerOneIdentifier(form: WorkspaceOnboardingFormState): string {
  for (const asset of form.assets) {
    const handle = asset.attributes?.hackerOneHandle;
    if (typeof handle === 'string' && handle.trim()) return normalizedHackerOneIdentifier(handle);
  }
  return '';
}

function normalizedHackerOneIdentifier(value: string): string {
  return value.trim().replace(/^https?:\/\/(?:www\.)?hackerone\.com\//iu, '').replace(/^@/u, '').split(/[/?#]/u, 1)[0]?.trim() ?? '';
}

function scopeAssetForCreation(asset: ScopeAssetInput | undefined, index: number): ScopeAsset | null {
  return asset ? { ...asset, id: `creation_asset_${index}`, scopeVersionId: 'workspace_creation', createdAt: new Date(0).toISOString() } : null;
}

function resourceLabel(asset: ScopeAssetInput): string {
  const displayName = asset.attributes?.displayName;
  return typeof displayName === 'string' && displayName.trim() ? displayName.trim() : asset.value;
}
