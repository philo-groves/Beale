import { useState, type JSX } from 'react';
import { Activity, DatabaseZap, KeyRound, RefreshCw, Server, ShieldAlert, Terminal } from 'lucide-react';
import type {
  ExecutorBackendKind,
  ExecutorBackendStatus,
  ExecutorStatus,
  OpenAiAccountStatus,
  OpenAiOAuthStartResult,
  ProfilingState,
  ProjectSemanticSummary,
  SandboxSetupInput,
  SandboxSetupResult,
  VmPreference,
  VmPreferenceInput
} from '@shared/types';
import { Modal } from '../../app/Modal';
import { StatusPill } from '../../app/StatusPill';
import { formatSessionDateTime, stateClass } from '../../lib/formatting';
import { findBackendByKind } from '../../view-models/environmentDisplay';

export type SettingsSection = 'general' | 'sandboxes' | 'providers';

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
  onSetupSandbox,
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
  onSetupSandbox: (input: SandboxSetupInput) => Promise<SandboxSetupResult>;
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
          {(['general', 'sandboxes', 'providers'] as SettingsSection[]).map((item) => (
            <button type="button" className={section === item ? 'active' : ''} key={item} onClick={() => onChangeSection(item)}>
              {settingsSectionLabel(item)}
            </button>
          ))}
        </nav>
        <section className="settings-view">
          {section === 'general' ? (
            <GeneralSettingsView
              busy={busy}
              projectSemantic={projectSemantic}
              programName={programName}
              profilingState={profilingState}
              onRefreshProjectSemanticIndex={onRefreshProjectSemanticIndex}
              onSetProjectSemanticIndexEnabled={onSetProjectSemanticIndexEnabled}
              onSetProfilingEnabled={onSetProfilingEnabled}
            />
          ) : section === 'sandboxes' ? (
            <SandboxSettingsView busy={busy} executor={executor} vmPreference={vmPreference} onSetupSandbox={onSetupSandbox} onSetVmPreference={onSetVmPreference} />
          ) : (
            <ProvidersSettingsView busy={busy} openAiOAuthResult={openAiOAuthResult} openAiStatus={openAiStatus} onRefreshOpenAi={onRefreshOpenAi} onStartOpenAiOAuth={onStartOpenAiOAuth} />
          )}
        </section>
      </div>
    </Modal>
  );
}

