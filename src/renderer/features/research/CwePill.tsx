import type { JSX } from 'react';
import type { WeaknessMappingRecord } from '@shared/types';
import { traceLabel } from '../../lib/formatting';

export function CwePill({ mappings }: { mappings: WeaknessMappingRecord[] }): JSX.Element | null {
  const primary = mappings.find((mapping) => mapping.mappingRole === 'primary') ?? mappings[0];
  if (!primary) return null;
  const title = [
    `${primary.cweId}: ${primary.cweName}`,
    `Confidence: ${traceLabel(primary.confidence)}`,
    `Mapping: ${traceLabel(primary.mappingStatus)}`,
    primary.rationaleMarkdown
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className={`cwe-pill confidence-${primary.confidence} status-${primary.mappingStatus}`} title={title}>
      {primary.cweId}
    </span>
  );
}
