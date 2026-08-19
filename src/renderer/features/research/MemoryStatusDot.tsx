import type { JSX } from 'react';
import type { ResearchProfileMemoryStatus } from '@shared/types';

export type MemoryStatusPolarity = NonNullable<ResearchProfileMemoryStatus['polarity']> | 'unknown';

export function memoryStatusDefinition(
  status: string,
  definitions: readonly ResearchProfileMemoryStatus[] = []
): ResearchProfileMemoryStatus | null {
  return definitions.find((definition) => definition.id === status) ?? null;
}

export function memoryStatusPolarity(
  status: string,
  definitions: readonly ResearchProfileMemoryStatus[] = []
): MemoryStatusPolarity {
  const definition = memoryStatusDefinition(status, definitions);
  if (definition) return definition.polarity ?? 'neutral';
  if (['confirmed', 'supported', 'verified', 'published', 'complete', 'completed'].includes(status)) return 'positive';
  if (['rejected', 'stale', 'discarded', 'failed'].includes(status)) return 'negative';
  if (['draft', 'open', 'suspected', 'current', 'archived'].includes(status)) return 'neutral';
  return 'unknown';
}

export function memoryStatusLabel(
  status: string,
  definitions: readonly ResearchProfileMemoryStatus[] = []
): string {
  const definition = memoryStatusDefinition(status, definitions);
  if (definition) return definition.name;
  const normalized = status.trim().replace(/[_-]+/gu, ' ').toLocaleLowerCase();
  return normalized ? `${normalized[0]?.toLocaleUpperCase() ?? ''}${normalized.slice(1)}` : 'Unknown';
}

export function MemoryStatusDot({
  status,
  definitions,
  decorative = false
}: {
  status: string;
  definitions?: readonly ResearchProfileMemoryStatus[];
  decorative?: boolean;
}): JSX.Element {
  const definition = memoryStatusDefinition(status, definitions);
  const label = memoryStatusLabel(status, definitions);
  const polarity = memoryStatusPolarity(status, definitions);
  const title = definition?.description ? `${label}: ${definition.description}` : label;
  return (
    <span
      className={`memory-status-dot memory-status-${polarity}`}
      data-memory-status={status}
      data-memory-status-polarity={polarity}
      aria-hidden={decorative ? 'true' : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `Status: ${label}`}
      title={decorative ? undefined : title}
    />
  );
}
