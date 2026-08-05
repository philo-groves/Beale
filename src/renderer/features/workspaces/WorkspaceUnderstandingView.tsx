import type { JSX, ReactNode } from 'react';
import { Boxes, Database, FolderOpen, GitBranch, MoonStar, Network, RotateCcw } from 'lucide-react';
import type {
  HoneycrispMemoryDirectorySummary,
  MemoryDreamingSummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispMemorySummary,
  WorkspaceScopeVersion,
  ScopeAsset
} from '@shared/types';
import { formatSessionDateTime, networkProfileLabel, stateClass, traceLabel, truncateText } from '../../lib/formatting';
import { MemoryTypeLabel } from '../research/MemoryTypeLabel';

export function WorkspaceUnderstandingView({
  busy,
  memoryDreamingInProgress,
  honeycrispMemory,
  onOpenHoneycrispMemoryDirectory,
  onRestoreMemoryDreamingChange,
  onRunMemoryDreaming,
  runCount,
  scope
}: {
  busy: boolean;
  memoryDreamingInProgress: boolean;
  honeycrispMemory: HoneycrispMemorySummary | null;
  onOpenHoneycrispMemoryDirectory: (name: HoneycrispMemoryDirectorySummary['name']) => void;
  onRestoreMemoryDreamingChange: (changeId: string) => void;
  onRunMemoryDreaming: () => void;
  runCount: number;
  scope: WorkspaceScopeVersion | null;
}): JSX.Element {
  const inScopeAssets = scope?.assets.filter((asset) => asset.direction === 'in_scope') ?? [];
  const repositoryAssets = inScopeAssets.filter((asset) => asset.kind === 'repo').slice(0, 6);
  const primitives = honeycrispMemory?.nodes.filter((node) => node.type === 'primitive') ?? [];
  return (
    <div className="workspace-understanding-workspace" aria-label="Honeycrisp Memory">
      <div className="workspace-understanding-scroll">
        <div className="workspace-understanding-summary-grid" aria-label="Workspace summary">
          <SummaryTile icon={<Database size={17} />} label="Durable Knowledge" value={`${formatCount(honeycrispMemory?.nodeCount ?? 0)} nodes`} detail={`${formatCount(honeycrispMemory?.edgeCount ?? 0)} relationships`} />
          <SummaryTile icon={<GitBranch size={17} />} label="Primitives" value={formatCount(primitives.length)} detail={`${formatCount(honeycrispMemory?.evidenceRefCount ?? 0)} references`} />
          <SummaryTile icon={<FolderOpen size={17} />} label="Storage" value={`${formatCount(honeycrispMemory?.storageArtifactCount ?? 0)} artifacts`} detail={`${formatCount(honeycrispMemory?.runbookCount ?? 0)} runbooks · ${formatCount(honeycrispMemory?.directories.length ?? 0)} directories`} />
          <SummaryTile icon={<Network size={17} />} label="Workspace Tracking" value={`${formatCount(runCount)} sessions`} detail={scope ? networkProfileLabel(scope.networkProfile) : 'No active workspace'} />
        </div>

        <div className="workspace-understanding-layout">
          <section className="workspace-understanding-section workspace-understanding-section-wide" aria-label="Honeycrisp memory">
            <SectionHeader icon={<Database size={16} />} title="Honeycrisp Memory" status={honeycrispMemory?.status ?? 'missing'} />
            <div className="workspace-understanding-metric-grid">
              <MetricCell label="Knowledge Nodes" value={formatCount(honeycrispMemory?.nodeCount ?? 0)} />
              <MetricCell label="Relationships" value={formatCount(honeycrispMemory?.edgeCount ?? 0)} />
              <MetricCell label="References" value={formatCount(honeycrispMemory?.evidenceRefCount ?? 0)} />
              <MetricCell label="Storage Artifacts" value={formatCount(honeycrispMemory?.storageArtifactCount ?? 0)} />
              <MetricCell label="Runbooks" value={formatCount(honeycrispMemory?.runbookCount ?? 0)} />
              <MetricCell label="Database Size" value={formatBytes(honeycrispMemory?.databaseSizeBytes ?? 0)} />
              <MetricCell label="Primitives" value={formatCount(primitives.length)} />
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
              <CountList title="Node Types" counts={honeycrispMemory?.nodeTypeCounts} memoryTypes />
              <CountList title="Node Statuses" counts={honeycrispMemory?.nodeStatusCounts} />
            </div>
            <div className="workspace-understanding-list-grid">
              <MemoryNodeList title="Assets and Boundaries" nodes={nodesByType(honeycrispMemory, ['asset', 'source', 'sink'])} />
              <MemoryNodeList title="Hypotheses" nodes={nodesByType(honeycrispMemory, ['hypothesis'])} />
              <MemoryNodeList title="Bug History" nodes={nodesByType(honeycrispMemory, ['bug'])} />
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
                ['Owner / Subject', scope?.scopeOwner ?? 'None'],
                ['Network', scope ? networkProfileLabel(scope.networkProfile) : 'None'],
                ['Scope Version', scope ? `v${scope.version}` : 'None'],
                ['Active From', formatNullableDate(scope?.activeFrom)],
                ['Sessions', formatCount(runCount)],
                ['Security Primitives', formatCount(primitives.length)],
                ['References', formatCount(honeycrispMemory?.evidenceRefCount ?? 0)]
              ]}
            />
            <CountList title="Asset Types" counts={assetKindCounts(inScopeAssets)} />
            <RepositoryList assets={repositoryAssets} total={inScopeAssets.filter((asset) => asset.kind === 'repo').length} />
          </section>

          <DreamingSection
            busy={busy}
            inProgress={memoryDreamingInProgress}
            dreaming={honeycrispMemory?.dreaming ?? null}
            onRestoreChange={onRestoreMemoryDreamingChange}
            onRun={onRunMemoryDreaming}
          />
        </div>
      </div>
    </div>
  );
}

