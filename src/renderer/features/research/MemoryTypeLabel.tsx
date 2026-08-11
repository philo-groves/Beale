import type { CSSProperties, JSX } from 'react';
import { Database } from 'lucide-react';
import type { ResearchProfileMemoryType } from '@shared/types';
import { stateClass } from '../../lib/formatting';

type MemoryTypeStyle = CSSProperties & { '--memory-type-color'?: string };

export function memoryTypeDefinition(
  type: string,
  definitions: readonly ResearchProfileMemoryType[] = []
): ResearchProfileMemoryType | null {
  return definitions.find((definition) => definition.id === type || definition.aliases?.includes(type)) ?? null;
}

export function memoryTypeClassName(type: string, definitions: readonly ResearchProfileMemoryType[] = []): string {
  return `memory-type-${stateClass(memoryTypeDefinition(type, definitions)?.id ?? type)}`;
}

export function memoryTypeLabel(type: string, definitions?: readonly ResearchProfileMemoryType[]): string {
  const definition = definitions ? memoryTypeDefinition(type, definitions) : null;
  if (definition) return definition.name;
  const normalized = type.trim().replace(/_/g, ' ').toLocaleLowerCase();
  const fallback = normalized ? `${normalized[0]?.toLocaleUpperCase() ?? ''}${normalized.slice(1)}` : 'Unlabeled';
  return definitions && definitions.length > 0 ? `Unknown type (${fallback})` : fallback;
}

export function MemoryTypeLabel({
  type,
  definitions,
  label = memoryTypeLabel(type, definitions),
  className = '',
  showDot = true
}: {
  type: string;
  definitions?: readonly ResearchProfileMemoryType[];
  label?: string;
  className?: string;
  showDot?: boolean;
}): JSX.Element {
  const definition = memoryTypeDefinition(type, definitions);
  return (
    <span
      className={`memory-type-label ${memoryTypeClassName(type, definitions)} ${className}`.trim()}
      data-memory-type-lifecycle={definition?.lifecycle}
      style={memoryTypeStyle(definition)}
      title={definition?.lifecycle === 'retired' ? `${definition.description} Retired.` : definition?.description}
    >
      {showDot ? <MemoryTypeDot type={type} definitions={definitions} /> : null}
      <span className="memory-type-text">{label}</span>
    </span>
  );
}

export function MemoryTypeDot({
  type,
  definitions,
  className = ''
}: {
  type: string;
  definitions?: readonly ResearchProfileMemoryType[];
  className?: string;
}): JSX.Element {
  const definition = memoryTypeDefinition(type, definitions);
  return (
    <span
      className={`memory-type-dot ${memoryTypeClassName(type, definitions)} ${className}`.trim()}
      style={memoryTypeStyle(definition)}
      aria-hidden="true"
    />
  );
}

export function MemoryTypeIcon({
  type,
  definitions,
  className = ''
}: {
  type: string;
  definitions?: readonly ResearchProfileMemoryType[];
  className?: string;
}): JSX.Element {
  const definition = memoryTypeDefinition(type, definitions);
  return (
    <span
      className={`memory-type-icon ${memoryTypeClassName(type, definitions)} ${className}`.trim()}
      data-memory-icon={definition?.icon}
      style={memoryTypeStyle(definition)}
      aria-hidden="true"
    >
      <Database size={16} />
    </span>
  );
}

function memoryTypeStyle(definition: ResearchProfileMemoryType | null): MemoryTypeStyle | undefined {
  return definition?.color ? { '--memory-type-color': definition.color } : undefined;
}
