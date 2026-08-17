import type { CSSProperties, JSX } from 'react';
import { Database } from 'lucide-react';
import type { ResearchProfileMemoryType } from '@shared/types';
import { stateClass } from '../../lib/formatting';
import {
  EMPTY_SESSION_HEAT_PREFERENCES,
  SESSION_HEAT_LEVELS
} from '../../view-models/sessionHeat';
import type { SessionHeat, SessionHeatPreferences } from '../../view-models/sessionHeat';

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

export function memoryTypeHeat(
  type: string,
  definitions: readonly ResearchProfileMemoryType[] = [],
  status?: string,
  profileId?: string | null,
  preferences: SessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES
): SessionHeat {
  const definition = memoryTypeDefinition(type, definitions);
  if (!definition) return 'none';
  const statuses = status ? [status] : definition.allowedStatuses;
  return statuses.reduce<SessionHeat>((current, candidateStatus) => {
    const heat = (profileId ? preferences.heatOverrides[profileId]?.[definition.id]?.[candidateStatus] : undefined)
      ?? definition.sessionHeat?.[candidateStatus]
      ?? 'none';
    return SESSION_HEAT_LEVELS.indexOf(heat) > SESSION_HEAT_LEVELS.indexOf(current) ? heat : current;
  }, 'none');
}

export function memoryTypeStyle(
  type: string,
  definitions: readonly ResearchProfileMemoryType[] = [],
  status?: string,
  profileId?: string | null,
  preferences: SessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES
): MemoryTypeStyle | undefined {
  const heat = memoryTypeHeat(type, definitions, status, profileId, preferences);
  return heat === 'none' ? undefined : { '--memory-type-color': `var(--session-heat-${heat}-color)` };
}

export function MemoryTypeLabel({
  type,
  definitions,
  status,
  profileId,
  sessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES,
  label = memoryTypeLabel(type, definitions),
  className = '',
  showDot = true
}: {
  type: string;
  definitions?: readonly ResearchProfileMemoryType[];
  status?: string;
  profileId?: string | null;
  sessionHeatPreferences?: SessionHeatPreferences;
  label?: string;
  className?: string;
  showDot?: boolean;
}): JSX.Element {
  const definition = memoryTypeDefinition(type, definitions);
  const heat = memoryTypeHeat(type, definitions, status, profileId, sessionHeatPreferences);
  return (
    <span
      className={`memory-type-label ${memoryTypeClassName(type, definitions)} ${className}`.trim()}
      data-memory-heat={heat === 'none' ? undefined : heat}
      data-memory-type-lifecycle={definition?.lifecycle}
      style={memoryTypeStyle(type, definitions, status, profileId, sessionHeatPreferences)}
      title={definition?.lifecycle === 'retired' ? `${definition.description} Retired.` : definition?.description}
    >
      {showDot ? (
        <MemoryTypeDot
          type={type}
          definitions={definitions}
          status={status}
          profileId={profileId}
          sessionHeatPreferences={sessionHeatPreferences}
        />
      ) : null}
      <span className="memory-type-text">{label}</span>
    </span>
  );
}

export function MemoryTypeDot({
  type,
  definitions,
  status,
  profileId,
  sessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES,
  className = ''
}: {
  type: string;
  definitions?: readonly ResearchProfileMemoryType[];
  status?: string;
  profileId?: string | null;
  sessionHeatPreferences?: SessionHeatPreferences;
  className?: string;
}): JSX.Element {
  const heat = memoryTypeHeat(type, definitions, status, profileId, sessionHeatPreferences);
  return (
    <span
      className={`memory-type-dot ${memoryTypeClassName(type, definitions)} ${className}`.trim()}
      data-memory-heat={heat === 'none' ? undefined : heat}
      style={memoryTypeStyle(type, definitions, status, profileId, sessionHeatPreferences)}
      aria-hidden="true"
    />
  );
}

export function MemoryTypeIcon({
  type,
  definitions,
  status,
  profileId,
  sessionHeatPreferences = EMPTY_SESSION_HEAT_PREFERENCES,
  className = ''
}: {
  type: string;
  definitions?: readonly ResearchProfileMemoryType[];
  status?: string;
  profileId?: string | null;
  sessionHeatPreferences?: SessionHeatPreferences;
  className?: string;
}): JSX.Element {
  const definition = memoryTypeDefinition(type, definitions);
  const heat = memoryTypeHeat(type, definitions, status, profileId, sessionHeatPreferences);
  return (
    <span
      className={`memory-type-icon ${memoryTypeClassName(type, definitions)} ${className}`.trim()}
      data-memory-heat={heat === 'none' ? undefined : heat}
      data-memory-icon={definition?.icon}
      style={memoryTypeStyle(type, definitions, status, profileId, sessionHeatPreferences)}
      aria-hidden="true"
    >
      <Database size={16} />
    </span>
  );
}