function GeneralSettingsView({
  projectSemantic,
  programName,
  profilingState,
  busy,
  onRefreshProjectSemanticIndex,
  onSetProjectSemanticIndexEnabled,
  onSetProfilingEnabled
}: {
  projectSemantic: ProjectSemanticSummary | null;
  programName: string | null;
  profilingState: ProfilingState | null;
  busy: boolean;
  onRefreshProjectSemanticIndex: () => Promise<void>;
  onSetProjectSemanticIndexEnabled: (enabled: boolean) => Promise<void>;
  onSetProfilingEnabled: (enabled: boolean) => Promise<void>;
}): JSX.Element {
  return (
    <div className="settings-page general-settings-page">
      <div className="settings-page-header">
        <h3>General</h3>
      </div>
      <section className={`provider-card semantic-index-card readiness-${stateClass(projectSemantic?.status ?? 'disabled')}`}>
        <div className="provider-heading">
          <div className="status-icon">
            <DatabaseZap size={18} />
          </div>
          <div>
            <h4>Program Understanding</h4>
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

function SandboxSettingsView({
  executor,
  vmPreference,
  busy,
  onSetupSandbox,
  onSetVmPreference
}: {
  executor: ExecutorStatus | null;
  vmPreference: VmPreference;
  busy: boolean;
  onSetupSandbox: (input: SandboxSetupInput) => Promise<SandboxSetupResult>;
  onSetVmPreference: (input: VmPreferenceInput) => Promise<void>;
}): JSX.Element {
  const backends = sandboxBackendsForDisplay(executor);
  const [selectedKind, setSelectedKind] = useState<ExecutorBackendKind | null>(vmPreference.backendKind ?? defaultSandboxBackendKind(backends));
  const [setupState, setSetupState] = useState<{
    backendKind: ExecutorBackendKind;
    status: 'running' | 'ok' | 'error';
    detail: string;
  } | null>(null);
  const displayKind = selectedKind ?? vmPreference.backendKind ?? defaultSandboxBackendKind(backends);
  const selectedBackend = backends.find((backend) => backend.kind === displayKind) ?? null;
  const active = Boolean(selectedBackend && vmPreference.enabled && vmPreference.backendKind === selectedBackend.kind);
  const selection = selectedBackend ? sandboxSelectionStatus(selectedBackend, active) : { status: 'none', heading: 'No sandbox selected' };
  const controller = executorControllerMetadata(executor);
  const properties = selectedBackend ? sandboxPropertyRows(selectedBackend, executor, controller) : [];
  const setupRunning = setupState?.status === 'running';

  const setupDocker = async (): Promise<void> => {
    setSetupState({
      backendKind: 'docker',
      status: 'running',
      detail: 'Preparing the Docker sandbox image. This may take several minutes.'
    });
    try {
      const result = await onSetupSandbox({ backendKind: 'docker' });
      setSetupState({
        backendKind: result.backendKind,
        status: result.ok ? 'ok' : 'error',
        detail: result.detail
      });
    } catch (caught) {
      setSetupState({
        backendKind: 'docker',
        status: 'error',
        detail: caught instanceof Error ? caught.message : 'Docker setup failed.'
      });
    }
  };

  return (
    <div className="settings-page sandboxes-settings-page">
      <div className="settings-page-header">
        <h3>Sandboxes</h3>
      </div>

      <section className={`provider-card sandbox-settings-card readiness-${stateClass(selection.status)}`}>
        <div className="sandbox-selector" role="tablist" aria-label="Sandbox backends">
          {backends.map((backend) => (
            <button
              type="button"
              role="tab"
              aria-selected={selectedBackend?.kind === backend.kind}
              className={selectedBackend?.kind === backend.kind ? 'selected' : ''}
              key={backend.kind}
              onClick={() => setSelectedKind(backend.kind)}
            >
              <strong>{sandboxShortLabel(backend)}</strong>
              <span>{sandboxSelectorDetail(backend)}</span>
              <StatusPill status={backendStatusLabel(backend, vmPreference)} />
            </button>
          ))}
        </div>

        {selectedBackend ? (
          <>
            <div className="provider-heading sandbox-detail-heading">
              <div className="status-icon">
                <Server size={18} />
              </div>
              <div>
                <h4>{selectedBackend.label}</h4>
                <p>{selection.heading}</p>
              </div>
              <StatusPill status={backendStatusLabel(selectedBackend, vmPreference)} />
            </div>

            {selectedBackend.kind === 'docker' ? (
              <div className="sandbox-backend-warning">
                <ShieldAlert size={14} />
                Docker is less secure than a virtual machine. Prefer Firecracker, Hyper-V, or Tart for high-risk target execution.
              </div>
            ) : null}

            <div className="provider-grid vm-provider-grid">
              <div>
                <span>Provider</span>
                <strong>{sandboxProviderLabel(selectedBackend.kind)}</strong>
              </div>
              <div>
                <span>Execution</span>
                <strong>{active ? 'selected sandbox' : 'not selected'}</strong>
              </div>
              <div>
                <span>Network</span>
                <strong>{sandboxNetworkProfiles(selectedBackend.kind, executor)}</strong>
              </div>
              <div>
                <span>Availability</span>
                <strong>{selectedBackend.available ? 'available' : selectedBackend.configured ? 'configured' : 'not configured'}</strong>
              </div>
            </div>

            <p className="provider-detail">{sandboxStatusDetail(selectedBackend, active, Boolean(executor))}</p>
            {selectedBackend.reason ? <p className="provider-detail muted">{selectedBackend.reason}</p> : null}
            {setupState?.backendKind === selectedBackend.kind ? (
              <p className={`sandbox-setup-message ${setupState.status}`} role="status">
                {setupState.detail}
              </p>
            ) : null}

            <div className="sandbox-property-list" aria-label={`${selectedBackend.label} properties`}>
              {properties.map((property) => (
                <div className="sandbox-property-row" key={`${property.label}-${property.setting ?? property.value}`}>
                  <span>{property.label}</span>
                  <strong>{property.value}</strong>
                  {property.setting ? <code>{property.setting}</code> : null}
                </div>
              ))}
            </div>

            <div className="provider-actions sandbox-actions">
              {selectedBackend.kind === 'docker' && !selectedBackend.available ? (
                <button type="button" disabled={busy || setupRunning} onClick={() => void setupDocker()}>
                  {setupRunning ? 'Setting Up Docker...' : 'Set Up Docker'}
                </button>
              ) : null}
              {active ? (
                <button type="button" disabled={busy} onClick={() => void onSetVmPreference({ enabled: false, backendKind: null })}>
                  Disable
                </button>
              ) : (
                <button className="primary-button" type="button" disabled={busy || !selectedBackend.available} onClick={() => void onSetVmPreference({ enabled: true, backendKind: selectedBackend.kind })}>
                  Use Sandbox
                </button>
              )}
              <div className="command-row">
                <Terminal size={15} />
                <code>{executorSandboxSetupCommand(executor, selectedBackend.kind)}</code>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function semanticHeading(summary: ProjectSemanticSummary | null, programName: string | null): string {
  const name = programName?.trim() || 'the active program';
  if (!summary) return 'Open a program to manage program understanding indexes.';
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
  const progress =
    typeof summary.progressProcessed === 'number' && typeof summary.progressTotal === 'number'
      ? ` ${summary.progressProcessed.toLocaleString()}/${summary.progressTotal.toLocaleString()} source documents processed.`
      : '';
  if (summary.status === 'queued') return `Queued ${summary.queuedAt ? formatSessionDateTime(summary.queuedAt) : 'now'}. Search will use exact and stale indexed results while the rebuild waits.${progress}`;
  if (summary.status === 'indexing')
    return `Started ${summary.startedAt ? formatSessionDateTime(summary.startedAt) : 'recently'}. Search remains available with exact and stale indexed results.${progress}`;
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

function backendStatusLabel(backend: ExecutorBackendStatus, vmPreference: VmPreference): string {
  if (vmPreference.enabled && vmPreference.backendKind === backend.kind) return backend.available ? 'enabled' : 'unavailable';
  if (backend.available) return 'available';
  if (backend.configured) return 'configured';
  return 'not_configured';
}

function sandboxSelectionStatus(backend: ExecutorBackendStatus, active: boolean): { status: string; heading: string } {
  if (active && backend.available) return { status: 'enabled', heading: `${backend.label} is selected` };
  if (active) return { status: 'unavailable', heading: `${backend.label} is selected but unavailable` };
  if (backend.available) return { status: 'available', heading: `${backend.label} is available` };
  if (backend.configured) return { status: 'configured', heading: `${backend.label} is configured but unavailable` };
  return { status: 'not_configured', heading: `${backend.label} is not configured` };
}

function executorControllerMetadata(executor: ExecutorStatus | null): { autoDiscovered: boolean; command: string | null; configPath: string | null } {
  const metadata = executor?.metadata;
  const controller = metadata?.controller;
  if (!controller || typeof controller !== 'object' || Array.isArray(controller)) {
    return { autoDiscovered: false, command: null, configPath: null };
  }
  const record = controller as Record<string, unknown>;
  return {
    autoDiscovered: record.autoDiscovered === true,
    command: typeof record.command === 'string' && record.command.trim() ? record.command : null,
    configPath: typeof record.configPath === 'string' && record.configPath.trim() ? record.configPath : null
  };
}

function sandboxStatusDetail(backend: ExecutorBackendStatus, active: boolean, hasLiveStatus: boolean): string {
  if (!hasLiveStatus) return 'Open a program to check live availability. You can still review the setup knobs for this sandbox here.';
  if (active && backend.available) return 'Beale can execute target code and verifier contracts inside this disposable sandbox.';
  if (active) return backend.reason ?? 'The selected sandbox backend is not currently available.';
  if (backend.available) return 'Select this sandbox to use it for target execution in new sandbox-backed sessions.';
  return backend.reason ?? 'This sandbox backend is not currently available.';
}

function executorSandboxSetupCommand(executor: ExecutorStatus | null, backendKind: ExecutorBackendKind): string {
  if (backendKind === 'docker') {
    const setupCommand = metadataString(executor, 'setupCommand');
    const image = metadataString(executor, 'image') ?? 'beale-sandbox-toolchain:local';
    return executor?.available ? 'docker info' : setupCommand ?? `docker build -t ${image} docker/sandbox-toolchain`;
  }
  if (executor?.available) return 'npm run firecracker:doctor';
  if (executor?.configured) return 'npm run firecracker:doctor';
  const firecrackerRecommended = !executor || executor.backends.some((backend) => backend.kind === 'firecracker' && backend.recommended);
  if (firecrackerRecommended) return 'npm run firecracker:init && npm run firecracker:doctor';
  return 'Configure BEALE_VMCTL_COMMAND for a Beale vmctl-compatible sandbox controller.';
}

interface SandboxPropertyRow {
  label: string;
  value: string;
  setting?: string;
}

function defaultSandboxBackendKind(backends: ExecutorBackendStatus[]): ExecutorBackendKind | null {
  return (
    backends.find((backend) => backend.available && backend.recommended)?.kind ??
    backends.find((backend) => backend.available)?.kind ??
    backends.find((backend) => backend.recommended)?.kind ??
    backends[0]?.kind ??
    null
  );
}

function sandboxBackendsForDisplay(executor: ExecutorStatus | null): ExecutorBackendStatus[] {
  if (executor?.backends.length) return executor.backends;
  return [
    fallbackSandboxBackend('firecracker', 'Firecracker microVM', 'linux', 'Open a program to check Firecracker availability.'),
    fallbackSandboxBackend('hyperv', 'Hyper-V local VM', 'win32', 'Open a program to check Hyper-V availability.'),
    fallbackSandboxBackend('tart', 'Tart local VM', 'darwin', 'Open a program to check Tart availability.'),
    fallbackSandboxBackend('docker', 'Docker container sandbox', 'any', 'Open a program to check Docker CLI and image availability.'),
    fallbackSandboxBackend('custom_vmctl', 'Custom vmctl controller', 'any', 'Open a program to check the configured vmctl controller.')
  ];
}

function fallbackSandboxBackend(
  kind: ExecutorBackendKind,
  label: string,
  platform: ExecutorBackendStatus['platform'],
  reason: string
): ExecutorBackendStatus {
  return {
    kind,
    label,
    platform,
    configured: false,
    available: false,
    recommended: false,
    reason
  };
}

function sandboxShortLabel(backend: ExecutorBackendStatus): string {
  if (backend.kind === 'custom_vmctl') return 'Custom';
  return backend.label.replace(/\s+(microVM|local VM|container sandbox|controller)$/i, '').trim();
}

function sandboxSelectorDetail(backend: ExecutorBackendStatus): string {
  if (backend.available) return backend.recommended ? 'Available, preferred here' : 'Available';
  if (backend.configured) return 'Configured';
  return backend.platform === 'any' ? 'Not configured' : `${platformLabel(backend.platform)} only`;
}

function sandboxProviderLabel(kind: ExecutorBackendKind): string {
  return kind === 'docker' ? 'docker' : 'vmctl';
}

function sandboxNetworkProfiles(kind: ExecutorBackendKind, executor: ExecutorStatus | null): string {
  if (executor?.provider === sandboxProviderLabel(kind)) return executor.supportedNetworkProfiles.join(', ');
  return kind === 'docker' ? 'offline, elevated' : 'offline, scoped, elevated';
}

function sandboxPropertyRows(backend: ExecutorBackendStatus, executor: ExecutorStatus | null, controller: ReturnType<typeof executorControllerMetadata>): SandboxPropertyRow[] {
  if (backend.kind === 'docker') {
    return [
      { label: 'Docker Image', value: metadataString(executor, 'image') ?? 'beale-sandbox-toolchain:local', setting: 'BEALE_DOCKER_IMAGE' },
      { label: 'Docker Command', value: metadataString(executor, 'dockerCommand') ?? 'docker', setting: 'BEALE_DOCKER_COMMAND' },
      { label: 'Setup Mode', value: metadataString(executor, 'setupMode') ?? 'build local image' },
      { label: 'Dockerfile', value: metadataString(executor, 'dockerfile') ?? 'docker/sandbox-toolchain/Dockerfile', setting: 'BEALE_DOCKERFILE' },
      { label: 'State Directory', value: metadataString(executor, 'stateRoot') ?? 'system temp / beale-docker-sandboxes', setting: 'BEALE_DOCKER_STATE_DIR' },
      { label: 'Execution Timeout', value: '120000 ms', setting: 'BEALE_DOCKER_TIMEOUT_MS' },
      { label: 'Status Timeout', value: '1500 ms', setting: 'BEALE_DOCKER_STATUS_TIMEOUT_MS' }
    ];
  }

  return [
    { label: 'Backend Kind', value: backend.kind, setting: 'BEALE_VM_BACKEND' },
    { label: 'Controller Command', value: controller.command ?? (backend.configured ? 'configured' : 'not configured'), setting: 'BEALE_VMCTL_COMMAND' },
    { label: 'Controller Args', value: 'JSON array', setting: 'BEALE_VMCTL_ARGS_JSON' },
    { label: 'Controller Config', value: controller.configPath ?? 'none' },
    { label: 'Status', value: controller.autoDiscovered ? 'auto discovered' : backend.configured ? 'environment configured' : 'not configured' }
  ];
}

function metadataString(executor: ExecutorStatus | null, key: string): string | null {
  const value = executor?.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function platformLabel(platform: ExecutorBackendStatus['platform']): string {
  if (platform === 'linux') return 'Linux';
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  return 'Any host';
}

function settingsSectionLabel(section: SettingsSection): string {
  switch (section) {
    case 'general':
      return 'General';
    case 'sandboxes':
      return 'Sandboxes';
    case 'providers':
      return 'Providers';
  }
}
