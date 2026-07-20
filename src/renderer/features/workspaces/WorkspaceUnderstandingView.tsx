import type { JSX, ReactNode } from 'react';
import { Boxes, Database, FolderOpen, GitBranch, Network } from 'lucide-react';
import type {
  HoneycrispMemoryDirectorySummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispMemorySummary,
  WorkspaceScopeVersion,
  ScopeAsset
} from '@shared/types';
import { formatSessionDateTime, networkProfileLabel, stateClass, traceLabel, truncateText } from '../../lib/formatting';

export function WorkspaceUnderstandingView({
  busy,
  honeycrispMemory,
  onOpenHoneycrispMemoryDirectory,
  runCount,
  scope
}: {
  busy: boolean;
  honeycrispMemory: HoneycrispMemorySummary | null;
  onOpenHoneycrispMemoryDirectory: (name: HoneycrispMemoryDirectorySummary['name']) => void;
  runCount: number;
  scope: WorkspaceScopeVersion | null;
}): JSX.Element {
  const inScopeAssets = scope?.assets.filter((asset) => asset.direction === 'in_scope') ?? [];
  const repositoryAssets = inScopeAssets.filter((asset) => asset.kind === 'repo').slice(0, 6);
  const findings = honeycrispMemory?.nodes.filter((node) => node.type === 'finding') ?? [];
  return (
    <div className="workspace-understanding-workspace" aria-label="Honeycrisp Memory">
      <div className="workspace-understanding-scroll">
        <div className="workspace-understanding-summary-grid" aria-label="Workspace summary">
          <SummaryTile icon={<Database size={17} />} label="Durable Knowledge" value={`${formatCount(honeycrispMemory?.nodeCount ?? 0)} nodes`} detail={`${formatCount(honeycrispMemory?.edgeCount ?? 0)} relationships`} />
          <SummaryTile icon={<GitBranch size={17} />} label="Findings" value={formatCount(findings.length)} detail={`${formatCount(honeycrispMemory?.evidenceRefCount ?? 0)} evidence references`} />
          <SummaryTile icon={<FolderOpen size={17} />} label="Storage" value={`${formatCount(honeycrispMemory?.storageArtifactCount ?? 0)} artifacts`} detail={`${formatCount(honeycrispMemory?.directories.length ?? 0)} directories`} />
          <SummaryTile icon={<Network size={17} />} label="Workspace Tracking" value={`${formatCount(runCount)} sessions`} detail={scope ? networkProfileLabel(scope.networkProfile) : 'No active workspace'} />
        </div>

        <div className="workspace-understanding-layout">
          <section className="workspace-understanding-section workspace-understanding-section-wide" aria-label="Honeycrisp memory">
            <SectionHeader icon={<Database size={16} />} title="Honeycrisp Memory" status={honeycrispMemory?.status ?? 'missing'} />
            <div className="workspace-understanding-metric-grid">
              <MetricCell label="Knowledge Nodes" value={formatCount(honeycrispMemory?.nodeCount ?? 0)} />
              <MetricCell label="Relationships" value={formatCount(honeycrispMemory?.edgeCount ?? 0)} />
              <MetricCell label="Evidence Refs" value={formatCount(honeycrispMemory?.evidenceRefCount ?? 0)} />
              <MetricCell label="Storage Artifacts" value={formatCount(honeycrispMemory?.storageArtifactCount ?? 0)} />
              <MetricCell label="Database Size" value={formatBytes(honeycrispMemory?.databaseSizeBytes ?? 0)} />
              <MetricCell label="Findings" value={formatCount(findings.length)} />
            </div>
            <KeyValueRows
              rows={[
                ['Source', traceLabel(honeycrispMemory?.source ?? 'none')],
                ['Database', honeycrispMemory?.databasePath ?? 'Not initialized'],
                ['Storage Root', honeycrispMemory?.storageRoot ?? 'Not initialized'],
                ['Latest Node', formatNullableDate(honeycrispMemory?.latestNodeUpdatedAt)]
              ]}
            />
            {honeycrispMemory?.lastError ? <p className="workspace-understanding-warning">{honeycrispMemory.lastError}</p> : null}
            <div className="workspace-understanding-list-grid">
              <CountList title="Node Types" counts={honeycrispMemory?.nodeTypeCounts} />
              <CountList title="Node Statuses" counts={honeycrispMemory?.nodeStatusCounts} />
            </div>
            <div className="workspace-understanding-list-grid">
              <MemoryNodeList title="Assets and Boundaries" nodes={nodesByType(honeycrispMemory, ['asset', 'source', 'sink'])} />
              <MemoryNodeList title="Hypotheses" nodes={nodesByType(honeycrispMemory, ['hypothesis'])} />
              <MemoryNodeList title="Findings and Bugs" nodes={nodesByType(honeycrispMemory, ['finding', 'bug'])} />
              <MemoryNodeList title="Invariants and Mitigations" nodes={nodesByType(honeycrispMemory, ['invariant', 'mitigation'])} />
              <MemoryNodeList title="Primitives and Chains" nodes={nodesByType(honeycrispMemory, ['primitive', 'chain'])} />
              <MemoryNodeList title="Procedures and Trajectories" nodes={nodesByType(honeycrispMemory, ['procedure', 'trajectory'])} />
            </div>
            <StorageDirectoryList busy={busy} directories={honeycrispMemory?.directories ?? []} onOpenDirectory={onOpenHoneycrispMemoryDirectory} />
          </section>

          <section className="workspace-understanding-section" aria-label="Workspace tracking">
            <SectionHeader icon={<Boxes size={16} />} title="Workspace Tracking" />
            <KeyValueRows
              rows={[
                ['Workspace', scope?.workspaceName ?? 'None'],
                ['Organization', scope?.scopeOwner ?? 'None'],
                ['Network', scope ? networkProfileLabel(scope.networkProfile) : 'None'],
                ['Scope Version', scope ? `v${scope.version}` : 'None'],
                ['Active From', formatNullableDate(scope?.activeFrom)],
                ['Sessions', formatCount(runCount)],
                ['Honeycrisp Findings', formatCount(findings.length)],
                ['Evidence References', formatCount(honeycrispMemory?.evidenceRefCount ?? 0)]
              ]}
            />
            <CountList title="Asset Types" counts={assetKindCounts(inScopeAssets)} />
            <RepositoryList assets={repositoryAssets} total={inScopeAssets.filter((asset) => asset.kind === 'repo').length} />
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ detail, icon, label, value }: { detail: string; icon: ReactNode; label: string; value: string }): JSX.Element {
  return (
    <div className="workspace-understanding-summary-tile">
      <span className="workspace-understanding-summary-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="workspace-understanding-summary-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function SectionHeader({ action, icon, status, title }: { action?: ReactNode; icon: ReactNode; status?: string; title: string }): JSX.Element {
  return (
    <div className="workspace-understanding-section-header">
      <span className="workspace-understanding-section-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      {status ? <StatusPill value={status} /> : null}
      {action ? <span className="workspace-understanding-section-action">{action}</span> : null}
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="workspace-understanding-metric-cell">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CountList({ counts, title }: { counts: Record<string, number> | null | undefined; title: string }): JSX.Element {
  const entries = topCountEntries(counts, 6);
  return (
    <div className="workspace-understanding-count-list">
      <h4>{title}</h4>
      {entries.length > 0 ? (
        <ul>
          {entries.map(([label, count]) => (
            <li key={label}>
              <span>{traceLabel(label)}</span>
              <strong>{formatCount(count)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>No records yet.</p>
      )}
    </div>
  );
}

function MemoryNodeList({ nodes, title }: { nodes: HoneycrispMemoryNodeSummary[]; title: string }): JSX.Element {
  return (
    <div className="workspace-understanding-count-list">
      <h4>{title}</h4>
      {nodes.length > 0 ? (
        <ul>
          {nodes.slice(0, 5).map((node) => (
            <li key={node.id}>
              <span title={node.summary || node.body}>{truncateText(node.title || node.summary || node.id, 64)}</span>
              <strong title={node.status}>{traceLabel(node.status)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>No records yet.</p>
      )}
    </div>
  );
}

function nodesByType(memory: HoneycrispMemorySummary | null, types: string[]): HoneycrispMemoryNodeSummary[] {
  return memory?.nodes.filter((node) => types.includes(node.type)) ?? [];
}

function KeyValueRows({ rows }: { rows: Array<[string, string]> }): JSX.Element {
  return (
    <dl className="workspace-understanding-key-values">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RepositoryList({ assets, total }: { assets: ScopeAsset[]; total: number }): JSX.Element {
  return (
    <div className="workspace-understanding-repositories">
      <h4>Repositories</h4>
      {assets.length > 0 ? (
        <ul>
          {assets.map((asset) => (
            <li key={asset.id}>
              <span title={asset.value}>{truncateText(asset.value, 72)}</span>
              <small>{traceLabel(asset.sensitivity || 'normal')}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No in-scope repositories recorded.</p>
      )}
      {total > assets.length ? <small>{formatCount(total - assets.length)} more hidden</small> : null}
    </div>
  );
}

function StorageDirectoryList({
  busy,
  directories,
  onOpenDirectory
}: {
  busy: boolean;
  directories: HoneycrispMemoryDirectorySummary[];
  onOpenDirectory: (name: HoneycrispMemoryDirectorySummary['name']) => void;
}): JSX.Element {
  return (
    <div className="workspace-understanding-repositories workspace-understanding-storage-directories">
      <h4>Storage Directories</h4>
      {directories.length > 0 ? (
        <ul>
          {directories.map((directory) => (
            <li key={directory.name}>
              <span title={`${directory.path}\n${directory.purpose}`}>{traceLabel(directory.name)}</span>
              <small>{directory.exists ? `${formatCount(directory.entryCount)} entries` : 'missing'}</small>
              <button
                type="button"
                className="workspace-understanding-row-icon-button"
                title={directory.exists ? `Open ${traceLabel(directory.name)} directory` : `${traceLabel(directory.name)} directory is missing`}
                aria-label={directory.exists ? `Open ${traceLabel(directory.name)} directory` : `${traceLabel(directory.name)} directory is missing`}
                disabled={busy || !directory.exists}
                onClick={() => onOpenDirectory(directory.name)}
              >
                <FolderOpen size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No Honeycrisp storage layout recorded.</p>
      )}
    </div>
  );
}

function StatusPill({ label, value }: { label?: string; value: string }): JSX.Element {
  return (
    <span className={`workspace-understanding-status status-${stateClass(value)}`} title={label ? `${label}: ${traceLabel(value)}` : traceLabel(value)}>
      {label ? `${label}: ` : ''}
      {traceLabel(value)}
    </span>
  );
}

function topCountEntries(counts: Record<string, number> | null | undefined, limit: number): Array<[string, number]> {
  return Object.entries(counts ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function assetKindCounts(assets: ScopeAsset[]): Record<string, number> {
  return assets.reduce<Record<string, number>>((counts, asset) => {
    counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function formatNullableDate(value: string | null | undefined): string {
  return value ? formatSessionDateTime(value) : 'Never';
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatBytes(value: number): string {
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let next = value;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  const digits = next >= 10 || unitIndex === 0 ? 0 : 1;
  return `${next.toFixed(digits)} ${units[unitIndex]}`;
}
