import type { JSX } from 'react';
import { Activity, DatabaseZap, KeyRound, RefreshCw, Server, Terminal } from 'lucide-react';
import type {
  ExecutorBackendStatus,
  ExecutorStatus,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  ProfilingState,
  ProjectSemanticSummary,
  VmPreference,
  VmPreferenceInput
} from '@shared/types';
import { Modal } from '../../app/Modal';
import { StatusPill } from '../../app/StatusPill';
import { formatSessionDateTime, stateClass } from '../../lib/formatting';
import { findBackendByKind } from '../../view-models/environmentDisplay';

export type SettingsSection = 'general' | 'providers';

export function SettingsModal({
  section,
  executor,
  projectSemantic,
  programName,
  vmPreference,
  openAiStatus,
  openAiOAuthResult,
  profilingState,
  busy,
  onChangeSection,
  onClose,
  onSetVmPreference,
  onRefreshProjectSemanticIndex,
  onSetProjectSemanticIndexEnabled,
  onSetProfilingEnabled,
  onRefreshOpenAi,
  onStartOpenAiOAuth
}: {
  section: SettingsSection;
  executor: ExecutorStatus | null;
  projectSemantic: ProjectSemanticSummary | null;
  programName: string | null;
  vmPreference: VmPreference;
  openAiStatus: OpenAiAccountStatus | null;
  openAiOAuthResult: OpenAiOAuthStartResult | null;
  profilingState: ProfilingState | null;
  busy: boolean;
  onChangeSection: (section: SettingsSection) => void;
  onClose: () => void;
  onSetVmPreference: (input: VmPreferenceInput) => Promise<void>;
  onRefreshProjectSemanticIndex: () => Promise<void>;
  onSetProjectSemanticIndexEnabled: (enabled: boolean) => Promise<void>;
  onSetProfilingEnabled: (enabled: boolean) => Promise<void>;
  onRefreshOpenAi: () => Promise<void>;
  onStartOpenAiOAuth: () => Promise<void>;
}): JSX.Element {
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
          {(['general', 'providers'] as SettingsSection[]).map((item) => (
            <button type="button" className={section === item ? 'active' : ''} key={item} onClick={() => onChangeSection(item)}>
              {settingsSectionLabel(item)}
            </button>
          ))}
        </nav>
        <section className="settings-view">
          {section === 'general' ? (
            <GeneralSettingsView
              busy={busy}
              executor={executor}
              projectSemantic={projectSemantic}
              programName={programName}
              profilingState={profilingState}
              vmPreference={vmPreference}
              onRefreshProjectSemanticIndex={onRefreshProjectSemanticIndex}
              onSetProjectSemanticIndexEnabled={onSetProjectSemanticIndexEnabled}
              onSetProfilingEnabled={onSetProfilingEnabled}
              onSetVmPreference={onSetVmPreference}
            />
          ) : (
            <ProvidersSettingsView busy={busy} openAiOAuthResult={openAiOAuthResult} openAiStatus={openAiStatus} onRefreshOpenAi={onRefreshOpenAi} onStartOpenAiOAuth={onStartOpenAiOAuth} />
          )}
        </section>
      </div>
    </Modal>
  );
}

