import { memo } from 'react';
import type { JSX } from 'react';
import { BadgePercent, Coins, Gauge } from 'lucide-react';
import type { RunDetail } from '@shared/types';
import { useDevRenderProbe } from '../../devInstrumentation';
import { contextMeterForDetail, visibleCacheHitRateLabel, visibleContextWindowPercentageLabel, visibleCurrentContextTokenLabel, visibleSessionCachedTokenLabel, visibleSessionTokenBreakdownLabel, visibleSessionTokenUsageLabel } from './contextMeter';

export const SessionUsageSummary = memo(function SessionUsageSummary({ detail }: { detail: RunDetail }): JSX.Element {
  const contextMeter = contextMeterForDetail(detail);
  const contextPercentageLabel = visibleContextWindowPercentageLabel(contextMeter);
  const currentContextTokenLabel = visibleCurrentContextTokenLabel(contextMeter);
  const tokenLabel = visibleSessionTokenUsageLabel(contextMeter);
  const tokenBreakdownLabel = visibleSessionTokenBreakdownLabel(contextMeter);
  const cacheHitRateLabel = visibleCacheHitRateLabel(contextMeter);
  const cachedTokenLabel = visibleSessionCachedTokenLabel(contextMeter);

  useDevRenderProbe('research.session-usage', () => ({
    context: contextPercentageLabel,
    tokens: tokenLabel,
    cacheHitRate: cacheHitRateLabel
  }));

  const contextTooltip = `Context window\n${contextPercentageLabel} used (${contextMeter.label})\n${contextMeter.source}`;
  const tokenTooltip = `Session tokens\n${contextMeter.totalSessionTokens.toLocaleString()} tokens used${tokenBreakdownLabel ? `\n${tokenBreakdownLabel}` : ''}`;
  const cacheTooltip = contextMeter.cacheHitRate === null
    ? 'Prompt cache\nHit rate is not available for this session yet.'
    : `Prompt cache\n${cacheHitRateLabel} hit rate\n${contextMeter.cacheReadTokens.toLocaleString()} cached of ${contextMeter.cachePromptTokens.toLocaleString()} prompt tokens`;

  return (
    <div
      className="session-summary-items session-usage-summary"
      role="list"
      aria-label={`Session usage: ${tokenLabel} tokens used, ${cacheHitRateLabel} cache hit rate, ${contextPercentageLabel} context window.`}
    >
      <div className="session-summary-item session-usage-item session-stat-tooltip" role="listitem" data-tooltip={tokenTooltip}>
        <Coins size={15} aria-hidden="true" />
        <span>{tokenLabel} Tokens</span>
        {tokenBreakdownLabel ? <span className="session-summary-meta">{tokenBreakdownLabel}</span> : null}
      </div>
      <div className="session-summary-item session-usage-item session-stat-tooltip" role="listitem" data-tooltip={cacheTooltip}>
        <BadgePercent size={15} aria-hidden="true" />
        <span>{cacheHitRateLabel} Hit Rate</span>
        <span className="session-summary-meta">{cachedTokenLabel}</span>
      </div>
      <div className="session-summary-item session-usage-item session-stat-tooltip" role="listitem" data-tooltip={contextTooltip}>
        <Gauge size={15} aria-hidden="true" />
        <span>{contextPercentageLabel} Context</span>
        <span className="session-summary-meta">{currentContextTokenLabel}</span>
      </div>
    </div>
  );
});

export function SessionUsageSummaryLoading(): JSX.Element {
  const rows = [
    { Icon: Coins, label: 'token count' },
    { Icon: BadgePercent, label: 'cache hit rate' },
    { Icon: Gauge, label: 'context usage' }
  ] as const;
  return (
    <div
      aria-label="Loading session usage"
      aria-busy="true"
      className="session-summary-items session-usage-summary session-usage-summary-loading"
      role="list"
    >
      {rows.map(({ Icon, label }) => (
        <div
          aria-label={`Loading ${label}`}
          className="session-summary-item session-usage-item session-summary-loading-item"
          key={label}
          role="listitem"
        >
          <Icon aria-hidden="true" size={15} />
          <span aria-hidden="true" className="session-summary-loading-line" />
        </div>
      ))}
    </div>
  );
}
