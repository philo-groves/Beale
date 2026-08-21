import { useMemo } from 'react';
import type { JSX } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, GitBranch, Target } from 'lucide-react';
import type {
  HoneycrispCampaignCoverageGapSummary,
  HoneycrispMemorySummary,
  WorkspaceScopeVersion
} from '@shared/types';
import type { ResearchGoalSeed } from '../sessions/SessionNextSteps';
import { layoutCampaignGraph } from '../../view-models/campaignGraph';

const CAMPAIGN_COLUMNS = [
  ['Authorized assets', 'asset'],
  ['Research memory', 'memory'],
  ['Canonical findings', 'finding'],
  ['Proof and reports', 'proof']
] as const;

export function CampaignGraphView({
  memory,
  activeScope,
  onOpenMemory,
  onOpenRunbook,
  onPursue
}: {
  memory: HoneycrispMemorySummary | null;
  activeScope: WorkspaceScopeVersion | null;
  onOpenMemory: (nodeId: string) => void;
  onOpenRunbook: (runbookId: string) => void;
  onPursue: (goal: ResearchGoalSeed) => void;
}): JSX.Element {
  const campaign = memory?.campaign;
  const layout = useMemo(
    () => layoutCampaignGraph(campaign?.nodes ?? [], campaign?.edges ?? []),
    [campaign?.edges, campaign?.nodes]
  );
  const assetLabels = useMemo(() => new Map((activeScope?.assets ?? []).map((asset) => [
    asset.id,
    typeof asset.attributes?.displayName === 'string' && asset.attributes.displayName.trim()
      ? asset.attributes.displayName.trim()
      : asset.value
  ])), [activeScope?.assets]);
  const loading = memory === null || memory.loading === true;

  return (
    <section className="workspace-dashboard-panel campaign-panel" id="workspace-dashboard-campaign-panel" role="tabpanel">
      <header className="campaign-header">
        <div>
          <span className="campaign-eyebrow"><GitBranch aria-hidden="true" size={14} /> Research campaign</span>
          <h2>{loading ? 'Loading campaign…' : campaign?.momentum.reason ?? 'No campaign context available.'}</h2>
          <p>The harness prioritizes uncovered or weakly supported territory and carries this graph into every agent run.</p>
        </div>
        <div className={`campaign-momentum campaign-momentum-${campaign?.momentum.state ?? 'empty'}`}>
          <span>{campaign?.momentum.state.replaceAll('_', ' ') ?? 'empty'}</span>
          <strong>{campaign?.counts.verifiedFindings ?? 0}</strong>
          <small>verified findings</small>
        </div>
      </header>

      <div className="campaign-stat-row" aria-label="Campaign summary">
        <CampaignStat label="Findings" value={campaign?.counts.findings ?? 0} />
        <CampaignStat label="Coverage gaps" value={campaign?.counts.coverageGaps ?? 0} alert={(campaign?.counts.coverageGaps ?? 0) > 0} />
        <CampaignStat label="Contradictions" value={campaign?.counts.contradictions ?? 0} alert={(campaign?.counts.contradictions ?? 0) > 0} />
        <CampaignStat label="Disclosed" value={campaign?.counts.disclosedFindings ?? 0} />
      </div>

      <div className="campaign-content-grid">
        <div className="campaign-map-card">
          <div className="campaign-column-headings">
            {CAMPAIGN_COLUMNS.map(([label]) => <span key={label}>{label}</span>)}
          </div>
          {layout.nodes.length === 0 ? (
            <div className="campaign-empty"><CircleDashed aria-hidden="true" size={24} />No durable campaign nodes yet.</div>
          ) : (
            <div className="campaign-map-scroll">
              <div className="campaign-map" style={{ width: layout.width, height: layout.height }}>
                <svg aria-hidden="true" className="campaign-map-edges" height={layout.height} width={layout.width}>
                  {layout.edges.map((edge) => (
                    <path
                      className={edge.contradictory ? 'contradictory' : ''}
                      d={`M ${edge.x1} ${edge.y1} C ${edge.x1 + 18} ${edge.y1}, ${edge.x2 - 18} ${edge.y2}, ${edge.x2} ${edge.y2}`}
                      key={`${edge.fromId}:${edge.toId}:${edge.relation}`}
                    />
                  ))}
                </svg>
                {layout.nodes.map((node) => {
                  const label = node.kind === 'asset' && node.assetId ? assetLabels.get(node.assetId) ?? node.label : node.label;
                  const actionable = Boolean(node.memoryNodeId) || node.kind === 'runbook';
                  const open = (): void => {
                    if (node.kind === 'runbook') onOpenRunbook(node.id.replace(/^runbook:/u, ''));
                    else if (node.memoryNodeId) onOpenMemory(node.memoryNodeId);
                  };
                  return (
                    <button
                      className={`campaign-node campaign-node-${node.kind} campaign-node-${node.status}`}
                      disabled={!actionable}
                      key={node.id}
                      onClick={open}
                      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                      title={`${label} — ${node.status}`}
                      type="button"
                    >
                      <span>{node.kind}</span>
                      <strong>{label}</strong>
                      <small>{node.status.replaceAll('_', ' ')} · {node.evidenceCount} evidence</small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <aside className="campaign-priority-card" aria-label="Prioritized campaign work">
          <div className="campaign-section-title">
            <Target aria-hidden="true" size={16} />
            <div><strong>Next best territory</strong><span>Evidence-ranked, deduplicated work</span></div>
          </div>
          {(campaign?.nextActions ?? []).length === 0 ? (
            <div className="campaign-complete"><CheckCircle2 aria-hidden="true" size={18} />No unresolved campaign gaps.</div>
          ) : campaign?.nextActions.map((gap) => (
            <CampaignGap gap={gap} key={gap.id} onPursue={onPursue} />
          ))}
        </aside>
      </div>

      {(memory?.findings.length ?? 0) > 0 ? (
        <div className="campaign-findings-ledger">
          <div className="campaign-section-title"><strong>Finding lifecycle</strong><span>Canonical, append-only state</span></div>
          {memory?.findings.map((finding) => (
            <div className="campaign-finding-row" key={finding.id}>
              <button onClick={() => onOpenMemory(finding.memoryNodeId)} type="button">{finding.title}</button>
              <span className={`campaign-finding-status status-${finding.status}`}>{finding.status.replaceAll('_', ' ')}</span>
              <span>{finding.evidence.length} evidence</span>
              <span>rev {finding.revision}</span>
              {finding.authors.length > 0 ? (
                <small>{finding.authors.map((author) => `${author.provider}/${author.model}`).join(', ')}</small>
              ) : null}
              {finding.staleReason ? <small>{finding.staleReason}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CampaignStat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }): JSX.Element {
  return <div className={alert ? 'campaign-stat alert' : 'campaign-stat'}>{alert ? <AlertTriangle aria-hidden="true" size={14} /> : null}<strong>{value}</strong><span>{label}</span></div>;
}

function CampaignGap({ gap, onPursue }: { gap: HoneycrispCampaignCoverageGapSummary; onPursue: (goal: ResearchGoalSeed) => void }): JSX.Element {
  return (
    <article className={`campaign-gap campaign-gap-${gap.priority}`}>
      <span>{gap.priority}</span>
      <strong>{gap.title}</strong>
      <p>{gap.rationale}</p>
      <button onClick={() => onPursue({ sentence: gap.title, phase: 'campaign', promptMarkdown: gap.suggestedPrompt })} type="button">
        Pursue <ArrowRight aria-hidden="true" size={13} />
      </button>
    </article>
  );
}
