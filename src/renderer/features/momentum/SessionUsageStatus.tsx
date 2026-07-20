import { memo } from 'react';
import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { useDevRenderProbe } from '../../devInstrumentation';
import { contextMeterForDetail, visibleContextMeterLabel, visibleSessionTokenUsageLabel } from './contextMeter';

export function isSessionUsageVisible(detail: RunDetail | null): boolean {
  return detail !== null;
}

export const SessionUsageStatus = memo(function SessionUsageStatus({ detail }: { detail: RunDetail | null }): JSX.Element {
  const contextMeter = contextMeterForDetail(detail);
  const contextLabel = visibleContextMeterLabel(contextMeter);
  const tokenLabel = visibleSessionTokenUsageLabel(contextMeter);

  useDevRenderProbe('footer.usage', () => ({
    context: contextLabel,
    tokens: tokenLabel
  }));

  return (
    <div className="session-usage-status" aria-label={`Context: ${contextMeter.label}. Session tokens: ${tokenLabel}.`}>
      <span title={`Context: ${contextMeter.label} (${contextMeter.source})`}>{contextLabel}</span>
      <span className="session-token-usage" title={`Total tokens used this session: ${tokenLabel}`}>
        {tokenLabel}
      </span>
    </div>
  );
});
