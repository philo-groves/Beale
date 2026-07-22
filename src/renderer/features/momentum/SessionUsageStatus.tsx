import { memo } from 'react';
import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { useDevRenderProbe } from '../../devInstrumentation';
import { contextMeterForDetail, visibleCacheHitRateLabel, visibleContextMeterLabel, visibleSessionTokenUsageLabel } from './contextMeter';

export const SessionUsageStatus = memo(function SessionUsageStatus({ detail }: { detail: RunDetail }): JSX.Element {
  const contextMeter = contextMeterForDetail(detail);
  const contextLabel = visibleContextMeterLabel(contextMeter);
  const tokenLabel = visibleSessionTokenUsageLabel(contextMeter);
  const cacheHitRateLabel = visibleCacheHitRateLabel(contextMeter);

  useDevRenderProbe('header.usage', () => ({
    context: contextLabel,
    tokens: tokenLabel,
    cacheHitRate: cacheHitRateLabel
  }));

  const contextTooltip = `Context window\n${contextMeter.label}\n${contextMeter.source}`;
  const tokenTooltip = `Session tokens\n${contextMeter.totalSessionTokens.toLocaleString()} tokens used`;
  const cacheTooltip = contextMeter.cacheHitRate === null
    ? 'Prompt cache\nHit rate is not available for this session yet.'
    : `Prompt cache\n${cacheHitRateLabel} hit rate\n${contextMeter.cacheReadTokens.toLocaleString()} cached of ${contextMeter.cachePromptTokens.toLocaleString()} prompt tokens`;

  return (
    <div className="session-usage-status" aria-label={`Context: ${contextMeter.label}. Session tokens: ${tokenLabel}. Cache hit rate: ${cacheHitRateLabel}.`}>
      <span className="session-stat-tooltip" data-tooltip={contextTooltip}>{contextLabel}</span>
      <span className="session-token-usage session-stat-tooltip" data-tooltip={tokenTooltip}>
        {tokenLabel}
      </span>
      <span
        className="session-cache-hit-rate session-stat-tooltip"
        data-tooltip={cacheTooltip}
      >
        {cacheHitRateLabel} cache
      </span>
    </div>
  );
});
