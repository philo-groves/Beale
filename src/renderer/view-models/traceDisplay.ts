import type { TraceEventRecord } from '@shared/types';

export function traceTurnNumber(event: TraceEventRecord): number | null {
  const turn = event.payload.turn;
  if (typeof turn === 'number' && Number.isInteger(turn) && turn > 0) return turn;
  if (typeof turn === 'string' && /^\d+$/.test(turn)) return Number(turn);
  const match = event.summary.match(/\bturn\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function latestTraceTurnNumber(events: TraceEventRecord[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    latest = traceTurnNumber(event) ?? latest;
  }
  return latest;
}

export function latestTraceGroupKey(events: TraceEventRecord[]): string {
  let key = 'setup';
  for (const event of events) {
    const turnNumber = traceTurnNumber(event);
    if (turnNumber !== null) {
      key = `turn-${turnNumber}-${event.sequence}`;
    }
  }
  return key;
}
