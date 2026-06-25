import { useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Server, Wrench } from 'lucide-react';
import type {
  HoneycrispToolingMcpCapabilitySummary,
  HoneycrispToolingSkillSummary,
  HoneycrispToolingSummary,
  HoneycrispToolingToolSummary
} from '@shared/types';
import { Modal } from '../../app/Modal';
import { errorMessage } from '../../lib/errors';

export type HoneycrispToolingModalKind = 'skills' | 'mcpServers';

export function HoneycrispToolingModal({
  kind,
  onClose
}: {
  kind: HoneycrispToolingModalKind;
  onClose: () => void;
}): JSX.Element {
  const [summary, setSummary] = useState<HoneycrispToolingSummary | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    refresh();
  }, []);

  const title = kind === 'skills' ? 'Skills' : 'MCP Servers';

  return (
    <Modal
      title={title}
      wide
      className="honeycrisp-tooling-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modal-footer-leading" disabled={loading} onClick={refresh}>
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
        {error ? (
          <div className="honeycrisp-tooling-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}
        {!loading && !error && summary ? (
          kind === 'skills' ? <SkillsView summary={summary} /> : <McpServersView summary={summary} />
        ) : null}
      </div>
    </Modal>
  );
}

function SkillsView({ summary }: { summary: HoneycrispToolingSummary }): JSX.Element {
  const selected = new Set(summary.skills.selectedIds);
  return (
    <>
      <div className="honeycrisp-tooling-summary-grid">
        <Metric label="Loaded" value={summary.skills.loaded.length} />
        <Metric label="Selected" value={summary.skills.selectedIds.length} />
        <Metric label="Tools" value={summary.tools.length} />
        <Metric label="Source" value="Honeycrisp CLI" />
      </div>
      <section className="honeycrisp-tooling-section">
        <h3>Loaded Skills</h3>
        {summary.skills.loaded.length > 0 ? (
          <div className="honeycrisp-tooling-list">
            {summary.skills.loaded.map((skill) => (
              <SkillCard key={skill.id} skill={skill} selected={selected.has(skill.id)} />
            ))}
          </div>
        ) : (
          <p className="honeycrisp-tooling-empty">No Honeycrisp skills loaded.</p>
        )}
      </section>
      {summary.skills.selectedIds.length > 0 ? (
        <section className="honeycrisp-tooling-section">
          <h3>Selected IDs</h3>
          <PillList values={summary.skills.selectedIds} />
        </section>
      ) : null}
      <ToolFamilies summary={summary} />
    </>
  );
}

function McpServersView({ summary }: { summary: HoneycrispToolingSummary }): JSX.Element {
  const mcp = summary.mcp;
  return (
    <>
      <div className="honeycrisp-tooling-summary-grid">
        <Metric label="Status" value={statusLabel(mcp.status)} />
        <Metric label="Allowed" value={mcp.allowedServers.length} />
        <Metric label="Capabilities" value={mcp.discoveredCapabilities.length} />
        <Metric label="Denied" value={mcp.deniedCapabilities.length} />
      </div>
      <section className="honeycrisp-tooling-section">
        <h3>Servers</h3>
        <div className="honeycrisp-tooling-key-values">
          <KeyValue label="Config" value={mcp.configPath ?? 'None'} />
          <KeyValue label="Configured" value={mcp.configuredServers.length > 0 ? mcp.configuredServers.join(', ') : 'None'} />
          <KeyValue label="Allowed" value={mcp.allowedServers.length > 0 ? mcp.allowedServers.join(', ') : 'None'} />
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

function SkillCard({ skill, selected }: { skill: HoneycrispToolingSkillSummary; selected: boolean }): JSX.Element {
  const source = sourceLabel(skill.source);
  return (
    <article className="honeycrisp-tooling-card">
      <div className="honeycrisp-tooling-card-heading">
        <div>
          <strong>{skill.version ? `${skill.id}@${skill.version}` : skill.id}</strong>
          {skill.description ? <span>{skill.description}</span> : null}
        </div>
        {selected ? (
          <span className="honeycrisp-tooling-selected">
            <CheckCircle2 size={13} />
            Selected
          </span>
        ) : null}
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
