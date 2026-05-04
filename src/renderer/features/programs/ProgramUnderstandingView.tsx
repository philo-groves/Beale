import type { JSX, ReactNode } from 'react';
import { Boxes, Database, GitBranch, Network, Route, SearchCheck, ShieldCheck } from 'lucide-react';
import type {
  ProgramScopeVersion,
  ProjectGraphSummary,
  ProjectSemanticSummary,
  ScopeAsset
} from '@shared/types';
import { formatSessionDateTime, networkProfileLabel, stateClass, traceLabel, truncateText } from '../../lib/formatting';
import { ProgramGraphExplorer } from './ProgramGraphExplorer';
import type { ProgramMainView } from './programViews';

export function ProgramUnderstandingView({
  graph,
  programView,
  runCount,
  scope,
  semantic
}: {
  graph: ProjectGraphSummary | null;
  programView: ProgramMainView;
  runCount: number;
  scope: ProgramScopeVersion | null;
  semantic: ProjectSemanticSummary | null;
}): JSX.Element {
  const inScopeAssets = scope?.assets.filter((asset) => asset.direction === 'in_scope') ?? [];
  const outOfScopeAssets = scope?.assets.filter((asset) => asset.direction === 'out_of_scope') ?? [];
  const repositoryAssets = inScopeAssets.filter((asset) => asset.kind === 'repo').slice(0, 6);
  const graphStatus = graph?.status ?? 'empty';
  const semanticStatus = semantic ? semantic.status : 'empty';
  const semanticChunkDetail = semantic ? `${formatCount(semantic.embeddedChunkCount)} / ${formatCount(semantic.chunkCount)} chunks` : '0 / 0 chunks';
  const semanticSourceDetail = semantic ? `${formatCount(semantic.indexedSourceDocumentCount)} / ${formatCount(semantic.sourceDocumentCount)} sources` : '0 / 0 sources';
  return (
    <div className="program-understanding-workspace" aria-label="Program Understanding">
      <div className="program-understanding-scroll">
        {programView === 'graph' ? (
          <ProgramGraphExplorer graph={graph} scope={scope} />
        ) : (
          <>
            <div className="program-understanding-summary-grid" aria-label="Program summary">
              <SummaryTile icon={<GitBranch size={17} />} label="Relationship Graph" value={formatCount(graph?.nodeCount ?? 0)} detail={`${formatCount(graph?.edgeCount ?? 0)} edges`} />
              <SummaryTile icon={<SearchCheck size={17} />} label="Search Memory" value={semanticChunkDetail} detail={semanticSourceDetail} />
              <SummaryTile icon={<ShieldCheck size={17} />} label="Scope" value={`${formatCount(inScopeAssets.length)} in scope`} detail={`${formatCount(outOfScopeAssets.length)} excluded`} />
              <SummaryTile icon={<Network size={17} />} label="Sessions" value={formatCount(runCount)} detail={scope ? networkProfileLabel(scope.networkProfile) : 'No active program'} />
            </div>

            <div className="program-understanding-layout">
              <section className="program-understanding-section program-understanding-section-wide" aria-label="Relationship graph">
                <SectionHeader icon={<GitBranch size={16} />} title="Relationship Graph" status={graphStatus} />
                <div className="program-understanding-metric-grid">
                  <MetricCell label="Nodes" value={formatCount(graph?.nodeCount ?? 0)} />
                  <MetricCell label="Edges" value={formatCount(graph?.edgeCount ?? 0)} />
                  <MetricCell label="Structural Edges" value={formatCount(graph?.structuralEdgeCount ?? 0)} />
                  <MetricCell label="Unresolved" value={formatCount(graph?.unresolvedEdgeCount ?? 0)} />
                  <MetricCell label="Expected Nodes" value={formatCount(graph?.expectedNodeCount ?? 0)} />
                  <MetricCell label="Builds" value={formatCount(graph?.buildCount ?? 0)} />
                </div>
                <div className="program-understanding-list-grid">
                  <CountList title="Node Families" counts={graph?.nodeFamilyCounts} />
                  <CountList title="Edge Families" counts={graph?.edgeFamilyCounts} />
                  <CountList title="Extraction Families" counts={graph?.extractionFamilyCounts} />
                </div>
                <GraphFreshness graph={graph} />
              </section>

              <section className="program-understanding-section" aria-label="Search memory">
                <SectionHeader icon={<Database size={16} />} title="Search Memory" status={semanticStatus} />
                <div className="program-understanding-metric-grid compact">
                  <MetricCell label="Chunks" value={`${formatCount(semantic?.embeddedChunkCount ?? 0)} / ${formatCount(semantic?.chunkCount ?? 0)}`} />
                  <MetricCell label="Sources" value={`${formatCount(semantic?.indexedSourceDocumentCount ?? 0)} / ${formatCount(semantic?.sourceDocumentCount ?? 0)}`} />
                  <MetricCell label="Index Size" value={formatBytes(semantic?.indexSizeBytes ?? 0)} />
                  <MetricCell label="Provider" value={semantic?.provider ?? 'None'} />
                </div>
                <KeyValueRows
                  rows={[
                    ['Model', semantic?.model ?? 'None'],
                    ['Remote Embeddings', semantic?.remoteEmbeddingEnabled ? 'Enabled' : 'Disabled'],
                    ['Progress', semanticProgressLabel(semantic)],
                    ['Indexed', formatNullableDate(semantic?.indexedAt)]
                  ]}
                />
                <CountList title="Namespaces" counts={semantic?.namespaceCounts} />
                {semantic?.lastError ? <p className="program-understanding-warning">{semantic.lastError}</p> : null}
              </section>

              <section className="program-understanding-section" aria-label="Program scope">
                <SectionHeader icon={<Boxes size={16} />} title="Program Scope" />
                <KeyValueRows
                  rows={[
                    ['Organization', scope?.organizationName ?? 'None'],
                    ['Network', scope ? networkProfileLabel(scope.networkProfile) : 'None'],
                    ['Scope Version', scope ? `v${scope.version}` : 'None'],
                    ['Active From', formatNullableDate(scope?.activeFrom)]
                  ]}
                />
                <CountList title="Asset Types" counts={assetKindCounts(inScopeAssets)} />
                <RepositoryList assets={repositoryAssets} total={inScopeAssets.filter((asset) => asset.kind === 'repo').length} />
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ detail, icon, label, value }: { detail: string; icon: ReactNode; label: string; value: string }): JSX.Element {
  return (
    <div className="program-understanding-summary-tile">
      <span className="program-understanding-summary-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="program-understanding-summary-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function SectionHeader({ icon, status, title }: { icon: ReactNode; status?: string; title: string }): JSX.Element {
  return (
    <div className="program-understanding-section-header">
      <span className="program-understanding-section-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      {status ? <StatusPill value={status} /> : null}
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="program-understanding-metric-cell">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CountList({ counts, title }: { counts: Record<string, number> | null | undefined; title: string }): JSX.Element {
  const entries = topCountEntries(counts, 6);
  return (
    <div className="program-understanding-count-list">
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

function GraphFreshness({ graph }: { graph: ProjectGraphSummary | null }): JSX.Element {
  const staleReasons = graph?.staleReasons ?? [];
  return (
    <div className="program-understanding-freshness">
      <Route size={15} aria-hidden="true" />
      <span>
        Indexed {formatNullableDate(graph?.indexedAt)}
        {graph?.rebuildReason ? ` from ${traceLabel(graph.rebuildReason)}` : ''}
      </span>
      {staleReasons.length > 0 ? (
        <div className="program-understanding-stale-reasons">
          {staleReasons.slice(0, 4).map((reason) => (
            <span key={reason}>{traceLabel(reason)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KeyValueRows({ rows }: { rows: Array<[string, string]> }): JSX.Element {
  return (
    <dl className="program-understanding-key-values">
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
    <div className="program-understanding-repositories">
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

function StatusPill({ label, value }: { label?: string; value: string }): JSX.Element {
  return (
    <span className={`program-understanding-status status-${stateClass(value)}`} title={label ? `${label}: ${traceLabel(value)}` : traceLabel(value)}>
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

function semanticProgressLabel(semantic: ProjectSemanticSummary | null): string {
  if (!semantic) return 'None';
  if (semantic.progressProcessed !== null && semantic.progressTotal !== null) {
    return `${formatCount(semantic.progressProcessed)} / ${formatCount(semantic.progressTotal)}`;
  }
  if (semantic.queuedAt && semantic.status === 'queued') return `Queued ${formatNullableDate(semantic.queuedAt)}`;
  if (semantic.startedAt && semantic.status === 'indexing') return `Started ${formatNullableDate(semantic.startedAt)}`;
  if (semantic.finishedAt) return `Finished ${formatNullableDate(semantic.finishedAt)}`;
  return traceLabel(semantic.status);
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