function GeneralSettingsView({
  executor,
  projectSemantic,
  programName,
  vmPreference,
  profilingState,
  busy,
  onRefreshProjectSemanticIndex,
  onSetProjectSemanticIndexEnabled,
  onSetProfilingEnabled,
  onSetVmPreference
}: {
  executor: ExecutorStatus | null;
  projectSemantic: ProjectSemanticSummary | null;
  programName: string | null;
  vmPreference: VmPreference;
  profilingState: ProfilingState | null;
  busy: boolean;
  onRefreshProjectSemanticIndex: () => Promise<void>;
  onSetProjectSemanticIndexEnabled: (enabled: boolean) => Promise<void>;
  onSetProfilingEnabled: (enabled: boolean) => Promise<void>;
  onSetVmPreference: (input: VmPreferenceInput) => Promise<void>;
}): JSX.Element {
  const selection = vmSelectionStatus(executor, vmPreference);
  const status = selection.status;
  const controller = executorControllerMetadata(executor);

  return (
    <div className="settings-page general-settings-page">
      <div className="settings-page-header">
        <h3>General</h3>
      </div>
      <section className={`provider-card vm-settings-card readiness-${stateClass(status)}`}>
        <div className="provider-heading">
          <div className="status-icon">
            <Server size={18} />
          </div>
          <div>
            <h4>Local VM</h4>
            <p>{selection.heading}</p>
          </div>
          <StatusPill status={status} />
        </div>

        <div className="provider-grid vm-provider-grid">
          <div>
            <span>Provider</span>
            <strong>{executor?.provider ?? 'vmctl'}</strong>
          </div>
          <div>
            <span>Execution</span>
            <strong>{selection.execution}</strong>
          </div>
          <div>
            <span>Network</span>
            <strong>{executor?.supportedNetworkProfiles.join(', ') || 'none'}</strong>
          </div>
          <div>
            <span>Controller</span>
            <strong>{controller.autoDiscovered ? 'auto' : executor?.configured ? 'environment' : 'not configured'}</strong>
          </div>
        </div>

        <p className="provider-detail">{executorStatusDetail(executor, vmPreference)}</p>
        {controller.configPath ? <p className="provider-detail muted">Config: {controller.configPath}</p> : null}

        <div className="vm-backend-list">
          {(executor?.backends ?? []).map((backend) => (
            <div className={`vm-backend-row ${backendRowClass(backend, vmPreference)}`} key={backend.kind}>
              <div>
                <strong>{backend.label}</strong>
                <span>{backend.reason ?? (backend.available ? 'Available' : backend.recommended ? 'Recommended for this host' : 'Not configured')}</span>
              </div>
              <div className="vm-backend-controls">
                <StatusPill status={backendStatusLabel(backend, vmPreference)} />
                {vmPreference.enabled && vmPreference.backendKind === backend.kind ? (
                  <button type="button" disabled={busy} onClick={() => void onSetVmPreference({ enabled: false, backendKind: null })}>
                    Disable
                  </button>
                ) : (
                  <button type="button" disabled={busy || !backend.available} onClick={() => void onSetVmPreference({ enabled: true, backendKind: backend.kind })}>
                    Enable
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="provider-actions">
          <div className="command-row">
            <Terminal size={15} />
            <code>{executorVmSetupCommand(executor)}</code>
          </div>
        </div>
      </section>
      <section className={`provider-card semantic-index-card readiness-${stateClass(projectSemantic?.status ?? 'disabled')}`}>
        <div className="provider-heading">
          <div className="status-icon">
            <DatabaseZap size={18} />
          </div>
          <div>
            <h4>Project Understanding</h4>
            <p>{semanticHeading(projectSemantic, programName)}</p>
          </div>
          <StatusPill status={projectSemantic?.status ?? 'disabled'} />
        </div>

        <div className="provider-grid semantic-provider-grid">
          <div>
            <span>Chunks</span>
            <strong>{projectSemantic ? projectSemantic.chunkCount.toLocaleString() : '0'}</strong>
          </div>
          <div>
            <span>Sources</span>
            <strong>{semanticSourceLabel(projectSemantic)}</strong>
          </div>
          <div>
            <span>Size</span>
            <strong>{formatSemanticBytes(projectSemantic?.indexSizeBytes ?? 0)}</strong>
          </div>
          <div>
            <span>Build</span>
            <strong>{formatSemanticDuration(projectSemantic?.lastRefreshDurationMs ?? null)}</strong>
          </div>
        </div>

        <p className="provider-detail">{semanticDetail(projectSemantic)}</p>

        <div className="semantic-namespace-list" aria-label="Semantic index namespaces">
          {semanticNamespaceRows(projectSemantic).map(([namespace, count]) => (
            <div key={namespace}>
              <span>{namespaceLabel(namespace)}</span>
              <strong>{count.toLocaleString()}</strong>
            </div>
          ))}
        </div>

        <div className="provider-actions semantic-index-actions">
          <button type="button" disabled={busy || !projectSemantic} onClick={() => void onSetProjectSemanticIndexEnabled(!(projectSemantic?.enabled ?? false))}>
            {projectSemantic?.enabled ? 'Disable' : 'Enable'}
          </button>
          <button type="button" disabled={busy || !projectSemantic?.enabled} onClick={() => void onRefreshProjectSemanticIndex()}>
            Rebuild
          </button>
        </div>
      </section>
      <section className="provider-card profiling-settings-card">
        <div className="provider-heading">
          <div className="status-icon">
            <Activity size={18} />
          </div>
          <div>
            <h4>Profiling</h4>
            <p>Capture renderer reports and main IPC timings to a local JSONL file.</p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={profilingState?.enabled ?? false}
              disabled={busy}
              onChange={(event) => void onSetProfilingEnabled(event.target.checked)}
            />
            <span>{profilingState?.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <p className="provider-detail">
          {profilingState?.outputPath ? `Output: ${profilingState.outputPath}` : 'Enable profiling to create a temporary output file.'}
        </p>
      </section>
    </div>
  );
}

function semanticHeading(summary: ProjectSemanticSummary | null, programName: string | null): string {
  const name = programName?.trim() || 'the active program';
  if (!summary) return 'Open a program to manage project understanding indexes.';
  if (!summary.enabled) return `Semantic search is off for ${name}.`;
  if (summary.status === 'queued') return `Semantic indexing is queued for ${name}.`;
  if (summary.status === 'indexing') return `Semantic indexing is running for ${name}.`;
  if (summary.status === 'error') return `Semantic indexing failed for ${name}.`;
  if (summary.status === 'canceled') return `Semantic indexing was canceled for ${name}.`;
  if (summary.status === 'stale') return `Semantic search for ${name} needs rebuild.`;
  if (summary.chunkCount === 0) return `Semantic search is on for ${name}, but no chunks are indexed yet.`;
  return `Semantic search is on for ${name}.`;
}

function semanticDetail(summary: ProjectSemanticSummary | null): string {
  if (!summary) return 'Semantic indexing is scoped to a single program and stored locally under .beale/.';
  if (summary.status === 'queued') return `Queued ${summary.queuedAt ? formatSessionDateTime(summary.queuedAt) : 'now'}. Search will use exact and stale indexed results while the rebuild waits.`;
  if (summary.status === 'indexing') return `Started ${summary.startedAt ? formatSessionDateTime(summary.startedAt) : 'recently'}. Search remains available with exact and stale indexed results.`;
  if (summary.status === 'error') return `Last error: ${summary.lastError || 'Semantic indexing failed. Search remains available without fresh semantic results.'}`;
  if (summary.status === 'canceled') return `Canceled ${summary.finishedAt ? formatSessionDateTime(summary.finishedAt) : 'recently'}.`;
  const indexed = summary.indexedAt ? formatSessionDateTime(summary.indexedAt) : 'never';
  const model = `${summary.provider} / ${summary.model}`;
  const remote = summary.remoteEmbeddingEnabled ? 'Remote embeddings are enabled.' : 'Remote embeddings are off; indexed material stays local.';
  return `Last indexed ${indexed}. ${summary.embeddedChunkCount.toLocaleString()} embedded chunk${summary.embeddedChunkCount === 1 ? '' : 's'} using ${model}. ${remote}`;
}

function semanticSourceLabel(summary: ProjectSemanticSummary | null): string {
  if (!summary) return '0/0';
  return `${summary.indexedSourceDocumentCount.toLocaleString()}/${summary.sourceDocumentCount.toLocaleString()}`;
}

function formatSemanticBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function formatSemanticDuration(durationMs: number | null): string {
  if (durationMs === null) return 'never';
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))} ms`;
  return `${Math.round((durationMs / 1000) * 10) / 10} s`;
}

function semanticNamespaceRows(summary: ProjectSemanticSummary | null): Array<[string, number]> {
  const rows = Object.entries(summary?.namespaceCounts ?? {}).filter(([, count]) => count > 0);
  return rows.length ? rows.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])) : [['none', 0]];
}

function namespaceLabel(namespace: string): string {
  return namespace
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
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
            <strong>{openAiStatus?.defaultModel ?? 'gpt-5.5'}</strong>
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

function vmSelectionStatus(
  executor: ExecutorStatus | null,
  vmPreference: VmPreference
): { status: string; heading: string; execution: string; backend: ExecutorBackendStatus | null } {
  if (!vmPreference.enabled || !vmPreference.backendKind) {
    return {
      status: 'none',
      heading: 'No VM enabled',
      execution: 'host machine',
      backend: null
    };
  }

  const backend = findBackendByKind(executor, vmPreference.backendKind);
  if (!backend) {
    return {
      status: 'unavailable',
      heading: 'Enabled VM is not reported by this host',
      execution: 'not available',
      backend: null
    };
  }

  if (backend.available && executor?.available === true) {
    return {
      status: 'enabled',
      heading: backend.label,
      execution: 'guest VM',
      backend
    };
  }

  return {
    status: 'unavailable',
    heading: `${backend.label} unavailable`,
    execution: 'not available',
    backend
  };
}

function backendRowClass(backend: ExecutorBackendStatus, vmPreference: VmPreference): string {
  return [
    backend.available ? 'available' : '',
    backend.configured && !backend.available ? 'configured' : '',
    vmPreference.enabled && vmPreference.backendKind === backend.kind ? 'selected' : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function backendStatusLabel(backend: ExecutorBackendStatus, vmPreference: VmPreference): string {
  if (vmPreference.enabled && vmPreference.backendKind === backend.kind) return backend.available ? 'enabled' : 'unavailable';
  if (backend.available) return 'available';
  if (backend.configured) return 'configured';
  return 'not_configured';
}

function executorControllerMetadata(executor: ExecutorStatus | null): { autoDiscovered: boolean; configPath: string | null } {
  const metadata = executor?.metadata;
  const controller = metadata?.controller;
  if (!controller || typeof controller !== 'object' || Array.isArray(controller)) {
    return { autoDiscovered: false, configPath: null };
  }
  const record = controller as Record<string, unknown>;
  return {
    autoDiscovered: record.autoDiscovered === true,
    configPath: typeof record.configPath === 'string' && record.configPath.trim() ? record.configPath : null
  };
}

function executorStatusDetail(executor: ExecutorStatus | null, vmPreference: VmPreference): string {
  if (!vmPreference.enabled || !vmPreference.backendKind) {
    return 'No local VM is enabled. Research sessions run on the host unless a VM backend is enabled here.';
  }
  const backend = findBackendByKind(executor, vmPreference.backendKind);
  if (backend?.available && executor?.available === true) return 'Beale can execute target code and verifier contracts inside the enabled disposable VM.';
  if (backend) return executor?.reason ?? backend.reason ?? 'The enabled local VM backend is not currently available.';
  if (!executor) return 'Open a research program to check the local VM executor.';
  if (executor.configured) return executor.reason ?? 'A local VM controller is configured, but it is not currently available.';
  return 'Beale did not find a local VM controller. On WSL/Linux, Firecracker is autodetected when .beale/firecracker/config.json exists in the Beale app directory.';
}

function executorVmSetupCommand(executor: ExecutorStatus | null): string {
  if (executor?.available) return 'npm run firecracker:doctor';
  if (executor?.configured) return 'npm run firecracker:doctor';
  const firecrackerRecommended = !executor || executor.backends.some((backend) => backend.kind === 'firecracker' && backend.recommended);
  if (firecrackerRecommended) return 'npm run firecracker:init && npm run firecracker:doctor';
  return 'Configure BEALE_VMCTL_COMMAND for a Beale vmctl-compatible local VM controller.';
}

function settingsSectionLabel(section: SettingsSection): string {
  switch (section) {
    case 'general':
      return 'General';
    case 'providers':
      return 'Providers';
  }
}
