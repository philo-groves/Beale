import type { FormEvent, JSX } from 'react';
import { FolderPlus, GitBranch, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
import type { AgentPluginRecord, AgentPluginRegistryState } from '@shared/types';
import { CenteredLoadingState } from '../../app/CenteredLoadingState';

export function PluginManagerWorkspace({
  state,
  loading,
  busy,
  error,
  repositoryUrl,
  onRepositoryUrlChange,
  onAddFilesystem,
  onAddRepository,
  onSetEnabled,
  onRemove
}: {
  state: AgentPluginRegistryState | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  repositoryUrl: string;
  onRepositoryUrlChange: (value: string) => void;
  onAddFilesystem: () => void;
  onAddRepository: () => void;
  onSetEnabled: (pluginId: string, enabled: boolean) => void;
  onRemove: (pluginId: string) => void;
}): JSX.Element {
  const plugins = state?.plugins ?? [];
  const pluginCountLabel = `${plugins.length} ${plugins.length === 1 ? 'Plugin' : 'Plugins'}`;
  const submittingDisabled = busy || loading || repositoryUrl.trim().length === 0;

  const submitRepository = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!submittingDisabled) onAddRepository();
  };

  return (
    <section className="plugin-manager-workspace" aria-label="Plugins" aria-busy={loading}>
      <div className="plugin-manager-body">
        <section className="plugin-manager-add">
          <button type="button" className="plugin-manager-file-button" disabled={busy || loading} onClick={onAddFilesystem}>
            <FolderPlus size={15} />
            <span>Add from Filesystem</span>
          </button>
          <form className="plugin-manager-repository-form" onSubmit={submitRepository}>
            <GitBranch size={15} aria-hidden="true" />
            <input
              type="url"
              value={repositoryUrl}
              placeholder="https://github.com/owner/plugin"
              disabled={busy || loading}
              onChange={(event) => onRepositoryUrlChange(event.target.value)}
            />
            <button type="submit" className="primary-button" disabled={submittingDisabled}>
              Add Repository
            </button>
          </form>
        </section>

        {error ? <div className="plugin-manager-error">{error}</div> : null}

        <section className="plugin-manager-catalog" aria-label="Installed plugins">
          <h2>{pluginCountLabel}</h2>
          <div className="plugin-manager-list">
            {loading ? (
              <CenteredLoadingState label="Loading plugins…" />
            ) : plugins.length > 0 ? (
              plugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  busy={busy}
                  onSetEnabled={onSetEnabled}
                  onRemove={onRemove}
                />
              ))
            ) : (
              <div className="plugin-manager-empty">
                <strong>No plugins installed</strong>
                <span>Add an Agent Plugin directory or repository.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function PluginCard({
  plugin,
  busy,
  onSetEnabled,
  onRemove
}: {
  plugin: AgentPluginRecord;
  busy: boolean;
  onSetEnabled: (pluginId: string, enabled: boolean) => void;
  onRemove: (pluginId: string) => void;
}): JSX.Element {
  const sourceLabel = plugin.source.kind === 'builtin'
    ? null
    : plugin.source.kind === 'repository'
      ? plugin.source.repositoryUrl ?? plugin.source.path
      : plugin.source.path;
  const visibleMcpServers = plugin.mcpServers.filter((server) => (
    plugin.source.kind !== 'builtin' || server.name !== 'beale'
  ));
  const skillCount = plugin.skills.length;
  const serverCount = plugin.mcpServers.length;
  const invalid = plugin.status === 'invalid';
  const messages = [
    ...plugin.errors,
    ...plugin.warnings,
    ...plugin.mcpServers.flatMap((server) => server.errors.map((message) => `${server.name}: ${message}`))
  ];

  return (
    <article className={`plugin-manager-card ${invalid ? 'invalid' : ''}`}>
      <div className="plugin-manager-card-heading">
        <div className="plugin-manager-card-title">
          <strong>{plugin.name}</strong>
          {plugin.version ? <span>{plugin.version}</span> : null}
        </div>
        <div className="plugin-manager-actions">
          <button
            type="button"
            title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
            disabled={busy || invalid}
            onClick={() => onSetEnabled(plugin.id, !plugin.enabled)}
          >
            {plugin.enabled ? <Power size={15} /> : <PowerOff size={15} />}
            <span>{plugin.enabled ? 'Enabled' : 'Disabled'}</span>
          </button>
          {plugin.source.kind !== 'builtin' ? (
            <button type="button" title="Remove plugin" disabled={busy} onClick={() => onRemove(plugin.id)}>
              <Trash2 size={15} />
              <span>Remove</span>
            </button>
          ) : null}
        </div>
      </div>
      {plugin.description ? <p>{plugin.description}</p> : null}
      <div className="plugin-manager-meta">
        <span>{skillCount} {skillCount === 1 ? 'skill' : 'skills'}</span>
        <span>{serverCount} MCP {serverCount === 1 ? 'server' : 'servers'}</span>
        <span>{plugin.source.kind}</span>
      </div>
      {sourceLabel ? <code title={sourceLabel}>{sourceLabel}</code> : null}
      {plugin.skills.length > 0 ? (
        <div className="plugin-manager-component-list">
          {plugin.skills.map((skill) => (
            <span key={skill.relativePath}>{skill.name}</span>
          ))}
        </div>
      ) : null}
      {visibleMcpServers.length > 0 ? (
        <div className="plugin-manager-component-list">
          {visibleMcpServers.map((server) => (
            <span className={server.valid ? '' : 'invalid'} key={server.name}>{server.name}</span>
          ))}
        </div>
      ) : null}
      {messages.length > 0 ? (
        <div className="plugin-manager-messages">
          <RefreshCw size={12} aria-hidden="true" />
          <span>{messages.join(' ')}</span>
        </div>
      ) : null}
    </article>
  );
}
