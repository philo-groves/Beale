import type { JSX } from 'react';
import { Database } from 'lucide-react';
import { stateClass } from '../../lib/formatting';

export function memoryTypeClassName(type: string): string {
  return `memory-type-${stateClass(type)}`;
}

export function memoryTypeLabel(type: string): string {
  const normalized = type.trim().replace(/_/g, ' ').toLocaleLowerCase();
  return normalized ? `${normalized[0]?.toLocaleUpperCase() ?? ''}${normalized.slice(1)}` : '';
}

export function MemoryTypeLabel({
  type,
  label = memoryTypeLabel(type),
  className = '',
  showDot = true
}: {
  type: string;
  label?: string;
  className?: string;
  showDot?: boolean;
}): JSX.Element {
  return (
    <span className={`memory-type-label ${memoryTypeClassName(type)} ${className}`.trim()}>
      {showDot ? <MemoryTypeDot type={type} /> : null}
      <span className="memory-type-text">{label}</span>
    </span>
  );
}

export function MemoryTypeDot({ type, className = '' }: { type: string; className?: string }): JSX.Element {
  return <span className={`memory-type-dot ${memoryTypeClassName(type)} ${className}`.trim()} aria-hidden="true" />;
}

export function MemoryTypeIcon({ type, className = '' }: { type: string; className?: string }): JSX.Element {
  return (
    <span className={`memory-type-icon ${memoryTypeClassName(type)} ${className}`.trim()} aria-hidden="true">
      <Database size={16} />
    </span>
  );
}