function DreamingSection({
  busy,
  dreaming,
  inProgress,
  onRestoreChange,
  onRun
}: {
  busy: boolean;
  dreaming: MemoryDreamingSummary | null;
  inProgress: boolean;
  onRestoreChange: (changeId: string) => void;
  onRun: () => void;
}): JSX.Element {
  const available = Boolean(dreaming?.available);
  const lastRun = dreaming?.lastRun ?? null;
  return (
    <section className="workspace-understanding-section workspace-understanding-dreaming" aria-label="Memory dreaming">
      <SectionHeader
        icon={<MoonStar size={16} />}
        title="Dreaming"
        status={inProgress ? 'in_progress' : lastRun?.status ?? (available ? 'ready' : 'unavailable')}
        action={
          <button
            type="button"
            className="workspace-understanding-action-button"
            disabled={busy || inProgress || !available}
            title={inProgress ? 'Memory Dreaming is reviewing this workspace' : available ? 'Have the research model synthesize workspace memories and past sessions' : 'Honeycrisp memory is not initialized'}
            onClick={onRun}
          >
            <MoonStar size={13} />
            {inProgress ? 'Dreaming…' : 'Dream'}
          </button>
        }
      />
      <p className="workspace-understanding-dreaming-copy">
        The research model reviews memories associated with this workspace alongside up to 100 past session transcripts, then prunes, revises, reclassifies, and consolidates semantically redundant knowledge. Original nodes and revisions remain stored for restoration.
      </p>
      <div className="workspace-understanding-metric-grid compact">
        <MetricCell label="Hidden Nodes" value={formatCount(dreaming?.hiddenNodeCount ?? 0)} />
        <MetricCell label="Restorable Changes" value={formatCount(dreaming?.restorableChangeCount ?? 0)} />
        <MetricCell label="Last Pruned" value={formatCount(lastRun?.prunedNodeCount ?? 0)} />
        <MetricCell label="Last De-duplication" value={formatCount(lastRun?.duplicateHiddenCount ?? 0)} />
        <MetricCell label="Last Reclassified" value={formatCount(lastRun?.reclassifiedNodeCount ?? 0)} />
      </div>
      {lastRun?.status === 'failed' && lastRun.errorMessage ? (
        <p className="workspace-understanding-warning" role="status">
          Last Dreaming attempt failed before applying changes: {lastRun.errorMessage}
        </p>
      ) : null}
      <div className="workspace-understanding-dreaming-history">
        <h4>Recent Changes</h4>
        {dreaming?.changes.length ? (
          <ul>
            {dreaming.changes.map((change) => (
              <li key={change.id}>
                <span>
                  <strong title={change.title}>{truncateText(change.title || change.hiddenNodeIds[0] || change.id, 54)}</strong>
                  <small title={change.reason}>
                    {change.action === 'prune'
                      ? 'Memory pruned'
                      : change.action === 'revise'
                        ? 'Memory revised'
                        : change.action === 'reclassify'
                          ? `Memory reclassified as ${change.nodeType}`
                          : `${formatCount(change.hiddenNodeIds.length)} duplicate${change.hiddenNodeIds.length === 1 ? '' : 's'} consolidated`}
                    {' · '}
                    {formatNullableDate(change.createdAt)}
                  </small>
                </span>
                <button
                  type="button"
                  className="workspace-understanding-row-icon-button"
                  disabled={busy || !change.canRestore}
                  title={change.restoredAt ? 'This change has been restored' : change.canRestore ? 'Restore this Dreaming change' : 'Cannot restore because the affected memory changed afterward'}
                  aria-label={`Restore Dreaming change for ${change.title}`}
                  onClick={() => onRestoreChange(change.id)}
                >
                  <RotateCcw size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No Dreaming changes recorded.</p>
        )}
      </div>
      {lastRun ? (
        <small className="workspace-understanding-dreaming-last-run">
          Last {lastRun.status === 'failed' ? 'attempt' : 'run'} {formatNullableDate(lastRun.completedAt)} · {lastRun.model} / {traceLabel(lastRun.reasoningEffort)} · reviewed {formatCount(lastRun.inputNodeCount)} nodes and {formatCount(lastRun.inputSessionCount)} sessions{lastRun.status === 'failed' ? ' · no changes applied' : ` · ${formatCount(lastRun.editedNodeCount)} edited output${lastRun.editedNodeCount === 1 ? '' : 's'}`}
        </small>
      ) : null}
    </section>
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

function CountList({ counts, memoryTypes = false, title }: { counts: Record<string, number> | null | undefined; memoryTypes?: boolean; title: string }): JSX.Element {
  const entries = topCountEntries(counts, 6);
  return (
    <div className="workspace-understanding-count-list">
      <h4>{title}</h4>
      {entries.length > 0 ? (
        <ul>
          {entries.map(([label, count]) => (
            <li key={label}>
              {memoryTypes ? <MemoryTypeLabel type={label} /> : <span>{traceLabel(label)}</span>}
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
              <strong title={`${node.workspaces.length} workspace associations · ${traceLabel(node.status)}`}>
                {node.workspaces.length} workspace{node.workspaces.length === 1 ? '' : 's'} · {traceLabel(node.status)}
              </strong>
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
