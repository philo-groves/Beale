import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Plus, Save, Server, Trash2, Wrench, XCircle } from 'lucide-react';
import type {
  HoneycrispToolingConfigUpdate,
  HoneycrispToolingMcpCapabilitySummary,
  HoneycrispToolingSkillSummary,
  HoneycrispToolingSummary,
  HoneycrispToolingToolSummary
} from '@shared/types';
import { Modal } from '../../app/Modal';
import { errorMessage } from '../../lib/errors';

export type HoneycrispToolingModalKind = 'skills' | 'mcpServers';

type ToolingUpdateHandler = (update: HoneycrispToolingConfigUpdate) => Promise<boolean>;

export function HoneycrispToolingModal({
  kind,
  onClose
}: {
  kind: HoneycrispToolingModalKind;
  onClose: () => void;
}): JSX.Element {
  const [summary, setSummary] = useState<HoneycrispToolingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    setLoading(true);
    setError(null);
    window.beale
      .getHoneycrispToolingSummary()
      .then(setSummary)
      .catch((caught: unknown) => setError(errorMessage(caught)))
      .finally(() => setLoading(false));
  };

  const applyUpdate: ToolingUpdateHandler = async (update) => {
    setBusyAction(update.type);
    setError(null);
    try {
      const next = await window.beale.updateHoneycrispToolingConfig(update);
      setSummary(next);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const title = kind === 'skills' ? 'Skills' : 'MCP Servers';
  const busy = loading || Boolean(busyAction);

  return (
    <Modal
      title={title}
      wide
      className="honeycrisp-tooling-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modal-footer-leading" disabled={busy} onClick={refresh}>
            Refresh
          </button>
          <button type="button" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="honeycrisp-tooling">
        {loading ? (
          <div className="honeycrisp-tooling-loading">
            <Loader2 size={16} />
            <span>Loading Honeycrisp tooling...</span>
          </div>
        ) : null}
        {busyAction ? (
          <div className="honeycrisp-tooling-loading">
            <Loader2 size={16} />
            <span>Updating Honeycrisp tooling...</span>
          </div>
        ) : null}
        {error ? (
          <div className="honeycrisp-tooling-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}
        {!loading && summary ? (
          kind === 'skills' ? (
            <SkillsView summary={summary} disabled={busy} onUpdate={applyUpdate} />
          ) : (
            <McpServersView summary={summary} disabled={busy} onUpdate={applyUpdate} />
          )
        ) : null}
      </div>
    </Modal>
  );
}

function SkillsView({
  summary,
  disabled,
  onUpdate
}: {
  summary: HoneycrispToolingSummary;
  disabled: boolean;
  onUpdate: ToolingUpdateHandler;
}): JSX.Element {
  const [skillDirDraft, setSkillDirDraft] = useState('');
  const [skillIdDraft, setSkillIdDraft] = useState('');
  const activeSelected = new Set(summary.skills.selectedIds);
  const configuredSelected = new Set(summary.config.preference.selectedSkillIds);

  const addSkillDir = (event: FormEvent): void => {
    event.preventDefault();
    const path = skillDirDraft.trim();
    if (!path) return;
    void onUpdate({ type: 'add_skill_dir', path }).then((ok) => {
      if (ok) setSkillDirDraft('');
    });
  };

  const addSkill = (event: FormEvent): void => {
    event.preventDefault();
    const id = skillIdDraft.trim();
    if (!id) return;
    void onUpdate({ type: 'select_skill', id }).then((ok) => {
      if (ok) setSkillIdDraft('');
    });
  };

  return (
    <>
      <div className="honeycrisp-tooling-summary-grid">
        <Metric label="Loaded" value={summary.skills.loaded.length} />
        <Metric label="Active" value={summary.skills.selectedIds.length} />
        <Metric label="Configured Dirs" value={summary.config.preference.skillDirs.length} />
        <Metric label="Config" value={summary.config.exists ? 'Saved' : 'Default'} />
      </div>
      <section className="honeycrisp-tooling-section">
        <h3>Configuration</h3>
        <div className="honeycrisp-tooling-key-values">
          <KeyValue label="Path" value={summary.config.configPath} />
        </div>
        <form className="honeycrisp-tooling-control-row" onSubmit={addSkillDir}>
          <label>
            <span>Skill directory</span>
            <input
              value={skillDirDraft}
              placeholder="/path/to/skills"
              disabled={disabled}
              onChange={(event) => setSkillDirDraft(event.currentTarget.value)}
            />
          </label>
          <button type="submit" className="honeycrisp-tooling-icon-button" title="Add skill directory" disabled={disabled || !skillDirDraft.trim()}>
            <Plus size={15} />
          </button>
        </form>
        <ConfiguredValueList
          values={summary.config.preference.skillDirs}
          emptyLabel="No configured skill directories."
          removeTitle="Remove skill directory"
          disabled={disabled}
          onRemove={(path) => onUpdate({ type: 'remove_skill_dir', path })}
        />
        <form className="honeycrisp-tooling-control-row" onSubmit={addSkill}>
          <label>
            <span>Skill id</span>
            <input
              value={skillIdDraft}
              placeholder="skill-id"
              disabled={disabled}
              onChange={(event) => setSkillIdDraft(event.currentTarget.value)}
            />
          </label>
          <button type="submit" className="honeycrisp-tooling-icon-button" title="Select skill" disabled={disabled || !skillIdDraft.trim()}>
            <Plus size={15} />
          </button>
        </form>
        <ConfiguredValueList
          values={summary.config.preference.selectedSkillIds}
          emptyLabel="No configured selected skills."
          removeTitle="Deselect skill"
          disabled={disabled}
          onRemove={(id) => onUpdate({ type: 'deselect_skill', id })}
        />
      </section>
      <section className="honeycrisp-tooling-section">
        <h3>Loaded Skills</h3>
        {summary.skills.loaded.length > 0 ? (
          <div className="honeycrisp-tooling-list">
            {summary.skills.loaded.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                selected={activeSelected.has(skill.id)}
                configured={configuredSelected.has(skill.id)}
                disabled={disabled}
                onSelect={(id) => onUpdate({ type: 'select_skill', id })}
                onDeselect={(id) => onUpdate({ type: 'deselect_skill', id })}
              />
            ))}
          </div>
        ) : (
          <p className="honeycrisp-tooling-empty">No Honeycrisp skills loaded.</p>
        )}
      </section>
      <ToolFamilies summary={summary} />
    </>
  );
}

function McpServersView({
  summary,
  disabled,
  onUpdate
}: {
  summary: HoneycrispToolingSummary;
  disabled: boolean;
  onUpdate: ToolingUpdateHandler;
}): JSX.Element {
  const mcp = summary.mcp;
  const [mcpConfigPathDraft, setMcpConfigPathDraft] = useState(summary.config.preference.mcpConfigPath ?? '');
  const [allowedServerDraft, setAllowedServerDraft] = useState('');
  const [timeoutDraft, setTimeoutDraft] = useState(summary.config.preference.mcpTimeoutMs ? String(summary.config.preference.mcpTimeoutMs) : '');

  useEffect(() => {
    setMcpConfigPathDraft(summary.config.preference.mcpConfigPath ?? '');
    setTimeoutDraft(summary.config.preference.mcpTimeoutMs ? String(summary.config.preference.mcpTimeoutMs) : '');
  }, [summary.config.preference.mcpConfigPath, summary.config.preference.mcpTimeoutMs]);

  const saveMcpConfigPath = (event: FormEvent): void => {
    event.preventDefault();
    const path = mcpConfigPathDraft.trim();
    if (!path) return;
    void onUpdate({ type: 'set_mcp_config_path', path });
  };

  const addAllowedServer = (event: FormEvent): void => {
    event.preventDefault();
    const name = allowedServerDraft.trim();
    if (!name) return;
    void onUpdate({ type: 'allow_mcp_server', name }).then((ok) => {
      if (ok) setAllowedServerDraft('');
    });
  };

  const saveTimeout = (event: FormEvent): void => {
    event.preventDefault();
    const timeoutMs = Number.parseInt(timeoutDraft.trim(), 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    void onUpdate({ type: 'set_mcp_timeout_ms', timeoutMs });
  };

  return (
    <>
      <div className="honeycrisp-tooling-summary-grid">
        <Metric label="Status" value={statusLabel(mcp.status)} />
        <Metric label="Allowed" value={mcp.allowedServers.length} />
        <Metric label="Capabilities" value={mcp.discoveredCapabilities.length} />
        <Metric label="Config" value={summary.config.exists ? 'Saved' : 'Default'} />
      </div>
      <section className="honeycrisp-tooling-section">
        <h3>Configuration</h3>
        <div className="honeycrisp-tooling-key-values">
          <KeyValue label="Path" value={summary.config.configPath} />
        </div>
        <form className="honeycrisp-tooling-control-row" onSubmit={saveMcpConfigPath}>
          <label>
            <span>MCP config</span>
            <input
              value={mcpConfigPathDraft}
              placeholder="/path/to/mcp.json"
              disabled={disabled}
              onChange={(event) => setMcpConfigPathDraft(event.currentTarget.value)}
            />
          </label>
          <button type="submit" className="honeycrisp-tooling-icon-button" title="Save MCP config path" disabled={disabled || !mcpConfigPathDraft.trim()}>
            <Save size={15} />
          </button>
          <button
            type="button"
            className="honeycrisp-tooling-icon-button"
            title="Clear MCP config path"
            disabled={disabled || !summary.config.preference.mcpConfigPath}
            onClick={() => void onUpdate({ type: 'clear_mcp_config_path' })}
          >
            <XCircle size={15} />
          </button>
        </form>
        <form className="honeycrisp-tooling-control-row" onSubmit={addAllowedServer}>
          <label>
            <span>Allowed server</span>
            <input
              value={allowedServerDraft}
              placeholder="server-name"
              disabled={disabled}
              onChange={(event) => setAllowedServerDraft(event.currentTarget.value)}
            />
          </label>
          <button type="submit" className="honeycrisp-tooling-icon-button" title="Allow MCP server" disabled={disabled || !allowedServerDraft.trim()}>
            <Plus size={15} />
          </button>
        </form>
        <ConfiguredValueList
          values={summary.config.preference.allowedMcpServers}
          emptyLabel="No configured MCP allowlist."
          removeTitle="Remove allowed MCP server"
          disabled={disabled}
          onRemove={(name) => onUpdate({ type: 'disallow_mcp_server', name })}
        />
        <form className="honeycrisp-tooling-control-row" onSubmit={saveTimeout}>
          <label>
            <span>MCP timeout ms</span>
            <input
              type="number"
              min={1}
              value={timeoutDraft}
              placeholder="30000"
              disabled={disabled}
              onChange={(event) => setTimeoutDraft(event.currentTarget.value)}
            />
          </label>
          <button type="submit" className="honeycrisp-tooling-icon-button" title="Save MCP timeout" disabled={disabled || !timeoutDraft.trim()}>
            <Save size={15} />
          </button>
          <button
            type="button"
            className="honeycrisp-tooling-icon-button"
            title="Clear MCP timeout"
            disabled={disabled || summary.config.preference.mcpTimeoutMs === null}
            onClick={() => void onUpdate({ type: 'clear_mcp_timeout_ms' })}
          >
            <XCircle size={15} />
          </button>
        </form>
      </section>
      <section className="honeycrisp-tooling-section">
        <h3>Servers</h3>
        <div className="honeycrisp-tooling-key-values">
          <KeyValue label="Active Config" value={mcp.configPath ?? 'None'} />
          <KeyValue label="Configured" value={mcp.configuredServers.length > 0 ? mcp.configuredServers.join(', ') : 'None'} />
          <KeyValue label="Active Allowed" value={mcp.allowedServers.length > 0 ? mcp.allowedServers.join(', ') : 'None'} />
          <KeyValue label="Timeout" value={mcp.timeoutMs === null ? 'Default' : `${mcp.timeoutMs} ms`} />
        </div>
      </section>
      <section className="honeycrisp-tooling-section">
        <h3>Discovered Capabilities</h3>
        {mcp.discoveredCapabilities.length > 0 ? (
          <div className="honeycrisp-tooling-list">
            {mcp.discoveredCapabilities.map((capability) => (
              <ToolCard key={`${capability.transportName ?? capability.name}:${capability.name}`} tool={capability} />
            ))}
          </div>
        ) : (
          <p className="honeycrisp-tooling-empty">No MCP capabilities discovered.</p>
        )}
      </section>
      {mcp.resourceTemplates.length > 0 ? (
        <section className="honeycrisp-tooling-section">
          <h3>Resource Templates</h3>
          <pre className="honeycrisp-tooling-json">{JSON.stringify(mcp.resourceTemplates, null, 2)}</pre>
        </section>
      ) : null}
      {mcp.deniedCapabilities.length > 0 ? (
        <section className="honeycrisp-tooling-section">
          <h3>Denied Capabilities</h3>
          <pre className="honeycrisp-tooling-json">{JSON.stringify(mcp.deniedCapabilities, null, 2)}</pre>
        </section>
      ) : null}
      <ToolFamilies summary={summary} />
    </>
  );
}

function SkillCard({
  skill,
  selected,
  configured,
  disabled,
  onSelect,
  onDeselect
}: {
  skill: HoneycrispToolingSkillSummary;
  selected: boolean;
  configured: boolean;
  disabled: boolean;
  onSelect: (id: string) => Promise<boolean>;
  onDeselect: (id: string) => Promise<boolean>;
}): JSX.Element {
  const source = sourceLabel(skill.source);
  return (
    <article className="honeycrisp-tooling-card">
      <div className="honeycrisp-tooling-card-heading">
        <div>
          <strong>{skill.version ? `${skill.id}@${skill.version}` : skill.id}</strong>
          {skill.description ? <span>{skill.description}</span> : null}
        </div>
        <div className="honeycrisp-tooling-card-actions">
          {selected ? (
            <span className="honeycrisp-tooling-selected">
              <CheckCircle2 size={13} />
              Active
            </span>
          ) : null}
          <button
            type="button"
            className="honeycrisp-tooling-icon-button"
            title={configured ? 'Deselect skill' : 'Select skill'}
            disabled={disabled}
            onClick={() => void (configured ? onDeselect(skill.id) : onSelect(skill.id))}
          >
            {configured ? <Trash2 size={14} /> : <Plus size={14} />}
          </button>
        </div>
      </div>
      <div className="honeycrisp-tooling-card-meta">
        {source ? <span>{source}</span> : null}
        {skill.domainTags.length > 0 ? <PillList values={skill.domainTags} /> : null}
      </div>
    </article>
  );
}

function ToolCard({ tool }: { tool: HoneycrispToolingToolSummary | HoneycrispToolingMcpCapabilitySummary }): JSX.Element {
  return (
    <article className="honeycrisp-tooling-card">
      <div className="honeycrisp-tooling-card-heading">
        <div>
          <strong>{tool.name}</strong>
          {tool.transportName ? <span>{tool.transportName}</span> : null}
        </div>
        <Wrench size={15} />
      </div>
      <div className="honeycrisp-tooling-card-meta">
        {tool.actionClasses.length > 0 ? <PillList values={tool.actionClasses} /> : null}
        {tool.sideEffects.length > 0 ? <PillList values={tool.sideEffects} /> : null}
        {tool.requiredPermissions.length > 0 ? <PillList values={tool.requiredPermissions} /> : null}
      </div>
    </article>
  );
}

function ToolFamilies({ summary }: { summary: HoneycrispToolingSummary }): JSX.Element {
  const families = useMemo(
    () => [
      ['Enabled', summary.toolFamilies.enabled],
      ['Requested', summary.toolFamilies.requested],
      ['Disabled', summary.toolFamilies.disabled]
    ] as const,
    [summary.toolFamilies.disabled, summary.toolFamilies.enabled, summary.toolFamilies.requested]
  );
  if (families.every(([, values]) => values.length === 0)) return <></>;
  return (
    <section className="honeycrisp-tooling-section">
      <h3>Tool Families</h3>
      <div className="honeycrisp-tooling-family-grid">
        {families.map(([label, values]) => (
          <div key={label}>
            <span>{label}</span>
            {values.length > 0 ? <PillList values={values} /> : <small>None</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

function ConfiguredValueList({
  values,
  emptyLabel,
  removeTitle,
  disabled,
  onRemove
}: {
  values: string[];
  emptyLabel: string;
  removeTitle: string;
  disabled: boolean;
  onRemove: (value: string) => Promise<boolean>;
}): JSX.Element {
  if (values.length === 0) {
    return <p className="honeycrisp-tooling-empty">{emptyLabel}</p>;
  }
  return (
    <div className="honeycrisp-tooling-config-list">
      {values.map((value) => (
        <div key={value} className="honeycrisp-tooling-config-row">
          <span>{value}</span>
          <button type="button" className="honeycrisp-tooling-icon-button" title={removeTitle} disabled={disabled} onClick={() => void onRemove(value)}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="honeycrisp-tooling-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PillList({ values }: { values: string[] }): JSX.Element {
  return (
    <div className="honeycrisp-tooling-pills">
      {values.map((value) => (
        <span key={value}>{value}</span>
      ))}
    </div>
  );
}

function sourceLabel(source: Record<string, unknown> | null): string {
  if (!source) return '';
  const kind = typeof source.kind === 'string' ? source.kind : '';
  const uri = typeof source.uri === 'string' ? source.uri : '';
  if (kind && uri) return `${kind}: ${uri}`;
  return kind || uri;
}

function statusLabel(status: string): JSX.Element | string {
  if (status === 'configured') {
    return (
      <span className="honeycrisp-tooling-status-ready">
        <Server size={13} />
        Configured
      </span>
    );
  }
  return status.replace(/_/g, ' ');
}
