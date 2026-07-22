import type { HoneycrispMemorySummary, RunDetail } from '@shared/types';
import { stateClass } from '../lib/formatting';

export type SessionHeat = 'none' | 'low' | 'medium' | 'high' | 'critical';

const SESSION_HEAT_LEVELS: SessionHeat[] = ['none', 'low', 'medium', 'high', 'critical'];

export function sessionHeatForDetail(detail: RunDetail | null): SessionHeat {
  if (!detail) return 'none';
  return sessionHeatForHoneycrispMemory(detail.honeycrispMemory ?? null, detail.run.id);
}

export function sessionHeatForHoneycrispMemory(
  memory: HoneycrispMemorySummary | null | undefined,
  sessionId: string | null
): SessionHeat {
  if (!sessionId || !memory || memory.status === 'missing' || memory.status === 'error') return 'none';

  let heat: SessionHeat = 'none';
  for (const node of memory.nodes) {
    if (node.sessionId !== sessionId) continue;
    heat = maxSessionHeat(heat, sessionHeatForMemoryNode(node.type, node.status));
  }
  return heat;
}

function sessionHeatForMemoryNode(type: string, status: string): SessionHeat {
  const normalizedType = stateClass(type);
  const normalizedStatus = stateClass(status);
  if (normalizedType === 'chain') {
    if (normalizedStatus === 'confirmed') return 'critical';
    if (normalizedStatus === 'suspected') return 'high';
  }
  if (normalizedType === 'primitive') {
    if (normalizedStatus === 'confirmed') return 'medium';
    if (normalizedStatus === 'suspected') return 'low';
  }
  return 'none';
}

function maxSessionHeat(left: SessionHeat, right: SessionHeat): SessionHeat {
  return SESSION_HEAT_LEVELS[Math.max(SESSION_HEAT_LEVELS.indexOf(left), SESSION_HEAT_LEVELS.indexOf(right))];
}
