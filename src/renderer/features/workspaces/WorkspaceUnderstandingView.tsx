import type { JSX, ReactNode } from 'react';
import { Boxes, Database, FolderOpen, GitBranch, MoonStar, RotateCcw } from 'lucide-react';
import type {
  HoneycrispMemoryDirectorySummary,
  MemoryDreamingSummary,
  HoneycrispMemoryNodeSummary,
  HoneycrispMemorySummary,
  ResearchProfile,
  ResearchProfileMemoryStatus,
  ResearchProfileMemoryType,
  ResearchSubject,
  WorkspaceScopeVersion,
  ScopeAsset
} from '@shared/types';
import { formatSessionDateTime, stateClass, traceLabel, truncateText } from '../../lib/formatting';
import { researchProfileFeatureAvailability } from '../../view-models/researchProfileFeatures';
import { MemoryTypeLabel } from '../research/MemoryTypeLabel';
import { orderedCatalogMemoryTypes, pluralizePresentationLabel } from '../research/MemorySidePanel';

export function WorkspaceUnderstandingView({
  busy,
  memoryDreamingInProgress,
  honeycrispMemory,
  researchProfile = null,
  researchSubject = null,
  onOpenHoneycrispMemoryDirectory,
  onRestoreMemoryDreamingChange,
  onRunMemoryDreaming,
  runCount,
  scope
}: {
  busy: boolean;
  memoryDreamingInProgress: boolean;
  honeycrispMemory: HoneycrispMemorySummary | null;
  researchProfile?: ResearchProfile | null;
  researchSubject?: ResearchSubject | null;
  onOpenHoneycrispMemoryDirectory: (name: HoneycrispMemoryDirectorySummary['name']) => void;
  onRestoreMemoryDreamingChange: (changeId: string) => void;
  onRunMemoryDreaming: () => void;
  runCount: number;
  scope: WorkspaceScopeVersion | null;
}): JSX.Element {
  const inScopeAssets = scope?.assets.filter((asset) => asset.direction === 'in_scope') ?? [];
  const repositoryAssets = inScopeAssets.filter((asset) => asset.kind === 'repo').slice(0, 6);
  const primitives = honeycrispMemory?.nodes.filter((node) => node.type === 'primitive') ?? [];
  const memoryLabel = 'Memory';
  const runbookLabel = 'Runbooks';
  const sessionLabel = researchProfile?.presentation.sessionLabel ?? 'Session';
  const workspaceNoun = researchProfile?.workspace.workspaceNoun ?? 'Workspace';
  const subjectNoun = researchProfile?.workspace.subjectNoun ?? 'Subject';
  const memoryTypes = researchProfile?.memory.types ?? [];
  const memoryStatuses = researchProfile?.memory.statuses ?? [];
  const catalogTypes = researchProfile
    ? orderedCatalogMemoryTypes(honeycrispMemory?.nodes ?? [], memoryTypes)
    : [];
  const memoryEnabled = researchProfileFeatureAvailability(researchProfile).memory;
  return (
    <div className="workspace-understanding-workspace" aria-label={`Honeycrisp ${memoryLabel}`}>
      <div className="workspace-understanding-scroll">
        <div className="workspace-understanding-summary-grid" aria-label="Workspace summary">
          <SummaryTile icon={<Database size={17} />} label="Durable Knowledge" value={`${formatCount(honeycrispMemory?.nodeCount ?? 0)} nodes`} detail={`${formatCount(honeycrispMemory?.edgeCount ?? 0)} relationships`} />
          <SummaryTile icon={<GitBranch size={17} />} label={researchProfile ? 'Catalog Types' : 'Primitives'} value={formatCount(researchProfile ? Object.keys(honeycrispMemory?.nodeTypeCounts ?? {}).length : primitives.length)} detail={`${formatCount(honeycrispMemory?.evidenceRefCount ?? 0)} references`} />
          <SummaryTile icon={<FolderOpen size={17} />} label="Storage" value={`${formatCount(honeycrispMemory?.storageArtifactCount ?? 0)} artifacts`} detail={`${formatCount(honeycrispMemory?.runbookCount ?? 0)} ${runbookLabel.toLocaleLowerCase()} · ${formatCount(honeycrispMemory?.directories.length ?? 0)} directories`} />
          <SummaryTile icon={<Boxes size={17} />} label={`${workspaceNoun} Tracking`} value={`${formatCount(runCount)} ${pluralizePresentationLabel(sessionLabel).toLocaleLowerCase()}`} detail={scope?.workspaceName ?? `No active ${workspaceNoun.toLocaleLowerCase()}`} />
        </div>

        <div className="workspace-understanding-layout">
          <section className="workspace-understanding-section workspace-understanding-section-wide" aria-label={`Honeycrisp ${memoryLabel.toLocaleLowerCase()}`}>
            <SectionHeader icon={<Database size={16} />} title={`Honeycrisp ${memoryLabel}`} status={honeycrispMemory?.status ?? 'missing'} />
            <div className="workspace-understanding-metric-grid">
              <MetricCell label="Knowledge Nodes" value={formatCount(honeycrispMemory?.nodeCount ?? 0)} />
              <MetricCell label="Relationships" value={formatCount(honeycrispMemory?.edgeCount ?? 0)} />
              <MetricCell label="References" value={formatCount(honeycrispMemory?.evidenceRefCount ?? 0)} />
              <MetricCell label="Storage Artifacts" value={formatCount(honeycrispMemory?.storageArtifactCount ?? 0)} />
              <MetricCell label={runbookLabel} value={formatCount(honeycrispMemory?.runbookCount ?? 0)} />
              <MetricCell label="Database Size" value={formatBytes(honeycrispMemory?.databaseSizeBytes ?? 0)} />
              <MetricCell label={researchProfile ? 'Catalog Types' : 'Primitives'} value={formatCount(researchProfile ? Object.keys(honeycrispMemory?.nodeTypeCounts ?? {}).length : primitives.length)} />
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
              <CountList title="Node Types" counts={honeycrispMemory?.nodeTypeCounts} memoryTypes={researchProfile ? memoryTypes : []} />
              <CountList title="Node Statuses" counts={honeycrispMemory?.nodeStatusCounts} memoryStatuses={researchProfile ? memoryStatuses : undefined} />
            </div>
            <div className="workspace-understanding-list-grid">
              {researchProfile ? catalogTypes.map((catalogType) => (
                <MemoryNodeList
                  key={catalogType.id}
                  title={memoryTypes.find((definition) => definition.id === catalogType.id || definition.aliases?.includes(catalogType.id))?.pluralName ?? catalogType.label}
                  nodes={nodesByType(honeycrispMemory, [catalogType.id])}
                  memoryStatuses={memoryStatuses}
                />
              )) : (
                <>
                  <MemoryNodeList title="Assets and Boundaries" nodes={nodesByType(honeycrispMemory, ['asset', 'source', 'sink'])} />
                  <MemoryNodeList title="Hypotheses" nodes={nodesByType(honeycrispMemory, ['hypothesis'])} />
                  <MemoryNodeList title="Bug History" nodes={nodesByType(honeycrispMemory, ['bug'])} />
                  <MemoryNodeList title="Invariants and Mitigations" nodes={nodesByType(honeycrispMemory, ['invariant', 'mitigation'])} />
                  <MemoryNodeList title="Primitives and Chains" nodes={nodesByType(honeycrispMemory, ['primitive', 'chain'])} />
                  <MemoryNodeList title="Procedures and Trajectories" nodes={nodesByType(honeycrispMemory, ['procedure', 'trajectory'])} />
                </>
              )}
            </div>
            <StorageDirectoryList busy={busy} directories={honeycrispMemory?.directories ?? []} onOpenDirectory={onOpenHoneycrispMemoryDirectory} />
          </section>

          <section className="workspace-understanding-section" aria-label={`${workspaceNoun} tracking`}>
            <SectionHeader icon={<Boxes size={16} />} title={`${workspaceNoun} Tracking`} />
            <KeyValueRows
              rows={[
                [workspaceNoun, scope?.workspaceName ?? 'None'],
                [subjectNoun, researchSubject?.name ?? 'None'],
                ['Authorization Owner', scope?.scopeOwner || 'None'],
                ['Scope Version', scope ? `v${scope.version}` : 'None'],
                ['Active From', formatNullableDate(scope?.activeFrom)],
                [pluralizePresentationLabel(sessionLabel), formatCount(runCount)],
                [pluralizePresentationLabel(memoryLabel), formatCount(honeycrispMemory?.nodeCount ?? 0)],
                ['References', formatCount(honeycrispMemory?.evidenceRefCount ?? 0)]
              ]}
            />
            <CountList title="Asset Types" counts={assetKindCounts(inScopeAssets)} />
            <RepositoryList assets={repositoryAssets} total={inScopeAssets.filter((asset) => asset.kind === 'repo').length} />
          </section>

          <DreamingSection
            busy={busy}
            enabled={memoryEnabled}
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
  enabled,
  inProgress,
  onRestoreChange,
  onRun
}: {
  busy: boolean;
  dreaming: MemoryDreamingSummary | null;
  enabled: boolean;
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
            disabled={!enabled || busy || inProgress || !available}
            title={!enabled ? 'Memory Dreaming is disabled by the active research profile' : inProgress ? 'Memory Dreaming is reviewing this workspace' : available ? 'Have the research model synthesize workspace memories and past sessions' : 'Honeycrisp memory is not initialized'}
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

function CountList({
  counts,
  memoryStatuses,
  memoryTypes,
  title
}: {
  counts: Record<string, number> | null | undefined;
  memoryStatuses?: readonly ResearchProfileMemoryStatus[];
  memoryTypes?: readonly ResearchProfileMemoryType[];
  title: string;
}): JSX.Element {
  const entries = orderedProfileCountEntries(counts, memoryTypes ?? memoryStatuses, 6);
  const statusById = new Map(memoryStatuses?.map((status) => [status.id, status]) ?? []);
  return (
    <div className="workspace-understanding-count-list">
      <h4>{title}</h4>
      {entries.length > 0 ? (
        <ul>
          {entries.map(([label, count]) => (
            <li key={label}>
              {memoryTypes
                ? <MemoryTypeLabel type={label} definitions={memoryTypes} />
                : <span>{statusById.get(label)?.name ?? (memoryStatuses ? unknownProfileLabel('status', label) : traceLabel(label))}</span>}
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

function MemoryNodeList({
  memoryStatuses,
  nodes,
  title
}: {
  memoryStatuses?: readonly ResearchProfileMemoryStatus[];
  nodes: HoneycrispMemoryNodeSummary[];
  title: string;
}): JSX.Element {
  const statusById = new Map(memoryStatuses?.map((status) => [status.id, status]) ?? []);
  return (
    <div className="workspace-understanding-count-list">
      <h4>{title}</h4>
      {nodes.length > 0 ? (
        <ul>
          {nodes.slice(0, 5).map((node) => (
            <li key={node.id}>
              <span title={node.summary || node.body}>{truncateText(node.title || node.summary || node.id, 64)}</span>
              <strong title={`${node.workspaces.length} workspace associations · ${statusById.get(node.status)?.name ?? traceLabel(node.status)}`}>
                {node.workspaces.length} workspace{node.workspaces.length === 1 ? '' : 's'} · {statusById.get(node.status)?.name ?? (memoryStatuses ? unknownProfileLabel('status', node.status) : traceLabel(node.status))}
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

function orderedProfileCountEntries(
  counts: Record<string, number> | null | undefined,
  definitions: readonly { id: string; order: number }[] | undefined,
  limit: number
): Array<[string, number]> {
  if (!definitions) return topCountEntries(counts, limit);
  const orderById = new Map(definitions.map((definition) => [definition.id, definition.order]));
  return Object.entries(counts ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => {
      const leftOrder = orderById.get(left[0]);
      const rightOrder = orderById.get(right[0]);
      if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder || left[0].localeCompare(right[0]);
      if (leftOrder !== undefined) return -1;
      if (rightOrder !== undefined) return 1;
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit);
}

function unknownProfileLabel(kind: string, id: string): string {
  return `Unknown ${kind} (${id.trim().replace(/[_-]+/gu, ' ') || 'unlabeled'})`;
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
